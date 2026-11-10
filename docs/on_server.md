# Steps on the server

The next update of the server. Run these on the server, in order.

Every step is safe to run again. It doesn't matter whether the earlier update (admin dashboard, a gateway for every
apartment) was already done here.

On this server the backend runs from `/home/ems-server/EMS/repo/Park-Lane_Mobile_app` on the `Master` branch, with
its settings in `backend/.env` there. `Park-Lane_Mobile_app_2` is no longer used: don't start the backend from it.

If a command says "Permission denied", put `sudo` in front of it.

## What this update brings

- **The backend comes ready-made from Docker Hub** (`hmahmoud2211/parklane-backend`). The server no longer builds it.
- **The relay starts together with the backend.** It keeps its data and its version.
- **For the App Store and Google Play:** a public privacy page (`/privacy`), an account deletion page
  (`/account/delete`), and "delete my account" in the app.
- **The real backend for:** the inbox (notifications), My Unit and Bills, visitor passes and the gate, deliveries,
  maintenance / housekeeping / moving requests, community, and amenities. Most come with a new page in the dashboard.
- **Health records:** sharing a record with family in the same apartment.

## Before you start: the developer's part (on the Mac)

Don't start until the developer has done both of these:

1. The new code is committed, merged into `Master` and pushed to GitHub.
2. The backend image for that commit is on Docker Hub: `./scripts/dev.sh push`. At the end it prints the commit,
   for example `1a2b3c4`. In the steps below, that is `<commit>`.

## 1. Get the new code

```bash
cd /home/ems-server/EMS/repo/Park-Lane_Mobile_app
git switch Master
git pull
git log -1 --oneline        # the first word must be <commit>
```

## 2. Write down the version that runs now

```bash
docker inspect -f '{{.Config.Image}}' parklane-backend
```

Keep the answer, for example `parklane-backend:148848c`. "If something goes wrong" below needs it.

## 3. Back up the data

This update adds new tables to the database, and they can't be removed again. So make a copy first. The backend
stops for about a minute. The apartments' Home Assistants keep running.

```bash
cd /home/ems-server/EMS/repo/Park-Lane_Mobile_app
DATA=$(grep '^PARKLANE_DATA=' backend/.env | cut -d= -f2-)
echo "$DATA"                        # for example /srv/parklane
grep '^DATA_DIR=' backend/.env      # must start with the folder above, for example /srv/parklane/data
docker stop parklane-backend
sudo tar czf ~/parklane-backup-$(date +%F).tgz "$DATA" "$PWD/backend/.env"
sudo chmod 600 ~/parklane-backup-$(date +%F).tgz
docker start parklane-backend
ls -lh ~/parklane-backup-*.tgz
```

The copy holds the database, every apartment's data and the keys, so it is readable only with `sudo`.

**Stop here and tell the developer if `DATA_DIR` is missing or outside that folder.** It would mean the database
lives inside the container and would be lost with it.

## 4. Settings in `backend/.env`

Add each setting only if it isn't there yet. Edit the file with `nano backend/.env`.

**a) A gateway for every new apartment** (from the earlier update):

```bash
cd /home/ems-server/EMS/repo/Park-Lane_Mobile_app
grep -q '^GATEWAY_RELAY_ENROLL_TOKEN=.' backend/.env || echo "GATEWAY_RELAY_ENROLL_TOKEN=$(grep '^CUBE_RELAY_ENROLL_TOKEN=' /home/ems-server/EMS/cube-relay/relay.env | cut -d= -f2-)" >> backend/.env
grep -c '^GATEWAY_RELAY_ENROLL_TOKEN=.' backend/.env    # must print 1
grep '^PUBLIC_URL=' backend/.env                         # must be https://api-iot-2.ems-iot.com
```

**b) The privacy page.** The App Store and Google Play link to it:

```
LEGAL_OPERATOR_NAME=<the company responsible for the app, as registered>
LEGAL_CONTACT_EMAIL=<a mailbox someone reads, for privacy and deletion requests>
PRIVACY_POLICY_DATE=<YYYY-MM-DD, the day the policy text was approved>
```

Without them, `/privacy` shows a "draft" banner.

**c) Start the relay with the backend:**

```
COMPOSE_PROFILES=relay
RELAY_ENV_FILE=/home/ems-server/EMS/cube-relay/relay.env
```

Then check two things about the relay's settings file:

```bash
test -r /home/ems-server/EMS/cube-relay/relay.env && echo readable
sudo grep -c '^CUBE_MQTT_CA_FILE=' /home/ems-server/EMS/cube-relay/relay.env
```

- If the first line doesn't print `readable`, run
  `sudo chown "$(id -un)": /home/ems-server/EMS/cube-relay/relay.env`. The file stays readable only by you.
- If the second line prints `1`, the relay runs the device broker. Then also add
  `RELAY_CA_FILE=/home/ems-server/EMS/cube-mqtt/certs/ca.crt` to `backend/.env`.

`RELAY_IMAGE` comes in step 6.

## 5. Download the gateway image

