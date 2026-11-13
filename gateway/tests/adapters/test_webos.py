"""LG webOS adapter with aiowebostv's client replaced by a fake TV."""

import ipaddress
from types import SimpleNamespace

import httpx
import pytest
from aiowebostv import WebOsTvPairError

from cube_gateway.adapters import webos
from cube_gateway.adapters.base import (
    AdapterContext,
    AdapterError,
    DeviceUnreachable,
    PairingRejected,
    ScanContext,
    SsdpRecord,
    StoredDevice,
    UnsupportedCommand,
)
from cube_gateway.config import load_settings
from cube_gateway.models import Category


class FakeTv:
    mode = "accept"  # accept | reject | timeout
    instances: list = []

    def __init__(self, host, client_key=None):
        self.host, self.client_key = host, client_key
        self.connected = False
        self.tv_state = SimpleNamespace(
            is_on=True,
            volume=12,
            muted=False,
            current_app_id="com.webos.app.hdmi1",
            inputs={"HDMI_1": {"id": "HDMI_1", "label": "HDMI 1", "appId": "com.webos.app.hdmi1"}},
            apps={"netflix": {"id": "netflix", "title": "Netflix"}},
        )
        self.tv_info = SimpleNamespace(connection={"wiredInfo": {"macAddress": "A8:23:FE:01:02:03"}}, system={"modelName": "OLED55C1"})
        self.calls = []
        FakeTv.instances.append(self)

    async def connect(self):
        if self.mode == "reject":
            raise WebOsTvPairError("rejected")
        if self.mode == "timeout" and not self.client_key:
            raise TimeoutError
        self.client_key = self.client_key or "granted-key"
        self.connected = True
        return True

    def is_connected(self):
        return self.connected

    async def disconnect(self):
        self.connected = False

    async def set_volume(self, volume):
        self.tv_state.volume = volume

    async def set_mute(self, muted):
        self.tv_state.muted = muted

    async def launch_app(self, app):
        self.calls.append(("launch", app))
        self.tv_state.current_app_id = app

    async def set_input(self, input_id):
        self.calls.append(("input", input_id))

    async def channel_up(self):
        self.calls.append(("channel_up",))

    async def power_off(self):
        self.calls.append(("power_off",))

    async def button(self, name):
        self.calls.append(("button", name))


@pytest.fixture
def ctx(tmp_path, monkeypatch):
    monkeypatch.setenv("CUBE_DATA_DIR", str(tmp_path))
    description = "<root><device><friendlyName>Living room TV</friendlyName><modelName>OLED55C1</modelName></device></root>"
    http = httpx.AsyncClient(transport=httpx.MockTransport(lambda request: httpx.Response(200, text=description)))
    return AdapterContext(load_settings(), http=http)


@pytest.fixture
def adapter(ctx, monkeypatch):
    FakeTv.mode, FakeTv.instances = "accept", []
    adapter = webos.WebOsAdapter(ctx)
    adapter.client_factory = FakeTv
    monkeypatch.setattr(webos, "_reachable", lambda host, *a, **k: _ret(True))
    return adapter


def stored(mac="a8:23:fe:01:02:03"):
    return StoredDevice(
        id="d1",
        adapter_id="lg_webos",
        brand="lg",
        unique_id="uuid-1",
        name="TV",
        category=Category.TV,
        host="192.168.1.40",
        mac=mac,
        credentials={"client_key": "granted-key"},
    )


async def test_ssdp_discovery_reads_the_description(adapter):
    found = []
    scan = ScanContext(timeout=1, subnets=[ipaddress.ip_network("192.168.1.0/24")], report=found.append)
    scan.ssdp = [
        SsdpRecord(
            ip="192.168.1.40",
            st=webos.SERVICE,
            usn=f"uuid:1234abcd-0000-1111-2222-333344445555::{webos.SERVICE}",
            location="http://192.168.1.40:1036/",
            server="WebOS/4.1.0 UPnP/1.0",
            headers={},
        ),
        SsdpRecord(ip="192.168.1.41", st="upnp:rootdevice", usn="uuid:other", location=None, server="Linux UPnP/1.0 Sonos", headers={}),
    ]
    scan.passive_done.set()
    await adapter.discover(scan)
    assert len(found) == 1
    candidate = found[0]
    assert candidate.unique_id == "1234abcd-0000-1111-2222-333344445555"
    assert (candidate.name, candidate.model) == ("Living room TV", "OLED55C1")
    assert candidate.pairing.auth == "approve_on_device" and candidate.pairing.approval_timeout == 60


