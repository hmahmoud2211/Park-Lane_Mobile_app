"""The SoftAP provisioning state machine, password rules, device matching, recovery and expiry."""

from __future__ import annotations

from cube_gateway.models import AuthKind
from cube_gateway.provisioning import engine as provisioning_engine
from cube_gateway.provisioning.plugins import PLUGINS, PLUGINS_BY_ID
from tests.conftest import Harness
from tests.fakes import FakeAdapter, info


def _with_adapter(settings, adapter_id: str, brand: str, auth: AuthKind = AuthKind.NONE) -> tuple[Harness, FakeAdapter]:
    h = Harness(settings)
    adapter = FakeAdapter(h.ctx, adapter_info=info(adapter_id, brand, auth=auth))
    h.registry.add(adapter)
    return h, adapter


def _event(h: Harness, session_id: str, event: str, **data):
    response = h.post(f"/provisioning/sessions/{session_id}/events", json={"event": event, "data": data})
    assert response.status_code == 200, response.text
    return response.json()["data"]


def test_password_rules_only_fill_verified_models():
    sonoff = PLUGINS_BY_ID["sonoff_diy_softap"].hotspot
    assert sonoff.resolve("MINI").password_rule == "verified_rule" and sonoff.resolve("MINI").password == "12345678"
    assert sonoff.resolve("S26R2TPF").password == "12345678"
    other = sonoff.resolve("POWR320D")
    assert other.password_rule == "user" and other.password is None
    assert sonoff.resolve(None).password is None
    assert PLUGINS_BY_ID["wled_softap"].hotspot.resolve(None).password == "wled1234"
    assert PLUGINS_BY_ID["shelly_softap"].hotspot.resolve("anything").password_rule == "none"
    lg = PLUGINS_BY_ID["lg_thinq_softap"].hotspot.resolve("RAC_056905_WW")
    assert lg.password_rule == "user" and lg.password is None


def test_every_plugin_declares_what_it_needs():
    for plugin in PLUGINS:
        assert plugin.transport in {"phone", "guided", "gateway"}
        assert plugin.steps, plugin.id
        assert plugin.sources, plugin.id
        if plugin.hotspot.kind == "fixed":
            assert plugin.hotspot.verified_models and plugin.hotspot.source, plugin.id


def test_sonoff_experimental_model_is_flagged():
    plugin = PLUGINS_BY_ID["sonoff_diy_softap"]
    assert plugin.is_experimental("S26R2TPF") and plugin.is_experimental("other")
    assert not plugin.is_experimental("BASICR3")


def test_shelly_softap_happy_path(settings):
    h, shelly = _with_adapter(settings, "shelly", "shelly")
    with h:
        h.claim()
        session = h.post("/provisioning/sessions", json={"plugin_id": "shelly_softap"}).json()["data"]
        assert session["state"] == "pairing_mode_required" and session["transport"] == "phone"
        assert session["hotspot"]["password_rule"] == "none" and session["hotspot"]["device_ip"] == "192.168.33.1"
        _event(h, session["id"], "pairing_mode_confirmed")
        joined = _event(h, session["id"], "device_ap_joined", ssid="shellyplus1-A8032AB1C2D3")
        assert joined["expect"] == {"mac_suffix": "a8032ab1c2d3"} and joined["state"] == "sending_wifi_config"
        _event(h, session["id"], "wifi_config_sent")
        # Another Shelly is already on the network: it must not be taken for the new one.
        shelly.devices["other"] = {"name": "Old", "ip": "192.168.50.30", "mac": "11:22:33:44:55:66"}
        shelly.devices["a8032ab1c2d3"] = {"name": "New Shelly", "ip": "192.168.50.31", "mac": "a8:03:2a:b1:c2:d3"}
        _event(h, session["id"], "phone_returned")
        done = h.wait(lambda: (s := h.get(f"/provisioning/sessions/{session['id']}").json()["data"])["state"] in {"connected", "pairing_failed"} and s, timeout=15)
        assert done["state"] == "connected", done
        device = h.get(f"/devices/{done['device_id']}").json()["data"]
        assert device["unique_id"] == "a8032ab1c2d3" and device["connection"]["status"] == "connected"
        states = [entry["state"] for entry in done["history"]]
        assert states == ["pairing_mode_required", "connecting_device_ap", "sending_wifi_config", "connecting_home_network", "waiting_for_device", "connected"]


