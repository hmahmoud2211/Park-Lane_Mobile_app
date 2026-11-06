"""Gree adapter against a fake unit speaking the Gree UDP protocol, in each encryption real units use.

The fake does its own cryptography with raw primitives rather than the adapter's helpers, so a mistake in the
adapter cannot cancel itself out. Like a real unit it stays silent on anything it cannot open, and answers a
bind only straight after a scan.
"""

import asyncio
import base64
import ipaddress
import json
import logging

import pytest
from cryptography.hazmat.primitives import padding
from cryptography.hazmat.primitives.ciphers import Cipher, algorithms, modes
from cryptography.hazmat.primitives.ciphers.aead import AESGCM

from cube_gateway.adapters import gree
from cube_gateway.adapters.base import (
    AdapterContext,
    AdapterError,
    AuthRequired,
    DeviceUnreachable,
    PairingRejected,
    ScanContext,
    StoredDevice,
    UnsupportedCommand,
)
from cube_gateway.adapters.gree import GreeAdapter
from cube_gateway.adapters.registry import AdapterRegistry
from cube_gateway.config import load_settings
from cube_gateway.models import AuthKind, Category, ConnectionStatus, SupportLevel

MAC = "f4911e7aca59"
DEVICE_KEY = "St6Vy9Bd1Fg3Jk5M"
ECB_GENERIC = b"a3K8Bx%2r8Y7#xDh"
GCM_GENERIC = b"{yxAHAY_Lm6pbC/<"
NONCE = bytes.fromhex("5440784449675a516c5e6313")
AAD = b"qualcomm-test"

#: Made with PyCryptodome (and for ECB also with `openssl enc`), not with the library the adapter uses.
VECTOR_PLAIN = {"t": "dev", "cid": MAC, "name": "Salon"}
VECTOR_ECB = "LP24Ek0OaYogxs3iQLjL4Hn0XnvnSTH8fuD1MbP6P2JGrnZ6R1eJn0gC5i7k/iwL"
VECTOR_GCM = "JtoKliwtrZWlpNCVOSARFZVj7tcb0xajNwU3XO/ShOTTeGwCiENkaLv0u+PKSJg="
VECTOR_TAG = "ngkew/FIVpBdFb0MGbaNfg=="

#: How units differ: the original, current firmware, and those that answer the scan in ECB and then want GCM.
VARIANTS = {"ecb": ("ecb", "ecb"), "gcm": ("gcm", "gcm"), "combined": ("ecb", "gcm")}


def ecb_seal(key, plain, tail=None):
    if tail is None:
        padder = padding.PKCS7(128).padder()
        plain = padder.update(plain) + padder.finalize()
    else:
        plain += tail * (16 - len(plain) % 16)
    encryptor = Cipher(algorithms.AES(key), modes.ECB()).encryptor()  # noqa: S305
    return {"pack": base64.b64encode(encryptor.update(plain) + encryptor.finalize()).decode()}


def ecb_open(key, pack):
    decryptor = Cipher(algorithms.AES(key), modes.ECB()).decryptor()  # noqa: S305
    plain = decryptor.update(base64.b64decode(pack)) + decryptor.finalize()
    unpadder = padding.PKCS7(128).unpadder()
    return unpadder.update(plain) + unpadder.finalize()


def gcm_seal(key, plain):
    sealed = AESGCM(key).encrypt(NONCE, plain, AAD)
    return {"pack": base64.b64encode(sealed[:-16]).decode(), "tag": base64.b64encode(sealed[-16:]).decode()}


def gcm_open(key, packet):
    return AESGCM(key).decrypt(NONCE, base64.b64decode(packet["pack"]) + base64.b64decode(packet["tag"]), AAD)


