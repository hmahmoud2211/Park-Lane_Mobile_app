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
     ghcr.io/hmahmoud2211/cube-os-gateway:latest relay
   curl https://cube-relay.ems-iot.com/relay/v1/health    # "device_broker": true
   ```

## Per apartment

```bash
./new-apartment.sh tower-a-1203 18701      # name, and a free local port per apartment
```

It starts `cube-gw-tower-a-1203`, waits until it has enrolled with the relay, and prints the **setup code** and
a **pairing QR code** (`cubegw://pair?url=…&code=…`). Give them to the resident: in the app, **Connect gateway →
Scan QR code** (or enter the code and the relay URL). The code works once. A lost code:
`docker exec cube-gw-tower-a-1203 cube-gateway reset-owner`, then `docker restart cube-gw-tower-a-1203`.

Each gateway listens on 127.0.0.1 only; nothing per apartment is exposed to the internet.

## What residents can add

| Device | How | Account needed |
| --- | --- | --- |
| Shelly Gen2, Gen3, Gen4 | Add Device → Shelly → **Set up a new Shelly (connects to CUBE's server)**. The phone joins the Shelly's Wi-Fi and gives it the home Wi-Fi, CUBE's CA and its own broker login | None |
| LG ThinQ ACs (ReThink models) | Add Device → LG → **Set up an LG ThinQ appliance for ReThink** | None |
| SONOFF, Tuya / Smart Life, SwitchBot, Ring, ecobee, tado°, Sensibo, Blink, EZVIZ, Ecovacs | Add Device → brand → **Link … account**, through the building's Home Assistant. The resident signs in to EMS first, and adds the device in the maker's app before linking | The brand's account |
| Samsung SmartThings, Google Nest, Netatmo, August, Yale Home, Miele, Home Connect | The same, once the company has registered an app with the brand ([docs/SMART_HOME.md](../../../docs/SMART_HOME.md), step 3d). Until then they say "not available yet" | The brand's account |
| TP-Link Kasa / Tapo, Xiaomi / Yeelight, WiZ, LIFX, WLED, Daikin, Midea, other brands | Listed, marked **Needs a box at home**. They only work on the home network, which the server can't reach, so they need a [gateway in the home](../../../docs/CUBE_GATEWAY.md) | |

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
- **LG appliances on the shared ReThink** are visible only to the gateway that set them up (or paired them).
  During an LG setup, only appliances new to ReThink can match. If two appear at once, the gateway refuses to
  guess.
- **Ownership:** a server-hosted gateway can be claimed through the relay (`CUBE_ALLOW_REMOTE_CLAIM`), still
  only with its single-use setup code (rate-limited, rotated after 10 wrong tries).

## Checks

```bash
docker ps --filter name=cube-                     # cube-mqtt, cube-relay, cube-gw-*
docker logs cube-gw-<name> | grep -E "enrolled|device broker|ReThink"
mosquitto_sub -h 127.0.0.1 -p 8885 -t '#'         # must fail: anonymous clients are refused
```
