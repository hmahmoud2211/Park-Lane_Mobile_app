"""Meross plugs, strips and bulbs that connect out to the company's device broker (server-hosted mode, no home network).

During setup the phone joins the device's open Meross_... network and gives it the home Wi-Fi, the broker's address
and a signing key the gateway made for it (provisioning plugin `meross_cloud_softap`). The device then logs in to the
broker with a password derived from its MAC and that key, so the gateway creates the login through the relay once the
phone reports the MAC. No Meross account is involved and the device never talks to Meross's cloud.

Unlike Shelly, a Meross device's topics are fixed (/appliance/<uuid>/...), so the broker gives the device and its
gateway access to exactly those topics, per device. On connecting, a device expects answers to Appliance.Control.Bind
and Appliance.System.Clock, and some drop the connection without them; meross_lan documents this (its issue #346).

EXPERIMENTAL: the setup and control messages match the sources above, and tests run against a simulated device built
from real traces, but no Meross device has connected to this broker yet. It is unknown whether Meross firmware accepts
a broker on the internet with CUBE's private certificate: unlike a Shelly it can't be given CUBE's CA.
"""

from __future__ import annotations

import asyncio
import contextlib
import json
import time
from typing import Any

from ..cloud.link import CloudError, parse_json
from ..models import AdapterInfo, AuthKind, Candidate, Category, CommandResult, ConnectionStatus, PairingRequirements, SupportLevel
from ..tasks import spawn
from . import _meross as protocol
from . import caps
from .base import (
    AdapterError,
    ApprovalCallback,
    CommandOutcome,
    DeviceAdapter,
    DeviceState,
    DeviceUnreachable,
    PairResult,
    ScanContext,
    StateCallback,
    StoredDevice,
    UnsupportedCommand,
    make_candidate,
    normalize_mac,
)

RPC_TIMEOUT = 8.0
PUSH_DEBOUNCE = 0.3
#: A device counts as connected if it was heard from this recently (scans, setup).
SEEN_WINDOW = 600.0


