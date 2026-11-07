# First real Meross test (server-hosted, no box at home)

This one test decides whether Meross can be offered with no box at home. Everything so far ran against a
simulated device. The unknown: **does Meross firmware accept CUBE's broker, whose certificate comes from CUBE's
own CA?** Unlike a Shelly, a Meross device can't be given that CA.

Takes about an hour. You need access to the company server and one phone.

## What you need

- **One Meross Wi-Fi plug that is set up over Wi-Fi**, not only over Bluetooth (for example an MSS110, MSS210 or
  MSS310). Write down the model, hardware version and region from its label. Pairing mode resets it and removes it
  from any Meross account.
- **A 2.4 GHz Wi-Fi network with internet access** for the plug. It doesn't have to be the server's network.
- **The phone** with an app build from 2026-11-06 or later. Meross setup needs the `@noble` crypto added then, so an
  older build won't work.
- **On the server:** the relay and gateways upgraded to an image from 2026-11-06 or later (Meross needs the relay's
  `/relay/v1/mqtt/appliances` routes), and `cube-mqtt` running.

## Before you start

```bash
curl -s https://cube-relay.ems-iot.com/relay/v1/health      # must show "device_broker": true
cd gateway/deploy/server-mode && ./new-apartment.sh meross-test 18799
```

The second command prints a setup code and QR code. In the app: **Connect gateway → Scan QR code**.

Open two terminals on the server and leave them running:

```bash
docker logs -f --since 1m cube-gw-meross-test      # the gateway
docker logs -f --since 1m cube-mqtt                # the broker: shows each TLS connection and login
```

## Run it

In the app: **Add Device → Meross → Set up a new Meross device (connects to CUBE's server)**. Follow the steps and
note where it stops. Then match what you saw:

| What you see | What it means | Next |
| --- | --- | --- |
| The app can't find or join `Meross_…` | The plug isn't in pairing mode, or the phone left its network | Hold the button about 10 s until the light alternates amber and green; try again |
| The app stops at "Send the settings" | The plug rejected the setup messages (often newer firmware with encrypted setup) | Note the firmware version and the app's error text, and report them |
| No line in the `cube-mqtt` log from the plug's public IP within 2 minutes | The plug never reached `mqtt-cube.ems-iot.com:8885` | Check port 8885 is forwarded and the plug's Wi-Fi has internet. If both are fine, the firmware ignores the server it was given |
| TLS errors in the `cube-mqtt` log (`unknown ca`, `certificate verify failed`, `handshake failure`) | **The firmware checks the broker's certificate and refuses CUBE's CA** | This model can't use the no-box route as built. Next idea: give the broker a publicly trusted certificate (e.g. Let's Encrypt) and test again |
| `not authorised` / bad username or password in the `cube-mqtt` log | The plug connected, but its login doesn't match the one the gateway made | Send both log excerpts: the MAC/key derivation is wrong for this firmware |
| The plug connects, then drops within seconds, again and again | It didn't get the Bind/Clock answers it expects | Send the gateway log |
| The app says **Connected** | The route works for this model | Run the checks below |

## If it connects

1. Turn it on and off 10 times from the app. Each change should show **Working** (confirmed), and the plug should
   click every time.
2. Unplug it for a minute. The app should show it offline, then online again within about a minute of plugging it
   back in.
3. Restart the gateway: `docker restart cube-gw-meross-test`. The plug should come back without any action.
4. Remove the plug in the app. In the `cube-mqtt` log, its next connection attempt should be refused.

## Report

Write down the model, hardware version, region, firmware version (if the app or the label shows it), which row
above you ended on, and the log lines around it. Add the result to "Test results" in
[docs/CUBE_GATEWAY.md](../../../docs/CUBE_GATEWAY.md). If it passed, add the model to `verified_models` in
`gateway/cube_gateway/adapters/meross_cloud.py`.

Clean up afterwards: `docker rm -f cube-gw-meross-test`.
