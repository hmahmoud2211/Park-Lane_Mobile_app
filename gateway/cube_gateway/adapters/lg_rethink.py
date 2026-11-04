"""LG ThinQ appliances through ReThink (https://github.com/anszom/rethink), a local replacement for LG's cloud.

ReThink terminates the appliance's cloud connection (the appliance is pointed at it during setup and
*.lgthinq.com is redirected to it in DNS) and republishes each supported appliance as Home Assistant MQTT
device discovery: config at `<discovery_prefix>/device/rethink/<id>/config`, state at `rethink/<id>/<field>`,
commands at `rethink/<id>/<field>/set`. This adapter is an MQTT consumer of exactly that, so it supports what
ReThink supports and nothing more: experimental and model-dependent (see ReThink's support table).

ReThink publishes discovery when it connects and when `<discovery_prefix>/status` says `online` (Home
Assistant's birth message), which this adapter sends on connect. If no discovery arrives, an air conditioner is
still recognised from ReThink's climate topic names (`climate-mode`, `climate-temperature`, ...).
"""

from __future__ import annotations

import asyncio
import contextlib
import json
import logging
from collections import defaultdict
from typing import Any
from urllib.parse import urlparse

from ..models import AdapterInfo, AuthKind, Candidate, Category, CommandResult, ConnectionStatus, SupportLevel
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
)

log = logging.getLogger("cube.adapter.lg_thinq_rethink")
HA_DEFAULT_MODES = ["off", "auto", "cool", "dry", "fan_only", "heat"]
FALLBACK_FAN_MODES = ["auto", "very low", "low", "medium", "high", "very high"]


