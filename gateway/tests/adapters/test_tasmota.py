"""Tasmota and OpenBeken against a mocked /cm command API, built from each firmware's published reply shapes."""

import base64
import ipaddress

import httpx
import pytest

from cube_gateway.adapters.base import (
    AdapterContext,
    AdapterError,
    AuthRequired,
    DeviceUnreachable,
    ScanContext,
    StoredDevice,
    UnsupportedCommand,
)
from cube_gateway.adapters.tasmota import TasmotaAdapter
from cube_gateway.config import load_settings
from cube_gateway.models import Category, ConnectionStatus, SupportLevel

PASSWORD = "s3cret & sure"


class FakeFirmware:
    """One device's /cm endpoint. `outputs` maps POWER keys to their state; `light` adds light fields to StatusSTS."""

    def __init__(self, *, obk=False, outputs=None, light=None, energy=None, password=None, legacy_auth=False, name="Kettle"):
        self.obk = obk
        self.outputs = {"POWER": "OFF"} if outputs is None else outputs
        self.light = light
        self.energy = energy
        self.password = password
        self.legacy_auth = legacy_auth  # Tasmota 7.x: URL arguments only, and a 200 refusal
        self.name = name
        self.warning = "Need user=<username>&password=<password>"
        self.requests = []  # every /cm request, with its command in .url.params["cmnd"]
        self.down = False
        self.reply_override = None
        self.auto_power_on = not obk

    def commands(self):
        return [r.url.params["cmnd"] for r in self.requests]

    def sent(self):
        """Commands other than the status reads around them."""
        return [c for c in self.commands() if c != "Status 0"]

    def _authorized(self, request):
        if not self.password:
            return True
        header = request.headers.get("authorization", "")
        if header.startswith("Basic ") and not self.legacy_auth:
            return base64.b64decode(header[6:]).decode() == f"admin:{self.password}"
        if self.obk:
            return False  # OpenBeken has no URL arguments for this
        return request.url.params.get("user") == "admin" and request.url.params.get("password") == self.password

    def status_0(self):
        firmware = (
            {"Version": "OpenBK7231N_1.18.150", "Core": "0.0", "SDK": "obk", "CpuFrequency": 80, "Hardware": "BK7231N"}
            if self.obk
            else {"Version": "14.4.1(release-tasmota)", "Core": "2_7_8", "SDK": "2.2.2-dev(38a443e)", "CpuFrequency": 80, "Hardware": "ESP8266EX"}
        )
        sensors = {"Time": "2026-01-01T10:00:00"}
        if self.energy:
            sensors["ENERGY"] = self.energy
        sts = {"Time": "2026-01-01T10:00:00", "UptimeSec": 60, **self.outputs, "Wifi": {"AP": 1, "SSId": "Home", "RSSI": 70, "Signal": -65}}
        if self.light:
            sts.update(self.light)
        return {
            "Status": {"Module": 1, "DeviceName": self.name, "FriendlyName": [self.name], "Topic": "tasmota_3D5E26", "Power": "0"},
            "StatusFWR": firmware,
            "StatusNET": {"Hostname": "tasmota-3D5E26-7718", "IPAddress": "192.168.1.30", "Mac": "A4:CF:12:3D:5E:26"},
            "StatusSNS": sensors,
            "StatusSTS": sts,
        }

    def _light_on(self):
        key = sorted(self.outputs)[-1]
        if self.auto_power_on:
            self.outputs[key] = "ON"

    def _run(self, line):
        verb, _, argument = line.partition(" ")
        word = verb.upper()
        if word == "STATUS":
            return self.status_0()
        if word.startswith("POWER"):
            key = word if word in self.outputs else next(iter(self.outputs))
            if argument.upper() == "TOGGLE":
                self.outputs[key] = "OFF" if self.outputs[key] == "ON" else "ON"
            else:
                self.outputs[key] = argument.upper()
            return {key: self.outputs[key]}
        if not self.light:
            return {"Command": "Unknown", "Input": line}
        if word == "DIMMER":
            self.light["Dimmer"] = int(argument)
        elif word == "CT":
            self.light["CT"] = int(argument)
        elif word == "HSBCOLOR":
            self.light["HSBColor"] = argument
        else:
            return {"Command": "Unknown", "Input": line}
        self._light_on()
        return {**self.outputs, **self.light}

    def handler(self, request):
        if self.down:
            raise httpx.ConnectError("unreachable", request=request)
        if request.url.host == "192.168.1.9":
            return httpx.Response(200, text="<html>router</html>")
        if request.url.host == "192.168.1.8":
            return httpx.Response(401, headers={"WWW-Authenticate": 'Basic realm="Router"'})
        if request.url.host == "192.168.1.7":
            return httpx.Response(200, json={"Status": "fine"})
        if request.url.path != "/cm":
            return httpx.Response(404)
        self.requests.append(request)
        if not self._authorized(request):
            if self.obk:
                return httpx.Response(401, headers={"WWW-Authenticate": 'Basic realm="OpenBeken HTTP Server"'})
            return httpx.Response(200 if self.legacy_auth else 401, json={"WARNING": self.warning})
        if self.reply_override is not None:
            return self.reply_override
        return httpx.Response(200, json=self._run(request.url.params["cmnd"]))


