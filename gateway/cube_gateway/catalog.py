"""The brands the app offers, built from the adapters actually loaded and the provisioning plugins.

Nothing here is a compatibility claim on its own: a brand's status and methods come from its adapters'
declared support level and availability in this deployment (e.g. the LG ThinQ path is unavailable until
CUBE_RETHINK_MQTT_URL is set), and from the provisioning plugins' own declarations.
"""

from __future__ import annotations

import os
from dataclasses import dataclass

from .adapters.base import DeviceAdapter
from .adapters.registry import AdapterRegistry
from .config import Settings
from .models import AuthKind, Brand, Category, ConnectionMethod, SupportLevel
from .provisioning.plugins import PLUGINS

_RANK = {SupportLevel.SUPPORTED: 0, SupportLevel.LIMITED: 1, SupportLevel.EXPERIMENTAL: 2, SupportLevel.UNSUPPORTED: 3}


@dataclass(frozen=True)
class BrandEntry:
    id: str
    name: str
    logo: str
    summary: str
    adapters: tuple[str, ...]
    aliases: tuple[str, ...] = ()
    notes: tuple[str, ...] = ()
    #: Why there is no in-app Wi-Fi setup for this brand (shown on a disabled "Connect new device").
    no_setup_reason: str | None = None


BRANDS: list[BrandEntry] = [
    BrandEntry(
        "lg",
        "LG",
        "lg",
        "webOS TVs pair locally. ThinQ air conditioners and appliances work through ReThink (experimental).",
        ("lg_webos", "lg_thinq_rethink"),
        aliases=("LG Electronics", "webOS", "ThinQ"),
        notes=(
            "webOS TVs: approve the request on the TV when pairing.",
            "ThinQ appliances only through a ReThink server, for the models in ReThink's support list.",
        ),
        no_setup_reason="Connect an LG TV to Wi-Fi from the TV's own settings, then use Find existing device.",
    ),
    BrandEntry(
        "samsung",
        "Samsung",
        "samsung",
        "Samsung Smart TVs (2016 and later) over their local WebSocket API.",
        ("samsung_tv",),
        aliases=("Samsung Electronics", "Tizen"),
        notes=("Samsung appliances use SmartThings, which has no local API; they are not supported locally.",),
        no_setup_reason="Connect the TV to Wi-Fi from its own settings, then use Find existing device.",
    ),
    BrandEntry(
        "sonoff",
        "SONOFF",
        "sonoff",
        "DIY mode devices are controlled locally without an account; eWeLink LAN mode needs the device key.",
        ("sonoff_lan",),
        aliases=("ITEAD", "eWeLink"),
        notes=(
            "DIY mode is documented by ITEAD for BASICR3, RFR3 and MINI; other models are experimental.",
            "Devices set up with the eWeLink app encrypt their LAN traffic: enter the device key to control them.",
        ),
    ),
    BrandEntry(
        "tuya",
        "Tuya / Smart Life",
        "tuya",
        "Local control once you have the device's local key.",
        ("tuya_local",),
        aliases=("Smart Life", "Tuya Smart", "Gosund", "Teckin", "Nedis"),
        notes=(
            "Discovery does not reveal the local key; get it once with tinytuya's wizard (Tuya IoT developer account).",
        ),
        no_setup_reason="Tuya devices join Wi-Fi only through the Smart Life or Tuya app, which needs an account. "
        "Once connected, add them here with their local key.",
    ),
    BrandEntry(
        "tplink",
        "TP-Link Kasa / Tapo",
        "tplink",
        "Kasa and Tapo plugs, switches and bulbs on the local network.",
        ("tplink",),
        aliases=("Kasa", "Tapo", "TP-Link"),
        notes=(
            "Tapo and newer Kasa firmware authenticate with your TP-Link account email and password; the gateway "
            "uses them locally and never sends them to TP-Link.",
        ),
    ),
    BrandEntry(
        "xiaomi",
        "Xiaomi / Yeelight",
        "xiaomi",
        "Yeelight lights with LAN Control turned on.",
        ("yeelight",),
        aliases=("Yeelight", "Mi", "Mijia"),
        notes=(
            "Turn on LAN Control once in the Yeelight app for each light.",
            "Other Mi Home devices need a per-device token and are not supported yet.",
        ),
        no_setup_reason="Yeelight lights join Wi-Fi through the Yeelight app. Then turn on LAN Control and find them here.",
    ),
    BrandEntry("shelly", "Shelly", "shelly", "Relays, plugs, dimmers and shutters with a documented local API.", ("shelly",), aliases=("Allterco",)),
    BrandEntry(
        "wiz",
        "Philips WiZ",
        "wiz",
        "WiZ lights over their local UDP protocol.",
        ("wiz",),
        aliases=("WiZ", "Philips Smart LED"),
        no_setup_reason="WiZ lights join Wi-Fi through the WiZ app. Afterwards they are controlled locally.",
    ),
    BrandEntry(
        "lifx",
        "LIFX",
        "lifx",
        "LIFX lights over LIFX's published LAN protocol.",
        ("lifx",),
        no_setup_reason="LIFX lights join Wi-Fi through the LIFX app. Afterwards they are controlled locally.",
    ),
    BrandEntry("wled", "WLED", "wled", "WLED LED controllers over their JSON API.", ("wled",)),
    BrandEntry(
        "daikin",
        "Daikin",
        "daikin",
        "Daikin Wi-Fi adapters with the local HTTP API (experimental).",
        ("daikin",),
        notes=("BRP069 adapters answer locally; newer BRP072C/SKYFi adapters need a key or are not supported.",),
        no_setup_reason="Set up the Daikin Wi-Fi adapter with Daikin's app, then find it here.",
    ),
    BrandEntry(
        "midea",
        "Midea",
        "midea",
        "Midea air conditioners over the local protocol, with the device token and key.",
        ("midea",),
        aliases=("Comfee", "Inventor", "Pioneer"),
        notes=("Newer (V3) units need a token and key obtained once from Midea's service.",),
        no_setup_reason="Midea units join Wi-Fi through Midea's app (account required). Then find them here.",
    ),
    BrandEntry(
        "other",
        "Other / Unknown brand",
        "other",
        "See what the gateway finds on your network. Unknown devices are shown, not controlled.",
        ("generic",),
        no_setup_reason="Set up the device with its maker's instructions, then scan to see whether the gateway recognises it.",
    ),
]

