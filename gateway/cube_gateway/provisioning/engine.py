"""Provisioning sessions: the state machine behind "Connect new device".

A session moves forward through ConnectionStatus states as the phone (or the gateway itself) reports what it
did on the device's setup network. Once the device should be on the home network, the gateway scans for it,
matching what it learned from the hotspot name or the device's own reply, and pairs it. `connected` is only
set after pairing has read the device's state; anything else ends in `pairing_failed` with a code, a message
and a recovery step. Sessions expire after CUBE_PROVISIONING_TTL seconds.

Home Wi-Fi passwords never enter a session: for phone/guided transports they go phone -> device; for the
gateway transport they are passed to the runner in memory and dropped.
"""

from __future__ import annotations

import asyncio
import contextlib
import logging
import re
import secrets
import time
from typing import Any

from ..adapters.base import AdapterError
from ..adapters.registry import AdapterRegistry
from ..config import Settings
from ..db import Database
from ..devices import DeviceError, PairingManager
from ..discovery.engine import DiscoveryEngine
from ..events import EventBus
from ..models import (
    AuthKind,
    Candidate,
    ConnectionStatus,
    GatewayProvisionRequest,
    Pairing,
    PairingRequest,
    ProvisioningError,
    ProvisioningEvent,
    ProvisioningSession,
)
from .plugins import PLUGINS_BY_ID, ProvisioningPlugin

log = logging.getLogger("cube.provisioning")
S = ConnectionStatus
WAIT_WINDOW = 180.0

ORDER = [
    S.PAIRING_MODE_REQUIRED,
    S.HOTSPOT_PASSWORD_REQUIRED,
    S.CONNECTING_DEVICE_AP,
    S.SENDING_WIFI_CONFIG,
    S.CONNECTING_HOME_NETWORK,
    S.WAITING_FOR_DEVICE,
    S.LOCAL_AUTHORIZATION_REQUIRED,
    S.CONNECTED,
]
TERMINAL = {S.CONNECTED, S.PAIRING_FAILED}

EVENT_STATE = {
    "pairing_mode_confirmed": S.CONNECTING_DEVICE_AP,
    "joining_device_ap": S.CONNECTING_DEVICE_AP,
    "hotspot_password_needed": S.HOTSPOT_PASSWORD_REQUIRED,
    "device_ap_joined": S.SENDING_WIFI_CONFIG,
    "device_info": None,
    "wifi_config_sent": S.CONNECTING_HOME_NETWORK,
    "phone_returned": S.WAITING_FOR_DEVICE,
}

#: Prompt section 13: what went wrong and what the user can do about it.
ERRORS: dict[str, tuple[str, str]] = {
    "hotspot_password_wrong": (
        "The device's setup network rejected the password.",
        "Check the password printed on the device or in its manual, put the device back in setup mode and try again.",
    ),
    "hotspot_not_found": (
        "The phone could not find the device's setup network.",
        "Make sure the device is in setup mode (its light is blinking) and close to the phone, then try again.",
    ),
    "join_cancelled": ("Joining the device's network was cancelled.", "Start again and accept the system prompt to join the device's network."),
    "permission_denied": (
        "The phone did not allow CUBE OS to join or see Wi-Fi networks.",
        "Allow location (and on Android 13+, nearby devices) for CUBE OS in the phone's settings, then try again.",
    ),
    "device_not_reachable_on_ap": (
        "The phone joined the setup network but the device did not answer.",
        "On Android, choose 'Stay connected' if asked about no internet, or turn mobile data off for a moment. Then try again.",
    ),
    "wifi_rejected": (
        "The device could not join your Wi-Fi with that name and password.",
        "Check the network name and password. Most devices need a 2.4 GHz network; dual-band routers may need it named separately.",
    ),
    "device_not_found": (
        "The device did not appear on your network.",
        "Check it joined your Wi-Fi (its light stops blinking), that the gateway is on the same network, and that the router "
        "does not isolate Wi-Fi clients (AP or client isolation). Then put the device back in setup mode and try again.",
    ),
    "local_key_required": (
        "The device was found but encrypts its local protocol.",
        "Enter its local key to finish pairing, or set it up in a mode that does not need one.",
    ),
    "unsupported_model": ("This model is not supported by CUBE's setup for this brand.", "Set it up with the manufacturer's instructions, then use Find existing device."),
    "already_paired": ("This device is already paired with CUBE.", "It is in your device list."),
    "gateway_wifi_unavailable": (
        "The gateway has no Wi-Fi radio available for device setup.",
        "Set CUBE_SOFTAP_INTERFACE on a gateway with a spare Wi-Fi radio, or use another setup method.",
    ),
    "provisioning_protocol_failed": ("The device did not accept the setup request.", "Put the device back in setup mode and try again."),
    "session_expired": ("The setup took too long and was stopped.", "Start again; put the device back in setup mode first."),
    "gateway_restarted": ("The gateway restarted during setup.", "Start the setup again."),
    "cancelled": ("Setup cancelled.", "Start again whenever you are ready."),
    "pairing_failed": ("The device was found but pairing failed.", "Try pairing it from Find existing device."),
}


