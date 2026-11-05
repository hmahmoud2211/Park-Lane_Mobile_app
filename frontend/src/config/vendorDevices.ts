/**
 * Fixed addresses of devices on their own setup hotspots. They are the makers' protocol,
 * not settings: the phone joins the device's Wi-Fi and the device is always here. The CUBE
 * gateway's provisioning plugins (gateway/cube_gateway/provisioning/plugins.py) use the
 * same values.
 */
export const vendorDevices = {
  /** Shelly Gen1 and Gen2+ in AP mode. */
  shellySetupIp: '192.168.33.1',
  /** SONOFF / eWeLink devices in AP (pairing) mode. */
  sonoffSetupIp: '10.10.7.1',
} as const;
