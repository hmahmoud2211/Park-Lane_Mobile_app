import { createApp } from './app.ts';
import { config } from './config.ts';
import { db } from './ems/db.ts';
import { purgeExpiredContent } from './clinic/consultations.ts';
import { startHubs } from './ha/hubs.ts';
import { resumeReading } from './health/documents.ts';
import { sweepOrphanFiles } from './health/files.ts';
import { resumeSummaries } from './health/summaries.ts';
import { aiConfigured, aiModelName } from './integrations/ai/model.ts';
import { log } from './log.ts';

/**
 * Starts the backend: routes in app.ts, EMS storage in ems/, the units' Home Assistant
 * hubs in ha/, and the clinic's and Health Passport's upkeep and background work.
 */

db();
startHubs();

// Clinic retention: transcripts and AI drafts after CLINIC_TRANSCRIPT_RETENTION_DAYS, expired history summaries.
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

createApp().listen(config.port, config.host, () => {
  log.info(`Parklane device backend on http://${config.host}:${config.port}`, {
    auth: config.apiKey ? 'api key' : 'none',
    ai: aiConfigured() ? `${config.ai.provider} (${aiModelName()})` : 'off',
    clinicSpeech: Boolean(config.elevenlabs.apiKey),
  });
});
