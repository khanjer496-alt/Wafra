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
  /** Capture time, independent of the channel-specific SMS fingerprint. */
  ts?: number;
  channel?: CaptureChannel;
  /** Resolved account/card. Required for high-confidence settlement pairing. */
  accountId?: string;
  eventKind?: 'transaction' | 'cardPayment';
  /** Which bank alert described the card settlement. Opposite sides are one event. */
  cardPaymentSide?: 'debit' | 'receipt';
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
/** Push and SMS clocks may drift, but a day-wide match erases real purchases. */
const CROSS_CHANNEL_EVENT_MS = 120_000;
/** Debit-account confirmation and card receipt can be several minutes apart. */
const CARD_PAYMENT_PAIR_MS = 30 * 60_000;

/** The timestamp inside `s{ts}-{amount}`, or null if there isn't one. */
function keyTime(smsKey: string | undefined): number | null {
  const m = smsKey?.match(/^s(\d+)-/);
  return m ? Number(m[1]) : null;
}

function candidateTime(c: Pick<DuplicateCandidate, 'ts' | 'smsKey'>): number | null {
  return Number.isFinite(c.ts) ? c.ts! : keyTime(c.smsKey);
}

interface SeenEvent {
  ts: number | null;
  channel: CaptureChannel;
  id?: string;
}

interface SeenCardPayment {
  date: string;
  ts: number | null;
  side: 'debit' | 'receipt';
  title: string;
  /** One bank-side alert can consume only one card-side receipt. */
  paired: boolean;
}

interface SeenManualPayment {
  /** One explicit Mark-paid row can explain one alert on each bank side. */
  consumedSides: Set<'debit' | 'receipt' | 'unknown'>;
}

function closeEnough(a: number | null, b: number | null, windowMs: number): boolean {
  return a !== null && b !== null && Math.abs(a - b) <= windowMs;
}

