import { createApp } from './app.ts';
import { config } from './config.ts';
import { ensureAdminAccount, ensureDefaultAccount } from './ems/auth.ts';
import { db } from './ems/db.ts';
import { purgeExpiredContent } from './clinic/consultations.ts';
import { purgeOldNotifications } from './ems/notifications.ts';
import { purgeOldPasses } from './visitors/passes.ts';
import { sweepOrphanPhotos } from './requests/serviceRequests.ts';
import { sweepParking } from './parking/accounts.ts';
import { startQuarterHourPush } from './series/api.ts';
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
await ensureDefaultAccount();
await ensureAdminAccount();
startHubs();

// Clinic retention: transcripts and AI drafts after CLINIC_TRANSCRIPT_RETENTION_DAYS, expired history summaries.
const purge = () => {
  try {
    const purged = purgeExpiredContent();
    if (purged > 0) log.info('Clinic retention: purged consultation working content', { consultations: purged });
    const orphans = sweepOrphanFiles();
    if (orphans > 0) log.info('Health Passport: removed files nothing refers to', { files: orphans });
    const notifications = purgeOldNotifications();
    if (notifications > 0) log.info('Inbox: removed old notifications', { notifications });
    const passes = purgeOldPasses();
    if (passes > 0) log.info('Visitors: removed past passes after their retention', { passes });
    const photos = sweepOrphanPhotos();
    if (photos > 0) log.info('Requests: removed photo files nothing refers to', { photos });
  } catch (error) {
    log.error('Clinic retention failed', { reason: (error as Error).message });
  }
};
purge();
setInterval(purge, 3600_000).unref();

// Parking: the rules that fall due with time (no-shows, overdue visits, charging windows) run every minute, as well
// as inside every request's step, so alerts go out even when nobody is using parking.
setInterval(() => {
  try {
    sweepParking();
  } catch (error) {
    log.error('Parking sweep failed', { reason: (error as Error).message });
  }
}, 60_000).unref();

// Each quarter hour, a new reading becomes current: residents' apps are told over the realtime channel.
startQuarterHourPush();

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
