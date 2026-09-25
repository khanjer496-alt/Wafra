/**
 * AI READING OF UNRECOGNISED BANK ALERTS — the deterministic gate.
 *
 * A model (the downloaded on-device tagger, src/lib/ai-alert-model*.ts, or in
 * evaluation an LLM) PROPOSES a reading: status, family, direction and
 * character spans for amount / currency / merchant / date / balance / cues.
 * This module decides what, if anything, Wafra may do with it. It is pure:
 * no storage, no network, no model — so the exact same gate runs in the app,
 * in tests and in the offline benchmark (scripts/parser-ai/).
 *
 * WHEN IT RUNS (callers must enforce; the gate re-checks what it can):
 *  - only after the proven paths returned nothing: launch-alert-parser
 *    parse/parseUnproven and the universal parser's automatic path;
 *  - NEVER for a UAE/Saudi sender or an alert routed to AE/SA (the mature
 *    grammar's refusal there is deliberate evidence) → 'launch-market'.
 *
 * OUTCOMES
 *  - 'prefill': a Review item may carry the model's amount / currency /
 *    merchant / direction / date as SUGGESTIONS the person confirms. Requires
 *    a completed status and an amount + currency that are grounded in the
 *    text (the model's span overlaps exactly one money token found by the
 *    deterministic money reader). Adds nothing to the ledger.
 *  - 'post': only when auto-posting is enabled for this build (flag, default
 *    OFF) AND for the alert's language (ai-alert-gates.ts, all OFF until a
 *    language passes ≥500 labelled real messages), AND every guard passes:
 *      · model confidences above the calibrated post thresholds;
 *      · no non-completed wording (hasNonCompletedWording: pending, holds,
 *        declined, reversed, OTP, promotions, statements, scheduled …) and no
 *        authentication / promotion / pending / failed reading by the
 *        universal parser;
 *      · amount + currency grounded as above, currency resolved to ONE ISO
 *        code (local spellings only for the user's own country);
 *      · no competing money figure: any other amount must be the same
 *        figure, tagged as a balance, or labelled balance/limit/due in text;
 *      · the text carries a direction cue of the predicted polarity and none
 *        of the opposite one, the model tagged no opposite cue, and the
 *        family agrees with the direction;
 *      · then the UNCHANGED best-effort policy (decideBestEffortAutoPost):
 *        future dates, FX rate on device, ledger exponent, launch markets.
 *    A posted row carries the best-effort marker with format `ai:<family>:<dir>`
 *    so it shows "Auto-added — check" and can be confirmed, edited or undone.
 *  - 'refuse': anything else — the alert is handled exactly as today.
 */
import { inspectUniversalMoneyDraft } from '@/lib/universal-money';
import { inspectUniversalBankEvent } from '@/lib/universal-parser';
import { currencyMinorUnits } from '@/lib/currency-metadata';
import { detectLaunchMarketFromSender } from '@/lib/markets';
import {
  decideBestEffortAutoPost,
  hasNonCompletedWording,
  sharedSymbolCurrencyForCountry,
  type BestEffortDecision,
} from '@/lib/best-effort-autopost';
import { directionCueEvidence, isBalanceContext, localCurrencyAliases, type AiCueLanguage } from '@/lib/ai-alert-cues';
import { aiAutoPostAllowedForLanguage } from '@/lib/ai-alert-gates';
import type { FxQuote } from '@/lib/fx';
import type { UniversalBankEvent, UniversalField, UniversalMoney } from '@/lib/universal-types';

export type AiAlertStatus =
  | 'completed' | 'pending' | 'declined' | 'otp' | 'promo' | 'informational' | 'future' | 'request' | 'unknown';
export type AiAlertFamily =
  | 'purchase' | 'refund' | 'transfer' | 'salary' | 'fee' | 'withdrawal' | 'card-payment' | 'bill-payment' | 'non-posting';
export type AiSpanLabel = 'AMT' | 'CUR' | 'MER' | 'DATE' | 'BAL' | 'CUE_DEBIT' | 'CUE_CREDIT' | 'CUE_NONPOST';

export interface AiSpan {
  label: AiSpanLabel;
  /** UTF-16 offsets into the exact source string the model read. */
  start: number;
  end: number;
  /** Calibrated probability of the weakest token in the span (1 when unknown). */
  p: number;
}

/** Engine-agnostic model reading. Probabilities are calibrated where available. */
export interface AiAlertPrediction {
  engine: 'tagger' | 'llm';
  modelVersion: string;
  status: AiAlertStatus;
  statusP: number;
  family: AiAlertFamily;
  familyP: number;
  direction: 'debit' | 'credit' | 'none';
  directionP: number;
  spans: AiSpan[];
}

