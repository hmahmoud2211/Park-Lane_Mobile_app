
Steps on the server

1. Get the new code

cd /opt/parklane
git pull
git log -1 --oneline        # must show: be7611d
2. Download the new gateway image. This step matters: the server still has the old copy, and new gateways would start from it and fail.

docker pull hmahmoud2211/cube-os-gateway:latest
docker inspect --format '{{index .Config.Labels "org.opencontainers.image.revision"}}' hmahmoud2211/cube-os-gateway:latest

# must start with: be7611d

3. Turn on "a gateway for every new apartment"

cd /opt/parklane
TOKEN=$(grep '^CUBE_RELAY_ENROLL_TOKEN=' /home/ems-server/EMS/cube-relay/relay.env | cut -d= -f2-)
echo "GATEWAY_RELAY_ENROLL_TOKEN=$TOKEN" >> backend/.env
grep -c '^GATEWAY_RELAY_ENROLL_TOKEN=.' backend/.env    # must print 1
grep '^PUBLIC_URL=' backend/.env                         # must be https://api-iot-2.ems-iot.com
If the first grep says "Permission denied", put sudo in front of it.

4. Restart the backend

./scripts/dev.sh server
docker ps --filter name=parklane-backend    # wait until it says (healthy)
5. Get the admin's first password. It is printed only once, on this start.

docker logs parklane-backend 2>&1 | grep -A2 "EMS admin account created"
6. Sign in to the dashboard

Open https://api-iot-2.ems-iot.com/admin.
Sign in as admin with that password, then choose your own.
7. Test with one apartment

Click New apartment, for example "Test 1", with both boxes ticked.
Within 3 minutes the gateway should change from Setting up to Connected.
If it says Setup failed, the message explains why. The gateway's log is docker logs cube-gw-… (the full name is on the page). Send me both.
The relay doesn't need a restart; its code didn't change.

Gateways you made earlier with the script (if any)
They are still on the old version and not linked to an apartment. For each one:

In the dashboard, create its apartment with "Create its CUBE gateway" unticked. Copy the unit ID shown on its page.
On the server, run the script again with the same name and port you used before:

cd /opt/parklane/gateway/deploy/server-mode
UNIT_ID=<unit id></unit> ADMIN_API_KEY=<your ADMIN_API_KEY></your> ./new-apartment.sh <same name></same> <same port></same>
This keeps its devices, moves it to the new version, and links it to the apartment.
To see which ones exist: docker ps --filter name=cube-gw-

Before you give accounts to real owners
The phones need a new app build. The "choose your password" screen and account sign-in are in the new app. The project has no over-the-air updates, so phones get it only through a new EAS build. An owner with the old app and a temporary password would only see errors. The server steps above are safe to do now.