class FakeGree(asyncio.DatagramProtocol):
    """One unit. `scan_cipher` is how it answers a scan; `session_cipher` is how it binds and talks from then on."""

    def __init__(self, scan_cipher="ecb", session_cipher="ecb", **options):
        self.scan_cipher = scan_cipher
        self.session_cipher = session_cipher
        self.mid = options.get("mid", "10001")
        self.name = options.get("name", "Salon")
        self.version = options.get("version", "V1.1.13")
        self.bind_reply = options.get("bind_reply", {"t": "bindok", "mac": MAC, "key": DEVICE_KEY, "r": 200})
        self.command_code = options.get("command_code", 200)
        #: Junk after the JSON instead of proper padding, as some firmware sends.
        self.tail = options.get("tail")
        #: Reply to a scan under a key nobody knows.
        self.private_scan = options.get("private_scan", False)
        self.silent_to = set(options.get("silent_to", ()))
        self.ignores = set(options.get("ignores", ()))
        self.lose_binds = options.get("lose_binds", 0)
        self.answer_with_key = options.get("answer_with_key", DEVICE_KEY).encode()
        self.mute_after_command = False
        self.props = {
            "Pow": 1,
            "Mod": 1,
            "SetTem": 24,
            "TemUn": 0,
            "TemRec": 0,
            "TemSen": 66,
            "WdSpd": 0,
            "SwUpDn": 0,
            "SwingLfRig": 0,
            "Tur": 0,
            "Quiet": 0,
            "Lig": 1,
            **options.get("props", {}),
        }
        self.scan_fresh = False
        self.requests = []
        self.commands = []
        self.counts = {"scan": 0, "bind": 0, "status": 0, "cmd": 0}

    def connection_made(self, transport):
        self.transport = transport

    def send(self, addr, inner, cipher, key):
        plain = json.dumps(inner).encode()
        if cipher == "gcm":
            sealed = gcm_seal(key, plain + (self.tail * 3 if self.tail else b""))
        else:
            sealed = ecb_seal(key, plain, self.tail)
        self.transport.sendto(json.dumps({"t": "pack", "i": 0, "uid": 0, "cid": MAC, "tcid": "app", **sealed}).encode(), addr)

    def open(self, request, key):
        try:
            plain = gcm_open(key, request) if self.session_cipher == "gcm" else ecb_open(key, request["pack"])
            return json.loads(plain)
        except Exception:  # noqa: BLE001 - a unit stays silent on what it cannot open
            return None

    def datagram_received(self, data, addr):
        request = json.loads(data)
        self.requests.append(request)
        if request["t"] == "scan":
            self.on_scan(addr)
        elif request["i"] == 1:
            self.on_bind(request, addr)
        else:
            self.on_message(request, addr)

    def on_scan(self, addr):
        self.counts["scan"] += 1
        self.scan_fresh = True
        if "scan" in self.silent_to:
            return
        pack = {"t": "dev", "cid": MAC, "bc": "gree", "brand": "gree", "catalog": "gree", "mac": MAC, "mid": self.mid, "model": "gree", "name": self.name, "ver": self.version, "lock": 0}
        key = ECB_GENERIC if self.scan_cipher == "ecb" else GCM_GENERIC
        self.send(addr, pack, self.scan_cipher, b"0123456789abcdef" if self.private_scan else key)

    def on_bind(self, request, addr):
        fresh, self.scan_fresh = self.scan_fresh, False
        key = ECB_GENERIC if self.session_cipher == "ecb" else GCM_GENERIC
        if not fresh or "bind" in self.silent_to or self.open(request, key) is None:
            return
        self.counts["bind"] += 1
        if self.lose_binds:
            self.lose_binds -= 1
            return
        self.send(addr, self.bind_reply, self.session_cipher, key)

    def on_message(self, request, addr):
        inner = self.open(request, DEVICE_KEY.encode())
        if inner is None:
            return
        kind = inner["t"]
        self.counts[kind] += 1
        if kind in self.silent_to or (kind == "status" and self.mute_after_command):
            return
        if kind == "status":
            columns = [column for column in inner["cols"] if column in self.props]
            reply = {"t": "dat", "mac": MAC, "r": 200, "cols": columns, "dat": [self.props[column] for column in columns]}
        else:
            self.commands.append(dict(zip(inner["opt"], inner["p"], strict=True)))
            self.props.update({k: v for k, v in self.commands[-1].items() if k not in self.ignores})
            self.mute_after_command = "read_back" in self.silent_to
            reply = {"t": "res", "mac": MAC, "r": self.command_code, "opt": inner["opt"], "p": inner["p"], "val": inner["p"]}
        self.send(addr, reply, self.session_cipher, self.answer_with_key)


class Stranger(asyncio.DatagramProtocol):
    """Something else on the port, answering every datagram with fixed bytes."""

    def __init__(self, answer):
        self.answer = answer

    def connection_made(self, transport):
        self.transport = transport

    def datagram_received(self, data, addr):
        self.transport.sendto(self.answer, addr)


@pytest.fixture
def ctx(tmp_path, monkeypatch):
    monkeypatch.setenv("CUBE_DATA_DIR", str(tmp_path))
    return AdapterContext(load_settings())


@pytest.fixture
async def listen():
    """Opens protocols on loopback ports, and closes them after the test."""
    transports = []

    async def start(factory):
        transport, protocol = await asyncio.get_running_loop().create_datagram_endpoint(factory, local_addr=("127.0.0.1", 0))
        transports.append(transport)
        return protocol, transport.get_extra_info("sockname")[1]

    yield start
    for transport in transports:
        transport.close()


@pytest.fixture
def start_unit(listen):
    async def start(variant="ecb", **options):
        return await listen(lambda: FakeGree(*VARIANTS[variant], **options))

    return start


def adapter_for(ctx, port):
    adapter = GreeAdapter(ctx)
    adapter.port = port
    adapter.discovery_targets = [("127.0.0.1", port), ("127.0.0.1", port)]
    adapter.timeout = adapter.bind_timeout = 0.1
    return adapter


