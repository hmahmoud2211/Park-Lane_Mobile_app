import { config } from '../config.ts';

/**
 * The brands a resident can link from the app. Each is a Home Assistant
 * integration that reaches its devices through the maker's cloud, so it
 * works from a hub on the company server (local-only integrations would
 * not). Handlers are checked against IOT/core/homeassistant/components:
 * `iot_class` cloud_polling or cloud_push, with a config flow.
 *
 * `method` tells the app what to expect:
 *  - credentials: forms (email, password, API token, PIN…)
 *  - qr: a form, then a QR code to scan with the brand's own app
 *  - oauth: the brand's sign-in page in a browser; needs the company's OAuth
 *    app for that brand in HA_OAUTH_CREDENTIALS and PUBLIC_URL for the callback
 *
 * `sonoff` is not part of Home Assistant: it is the community SonoffLAN
 * integration (github.com/AlexxIT/SonoffLAN), which signs in to the eWeLink
 * cloud. A hub has it once it is in the hub's custom_components
 * (HA_CUSTOM_COMPONENTS for provisioned units); without it, starting the
 * link says the brand is not available on that hub.
 */

export type LinkMethod = 'credentials' | 'qr' | 'oauth';

export interface Integration {
  id: string;
  name: string;
  method: LinkMethod;
  /** What the resident needs before starting. */
  hint: string;
}

const INTEGRATIONS: readonly Integration[] = [
  { id: 'tuya', name: 'Tuya / Smart Life', method: 'qr', hint: 'The user code from the Smart Life app (Me → Settings → Account and Security), then scan a QR code with it.' },
  { id: 'sonoff', name: 'SONOFF (eWeLink)', method: 'credentials', hint: 'The email or phone number and password of your eWeLink app account.' },
  { id: 'smartthings', name: 'Samsung SmartThings', method: 'oauth', hint: 'Sign in with your Samsung account.' },
  { id: 'switchbot_cloud', name: 'SwitchBot', method: 'credentials', hint: 'The token and secret from the SwitchBot app (Profile → Preferences → Developer options).' },
  { id: 'lg_thinq', name: 'LG ThinQ', method: 'credentials', hint: 'A personal access token from the LG ThinQ developer site.' },
  { id: 'nest', name: 'Google Nest', method: 'oauth', hint: 'Sign in with the Google account your Nest devices use.' },
  { id: 'ring', name: 'Ring', method: 'credentials', hint: 'Your Ring email and password, and the code Ring sends you.' },
  { id: 'ecobee', name: 'ecobee', method: 'credentials', hint: 'An API key, then a PIN you enter at ecobee.com.' },
  { id: 'tado', name: 'tado°', method: 'credentials', hint: 'You confirm the link on tado’s website.' },
  { id: 'sensibo', name: 'Sensibo', method: 'credentials', hint: 'An API key from home.sensibo.com.' },
  { id: 'netatmo', name: 'Netatmo', method: 'oauth', hint: 'Sign in with your Netatmo account.' },
  { id: 'august', name: 'August', method: 'oauth', hint: 'Sign in with your August account.' },
  { id: 'yale', name: 'Yale Home', method: 'oauth', hint: 'Sign in with your Yale Home account.' },
  { id: 'blink', name: 'Blink', method: 'credentials', hint: 'Your Blink email and password, and the code Blink sends you.' },
  { id: 'ezviz', name: 'EZVIZ', method: 'credentials', hint: 'Your EZVIZ account email and password.' },
  { id: 'ecovacs', name: 'Ecovacs', method: 'credentials', hint: 'Your Ecovacs account email and password.' },
  { id: 'miele', name: 'Miele', method: 'oauth', hint: 'Sign in with your Miele account.' },
  { id: 'home_connect', name: 'Home Connect (Bosch, Siemens)', method: 'oauth', hint: 'Sign in with your Home Connect account.' },
];

const BY_ID = new Map(INTEGRATIONS.map((integration) => [integration.id, integration]));

export function findIntegration(id: string): Integration | undefined {
  return BY_ID.get(id);
}

/** OAuth brands only work once the company has an app with them and the callback is reachable. */
export function isAvailable(integration: Integration): boolean {
  return integration.method !== 'oauth' || (Boolean(config.publicUrl) && integration.id in config.ha.oauthCredentials);
}

export function listIntegrations(): (Integration & { available: boolean })[] {
  return INTEGRATIONS.map((integration) => ({ ...integration, available: isAvailable(integration) }));
}
