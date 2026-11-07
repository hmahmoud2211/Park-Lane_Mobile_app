"""Matter adapter against a fake Matter Server speaking its WebSocket API over a real socket on localhost.

Message shapes follow python-matter-server 8.1.2 (server info on connect, start_listening -> node list,
{"message_id", "result"} / {"message_id", "error_code", "details"} replies, {"event", "data"} events).
"""

from __future__ import annotations

import asyncio
import ipaddress
import json
from dataclasses import replace
from typing import Any

import pytest

from cube_gateway.adapters import matter as matter_module
from cube_gateway.adapters.base import (
    AdapterContext,
    AdapterError,
    AuthRequired,
    DeviceUnreachable,
    NotSupported,
    PairingRejected,
    ScanContext,
    StoredDevice,
    UnsupportedCommand,
)
from cube_gateway.adapters.matter import MatterAdapter, normalize_code
from cube_gateway.models import AuthKind, Category


def _node(node_id: int, attributes: dict[str, Any], *, available: bool = True, bridge: bool = False) -> dict[str, Any]:
    return {
        "node_id": node_id,
        "date_commissioned": "2026-11-07T10:00:00",
        "last_interview": "2026-11-07T10:00:00",
        "interview_version": 6,
        "available": available,
        "is_bridge": bridge,
        "attributes": {"0/29/0": [{"0": 22, "1": 1}], **attributes},
    }


def light(node_id: int = 5, **kw) -> dict:
    return _node(node_id, {
        "0/40/1": "Eve Systems", "0/40/2": 4874, "0/40/3": "Eve Light Strip", "0/40/4": 77, "0/40/5": "", "0/40/18": "EVE-ABC123",
        "1/29/0": [{"0": 269, "1": 4}], "1/6/0": False, "1/8/0": 127, "1/768/7": 370, "1/768/16395": 153, "1/768/16396": 500,
    }, **kw)


def plug(node_id: int = 6) -> dict:
    return _node(node_id, {"0/40/1": "TP-Link", "0/40/3": "Tapo P110M", "0/40/5": "Kettle", "0/40/15": "SN-77", "1/29/0": [{"0": 266, "1": 3}], "1/6/0": True, "1/144/8": 23500})


def thermostat(node_id: int = 7) -> dict:
    return _node(node_id, {
        "0/40/3": "Nest Thermostat", "0/40/18": "NEST-1", "1/29/0": [{"0": 769, "1": 2}],
        "1/513/0": 2150, "1/513/17": 2600, "1/513/18": 2000, "1/513/27": 4, "1/513/28": 4, "1/513/3": 700, "1/513/4": 3000, "1/513/5": 1600, "1/513/6": 3200,
    })


def sensor(node_id: int = 8) -> dict:
    return _node(node_id, {
        "0/40/3": "Door & Window", "0/40/18": "EVE-DW-1", "1/29/0": [{"0": 21, "1": 1}], "1/69/0": True, "1/47/12": 180,
        "2/29/0": [{"0": 770, "1": 1}], "2/1026/0": 2234, "3/29/0": [{"0": 775, "1": 1}], "3/1029/0": 4512,
    })


def cover(node_id: int = 9) -> dict:
    return _node(node_id, {"0/40/3": "MotionBlinds", "0/40/18": "BLIND-1", "1/29/0": [{"0": 514, "1": 2}], "1/258/14": 2500})


def bridge(node_id: int = 10) -> dict:
    return _node(node_id, {"0/40/3": "Hue Bridge", "0/40/18": "HUE-1", "1/29/0": [{"0": 14, "1": 1}]}, bridge=True)


