# CUBE Gateway: install, connect, compatibility and limits

CUBE OS adds and controls smart devices through the **CUBE Gateway**, a Linux service in one Docker image that
sits on the home network. It finds devices, sets up new ones on Wi-Fi, pairs them locally and keeps them
under control, without manufacturer accounts wherever the device allows it. The phone app is a separate
install (EAS build); Docker only packages the gateway.

- [How it fits together](#how-it-fits-together)
- [No box at home: server-hosted mode](#no-box-at-home-server-hosted-mode)
- [Install the gateway](#install-the-gateway)
- [Connect the app](#connect-the-app)
- [Add a device](#add-a-device)
- [Compatibility](#compatibility)
- [LG ThinQ appliances via ReThink](#lg-thinq-appliances-via-rethink)
- [SONOFF and the S26R2TPF](#sonoff-and-the-s26r2tpf)
- [Matter devices (experimental)](#matter-devices-experimental)
- [Installer-only routes](#installer-only-routes)
- [Remote access](#remote-access)
- [HTTPS at home and through the relay](#https-at-home-and-through-the-relay)
- [Configuration](#configuration)
- [Security model](#security-model)
- [Operations](#operations)
- [Test results](#test-results)
- [Not supported, and why](#not-supported-and-why)

---

## How it fits together

```
 CUBE OS app (phone)
   │  home Wi-Fi: http://<gateway>:8686        away: Tailscale, or https://<relay>/relay/v1/g/<id>
   ▼
 CUBE Gateway  (Docker, --network host, volume /data)
   ├─ discovery: mDNS, SSDP, vendor UDP, authorized subnet probe
   ├─ adapters: Shelly, WLED, SONOFF, Kasa/Tapo, Tuya, LG webOS, Samsung TV, Yeelight, WiZ, LIFX, Daikin, Faikout, Midea, Gree,
   │            Tasmota/OpenBeken, ESPHome, LG ThinQ (ReThink), Nest (NoLongerEvil)
   ├─ provisioning sessions (SoftAP state machine) and pairing
   └─ SQLite registry with sealed credentials, live state, WebSocket events
   │  local protocols only (no manufacturer cloud)
   ▼
 Devices on the home network
```

**Relation to the existing smart home (Home Assistant per unit, `backend/`).** That system links brand
*cloud accounts*. It stays in place because the Parklane Assistant and the deployed `api-iot-2.ems-iot.com`
backend use it, and because some brands have no local protocol. In the app, **Add Device is now the only way
to onboard a device**. When a brand has both routes the resident chooses first: **Pair it from the start** (the
methods below) or **Use my … app account** (linking through the hub). Brands with one route open it directly.
Devices already linked through Home
Assistant keep working and still show in My Devices. Cloud-linked devices can't be moved onto the gateway
automatically: the gateway controls devices over the LAN, the hub through a brand's cloud.

## No box at home: server-hosted mode

If apartments should have **no device at home**, each apartment's gateway runs on the company server instead,
and devices reach it because they connect out to the server:

- **Shelly Gen2/Gen3/Gen4:** set up from the phone. The Shelly gets the home Wi-Fi, CUBE's own CA and its own
  login to CUBE's MQTT broker (`mqtt-cube.ems-iot.com:8885`, TLS), and from then on it connects there.
- **LG ThinQ ACs:** through ReThink, as before. Each apartment only sees the appliances it set up.
- **Meross plugs, strips and bulbs (experimental):** set up from the phone. The device gets the home Wi-Fi and CUBE's
  broker address, and from then on it connects there.
- **Brands with a cloud (SONOFF, Tuya, SwitchBot and others):** linked through the brand's account on the
  building's Home Assistant hub, from the brand's page in Add Device.
- **Brands that only work on the home network (TP-Link, Xiaomi / Yeelight, WiZ, LIFX, WLED, Daikin, Midea, Gree,
  Tasmota / OpenBeken, ESPHome):**
  listed in Add Device and marked as needing a box at home. An apartment can instead get a **tunnel box**: a
  small machine at home that opens a WireGuard tunnel to its own gateway container on the server, so most
  home-network brands work with the logic still on the server (not Tuya or Matter)
  ([gateway/deploy/server-mode/README.md](../gateway/deploy/server-mode/README.md), "the tunnel box").

Residents pair the app with their apartment's gateway through the relay, using a setup code or QR code the
building gives them. The full operator guide is in
[gateway/deploy/server-mode/README.md](../gateway/deploy/server-mode/README.md). Shelly Gen1, WLED and Tasmota on
ESP8266 are not offered in this mode: they only speak unencrypted MQTT.

**Verified on the EMS server (2026-11-04):** broker with TLS and per-device logins; relay issuing logins; a
server-hosted apartment gateway that enrolled itself. Through the public relay URL the test claimed the gateway
and saw only the LG and Shelly brands; the office LG AC was not visible to the apartment. A simulated Shelly then
connected over TLS with its own login, setup reached "connected", and "turn on" came back confirmed. The device
login was refused for every topic outside its own. A real Shelly hasn't been tried yet.

## Install the gateway

You need a Linux machine on the same network as the devices (a mini PC, a Raspberry Pi 4/5 with a 64-bit OS, a
NAS or a server), with Docker installed: `curl -fsSL https://get.docker.com | sudo sh`.

```bash
docker run -d --name cube-os-gateway --network host --restart unless-stopped \
  -v cube-os-data:/data hmahmoud2211/cube-os-gateway:latest
docker logs cube-os-gateway
```

The log shows the gateway's name, a **setup code** such as `76GH-RAZE`, and a QR code. That's all: the first
start creates the database and encryption key in the `cube-os-data` volume, and the container restarts by
itself and keeps its paired devices across restarts and upgrades. Docker reports it `healthy` once the API
answers.

- **The image is on Docker Hub** as `hmahmoud2211/cube-os-gateway`, for `linux/amd64` and `linux/arm64`.
  GitHub Actions (`.github/workflows/cube-gateway.yml`) publishes it: every push to `Master` updates `:latest`
  and `:sha-<commit>`, and a tag `gateway-v1.2.3` publishes `:1.2.3` and `:1.2`. That needs the repository
  secrets `DOCKERHUB_USERNAME` and `DOCKERHUB_TOKEN`. Without Actions, publish from any machine logged in to
  Docker Hub: `docker buildx build --platform linux/amd64,linux/arm64 -t hmahmoud2211/cube-os-gateway:latest --push gateway/`.
- **Docker Hub limits anonymous pulls per address.** On a server that pulls often, `docker login` first (any
  free Docker account) to get the higher limit. Older installs used `ghcr.io/hmahmoud2211/cube-os-gateway`,
  which no longer gets updates.
- **Why host networking:** mDNS, SSDP and the vendors' UDP broadcasts don't cross Docker's bridge network.
  The gateway listens on port 8686 only. It opens no other ports and exposes no device ports.

Upgrade: `docker pull hmahmoud2211/cube-os-gateway:latest && docker rm -f cube-os-gateway`, then run
the same `docker run` command again. The volume keeps everything.

## Connect the app

1. In CUBE OS: **My Devices → Add**, or Smart Home's **+**. With no gateway yet, the app opens **Connect
   gateway**.
2. The app looks for gateways on the phone's Wi-Fi network. It probes the phone's own /24 for port 8686,
   private addresses only. You can also type the address or scan the QR code from the log. Scan it from inside
   the app, because the phone's normal camera can't open it. Scanning fills in the address and the code, and you
   tap **Connect**. If a gateway can't tell its address, its QR code still fills in the code and the app asks for
   the address.
3. Enter the setup code. That phone becomes the **owner**. The code is single-use. A lost code can be shown
   again with `docker exec cube-os-gateway cube-gateway setup-code`.
4. Other phones: the owner creates an invite code (Connect gateway → Invite). Invites last 10 minutes, are
   single-use, and give the **member** role (control devices, nothing else) or **owner**.

The app remembers the gateway. If the gateway's IP changes, the app rescans and recognises it by its ID.
**Before the app sends its token to an address it hasn't used before, the gateway must prove its identity**
with an HMAC over a fresh nonce, keyed with a secret only that phone and the gateway share. A device that
merely advertises the same name or ID gets nothing.

Lost the owner phone? `docker exec cube-os-gateway cube-gateway reset-owner` unpairs every phone (devices
and rooms are kept) and prints a new setup code and QR code. Then `docker restart cube-os-gateway`.

## Add a device

**Add Device → choose the brand → choose how:**

| Option                         | When                                | What happens                                                                                                                                                                        |
| ------------------------------ | ----------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **Find existing device** | The device is already on your Wi-Fi | The gateway scans (mDNS, SSDP, vendor UDP, subnet probe) and lists what it finds: name, model, IP, protocol, whether it needs an account, and what pairing needs. Pick one to pair. |
| **Connect new device**   | Factory-new or reset                | A guided setup through the device's own setup hotspot (below). Shown only for brands with a supported procedure.                                                                    |
| **Advanced**             | Special cases                       | Add by IP address (when the router blocks mDNS); gateway-side Wi-Fi setup (Kasa, LG via ReThink) on gateways with a spare Wi-Fi radio; the cloud-account fallback.                  |

Pairing asks only for what the device needs: nothing (Shelly, WLED, Yeelight, WiZ, LIFX, Kasa legacy), an
**Allow** on the TV (LG webOS, Samsung), a **local key** (Tuya, SONOFF eWeLink LAN mode, Midea V3) or
**credentials** (Tapo: TP-Link account; a Shelly with a password). Then choose a room, rename it, see its
controls and **test control**. The app reports "Working" only when the device confirmed the change. Devices
that don't report back (TV keys) show "Sent, this device doesn't report back".

### Connect new device (SoftAP)

1. Put the device in setup mode. The app shows the brand's steps.
2. The phone joins the device's setup network. On Android 10+ the system asks to connect and keeps the app's
   traffic on that network. On iOS you confirm "Join". In Expo Go, or if the system join fails, the app sends
   you to Wi-Fi settings and detects when you're connected.
3. **Setup network password:** filled in only when a published default exists for that exact model (see
   below). Otherwise you type it. Nothing is guessed.
4. The Wi-Fi details go from the phone **straight to the device** (Shelly: documented RPC), or you enter them
   on the device's own setup page (WLED, SONOFF DIY). The gateway never receives your Wi-Fi password, except
   in the gateway-side setup, where it is used in memory and never stored.
5. The phone returns to your Wi-Fi. The gateway looks for the device for up to 3 minutes, matching it by what
   it learned (the MAC in a Shelly's hotspot name, the SONOFF device ID), pairs it and reads its state. Only
   then does the app say **Connected**. Otherwise it gives the reason and what to do: wrong setup-network
   password, Wi-Fi rejected (2.4 GHz?), device not found (router client isolation?), local key needed,
   permission missing, session expired.

| Plugin                      | Brand        | How                                                                                                       | Setup network                                                                                                            | Status                                                                                |
| --------------------------- | ------------ | --------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------ | ------------------------------------------------------------------------------------- |
| `shelly_softap`           | Shelly       | Phone sends Wi-Fi with the documented API (Gen1 `/settings/sta`, Gen2+ `WiFi.SetConfig`)              | `shelly…-XXXXXX`, open, 192.168.33.1                                                                                  | Supported                                                                             |
| `wled_softap`             | WLED         | You enter Wi-Fi on WLED's page                                                                            | `WLED-AP`, password `wled1234` (WLED's published default)                                                            | Supported                                                                             |
| `sonoff_diy_softap`       | SONOFF       | DIY mode: you enter Wi-Fi on the device's page; the phone also reads the device key from `/device`      | `ITEAD-XXXXXXXX`, password `12345678` (ITEAD DIY doc) for BASICR3, RFR3, MINI, and S26R2TPF                          | Supported for BASICR3/RFR3/MINI; **experimental** for S26R2TPF and others       |
| `kasa_softap`             | TP-Link Kasa | Gateway joins with its own radio, python-kasa `wifi join`                                               | `TP-LINK_…_XXXX`, open                                                                                                | Experimental; needs `CUBE_SOFTAP_INTERFACE`                                         |
| `lg_thinq_softap`         | LG ThinQ     | The phone joins the appliance's network and runs ReThink's setup protocol (ThinQ1, ThinQ2, Whisen) itself | `LGE_…` or `[LG_…]`; you type the password (the app suggests ReThink's documented default for that name, editable) | Experimental; needs ReThink                                                           |
| `lg_thinq_softap_gateway` | LG ThinQ     | Gateway joins with its own radio and runs ReThink's `rethink-setup`                                     | Same                                                                                                                     | Experimental; needs ReThink, `CUBE_SOFTAP_INTERFACE` and `CUBE_RETHINK_SETUP_CMD` |
| `meross_cloud_softap`     | Meross       | Phone sends the Wi-Fi and CUBE's broker address (`Appliance.Config.Key`, `Config.Wifi` or `WifiX`), with Meross's key exchange and encryption on newer firmware | `Meross_…`, open, 10.10.10.1 | Experimental; needs a relay with a device broker |
| `tasmota_softap`          | Tasmota      | You choose your network on the device's page                                                             | `tasmota-XXXXXX-1234`, open, 192.168.4.1 (three minutes after power-up, one client) | Experimental |
| `openbeken_softap`        | OpenBeken    | You enter your network on the device's page                                                              | `Open…_XXXXXXXX`, open, 192.168.4.1 | Experimental |
| `gree_softap_gateway`     | Gree         | Gateway joins with its own radio and sends the Wi-Fi as a UDP packet, which the phone can't send         | 8 characters from the MAC, 192.168.1.1; you type the password (community sources give `12345678`) | Experimental; needs `CUBE_SOFTAP_INTERFACE` |

Tuya/Smart Life, Yeelight, WiZ, LIFX, Midea and Daikin's own adapters join Wi-Fi only through their own apps. TVs join from
their own settings. For these brands, "Connect new device" is shown greyed out with that explanation; once
the device is on Wi-Fi, use Find existing device.

## Compatibility

"Tested on hardware" means tested in this project against a real device. Everything else is tested against
protocol mocks (see [Test results](#test-results)) and must be confirmed per model before you promise it to
residents.

| Brand                          | Adapter              | Protocol                                | Status                                  | Account needed                                                             | Pairing                               | Tested on hardware                                                                                                  |
| ------------------------------ | -------------------- | --------------------------------------- | --------------------------------------- | -------------------------------------------------------------------------- | ------------------------------------- | ------------------------------------------------------------------------------------------------------------------- |
| LG webOS TVs                   | `lg_webos`         | aiowebostv (local WebSocket)            | Supported                               | No                                                                         | Allow on TV                           | No                                                                                                                  |
| LG ThinQ ACs & appliances      | `lg_thinq_rethink` | ReThink MQTT                            | **Experimental**, model-dependent | No (ReThink replaces LG's cloud)                                           | None                                  | **Yes, read-only:** an RAC_056905_WW AC on this server's ReThink (state, model, 12 sensors; no commands sent) |
| Samsung Smart TVs (2016+)      | `samsung_tv`       | samsungtvws (WebSocket 8001/8002)       | Supported                               | No                                                                         | Allow on TV                           | No                                                                                                                  |
| SONOFF DIY mode                | `sonoff_lan`       | ITEAD DIY API v2 (HTTP 8081)            | Supported                               | No                                                                         | None                                  | No                                                                                                                  |
| SONOFF eWeLink LAN mode        | `sonoff_lan`       | AES LAN protocol (SonoffLAN-compatible) | **Experimental**                  | No, but needs the device key                                               | Device key                            | No                                                                                                                  |
| Tuya / Smart Life              | `tuya_local`       | tinytuya (3.1–3.5)                     | Limited                                 | No for control; the key is obtained once with a Tuya IoT developer account | Local key                             | No                                                                                                                  |
| TP-Link Kasa (legacy firmware) | `tplink`           | python-kasa (XOR, port 9999)            | Supported                               | No                                                                         | None                                  | No                                                                                                                  |
| TP-Link Tapo / newer Kasa      | `tplink`           | python-kasa (KLAP/AES)                  | Supported                               | TP-Link account email and password, used locally only                      | Credentials                           | No                                                                                                                  |
| Xiaomi Yeelight                | `yeelight`         | Yeelight Inter-Operation Spec           | Supported                               | No (turn on LAN Control once)                                              | None                                  | No                                                                                                                  |
| Shelly Gen1 / Gen2+            | `shelly`           | Documented HTTP / RPC                   | Supported                               | No                                                                         | None (or device password)             | No                                                                                                                  |
| Philips WiZ                    | `wiz`              | UDP 38899 (community-documented)        | Supported                               | No                                                                         | None                                  | No                                                                                                                  |
| LIFX                           | `lifx`             | LIFX LAN protocol                       | Supported                               | No                                                                         | None                                  | No                                                                                                                  |
| WLED                           | `wled`             | JSON API                                | Supported                               | No                                                                         | None                                  | No                                                                                                                  |
| Daikin (BRP069)                | `daikin`           | Unofficial local HTTP                   | **Experimental**                  | No                                                                         | None (BRP072C: adapter key, untested) | No                                                                                                                  |
| Midea ACs                      | `midea`            | msmart-ng, no cloud calls               | Limited                                 | V3 token and key, obtained once                                            | Token + key                           | No                                                                                                                  |
| Meross plugs, strips, bulbs    | `meross_cloud`     | Meross MQTT through CUBE's broker       | **Experimental**                  | No                                                                         | None (set up from the app)            | No, simulated from real traces. An internet broker with CUBE's private CA is unproven                                |
| Tasmota, OpenBeken firmware    | `tasmota`          | HTTP `/cm?cmnd=`                        | **Experimental**                  | No                                                                         | None (or web password)                | No                                                                                                                  |
| ESPHome firmware               | `esphome`          | ESPHome native API (aioesphomeapi)      | **Experimental**                  | No                                                                         | None, or its API encryption key       | No, run against a stand-in server written from the firmware's source                                                 |
| Gree ACs and rebrands          | `gree`             | UDP 7000, AES ECB or GCM                | **Experimental**                  | No, but firmware decides: some builds are cloud-only                       | None (local bind)                     | No. The cipher was checked against packets people posted in public issue reports                                    |
| Faikout (ESP32 Daikin module)  | `faikout`          | Daikin legacy HTTP, as Faikout serves it | **Experimental**                 | No                                                                         | None; clear any web password first    | No                                                                                                                  |
| Nest Learning gen 1–2          | `nolongerevil`     | NoLongerEvil's control API              | **Experimental**                  | No, once flashed                                                           | None; needs your server and `CUBE_NLE_URL` | No                                                                                                             |
| Matter devices (any brand)     | `matter`           | Matter, through a Matter Server         | **Experimental**                  | No                                                                         | The Matter setup code, or nothing if already on CUBE's fabric | No                                                                                                             |
| Other / unknown                | `generic`          | mDNS / SSDP                             | Detection only                          | —                                                                         | Cannot be paired                      | —                                                                                                                  |

## LG ThinQ appliances via ReThink

ReThink (github.com/anszom/rethink) replaces LG's cloud. The appliance is set up to talk to ReThink, and ReThink
republishes it as Home Assistant-style MQTT. The gateway is an MQTT client of that.

1. **ReThink running.** On this server it already runs: `/home/ems-server/EMS/repo/rethink`, management UI at
   `https://rethink.ems-iot.com` (password-protected), appliances connect to `lg.ems-iot.com`, and its
   Mosquitto broker listens on `127.0.0.1:1885`.
2. **Point new appliances at ReThink.** ThinQ2 appliances (most current ACs) can be given ReThink's address during
   setup: set `CUBE_RETHINK_API_SERVER` and `CUBE_RETHINK_MQTT_SERVER` to ReThink's `advertise` values (on this
   server: `https://lg.ems-iot.com:4443` and `ssl://lg.ems-iot.com:8884`). Then no DNS change is needed.
   ThinQ1 and Whisen appliances always need DNS redirection: the home router must resolve `lgthinq.com` and
   `*.lgthinq.com` to the ReThink server (DNS override, Pi-hole, AdGuard Home, or the `dns` service in
   [`docker/rethink/`](../docker/rethink/)). This server's nginx already forwards `*.lgthinq.com` to ReThink.
3. **Point the gateway at the broker:** `-e CUBE_RETHINK_MQTT_URL=mqtt://<host>:<port>` (credentials as
   `mqtt://user:pass@host:port`; `mqtts://` for TLS). The broker must be reachable from the gateway. The
   broker here is bound to `127.0.0.1`, so only a gateway on this same server can use it as configured.
4. **Set the appliance up for ReThink**, if it's new or still on LG's cloud. In the app: **Add Device → LG →
   Set up an LG ThinQ appliance for ReThink**. The phone joins the appliance's `LGE_…` network and sends your
   Wi-Fi itself. This needs the app build, not Expo Go, because it uses raw TLS sockets. Alternatives: run
   ReThink's `rethink-setup` from a laptop (`npx tsx rethink-setup.ts 192.168.120.254 <ssid> <password>`), or
   let a gateway with a spare Wi-Fi radio do it (`CUBE_SOFTAP_INTERFACE` plus
   `CUBE_RETHINK_SETUP_CMD="npx tsx /opt/rethink/rethink-setup.ts"`). The gateway recognises the new
   appliance as the one ReThink didn't know before setup started.
5. Already on ReThink: **Add Device → LG → Find an appliance on ReThink**.
6. **AC settings:** Device → **All AC settings** shows everything ReThink exposes for the model: mode, set point,
   fan speed, both swings, Jet, Air purify, Energy saving, timers, filter hours and reset, and diagnostics.
   Each setting says when it isn't available and what it needs (e.g. Jet: "AC on, in Cooling or Heating").
   Settings the unit doesn't echo back are shown as not confirmed until it reports.

Notes:

- ReThink is GPL-2.0. The gateway doesn't include ReThink code: it talks MQTT to it and can start its setup
  tool as a separate program. **The app's** `frontend/src/features/lg/services/lgSetupProtocol.ts` (from Master) re-implements
  `rethink-setup.ts` in TypeScript. Have it reviewed for GPL obligations before publishing the app to the
  stores.
- Only models in ReThink's support table are translated. Others appear as unsupported.
- On connect the gateway sends Home Assistant's birth message (`homeassistant/status` = `online`), which makes
  ReThink re-announce its devices. If Home Assistant shares the broker this is harmless; it sends the same.
- Exposed: climate (mode, target temperature, fan, power through ReThink's power topic), every extra ReThink
  announces (switches, numbers, selects, buttons, sensors) as settings with availability, and readings.

## SONOFF and the S26R2TPF

- **DIY mode** (ITEAD's documented API) is local and account-free. ITEAD lists BASICR3, RFR3 and MINI.
  Put a device in Compatible Pairing Mode (hold the button 5 s, then 5 s again until the LED blinks
  continuously), join `ITEAD-XXXXXXXX` with password `12345678`, open `http://10.10.7.1/` and enter your
  2.4 GHz Wi-Fi.
- **S26R2TPF:** this project's earlier SONOFF work confirmed the `ITEAD-` network with `12345678` and
  `GET http://10.10.7.1/device` (returns `deviceid` and `apikey`) on this model. A `POST /ap` request timed
  out, so the gateway doesn't use it. Whether the S26R2TPF's setup page accepts DIY-mode Wi-Fi isn't verified.
  The flow is therefore marked **experimental**. During setup the phone reads `/device` and hands the
  `apikey` to the gateway as the device key. That way, if the plug ends up in eWeLink LAN mode instead of DIY
  mode, pairing can still finish with the encrypted LAN protocol (also experimental).
- **Devices set up with the eWeLink app** encrypt their LAN traffic. They are found but need their device key.
  Pairing checks the key against the device's announcement before accepting it.

## Matter devices (experimental)

The gateway controls Matter devices through a **Matter Server** running next to it on the same machine. The
Matter Server is the Open Home Foundation's controller; Home Assistant uses the same one. It holds CUBE's Matter
network ("fabric"), adds devices to it and keeps a live connection to each. The gateway talks to it over a local
WebSocket.

```bash
docker run -d --name matter-server --network host --restart unless-stopped \
  -v matter-server-data:/data ghcr.io/matter-js/matterjs-server:stable

# then start (or re-create) the gateway with:
#   -e CUBE_MATTER_URL=ws://127.0.0.1:5580/ws
```

The older `ghcr.io/matter-js/python-matter-server:stable` image works too: it has the same API. The Matter Server
needs host networking and IPv6 on the home network. Keep its port (5580) off the internet: it has no login.

**Adding a device.** Add Device → Matter → **Find a Matter device** lists two kinds of device:

- **In pairing mode on your network.** Enter the device's 11-digit Matter setup code. This is the usual route for a
  device already set up in Apple Home, Google Home or its maker's app: use that app's "share" or "pair with
  another app" option, which gives a fresh pairing code and opens a pairing window for a few minutes.
- **Already on CUBE's Matter network** but not added in CUBE yet. No code needed.

**Thread devices** also need a Thread border router at home, such as an Apple TV 4K, a HomePod mini or a Nest Hub.

**What works:** on/off, brightness, white temperature, thermostats (Heat, Cool, Auto, Off), blinds and covers,
and readings for temperature, humidity, door and window contact, motion, power and battery. State changes are
pushed by the device.

**Not yet:** setting up a brand-new device over Bluetooth (it needs Bluetooth on the gateway and your Wi-Fi password
in the Matter Server); Matter bridges such as a Hue Bridge (refused, with a reason); a power strip's other outlets;
locks, fans and colour. Removing a device in CUBE also removes it from CUBE's Matter network.

**Not tested on a real Matter device yet.** The adapter is tested against a simulator that speaks the Matter
Server's API (`gateway/tests/adapters/test_matter.py`). Try a plug and a light before offering it to residents.

## Installer-only routes

These projects change a device's firmware or depend on the home network's DNS, so they can't be a step in the app.
A resident can't undo them, and some can brick a device. They are for your installers, on hardware you own.

| Project | What it does | How it reaches CUBE |
| ------- | ------------ | ------------------- |
| [tuya-cloudcutter](https://github.com/tuya-cloudcutter/tuya-cloudcutter) (MIT) | Detaches Tuya devices from Tuya's cloud over Wi-Fi, or flashes new firmware. Needs Linux and a Wi-Fi card. Only Beken and some Realtek chips, on firmware from before Tuya's February 2022 patch. The device stops working with Tuya's apps | A detached device with a local key you set: **Tuya / Smart Life**. Flashed with OpenBeken: **Tasmota / OpenBeken** |
| Tasmota, ESPHome | Replacement firmware for ESP devices, flashed by serial or over the air. An ESPHome device is built per device, so the app can't set one up, only find it | **Tasmota / OpenBeken**, **ESPHome** |
| [NoLongerEvil](https://docs.nolongerevil.com/self-hosted/installation) (MIT) | Firmware for Nest Learning gen 1–2, flashed over USB from macOS or Linux, plus a server you run. A failed flash can brick the thermostat | Set `CUBE_NLE_URL` to its control API. **Never expose port 8082: it has no authentication.** Google Nest then also lists **Find a Nest on NoLongerEvil** |
| [Faikout](https://codeberg.org/RevK/ESP32-Faikout) (GPL-3.0) | A module that replaces Daikin's Wi-Fi adapter on the S21 or X50 port. It also supports MQTT with TLS to a remote broker, but its topics are fixed, so that route isn't built | **Daikin → Find a Faikout module**, on the home network |
| [Bumper](https://bumper.readthedocs.io/en/latest/DNS_Setup/) (GPL-3.0) | Replaces Ecovacs's cloud. Needs a DNS override on the apartment's network and a separate server. It offers no command API, only the Ecovacs app's own protocol | **No adapter.** Ecovacs stays on its account link |
| [Fake-Gree-server](https://github.com/rapi3/Fake-Gree-server) (GPL-3.0) | Answers a Gree unit's registration and heartbeat, for units that stop working without them. Needs a DNS override | Not used by the gateway. **Gree** control is local; run this alongside it only if a unit needs it |

GPL projects run as separate programs; none of their code is in the gateway. The gateway's adapters are written from
each protocol's published behaviour.

## Remote access

Local control works without internet. Away from home you need a route to the gateway. There are two, and
neither exposes the gateway or any device port to the internet.

### Tailscale / WireGuard (development, and end-to-end encrypted)

1. Install Tailscale on the gateway host and on the phone, both signed in to the same tailnet.
2. The gateway's Tailscale address (`100.x.y.z`, or its MagicDNS name) appears in the app's Connect gateway →
   Remote access (`GET /api/v1/remote` lists it). Add `http://100.x.y.z:8686` as the remote address.
3. The app uses the home address when it answers and the Tailscale address otherwise, verifying the gateway's
   identity the first time it uses each address.

Traffic is WireGuard-encrypted end to end. Any WireGuard setup works the same way: give the phone a route to
the gateway's address.

### The CUBE relay (production)

The same image runs a relay: `cube-gateway relay`. Gateways keep an outbound WebSocket to it, so no router
ports are opened. The app calls `https://<relay>/relay/v1/g/<gateway_id>/api/v1/...` with the same token it
uses at home. **The gateway checks every request itself.** The relay only routes. It stores gateway IDs and
hashed tunnel secrets, never client tokens or device credentials. Owners can't be claimed through the relay,
however the address is written: the gateway accepts only plain API paths from the tunnel and checks again in the
claim itself. Each caller behind the relay is rate-limited separately. A relay that manages the device broker won't
start without `CUBE_RELAY_ENROLL_TOKEN`, and it only believes `X-Real-IP` / `X-Forwarded-For` from a proxy on its
own host or private network (including Docker's bridge).

Run it on a public server, behind HTTPS:

```bash
docker run -d --name cube-relay --restart unless-stopped -p 127.0.0.1:8687:8687 \
  -e CUBE_RELAY_ENROLL_TOKEN="$(openssl rand -base64 32)" -v cube-relay-data:/data \
  hmahmoud2211/cube-os-gateway:latest relay
```

nginx (WebSockets must pass through):

```nginx
server {
    listen 443 ssl;
    server_name cube-relay.ems-iot.com;
    ssl_certificate     /etc/nginx/ssl/cube/cert.pem;      # Cloudflare origin certificate for *.ems-iot.com
    ssl_certificate_key /etc/nginx/ssl/cube/key.pem;
    location /relay/ {
        proxy_pass http://127.0.0.1:8687;
        proxy_http_version 1.1;
        proxy_set_header Upgrade $http_upgrade;
        proxy_set_header Connection "upgrade";
        proxy_set_header Host $host;
        proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
        proxy_set_header X-Forwarded-Proto https;
        proxy_read_timeout 3600s;
        proxy_send_timeout 3600s;
    }
}
```

Then, in the app (owner): Connect gateway → Remote access → relay URL `https://cube-relay.ems-iot.com` and the
enrolment token. The gateway enrols and keeps the tunnel open (`PUT /api/v1/remote/relay`). Revoking a phone
on the gateway (`DELETE /api/v1/auth/clients/{id}`) cuts it off through the relay at once.

**Deployed on the EMS server (2026-11-04):**

| Item                         | Value                                                                                                                              |
| ---------------------------- | ---------------------------------------------------------------------------------------------------------------------------------- |
| Public URL                   | `https://cube-relay.ems-iot.com` (Cloudflare proxied → 102.43.60.185)                                                           |
| Container                    | `cube-relay` (image `cube-os-gateway:1.0.0`, `relay` mode, host network, `127.0.0.1:8687`, `--restart unless-stopped`)   |
| Settings and enrolment token | `/home/ems-server/EMS/cube-relay/relay.env` (0600). Show the token with `grep TOKEN /home/ems-server/EMS/cube-relay/relay.env` |
| Data                         | Docker volume `cube-relay-data` (`relay.db`: gateway IDs and hashed tunnel secrets)                                            |
| nginx                        | `/etc/nginx/conf.d/cube-relay.conf`: only `/relay/` is proxied; rate limits use Cloudflare's `CF-Connecting-IP`              |
| Logs and health              | `docker logs -f cube-relay`; `curl https://cube-relay.ems-iot.com/relay/v1/health`                                             |

To restart or upgrade it: `docker rm -f cube-relay`, then
`docker run -d --name cube-relay --network host --restart unless-stopped --env-file /home/ems-server/EMS/cube-relay/relay.env -v cube-relay-data:/data <image> relay`.

**Limitation of the relay's HTTP route:** TLS ends at the relay, so whoever operates the relay could read
traffic in transit. The HTTPS route below doesn't have this problem; older app versions use this one.

## HTTPS at home and through the relay

Once the relay is set up for it, every enrolled gateway gets a real certificate, and the app uses HTTPS:

- **At home:** `https://<gateway id>.gw.ems-iot.com:8688`. That name points at the gateway's home address.
- **Away:** `https://<gateway id>.r.ems-iot.com`. The relay reads only the name the app asks for and passes the
  encrypted connection to that gateway without decrypting it, so tokens and data are readable only by the phone
  and the gateway.

The gateway makes its own key, which never leaves it. The relay gets a Let's Encrypt certificate for it, proving
the names with DNS records on Cloudflare (DNS-01), and the gateway renews it on its own. Where HTTPS doesn't work
(an older gateway, no certificate yet, a router that blocks the home name), the app falls back to the routes
above, so nothing breaks.

### Set it up on the relay (once)

1. **Cloudflare API token:** Zone → DNS → Edit, for `ems-iot.com` only.
2. **DNS:** one record, `*.r.ems-iot.com` A → the relay server's public IP, **DNS only (grey cloud)**. A proxied
   record would end TLS at Cloudflare. The relay creates each gateway's `<id>.gw.ems-iot.com` record itself.
3. **The relay's env file:**
   ```bash
   CUBE_RELAY_TLS_REMOTE_ZONE=r.ems-iot.com
   CUBE_RELAY_TLS_LAN_ZONE=gw.ems-iot.com
   CUBE_RELAY_TLS_PORT=8689
   CUBE_CLOUDFLARE_API_TOKEN=<token>
   CUBE_ACME_EMAIL=<an address Let's Encrypt can warn about expiry>
   # first run only: CUBE_ACME_DIRECTORY=https://acme-staging-v02.api.letsencrypt.org/directory
   ```
   Try once with the staging directory. Its certificates aren't trusted by phones, but they prove the DNS and
   token work without using up Let's Encrypt's limits. Then remove that line and restart.
4. **Let the app reach the pass-through listener**, one of two ways:
   - **Port 443 through nginx (recommended: every network allows 443).** nginx reads the requested name before
     any TLS and sends `*.r.ems-iot.com` to the relay. Your existing HTTPS sites move to a local port:
     ```nginx
     stream {
         map $ssl_preread_server_name $cube_upstream {
             ~\.r\.ems-iot\.com$  127.0.0.1:8689;   # CUBE_RELAY_TLS_PORT
             default              127.0.0.1:8443;   # the existing HTTPS sites
         }
         server {
             listen 443;
             ssl_preread on;
             proxy_protocol on;            # hands on each caller's address, for per-caller rate limits
             proxy_pass $cube_upstream;
         }
     }
     # and in each existing https server block:
     #   listen 127.0.0.1:8443 ssl proxy_protocol;
     #   set_real_ip_from 127.0.0.1;  real_ip_header proxy_protocol;
     ```
   - **Its own port.** Open `CUBE_RELAY_TLS_PORT` in the firewall (e.g. 8444) and set
     `CUBE_RELAY_TLS_PUBLIC_PORT=8444`. Simpler, but some networks block ports other than 443.
5. Restart the relay (a relay run with `-p` instead of `--network host` also needs `-p 127.0.0.1:8689:8689`).
   Each connected gateway gets its certificate within about five minutes. Its log says
   `HTTPS certificate installed`, and `GET /api/v1/health` then shows `tls`.

**On the gateway** nothing needs setting. `CUBE_TLS_PORT` (8688) is the home HTTPS port. Server-hosted gateways
listen on a loopback port and are reached only through the relay.

**Limits:**

- **No relay, no HTTPS.** A gateway that isn't enrolled with a relay keeps plain HTTP, with the identity check.
- **Router DNS filters.** Some routers drop DNS answers that point at private addresses ("DNS rebinding
  protection"); on those networks the app uses plain HTTP at home. To allow it, add an exception for
  `gw.ems-iot.com` (dnsmasq/OpenWrt: `rebind_domain`).
- **The relay operator.** The operator controls the zone and could have another certificate issued for a
  gateway's name. Every certificate issued for these names is public in Certificate Transparency logs
  (crt.sh), so that can't happen unseen.
- **Let's Encrypt limits.** 50 new certificates per registered domain per week. Renewing the same names is
  treated more leniently ([letsencrypt.org/docs/rate-limits](https://letsencrypt.org/docs/rate-limits/)), so plan
  large rollouts, or use a separate domain for gateways. The relay also caps each gateway at four a week.
- **App versions.** Only the new app build uses HTTPS. It trusts names in `gw.ems-iot.com` and `r.ems-iot.com`
  only, unless the build sets `EXPO_PUBLIC_GATEWAY_TLS_ZONES`. Older app versions keep using the routes above.
- **Not yet tried against Let's Encrypt or Cloudflare.** The ACME client has issued certificates from Pebble
  (Let's Encrypt's test CA) with real DNS-01 validation; Cloudflare's API and the nginx setup are untested.

## Configuration

All optional, as `-e NAME=value` on `docker run`.

| Variable                                                                                                                         | Default                         | Meaning                                                                                                                                                         |
| -------------------------------------------------------------------------------------------------------------------------------- | ------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `CUBE_PORT`                                                                                                                    | `8686`                        | API port                                                                                                                                                        |
| `CUBE_HOST`                                                                                                                    | `0.0.0.0`                     | Bind address. Set an IP to listen on one interface only                                                                                                         |
| `CUBE_GATEWAY_NAME`                                                                                                            | `CUBE Gateway XXXX`           | Name shown in the app (also settable from the app)                                                                                                              |
| `CUBE_DATA_DIR`                                                                                                                | `/data`                       | Database, key and setup code                                                                                                                                    |
| `CUBE_LOG_LEVEL` / `CUBE_LOG_FORMAT`                                                                                         | `INFO` / `json`             | `text` for human-readable logs                                                                                                                                |
| `CUBE_MDNS_ADVERTISE`                                                                                                          | `1`                           | Advertise `_cube-gw._tcp` on the LAN                                                                                                                          |
| `CUBE_SUBNET_SCAN`                                                                                                             | `1`                           | Allow the TCP probe of the local /24 during scans                                                                                                               |
| `CUBE_SCAN_SUBNETS`                                                                                                            | (auto)                          | Comma-separated private networks to scan, each /22 or smaller                                                                                                   |
| `CUBE_POLL_INTERVAL`                                                                                                           | `30`                          | Seconds between state reads for devices without push updates                                                                                                    |
| `CUBE_PROVISIONING_TTL`                                                                                                        | `900`                         | Seconds a setup session stays open                                                                                                                              |
| `CUBE_CORS_ORIGINS`                                                                                                            | `*`                           | Allowed web origins (tokens are bearer headers, no cookies)                                                                                                     |
| `CUBE_RETHINK_MQTT_URL`                                                                                                        | —                              | ReThink's MQTT broker; enables LG ThinQ                                                                                                                         |
| `CUBE_RETHINK_DISCOVERY_PREFIX` / `CUBE_RETHINK_PREFIX`                                                                      | `homeassistant` / `rethink` | ReThink topic prefixes                                                                                                                                          |
| `CUBE_RETHINK_API_SERVER` / `CUBE_RETHINK_MQTT_SERVER`                                                                       | —                              | ReThink's public addresses, handed to ThinQ2 appliances during phone setup so they need no DNS override (set both)                                              |
| `CUBE_RETHINK_SETUP_CMD`                                                                                                       | —                              | Command that runs ReThink's `rethink-setup` (gateway-side LG setup)                                                                                           |
| `CUBE_NLE_URL`                                                                                                                 | —                              | NoLongerEvil's control API, e.g. `http://192.168.1.10:8082`; enables Nest Learning gen 1–2                                                                    |
| `CUBE_MATTER_URL`                                                                                                              | —                              | The Matter Server's WebSocket, e.g. `ws://127.0.0.1:5580/ws`; enables Matter devices ([Matter devices](#matter-devices-experimental))                         |
| `CUBE_SOFTAP_INTERFACE`                                                                                                        | —                              | Spare Wi-Fi interface for gateway-side setup. Also needs `-v /run/dbus:/run/dbus:ro --user 0` and NetworkManager on the host                                  |
| `CUBE_TLS_PORT`                                                                                                                | `8688` (`0` server-hosted)     | Home HTTPS port, opened once the relay has issued a certificate; `0` = loopback only |
| `CUBE_RELAY_TLS_REMOTE_ZONE` / `CUBE_RELAY_TLS_LAN_ZONE`                                                                       | —                              | Relay mode: zones for gateway certificates (`<id>.<zone>`); the remote zone turns certificates on |
| `CUBE_RELAY_TLS_PORT` / `CUBE_RELAY_TLS_PUBLIC_PORT`                                                                           | `0` / `443`                    | Relay mode: the pass-through listener's local port, and the port apps reach it on |
| `CUBE_CLOUDFLARE_API_TOKEN` / `CUBE_CLOUDFLARE_ZONE_ID`                                                                        | —                              | Relay mode: DNS edit on the zone(s); the zone id is looked up when not set |
| `CUBE_ACME_DIRECTORY` / `CUBE_ACME_EMAIL` / `CUBE_DNS_PROPAGATION_WAIT`                                                        | Let's Encrypt / — / `20`       | Relay mode: the ACME server (staging for a first test), its contact address, seconds to wait after publishing a TXT record |
| `CUBE_RELAY_URL`                                                                                                               | —                              | Relay to connect to at start (normally set from the app instead)                                                                                                |
| `CUBE_RELAY_ENROLL_TOKEN` / `CUBE_RELAY_PORT`                                                                                | — / `8687`                   | Relay mode: who may enrol. Gateway mode: with `CUBE_RELAY_URL`, enrol automatically at start                                                                  |
| `CUBE_TUNNEL_SUBNETS` / `CUBE_TUNNEL_ENDPOINT` / `CUBE_TUNNEL_PORT`                                                            | — / — / `51820`                | Server-hosted apartment with a tunnel box: its home subnet(s), the address boxes connect to, WireGuard's port in the container (needs `--user 0 --cap-add NET_ADMIN`) |
| `CUBE_SERVER_HOSTED`                                                                                                           | `0`                           | Run on the company server for one apartment: only Shelly-over-broker and LG via ReThink; claim allowed through the relay; LG appliances private to this gateway |
| `CUBE_CLOUD_MQTT_URL`                                                                                                          | (from the relay)                | How this gateway reaches the device broker, e.g. `mqtt://127.0.0.1:1886` on the broker's own server                                                           |
| `CUBE_ALLOW_REMOTE_CLAIM` / `CUBE_RETHINK_ONLY_PROVISIONED`                                                                  | follow `CUBE_SERVER_HOSTED`   | The two server-hosted behaviours, separately                                                                                                                    |
| `CUBE_MQTT_ADMIN_URL`, `_USER`, `_PASSWORD`, `CUBE_MQTT_PUBLIC_SERVER`, `CUBE_MQTT_GATEWAY_URL`, `CUBE_MQTT_CA_FILE` | —                              | Relay mode: the device broker it manages (written by `setup-broker.sh` to `admin.env`)                                                                      |

## Security model

- **Ownership:** proven by reading the setup code from the gateway's log or with `docker exec`, both of which
  need access to the server. 10 wrong codes rotate it, claims are rate-limited per caller (through the relay too),
  and claiming is refused through the relay unless the gateway is server-hosted.
- **Clients:** random 256-bit bearer tokens, stored as SHA-256 hashes, revocable at once (WebSocket closed
  too). Roles are owner and member; members can't pair, remove, rename or manage access.
- **Gateway identity:** an HMAC challenge before a phone sends its token to a new address.
- **Credentials at rest:** local keys, TV tokens, device keys and Tapo logins are sealed with AES-256-GCM.
  The key is in `/data/secret.key` (0600), and each blob is bound to its device ID. They are never returned
  by the API and never logged. Logs redact any field or `key=value` that looks secret.
- **Wi-Fi passwords:** go phone → device. With gateway-side setup they're used in memory only.
- **Network scope:** scans only private networks of the gateway's own interfaces (at most a /24 each, or
  `CUBE_SCAN_SUBNETS`). Manual probes accept private IPv4 only. Every name, model and header from the network
  is size-limited and stripped of control characters.
- **Fault isolation:** every adapter call runs with a timeout and an exception guard. A failing adapter fails
  its own operation and is logged; a broken adapter module is listed as not loaded and the rest load.
- **No silent cloud uploads:** the gateway contacts no manufacturer cloud. msmart-ng runs with
  `auto_connect=False`, and Tapo credentials are used for local authentication only.
- **Transport:** with a relay set up for certificates, HTTPS at home and end to end through the relay (see
  [HTTPS at home and through the relay](#https-at-home-and-through-the-relay)); the gateway's key never leaves
  it. Without one, plain HTTP on the home network with the identity check, and the relay's HTTP route, where
  TLS ends at the relay. Use Tailscale (WireGuard) where neither is enough.

## Operations

| Task              | How                                                                                                                                                                                                                            |
| ----------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| Logs              | `docker logs -f cube-os-gateway` (JSON lines; `-e CUBE_LOG_FORMAT=text` for plain text)                                                                                                                                    |
| Setup code again  | `docker exec cube-os-gateway cube-gateway setup-code`                                                                                                                                                                        |
| Unpair all phones | `docker exec cube-os-gateway cube-gateway reset-owner`, then `docker restart cube-os-gateway`                                                                                                                              |
| Back up           | Copy the volume while running or stopped: `docker run --rm -v cube-os-data:/data -v "$PWD":/b alpine tar czf /b/cube-backup.tgz -C /data .`. It contains `secret.key`: without it, stored device credentials can't be read |
| Health            | `docker inspect --format '{{.State.Health.Status}}' cube-os-gateway`, or `GET /api/v1/health`                                                                                                                              |
| API explorer      | `http://<gateway>:8686/api/v1/docs` (protected routes still need a token)                                                                                                                                                    |

## Test results

Run on 2026-11-04 on the development server (Ubuntu, x86_64, Docker 29.8, Python 3.14.4, Node 22.23).

| Check                                                                                          | Result                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                     |
| ---------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Gateway tests: `cd gateway && .venv/bin/pytest -q`                                           | **658 passed** on 2026-11-07 (macOS, Python 3.14.6, installed from `uv.lock`): API and auth, ownership, invites, revocation, identity proof, rate limits, WebSocket events, discovery (dedupe, scope, cancellation, crash isolation), pairing (local key, approval, detection-only), registry persistence and restart, commands (confirmed / assumed / pending / unsupported / offline back-off), the SoftAP state machine (happy path, wrong network, Wi-Fi rejected, device not found, expiry, cancel, restart recovery, gateway transport), hotspot password rules, relay end to end over real sockets (including disguised claim paths and per-caller rate limits), monitoring that survives unexpected errors, every adapter against protocol mocks, the Matter adapter against a simulated Matter Server, HTTPS end to end through the relay's pass-through (the relay sees only ciphertext; claims through it are refused) with certificates from a strict fake ACME CA, the tunnel-box setup (keys, box config, wg0 commands, privilege drop, adapters and catalog; not a live tunnel), and the LG settings mapping against the real discovery message of an RAC_056905_WW |
| `ruff check cube_gateway tests`                                                              | Clean                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                      |
| `docker build gateway/` (amd64)                                                              | Builds; image 321 MB                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                       |
| Container first start → setup code via `docker exec` → claim → data → `docker restart` | Data and token survive; Docker health `healthy`                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                          |
| Real LG AC (RAC_056905_WW) on this server's ReThink, read-only                                 | Found, paired, state read (mode, target 24 °C, room 26 °C, fan), model and 12 sensors after restart. **No commands were sent to the appliance**                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                    |
| Relay on `cube-relay.ems-iot.com` (nginx + Cloudflare)                                       | A gateway enrolled with the token and opened its tunnel. Through the public URL: health answered, `/devices` 401 without a token and 200 with one, claiming refused (403), a room created, and the events WebSocket got `ready` and then a live `rooms.updated`. Without the token, enrolment is refused. The test gateway and its enrolment were then removed                                                                                                                                                                                                                                                                                                       |
| ARM64                                                                                          | Every dependency resolves to an aarch64 wheel for CPython 3.14. The arm64 image build itself runs in CI (QEMU); it was not run on this server                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                              |
| App: `npx tsc --noEmit`, `npx expo lint`                                                   | Both pass                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                  |
| App: `npx expo export` (Android, web)                                                        | Builds                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                     |

**The brands added on 2026-11-05 are untested on real hardware:** Meross, Tasmota / OpenBeken, ESPHome, Gree, Faikout and
Nest (NoLongerEvil). So is Matter (added 2026-11-07). The first Meross test is written out step by step in
[gateway/deploy/server-mode/MEROSS_TEST.md](../gateway/deploy/server-mode/MEROSS_TEST.md). Each runs against a protocol simulator. The first real Meross test decides whether that route works:
whether the firmware accepts a broker on the internet with CUBE's private certificate is unknown.

**Still to test on real hardware:** every adapter other than the read-only LG check above; commands to the
LG AC; Wi-Fi provisioning for Shelly, WLED and SONOFF (especially the S26R2TPF) from a phone; the Android and
iOS hotspot join with `react-native-wifi-reborn` in a development build (it isn't in Expo Go); gateway-side
setup over NetworkManager; the relay from a phone on mobile data; the arm64 image on a Raspberry Pi.

## Not supported, and why

| Not supported                                                             | Why                                                                                                                                         |
| ------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------- |
| Universal compatibility                                                   | Each brand speaks its own protocol, and many have no local one. Only the brands above have adapters                                         |
| Tuya Wi-Fi setup in the app; reading Tuya local keys                      | Tuya's pairing protocol needs its cloud. Keys come only from Tuya's cloud API (`tinytuya wizard`), or from an installer's tuya-cloudcutter run ([Installer-only routes](#installer-only-routes)) |
| ESPHome devices without a key, after February 2027                        | ESPHome's source marks plaintext as to be removed after 2027.2.0. Those devices will need its zero-PSK setup, which isn't built            |
| Ecovacs without an account                                                | Bumper needs DNS control and offers no command API; see [Installer-only routes](#installer-only-routes)                                     |
| Meross on a gateway at home                                               | Meross setup points the device at CUBE's broker, which a home gateway doesn't use. Its local HTTP mode isn't built                         |
| Samsung appliances (SmartThings), LG appliances outside ReThink's list    | No local API; cloud only (available through the Home Assistant cloud fallback where linked)                                                 |
| Other Xiaomi / Mi Home devices                                            | They need a per-device token from Xiaomi's cloud; not implemented                                                                           |
| SONOFF `POST /ap` (eWeLink app-style setup)                             | Undocumented. It timed out on the S26R2TPF and would register the device with eWeLink's cloud                                               |
| Guessed or brute-forced hotspot passwords                                 | Only published, model-specific defaults are filled in                                                                                       |
| BLE provisioning                                                          | No verified BLE protocol for the target devices yet, and the hardware is Wi-Fi focused. The provisioning engine has a transport slot for it. Meross and Gree models that pair only over Bluetooth can't be set up here |
| Zigbee, Z-Wave                                                            | Need radios and stacks the gateway doesn't include                                                                                          |
| Native mDNS in the app                                                    | React Native has no mDNS without another native module. The app probes the /24 instead, and the gateway still advertises `_cube-gw._tcp`  |
| HTTPS on the LAN                                                          | See the security model; use Tailscale                                                                                                       |
| Parklane Assistant controlling gateway devices                            | The assistant service talks to the EMS backend in the cloud, which can't reach a home LAN. It would need the relay plus a backend change    |
| Scenes, automations, energy history                                       | Not in this release                                                                                                                         |
| The Alexa skill, SONOFF cloud and the old CUBE/SONOFF pairing from Master | Built on the server modules the Home Assistant rewrite replaced. Kept on branch `archive/master-2026-11-04`                               |