def test_sonoff_device_key_from_setup_network_is_used(settings):
    h, sonoff = _with_adapter(settings, "sonoff_lan", "sonoff")
    sonoff.key_field = "device_key"
    sonoff.required_key = "aaaabbbb-cccc-dddd-eeee-ffff00001111"
    with h:
        h.claim()
        session = h.post("/provisioning/sessions", json={"plugin_id": "sonoff_diy_softap", "model": "S26R2TPF"}).json()["data"]
        assert session["experimental"] is True and session["hotspot"]["password"] == "12345678"
        _event(h, session["id"], "device_ap_joined", ssid="ITEAD-1000abcdef")
        info_session = _event(h, session["id"], "device_info", deviceid="1000ABCDEF", apikey="aaaabbbb-cccc-dddd-eeee-ffff00001111")
        assert info_session["expect"]["deviceid"] == "1000abcdef"
        assert "apikey" not in str(info_session) and "aaaabbbb" not in str(info_session)
        _event(h, session["id"], "wifi_config_sent")
        sonoff.devices["1000abcdef"] = {"name": "SONOFF", "ip": "192.168.50.40"}
        _event(h, session["id"], "phone_returned")
        done = h.wait(lambda: (s := h.get(f"/provisioning/sessions/{session['id']}").json()["data"])["state"] in {"connected", "pairing_failed", "local_authorization_required"} and s, timeout=15)
        assert done["state"] == "connected", done
        assert h.get(f"/devices/{done['device_id']}").json()["data"]["experimental"] is True


def test_wrong_network_name_fails_with_recovery(settings):
    h, _ = _with_adapter(settings, "shelly", "shelly")
    with h:
        h.claim()
        session = h.post("/provisioning/sessions", json={"plugin_id": "shelly_softap"}).json()["data"]
        failed = _event(h, session["id"], "device_ap_joined", ssid="HomeWiFi-5G")
        assert failed["state"] == "pairing_failed" and failed["error"]["code"] == "unsupported_model"
        assert failed["error"]["recovery"]
        assert h.post(f"/provisioning/sessions/{session['id']}/events", json={"event": "phone_returned"}).status_code == 409


def test_phone_reported_failures_map_to_recovery(settings):
    h, _ = _with_adapter(settings, "shelly", "shelly")
    with h:
        h.claim()
        for code in ["hotspot_password_wrong", "wifi_rejected", "permission_denied", "device_not_reachable_on_ap"]:
            session = h.post("/provisioning/sessions", json={"plugin_id": "shelly_softap"}).json()["data"]
            failed = _event(h, session["id"], "failed", code=code)
            assert failed["state"] == "pairing_failed" and failed["error"]["code"] == code
            assert failed["error"]["message"] and failed["error"]["recovery"]


def test_device_not_found_after_joining(settings, monkeypatch):
    monkeypatch.setattr(provisioning_engine, "WAIT_WINDOW", 2.0)
    h, _ = _with_adapter(settings, "shelly", "shelly")
    with h:
        h.claim()
        session = h.post("/provisioning/sessions", json={"plugin_id": "shelly_softap"}).json()["data"]
        _event(h, session["id"], "device_ap_joined", ssid="shelly1-ABCDEF")
        _event(h, session["id"], "wifi_config_sent")
        _event(h, session["id"], "phone_returned")
        done = h.wait(lambda: (s := h.get(f"/provisioning/sessions/{session['id']}").json()["data"])["state"] == "pairing_failed" and s, timeout=20)
        assert done["error"]["code"] == "device_not_found"
        assert "isolat" in done["error"]["recovery"]


