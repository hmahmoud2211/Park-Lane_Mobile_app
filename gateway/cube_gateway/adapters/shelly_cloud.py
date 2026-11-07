"""Shelly Gen2+ devices that connect out to the company's device broker (server-hosted mode, no home network).

During setup the phone gives the Shelly a broker login, the CA that signed the broker's certificate and a topic
prefix (cube/<gateway_id>/<slot>), all with Shelly's documented RPCs (Shelly.PutUserCA, Mqtt.SetConfig,
WiFi.SetConfig). From then on the device keeps a TLS MQTT connection to the broker and the gateway controls it with
Shelly's documented RPC over MQTT (https://shelly-api-docs.shelly.cloud/gen2/ComponentsAndServices/Mqtt):

    request    <prefix>/rpc          {"id", "src": "<prefix>/gw", "method", "params"}
    response   <prefix>/gw/rpc       {"id", "result" | "error"}
    events     <prefix>/events/rpc   NotifyStatus / NotifyEvent
    presence   <prefix>/online       true / false (last will)

Commands and state mapping are the LAN Shelly adapter's (shelly.py); only the transport differs.
"""

from __future__ import annotations

import asyncio
import contextlib
import itertools
import json
import time
from typing import Any

from ..cloud.link import CloudError, parse_json
from ..models import AdapterInfo, AuthKind, Candidate, Category, ConnectionStatus, PairingRequirements, SupportLevel
from ..tasks import spawn
from .base import ApprovalCallback, DeviceState, DeviceUnreachable, PairResult, ScanContext, StateCallback, StoredDevice, make_candidate, normalize_mac
from .shelly import AdapterError, ShellyAdapter, _category, _state_gen2

_ids = itertools.count(1)
RPC_TIMEOUT = 8.0


