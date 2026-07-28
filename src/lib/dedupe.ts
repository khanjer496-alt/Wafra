import type { Transaction, TransactionType } from '@/lib/types';

/**
 * Deciding whether a parsed message is one the ledger already has.
 *
 * This lives apart from auto-import.ts because that file imports react-native
 * and so cannot be tested — and this is the logic where being wrong shows up
 * as the user's salary appearing twice.
 *
 * There are three fingerprints and they answer different questions, because
 * the same real transaction can reach us through three capture channels:
 *
 *   inbox     the SMS provider's copy, stamped with when it stored the message
 *   delivery  the broadcast receiver's copy of the SAME SMS, stamped with the
 *             timestamp the carrier wrote into the PDU — seconds apart
 *   push      the bank's own app notification about the same event, in
 *             completely different words
 *
 * A fingerprint built out of the timestamp cannot see that the first two are
 * one message, and a fingerprint built out of the title cannot see that the
 * third is the same event. Hence three.
 */

/** Message text reduced to what two captures of the same SMS must agree on. */
export function bodyPrint(body: string): string {
  return body.replace(/\s+/g, ' ').trim().toLowerCase();
}

/** Day, amount and name — the everyday duplicate check. */
export function dedupeKey(date: string, amountFils: number, title: string): string {
  return `${date}|${amountFils}|${title.toLowerCase()}`;
}

/**
 * Day, amount and direction — everything a push notification can be held to,
 * since it words the same event differently from the SMS about it.
 */
export function crossChannelKey(date: string, amountFils: number, type: string): string {
  return `${date}|${amountFils}|${type}`;
}

export type CaptureChannel = 'inbox' | 'delivery' | 'push';

export interface DuplicateCandidate {
  date: string;
  amountFils: number;
  title: string;
  type: TransactionType;
  /** `s{timestamp}-{amount}`, when the message carried a timestamp. */
  smsKey?: string;
  channel?: CaptureChannel;
  /** Set only for rows already in the ledger, so a later SMS can replace them. */
  id?: string;
}

export interface DuplicateGuard {
  /** True when the ledger already has this, by any of the three tests. */
  has(c: DuplicateCandidate): boolean;
  /**
   * The id of an existing PUSH row this SMS is the better version of, if any.
   *
   * A bank app posts its notification the instant the card is used and the
   * SMS reaches the provider's inbox a moment later, so which one this app
   * sees first is a race. The push copy is worded differently and parses
   * worse, so when the SMS finally arrives it must REPLACE that row — not sit
   * beside it, which is what happened, and is what made a charge appear twice
   * shortly after notification access was granted.
   */
  supersedes(c: DuplicateCandidate): string | null;
  /** Record it, so the rest of this same batch dedupes against it too. */
  add(c: DuplicateCandidate): void;
}

/**
 * How close two captures of the same money must be to be the same event.
 *
 * The inbox stamps the provider's time and the delivery receiver stamps the
 * carrier's; they differ by seconds. Two genuine identical charges — the same
 * coffee bought twice — are minutes apart at the very least.
 */
const SAME_EVENT_MS = 120_000;

/** The timestamp inside `s{ts}-{amount}`, or null if there isn't one. */
function keyTime(smsKey: string | undefined): number | null {
  const m = smsKey?.match(/^s(\d+)-/);
  return m ? Number(m[1]) : null;
}

export function duplicateGuard(existing: Transaction[]): DuplicateGuard {
  /** dedupeKey → the capture times filed under it. */
  const seen = new Map<string, (number | null)[]>();
  const note = (key: string, ts: number | null) => {
    const at = seen.get(key);
    if (at) at.push(ts);
    else seen.set(key, [ts]);
  };
  for (const t of existing) {
    note(dedupeKey(t.date, t.amountFils, t.title), keyTime(t.smsKey));
  }
  const seenSms = new Set(existing.map((t) => t.smsKey).filter(Boolean) as string[]);
  const seenLoose = new Set(
    existing
      .filter((t) => t.source === 'sms')
      .map((t) => crossChannelKey(t.date, t.amountFils, t.type)),
  );
  /** crossChannelKey → id, for rows that came from a push notification. */
  const pushRows = new Map<string, string>();
  for (const t of existing) {
    if (t.viaPush) pushRows.set(crossChannelKey(t.date, t.amountFils, t.type), t.id);
  }

  return {
    has(c) {
      if (c.smsKey && seenSms.has(c.smsKey)) return true;
      const at = seen.get(dedupeKey(c.date, c.amountFils, c.title));
      if (at) {
        const mine = keyTime(c.smsKey);
        // Same day, same amount, same name. That is one event captured twice
        // UNLESS both sides carry a timestamp and those are far enough apart
        // to be two separate visits. Without this the second identical charge
        // of the day was silently dropped and the user's spending under-read
        // — the comment here claimed both rows survived; the code kept one.
        if (mine === null || at.some((t) => t === null || Math.abs(t - mine) <= SAME_EVENT_MS)) {
          return true;
        }
      }
      // Deliberately asymmetric. Only a PUSH is dropped for merely matching
      // the money, the day and the direction — SMS has the fuller text and
      // the better parse, so it wins. When the SMS is the one arriving
      // second, `supersedes` replaces the push row instead of dropping this.
      if (c.channel === 'push' && seenLoose.has(crossChannelKey(c.date, c.amountFils, c.type))) {
        return true;
      }
      return false;
    },
    supersedes(c) {
      if (c.channel === 'push') return null;
      return pushRows.get(crossChannelKey(c.date, c.amountFils, c.type)) ?? null;
    },
    add(c) {
      note(dedupeKey(c.date, c.amountFils, c.title), keyTime(c.smsKey));
      if (c.smsKey) seenSms.add(c.smsKey);
      seenLoose.add(crossChannelKey(c.date, c.amountFils, c.type));
      if (c.channel === 'push' && c.id) {
        pushRows.set(crossChannelKey(c.date, c.amountFils, c.type), c.id);
      }
    },
  };
}