class FakeMatterServer:
    def __init__(self) -> None:
        self.nodes: dict[int, dict] = {}
        self.calls: list[tuple[str, dict]] = []
        self.commissionable: list[dict] = []
        self.commission_result: dict | None = None
        self.fail: dict[str, tuple[int, str]] = {}
        self.schema = 11
        self.echo = True
        self.sockets: set = set()
        self.server: Any = None
        self.port = 0

    async def start(self) -> None:
        from websockets.asyncio.server import serve

        self.server = await serve(self.handler, "127.0.0.1", self.port)
        self.port = self.server.sockets[0].getsockname()[1]

    @property
    def url(self) -> str:
        return f"ws://127.0.0.1:{self.port}/ws"

    async def stop(self) -> None:
        self.server.close()
        await self.server.wait_closed()

    async def handler(self, ws) -> None:
        self.sockets.add(ws)
        info = {"fabric_id": 1, "compressed_fabric_id": 1234, "schema_version": self.schema, "min_supported_schema_version": 5, "sdk_version": "fake",
                "wifi_credentials_set": False, "thread_credentials_set": False, "bluetooth_enabled": False}
        await ws.send(json.dumps(info))
        try:
            async for raw in ws:
                await self.answer(ws, json.loads(raw))
        except Exception:  # noqa: BLE001, S110 - a client going away mid-test is fine
            pass
        finally:
            self.sockets.discard(ws)

    async def emit(self, event: str, data: Any) -> None:
        for ws in list(self.sockets):
            await ws.send(json.dumps({"event": event, "data": data}))

    async def answer(self, ws, msg: dict) -> None:
        command, args, message_id = msg["command"], msg.get("args") or {}, msg["message_id"]
        self.calls.append((command, args))
        if command in self.fail:
            code, details = self.fail[command]
            await ws.send(json.dumps({"message_id": message_id, "error_code": code, "details": details}))
            return
        result: Any = None
        changes: dict[str, Any] = {}
        node_id = args.get("node_id")
        if command == "start_listening":
            result = list(self.nodes.values())
        elif command == "discover":
            result = self.commissionable
        elif command == "commission_with_code":
            node = self.commission_result
            assert node is not None
            self.nodes[node["node_id"]] = node
            result = node
        elif command == "device_command":
            changes = self._apply(args)
        elif command == "write_attribute":
            changes = {args["attribute_path"]: args["value"]}
        elif command == "read_attribute":
            paths = args["attribute_path"] if isinstance(args["attribute_path"], list) else [args["attribute_path"]]
            result = {path: self.nodes[node_id]["attributes"].get(path) for path in paths}
        elif command == "remove_node":
            self.nodes.pop(node_id, None)
        await ws.send(json.dumps({"message_id": message_id, "result": result}))
        if command == "remove_node":
            await self.emit("node_removed", node_id)
        if changes and self.echo:
            for path, value in changes.items():
                self.nodes[node_id]["attributes"][path] = value
                await self.emit("attribute_updated", [node_id, path, value])

    def _apply(self, args: dict) -> dict[str, Any]:
        ep, cluster, name, payload = args["endpoint_id"], args["cluster_id"], args["command_name"], args["payload"]
        attributes = self.nodes[args["node_id"]]["attributes"]
        if cluster == 6:
            current = bool(attributes.get(f"{ep}/6/0"))
            return {f"{ep}/6/0": {"On": True, "Off": False, "Toggle": not current}[name]}
        if cluster == 8 and name == "MoveToLevelWithOnOff":
            return {f"{ep}/8/0": payload["level"], f"{ep}/6/0": True}
        if cluster == 768 and name == "MoveToColorTemperature":
            return {f"{ep}/768/7": payload["colorTemperatureMireds"]}
        return {}  # covers move slowly: no immediate report


@pytest.fixture
async def server():
    fake = FakeMatterServer()
    await fake.start()
    yield fake
    await fake.stop()


@pytest.fixture
async def make_adapter(settings):
    started: list[MatterAdapter] = []

    async def make(url: str) -> MatterAdapter:
        adapter = MatterAdapter(AdapterContext(replace(settings, matter_url=url)))
        await adapter.start()
        started.append(adapter)
        return adapter

    yield make
    for adapter in started:
        await adapter.stop()


def _scan(found: list) -> ScanContext:
    return ScanContext(timeout=5, subnets=[ipaddress.ip_network("192.168.50.0/24")], report=found.append)


def _device(adapter: MatterAdapter, result, device_id: str = "dev_1") -> StoredDevice:
    return StoredDevice(id=device_id, adapter_id=adapter.info.id, brand="matter", unique_id=result.unique_id, name=result.name,
                        category=result.category, model=result.model, protocol=result.protocol, params=dict(result.params))


async def _approve(message: str) -> None:
    return None


async def _paired(adapter: MatterAdapter, node: dict) -> StoredDevice:
    found: list = []
    await adapter.discover(_scan(found))
    candidate = next(c for c in found if c.details.get("node_id") == node["node_id"])
    return _device(adapter, await adapter.pair(candidate, {}, _approve))


