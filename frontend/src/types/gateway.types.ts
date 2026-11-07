/**
 * The CUBE Gateway's API, as it sends it (gateway/cube_gateway/models.py and
 * gateway/API.md). Field names are snake_case on the wire, as there; change
 * both together. The app turns gateway devices into its own Device model in
 * services/gateway/deviceMapping.ts.
 */

export type SupportLevel = 'supported' | 'experimental' | 'limited' | 'unsupported';

export type GatewayCategory = 'switch' | 'plug' | 'light' | 'climate' | 'tv' | 'fan' | 'sensor' | 'camera' | 'cover' | 'other';

export type AuthKind =
  | 'none'
  | 'approve_on_device'
  | 'pin'
  | 'local_key'
  | 'device_credentials'
  | 'account_credentials';

/** One vocabulary for device connections and provisioning sessions (prompt section 13). */
export type ConnectionStatus =
  | 'scanning'
  | 'discovered'
  | 'identified'
  | 'pairing_mode_required'
  | 'connecting_device_ap'
  | 'hotspot_password_required'
  | 'sending_wifi_config'
  | 'connecting_home_network'
  | 'waiting_for_device'
  | 'local_authorization_required'
  | 'connected'
  | 'offline'
  | 'local_key_required'
  | 'experimental'
  | 'unsupported'
  | 'pairing_failed';

// ---- catalog --------------------------------------------------------------------------------

export interface FieldSpec {
  name: string;
  label: string;
  kind: 'text' | 'password' | 'number' | 'select';
  required: boolean;
  secret: boolean;
  help: string | null;
  options: string[];
  pattern: string | null;
}

export interface PairingRequirements {
  auth: AuthKind;
  fields: FieldSpec[];
  instructions: string | null;
  manufacturer_account: boolean;
  approval_timeout: number | null;
}

export type MethodGroup = 'existing' | 'new' | 'advanced';
export type MethodTransport = 'lan' | 'phone' | 'gateway' | 'guided';
export type HotspotPasswordRule = 'none' | 'verified_rule' | 'user';

export interface ConnectionMethod {
  /** `find:<adapter>`, `setup:<plugin>`, `manual:<adapter>`, or `setup:none` for a brand with no in-app setup. */
  id: string;
  group: MethodGroup;
  title: string;
  description: string;
  adapter_id: string;
  plugin_id: string | null;
  transport: MethodTransport;
  status: SupportLevel;
  manufacturer_account: boolean;
  hotspot_password: HotspotPasswordRule;
  user_approval: boolean;
  local_key: boolean;
  available: boolean;
  unavailable_reason: string | null;
}

export interface Brand {
  id: string;
  name: string;
  aliases: string[];
  /** An icon key the app maps to its own artwork; the gateway never sends images. */
  logo: string;
  status: SupportLevel;
  summary: string;
  account_free: boolean;
  categories: GatewayCategory[];
  adapters: string[];
  methods: ConnectionMethod[];
  notes: string[];
  /** Integrations on the building's hub that link this brand (backend/src/ha/integrations.ts). */
  hub_integrations?: string[];
  /** On a gateway on CUBE's server: the brand only works on the home network. */
  needs_home_gateway?: boolean;
}

export interface AdapterInfo {
  id: string;
  name: string;
  brands: string[];
  protocols: string[];
  discovery: string[];
  categories: GatewayCategory[];
  status: SupportLevel;
  account_free: boolean;
  auth: AuthKind;
  local_control: boolean;
  push_updates: boolean;
  library: string | null;
  verified_models: string[];
  notes: string[];
  loaded: boolean;
  load_error: string | null;
}

// ---- discovery ------------------------------------------------------------------------------

export interface Candidate {
  id: string;
  adapter_id: string;
  brand: string;
  name: string | null;
  model: string | null;
  ip: string | null;
  port: number | null;
  mac: string | null;
  unique_id: string;
  protocol: string | null;
  sources: string[];
  status: ConnectionStatus;
  /** Being seen is not being controllable: `detection_only` devices can't be paired. */
  control: 'supported' | 'experimental' | 'detection_only';
  account_free: boolean;
  pairing: PairingRequirements;
  paired_device_id: string | null;
  first_seen: number;
  last_seen: number;
  details: Record<string, unknown>;
}

export interface DiscoveryJob {
  id: string;
  status: 'running' | 'completed' | 'cancelled' | 'failed';
  brand_id: string | null;
  adapter_ids: string[];
  methods: string[];
  progress: number;
  phase: string;
  started_at: number;
  finished_at: number | null;
  timeout: number;
  candidate_ids: string[];
  errors: string[];
}

