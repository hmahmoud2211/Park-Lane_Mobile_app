"""Faikout adapter against a mock of the module's Daikin-style HTTP API."""

from urllib.parse import parse_qs

import httpx
import pytest

from cube_gateway.adapters.base import AdapterContext, AdapterError, AuthRequired, DeviceUnreachable, MdnsRecord, ScanContext, StoredDevice, UnsupportedCommand
from cube_gateway.adapters.daikin import DaikinAdapter
from cube_gateway.adapters.faikout import FaikoutAdapter, is_faikout
from cube_gateway.models import Category, SupportLevel

MODULE = "192.168.1.20"
ROUTER = "192.168.1.9"
REAL_DAIKIN = "192.168.1.21"
OTHER_MODULE = "192.168.1.22"

BASIC = (
    "ret=OK,type=aircon,reg=eu,dst=0,ver=1f3a9c2,rev=1f3a9c2,pow=1,err={err},location=0,name={name},icon=1,method=home only,"
    "port=30050,id=,pw=,lpw_flag=0,adp_kind=0,pv=3,cpv=3,cpv_minor=20,led=1,en_setzone=0,mac=F412FA97CDE8,adp_mode=run,"
    "ssid=,ssid1={ssid},grp_name=,en_grp=0"
)
REAL_BASIC = "ret=OK,type=aircon,reg=eu,dst=1,ver=1_2_51,rev=D3A0C9F,pow=0,err=0,name=%4c%69%76%69%6e%67,adp_kind=3,mac=A408EA123456"
LOGIN_PAGE = '<html><head><script>document.location="/login";</script></head><body><a href="/login">Login required</a></body></html>'


class FakeFaikout:
    """Answers as the firmware does: any subset of fields on a set, and the new value echoed by the next read."""

    def __init__(self):
        self.err = "0"
        self.name = "GuestAC"
        self.ssid = "Home"
        self.pow = "1"
        self.mode = "3"
        self.stemp = "24.0"
        self.f_rate = "A"
        self.htemp = "23.50"
        self.otemp = "31.00"
        self.down = False
        self.password = False
        self.refuse = None
        self.sets = []
        self.hosts = []

    def control(self):
        setpoints = {f"dt{i}": "24.0" if str(i) == self.mode else "20.0" for i in range(1, 8)}
        fields = {"ret": "OK", "pow": self.pow, "mode": self.mode, "adv": "0", "stemp": self.stemp, "shum": "0", **setpoints, "f_rate": self.f_rate, "f_dir": "0"}
        return ",".join(f"{key}={value}" for key, value in fields.items())

    def handler(self, request: httpx.Request) -> httpx.Response:
        self.hosts.append(request.url.host)
        if self.down:
            raise httpx.ConnectError("unreachable", request=request)
        if request.url.host == ROUTER:
            return httpx.Response(200, text="<html>router</html>")
        if request.url.host == REAL_DAIKIN:
            return httpx.Response(200, text=REAL_BASIC)
        if self.password:
            return httpx.Response(200, text=LOGIN_PAGE)
        path = request.url.path
        if path == "/common/basic_info":
            return httpx.Response(200, text=BASIC.format(err=self.err, name=self.name, ssid=self.ssid))
        if path == "/aircon/get_control_info":
            return httpx.Response(200, text=self.control())
        if path == "/aircon/get_sensor_info":
            return httpx.Response(200, text=f"ret=OK,htemp={self.htemp},hhum=-,otemp={self.otemp},err=0,cmpfreq=-")
        if path == "/aircon/set_control_info":
            values = {key: value[0] for key, value in parse_qs(request.url.query.decode()).items()}
            self.sets.append(values)
            if self.refuse:
                return httpx.Response(200, text=f"ret=PARAM NG,adv={self.refuse}")
            self.pow = values.get("pow", self.pow)
            self.mode = values.get("mode", self.mode)
            self.stemp = values.get("stemp", self.stemp)
            self.f_rate = values.get("f_rate", self.f_rate)
            return httpx.Response(200, text="ret=OK,adv=0")
        return httpx.Response(404)


@pytest.fixture
def fake():
    return FakeFaikout()


@pytest.fixture
def ctx(settings, fake):
    return AdapterContext(settings, http=httpx.AsyncClient(transport=httpx.MockTransport(fake.handler)))


def stored(adapter_id="faikout"):
    return StoredDevice(id="d1", adapter_id=adapter_id, brand="daikin", unique_id="f412fa97cde8", name="GuestAC", category=Category.CLIMATE, host=MODULE, port=80, params={"https": False})


def test_metadata_is_honest():
    info = FaikoutAdapter.info
    assert info.id == "faikout" and info.brands == ["daikin"] and info.categories == [Category.CLIMATE]
    assert info.status == SupportLevel.EXPERIMENTAL and info.verified_models == []
    assert info.account_free is True and info.library is None