# ---- setup ----


def test_codes_are_normalized():
    assert normalize_code(" 3497-011-2332 ") == "34970112332"
    assert normalize_code("mt:y.k9042c00ka0648g00") == "MT:Y.K9042C00KA0648G00"


async def test_without_a_server_it_stays_idle(settings):
    adapter = MatterAdapter(AdapterContext(settings))
    await adapter.start()
    ok, why = adapter.available()
    assert not ok and "CUBE_MATTER_URL" in why
    found: list = []
    await adapter.discover(_scan(found))
    assert found == []


async def test_an_old_server_is_refused(server, make_adapter, monkeypatch):
    server.schema = 5
    adapter = await make_adapter(server.url)
    for _ in range(50):
        if adapter.last_error:
            break
        await asyncio.sleep(0.05)
    ok, why = adapter.available()
    assert not ok and "too old" in why


async def test_lists_fabric_nodes_and_devices_in_pairing_mode(server, make_adapter):
    server.nodes = {5: light(), 10: bridge()}
    server.commissionable = [{"instance_name": "ABCDEF0123456789", "device_name": "Eve Energy", "vendor_id": 4874, "product_id": 80, "long_discriminator": 3840,
                              "addresses": ["fd00::12", "192.168.50.31"]}]
    adapter = await make_adapter(server.url)
    assert adapter.available() == (True, None)
    found: list = []
    await adapter.discover(_scan(found))
    by_kind = {c.details["kind"] + str(c.details.get("node_id", "")): c for c in found}
    on_fabric = by_kind["node5"]
    assert on_fabric.unique_id == "EVE-ABC123" and on_fabric.name == "Eve Light Strip" and adapter.get_pairing_requirements(on_fabric).auth == AuthKind.NONE
    assert by_kind["node10"].control == "detection_only"
    waiting = by_kind["commissionable"]
    assert waiting.name == "Eve Energy" and waiting.ip == "192.168.50.31"
    requirements = adapter.get_pairing_requirements(waiting)
    assert requirements.auth == AuthKind.PIN and [f.name for f in requirements.fields] == ["setup_code"]


# ---- pairing ----


async def test_pairs_a_device_with_its_setup_code(server, make_adapter):
    server.commissionable = [{"instance_name": "ABCDEF0123456789", "vendor_id": 4874, "product_id": 80, "long_discriminator": 3840}]
    server.commission_result = plug()
    adapter = await make_adapter(server.url)
    found: list = []
    await adapter.discover(_scan(found))
    candidate = next(c for c in found if c.details["kind"] == "commissionable")
    with pytest.raises(AuthRequired, match="setup code"):
        await adapter.pair(candidate, {}, _approve)
    with pytest.raises(AuthRequired) as wrong:
        await adapter.pair(candidate, {"setup_code": "1234"}, _approve)
    assert wrong.value.code == "credentials_invalid"
    messages: list[str] = []

    async def approval(message: str) -> None:
        messages.append(message)

    result = await adapter.pair(candidate, {"setup_code": "3497-011-2332"}, approval)
    assert ("commission_with_code", {"code": "34970112332", "network_only": True}) in server.calls
    assert messages and "minute" in messages[0]
    assert result.unique_id == "0-0-SN-77"  # no UniqueID: vendor id-product id-serial (both ids absent here)
    assert result.name == "Kettle" and result.model == "Tapo P110M" and result.category == Category.PLUG and result.params["node_id"] == 6


async def test_a_failed_commissioning_is_explained(server, make_adapter):
    server.commissionable = [{"instance_name": "X", "vendor_id": 1, "product_id": 2, "long_discriminator": 3}]
    server.fail["commission_with_code"] = (1, "Commissioning failed: timeout")
    adapter = await make_adapter(server.url)
    found: list = []
    await adapter.discover(_scan(found))
    with pytest.raises(PairingRejected) as error:
        await adapter.pair(found[0], {"setup_code": "34970112332"}, _approve)
    assert "setup code" in error.value.recovery


async def test_bridges_are_refused_and_taken_off_the_fabric(server, make_adapter):
    server.commissionable = [{"instance_name": "B", "vendor_id": 4107, "product_id": 2, "long_discriminator": 9}]
    server.commission_result = bridge()
    adapter = await make_adapter(server.url)
    found: list = []
    await adapter.discover(_scan(found))
    with pytest.raises(NotSupported, match="bridge"):
        await adapter.pair(found[0], {"setup_code": "34970112332"}, _approve)
    assert ("remove_node", {"node_id": 10}) in server.calls


