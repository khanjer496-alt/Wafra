/**
 * LEARNED BANK FORMATS IN CAPTURE AND REVIEW (the wiring around the pure
 * learned-alert-formats.ts module).
 *
 * Order of authority in every capture path:
 *   1. the proven parsers (AE/SA launch grammar, certified templates) and the
 *      best-effort universal policy — unchanged;
 *   2. the person's learned formats (this module) — deterministic;
 *   3. AI reading (ai-alert-reader.ts) — Review suggestions only.
 *
 * A learned template with ONE confirmation pre-fills a Review item marked
 * "Recognised format"; with LEARNED_POST_THRESHOLD (2) consistent
 * confirmations it may add the row automatically, carrying the best-effort
 * marker (`learned:template:<dir>` + the template id) so it shows
 * "Learned format — check" and can be confirmed or undone. Never for AE/SA
 * senders or routes, never on an AED/SAR ledger or for an AE/SA user
 * (those launch-tested markets keep their proven grammar), never when the
 * person turned "Auto-add from learned formats" off (then it pre-fills).
 *
 * Learning happens only when the person confirms a Review item. The item
 * carries a LEARN DRAFT (see createLearnDraft) computed at capture time, so
 * the Review tray never keeps message text. Nothing here touches the network.
 */
import {
  blockLearnedTemplate,
  confirmLearnedTemplate,
  addOrUpdateLearnedTemplate,
  createLearnDraft,
  emptyLearnedFormatStore,
  finalizeLearnDraft,
  matchLearnedFormat,
  validateLearnedFormatStore,
  type LearnDraft,
  type LearnedFields,
  type LearnedFormatStore,
  type LearnedMatch,
} from '@/lib/learned-alert-formats';
import { decideBestEffortAutoPost } from '@/lib/best-effort-autopost';
import { detectLaunchMarketFromAlert, detectLaunchMarketFromSender, pinnedLedgerCurrencyCode } from '@/lib/markets';
import { getActiveCountry } from '@/lib/country';
import { categorizeMerchant } from '@/lib/universal-categorization';
import type { FxQuote } from '@/lib/fx';
import type { ParsedSms } from '@/lib/sms-parser';
import type { BestEffortMarker, CategoryId } from '@/lib/types';
import type { UniversalBankEvent, UniversalField, UniversalMoney } from '@/lib/universal-types';

export const LEARNED_POST_THRESHOLD = 2;
const LAUNCH = new Set(['AE', 'SA']);

/* ── process mirror of the persisted state ─────────────────────────────
 * Like the best-effort setting (best-effort-autopost.ts), the store mirrors
 * its encrypted state here so parser sessions deep in capture pipelines read
 * it without threading the store through every native adapter. */
interface LearnedCaptureMirror {
  store: LearnedFormatStore;
  /** "Auto-add from learned formats"; undefined in storage = ON. */
  autoPost: boolean;
  /** False in Private Mode: no new learning drafts are made. */
  learning: boolean;
}

let mirror: LearnedCaptureMirror = { store: emptyLearnedFormatStore(), autoPost: true, learning: true };

export function setLearnedFormatCaptureState(next: {
  store?: LearnedFormatStore | null;
  autoPost?: boolean;
  privateMode?: boolean;
}): void {
  mirror = {
    store: next.store && Array.isArray(next.store.templates) ? next.store : emptyLearnedFormatStore(),
    autoPost: next.autoPost !== false,
    learning: next.privateMode !== true,
  };
}

export const learnedFormatCaptureState = (): Readonly<LearnedCaptureMirror> => mirror;

/** Normalise a persisted or restored store; invalid templates are dropped. */
export const normalizeLearnedFormatStore = (value: unknown): LearnedFormatStore =>
  (value === undefined || value === null ? null : validateLearnedFormatStore(value)) ?? emptyLearnedFormatStore();

/** AE/SA evidence of any kind: the sender, the caller's route, or the alert's own AED/SAR routing. */
const launchEvidence = (source: string, sender: string | null | undefined, routedMarket: string | null | undefined): boolean =>
  !!detectLaunchMarketFromSender(sender ?? '') || (!!routedMarket && LAUNCH.has(routedMarket)) ||
  !!detectLaunchMarketFromAlert(source, sender ?? '');

