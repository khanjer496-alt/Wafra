import { currencyMinorUnits } from '@/lib/currency-metadata';
import { normalizeCountryCode, setActiveCountry } from '@/lib/country';
import { detectLaunchMarketFromSender, setActiveMarket, setLedgerCurrency } from '@/lib/markets';
import { hasUniversalInstitutionSender } from '@/lib/alert-institution-grammars';
import { createLaunchAlertSession, inspectGenericBankEventForReview } from '@/lib/launch-alert-parser';
import { hasNonCompletedWording, isNotAutoPostableMoney } from '@/lib/best-effort-autopost';
import { originalMoneyOf } from '@/lib/fx';
import { PARSER_VERSION, nonPostingReason, type ParsedSms } from '@/lib/sms-parser';
import type { UniversalBankEvent, UniversalMoney } from '@/lib/universal-types';

export type NativeParserExponent = 0 | 2 | 3;
export interface NativeParserContext {
  readonly v: 1;
  readonly country: string | null;
  readonly parserMarket: 'AE' | 'SA' | 'ZZ';
  readonly ledgerMoney: { readonly currency: string; readonly exponent: NativeParserExponent } | null;
  readonly sourceHash: string;
}
export interface NativeParserInput {
  readonly v: 1;
  readonly context: NativeParserContext;
  readonly sender: string;
  readonly body: string;
  /** Observation time in milliseconds, as supplied by the receipt collector. */
  readonly observedAt: number;
}
export type NativeParserFamily = 'purchase' | 'transfer' | 'refund' | 'cash-withdrawal' |
  'fee' | 'utility' | 'recurring-payment' | 'income';
export interface NativeParserMoney {
  readonly currency: string;
  readonly minorUnits: string;
  readonly exponent: NativeParserExponent;
}
export interface NativeParserNotification {
  readonly style: 'movement' | 'review';
  readonly family: NativeParserFamily;
  readonly direction: 'debit' | 'credit';
  readonly amount: NativeParserMoney;
  readonly merchant: string | null;
  readonly instrument: { readonly kind: 'card' | 'account' | 'wallet'; readonly last4: string | null } | null;
}
export interface NativeParserResult {
  readonly v: 1;
  readonly parserVersion: number;
  readonly route: 'parsed' | 'review' | 'ignore';
  readonly provenance: 'launch' | 'unverified' | null;
  readonly notification: NativeParserNotification | null;
}

const ignore = (): NativeParserResult => ({
  v: 1, parserVersion: PARSER_VERSION, route: 'ignore', provenance: null, notification: null,
});
const record = (value: unknown): value is Record<string, unknown> =>
  typeof value === 'object' && value !== null && !Array.isArray(value);
const keys = (value: Record<string, unknown>, expected: readonly string[]): boolean =>
  Object.keys(value).length === expected.length && expected.every((key) => Object.hasOwn(value, key));

// JavaScriptCore has no TextEncoder binding. Reject malformed UTF-16 and count
// complete UTF-8 input instead of truncating text into a different bank event.
function boundedUtf8(value: string, limit: number): boolean {
  let bytes = 0;
  for (let index = 0; index < value.length; index += 1) {
    const code = value.charCodeAt(index);
    if (code >= 0xd800 && code <= 0xdbff) {
      const next = value.charCodeAt(index + 1);
      if (!(next >= 0xdc00 && next <= 0xdfff)) return false;
      index += 1;
      bytes += 4;
    } else {
      if (code >= 0xdc00 && code <= 0xdfff) return false;
      bytes += code <= 0x7f ? 1 : code <= 0x7ff ? 2 : 3;
    }
    if (bytes > limit) return false;
  }
  return true;
}

function validatedContext(value: unknown): NativeParserContext | null {
  if (!record(value) || !keys(value, ['v', 'country', 'parserMarket', 'ledgerMoney', 'sourceHash']) ||
    value.v !== 1 || typeof value.sourceHash !== 'string' || !/^[a-f0-9]{64}$/.test(value.sourceHash) ||
    typeof value.parserMarket !== 'string' || !['AE', 'SA', 'ZZ'].includes(value.parserMarket)) return null;
  if (value.country !== null && (typeof value.country !== 'string' ||
    normalizeCountryCode(value.country) !== value.country)) return null;
  if (value.ledgerMoney !== null) {
    const money = value.ledgerMoney;
    if (!record(money) || !keys(money, ['currency', 'exponent']) ||
      typeof money.currency !== 'string' || !/^[A-Z]{3}$/.test(money.currency) ||
      ![0, 2, 3].includes(Number(money.exponent)) ||
      currencyMinorUnits(money.currency) !== money.exponent) return null;
  }
  return value as unknown as NativeParserContext;
}

