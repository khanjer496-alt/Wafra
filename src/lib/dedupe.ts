import { canonicalCaptureSourceKey, isUnboundAndroidSourceKey, isUsableCaptureSourceIdentity } from '@/lib/capture-source-identity';
import type { CaptureInstrument, CaptureSource, Transaction, TransactionType } from '@/lib/types';

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

/**
 * A ledger row promoted from an Apple Pay (Wallet) review.
 *
 * Wallet's observation UUID is not the bank's message identity, and the row's
 * title/account/date are explicit user decisions. Such a row may only ever be
 * matched by its exact receipt identity; import-plan binds it to a later bank
 * SMS under its own strict one-to-one rule. Generic title, cross-channel,
 * statement and hydration heuristics must never pair or delete it.
 */
export const APPLE_PAY_REVIEW_SOURCE_KEY = /^apple_pay_review_source_[a-f0-9]{32}$/;
export function isApplePayWalletRow(t: Pick<Transaction, 'source' | 'smsKey'>): boolean {
  return t.source === 'sms' && typeof t.smsKey === 'string' && APPLE_PAY_REVIEW_SOURCE_KEY.test(t.smsKey);
}

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
  'credit reversal',
  'invoice payment',
  'inward remittance',
  'bank transfer',
  'own account transfer',
  'card payment',
  'payment',
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
  /** Ephemeral retained source evidence for an evidenced parser correction. */
  raw?: string;
  /** `s{timestamp}-{amount}`, when the message carried a timestamp. */
  smsKey?: string;
  /** Capture time, independent of the channel-specific SMS fingerprint. */
  ts?: number;
  channel?: CaptureChannel;
  /** Structured ingest provenance; PDF/CSV are statement rows. */
  captureSource?: CaptureSource;
  /**
   * Opaque id of the one statement upload a PDF/CSV row came from. Rows of the
   * same upload are never duplicates of each other (a statement lists a
   * genuine repeat twice); rows of different uploads are matched one-to-one.
   */
  statementImportId?: string;
  /** Bank identity a statement named for itself, when it named one. */
  statementBank?: string;
  /** Resolved account/card. Required for high-confidence settlement pairing. */
  accountId?: string;
  captureInstrument?: CaptureInstrument;
  eventKind?: 'transaction' | 'cardPayment';
  /** Which bank alert described the card settlement. Opposite sides are one event. */
  cardPaymentSide?: 'debit' | 'receipt';
  /** Set only for rows already in the ledger, so a later SMS can replace them. */
  id?: string;
  /**
   * One GUID-less iOS live Message (queue-UUID observation). Never merged with
   * another live observation; bound to at most one History copy.
   */
  liveObservation?: boolean;
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
/**
 * The same card event on the OTHER channel, when the alerts prove it.
 *
 * A bank app does not always post its notification when the SMS lands: an
 * owner's ADCB credit-card push arrived 10 min 48 s after the SMS about the
 * same charge (same card digits, amount and merchant), so the two-minute
 * window above booked it twice. Beyond two minutes a push and an SMS pair only
 * on evidence the bare money cannot supply: both alerts state the SAME card or
 * account digits, both NAME the same merchant (a generic "Card purchase" never
 * qualifies), neither row was edited, and the match is nearest-first and
 * one-to-one. Two identical charges on one channel never use this path; they
 * keep the two-minute same-event rule, so two equal coffees stay two.
 */
export const CROSS_CHANNEL_INSTRUMENT_EVENT_MS = 15 * 60_000;
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
  captureInstrument?: CaptureInstrument;
  /** A title the user typed says nothing about the merchant; skip the test. */
  userEdited?: boolean;
  /** One capture explains one event on the other channel, not every one. */
  consumed?: boolean;
}

interface SeenStatementPairEvent {
  date: string;
  amountFils: number;
  type: TransactionType;
  title: string;
  accountId?: string;
  captureInstrument?: CaptureInstrument;
  captureSource?: CaptureSource;
  statementImportId?: string;
  statementBank?: string;
  id?: string;
  consumed: boolean;
}

