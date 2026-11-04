"""Provisioning plugins: how a factory-new device of one brand gets onto the home Wi-Fi.

Each plugin declares exactly what it needs (prompt section 5D): brands, models and firmware it is known to
work with, its authentication, whether it needs a manufacturer account, a hotspot password or user approval,
and whether local control is available afterwards. A plugin never claims more than its sources show.

Hotspot passwords: a plugin only fills in a password from a published, model-specific default
(`HotspotRule.verified_models`). For any other model the user types it. Nothing is guessed or brute-forced.

Transports:
- phone:   the app joins the device's hotspot and runs the documented setup call itself
           (src/services/provisioning/ in the app). The home Wi-Fi password goes phone -> device only.
- guided:  the app joins the hotspot and opens the device's own setup page; the user enters the Wi-Fi there.
- gateway: the gateway joins the hotspot with its own Wi-Fi radio (CUBE_SOFTAP_INTERFACE) and runs a
           protocol a phone cannot (raw TLS, encrypted TCP). See provisioning/gateway_wifi.py.

In every case the gateway then waits for the device to appear on the LAN and pairs it; success is only
reported once the device has been found and its state read.
"""

from __future__ import annotations

import re
from dataclasses import dataclass, field

from ..models import ConnectionStatus, HotspotInfo, ProvisioningStep, SupportLevel

S = ConnectionStatus


@dataclass(frozen=True)
class HotspotRule:
    ssid_pattern: str
    ssid_prefixes: tuple[str, ...]
    #: none: the setup network is open. fixed: a published default exists for `verified_models`. user: ask.
    kind: str
    password: str | None = None
    verified_models: tuple[str, ...] = ()
    source: str | None = None
    device_ip: str | None = None

    def resolve(self, model: str | None) -> HotspotInfo:
        base = {"ssid_pattern": self.ssid_pattern, "ssid_prefixes": list(self.ssid_prefixes), "device_ip": self.device_ip}
        if self.kind == "none":
            return HotspotInfo(password_rule="none", rule_source=self.source, **base)
        if self.kind == "fixed" and self.password and ("*" in self.verified_models or (model and model in self.verified_models)):
            return HotspotInfo(password_rule="verified_rule", password=self.password, rule_source=self.source, **base)
        return HotspotInfo(password_rule="user", rule_source=None, **base)


@dataclass(frozen=True)
class ProvisioningPlugin:
    id: str
    brand_id: str
    adapter_id: str
    title: str
    description: str
    transport: str
    status: SupportLevel
    hotspot: HotspotRule
    #: Models a source confirms; empty means the plugin is generic for the brand's firmware.
    supported_models: tuple[str, ...] = ()
    #: Models the app offers in its picker; "other" is always added.
    model_choices: tuple[str, ...] = ()
    firmware: str | None = None
    auth_mechanisms: tuple[str, ...] = ()
    requirements: tuple[str, ...] = ()
    manufacturer_account: bool = False
    user_approval: bool = False
    local_control_after: bool = True
    #: Regex with named groups read from the hotspot name to recognise the device later (e.g. MAC suffix).
    expect_from_ssid: str | None = None
    #: Models for which the plugin runs as `experimental` even though the plugin itself is supported.
    experimental_models: tuple[str, ...] = ()
    steps: tuple[ProvisioningStep, ...] = field(default_factory=tuple)
    sources: tuple[str, ...] = ()

    def is_experimental(self, model: str | None) -> bool:
        if self.status == SupportLevel.EXPERIMENTAL:
            return True
        if model and model in self.experimental_models:
            return True
        return bool(self.supported_models) and (model or "other") not in self.supported_models

    def expect(self, ssid: str | None) -> dict[str, str]:
        if not ssid or not self.expect_from_ssid:
            return {}
        match = re.search(self.expect_from_ssid, ssid)
        return {k: v.lower() for k, v in (match.groupdict() if match else {}).items() if v}


def _steps(*items: tuple[ConnectionStatus, str, str]) -> tuple[ProvisioningStep, ...]:
    return tuple(ProvisioningStep(state=state, title=title, detail=detail) for state, title, detail in items)