class ProvisioningFailure(Exception):
    def __init__(self, code: str, detail: str | None = None):
        super().__init__(code)
        self.code = code
        self.detail = detail


def error_for(code: str, detail: str | None = None) -> ProvisioningError:
    message, recovery = ERRORS.get(code, ERRORS["provisioning_protocol_failed"])
    return ProvisioningError(code=code if code in ERRORS else "provisioning_protocol_failed", message=detail or message, recovery=recovery)


class ProvisioningEngine:
    def __init__(
        self,
        db: Database,
        bus: EventBus,
        settings: Settings,
        registry: AdapterRegistry,
        discovery: DiscoveryEngine,
        pairings: PairingManager,
        gateway_runner: Any = None,
    ):
        self.db = db
        self.bus = bus
        self.settings = settings
        self.registry = registry
        self.discovery = discovery
        self.pairings = pairings
        self.gateway_runner = gateway_runner
        self.sessions: dict[str, ProvisioningSession] = {}
        #: Secrets the phone read from the device's setup network (e.g. the SONOFF device key), in memory only.
        self._secrets: dict[str, dict[str, str]] = {}
        self._tasks: dict[str, asyncio.Task] = {}
        self._sweeper: asyncio.Task | None = None
        pairings.listeners.append(self._on_pairing)

    async def load(self) -> None:
        rows = await self.db.fetchall("SELECT data FROM provisioning_sessions WHERE created_at > ?", (time.time() - 86400,))
        for row in rows:
            try:
                session = ProvisioningSession.model_validate_json(row["data"])
            except ValueError:
                continue
            self.sessions[session.id] = session
            if session.state in TERMINAL:
                continue
            if session.state == S.WAITING_FOR_DEVICE and session.expires_at > time.time():
                self._tasks[session.id] = asyncio.create_task(self._wait_for_device(session.id))
            else:
                await self._fail(session, "gateway_restarted")
        await self.db.execute("DELETE FROM provisioning_sessions WHERE created_at <= ?", (time.time() - 86400,))
        self._sweeper = asyncio.create_task(self._sweep())

    async def stop(self) -> None:
        for task in [*self._tasks.values(), self._sweeper]:
            if task:
                task.cancel()

    async def _sweep(self) -> None:
        while True:
            await asyncio.sleep(10)
            now = time.time()
            for session in list(self.sessions.values()):
                if session.state not in TERMINAL and session.expires_at < now:
                    task = self._tasks.pop(session.id, None)
                    if task:
                        task.cancel()
                    await self._fail(session, "session_expired")

    # ---- persistence and publishing ----

    async def _save(self, session: ProvisioningSession) -> None:
        session.updated_at = time.time()
        await self.db.execute(
            "INSERT INTO provisioning_sessions (id, data, created_at, expires_at) VALUES (?, ?, ?, ?) "
            "ON CONFLICT(id) DO UPDATE SET data = excluded.data",
            (session.id, session.model_dump_json(), session.created_at, session.expires_at),
        )
        self.bus.publish("provisioning.updated", session=session.model_dump(mode="json"))

    async def _move(self, session: ProvisioningSession, state: ConnectionStatus, note: str | None = None) -> None:
        session.state = state
        session.history.append({"state": state.value, "at": time.time(), **({"note": note} if note else {})})
        await self._save(session)

    async def _fail(self, session: ProvisioningSession, code: str, detail: str | None = None) -> None:
        session.error = error_for(code, detail)
        self._secrets.pop(session.id, None)
        await self._move(session, S.PAIRING_FAILED, code)
        log.info("provisioning failed", extra={"session": session.id, "plugin": session.plugin_id, "code": code})

    # ---- API ----

    def get(self, session_id: str) -> ProvisioningSession:
        session = self.sessions.get(session_id)
        if session is None:
            raise DeviceError("not_found", "No such setup session.", 404)
        return session

    async def create(self, plugin_id: str, model: str | None) -> ProvisioningSession:
        plugin = PLUGINS_BY_ID.get(plugin_id)
        if plugin is None:
            raise DeviceError("not_found", "No such setup method.", 404)
        if plugin.adapter_id not in self.registry.adapters:
            raise DeviceError("adapter_unavailable", "The adapter for this device is not loaded on this gateway.", 422)
        ok, reason = self.registry.adapters[plugin.adapter_id].available()
        if not ok:
            raise DeviceError("adapter_unavailable", reason or "This setup method is not available.", 422)
        if plugin.transport == "gateway" and not self.settings.softap_interface:
            raise DeviceError("gateway_wifi_unavailable", ERRORS["gateway_wifi_unavailable"][0], 422, ERRORS["gateway_wifi_unavailable"][1])
        model = (model or "").strip()[:40] or None
        now = time.time()
        session = ProvisioningSession(
            id="prov_" + secrets.token_hex(6),
            brand_id=plugin.brand_id,
            plugin_id=plugin.id,
            adapter_id=plugin.adapter_id,
            model=model,
            transport=plugin.transport,  # type: ignore[arg-type]
            state=S.PAIRING_MODE_REQUIRED,
            experimental=plugin.is_experimental(model),
            hotspot=plugin.hotspot.resolve(model),
            steps=list(plugin.steps),
            created_at=now,
            expires_at=now + self.settings.provisioning_ttl,
            updated_at=now,
            history=[{"state": S.PAIRING_MODE_REQUIRED.value, "at": now}],
        )
        self.sessions[session.id] = session
        await self._save(session)
        log.info("provisioning started", extra={"session": session.id, "plugin": plugin.id, "model": model, "experimental": session.experimental})
        return session

    async def event(self, session_id: str, event: ProvisioningEvent) -> ProvisioningSession:
        session = self.get(session_id)
        if session.state in TERMINAL:
            raise DeviceError("conflict", "This setup session has already finished.", 409)
        plugin = PLUGINS_BY_ID[session.plugin_id]
        if event.event == "cancel":
            self._cancel_task(session_id)
            await self._fail(session, "cancelled")
            return session
        if event.event == "failed":
            code = str(event.data.get("code") or "provisioning_protocol_failed")[:40]
            detail = event.data.get("message")
            await self._fail(session, code, str(detail)[:300] if isinstance(detail, str) and detail.strip() else None)
            return session
        if event.event == "device_ap_joined":
            ssid = str(event.data.get("ssid") or "")[:32]
            if ssid and not re.search(session.hotspot.ssid_pattern, ssid, re.I):
                await self._fail(session, "unsupported_model", f"The network {ssid!r} does not look like a {plugin.title.split(' a ')[-1]} setup network.")
                return session
            session.expect.update(plugin.expect(ssid))
        if event.event == "device_info":
            self._absorb_device_info(session, event.data)
            await self._save(session)
            return session
        target = EVENT_STATE.get(event.event)
        if target is None:
            raise DeviceError("bad_request", "Unknown setup step.", 400)
        if ORDER.index(target) < ORDER.index(session.state) and target != S.HOTSPOT_PASSWORD_REQUIRED:
            raise DeviceError("conflict", "That step does not fit where the setup is now.", 409)
        await self._move(session, target)
        if target == S.WAITING_FOR_DEVICE:
            self._cancel_task(session_id)
            self._tasks[session_id] = asyncio.create_task(self._wait_for_device(session_id))
        return session

    def _absorb_device_info(self, session: ProvisioningSession, data: dict[str, Any]) -> None:
        if session.plugin_id == "sonoff_diy_softap":
            device_id = str(data.get("deviceid") or "").lower()
            apikey = str(data.get("apikey") or "")
            if re.fullmatch(r"[0-9a-f]{6,16}", device_id):
                session.expect["deviceid"] = device_id
            if re.fullmatch(r"[0-9A-Za-z-]{16,64}", apikey):
                self._secrets.setdefault(session.id, {})["device_key"] = apikey
        elif session.plugin_id == "shelly_softap":
            mac = re.sub(r"[^0-9a-f]", "", str(data.get("mac") or "").lower())
            if len(mac) == 12:
                session.expect["mac_suffix"] = mac
        model = data.get("model")
        if isinstance(model, str) and model.strip() and not session.model:
            session.model = model.strip()[:40]

    async def cancel(self, session_id: str) -> ProvisioningSession:
        return await self.event(session_id, ProvisioningEvent(event="cancel"))

    def _cancel_task(self, session_id: str) -> None:
        task = self._tasks.pop(session_id, None)
        if task:
            task.cancel()

    async def run_on_gateway(self, session_id: str, request: GatewayProvisionRequest) -> ProvisioningSession:
        session = self.get(session_id)
        if session.transport != "gateway":
            raise DeviceError("bad_request", "This setup runs on the phone, not the gateway.", 400)
        if session.state in TERMINAL or session.state == S.WAITING_FOR_DEVICE:
            raise DeviceError("conflict", "This setup is not waiting to be run.", 409)
        plugin = PLUGINS_BY_ID[session.plugin_id]
        if not re.search(session.hotspot.ssid_pattern, request.hotspot_ssid, re.I):
            raise DeviceError("bad_params", "That network name does not look like this device's setup network.", 400)
        if self.gateway_runner is None:
            raise DeviceError("gateway_wifi_unavailable", ERRORS["gateway_wifi_unavailable"][0], 422, ERRORS["gateway_wifi_unavailable"][1])
        session.expect.update(plugin.expect(request.hotspot_ssid))
        await self._move(session, S.CONNECTING_DEVICE_AP)
        self._cancel_task(session_id)
        self._tasks[session_id] = asyncio.create_task(self._run_gateway(session, plugin, request))
        return session

    async def _run_gateway(self, session: ProvisioningSession, plugin: ProvisioningPlugin, request: GatewayProvisionRequest) -> None:
        hotspot_password = request.hotspot_password if session.hotspot.password_rule == "user" else session.hotspot.password

        async def progress(state: ConnectionStatus) -> None:
            await self._move(session, state)

        try:
            await self.gateway_runner(plugin, session, request.hotspot_ssid, hotspot_password, request.home_ssid, request.home_password, progress)
        except ProvisioningFailure as failure:
            await self._fail(session, failure.code, failure.detail)
            return
        except asyncio.CancelledError:
            raise
        except Exception:  # noqa: BLE001
            log.exception("gateway-side provisioning failed")
            await self._fail(session, "provisioning_protocol_failed")
            return
        await self._move(session, S.WAITING_FOR_DEVICE)
        await self._wait_for_device(session.id)

    # ---- after the device joins the home network ----

    def _matches(self, session: ProvisioningSession, candidate: Candidate) -> bool:
        expect = session.expect
        if not expect:
            return candidate.paired_device_id is None
        if "deviceid" in expect and candidate.unique_id.lower() != expect["deviceid"]:
            return False
        if "mac_suffix" in expect:
            mac = (candidate.mac or candidate.unique_id).replace(":", "").lower()
            if not mac.endswith(expect["mac_suffix"]):
                return False
        return True

    async def _wait_for_device(self, session_id: str) -> None:
        session = self.sessions[session_id]
        try:
            window = min(WAIT_WINDOW, max(10.0, session.expires_at - time.time()))
            candidate = await self.discovery.find(session.adapter_id, lambda c: self._matches(session, c), window=window, after=session.created_at - 5)
            if candidate is None:
                await self._fail(session, "device_not_found")
                return
            session.candidate_id = candidate.id
            if candidate.paired_device_id:
                session.device_id = candidate.paired_device_id
                await self._move(session, S.CONNECTED, "already_paired")
                return
            credentials = dict(self._secrets.get(session_id, {}))
            needs = candidate.pairing.auth
            if needs not in (AuthKind.NONE,) and not (needs == AuthKind.LOCAL_KEY and credentials.get("device_key")):
                await self._move(session, S.LOCAL_AUTHORIZATION_REQUIRED)
                return
            pairing = await self.pairings.start(PairingRequest(candidate_id=candidate.id, credentials=credentials), experimental=session.experimental)
            session.pairing_id = pairing.id
            await self._save(session)
        except asyncio.CancelledError:
            raise
        except AdapterError as error:
            await self._fail(session, "pairing_failed", error.message)
        except Exception:  # noqa: BLE001
            log.exception("waiting for the device failed")
            await self._fail(session, "device_not_found")
        finally:
            self._tasks.pop(session_id, None)

    def _on_pairing(self, pairing: Pairing) -> None:
        for session in self.sessions.values():
            if session.state in TERMINAL or session.candidate_id != pairing.candidate_id:
                continue
            if pairing.status == "paired":
                session.device_id = pairing.device_id
                session.pairing_id = pairing.id
                self._secrets.pop(session.id, None)
                asyncio.get_running_loop().create_task(self._move(session, S.CONNECTED))
            elif pairing.status == "needs_input":
                session.pairing_id = pairing.id
                code = "local_key_required" if pairing.error_code and "key" in pairing.error_code else None
                if code:
                    session.error = error_for(code)
                asyncio.get_running_loop().create_task(self._move(session, S.LOCAL_AUTHORIZATION_REQUIRED))
            elif pairing.status == "failed" and session.state != S.LOCAL_AUTHORIZATION_REQUIRED:
                with contextlib.suppress(RuntimeError):
                    asyncio.get_running_loop().create_task(self._fail(session, "pairing_failed", pairing.message))