BRANDS_BY_ID = {brand.id: brand for brand in BRANDS}

#: How each adapter's "find on Wi-Fi" method reads in the app.
FIND_TEXT: dict[str, tuple[str, str]] = {
    "lg_webos": ("Find an LG TV", "Finds webOS TVs on your network. You approve the connection on the TV."),
    "lg_thinq_rethink": ("Find an appliance on ReThink", "Lists LG appliances already connected to your ReThink server."),
    "samsung_tv": ("Find a Samsung TV", "Finds Samsung TVs on your network. You allow the connection on the TV."),
    "tuya_local": ("Find a Tuya device", "Finds Tuya devices on your network. You'll need each device's local key."),
    "sonoff_lan": ("Find a SONOFF device", "Finds devices in DIY or eWeLink LAN mode on your network."),
}


def _find_method(registry: AdapterRegistry, adapter_id: str) -> ConnectionMethod | None:
    if adapter_id not in registry.adapters:
        return None
    adapter = registry.adapters[adapter_id]
    info = adapter.info
    available, reason = adapter.available()
    title, description = FIND_TEXT.get(adapter_id, ("Find existing device", "Finds devices already on your Wi-Fi."))
    return ConnectionMethod(
        id=f"find:{adapter_id}",
        group="existing",
        title=title,
        description=description,
        adapter_id=adapter_id,
        transport="lan",
        status=info.status,
        manufacturer_account=info.auth == AuthKind.ACCOUNT_CREDENTIALS,
        user_approval=info.auth in {AuthKind.APPROVE_ON_DEVICE, AuthKind.PIN},
        local_key=info.auth == AuthKind.LOCAL_KEY,
        available=available,
        unavailable_reason=reason,
    )


