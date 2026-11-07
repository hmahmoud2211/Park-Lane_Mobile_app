# Steps on the server

Moving the server to the version with the admin dashboard, account access to gateways, and a gateway for every new
apartment. Run these on the server, in order.

## 1. Get the new code

```bash
cd /opt/parklane
git pull
git log -1 --oneline        # must show 148848c, or a newer commit
```

## 2. Download the new gateway image

```bash
docker pull hmahmoud2211/cube-os-gateway:latest
docker inspect --format '{{index .Config.Labels "org.opencontainers.image.revision"}}' hmahmoud2211/cube-os-gateway:latest
# must start with: be7611d
```

The gateway code hasn't changed since `be7611d`, so the image still shows that commit. From this version on, the
backend downloads the newest image every time it creates a gateway. Pulling it here as well makes the first
apartment start faster, and the scripts in "Gateways you made earlier" below use this copy.

## 3. Turn on "a gateway for every new apartment"

```bash
cd /opt/parklane
TOKEN=$(grep '^CUBE_RELAY_ENROLL_TOKEN=' /home/ems-server/EMS/cube-relay/relay.env | cut -d= -f2-)
echo "GATEWAY_RELAY_ENROLL_TOKEN=$TOKEN" >> backend/.env
grep -c '^GATEWAY_RELAY_ENROLL_TOKEN=.' backend/.env    # must print 1
grep '^PUBLIC_URL=' backend/.env                         # must be https://api-iot-2.ems-iot.com
```

If the first `grep` says "Permission denied", put `sudo` in front of it.

## 4. Restart the backend

```bash
./scripts/dev.sh server
docker ps --filter name=parklane-backend    # wait until it says (healthy)
```

## 5. Get the admin's first password

It is printed only once, on this start:

```bash
docker logs parklane-backend 2>&1 | grep -A2 "EMS admin account created"
```

## 6. Sign in to the dashboard

1. Open <https://api-iot-2.ems-iot.com/admin>.
2. Sign in as `admin` with that password, then choose your own.

## 7. Test with one apartment

1. Click **New apartment**, for example "Test 1", with both boxes ticked.
2. Within 3 minutes the gateway should change from **Setting up** to **Connected**.
3. If it says **Setup failed**, the message explains why. The gateway's log is `docker logs cube-gw-…` (the full name
   is on the apartment's page).

The relay doesn't need a restart: its code didn't change.

## Gateways you made earlier with the script (if any)

They are still on the old version and not linked to an apartment. To see which ones exist:

```bash
docker ps --filter name=cube-gw-
```

For each one:

1. In the dashboard, create its apartment with **"Create its CUBE gateway" unticked**. Copy the unit ID shown on its
   page.
2. On the server, run the script again with the **same name and port** you used before:

   ```bash
   cd /opt/parklane/gateway/deploy/server-mode
   UNIT_ID=<unit id> ADMIN_API_KEY=<your ADMIN_API_KEY> ./new-apartment.sh <same name> <same port>
   ```

   Replace each `<…>` with the real value, without the `< >`. For example, for a gateway named `cube-gw-tower-a-1203`
   on port 18701: `... ./new-apartment.sh tower-a-1203 18701`.

This keeps its devices, moves it to the new version, and links it to the apartment.

## The app on the phones

The "Choose a new password" screen and the account sign-in to the gateway are only in the new app. The project has
no over-the-air updates, so phones need the new build. An owner with the old app and a temporary password would only
see errors.

The new Android build (from Master `be7611d`) is ready. Open this link on the phone to install it:
<https://expo.dev/artifacts/eas/uv1wzWuAr34DBa9_EUxcVXge_p3iy9LehtciW5V0q3Q.apk>

It installs over the earlier test APKs from the `hazemmahm03` project. What residents do in the app, step by step, is
in [MOBILE_APP_PATHS.md](MOBILE_APP_PATHS.md).
