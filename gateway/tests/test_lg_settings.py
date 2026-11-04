"""LG via ReThink: the AC's full settings (ported from Master's server mapping) and LG setup from the phone.

The fixture is the discovery message a real RAC_056905_WW published on the EMS server's ReThink (2026-11-04).
"""

from __future__ import annotations

import json
from dataclasses import replace
from pathlib import Path

import pytest

from cube_gateway.adapters.base import AdapterContext, AdapterError, StoredDevice, UnsupportedCommand
from cube_gateway.adapters.lg_rethink import LgRethinkAdapter
from cube_gateway.models import AuthKind, Category
from tests.conftest import Harness
from tests.fakes import FakeAdapter, info

DEVICE = "7bd22121-1a4f-11e0-a28c-28876113fdac"
BASE = f"rethink/{DEVICE}"
CONFIG = (Path(__file__).parent / "fixtures" / "rethink_RAC_056905_WW.json").read_text()


class EchoMqtt:
    """Publishes like ReThink's broker: commands to non-optimistic settings come back on their state topic."""

    def __init__(self, adapter: LgRethinkAdapter, echo: set[str] | None = None):
        self.adapter = adapter
        self.echo = echo
        self.published: list[tuple[str, str]] = []

    async def publish(self, topic: str, payload: str) -> None:
        self.published.append((topic, payload))
        state = topic[: -len("/set")]
        if self.echo is None or state in self.echo:
            if topic.endswith("climate-power/set"):
                self.adapter.handle_message(f"{BASE}/climate-mode", b"cool" if payload == "ON" else b"off")
            else:
                self.adapter.handle_message(state, payload.encode())


def _adapter(settings, mode: str = "cool", echo: set[str] | None = None) -> tuple[LgRethinkAdapter, EchoMqtt]:
    adapter = LgRethinkAdapter(AdapterContext(replace(settings, rethink_mqtt_url="mqtt://127.0.0.1:9")))
    adapter.connected = True
    mqtt = EchoMqtt(adapter, echo)
    adapter._client = mqtt
    adapter.handle_message(f"homeassistant/device/rethink/{DEVICE}/config", CONFIG.encode())
    values = {
        "rethink/availability": "online",
        f"{BASE}/availability": "online",
        f"{BASE}/climate-mode": mode,
        f"{BASE}/climate-action": "cooling" if mode != "off" else "off",
        f"{BASE}/climate-temperature": "24",
        f"{BASE}/climate-current_temperature": "26",
        f"{BASE}/climate-fan_mode": "very high",
        f"{BASE}/climate-swing_mode": "2",
        f"{BASE}/jet-": "OFF",
        f"{BASE}/jet-available": "online",
        f"{BASE}/jet-attributes": json.dumps({"description": "Jet: strong airflow for 30 minutes.", "requires": "AC on, in Cooling or Heating"}),
        f"{BASE}/energysave-": "OFF",
        f"{BASE}/energysave-available": "offline",
        f"{BASE}/energysave-attributes": json.dumps({"description": "Energy saving.", "requires": "AC on, in Cooling"}),
        f"{BASE}/airclean-": "OFF",
        f"{BASE}/airclean-attributes": json.dumps({"description": "Air purify.", "requires": "nothing, always available"}),
        f"{BASE}/beep-": "ON",
        f"{BASE}/sleeptimer-": "0",
        f"{BASE}/sleeptimer-available": "online",
        f"{BASE}/filterused": "12",
        f"{BASE}/filterchangeddate": "0000-00-00",
        f"{BASE}/autodry-": "OFF",
        f"{BASE}/error-": "0",
    }
    for topic, value in values.items():
        adapter.handle_message(topic, value.encode())
    return adapter, mqtt


STORED = StoredDevice(id="lg", adapter_id="lg_thinq_rethink", brand="lg", unique_id=DEVICE, name="AC", category=Category.CLIMATE)