def build_brands(registry: AdapterRegistry, settings: Settings) -> list[Brand]:
    brands: list[Brand] = []
    for entry in BRANDS:
        adapters = [registry.adapters[a] for a in entry.adapters if a in registry.adapters]
        methods: list[ConnectionMethod] = [m for a in entry.adapters if (m := _find_method(registry, a))]

        plugins = [p for p in PLUGINS if p.brand_id == entry.id]
        for plugin in plugins:
            available, reason = True, None
            if plugin.adapter_id not in registry.adapters:
                available, reason = False, "The adapter for this brand is not loaded on this gateway."
            elif plugin.transport == "gateway" and not settings.softap_interface:
                available, reason = False, "Needs a gateway with a Wi-Fi radio set as CUBE_SOFTAP_INTERFACE."
            elif plugin.id == "lg_thinq_softap" and not os.environ.get("CUBE_RETHINK_SETUP_CMD"):
                available, reason = False, "Needs ReThink's rethink-setup on the gateway (CUBE_RETHINK_SETUP_CMD), or run it from a laptop."
            else:
                ok, why = registry.adapters[plugin.adapter_id].available()
                if not ok:
                    available, reason = False, why
            methods.append(
                ConnectionMethod(
                    id=f"setup:{plugin.id}",
                    group="advanced" if plugin.transport == "gateway" else "new",
                    title=plugin.title,
                    description=plugin.description,
                    adapter_id=plugin.adapter_id,
                    plugin_id=plugin.id,
                    transport=plugin.transport,  # type: ignore[arg-type]
                    status=plugin.status,
                    manufacturer_account=plugin.manufacturer_account,
                    hotspot_password={"none": "none", "fixed": "verified_rule"}.get(plugin.hotspot.kind, "user"),  # type: ignore[arg-type]
                    user_approval=plugin.user_approval,
                    available=available,
                    unavailable_reason=reason,
                )
            )
        if not any(m.group == "new" for m in methods):
            methods.append(
                ConnectionMethod(
                    id="setup:none",
                    group="new",
                    title="Connect new device",
                    description=entry.no_setup_reason or "This brand has no supported in-app Wi-Fi setup.",
                    adapter_id=entry.adapters[0],
                    transport="guided",
                    status=SupportLevel.UNSUPPORTED,
                    available=False,
                    unavailable_reason=entry.no_setup_reason,
                )
            )
        for adapter in adapters:
            if type(adapter).probe is not DeviceAdapter.probe and adapter.info.id != "generic":
                methods.append(
                    ConnectionMethod(
                        id=f"manual:{adapter.info.id}",
                        group="advanced",
                        title="Add by IP address",
                        description="For a device that is on your network but not found by scanning (e.g. mDNS blocked by the router).",
                        adapter_id=adapter.info.id,
                        transport="lan",
                        status=adapter.info.status,
                        local_key=adapter.info.auth == AuthKind.LOCAL_KEY,
                        available=adapter.available()[0],
                        unavailable_reason=adapter.available()[1],
                    )
                )

        statuses = [a.info.status for a in adapters] or [SupportLevel.UNSUPPORTED]
        categories: list[Category] = []
        for adapter in adapters:
            categories += [c for c in adapter.info.categories if c not in categories]
        brands.append(
            Brand(
                id=entry.id,
                name=entry.name,
                aliases=list(entry.aliases),
                logo=entry.logo,
                status=min(statuses, key=lambda s: _RANK[SupportLevel(s)]),
                summary=entry.summary,
                account_free=any(a.info.account_free for a in adapters),
                categories=categories,
                adapters=[a.info.id for a in adapters],
                methods=methods,
                notes=list(entry.notes),
            )
        )
    return brands
