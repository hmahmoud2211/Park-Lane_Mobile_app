import type { PolicySettings } from '../../services/parking/policy';
import { HOUR_MS, MINUTE_MS } from '../../services/parking/time';

export const demoCopy = {
  title: 'Demo Controls',
  intro:
    'Everything here is a simulation tool for presenting the demo. Residents, visitors and security never see these controls.',
  clockNote:
    'One demo clock drives every rule: arrival expiry, overstays, charging progress and availability all move together. Time only moves forward; reset the demo to return to now.',
  storage: {
    browser:
      'Saved in this browser (localStorage). Refreshing keeps everything. Other devices, and other browsers on this one, cannot see it: a shared backend would be needed for a visitor to open a pass on their own phone.',
    device:
      'Saved on this device only. Refreshing or restarting keeps everything; other devices cannot see it without a shared backend.',
    memory: 'Saved in memory only (storage is blocked here), so a refresh starts again from the seed data.',
  },
  resetConfirm: 'Replace all bookings and events with fresh demo data at the current time?',
} as const;

export const clockSteps = [
  { label: '+15 min', ms: 15 * MINUTE_MS },
  { label: '+1 hour', ms: HOUR_MS },
  { label: '+4 hours', ms: 4 * HOUR_MS },
  { label: '+1 day', ms: 24 * HOUR_MS },
] as const;

export const policyLabels: Record<keyof PolicySettings, [string, string]> = {
  turnoverBufferMinutes: ['Turnover buffer', 'min'],
  lateArrivalGraceMinutes: ['Late arrival grace', 'min'],
  earlyArrivalMinutes: ['Early arrival allowed', 'min'],
  maxSimultaneousGuestBookingsPerProperty: ['Guest bookings at once, per property', ''],
  maxStandardDurationMinutes: ['Longest visitor stay', 'min'],
  maxEvParkingDurationMinutes: ['Longest EV stay', 'min'],
  maxChargingDurationMinutes: ['Longest charging slot', 'min'],
  bookingHorizonDays: ['Booking horizon', 'days'],
  startTolerancePastMinutes: ['Arrival may be this far in the past', 'min'],
  evMoveOutBufferMinutes: ['Default stay after charging', 'min'],
  evMoveOutGraceMinutes: ['Move out of EV bay within', 'min'],
  chargingPlugInGraceMinutes: ['Plug in within', 'min'],
  slotMinutes: ['Booking time step', 'min'],
};