export interface AiAlertContext {
  sender: string;
  /** The user's ISO country (country.ts). Resolves shared symbols and local spellings only. */
  country: string | null;
  /** Market the router proved for this alert, when single. */
  routedMarket: string | null;
  ledgerCurrency: string | null;
  ledgerExponent: number | null;
  observedAt?: number;
  fxLookup?: (base: string, quote: string, date: string) => FxQuote | null;
  /** The user's country date order (country.ts), so numeric dates resolve. */
  dateOrder?: 'DMY' | 'MDY' | 'YMD';
  /** Build flag (ai-alert-flags.ts) — default OFF. */
  autoPostEnabled: boolean;
  /** The persisted best-effort setting; OFF also disables AI auto-posting. */
  bestEffortEnabled: boolean;
  /**
   * OFFLINE EVALUATION ONLY (scripts/parser-ai): measure the post path as if a
   * language gate were open. App callers never pass it.
   */
  evaluationLanguageGate?: (language: AiCueLanguage) => boolean;
}

export interface AiThresholds {
  prefillStatus: number;
  prefillAmount: number;
  postStatus: number;
  postDirection: number;
  postFamily: number;
  postAmount: number;
}

/**
 * Defaults. The post thresholds are placeholders until a calibrated model
 * manifest supplies its own (chosen on the dev split to meet ≤0.3% false
 * posts); they are deliberately strict.
 */
export const DEFAULT_AI_THRESHOLDS: AiThresholds = Object.freeze({
  prefillStatus: 0.6,
  prefillAmount: 0.5,
  postStatus: 0.98,
  postDirection: 0.98,
  postFamily: 0.9,
  postAmount: 0.95,
});

export interface AiAlertFields {
  money: UniversalMoney;
  direction: 'debit' | 'credit' | null;
  family: AiAlertFamily;
  merchant: string | null;
  date: string | null;
  /** Language whose direction cue matched, when any. */
  language: AiCueLanguage | null;
}

export type AiAlertRefusal =
  | 'launch-market'
  | 'not-completed'
  | 'low-confidence'
  | 'non-posting-wording'
  | 'no-amount'
  | 'amount-ungrounded'
  | 'currency-unclear'
  | 'invalid-money';

export type AiPostBlocker =
  | 'autopost-disabled'
  | 'language-gate'
  | 'low-confidence'
  | 'competing-amounts'
  | 'direction-cue-missing'
  | 'direction-cue-conflict'
  | 'direction-family-conflict'
  | 'unsupported-family'
  | `policy:${string}`;

export type AiAlertGateResult =
  | { outcome: 'refuse'; reason: AiAlertRefusal }
  | { outcome: 'prefill'; fields: AiAlertFields; event: UniversalBankEvent; blockers: AiPostBlocker[] }
  | { outcome: 'post'; fields: AiAlertFields; event: UniversalBankEvent; decision: Extract<BestEffortDecision, { outcome: 'post' }> };

const LAUNCH = new Set(['AE', 'SA']);
const NON_POSTING_ISSUES = new Set([
  'authentication-not-posting', 'authentication-or-otp', 'pending-not-posting',
  'promotion-not-posting', 'failed-not-posting',
]);
const DEBIT_FAMILIES = new Set<AiAlertFamily>(['purchase', 'fee', 'withdrawal', 'bill-payment']);
const CREDIT_FAMILIES = new Set<AiAlertFamily>(['refund', 'salary', 'card-payment']);

const EVENT_FAMILY: Record<AiAlertFamily, UniversalBankEvent['family'] | null> = {
  purchase: 'purchase',
  refund: 'refund',
  transfer: 'transfer',
  salary: 'transfer',
  fee: 'fee',
  withdrawal: 'cash-withdrawal',
  'bill-payment': 'utility',
  'card-payment': 'card-payment',
  'non-posting': null,
};

const field = <T>(value: T | null, spans: { start: number; end: number }[] = []): UniversalField<T> => ({
  value, evidence: value === null ? 'missing' : 'explicit', spans, alternatives: [], issues: [],
});

/** Merge the model's word-level spans of one label into maximal runs. */
const spansOf = (prediction: AiAlertPrediction, label: AiSpanLabel): AiSpan[] =>
  prediction.spans.filter((span) => span.label === label && span.end > span.start);

const overlaps = (a: { start: number; end: number }, b: { start: number; end: number }): boolean =>
  a.start < b.end && b.start < a.end;

const cleanMerchant = (text: string): string | null => {
  const value = text.replace(/\s+/gu, ' ').replace(/^[\s*:,.;\-–|/]+|[\s*:,.;\-–|/]+$/gu, '').trim();
  if (value.length < 2 || value.length > 80 || !/\p{L}/u.test(value)) return null;
  return value;
};

