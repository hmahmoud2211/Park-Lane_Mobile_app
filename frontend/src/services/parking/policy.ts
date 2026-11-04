/**
 * Booking and access rules. Every scheduling rule reads its numbers from
 * here, so changing a buffer or limit is a configuration change, not a code
 * hunt. The active copy lives in the store (`ParkingDb.policy`), seeded from
 * these defaults.
 */
export interface PolicySettings {
  /** Kept free after a stay before the next one may start. */
  turnoverBufferMinutes: number;
  /** A confirmed visit may still enter this long after its start. */
  lateArrivalGraceMinutes: number;
  /** Entry is allowed this long before the start, if the bay is free. */
  earlyArrivalMinutes: number;
  /** Guest bookings one property may hold at the same time. */
  maxSimultaneousGuestBookingsPerProperty: number;
  maxStandardDurationMinutes: number;
  maxEvParkingDurationMinutes: number;
  maxChargingDurationMinutes: number;
  /** Bookings may start at most this far ahead. */
  bookingHorizonDays: number;
  /** A start this far in the past still counts as "now". */
  startTolerancePastMinutes: number;
  /** Default gap between charging end and parking departure. */
  evMoveOutBufferMinutes: number;
  /** After charging ends, the car should leave the EV bay within this. */
  evMoveOutGraceMinutes: number;
  /** A reserved charging slot is held this long after its start for plug-in. */
  chargingPlugInGraceMinutes: number;
  /** Booking times are offered on this grid. */
  slotMinutes: number;
}

export const defaultPolicy: PolicySettings = {
  turnoverBufferMinutes: 10,
  lateArrivalGraceMinutes: 20,
  earlyArrivalMinutes: 30,
  maxSimultaneousGuestBookingsPerProperty: 2,
  maxStandardDurationMinutes: 8 * 60,
  maxEvParkingDurationMinutes: 10 * 60,
  maxChargingDurationMinutes: 4 * 60,
  bookingHorizonDays: 14,
  startTolerancePastMinutes: 15,
  evMoveOutBufferMinutes: 15,
  evMoveOutGraceMinutes: 15,
  chargingPlugInGraceMinutes: 30,
  slotMinutes: 15,
};

/** Display and booking timezone. Storage is always UTC. */
export const SITE_TIME_ZONE = 'Africa/Cairo';

/** Fictional compound identity shown on passes. */
export const siteInfo = {
  compoundName: 'Park Lane Compoundhood',
  city: 'New Capital (demo)',
  /** Fictional number for the demo; replace with the real security desk. */
  securityPhone: '+20 2 0000 0100',
  /** Turns a local number such as 0100 123 4567 into +20 100 123 4567 for WhatsApp. */
  countryCallingCode: '20',
  /**
   * Base URL for invitation links on native, where there is no page origin.
   * On web the page's own origin is used. Fictional placeholder.
   */
  nativeInviteBaseUrl: 'https://parklane-demo.example',
} as const;
