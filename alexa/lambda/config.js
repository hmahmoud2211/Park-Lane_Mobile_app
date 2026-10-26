/**
 * Settings for the EMS Voice Control skill (Alexa-hosted, so there are no
 * environment variables: edit this file in the developer console's Code tab).
 *
 * Nothing here is a customer credential. Each customer's EMS access token
 * arrives in every request after account linking.
 */
module.exports = {
  /** The EMS backend's public HTTPS address (EMS_PUBLIC_URL on the backend). */
  EMS_API_URL: 'https://api-iot.ems-iot.com',

  /** Alexa allows about 8 seconds per answer; the backend waits up to 5 for the device. */
  REQUEST_TIMEOUT_MS: 7000,

  /**
   * DEVELOPMENT ONLY. Before account linking works, the skill can act as one
   * test user with the backend's DEV_VOICE_TOKEN. Leave empty in any skill
   * real customers use, and never commit a real value.
   */
  DEV_VOICE_TOKEN: '',
};