def stored(port, cipher="ecb", key=DEVICE_KEY):
    return StoredDevice(
        id="d1",
        adapter_id="gree",
        brand="gree",
        unique_id=MAC,
        name="Salon",
        category=Category.CLIMATE,
        host="127.0.0.1",
        port=port,
        params={"cipher": cipher},
        credentials={"key": key} if key else {},
    )


async def paired(adapter):
    candidate = await adapter.probe("127.0.0.1")
    return candidate, await adapter.pair(candidate, {}, approval=None)


def climate_of(state):
    return next(cap for cap in state.capabilities if cap.type == "climate")


def setting_of(state, key):
    return next(setting for setting in state.settings if setting.key == key)


async def scanned(adapter, subnets=()):
    found = []
    scan = ScanContext(timeout=0.3, subnets=list(subnets), report=found.append)
    if not subnets:
        scan.in_scope = lambda ip: True  # the fake unit answers from loopback
    await adapter.discover(scan)
    return found, scan


# ---- packs -----------------------------------------------------------------------------------------


def test_packs_match_another_implementation():
    assert gree._unseal({"pack": VECTOR_ECB}, ECB_GENERIC) == VECTOR_PLAIN
    assert gree._unseal({"pack": VECTOR_GCM, "tag": VECTOR_TAG}, GCM_GENERIC) == VECTOR_PLAIN
    assert gree._seal("ecb", ECB_GENERIC, VECTOR_PLAIN) == {"pack": VECTOR_ECB}
    assert gree._seal("gcm", GCM_GENERIC, VECTOR_PLAIN) == {"pack": VECTOR_GCM, "tag": VECTOR_TAG}


@pytest.mark.parametrize(
    "packet",
    [
        {"pack": VECTOR_GCM, "tag": "AAAAAAAAAAAAAAAAAAAAAA=="},  # wrong tag
        {"pack": "AA" + VECTOR_GCM[2:], "tag": VECTOR_TAG},  # altered ciphertext
        {"pack": VECTOR_ECB[:-4]},  # not a whole number of blocks
        {"pack": base64.b64encode(b"\x00" * 16).decode()},  # opens to garbage
        {"pack": "@@not base64@@"},
        {"pack": 7},
        {},
    ],
)
def test_a_bad_pack_is_unreadable(packet):
    with pytest.raises(gree._Unreadable):
        gree._unseal(packet, GCM_GENERIC if "tag" in packet else ECB_GENERIC)


def test_a_pack_that_is_not_an_object_is_unreadable():
    with pytest.raises(gree._Unreadable):
        gree._unseal(ecb_seal(ECB_GENERIC, b'["}"]'), ECB_GENERIC)


@pytest.mark.parametrize("tail", [b"\x00", b" ", b"\xff"])
def test_firmware_padding_is_tolerated(tail):
    assert gree._unseal(ecb_seal(ECB_GENERIC, b'{"t":"dat"}', tail), ECB_GENERIC) == {"t": "dat"}
    assert gree._unseal(gcm_seal(GCM_GENERIC, b'{"t":"dat"}' + tail * 3), GCM_GENERIC) == {"t": "dat"}


# ---- discovery -------------------------------------------------------------------------------------


@pytest.mark.parametrize("variant", VARIANTS)
async def test_discovery_identifies_the_unit_once(ctx, start_unit, variant):
    _unit, port = await start_unit(variant)
    found, scan = await scanned(adapter_for(ctx, port))
    assert len(found) == 1
    candidate = found[0]
    assert candidate.unique_id == MAC and candidate.mac == "f4:91:1e:7a:ca:59" and candidate.brand == "gree"
    assert candidate.name == "Salon" and candidate.model is None  # "gree" is a placeholder, not a model
    assert candidate.status == ConnectionStatus.IDENTIFIED and candidate.control == "experimental" and candidate.account_free
    assert candidate.pairing.auth == AuthKind.NONE and candidate.details["ver"] == "V1.1.13"
    assert "127.0.0.1" in scan.claimed_ips


async def test_discovery_skips_out_of_scope_replies(ctx, start_unit):
    _unit, port = await start_unit()
    found, _scan = await scanned(adapter_for(ctx, port), [ipaddress.ip_network("192.168.1.0/24")])
    assert found == []


async def test_discovery_stops_when_cancelled(ctx, start_unit):
    unit, port = await start_unit()
    scan = ScanContext(timeout=30, subnets=[], report=lambda c: None)
    scan.cancelled.set()
    await asyncio.wait_for(adapter_for(ctx, port).discover(scan), timeout=1)
    assert unit.counts["scan"] == 0


