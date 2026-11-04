import { getHubForUnit, runtimeForUser, runtimeStatus } from './hubs.ts';
import type { HubStatus, Room } from './types.ts';
import { unitForUser } from './units.ts';

/** GET /api/home: the resident's unit and the state of its hub, even while it is still being set up. */
export function homeFor(userId: string) {
  const unit = unitForUser(userId);
  const hub = getHubForUnit(unit.id);
  const status: HubStatus = hub ? (runtimeStatus(hub.id) ?? hub.status) : 'provisioning';
  let rooms: Room[] = [];
  let deviceCount = 0;
  if (hub && status !== 'provisioning' && status !== 'failed') {
    try {
      const runtime = runtimeForUser(userId);
      rooms = runtime.listRooms();
      deviceCount = runtime.listDevices().length;
    } catch {
      // Offline before the first connection: the status says so.
    }
  }
  return {
    unit: { id: unit.id, name: unit.name, building: unit.building },
    // A failed setup is the operators' problem; residents see it as still being set up.
    hub: { status: status === 'failed' ? 'provisioning' : status, haVersion: hub?.haVersion ?? null, lastSeen: hub?.lastSeen ?? null },
    rooms,
    deviceCount,
  };
}
