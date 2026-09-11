import { inspectUniversalAlert, type UniversalAlertReview } from '@/lib/alert-market-detection';
import { hasUniversalInstitutionSender } from '@/lib/alert-institution-grammars';
import {
  interpretBankAlert,
  type BankAlertInterpretation,
} from '@/lib/bank-alert-interpreter';
import {
  detectLaunchMarketFromAlert,
  detectLaunchMarketFromSender,
  getActiveMarket,
  pinnedLedgerCurrencyCode,
} from '@/lib/markets';
import { parseSmsBatch, type ParsedSms } from '@/lib/sms-parser';
import type { CategoryId } from '@/lib/types';
import { CURRENCY_SYMBOL_CANDIDATES, currencyMinorUnits } from '@/lib/currency-metadata';
import { inspectUniversalBankEvent } from '@/lib/universal-parser';
import type { UniversalBankEvent } from '@/lib/universal-types';

// Cheap supersets used only to decide whether market routing must run. The
// parser/reviewer remains the authority; matching one of these never imports.
export const REVIEW_MONEY_HINT = /\b(?:USD|GBP|EUR|INR|QAR|KWD|BHD|OMR|EGP|JOD|Rs\.?|KD|BD|RO|R\.O\.|LE|L\.E\.|JD)\b|[$€£₹]|ر\.ق|د\.ك|د\.ب|ر\.ع|ج\.م|د\.[أا]/iu;
const LAUNCH_MONEY_HINT = /\b(?:AED|Dhs?\.?|SAR|SR)\b|د\.?[إا]\.?|دراهم|درهم|ر\.?\s?س\.?|ريال/iu;

export const hasBankAlertMoneyHint = (source: string): boolean =>
  REVIEW_MONEY_HINT.test(source) || LAUNCH_MONEY_HINT.test(source) ||
  [...source.matchAll(/(?<![A-Z])([A-Z]{3})(?![A-Z])/giu)]
    .some((match) => currencyMinorUnits(match[1]) !== null) ||
  Object.keys(CURRENCY_SYMBOL_CANDIDATES).some((symbol) => source.includes(symbol));

// Review eligibility needs financial-alert context, not merely a currency in
// a personal conversation. None of these words grants automatic import.
const GENERIC_BANK_CONTEXT = /\b(?:(?:credit|debit|covered|prepaid|charge)\s+card|card\s+(?:purchase|payment|ending|number|no\b)|(?:your|available|current)\s+(?:account|balance|credit)|bank\s+(?:alert|account|fee|transfer|statement|notification)|(?:minimum|total)\s+(?:amount\s+)?due|(?:account|a\/?c)\s+(?:ending|number|no\b)|iban|swift|sepa|upi|neft|imps|statement|paiement\s+par\s+carte|kartenzahlung|kontoauszug|compra\s+con\s+tarjeta|pagamento\s+con\s+carta|rekeningoverzicht)\b|بطاق[هة]|حساب|رصيد|كشف\s+حساب|فاتور[هة]/iu;

export const hasGenericBankAlertContext = (source: string, sender = ''): boolean =>
  GENERIC_BANK_CONTEXT.test(source) || detectLaunchMarketFromSender(sender) !== null ||
  hasUniversalInstitutionSender(sender);

/** Generic evidence augments misses in every country; it is always review-only. */
export const inspectGenericBankEventForReview = (
  source: string,
  sender = '',
): UniversalBankEvent | null => {
  if (!hasGenericBankAlertContext(source, sender)) return null;
  const event = inspectUniversalBankEvent(source, { sender });
  if (event.decision !== 'review') return null;
  if (event.status === 'unknown' && event.family === 'unknown' &&
    event.instrument.evidence !== 'explicit') return null;
  return event;
};

export interface LaunchAlertSession {
  inspect(source: string, sender: string): UniversalAlertReview | null;
  interpret(
    source: string,
    sender: string,
    inspection?: UniversalAlertReview | null,
    forcedMarket?: string,
  ): Extract<BankAlertInterpretation, { outcome: 'parsed' }> | null;
  parse(
    source: string,
    sender: string,
    inspection?: UniversalAlertReview | null,
    forcedMarket?: string,
  ): ParsedSms | null;
  detectedMarket(): 'AE' | 'SA' | null;
}

/**
 * One ordered capture session's launch-parser policy.
 *
 * Keeping routing, global-issuer refusal and the single Gulf-market lock here
 * lets the phone scanner and the private corpus audit execute exactly the same
 * decision. The session is intentionally stateful: once a corpus establishes
 * UAE or Saudi, a conflicting alert cannot silently switch money systems.
 */
