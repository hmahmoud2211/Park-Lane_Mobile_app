"""Samsung TV adapter: REST identification mocked with httpx, the WebSocket remote replaced by a fake."""

import httpx
import pytest
from samsungtvws.exceptions import UnauthorizedError

from cube_gateway.adapters import samsung_tv
from cube_gateway.adapters.base import AdapterContext, PairingRejected, ScanContext, StoredDevice, UnsupportedCommand
from cube_gateway.config import load_settings
from cube_gateway.models import Category


class Tv:
    def __init__(self):
        self.power = "on"
        self.down = False

    def handler(self, request):
        if self.down:
            raise httpx.ConnectError("off", request=request)
        if request.url.host == "192.168.1.9":
            return httpx.Response(200, json={"device": {"type": "Roku"}})
        return httpx.Response(
            200,
            json={
                "type": "Samsung SmartTV",
                "device": {
                    "type": "Samsung SmartTV",
                    "name": "[TV] Samsung Q80",
                    "modelName": "QE55Q80TATXXU",
                    "wifiMac": "64:1C:AE:00:11:22",
                    "id": "uuid:7b1f2c3d-0000-1111-2222-333344445555",
                    "TokenAuthSupport": "true",
                    "PowerState": self.power,
                },
            },
        )


class FakeRemote:
    mode = "allow"
    sent: list = []

    def __init__(self, host, token=None, port=8001, timeout=None, name=""):
        self.host, self.token, self.port = host, token, port
        self.alive = False

    async def open(self):
        if self.mode == "deny":
            raise UnauthorizedError({"event": "ms.channel.unauthorized"})
        self.token = self.token or "tv-token"
        self.alive = True

    def is_alive(self):
        return self.alive

    async def send_command(self, command):
        FakeRemote.sent.append(command.params["DataOfCmd"])

    async def close(self):
        self.alive = False


@pytest.fixture
def tv():
    return Tv()


@pytest.fixture
def adapter(tmp_path, monkeypatch, tv):
    monkeypatch.setenv("CUBE_DATA_DIR", str(tmp_path))
    ctx = AdapterContext(load_settings(), http=httpx.AsyncClient(transport=httpx.MockTransport(tv.handler)))
    FakeRemote.mode, FakeRemote.sent = "allow", []
    adapter = samsung_tv.SamsungTvAdapter(ctx)
    adapter.remote_factory = FakeRemote
    return adapter


def stored():
    return StoredDevice(
        id="d1",
        adapter_id="samsung_tv",
        brand="samsung",
        unique_id="7b1f",
        name="TV",
        category=Category.TV,
        host="192.168.1.50",
        port=8002,
        mac="64:1c:ae:00:11:22",
        params={"port": 8002},
        credentials={"token": "tv-token"},
    )


async def test_identification(adapter):
    candidate = await adapter.probe("192.168.1.50")
    assert candidate.unique_id == "7b1f2c3d-0000-1111-2222-333344445555"
    assert (candidate.model, candidate.mac, candidate.port) == ("QE55Q80TATXXU", "64:1c:ae:00:11:22", 8002)
    assert candidate.pairing.auth == "approve_on_device"
    assert await adapter.probe("192.168.1.9") is None  # answers, but is not a Samsung TV


async def test_subnet_discovery(adapter):
    found = []
    scan = ScanContext(timeout=1, subnets=[], report=found.append)
    scan.open_ports[8001] = {"192.168.1.50", "192.168.1.9"}
    scan.passive_done.set()
    await adapter.discover(scan)
    assert [c.ip for c in found] == ["192.168.1.50"]


async def test_pairing(adapter):
    candidate = await adapter.probe("192.168.1.50")
    prompts = []
    result = await adapter.pair(candidate, {}, lambda message: _ret(prompts.append(message)))
    assert prompts and result.credentials == {"token": "tv-token"} and result.params["port"] == 8002
    FakeRemote.mode = "deny"
    with pytest.raises(PairingRejected):
        await adapter.pair(candidate, {}, lambda message: _ret(None))


async def test_power_state_is_confirmed_only_when_reported(adapter, tv):
    state = await adapter.get_state(stored())
    assert state.capabilities[0].value == "on" and state.capabilities[0].confirmed
    tv.power = "standby"
    assert (await adapter.get_state(stored())).capabilities[0].value == "off"
    tv.down = True
    power = (await adapter.get_state(stored())).capabilities[0]
    assert power.value == "off" and power.confirmed is False


async def test_key_commands_are_assumed(adapter, tv, monkeypatch):
    outcome = await adapter.execute_command(stored(), "volume_up", {})
    assert outcome.result.status == "assumed" and FakeRemote.sent == ["KEY_VOLUP"]
    tv.power = "standby"
    outcome = await adapter.execute_command(stored(), "turn_on", {})
    assert FakeRemote.sent[-1] == "KEY_POWER" and outcome.result.status == "assumed"
    tv.down = True
    woken = []
    monkeypatch.setattr(samsung_tv._lan, "wake_on_lan", lambda mac, *a: _ret(woken.append(mac)))
    await adapter.execute_command(stored(), "turn_on", {})
    assert woken == ["64:1c:ae:00:11:22"]
    with pytest.raises(UnsupportedCommand):
        await adapter.execute_command(stored(), "set_volume", {"volume": 10})


async def _ret(value):
    return value
