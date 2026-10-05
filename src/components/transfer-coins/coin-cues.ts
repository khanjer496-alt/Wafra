/**
 * When a transfer's coin travels its route. Pure, so the screen only decides
 * and the row only draws.
 *
 * A cue is stamped with the moment it was given. A row that mounts long after
 * (scrolled away and back, a filter cleared) finds its cue stale and stays
 * still: the coin explains a change the person just saw, never replays one.
 */
import type { TransferListItem, TransferTag } from '@/lib/transfer-list';

export interface CoinCue {
  /** Date.now() when the cue was given. */
  at: number;
  /** How long this row waits before its coin sets off (the first rows are staggered). */
  delay: number;
}

/** Only the first rows on screen travel when the list appears, not every row of a long history. */
export const INTRO_ROWS = 3;
/** The first coin waits for the screen's own slide-in to finish before it sets off. */
export const INTRO_START = 360;
/** The first rows set off this far apart. */
export const INTRO_ROW_GAP = 120;
/** A cue older than this (plus its delay) is not played. */
export const CUE_FRESH_MS = 1200;

/** The ledger rows behind one route: both legs of a linked pair, else the one row. */
export function routeLegIds(item: Pick<TransferListItem, 'key' | 'transactionId' | 'linked'>): string[] {
  return item.linked ? item.key.split('|') : [item.transactionId];
}

/** Each listed leg's tag, to compare with the next list. */
export function legTags(items: readonly Pick<TransferListItem, 'key' | 'transactionId' | 'linked' | 'tag'>[]): Map<string, TransferTag> {
  const tags = new Map<string, TransferTag>();
  for (const item of items) for (const id of routeLegIds(item)) tags.set(id, item.tag);
  return tags;
}

/**
 * Routes that have just been answered: tagged own or someone else now, and at
 * least one of their legs was listed before as an open question (needs an
 * answer, or not answered yet). The coin then travels the route the person
 * just explained, to the account or person the "?" became. A row first seen
 * already answered (a period change, a first paint) is not an arrival; neither
 * is Undo, which goes back to a question, nor switching one answer for the other.
 */
export function newlyAnsweredRoutes(
  previous: ReadonlyMap<string, TransferTag>,
  items: readonly Pick<TransferListItem, 'key' | 'transactionId' | 'linked' | 'tag'>[],
): string[] {
  return items.filter(item => (item.tag === 'own' || item.tag === 'external') && routeLegIds(item).some(id => {
    const before = previous.get(id);
    return before === 'needs-answer' || before === 'unconfirmed';
  })).map(item => item.key);
}

/** The first rows' cues, staggered. */
export function introCues(keys: readonly string[], at: number): Map<string, CoinCue> {
  return new Map(keys.slice(0, INTRO_ROWS).map((key, index) => [key, { at, delay: INTRO_START + index * INTRO_ROW_GAP }] as const));
}

/** Whether a cue is still the moment it was given for. */
export function cueIsFresh(cue: CoinCue, now: number): boolean {
  return now - cue.at <= CUE_FRESH_MS + cue.delay;
}