def test_fingerprint_tells_a_module_from_a_real_adapter():
    assert is_faikout({"ret": "OK", "type": "aircon", "ver": "1f3a9c2", "rev": "1f3a9c2"})
    assert not is_faikout({"ret": "OK", "type": "aircon", "ver": "1_2_51", "rev": "D3A0C9F"})
    assert not is_faikout({"ret": "OK", "type": "aircon", "ver": "1_2_51"})
    assert not is_faikout({"ret": "OK", "type": "aircon", "ver": "", "rev": ""})


async def test_probe_identifies_a_module_and_leaves_others_alone(ctx):
    adapter = FaikoutAdapter(ctx)
    candidate = await adapter.probe(MODULE)
    assert candidate.adapter_id == "faikout" and candidate.brand == "daikin"
    assert candidate.name == "GuestAC" and candidate.mac == "f4:12:fa:97:cd:e8" and candidate.unique_id == "f412fa97cde8"
    assert candidate.model == "Faikout 1f3a9c2" and candidate.protocol == "faikout-http" and candidate.port == 80
    assert candidate.control == "experimental" and candidate.pairing.auth == "none"
    assert await adapter.probe(REAL_DAIKIN) is None
    assert await adapter.probe(ROUTER) is None


async def test_an_unnamed_module_does_not_show_its_mac_as_a_name(ctx, fake):
    fake.name = "F412FA97CDE8"
    assert (await FaikoutAdapter(ctx).probe(MODULE)).name == "Daikin air conditioner"


async def test_network_text_is_sanitized(ctx, fake):
    fake.name = "Guest\x1b[31mAC"
    candidate = await FaikoutAdapter(ctx).probe(MODULE)
    assert "\x1b" not in candidate.name


async def test_a_module_with_a_web_password_is_not_listed(ctx, fake):
    fake.password = True
    assert await FaikoutAdapter(ctx).probe(MODULE) is None


async def test_discover_uses_the_subnet_probe_and_mdns_only_on_home_networks(ctx, fake):
    found = []
    scan = ScanContext(timeout=1, subnets=[], report=found.append)
    scan.open_ports[80] = {ROUTER, REAL_DAIKIN}
    scan.mdns = [
        MdnsRecord(type="_http._tcp.local.", name="GuestAC._http._tcp.local.", ip=MODULE, port=80, properties={}),
        MdnsRecord(type="_http._tcp.local.", name="public._http._tcp.local.", ip="8.8.8.8", port=80, properties={}),
    ]
    scan.passive_done.set()
    await FaikoutAdapter(ctx).discover(scan)
    assert [(c.ip, c.sources) for c in found] == [(MODULE, ["mdns"])]
    assert scan.claimed_ips == {MODULE}
    assert "8.8.8.8" not in fake.hosts


async def test_pair_proves_control_by_reading_state(ctx):
    adapter = FaikoutAdapter(ctx)
    result = await adapter.pair(await adapter.probe(MODULE), {}, approval=None)
    assert (result.unique_id, result.name, result.host, result.port) == ("f412fa97cde8", "GuestAC", MODULE, 80)
    assert result.category == Category.CLIMATE and result.protocol == "faikout-http"
    assert result.params == {"https": False, "ver": "1f3a9c2"} and result.credentials == {}


async def test_pair_refuses_a_module_that_has_lost_the_air_conditioner(ctx, fake):
    adapter = FaikoutAdapter(ctx)
    candidate = await adapter.probe(MODULE)
    fake.err = "1"
    with pytest.raises(AdapterError) as error:
        await adapter.pair(candidate, {}, approval=None)
    assert error.value.code == "ac_not_connected" and "air conditioner" in error.value.message


async def test_pair_without_an_address_asks_for_a_new_scan(ctx):
    adapter = FaikoutAdapter(ctx)
    candidate = (await adapter.probe(MODULE)).model_copy(update={"ip": None})
    with pytest.raises(DeviceUnreachable):
        await adapter.pair(candidate, {}, approval=None)


async def test_state(ctx):
    state = await FaikoutAdapter(ctx).get_state(stored())
    climate = state.capabilities[0]
    assert (climate.mode, climate.target, climate.current, climate.fan_mode) == ("cool", 24.0, 23.5, "auto")
    assert (climate.min, climate.max, climate.step) == (16, 32, 0.5)
    assert state.online is True and climate.confirmed is True
    assert state.readings[0].key == "outdoor_temperature" and state.readings[0].value == 31.0
    assert {"set_temperature", "set_hvac_mode", "set_fan_mode", "turn_on", "turn_off"} <= set(state.commands)


async def test_values_the_unit_has_not_reported_stay_empty(ctx, fake):
    fake.stemp, fake.htemp, fake.otemp = "nan", "-", "-"
    state = await FaikoutAdapter(ctx).get_state(stored())
    assert state.capabilities[0].target is None and state.capabilities[0].current is None and state.readings == []


async def test_a_lost_air_conditioner_shows_offline_not_stale_values_as_fact(ctx, fake):
    fake.err = "1"
    state = await FaikoutAdapter(ctx).get_state(stored())
    assert state.online is False and state.capabilities[0].confirmed is False


async def test_auto_is_read_from_every_code_the_firmware_may_use(ctx, fake):
    fake.mode = "7"
    assert (await FaikoutAdapter(ctx).get_state(stored())).capabilities[0].mode == "auto"