PLUGINS: list[ProvisioningPlugin] = [
    ProvisioningPlugin(
        id="shelly_softap",
        brand_id="shelly",
        adapter_id="shelly",
        title="Set up a new Shelly",
        description="The phone joins the Shelly's own Wi-Fi and sends it your home network with Shelly's documented local API.",
        transport="phone",
        status=SupportLevel.SUPPORTED,
        hotspot=HotspotRule(
            ssid_pattern=r"^shelly[a-z0-9]*-[0-9a-f]{6,12}$",
            ssid_prefixes=("shelly", "Shelly"),
            kind="none",
            source="Shelly devices open an unsecured access point at 192.168.33.1 until Wi-Fi is configured "
            "(shelly-api-docs.shelly.cloud).",
            device_ip="192.168.33.1",
        ),
        firmware="Gen1 firmware 1.x, Gen2+ firmware 1.x",
        auth_mechanisms=("none", "device password (optional)"),
        requirements=("2.4 GHz home Wi-Fi",),
        expect_from_ssid=r"-(?P<mac_suffix>[0-9a-fA-F]{6,12})$",
        steps=_steps(
            (S.PAIRING_MODE_REQUIRED, "Put the Shelly in setup mode", "A new Shelly starts in setup mode. Otherwise, factory reset it (see its manual)."),
            (S.CONNECTING_DEVICE_AP, "Join the Shelly's Wi-Fi", "Its network is named like shellyplus1-XXXXXXXXXXXX and has no password."),
            (S.SENDING_WIFI_CONFIG, "Send your Wi-Fi", "The app sends your home Wi-Fi name and password directly to the Shelly."),
            (S.CONNECTING_HOME_NETWORK, "Back to your Wi-Fi", "The phone rejoins your home network while the Shelly connects to it."),
            (S.WAITING_FOR_DEVICE, "Finding the Shelly", "The gateway looks for the Shelly on your network."),
        ),
        sources=("https://shelly-api-docs.shelly.cloud/gen1/#settings-sta", "https://shelly-api-docs.shelly.cloud/gen2/ComponentsAndServices/WiFi"),
    ),
    ProvisioningPlugin(
        id="wled_softap",
        brand_id="wled",
        adapter_id="wled",
        title="Set up a new WLED controller",
        description="The phone joins WLED's setup network; you enter your Wi-Fi on WLED's own page.",
        transport="guided",
        status=SupportLevel.SUPPORTED,
        hotspot=HotspotRule(
            ssid_pattern=r"^WLED-AP$",
            ssid_prefixes=("WLED-AP",),
            kind="fixed",
            password="wled1234",
            verified_models=("*",),
            source="WLED's documented default access point: WLED-AP, password wled1234, setup page at 4.3.2.1 "
            "(kno.wled.ge/basics/getting-started).",
            device_ip="4.3.2.1",
        ),
        firmware="WLED 0.13 or later",
        auth_mechanisms=("none",),
        requirements=("2.4 GHz home Wi-Fi",),
        steps=_steps(
            (S.PAIRING_MODE_REQUIRED, "Power the controller", "A WLED controller without Wi-Fi settings opens WLED-AP within a minute of power-up."),
            (S.CONNECTING_DEVICE_AP, "Join WLED-AP", "Password wled1234 (WLED's published default)."),
            (S.SENDING_WIFI_CONFIG, "Enter your Wi-Fi on WLED's page", "The page at 4.3.2.1 opens. Fill in your network and save."),
            (S.CONNECTING_HOME_NETWORK, "Back to your Wi-Fi", "Rejoin your home network."),
            (S.WAITING_FOR_DEVICE, "Finding WLED", "The gateway looks for the controller on your network."),
        ),
        sources=("https://kno.wled.ge/basics/getting-started/",),
    ),
    ProvisioningPlugin(
        id="sonoff_diy_softap",
        brand_id="sonoff",
        adapter_id="sonoff_lan",
        title="Set up a SONOFF in DIY mode",
        description="Puts the device in ITEAD's documented DIY mode: the phone joins its ITEAD- network and you enter "
        "your Wi-Fi on the device's page. DIY mode is controlled locally without an eWeLink account.",
        transport="guided",
        status=SupportLevel.SUPPORTED,
        hotspot=HotspotRule(
            ssid_pattern=r"^ITEAD-[0-9A-Fa-f]{6,12}$",
            ssid_prefixes=("ITEAD-",),
            kind="fixed",
            password="12345678",
            verified_models=("BASICR3", "RFR3", "MINI", "S26R2TPF"),
            source="ITEAD's SONOFF DIY Mode API Protocol v2.0: Compatible Pairing Mode opens ITEAD-XXXXXXXX with "
            "default password 12345678 and a setup page at http://10.10.7.1/. Listed for BASICR3, RFR3 and MINI; "
            "on the S26R2TPF the same network and GET /device were confirmed in this project's earlier testing.",
            device_ip="10.10.7.1",
        ),
        supported_models=("BASICR3", "RFR3", "MINI"),
        model_choices=("BASICR3", "RFR3", "MINI", "S26R2TPF"),
        experimental_models=("S26R2TPF",),
        firmware="3.6.0 or later (DIY mode v2)",
        auth_mechanisms=("none (DIY mode)", "device key (eWeLink LAN mode)"),
        requirements=("2.4 GHz home Wi-Fi with mDNS (most home routers)",),
        expect_from_ssid=r"^ITEAD-(?P<deviceid>[0-9A-Fa-f]{6,12})$",
        steps=_steps(
            (
                S.PAIRING_MODE_REQUIRED,
                "Enter Compatible Pairing Mode",
                "Hold the button 5 s until the LED blinks, then hold it another 5 s until it blinks continuously.",
            ),
            (S.CONNECTING_DEVICE_AP, "Join the ITEAD- network", "Its name is ITEAD- followed by the device ID."),
            (S.SENDING_WIFI_CONFIG, "Enter your Wi-Fi on the device's page", "The page at 10.10.7.1 opens. Fill in your 2.4 GHz network and save."),
            (S.CONNECTING_HOME_NETWORK, "Back to your Wi-Fi", "Rejoin your home network. The LED double-blinks once the device is connected."),
            (S.WAITING_FOR_DEVICE, "Finding the device", "The gateway looks for it on your network (mDNS _ewelink._tcp)."),
        ),
        sources=(
            "https://github.com/itead/Sonoff_Devices_DIY_Tools (SONOFF DIY MODE Protocol Doc v2.0)",
            "https://github.com/AlexxIT/SonoffLAN#getting-devicekey-manually",
        ),
    ),
    ProvisioningPlugin(
        id="kasa_softap",
        brand_id="tplink",
        adapter_id="tplink",
        title="Set up a Kasa plug or bulb with the gateway",
        description="The gateway joins the device's open setup network with its own Wi-Fi and sends your network "
        "with python-kasa's documented `wifi join`. Needs a gateway with a spare Wi-Fi radio.",
        transport="gateway",
        status=SupportLevel.EXPERIMENTAL,
        hotspot=HotspotRule(
            ssid_pattern=r"^(TP-LINK|TP-Link|Kasa)_.+_[0-9A-F]{4}$",
            ssid_prefixes=("TP-LINK_", "TP-Link_", "Kasa_"),
            kind="none",
            source="Kasa devices in setup mode open an unsecured network and answer at 192.168.0.1 (python-kasa docs).",
            device_ip="192.168.0.1",
        ),
        firmware="Kasa devices on the legacy local protocol (port 9999). Newer firmware needs a TP-Link account.",
        auth_mechanisms=("none (legacy protocol)",),
        requirements=("Gateway with a Wi-Fi radio set as CUBE_SOFTAP_INTERFACE", "2.4 GHz home Wi-Fi"),
        steps=_steps(
            (S.PAIRING_MODE_REQUIRED, "Put the device in setup mode", "Hold its button about 5 s until the light blinks amber and green."),
            (S.CONNECTING_DEVICE_AP, "Gateway joins the device", "The gateway connects to TP-LINK_..._XXXX by itself."),
            (S.SENDING_WIFI_CONFIG, "Sending your Wi-Fi", "The gateway sends your network name and password to the device."),
            (S.CONNECTING_HOME_NETWORK, "Device joins your Wi-Fi", "The gateway returns to your network."),
            (S.WAITING_FOR_DEVICE, "Finding the device", "The gateway looks for it on your network."),
        ),
        sources=("https://python-kasa.readthedocs.io/en/stable/cli.html#provisioning",),
    ),
    ProvisioningPlugin(
        id="lg_thinq_softap",
        brand_id="lg",
        adapter_id="lg_thinq_rethink",
        title="Set up an LG ThinQ appliance for ReThink",
        description="Experimental. The phone joins the appliance's setup network and runs ReThink's setup protocol "
        "(ThinQ1, ThinQ2 or Whisen) itself, pointing the appliance at your ReThink server instead of LG's cloud. "
        "ThinQ2 appliances are given ReThink's address directly when the gateway knows it; other models need "
        "*.lgthinq.com redirected to ReThink in the router's DNS.",
        transport="phone",
        status=SupportLevel.EXPERIMENTAL,
        hotspot=HotspotRule(
            ssid_pattern=r"^(LGE?_|\[LG_)",
            ssid_prefixes=("LGE_", "[LG_", "LG_"),
            # LG documents no per-model default, so the user types it; the app offers ReThink's documented
            # name patterns (e.g. LGE_AC2_1234 -> 12341234) as an editable suggestion, never silently.
            kind="user",
            source=None,
            device_ip="192.168.120.254",
        ),
        model_choices=("RAC_056905_WW", "WIN_056905_WW", "POT_056905_WW"),
        firmware="Models listed in ReThink's support table only",
        auth_mechanisms=("TLS setup protocol on port 5500 (ThinQ1/2) or 9000 (Whisen)",),
        requirements=(
            "ReThink running and reachable by the appliance",
            "CUBE_RETHINK_MQTT_URL pointing at ReThink's MQTT broker",
            "ThinQ2: CUBE_RETHINK_API_SERVER and CUBE_RETHINK_MQTT_SERVER, or the DNS redirection below",
            "ThinQ1 and Whisen: router DNS sends lgthinq.com and *.lgthinq.com to the ReThink server",
            "The CUBE OS app build (raw TLS sockets are not available in Expo Go or on the web)",
        ),
        steps=_steps(
            (S.PAIRING_MODE_REQUIRED, "Start Wi-Fi setup on the appliance", "On most ACs: hold the remote's Wi-Fi (or Jet) button until the display shows AP or the Wi-Fi LED blinks."),
            (S.HOTSPOT_PASSWORD_REQUIRED, "Setup network password", "Enter the password of the appliance's LGE_ network (on its label or in the manual); leave it empty if the network is open."),
            (S.CONNECTING_DEVICE_AP, "Join the appliance's network", "The phone joins the LGE_... network."),
            (S.SENDING_WIFI_CONFIG, "Sending your Wi-Fi", "The phone sends your network, and where ReThink is, using ReThink's setup protocol."),
            (S.CONNECTING_HOME_NETWORK, "Back to your Wi-Fi", "The phone rejoins your network while the appliance connects to ReThink."),
            (S.WAITING_FOR_DEVICE, "Waiting for ReThink", "It can take the appliance a few minutes to join your Wi-Fi and reach ReThink; it then appears here."),
        ),
        sources=("https://github.com/anszom/rethink (rethink-setup.ts)", "https://github.com/anszom/rethink/wiki"),
    ),
    ProvisioningPlugin(
        id="lg_thinq_softap_gateway",
        brand_id="lg",
        adapter_id="lg_thinq_rethink",
        title="Set up an LG ThinQ appliance with the gateway's Wi-Fi",
        description="Experimental. For when the phone cannot do it: the gateway joins the appliance's setup network "
        "with its own spare Wi-Fi radio and runs ReThink's own setup tool (rethink-setup).",
        transport="gateway",
        status=SupportLevel.EXPERIMENTAL,
        hotspot=HotspotRule(
            ssid_pattern=r"^(LGE?_|\[LG_)",
            ssid_prefixes=("LGE_", "[LG_", "LG_"),
            # LG documents no per-model default, so the user types it; the app offers ReThink's documented
            # name patterns (e.g. LGE_AC2_1234 -> 12341234) as an editable suggestion, never silently.
            kind="user",
            source=None,
            device_ip="192.168.120.254",
        ),
        model_choices=("RAC_056905_WW", "WIN_056905_WW", "POT_056905_WW"),
        firmware="Models listed in ReThink's support table only",
        auth_mechanisms=("TLS setup protocol on port 5500 (ThinQ1/2) or 9000 (Whisen)",),
        requirements=(
            "ReThink running and reachable by the appliance",
            "Router DNS: lgthinq.com and *.lgthinq.com resolve to the ReThink server",
            "Gateway with a Wi-Fi radio set as CUBE_SOFTAP_INTERFACE",
            "CUBE_RETHINK_SETUP_CMD: ReThink's rethink-setup installed on the gateway host (GPL-2.0, run as a separate program)",
            "CUBE_RETHINK_MQTT_URL pointing at ReThink's MQTT broker",
        ),
        steps=_steps(
            (S.PAIRING_MODE_REQUIRED, "Start Wi-Fi setup on the appliance", "On most ACs: hold the remote's Wi-Fi (or Jet) button until the display shows AP or the Wi-Fi LED blinks."),
            (S.HOTSPOT_PASSWORD_REQUIRED, "Hotspot password", "Enter the setup network's password if it has one; leave empty if open."),
            (S.CONNECTING_DEVICE_AP, "Gateway joins the appliance", "The gateway connects to the LGE_... network by itself."),
            (S.SENDING_WIFI_CONFIG, "Sending your Wi-Fi", "ReThink's setup tool sends your network and the ReThink region."),
            (S.WAITING_FOR_DEVICE, "Waiting for ReThink", "The appliance joins your Wi-Fi and connects to ReThink; it then appears here."),
        ),
        sources=("https://github.com/anszom/rethink (rethink-setup.ts)", "https://github.com/anszom/rethink/wiki"),
    ),
]

PLUGINS_BY_ID = {plugin.id: plugin for plugin in PLUGINS}
