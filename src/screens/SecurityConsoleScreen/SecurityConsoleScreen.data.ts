import type { StatusTone } from '../../components/ui/StatusChip';
import type { ScanResult } from '../../services/parking/gate';
import type { ArrivalPhase } from '../../services/parking/tracking';

export const consoleCopy = {
  title: 'Security Console',
  roleNote:
    'Demo role: gate security. Every barrier action here is simulated. A real gate validates the code on a server before opening.',
  entryNote:
    'Entry proves the car entered the parking area. This demo marks the assigned bay occupied on entry; a real site would confirm it with bay sensors or a guard.',
  emergency: 'Booking rules never block an emergency: security can always open the barrier.',
  arrivalsNote: 'Due in the next hour, and late arrivals whose bay is still held. Tap one to get its pass ready to scan.',
  noArrivals: 'Nobody is due in the next hour.',
  plateToCome: 'plate to come',
  arrivalHint: 'Picks this pass and its gate for a simulated scan',
} as const;

/** Where an expected arrival stands at the gate. */
export const arrivalChip: Record<ArrivalPhase, { label: string; tone: StatusTone }> = {
  due: { label: 'Due', tone: 'violet' },
  open: { label: 'Entry open', tone: 'teal' },
  late: { label: 'Late', tone: 'amber' },
};

export const needsBayChip: { label: string; tone: StatusTone } = { label: 'Needs bay', tone: 'red' };

export const arrivalPicked = (gate: string) => `${gate} and its entry lane are selected. Scan the pass as if the car were at the barrier.`;

export const arrivalScan = (gate: string) => `Scan their pass at ${gate}`;

/** Keeps "Gate 2" and "04:00 PM" on one line, so a narrow row breaks at the dots instead. */
export const keepTogether = (text: string) => text.replace(/(Gate|\d) (\d|AM|PM)/g, '$1\u00A0$2');

export function resultTone(result: ScanResult): 'success' | 'warning' | 'error' {
  if (result.outcome === 'accepted') return 'success';
  return result.outcome === 'already-processed' ? 'warning' : 'error';
}