function sameOrAdjacentDate(a: string, b: string): boolean {
  const aTime = Date.parse(`${a}T12:00:00Z`);
  const bTime = Date.parse(`${b}T12:00:00Z`);
  return (
    Number.isFinite(aTime) &&
    Number.isFinite(bTime) &&
    Math.abs(aTime - bTime) <= 86_400_000
  );
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
    // Locally-created and migrated rows may have no SMS fingerprint but still
    // carry a precise event clock. Treating those as timeless made every
    // identical purchase later that day look like the same event.
    note(dedupeKey(t.date, t.amountFils, t.title), candidateTime(t));
  }
  const seenSms = new Set(existing.map((t) => t.smsKey).filter(Boolean) as string[]);
  /** A day/amount/direction key still needs a capture time to identify an event. */
  const crossChannel = new Map<string, SeenEvent[]>();
  const noteCross = (key: string, event: SeenEvent) => {
    const rows = crossChannel.get(key);
    if (rows) rows.push(event);
    else crossChannel.set(key, [event]);
  };
  /** Opposite alerts for one card payment: bank-account debit + card receipt. */
  const cardPayments = new Map<string, SeenCardPayment[]>();
  const noteCardPayment = (key: string, event: SeenCardPayment) => {
    const rows = cardPayments.get(key);
    if (rows) rows.push(event);
    else cardPayments.set(key, [event]);
  };
  const manualPayments = new Map<string, SeenManualPayment[]>();
  const noteManualPayment = (key: string) => {
    const rows = manualPayments.get(key);
    if (rows) rows.push({ consumedSides: new Set() });
    else manualPayments.set(key, [{ consumedSides: new Set() }]);
  };
  for (const t of existing) {
    if (t.source === 'sms') {
      noteCross(crossChannelKey(t.date, t.amountFils, t.type), {
        ts: Number.isFinite(t.ts) ? t.ts! : keyTime(t.smsKey),
        channel: t.viaPush ? 'push' : 'inbox',
        id: t.id,
      });
    }
    if (t.cardPaymentSide) {
      noteCardPayment(`${t.amountFils}|${t.accountId}`, {
        date: t.date,
        ts: Number.isFinite(t.ts) ? t.ts! : keyTime(t.smsKey),
        side: t.cardPaymentSide,
        title: t.title,
        paired: false,
      });
    }
    if (t.source === 'manual' && t.type === 'income' && t.isTransfer === true) {
      noteManualPayment(`${t.date}|${t.amountFils}|${t.accountId}`);
    }
  }

  return {
    has(c) {
      if (c.smsKey && seenSms.has(c.smsKey)) return true;
      const mine = candidateTime(c);
      if (c.eventKind === 'cardPayment' && c.accountId) {
        const side = c.cardPaymentSide ?? 'unknown';
        const manual = (
          manualPayments.get(`${c.date}|${c.amountFils}|${c.accountId}`) ?? []
        ).find((row) => !row.consumedSides.has(side));
        if (manual) {
          manual.consumedSides.add(side);
          return true;
        }
      }
      if (c.eventKind === 'cardPayment' && c.accountId && c.cardPaymentSide) {
        const rows = cardPayments.get(`${c.amountFils}|${c.accountId}`) ?? [];
        const paired = rows.find(
          (row) =>
            !row.paired &&
            row.side !== c.cardPaymentSide &&
            sameOrAdjacentDate(row.date, c.date) &&
            closeEnough(row.ts, mine, CARD_PAYMENT_PAIR_MS),
        );
        if (paired) {
          paired.paired = true;
          return true;
        }
        // Provider/delivery copies on the SAME side can still race by seconds.
        // Once an opposite side has been consumed, however, it cannot act as
        // a generic title duplicate for every later genuine receipt.
        if (
          rows.some(
            (row) =>
              row.side === c.cardPaymentSide &&
              row.date === c.date &&
              row.title.toLowerCase() === c.title.toLowerCase() &&
              closeEnough(row.ts, mine, SAME_EVENT_MS),
          )
        ) return true;
      } else {
        const at = seen.get(dedupeKey(c.date, c.amountFils, c.title));
        if (at) {
          // Same day, same amount, same name. That is one event captured twice
          // UNLESS both sides carry a timestamp and those are far enough apart
          // to be two separate visits. Without this the second identical charge
          // of the day was silently dropped and the user's spending under-read
          // — the comment here claimed both rows survived; the code kept one.
          if (mine === null || at.some((t) => t === null || Math.abs(t - mine) <= SAME_EVENT_MS)) {
            return true;
          }
        }
      }
      // Deliberately asymmetric. Only a PUSH is dropped for merely matching
      // the money, the day and the direction — SMS has the fuller text and
      // the better parse, so it wins. When the SMS is the one arriving
      // second, `supersedes` replaces the push row instead of dropping this.
      if (c.channel === 'push') {
        const rows = crossChannel.get(crossChannelKey(c.date, c.amountFils, c.type)) ?? [];
        if (
          rows.some(
            (row) => row.channel !== 'push' && closeEnough(row.ts, mine, CROSS_CHANNEL_EVENT_MS),
          )
        ) return true;
      }
      return false;
    },
    supersedes(c) {
      if (c.channel === 'push') return null;
      const mine = candidateTime(c);
      const rows = crossChannel.get(crossChannelKey(c.date, c.amountFils, c.type)) ?? [];
      let best: SeenEvent | null = null;
      for (const row of rows) {
        if (row.channel !== 'push' || !row.id || !closeEnough(row.ts, mine, CROSS_CHANNEL_EVENT_MS)) {
          continue;
        }
        if (!best || Math.abs(row.ts! - mine!) < Math.abs(best.ts! - mine!)) best = row;
      }
      return best?.id ?? null;
    },
    add(c) {
      const ts = candidateTime(c);
      note(dedupeKey(c.date, c.amountFils, c.title), ts);
      if (c.smsKey) seenSms.add(c.smsKey);
      noteCross(crossChannelKey(c.date, c.amountFils, c.type), {
        ts,
        channel: c.channel ?? 'inbox',
        id: c.id,
      });
      if (c.eventKind === 'cardPayment' && c.accountId && c.cardPaymentSide) {
        noteCardPayment(`${c.amountFils}|${c.accountId}`, {
          date: c.date,
          ts,
          side: c.cardPaymentSide,
          title: c.title,
          paired: false,
        });
      }
    },
  };
}

/**
 * Repair duplicates already persisted by older capture code.
 *
 * This is intentionally narrower than import-time matching. A migration is
 * allowed to merge only when source identity is strong: the exact same SMS
 * fingerprint, a push/SMS pair within the event window, or two byte-equivalent
 * parsed SMS rows within 30 seconds (provider inbox + delivery receiver), or
 * the opposite alerts for one card settlement on the exact same account.
 * A user-edited row is never removed or overwritten: when one strong-identity
 * copy is edited only the unedited copy is discarded; two edited copies stay.
 * Same-day/same-value alone is never enough. The fuller SMS otherwise wins
 * over a push, including its card account.
 */
