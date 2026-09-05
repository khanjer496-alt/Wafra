import { inspectAlertDraft, type AlertDraft, type MoneyCandidate, type SourceSpan } from '@/lib/alert-draft';
import { CURRENCY_SYMBOL_CANDIDATES } from '@/lib/currency-metadata';
import {
  missingUniversalField,
  type UniversalField,
  type UniversalMoney,
  type UniversalMoneyObservation,
  type UniversalMoneyRole,
  type UniversalParseContext,
} from '@/lib/universal-types';

export interface UniversalMoneyExtraction {
  /** Ephemeral inspection only; never attach this draft to a persisted event. */
  draft: AlertDraft;
  observations: UniversalMoneyObservation[];
  amount: UniversalField<UniversalMoney>;
  statementTotal: UniversalField<UniversalMoney>;
  minimumDue: UniversalField<UniversalMoney>;
  balance: UniversalField<UniversalMoney>;
  creditLimit: UniversalField<UniversalMoney>;
  /** Full owning clause, including posting language. Exact money spans live on fields. */
  transactionSpan: SourceSpan | null;
}

// Long labels consume their component words: "minimum payment due" must not
// leave a second, stronger-looking "payment" or "amount due" match behind.
const LABEL = new RegExp([
  String.raw`(?<minimum>\bmin(?:imum)?\.?\s+(?:(?:amount|amt|payment)\s+)?due\b|\bminimum\s+payment\b|\bpago\s+mínimo\b|(?<![\p{L}\p{M}\p{N}_])(?:paiement\s+minimum|न्यूनतम\s+देय\s+राशि)(?![\p{L}\p{M}\p{N}_])|الحد\s+(?:الادنى|الأدنى)\s+(?:المستحق|للدفع|للسداد))`,
  String.raw`(?<total>\b(?:statement\s+(?:total|balance|amount)|closing\s+balance|total\s+(?:(?:amount|amt)\s+)?due|total\s+outstanding(?:\s+balance)?|new\s+balance|saldo\s+total\s+del\s+estado)\b|(?<![\p{L}\p{M}\p{N}_])(?:total\s+à\s+payer|कुल\s+देय\s+राशि)(?![\p{L}\p{M}\p{N}_])|(?:اجمالي|إجمالي)\s+(?:المبلغ\s+المستحق|مبلغ\s+الكشف))`,
  String.raw`(?<limit>\b(?:(?:available|avl|avail)\.?\s+(?:credit|cr\.?)\s+limit|(?:available|credit|avl|avail)\.?\s+limit)\b|الحد\s+(?:المتاح|الائتماني))`,
  String.raw`(?<balance>\b(?:(?:available|current|avl|avail)\.?\s+)?bal(?:ance)?\b|\b(?:solde(?:\s+disponible)?|kontostand|saldo|(?:kullanılabilir\s+)?bakiye)\b|الرصيد(?:\s+(?:الحالي|المتاح))?|(?:उपलब्ध\s+)?शेष\s+राशि|(?:利用可能)?残高|(?:可用)?余额)`,
  String.raw`(?<bill>\b(?:bill(?:\s+amount)?\s+(?:due|of)|amount\s+due|payment\s+due|bill\s+amount|bill\s+for|montant\s+à\s+payer|importo\s+da\s+pagare)\b|مبلغ\s+الفاتورة|المبلغ\s+المستحق|देय\s+राशि)`,
  String.raw`(?<fee>\b(?:fee|fees|commission|service\s+charge)\b|رسوم|عمولة)`,
  String.raw`(?<transaction>\b(?:purchase|purchased|spend|spent|paid|charged|debited|credited|received|sent|withdrawn|withdrawal|deposited|deposit|refund|reversal|transfer(?:red)?|payment|amount|paiement|débité|crédité|remboursement|kartenzahlung|abonnementzahlung|belastet|gutgeschrieben|compra|reembolso|abonado|pagamento|pinbetaling|kaartbetaling|betaling)\b|(?<![\p{L}\p{N}])(?:alışveriş|ödemeniz)(?![\p{L}\p{N}])|شراء|خصم|إيداع|ايداع|تحويل|استرداد|دفع|भुगतान|रिफंड\s+राशि|(?<![\p{L}\p{M}\p{N}_])(?:überweisung|overboeking|acquisto|rimborso|accreditato|cargados?|debitados?|रिफंड)(?![\p{L}\p{M}\p{N}_])|(?:利用)?金額|金额|退回|退款|引き落とされました|扣款)`,
].join('|'), 'giu');

