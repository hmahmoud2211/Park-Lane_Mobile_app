"""NoLongerEvil adapter against a mock of the self-hosted server's control API."""

import json
from dataclasses import replace

import httpx
import pytest

from cube_gateway.adapters.base import AdapterContext, AdapterError, AuthRequired, DeviceUnreachable, ScanContext, StoredDevice, UnsupportedCommand
from cube_gateway.adapters.nolongerevil import NoLongerEvilAdapter
from cube_gateway.models import Category, SupportLevel

URL = "http://nle.test:8082"
SERIAL = "02AB01AC012345678"


def thermostat(**changes):
    status = {
        "serial": SERIAL,
        "api_key": "not-for-storing",
        "is_available": True,
        "last_seen": "2026-04-01T12:00:00",
        "name": "Living Room",
        "current_temperature": 20.5,
        "target_temperature": 21.0,
        "target_temperature_high": None,
        "target_temperature_low": None,
        "humidity": 45,
        "mode": "heat",
        "hvac": {"heater": True, "ac": False, "fan": False},
        "fan_timer_active": False,
        "software_version": "5.9.3-5",
        "capabilities": {"can_heat": True, "can_cool": True, "has_fan": True, "has_emer_heat": False},
        "eco_mode": "schedule",
        "schedule_mode": "HEAT",
    }
    return {**status, **changes}


class FakeServer:
    def __init__(self):
        self.status = thermostat()
        self.commands = []
        self.down = False
        self.reply = None
        self.refuse = None

    def handler(self, request: httpx.Request) -> httpx.Response:
        if self.down:
            raise httpx.ConnectError("unreachable", request=request)
        if self.reply:
            return self.reply
        path = request.url.path
        if path == "/api/devices":
            return httpx.Response(200, json={"devices": [{**self.status, "subscription_count": 1}], "total": 1})
        if path == "/status":
            if request.url.params.get("serial") != SERIAL:
                return httpx.Response(404, json={"error": "Device not found"})
            return httpx.Response(200, json=self.status)
        if path == "/command" and request.method == "POST":
            body = json.loads(request.content)
            self.commands.append(body)
            if self.refuse:
                return httpx.Response(400, json={"success": False, "message": self.refuse})
            command, value = body["command"], body["value"]
            if command == "set_mode":
                self.status["mode"] = {"heat-cool": "range"}.get(value, value)
            elif command == "set_temperature" and isinstance(value, dict):
                self.status["target_temperature_high"], self.status["target_temperature_low"] = value["high"], value["low"]
            elif command == "set_temperature":
                self.status["target_temperature"] = value
            elif command == "set_fan":
                self.status["fan_timer_active"] = value == "on"
            return httpx.Response(200, json={"success": True, "data": {"object_key": f"shared.{SERIAL}", "values": {}}})
        return httpx.Response(404, text="not here")


@pytest.fixture
def fake():
    return FakeServer()


@pytest.fixture
def adapter(settings, fake):
    ctx = AdapterContext(replace(settings, nle_url=URL), http=httpx.AsyncClient(transport=httpx.MockTransport(fake.handler)))
    return NoLongerEvilAdapter(ctx)


def stored(**params):
    return StoredDevice(id="d1", adapter_id="nolongerevil", brand="nest", unique_id=SERIAL, name="Living Room", category=Category.CLIMATE, protocol="nle-control-http", params=params)


async def found_by(adapter):
    found = []
    await adapter.discover(ScanContext(timeout=1, subnets=[], report=found.append))
    return found


def test_metadata_is_honest():
    info = NoLongerEvilAdapter.info
    assert info.id == "nolongerevil" and info.brands == ["nest"] and info.categories == [Category.CLIMATE]
    assert info.status == SupportLevel.EXPERIMENTAL and info.verified_models == []
    assert info.account_free is True and info.library is None


def test_notes_warn_that_the_control_api_must_stay_private():
    notes = " ".join(NoLongerEvilAdapter.info.notes)
    assert "no authentication" in notes and "never expose" in notes


async def test_idle_without_a_url(settings, fake):
    ctx = AdapterContext(settings, http=httpx.AsyncClient(transport=httpx.MockTransport(fake.handler)))
    adapter = NoLongerEvilAdapter(ctx)
    ok, reason = adapter.available()
    assert ok is False and "CUBE_NLE_URL" in reason
    assert await found_by(adapter) == []
    with pytest.raises(DeviceUnreachable, match="CUBE_NLE_URL"):
        await adapter.get_state(stored())


def test_available_with_a_url(adapter):
    assert adapter.available() == (True, None)