async def test_settings_from_the_real_discovery(settings):
    adapter, _ = _adapter(settings)
    state = await adapter.get_state(STORED)
    by_key = {s.key: s for s in state.settings}
    mode = by_key["mode"]
    assert mode.kind == "select" and "off" not in mode.options and mode.value == "cool" and mode.requires == "AC on" and mode.available
    temperature = by_key["temperature"]
    assert (temperature.kind, temperature.min, temperature.max, temperature.step, temperature.unit, temperature.value) == ("number", 16, 30, 0.5, "°C", 24.0)
    assert by_key["fan_mode"].options[-1] == "very high"
    assert by_key["jet"].kind == "switch" and by_key["jet"].value is False and by_key["jet"].available
    assert by_key["jet"].requires == "AC on, in Cooling or Heating" and by_key["jet"].description.startswith("Jet")
    energysave = by_key["energysave"]
    assert energysave.available is False and energysave.requires == "AC on, in Cooling"
    assert by_key["airclean"].requires is None  # "nothing, always available"
    assert by_key["sleeptimer"].kind == "number" and by_key["sleeptimer"].max == 15 and by_key["sleeptimer"].unit == "h"
    assert by_key["filterreset"].kind == "button" and by_key["filterreset"].diagnostic
    assert by_key["filterused"].kind == "sensor" and by_key["filterused"].value == 12.0
    assert by_key["autodry"].kind == "sensor" and by_key["autodry"].value is False
    assert by_key["changeddate"].value is None  # ReThink's 0000-00-00: never reset
    assert {"set_setting", "press", "turn_on", "turn_off"} <= set(state.commands)
    adapter.handle_message(f"{BASE}/sleeptimer-available", b"offline")
    assert next(s for s in (await adapter.get_state(STORED)).settings if s.key == "sleeptimer").available is False
    assert state.capabilities[0].state == "cooling"


async def test_climate_settings_need_the_ac_on(settings):
    adapter, _ = _adapter(settings, mode="off")
    by_key = {s.key: s for s in (await adapter.get_state(STORED)).settings}
    assert by_key["mode"].available is False and by_key["temperature"].available is False
    assert by_key["airclean"].available is True  # works in any state
    with pytest.raises(AdapterError) as error:
        await adapter.execute_command(STORED, "set_setting", {"key": "temperature", "value": 22})
    assert error.value.code == "setting_unavailable" and "AC on" in error.value.message


async def test_echoed_setting_is_confirmed(settings):
    adapter, mqtt = _adapter(settings)
    outcome = await adapter.execute_command(STORED, "set_setting", {"key": "temperature", "value": 21.3})
    assert mqtt.published[-1] == (f"{BASE}/climate-temperature/set", "21.5") and outcome.result.status == "confirmed"
    outcome = await adapter.execute_command(STORED, "set_setting", {"key": "beep", "value": False})
    assert mqtt.published[-1] == (f"{BASE}/beep-/set", "OFF") and outcome.result.status == "confirmed"
    assert next(s for s in outcome.state.settings if s.key == "beep").value is False


async def test_optimistic_switch_is_assumed_until_reported(settings):
    adapter, mqtt = _adapter(settings, echo=set())  # the unit applies Air purify at power-up, without echoing now
    outcome = await adapter.execute_command(STORED, "set_setting", {"key": "airclean", "value": True})
    assert mqtt.published[-1] == (f"{BASE}/airclean-/set", "ON") and outcome.result.status == "assumed"
    airclean = next(s for s in outcome.state.settings if s.key == "airclean")
    assert airclean.value is True and airclean.confirmed is False
    adapter.handle_message(f"{BASE}/airclean-", b"ON")
    airclean = next(s for s in (await adapter.get_state(STORED)).settings if s.key == "airclean")
    assert airclean.value is True and airclean.confirmed is True


async def test_buttons_options_and_bad_values(settings):
    adapter, mqtt = _adapter(settings)
    outcome = await adapter.execute_command(STORED, "press", {"key": "filterreset"})
    assert mqtt.published[-1] == (f"{BASE}/filterreset/set", "PRESS") and outcome.result.status == "assumed"
    with pytest.raises(AdapterError, match="no option"):
        await adapter.execute_command(STORED, "set_setting", {"key": "fan_mode", "value": "turbo"})
    with pytest.raises(AdapterError, match="true or false"):
        await adapter.execute_command(STORED, "set_setting", {"key": "jet", "value": "yes"})
    with pytest.raises(UnsupportedCommand):
        await adapter.execute_command(STORED, "set_setting", {"key": "filterused", "value": 0})
    with pytest.raises(UnsupportedCommand):
        await adapter.execute_command(STORED, "set_setting", {"key": "nonexistent", "value": 1})
    timer = await adapter.execute_command(STORED, "set_setting", {"key": "sleeptimer", "value": 99})
    assert mqtt.published[-1] == (f"{BASE}/sleeptimer-/set", "15") and timer.result.status == "confirmed"


