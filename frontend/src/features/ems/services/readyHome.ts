import type { Home } from '../../../types/home.types';

/**
 * The resident's home once its smart home can be used: signed in to EMS, linked to a
 * unit, and the unit's hub past setup. Null otherwise (signed out, no unit yet, or the hub
 * still being provisioned), when screens offer sign-in or say the home is on its way.
 */
export function readyHome(status: string, home: Home | null): Home | null {
  return status === 'signedIn' && home !== null && home.hub.status !== 'provisioning' ? home : null;
}