async def test_discovery_lists_what_the_server_knows(adapter):
    candidate = (await found_by(adapter))[0]
    assert candidate.adapter_id == "nolongerevil" and candidate.brand == "nest" and candidate.unique_id == SERIAL
    assert candidate.name == "Living Room" and candidate.model == "Nest Learning Thermostat"
    assert candidate.control == "experimental" and candidate.status == "experimental"
    assert candidate.details == {"online": True, "software_version": "5.9.3-5"}


async def test_discovery_never_keeps_the_api_key_and_sanitizes_names(adapter, fake):
    fake.status["name"] = "Hall\x1b[31m"
    candidate = (await found_by(adapter))[0]
    assert "\x1b" not in candidate.name
    assert "not-for-storing" not in candidate.model_dump_json()


async def test_discovery_skips_entries_without_a_serial(adapter, fake):
    fake.reply = httpx.Response(200, json={"devices": [{"name": "broken"}, "junk", {"serial": SERIAL, "is_available": False}]})
    found = await found_by(adapter)
    assert [c.unique_id for c in found] == [SERIAL]
    assert found[0].name == "Nest thermostat" and found[0].details["online"] is False


async def test_discovery_explains_a_wrong_port(adapter, fake):
    fake.reply = httpx.Response(404, text="device protocol port")
    with pytest.raises(DeviceUnreachable, match="port 8082"):
        await found_by(adapter)


async def test_discovery_with_the_server_down(adapter, fake):
    fake.down = True
    with pytest.raises(DeviceUnreachable, match="did not answer"):
        await found_by(adapter)


async def test_pair_proves_control_by_reading_state(adapter):
    candidate = (await found_by(adapter))[0]
    result = await adapter.pair(candidate, {}, approval=None)
    assert (result.unique_id, result.name, result.category) == (SERIAL, "Living Room", Category.CLIMATE)
    assert result.protocol == "nle-control-http" and result.credentials == {}
    assert result.params == {"software_version": "5.9.3-5"}


async def test_pair_refuses_a_thermostat_the_server_has_not_heard_from(adapter, fake):
    candidate = (await found_by(adapter))[0]
    fake.status["is_available"] = False
    with pytest.raises(DeviceUnreachable, match="not heard"):
        await adapter.pair(candidate, {}, approval=None)


async def test_pair_refuses_a_thermostat_with_no_state_yet(adapter, fake):
    candidate = (await found_by(adapter))[0]
    fake.status["mode"] = None
    with pytest.raises(AdapterError) as error:
        await adapter.pair(candidate, {}, approval=None)
    assert error.value.code == "not_ready"


async def test_pair_refuses_a_serial_the_server_no_longer_lists(adapter):
    candidate = (await found_by(adapter))[0].model_copy(update={"unique_id": "GONE"})
    with pytest.raises(DeviceUnreachable, match="does not list"):
        await adapter.pair(candidate, {}, approval=None)


async def test_state_in_heat(adapter):
    state = await adapter.get_state(stored())
    climate = state.capabilities[0]
    assert (climate.mode, climate.target, climate.current, climate.state) == ("heat", 21.0, 20.5, "heating")
    assert climate.modes == ["off", "heat", "cool", "heat_cool"] and (climate.fan_mode, climate.fan_modes) == ("auto", ["auto", "on"])
    assert (climate.min, climate.max, climate.step, climate.unit) == (4.5, 32.0, 0.5, "°C")
    assert [r.key for r in state.readings] == ["current_humidity"] and state.readings[0].value == 45
    assert state.online is True and climate.confirmed is True
    assert {"set_temperature", "set_hvac_mode", "set_fan_mode", "turn_on", "turn_off", "set_setting"} <= set(state.commands)
    assert state.settings[0].key == "eco" and state.settings[0].value is False


async def test_state_in_range_shows_the_midpoint_and_both_setpoints(adapter, fake):
    fake.status.update(mode="range", target_temperature=None, target_temperature_low=19.0, target_temperature_high=24.0)
    state = await adapter.get_state(stored())
    assert state.capabilities[0].mode == "heat_cool" and state.capabilities[0].target == 21.5
    assert {r.key: r.value for r in state.readings} == {"current_humidity": 45, "target_low": 19.0, "target_high": 24.0}


@pytest.mark.parametrize(
    ("hvac", "mode", "action"),
    [
        ({"ac": True}, "cool", "cooling"),
        ({"cool_x2": True}, "cool", "cooling"),
        ({"aux_heat": True}, "heat", "heating"),
        ({"fan": True}, "cool", "fan"),
        ({}, "heat", "idle"),
        ({"heater": True}, "off", "off"),
    ],
)
async def test_what_the_system_is_doing_now(adapter, fake, hvac, mode, action):
    fake.status.update(hvac=hvac, mode=mode)
    assert (await adapter.get_state(stored())).capabilities[0].state == action


