# Server-hosted mode: no box in the apartment

Each apartment's CUBE gateway runs on the company server. Devices reach it because **they** connect out to the
server: Shelly Gen2+ devices to CUBE's MQTT broker, LG appliances to ReThink. Residents use the app from
anywhere through the relay. Brands that can't connect to your server are linked through their cloud account in
the app (Add Device → "Link manufacturer account (cloud)").

```
Shelly Gen2+ ──TLS MQTT──▶ mqtt-cube.ems-iot.com:8885 ─┐           LG AC ──▶ ReThink (lg.ems-iot.com)
                                                       ▼                         │
Company server:   cube-mqtt (broker) ◀── cube-gw-<apartment> (one per apartment) ◀┘
                                                       ▲ outbound tunnel
Phone (anywhere) ──▶ https://cube-relay.ems-iot.com ───┘
```

## One-time setup

1. **DNS:** in Cloudflare, an A record `mqtt-cube` → the server's public IP, **DNS only (grey cloud)**. MQTT is
   not HTTP, so it can't go through Cloudflare's proxy.
2. **Network:** forward TCP **8885** on the router to the server, and allow it on the server:
   `sudo ufw allow 8885/tcp`.
3. **Broker:** `./setup-broker.sh mqtt-cube.ems-iot.com`. Creates CUBE's device CA, the broker certificate,
   the broker admin login (in `/home/ems-server/EMS/cube-mqtt/admin.env`, mode 0600) and starts `cube-mqtt`.
   Re-running keeps all of it.
4. **Relay:** add the lines of `admin.env` to the relay's env file and restart it with the CA mounted:
   ```bash
   cat /home/ems-server/EMS/cube-mqtt/admin.env >> /home/ems-server/EMS/cube-relay/relay.env
   docker rm -f cube-relay
   docker run -d --name cube-relay --network host --restart unless-stopped \
     --env-file /home/ems-server/EMS/cube-relay/relay.env -v cube-relay-data:/data \
     -v /home/ems-server/EMS/cube-mqtt/certs/ca.crt:/ca/ca.crt:ro \
     hmahmoud2211/cube-os-gateway:latest relay
   curl https://cube-relay.ems-iot.com/relay/v1/health    # "device_broker": true
   ```

## Per apartment

```bash
./new-apartment.sh tower-a-1203 18701      # name, and a free local port per apartment
```

It starts `cube-gw-tower-a-1203`, waits until it has enrolled with the relay, and prints the **setup code** and
a **pairing QR code** (`cubegw://pair?url=…&code=…`). Give them to the resident: in the app, **Connect gateway →
Scan QR code** (or enter the code and the relay URL). The code works once. A lost code:
`docker exec cube-gw-tower-a-1203 cube-gateway reset-owner`, which prints a new code and QR code, then
`docker restart cube-gw-tower-a-1203`. The QR code in `docker logs` names the relay too.

Each gateway listens on 127.0.0.1 only; nothing per apartment is exposed to the internet.

## Apartments with home-only devices: the tunnel box

TP-Link, Gree, WiZ, Yeelight, Daikin, Tasmota, ESPHome and similar devices never connect out to the internet, so a
gateway on this server can't reach them by itself. For those apartments, a small box at home (a Raspberry Pi, or any
Debian/Ubuntu machine) opens a private WireGuard tunnel from the home network to **that apartment's own gateway
container**. All the logic stays here; the box only passes traffic.

```
cube-gw-<apartment> (own network namespace, wg0 10.200.0.1) <── WireGuard, opened by the box ── box at home ── home devices
```

Each apartment's container has its own network namespace and its own tunnel, so two apartments can both use
192.168.1.0/24. The box connects out, so nothing is opened on the home router.

**Once, on the server side:**
1. **DNS:** `vpn.ems-iot.com` A → the server's public IP, **DNS only (grey cloud)** (or set `TUNNEL_HOST`).
2. **Router:** forward a UDP range to the server, one port per tunnelled apartment (for example 51821–51999), and
   `sudo ufw allow 51821:51999/udp`.
3. **LG appliances in tunnelled apartments:** these containers aren't on the host network, so they reach ReThink's
   MQTT at `host.docker.internal:1885`. ReThink's broker must listen on the Docker bridge too, not only 127.0.0.1,
   and `sudo ufw allow from 172.16.0.0/12 to any port 1885 proto tcp`. The device broker needs nothing extra: they use
   its TLS listener, which already listens on all addresses.

**Per apartment:**
```bash
./new-apartment.sh tower-a-1203 18701 192.168.1.0/24 51821     # name, local port, the home's subnet, its UDP port
```
This prints the setup code and QR code as usual, and writes `tower-a-1203-tunnel.conf`, which holds the box's key.
Copy that file and `tunnel-box.sh` to the box, delete the config here, and on the box run:
```bash
sudo ./tunnel-box.sh tower-a-1203-tunnel.conf
```
It installs WireGuard, starts the tunnel at every boot, and says when the server answered. Check from the server:
`curl -s http://127.0.0.1:18701/api/v1/remote -H "Authorization: Bearer <owner token>"` shows `tunnel.received_bytes`
growing, or simply `docker logs cube-gw-tower-a-1203 | grep tunnel`.