interface OwnedCandidate {
  candidate: MoneyCandidate;
  role: UniversalMoneyRole;
  labelStart: number | null;
  span: SourceSpan;
  aggregate: boolean;
}

// Public CommBank notifications pair a purchase with "So far this month
// you've spent ...". The latter is a period/category statistic, never another
// posting or a fallback principal. Keep the observed value for inspection.
const AGGREGATE_PREFIX = /\b(?:(?:so far(?:\s+(?:this|the)\s+(?:day|week|month|year))?|(?:this|last)\s+(?:week|month|year)|(?:month|year|week)[ -]to[ -]date|(?:monthly|weekly|yearly|annual|cumulative|category)\s+(?:spend(?:ing)?|spends|expenditure)(?:\s+total)?)\b)[^.!?;\n]*$/iu;

function aggregateAmount(prefix: string, suffix: string, label: { role: UniversalMoneyRole; text: string } | undefined): boolean {
  // An independently labelled purchase/fee in the same clause retains its own
  // authority; period wording must qualify spending, not merely occur nearby.
  if (label && (label.role !== 'transaction' || !/^(?:spend|spent|amount)$/i.test(label.text))) return false;
  if (AGGREGATE_PREFIX.test(prefix)) return true;
  // Postfixed period summaries: "$40 on Food so far this month". A following
  // posting verb belongs to a separate field, so cannot qualify this amount.
  return !labels(suffix).some(row => row.role === 'transaction') &&
    /^\s*(?:on\s+[^.!?;\n]+?\s+)?(?:so far(?:\s+(?:this|the)\s+(?:day|week|month|year))?|(?:this|last)\s+(?:week|month|year)|(?:month|year|week)[ -]to[ -]date)\b/iu.test(suffix);
}

const LABEL_ROLES: Record<string, UniversalMoneyRole> = {
  minimum: 'minimum-due', total: 'statement-total', limit: 'credit-limit',
  balance: 'balance', bill: 'bill-due', fee: 'fee', transaction: 'transaction',
};

function labels(text: string): { role: UniversalMoneyRole; start: number; text: string }[] {
  return [...text.matchAll(LABEL)].map((match) => ({
    role: LABEL_ROLES[Object.keys(match.groups ?? {}).find((key) => match.groups?.[key] !== undefined)!],
    start: match.index!, text: match[0],
  }));
}

/** Separators between monetary fields; decimal and domain punctuation is excluded. */
function separators(text: string): number[] {
  return [...text.matchAll(/[;\n!?。।]|[.,](?=\s|$)/g)]
    .filter((match) => match[0] !== '.' || !/\b(?:min|avl|avail|cr|dr|amt|bal)$/i.test(text.slice(0, match.index)))
    .map((match) => match.index!);
}