@pytest.mark.parametrize(
    "answer",
    [
        b"not json",
        b"[1, 2]",
        b'{"t": "pack"}',
        b'{"t": "pack", "pack": 5, "cid": "f4911e7aca59"}',
        b'{"t": "other", "pack": "AAAA", "cid": "f4911e7aca59"}',
        b'{"t": "pack", "pack": "AAAA", "cid": "not a mac"}',
    ],
)
async def test_strangers_on_the_port_are_not_units(ctx, listen, answer):
    _stranger, port = await listen(lambda: Stranger(answer))
    adapter = adapter_for(ctx, port)
    found, _scan = await scanned(adapter)
    assert found == []
    assert await adapter.probe("127.0.0.1") is None


async def test_a_scan_reply_that_will_not_open_still_lists_the_unit(ctx, start_unit):
    _unit, port = await start_unit(private_scan=True)
    found, _scan = await scanned(adapter_for(ctx, port))
    assert found[0].unique_id == MAC and found[0].status == ConnectionStatus.DISCOVERED
    assert found[0].name == "Gree air conditioner ca59"


@pytest.mark.parametrize("mid", ["60", "13800", "9300"])
async def test_other_gree_appliances_are_shown_but_not_offered(ctx, start_unit, mid):
    _unit, port = await start_unit(mid=mid)
    adapter = adapter_for(ctx, port)
    found, _scan = await scanned(adapter)
    assert found[0].control == "detection_only" and found[0].status == ConnectionStatus.UNSUPPORTED
    with pytest.raises(UnsupportedCommand):
        await adapter.pair(found[0], {}, approval=None)


def test_a_datagram_built_to_exhaust_the_parser_is_ignored():
    assert gree._packet(b"[" * 1_000_000) is None


@pytest.mark.parametrize("name", ["gree", "", "7aca59", None])
async def test_placeholder_names_become_a_readable_one(ctx, start_unit, name):
    _unit, port = await start_unit(name=name)
    found, _scan = await scanned(adapter_for(ctx, port))
    assert found[0].name == "Gree air conditioner ca59"


async def test_network_text_is_sanitized(ctx, start_unit):
    hostile = "Salon\x00\x1b[2J" + "x" * 300
    _unit, port = await start_unit(name=hostile, version=hostile, mid=hostile)
    candidate = (await scanned(adapter_for(ctx, port)))[0][0]
    assert "\x00" not in candidate.name and "\x1b" not in candidate.name and len(candidate.name) <= 96
    for text in (candidate.details["ver"], candidate.details["mid"]):
        assert "\x00" not in text and "\x1b" not in text and len(text) <= 32


async def test_probe_checks_a_typed_address(ctx, start_unit):
    _unit, port = await start_unit("gcm")
    candidate = await adapter_for(ctx, port).probe("127.0.0.1")
    assert candidate.unique_id == MAC and candidate.sources == ["manual"] and candidate.protocol == "gree-udp-gcm"


async def test_probe_finds_nothing_at_a_silent_address(ctx, start_unit):
    _unit, port = await start_unit(silent_to=["scan"])
    assert await adapter_for(ctx, port).probe("127.0.0.1") is None


# ---- pairing ---------------------------------------------------------------------------------------


@pytest.mark.parametrize("variant, cipher", [("ecb", "ecb"), ("gcm", "gcm"), ("combined", "gcm")])
async def test_pairing_detects_the_encryption_and_proves_control(ctx, start_unit, variant, cipher):
    unit, port = await start_unit(variant)
    candidate, result = await paired(adapter_for(ctx, port))
    assert result.category == Category.CLIMATE and result.unique_id == MAC and result.mac == candidate.mac
    assert result.protocol == f"gree-udp-{cipher}" and result.params["cipher"] == cipher
    assert result.credentials == {"key": DEVICE_KEY}
    assert DEVICE_KEY not in json.dumps(result.params)
    assert unit.counts["status"] == 1  # the state was read back with the new key


async def test_the_bind_packet_has_the_documented_shape(ctx, start_unit):
    unit, port = await start_unit("gcm")
    await paired(adapter_for(ctx, port))
    bind = next(request for request in unit.requests if request["t"] == "pack" and request["i"] == 1)
    assert {key: bind[key] for key in ("cid", "uid", "tcid")} == {"cid": "app", "uid": 0, "tcid": MAC}
    assert json.loads(gcm_open(GCM_GENERIC, bind)) == {"mac": MAC, "t": "bind", "uid": 0}


async def test_a_lost_bind_reply_is_retried_after_a_fresh_scan(ctx, start_unit):
    unit, port = await start_unit(lose_binds=1)
    _candidate, result = await paired(adapter_for(ctx, port))
    assert result.params["cipher"] == "ecb" and unit.counts["bind"] == 2