export const createLaunchAlertSession = ({
  overrides,
  regionHint = null,
  pinnedCurrency = pinnedLedgerCurrencyCode(),
  activeMarket = getActiveMarket().id,
}: {
  overrides: Record<string, CategoryId>;
  regionHint?: string | null;
  pinnedCurrency?: string | null;
  activeMarket?: string;
}): LaunchAlertSession => {
  let sessionMarket: 'AE' | 'SA' | null =
    pinnedCurrency === 'AED' ? 'AE' : pinnedCurrency === 'SAR' ? 'SA' : null;
  let detected: 'AE' | 'SA' | null = null;

  const inspect = (source: string, sender: string): UniversalAlertReview | null => {
    if (!REVIEW_MONEY_HINT.test(source)) return null;
    // A launch-tested issuer can quote any foreign transaction currency. Its
    // exact sender evidence already outranks that currency, and the universal
    // result cannot change the launch parser's decision. Avoid walking every
    // worldwide institution grammar for the common UAE/Saudi foreign-card
    // path; unknown and overlapping senders still take the full safe route.
    if (detectLaunchMarketFromSender(sender) && !hasUniversalInstitutionSender(sender)) return null;
    try {
      return inspectUniversalAlert({ source, sender, regionHint });
    } catch {
      return null;
    }
  };

  const interpret = (
    source: string,
    sender: string,
    inspection: UniversalAlertReview | null = null,
    forcedMarket?: string,
  ): Extract<BankAlertInterpretation, { outcome: 'parsed' }> | null => {
    if (pinnedCurrency && pinnedCurrency !== 'AED' && pinnedCurrency !== 'SAR') return null;
    // Most phone inbox rows are ordinary conversations, OTP-free service
    // notices, delivery updates, etc. On an AED/SAR ledger the old path still
    // ran the full launch-bank grammar over every one of them because the
    // active market supplied a default even when the message carried no money
    // or banking evidence. During a 10k-message history import that is a large
    // amount of pure CPU work. Fail fast only when BOTH broad evidence gates
    // are absent. Known launch/global institution senders remain eligible via
    // hasGenericBankAlertContext even when an unusual template omits currency.
    const moneyHint = hasBankAlertMoneyHint(source);
    if (!moneyHint && !hasGenericBankAlertContext(source, sender)) return null;
    if (
      inspection?.route.decision === 'single' &&
      inspection.route.market !== 'AE' &&
      inspection.route.market !== 'SA'
    ) return null;
    const routed = forcedMarket === 'AE' || forcedMarket === 'SA'
      ? forcedMarket
      : inspection?.route.decision === 'single' &&
          (inspection.route.market === 'AE' || inspection.route.market === 'SA')
        ? inspection.route.market
        : detectLaunchMarketFromAlert(source, sender);
    if (moneyHint && !routed) return null;
    const desired = routed ?? sessionMarket ?? activeMarket;
    if (desired !== 'AE' && desired !== 'SA') return null;
    if (sessionMarket && desired !== sessionMarket) return null;
    const interpretation = interpretBankAlert({
      source,
      sender,
      market: desired,
      overrides,
    });
    const result = interpretation.outcome === 'parsed' ? interpretation : null;
    if (result && routed) {
      sessionMarket ??= routed;
      detected = routed;
    }
    return result;
  };

  const parse = (
    source: string,
    sender: string,
    inspection: UniversalAlertReview | null = null,
    forcedMarket?: string,
  ): ParsedSms | null => interpret(source, sender, inspection, forcedMarket)?.parsed ?? null;

  return { inspect, interpret, parse, detectedMarket: () => detected };
};

/**
 * Manual paste uses the same money and semantic policy as capture. Pasted
 * text supplies no authenticated sender: body mentions may route an alert,
 * but never manufacture the issuer evidence needed for global review.
 * Retain the batch parser's bilingual-restatement deduplication.
 */
export const parsePastedBankAlerts = (
  text: string,
  overrides: Record<string, CategoryId>,
  onRefused?: (source: string) => void,
): ParsedSms[] => {
  const session = createLaunchAlertSession({ overrides });
  return parseSmsBatch(text, overrides, (source) => {
    const parsed = session.parse(source, '', session.inspect(source, ''));
    if (!parsed) onRefused?.(source);
    return parsed;
  });
};
