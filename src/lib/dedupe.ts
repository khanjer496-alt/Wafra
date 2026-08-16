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

/**
 * Titles a capture can carry that name no merchant at all.
 *
 * A bank push often says only "Card purchase"; the SMS about that same charge
 * says "COSTA COFFEE". Those two legitimately describe one event, which is why
 * the cross-channel fingerprint drops the title. But dropping it entirely made
 * every AED 25 charge within two minutes of another AED 25 charge the same
 * event, and the loser was deleted rather than shown — so the title is ignored
 * only when one side does not state one.
 */
const GENERIC_CAPTURE_TITLES = new Set([
  'card purchase',
  'card transaction',
  'purchase',
  'transaction',
  // Below this line: sms-parser's STRUCTURAL_TITLES, lowercased — every title
  // the parser assigns from the SHAPE of a message rather than from a merchant
  // it read. The salary SMS says "Incoming transfer" and the bank's push about
  // it says "Salary credited"; neither names a party, so neither can be
  // compared to one.
  //
  // Restated rather than imported ON PURPOSE: this module has no dependencies
  // beyond types, which db.test.js asserts by loading it with a require() that
  // throws. import-plan.test.js pins the two lists in sync instead. Drift here
  // fails safe — a title that stops being treated as generic under-merges, and
  // a visible duplicate is always better than a charge that disappears.
  'atm withdrawal',
  'bank fee',
  'annual card fee',
  'annual bank fee',
  'account maintenance fee',
  'service charge',
  'overlimit fee',
  'insufficient balance fee',
  'late payment fee',
  'overdraft fee',
  'vat fee',
  'cash deposit',
  'cheque',
  'parking',
  'outgoing transfer',
  'incoming transfer',
  'refund',
  'inward remittance',
  'bank transfer',
  'own account transfer',
  'card payment',
  'account debit',
  'telegraphic transfer',
  'outward remittance',
  'mobile recharge',
]);

/**
 * Whether a push title and an SMS title can be describing one merchant.
 *
 * Deliberately generous in one direction only: the two channels truncate the
 * same trade name differently ("The One" / "The One Home"), so a whole-word
 * prefix counts, but two names that share no prefix are two merchants and
 * must stay two rows.
 */
export function sameMerchantCapture(a: string, b: string): boolean {
  const x = a.trim().toLowerCase();
  const y = b.trim().toLowerCase();
  if (!x || !y) return true;
  if (x === y) return true;
  if (GENERIC_CAPTURE_TITLES.has(x) || GENERIC_CAPTURE_TITLES.has(y)) return true;
  const [short, long] = x.length <= y.length ? [x, y] : [y, x];
  return long.startsWith(`${short} `);
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
   * Existing row consumed by the most recent `has` call, when there was one.
   * Reading clears the value. Import planning uses this to promote a live
   * capture to an exact historical Message identity instead of dropping that
   * identity before the reducer can preserve later, distinct history rows.
   */
  takeMatchedId(): string | null;
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
  /**
   * Mark a superseded push row as spent.
   *
   * `supersedes` is a QUESTION and is asked twice about the same message, so
   * it cannot consume anything itself. The caller says so once it has acted.
   * Without this, one push row answered every SMS of the same value in the
   * next two minutes: each SMS queued a patch against the SAME id, the store
   * keyed those patches by id and kept the last, and two genuine charges
   * became one row — with the first message's money simply gone.
   */
  consume(id: string): void;
  /** Consume ordinary capture indexes while preserving card-settlement pairing capacity. */
  consumeCapture(id: string): void;
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
  /** What this capture called the merchant, for the compatibility test above. */
  title: string;
  /** A title the user typed says nothing about the merchant; skip the test. */
  userEdited?: boolean;
  /** One capture explains one event on the other channel, not every one. */
  consumed?: boolean;
}

/**
 * Whether a stored capture and an incoming one can be one event, merchant-wise.
 *
 * A title the user typed is not a merchant name at all — the ledger row may
 * read "Weekly shop" — so an edited row is held to the money and the clock
 * only, exactly as before.
 */
function crossChannelPair(row: SeenEvent, title: string): boolean {
  return row.userEdited === true || sameMerchantCapture(row.title, title);
}

/** One occurrence filed under a day/amount/title fingerprint. */
interface SeenOccurrence {
  ts: number | null;
  id?: string;
  /** A retained Apple Message has an exact, opaque GUID-derived identity. */
  historyIdentity: boolean;
  /** A row with no event clock explains one later capture, not all of them. */
  consumed: boolean;
}