// ---- devices --------------------------------------------------------------------------------

export type GatewayCapabilityType = 'power' | 'brightness' | 'color_temp' | 'color' | 'climate' | 'media' | 'fan' | 'cover';

/** One controllable aspect. `key` tells several of a kind apart, e.g. `power:0` and `power:1` on a two-gang switch. */
export interface GatewayCapability {
  key: string;
  type: GatewayCapabilityType;
  label: string;
  /** False when the gateway shows what it expects, not what the device reported. */
  confirmed: boolean;
  updated_at: number | null;
  value: unknown;
  min: number | null;
  max: number | null;
  step: number | null;
  current: number | null;
  target: number | null;
  unit: string | null;
  mode: string | null;
  modes: string[];
  fan_mode: string | null;
  fan_modes: string[];
  volume: number | null;
  muted: boolean | null;
  source: string | null;
  sources: string[];
  state: string | null;
  percentage: number | null;
  preset: string | null;
  presets: string[];
  position: number | null;
}

export interface GatewayReading {
  key: string;
  label: string;
  value: unknown;
  unit: string | null;
  device_class: string | null;
}

export type SettingKind = 'select' | 'number' | 'switch' | 'button' | 'sensor';

/**
 * A setting or reading beyond the basic capabilities, e.g. an AC's swing, Jet,
 * a timer or its filter hours (models.Setting). The device only lists what it
 * supports. `select`, `number` and `switch` change with `set_setting`, a
 * `button` with `press`; a `sensor` only reads. `available` is false while
 * the device would ignore it, with `requires` saying what it needs.
 * `confirmed` is false for a value the device has not echoed back.
 */
export interface GatewaySetting {
  key: string;
  kind: SettingKind;
  name: string;
  value: string | number | boolean | null;
  options: string[];
  min: number | null;
  max: number | null;
  step: number | null;
  unit: string | null;
  available: boolean;
  requires: string | null;
  description: string | null;
  diagnostic: boolean;
  confirmed: boolean;
}

export interface DeviceConnection {
  status: ConnectionStatus;
  last_seen: number | null;
  last_error: string | null;
  retry_at: number | null;
}

export interface PendingCommand {
  command: string;
  params: Record<string, unknown>;
  since: number;
}

export interface GatewayDevice {
  id: string;
  name: string;
  brand: string;
  model: string | null;
  adapter_id: string;
  category: GatewayCategory;
  room_id: string | null;
  room: string | null;
  ip: string | null;
  mac: string | null;
  unique_id: string;
  protocol: string | null;
  experimental: boolean;
  dashboard: boolean;
  connection: DeviceConnection;
  capabilities: GatewayCapability[];
  readings: GatewayReading[];
  /** Settings beyond the capabilities (an AC's swing, Jet, timers, filter); empty for most devices. */
  settings: GatewaySetting[];
  /** The normalized commands this device accepts (models.COMMANDS). */
  commands: string[];
  pending: PendingCommand | null;
  created_at: number;
  updated_at: number;
}

export interface GatewayRoom {
  id: string;
  name: string;
  device_count: number;
}

export type GatewayCommandName =
  | 'turn_on'
  | 'turn_off'
  | 'toggle'
  | 'set_brightness'
  | 'set_color'
  | 'set_color_temp'
  | 'set_temperature'
  | 'set_hvac_mode'
  | 'set_fan_mode'
  | 'set_fan_speed'
  | 'set_volume'
  | 'volume_up'
  | 'volume_down'
  | 'mute'
  | 'set_source'
  | 'media_play'
  | 'media_pause'
  | 'media_next'
  | 'media_previous'
  | 'cover_open'
  | 'cover_close'
  | 'cover_stop'
  | 'set_position'
  | 'set_setting'
  | 'press';

export interface GatewayCommand {
  command: GatewayCommandName;
  params: Record<string, unknown>;
}

export interface CommandResult {
  /**
   * confirmed: the device reported the new state. assumed: the protocol gives
   * no feedback, so the state shown is expected, not reported. pending: the
   * device will report later.
   */
  status: 'confirmed' | 'assumed' | 'pending';
  message: string | null;
}

export interface CommandResponse {
  device: GatewayDevice;
  result: CommandResult;
}

// ---- pairing and provisioning ---------------------------------------------------------------