const launchUser = (country: string | null | undefined, ledgerCurrency: string | null | undefined): boolean =>
  (!!country && LAUNCH.has(country.toUpperCase())) || ledgerCurrency === 'AED' || ledgerCurrency === 'SAR';

/** The person is a UAE/Saudi user or keeps an AED/SAR ledger: learned formats stay out entirely. */
export interface LearnedUserContext { country?: string | null; ledgerCurrency?: string | null }
const currentLaunchUser = (user: LearnedUserContext | undefined): boolean => launchUser(
  user && 'country' in user ? user.country : getActiveCountry(),
  user && 'ledgerCurrency' in user ? user.ledgerCurrency : pinnedLedgerCurrencyCode(),
);

/** Match one message against the person's learned formats (mirror store). */
export function readLearnedFormat(
  source: string,
  sender: string | null | undefined,
  options: { observedAt?: number; routedMarket?: string | null; store?: LearnedFormatStore } = {},
): LearnedMatch {
  const store = options.store ?? mirror.store;
  if (!store.templates.length) return { kind: 'none' };
  try {
    return matchLearnedFormat(source, sender, store, {
      postThreshold: LEARNED_POST_THRESHOLD,
      now: options.observedAt,
      routedMarket: options.routedMarket ?? null,
    });
  } catch {
    return { kind: 'none' };
  }
}

const explicit = <T>(value: T | null): UniversalField<T> => ({
  value, evidence: value === null ? 'missing' : 'explicit', spans: [], alternatives: [], issues: [],
});

/** The Review / policy view of a learned reading. Family stays unknown: the template records direction only. */
export function learnedFieldsEvent(fields: LearnedFields, family: UniversalBankEvent['family'] = 'unknown'): UniversalBankEvent {
  const money: UniversalMoney = { currency: fields.currency, minorUnits: String(fields.amountMinor), exponent: fields.exponent };
  return {
    version: 1,
    decision: 'review',
    family,
    status: 'posted',
    direction: fields.direction,
    amount: explicit(money),
    statementTotal: explicit<UniversalMoney>(null),
    minimumDue: explicit<UniversalMoney>(null),
    balance: explicit<UniversalMoney>(null),
    creditLimit: explicit<UniversalMoney>(null),
    merchant: explicit(fields.merchant ?? null),
    transactionDate: explicit(fields.date ?? null),
    dueDate: explicit<string>(null),
    statementDate: explicit<string>(null),
    instrument: explicit(fields.cardLast4 ? { kind: 'card' as const, last4: fields.cardLast4 } : null),
    observations: [{ role: 'transaction', field: explicit(money) }],
    issues: [],
  };
}

export interface LearnedPostingInput {
  source: string;
  sender: string;
  observedAt?: number;
  routedMarket: string | null;
  country: string | null;
  ledgerCurrency: string | null;
  ledgerExponent: number | null;
  fxLookup?: (base: string, quote: string, date: string) => FxQuote | null;
  overrides?: Record<string, CategoryId>;
  /** Tests only; capture uses the mirrored store and setting. */
  store?: LearnedFormatStore;
  autoPost?: boolean;
}

/**
 * An automatic row from a learned format, or null (the alert continues to
 * Review exactly as before). Requires ≥ LEARNED_POST_THRESHOLD consistent
 * confirmations, the setting ON, a pinned non-AED/SAR ledger, a non-AE/SA
 * user and sender, and the unchanged best-effort policy for the rest (no
 * non-completed wording, no future date, a dated rate for foreign money).
 */