interface SeenCardPayment {
  date: string;
  ts: number | null;
  side: 'debit' | 'receipt';
  title: string;
  historyIdentity: boolean;
  id?: string;
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
  let lastMatchedId: string | null = null;
  /** dedupeKey → the capture times filed under it. */
  const seen = new Map<string, SeenOccurrence[]>();
  /** The same stored row can appear in title and cross-channel indexes. */
  const seenById = new Map<string, SeenOccurrence>();
  const note = (key: string, ts: number | null, smsKey?: string, id?: string) => {
    const at = seen.get(key);
    const occurrence = { ts, id, historyIdentity: smsKey?.startsWith('h') === true, consumed: false };
    if (at) at.push(occurrence);
    else seen.set(key, [occurrence]);
    if (id) seenById.set(id, occurrence);
  };
  for (const t of existing) {
    // Locally-created and migrated rows may have no SMS fingerprint but still
    // carry a precise event clock. Treating those as timeless made every
    // identical purchase later that day look like the same event.
    note(dedupeKey(t.date, t.amountFils, t.title), candidateTime(t), t.smsKey, t.id);
  }
  const seenSms = new Set(existing.map((t) => t.smsKey).filter(Boolean) as string[]);
  const seenSmsIds = new Map(
    existing.filter((t) => t.smsKey).map((t) => [t.smsKey as string, t.id]),
  );
  /** A day/amount/direction key still needs a capture time to identify an event. */
  const crossChannel = new Map<string, SeenEvent[]>();
  /** Ledger rows by id, so `consume` does not have to scan every bucket. */
  const crossById = new Map<string, SeenEvent>();
  const noteCross = (key: string, event: SeenEvent) => {
    const rows = crossChannel.get(key);
    if (rows) rows.push(event);
    else crossChannel.set(key, [event]);
    if (event.id) crossById.set(event.id, event);
  };
  /** Opposite alerts for one card payment: bank-account debit + card receipt. */
  const cardPayments = new Map<string, SeenCardPayment[]>();
  const cardPaymentById = new Map<string, SeenCardPayment>();
  const noteCardPayment = (key: string, event: SeenCardPayment) => {
    const rows = cardPayments.get(key);
    if (rows) rows.push(event);
    else cardPayments.set(key, [event]);
    if (event.id) cardPaymentById.set(event.id, event);
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
        title: t.title,
        userEdited: t.userEdited,
      });
    }
    if (t.cardPaymentSide) {
      noteCardPayment(`${t.amountFils}|${t.accountId}`, {
        date: t.date,
        ts: Number.isFinite(t.ts) ? t.ts! : keyTime(t.smsKey),
        side: t.cardPaymentSide,
        title: t.title,
        historyIdentity: t.smsKey?.startsWith('h') === true,
        id: t.id,
        paired: false,
      });
    }
    if (t.source === 'manual' && t.type === 'income' && t.isTransfer === true) {
      noteManualPayment(`${t.date}|${t.amountFils}|${t.accountId}`);
    }
  }

  return {
    has(c) {
      lastMatchedId = null;
      if (c.smsKey && seenSms.has(c.smsKey)) {
        lastMatchedId = seenSmsIds.get(c.smsKey) ?? null;
        return true;
      }
      // The live Shortcut/Android identity predates history GUID hashing, but
      // its `s{exact-message-time}-{amount}` key is still a strong bridge.
      // Use it before merchant-title matching so a parser upgrade (or a user's
      // corrected title) cannot leave the same Message counted twice. Consume
      // it one-to-one: another history GUID at the same second is a real row.
      if (c.smsKey?.startsWith('h') && Number.isFinite(c.ts)) {
        const legacyId = seenSmsIds.get(`s${c.ts}-${c.amountFils}`);
        const occurrence = legacyId ? seenById.get(legacyId) : undefined;
        if (legacyId && occurrence && !occurrence.consumed) {
          occurrence.consumed = true;
          lastMatchedId = legacyId;
          return true;
        }
      }
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
        const candidateIsHistory = c.smsKey?.startsWith('h') === true;
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
          lastMatchedId = paired.id ?? null;
          return true;
        }
        // Provider/delivery copies on the SAME side can still race by seconds.
        // Once an opposite side has been consumed, however, it cannot act as
        // a generic title duplicate for every later genuine receipt.
        const sameSide = rows.find(
          (row) =>
              // Exact historical identity was handled by seenSms. Two
              // different retained Messages on the same settlement side are
              // two events; an opposite side is still one settlement pair.
              !(candidateIsHistory && row.historyIdentity) &&
              (!(candidateIsHistory || row.historyIdentity) || !row.paired) &&
              row.side === c.cardPaymentSide &&
              // Seconds apart, but either side of midnight: the provider
              // stamped 23:59:58 and the delivery receiver 00:00:03, so an
              // exact date test filed one settlement as two. The event window
              // is what separates the copies from a genuine repeat — a real
              // second payment is minutes away, not seconds.
              sameOrAdjacentDate(row.date, c.date) &&
              row.title.toLowerCase() === c.title.toLowerCase() &&
            closeEnough(row.ts, mine, SAME_EVENT_MS),
        );
        if (sameSide) {
          // One live capture may account for one historical Message, not every
          // equal payment in the next two minutes.
          if (candidateIsHistory || sameSide.historyIdentity) sameSide.paired = true;
          lastMatchedId = sameSide.id ?? null;
          return true;
        }
      } else {
        const at = seen.get(dedupeKey(c.date, c.amountFils, c.title));
        if (at) {
          // Two different GUID-derived identities are two different retained
          // Apple Messages, even when the bank stamped both in the same
          // second. Exact re-imports were already caught by seenSms above.
          // Continue comparing against Android/live captures so importing
          // history after enabling live capture still removes overlap.
          const comparable = c.smsKey?.startsWith('h')
            ? at.filter((row) => !row.historyIdentity)
            : at;
          // Same day, same amount, same name. That is one event captured twice
          // UNLESS both sides carry a timestamp and those are far enough apart
          // to be two separate visits. Without this the second identical charge
          // of the day was silently dropped and the user's spending under-read
          // — the comment here claimed both rows survived; the code kept one.
          if (mine === null && comparable.length > 0) return true;
          const timed = comparable.find(
            (occurrence) =>
              (!(c.smsKey?.startsWith('h') || occurrence.historyIdentity) ||
                !occurrence.consumed) &&
              occurrence.ts !== null &&
              Math.abs(occurrence.ts - mine!) <= SAME_EVENT_MS,
          );
          if (timed) {
            // Exact history/live overlap is one-to-one. Without consuming the
            // live occurrence it silences every distinct historical Message
            // the bank happened to timestamp in the same two-minute window.
            if (c.smsKey?.startsWith('h') || timed.historyIdentity) timed.consumed = true;
            lastMatchedId = timed.id ?? null;
            return true;
          }
          // A row with no event clock at all — every manually added row, since
          // add-transaction and the card-payment sheet write no `ts`. It does
          // explain the bank's message about it, but only ONE of them: treating
          // it as a permanent day-long veto meant a user who logged an AED 400
          // Salik top-up by hand lost the genuine second one nine hours later.
          const timeless = comparable.find((o) => o.ts === null && !o.consumed);
          if (timeless) {
            timeless.consumed = true;
            lastMatchedId = timeless.id ?? null;
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
        const match = rows.find(
          (row) =>
            row.channel !== 'push' &&
            !row.consumed &&
            crossChannelPair(row, c.title) &&
            closeEnough(row.ts, mine, CROSS_CHANNEL_EVENT_MS),
        );
        if (match) {
          // One SMS row accounts for one notification. Left uncounted, a
          // single AED 25 SMS silenced every AED 25 push in the next two
          // minutes, and the second real charge was never imported at all.
          match.consumed = true;
          lastMatchedId = match.id ?? null;
          return true;
        }
      }
      return false;
    },
    takeMatchedId() {
      const id = lastMatchedId;
      lastMatchedId = null;
      return id;
    },
    supersedes(c) {
      if (c.channel === 'push') return null;
      const mine = candidateTime(c);
      const rows = crossChannel.get(crossChannelKey(c.date, c.amountFils, c.type)) ?? [];
      let best: SeenEvent | null = null;
      for (const row of rows) {
        if (
          row.channel !== 'push' ||
          !row.id ||
          row.consumed ||
          !crossChannelPair(row, c.title) ||
          !closeEnough(row.ts, mine, CROSS_CHANNEL_EVENT_MS)
        ) {
          continue;
        }
        if (!best || Math.abs(row.ts! - mine!) < Math.abs(best.ts! - mine!)) best = row;
      }
      return best?.id ?? null;
    },
    consume(id) {
      const row = crossById.get(id);
      if (row) row.consumed = true;
      const occurrence = seenById.get(id);
      if (occurrence) occurrence.consumed = true;
      const cardPayment = cardPaymentById.get(id);
      if (cardPayment) cardPayment.paired = true;
    },
    consumeCapture(id) {
      // Exact source identity has accounted for this row in the ordinary
      // title/cross-channel indexes, but it has not consumed the other alert
      // for the same card settlement. Marking `paired` here made a repeated
      // history import offer the opposite debit/receipt leg as new every time.
      const row = crossById.get(id);
      if (row) row.consumed = true;
      const occurrence = seenById.get(id);
      if (occurrence) occurrence.consumed = true;
    },
    add(c) {
      const ts = candidateTime(c);
      note(dedupeKey(c.date, c.amountFils, c.title), ts, c.smsKey, c.id);
      if (c.smsKey) seenSms.add(c.smsKey);
      noteCross(crossChannelKey(c.date, c.amountFils, c.type), {
        ts,
        channel: c.channel ?? 'inbox',
        id: c.id,
        title: c.title,
      });
      if (c.eventKind === 'cardPayment' && c.accountId && c.cardPaymentSide) {
        noteCardPayment(`${c.amountFils}|${c.accountId}`, {
          date: c.date,
          ts,
          side: c.cardPaymentSide,
          title: c.title,
          historyIdentity: c.smsKey?.startsWith('h') === true,
          id: c.id,
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
      // Distinct Apple Message identities survive hydration/migration too.
      // Opposite card-payment sides above are deliberately one settlement;
      // two distinct same-side messages are two real events.
      if (
        row.smsKey?.startsWith('h') &&
        prior.smsKey?.startsWith('h') &&
        row.smsKey !== prior.smsKey
      ) return false;
      if (
        row.date !== prior.date ||
        row.amountFils !== prior.amountFils ||
        row.type !== prior.type
      ) return false;
      const priorTime = timeOf(prior);
      if (row.viaPush !== prior.viaPush && (row.viaPush || prior.viaPush)) {
        return (
          !bothEdited &&
          // Money, day and direction are not an event identity on their own.
          // A push that says only "Card purchase" pairs with any SMS title,
          // but two rows that each NAME a different merchant are two charges,
          // and this branch was deleting one of them on every hydrate.
          (Boolean(row.userEdited) ||
            Boolean(prior.userEdited) ||
            sameMerchantCapture(row.title, prior.title)) &&
          closeEnough(rowTime, priorTime, CROSS_CHANNEL_EVENT_MS)
        );
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
    const historicalIdentity = row.smsKey?.startsWith('h')
      ? row
      : prior.smsKey?.startsWith('h')
        ? prior
        : undefined;
    const debitSide = cardPaymentPair
      ? row.cardPaymentSide === 'debit' ? row : prior
      : undefined;
    kept[duplicateAt] = {
      ...secondary,
      ...preferred,
      // `viaPush` has to be assigned, not spread.
      //
      // A persisted SMS row has NO viaPush key — it is written as
      // `p.channel === 'push' || undefined` and JSON.stringify drops
      // undefined-valued keys — so spreading the preferred SMS row over the
      // push row could not clear `viaPush: true`. The merged row therefore
      // came back from storage still looking like a push capture, took the
      // cross-channel branch above on the NEXT hydrate, and ate another
      // genuine charge. Every launch, compounding.
      viaPush: preferred.viaPush,
      // A live/history merge must retain the stable Message identity. If the
      // live `s...` key wins, the next distinct history GUID can merge into
      // the same row too and vanish. The opaque h-key also makes re-imports
      // exact after the first overlap reconciliation.
      smsKey: historicalIdentity?.smsKey ?? preferred.smsKey,
      ts: historicalIdentity?.ts ?? preferred.ts,
      // The receipt is the richer settlement record and remains canonical,
      // but cash left on the debit alert's date. Preserve that fact across a
      // midnight/weekend boundary so Cash out stays in the funding period.
      cashOutDate: debitSide?.cashOutDate ?? debitSide?.date ??
        preferred.cashOutDate ?? secondary.cashOutDate,
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