class LgRethinkAdapter(DeviceAdapter):
    info = AdapterInfo(
        id="lg_thinq_rethink",
        name="LG ThinQ via ReThink (MQTT)",
        brands=["lg"],
        protocols=["rethink-mqtt"],
        discovery=["mqtt"],
        categories=[Category.CLIMATE, Category.OTHER],
        status=SupportLevel.EXPERIMENTAL,
        account_free=True,
        auth=AuthKind.NONE,
        push_updates=True,
        library="aiomqtt",
        verified_models=[],
        notes=[
            "Needs a ReThink server and CUBE_RETHINK_MQTT_URL. ReThink replaces LG's cloud, so no LG account is used.",
            "The appliance must be set up for ReThink (rethink-setup or the gateway's LG setup) and *.lgthinq.com must resolve to ReThink.",
            "Only appliances in ReThink's support table are translated; others appear as unsupported.",
        ],
    )
    poll_interval = 120

    def __init__(self, ctx):
        super().__init__(ctx)
        settings = ctx.settings
        self.url = settings.rethink_mqtt_url
        self.discovery_prefix = settings.rethink_discovery_prefix
        self.prefix = settings.rethink_prefix
        self.configs: dict[str, dict[str, Any]] = {}
        self.values: dict[str, str] = {}
        self.connected = False
        self.last_error: str | None = None
        self._client: Any = None
        self._task: asyncio.Task | None = None
        self._stopping = False
        self._changed: dict[str, asyncio.Event] = defaultdict(asyncio.Event)
        self._listeners: dict[str, StateCallback] = {}
        self._debounce: dict[str, asyncio.TimerHandle] = {}
        self._last_on_mode: dict[str, str] = {}

    def available(self) -> tuple[bool, str | None]:
        if not self.url:
            return False, "Set CUBE_RETHINK_MQTT_URL to your ReThink MQTT broker to use LG ThinQ appliances."
        return True, None

    # ---- MQTT connection ----

    async def start(self) -> None:
        if self.url and self._task is None:
            self._stopping = False
            self._task = asyncio.create_task(self._run())

    async def stop(self) -> None:
        self._stopping = True
        if self._task:
            self._task.cancel()
            with contextlib.suppress(asyncio.CancelledError, Exception):
                await self._task
            self._task = None

    async def _run(self) -> None:
        import aiomqtt

        parsed = urlparse(self.url)
        host = parsed.hostname or "localhost"
        port = parsed.port or (8883 if parsed.scheme == "mqtts" else 1883)
        backoff = 1.0
        while not self._stopping:
            try:
                async with aiomqtt.Client(
                    host,
                    port,
                    username=parsed.username or None,
                    password=parsed.password or None,
                    identifier=f"cube-gateway-{id(self) & 0xFFFF:x}",
                    tls_params=aiomqtt.TLSParameters() if parsed.scheme == "mqtts" else None,
                ) as client:
                    self._client = client
                    self.connected = True
                    self.last_error = None
                    backoff = 1.0
                    log.info("connected to ReThink MQTT", extra={"host": host, "port": port})
                    await client.subscribe(f"{self.discovery_prefix}/device/rethink/+/config")
                    await client.subscribe(f"{self.prefix}/#")
                    # Home Assistant's birth message: ReThink answers by publishing discovery again.
                    await client.publish(f"{self.discovery_prefix}/status", "online")
                    async for message in client.messages:
                        self.handle_message(str(message.topic), bytes(message.payload or b""))
            except asyncio.CancelledError:
                raise
            except Exception as error:  # noqa: BLE001 - reconnect on any broker failure
                self.last_error = str(error) or type(error).__name__
                log.warning("ReThink MQTT connection failed; retrying", extra={"reason": self.last_error, "retry_in": backoff})
            finally:
                self.connected = False
                self._client = None
            await asyncio.sleep(backoff)
            backoff = min(60.0, backoff * 2)

    def handle_message(self, topic: str, payload: bytes) -> None:
        """Public for tests: feeds one MQTT message into the adapter's view."""
        config_prefix = f"{self.discovery_prefix}/device/rethink/"
        is_config = topic.startswith(config_prefix) and topic.endswith("/config")
        # Device discovery for a full-featured AC is ~11 KB; state values are short.
        text = payload.decode("utf-8", "replace")[: 131072 if is_config else 4096]
        if is_config:
            device_id = topic[len(config_prefix) : -len("/config")]
            try:
                config = json.loads(text)
            except ValueError:
                return
            if isinstance(config, dict) and isinstance(config.get("components"), dict):
                self.configs[device_id] = config
                self._notify(device_id)
            return
        if not topic.startswith(self.prefix + "/"):
            return
        self.values[topic] = text
        self._changed[topic].set()
        parts = topic[len(self.prefix) + 1 :].split("/")
        if len(parts) >= 2:
            self._notify(parts[0])

    def _notify(self, device_id: str) -> None:
        callback = self._listeners.get(device_id)
        if callback is None:
            return
        handle = self._debounce.pop(device_id, None)
        if handle:
            handle.cancel()
        loop = asyncio.get_running_loop()

        def fire() -> None:
            self._debounce.pop(device_id, None)
            loop.create_task(self._push(device_id, callback))

        self._debounce[device_id] = loop.call_later(0.3, fire)

    async def _push(self, device_id: str, callback: StateCallback) -> None:
        try:
            await callback(self._state_for(device_id))
        except Exception:  # noqa: BLE001
            log.debug("state push failed", exc_info=True)

    # ---- model ----

    def device_ids(self) -> list[str]:
        ids = set(self.configs)
        for topic in self.values:
            parts = topic[len(self.prefix) + 1 :].split("/")
            if len(parts) == 2 and parts[1].startswith("climate-"):
                ids.add(parts[0])
        return sorted(ids)

    def _climate(self, device_id: str) -> dict[str, Any] | None:
        config = self.configs.get(device_id)
        if config:
            for component in config["components"].values():
                if isinstance(component, dict) and component.get("platform") == "climate":
                    return component
        base = f"{self.prefix}/{device_id}/climate-"
        if f"{base}mode" not in self.values:
            return None
        # ReThink's own topic names (cloud/devices/tlv_device.ts addField): climate-<field>, climate-<field>/set.
        return {
            "mode_state_topic": f"{base}mode",
            "mode_command_topic": f"{base}mode/set",
            "temperature_state_topic": f"{base}temperature",
            "temperature_command_topic": f"{base}temperature/set",
            "current_temperature_topic": f"{base}current_temperature",
            "fan_mode_state_topic": f"{base}fan_mode",
            "fan_mode_command_topic": f"{base}fan_mode/set",
            "fan_modes": FALLBACK_FAN_MODES,
            "min_temp": 18,
            "max_temp": 30,
            "temp_step": 0.5,
        }

    def _float(self, topic: str | None) -> float | None:
        if not topic:
            return None
        try:
            return float(self.values[topic])
        except (KeyError, ValueError):
            return None

    def _online(self, device_id: str) -> bool:
        own = self.values.get(f"{self.prefix}/{device_id}/availability")
        bridge = self.values.get(f"{self.prefix}/availability")
        return own == "online" and bridge != "offline"

    def _state_for(self, device_id: str) -> DeviceState:
        capabilities = []
        readings = []
        climate = self._climate(device_id)
        if climate:
            mode = self.values.get(climate.get("mode_state_topic", ""))
            if mode and mode != "off":
                self._last_on_mode[device_id] = mode
            capabilities.append(
                caps.climate(
                    current=self._float(climate.get("current_temperature_topic")),
                    target=self._float(climate.get("temperature_state_topic")),
                    mode=mode,
                    modes=list(climate.get("modes") or HA_DEFAULT_MODES),
                    fan_mode=self.values.get(climate.get("fan_mode_state_topic", "")),
                    fan_modes=list(climate.get("fan_modes") or []),
                    low=float(climate.get("min_temp", 18)),
                    high=float(climate.get("max_temp", 30)),
                    step=float(climate.get("temp_step", 0.5)),
                    unit="°C" if climate.get("temperature_unit", "C") == "C" else "°F",
                )
            )
        config = self.configs.get(device_id) or {}
        for key, component in (config.get("components") or {}).items():
            if isinstance(component, dict) and component.get("platform") == "sensor" and component.get("state_topic") in self.values:
                value = self.values[component["state_topic"]]
                with contextlib.suppress(ValueError):
                    value = float(value)  # type: ignore[assignment]
                label = component.get("name") or key.replace("_", " ").capitalize()
                readings.append(caps.reading(key, str(label), value, component.get("unit_of_measurement"), component.get("device_class")))
        model = ((self.configs.get(device_id) or {}).get("device") or {}).get("model")
        return DeviceState(capabilities=capabilities, readings=readings, commands=caps.commands_for(capabilities), online=self._online(device_id), model=model)

    def _describe(self, device_id: str) -> tuple[str, str | None, Category]:
        device = (self.configs.get(device_id) or {}).get("device") or {}
        category = Category.CLIMATE if self._climate(device_id) else Category.OTHER
        return device.get("name") or ("LG Air Conditioner" if category == Category.CLIMATE else "LG appliance"), device.get("model"), category

    # ---- adapter interface ----

    async def discover(self, scan: ScanContext) -> None:
        if not self.url:
            return
        if not self.connected:
            raise AdapterError(f"ReThink's MQTT broker is not reachable ({self.last_error or 'connecting'}).", code="rethink_unreachable")
        loop = asyncio.get_running_loop()
        deadline = loop.time() + min(3.0, scan.timeout)
        while not self.device_ids() and loop.time() < deadline and not scan.cancelled.is_set():
            await asyncio.sleep(0.2)
        for device_id in self.device_ids():
            name, model, category = self._describe(device_id)
            supported = category != Category.OTHER or bool(self.configs.get(device_id))
            candidate = make_candidate(
                self,
                device_id,
                name=name,
                model=model,
                protocol="rethink-mqtt",
                sources=["mqtt"],
                control="experimental" if supported else "detection_only",
                details={"online": self._online(device_id)},
            )
            candidate.status = ConnectionStatus.EXPERIMENTAL if supported else ConnectionStatus.UNSUPPORTED
            scan.report(candidate)

    async def pair(self, candidate: Candidate, credentials: dict[str, str], approval: ApprovalCallback) -> PairResult:
        if candidate.unique_id not in self.device_ids():
            raise DeviceUnreachable("ReThink does not list this appliance right now. Check it is connected to ReThink.")
        name, model, category = self._describe(candidate.unique_id)
        if category == Category.OTHER and not self.configs.get(candidate.unique_id):
            raise AdapterError("ReThink does not translate this appliance yet, so it cannot be controlled.", code="unsupported_device")
        return PairResult(unique_id=candidate.unique_id, name=name, category=category, model=model, protocol="rethink-mqtt", params={"rethink_id": candidate.unique_id})

    async def get_state(self, device: StoredDevice) -> DeviceState:
        if not self.connected:
            raise DeviceUnreachable("The gateway is not connected to ReThink's MQTT broker.")
        return self._state_for(device.unique_id)

    async def _publish(self, topic: str | None, value: str) -> None:
        if not topic:
            raise UnsupportedCommand("ReThink offers no control for that on this appliance.")
        if not self.connected or self._client is None:
            raise DeviceUnreachable("The gateway is not connected to ReThink's MQTT broker.")
        await self._client.publish(topic, value)

    async def execute_command(self, device: StoredDevice, command: str, params: dict[str, Any]) -> CommandOutcome:
        climate = self._climate(device.unique_id)
        if climate is None:
            raise UnsupportedCommand("This appliance has no climate controls in ReThink.")
        if command in {"turn_on", "turn_off", "toggle"}:
            current = self.values.get(climate.get("mode_state_topic", ""), "off")
            on = {"turn_on": True, "turn_off": False}.get(command, current == "off")
            if on and climate.get("power_command_topic"):
                # Power ON resumes the appliance's own last mode; confirmed once the mode leaves "off".
                return await self._power_on(device, climate)
            mode = self._last_on_mode.get(device.unique_id, "cool") if on else "off"
            topic, state_topic, value = climate.get("mode_command_topic"), climate.get("mode_state_topic"), mode
        elif command == "set_hvac_mode":
            value = str(caps.param(params, "mode"))
            if value not in (climate.get("modes") or HA_DEFAULT_MODES):
                raise AdapterError(f"Mode {value!r} is not offered by this appliance.", code="bad_params")
            topic, state_topic = climate.get("mode_command_topic"), climate.get("mode_state_topic")
        elif command == "set_temperature":
            temperature = caps.clamp(caps.param(params, "temperature"), float(climate.get("min_temp", 18)), float(climate.get("max_temp", 30)), "temperature")
            step = float(climate.get("temp_step", 0.5))
            value = f"{round(temperature / step) * step:g}"
            topic, state_topic = climate.get("temperature_command_topic"), climate.get("temperature_state_topic")
        elif command == "set_fan_mode":
            value = str(caps.param(params, "fan_mode"))
            if climate.get("fan_modes") and value not in climate["fan_modes"]:
                raise AdapterError(f"Fan mode {value!r} is not offered by this appliance.", code="bad_params")
            topic, state_topic = climate.get("fan_mode_command_topic"), climate.get("fan_mode_state_topic")
        else:
            raise UnsupportedCommand(f"LG appliances via ReThink do not support {command}.")

        if state_topic:
            self._changed[state_topic].clear()
        await self._publish(topic, value)
        if state_topic:
            with contextlib.suppress(TimeoutError):
                await asyncio.wait_for(self._wait_value(state_topic, value), timeout=8)
            if _same(self.values.get(state_topic), value):
                return CommandOutcome(result=CommandResult(status="confirmed"), state=self._state_for(device.unique_id))
        return CommandOutcome(
            result=CommandResult(status="pending", message="ReThink accepted the command; the appliance has not reported the change yet."),
            state=self._state_for(device.unique_id),
        )

    async def _power_on(self, device: StoredDevice, climate: dict[str, Any]) -> CommandOutcome:
        state_topic = climate.get("mode_state_topic")
        if state_topic:
            self._changed[state_topic].clear()
        await self._publish(climate.get("power_command_topic"), str(climate.get("payload_on", "ON")))
        if state_topic:
            with contextlib.suppress(TimeoutError):
                await asyncio.wait_for(self._wait_not(state_topic, "off"), timeout=8)
            if self.values.get(state_topic) not in (None, "off"):
                return CommandOutcome(result=CommandResult(status="confirmed"), state=self._state_for(device.unique_id))
        return CommandOutcome(
            result=CommandResult(status="pending", message="ReThink accepted the command; the appliance has not reported the change yet."),
            state=self._state_for(device.unique_id),
        )

    async def _wait_not(self, topic: str, value: str) -> None:
        while self.values.get(topic) in (None, value):
            event = self._changed[topic]
            event.clear()
            await event.wait()

    async def _wait_value(self, topic: str, value: str) -> None:
        while not _same(self.values.get(topic), value):
            event = self._changed[topic]
            event.clear()
            await event.wait()

    async def subscribe_to_events(self, device: StoredDevice, callback: StateCallback):
        self._listeners[device.unique_id] = callback

        async def unsubscribe() -> None:
            self._listeners.pop(device.unique_id, None)

        return unsubscribe


def _same(reported: str | None, wanted: str) -> bool:
    if reported is None:
        return False
    if reported == wanted:
        return True
    try:
        return abs(float(reported) - float(wanted)) < 1e-6
    except ValueError:
        return False