export function isStatementCaptureSource(source: CaptureSource | undefined): boolean {
  return source === 'pdf' || source === 'csv';
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

/** Both alerts state the same card/account digits; absence proves nothing here. */
function sameStatedInstrument(a?: CaptureInstrument, b?: CaptureInstrument): boolean {
  return !!a && !!b && /^\d{4}$/.test(a.last4) && a.last4 === b.last4 &&
    compatibleCaptureInstrument(a, b);
}

/** Both titles name a merchant, and the same one (whole-word prefix allowed). */
function sameNamedMerchant(a: string, b: string): boolean {
  const x = a.trim().toLowerCase();
  const y = b.trim().toLowerCase();
  return !!x && !!y && !GENERIC_CAPTURE_TITLES.has(x) && !GENERIC_CAPTURE_TITLES.has(y) &&
    sameMerchantCapture(x, y);
}

/**
 * The strong-evidence push/SMS pairing beyond the two-minute window; see
 * CROSS_CHANNEL_INSTRUMENT_EVENT_MS. Exported for the hydration repair and
 * tests; callers still enforce opposite channels and one-to-one consumption.
 */
export function laggedCrossChannelEvent(
  a: { ts: number | null; title: string; captureInstrument?: CaptureInstrument; userEdited?: boolean },
  b: { ts: number | null; title: string; captureInstrument?: CaptureInstrument; userEdited?: boolean },
): boolean {
  return a.userEdited !== true && b.userEdited !== true &&
    sameStatedInstrument(a.captureInstrument, b.captureInstrument) &&
    sameNamedMerchant(a.title, b.title) &&
    closeEnough(a.ts, b.ts, CROSS_CHANNEL_INSTRUMENT_EVENT_MS);
}

/**
 * Nearest unconsumed capture on the other channel that the lagged rule pairs
 * with `c`: an SMS row for an incoming push (`wanted: 'inbox'`), or a stored
 * push row for an incoming SMS (`wanted: 'push'`).
 */
function nearestLaggedCrossChannel(
  rows: readonly SeenEvent[],
  c: DuplicateCandidate,
  mine: number | null,
  wanted: 'inbox' | 'push',
): SeenEvent | undefined {
  if (mine === null) return undefined;
  let best: SeenEvent | undefined;
  for (const row of rows) {
    if (row.consumed || row.ts === null) continue;
    if (wanted === 'push' ? row.channel !== 'push' || !row.id : row.channel === 'push') continue;
    if (!laggedCrossChannelEvent(row, { ts: mine, title: c.title, captureInstrument: c.captureInstrument })) continue;
    if (!best || Math.abs(row.ts - mine) < Math.abs(best.ts! - mine)) best = row;
  }
  return best;
}

/** One occurrence filed under a day/amount/title fingerprint. */
interface SeenOccurrence {
  ts: number | null;
  id?: string;
  /** A retained Apple Message has an exact, opaque GUID-derived identity. */
  historyIdentity: boolean;
  /** One GUID-less iOS live Message; see DuplicateCandidate.liveObservation. */
  liveObservation: boolean;
  /** A row with no event clock explains one later capture, not all of them. */
  consumed: boolean;
  captureInstrument?: CaptureInstrument;
  type: TransactionType;
  /** Statement provenance, so a statement from another upload is left to its own matcher. */
  statement?: Pick<DuplicateCandidate, 'captureSource' | 'statementImportId'>;
}

/** Only facts from the alerts can prove two captures describe different instruments. */
export function compatibleCaptureInstrument(a?: CaptureInstrument, b?: CaptureInstrument): boolean {
  if (!a || !b) return true;
  if (a.last4 !== b.last4) return false;
  if (a.bankIdentity && b.bankIdentity && a.bankIdentity !== b.bankIdentity) return false;
  return a.kind === 'unknown' || b.kind === 'unknown' || a.kind === b.kind;
}

/** Keep every compatible fact when a fuller message omits bank or card kind. */
export function mergeCaptureInstrument(
  preferred?: CaptureInstrument,
  secondary?: CaptureInstrument,
): CaptureInstrument | undefined {
  if (!preferred) return secondary;
  if (!secondary || !compatibleCaptureInstrument(preferred, secondary)) return preferred;
  return {
    ...secondary,
    ...preferred,
    kind: preferred.kind === 'unknown' ? secondary.kind : preferred.kind,
    ...(preferred.bankIdentity || secondary.bankIdentity
      ? { bankIdentity: preferred.bankIdentity || secondary.bankIdentity } : {}),
  };
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

const OBSERVATION_UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/** A stored GUID-less iOS live Message that has not yet bound a History identity. */
function hasMessageObservationId(t: Transaction): boolean {
  return t.source === 'sms' && t.viaPush !== true &&
    typeof t.messageObservationId === 'string' && OBSERVATION_UUID_RE.test(t.messageObservationId);
}

function isLiveMessageObservationRow(t: Transaction): boolean {
  return hasMessageObservationId(t) && t.smsKey?.startsWith('h') !== true;
}

export interface DuplicateGuardOptions {
  /** Issuer identity of a ledger account, for statement/alert compatibility. */
  accountBankIdentity?: (accountId: string) => string | undefined;
  /**
   * An account reference that attributes nothing — the unassigned holdings a
   * statement with no card/account digits lands on. Only a statement row on
   * such an account may be matched to an alert on another account.
   */
  unresolvedAccount?: (accountId: string) => boolean;
}

const STATEMENT_IMPORT_ID = /^[a-f0-9]{32}$/;

/** The upload a statement row came from, when the relay named one. */
export function statementUploadOf(
  row: Pick<DuplicateCandidate, 'captureSource' | 'statementImportId'>,
): string | undefined {
  return isStatementCaptureSource(row.captureSource) && typeof row.statementImportId === 'string' &&
    STATEMENT_IMPORT_ID.test(row.statementImportId) ? row.statementImportId : undefined;
}

/**
 * Two statement rows from different uploads. Their relay clocks are coarse
 * and restart at midday for every file, so neither a shared `s{ts}-{amount}`
 * nor a title within the event window says they are one event; only the
 * one-to-one statement matcher may pair them. An untagged statement row
 * predates upload ids and is necessarily from another upload than a tagged one.
 */
export function fromDifferentStatementUploads(
  a: Pick<DuplicateCandidate, 'captureSource' | 'statementImportId'>,
  b: Pick<DuplicateCandidate, 'captureSource' | 'statementImportId'>,
): boolean {
  if (!isStatementCaptureSource(a.captureSource) || !isStatementCaptureSource(b.captureSource)) return false;
  const left = statementUploadOf(a);
  const right = statementUploadOf(b);
  return (left !== undefined || right !== undefined) && left !== right;
}

export function duplicateGuard(
  existing: Transaction[],
  sourceIdentityAlreadyValidated = false,
  options: DuplicateGuardOptions = {},
): DuplicateGuard {
  if (!sourceIdentityAlreadyValidated) {
    existing = existing.filter((row) => isUsableCaptureSourceIdentity(row.smsKey, row.ts));
  }
  let lastMatchedId: string | null = null;
  /** dedupeKey → the capture times filed under it. */
  const seen = new Map<string, SeenOccurrence[]>();
  /** The same stored row can appear in title and cross-channel indexes. */
  const seenById = new Map<string, SeenOccurrence>();
  /** User-renamed, still-unbound live observations, for the title-free bind. */
  const renamedLiveObservations: { amountFils: number; occurrence: SeenOccurrence }[] = [];
  const note = (
    key: string, ts: number | null, type: TransactionType, amountFils: number, smsKey?: string,
    id?: string, captureInstrument?: CaptureInstrument,
    flags: {
      liveObservation?: boolean; renamed?: boolean; boundLiveCopy?: boolean;
      statement?: Pick<DuplicateCandidate, 'captureSource' | 'statementImportId'>;
    } = {},
  ) => {
    const at = seen.get(key);
    const historyIdentity = smsKey?.startsWith('h') === true;
    const occurrence: SeenOccurrence = {
      ts, id, type, captureInstrument, historyIdentity,
      ...(flags.statement && isStatementCaptureSource(flags.statement.captureSource)
        ? { statement: { captureSource: flags.statement.captureSource,
          statementImportId: flags.statement.statementImportId } } : {}),
      liveObservation: flags.liveObservation === true && !historyIdentity,
      // A History row promoted from a live observation has already explained
      // its live copy; it can never absorb another live Message.
      consumed: historyIdentity && flags.boundLiveCopy === true,
    };
    if (at) at.push(occurrence);
    else seen.set(key, [occurrence]);
    if (id) seenById.set(id, occurrence);
    if (occurrence.liveObservation && flags.renamed === true) {
      renamedLiveObservations.push({ amountFils, occurrence });
    }
  };
  /**
   * Bind one incoming History Message to one GUID-less live Message the user
   * renamed. An unedited live row parses to the History copy's own title and
   * pairs through the title rule; a renamed one cannot, and its s-key carries
   * the receipt time rather than the Message's own. Match by money,
   * direction, instrument and the same-event window, nearest first; the
   * occurrence is consumed so it explains exactly one History copy. Never the
   * reverse direction: a new live Message is not bound to History by money
   * alone, since a different merchant at the same amount is a real purchase.
   */
  const titleFreeObservationMatch = (c: DuplicateCandidate, mine: number | null): SeenOccurrence | undefined => {
    if (c.smsKey?.startsWith('h') !== true || mine === null) return undefined;
    let best: SeenOccurrence | undefined;
    for (const { amountFils, occurrence } of renamedLiveObservations) {
      if (occurrence.consumed || occurrence.ts === null || amountFils !== c.amountFils ||
        occurrence.type !== c.type) continue;
      if (!compatibleCaptureInstrument(occurrence.captureInstrument, c.captureInstrument)) continue;
      const distance = Math.abs(occurrence.ts - mine);
      if (distance > SAME_EVENT_MS) continue;
      if (!best || distance < Math.abs(best.ts! - mine)) best = occurrence;
    }
    return best;
  };
  // Wallet rows, unbound or bound to one bank alert, keep only their exact
  // receipt identity (noteExact below). A non-exact alert near a bound row
  // goes to the planner's possible-duplicate Review, never a silent merge.
  const heuristicRows = existing.filter((t) => !isApplePayWalletRow(t) && t.walletBound !== true);
  for (const t of heuristicRows) {
    // Locally-created and migrated rows may have no SMS fingerprint but still
    // carry a precise event clock. Treating those as timeless made every
    // identical purchase later that day look like the same event.
    note(dedupeKey(t.date, t.amountFils, t.title), candidateTime(t), t.type, t.amountFils, t.smsKey, t.id,
      t.captureInstrument, {
        liveObservation: isLiveMessageObservationRow(t),
        renamed: t.userEdited === true || t.titleEdited === true,
        boundLiveCopy: hasMessageObservationId(t),
        statement: t,
      });
  }
  // Delivery clocks can collide across cards; retain every candidate per key.
  const exactRows = new Map<string, DuplicateCandidate[]>();
  const noteExact = (c: DuplicateCandidate) => {
    if (!c.smsKey) return;
    const key = canonicalCaptureSourceKey(c.smsKey, c.ts);
    if (isUnboundAndroidSourceKey(key)) return;
    const rows = exactRows.get(key) ?? [];
    rows.push(c);
    exactRows.set(key, rows);
  };
  for (const t of existing) noteExact(t);
  const exactMatch = (key: string, c: DuplicateCandidate) =>
    (exactRows.get(canonicalCaptureSourceKey(key, c.ts)) ?? []).find((row) => key.startsWith('h') || (
      !fromDifferentStatementUploads(row, c) &&
      (row.type === c.type || c.eventKind === 'cardPayment' ||
        (row.raw !== undefined && c.raw !== undefined && bodyPrint(row.raw) === bodyPrint(c.raw))) &&
      compatibleCaptureInstrument(row.captureInstrument, c.captureInstrument)
    ));
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
  /**
   * Statement ↔ live-capture overlap cannot use the push/SMS clock/title rule.
   * Statements commonly provide a date-only timestamp and a card-network
   * descriptor while the live alert provides a real time and friendly merchant.
   * Match only when exactly one side is proven PDF/CSV and the resolved money
   * facts agree. Every row is consumable once, preserving repeated equal charges.
   */
  //
  // Every rule below needs the same or an adjacent day, so rows are bucketed
  // by day and a candidate reads only the nearby buckets instead of every SMS
  // row in the ledger. `seq` restores insertion order across buckets, so the
  // first/best match is the one a full scan would have picked.
  const statementPairByDay = new Map<string | number, SeenStatementPairEvent[]>();
  const statementPairSeq = new Map<SeenStatementPairEvent, number>();
  const statementPairById = new Map<string, SeenStatementPairEvent>();
  const statementPairDay = (date: string): string | number => {
    const time = Date.parse(`${date}T12:00:00Z`);
    return Number.isFinite(time) ? Math.floor(time / 86_400_000) : `raw:${date}`;
  };
  const noteStatementPair = (event: SeenStatementPairEvent) => {
    const day = statementPairDay(event.date);
    const rows = statementPairByDay.get(day);
    if (rows) rows.push(event);
    else statementPairByDay.set(day, [event]);
    statementPairSeq.set(event, statementPairSeq.size);
    if (event.id) statementPairById.set(event.id, event);
  };
  const statementPairNear = (date: string): SeenStatementPairEvent[] => {
    const day = statementPairDay(date);
    if (typeof day !== 'number') return statementPairByDay.get(day) ?? [];
    const near: SeenStatementPairEvent[] = [];
    for (let d = day - 2; d <= day + 2; d++) {
      const rows = statementPairByDay.get(d);
      if (rows) near.push(...rows);
    }
    return near.sort((a, b) => statementPairSeq.get(a)! - statementPairSeq.get(b)!);
  };
  const unresolvedAccount = (accountId: string | undefined): boolean =>
    !accountId || options.unresolvedAccount?.(accountId) === true;
  const bankOf = (row: Pick<SeenStatementPairEvent, 'statementBank' | 'captureInstrument' | 'accountId'>) =>
    row.statementBank ?? row.captureInstrument?.bankIdentity ??
      (row.accountId ? options.accountBankIdentity?.(row.accountId) : undefined);
  const banksCompatible = (a: string | undefined, b: string | undefined) => !a || !b || a === b;
  const sameDescriptor = (a: string, b: string) => a.trim().toLowerCase() === b.trim().toLowerCase();
  /**
   * Whether a statement descriptor and an alert title can name one merchant:
   * one shares a word of four or more letters with the other ("PAYPAL
   * *ENDURANCEIN" / "Endurancein", "CARREFOUR HYPER 1234" / "Carrefour").
   * Money and a day alone are not an identity when the statement names no
   * account: "NOON.COM 50.00" and "Carrefour 50.00" are two purchases.
   */
  const descriptorOverlap = (a: string, b: string): boolean => {
    const words = (value: string) => new Set(value.toLowerCase().normalize('NFKC')
      .split(/[^\p{L}\p{N}]+/u).filter((word) => word.length >= 4 && /\p{L}/u.test(word)));
    const left = words(a);
    const right = words(b);
    for (const word of left) if (right.has(word)) return true;
    const flatLeft = [...left].join(' ');
    const flatRight = [...right].join(' ');
    return [...left].some((word) => flatRight.includes(word)) || [...right].some((word) => flatLeft.includes(word));
  };
  const statementPairMatch = (c: DuplicateCandidate): SeenStatementPairEvent | undefined => {
    const incomingStatement = isStatementCaptureSource(c.captureSource);
    const open = statementPairNear(c.date).filter((row) =>
      !row.consumed && row.type === c.type &&
      compatibleCaptureInstrument(row.captureInstrument, c.captureInstrument));
    // 1. Statement <-> live capture on the SAME resolved account. Provenance
    // is the permission to relax title/time; a bounded posting drift is allowed.
    if (c.accountId) {
      const matches = open.filter((row) =>
        !!row.accountId &&
        row.accountId === c.accountId &&
        isStatementCaptureSource(row.captureSource) !== incomingStatement &&
        Math.abs(row.amountFils - c.amountFils) <= 1 &&
        sameOrAdjacentDate(row.date, c.date));
      if (matches.length) {
        matches.sort((a, b) => {
          const score = (row: SeenStatementPairEvent) =>
            (row.date === c.date ? 0 : 10) + Math.abs(row.amountFils - c.amountFils);
          return score(a) - score(b);
        });
        return matches[0];
      }
    }
    // 2. Statement <-> statement from ANOTHER upload: the same day, amount,
    // direction and account, whatever each file's row order put on the clock.
    // Two unlabelled statements share only the unassigned holding, which says
    // nothing about the account, so they must also print the same descriptor.
    // Rows of one upload never pair: a statement's repeat is a real repeat.
    const incomingUpload = incomingStatement ? statementUploadOf(c) : undefined;
    if (incomingUpload && c.accountId) {
      const unlabelled = unresolvedAccount(c.accountId);
      const match = open.find((row) =>
        isStatementCaptureSource(row.captureSource) &&
        fromDifferentStatementUploads(row, c) &&
        row.accountId === c.accountId &&
        row.amountFils === c.amountFils &&
        row.date === c.date &&
        banksCompatible(bankOf(row), bankOf(c)) &&
        (!unlabelled || sameDescriptor(row.title, c.title)));
      if (match) return match;
    }
    // 3. A statement that could not name its account <-> a live capture on any
    // account of a compatible bank. Exact day and amount only, one-to-one:
    // the statement side attributes nothing, so no drift is tolerated.
    const relaxed = incomingStatement
      ? unresolvedAccount(c.accountId)
        ? open.filter((row) => !isStatementCaptureSource(row.captureSource))
        : []
      : open.filter((row) => isStatementCaptureSource(row.captureSource) && unresolvedAccount(row.accountId));
    const matches = relaxed.filter((row) =>
      row.amountFils === c.amountFils &&
      row.date === c.date &&
      banksCompatible(bankOf(row), bankOf(c)) &&
      (descriptorOverlap(row.title, c.title) || sameDescriptor(row.title, c.title)));
    return matches[0];
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
  for (const t of heuristicRows) {
    if (t.source === 'sms') {
      noteCross(crossChannelKey(t.date, t.amountFils, t.type), {
        ts: Number.isFinite(t.ts) ? t.ts! : keyTime(t.smsKey),
        channel: t.viaPush ? 'push' : 'inbox',
        id: t.id,
        title: t.title,
        captureInstrument: t.captureInstrument,
        userEdited: t.userEdited,
      });
    }
    // Statement provenance is persisted on parser-owned rows, but older live
    // SMS rows legitimately have no captureSource at all. Index both groups;
    // the matcher itself requires exactly one side to be PDF/CSV.
    if (t.source === 'sms' || isStatementCaptureSource(t.captureSource)) {
      noteStatementPair({
        date: t.date,
        amountFils: t.amountFils,
        type: t.type,
        title: t.title,
        accountId: t.accountId,
        captureInstrument: t.captureInstrument,
        captureSource: t.captureSource,
        statementImportId: t.statementImportId,
        id: t.id,
        consumed: false,
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
  // Bound Wallet rows stay out of the loose indexes above, but a bank
  // statement row for the same purchase must still pair with them one-to-one;
  // otherwise the statement would add the purchase a second time.
  for (const t of existing) {
    if (t.walletBound !== true || t.source !== 'sms') continue;
    noteStatementPair({
      date: t.date,
      amountFils: t.amountFils,
      type: t.type,
      title: t.title,
      accountId: t.accountId,
      captureInstrument: t.captureInstrument,
      captureSource: t.captureSource,
      statementImportId: t.statementImportId,
      id: t.id,
      consumed: false,
    });
  }

  return {
    has(c) {
      if (!isUsableCaptureSourceIdentity(c.smsKey, c.ts)) { lastMatchedId = null; return false; }
      lastMatchedId = null;
      const exact = c.smsKey ? exactMatch(c.smsKey, c) : undefined;
      if (exact) {
        lastMatchedId = exact.id ?? null;
        return true;
      }
      // The live Shortcut/Android identity predates history GUID hashing, but
      // its `s{exact-message-time}-{amount}` key is still a strong bridge.
      // Use it before merchant-title matching so a parser upgrade (or a user's
      // corrected title) cannot leave the same Message counted twice. Consume
      // it one-to-one: another history GUID at the same second is a real row.
      if (c.smsKey?.startsWith('h') && Number.isFinite(c.ts)) {
        const legacyId = exactMatch(`s${c.ts}-${c.amountFils}`, c)?.id;
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
          // Likewise two GUID-less live observations are two delivered
          // Messages: the native queue stages each Message once.
          const incomingLive = c.liveObservation === true && !c.smsKey?.startsWith('h');
          const comparable = at.filter((row) =>
            row.type === c.type &&
            !(row.statement && fromDifferentStatementUploads(row.statement, c)) &&
            compatibleCaptureInstrument(row.captureInstrument, c.captureInstrument) &&
            !(c.smsKey?.startsWith('h') && row.historyIdentity) &&
            !(incomingLive && row.liveObservation));
          const oneToOne = (occurrence: SeenOccurrence) => c.smsKey?.startsWith('h') === true ||
            incomingLive || occurrence.historyIdentity || occurrence.liveObservation;
          // Same day, same amount, same name. That is one event captured twice
          // UNLESS both sides carry a timestamp and those are far enough apart
          // to be two separate visits. Without this the second identical charge
          // of the day was silently dropped and the user's spending under-read
          // — the comment here claimed both rows survived; the code kept one.
          if (mine === null && comparable.length > 0) return true;
          const timed = comparable.find(
            (occurrence) =>
              (!oneToOne(occurrence) || !occurrence.consumed) &&
              occurrence.ts !== null &&
              Math.abs(occurrence.ts - mine!) <= SAME_EVENT_MS,
          );
          if (timed) {
            // Exact history/live overlap is one-to-one. Without consuming the
            // live occurrence it silences every distinct historical Message
            // the bank happened to timestamp in the same two-minute window.
            if (oneToOne(timed)) timed.consumed = true;
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
        const observation = titleFreeObservationMatch(c, mine);
        if (observation) {
          observation.consumed = true;
          lastMatchedId = observation.id ?? null;
          return true;
        }
      }
      const statementMatch = statementPairMatch(c);
      if (statementMatch) {
        statementMatch.consumed = true;
        // Never let a later statement descriptor overwrite a richer live row.
        // In the reverse direction the live capture may heal the stored row,
        // which keeps its persisted statement provenance for future reimports.
        if (!isStatementCaptureSource(c.captureSource)) {
          lastMatchedId = statementMatch.id ?? null;
        }
        return true;
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
            compatibleCaptureInstrument(row.captureInstrument, c.captureInstrument) &&
            crossChannelPair(row, c.title) &&
            closeEnough(row.ts, mine, CROSS_CHANNEL_EVENT_MS),
        ) ?? nearestLaggedCrossChannel(rows, c, mine, 'inbox');
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
      if (!isUsableCaptureSourceIdentity(c.smsKey, c.ts)) return null;
      if (c.channel === 'push') return null;
      const mine = candidateTime(c);
      const rows = crossChannel.get(crossChannelKey(c.date, c.amountFils, c.type)) ?? [];
      let best: SeenEvent | null = null;
      for (const row of rows) {
        if (
          row.channel !== 'push' ||
          !row.id ||
          row.consumed ||
          !compatibleCaptureInstrument(row.captureInstrument, c.captureInstrument) ||
          !crossChannelPair(row, c.title) ||
          !closeEnough(row.ts, mine, CROSS_CHANNEL_EVENT_MS)
        ) {
          continue;
        }
        if (!best || Math.abs(row.ts! - mine!) < Math.abs(best.ts! - mine!)) best = row;
      }
      if (!best) {
        const lagged = nearestLaggedCrossChannel(rows, c, mine, 'push');
        if (lagged?.id) best = lagged;
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
      const statementPair = statementPairById.get(id);
      if (statementPair) statementPair.consumed = true;
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
      const statementPair = statementPairById.get(id);
      if (statementPair) statementPair.consumed = true;
    },
    add(c) {
      if (!isUsableCaptureSourceIdentity(c.smsKey, c.ts)) return;
      const ts = candidateTime(c);
      note(dedupeKey(c.date, c.amountFils, c.title), ts, c.type, c.amountFils, c.smsKey, c.id,
        c.captureInstrument, { liveObservation: c.liveObservation === true, statement: c });
      noteExact(c);
      noteCross(crossChannelKey(c.date, c.amountFils, c.type), {
        ts,
        channel: c.channel ?? 'inbox',
        id: c.id,
        title: c.title,
        captureInstrument: c.captureInstrument,
      });
      noteStatementPair({
        date: c.date,
        amountFils: c.amountFils,
        type: c.type,
        title: c.title,
        accountId: c.accountId,
        captureInstrument: c.captureInstrument,
        captureSource: c.captureSource,
        statementImportId: c.statementImportId,
        statementBank: c.statementBank,
        id: c.id,
        consumed: false,
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
  // Every capture and every launch run this over the whole ledger, so the
  // time-bucketed indexes are keyed on each row's own fingerprint alone and
  // hold flat lists in insertion order instead of one composite
  // `${fingerprint}|${bucket}` string per bucket. A bucket is an integer and
  // holds no "|", so such a string names exactly one (fingerprint, bucket)
  // pair: scanning a fingerprint's list for one bucket yields precisely the
  // rows, in precisely the order, the composite keys did, without building and
  // hashing a string per probe.
  const bySmsKey = new Map<string, number[]>();
  /** crossChannelKey -> [crossBucket, laggedBucket, index, ...]. */
  const byCross = new Map<string, number[]>();
  /** dedupeKey -> [titleBucket, index, ...]. */
  const byTitle = new Map<string, number[]>();
  /** amount|account -> [cardPaymentBucket, index, ...]. */
  const byCardPayment = new Map<string, number[]>();
  const pairedCardPayments = new Set<number>();
  /** A kept row that absorbed a lagged cross-channel copy explains exactly one. */
  const laggedAbsorbed = new Set<number>();

  const timeOf = (t: Transaction): number | null =>
    Number.isFinite(t.ts) ? t.ts! : keyTime(t.smsKey);

  const pushIndex = (map: Map<string, number[]>, key: string, index: number) => {
    const rows = map.get(key);
    if (rows) rows.push(index);
    else map.set(key, [index]);
  };
  const pushPair = (map: Map<string, number[]>, key: string, slot: number, index: number) => {
    const rows = map.get(key);
    if (rows) rows.push(slot, index);
    else map.set(key, [slot, index]);
  };
  const pushTriple = (map: Map<string, number[]>, key: string, slot: number, lagged: number, index: number) => {
    const rows = map.get(key);
    if (rows) rows.push(slot, lagged, index);
    else map.set(key, [slot, lagged, index]);
  };
  const bucket = (ts: number, width: number) => Math.floor(ts / width);
  /** `keys` are this row's own fingerprints when the caller already built them. */
  const noteAt = (
    row: Transaction,
    index: number,
    keys?: { source: string | undefined; cross: string; title: string },
  ) => {
    if (row.smsKey) pushIndex(bySmsKey, keys?.source ?? canonicalCaptureSourceKey(row.smsKey, row.ts), index);
    const ts = timeOf(row);
    if (ts === null || row.source !== 'sms') return;
    pushTriple(byCross, keys?.cross ?? crossChannelKey(row.date, row.amountFils, row.type),
      bucket(ts, CROSS_CHANNEL_EVENT_MS), bucket(ts, CROSS_CHANNEL_INSTRUMENT_EVENT_MS), index);
    pushPair(byTitle, keys?.title ?? dedupeKey(row.date, row.amountFils, row.title), bucket(ts, 30_000), index);
    if (row.cardPaymentSide && row.isTransfer === true) {
      pushPair(byCardPayment, `${row.amountFils}|${row.accountId}`, bucket(ts, CARD_PAYMENT_PAIR_MS), index);
    }
  };
  // Reusable, insertion-ordered, de-duplicated candidate lists: the Sets they
  // replace were allocated for every row although most rows match nothing.
  const candidates: number[] = [];
  const seenCandidates = new Set<number>();
  const laggedCandidates: number[] = [];
  const seenLagged = new Set<number>();
  const addCandidate = (index: number) => {
    if (seenCandidates.has(index)) return;
    seenCandidates.add(index);
    candidates.push(index);
  };
  const addLagged = (index: number) => {
    if (seenLagged.has(index)) return;
    seenLagged.add(index);
    laggedCandidates.push(index);
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
    if (!isUsableCaptureSourceIdentity(row.smsKey, row.ts)) {
      kept.push(row);
      continue;
    }
    if (row.source !== 'sms') {
      kept.push(row);
      noteAt(row, kept.length - 1);
      continue;
    }
    const rowTime = timeOf(row);
    candidates.length = 0;
    seenCandidates.clear();
    laggedCandidates.length = 0;
    seenLagged.clear();
    const rowSourceKey = row.smsKey ? canonicalCaptureSourceKey(row.smsKey, row.ts) : undefined;
    if (rowSourceKey !== undefined) {
      for (const index of bySmsKey.get(rowSourceKey) ?? []) addCandidate(index);
    }
    let rowKeys: { source: string | undefined; cross: string; title: string } | undefined;
    if (rowTime !== null) {
      rowKeys = {
        source: rowSourceKey,
        cross: crossChannelKey(row.date, row.amountFils, row.type),
        title: dedupeKey(row.date, row.amountFils, row.title),
      };
      const cross = byCross.get(rowKeys.cross);
      const titled = byTitle.get(rowKeys.title);
      const payments = row.cardPaymentSide && row.isTransfer === true
        ? byCardPayment.get(`${row.amountFils}|${row.accountId}`)
        : undefined;
      const crossSlot = bucket(rowTime, CROSS_CHANNEL_EVENT_MS);
      const laggedSlot = bucket(rowTime, CROSS_CHANNEL_INSTRUMENT_EVENT_MS);
      const titleSlot = bucket(rowTime, 30_000);
      const paymentSlot = bucket(rowTime, CARD_PAYMENT_PAIR_MS);
      for (let offset = -1; offset <= 1; offset += 1) {
        if (cross) {
          for (let at = 0; at < cross.length; at += 3) {
            if (cross[at] === crossSlot + offset) addCandidate(cross[at + 2]);
          }
          for (let at = 0; at < cross.length; at += 3) {
            if (cross[at + 1] === laggedSlot + offset) addLagged(cross[at + 2]);
          }
        }
        if (titled) {
          for (let at = 0; at < titled.length; at += 2) {
            if (titled[at] === titleSlot + offset) addCandidate(titled[at + 1]);
          }
        }
        if (payments) {
          for (let at = 0; at < payments.length; at += 2) {
            if (payments[at] === paymentSlot + offset) addCandidate(payments[at + 1]);
          }
        }
      }
    }
    const primaryAt = candidates.find((index) => {
      const prior = kept[index];
      if (prior.source !== 'sms') return false;
      // Import already matched statement uploads one-to-one; a shared midday
      // clock between two uploads is not an event identity.
      if (fromDifferentStatementUploads(row, prior)) return false;
      const rowPinned = Boolean(row.userEdited || row.transferDecision);
      const priorPinned = Boolean(prior.userEdited || prior.transferDecision);
      const bothEdited = rowPinned && priorPinned;
      const rowSource = rowSourceKey;
      const priorSource = prior.smsKey ? canonicalCaptureSourceKey(prior.smsKey, prior.ts) : undefined;
      if (row.smsKey && rowSource && !isUnboundAndroidSourceKey(rowSource) && rowSource === priorSource &&
        (row.smsKey.startsWith('h') || (row.type === prior.type &&
          compatibleCaptureInstrument(row.captureInstrument, prior.captureInstrument)))) return !bothEdited;
      // A reviewed event may fold with its exact same provider identity, but
      // amount/time heuristics cannot delete a decision or attach it to a
      // different event. Two independently reviewed rows require user review.
      if (row.transferDecision || prior.transferDecision) return false;
      // Likewise a Wallet review decision: only exact receipt identity (above)
      // may fold it. Import binds a proven SMS counterpart explicitly.
      if (isApplePayWalletRow(row) || isApplePayWalletRow(prior) ||
        row.walletBound === true || prior.walletBound === true) return false;
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
        rowSource !== priorSource
      ) return false;
      // Two GUID-less iOS live Messages are two delivered Messages; the
      // native queue stages each once, so heuristics must never fold them.
      if (
        isLiveMessageObservationRow(row) &&
        isLiveMessageObservationRow(prior) &&
        row.messageObservationId!.toLowerCase() !== prior.messageObservationId!.toLowerCase()
      ) return false;
      if (
        row.date !== prior.date ||
        row.amountFils !== prior.amountFils ||
        row.type !== prior.type ||
        !compatibleCaptureInstrument(row.captureInstrument, prior.captureInstrument)
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
    // Second, narrower pass: only when nothing above matched may a push and an
    // SMS for the same stated card and named merchant pair across the lagged
    // window, nearest first and one-to-one. Neither row may be edited, so no
    // user decision is ever folded by this rule.
    let laggedAt: number | undefined;
    if (primaryAt === undefined && rowTime !== null && !row.userEdited && !row.transferDecision &&
      !isApplePayWalletRow(row) && row.walletBound !== true) {
      for (const index of laggedCandidates) {
        const prior = kept[index];
        const priorTime = timeOf(prior);
        if (laggedAbsorbed.has(index) || prior.source !== 'sms' || priorTime === null ||
          prior.transferDecision || isApplePayWalletRow(prior) || prior.walletBound === true ||
          fromDifferentStatementUploads(row, prior) ||
          Boolean(row.viaPush) === Boolean(prior.viaPush) ||
          row.date !== prior.date || row.amountFils !== prior.amountFils || row.type !== prior.type ||
          !laggedCrossChannelEvent(
            { ts: rowTime, title: row.title, captureInstrument: row.captureInstrument, userEdited: row.userEdited },
            { ts: priorTime, title: prior.title, captureInstrument: prior.captureInstrument, userEdited: prior.userEdited },
          )) continue;
        if (laggedAt === undefined ||
          Math.abs(priorTime - rowTime) < Math.abs(timeOf(kept[laggedAt])! - rowTime)) laggedAt = index;
      }
    }
    const duplicateAt = primaryAt ?? laggedAt;
    if (duplicateAt === undefined) {
      kept.push(row);
      noteAt(row, kept.length - 1, rowKeys);
      continue;
    }

    changed = true;
    const prior = kept[duplicateAt];
    const cardPaymentPair = isOppositeCardPaymentPair(row, prior, rowTime);
    const preferred = Boolean(row.userEdited || row.transferDecision) !== Boolean(prior.userEdited || prior.transferDecision)
      ? row.userEdited || row.transferDecision ? row : prior
      : row.userEdited !== prior.userEdited
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
      captureInstrument: mergeCaptureInstrument(preferred.captureInstrument, secondary.captureInstrument),
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
    // Any push/SMS fold has explained its one cross-channel copy; the lagged
    // rule may not attach a second, later push to the same row.
    if (primaryAt === undefined || Boolean(row.viaPush) !== Boolean(prior.viaPush)) {
      laggedAbsorbed.add(duplicateAt);
    }
    // Maps may retain the old row's keys at this index; every candidate is
    // revalidated above, and adding the preferred keys keeps future lookups
    // complete without an O(n) map cleanup.
    noteAt(kept[duplicateAt], duplicateAt);
  }

  return changed ? kept : transactions;
}