export interface Pairing {
  id: string;
  candidate_id: string;
  status: 'running' | 'awaiting_approval' | 'needs_input' | 'paired' | 'failed';
  message: string | null;
  fields: FieldSpec[];
  device_id: string | null;
  error_code: string | null;
  started_at: number;
  finished_at: number | null;
}

export interface HotspotInfo {
  ssid_pattern: string;
  ssid_prefixes: string[];
  password_rule: HotspotPasswordRule;
  /** Set only when a published, model-specific default applies; otherwise the user types it. */
  password: string | null;
  rule_source: string | null;
  device_ip: string | null;
}

export interface ProvisioningStep {
  state: ConnectionStatus;
  title: string;
  detail: string;
}

export interface ProvisioningError {
  code: string;
  message: string;
  recovery: string;
}

export type ProvisioningTransport = 'phone' | 'gateway' | 'guided';

export interface ProvisioningSession {
  id: string;
  brand_id: string;
  plugin_id: string;
  adapter_id: string;
  model: string | null;
  transport: ProvisioningTransport;
  state: ConnectionStatus;
  experimental: boolean;
  hotspot: HotspotInfo;
  steps: ProvisioningStep[];
  expect: Record<string, string>;
  /**
   * What the phone needs to run the setup. For LG ThinQ: `rethink_api_server`
   * and `rethink_mqtt_server`, ReThink's public addresses, when the gateway knows them.
   */
  setup: Record<string, string>;
  candidate_id: string | null;
  device_id: string | null;
  pairing_id: string | null;
  error: ProvisioningError | null;
  history: Record<string, unknown>[];
  created_at: number;
  expires_at: number;
  updated_at: number;
}

export type ProvisioningEventName =
  | 'pairing_mode_confirmed'
  | 'joining_device_ap'
  | 'device_ap_joined'
  | 'hotspot_password_needed'
  | 'device_info'
  | 'wifi_config_sent'
  | 'phone_returned'
  | 'failed'
  | 'cancel';

export interface ProvisioningPlugin {
  id: string;
  brand_id: string;
  adapter_id: string;
  title: string;
  description: string;
  transport: ProvisioningTransport;
  status: SupportLevel;
  supported_models: string[];
  model_choices: string[];
  firmware: string | null;
  auth_mechanisms: string[];
  requirements: string[];
  manufacturer_account: boolean;
  user_approval: boolean;
  local_control_after: boolean;
  sources: string[];
}

// ---- gateway, access and remote -------------------------------------------------------------

export interface GatewayHealth {
  status: string;
  version: string;
  api_version: number;
  gateway_id: string;
  name: string;
  claimed: boolean;
  uptime: number;
  adapters: { loaded: number; failed: number };
  /** Absent or null until the gateway has a certificate; older gateways never send it. */
  tls?: GatewayTls | null;
}

/** The gateway's HTTPS base URLs, each a name whose first label is its gateway_id. */
export interface GatewayTls {
  /** `https://<gateway_id>.<lan zone>:8443`: a public name for its private home address, which some routers refuse to resolve. */
  lan_url: string | null;
  /** `https://<gateway_id>.<remote zone>`: through the relay, which forwards the encrypted bytes without reading them. */
  remote_url: string | null;
  /** When the certificate expires, in Unix seconds. */
  expires_at: number;
}

export interface GatewayClient {
  id: string;
  name: string;
  role: 'owner' | 'member';
  created_at?: number;
  last_seen?: number | null;
  revoked?: boolean;
}

export interface ClaimResult {
  client: GatewayClient;
  token: string;
  /** The client's shared secret for identity proofs (base64url, see services/gateway/hmac.ts). */
  pin_key: string;
  gateway: { id: string; name: string };
}

export interface RemoteStatus {
  tailscale: { detected: boolean; addresses: string[] };
  relay: { configured: boolean; url: string | null; connected: boolean; public_url: string | null; last_error: string | null };
}

export type GatewayEvent =
  | { type: 'ready' }
  | { type: 'error'; code: string }
  | { type: 'device.updated'; data: { device: GatewayDevice }; at: number }
  | { type: 'device.removed'; data: { id: string }; at: number }
  | { type: 'rooms.updated'; data: { rooms: GatewayRoom[] }; at: number }
  | { type: 'discovery.progress'; data: { job: DiscoveryJob }; at: number }
  | { type: 'discovery.candidate'; data: { candidate: Candidate }; at: number }
  | { type: 'pairing.updated'; data: { pairing: Pairing }; at: number }
  | { type: 'provisioning.updated'; data: { session: ProvisioningSession }; at: number }
  | { type: 'client.revoked'; data: { id: string }; at: number };