async def test_modes_follow_the_wiring(adapter, fake):
    fake.status["capabilities"] = {"can_heat": True, "can_cool": False, "has_fan": False, "has_emer_heat": True}
    climate = (await adapter.get_state(stored())).capabilities[0]
    assert climate.modes == ["off", "heat", "emergency_heat"] and climate.fan_modes == [] and climate.fan_mode is None


@pytest.mark.parametrize(("eco_mode", "value"), [("manual-eco", True), ("auto-eco", True), ("schedule", False), (None, None)])
async def test_eco_state(adapter, fake, eco_mode, value):
    fake.status["eco_mode"] = eco_mode
    assert (await adapter.get_state(stored())).settings[0].value == value


async def test_bad_values_from_the_server_stay_empty(adapter, fake):
    # Sent as text: Python's parser accepts a bare NaN, and the server's JSON is not guaranteed to be strict.
    fake.reply = httpx.Response(200, text='{"is_available": true, "current_temperature": true, "target_temperature": "hot", "humidity": NaN, "mode": "party", "hvac": "junk", "capabilities": "junk"}')
    state = await adapter.get_state(stored())
    climate = state.capabilities[0]
    assert (climate.current, climate.target, climate.mode) == (None, None, None) and state.readings == []


async def test_a_thermostat_gone_quiet_shows_offline(adapter, fake):
    fake.status["is_available"] = False
    state = await adapter.get_state(stored())
    assert state.online is False and state.capabilities[0].confirmed is False


async def test_the_last_running_mode_is_saved_only_when_it_changes(adapter, fake):
    assert (await adapter.get_state(stored())).params == {"last_mode": "heat"}
    assert (await adapter.get_state(stored(last_mode="heat"))).params is None
    fake.status["mode"] = "off"
    assert (await adapter.get_state(stored(last_mode="heat"))).params is None


async def test_emergency_heat_is_not_remembered(adapter, fake):
    fake.status["mode"] = "emergency"
    assert (await adapter.get_state(stored(last_mode="heat"))).params is None


@pytest.mark.parametrize(
    ("command", "params", "sent"),
    [
        ("turn_off", {}, ("set_mode", "off")),
        ("set_hvac_mode", {"mode": "off"}, ("set_mode", "off")),
        ("set_hvac_mode", {"mode": "cool"}, ("set_mode", "cool")),
        ("set_hvac_mode", {"mode": "heat_cool"}, ("set_mode", "heat-cool")),
        ("set_temperature", {"temperature": 21.5}, ("set_temperature", 21.5)),
        ("set_temperature", {"temperature": 2}, ("set_temperature", 4.5)),
        ("set_temperature", {"temperature": 50}, ("set_temperature", 32.0)),
        ("set_fan_mode", {"fan_mode": "on"}, ("set_fan", "on")),
        ("set_fan_mode", {"fan_mode": "auto"}, ("set_fan", "auto")),
        ("set_setting", {"key": "eco", "value": True}, ("set_away", True)),
        ("set_setting", {"key": "eco", "value": False}, ("set_away", False)),
    ],
)
async def test_commands_use_the_documented_names(adapter, fake, command, params, sent):
    await adapter.execute_command(stored(), command, params)
    assert fake.commands == [{"serial": SERIAL, "command": sent[0], "value": sent[1]}]


async def test_a_change_is_pending_because_the_server_only_stored_it(adapter):
    outcome = await adapter.execute_command(stored(), "set_temperature", {"temperature": 22})
    assert outcome.result.status == "pending" and "next connects" in outcome.result.message
    assert outcome.state.capabilities[0].target == 22 and outcome.state.capabilities[0].confirmed is False
    assert outcome.state.settings[0].confirmed is False


async def test_set_temperature_in_range_moves_both_setpoints(adapter, fake):
    fake.status.update(mode="range", target_temperature_low=19.0, target_temperature_high=24.0)
    outcome = await adapter.execute_command(stored(), "set_temperature", {"temperature": 22.5})
    assert fake.commands[-1]["value"] == {"high": 25.0, "low": 20.0}
    assert outcome.state.capabilities[0].target == 22.5