# ---- state and commands ----


async def test_light_state_and_commands(server, make_adapter):
    server.nodes = {5: light()}
    adapter = await make_adapter(server.url)
    device = await _paired(adapter, server.nodes[5])
    assert device.category == Category.LIGHT
    state = await adapter.get_state(device)
    caps = {c.type: c for c in state.capabilities}
    assert caps["power"].value == "off" and caps["brightness"].value == 50
    assert caps["color_temp"].value == 2703 and (caps["color_temp"].min, caps["color_temp"].max) == (2000, 6536)
    assert {"turn_on", "set_brightness", "set_color_temp"} <= set(state.commands)

    outcome = await adapter.execute_command(device, "turn_on", {})
    assert outcome.result.status == "confirmed"
    assert ("device_command", {"node_id": 5, "endpoint_id": 1, "cluster_id": 6, "command_name": "On", "payload": {}}) in server.calls
    assert next(c for c in outcome.state.capabilities if c.type == "power").value == "on"

    await adapter.execute_command(device, "set_brightness", {"brightness": 100})
    assert server.calls[-1][1]["payload"] == {"level": 254, "transitionTime": 0}
    outcome = await adapter.execute_command(device, "set_color_temp", {"kelvin": 2700})
    assert server.calls[-1][1]["payload"] == {"colorTemperatureMireds": 370, "transitionTime": 0} and outcome.result.status == "confirmed"
    await adapter.execute_command(device, "set_brightness", {"brightness": 0})
    assert server.calls[-1][1]["command_name"] == "Off"
    with pytest.raises(UnsupportedCommand):
        await adapter.execute_command(device, "set_position", {"position": 10})


async def test_plug_reports_power(server, make_adapter):
    server.nodes = {6: plug()}
    adapter = await make_adapter(server.url)
    device = await _paired(adapter, server.nodes[6])
    state = await adapter.get_state(device)
    assert {r.key: r.value for r in state.readings}["power_w"] == 23.5
    assert [c.type for c in state.capabilities] == ["power"]


async def test_thermostat_targets_follow_the_mode(server, make_adapter):
    server.nodes = {7: thermostat()}
    adapter = await make_adapter(server.url)
    device = await _paired(adapter, server.nodes[7])
    climate = next(c for c in (await adapter.get_state(device)).capabilities if c.type == "climate")
    assert (climate.current, climate.target, climate.mode) == (21.5, 20.0, "heat")
    assert climate.modes == ["off", "heat", "cool", "auto"] and (climate.min, climate.max) == (7.0, 32.0)

    outcome = await adapter.execute_command(device, "set_temperature", {"temperature": 22.5})
    assert server.calls[-1] == ("write_attribute", {"node_id": 7, "attribute_path": "1/513/18", "value": 2250}) and outcome.result.status == "confirmed"
    await adapter.execute_command(device, "set_hvac_mode", {"mode": "cool"})
    assert server.calls[-1][1] == {"node_id": 7, "attribute_path": "1/513/28", "value": 3}
    await adapter.execute_command(device, "set_temperature", {"temperature": 24})
    assert server.calls[-1][1]["attribute_path"] == "1/513/17"
    await adapter.execute_command(device, "set_hvac_mode", {"mode": "auto"})
    with pytest.raises(AdapterError, match="Heat or Cool"):
        await adapter.execute_command(device, "set_temperature", {"temperature": 22})
    with pytest.raises(UnsupportedCommand):
        await adapter.execute_command(device, "set_hvac_mode", {"mode": "dry"})
    await adapter.execute_command(device, "turn_off", {})
    assert server.calls[-1][1] == {"node_id": 7, "attribute_path": "1/513/28", "value": 0}


async def test_sensor_readings(server, make_adapter):
    server.nodes = {8: sensor()}
    adapter = await make_adapter(server.url)
    device = await _paired(adapter, server.nodes[8])
    assert device.category == Category.SENSOR
    readings = {r.key: r.value for r in (await adapter.get_state(device)).readings}
    assert readings == {"temperature": 22.3, "humidity": 45, "contact": "Closed", "battery": 90}