export function learnedPosting(input: LearnedPostingInput): ParsedSms | null {
  try {
    // Cheapest checks first: with no learned formats nothing else runs.
    if (!(input.store ?? mirror.store).templates.length) return null;
    if (!(input.autoPost ?? mirror.autoPost)) return null;
    if (!input.ledgerCurrency || launchUser(input.country, input.ledgerCurrency)) return null;
    const senderMarket = detectLaunchMarketFromSender(input.sender);
    if (launchEvidence(input.source, input.sender, input.routedMarket)) return null;
    const match = readLearnedFormat(input.source, input.sender, {
      observedAt: input.observedAt, routedMarket: input.routedMarket, store: input.store,
    });
    if (match.kind !== 'post') return null;
    const { fields } = match;
    // The policy needs a family that agrees with the direction; the marker
    // below records the learned provenance instead of this stand-in.
    const event = learnedFieldsEvent(fields, fields.direction === 'debit' ? 'purchase' : 'transfer');
    const decision = decideBestEffortAutoPost({
      source: input.source,
      event,
      enabled: true,
      country: input.country,
      routedMarket: input.routedMarket,
      launchSenderMarket: senderMarket,
      ledgerCurrency: input.ledgerCurrency,
      ledgerExponent: input.ledgerExponent,
      observedAt: input.observedAt,
      fxLookup: input.fxLookup,
      formatPrefix: 'learned',
    });
    if (decision.outcome !== 'post') return null;
    const marker: BestEffortMarker = {
      v: 1,
      format: `learned:template:${fields.direction}`,
      market: decision.marker.market,
      template: match.templateId,
    };
    const type = fields.direction === 'credit' ? 'income' : 'expense';
    const merchant = fields.merchant?.trim() ?? '';
    const suggestion = merchant ? categorizeMerchant({
      merchant, type, overrides: input.overrides, market: input.country ?? undefined,
    }) : null;
    const categoryGuess: CategoryId = suggestion && !suggestion.needsReview ? suggestion.category : 'other';
    return {
      kind: 'transaction',
      type,
      amountFils: decision.amountFils,
      currency: decision.currency,
      ...(decision.conversion ? decision.conversion.fields : {}),
      bestEffort: marker,
      merchant: merchant || (type === 'income' ? 'Incoming payment' : 'Account debit'),
      date: decision.date,
      dueDay: null,
      minDueFils: null,
      card: fields.cardLast4 ? { last4: fields.cardLast4, kind: 'unknown' } : null,
      reference: null,
      transferHint: false,
      snapshotFils: null,
      snapshotKind: null,
      categoryGuess,
      categoryDeliberate: !!suggestion && !suggestion.needsReview,
      raw: input.source.trim(),
    };
  } catch {
    return null;
  }
}

/**
 * A pre-filled Review event from a learned format (1 confirmation, a match
 * whose posting was refused, or auto-add turned off), with the template as
 * the item's learn draft so a confirmation counts toward it.
 */
export function learnedReviewEvent(
  source: string,
  sender: string,
  options: { observedAt?: number; routedMarket?: string | null; store?: LearnedFormatStore; user?: LearnedUserContext } = {},
): { event: UniversalBankEvent; templateId: string; draft: LearnDraft | null } | null {
  const store = options.store ?? mirror.store;
  if (!store.templates.length || currentLaunchUser(options.user) ||
    launchEvidence(source, sender, options.routedMarket)) return null;
  const match = readLearnedFormat(source, sender, { ...options, store });
  if (match.kind === 'none') return null;
  const template = store.templates.find((row) => row.id === match.templateId) ?? null;
  // In Private Mode a match still pre-fills, but confirming it teaches nothing.
  return { event: learnedFieldsEvent(match.fields), templateId: match.templateId, draft: mirror.learning ? template : null };
}

/**
 * The learning draft for a Review item built from `event` (a universal or AI
 * reading), or null when it cannot be learned: Private Mode, AE/SA evidence,
 * no single explicit amount, or a message the learner refuses.
 */
