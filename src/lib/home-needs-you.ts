/**
 * Home's "Needs you" pill: the one thing that truly needs the person now, or
 * nothing. Highest priority only:
 *
 *   1. tracking has paused or stopped (capture off, the trial ended, or the
 *      alerts stopped arriving) — every figure on Home goes stale until it is fixed
 *   2. a card payment is overdue
 *   3. transfers wait for an answer (the Transfers question queue)
 *   4. a monthly limit is over
 *
 * Each need has a key; a need dismissed for the session is passed over and
 * the next one, if any, takes its place. Pure: the screen supplies the facts.
 */

export type TrackingNeed = 'paused' | 'stopped' | 'off';

export interface NeedsYouFacts {
  /** Tracking that needs the person, or null when it is running (or deliberately switched off). */
  tracking: TrackingNeed | null;
  /** The earliest overdue card payment, if any. */
  overdueCard: { id: string; title: string; amountFils: number; daysLate: number } | null;
  /** Transfers the Transfers card would ask about (transferQuestionQueue). */
  transferQuestions: number;
  /** Monthly limits already over this month. */
  limitsOver: number;
  /** Need keys dismissed this session. */
  dismissed: ReadonlySet<string>;
}

export type Need =
  | { kind: 'tracking'; key: string; tracking: TrackingNeed }
  | { kind: 'card'; key: string; dueId: string; title: string; amountFils: number; daysLate: number }
  | { kind: 'transfers'; key: string; count: number }
  | { kind: 'limit'; key: string; count: number };

export function pickNeed(facts: NeedsYouFacts): Need | null {
  const candidates: Need[] = [];
  if (facts.tracking) candidates.push({ kind: 'tracking', key: `tracking:${facts.tracking}`, tracking: facts.tracking });
  if (facts.overdueCard) {
    const due = facts.overdueCard;
    candidates.push({ kind: 'card', key: `card:${due.id}`, dueId: due.id, title: due.title, amountFils: due.amountFils,
      daysLate: Math.max(1, Math.round(due.daysLate)) });
  }
  if (facts.transferQuestions > 0) candidates.push({ kind: 'transfers', key: 'transfers', count: Math.floor(facts.transferQuestions) });
  if (facts.limitsOver > 0) candidates.push({ kind: 'limit', key: 'limit', count: Math.floor(facts.limitsOver) });
  return candidates.find((need) => !facts.dismissed.has(need.key)) ?? null;
}

/** Overdue card payments from Home's payment list (leavingSoon order), the latest-due first. */
export function earliestOverdueCard<T extends { id: string; kind: string; overdue?: boolean; daysLeft: number;
  dueId?: string; title: string; displayLabel?: string; amountFils: number }>(items: readonly T[]):
  NeedsYouFacts['overdueCard'] {
  let found: T | null = null;
  for (const item of items) {
    if (item.kind !== 'card' || !item.overdue || !item.dueId) continue;
    if (!found || item.daysLeft < found.daysLeft) found = item;
  }
  return found ? { id: found.dueId!, title: found.displayLabel ?? found.title, amountFils: found.amountFils, daysLate: -found.daysLeft } : null;
}

/* Dismissals last for this JS session only: a fresh launch asks again. */
let dismissedThisSession: ReadonlySet<string> = new Set<string>();
const listeners = new Set<() => void>();

export function dismissNeed(key: string): void {
  if (dismissedThisSession.has(key)) return;
  // A new set per change, so a subscriber can compare snapshots by identity.
  dismissedThisSession = new Set([...dismissedThisSession, key]);
  for (const listener of listeners) listener();
}

export function dismissedNeeds(): ReadonlySet<string> {
  return dismissedThisSession;
}

export function subscribeDismissedNeeds(listener: () => void): () => void {
  listeners.add(listener);
  return () => { listeners.delete(listener); };
}

/** Below this window height (pt) the pill goes inline: a floating one would sit on the first rows. */
export const NEEDS_YOU_SHORT_WINDOW = 700;
/** From this text scale the pill goes inline, for the same reason. */
export const NEEDS_YOU_INLINE_FONT_SCALE = 1.2;

/**
 * Whether the Needs you pill sits inline at the top of Home's sheet rather
 * than floating above the tab bar: with large text (the app's large-text
 * layout, or a text scale of 1.2 or more) or on a window shorter than 700pt.
 */
export function needsYouInline(layout: { largeText: boolean; fontScale: number; height: number }): boolean {
  return layout.largeText || layout.fontScale >= NEEDS_YOU_INLINE_FONT_SCALE || layout.height < NEEDS_YOU_SHORT_WINDOW;
}