async def test_off_wins_over_the_remembered_mode(ctx, fake):
    fake.pow = "0"
    assert (await FaikoutAdapter(ctx).get_state(stored())).capabilities[0].mode == "off"


@pytest.mark.parametrize(
    ("command", "params", "sent"),
    [
        ("turn_on", {}, {"pow": "1"}),
        ("turn_off", {}, {"pow": "0"}),
        ("set_temperature", {"temperature": 21.5}, {"stemp": "21.5"}),
        ("set_hvac_mode", {"mode": "heat"}, {"pow": "1", "mode": "4"}),
        ("set_hvac_mode", {"mode": "fan_only"}, {"pow": "1", "mode": "6"}),
        ("set_hvac_mode", {"mode": "off"}, {"pow": "0"}),
        ("set_fan_mode", {"fan_mode": "3"}, {"f_rate": "5"}),
        ("set_fan_mode", {"fan_mode": "silence"}, {"f_rate": "B"}),
    ],
)
async def test_commands_send_only_what_changes(ctx, fake, command, params, sent):
    await FaikoutAdapter(ctx).execute_command(stored(), command, params)
    assert fake.sets == [sent]


async def test_a_mode_change_keeps_the_setpoint_where_the_plain_daikin_adapter_resets_it(ctx, fake):
    await DaikinAdapter(ctx).execute_command(stored("daikin"), "set_hvac_mode", {"mode": "heat"})
    assert fake.sets[-1]["stemp"] == "20.0"  # The firmware's default for a mode it has not seen.
    fake.stemp, fake.mode = "24.0", "3"
    state = (await FaikoutAdapter(ctx).execute_command(stored(), "set_hvac_mode", {"mode": "heat"})).state
    assert "stemp" not in fake.sets[-1] and state.capabilities[0].target == 24.0


async def test_an_unreported_setpoint_is_never_written_back(ctx, fake):
    fake.stemp = "nan"
    await FaikoutAdapter(ctx).execute_command(stored(), "set_fan_mode", {"fan_mode": "auto"})
    assert "stemp" not in fake.sets[-1]


async def test_a_change_is_pending_because_the_read_back_only_echoes_it(ctx):
    outcome = await FaikoutAdapter(ctx).execute_command(stored(), "set_temperature", {"temperature": 22})
    assert outcome.result.status == "pending" and "air conditioner" in outcome.result.message
    assert outcome.state.capabilities[0].target == 22.0 and outcome.state.capabilities[0].confirmed is False


@pytest.mark.parametrize(("wanted", "sent"), [(5, "16.0"), (40, "32.0")])
async def test_temperature_stays_inside_the_module_range(ctx, fake, wanted, sent):
    await FaikoutAdapter(ctx).execute_command(stored(), "set_temperature", {"temperature": wanted})
    assert fake.sets[-1]["stemp"] == sent


async def test_bad_requests_are_refused_before_reaching_the_module(ctx, fake):
    adapter = FaikoutAdapter(ctx)
    with pytest.raises(AdapterError):
        await adapter.execute_command(stored(), "set_hvac_mode", {"mode": "boost"})
    with pytest.raises(AdapterError):
        await adapter.execute_command(stored(), "set_fan_mode", {"fan_mode": "turbo"})
    with pytest.raises(UnsupportedCommand):
        await adapter.execute_command(stored(), "set_volume", {})
    fake.mode = "2"
    with pytest.raises(AdapterError, match="dry or fan"):
        await adapter.execute_command(stored(), "set_temperature", {"temperature": 22})
    assert fake.sets == []


async def test_a_refusal_gives_the_module_s_reason_sanitized(ctx, fake):
    fake.refuse = "Setting cannot\x07 be controlled"
    with pytest.raises(AdapterError) as error:
        await FaikoutAdapter(ctx).execute_command(stored(), "set_fan_mode", {"fan_mode": "1"})
    assert error.value.code == "device_rejected"
    assert error.value.message == "The Faikout module refused the change: Setting cannot be controlled."


async def test_a_web_password_added_later_is_explained(ctx, fake):
    fake.password = True
    with pytest.raises(AuthRequired) as error:
        await FaikoutAdapter(ctx).get_state(stored())
    assert "web password" in error.value.message and "Clear" in error.value.recovery


async def test_a_wifi_name_with_login_in_it_is_not_a_password(ctx, fake):
    fake.ssid = "/login"
    assert (await FaikoutAdapter(ctx).get_state(stored())).online is True


async def test_web_control_switched_off_is_explained(ctx, fake):
    adapter = FaikoutAdapter(ctx)
    device = stored()
    device.host = ROUTER
    with pytest.raises(AdapterError) as error:
        await adapter.get_state(device)
    assert error.value.code == "not_faikout" and "Web control" in error.value.recovery


async def test_unreachable(ctx, fake):
    fake.down = True
    with pytest.raises(DeviceUnreachable, match="Faikout module"):
        await FaikoutAdapter(ctx).get_state(stored())