async def test_cover_position_is_inverted_and_moves_are_pending(server, make_adapter):
    server.nodes = {9: cover()}
    adapter = await make_adapter(server.url)
    device = await _paired(adapter, server.nodes[9])
    state = await adapter.get_state(device)
    blind = next(c for c in state.capabilities if c.type == "cover")
    assert (blind.position, blind.state) == (75, "open")
    assert {"cover_open", "cover_close", "cover_stop", "set_position"} <= set(state.commands)
    outcome = await adapter.execute_command(device, "set_position", {"position": 30})
    assert server.calls[-1][1]["command_name"] == "GoToLiftPercentage" and server.calls[-1][1]["payload"] == {"liftPercent100thsValue": 7000}
    assert outcome.result.status == "pending"
    await adapter.execute_command(device, "cover_stop", {})
    assert server.calls[-1][1]["command_name"] == "StopMotion"


async def test_a_change_the_device_never_reports_is_pending(server, make_adapter, monkeypatch):
    monkeypatch.setattr(matter_module, "CONFIRM_WAIT", 0.2)
    server.nodes = {6: plug()}
    server.echo = False
    adapter = await make_adapter(server.url)
    device = await _paired(adapter, server.nodes[6])
    outcome = await adapter.execute_command(device, "turn_off", {})
    assert outcome.result.status == "pending"
    assert server.calls[-1][0] == "read_attribute"


# ---- live updates and failures ----


async def test_pushes_changes_the_device_reports(server, make_adapter):
    server.nodes = {6: plug()}
    adapter = await make_adapter(server.url)
    device = await _paired(adapter, server.nodes[6])
    pushed: list = []

    async def callback(state) -> None:
        pushed.append(state)

    unsubscribe = await adapter.subscribe_to_events(device, callback)
    await server.emit("attribute_updated", [6, "1/6/0", False])
    for _ in range(40):
        if pushed:
            break
        await asyncio.sleep(0.05)
    assert pushed and next(c for c in pushed[-1].capabilities if c.type == "power").value == "off"
    await unsubscribe()
    pushed.clear()
    await server.emit("attribute_updated", [6, "1/6/0", True])
    await asyncio.sleep(0.4)
    assert pushed == []


async def test_unavailable_and_removed_devices(server, make_adapter):
    server.nodes = {6: plug(), 5: light(available=False)}
    adapter = await make_adapter(server.url)
    device = await _paired(adapter, server.nodes[6])
    asleep = await _paired(adapter, server.nodes[5])
    with pytest.raises(DeviceUnreachable, match="isn't answering"):
        await adapter.get_state(asleep)
    await server.emit("node_removed", 6)
    for _ in range(40):
        if 6 not in adapter.nodes:
            break
        await asyncio.sleep(0.05)
    with pytest.raises(DeviceUnreachable, match="no longer"):
        await adapter.get_state(device)


async def test_a_recommissioned_device_is_found_by_its_stable_id(server, make_adapter):
    server.nodes = {5: light()}
    adapter = await make_adapter(server.url)
    device = await _paired(adapter, server.nodes[5])
    device.params["node_id"] = 99  # it was node 99 before being added again
    state = await adapter.get_state(device)
    assert state.params == {"node_id": 5}
    device.params["node_id"] = 5
    assert (await adapter.get_state(device)).params is None  # nothing to persist on ordinary updates


async def test_reconnects_after_the_server_restarts(server, make_adapter):
    server.nodes = {6: plug()}
    adapter = await make_adapter(server.url)
    device = await _paired(adapter, server.nodes[6])
    await server.stop()
    for _ in range(60):
        if not adapter.connected.is_set():
            break
        await asyncio.sleep(0.05)
    with pytest.raises(DeviceUnreachable, match="Matter Server"):
        await adapter.get_state(device)
    await server.start()
    for _ in range(160):
        if adapter.connected.is_set():
            break
        await asyncio.sleep(0.05)
    assert adapter.connected.is_set()
    assert (await adapter.get_state(device)).online


async def test_forget_takes_the_device_off_the_fabric(server, make_adapter):
    server.nodes = {6: plug()}
    adapter = await make_adapter(server.url)
    device = await _paired(adapter, server.nodes[6])
    await adapter.forget(device)
    assert ("remove_node", {"node_id": 6}) in server.calls