class ShellyCloudAdapter(ShellyAdapter):
    info = AdapterInfo(
        id="shelly_cloud",
        name="Shelly via CUBE's server (MQTT over TLS)",
        brands=["shelly"],
        protocols=["shelly-gen2-mqtt-rpc"],
        discovery=["mqtt"],
        categories=[Category.SWITCH, Category.PLUG, Category.LIGHT, Category.COVER],
        status=SupportLevel.SUPPORTED,
        account_free=True,
        auth=AuthKind.NONE,
        push_updates=True,
        library="aiomqtt",
        notes=[
            "Gen2, Gen3 and Gen4 Shelly devices: they connect to CUBE's broker over TLS, verified with CUBE's own CA.",
            "No Shelly account or Shelly cloud; no box at home. Each device has its own broker login, limited to its own topics.",
            "Gen1 Shelly devices only support unencrypted MQTT and are not offered over the internet.",
        ],
    )
    mdns_types = ()
    probe_ports = ()
    poll_interval = 120
    call_timeout = 12.0

    def __init__(self, ctx):
        super().__init__(ctx)
        self.online: dict[str, bool] = {}
        self.infos: dict[str, dict[str, Any]] = {}
        self._pending: dict[int, asyncio.Future] = {}
        self._listeners: dict[str, StateCallback] = {}
        self._debounce: dict[str, asyncio.TimerHandle] = {}
        self._subscribed = False

    @property
    def cloud(self):
        return getattr(self.ctx, "cloud", None)

    def available(self) -> tuple[bool, str | None]:
        if self.cloud is None:
            return False, "Needs a gateway enrolled with a relay that has a device broker (server-hosted mode)."
        return True, None

    async def start(self) -> None:
        if self.cloud is not None and not self._subscribed:
            self.cloud.on_message(self.handle_message)
            self._subscribed = True

    # ---- MQTT plumbing ----

    def _slot_of(self, topic: str) -> tuple[str, str] | None:
        prefix = self.cloud.prefix + "/" if self.cloud else ""
        if not topic.startswith(prefix):
            return None
        slot, _, rest = topic[len(prefix) :].partition("/")
        return (slot, rest) if slot and rest else None

    async def handle_message(self, topic: str, payload: bytes) -> None:
        parsed = self._slot_of(topic)
        if parsed is None:
            return
        slot, rest = parsed
        if rest == "online":
            self.online[slot] = payload.strip().lower() == b"true"
            self._notify(slot)
        elif rest == "gw/rpc":
            message = parse_json(payload)
            if isinstance(message, dict):
                future = self._pending.pop(int(message.get("id") or 0), None)
                if future and not future.done():
                    future.set_result(message)
        elif rest == "events/rpc":
            self.online[slot] = True
            message = parse_json(payload)
            if isinstance(message, dict) and message.get("method") in {"NotifyStatus", "NotifyFullStatus"}:
                self._notify(slot)

    async def rpc(self, slot: str, method: str, params: dict[str, Any] | None = None) -> Any:
        if self.cloud is None:
            raise DeviceUnreachable("This gateway has no device broker.")
        prefix = f"{self.cloud.prefix}/{slot}"
        request_id = next(_ids)
        future: asyncio.Future = asyncio.get_running_loop().create_future()
        self._pending[request_id] = future
        try:
            await self.cloud.publish(f"{prefix}/rpc", json.dumps({"id": request_id, "src": f"{prefix}/gw", "method": method, "params": params or {}}))
            reply = await asyncio.wait_for(future, timeout=RPC_TIMEOUT)
        except CloudError as error:
            raise DeviceUnreachable(str(error)) from error
        except TimeoutError as error:
            raise DeviceUnreachable("The Shelly did not answer through CUBE's server. Check it has power and Wi-Fi.") from error
        finally:
            self._pending.pop(request_id, None)
        if "error" in reply:
            raise AdapterError(f"The Shelly refused {method}: {(reply['error'] or {}).get('message', 'error')}.", code="device_rejected")
        return reply.get("result")

    def _notify(self, slot: str) -> None:
        callback = self._listeners.get(slot)
        if callback is None:
            return
        handle = self._debounce.pop(slot, None)
        if handle:
            handle.cancel()
        loop = asyncio.get_running_loop()

        def fire() -> None:
            self._debounce.pop(slot, None)
            spawn(self._push(slot, callback), name="shelly-push")

        self._debounce[slot] = loop.call_later(0.3, fire)

    async def _push(self, slot: str, callback: StateCallback) -> None:
        with contextlib.suppress(Exception):
            if not self.online.get(slot, True):
                await callback(DeviceState(online=False))
                return
            await callback(_state_gen2(await self.rpc(slot, "Shelly.GetStatus") or {}))

    # ---- discovery and pairing ----

    async def _describe(self, slot: str) -> dict[str, Any]:
        info = self.infos.get(slot)
        if info is None:
            info = await self.rpc(slot, "Shelly.GetDeviceInfo") or {}
            self.infos[slot] = info
        return info

    async def candidate_for(self, slot: str) -> Candidate | None:
        try:
            info = await self._describe(slot)
        except AdapterError:
            return None
        mac = normalize_mac(info.get("mac"))
        if not mac:
            return None
        candidate = make_candidate(
            self,
            mac.replace(":", ""),
            name=info.get("name") or info.get("id") or f"Shelly {info.get('app') or ''}".strip(),
            model=info.get("model"),
            mac=mac,
            protocol="shelly-gen2-mqtt-rpc",
            sources=["mqtt"],
            details={"slot": slot, "gen": int(info.get("gen") or 2), "app": info.get("app"), "fw": info.get("fw_id"), "auth": False},
        )
        candidate.status = ConnectionStatus.IDENTIFIED
        return candidate

    async def discover(self, scan: ScanContext) -> None:
        for slot in [s for s, up in self.online.items() if up]:
            if scan.cancelled.is_set():
                return
            candidate = await self.candidate_for(slot)
            if candidate:
                scan.report(candidate)

    async def probe(self, host: str) -> Candidate | None:
        return None

    def get_pairing_requirements(self, candidate: Candidate) -> PairingRequirements:
        return PairingRequirements(auth=AuthKind.NONE, instructions="Connected to CUBE's server with its own login.")

    async def pair(self, candidate: Candidate, credentials: dict[str, str], approval: ApprovalCallback) -> PairResult:
        slot = str(candidate.details.get("slot") or "")
        if not slot:
            raise DeviceUnreachable("This Shelly is not connected to CUBE's server.")
        info = await self._describe(slot)
        state = _state_gen2(await self.rpc(slot, "Shelly.GetStatus") or {})
        return PairResult(
            unique_id=candidate.unique_id,
            name=candidate.name or "Shelly",
            category=_category(state, info.get("model"), info.get("app")),
            model=info.get("model"),
            mac=candidate.mac,
            protocol="shelly-gen2-mqtt-rpc",
            params={"slot": slot, "gen": int(info.get("gen") or 2), "app": info.get("app"), "fw": info.get("fw_id"), "paired_at": time.time()},
        )

    # ---- state and commands (the LAN adapter's logic over MQTT) ----

    def _slot(self, device: StoredDevice) -> str:
        slot = str(device.params.get("slot") or "")
        if not slot:
            raise DeviceUnreachable("This device has no CUBE server connection.")
        return slot

    async def get_state(self, device: StoredDevice) -> DeviceState:
        slot = self._slot(device)
        if self.online.get(slot) is False:
            raise DeviceUnreachable("The Shelly is offline: it is not connected to CUBE's server.")
        return _state_gen2(await self.rpc(slot, "Shelly.GetStatus") or {})

    async def _gen2(self, device: StoredDevice, method: str, params: dict[str, Any]) -> Any:
        return await self.rpc(self._slot(device), method, params)

    async def execute_command(self, device: StoredDevice, command: str, params: dict[str, Any]) -> Any:
        device.params = {**device.params, "gen": 2}
        return await super().execute_command(device, command, params)

    async def subscribe_to_events(self, device: StoredDevice, callback: StateCallback):
        slot = self._slot(device)
        self._listeners[slot] = callback

        async def unsubscribe() -> None:
            self._listeners.pop(slot, None)

        return unsubscribe