function ownCandidates(draft: AlertDraft, excludedRoleSpans: readonly SourceSpan[]): OwnedCandidate[] {
  const text = draft.normalizedText;
  let roleText = text;
  for (const span of excludedRoleSpans) {
    if (!Number.isInteger(span.start) || !Number.isInteger(span.end) ||
      span.start < 0 || span.end < span.start || span.end > text.length) continue;
    roleText = roleText.slice(0, span.start) + ' '.repeat(span.end - span.start) + roleText.slice(span.end);
  }
  const owned: OwnedCandidate[] = [];
  draft.candidates.forEach((candidate, index) => {
    const previousEnd = draft.candidates[index - 1]?.span.end ?? 0;
    const nextStart = draft.candidates[index + 1]?.span.start ?? text.length;
    const before = text.slice(previousEnd, candidate.span.start);
    let prefixStart = previousEnd + ((separators(before).at(-1) ?? -1) + 1);
    let preceding = labels(roleText.slice(prefixStart, candidate.span.start)).at(-1);
    if (!preceding) {
      const prior = labels(roleText.slice(previousEnd, candidate.span.start)).at(-1);
      if (prior) {
        const start = previousEnd + prior.start;
        const tail = roleText.slice(start + prior.text.length, candidate.span.start);
        const lineStart = Math.max(previousEnd, roleText.lastIndexOf('\n', start - 1) + 1);
        // Printed field layouts put a label alone above its value. Neither a
        // merchant containing BALANCE nor prose after a label grants ownership.
        if (/\n/.test(tail) && /^[\s:;,.\-]*$/.test(tail) &&
            /^[\s:;,.\-]*$/.test(roleText.slice(lineStart, start))) {
          prefixStart = lineStart;
          preceding = { ...prior, start: start - lineStart };
        }
      }
    }
    const after = text.slice(candidate.span.end, nextStart);
    const suffixEnd = candidate.span.end + (separators(after)[0] ?? after.length);
    const following = labels(roleText.slice(candidate.span.end, suffixEnd))[0];
    const label = preceding ?? following;
    let role = label?.role ?? 'unknown';
    // In a statement, an explicitly labelled "amount due" is the total;
    // a bare amount or a minimum is never promoted to a statement total.
    if (role === 'bill-due' && label && !/\bbill\b|فاتورة/iu.test(label.text) &&
        /\b(?:statement|mini\s+stmt)\b/iu.test(roleText.slice(0, candidate.span.start))) {
      role = 'statement-total';
    }
    if (!label && owned.at(-1)?.role === 'transaction' && /^\s*(?:and|plus|,|&)?\s*$/i.test(before)) {
      role = 'transaction';
    }
    let labelStart = preceding ? prefixStart + preceding.start : null;
    const aggregate = aggregateAmount(roleText.slice(prefixStart, candidate.span.start),
      roleText.slice(candidate.span.end, suffixEnd), label);
    if (aggregate) {
      role = 'unknown';
      const marker = roleText.slice(prefixStart, candidate.span.start).match(AGGREGATE_PREFIX);
      if (marker) labelStart = prefixStart + marker.index!;
    }
    owned.push({ candidate, role, labelStart, aggregate,
      span: { start: previousEnd > 0 ? labelStart ?? prefixStart : prefixStart, end: suffixEnd } });
  });
  // A second labelled amount is an independent field even without punctuation.
  owned.forEach((item, index) => {
    const next = owned[index + 1];
    if (next) item.span.end = Math.min(item.span.end, next.labelStart ?? next.candidate.span.start);
    while (item.span.start < item.span.end && /\s/.test(text[item.span.start])) item.span.start++;
    while (item.span.end > item.span.start && /\s/.test(text[item.span.end - 1])) item.span.end--;
  });
  return owned;
}

/**
 * Validate grouping that the underlying exact parser otherwise strips. This
 * performs no conversion or amount arithmetic; inspectAlertDraft remains the
 * sole owner of currency exponents and numerical interpretations.
 */