```bash
docker pull hmahmoud2211/cube-os-gateway:latest
docker inspect --format '{{index .Config.Labels "org.opencontainers.image.revision"}}' hmahmoud2211/cube-os-gateway:latest
# must start with: be7611d
```

The gateway code hasn't changed since `be7611d`. The backend downloads this image every time it creates a gateway.
Pulling it here makes the first apartment start faster, and "Gateways you made earlier" below uses this copy.

## 6. Start the new version

```bash
cd /home/ems-server/EMS/repo/Park-Lane_Mobile_app
./scripts/dev.sh server --pull <commit>
```

**The first time, it stops on purpose** with: `cube-relay was started by hand. To keep the build it runs, set
RELAY_IMAGE=… in backend/.env`. Copy that whole `RELAY_IMAGE=…` line into `backend/.env`, then run the same command
again.

Then it:

1. downloads the backend image (if that fails, nothing has stopped);
2. moves the relay into compose, with the same data and version (phones lose remote access for a few seconds);
3. starts both and waits until they answer.

## 7. Check it

```bash
docker ps --filter name=parklane-backend --filter name=cube-relay   # after a minute, both say (healthy)
docker inspect -f '{{index .Config.Labels "org.opencontainers.image.revision"}}' parklane-backend   # must print <commit>
curl -s https://cube-relay.ems-iot.com/relay/v1/health              # must contain "ok":true
curl -s -o /dev/null -w '%{http_code}\n' https://api-iot-2.ems-iot.com/privacy   # must print 200
```

Then open <https://api-iot-2.ems-iot.com/privacy> in a browser. It must show the company name and email, with no
"draft" banner. <https://api-iot-2.ems-iot.com/account/delete> must open too.

## 8. The admin's first password (only the first time)

Only if nobody has signed in to the dashboard yet. The password is printed once, on the first start of a version with
the dashboard:

```bash
docker logs parklane-backend 2>&1 | grep -A2 "EMS admin account created"
```

If this prints nothing, the admin account already exists: use its password.

## 9. Sign in to the dashboard

1. Open <https://api-iot-2.ems-iot.com/admin>.
2. Sign in as `admin`. With the first password, the dashboard asks you to choose your own.

## 10. Fill in the new dashboard pages

The new parts of the app stay empty until management fills them:

- **Compound rules:** visitor hours and limits, and the emergency number. The app shows its emergency card only
  when the number is set.
- **Unit finance:** each apartment's contract, charges, payments and meters. My Unit and Bills show these.
- **Gate:** gate staff sign in with their own account. Create it in the dashboard with the role
  **Gate staff (security)**.
- **Requests:** add the technicians. The service categories are already there.
- **Community** and **Amenities:** no notices, events or amenities are added for you.

## 11. Test with one apartment

1. Click **New apartment**, for example "Test 1", with both boxes ticked.
2. Within 3 minutes the gateway should change from **Setting up** to **Connected**.
3. If it says **Setup failed**, the message explains why. The gateway's log is `docker logs cube-gw-…` (the full name
   is on the apartment's page).
4. With the new app (see the end) and a test resident in that apartment: create a visitor pass, send a maintenance
   request and book an amenity. Each must show up in the dashboard.

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
   cd /home/ems-server/EMS/repo/Park-Lane_Mobile_app/gateway/deploy/server-mode
   UNIT_ID=<unit id> ADMIN_API_KEY=<your ADMIN_API_KEY> ./new-apartment.sh <same name> <same port>
   ```

   Replace each `<…>` with the real value, without the `< >`. For example, for a gateway named `cube-gw-tower-a-1203`
   on port 18701: `... ./new-apartment.sh tower-a-1203 18701`.

This keeps its devices, moves it to the new version, and links it to the apartment.

## If something goes wrong

**The new version doesn't start, or misbehaves:** go back to the version from step 2.

- If step 2 printed `parklane-backend:<old>` (built on this server), give it the new name first:
  `docker tag parklane-backend:<old> hmahmoud2211/parklane-backend:<old>`
- Then: `./scripts/dev.sh server --pull <old>`. It uses the copy on this server.

The new tables and columns stay in the database. The older version ignores them and starts normally.

**The data itself looks damaged** (rare): ask the developer first. To put the copy from step 3 back:

```bash
docker stop parklane-backend
sudo tar xzf ~/parklane-backup-<date>.tgz -C /
```

Then go back to the old version as above.

## The app on the phones

The new screens (inbox, Bills, Deliveries, the real My Unit, visitor passes, requests, community, amenities, account
deletion) are only in the new app. The project has no over-the-air updates, so phones need the new build.

**New build: not made yet.** The developer adds its link here.

The earlier Android build (Master `be7611d`) doesn't have these screens:
<https://expo.dev/artifacts/eas/uv1wzWuAr34DBa9_EUxcVXge_p3iy9LehtciW5V0q3Q.apk>

What residents do in the app, step by step, is in [MOBILE_APP_PATHS.md](MOBILE_APP_PATHS.md).