async def test_a_restart_needs_no_new_bind(ctx, start_unit):
    unit, port = await start_unit("gcm")
    _candidate, result = await paired(adapter_for(ctx, port))
    restarted = adapter_for(ctx, port)
    state = await restarted.get_state(stored(port, result.params["cipher"], result.credentials["key"]))
    assert climate_of(state).target == 24 and unit.counts["bind"] == 1


async def test_pairing_a_unit_that_answers_but_will_not_bind(ctx, start_unit):
    _unit, port = await start_unit(silent_to=["bind"])
    with pytest.raises(PairingRejected) as caught:
        await paired(adapter_for(ctx, port))
    assert caught.value.code == "bind_failed" and "Lock device" in caught.value.recovery


@pytest.mark.parametrize(
    "bind_reply",
    [
        {"t": "bindok", "mac": MAC, "key": DEVICE_KEY, "r": 400},
        {"t": "bindok", "mac": MAC, "key": "short", "r": 200},
        {"t": "bindok", "mac": MAC, "key": 12345, "r": 200},
        {"t": "bindok", "mac": MAC},
        {"t": "other", "mac": MAC, "key": DEVICE_KEY},
    ],
)
async def test_pairing_rejects_a_bad_bind_reply(ctx, start_unit, bind_reply):
    _unit, port = await start_unit(bind_reply=bind_reply)
    with pytest.raises(PairingRejected):
        await paired(adapter_for(ctx, port))


async def test_bind_reply_type_is_read_in_any_case(ctx, start_unit):
    _unit, port = await start_unit(bind_reply={"t": "bindOk", "mac": MAC, "key": DEVICE_KEY})
    _candidate, result = await paired(adapter_for(ctx, port))
    assert result.credentials == {"key": DEVICE_KEY}


async def test_pairing_a_unit_that_stopped_answering(ctx, start_unit):
    unit, port = await start_unit()
    adapter = adapter_for(ctx, port)
    candidate = await adapter.probe("127.0.0.1")
    unit.silent_to = {"scan", "bind"}
    with pytest.raises(DeviceUnreachable):
        await adapter.pair(candidate, {}, approval=None)


async def test_pairing_fails_when_the_new_key_cannot_read_state(ctx, start_unit):
    _unit, port = await start_unit(silent_to=["status"])
    with pytest.raises(DeviceUnreachable):
        await paired(adapter_for(ctx, port))


async def test_pairing_refuses_a_unit_that_is_not_an_air_conditioner(ctx, start_unit):
    unit, port = await start_unit(mid="99999")
    del unit.props["SetTem"]
    with pytest.raises(UnsupportedCommand) as caught:
        await paired(adapter_for(ctx, port))
    assert caught.value.code == "unsupported_device"


async def test_pairing_without_an_address(ctx, start_unit):
    _unit, port = await start_unit()
    adapter = adapter_for(ctx, port)
    candidate = await adapter.probe("127.0.0.1")
    with pytest.raises(DeviceUnreachable):
        await adapter.pair(candidate.model_copy(update={"ip": None}), {}, approval=None)


# ---- state -----------------------------------------------------------------------------------------


@pytest.mark.parametrize("variant, cipher", [("ecb", "ecb"), ("gcm", "gcm"), ("combined", "gcm")])
async def test_state_in_each_encryption(ctx, start_unit, variant, cipher):
    _unit, port = await start_unit(variant)
    state = await adapter_for(ctx, port).get_state(stored(port, cipher))
    climate = climate_of(state)
    assert climate.mode == "cool" and climate.target == 24 and climate.current == 26 and climate.unit == "°C"
    assert climate.fan_mode == "auto" and climate.fan_modes == ["auto", "low", "medium", "high"]
    assert climate.modes == ["off", "auto", "cool", "dry", "fan_only", "heat"] and (climate.min, climate.max, climate.step) == (16, 30, 1)
    assert {"turn_on", "turn_off", "set_temperature", "set_hvac_mode", "set_fan_mode", "set_setting"} <= set(state.commands)


async def test_the_status_request_asks_for_every_field(ctx, start_unit):
    unit, port = await start_unit()
    await adapter_for(ctx, port).get_state(stored(port))
    inner = json.loads(ecb_open(DEVICE_KEY.encode(), unit.requests[-1]["pack"]))
    assert inner["t"] == "status" and inner["mac"] == MAC
    assert {"Pow", "Mod", "SetTem", "TemUn", "TemSen", "WdSpd", "SwUpDn", "SwingLfRig", "Tur", "Quiet", "Lig"} <= set(inner["cols"])


@pytest.mark.parametrize("code, name", [(0, "auto"), (1, "cool"), (2, "dry"), (3, "fan_only"), (4, "heat")])
async def test_modes(ctx, start_unit, code, name):
    _unit, port = await start_unit(props={"Mod": code})
    assert climate_of(await adapter_for(ctx, port).get_state(stored(port))).mode == name


