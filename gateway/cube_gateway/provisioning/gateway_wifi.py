"""Gateway-side SoftAP transport: the gateway joins a device's setup hotspot with its own Wi-Fi radio.

Optional. Needs CUBE_SOFTAP_INTERFACE (e.g. wlan1), NetworkManager on the host, and its system D-Bus socket in
the container (`-v /run/dbus:/run/dbus:ro`) with permission to manage connections (run the container as root,
or add a polkit rule for its user). Use a spare radio: if the gateway's only network link is that Wi-Fi
interface it is offline while it is on the device's hotspot, then reconnects.

The temporary connection is volatile (never saved), and the interface's previous connection is reactivated
afterwards whatever happened.
"""

from __future__ import annotations

import asyncio
import contextlib
import logging
from collections.abc import AsyncIterator, Awaitable, Callable

from ..models import ConnectionStatus, ProvisioningSession
from .engine import ProvisioningFailure
from .plugins import ProvisioningPlugin

log = logging.getLogger("cube.softap")
NM = "org.freedesktop.NetworkManager"
NM_PATH = "/org/freedesktop/NetworkManager"
ACTIVATED = 2
DEACTIVATED = 4


@contextlib.asynccontextmanager
async def joined(interface: str, ssid: str, password: str | None, timeout: float = 40) -> AsyncIterator[None]:
    try:
        from dbus_fast import BusType, Variant
        from dbus_fast.aio import MessageBus
    except ImportError as error:
        raise ProvisioningFailure("gateway_wifi_unavailable", "dbus-fast is not installed.") from error
    try:
        bus = await MessageBus(bus_type=BusType.SYSTEM).connect()
    except Exception as error:  # noqa: BLE001
        raise ProvisioningFailure("gateway_wifi_unavailable", "The host's D-Bus is not reachable (mount /run/dbus).") from error

    async def iface(path: str, name: str):
        introspection = await bus.introspect(NM, path)
        return bus.get_proxy_object(NM, path, introspection).get_interface(name)

    previous: str | None = None
    active_path: str | None = None
    try:
        manager = await iface(NM_PATH, NM)
        try:
            device_path = await manager.call_get_device_by_ip_iface(interface)
        except Exception as error:  # noqa: BLE001
            raise ProvisioningFailure("gateway_wifi_unavailable", f"NetworkManager has no interface {interface}.") from error
        device_props = await iface(device_path, "org.freedesktop.DBus.Properties")
        current = (await device_props.call_get(f"{NM}.Device", "ActiveConnection")).value
        if current and current != "/":
            active_props = await iface(current, "org.freedesktop.DBus.Properties")
            previous = (await active_props.call_get(f"{NM}.Connection.Active", "Connection")).value

        settings = {
            "connection": {"id": Variant("s", "cube-device-setup"), "type": Variant("s", "802-11-wireless"), "autoconnect": Variant("b", False)},
            "802-11-wireless": {"ssid": Variant("ay", ssid.encode()), "mode": Variant("s", "infrastructure")},
            "ipv4": {"method": Variant("s", "auto")},
            "ipv6": {"method": Variant("s", "ignore")},
        }
        if password:
            settings["802-11-wireless-security"] = {"key-mgmt": Variant("s", "wpa-psk"), "psk": Variant("s", password)}
        try:
            _conn, active_path, _result = await manager.call_add_and_activate_connection2(settings, device_path, "/", {"persist": Variant("s", "volatile")})
        except Exception as error:  # noqa: BLE001
            raise ProvisioningFailure("hotspot_not_found", f"The gateway could not join {ssid}.") from error

        active_props = await iface(active_path, "org.freedesktop.DBus.Properties")
        loop = asyncio.get_running_loop()
        deadline = loop.time() + timeout
        while True:
            try:
                state = (await active_props.call_get(f"{NM}.Connection.Active", "State")).value
            except Exception:  # noqa: BLE001 - the active connection vanished: activation failed
                state = DEACTIVATED
            if state == ACTIVATED:
                break
            if state == DEACTIVATED:
                raise ProvisioningFailure("hotspot_password_wrong" if password else "hotspot_not_found")
            if loop.time() > deadline:
                raise ProvisioningFailure("hotspot_not_found", f"Joining {ssid} timed out.")
            await asyncio.sleep(0.5)
        log.info("gateway joined device hotspot", extra={"interface": interface})
        yield
    finally:
        with contextlib.suppress(Exception):
            manager = await iface(NM_PATH, NM)
            if active_path:
                await manager.call_deactivate_connection(active_path)
            if previous:
                device_path = await manager.call_get_device_by_ip_iface(interface)
                await manager.call_activate_connection(previous, device_path, "/")
                log.info("gateway restored its network connection", extra={"interface": interface})
        bus.disconnect()


async def run_rethink_setup(device_ip: str, ssid: str, password: str) -> None:
    """Runs ReThink's own setup tool (GPL-2.0, a separate program) as `<CUBE_RETHINK_SETUP_CMD> host ssid password`.

    The gateway does not include ReThink's code; it only starts the tool the operator installed, e.g.
    `npx tsx /opt/rethink/rethink-setup.ts`. Its output is not logged because it echoes the request.
    """
    import os
    import shlex

    command = os.environ.get("CUBE_RETHINK_SETUP_CMD", "").strip()
    if not command:
        raise ProvisioningFailure("gateway_wifi_unavailable", "Set CUBE_RETHINK_SETUP_CMD to ReThink's rethink-setup command.")
    try:
        process = await asyncio.create_subprocess_exec(
            *shlex.split(command), device_ip, ssid, password, stdout=asyncio.subprocess.DEVNULL, stderr=asyncio.subprocess.DEVNULL
        )
    except OSError as error:
        raise ProvisioningFailure("gateway_wifi_unavailable", "CUBE_RETHINK_SETUP_CMD could not be started.") from error
    try:
        code = await asyncio.wait_for(process.wait(), timeout=90)
    except TimeoutError as error:
        process.kill()
        raise ProvisioningFailure("provisioning_protocol_failed", "ReThink's setup did not finish in 90 s.") from error
    if code != 0:
        raise ProvisioningFailure("provisioning_protocol_failed", "The appliance did not accept ReThink's setup (rethink-setup failed).")


def make_runner(interface: str) -> Callable[..., Awaitable[None]]:
    """The callable ProvisioningEngine uses for gateway-transport plugins."""

    async def run(
        plugin: ProvisioningPlugin,
        session: ProvisioningSession,
        hotspot_ssid: str,
        hotspot_password: str | None,
        home_ssid: str,
        home_password: str,
        progress: Callable[[ConnectionStatus], Awaitable[None]],
    ) -> None:
        device_ip = session.hotspot.device_ip or "192.168.0.1"
        async with joined(interface, hotspot_ssid, hotspot_password):
            await progress(ConnectionStatus.SENDING_WIFI_CONFIG)
            if plugin.id == "kasa_softap":
                from ..adapters.tplink import wifi_join

                try:
                    await asyncio.wait_for(wifi_join(device_ip, home_ssid, home_password), timeout=30)
                except Exception as error:  # noqa: BLE001
                    raise ProvisioningFailure("provisioning_protocol_failed", "The Kasa device did not accept the Wi-Fi settings.") from error
            elif plugin.id == "lg_thinq_softap_gateway":
                await run_rethink_setup(device_ip, home_ssid, home_password)
            else:
                raise ProvisioningFailure("unsupported_model", f"{plugin.title} does not run on the gateway.")
        await progress(ConnectionStatus.CONNECTING_HOME_NETWORK)

    return run