def test_backwards_steps_are_refused(settings):
    h, _ = _with_adapter(settings, "shelly", "shelly")
    with h:
        h.claim()
        session = h.post("/provisioning/sessions", json={"plugin_id": "shelly_softap"}).json()["data"]
        _event(h, session["id"], "device_ap_joined", ssid="shelly1-ABCDEF")
        _event(h, session["id"], "wifi_config_sent")
        response = h.post(f"/provisioning/sessions/{session['id']}/events", json={"event": "device_ap_joined", "data": {"ssid": "shelly1-ABCDEF"}})
        assert response.status_code == 409


def test_gateway_transport_needs_a_radio(settings):
    h, _ = _with_adapter(settings, "tplink", "tplink")
    with h:
        h.claim()
        response = h.post("/provisioning/sessions", json={"plugin_id": "kasa_softap"})
        assert response.status_code == 422 and response.json()["error"]["code"] == "gateway_wifi_unavailable"


def test_gateway_transport_runs_and_waits(settings, monkeypatch):
    from dataclasses import replace

    calls = {}

    async def runner(plugin, session, hotspot_ssid, hotspot_password, home_ssid, home_password, progress):
        calls.update(plugin=plugin.id, hotspot=hotspot_ssid, home=home_ssid, password=home_password)
        await progress(provisioning_engine.S.SENDING_WIFI_CONFIG)
        await progress(provisioning_engine.S.CONNECTING_HOME_NETWORK)

    radio = replace(settings, softap_interface="wlan9")
    h, kasa = _with_adapter(radio, "tplink", "tplink")
    h.gateway.provisioning.gateway_runner = runner
    with h:
        h.claim()
        session = h.post("/provisioning/sessions", json={"plugin_id": "kasa_softap"}).json()["data"]
        kasa.devices["kasa1"] = {"name": "Kasa plug", "ip": "192.168.50.60"}
        bad = h.post(f"/provisioning/sessions/{session['id']}/run", json={"home_ssid": "Home", "home_password": "pw", "hotspot_ssid": "NotKasa"})
        assert bad.status_code == 400
        h.post(f"/provisioning/sessions/{session['id']}/run", json={"home_ssid": "Home", "home_password": "s3cret-pw", "hotspot_ssid": "TP-LINK_Smart Plug_1A2B"})
        done = h.wait(lambda: (s := h.get(f"/provisioning/sessions/{session['id']}").json()["data"])["state"] in {"connected", "pairing_failed"} and s, timeout=15)
        assert done["state"] == "connected" and calls["hotspot"] == "TP-LINK_Smart Plug_1A2B"
        assert "s3cret-pw" not in str(done)


def test_unfinished_sessions_after_restart(settings):
    h, _ = _with_adapter(settings, "shelly", "shelly")
    with h:
        token = h.claim()["token"]
        session = h.post("/provisioning/sessions", json={"plugin_id": "shelly_softap"}).json()["data"]
        _event(h, session["id"], "device_ap_joined", ssid="shelly1-ABCDEF")
    h2, _ = _with_adapter(settings, "shelly", "shelly")
    with h2:
        restored = h2.get(f"/provisioning/sessions/{session['id']}", headers=h2.headers(token)).json()["data"]
        assert restored["state"] == "pairing_failed" and restored["error"]["code"] == "gateway_restarted"


def test_sessions_expire(settings):
    h, _ = _with_adapter(settings, "shelly", "shelly")
    with h:
        h.claim()
        session = h.post("/provisioning/sessions", json={"plugin_id": "shelly_softap"}).json()["data"]
        live = h.gateway.provisioning.sessions[session["id"]]
        live.expires_at = 0
        done = h.wait(lambda: (s := h.get(f"/provisioning/sessions/{session['id']}").json()["data"])["state"] == "pairing_failed" and s, timeout=15)
        assert done["error"]["code"] == "session_expired"


def test_cancel(settings):
    h, _ = _with_adapter(settings, "shelly", "shelly")
    with h:
        h.claim()
        session = h.post("/provisioning/sessions", json={"plugin_id": "shelly_softap"}).json()["data"]
        cancelled = h.delete(f"/provisioning/sessions/{session['id']}").json()["data"]
        assert cancelled["state"] == "pairing_failed" and cancelled["error"]["code"] == "cancelled"
