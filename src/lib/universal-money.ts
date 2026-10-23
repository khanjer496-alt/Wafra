import { inspectAlertDraft, type AlertDraft, type CurrencyAliasMap, type MoneyCandidate, type SourceSpan } from '@/lib/alert-draft';
import { alertMarketPack } from '@/lib/alert-market-packs';
import { CURRENCY_SYMBOL_CANDIDATES, type CurrencyCode } from '@/lib/currency-metadata';
import { extractUniversalFields } from '@/lib/universal-fields';
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

// Literal source units, not aliases inferred from the person's ledger locale.
// Public Tanzanian wallet receipts use Tsh for TZS, alongside separately
// labelled transfer principal, charges and balance fields (issue #524).
const SOURCE_UNIT_ALIASES: CurrencyAliasMap = {
  KSh: CURRENCY_SYMBOL_CANDIDATES.KSh,
  TSh: ['TZS'],
};

const sourceCurrencyAliases = (context: UniversalParseContext): CurrencyAliasMap => {
  const market = context.moneyMarket ?? context.market;
  return { ...SOURCE_UNIT_ALIASES, ...(market ? alertMarketPack(market).currencyAliases : {}),
    ...context.currencyAliases };
};

// Long labels consume their component words: "minimum payment due" must not
// leave a second, stronger-looking "payment" or "amount due" match behind.
// The real "Avl. Cr.Limit" footer uses its abbreviation's dot as the word
// separator. Keep bare "CrLimit"/"CreditLimit" outside that observed alias.
const LABEL = new RegExp([
  String.raw`(?<minimum>\bpay\s+min\.|\bmin(?:imum)?(?:\s+|\.\s*)(?:(?:amount|amt|payment)\s+)?due\b|\bminimum\s+payment\b|\bpago\s+mínimo\b|(?<![\p{L}\p{M}\p{N}_])(?:paiement\s+minimum|pagamento\s+m[ií]nimo|mindestbetrag|minimumbedrag|minimalna\s+kwota|lägsta\s+belopp|minimumsbeløb|minstebeløp|minimální\s+splátka|न्यूनतम\s+देय\s+राशि)(?![\p{L}\p{M}\p{N}_])|الحد\s+(?:الادنى|الأدنى)\s+(?:المستحق|للدفع|للسداد))`,
  String.raw`(?<total>\b(?:statement\s+(?:total|balance|amount)|closing\s+balance|total\s+(?:(?:amount|amt)\s+)?due(?:\s+to\s+avoid\s+fin\.\s+charges)?|total\s+outstanding(?:\s+balance)?|new\s+balance|saldo\s+total\s+del\s+estado)\b|(?<![\p{L}\p{M}\p{N}_])(?:total\s+à\s+payer|कुल\s+देय\s+राशि)(?![\p{L}\p{M}\p{N}_])|(?:اجمالي|إجمالي)\s+(?:المبلغ\s+المستحق|مبلغ\s+الكشف))`,
  String.raw`(?<limit>\b(?:(?:available|avl|avail)\.?\s+(?:credit\s+limit|cr(?:\.?\s+|\.)limit)|(?:available|credit|avl|avail)\.?\s+(?:limit|lmt)|available\s+credit|credit\s+available)\b|(?<![\p{L}\p{M}\p{N}_])(?:(?:verfügbarer\s+)?kreditrahmen|plafond(?:\s+(?:disponível|disponivel|de\s+paiement\s+restant))?|l[ií]mite\s+disponible|disponibilit[àa](?:\s+residua)?|tillgänglig\s+kredit|tilgjengelig\s+kreditt|dostępny\s+limit|volný\s+limit(?:\s+karty)?|beschikbare\s+limiet|rådighed(?:\s+på\s+kortet)?|disponibelt(?:\s+belopp)?|disponibilní\s+zůstatek|zůstatek)(?![\p{L}\p{M}\p{N}_])|الحد\s+(?:المتاح|الائتماني))`,
  String.raw`(?<balance>\b(?:(?:available|current|avl|avail)\.?\s+)?bal(?:ance)?\b|\b(?:solde(?:\s+disponible)?|kontostand|guthaben|saldo|(?:kullanılabilir\s+)?bakiye)\b|(?<![\p{L}\p{M}\p{N}_])(?:disponib\p{L}*|beschikba\p{L}*|verf[üu]gbar\p{L}*|tillg[äa]ngl\p{L}*|tilgjengel\p{L}*)\s+\p{L}{4,10}(?=\s*:)|\bdost(?:\.|[eę]pne(?![\p{L}\p{M}\p{N}_]))|الرصيد(?:\s+(?:الحالي|المتاح|المتوفر|المتبقي))?|(?<![\p{L}\p{M}\p{N}_])(?:رصيد\s+حسابك|رصيدك)(?:\s+(?:الحالي|المتاح|المتوفر))?(?![\p{L}\p{M}\p{N}_])|(?<![\p{L}\p{M}\p{N}_])المتاح(?![\p{L}\p{M}\p{N}_])|(?:उपलब्ध\s+)?शेष\s+राशि|(?:利用可能)?残高|(?:可用)?余额)`,
  String.raw`(?<bill>\b(?:bill(?:\s+amount)?\s+(?:due|of)|amount\s+due|payment\s+due|bill\s+amount|bill\s+for|montant\s+à\s+payer|importo\s+da\s+pagare)\b|مبلغ\s+الفاتورة|المبلغ\s+المستحق|देय\s+राशि)`,
  String.raw`(?<fee>\b(?:total\s+charges|fee|fees|frais|commission|(?:service|late|finance|interest)\s+charge)\b|(?<![\p{L}\p{M}\p{N}_])(?:gebühr|entgelt|comisi[oó]n|commissione|comissão|comissao|kosten|opłata|avgift|gebyr|poplatek)(?![\p{L}\p{M}\p{N}_])|رسوم|عمولة)`,
  String.raw`(?<transaction>\b(?:virement(?:\s+reçu)?|pix(?:\s+(?:enviado|recebido))?|transaksi|havale|bizum|cargo\s+de|cargo|adeudo|consumo\s+de|na\s+kwot[eę]|lastschrift(?:\s+über)?|payment\s+made\s+for|you\s+have\s+(?:sent|received)|(?:you\s+)?made\s+an?|charge(?:\s+(?:of|made))?|credit\s+of|transaction(?!\s+(?:id|no|number|ref|reference|date|time|alert)\b)|(?:was|been)\s+used|used\s+for|charged\s+for|deducted|deduction|refunded|withdrew|purchase|purchased|spend|spent|paid|charged|debited|credited|received|sent|withdrawn|withdrawal|cash\s+out|deposited|deposit|refund|reversal|transfer(?:red)?|payment|amount|amt|amnt|paiement|achat|retrait|dépôt|remboursement|kartenzahlung|abonnementzahlung|belastet|gutgeschrieben|gutschrift|zahlungseingang|betrag|bezahlt|transaktion|erhalten|compra|pagado|reembolso|abonado|retirada|utilizada\s+por|operazione|pagamento|enviou|pinbetaling|pasbetaling|kaartbetaling|betaling|betaald|bijgeschreven|afgeschreven|wydano|otrzymano|platba|(?:kort)?köp|fått|betalt|betalte|sendt)\b|(?<![\p{L}\p{N}])(?:alışveriş(?:iniz)?|ödemeniz|tutarında|(?:و?ب)?مبلغ|بقيمة)(?![\p{L}\p{N}])|شراء|خصم|إيداع|ايداع|تحويل|استرداد|دفع|भुगतान|रिफंड\s+राशि|(?<![\p{L}\p{M}\p{N}_])(?:gezahlt|zapłacono|zaplacono|handlet|opname|kortkjøp|køb|aankoop|internetaankoop|zaplatili\s+jste|accredito(?:\s+stipendio)?|rimborsat[oa]|devuelto|reçue?|einkauf|internetkauf|onlinekauf|bargeldabhebung|bargeld\s+abgehoben|abgehoben|erstattung|erstattet|gesendet|überwiesen|abgebucht|ausgeführt|montant|pay[ée]e?s?|retir[ée]|rembours[ée]e?|r[ée]gl[ée]e?|cobrad[oa]|enviado|recibido|cantidad|importe|devoluci[oó]n|importo(?:\s+operazione)?|pagato|prelevato|prelievo|inviato|ricevuto|storno|addebitat[oa]|bonifico|bedrag|betaalde|gestuurd|ontvangen|opgenomen|overgemaakt|bijschrijving|terugbetaling|incasso|geïncasseerd|montante|pagou|recebeu|levantamento|devolução|wypłata|wypłaciłeś|wypłaciłaś|przesłał|przesłała|przelew|zapłaciłeś|zapłaciłaś|pobrał|pobrała|zwrot|obciążenie|transakcja|kartenumsatz|gekregen|summa|belopp|drog|dragits|betalat|handlat\s+för|uttag|överföring|återbetal\p{L}*|beløb|hævet|købt|tilbagebetaling|opkrævet|overført|beløp|trukket|handlet\s+for|kjøp|mottatt|uttak|tatt\s+ut|částka(?:\s+transakce)?|stržena|odepsána|výběr|připsána|zaplaceno|odeslaná|refundace|vrátil|vrátila|überweisung|overboeking|acquisto|rimborso|accreditato|cargados?|debitados?|débitée?|créditée?|prélèvement|prélevée?s?|envoyée?|kwot[aęy]|रिफंड)(?![\p{L}\p{M}\p{N}_])|(?:利用)?金額|金额|退回|退款|引き落とされました|扣款|승인|डेबिट|क्रेडिट)`,
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
// "Spent today: €40.00" (Revolut) is the day's running total, never a posting.
const AGGREGATE_PREFIX = /\b(?:(?:so far(?:\s+(?:this|the)\s+(?:day|week|month|year))?|(?:this|last)\s+(?:week|month|year)|(?:month|year|week)[ -]to[ -]date|(?:monthly|weekly|yearly|annual|cumulative|category)\s+(?:spend(?:ing)?|spends|expenditure)(?:\s+total)?)\b|spent\s+today\s*:)[^.!?;\n]*$/iu;

/**
 * The alert threshold the person set: "… is greater than your $5.00 limit in
 * your Alerts settings", "… was more than the $0.01 in your Alerts settings"
 * (Chase). It qualifies the alert, not the money; an earlier label in the
 * same sentence ("transaction") belongs to the principal, not to this figure.
 */
const ALERT_THRESHOLD_PREFIX = /\b(?:is|was)\s+(?:greater|more|higher|larger)\s+than\s+(?:the|your)\s*$/iu;
const ALERT_THRESHOLD_SUFFIX = /^\s*(?:limit\s+)?(?:set\s+)?in\s+your\s+alerts?\s+settings\b/iu;

function aggregateAmount(prefix: string, suffix: string, label: { role: UniversalMoneyRole; text: string } | undefined): boolean {
  if (ALERT_THRESHOLD_PREFIX.test(prefix) && ALERT_THRESHOLD_SUFFIX.test(suffix)) return true;
  // An independently labelled purchase/fee in the same clause retains its own
  // authority; period wording must qualify spending, not merely occur nearby.
  if (label && (label.role !== 'transaction' || !/^(?:spend|spent|amount)$/i.test(label.text))) return false;
  if (AGGREGATE_PREFIX.test(prefix)) return true;
  // Postfixed period summaries: "$40 on Food so far this month". A following
  // posting verb belongs to a separate field, so cannot qualify this amount.
  // "You've spent £67.64 on your card today" (Monzo) is the day's total.
  if (/^\s*on\s+your\s+card\s+today\b/iu.test(suffix)) return true;
  return !labels(suffix).some(row => row.role === 'transaction') &&
    /^\s*(?:on\s+[^.!?;\n]+?\s+)?(?:so far(?:\s+(?:this|the)\s+(?:day|week|month|year))?|(?:this|last)\s+(?:week|month|year)|(?:month|year|week)[ -]to[ -]date)\b/iu.test(suffix);
}

/**
 * Participles that label only the figure BEFORE them: "-$123.45 was refunded
 * to Amex". In "Purchase amount of THB 340.00 ... has been refunded AED 37.40
 * to your card account" the AED figure after the verb is the card's own
 * converted quote, not a second refund principal.
 */
const POSTFIX_ONLY_LABEL = /^refunded$/iu;
const prefixLabel = (row: { text: string }): boolean => !POSTFIX_ONLY_LABEL.test(row.text);

/** Words that list one figure beside another ("USD 5 and USD 7", "5 € und 7 €", "5 جم و 7 جم"). */
const LIST_JOIN = /^\s*(?:and|plus|und|et|en|y|e|,|&|و)?\s*$/iu;

const INFORMATIONAL_ROLES = new Set<UniversalMoneyRole>(['balance', 'credit-limit', 'statement-total', 'minimum-due']);

const LABEL_ROLES: Record<string, UniversalMoneyRole> = {
  minimum: 'minimum-due', total: 'statement-total', limit: 'credit-limit',
  balance: 'balance', bill: 'bill-due', fee: 'fee', transaction: 'transaction',
};

function labels(text: string, marketLabels: RegExp | null = null): { role: UniversalMoneyRole; start: number; text: string }[] {
  const found = [...text.matchAll(LABEL)].map((match) => ({
    role: LABEL_ROLES[Object.keys(match.groups ?? {}).find((key) => match.groups?.[key] !== undefined)!],
    start: match.index!, text: match[0],
  }));
  if (!marketLabels) return found;
  for (const match of text.matchAll(marketLabels)) {
    found.push({ role: 'transaction', start: match.index! + match[1].length, text: match[2] });
  }
  return found.sort((a, b) => a.start - b.start);
}

// Market-scoped transaction labels (second-wave packs only). Built from fixed
// pack vocabulary, never from alert text; at most one pattern per market.
const marketLabelPatterns = new Map<string, RegExp | null>();
function marketLabelPattern(market: UniversalParseContext['market']): RegExp | null {
  if (!market) return null;
  if (marketLabelPatterns.has(market)) return marketLabelPatterns.get(market)!;
  const terms = alertMarketPack(market).moneyLabels ?? [];
  const pattern = terms.length
    ? new RegExp(String.raw`(^|[^\p{L}\p{N}])(${terms
      .map((term) => term.trim().split(/\s+/u).map((word) => word.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')).join(String.raw`\s+`))
      .join('|')})(?=$|[^\p{L}\p{N}])`, 'giu')
    : null;
  marketLabelPatterns.set(market, pattern);
  return pattern;
}

/**
 * Commas that list one thing rather than separate fields: the US card-not-
 * present phrase "online, (by) phone, or (by) mail" and an English month-day
 * date "Oct 2, 2026". Splitting there cut "You made an online, phone, or mail
 * transaction of $30.00" away from its own verb, and "… on Mar 29, 2020 at …"
 * away from the rest of its sentence.
 */
const NON_SEPARATING_COMMAS = /\bonline,\s+(?:by\s+)?phone,?\s+or\s+(?:by\s+)?mail\b|\b(?:jan|feb|mar|apr|may|jun|jul|aug|sep|sept|oct|nov|dec)[a-z]{0,6}\.?\s+\d{1,2},\s+\d{4}\b/giu;

/** Separators between monetary fields; decimal and domain punctuation is excluded. */
function separators(text: string): number[] {
  const listed = [...text.matchAll(NON_SEPARATING_COMMAS)]
    .map((match) => ({ start: match.index!, end: match.index! + match[0].length }));
  return [...text.matchAll(/[;\n!?。।]|[.,](?=\s|$)/g)]
    .filter((match) => match[0] !== ',' || !listed.some((range) => match.index! > range.start && match.index! < range.end))
    .filter((match) => match[0] !== '.' || !/\b(?:min|avl|avail|cr|dr|amt|bal|dost)$/i.test(text.slice(0, match.index)))
    // The observed ADCB total label includes an abbreviation, not a clause
    // boundary. Its qualifier must stay attached to its own total only.
    .filter((match) => match[0] !== '.' ||
      !(/\btotal\s+due\s+to\s+avoid\s+fin$/i.test(text.slice(0, match.index)) &&
        /^\.\s+charges\b/i.test(text.slice(match.index))))
    .map((match) => match.index!);
}

/**
 * Two source-backed statement sentences without ordinary total/minimum labels.
 * Own only the existing exact money candidates; no number, currency, date or
 * account is inferred. Bare total-of/minimum-of may be rewards, not debt.
 */
function contextualStatementRoles(
  draft: AlertDraft,
  roleText: string,
): Map<number, { role: UniversalMoneyRole; labelStart: number }> {
  const roles = new Map<number, { role: UniversalMoneyRole; labelStart: number }>();
  const currencies = (candidate: MoneyCandidate) =>
    [...new Set(candidate.interpretations.map(value => value.currency))].sort().join('|');
  const statementContext = (prefix: string) =>
    /\bstatement\b/iu.test(prefix) &&
    /\b(?:(?:credit|covered|charge)\s+card|card\s+statement)\b/iu.test(prefix);
  for (let index = 0; index < draft.candidates.length; index++) {
    const first = draft.candidates[index];
    const prefix = roleText.slice(0, first.span.start);
    const totalLabel = prefix.match(/\btotal\s+of\s*$/iu);
    const second = draft.candidates[index + 1];
    if (totalLabel && second && statementContext(prefix)) {
      const between = roleText.slice(first.span.end, second.span.start);
      const minimumLabel = between.match(/^\s*(?:,|and|&)\s*(minimum\s+of)\s*$/iu);
      const after = roleText.slice(second.span.end, draft.candidates[index + 2]?.span.start);
      const sameCurrency = currencies(first) !== '' && currencies(first) === currencies(second);
      if (minimumLabel && sameCurrency && /^\s+(?:is|are)\s+due\s+(?:by|on)\b/iu.test(after)) {
        roles.set(first.span.start, { role: 'statement-total', labelStart: totalLabel.index! });
        roles.set(second.span.start, { role: 'minimum-due',
          labelStart: first.span.end + between.indexOf(minimumLabel[1]) });
      }
    }
    const generatedHeader = prefix.match(
      /\bstatement\s+for\s+(?:your\s+)?(?:[A-Za-z]+\s+){0,3}(?:credit|covered|charge)\s+card\s+[Xx*•·\d-]{4,24}\s+of\s*$/iu,
    );
    if (!generatedHeader || !/^\s+has\s+been\s+(?:generated|issued)\b/iu.test(
      roleText.slice(first.span.end, draft.candidates[index + 1]?.span.start),
    )) continue;
    // Reuse the field resolver, including masked PANs and conflicting cards.
    // An unrelated account or a BIN-only prefix cannot bind this debt.
    const instrument = extractUniversalFields(roleText, {}, draft.candidates.map(value => value.span)).instrument;
    const owner = extractUniversalFields(generatedHeader[0]).instrument;
    if (instrument.evidence !== 'explicit' || owner.evidence !== 'explicit' ||
        instrument.value?.kind !== 'card' || !instrument.value.last4 ||
        instrument.value.last4 !== owner.value?.last4) continue;
    roles.set(first.span.start, { role: 'statement-total', labelStart: generatedHeader.index! });
  }
  return roles;
}

function ownCandidates(
  draft: AlertDraft,
  excludedRoleSpans: readonly SourceSpan[],
  marketLabels: RegExp | null = null,
): OwnedCandidate[] {
  const text = draft.normalizedText;
  let roleText = text;
  for (const span of excludedRoleSpans) {
    if (!Number.isInteger(span.start) || !Number.isInteger(span.end) ||
      span.start < 0 || span.end < span.start || span.end > text.length) continue;
    roleText = roleText.slice(0, span.start) + ' '.repeat(span.end - span.start) + roleText.slice(span.end);
  }
  const owned: OwnedCandidate[] = [];
  const statementRoles = contextualStatementRoles(draft, roleText);
  draft.candidates.forEach((candidate, index) => {
    const previousEnd = draft.candidates[index - 1]?.span.end ?? 0;
    const nextStart = draft.candidates[index + 1]?.span.start ?? text.length;
    const before = text.slice(previousEnd, candidate.span.start);
    let prefixStart = previousEnd + ((separators(before).at(-1) ?? -1) + 1);
    let preceding = labels(roleText.slice(prefixStart, candidate.span.start), marketLabels).filter(prefixLabel).at(-1);
    if (!preceding) {
      const prior = labels(roleText.slice(previousEnd, candidate.span.start), marketLabels).filter(prefixLabel).at(-1);
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
    // "508,63 kr. hos DSB": the point abbreviates the Nordic currency word.
    const krPoint = /kr$/iu.test(candidate.sourceText) && /^\.\s+\p{Ll}/u.test(after) ? 1 : 0;
    const suffixEnd = candidate.span.end + krPoint + (separators(after.slice(krPoint))[0] ?? after.length - krPoint);
    // A label that introduces the NEXT amount is that amount's own label:
    // "Salary credit of QAR 17,000.00 to your Current Account XX0015 Your new
    // available balance is QAR 30,966.05" has no separator between the two
    // figures; the balance label must not make the salary a second balance.
    // This is the same preceding-label search the next candidate runs. Only
    // an informational label is released: a posting verb between two bare
    // amounts ("USD 24.90 debited USD 500.00 balance") stays claimed by both,
    // so neither can quietly become the only principal.
    const next = draft.candidates[index + 1];
    const nextPrefixStart = candidate.span.end + ((separators(after).at(-1) ?? -1) + 1);
    const nextLabel = next ? labels(roleText.slice(nextPrefixStart, next.span.start), marketLabels).filter(prefixLabel).at(-1) : undefined;
    const nextLabelStart = nextLabel && INFORMATIONAL_ROLES.has(nextLabel.role) ? nextPrefixStart + nextLabel.start : Infinity;
    const following = labels(roleText.slice(candidate.span.end, suffixEnd), marketLabels)
      .find((row) => candidate.span.end + row.start < nextLabelStart);
    const label = preceding ?? following;
    let role = label?.role ?? 'unknown';
    // In a statement, an explicitly labelled "amount due" is the total;
    // a bare amount or a minimum is never promoted to a statement total.
    if (role === 'bill-due' && label && !/\bbill\b|فاتورة/iu.test(label.text) &&
        /\b(?:statement|mini\s+stmt)\b/iu.test(roleText.slice(0, candidate.span.start))) {
      role = 'statement-total';
    }
    if (!label && owned.at(-1)?.role === 'transaction' && LIST_JOIN.test(before)) {
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
    const statementRole = statementRoles.get(candidate.span.start);
    if (statementRole && !aggregate) {
      role = statementRole.role;
      labelStart = statementRole.labelStart;
    }
    owned.push({ candidate, role, labelStart, aggregate,
      span: { start: previousEnd > 0 ? labelStart ?? prefixStart : prefixStart, end: suffixEnd } });
  });
  // A postfixed verb labels only the last figure of a list: in "38,87 € und
  // 12,00 € bezahlt" both figures were paid, so the first is a transaction
  // too and the pair stays a review question instead of one silent figure.
  for (let index = owned.length - 2; index >= 0; index--) {
    const item = owned[index], next = owned[index + 1];
    if (item.role === 'unknown' && !item.aggregate && next.role === 'transaction' &&
        LIST_JOIN.test(text.slice(item.candidate.span.end, next.candidate.span.start))) item.role = 'transaction';
  }
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
  // Alias suffixes must not recover a numeric tail from an alphanumeric ID.
  // The existing Chinese card layout glues its labelled principal to 元:
  // ",金额58.00元". Admit that field boundary and literal unit only, never an
  // arbitrary CJK letter or a reference such as "AB金额58.00元".
  const labelledYuan = text.slice(end, candidate.span.end).trim() === '元' &&
    /(?:^|[,，;；。！？\n])\s*金额\s*[:：]?\s*$/u.test(text.slice(0, start));
  if (start === candidate.span.start && /[\p{L}\p{N}_]/u.test(before) && !labelledYuan) return false;
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

/**
 * Currencies whose own banks always write a decimal point and three-digit
 * groups ("$1,234.56", "£4.50"). A figure written with a decimal comma
 * ("$4,50", "£1.234,56") or lakh grouping ("$1,00,000.00") was not written by
 * such a bank: which digits are the decimals is a guess, so the figure is
 * never read in one of these currencies. (A "$" that may also be a peso
 * written with a decimal comma keeps only that reading: "$4,50" is never
 * USD 4.50, and is ARS 4.50 only where the person's country says so.)
 * Canada is included because only a PREFIXED figure is judged: a
 * French-Canadian bank writes "4,50 $", never "$4,50" or "C$4,50".
 */
const POINT_DECIMAL_CURRENCIES = new Set(['USD', 'GBP', 'AUD', 'NZD', 'SGD', 'HKD', 'CAD']);
const LAKH_GROUPING = /^\d{1,2}(?:,\d{2})+,\d{3}(?:\.\d+)?$/;
const figureOf = (candidate: MoneyCandidate, text: string): string =>
  text.slice(candidate.span.start, candidate.span.end).match(/\d[\d.,]*\d|\d/)?.[0] ?? '';
// (Only a currency written BEFORE the figure, as these banks print it — a
// sign "$4,50", a code "USD 4,50" or a sign variant "US$4,50", "C$4,50": a
// European bank's "Kartenzahlung 12,50 USD" or "4,50 $" is its own convention
// for a foreign-currency amount, and its decimals are not in doubt.)
function foreignNumberConvention(candidate: MoneyCandidate, text: string): boolean {
  // (A leading sign is not the currency: "+12,50 USD" is a European bank's credit.)
  if (!/^[+\-−]?\s*(?:[A-Z]{1,3}\$|[A-Z]{3}(?=[ \t]*\d)|[^\p{L}\p{N}\s+\-−])/u.test(text.slice(candidate.span.start, candidate.span.end).trim())) return false;
  const numeric = figureOf(candidate, text);
  return /,\d{1,2}$/.test(numeric) || LAKH_GROUPING.test(numeric);
}

function candidateField(candidate: MoneyCandidate, text: string): UniversalField<UniversalMoney> {
  if (!completeNumericToken(candidate, text)) {
    return { ...missingUniversalField<UniversalMoney>('malformed-money-token'), spans: [candidate.span] };
  }
  let alternatives = candidate.interpretations.map(({ currency, minorUnits, exponent }) => ({ currency, minorUnits, exponent }));
  if (foreignNumberConvention(candidate, text) && alternatives.some(({ currency }) => POINT_DECIMAL_CURRENCIES.has(currency))) {
    alternatives = alternatives.filter(({ currency }) => !POINT_DECIMAL_CURRENCIES.has(currency));
    // (Lakh grouping is no "$" or "£" currency's own: no reading survives.)
    if (alternatives.length === 0 || LAKH_GROUPING.test(figureOf(candidate, text))) {
      return { value: null, evidence: 'ambiguous', spans: [candidate.span], alternatives: [], issues: ['foreign-number-convention'] };
    }
    return { value: null, evidence: 'ambiguous', spans: [candidate.span], alternatives,
      issues: [...new Set([...candidate.ambiguities, 'foreign-number-convention'])] };
  }
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

const moneyKey = (field: UniversalField<UniversalMoney>): string =>
  [...(field.value ? [field.value] : []), ...field.alternatives]
    .map((money) => `${money.currency}:${money.minorUnits}:${money.exponent}`).sort().join('|');
const ARABIC = /\p{Script=Arabic}/u;
const DEBIT_WORDS = /\b(?:used|purchase[ds]?|debited|spent|paid|withdrawn|withdrawal|sent|transferred)\b|خصم|شراء|استخدام|سحب|دفع|سداد|تحويل/iu;
const CREDIT_WORDS = /\b(?:refund(?:ed)?|credited|received|deposit(?:ed)?|reversal|reversed|returned)\b|استرداد|إيداع|ايداع|استلام|إرجاع|ارجاع|إضافة|اضافة|وارد/iu;
const directionClass = (text: string): 'debit' | 'credit' | null => {
  const debit = DEBIT_WORDS.test(text), credit = CREDIT_WORDS.test(text);
  return debit === credit ? null : debit ? 'debit' : 'credit';
};

/**
 * Bilingual alerts state the whole message once per language: BankMuscat
 * prints "used for OMR 4.200 at SHOP ... Avl Bal OMR 230.500 / تم استخدام
 * ... بمبلغ 4.200 ر.ع لدى SHOP ... الرصيد المتاح 230.500 ر.ع". The second
 * half is then a translation, not further movements, and its fields are
 * dropped. It is a translation only when ALL of these hold:
 *  - one delimiter (" / ", newline, "║", " | ") splits the text into a half
 *    with no Arabic letter and a half with Arabic wording;
 *  - both halves state the same figures in the same roles;
 *  - every Latin name or number in the Arabic half also appears in the
 *    English half (a different merchant or counterparty fails);
 *  - both halves read as the same direction (a purchase beside an Arabic
 *    refund of the same figure fails).
 * Anything else keeps every figure: "Sent OMR 4.200 to A and sent OMR 4.200
 * to B" is two payments, and stays a review question.
 */
function bilingualRepeats(text: string, owned: readonly OwnedCandidate[], observations: readonly UniversalMoneyObservation[]): Set<number> {
  const none = new Set<number>();
  if (owned.length < 2) return none;
  const delimiters = [...text.matchAll(/[ \t]\/[ \t]|\n|║|[ \t]\|[ \t]/gu)];
  for (const delimiter of delimiters) {
    const at = delimiter.index!, after = at + delimiter[0].length;
    const left = text.slice(0, at), right = text.slice(after);
    const leftArabic = ARABIC.test(left), rightArabic = ARABIC.test(right);
    if (leftArabic === rightArabic) continue;
    const [latin, arabic] = leftArabic ? [right, left] : [left, right];
    const side = (index: number) => owned[index].candidate.span.end <= at ? 'left'
      : owned[index].candidate.span.start >= after ? 'right' : null;
    const fields = (which: 'left' | 'right') => observations.flatMap((row, index) =>
      side(index) === which ? [`${row.role}=${moneyKey(row.field)}`] : []).sort().join(';');
    if (owned.some((_, index) => side(index) === null)) return none;
    const leftFields = fields('left');
    if (!leftFields || leftFields !== fields('right')) return none;
    const latinWords = new Set((latin.match(/[A-Za-z0-9*]+/gu) ?? []).map((word) => word.toLowerCase()));
    if ((arabic.match(/[A-Za-z0-9*]+/gu) ?? []).some((word) => !latinWords.has(word.toLowerCase()))) return none;
    const direction = directionClass(latin);
    if (!direction || direction !== directionClass(arabic)) return none;
    const second = leftArabic ? 'left' : 'right';
    // The English half keeps its fields, whichever side it was printed on.
    return new Set(owned.flatMap((_, index) => side(index) === second ? [index] : []));
  }
  return none;
}

/** Same draft contract and source coordinates, with bounded evidenced tokens. */
export function inspectUniversalMoneyDraft(source: string, context: UniversalParseContext = {}): AlertDraft {
  // Existing unique KSh metadata, matched case-insensitively by the alias path.
  const currencyAliases = sourceCurrencyAliases(context);
  // A routed market's own three-decimal currency (KW, BH, OM, JO) reads "12.345"
  // as a decimal; nothing changes for an unrouted alert or another currency.
  const moneyMarket = context.moneyMarket ?? context.market;
  let dotDecimalCurrencies: readonly CurrencyCode[] | undefined = moneyMarket ? alertMarketPack(moneyMarket).dotDecimalCurrencies : undefined;
  let draft = inspectAlertDraft(source, { currencyAliases, dotDecimalCurrencies });
  // One message prints one number format. When another figure in the SAME
  // three-decimal currency can only be read with a decimal full stop
  // ("KWD 5.800 ... balance KWD 1,743.966", "JOD 2.750 ... JOD 1649.832"),
  // the full stop in "5.800" is that decimal point too. Proof comes from an
  // unambiguous token in this text only; commas and other currencies keep
  // their ambiguity, and nothing is inferred from the person's ledger.
  const proven: CurrencyCode[] = [...new Set(draft.candidates.flatMap((candidate): CurrencyCode[] => {
    if (candidate.currency === null || candidate.ambiguities.length > 0 || candidate.exponent !== 3 ||
      dotDecimalCurrencies?.includes(candidate.currency)) return [];
    const figure = draft.normalizedText.slice(candidate.span.start, candidate.span.end).match(/\d[\d.,]*\d|\d/)?.[0] ?? '';
    // Only a three-digit fraction proves the template: "IQD 250.00" beside
    // "IQD 12.500" suggests the opposite, and IQD is whole dinars anyway.
    return candidate.currency !== 'IQD' && /^\d{1,3}(?:,\d{3})+\.\d{3}$|^\d{4,}\.\d{3}$/.test(figure) ? [candidate.currency] : [];
  }))];
  if (proven.length && draft.candidates.some((candidate) => candidate.currency !== null &&
    proven.includes(candidate.currency) && candidate.ambiguities.includes('decimal-or-grouping'))) {
    dotDecimalCurrencies = [...(dotDecimalCurrencies ?? []), ...proven];
    draft = inspectAlertDraft(source, { currencyAliases, dotDecimalCurrencies });
  }
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
    const tokenDraft = inspectAlertDraft(match[0], { currencyAliases, dotDecimalCurrencies });
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
  const currencyAliases = sourceCurrencyAliases(context);
  const draft = inspectUniversalMoneyDraft(source, context);
  const candidates = draft.candidates.filter((candidate) =>
    // The alias collector accepts suffixes; identifiers such as AB250Ksh are
    // not monetary tokens. Keep the same leading boundary as global symbols.
    !(/(?:ksh|tsh)$/i.test(candidate.sourceText) && candidate.span.start > 0 &&
      /[\p{L}\p{N}]/u.test(draft.normalizedText[candidate.span.start - 1])) &&
    !excludedMoneySpans.some((span) =>
    Number.isInteger(span.start) && Number.isInteger(span.end) &&
    span.start >= 0 && span.end > span.start && span.end <= draft.normalizedText.length &&
    candidate.span.start < span.end && candidate.span.end > span.start));
  const allOwned = ownCandidates({ ...draft, candidates }, excludedRoleSpans, marketLabelPattern(context.market));
  const allObservations = allOwned.map(({ candidate, role, aggregate }) => {
    const field = candidateField(candidate, draft.normalizedText);
    if (aggregate) field.issues = [...field.issues, 'aggregate-money-field'];
    return { role, field };
  });
  const repeated = bilingualRepeats(draft.normalizedText, allOwned, allObservations);
  const owned = allOwned.filter((_, index) => !repeated.has(index));
  const observations = allObservations.filter((_, index) => !repeated.has(index));
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
  // A figure the currency cannot hold ("812.40 JPY") is the unreadable
  // transaction amount: never let another number stand in for it.
  const refusal = draft.reasons.includes('input-too-long') ? 'input-too-long'
    : scopedAuthentication ? 'authentication-or-otp'
      : draft.reasons.includes('exponent-invalid-money') ? 'exponent-invalid-money' : undefined;
  if (refusal) { amount = missingUniversalField(refusal); transactionSpan = null; }
  return {
    draft, observations, amount, transactionSpan,
    statementTotal: selectFields(withRole('statement-total')), minimumDue: selectFields(withRole('minimum-due')),
    balance: selectFields(withRole('balance')), creditLimit: selectFields(withRole('credit-limit')),
  };
}
