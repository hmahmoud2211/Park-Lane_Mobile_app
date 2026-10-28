/**
 * Pairing an LG appliance from its setup hotspot, the way rethink's
 * rethink-setup does (https://github.com/anszom/rethink), so neither LG's
 * ThinQ app nor a computer is needed. The backend's rethink bridge then finds
 * it (EXPO_PUBLIC_DEVICE_BACKEND_URL, see emsConfig).
 */
export const lgConfig = {
  /**
   * The appliance's address on its hotspot. Most hand out 192.168.120.x;
   * some hand out 192.168.1.x and sit at .1.
   */
  apHosts: ['192.168.120.254', '192.168.1.1'],

  connectTimeoutMs: 8_000,
  /** One reply; a ThinQ2 appliance may also stay silent to the ThinQ1 framing, then this decides. */
  replyTimeoutMs: 10_000,

  /** Joining home Wi-Fi, then calling (DNS-redirected) LG hosts, can take the appliance a few minutes. */
  discoveryWindowMs: 240_000,
  discoveryPollMs: 5_000,
} as const;

export const lgSources = {
  rethinkSetup: 'https://github.com/anszom/rethink/wiki/Installing-rethink%E2%80%90cloud',
  setupMode: 'https://www.lg.com/levant_en/support/product-help/CT40005031-20154768444181',
} as const;
