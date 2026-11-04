/**
 * Pairing an LG appliance from its setup hotspot, the way ReThink's
 * rethink-setup does (https://github.com/anszom/rethink), so neither LG's
 * ThinQ app nor a computer is needed. The CUBE Gateway's ReThink adapter then
 * finds it and finishes pairing (plugin lg_thinq_softap).
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
} as const;

export const lgSources = {
  rethinkSetup: 'https://github.com/anszom/rethink/wiki/Installing-rethink%E2%80%90cloud',
  setupMode: 'https://www.lg.com/levant_en/support/product-help/CT40005031-20154768444181',
} as const;
