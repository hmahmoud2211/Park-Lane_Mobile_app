"""The device MQTT broker's control plane, used by the relay.

Devices that connect out to the company server (server-hosted mode) talk MQTT to one Mosquitto broker. Every
gateway and every device gets its own login from Mosquitto's dynamic security plugin, limited to its own topics:

    gateway  gw-<gateway_id>          may publish/subscribe  cube/<gateway_id>/#
    device   d-<gateway_id>-<slot>    may publish/subscribe  cube/<gateway_id>/<slot>/#

So one apartment's gateway can never see or command another apartment's devices, and a device's leaked password
only exposes that device. Only the relay holds the broker's admin login; gateways ask the relay for credentials,
authenticated with their tunnel secret.

Meross devices can't change their topics or their login, which their firmware derives from the MAC:

    appliance  <mac>                  may publish/subscribe  /appliance/<uuid>/#

The device's gateway gets the same topics added to its role, and the relay records which gateway owns each uuid.
"""

from __future__ import annotations

import asyncio
import json
import logging
import re
import secrets
from typing import Any
from urllib.parse import urlparse

log = logging.getLogger("cube.broker")
CONTROL = "$CONTROL/dynamic-security/v1"
SLOT = re.compile(r"^[a-z0-9]{6,32}$")
APPLIANCE = re.compile(r"^[0-9a-f]{32}$")


class BrokerError(Exception):
    pass


def gateway_prefix(gateway_id: str) -> str:
    return f"cube/{gateway_id}"


def device_prefix(gateway_id: str, slot: str) -> str:
    return f"cube/{gateway_id}/{slot}"


def appliance_prefix(uuid: str) -> str:
    return f"/appliance/{uuid}"


def _acls(prefix: str) -> list[dict[str, Any]]:
    return [
        {"acltype": "publishClientSend", "topic": f"{prefix}/#", "priority": 0, "allow": True},
        {"acltype": "subscribePattern", "topic": f"{prefix}/#", "priority": 0, "allow": True},
        {"acltype": "unsubscribePattern", "topic": f"{prefix}/#", "priority": 0, "allow": True},
    ]


class DynsecAdmin:
    """Sends dynamic-security commands as the broker's admin and returns the broker's answers."""

    def __init__(self, url: str, username: str, password: str):
        self.url = url
        self.username = username
        self.password = password
        self._lock = asyncio.Lock()

    async def run(self, commands: list[dict[str, Any]]) -> list[dict[str, Any]]:
        import aiomqtt

        parsed = urlparse(self.url)
        async with self._lock:
            try:
                async with aiomqtt.Client(
                    parsed.hostname or "127.0.0.1",
                    parsed.port or 1883,
                    username=self.username,
                    password=self.password,
                    identifier=f"cube-relay-admin-{secrets.token_hex(3)}",
                ) as client:
                    await client.subscribe(f"{CONTROL}/response")
                    await client.publish(CONTROL, json.dumps({"commands": commands}))
                    async with asyncio.timeout(10):
                        async for message in client.messages:
                            payload = json.loads(bytes(message.payload or b"{}"))
                            return list(payload.get("responses") or [])
            except TimeoutError as error:
                raise BrokerError("The device broker did not answer.") from error
            except Exception as error:  # noqa: BLE001
                raise BrokerError(f"The device broker could not be reached: {type(error).__name__}") from error
        return []

    async def _ensure_client(self, username: str, rolename: str, prefix: str, password: str | None = None) -> str:
        password = password or secrets.token_urlsafe(24)
        responses = await self.run(
            [
                {"command": "createRole", "rolename": rolename, "acls": _acls(prefix)},
                {"command": "createClient", "username": username, "password": password, "roles": [{"rolename": rolename}]},
            ]
        )
        errors = {r.get("command"): r.get("error") for r in responses if r.get("error")}
        if errors.get("createRole") and "already exists" not in str(errors["createRole"]).lower():
            raise BrokerError(f"Could not create the broker role: {errors['createRole']}")
        if errors.get("createClient"):
            if "already exists" not in str(errors["createClient"]).lower():
                raise BrokerError(f"Could not create the broker login: {errors['createClient']}")
            # Re-issuing credentials: the old password stops working.
            reset = await self.run([{"command": "setClientPassword", "username": username, "password": password}])
            if any(r.get("error") for r in reset):
                raise BrokerError("Could not reset the broker login.")
        return password

    async def gateway_login(self, gateway_id: str) -> tuple[str, str, str]:
        username = f"gw-{gateway_id}"
        password = await self._ensure_client(username, username, gateway_prefix(gateway_id))
        return username, password, gateway_prefix(gateway_id)

    async def device_login(self, gateway_id: str, slot: str) -> tuple[str, str, str]:
        if not SLOT.match(slot):
            raise BrokerError("Invalid device slot.")
        username = f"d-{gateway_id}-{slot}"
        password = await self._ensure_client(username, username, device_prefix(gateway_id, slot))
        return username, password, device_prefix(gateway_id, slot)

    async def remove_device(self, gateway_id: str, slot: str) -> None:
        if not SLOT.match(slot):
            raise BrokerError("Invalid device slot.")
        username = f"d-{gateway_id}-{slot}"
        await self.run([{"command": "deleteClient", "username": username}, {"command": "deleteRole", "rolename": username}])

    async def appliance_login(self, gateway_id: str, uuid: str, mac: str, password: str) -> None:
        """A login for a device with fixed topics and a firmware-derived password; its gateway may use those topics too."""
        if not APPLIANCE.match(uuid):
            raise BrokerError("Invalid device id.")
        prefix = appliance_prefix(uuid)
        await self._ensure_client(mac, f"a-{uuid}", prefix, password)
        responses = await self.run([{"command": "addRoleACL", "rolename": f"gw-{gateway_id}", **acl} for acl in _acls(prefix)])
        failed = [r["error"] for r in responses if r.get("error") and "already" not in str(r["error"]).lower()]
        if failed:
            raise BrokerError(f"Could not give the gateway access to the device: {failed[0]}")

    async def remove_appliance(self, gateway_id: str, uuid: str, mac: str) -> None:
        if not APPLIANCE.match(uuid):
            raise BrokerError("Invalid device id.")
        await self.run(
            [
                {"command": "deleteClient", "username": mac},
                {"command": "deleteRole", "rolename": f"a-{uuid}"},
                *[
                    {"command": "removeRoleACL", "rolename": f"gw-{gateway_id}", "acltype": acl["acltype"], "topic": acl["topic"]}
                    for acl in _acls(appliance_prefix(uuid))
                ],
            ]
        )