async def test_a_unit_that_is_off_reads_off_whatever_its_mode(ctx, start_unit):
    _unit, port = await start_unit(props={"Pow": 0, "Mod": 4})
    assert climate_of(await adapter_for(ctx, port).get_state(stored(port))).mode == "off"


@pytest.mark.parametrize(
    "code, name, offered",
    [
        (1, "low", ["auto", "low", "medium", "high"]),
        (3, "medium", ["auto", "low", "medium", "high"]),
        (5, "high", ["auto", "low", "medium", "high"]),
        (2, "medium_low", ["auto", "low", "medium_low", "medium", "high"]),
        (4, "medium_high", ["auto", "low", "medium", "medium_high", "high"]),
    ],
)
async def test_fan_speeds(ctx, start_unit, code, name, offered):
    _unit, port = await start_unit(props={"WdSpd": code})
    climate = climate_of(await adapter_for(ctx, port).get_state(stored(port)))
    assert climate.fan_mode == name and climate.fan_modes == offered


@pytest.mark.parametrize(
    "raw, celsius",
    [
        (66, 26),  # Celsius plus 40, the documented form
        (40, 0),
        (90, 50),
        (26, 26),  # units that send plain Celsius
        (0, None),  # no sensor
        ("", None),
        (91, None),
        (-3, None),
    ],
)
async def test_room_temperature(ctx, start_unit, raw, celsius):
    _unit, port = await start_unit(props={"TemSen": raw})
    assert climate_of(await adapter_for(ctx, port).get_state(stored(port))).current == celsius


async def test_a_unit_without_a_sensor_column(ctx, start_unit):
    unit, port = await start_unit()
    del unit.props["TemSen"]
    assert climate_of(await adapter_for(ctx, port).get_state(stored(port))).current is None


async def test_a_fahrenheit_display_still_reads_celsius(ctx, start_unit):
    _unit, port = await start_unit(props={"TemUn": 1, "SetTem": 22, "TemRec": 1})
    climate = climate_of(await adapter_for(ctx, port).get_state(stored(port)))
    assert climate.target == 22 and climate.unit == "°C"


async def test_settings_list_only_what_the_unit_reports(ctx, start_unit):
    unit, port = await start_unit(props={"SwUpDn": 1, "SwingLfRig": 4, "Tur": 1, "Lig": 0})
    del unit.props["Quiet"]
    state = await adapter_for(ctx, port).get_state(stored(port))
    assert {setting.key for setting in state.settings} == {"swing_vertical", "swing_horizontal", "turbo", "display_light"}
    assert setting_of(state, "swing_vertical").value == "Full swing" and setting_of(state, "swing_vertical").kind == "select"
    assert setting_of(state, "swing_horizontal").value == "Centre"
    assert setting_of(state, "turbo").value is True and setting_of(state, "turbo").kind == "switch"
    assert setting_of(state, "display_light").value is False


async def test_turbo_and_quiet_are_unavailable_while_off(ctx, start_unit):
    _unit, port = await start_unit(props={"Pow": 0})
    state = await adapter_for(ctx, port).get_state(stored(port))
    assert not setting_of(state, "turbo").available and setting_of(state, "turbo").requires == "AC on"
    assert setting_of(state, "display_light").available


# ---- commands --------------------------------------------------------------------------------------


@pytest.mark.parametrize(
    "command, params, expected",
    [
        ("turn_on", {}, {"Pow": 1}),
        ("turn_off", {}, {"Pow": 0}),
        ("set_hvac_mode", {"mode": "off"}, {"Pow": 0}),
        ("set_hvac_mode", {"mode": "heat"}, {"Pow": 1, "Mod": 4}),
        ("set_hvac_mode", {"mode": "fan_only"}, {"Pow": 1, "Mod": 3}),
        ("set_fan_mode", {"fan_mode": "high"}, {"WdSpd": 5}),
        ("set_fan_mode", {"fan_mode": "medium_low"}, {"WdSpd": 2}),
        ("set_setting", {"key": "swing_vertical", "value": "Lower"}, {"SwUpDn": 5}),
        ("set_setting", {"key": "swing_horizontal", "value": "Right"}, {"SwingLfRig": 6}),
        ("set_setting", {"key": "display_light", "value": False}, {"Lig": 0}),
    ],
)
@pytest.mark.parametrize("variant, cipher", [("ecb", "ecb"), ("gcm", "gcm")])
async def test_commands_are_confirmed_by_reading_back(ctx, start_unit, variant, cipher, command, params, expected):
    unit, port = await start_unit(variant, props={"Pow": 0 if expected.get("Pow") else 1})
    outcome = await adapter_for(ctx, port).execute_command(stored(port, cipher), command, params)
    assert outcome.result.status == "confirmed" and outcome.state is not None
    assert unit.commands == [expected]