@pytest.fixture
def fake():
    return FakeFirmware()


@pytest.fixture
def make_ctx(tmp_path, monkeypatch):
    monkeypatch.setenv("CUBE_DATA_DIR", str(tmp_path))
    settings = load_settings()
    return lambda firmware: AdapterContext(settings, http=httpx.AsyncClient(transport=httpx.MockTransport(firmware.handler)))


@pytest.fixture
def adapter(fake, make_ctx):
    return TasmotaAdapter(make_ctx(fake))


def stored(password=None):
    return StoredDevice(
        id="d1",
        adapter_id="tasmota",
        brand="tasmota",
        unique_id="a4cf123d5e26",
        name="Kettle",
        category=Category.PLUG,
        host="192.168.1.30",
        port=80,
        credentials={"password": password} if password else {},
    )


def by_key(state):
    return {cap.key: cap for cap in state.capabilities}


RGBCCT = {"Dimmer": 40, "Color": "255,0,0,0,0", "HSBColor": "0,100,40", "White": 0, "CT": 250, "Channel": [40, 0, 0, 0, 0]}


def test_metadata_claims_nothing_unproven():
    info = TasmotaAdapter.info
    assert info.id == "tasmota" and info.brands == ["tasmota"]
    assert info.status == SupportLevel.EXPERIMENTAL and info.verified_models == [] and info.account_free
    assert set(info.categories) == {Category.SWITCH, Category.PLUG, Category.LIGHT}
    assert TasmotaAdapter.probe_ports == (80,)


async def test_probe_identifies_tasmota_and_sends_the_documented_url(adapter, fake):
    candidate = await adapter.probe("192.168.1.30")
    assert candidate.name == "Kettle" and candidate.model == "Tasmota on ESP8266EX"
    assert candidate.mac == "a4:cf:12:3d:5e:26" and candidate.unique_id == "a4cf123d5e26"
    assert candidate.control == "experimental" and candidate.account_free
    assert candidate.status == ConnectionStatus.IDENTIFIED and candidate.pairing.auth == "none"
    assert candidate.sources == ["manual"]
    assert candidate.details == {"firmware": "tasmota", "version": "14.4.1(release-tasmota)", "auth": False}
    assert fake.requests[0].url.raw_path == b"/cm?cmnd=Status%200"


async def test_probe_tells_openbeken_from_tasmota(make_ctx):
    candidate = await TasmotaAdapter(make_ctx(FakeFirmware(obk=True))).probe("192.168.1.30")
    assert candidate.model == "OpenBeken on BK7231N" and candidate.details["firmware"] == "openbeken"


@pytest.mark.parametrize("host", ["192.168.1.7", "192.168.1.8", "192.168.1.9"])
async def test_probe_rejects_other_web_servers(adapter, host):
    assert await adapter.probe(host) is None  # stray JSON, a router's own 401, a plain web page


async def test_probe_of_a_silent_host(adapter, fake):
    fake.down = True
    assert await adapter.probe("192.168.1.30") is None