export function learnDraftForEvent(
  source: string,
  sender: string,
  event: UniversalBankEvent,
  context: { observedAt: number; country: string | null; routedMarket?: string | null; learning?: boolean; ledgerCurrency?: string | null },
): LearnDraft | null {
  try {
    if (!(context.learning ?? mirror.learning)) return null;
    if (currentLaunchUser({ country: context.country,
      ledgerCurrency: 'ledgerCurrency' in context ? context.ledgerCurrency : pinnedLedgerCurrencyCode() })) return null;
    if (launchEvidence(source, sender, context.routedMarket)) return null;
    const amount = event.amount;
    if (amount.evidence !== 'explicit' || !amount.value || amount.alternatives.length) return null;
    return createLearnDraft({
      source,
      sender,
      amountMinor: amount.value.minorUnits,
      currency: amount.value.currency,
      exponent: amount.value.exponent,
      direction: event.direction === 'credit' ? 'credit' : 'debit',
      merchant: event.merchant.evidence === 'explicit' ? event.merchant.value : null,
      date: event.transactionDate.evidence === 'explicit' ? event.transactionDate.value : null,
      context: { country: context.country, routedMarket: context.routedMarket ?? null },
      now: context.observedAt,
    });
  } catch {
    return null;
  }
}

/**
 * The learned store after the person confirmed (added) a Review item.
 * Returns null when nothing is learned: no draft, an amount other than the
 * one the draft was learned on, or an unknown direction.
 */
export function learnedStoreAfterConfirmation(
  store: LearnedFormatStore | null | undefined,
  item: { event: UniversalBankEvent; learn?: LearnDraft },
  confirmed: { direction: 'debit' | 'credit'; amount: UniversalMoney | null; date: string },
  now: number,
  user?: LearnedUserContext,
): LearnedFormatStore | null {
  if (!item.learn || (confirmed.direction !== 'debit' && confirmed.direction !== 'credit')) return null;
  if (currentLaunchUser(user)) return null;
  // The item came from a learned format and the person answered the other
  // direction: that format read it wrong, whatever day they chose.
  const existing = store?.templates.find((row) => row.id === item.learn?.id);
  if (existing && !existing.blocked && existing.direction !== confirmed.direction) {
    return blockLearnedTemplate(store!, existing.id, now);
  }
  const suggested = item.event.amount.evidence === 'explicit' ? item.event.amount.value : null;
  if (!suggested || !confirmed.amount || suggested.currency !== confirmed.amount.currency ||
    suggested.minorUnits !== confirmed.amount.minorUnits || suggested.exponent !== confirmed.amount.exponent) return null;
  if (item.learn.currency !== suggested.currency || item.learn.exponent !== suggested.exponent) return null;
  const suggestedDate = item.event.transactionDate.evidence === 'explicit' ? item.event.transactionDate.value : null;
  const template = finalizeLearnDraft(item.learn, {
    direction: confirmed.direction,
    keepDate: !!suggestedDate && suggestedDate === confirmed.date,
    now,
  });
  if (!template) return null;
  return addOrUpdateLearnedTemplate(store ?? emptyLearnedFormatStore(), template, now);
}

/** Template id carried by a learned auto-added row's marker, if any. */
export const learnedTemplateOfMarker = (marker: BestEffortMarker | undefined | null): string | null =>
  marker && marker.format.startsWith('learned:') && typeof marker.template === 'string' ? marker.template : null;

/**
 * The person removed or materially changed (direction or amount) rows a
 * learned format added: stop those formats, exactly as "Undo" does.
 */
export function learnedStoreAfterRejection(
  store: LearnedFormatStore | null | undefined,
  rows: readonly { bestEffort?: BestEffortMarker }[],
  now: number,
): LearnedFormatStore | null {
  let next: LearnedFormatStore | null = null;
  for (const row of rows) {
    const id = learnedTemplateOfMarker(row.bestEffort);
    const current = next ?? store;
    if (!id || !current?.templates.some((template) => template.id === id && !template.blocked)) continue;
    next = blockLearnedTemplate(current, id, now);
  }
  return next;
}

/** "Looks right" / "Undo" on a learned auto-added row. */
export function learnedStoreAfterResolution(
  store: LearnedFormatStore | null | undefined,
  marker: BestEffortMarker | undefined | null,
  outcome: 'confirm' | 'undo',
  now: number,
): LearnedFormatStore | null {
  const id = learnedTemplateOfMarker(marker);
  if (!id || !store?.templates.some((row) => row.id === id)) return null;
  return outcome === 'undo' ? blockLearnedTemplate(store, id, now) : confirmLearnedTemplate(store, id, now);
}
