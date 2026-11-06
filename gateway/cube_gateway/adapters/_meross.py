"""The Meross appliance protocol: message envelope, signatures, topics and state mapping.

Every message is JSON {"header": {...}, "payload": {...}}, the same over HTTP on the setup network and over MQTT.
`sign` is md5(messageId + key + timestamp), with the key given to the device during setup. Facts come from
bytespider/Meross (ISC) and krahabb/meross_lan (MIT), including real device traces; the code here is written
for the gateway. The app has the setup half in frontend/src/features/provisioning/services/merossSoftap.ts.

A device publishes on /appliance/<uuid>/publish and listens on /appliance/<uuid>/subscribe. It answers on the topic
named in the request's `from`, so requests name its own publish topic: that is all its broker login may write.
"""

from __future__ import annotations

import hashlib
import re
import secrets
import time
from typing import Any

from . import caps
from .base import DeviceState

NS_ALL = "Appliance.System.All"
NS_ABILITY = "Appliance.System.Ability"
NS_CLOCK = "Appliance.System.Clock"
NS_BIND = "Appliance.Control.Bind"
NS_CONSUMPTION_CONFIG = "Appliance.Control.ConsumptionConfig"
NS_TOGGLE = "Appliance.Control.Toggle"
NS_TOGGLEX = "Appliance.Control.ToggleX"
NS_LIGHT = "Appliance.Control.Light"
NS_ELECTRICITY = "Appliance.Control.Electricity"

GET = "GET"
SET = "SET"
PUSH = "PUSH"
GETACK = "GETACK"
SETACK = "SETACK"
ERROR = "ERROR"

#: Bits of a light's `capacity`.
LIGHT_RGB = 1
LIGHT_TEMPERATURE = 2
LIGHT_LUMINANCE = 4
#: Meross expresses white temperature as 1 (warm) to 100 (cold); the range in Kelvin is the usual bulb's, not protocol.
KELVIN_MIN = 2700
KELVIN_MAX = 6500

UUID = re.compile(r"^[0-9a-f]{32}$")
MAC = re.compile(r"^[0-9a-fA-F]{2}(:[0-9a-fA-F]{2}){5}$")
_TOPIC = re.compile(r"^/appliance/([0-9a-f]{32})/publish$")


def _md5(text: str) -> str:
    return hashlib.md5(text.encode(), usedforsecurity=False).hexdigest()


def signature(message_id: str, key: str, timestamp: int) -> str:
    return _md5(f"{message_id}{key}{timestamp}")


def device_password(mac: str, key: str, user_id: str | int) -> str:
    """The password a device logs in to the broker with, derived by its firmware from what setup gave it.
    `mac` must be spelled exactly as the device reports it."""
    return f"{user_id}_{_md5(f'{mac}{key}')}"


def request_topic(uuid: str) -> str:
    return f"/appliance/{uuid}/subscribe"


def response_topic(uuid: str) -> str:
    return f"/appliance/{uuid}/publish"


def uuid_of(topic: str) -> str | None:
    match = _TOPIC.match(topic)
    return match.group(1) if match else None


def build(namespace: str, method: str, payload: dict[str, Any], key: str, reply_topic: str, message_id: str | None = None) -> dict[str, Any]:
    message_id = message_id or secrets.token_hex(16)
    timestamp = int(time.time())
    return {
        "header": {
            "messageId": message_id,
            "namespace": namespace,
            "method": method,
            "payloadVersion": 1,
            "from": reply_topic,
            "timestamp": timestamp,
            "timestampMs": 0,
            "sign": signature(message_id, key, timestamp),
        },
        "payload": payload,
    }


def push_reply(header: dict[str, Any], payload: dict[str, Any]) -> dict[str, Any]:
    """The answer to a device's PUSH repeats its header: the real broker does not sign these again."""
    return {"header": {**header, "triggerSrc": "CloudControl"}, "payload": payload}


# ---- state ----------------------------------------------------------------------------------------


def _toggles(everything: dict[str, Any]) -> list[dict[str, Any]]:
    """Channels from Appliance.System.All: `togglex` on current firmware, `toggle` on older plugs."""
    digest = everything.get("digest") or {}
    togglex = digest.get("togglex")
    if isinstance(togglex, dict):
        togglex = [togglex]
    if isinstance(togglex, list) and togglex:
        return [t for t in togglex if isinstance(t, dict)]
    toggle = (everything.get("control") or {}).get("toggle") or digest.get("toggle")
    return [{"channel": 0, "onoff": toggle.get("onoff")}] if isinstance(toggle, dict) else []


def kelvin_to_meross(kelvin: float) -> int:
    return round((kelvin - KELVIN_MIN) / (KELVIN_MAX - KELVIN_MIN) * 99) + 1


def meross_to_kelvin(value: float) -> int:
    return round(KELVIN_MIN + (value - 1) / 99 * (KELVIN_MAX - KELVIN_MIN))


def to_state(everything: dict[str, Any], electricity: dict[str, Any] | None = None, light_capacity: int = 0) -> DeviceState:
    capabilities = []
    toggles = _toggles(everything)
    if len(toggles) == 1:
        capabilities.append(caps.power(toggles[0].get("onoff") == 1))
    for toggle in toggles if len(toggles) > 1 else []:
        channel = int(toggle.get("channel") or 0)
        # On power strips channel 0 is the whole strip.
        capabilities.append(caps.power(toggle.get("onoff") == 1, key=f"power:{channel}", label=f"Outlet {channel}" if channel else "All outlets"))
    light = (everything.get("digest") or {}).get("light")
    if isinstance(light, dict):
        supported = light_capacity or int(light.get("capacity") or 0)
        if isinstance(light.get("luminance"), int | float) and light["luminance"] >= 0:
            capabilities.append(caps.brightness(light["luminance"]))
        if supported & LIGHT_RGB and isinstance(light.get("rgb"), int):
            rgb = light["rgb"]
            capabilities.append(caps.color(*caps.rgb_to_hs((rgb >> 16) & 0xFF, (rgb >> 8) & 0xFF, rgb & 0xFF)))
        if supported & LIGHT_TEMPERATURE and isinstance(light.get("temperature"), int | float) and light["temperature"] >= 1:
            capabilities.append(caps.color_temp(meross_to_kelvin(light["temperature"]), KELVIN_MIN, KELVIN_MAX))
    readings = []
    if electricity:
        # Device units: mW, mA and tenths of a volt.
        if isinstance(electricity.get("power"), int | float):
            readings.append(caps.reading("power_w", "Power", round(electricity["power"] / 1000, 1), "W", "power"))
        if isinstance(electricity.get("voltage"), int | float):
            readings.append(caps.reading("voltage", "Voltage", round(electricity["voltage"] / 10, 1), "V", "voltage"))
        if isinstance(electricity.get("current"), int | float):
            readings.append(caps.reading("current", "Current", round(electricity["current"] / 1000, 3), "A", "current"))
    return DeviceState(capabilities=capabilities, readings=readings, commands=caps.commands_for(capabilities))