export function reconcileCaptureDuplicates(transactions: Transaction[]): Transaction[] {
  const kept: Transaction[] = [];
  let changed = false;
  const bySmsKey = new Map<string, number[]>();
  const byCrossBucket = new Map<string, number[]>();
  const byTitleBucket = new Map<string, number[]>();
  const byCardPaymentBucket = new Map<string, number[]>();
  const pairedCardPayments = new Set<number>();

  const timeOf = (t: Transaction): number | null =>
    Number.isFinite(t.ts) ? t.ts! : keyTime(t.smsKey);

  const pushIndex = (map: Map<string, number[]>, key: string, index: number) => {
    const rows = map.get(key);
    if (rows) rows.push(index);
    else map.set(key, [index]);
  };
  const bucket = (ts: number, width: number) => Math.floor(ts / width);
  const noteAt = (row: Transaction, index: number) => {
    if (row.smsKey) pushIndex(bySmsKey, row.smsKey, index);
    const ts = timeOf(row);
    if (ts === null || row.source !== 'sms') return;
    const cross = crossChannelKey(row.date, row.amountFils, row.type);
    pushIndex(byCrossBucket, `${cross}|${bucket(ts, CROSS_CHANNEL_EVENT_MS)}`, index);
    const title = dedupeKey(row.date, row.amountFils, row.title);
    pushIndex(byTitleBucket, `${title}|${bucket(ts, 30_000)}`, index);
    if (row.cardPaymentSide && row.isTransfer === true) {
      const payment = `${row.amountFils}|${row.accountId}`;
      pushIndex(byCardPaymentBucket, `${payment}|${bucket(ts, CARD_PAYMENT_PAIR_MS)}`, index);
    }
  };
  const isOppositeCardPaymentPair = (
    row: Transaction,
    prior: Transaction,
    rowTime: number | null,
  ): boolean =>
    row.isTransfer === true &&
    prior.isTransfer === true &&
    Boolean(row.cardPaymentSide) &&
    Boolean(prior.cardPaymentSide) &&
    row.cardPaymentSide !== prior.cardPaymentSide &&
    row.accountId === prior.accountId &&
    sameOrAdjacentDate(row.date, prior.date) &&
    row.amountFils === prior.amountFils &&
    closeEnough(rowTime, timeOf(prior), CARD_PAYMENT_PAIR_MS);

  for (const row of transactions) {
    if (row.source !== 'sms') {
      kept.push(row);
      noteAt(row, kept.length - 1);
      continue;
    }
    const rowTime = timeOf(row);
    const candidates = new Set<number>();
    if (row.smsKey) for (const index of bySmsKey.get(row.smsKey) ?? []) candidates.add(index);
    if (rowTime !== null) {
      const cross = crossChannelKey(row.date, row.amountFils, row.type);
      const title = dedupeKey(row.date, row.amountFils, row.title);
      for (const offset of [-1, 0, 1]) {
        for (const index of
          byCrossBucket.get(
            `${cross}|${bucket(rowTime, CROSS_CHANNEL_EVENT_MS) + offset}`,
          ) ?? []) candidates.add(index);
        for (const index of
          byTitleBucket.get(`${title}|${bucket(rowTime, 30_000) + offset}`) ?? []) {
          candidates.add(index);
        }
        if (row.cardPaymentSide && row.isTransfer === true) {
          const payment = `${row.amountFils}|${row.accountId}`;
          for (const index of
            byCardPaymentBucket.get(
              `${payment}|${bucket(rowTime, CARD_PAYMENT_PAIR_MS) + offset}`,
            ) ?? []) candidates.add(index);
        }
      }
    }
    const duplicateAt = [...candidates].find((index) => {
      const prior = kept[index];
      if (prior.source !== 'sms') return false;
      const bothEdited = Boolean(row.userEdited && prior.userEdited);
      if (row.smsKey && prior.smsKey === row.smsKey) return !bothEdited;
      if (
        !pairedCardPayments.has(index) &&
        !row.userEdited &&
        !prior.userEdited &&
        isOppositeCardPaymentPair(row, prior, rowTime)
      ) return true;
      if (
        row.date !== prior.date ||
        row.amountFils !== prior.amountFils ||
        row.type !== prior.type
      ) return false;
      const priorTime = timeOf(prior);
      if (row.viaPush !== prior.viaPush && (row.viaPush || prior.viaPush)) {
        return !bothEdited && closeEnough(rowTime, priorTime, CROSS_CHANNEL_EVENT_MS);
      }
      return (
        !row.userEdited &&
        !prior.userEdited &&
        !row.viaPush &&
        !prior.viaPush &&
        dedupeKey(row.date, row.amountFils, row.title) ===
          dedupeKey(prior.date, prior.amountFils, prior.title) &&
        closeEnough(rowTime, priorTime, 30_000)
      );
    });
    if (duplicateAt === undefined) {
      kept.push(row);
      noteAt(row, kept.length - 1);
      continue;
    }

    changed = true;
    const prior = kept[duplicateAt];
    const cardPaymentPair = isOppositeCardPaymentPair(row, prior, rowTime);
    const preferred = row.userEdited !== prior.userEdited
      ? row.userEdited ? row : prior
      : cardPaymentPair
        ? row.cardPaymentSide === 'receipt' ? row : prior
        : prior.viaPush && !row.viaPush ? row : prior;
    const secondary = preferred === prior ? row : prior;
    kept[duplicateAt] = {
      ...secondary,
      ...preferred,
      // Preserve optional user-facing detail if only the poorer capture had
      // it; neither row is userEdited, but old builds could attach a note.
      ...(preferred.userEdited
        ? {}
        : {
            note: preferred.note ?? secondary.note,
            splits: preferred.splits ?? secondary.splits,
          }),
    };
    if (cardPaymentPair) pairedCardPayments.add(duplicateAt);
    // Maps may retain the old row's keys at this index; every candidate is
    // revalidated above, and adding the preferred keys keeps future lookups
    // complete without an O(n) map cleanup.
    noteAt(kept[duplicateAt], duplicateAt);
  }

  return changed ? kept : transactions;
}
