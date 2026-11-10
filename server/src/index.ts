import { aiConfigured, aiModelName } from './ai/model.ts';
import { createApp } from './app.ts';
import { purgeExpiredContent } from './clinic/consultations.ts';
import { resumeReading } from './health/documents.ts';
import { sweepOrphanFiles } from './health/files.ts';
import { resumeSummaries } from './health/summaries.ts';
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

// Clinic retention: dictations and AI proposals after CLINIC_TRANSCRIPT_RETENTION_DAYS, expired history summaries.
const purge = () => {
  try {
    const purged = purgeExpiredContent();
    if (purged > 0) log.info('Clinic retention: purged consultation working content', { consultations: purged });
    const orphans = sweepOrphanFiles();
    if (orphans > 0) log.info('Health Passport: removed files nothing refers to', { files: orphans });
  } catch (error) {
    log.error('Clinic retention failed', { reason: (error as Error).message });
  }
};
purge();
setInterval(purge, 3600_000).unref();

// Documents and summaries interrupted by a restart pick up where they were.
const resumed = { documents: resumeReading(), summaries: resumeSummaries() };
if (resumed.documents || resumed.summaries) log.info('Health Passport: resumed background work', resumed);

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
    ai: aiConfigured() ? `${config.ai.provider} (${aiModelName()})` : 'off',
    clinicSpeech: Boolean(config.elevenlabs.apiKey),
  });
});
