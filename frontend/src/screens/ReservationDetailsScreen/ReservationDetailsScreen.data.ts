import type { ChipOption } from '../../components/parking/Controls';
import type { TimelineItem } from '../../components/parking/Rows';
import { gateNameIn, nameIn, rangeIn, type Lang } from '../../services/parking/i18n';
import { siteInfo } from '../../services/parking/policy';
import type { ReservationView } from '../../services/parking/selectors';
import { formatDateTime, formatRange } from '../../services/parking/time';
import { shareChannelLabel, type ShareChannel } from '../../services/parking/tracking';
import type { ParkingDb, Reservation } from '../../services/parking/types';

export const detailsCopy = {
  title: 'Reservation',
  justBooked: 'Reserved and confirmed',
  justBookedBody: 'Share the pass with your guest. It shows their space, gate, QR code and directions.',
  justEdited: 'Changes saved',
  justEditedBody: 'Your guest’s pass and directions show the new details. The QR code stays the same.',
  passTitle: 'Guest pass',
  passBody: 'Your guest opens this link to see their pass and directions. No account is needed.',
  localOnly:
    'Demo: bookings are saved in this browser only. The link opens the pass here, on this device. Opening it on another phone needs a shared server, which this demo does not have.',
  cancelConfirm: 'Cancel this booking? The guest’s pass stops working immediately.',
  replaceConfirm: 'Issue a new QR? The current one stops working, so re-share the pass afterwards.',
  messageLanguage: 'Message and pass language',
  noPhone: 'No number saved for your guest, so WhatsApp will ask who to send it to.',
  deliveryNote: 'WhatsApp opens with the message written; you press send. The app can’t see whether it arrived.',
  trackerNote: 'From gate scans and bay records, never your guest’s location.',
  whatsappOpened: 'WhatsApp opened with the message ready. Press send there. The app can’t confirm delivery.',
  sendTitle: 'Send the pass',
  sendNote: 'You press send in WhatsApp; the app can’t confirm delivery.',
  localOnlyShort: 'Demo: the link opens only in this browser.',
  noPhoneShort: 'No number saved: WhatsApp will ask who to send to.',
  directions: 'Directions & site map',
} as const;

export const sendTo = (phone: string) => `To ${phone}`;
export const bookedSendTitle = (name: string) => `Booked! Send the pass to ${name}`;
export const openFailed = (app: string) => `Couldn’t open ${app} here. Copy the link and paste it into a message instead.`;

export const MESSAGE_LANGUAGES: readonly ChipOption<Lang>[] = [
  { value: 'en', label: 'English' },
  { value: 'ar', label: 'العربية' },
];

/**
 * The pass link, opening in the guest's language. `snapshot` (demo only, see
 * services/parking/passLink) lets the guest's own phone show the pass.
 */
export function passLink(link: string, lang: Lang, snapshot?: string): string {
  const query = [lang === 'ar' ? 'lang=ar' : '', snapshot ? `d=${snapshot}` : ''].filter(Boolean).join('&');
  return query ? `${link}?${query}` : link;
}

/**
 * The invitation, in the guest's language: when, which bay, which gate, and
 * what to do there. The pass link follows on its own line.
 */
export function passMessage(view: ReservationView, lang: Lang): string {
  const r = view.reservation;
  const first = r.guest?.name.trim().split(/\s+/)[0];
  if (lang === 'ar') {
    return [
      `${first ? `مرحبًا ${first}،` : 'مرحبًا،'} هذا تصريح موقفك في ${siteInfo.compoundName}.`,
      `${rangeIn(r.scheduledStart, r.scheduledEnd, 'ar')} · الموقف ${view.space.label}، ${nameIn(view.zone.name, 'ar')}`,
      `ادخل من ${gateNameIn(view.gate.id, 'ar')}، واعرض رمز QR الموجود في التصريح عند البوابة.`,
    ].join('\n');
  }
  return [
    `Hi ${first ?? 'there'}, here is your parking pass for ${siteInfo.compoundName}.`,
    `${formatRange(r.scheduledStart, r.scheduledEnd)} · Bay ${view.space.label}, ${view.zone.name}`,
    `Enter by ${view.gate.name} and show the QR code on the pass at the gate.`,
  ].join('\n');
}

/** Extensions offered as quick choices, in minutes. */
export const EXTEND_OPTIONS = [30, 60, 120] as const;

const AUDIT_LABELS: Record<string, string> = {
  'reservation.created': 'Booked',
  'reservation.edited': 'Booking changed',
  'reservation.extended': 'Visit extended',
  'reservation.cancelled': 'Cancelled',
  'reservation.reassigned': 'Moved to another bay',
  'reservation.no-show': 'Did not arrive in time',
  'reservation.overdue': 'Visit overdue',
  'reservation.vehicle-updated': 'Vehicle added',
  'pass.replaced': 'New QR issued',
  'pass.shared': 'Pass shared',
  'gate.manual-entry': 'Entry recorded by security',
  'gate.manual-exit': 'Exit recorded by security',
};

/** Booking, gate and bay events for one reservation, newest first, in plain words. */
export function timelineFor(db: ParkingDb, r: Reservation): TimelineItem[] {
  const items: (TimelineItem & { at: string })[] = [];
  for (const a of db.audit) {
    if (a.entityId !== r.id || !AUDIT_LABELS[a.action]) continue;
    const detail =
      a.action === 'pass.shared'
        ? `Through ${shareChannelLabel[a.details as ShareChannel] ?? a.details}. Delivery isn’t confirmed.`
        : (a.reason ?? a.details);
    items.push({ id: a.id, at: a.at, time: formatDateTime(a.at), title: AUDIT_LABELS[a.action], detail });
  }
  for (const e of db.scanEvents) {
    if (e.reservationId !== r.id) continue;
    const gate = db.gates.find((g) => g.id === e.gateId);
    const verb = e.direction === 'entry' ? 'Entry' : 'Exit';
    items.push({
      id: e.id,
      at: e.at,
      time: formatDateTime(e.at),
      title: e.outcome === 'accepted' ? `${verb} at ${gate?.name}` : `${verb} refused at ${gate?.name}`,
      detail: e.outcome === 'accepted' ? undefined : e.message,
      tone: e.outcome === 'accepted' ? 'good' : 'bad',
    });
  }
  for (const o of db.occupancyEvents) {
    if (o.reservationId !== r.id || o.source !== 'bay-vacated') continue;
    items.push({ id: o.id, at: o.at, time: formatDateTime(o.at), title: 'Left the EV bay', detail: o.note });
  }
  return items.sort((a, b) => Date.parse(b.at) - Date.parse(a.at));
}