interface GroundedMoney {
  money: UniversalMoney;
  span: { start: number; end: number };
  competing: boolean;
}

/**
 * The model's amount must overlap exactly ONE money token found by the
 * deterministic reader (same normalisation as every other parser path), and
 * that token must resolve to exactly one ISO currency: its own evidence, a
 * shared symbol through the user's country, or a local spelling of the user's
 * own currency. Returns a refusal reason otherwise.
 */
function groundMoney(
  source: string,
  prediction: AiAlertPrediction,
  ctx: AiAlertContext,
): GroundedMoney | 'no-amount' | 'amount-ungrounded' | 'currency-unclear' | 'invalid-money' {
  const amounts = spansOf(prediction, 'AMT');
  if (!amounts.length) return 'no-amount';
  const draft = inspectUniversalMoneyDraft(source, { currencyAliases: localCurrencyAliases(ctx.country) });
  const principal = amounts[0];
  const hits = draft.candidates.filter((candidate) => overlaps(candidate.span, principal));
  if (hits.length !== 1) return 'amount-ungrounded';
  const candidate = hits[0];
  // Every model amount span must belong to that same token (no split figures).
  if (amounts.some((span) => !overlaps(span, candidate.span) &&
    draft.candidates.some((other) => other !== candidate && overlaps(other.span, span) &&
      !(other.interpretations.length && candidate.interpretations.length &&
        other.interpretations[0].minorUnits === candidate.interpretations[0].minorUnits)))) {
    return 'amount-ungrounded';
  }
  // A currency the model tagged must sit inside or right next to that token.
  const currencies = spansOf(prediction, 'CUR');
  if (currencies.length && !currencies.some((span) =>
    overlaps(span, candidate.span) || Math.abs(span.start - candidate.span.end) <= 2 || Math.abs(candidate.span.start - span.end) <= 2)) {
    return 'amount-ungrounded';
  }
  let options = candidate.interpretations;
  if (options.length > 1) {
    const wanted = sharedSymbolCurrencyForCountry(ctx.country);
    options = wanted ? options.filter((option) => option.currency === wanted) : [];
  }
  const distinct = new Set(options.map((option) => `${option.currency}/${option.minorUnits}`));
  if (distinct.size !== 1) return 'currency-unclear';
  const chosen = options[0];
  const exponent = currencyMinorUnits(chosen.currency);
  if (exponent === null || exponent !== chosen.exponent || !/^[1-9]\d{0,15}$/.test(chosen.minorUnits) ||
    !Number.isSafeInteger(Number(chosen.minorUnits))) return 'invalid-money';
  const balances = spansOf(prediction, 'BAL');
  const competing = draft.candidates.some((other) => {
    if (other === candidate) return false;
    if (amounts.some((span) => overlaps(span, other.span)) &&
      other.interpretations.some((option) => option.minorUnits === chosen.minorUnits)) return false;
    if (other.interpretations.some((option) =>
      option.minorUnits === chosen.minorUnits && option.currency === chosen.currency)) return false;
    if (isBalanceContext(draft.normalizedText, other.span.start, other.span.end)) return false;
    if (balances.some((span) => overlaps(span, other.span) && span.p >= 0.9)) return false;
    // The card's own converted figure in the ledger currency beside a foreign charge.
    if (ctx.ledgerCurrency && chosen.currency !== ctx.ledgerCurrency &&
      other.interpretations.length === 1 && other.interpretations[0].currency === ctx.ledgerCurrency) return false;
    return true;
  });
  return {
    money: { currency: chosen.currency, minorUnits: chosen.minorUnits, exponent: chosen.exponent },
    span: candidate.span,
    competing,
  };
}

const minP = (spans: AiSpan[]): number => spans.reduce((low, span) => Math.min(low, span.p), 1);