async def test_subnet_scan_reports_only_devices_and_claims_them(adapter):
    found = []
    scan = ScanContext(timeout=1, subnets=[ipaddress.ip_network("192.168.1.0/24")], report=found.append)
    scan.open_ports[80] = {"192.168.1.7", "192.168.1.8", "192.168.1.9", "192.168.1.30", "192.168.2.30"}
    scan.passive_done.set()
    await adapter.discover(scan)
    assert [c.ip for c in found] == ["192.168.1.30"]  # 192.168.2.30 is outside the scanned network
    assert found[0].sources == ["subnet"]
    assert scan.claimed_ips == {"192.168.1.30"}


@pytest.mark.parametrize(
    ("firmware", "label"),
    [
        (FakeFirmware(password=PASSWORD), "tasmota"),  # 401 and JSON, Tasmota 8.5 on
        (FakeFirmware(password=PASSWORD, legacy_auth=True), "tasmota"),  # 200 and JSON, Tasmota 7.2
        (FakeFirmware(obk=True, password=PASSWORD), "openbeken"),  # 401 and a realm, no JSON
    ],
)
async def test_a_locked_device_is_recognised_and_asks_for_its_password(make_ctx, firmware, label):
    adapter = TasmotaAdapter(make_ctx(firmware))
    candidate = await adapter.probe("192.168.1.30")
    assert candidate.details == {"firmware": label, "auth": True}
    assert candidate.status == ConnectionStatus.LOCAL_AUTHORIZATION_REQUIRED
    assert candidate.pairing.auth == "device_credentials"
    assert [(f.name, f.secret) for f in candidate.pairing.fields] == [("password", True)]
    with pytest.raises(AuthRequired):
        await adapter.pair(candidate, {}, approval=None)


async def test_a_refusal_in_another_firmware_language_is_still_a_refusal(make_ctx):
    firmware = FakeFirmware(password=PASSWORD)
    firmware.warning = "Nécessite utilisateur=<username>&mot-de-passe=<password>"
    assert (await TasmotaAdapter(make_ctx(firmware)).probe("192.168.1.30")).details["auth"] is True


async def test_pair_reads_state_and_learns_the_mac_of_a_locked_device(make_ctx):
    firmware = FakeFirmware(password=PASSWORD, energy={"Power": 42, "Total": 1.5})
    adapter = TasmotaAdapter(make_ctx(firmware))
    candidate = await adapter.probe("192.168.1.30")
    assert candidate.mac is None and candidate.unique_id == "ip-192.168.1.30"
    with pytest.raises(AuthRequired) as rejected:
        await adapter.pair(candidate, {"password": "wrong"}, approval=None)
    assert rejected.value.code == "device_auth_failed"

    result = await adapter.pair(candidate, {"password": PASSWORD}, approval=None)
    assert result.unique_id == "a4cf123d5e26" and result.mac == "a4:cf:12:3d:5e:26"
    assert result.category == Category.PLUG and result.protocol == "tasmota-http"
    assert result.credentials == {"password": PASSWORD}
    assert result.params == {"firmware": "tasmota", "version": "14.4.1(release-tasmota)"}


async def test_the_password_stays_out_of_urls_unless_the_firmware_needs_it(make_ctx):
    current, legacy, obk = FakeFirmware(password=PASSWORD), FakeFirmware(password=PASSWORD, legacy_auth=True), FakeFirmware(obk=True, password=PASSWORD)
    await TasmotaAdapter(make_ctx(current)).get_state(stored(PASSWORD))
    assert ["password" in str(r.url) for r in current.requests] == [False]
    await TasmotaAdapter(make_ctx(obk)).get_state(stored(PASSWORD))
    assert ["password" in str(r.url) for r in obk.requests] == [False]

    await TasmotaAdapter(make_ctx(legacy)).get_state(stored(PASSWORD))
    assert ["password" in str(r.url) for r in legacy.requests] == [False, True]  # header first, then the URL
    assert legacy.requests[1].url.params["password"] == PASSWORD and "authorization" not in legacy.requests[1].headers


async def test_wrong_stored_password_on_openbeken(make_ctx):
    firmware = FakeFirmware(obk=True, password=PASSWORD)
    with pytest.raises(AuthRequired) as rejected:
        await TasmotaAdapter(make_ctx(firmware)).get_state(stored("old password"))
    assert rejected.value.code == "device_auth_failed"
    assert len(firmware.requests) == 1  # no URL retry: OpenBeken does not read one


