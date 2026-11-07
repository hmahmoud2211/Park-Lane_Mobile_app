/**
 * CUBE gateway access through the resident's EMS account (backend/src/routes/gateway.ts).
 *
 * The app asks the backend for a pass for the resident's apartment, then hands it to that apartment's gateway
 * (POST <gateway url>/api/v1/auth/account { pass, client_name }), which answers with this phone's own gateway
 * token, exactly like pairing does. The gateway checks the pass with the backend's public key, so it needs no
 * call to the backend, and later removes phones of residents who left the apartment.
 */

/** POST /api/gateway/pass (an app session only). 404 `no_gateway` when the unit has none yet. */
export interface GatewayPass {
  gateway: {
    /** The gateway's own id, as in its /api/v1/health and pairing QR codes. */
    id: string;
    /** Where phones reach it from anywhere (its relay address), or null if it isn't on a relay. */
    url: string | null;
  };
  /** Signed by the backend, single use, valid for a few minutes, only for this gateway. */
  pass: string;
  /** Milliseconds since the epoch. */
  expiresAt: number;
  /** The resident's role in the unit: an owner manages the gateway, a member controls devices. */
  role: 'owner' | 'member';
}