class MerossCloudAdapter(DeviceAdapter):
    info = AdapterInfo(
        id="meross_cloud",
        name="Meross via CUBE's server (MQTT over TLS)",
        brands=["meross"],
        protocols=["meross-mqtt"],
        discovery=["mqtt"],
        categories=[Category.PLUG, Category.SWITCH, Category.LIGHT],
        status=SupportLevel.EXPERIMENTAL,
        account_free=True,
        auth=AuthKind.NONE,
        local_control=False,
        push_updates=True,
        library="aiomqtt",
        verified_models=[],
        notes=["Needs a gateway enrolled with a relay that has a device broker. Not yet tested with a real Meross device."],
    )
    poll_interval = 120
    call_timeout = 12.0

    def __init__(self, ctx):
        super().__init__(ctx)
        #: Signing key per device: from setup until pairing, then from the device's sealed credentials.
        self.keys: dict[str, str] = {}
        self.seen: dict[str, float] = {}
        self._pending: dict[str, asyncio.Future] = {}
        self._listeners: dict[str, tuple[StoredDevice, StateCallback]] = {}
        self._debounce: dict[str, asyncio.TimerHandle] = {}
        self._subscribed = False

    @property
    def cloud(self):
        return getattr(self.ctx, "cloud", None)

    def available(self) -> tuple[bool, str | None]:
        if self.cloud is None:
            return False, "Needs a gateway connected to CUBE's server, with a device broker on its relay."
        return True, None

    async def start(self) -> None:
        if self.cloud is not None and not self._subscribed:
            self.cloud.on_message(self.handle_message)
            self._subscribed = True

    def expect(self, uuid: str, key: str) -> None:
        """Provisioning: this device will connect soon, signing with this key."""
        self.keys[uuid] = key

    # ---- MQTT plumbing ----

    async def handle_message(self, topic: str, payload: bytes) -> None:
        uuid = protocol.uuid_of(topic)
        if uuid is None:
            return
        message = parse_json(payload)
        header = message.get("header") if isinstance(message, dict) else None
        if not isinstance(header, dict):
            return
        self.seen[uuid] = time.time()
        method = header.get("method")
        namespace = header.get("namespace")
        if method in {protocol.GETACK, protocol.SETACK, protocol.ERROR}:
            future = self._pending.pop(str(header.get("messageId") or ""), None)
            if future and not future.done():
                future.set_result(message)
            return
        if namespace == protocol.NS_BIND and method == protocol.SET:
            reply = protocol.build(protocol.NS_BIND, protocol.SETACK, {}, self.keys.get(uuid, ""), protocol.response_topic(uuid), str(header.get("messageId") or ""))
            await self._send(uuid, reply)
        elif namespace == protocol.NS_CLOCK and method == protocol.PUSH:
            await self._send(uuid, protocol.push_reply(header, {"clock": {"timestamp": int(time.time())}}))
        elif namespace == protocol.NS_CONSUMPTION_CONFIG and method == protocol.PUSH:
            await self._send(uuid, protocol.push_reply(header, message.get("payload") or {}))
        elif method == protocol.PUSH:
            self._notify(uuid)

    async def _send(self, uuid: str, message: dict[str, Any]) -> None:
        with contextlib.suppress(CloudError):
            await self.cloud.publish(protocol.request_topic(uuid), json.dumps(message))

    async def rpc(self, uuid: str, namespace: str, method: str = protocol.GET, payload: dict[str, Any] | None = None) -> dict[str, Any]:
        if self.cloud is None:
            raise DeviceUnreachable("This gateway has no device broker.")
        message = protocol.build(namespace, method, payload or {}, self.keys.get(uuid, ""), protocol.response_topic(uuid))
        message_id = message["header"]["messageId"]
        future: asyncio.Future = asyncio.get_running_loop().create_future()
        self._pending[message_id] = future
        try:
            await self.cloud.publish(protocol.request_topic(uuid), json.dumps(message))
            reply = await asyncio.wait_for(future, timeout=RPC_TIMEOUT)
        except CloudError as error:
            raise DeviceUnreachable(str(error)) from error
        except TimeoutError as error:
            raise DeviceUnreachable("The Meross device did not answer through CUBE's server. Check it has power and Wi-Fi.") from error
        finally:
            self._pending.pop(message_id, None)
        body = reply.get("payload") if isinstance(reply.get("payload"), dict) else {}
        if reply["header"].get("method") == protocol.ERROR or "error" in body:
            raise AdapterError(f"The Meross device refused {namespace}.", code="device_rejected")
        return body

    def _notify(self, uuid: str) -> None:
        if uuid not in self._listeners:
            return
        handle = self._debounce.pop(uuid, None)
        if handle:
            handle.cancel()
        loop = asyncio.get_running_loop()

        def fire() -> None:
            self._debounce.pop(uuid, None)
            spawn(self._push(uuid), name="meross-push")

        self._debounce[uuid] = loop.call_later(PUSH_DEBOUNCE, fire)

    async def _push(self, uuid: str) -> None:
        entry = self._listeners.get(uuid)
        if entry:
            device, callback = entry
            with contextlib.suppress(Exception):
                await callback(await self.get_state(device))

    # ---- discovery and pairing ----

    async def candidate_for(self, uuid: str) -> Candidate | None:
        try:
            everything = (await self.rpc(uuid, protocol.NS_ALL)).get("all") or {}
        except AdapterError:
            return None
        system = everything.get("system") or {}
        hardware = system.get("hardware") or {}
        model = hardware.get("type")
        candidate = make_candidate(
            self,
            uuid,
            name=f"Meross {model}" if model else "Meross device",
            model=model,
            mac=normalize_mac(hardware.get("macAddress")),
            protocol="meross-mqtt",
            sources=["mqtt"],
            details={"uuid": uuid, "fw": (system.get("firmware") or {}).get("version")},
        )
        candidate.status = ConnectionStatus.IDENTIFIED
        return candidate

    async def discover(self, scan: ScanContext) -> None:
        now = time.time()
        for uuid, seen in list(self.seen.items()):
            if scan.cancelled.is_set():
                return
            if uuid in self.keys and now - seen < SEEN_WINDOW:
                candidate = await self.candidate_for(uuid)
                if candidate:
                    scan.report(candidate)

    def get_pairing_requirements(self, candidate: Candidate) -> PairingRequirements:
        return PairingRequirements(auth=AuthKind.NONE, instructions="Connected to CUBE's server with its own login.")

    async def pair(self, candidate: Candidate, credentials: dict[str, str], approval: ApprovalCallback) -> PairResult:
        uuid = candidate.unique_id
        key = credentials.get("key") or self.keys.get(uuid)
        if not key:
            raise DeviceUnreachable("This Meross device's setup did not finish here. Reset it and set it up again.")
        self.keys[uuid] = key
        ability = (await self.rpc(uuid, protocol.NS_ABILITY)).get("ability") or {}
        params = {
            "uuid": uuid,
            "togglex": protocol.NS_TOGGLEX in ability,
            "electricity": protocol.NS_ELECTRICITY in ability,
            "light_capacity": int((ability.get(protocol.NS_LIGHT) or {}).get("capacity") or 0) if protocol.NS_LIGHT in ability else 0,
            "paired_at": time.time(),
        }
        stored = StoredDevice(id="", adapter_id=self.info.id, brand="meross", unique_id=uuid, name="", category=Category.PLUG, params=params, credentials={"key": key})
        await self.get_state(stored)
        return PairResult(
            unique_id=uuid,
            name=candidate.name or "Meross device",
            category=Category.LIGHT if protocol.NS_LIGHT in ability else Category.PLUG,
            model=candidate.model,
            mac=candidate.mac,
            protocol="meross-mqtt",
            params=params,
            credentials={"key": key},
        )

    # ---- state and commands ----

    def _uuid(self, device: StoredDevice) -> str:
        uuid = str(device.params.get("uuid") or device.unique_id)
        key = device.credentials.get("key")
        if not key:
            raise DeviceUnreachable("This device's key is missing. Remove it, reset it and set it up again.")
        # After a gateway restart the key is known again from the device's sealed credentials.
        self.keys[uuid] = str(key)
        return uuid

    async def get_state(self, device: StoredDevice) -> DeviceState:
        uuid = self._uuid(device)
        everything = (await self.rpc(uuid, protocol.NS_ALL)).get("all") or {}
        electricity = None
        if device.params.get("electricity"):
            with contextlib.suppress(AdapterError):
                electricity = (await self.rpc(uuid, protocol.NS_ELECTRICITY)).get("electricity")
        return protocol.to_state(everything, electricity, int(device.params.get("light_capacity") or 0))

    async def _switch(self, device: StoredDevice, uuid: str, channel: int, on: bool) -> None:
        value = 1 if on else 0
        if device.params.get("togglex", True):
            await self.rpc(uuid, protocol.NS_TOGGLEX, protocol.SET, {"togglex": {"channel": channel, "onoff": value}})
        else:
            await self.rpc(uuid, protocol.NS_TOGGLE, protocol.SET, {"channel": channel, "toggle": {"onoff": value}})

    async def execute_command(self, device: StoredDevice, command: str, params: dict[str, Any]) -> CommandOutcome:
        uuid = self._uuid(device)
        state = await self.get_state(device)
        capacity = int(device.params.get("light_capacity") or 0)
        if command in {"turn_on", "turn_off", "toggle"}:
            power, channel = _target(state, params)
            on = command == "turn_on" if command != "toggle" else power.value != "on"
            await self._switch(device, uuid, channel, on)
        elif command == "set_brightness" and capacity & protocol.LIGHT_LUMINANCE:
            level = round(caps.clamp(caps.param(params, "brightness"), 0, 100, "brightness"))
            await self._light(uuid, {"capacity": protocol.LIGHT_LUMINANCE, "luminance": max(level, 1)})
        elif command == "set_color" and capacity & protocol.LIGHT_RGB:
            red, green, blue = caps.hs_to_rgb(caps.clamp(caps.param(params, "h"), 0, 360, "h"), caps.clamp(caps.param(params, "s"), 0, 100, "s"))
            await self._light(uuid, {"capacity": protocol.LIGHT_RGB, "rgb": (red << 16) | (green << 8) | blue})
        elif command == "set_color_temp" and capacity & protocol.LIGHT_TEMPERATURE:
            kelvin = caps.clamp(caps.param(params, "kelvin"), protocol.KELVIN_MIN, protocol.KELVIN_MAX, "kelvin")
            await self._light(uuid, {"capacity": protocol.LIGHT_TEMPERATURE, "temperature": protocol.kelvin_to_meross(kelvin)})
        else:
            raise UnsupportedCommand(f"This Meross device has no {command}.")
        return CommandOutcome(result=CommandResult(status="confirmed"), state=await self.get_state(device))

    async def _light(self, uuid: str, fields: dict[str, Any]) -> None:
        await self.rpc(uuid, protocol.NS_LIGHT, protocol.SET, {"light": {"channel": 0, **fields}})

    async def forget(self, device: StoredDevice) -> None:
        """Without its key the device can't be used again, so its login goes too; it needs a reset and a new setup."""
        uuid = str(device.params.get("uuid") or device.unique_id)
        self.keys.pop(uuid, None)
        self.seen.pop(uuid, None)
        if self.cloud is not None:
            await self.cloud.release_appliance(uuid)

    async def subscribe_to_events(self, device: StoredDevice, callback: StateCallback):
        uuid = self._uuid(device)
        self._listeners[uuid] = (device, callback)

        async def unsubscribe() -> None:
            self._listeners.pop(uuid, None)

        return unsubscribe


def _target(state: DeviceState, params: dict[str, Any]) -> tuple[Any, int]:
    """Which outlet a command is for: params.key ("power:1") or params.channel, else the first."""
    wanted = str(params["key"]).split(":")[-1] if params.get("key") else (str(params["channel"]) if params.get("channel") is not None else None)
    for capability in state.capabilities:
        if capability.type != "power":
            continue
        index = capability.key.partition(":")[2] or "0"
        if wanted is None or wanted == index:
            return capability, int(index)
    raise UnsupportedCommand("This Meross device has no such outlet.")
