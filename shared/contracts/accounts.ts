/**
 * Linking brand accounts through the unit's Home Assistant: GET /api/accounts/integrations,
 * GET /api/accounts, and the config-flow steps under /api/accounts/flows.
 */

export type LinkMethod = 'credentials' | 'qr' | 'oauth';

/** A brand a resident can link. */
export interface Integration {
  id: string;
  name: string;
  method: LinkMethod;
  /** What the resident needs before starting. */
  hint: string;
}

/** GET /api/accounts/integrations: each brand, and whether this building has enabled it. */
export interface IntegrationOption extends Integration {
  /** False for brands the building has not enabled yet (an OAuth brand without its app credentials). */
  available: boolean;
}

/** GET /api/accounts */
export interface LinkedAccount {
  id: string;
  integration: string;
  brand: string;
  title: string;
  state: string;
  /** The brand wants the resident to sign in again. */
  needsReconnect: boolean;
  deviceCount: number;
  problem: string | null;
}

export type FlowFieldKind = 'string' | 'password' | 'email' | 'number' | 'boolean' | 'select' | 'qr' | 'constant';

export interface FlowField {
  name: string;
  /** The expandable section it sits in; its value is sent nested under that name. */
  section: string | null;
  kind: FlowFieldKind;
  label: string;
  description: string | null;
  required: boolean;
  default: unknown;
  options: { value: string; label: string }[];
  multiple: boolean;
  min: number | null;
  max: number | null;
  step: number | null;
  multiline: boolean;
  /** A QR code's content, or a constant's text. */
  data: string | null;
}

export type FlowStepType = 'form' | 'menu' | 'external' | 'progress' | 'done' | 'abort';

/** One step of linking an account, as the backend normalizes Home Assistant's config flow. */
export interface FlowStep {
  flowId: string;
  integration: string;
  type: FlowStepType;
  stepId: string | null;
  title: string | null;
  description: string | null;
  fields: FlowField[];
  /** Field name (or `base` for the whole form) → message. */
  errors: Record<string, string>;
  menu: { id: string; label: string }[];
  /** For `external`: the page to open, e.g. the brand's sign-in. */
  url: string | null;
  /** For `done`: the linked account (config entry). */
  accountId: string | null;
  /** For `abort` and `progress`: what to tell the resident. */
  message: string | null;
}
