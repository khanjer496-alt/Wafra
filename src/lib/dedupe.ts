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
}

export interface DuplicateGuard {
  /** True when the ledger already has this, by any of the three tests. */
  has(c: DuplicateCandidate): boolean;
  /** Record it, so the rest of this same batch dedupes against it too. */
  add(c: DuplicateCandidate): void;
}

export function duplicateGuard(existing: Transaction[]): DuplicateGuard {
  const seen = new Set(existing.map((t) => dedupeKey(t.date, t.amountFils, t.title)));
  const seenSms = new Set(existing.map((t) => t.smsKey).filter(Boolean) as string[]);
  const seenLoose = new Set(
    existing
      .filter((t) => t.source === 'sms')
      .map((t) => crossChannelKey(t.date, t.amountFils, t.type)),
  );

  return {
    has(c) {
      if (seen.has(dedupeKey(c.date, c.amountFils, c.title))) return true;
      if (c.smsKey && seenSms.has(c.smsKey)) return true;
      // Deliberately asymmetric. Only a PUSH is dropped for merely matching
      // the money, the day and the direction — SMS has the fuller text and
      // the better parse, so it wins, and two genuine same-day same-amount
      // charges captured the ordinary way are still two rows.
      if (c.channel === 'push' && seenLoose.has(crossChannelKey(c.date, c.amountFils, c.type))) {
        return true;
      }
      return false;
    },
    add(c) {
      seen.add(dedupeKey(c.date, c.amountFils, c.title));
      if (c.smsKey) seenSms.add(c.smsKey);
      seenLoose.add(crossChannelKey(c.date, c.amountFils, c.type));
    },
  };
}
