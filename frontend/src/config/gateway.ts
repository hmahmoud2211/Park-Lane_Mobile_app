/**
 * The CUBE Gateway: a Docker container on a Linux machine in the home
 * (gateway/ in this repo). Nothing is configured per build: residents connect
 * a gateway from the app (found on the Wi-Fi, typed in, or scanned from the
 * QR code in its logs), and its address and token are kept on the phone.
 */
export const gatewayConfig = {
  defaultPort: 8686,
  apiPrefix: '/api/v1',
  /** The start of a gateway's pairing QR code; features/gateway/services/pairCode.ts reads the rest. */
  pairScheme: 'cubegw:',
  requestTimeoutMs: 10_000,
  /** A command waits for the device to report back (the gateway allows 10 s per call). */
  commandTimeoutMs: 20_000,
  /** Pairing can wait for the user to accept on a TV. */
  pairingTimeoutMs: 20_000,
  /** A quick reachability check of a known address. */
  healthTimeoutMs: 2_500,
  /** Scanning the phone's /24 for gateways: per address, and how many at once. */
  scanProbeTimeoutMs: 1_200,
  scanBatchSize: 24,
  /** Realtime reconnects back off from 1 s to 30 s. */
  reconnectMinMs: 1_000,
  reconnectMaxMs: 30_000,
  /** Discovery and provisioning are polled this often when the event channel is down. */
  pollMs: 1_500,
} as const;

/** `http://host:port` for a typed host, adding the default port and scheme when missing. */
export function gatewayBaseUrl(host: string): string {
  const trimmed = host.trim().replace(/\/+$/, '');
  if (/^https?:\/\//i.test(trimmed)) {
    return trimmed;
  }
  return /:\d+$/.test(trimmed) || trimmed.startsWith('[') ? `http://${trimmed}` : `http://${trimmed}:${gatewayConfig.defaultPort}`;
}