async def test_pair_refuses_a_device_with_nothing_to_control(make_ctx):
    adapter = TasmotaAdapter(make_ctx(FakeFirmware(outputs={})))
    candidate = await adapter.probe("192.168.1.30")
    with pytest.raises(AdapterError) as refused:
        await adapter.pair(candidate, {}, approval=None)
    assert refused.value.code == "no_outputs" and "template" in refused.value.recovery


@pytest.mark.parametrize(
    ("firmware", "category"),
    [
        (FakeFirmware(), Category.SWITCH),
        (FakeFirmware(energy={"Power": 3}), Category.PLUG),
        (FakeFirmware(light={"Dimmer": 50}), Category.LIGHT),
    ],
)
async def test_pair_picks_the_category(make_ctx, firmware, category):
    adapter = TasmotaAdapter(make_ctx(firmware))
    assert (await adapter.pair(await adapter.probe("192.168.1.30"), {}, approval=None)).category == category


async def test_network_text_is_sanitized(make_ctx):
    adapter = TasmotaAdapter(make_ctx(FakeFirmware(name="Kettle\x00\x1f\n" + "x" * 200)))
    candidate = await adapter.probe("192.168.1.30")
    assert candidate.name.startswith("Kettlexxx") and len(candidate.name) == 96
    assert (await adapter.pair(candidate, {}, approval=None)).name == candidate.name


async def test_older_status_shapes_are_read(make_ctx):
    firmware = FakeFirmware()
    status = firmware.status_0()
    status["Status"]["FriendlyName"] = "Lamp"  # one string, as on old firmware
    firmware.reply_override = httpx.Response(200, json=status)
    assert (await TasmotaAdapter(make_ctx(firmware)).probe("192.168.1.30")).name == "Lamp"


async def test_state_of_a_metered_plug(make_ctx):
    energy = {"Total": 12.345, "Yesterday": 0.5, "Today": 0.25, "Power": 42, "Factor": 0.93, "Voltage": 230, "Current": 0.183}
    firmware = FakeFirmware(outputs={"POWER": "ON"}, energy=energy)
    state = await TasmotaAdapter(make_ctx(firmware)).get_state(stored())
    assert by_key(state)["power"].value == "on"
    readings = {r.key: (r.value, r.unit) for r in state.readings}
    assert readings == {
        "power_w": (42, "W"),
        "voltage_v": (230, "V"),
        "current_a": (0.183, "A"),
        "energy_today_kwh": (0.25, "kWh"),
        "energy_total_kwh": (12.345, "kWh"),
        "rssi": (-65, "dBm"),
    }
    assert state.commands == ["turn_on", "turn_off", "toggle"]


async def test_state_of_a_two_channel_meter_keeps_channels_apart(make_ctx):
    firmware = FakeFirmware(outputs={"POWER1": "ON", "POWER2": "OFF"}, energy={"Power": [12, 0], "Total": 3.5})
    state = await TasmotaAdapter(make_ctx(firmware)).get_state(stored())
    assert {cap.key: (cap.value, cap.label) for cap in state.capabilities} == {"power:0": ("on", "Output 1"), "power:1": ("off", "Output 2")}
    readings = {r.key: r.value for r in state.readings}
    assert readings["power_w:0"] == 12 and readings["power_w:1"] == 0 and readings["energy_total_kwh"] == 3.5


async def test_state_of_a_colour_light(make_ctx):
    firmware = FakeFirmware(outputs={"POWER": "ON"}, light=dict(RGBCCT))
    state = await TasmotaAdapter(make_ctx(firmware)).get_state(stored())
    caps = by_key(state)
    assert caps["brightness"].value == 40
    assert caps["color"].value == {"h": 0, "s": 100}
    assert caps["color_temp"].value == 4000 and (caps["color_temp"].min, caps["color_temp"].max) == (2000, 6500)
    assert state.commands == ["turn_on", "turn_off", "toggle", "set_brightness", "set_color", "set_color_temp"]


async def test_state_tolerates_a_custom_state_word(make_ctx):
    firmware = FakeFirmware(outputs={"POWER": "AUS"})
    state = await TasmotaAdapter(make_ctx(firmware)).get_state(stored())
    assert by_key(state)["power"].value == "unknown"


