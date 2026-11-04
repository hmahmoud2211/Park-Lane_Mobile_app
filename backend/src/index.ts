import { createApp } from './app.ts';
import { config } from './config.ts';
import { db } from './ems/db.ts';
import { startHubs } from './ha/hubs.ts';
import { log } from './log.ts';

/** Starts the backend: routes in app.ts, EMS storage in ems/, the units' Home Assistant hubs in ha/. */

db();
startHubs();

createApp().listen(config.port, config.host, () => {
  log.info(`Parklane device backend on http://${config.host}:${config.port}`, {
    auth: config.apiKey ? 'api key' : 'none',
  });
});
