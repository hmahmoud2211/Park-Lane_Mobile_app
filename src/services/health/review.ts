import type { ConfirmInput, ConfirmItem, ExtractedItem, ItemData, RecordSection } from './health.types';
import { orderForReview } from './selectors';

export type ReviewState = 'pending' | 'confirmed' | 'removed';
export type DuplicateChoice = 'both' | 'replace' | 'skip';

export interface ReviewEntry {
  item: ExtractedItem;
  state: ReviewState;
  /** The data to save: as extracted, or as the resident corrected it. */
  data: ItemData<RecordSection>;
  edited: boolean;
  /** For a possible duplicate: what to do with the record's existing item. */
  duplicate: DuplicateChoice | null;
}

/** Low-confidence items first; nothing decided yet. */
export function startReview(items: readonly ExtractedItem[]): ReviewEntry[] {
  return orderForReview(items).map((item) => ({
    item,
    state: 'pending',
    data: item.data,
    edited: false,
    duplicate: null,
  }));
}

/** Items the resident must look at one by one: low confidence, or maybe already recorded. */
export const needsOwnCheck = (entry: ReviewEntry) =>
  entry.item.confidence === 'low' || entry.item.possible_duplicate_of !== null;

/** A possible duplicate can't be confirmed until the resident says what happens to the existing item. */
export const canConfirm = (entry: ReviewEntry) => entry.item.possible_duplicate_of === null || entry.duplicate !== null;

/** "Confirm all remaining" opens once every item that needs its own check has been decided. */
export const canConfirmAll = (entries: readonly ReviewEntry[]) =>
  entries.every((entry) => !needsOwnCheck(entry) || entry.state !== 'pending');

export function confirmRemaining(entries: readonly ReviewEntry[]): ReviewEntry[] {
  if (!canConfirmAll(entries)) return [...entries];
  return entries.map((entry) => (entry.state === 'pending' ? { ...entry, state: 'confirmed' } : entry));
}

export function update(entries: readonly ReviewEntry[], itemId: string, change: Partial<ReviewEntry>): ReviewEntry[] {
  return entries.map((entry) => (entry.item.item_id === itemId ? { ...entry, ...change } : entry));
}

/**
 * Every decided item is sent: confirmed ones as saves, and removed ones (or
 * a duplicate the resident chose to skip) as `reject`, so the backend drops
 * them for good. Items still pending are left for later.
 */
export function toConfirmInput(entries: readonly ReviewEntry[], finished: boolean): ConfirmInput {
  return {
    items: entries
      .filter((entry) => entry.state !== 'pending')
      .map((entry): ConfirmItem => {
        const id = entry.item.item_id;
        if (entry.state === 'removed' || entry.duplicate === 'skip') return { item_id: id, action: 'reject' };
        if (entry.duplicate === 'replace' && entry.item.possible_duplicate_of) {
          return { item_id: id, action: 'replace', data: entry.data, replace_id: entry.item.possible_duplicate_of };
        }
        return { item_id: id, action: 'add', data: entry.data };
      }),
    ...(finished ? { finished: true } : {}),
  };
}

/** How many of the decisions add something to the record. */
export const savedCount = (input: ConfirmInput) => input.items.filter((item) => item.action !== 'reject').length;

export const allDecided = (entries: readonly ReviewEntry[]) => entries.every((entry) => entry.state !== 'pending');