async def test_power_uses_the_power_topic(settings):
    adapter, mqtt = _adapter(settings, mode="off")
    outcome = await adapter.execute_command(STORED, "turn_on", {})
    assert mqtt.published[-1] == (f"{BASE}/climate-power/set", "ON") and outcome.result.status == "confirmed"


async def test_offline_appliance_settings_are_unavailable(settings):
    adapter, _ = _adapter(settings)
    adapter.handle_message(f"{BASE}/availability", b"offline")
    state = await adapter.get_state(STORED)
    assert state.online is False and not any(s.available for s in state.settings)


# ---- LG setup from the phone ----------------------------------------------------------------------


class FakeRethink(FakeAdapter):
    """Stands in for the ReThink adapter: appliances appear when ReThink learns of them; none has an IP."""

    def __init__(self, ctx):
        super().__init__(ctx, adapter_info=info("lg_thinq_rethink", "lg", auth=AuthKind.NONE, status="experimental"))

    def device_ids(self) -> list[str]:
        return list(self.devices)

    async def discover(self, scan) -> None:
        from cube_gateway.adapters.base import make_candidate

        for unique_id, fields in self.devices.items():
            scan.report(make_candidate(self, unique_id, sources=["mqtt"], control="experimental", **fields))


def test_lg_phone_setup_matches_only_a_new_appliance(settings):
    configured = replace(settings, rethink_api_server="https://lg.example.com:4443", rethink_mqtt_server="ssl://lg.example.com:8884")
    h = Harness(configured)
    rethink = FakeRethink(h.ctx)
    rethink.devices["already-on-rethink"] = {"name": "Old AC"}
    h.registry.add(rethink)
    with h:
        h.claim()
        session = h.post("/provisioning/sessions", json={"plugin_id": "lg_thinq_softap", "model": "RAC_056905_WW"}).json()["data"]
        assert session["transport"] == "phone" and session["experimental"] is True
        assert session["hotspot"]["password_rule"] == "user" and session["hotspot"]["password"] is None
        assert session["setup"] == {"rethink_api_server": "https://lg.example.com:4443", "rethink_mqtt_server": "ssl://lg.example.com:8884"}
        assert session["expect"]["exclude"] == "already-on-rethink"

        def event(name, **data):
            response = h.post(f"/provisioning/sessions/{session['id']}/events", json={"event": name, "data": data})
            assert response.status_code == 200, response.text
            return response.json()["data"]

        event("pairing_mode_confirmed")
        assert event("device_ap_joined", ssid="LGE_AC2_1234")["state"] == "sending_wifi_config"
        event("wifi_config_sent")
        event("phone_returned")
        # Only after ReThink announces the new appliance does the session finish, with that appliance.
        rethink.devices["new-ac"] = {"name": "LG Air Conditioner", "model": "RAC_056905_WW"}
        done = h.wait(lambda: (s := h.get(f"/provisioning/sessions/{session['id']}").json()["data"])["state"] in {"connected", "pairing_failed"} and s, timeout=20)
        assert done["state"] == "connected", done
        assert h.get(f"/devices/{done['device_id']}").json()["data"]["unique_id"] == "new-ac"


def test_lg_setup_network_name_is_checked(settings):
    h = Harness(settings)
    h.registry.add(FakeRethink(h.ctx))
    with h:
        h.claim()
        session = h.post("/provisioning/sessions", json={"plugin_id": "lg_thinq_softap"}).json()["data"]
        assert session["setup"] == {}  # no ReThink addresses configured: ThinQ2 needs the DNS override then
        failed = h.post(f"/provisioning/sessions/{session['id']}/events", json={"event": "device_ap_joined", "data": {"ssid": "HomeWiFi"}}).json()["data"]
        assert failed["state"] == "pairing_failed" and failed["error"]["code"] == "unsupported_model"
        bracketed = h.post("/provisioning/sessions", json={"plugin_id": "lg_thinq_softap"}).json()["data"]
        ok = h.post(f"/provisioning/sessions/{bracketed['id']}/events", json={"event": "device_ap_joined", "data": {"ssid": "[LG_WM]1A2B"}}).json()["data"]
        assert ok["state"] == "sending_wifi_config"


def test_gateway_variant_still_needs_a_radio(settings):
    h = Harness(settings)
    h.registry.add(FakeRethink(h.ctx))
    with h:
        h.claim()
        response = h.post("/provisioning/sessions", json={"plugin_id": "lg_thinq_softap_gateway"})
        assert response.status_code == 422 and response.json()["error"]["code"] == "gateway_wifi_unavailable"
