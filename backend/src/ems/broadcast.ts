import { memberIdsOfSite, memberIdsOfUnit } from '../repositories/units.ts';
import { publish, type UserEvent } from './events.ts';

/**
 * Realtime to everyone in a unit or on a site, over each person's own channel (events.ts). Only people who live
 * there receive it; an event never goes wider.
 */

export function publishToUsers(userIds: Iterable<string>, event: UserEvent): void {
  for (const userId of new Set(userIds)) publish(userId, event);
}

export const publishToUnit = (unitId: string, event: UserEvent) => publishToUsers(memberIdsOfUnit(unitId), event);

export const publishToSite = (siteId: string, event: UserEvent) => publishToUsers(memberIdsOfSite(siteId), event);