async def test_pairing_asks_for_approval_and_stores_the_key(adapter):
    prompts = []

    async def approval(message):
        prompts.append(message)

    candidate = await adapter._candidate("192.168.1.40", "uuid-1", None, "ssdp")
    result = await adapter.pair(candidate, {}, approval)
    assert prompts and "Accept" in prompts[0]
    assert result.credentials == {"client_key": "granted-key"}
    assert result.mac == "a8:23:fe:01:02:03" and result.model == "OLED55C1"


async def test_pairing_rejected_or_ignored(adapter):
    candidate = await adapter._candidate("192.168.1.40", "uuid-1", None, "ssdp")
    FakeTv.mode = "reject"
    with pytest.raises(PairingRejected):
        await adapter.pair(candidate, {}, lambda m: _ret(None))
    FakeTv.mode = "timeout"
    with pytest.raises(PairingRejected) as error:
        await adapter.pair(candidate, {}, lambda m: _ret(None))
    assert error.value.code == "approval_timeout"


async def test_unreachable_tv_is_off_not_confirmed(adapter, monkeypatch):
    monkeypatch.setattr(webos, "_reachable", lambda host, *a, **k: _ret(False))
    state = await adapter.get_state(stored())
    power = state.capabilities[0]
    assert power.value == "off" and power.confirmed is False
    with pytest.raises(DeviceUnreachable):
        await adapter.execute_command(stored(), "set_volume", {"volume": 5})


async def test_state_and_media_commands(adapter):
    state = await adapter.get_state(stored())
    media = next(c for c in state.capabilities if c.type == "media")
    assert media.volume == 12 and media.source == "HDMI 1" and media.sources == ["HDMI 1", "Netflix"]
    outcome = await adapter.execute_command(stored(), "set_volume", {"volume": 30})
    assert outcome.result.status == "confirmed"
    assert next(c for c in outcome.state.capabilities if c.type == "media").volume == 30
    outcome = await adapter.execute_command(stored(), "set_source", {"source": "Netflix"})
    assert outcome.result.status == "confirmed" and FakeTv.instances[-1].calls[-1] == ("launch", "netflix")
    outcome = await adapter.execute_command(stored(), "media_next", {})
    assert outcome.result.status == "assumed"
    outcome = await adapter.execute_command(stored(), "turn_off", {})
    assert outcome.result.status == "assumed" and outcome.state.capabilities[0].confirmed is False


async def test_remote_keys_while_the_tv_is_on(adapter):
    state = await adapter.get_state(stored())
    assert "press" in state.commands
    keys = {setting.key: setting for setting in state.settings}
    assert {"up", "down", "left", "right", "ok", "back", "home", "channel_up", "channel_down"} <= keys.keys()
    assert all(setting.kind == "button" for setting in state.settings) and keys["ok"].name == "OK"

    outcome = await adapter.execute_command(stored(), "press", {"key": "ok"})
    assert outcome.result.status == "assumed" and FakeTv.instances[-1].calls[-1] == ("button", "ENTER")
    await adapter.execute_command(stored(), "press", {"key": "channel_down"})
    assert FakeTv.instances[-1].calls[-1] == ("button", "CHANNELDOWN")
    with pytest.raises(AdapterError):
        await adapter.execute_command(stored(), "press", {"key": "self_destruct"})

    # The TV's own screens read in words, never as an app id; an unknown app reads as nothing.
    FakeTv.instances[-1].tv_state.current_app_id = "com.webos.app.home"
    media = next(c for c in (await adapter.get_state(stored())).capabilities if c.type == "media")
    assert media.source == "Home screen"
    FakeTv.instances[-1].tv_state.current_app_id = "com.example.unknown"
    media = next(c for c in (await adapter.get_state(stored())).capabilities if c.type == "media")
    assert media.source is None

    # Off: no remote keys, only power.
    FakeTv.instances[-1].tv_state.is_on = False
    off = await adapter.get_state(stored())
    assert "press" not in off.commands and off.settings == []


async def test_turn_on_uses_wake_on_lan(adapter, monkeypatch):
    sent = []
    monkeypatch.setattr(webos._lan, "wake_on_lan", lambda mac, *a: _ret(sent.append(mac)))
    outcome = await adapter.execute_command(stored(), "turn_on", {})
    assert sent == ["a8:23:fe:01:02:03"] and outcome.result.status == "assumed"
    with pytest.raises(UnsupportedCommand):
        await adapter.execute_command(stored(mac=None), "turn_on", {})
    with pytest.raises(UnsupportedCommand):
        await adapter.execute_command(stored(), "set_color", {})


async def _ret(value):
    return value