**What changes for the resident:** Add Device lists the home-network brands too, as with a box at home.
- **Found by scanning the home subnet through the tunnel:** Shelly, Daikin, SONOFF (DIY/LAN mode), Tasmota, Samsung TVs.
- **Added with Add by IP address** (find the address in the router's device list): TP-Link Kasa/Tapo, Yeelight,
  ESPHome, WLED, WiZ, LIFX, Gree, Midea, LG TVs.
- **Not through the tunnel:** Tuya (found only by broadcast, and it has no add-by-address route yet), Faikout and
  Matter.

**Limits:**
- **No home internet, no control,** even at home: everything goes through this server.
- **No broadcast or mDNS discovery** through the tunnel, so no Tuya, and **no Matter** (it needs the home network's
  IPv6 and multicast). A full gateway box at home has neither limit.
- **The box must stay powered and online.** Its config holds a private key: treat it like a password.
- **The container runs as root only to create its tunnel** (`--user 0 --cap-add NET_ADMIN`), then continues as the
  normal unprivileged user. The server's kernel needs WireGuard (Linux 5.6 or later; Ubuntu 20.04+ has it).
- **Not tested on real Linux yet:** the commands, keys, configs and routing logic are tested as data; nobody has
  brought a tunnel up on the server or a box.

## What residents can add

| Device | How | Account needed |
| --- | --- | --- |
| Shelly Gen2, Gen3, Gen4 | Add Device → Shelly → **Set up a new Shelly (connects to CUBE's server)**. The phone joins the Shelly's Wi-Fi and gives it the home Wi-Fi, CUBE's CA and its own broker login | None |
| LG ThinQ ACs (ReThink models) | Add Device → LG → **Set up an LG ThinQ appliance for ReThink** | None |
| Meross plugs, strips and bulbs (experimental) | Add Device → Meross → **Set up a new Meross device (connects to CUBE's server)**. The phone joins the device's Wi-Fi and gives it the home Wi-Fi and the broker's address | None |
| SONOFF, Tuya / Smart Life, SwitchBot, Ring, ecobee, tado°, Sensibo, Blink, EZVIZ, Ecovacs | Add Device → brand → **Link … account**, through the building's Home Assistant. The resident signs in to EMS first, and adds the device in the maker's app before linking | The brand's account |
| Samsung SmartThings, Google Nest, Netatmo, August, Yale Home, Miele, Home Connect | The same, once the company has registered an app with the brand ([docs/SMART_HOME.md](../../../docs/SMART_HOME.md), step 3d). Until then they say "not available yet" | The brand's account |
| TP-Link Kasa / Tapo, Xiaomi / Yeelight, WiZ, LIFX, WLED, Daikin, Midea, Gree, Tasmota / OpenBeken, ESPHome, other brands | Listed, marked **Needs a box at home**. They only work on the home network, which the server can't reach, so they need a [gateway in the home](../../../docs/CUBE_GATEWAY.md) | |

Shelly Gen1, WLED and Tasmota on ESP8266 can't use the broker: they only speak unencrypted MQTT, which would send
their passwords across the internet in clear text.

## Security

- **Logins:** every gateway and every device has its own broker login, created by the relay with Mosquitto's
  dynamic security plugin. A gateway can only use `cube/<its id>/#`, a device only `cube/<gateway>/<its slot>/#`.
  Tested: a device login is refused for its apartment's other topics, other apartments, `#` and the broker's
  control topics.
- **Admin access:** only the relay holds the broker admin login. Gateways ask the relay for logins with their
  tunnel secret.
- **TLS:** devices connect over TLS and verify the broker with CUBE's own CA, uploaded during setup with
  Shelly's `Shelly.PutUserCA`.
- **Passwords:** a device's broker password goes from the gateway to the owner's phone to the device. It's never
  written to the gateway's database.
- **Meross:** its firmware fixes its topics (`/appliance/<uuid>/...`) and derives its login from its MAC and a key the
  gateway makes for it, so the login is created once the phone reports the MAC. The relay gives that device and its
  gateway exactly those topics, and refuses a device that already belongs to another gateway. Unlike a Shelly, a Meross
  device can't be given CUBE's CA, so whether its firmware checks the broker's certificate is unknown, and whether it
  connects to this broker at all hasn't been tried with a real device. Test one before offering it to residents.
- **LG appliances on the shared ReThink** are visible only to the gateway that set them up (or paired them).
  During an LG setup, only appliances new to ReThink can match. If two appear at once, the gateway refuses to
  guess.
- **Ownership:** a server-hosted gateway can be claimed through the relay (`CUBE_ALLOW_REMOTE_CLAIM`), still
  only with its single-use setup code (rate-limited, rotated after 10 wrong tries).

## Upgrading

Meross needs the relay's new routes, so upgrade `cube-relay` as well as the apartment gateways. The relay adds its
new table by itself.

## Checks

```bash
docker ps --filter name=cube-                     # cube-mqtt, cube-relay, cube-gw-*
docker logs cube-gw-<name> | grep -E "enrolled|device broker|ReThink"
mosquitto_sub -h 127.0.0.1 -p 8885 -t '#'         # must fail: anonymous clients are refused
```