@pytest.mark.parametrize(("wanted", "low", "high"), [(1, 4.5, 9.5), (40, 27.0, 32.0)])
async def test_set_temperature_in_range_keeps_the_gap_at_the_limits(adapter, fake, wanted, low, high):
    fake.status.update(mode="range", target_temperature_low=19.0, target_temperature_high=24.0)
    await adapter.execute_command(stored(), "set_temperature", {"temperature": wanted})
    assert fake.commands[-1]["value"] == {"high": high, "low": low}


async def test_set_temperature_in_range_waits_for_the_setpoints(adapter, fake):
    fake.status.update(mode="range", target_temperature_low=None, target_temperature_high=None)
    with pytest.raises(AdapterError) as error:
        await adapter.execute_command(stored(), "set_temperature", {"temperature": 22})
    assert error.value.code == "not_ready" and fake.commands == []


async def test_set_temperature_while_off_is_refused(adapter, fake):
    fake.status["mode"] = "off"
    with pytest.raises(AdapterError, match="off"):
        await adapter.execute_command(stored(), "set_temperature", {"temperature": 22})
    assert fake.commands == []


async def test_turn_on_restores_the_last_mode(adapter, fake):
    fake.status["mode"] = "off"
    await adapter.execute_command(stored(last_mode="cool"), "turn_on", {})
    assert fake.commands[-1]["value"] == "cool"


async def test_turn_on_uses_the_schedule_when_no_mode_is_remembered(adapter, fake):
    fake.status.update(mode="off", schedule_mode="RANGE")
    await adapter.execute_command(stored(), "turn_on", {})
    assert fake.commands[-1]["value"] == "heat-cool"


async def test_turn_on_falls_back_to_what_the_wiring_allows(adapter, fake):
    fake.status.update(mode="off", schedule_mode=None, capabilities={"can_heat": False, "can_cool": True})
    await adapter.execute_command(stored(last_mode="heat"), "turn_on", {})
    assert fake.commands[-1]["value"] == "cool"


async def test_turn_on_never_starts_emergency_heat(adapter, fake):
    fake.status.update(mode="off", schedule_mode=None, capabilities={"can_heat": False, "can_cool": False, "has_emer_heat": True})
    with pytest.raises(AdapterError, match="not wired"):
        await adapter.execute_command(stored(), "turn_on", {})
    assert fake.commands == []


async def test_requests_it_cannot_honour_are_refused_before_reaching_the_server(adapter, fake):
    fake.status["capabilities"] = {"can_heat": True, "can_cool": False, "has_fan": False}
    with pytest.raises(AdapterError, match="not offered"):
        await adapter.execute_command(stored(), "set_hvac_mode", {"mode": "cool"})
    with pytest.raises(AdapterError, match="not offered"):
        await adapter.execute_command(stored(), "set_fan_mode", {"fan_mode": "on"})
    with pytest.raises(AdapterError, match="true or false"):
        await adapter.execute_command(stored(), "set_setting", {"key": "eco", "value": "yes"})
    with pytest.raises(UnsupportedCommand):
        await adapter.execute_command(stored(), "set_setting", {"key": "learning", "value": True})
    with pytest.raises(UnsupportedCommand):
        await adapter.execute_command(stored(), "set_volume", {})
    assert fake.commands == []


async def test_a_refusal_gives_the_server_s_reason_sanitized(adapter, fake):
    fake.refuse = "Device does not\x07 support heating"
    with pytest.raises(AdapterError) as error:
        await adapter.execute_command(stored(), "set_hvac_mode", {"mode": "heat"})
    assert error.value.code == "device_rejected" and error.value.message == "Device does not support heating"


async def test_a_failure_reported_with_status_200_is_still_a_failure(adapter, fake):
    fake.reply = httpx.Response(200, json={"success": False, "message": "Unknown command: set_foo"})
    with pytest.raises(AdapterError, match="Unknown command"):
        await adapter.get_state(stored())


async def test_a_server_error_without_a_reason(adapter, fake):
    fake.reply = httpx.Response(500, json={})
    with pytest.raises(AdapterError, match="answered 500"):
        await adapter.get_state(stored())


async def test_something_else_at_that_address(adapter, fake):
    fake.reply = httpx.Response(200, text="<html>not the control api</html>")
    with pytest.raises(AdapterError) as error:
        await adapter.get_state(stored())
    assert error.value.code == "nle_bad_reply"


@pytest.mark.parametrize("code", [401, 403])
async def test_a_login_in_front_of_the_server(adapter, fake, code):
    fake.reply = httpx.Response(code, text="login")
    with pytest.raises(AuthRequired):
        await adapter.get_state(stored())


async def test_unreachable(adapter, fake):
    fake.down = True
    with pytest.raises(DeviceUnreachable, match="did not answer"):
        await adapter.get_state(stored())
