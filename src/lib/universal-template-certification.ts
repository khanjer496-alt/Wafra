import type { UniversalMarket } from '@/lib/alert-market-pack-types';
import { alertMarketPack } from '@/lib/alert-market-packs';
import { assessUniversalEventConfidence } from '@/lib/universal-confidence';
import type { UniversalBankEvent } from '@/lib/universal-types';

export type UniversalTemplateCertificationDecision =
  | 'automatic'
  | 'semantic-generalized'
  | 'review'
  | 'never-post'
  | 'adapter-required';

export interface UniversalTemplateCertificationInput {
  market: UniversalMarket;
  institution: string | null;
  source: string;
  event: UniversalBankEvent;
  rail?: string | null;
  /**
   * Gold certification never needs this. Green semantic generalization may be
   * enabled only by a caller that has independently proven the installed app
   * identity (trusted package or verified Play finance app). SMS sender ids and
   * user-learned packages must leave this false.
   */
  allowSemanticGeneralization?: boolean;
}

export interface UniversalTemplateCertification {
  decision: UniversalTemplateCertificationDecision;
  /** Stable code-owned grammar id. Never derived from source text. */
  templateId: string | null;
  reason:
    | 'certified-template'
    | 'non-posting'
    | 'non-transaction-fact'
    | 'dedicated-adapter'
    | 'low-confidence'
    | 'unidentified-institution'
    | 'semantic-generalization'
    | 'semantic-guard-failed'
    | 'uncertified-template';
}

interface CertificationRule {
  id: string;
  market: UniversalMarket;
  institution: string;
  family: UniversalBankEvent['family'];
  direction: 'debit' | 'credit' | 'either';
  source: RegExp;
}

/**
 * Public-evidence certification registry.
 *
 * These rules are intentionally narrower than the semantic parser. Passing a
 * rule means the event shape has independent official/public fixture coverage;
 * it does NOT mean arbitrary alerts from that bank or country are automatic.
 * Keep this registry aligned with scripts/test/universal-template-certification.test.js.
 */
