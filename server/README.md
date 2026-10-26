# Parklane device backend

A small Node service between the Parklane app and the unit's eWeLink CUBE hub:

```
App ──HTTP──▶ backend ──Open API──▶ CUBE ──UpdateDeviceStates──▶ backend ──eWeLink LAN──▶ SONOFF plug
```

- It holds the CUBE credentials, so the app never needs them for these endpoints.
- It finds SONOFF plugs on the LAN over mDNS (`_ewelink._tcp`) and checks each plug's key against its encrypted announcement.
- It registers each plug with CUBE as a **third-party device** whose `service_address` points back at the backend. CUBE's on/off commands then reach the plug through the backend.

It has no dependencies. Node ≥ 22.18 runs the TypeScript directly.

## Run it

```bash
cd server
cp .env.example .env      # then fill in PUBLIC_URL and CUBE_PASSWORD (or CUBE_TOKEN)
npm start                 # node src/index.ts
npm test                  # LAN crypto, mDNS, CUBE directives, EMS registry, OAuth, Alexa linking, realtime
npm run typecheck         # uses the app's TypeScript (../node_modules)
```

Run it on a machine on the **same network segment as the plugs**. mDNS does not cross routers, so a backend on another subnet will never see a plug announce itself. CUBE must also be able to reach `PUBLIC_URL`.

In the app's `.env.local`, set `EXPO_PUBLIC_DEVICE_BACKEND_URL=http://<this machine>:8787`, plus `EXPO_PUBLIC_DEVICE_BACKEND_KEY` if you set `BACKEND_API_KEY`.

## EMS accounts, device registry and Alexa

The same process also runs the EMS device registry (SQLite in `DATA_DIR/ems.db`), user accounts, realtime updates over WebSocket, and the Alexa account-linking and voice APIs. It does not depend on CUBE. See [../ALEXA_INTEGRATION.md](../ALEXA_INTEGRATION.md) for those routes, settings and tests. The hub routes below moved from `/api/devices` to `/api/cube/devices` to make room for the registry.

## API (CUBE hub and SONOFF bridge)

Every answer is `{ "ok": true, "data": … }` or `{ "ok": false, "error": { "code", "message" } }`.

| Method & path | What it does |
| --- | --- |
| `GET /api/health` | Whether CUBE answers, whether mDNS is listening, and whether registration is possible (`PUBLIC_URL` set). |
| `GET /api/cube/devices` | The hub's devices: `{ id, name, category, manufacturer, model, online, power, controllable }`. |
| `GET /api/cube/devices/:id` | One of them. `:id` is the hub's serial number. |
| `POST /api/cube/devices/:id/on` · `/off` | `PUT /devices/:id { state: { power: { powerState } } }` on CUBE. Returns `409 not_controllable` when the device has no controllable `power` capability. Returns `502 device_unreachable` when CUBE (or the plug behind it) refuses. |
| `POST /api/sonoff/discover` `{ deviceId, deviceKey? }` | Listens about 4 seconds for the plug's mDNS announcement. Returns `{ found: false }`, or `{ found: true, device: { host, port, encrypted, keyVerified, power, singleChannel } }`. |
| `POST /api/sonoff/devices` `{ deviceId, deviceKey, name }` | Registers the plug with CUBE (see below) and returns `{ cubeSerial, created, device }`. |
| `POST /cube/directive/:secret` | Called **by CUBE**, not the app. The random secret is stored in `data/sonoff.json`. |

### What registration checks first

The backend refuses to register a plug unless all of the following hold. This ensures CUBE never lists a device that nothing can control:

1. `PUBLIC_URL` is set (`503 public_url_missing`).
2. The plug is announcing itself on the LAN right now (`404 device_not_found`).
3. Its announcement is encrypted and the key decrypts it (`422 key_rejected`). A plain (DIY-mode) announcement also passes this step.
4. It reports a single `switch` (`422 unsupported_device`). Multi-channel devices are not bridged yet.

Then it sends CUBE a `DiscoveryRequest`:
- `display_category: "plug"`
- `capabilities: [{ capability: "power", permission: "1100" }]` (controllable and reportable, as CUBE's docs declare power)
- the plug's current state
- `service_address = PUBLIC_URL/cube/directive/<secret>`

Registering the same plug again refreshes its address and key instead of adding a duplicate.

### After registration

- **`UpdateDeviceStates` from CUBE** (`on`, `off` or `toggle`): the backend sends `POST http://<plug>:8081/zeroconf/switch` with the encrypted `{ "switch": "on" | "off" }`. It answers `UpdateDeviceStatesResponse`, or `ErrorResponse ENDPOINT_UNREACHABLE` if the plug does not confirm. CUBE allows 3 seconds; the LAN timeout is 2.5 seconds.
- **`QueryDeviceStates`**: answered from the last state the plug reported.
- **Every announcement from a registered plug**: updates its address. If the switch changed (for example from the physical button), the backend sends `DeviceStatesChangeReport`.
- **Every 30 seconds**: the backend queries the LAN. A plug that misses 3 rounds is reported offline (`DeviceOnlineChangeReport`), and back online when it is heard again.

## Protocol sources and limits

- **CUBE third-party API:** CUBE's Developer & API Guide, the "Third-Party Request Gateway Interface" and "Gateway sends the instruction" sections.
- **eWeLink LAN protocol:** not documented by ITEAD for stock (non-DIY) firmware. This follows [AlexxIT/SonoffLAN](https://github.com/AlexxIT/SonoffLAN):
  - encryption is AES-128-CBC with key `MD5(devicekey)` and PKCS7 padding (checked against OpenSSL);
  - state is carried in TXT `data1`..`data4`;
  - commands go to `/zeroconf/<command>` on port 8081.
- **The device key:** SonoffLAN documents that the `apikey` returned by `http://10.10.7.1/device` in pairing mode is the plug's `devicekey`. One SonoffLAN issue reports a model where it is not, so the backend **verifies** the key against the plug's own announcement before trusting it.
- **Unverified on the S26R2TPF:** whether its firmware turns on LAN mode without a working eWeLink cloud connection. If it never announces `_ewelink._tcp`, discovery reports `found: false`, and the app stops at "Registration required".

## Secrets

- `.env` and `data/` are git-ignored.
- `data/sonoff.json` is written with mode `600`. It holds plug keys and the directive secret.
- Logs never include request bodies, the directive path, or any field whose name looks secret.
