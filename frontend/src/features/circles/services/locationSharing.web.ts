import type { LocationAccess } from '../types';

/**
 * The web app's version of locationSharing.ts: a browser cannot share its location in the background, so the web
 * app shows the Circle (who shares, last update, battery) but never shares its own position.
 */

export const locationAccess = async (): Promise<LocationAccess> => 'unsupported';
export const askForLocation = async (): Promise<LocationAccess> => 'unsupported';
export const openLocationSettings = async () => undefined;
export const sharingUpdatesRunning = async () => false;
export const startSharingUpdates = async () => undefined;
export const stopSharingUpdates = async () => undefined;
export const goLive = async (_until: number) => undefined;