async def test_the_command_packet_has_the_documented_shape(ctx, start_unit):
    unit, port = await start_unit("gcm")
    await adapter_for(ctx, port).execute_command(stored(port, "gcm"), "turn_off", {})
    command = next(request for request in unit.requests if request["i"] == 0 and json.loads(gcm_open(DEVICE_KEY.encode(), request))["t"] == "cmd")
    assert command["t"] == "pack" and command["cid"] == "app" and command["tcid"] == MAC and command["uid"] == 0
    assert json.loads(gcm_open(DEVICE_KEY.encode(), command)) == {"t": "cmd", "mac": MAC, "opt": ["Pow"], "p": [0]}


@pytest.mark.parametrize("asked, sent", [(21, 21), (21.6, 22), (5, 16), (40, 30)])
async def test_set_temperature_rounds_and_clamps(ctx, start_unit, asked, sent):
    unit, port = await start_unit()
    outcome = await adapter_for(ctx, port).execute_command(stored(port), "set_temperature", {"temperature": asked})
    assert unit.commands == [{"TemUn": 0, "SetTem": sent, "TemRec": 0}]
    assert climate_of(outcome.state).target == sent and outcome.result.status == "confirmed"


async def test_set_temperature_leaves_a_fahrenheit_display_alone(ctx, start_unit):
    unit, port = await start_unit(props={"TemUn": 1})
    await adapter_for(ctx, port).execute_command(stored(port), "set_temperature", {"temperature": 22})
    assert unit.commands == [{"TemUn": 1, "SetTem": 22, "TemRec": 0}] and unit.props["TemUn"] == 1


@pytest.mark.parametrize("active", ["Tur", "Quiet"])
async def test_a_chosen_fan_speed_ends_turbo_and_quiet(ctx, start_unit, active):
    unit, port = await start_unit(props={active: 1})
    await adapter_for(ctx, port).execute_command(stored(port), "set_fan_mode", {"fan_mode": "low"})
    assert unit.commands == [{"WdSpd": 1, active: 0}]


@pytest.mark.parametrize("key, column, rival", [("turbo", "Tur", "Quiet"), ("quiet", "Quiet", "Tur")])
async def test_turbo_and_quiet_exclude_each_other(ctx, start_unit, key, column, rival):
    unit, port = await start_unit(props={rival: 1})
    adapter = adapter_for(ctx, port)
    await adapter.execute_command(stored(port), "set_setting", {"key": key, "value": True})
    assert unit.commands == [{column: 1, rival: 0}]
    await adapter.execute_command(stored(port), "set_setting", {"key": key, "value": False})
    assert unit.commands[-1] == {column: 0}


async def test_turbo_is_refused_while_the_unit_is_off(ctx, start_unit):
    unit, port = await start_unit(props={"Pow": 0})
    with pytest.raises(AdapterError) as caught:
        await adapter_for(ctx, port).execute_command(stored(port), "set_setting", {"key": "turbo", "value": True})
    assert caught.value.code == "setting_unavailable" and unit.commands == []


@pytest.mark.parametrize(
    "command, params",
    [
        ("set_temperature", {}),
        ("set_temperature", {"temperature": "warm"}),
        ("set_hvac_mode", {"mode": "party"}),
        ("set_fan_mode", {"fan_mode": "hurricane"}),
        ("set_setting", {"key": "swing_vertical", "value": "Sideways"}),
        ("set_setting", {"key": "display_light", "value": "on"}),
        ("set_setting", {"key": "display_light"}),
    ],
)
async def test_bad_parameters_never_reach_the_unit(ctx, start_unit, command, params):
    unit, port = await start_unit()
    with pytest.raises(AdapterError) as caught:
        await adapter_for(ctx, port).execute_command(stored(port), command, params)
    assert caught.value.code == "bad_params" and unit.commands == []


async def test_unknown_commands_and_settings(ctx, start_unit):
    unit, port = await start_unit()
    del unit.props["SwingLfRig"]
    adapter = adapter_for(ctx, port)
    with pytest.raises(UnsupportedCommand):
        await adapter.execute_command(stored(port), "set_brightness", {"brightness": 5})
    with pytest.raises(UnsupportedCommand):
        await adapter.execute_command(stored(port), "set_setting", {"key": "self_destruct", "value": True})
    with pytest.raises(UnsupportedCommand):
        await adapter.execute_command(stored(port), "set_setting", {"key": "swing_horizontal", "value": "Left"})


async def test_a_reply_of_the_wrong_type_is_not_taken_as_success(ctx, listen):
    sealed = ecb_seal(DEVICE_KEY.encode(), json.dumps({"t": "dat", "r": 200, "cols": ["Pow"], "dat": [1]}).encode())
    _stranger, port = await listen(lambda: Stranger(json.dumps({"t": "pack", **sealed}).encode()))
    with pytest.raises(AdapterError) as caught:
        await adapter_for(ctx, port).execute_command(stored(port), "turn_off", {})
    assert caught.value.code == "bad_reply"