/** Gate one model reading. Pure; see the module comment for the contract. */
export function gateAiAlert(
  source: string,
  prediction: AiAlertPrediction,
  ctx: AiAlertContext,
  thresholds: AiThresholds = DEFAULT_AI_THRESHOLDS,
): AiAlertGateResult {
  const refuse = (reason: AiAlertRefusal): AiAlertGateResult => ({ outcome: 'refuse', reason });
  if (typeof source !== 'string' || !source.trim() || source.length > 4096) return refuse('no-amount');
  const senderMarket = detectLaunchMarketFromSender(ctx.sender);
  if ((senderMarket && LAUNCH.has(senderMarket)) || (ctx.routedMarket && LAUNCH.has(ctx.routedMarket))) {
    return refuse('launch-market');
  }
  if (prediction.status !== 'completed' || prediction.family === 'non-posting') return refuse('not-completed');
  if (prediction.statusP < thresholds.prefillStatus) return refuse('low-confidence');
  if (hasNonCompletedWording(source)) return refuse('non-posting-wording');
  const universal = inspectUniversalBankEvent(source, { sender: ctx.sender, dateOrder: ctx.dateOrder });
  if (universal.issues.some((issue) => NON_POSTING_ISSUES.has(issue)) ||
    universal.family === 'authentication' || universal.status === 'failed' || universal.status === 'future') {
    return refuse('non-posting-wording');
  }
  const grounded = groundMoney(source, prediction, ctx);
  if (typeof grounded === 'string') return refuse(grounded);
  if (minP(spansOf(prediction, 'AMT')) < thresholds.prefillAmount) return refuse('low-confidence');

  const cues = directionCueEvidence(source);
  const direction = prediction.direction === 'none' ? null : prediction.direction;
  const merchantSpan = spansOf(prediction, 'MER')[0];
  const merchant = merchantSpan ? cleanMerchant(source.slice(merchantSpan.start, merchantSpan.end)) : null;
  const dateSpan = spansOf(prediction, 'DATE')[0];
  const date = dateSpan && universal.transactionDate.evidence === 'explicit' &&
    universal.transactionDate.spans.some((span) => overlaps(span, dateSpan))
    ? universal.transactionDate.value
    : null;
  const fields: AiAlertFields = {
    money: grounded.money,
    direction,
    family: prediction.family,
    merchant,
    date,
    language: cues.languages[0] ?? null,
  };
  const eventFamily = EVENT_FAMILY[prediction.family] ?? 'unknown';
  const event: UniversalBankEvent = {
    version: 1,
    decision: 'review',
    family: eventFamily,
    status: 'posted',
    direction: direction ?? 'unknown',
    amount: field(grounded.money, [grounded.span]),
    statementTotal: field<UniversalMoney>(null),
    minimumDue: field<UniversalMoney>(null),
    balance: field<UniversalMoney>(null),
    creditLimit: field<UniversalMoney>(null),
    merchant: field(merchant, merchantSpan ? [{ start: merchantSpan.start, end: merchantSpan.end }] : []),
    transactionDate: field(date, dateSpan && date ? [{ start: dateSpan.start, end: dateSpan.end }] : []),
    dueDate: field<string>(null),
    statementDate: field<string>(null),
    instrument: universal.instrument,
    observations: [{ role: 'transaction', field: field(grounded.money, [grounded.span]) }],
    issues: [],
  };

  const blockers: AiPostBlocker[] = [];
  if (!ctx.autoPostEnabled || !ctx.bestEffortEnabled) blockers.push('autopost-disabled');
  const languageAllowed = ctx.evaluationLanguageGate ?? aiAutoPostAllowedForLanguage;
  if (!fields.language || !cues.languages.every((language) => languageAllowed(language))) {
    blockers.push('language-gate');
  }
  if (prediction.statusP < thresholds.postStatus || prediction.directionP < thresholds.postDirection ||
    prediction.familyP < thresholds.postFamily || minP(spansOf(prediction, 'AMT')) < thresholds.postAmount) {
    blockers.push('low-confidence');
  }
  if (grounded.competing) blockers.push('competing-amounts');
  if (!direction) blockers.push('direction-cue-missing');
  else {
    const same = direction === 'debit' ? cues.debit : cues.credit;
    const opposite = direction === 'debit' ? cues.credit : cues.debit;
    const modelOpposite = spansOf(prediction, direction === 'debit' ? 'CUE_CREDIT' : 'CUE_DEBIT').length > 0;
    if (!same) blockers.push('direction-cue-missing');
    if (opposite || modelOpposite || spansOf(prediction, 'CUE_NONPOST').length) blockers.push('direction-cue-conflict');
    if ((DEBIT_FAMILIES.has(prediction.family) && direction !== 'debit') ||
      (CREDIT_FAMILIES.has(prediction.family) && direction !== 'credit')) blockers.push('direction-family-conflict');
  }
  if (eventFamily === 'card-payment' || eventFamily === 'unknown') blockers.push('unsupported-family');
  if (blockers.length) return { outcome: 'prefill', fields, event, blockers };

  const decision = decideBestEffortAutoPost({
    source,
    event,
    enabled: true,
    country: ctx.country,
    routedMarket: ctx.routedMarket,
    launchSenderMarket: senderMarket,
    ledgerCurrency: ctx.ledgerCurrency,
    ledgerExponent: ctx.ledgerExponent,
    observedAt: ctx.observedAt,
    fxLookup: ctx.fxLookup,
    formatPrefix: 'ai',
  });
  if (decision.outcome !== 'post') return { outcome: 'prefill', fields, event, blockers: [`policy:${decision.reason}`] };
  return { outcome: 'post', fields, event, decision };
}