@pytest.mark.parametrize(
    "reply",
    [
        httpx.Response(200, text="<html>not json</html>"),
        httpx.Response(200, text=""),
        httpx.Response(200, json={"Status": {}}),
    ],
)
async def test_a_reply_without_state_reads_as_unreachable(make_ctx, reply):
    firmware = FakeFirmware()
    firmware.reply_override = reply
    with pytest.raises(DeviceUnreachable):
        await TasmotaAdapter(make_ctx(firmware)).get_state(stored())


async def test_a_server_error_is_reported(make_ctx):
    firmware = FakeFirmware()
    firmware.reply_override = httpx.Response(500)
    with pytest.raises(AdapterError) as failed:
        await TasmotaAdapter(make_ctx(firmware)).get_state(stored())
    assert failed.value.code == "device_rejected"


async def test_unreachable(adapter, fake):
    fake.down = True
    with pytest.raises(DeviceUnreachable):
        await adapter.get_state(stored())
    with pytest.raises(DeviceUnreachable):
        await adapter.execute_command(stored(), "turn_on", {})


async def test_power_commands_confirm_from_the_device(adapter, fake):
    outcome = await adapter.execute_command(stored(), "turn_on", {})
    assert outcome.result.status == "confirmed" and by_key(outcome.state)["power"].value == "on"
    outcome = await adapter.execute_command(stored(), "toggle", {})
    assert by_key(outcome.state)["power"].value == "off"
    outcome = await adapter.execute_command(stored(), "turn_off", {})
    assert by_key(outcome.state)["power"].value == "off"
    assert fake.sent() == ["Power ON", "Power TOGGLE", "Power OFF"]


async def test_power_reaches_the_named_output(make_ctx):
    firmware = FakeFirmware(outputs={"POWER1": "OFF", "POWER2": "OFF"})
    adapter = TasmotaAdapter(make_ctx(firmware))
    await adapter.execute_command(stored(), "turn_on", {"key": "power:1"})
    await adapter.execute_command(stored(), "turn_on", {"channel": 0})
    await adapter.execute_command(stored(), "turn_off", {})
    assert firmware.sent() == ["Power2 ON", "Power1 ON", "Power1 OFF"]
    for bad in ({"key": "power:5"}, {"channel": "first"}):
        with pytest.raises(AdapterError) as refused:
            await adapter.execute_command(stored(), "turn_on", bad)
        assert refused.value.code == "bad_params"


async def test_light_commands(make_ctx):
    firmware = FakeFirmware(outputs={"POWER": "ON"}, light=dict(RGBCCT))
    adapter = TasmotaAdapter(make_ctx(firmware))
    outcome = await adapter.execute_command(stored(), "set_brightness", {"brightness": 65})
    assert by_key(outcome.state)["brightness"].value == 65
    await adapter.execute_command(stored(), "set_color", {"h": 120, "s": 80})
    await adapter.execute_command(stored(), "set_color_temp", {"kelvin": 2700})
    outcome = await adapter.execute_command(stored(), "set_brightness", {"brightness": 0})
    assert by_key(outcome.state)["power"].value == "off"
    assert by_key(outcome.state)["brightness"].value == 65  # the level survives for the next turn on
    assert firmware.sent() == ["Dimmer 65", "HSBColor 120,80,65", "CT 370", "Power OFF"]
    assert firmware.requests[-1].url.raw_path == b"/cm?cmnd=Status%200"
    colour = next(r for r in firmware.requests if r.url.params["cmnd"].startswith("HSBColor"))
    assert colour.url.raw_path == b"/cm?cmnd=HSBColor%20120,80,65"


async def test_colour_on_a_dark_light_gets_a_real_brightness(make_ctx):
    # OpenBeken takes the third number literally, so a dimmer at 0 must not be sent as brightness 0.
    firmware = FakeFirmware(outputs={"POWER": "OFF"}, light={**RGBCCT, "Dimmer": 0})
    await TasmotaAdapter(make_ctx(firmware)).execute_command(stored(), "set_color", {"h": 10, "s": 20})
    assert firmware.sent() == ["HSBColor 10,20,100"]