async def test_a_refused_command_is_an_error(ctx, start_unit):
    _unit, port = await start_unit(command_code=400)
    with pytest.raises(AdapterError) as caught:
        await adapter_for(ctx, port).execute_command(stored(port), "turn_off", {})
    assert caught.value.code == "device_rejected"


async def test_a_change_the_unit_ignored_is_not_confirmed(ctx, start_unit):
    _unit, port = await start_unit(ignores=["Mod"], props={"Mod": 1})
    outcome = await adapter_for(ctx, port).execute_command(stored(port), "set_hvac_mode", {"mode": "heat"})
    assert outcome.result.status == "assumed" and "old value" in outcome.result.message
    assert climate_of(outcome.state).mode == "cool"  # what the unit really says


async def test_a_command_with_no_read_back_is_not_confirmed(ctx, start_unit):
    _unit, port = await start_unit(silent_to=["read_back"])
    outcome = await adapter_for(ctx, port).execute_command(stored(port), "turn_off", {})
    assert outcome.result.status == "assumed" and outcome.state is None


# ---- failures --------------------------------------------------------------------------------------


async def test_an_unreachable_unit(ctx, listen):
    transport_port = (await listen(asyncio.DatagramProtocol))[1]
    with pytest.raises(DeviceUnreachable):
        await adapter_for(ctx, transport_port).get_state(stored(transport_port))


async def test_a_reply_under_another_key_asks_to_pair_again(ctx, start_unit):
    _unit, port = await start_unit(answer_with_key="0000000000000000")
    with pytest.raises(AuthRequired) as caught:
        await adapter_for(ctx, port).get_state(stored(port))
    assert caught.value.code == "device_auth_failed"


async def test_a_lost_key_asks_to_pair_again(ctx, start_unit):
    _unit, port = await start_unit()
    with pytest.raises(AuthRequired) as caught:
        await adapter_for(ctx, port).get_state(stored(port, key=None))
    assert caught.value.code == "credentials_missing"


@pytest.mark.parametrize(
    "inner",
    [
        {"t": "res", "r": 200},
        {"t": "dat", "r": 200, "cols": ["Pow"], "dat": []},
        {"t": "dat", "r": 200, "cols": "Pow", "dat": [1]},
        {"t": "dat", "r": 200, "cols": ["Mod"], "dat": [1]},
        {"t": "dat", "r": 500, "cols": ["Pow"], "dat": [1]},
    ],
)
async def test_a_malformed_status_reply_is_an_error(ctx, listen, inner):
    sealed = ecb_seal(DEVICE_KEY.encode(), json.dumps(inner).encode())
    _stranger, port = await listen(lambda: Stranger(json.dumps({"t": "pack", **sealed}).encode()))
    with pytest.raises(AdapterError) as caught:
        await adapter_for(ctx, port).get_state(stored(port))
    assert caught.value.code in {"bad_reply", "device_rejected"}


async def test_the_key_never_reaches_the_logs(ctx, start_unit, caplog):
    _unit, port = await start_unit("gcm")
    adapter = adapter_for(ctx, port)
    with caplog.at_level(logging.DEBUG):
        candidate, result = await paired(adapter)
        await adapter.execute_command(stored(port, "gcm"), "turn_off", {})
    assert caplog.records  # the check below means nothing if nothing was logged
    assert all(DEVICE_KEY not in str(vars(record)) for record in caplog.records)
    assert DEVICE_KEY not in repr(candidate) and DEVICE_KEY not in json.dumps(result.params)


# ---- metadata --------------------------------------------------------------------------------------


def test_the_metadata_is_honest():
    info = GreeAdapter.info
    assert (info.id, info.brands) == ("gree", ["gree"]) and info.categories == [Category.CLIMATE]
    assert info.status == SupportLevel.EXPERIMENTAL and info.verified_models == []
    assert info.account_free is True and info.library is None and info.auth == AuthKind.NONE
    assert GreeAdapter.poll_interval == 30


def test_the_registry_can_load_it(ctx):
    registry = AdapterRegistry(ctx, modules=[("cube_gateway.adapters.gree", "GreeAdapter")])
    assert list(registry.adapters) == ["gree"] and not registry.failed


async def test_join_wifi_sends_the_plain_packet_and_accepts_silence(monkeypatch):
    sent: list = []

    async def fake_request(host, port, payload, **kwargs):
        sent.append((host, port, json.loads(payload)))
        raise gree.DeviceUnreachable("no reply")

    monkeypatch.setattr(gree._lan, "udp_request", fake_request)
    await gree.join_wifi("192.168.1.1", "Home", "secret-pw")
    assert sent == [("192.168.1.1", 7000, {"psw": "secret-pw", "ssid": "Home", "t": "wlan"})]