function sourceMoney(value: UniversalMoney | null): NativeParserMoney | null {
  if (!value || !/^[A-Z]{3}$/.test(value.currency) ||
    ![0, 2, 3].includes(value.exponent) || currencyMinorUnits(value.currency) !== value.exponent ||
    !/^[1-9]\d{0,15}$/.test(value.minorUnits) || !Number.isSafeInteger(Number(value.minorUnits))) return null;
  return { currency: value.currency, minorUnits: value.minorUnits, exponent: value.exponent as NativeParserExponent };
}
const sameMoney = (left: NativeParserMoney, right: NativeParserMoney): boolean =>
  left.currency === right.currency && left.minorUnits === right.minorUnits && left.exponent === right.exponent;

// These are preview refusal contexts, not transaction formats. A bank-looking
// quotation inside a conversation or example must not become a bank banner,
// even when the sender happens to name a launch bank.
const NON_RECEIPT_PREFIX_RE = /^\s*(?:for\s+example\b|e\.g\.|example\s*:|(?:please\s+)?(?:explain|clarify|help\s+me\s+understand)\b|(?:can|could|would)\s+you\s+(?:explain|clarify|help)\b|[^\n:,.!?]{1,32},\s*(?:i\b|my\b)|i(?:['’](?:ve|m))?\s|my\s+(?:(?:credit|debit|bank|prepaid)\s+)?(?:card|account|wallet)\b)/iu;

function singleSourcePrincipal(source: string, event: UniversalBankEvent, parsed: ParsedSms | null): boolean {
  if (event.amount.spans.length !== 1) return false;
  const primary = event.amount.spans[0];
  return event.observations.every(({ role, field }) => {
    if (field.spans.length === 1 && field.spans[0].start === primary.start && field.spans[0].end === primary.end) return true;
    // These named facts do not compete for the movement amount. Unlabeled
    // money and another transaction are never treated as an incidental field.
    if (['balance', 'credit-limit', 'fee', 'minimum-due', 'statement-total', 'bill-due'].includes(role)) return true;
    if (!parsed || parsed.fxSource !== 'bank' || !parsed.originalCurrency ||
      parsed.originalCurrency === parsed.currency || !Number.isSafeInteger(parsed.originalMinorUnits) ||
      (parsed.originalMinorUnits ?? 0) <= 0 || parsed.originalExponent === undefined ||
      currencyMinorUnits(parsed.originalCurrency) !== parsed.originalExponent ||
      field.evidence !== 'explicit' || field.spans.length !== 1) return false;
    const quoted = sourceMoney(field.value);
    const span = field.spans[0];
    const between = source.slice(primary.end, span.start).trim();
    const parentheticalQuote = between === '(' && source.slice(span.end).trimStart().startsWith(')');
    // The existing purchase-refund grammar also quotes its local refund after
    // "has been refunded" in the same clause. Keep that proved bank quote;
    // never exempt a later sentence describing another credit or debit.
    const refundQuote = event.family === 'refund' && parsed.type === 'income' &&
      !/[.!?\n]/.test(between) && /\bhas\s+been\s+(?:successfully\s+)?refunded\s*$/i.test(between);
    // The known parser must prove the true foreign pair and the exact quoted
    // local amount and quote relation. An unrelated second movement cannot
    // masquerade as that conversion.
    return quoted !== null && quoted.currency === parsed.currency &&
      quoted.minorUnits === String(parsed.amountFils) && span.start >= primary.end &&
      (parentheticalQuote || refundQuote);
  });
}

function parsedSourceMoney(parsed: ParsedSms, event: UniversalBankEvent | null): NativeParserMoney | null {
  const hasForeignFields = parsed.originalCurrency !== undefined || parsed.originalMinorUnits !== undefined ||
    parsed.originalExponent !== undefined || parsed.originalAmountMinor !== undefined ||
    parsed.fxRate !== undefined || parsed.fxSource !== undefined;
  let money: NativeParserMoney | null = null;
  if (hasForeignFields) {
    // originalMoneyOf also supports legacy exponent-two cents. Validate the
    // true ISO pair first so that fallback is never eligible for a preview.
    if (typeof parsed.originalCurrency !== 'string' ||
      !Number.isSafeInteger(parsed.originalMinorUnits) || (parsed.originalMinorUnits ?? 0) <= 0 ||
      parsed.originalExponent === undefined || currencyMinorUnits(parsed.originalCurrency) !== parsed.originalExponent) return null;
    const original = originalMoneyOf(parsed);
    if (original) money = sourceMoney({ ...original, minorUnits: String(original.minorUnits) });
  } else {
    if (!Number.isSafeInteger(parsed.amountFils) || parsed.amountFils <= 0) return null;
    const exponent = currencyMinorUnits(parsed.currency);
    if (exponent !== null) money = sourceMoney({ currency: parsed.currency, minorUnits: String(parsed.amountFils), exponent });
  }
  if (!money || !event) return null;
  const principal = event.amount.evidence === 'explicit' ? sourceMoney(event.amount.value) : null;
  if (principal && sameMoney(money, principal)) return money;
  // A known regional grammar can disambiguate its foreign three-decimal token.
  // It cannot choose among different principal spans or borrow a balance.
  if (hasForeignFields && event.amount.evidence === 'ambiguous' && event.amount.spans.length === 1 &&
    event.amount.alternatives.some((alternative) => {
      const candidate = sourceMoney(alternative);
      return candidate !== null && sameMoney(money!, candidate);
    })) return money;
  return null;
}

const movementFamily = (family: string): family is Exclude<NativeParserFamily, 'income'> =>
  ['purchase', 'transfer', 'refund', 'cash-withdrawal', 'fee', 'utility', 'recurring-payment'].includes(family);
function parsedFamily(parsed: ParsedSms, event: UniversalBankEvent): NativeParserFamily {
  const direction = parsed.type === 'income' ? 'credit' : 'debit';
  if (direction === 'credit' && parsed.merchant === 'Salary') return 'income';
  if ((event.direction === direction || event.direction === 'unknown') && movementFamily(event.family)) return event.family;
  if (parsed.transferHint || ['Incoming transfer', 'Outgoing transfer', 'Telegraphic transfer', 'Transfer'].includes(parsed.merchant)) return 'transfer';
  // The launch parser's received-money decision is sufficient for neutral
  // received wording. It grants no account ownership or net-income claim.
  return direction === 'credit' ? 'income' : 'purchase';
}
function merchant(value: string | null): string | null {
  if (!value) return null;
  const text = value.trim();
  // Do not smuggle full identifiers or source excerpts through a merchant.
  return text.length <= 120 && boundedUtf8(text, 512) && !/[\p{C}]|\d{5,}|[\dXx*·]{6,}/u.test(text) ? text : null;
}
const GENERIC_TRANSFER_TITLES = new Set([
  'incoming transfer', 'outgoing transfer', 'telegraphic transfer', 'bank transfer',
  'own account transfer', 'savings transfer', 'inward remittance', 'outward remittance',
  'transfer', 'account debit', 'account credit',
]);
function parsedMerchant(parsed: ParsedSms, event: UniversalBankEvent, family: NativeParserFamily): string | null {
  const title = merchant(parsed.merchant);
  if (family !== 'transfer' || !title || !GENERIC_TRANSFER_TITLES.has(title.toLowerCase())) return title;
  // Structural ledger titles describe the rail/direction, not a counterparty.
  // Native presentation already localizes that movement. Keep an actual named
  // party even if its source-proven name happens to match a structural title.
  const named = event.merchant.evidence === 'explicit' ? merchant(event.merchant.value) : null;
  return named?.toLowerCase() === title.toLowerCase() ? title : null;
}
function instrument(event: UniversalBankEvent, parsed?: ParsedSms): NativeParserNotification['instrument'] {
  const proven = event.instrument.evidence === 'explicit' ? event.instrument.value : null;
  if (proven && ['card', 'account', 'wallet'].includes(proven.kind)) {
    return { kind: proven.kind, last4: proven.last4 !== null && /^\d{4}$/.test(proven.last4) ? proven.last4 : null };
  }
  if (parsed?.card && /^\d{4}$/.test(parsed.card.last4)) {
    return { kind: parsed.card.kind === 'account' ? 'account' : 'card', last4: parsed.card.last4 };
  }
  return null;
}
function futureDate(event: UniversalBankEvent | null, observedAt: number, parsed?: ParsedSms): boolean {
  const date = new Date(observedAt);
  const today = `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}-${String(date.getDate()).padStart(2, '0')}`;
  return [parsed?.date, event?.transactionDate.evidence === 'explicit' ? event.transactionDate.value : null]
    .some((day) => typeof day === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(day) && day > today);
}
const resetContext = (): void => {
  setActiveCountry(null);
  setActiveMarket('ZZ');
  setLedgerCurrency(null);
};

/** Pure preview interpretation; it neither authorizes nor writes a ledger row. */
export function parseIosBackgroundAlert(input: NativeParserInput): NativeParserResult {
  resetContext();
  try {
    if (!record(input) || !keys(input, ['v', 'context', 'sender', 'body', 'observedAt']) || input.v !== 1 ||
      typeof input.sender !== 'string' || input.sender.length > 80 || !boundedUtf8(input.sender, 320) ||
      typeof input.body !== 'string' || !input.body.trim() || !boundedUtf8(input.body, 4096) ||
      !Number.isSafeInteger(input.observedAt) || input.observedAt < 0 || input.observedAt > 8_640_000_000_000_000) return ignore();
    const context = validatedContext(input.context);
    if (!context?.ledgerMoney) return ignore();
    const sender = /^(?:wafra(?:\s+(?:automation|shortcut))?|shortcut|automation|unknown|none|null)$/i.test(input.sender.trim())
      ? '' : input.sender.trim();
    const source = input.body;
    setActiveCountry(context.country);
    setActiveMarket(context.parserMarket);
    setLedgerCurrency(context.ledgerMoney.currency, context.ledgerMoney.exponent);
    if (NON_RECEIPT_PREFIX_RE.test(source) || nonPostingReason(source) || isNotAutoPostableMoney(source) ||
      hasNonCompletedWording(source, context.country, sender)) return ignore();
    const session = createLaunchAlertSession({ overrides: {}, activeMarket: context.parserMarket,
      pinnedCurrency: context.ledgerMoney.currency, fxLookup: () => null,
      bestEffort: { enabled: false, country: context.country } });
    // The same routing the ledger uses (local-message-record.ts
    // localRecordMarket): a present sender routes the launch grammar by
    // itself, as on Android; only a record with no sender reads the body.
    // A sender that names no launch bank is never previewed as money that
    // moved — the ledger sends it to Review at most — and gets no banner at
    // all unless it is a bank-style sender ID (a known institution header or
    // a carrier short code), never a person, number or e-mail handle.
    const senderMarket = sender ? detectLaunchMarketFromSender(sender) : null;
    const unbankedSender = sender !== '' && senderMarket === null;
    if (unbankedSender && !hasUniversalInstitutionSender(sender) && !/^\d{3,6}$/.test(sender)) return ignore();
    const inspection = session.inspect(source, sender);
    const parsed = unbankedSender ? null
      : session.parse(source, sender, inspection, senderMarket ?? undefined, input.observedAt);
    const event = inspectGenericBankEventForReview(source, sender);
    if (futureDate(event, input.observedAt, parsed ?? undefined)) return ignore();
    if (parsed && parsed.kind !== 'transaction') return ignore();
    if (event && ['statement', 'balance', 'authentication', 'bill', 'card-payment'].includes(event.family)) return ignore();
    if (!event || !singleSourcePrincipal(source, event, parsed)) return ignore();
    if (parsed && (['failed', 'future', 'informational'].includes(event.status) || event.direction === 'none' ||
      ((event.direction === 'debit' || event.direction === 'credit') &&
        event.direction !== (parsed.type === 'income' ? 'credit' : 'debit')))) return ignore();
    const amount = parsed ? parsedSourceMoney(parsed, event) : null;
    let result: NativeParserResult;
    if (parsed && !parsed.bestEffort && event && amount) {
      const family = parsedFamily(parsed, event);
      result = { v: 1, parserVersion: PARSER_VERSION, route: 'parsed', provenance: 'launch',
        notification: { style: 'movement', family,
          direction: parsed.type === 'income' ? 'credit' : 'debit', amount,
          merchant: parsedMerchant(parsed, event, family), instrument: instrument(event, parsed) } };
    } else {
      const reviewMoney = event?.amount.evidence === 'explicit' ? sourceMoney(event.amount.value) : null;
      if (!event || event.status !== 'posted' || !movementFamily(event.family) ||
        (event.direction !== 'debit' && event.direction !== 'credit') || !reviewMoney) return ignore();
      result = { v: 1, parserVersion: PARSER_VERSION, route: 'review', provenance: 'unverified',
        notification: { style: 'review', family: event.family, direction: event.direction, amount: reviewMoney,
          merchant: merchant(event.merchant.evidence === 'explicit' ? event.merchant.value : null), instrument: instrument(event) } };
    }
    return boundedUtf8(JSON.stringify(result), 2048) ? result : ignore();
  } catch {
    // A preview failure cannot change the already staged receipt's outcome.
    return ignore();
  } finally {
    resetContext();
  }
}
