import { createApp } from './app.ts';
import { config } from './config.ts';
import { isConfigured as alexaConfigured } from './ems/alexaLink.ts';
import { db } from './ems/db.ts';
import { startAdapters } from './ems/devices.ts';
import { log } from './log.ts';
import { browser, startBridge } from './sonoff/bridge.ts';

/** Starts the backend: routes in app.ts, EMS storage in ems/, the SONOFF bridge in sonoff/. */

db();
await startBridge();
startAdapters();

if (config.alexa.devVoiceToken) {
  log.warn('DEVELOPMENT ONLY: DEV_VOICE_TOKEN is set; the voice API accepts it without account linking.');
}

createApp().listen(config.port, config.host, () => {
  log.info(`Parklane device backend on http://${config.host}:${config.port}`, {
    cube: config.cube.url,
    publicUrl: config.publicUrl || '(not set: registration disabled)',
    emsPublicUrl: config.ems.publicUrl || '(not set: Alexa linking disabled)',
    alexaLinking: alexaConfigured(),
    mdns: browser.listening,
    auth: config.apiKey ? 'api key' : 'none',
  });
});
