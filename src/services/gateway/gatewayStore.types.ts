/** A gateway this phone is paired with, as kept on the phone. */
export interface StoredGateway {
  id: string;
  name: string;
  clientId: string;
  role: 'owner' | 'member';
  /** The phone's bearer token for this gateway. Secret. */
  token: string;
  /** The shared key the gateway proves its identity with (base64url). Secret. */
  pinKey: string;
  endpoints: {
    /** `http://<ip>:8686` on the home network, updated when the gateway's address changes. */
    lan?: string;
    /** Tailscale address or relay URL, tried when the home address does not answer. */
    remote?: string[];
  };
  /** The address that last answered and proved its identity. */
  lastUrl: string | null;
  /** Addresses that already proved this gateway's identity; others are challenged before the token is sent. */
  verifiedUrls: string[];
  pairedAt: number;
}