const CERTIFIED_RULES: readonly CertificationRule[] = [
  // United States
  { id: 'us-chase-purchase-v1', market: 'US', institution: 'jpmorgan-chase', family: 'purchase', direction: 'debit',
    source: /\b(?:card\s+charge|card\s+purchase|purchase)\b[\s\S]{0,120}\b(?:charged|debited|posted)\b/iu },
  { id: 'us-chase-refund-v1', market: 'US', institution: 'jpmorgan-chase', family: 'refund', direction: 'credit',
    source: /\brefund\b[\s\S]{0,120}\b(?:credited|posted|received)\b/iu },
  { id: 'us-bofa-purchase-v1', market: 'US', institution: 'bank-of-america', family: 'purchase', direction: 'debit',
    source: /\b(?:debit\s+card|card)\b[\s\S]{0,100}\b(?:charged|purchase|debited)\b|\bcard\s+purchase\b/iu },
  { id: 'us-bofa-direct-deposit-v1', market: 'US', institution: 'bank-of-america', family: 'transfer', direction: 'credit',
    source: /\bdirect\s+deposit\b[\s\S]{0,120}\b(?:credited|posted|deposited)\b/iu },
  { id: 'us-bofa-incoming-wire-v1', market: 'US', institution: 'bank-of-america', family: 'transfer', direction: 'credit',
    source: /\bincoming\s+wire(?:\s+transfer)?\b[\s\S]{0,120}\b(?:credited|posted|received)\b/iu },
  { id: 'us-bofa-ach-debit-v1', market: 'US', institution: 'bank-of-america', family: 'transfer', direction: 'debit',
    source: /\bach\s+debit\b[\s\S]{0,120}\b(?:debited|posted|completed)\b/iu },
  { id: 'us-bofa-zelle-paid-v1', market: 'US', institution: 'bank-of-america', family: 'transfer', direction: 'debit',
    source: /\bzelle\b[\s\S]{0,140}\b(?:is\s+paid|paid|sent|completed)\b/iu },
  { id: 'us-wells-card-purchase-v1', market: 'US', institution: 'wells-fargo', family: 'purchase', direction: 'debit',
    source: /\b(?:online\s+)?card\s+purchase\b[\s\S]{0,120}\b(?:charged|debited|posted)\b/iu },
  { id: 'us-wells-deposit-posted-v1', market: 'US', institution: 'wells-fargo', family: 'transfer', direction: 'credit',
    source: /\bdeposit\s+posted\b[\s\S]{0,120}\b(?:to|into)\s+(?:your\s+)?account\b/iu },
  { id: 'us-wells-atm-v1', market: 'US', institution: 'wells-fargo', family: 'cash-withdrawal', direction: 'debit',
    source: /\batm\s+(?:cash\s+)?withdrawal\b[\s\S]{0,120}\b(?:debited|withdrawn|posted)\b/iu },
  { id: 'us-citi-purchase-v1', market: 'US', institution: 'citi-us', family: 'purchase', direction: 'debit',
    source: /\b(?:credit\s+)?card\s+purchase\b[\s\S]{0,120}\b(?:charged|debited|posted)\b/iu },
  { id: 'us-citi-direct-deposit-v1', market: 'US', institution: 'citi-us', family: 'transfer', direction: 'credit',
    source: /\bdirect\s+deposit\b[\s\S]{0,120}\b(?:credited|posted|deposited)\b/iu },
  { id: 'us-discover-purchase-v1', market: 'US', institution: 'discover-card-us', family: 'purchase', direction: 'debit',
    source: /\bpurchase\b[\s\S]{0,120}\b(?:charged|debited|posted)\b/iu },

  // Existing worldwide trusted-package paths retained under explicit grammar certification.
  { id: 'fr-bnp-card-purchase-v1', market: 'FR', institution: 'bnp-paribas-fr', family: 'purchase', direction: 'debit',
    source: /paiement\s+par\s+carte[\s\S]{0,120}(?:d[eé]bit[eé]|pay[eé])/iu },
  { id: 'gb-barclays-card-purchase-v1', market: 'GB', institution: 'barclays-uk', family: 'purchase', direction: 'debit',
    source: /card(?:\s+(?:payment|purchase)[\s\S]{0,140}(?:charged|paid|debited)|[\s\S]{0,40}?(?:was\s+)?charged)/iu },
  { id: 'in-hdfc-card-purchase-v1', market: 'IN', institution: 'hdfc-bank', family: 'purchase', direction: 'debit',
    source: /(?:\b(?:card\s+purchase|purchase)\b[\s\S]{0,140}\b(?:debited|charged)\b|\b(?:debited|charged)\b[\s\S]{0,140}\bpurchase\b)/iu },

  // Second-wave markets. Each rule mirrors one issuer-documented alert family
  // reconstructed in scripts/test/fixtures/public-alert-evidence.js
  // (standard-derived, fictional values; not consented real alerts). Canada has
  // no certified rule: its only documented family is Interac Request Money,
  // which is lifecycle evidence and never posts.
  //
  // These documented templates are headings ("compra", "cargo recurrente",
  // "PayNow outgoing") rather than completion statements, and the same
  // headings open holds, requests, reversals, fraud questions, promotions and
  // limit changes. Each rule is therefore anchored to the WHOLE documented
  // template (case-sensitive upper-case counterparty, nothing after it), and it
  // still applies only to an event the semantic layer independently proved
  // posted. Today only the ANZ Osko credit carries its own completion verb;
  // the Itaú, Banorte and DBS headings are not posted evidence, so their rules
  // stay inert (Review) until a template-specific posting adapter exists.
  { id: 'au-anz-osko-credit-v1', market: 'AU', institution: 'anz-australia', family: 'transfer', direction: 'credit',
    source: /^ANZ: AUD \d{1,3}(?:,\d{3})*\.\d{2} received via Osko into your account\.?$/u },
  { id: 'br-itau-card-purchase-v1', market: 'BR', institution: 'itau-brasil', family: 'purchase', direction: 'debit',
    source: /^Ita[uú]: compra com cart[aã]o (?:BRL|R\$) ?\d{1,3}(?:\.\d{3})*,\d{2} em [A-Z0-9][A-Z0-9 &'.*/-]{0,60}[A-Z0-9]\.?$/u },
  { id: 'mx-banorte-purchase-v1', market: 'MX', institution: 'banorte-mexico', family: 'purchase', direction: 'debit',
    source: /^Banorte: \d{2}\/\d{2} compra (?:MXN|\$) ?\d{1,3}(?:,\d{3})*\.\d{2} [A-Z0-9][A-Z0-9 &'.*/-]{0,60}\. Tarjeta terminaci[oó]n \d{4}\.?$/u },
  { id: 'mx-banorte-recurring-v1', market: 'MX', institution: 'banorte-mexico', family: 'recurring-payment', direction: 'debit',
    source: /^Banorte: \d{2}\/\d{2} cargo recurrente (?:MXN|\$) ?\d{1,3}(?:,\d{3})*\.\d{2} [A-Z0-9][A-Z0-9 &'.*/-]{0,60}\. Tarjeta terminaci[oó]n \d{4}\.?$/u },
  { id: 'mx-banorte-refund-v1', market: 'MX', institution: 'banorte-mexico', family: 'refund', direction: 'credit',
    source: /^Banorte: \d{2}\/\d{2} devoluci[oó]n (?:MXN|\$) ?\d{1,3}(?:,\d{3})*\.\d{2} [A-Z0-9][A-Z0-9 &'.*/-]{0,60}\. Tarjeta terminaci[oó]n \d{4}\.?$/u },
  { id: 'sg-dbs-paynow-outgoing-v1', market: 'SG', institution: 'dbs-singapore', family: 'transfer', direction: 'debit',
    source: /^DBS(?: Bank)?: PayNow outgoing SGD \d{1,3}(?:,\d{3})*\.\d{2} to [A-Z0-9][A-Z0-9 &'.*/-]{0,60}[A-Z0-9]\.?$/u },
] as const;

const NON_TRANSACTION_FAMILIES = new Set<UniversalBankEvent['family']>([
  'statement', 'balance', 'authentication', 'bill',
]);

const GENERALIZABLE_FAMILIES = new Set<UniversalBankEvent['family']>([
  'purchase', 'refund', 'cash-withdrawal', 'fee', 'utility', 'recurring-payment', 'transfer',
]);

const familyDirectionIsSafe = (event: UniversalBankEvent): boolean => {
  if (event.family === 'refund') return event.direction === 'credit';
  if (event.family === 'transfer') return event.direction === 'debit' || event.direction === 'credit';
  return ['purchase', 'cash-withdrawal', 'fee', 'utility', 'recurring-payment'].includes(event.family) &&
    event.direction === 'debit';
};

/**
 * Green-path invariants for unseen wording from a strongly verified app.
 *
 * This deliberately uses only semantic facts the deterministic parser already
 * grounded. No regex template, merchant name, or TypeSafe result can satisfy a
 * missing accounting invariant. Unknown/foreign currency and multi-principal
 * alerts remain review-first even when the institution itself is trusted.
 */
const semanticGeneralizationIsSafe = (
  input: UniversalTemplateCertificationInput,
  confidence: ReturnType<typeof assessUniversalEventConfidence>,
): boolean => {
  const { event } = input;
  if (!input.allowSemanticGeneralization || !GENERALIZABLE_FAMILIES.has(event.family) ||
      !confidence.automationSafe || !familyDirectionIsSafe(event) ||
      event.amount.evidence !== 'explicit' || !event.amount.value || event.amount.alternatives.length !== 0 ||
      event.amount.spans.length !== 1) return false;
  const principalRoles = event.family === 'fee'
    ? new Set(['transaction', 'fee'])
    : new Set(['transaction']);
  const principal = event.observations.filter((observation) => principalRoles.has(observation.role));
  if (principal.length !== 1 || principal[0].field.evidence !== 'explicit' ||
      !principal[0].field.value || principal[0].field.alternatives.length !== 0) return false;
  const pack = alertMarketPack(input.market);
  if (!pack.currencies.some((currency) => currency === event.amount.value!.currency)) return false;
  return !event.issues.some((issue) => [
    'posting-status-unresolved', 'direction-unresolved', 'direction-conflict',
    'multiple-event-adapter-required', 'settlement-adapter-required', 'amount-role-unresolved',
  ].includes(issue));
};

const normalizeSource = (source: string): string =>
  source.slice(0, 4096).normalize('NFKC').replace(/\s+/gu, ' ').trim();

/**
 * Decide whether a semantic event has earned automatic treatment.
 *
 * The caller must separately prove capture-source trust (trusted package,
 * verified installed finance app, etc.). This function deliberately knows
 * nothing about Android package identity and never stores source text.
 */
export function certifyUniversalTemplate(
  input: UniversalTemplateCertificationInput,
): UniversalTemplateCertification {
  const { event } = input;
  if (event.status !== 'posted') {
    return { decision: 'never-post', templateId: null, reason: 'non-posting' };
  }
  if (NON_TRANSACTION_FAMILIES.has(event.family)) {
    return { decision: 'never-post', templateId: null, reason: 'non-transaction-fact' };
  }
  if (event.family === 'card-payment') {
    return { decision: 'adapter-required', templateId: null, reason: 'dedicated-adapter' };
  }
  if (!input.institution) {
    return { decision: 'review', templateId: null, reason: 'unidentified-institution' };
  }
  const confidence = assessUniversalEventConfidence(event);
  if (!confidence.automationSafe) {
    return { decision: 'review', templateId: null, reason: 'low-confidence' };
  }
  const source = normalizeSource(input.source);
  const match = CERTIFIED_RULES.find((rule) =>
    rule.market === input.market &&
    rule.institution === input.institution &&
    rule.family === event.family &&
    (rule.direction === 'either' || rule.direction === event.direction) &&
    rule.source.test(source));
  if (!match) {
    if (semanticGeneralizationIsSafe(input, confidence)) {
      return { decision: 'semantic-generalized', templateId: null, reason: 'semantic-generalization' };
    }
    return {
      decision: 'review', templateId: null,
      reason: input.allowSemanticGeneralization ? 'semantic-guard-failed' : 'uncertified-template',
    };
  }
  return { decision: 'automatic', templateId: match.id, reason: 'certified-template' };
}

/** Stable ids only; useful for diagnostics/contracts without exposing patterns. */
export const certifiedUniversalTemplateIds = (): string[] =>
  CERTIFIED_RULES.map((rule) => rule.id);