function completeNumericToken(candidate: MoneyCandidate, text: string): boolean {
  const source = text.slice(candidate.span.start, candidate.span.end);
  const match = source.match(/[+-]?(?:\d[\d.,٫'’ ]*\d|\d)/);
  if (!match) return false;
  const start = candidate.span.start + match.index!;
  const end = start + match[0].length;
  const before = text[start - 1] ?? '';
  const after = text[end] ?? '';
  if (/[xX*•·/\\]/.test(before) || /[xX*•·/\\]/.test(after)) return false;
  // A suffix match must not recover the visible tail of a masked or malformed token.
  if (start === candidate.span.start && /[.,٫'’+\-]/.test(before)) return false;
  if (end === candidate.span.end && /[+\-'’]/.test(after)) return false;
  if (end === candidate.span.end && /^[ \t]+\d/.test(text.slice(end))) return false;
  if (start === candidate.span.start && /\d[ \t]+$/.test(text.slice(0, start))) return false;
  if (end === candidate.span.end && /[.,٫'’]/.test(after) && /[\d.,٫'’]/.test(text[end + 1] ?? '')) return false;
  const numeric = match[0].replace(/^[+-]/, '').replace(/’/g, "'");
  if (!/[ ']/.test(numeric)) return true;
  const firstPunctuation = numeric.search(/[.,٫]/);
  const integer = firstPunctuation < 0 ? numeric : numeric.slice(0, firstPunctuation);
  const remainder = firstPunctuation < 0 ? '' : numeric.slice(firstPunctuation);
  if (/[ ']/.test(remainder) || (integer.includes(' ') && integer.includes("'"))) return false;
  const separator = integer.includes("'") ? "'" : ' ';
  const western = new RegExp(`^\\d{1,3}(?:${separator}\\d{3})+$`);
  const indian = new RegExp(`^\\d{1,2}(?:${separator}\\d{2})*${separator}\\d{3}$`);
  return western.test(integer) || indian.test(integer);
}

function candidateField(candidate: MoneyCandidate, text: string): UniversalField<UniversalMoney> {
  if (!completeNumericToken(candidate, text)) {
    return { ...missingUniversalField<UniversalMoney>('malformed-money-token'), spans: [candidate.span] };
  }
  const alternatives = candidate.interpretations.map(({ currency, minorUnits, exponent }) => ({ currency, minorUnits, exponent }));
  if (candidate.ambiguities.length > 0 || alternatives.length !== 1) {
    return { value: null, evidence: 'ambiguous', spans: [candidate.span], alternatives, issues: candidate.ambiguities };
  }
  return { value: alternatives[0], evidence: 'explicit', spans: [candidate.span], alternatives: [], issues: [] };
}

function selectFields(rows: UniversalMoneyObservation[]): UniversalField<UniversalMoney> {
  if (!rows.length) return missingUniversalField();
  if (rows.length === 1) return rows[0].field;
  return {
    value: null, evidence: 'ambiguous', spans: rows.flatMap((row) => row.field.spans),
    alternatives: rows.flatMap((row) => row.field.value ? [row.field.value] : row.field.alternatives),
    issues: [...new Set(['multiple-money-fields', ...rows.flatMap((row) => row.field.issues)])],
  };
}

/** Same draft contract and source coordinates, with bounded evidenced tokens. */
export function inspectUniversalMoneyDraft(source: string, context: UniversalParseContext = {}): AlertDraft {
  // Existing unique KSh metadata, matched case-insensitively by the alias path.
  const currencyAliases = { KSh: CURRENCY_SYMBOL_CANDIDATES.KSh, ...context.currencyAliases };
  const draft = inspectAlertDraft(source, { currencyAliases });
  if (source.length > 4096) return draft;
  const candidates = [...draft.candidates];
  // The frozen Japanese renewal places an ISO amount immediately before で.
  // Recover only that evidenced particle boundary, never arbitrary letters.
  // The whole numeric token is re-parsed by the existing exact money parser;
  // malformed grouping or embedded Latin IDs cannot yield a recovered tail.
  const particleMoney = /(?:(?<![\p{L}\p{N}_])|(?<=に))([A-Za-z]{3}[ \t]*[+-]?\d(?:[\d.,٫'’ \t]*\d)?)(?=で)/gu;
  for (const match of draft.normalizedText.matchAll(particleMoney)) {
    const start = match.index!;
    const end = start + match[0].length;
    if (candidates.some(row => start < row.span.end && end > row.span.start)) continue;
    const tokenDraft = inspectAlertDraft(match[0], { currencyAliases });
    const candidate = tokenDraft.candidates[0];
    if (tokenDraft.candidates.length !== 1 || candidate.evidence !== 'iso-code' ||
      candidate.span.start !== 0 || candidate.span.end !== match[0].length ||
      !completeNumericToken(candidate, match[0])) continue;
    candidates.push({ ...candidate, sourceText: source.slice(start, end), span: { start, end } });
  }
  candidates.sort((a, b) => a.span.start - b.span.start);
  const reasons = draft.reasons.filter(reason => reason !== 'no-grounded-money' || !candidates.length);
  if (candidates.some(candidate => candidate.ambiguities.length > 0)) reasons.push('ambiguous-money');
  if (candidates.length > 16) reasons.push('too-many-money-candidates');
  return { ...draft, candidates: candidates.slice(0, 16), reasons: [...new Set(reasons)],
    decision: reasons.some(reason => reason !== 'ambiguous-money') ? 'refuse' : 'review' };
}

/**
 * Direct callers must exclude known merchant/name spans from role discovery:
 * names such as NEW BALANCE are not statement labels. The public orchestration
 * supplies these spans; this adapter alone cannot resolve that name ambiguity.
 * Exclusions affect labels only, never money interpretations or source spans.
 * excludedMoneySpans separately removes numeric collisions with known account,
 * reference and date fields. The returned ephemeral draft stays unfiltered.
 */
export function extractUniversalMoney(
  source: string,
  context: UniversalParseContext = {},
  excludedRoleSpans: readonly SourceSpan[] = [],
  excludedMoneySpans: readonly SourceSpan[] = [],
): UniversalMoneyExtraction {
  // KSh is already a unique global symbol in currency metadata. The public
  // Safaricom excerpt spells it Ksh; the alias collector preserves source spans
  // while matching this documented symbol case-insensitively. No ledger locale
  // or new currency-symbol interpretation is introduced.
  const currencyAliases = { KSh: CURRENCY_SYMBOL_CANDIDATES.KSh, ...context.currencyAliases };
  const draft = inspectUniversalMoneyDraft(source, context);
  const candidates = draft.candidates.filter((candidate) =>
    // The alias collector accepts suffixes; identifiers such as AB250Ksh are
    // not monetary tokens. Keep the same leading boundary as global symbols.
    !(/ksh$/i.test(candidate.sourceText) && candidate.span.start > 0 &&
      /[\p{L}\p{N}]/u.test(draft.normalizedText[candidate.span.start - 1])) &&
    !excludedMoneySpans.some((span) =>
    Number.isInteger(span.start) && Number.isInteger(span.end) &&
    span.start >= 0 && span.end > span.start && span.end <= draft.normalizedText.length &&
    candidate.span.start < span.end && candidate.span.end > span.start));
  const owned = ownCandidates({ ...draft, candidates }, excludedRoleSpans);
  const observations = owned.map(({ candidate, role, aggregate }) => {
    const field = candidateField(candidate, draft.normalizedText);
    if (aggregate) field.issues = [...field.issues, 'aggregate-money-field'];
    return { role, field };
  });
  const withRole = (role: UniversalMoneyRole) => observations.filter((row, index) => row.role === role && !owned[index].aggregate);
  const transactions = withRole('transaction');
  const fees = withRole('fee');
  // A fee is the principal only when every other amount has a known
  // informational role. Unclassified money may be the actual cash movement.
  const unknown = withRole('unknown');
  const billDues = withRole('bill-due');
  const main = transactions.length ? transactions
    : fees.length ? [...fees, ...unknown] : billDues.length ? billDues : unknown;
  let amount = selectFields(main);
  if (main.some((row) => row.role === 'unknown')) {
    amount = { ...amount, issues: [...new Set([...amount.issues, 'amount-role-unresolved'])] };
  }
  let transactionSpan = main.length === 1 ? owned[observations.indexOf(main[0])].span : null;
  if (amount.value && /^-?0+$/.test(amount.value.minorUnits)) {
    amount = { ...missingUniversalField<UniversalMoney>('zero-transaction-amount'), spans: amount.spans, alternatives: [amount.value] };
    transactionSpan = null;
  }
  // The global draft deliberately retains every safety signal. A boilerplate
  // OTP sentence is not evidence that the separate purchase clause is an OTP.
  const scopedAuthentication = draft.reasons.includes('authentication-or-otp') &&
    (transactionSpan === null || inspectAlertDraft(
      source.slice(transactionSpan.start, transactionSpan.end),
      { currencyAliases },
    ).reasons.includes('authentication-or-otp'));
  const refusal = draft.reasons.includes('input-too-long') ? 'input-too-long'
    : scopedAuthentication ? 'authentication-or-otp' : undefined;
  if (refusal) { amount = missingUniversalField(refusal); transactionSpan = null; }
  return {
    draft, observations, amount, transactionSpan,
    statementTotal: selectFields(withRole('statement-total')), minimumDue: selectFields(withRole('minimum-due')),
    balance: selectFields(withRole('balance')), creditLimit: selectFields(withRole('credit-limit')),
  };
}
