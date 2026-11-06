"""The gateway's connection to the device MQTT broker (server-hosted mode).

The gateway asks the relay for its broker login (authenticated with its relay tunnel secret), keeps it sealed in
the database, and stays connected to the broker, subscribed to its own topics (cube/<gateway_id>/#, which is all
its login may touch). Adapters register handlers for messages and publish through it. The relay also hands out
per-device logins when a new device is set up (`allocate_device`).

Devices with fixed topics (Meross) live outside that prefix: `register_appliance` asks the relay for the login and
for access to that device's topics, and the gateway remembers them so it subscribes again after a restart.
"""

from __future__ import annotations

import asyncio
import contextlib
import json
import logging
import ssl
import tempfile
from collections.abc import Awaitable, Callable
from typing import TYPE_CHECKING, Any
from urllib.parse import urlparse

import httpx

if TYPE_CHECKING:
    from ..gateway import Gateway

log = logging.getLogger("cube.cloud")
Handler = Callable[[str, bytes], Awaitable[None] | None]


class CloudError(Exception):
    pass


class CloudLink:
    def __init__(self, gateway: Gateway):
        self.gateway = gateway
        self.connected = False
        self.last_error: str | None = None
        self._client: Any = None
        self._task: asyncio.Task | None = None
        self._handlers: list[Handler] = []
        self._ready = asyncio.Event()
        self._wake = asyncio.Event()
        #: Uuids of fixed-topic devices this gateway may use.
        self._appliances: set[str] = set()

    def wake(self) -> None:
        """Called after enrolling with the relay, so the broker connection starts without waiting."""
        self._wake.set()

    async def _pause(self, seconds: float) -> None:
        self._wake.clear()
        with contextlib.suppress(TimeoutError):
            await asyncio.wait_for(self._wake.wait(), timeout=seconds)

    # ---- relay access ----

    async def _relay(self) -> tuple[str, str] | None:
        url = await self.gateway.db.get_meta("relay_url")
        sealed = await self.gateway.db.get_meta("relay_secret")
        if not url or not sealed:
            return None
        return url, self.gateway.sealer.unseal(sealed, "relay")

    async def _relay_call(self, method: str, path: str, body: dict[str, Any] | None = None) -> dict[str, Any]:
        relay = await self._relay()
        if relay is None:
            raise CloudError("This gateway is not enrolled with a relay.")
        url, secret = relay
        headers = {"Authorization": f"Bearer {self.gateway.security.gateway_id}.{secret}"}
        try:
            async with httpx.AsyncClient(timeout=15) as client:
                response = await client.request(method, f"{url}{path}", headers=headers, json=body)
            payload = response.json()
        except (httpx.HTTPError, ValueError) as error:
            raise CloudError("The relay could not be reached.") from error
        if not payload.get("ok"):
            raise CloudError((payload.get("error") or {}).get("message") or "The relay refused the request.")
        return payload["data"]

    async def enabled(self) -> bool:
        return await self._relay() is not None

    async def allocate_device(self) -> dict[str, Any]:
        """A broker login for one new device: slot, server, username, password, topic_prefix, ca_pem."""
        return await self._relay_call("POST", "/relay/v1/mqtt/devices")

    async def release_device(self, slot: str) -> None:
        with contextlib.suppress(CloudError):
            await self._relay_call("DELETE", f"/relay/v1/mqtt/devices/{slot}")

    async def device_server(self) -> str:
        """host:port of the broker, as devices reach it."""
        return str((await self._relay_call("GET", "/relay/v1/mqtt/server"))["server"])

    async def register_appliance(self, uuid: str, mac: str, password: str) -> None:
        await self._relay_call("POST", "/relay/v1/mqtt/appliances", {"uuid": uuid, "mac": mac, "password": password})
        await self._load_appliances()
        self._appliances.add(uuid)
        await self.gateway.db.set_meta("cloud_appliances", json.dumps(sorted(self._appliances)))
        if self.connected and self._client is not None:
            await self._client.subscribe(appliance_topic(uuid))

    async def release_appliance(self, uuid: str) -> None:
        with contextlib.suppress(CloudError):
            await self._relay_call("DELETE", f"/relay/v1/mqtt/appliances/{uuid}")
        await self._load_appliances()
        self._appliances.discard(uuid)
        await self.gateway.db.set_meta("cloud_appliances", json.dumps(sorted(self._appliances)))

    async def _load_appliances(self) -> None:
        self._appliances |= set(json.loads(await self.gateway.db.get_meta("cloud_appliances") or "[]"))

    # ---- broker connection ----

    @property
    def prefix(self) -> str:
        return f"cube/{self.gateway.security.gateway_id}"

    def on_message(self, handler: Handler) -> None:
        self._handlers.append(handler)

    async def publish(self, topic: str, payload: str) -> None:
        if not self.connected or self._client is None:
            raise CloudError("The gateway is not connected to the device broker.")
        allowed = topic.startswith(self.prefix + "/") or any(topic.startswith(f"/appliance/{uuid}/") for uuid in self._appliances)
        if not allowed:
            raise CloudError("Refusing to publish outside this gateway's topics.")
        await self._client.publish(topic, payload)

    def start(self) -> None:
        if self._task is None:
            self._task = asyncio.create_task(self._run())

    async def stop(self) -> None:
        if self._task:
            self._task.cancel()
            with contextlib.suppress(asyncio.CancelledError, Exception):
                await self._task
            self._task = None
        self.connected = False

    async def _login(self, refresh: bool) -> dict[str, Any]:
        sealed = await self.gateway.db.get_meta("mqtt_login")
        if sealed and not refresh:
            return self.gateway.sealer.unseal(sealed, "mqtt")
        login = await self._relay_call("POST", "/relay/v1/mqtt/gateway")
        await self.gateway.db.set_meta("mqtt_login", self.gateway.sealer.seal(login, "mqtt"))
        return login

    async def _run(self) -> None:
        import aiomqtt

        backoff = 2.0
        refresh = False
        while True:
            if not await self.enabled():
                self.last_error = "Not enrolled with a relay that has a device broker."
                await self._pause(30)
                continue
            try:
                login = await self._login(refresh)
                refresh = False
                url = urlparse(self.gateway.settings.cloud_mqtt_url or login["url"])
                tls = None
                if url.scheme == "mqtts":
                    context = ssl.create_default_context()
                    if login.get("ca_pem"):
                        with tempfile.NamedTemporaryFile("w", suffix=".pem") as handle:
                            handle.write(login["ca_pem"])
                            handle.flush()
                            context = ssl.create_default_context(cafile=handle.name)
                    tls = context
                async with aiomqtt.Client(
                    url.hostname or "127.0.0.1",
                    url.port or (8883 if url.scheme == "mqtts" else 1883),
                    username=login["username"],
                    password=login["password"],
                    identifier=login["username"],
                    tls_context=tls,
                ) as client:
                    self._client = client
                    self.connected = True
                    self.last_error = None
                    backoff = 2.0
                    await client.subscribe(f"{self.prefix}/#")
                    await self._load_appliances()
                    for uuid in sorted(self._appliances):
                        await client.subscribe(appliance_topic(uuid))
                    self._ready.set()
                    log.info("connected to the device broker", extra={"broker": url.hostname, "port": url.port})
                    async for message in client.messages:
                        await self._dispatch(str(message.topic), bytes(message.payload or b""))
            except asyncio.CancelledError:
                raise
            except CloudError as error:
                self.last_error = str(error)
                log.warning("device broker login unavailable", extra={"reason": self.last_error})
            except Exception as error:  # noqa: BLE001 - reconnect on any broker failure
                self.last_error = str(error) or type(error).__name__
                # Not authorized: the stored login may have been re-issued; ask the relay again.
                refresh = "not authorized" in self.last_error.lower() or "bad user name or password" in self.last_error.lower()
                log.warning("device broker connection failed; retrying", extra={"reason": self.last_error, "retry_in": backoff})
            finally:
                self.connected = False
                self._client = None
                self._ready.clear()
            await self._pause(backoff)
            backoff = min(120.0, backoff * 2)

    async def _dispatch(self, topic: str, payload: bytes) -> None:
        for handler in list(self._handlers):
            try:
                result = handler(topic, payload)
                if asyncio.iscoroutine(result):
                    await result
            except Exception:  # noqa: BLE001 - one handler's failure must not stop the others
                log.debug("message handler failed", exc_info=True)


def appliance_topic(uuid: str) -> str:
    return f"/appliance/{uuid}/publish"


def parse_json(payload: bytes) -> Any:
    try:
        return json.loads(payload.decode("utf-8", "replace")[:65536])
    except ValueError:
        return None
