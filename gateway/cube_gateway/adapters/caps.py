"""Builders for normalized capabilities and readings, so adapters describe devices the same way."""

from __future__ import annotations

import colorsys
import time
from typing import Any

from ..models import Capability, Reading


def _now() -> float:
    return time.time()


def power(value: bool | None, *, key: str = "power", label: str = "Power", confirmed: bool = True) -> Capability:
    state = "unknown" if value is None else ("on" if value else "off")
    return Capability(key=key, type="power", label=label, value=state, confirmed=confirmed, updated_at=_now())


def brightness(percent: float | None, *, key: str = "brightness", label: str = "Brightness", confirmed: bool = True) -> Capability:
    value = None if percent is None else max(0, min(100, round(percent)))
    return Capability(key=key, type="brightness", label=label, value=value, min=0, max=100, step=1, confirmed=confirmed, updated_at=_now())


def color_temp(kelvin: float | None, low: float, high: float, *, key: str = "color_temp", confirmed: bool = True) -> Capability:
    value = None if kelvin is None else round(kelvin)
    return Capability(key=key, type="color_temp", label="White temperature", value=value, min=low, max=high, step=100, confirmed=confirmed, updated_at=_now())


def color(h: float | None, s: float | None, *, key: str = "color", confirmed: bool = True) -> Capability:
    value = None if h is None or s is None else {"h": round(h) % 360, "s": max(0, min(100, round(s)))}
    return Capability(key=key, type="color", label="Colour", value=value, confirmed=confirmed, updated_at=_now())


def climate(
    *,
    current: float | None,
    target: float | None,
    mode: str | None,
    modes: list[str],
    fan_mode: str | None = None,
    fan_modes: list[str] | None = None,
    low: float = 16,
    high: float = 30,
    step: float = 1,
    unit: str = "°C",
    key: str = "climate",
    confirmed: bool = True,
) -> Capability:
    return Capability(
        key=key,
        type="climate",
        label="Climate",
        current=current,
        target=target,
        mode=mode,
        modes=modes,
        fan_mode=fan_mode,
        fan_modes=fan_modes or [],
        min=low,
        max=high,
        step=step,
        unit=unit,
        confirmed=confirmed,
        updated_at=_now(),
    )


def media(
    *,
    state: str | None,
    volume: float | None = None,
    muted: bool | None = None,
    source: str | None = None,
    sources: list[str] | None = None,
    key: str = "media",
    confirmed: bool = True,
) -> Capability:
    return Capability(
        key=key,
        type="media",
        label="Media",
        state=state,
        volume=volume,
        muted=muted,
        source=source,
        sources=sources or [],
        min=0,
        max=100,
        step=1,
        confirmed=confirmed,
        updated_at=_now(),
    )


def fan(percentage: float | None, *, presets: list[str] | None = None, preset: str | None = None, key: str = "fan", confirmed: bool = True) -> Capability:
    return Capability(key=key, type="fan", label="Fan", percentage=percentage, preset=preset, presets=presets or [], confirmed=confirmed, updated_at=_now())


def reading(key: str, label: str, value: Any, unit: str | None = None, device_class: str | None = None) -> Reading:
    return Reading(key=key, label=label, value=value, unit=unit, device_class=device_class)


def commands_for(capabilities: list[Capability]) -> list[str]:
    """The normalized commands that follow from a device's capabilities."""
    types = {cap.type for cap in capabilities}
    commands: list[str] = []
    if "power" in types:
        commands += ["turn_on", "turn_off", "toggle"]
    if "brightness" in types:
        commands.append("set_brightness")
    if "color" in types:
        commands.append("set_color")
    if "color_temp" in types:
        commands.append("set_color_temp")
    for cap in capabilities:
        if cap.type == "climate":
            commands += ["set_temperature", "set_hvac_mode"] + (["set_fan_mode"] if cap.fan_modes else [])
            if "off" in cap.modes and "turn_off" not in commands:
                commands += ["turn_on", "turn_off"]
        if cap.type == "fan":
            commands.append("set_fan_speed")
    return list(dict.fromkeys(commands))


# ---- colour conversions ----------------------------------------------------------------------------


def hs_to_rgb(h: float, s: float, v: float = 100) -> tuple[int, int, int]:
    r, g, b = colorsys.hsv_to_rgb((h % 360) / 360, max(0, min(100, s)) / 100, max(0, min(100, v)) / 100)
    return round(r * 255), round(g * 255), round(b * 255)


def rgb_to_hs(r: int, g: int, b: int) -> tuple[float, float]:
    h, s, _v = colorsys.rgb_to_hsv(r / 255, g / 255, b / 255)
    return round(h * 360, 1), round(s * 100, 1)


def clamp(value: Any, low: float, high: float, name: str) -> float:
    from .base import AdapterError

    try:
        number = float(value)
    except (TypeError, ValueError) as error:
        raise AdapterError(f"{name} must be a number.", code="bad_params") from error
    return max(low, min(high, number))


def param(params: dict[str, Any], name: str) -> Any:
    from .base import AdapterError

    if name not in params:
        raise AdapterError(f"Missing params.{name}.", code="bad_params")
    return params[name]