async def test_light_values_are_clamped(make_ctx):
    firmware = FakeFirmware(outputs={"POWER": "ON"}, light=dict(RGBCCT))
    adapter = TasmotaAdapter(make_ctx(firmware))
    await adapter.execute_command(stored(), "set_color_temp", {"kelvin": 20000})
    await adapter.execute_command(stored(), "set_color_temp", {"kelvin": 100})
    await adapter.execute_command(stored(), "set_brightness", {"brightness": 400})
    assert firmware.sent() == ["CT 154", "CT 500", "Dimmer 100"]


async def test_tasmota_lights_turn_on_by_themselves(make_ctx):
    firmware = FakeFirmware(outputs={"POWER": "OFF"}, light=dict(RGBCCT))
    outcome = await TasmotaAdapter(make_ctx(firmware)).execute_command(stored(), "set_brightness", {"brightness": 30})
    assert by_key(outcome.state)["power"].value == "on"
    assert firmware.sent() == ["Dimmer 30"]


@pytest.mark.parametrize(
    ("command", "params", "first"),
    [
        ("set_brightness", {"brightness": 30}, "Dimmer 30"),
        ("set_color", {"h": 200, "s": 90}, "HSBColor 200,90,40"),
        ("set_color_temp", {"kelvin": 4000}, "CT 250"),
    ],
)
async def test_an_openbeken_light_that_stays_off_is_turned_on(make_ctx, command, params, first):
    firmware = FakeFirmware(obk=True, outputs={"POWER": "OFF"}, light=dict(RGBCCT))
    outcome = await TasmotaAdapter(make_ctx(firmware)).execute_command(stored(), command, params)
    assert firmware.sent() == [first, "Power ON"]
    assert by_key(outcome.state)["power"].value == "on"


async def test_a_light_after_a_relay_is_the_last_output(make_ctx):
    firmware = FakeFirmware(outputs={"POWER1": "ON", "POWER2": "ON"}, light={"Dimmer": 50})
    adapter = TasmotaAdapter(make_ctx(firmware))
    await adapter.execute_command(stored(), "set_brightness", {"brightness": 0})
    assert firmware.sent() == ["Power2 OFF"] and firmware.outputs == {"POWER1": "ON", "POWER2": "OFF"}
    firmware.auto_power_on = False
    await adapter.execute_command(stored(), "set_brightness", {"brightness": 25})
    assert firmware.sent()[-2:] == ["Dimmer 25", "Power2 ON"]


async def test_turning_a_light_off_does_not_fight_itself(make_ctx):
    firmware = FakeFirmware(obk=True, outputs={"POWER": "ON"}, light=dict(RGBCCT))
    outcome = await TasmotaAdapter(make_ctx(firmware)).execute_command(stored(), "set_brightness", {"brightness": 0})
    assert firmware.sent() == ["Power OFF"] and by_key(outcome.state)["power"].value == "off"


async def test_commands_the_device_does_not_offer(adapter, fake):
    for command, params in (("set_brightness", {"brightness": 10}), ("set_color", {"h": 1, "s": 1}), ("set_color_temp", {"kelvin": 3000}), ("set_volume", {})):
        with pytest.raises(UnsupportedCommand):
            await adapter.execute_command(stored(), command, params)
    assert fake.sent() == []


async def test_bad_params_never_reach_the_device(make_ctx):
    firmware = FakeFirmware(outputs={"POWER": "ON"}, light=dict(RGBCCT))
    adapter = TasmotaAdapter(make_ctx(firmware))
    for command, params in (("set_brightness", {}), ("set_brightness", {"brightness": "dim"}), ("set_color", {"h": 1}), ("set_color_temp", {})):
        with pytest.raises(AdapterError) as refused:
            await adapter.execute_command(stored(), command, params)
        assert refused.value.code == "bad_params"
    assert firmware.sent() == []


async def test_a_refused_command_is_an_error_not_a_confirmation(make_ctx):
    firmware = FakeFirmware()
    adapter = TasmotaAdapter(make_ctx(firmware))
    run = firmware._run

    def refuse(line):
        return {"Command": "Error", "Input": line} if line.startswith("Power") else run(line)

    firmware._run = refuse
    with pytest.raises(AdapterError) as refused:
        await adapter.execute_command(stored(), "turn_on", {})
    assert refused.value.code == "device_rejected"
