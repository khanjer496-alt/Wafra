import { inspectAlertDraft, type AlertDraft, type CurrencyAliasMap, type MoneyCandidate, type SourceSpan } from '@/lib/alert-draft';
import { alertMarketPack } from '@/lib/alert-market-packs';
import { CURRENCY_SYMBOL_CANDIDATES } from '@/lib/currency-metadata';
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

// ASCII \b does not treat accented or Vietnamese letters as word characters, so
// "crédité" or "débité" never matched a \b(...)\b label. These edges are
// Latin-script aware yet leave CJK/Hangul neighbours alone (an English word
// glued to Chinese text is still a word).
const LB = String.raw`(?<![A-Za-z\u00C0-\u024F\u1E00-\u1EFF\p{N}_])`;
const RB = String.raw`(?![A-Za-z\u00C0-\u024F\u1E00-\u1EFF\p{N}_])`;
// Suffix-inflected languages (Turkish, Indonesian, Swahili) glue endings on.
const RS = String.raw`[A-Za-z\u00C0-\u024F\u1E00-\u1EFF]*${RB}`;

// Long labels consume their component words: "minimum payment due" must not
// leave a second, stronger-looking "payment" or "amount due" match behind.
// The real "Avl. Cr.Limit" footer uses its abbreviation's dot as the word
// separator. Keep bare "CrLimit"/"CreditLimit" outside that observed alias.
const LABEL = new RegExp([
  String.raw`(?<minimum>\bpay\s+min\.|\bmin(?:imum)?(?:\s+|\.\s*)(?:(?:amount|amt|payment)\s+)?due\b|\bminimum\s+payment\b|\bpago\s+mínimo\b|(?<![\p{L}\p{M}\p{N}_])(?:paiement\s+minimum|न्यूनतम\s+देय\s+राशि)(?![\p{L}\p{M}\p{N}_])|الحد\s+(?:الادنى|الأدنى)\s+(?:المستحق|للدفع|للسداد))`,
  String.raw`(?<total>\b(?:statement\s+(?:total|balance|amount)|closing\s+balance|total\s+(?:(?:amount|amt)\s+)?due(?:\s+to\s+avoid\s+fin\.\s+charges)?|total\s+outstanding(?:\s+balance)?|new\s+balance|saldo\s+total\s+del\s+estado)\b|(?<![\p{L}\p{M}\p{N}_])(?:total\s+à\s+payer|कुल\s+देय\s+राशि)(?![\p{L}\p{M}\p{N}_])|(?:اجمالي|إجمالي)\s+(?:المبلغ\s+المستحق|مبلغ\s+الكشف))`,
  String.raw`(?<limit>\b(?:(?:available|avl|avail)\.?\s+(?:credit\s+limit|cr(?:\.?\s+|\.)limit)|(?:available|credit|avl|avail)\.?\s+(?:limit|lmt)|available\s+credit|credit\s+available)\b|${LB}(?:avail\.?\s+credit|kalan\s+limit|kullan[ıi]labilir\s+limit\p{L}*|limite\s+dispon[ií]vel|cupo\s+disponible|cr[eé]dito\s+disponible)${RB}|الحد\s+(?:المتاح|الائتماني))`,
  // Abbreviated and local balance labels ("AvlBal:", "Avlbl Amt:", "Bakiyeniz",
  // "Salio", "잔액", "คงเหลือ", "Số dư"). A balance is never the principal.
  String.raw`(?<balance>\b(?:(?:available|current|avl|avail)\.?\s+)?bal(?:ance)?\b|${LB}(?:(?:avl|avail)\.?\s*bal(?:ance)?|avlbl\.?\s*(?:amt|bal(?:ance)?)|avail(?:able)?\.?\s*amt|salio|s[ốo]\s+d[ưư]|sd(?=\s*:)|bakiye\p{L}*)${RB}|\b(?:solde(?:\s+disponible)?|kontostand|saldo|(?:kullanılabilir\s+)?bakiye)\b|잔액|[余餘]額|คงเหลือ|ยอดคงเหลือ|الرصيد(?:\s+(?:الحالي|المتاح))?|(?<![\p{L}\p{M}\p{N}_])رصيد\s+حسابك(?:\s+(?:الحالي|المتاح))?(?![\p{L}\p{M}\p{N}_])|(?:उपलब्ध\s+)?शेष\s+राशि|(?:利用可能)?残高|(?:可用)?余额)`,
  String.raw`(?<bill>\b(?:bill(?:\s+amount)?\s+(?:due|of)|amount\s+due|payment\s+due|bill\s+amount|bill\s+for|montant\s+à\s+payer|importo\s+da\s+pagare)\b|مبلغ\s+الفاتورة|المبلغ\s+المستحق|देय\s+राशि)`,
  // Wallet receipts print their charges as separate fields ("Transaction cost,
  // Ksh23.00", "Fee charged: GHS 0.85", "Tax was UGX 250"). They are fees, never
  // the principal; the words that follow a fee noun ("charged") must not turn
  // it into a transaction label. Bare cost/tax/VAT/levy count only when they
  // open their own clause, so "purchase cost $5" or "tax $300 debited" keep
  // their ordinary owner.
  String.raw`(?<fee>\b(?:transaction\s+(?:cost|fees?|charges?)|(?:service\s+)?(?:fees?|tax(?:es)?|vat|excise(?:\s+duty)?|levy)\s+(?:charged|was|applied)|total\s+charges|fee|fees|commission|service\s+charge)\b|(?<![\p{L}\p{M}\p{N}_])(?:ada\s+ya\s+muamala|frais|geb[üu]hr(?:en)?|entgelt|comisi[óo]n|comiss[ãa]o|commissione|tarifa)(?![\p{L}\p{M}\p{N}_])|رسوم|عمولة)`,
  // A bare cost/tax word opening a clause is a field name, but it gives way to a
  // movement word that follows its figure ("Tax $300.00 debited").
  String.raw`(?<feeweak>(?=(?:cost|tax|vat|levy|excise))(?<=(?:^|[.;,!?\n:])\s*)(?:cost|tax(?:es)?|vat|levy|excise\s+duty)(?![\p{L}\p{N}]))`,
  String.raw`(?<transaction>(?=withdraw)(?<=\d\s*[AP]M)withdraw|${LB}(?:virement(?:\s+reçu)?|pix(?:\s+(?:enviado|recebido))?|transaksi|havale|bizum|cargo\s+de|consumo\s+de|na\s+kwot[eę]|lastschrift(?:\s+über)?|payment\s+made\s+for|you\s+have\s+(?:sent|received)|(?:you\s+)?made\s+an?|charge\s+(?:of|made)|transaction(?!\s+(?:id|no|number|ref|reference|date|time|alert)\b)|used\s+for|charged\s+for|withdrew|purchase|purchased|spend|spent|paid|charged|debited|credited|received|sent|withdrawn|withdrawal|cash\s+out|deposited|deposit|refund(?:ed|s)?|reversal|transfer(?:red)?|payment|amount|amt|amnt|paiement|débité|crédité|remboursement|kartenzahlung|abonnementzahlung|belastet|gutgeschrieben|compra|reembolso|abonado|pagamento|pinbetaling|pasbetaling|kaartbetaling|betaling|txn|deduct(?:ed|ion)|credit\s+of|debit\s+of|withdraw(?:s|ing)?|utilizad[ao]\s+por|realizaste|pagaste|compraste|recibiste|enviaste|retiraste|depositaste|transferiste|pagou|recebeu|enviou|comprou|sacou|usted\s+envi[oó]|te\s+envi[oó]|te\s+transfiri[oó]|te\s+deposit[oó]|se\s+abon(?:aron|[oó])|abon[oó]|retiro|retirada|saque|giro|valor|importe|monto|cargos?|pagos?|devoluci[oó]n|devolu[cç][aã]o|d[eé]bito\s+de|cr[eé]dito\s+de|achat|retrait|d[eé]p[oô]t|pr[eé]l[eè]vement|pr[eé]lev[eé]s?|montant|vous\s+a\s+envoy[eé]|umetuma|umepokea|umelipa|umetoa|umeweka|kimetolewa|kimewekwa|imetumwa|kiasi|malipo|sebesar|jumlah|nominal|membayar|bayar|dibayar(?:kan)?|ditransfer|didebet|didebit|dikredit|dikirim|ditarik|diterima|menerima|mengirim(?:kan)?|tarik\s+tunai)${RB}|${LB}(?:al[ıi][sş]veri[sş]|harcama|g[öo]nderil|gelmi[sş]|yat[ıi]r[ıi]l|tahsil)${RS}|(?<![\p{L}\p{N}])(?:alışveriş(?:iniz)?|ödemeniz|tutarında|مبلغ)(?![\p{L}\p{N}])|شراء|خصم|إيداع|ايداع|تحويل|استرداد|دفع|भुगतान|रिफंड\s+राशि|(?<![\p{L}\p{M}\p{N}_])(?:überweisung|overboeking|acquisto|rimborso|accreditato|cargados?|debitados?|रिफंड)(?![\p{L}\p{M}\p{N}_])|(?:利用)?金額|金额|退回|退款|引き落とされました|扣款|승인|डेबिट|क्रेडिट|支出|收入|消费|消費|支付(?!宝)|付款|转账|轉帳|轉入|转入|薪資|薪资|入账|入帳|簽賬|签账|刷卡|入金|出金|お?引(?:き)?出し|입금|출금|금액|결제|(?<![\p{L}\p{M}\p{N}_])(?:जमा|निकासी)(?![\p{L}\p{M}\p{N}_]))`,
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
const AGGREGATE_PREFIX = /(?:(?<![\p{L}\p{N}_])(?:누적|累计|累計|(?:world)?puan\s*:|포인트)|\b(?:(?:so far(?:\s+(?:this|the)\s+(?:day|week|month|year))?|(?:this|last)\s+(?:week|month|year)|(?:month|year|week)[ -]to[ -]date|(?:monthly|weekly|yearly|annual|cumulative|category)\s+(?:spend(?:ing)?|spends|expenditure)(?:\s+total)?)\b|spent\s+today\s*:))[^.!?;\n]*$/iu;

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

const LABEL_ROLES: Record<string, UniversalMoneyRole> = {
  minimum: 'minimum-due', total: 'statement-total', limit: 'credit-limit',
  balance: 'balance', bill: 'bill-due', fee: 'fee', feeweak: 'fee', transaction: 'transaction',
};

type RoleLabel = { role: UniversalMoneyRole; start: number; text: string; weak?: boolean };

function labels(text: string, marketLabels: RegExp | null = null): RoleLabel[] {
  const found: RoleLabel[] = [...text.matchAll(LABEL)].map((match) => {
    const group = Object.keys(match.groups ?? {}).find((key) => match.groups?.[key] !== undefined)!;
    return { role: LABEL_ROLES[group], start: match.index!, text: match[0], weak: group === 'feeweak' };
  });
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
  return [...text.matchAll(/[;\n!?。।，、；]|[.,](?=\s|$)/g)]
    .filter((match) => match[0] !== ',' || !listed.some((range) => match.index! > range.start && match.index! < range.end))
    .filter((match) => match[0] !== '.' || !/\b(?:min|avl|avail|cr|dr|amt|bal)$/i.test(text.slice(0, match.index)))
    // "Transaction cost, Ksh23.00": a comma right after a field label is the
    // label's own punctuation, not the end of the field.
    .filter((match) => match[0] !== ',' || !/\b(?:cost|fees?|charges?|balance|bal|amt|amount)$/i.test(text.slice(0, match.index)))
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
    let preceding = labels(roleText.slice(prefixStart, candidate.span.start), marketLabels).at(-1);
    if (!preceding) {
      const prior = labels(roleText.slice(previousEnd, candidate.span.start), marketLabels).at(-1);
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
    const following = labels(roleText.slice(candidate.span.end, suffixEnd), marketLabels)[0];
    // A weak label (bare "Tax") yields to a movement word after its figure.
    const label = preceding?.weak && following?.role === 'transaction' ? following : preceding ?? following;
    let role = label?.role ?? 'unknown';
    // In a statement, an explicitly labelled "amount due" is the total;
    // a bare amount or a minimum is never promoted to a statement total.
    if (role === 'bill-due' && label && !/\bbill\b|فاتورة/iu.test(label.text) &&
        /\b(?:statement|mini\s+stmt)\b/iu.test(roleText.slice(0, candidate.span.start))) {
      role = 'statement-total';
    }
    // "Your new balance: UGX 120,500" closing a wallet receipt is the account
    // balance. It is a statement total only beside statement, minimum or due words.
    if (role === 'statement-total' && label && /^new\s+balance$/iu.test(label.text) &&
        !/\b(?:statement|stmt|minimum|min\.?\s*(?:due|payment)|due|credit\s+card|autopay)\b/iu.test(roleText)) {
      role = 'balance';
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
    const statementRole = statementRoles.get(candidate.span.start);
    if (statementRole && !aggregate) {
      role = statementRole.role;
      labelStart = statementRole.labelStart;
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
  // Alias suffixes must not recover a numeric tail from an alphanumeric ID.
  // The existing Chinese card layout glues its labelled principal to 元:
  // ",金额58.00元". Admit that field boundary and literal unit only, never an
  // arbitrary CJK letter or a reference such as "AB金额58.00元".
  const labelledYuan = text.slice(end, candidate.span.end).trim() === '元' &&
    /(?:^|[,，;；。！？\n])\s*金额\s*[:：]?\s*$/u.test(text.slice(0, start));
  // CJK text has no spaces: "余额3,245.67元", "출금200,000원" and "支出45.80元" put a
  // label word directly against the figure. Only those money labels are tolerated
  // there; any other letter or digit still marks an identifier.
  // 金额 is excluded on purpose: it is a field name that must follow a boundary (above).
  const cjkNeighbour = /(?:余额|餘額|支出|收入|消费|消費|支付|付款|转账|轉帳|入账|入帳|出金|入金|引出し|人民[币幣]|잔액|출금|입금|누적|결제)$/u.test(text.slice(0, start));
  if (start === candidate.span.start && /[\p{L}\p{N}_]/u.test(before) && !labelledYuan && !cjkNeighbour) return false;
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
  const currencyAliases = sourceCurrencyAliases(context);
  // A routed market's own three-decimal currency (KW, BH, OM, JO) reads "12.345"
  // as a decimal; nothing changes for an unrouted alert or another currency.
  const moneyMarket = context.moneyMarket ?? context.market;
  const dotDecimalCurrencies = moneyMarket ? alertMarketPack(moneyMarket).dotDecimalCurrencies : undefined;
  const draft = inspectAlertDraft(source, { currencyAliases, dotDecimalCurrencies });
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
    // Malaysian carriers prefix a bank's SMS with the free-message marker
    // "RM0 ". It opens the message, is followed by the sender's name and is
    // never money: left in, it competes with the real amount.
    !(/^RM\s?0$/i.test(candidate.sourceText) && /^\s*$/.test(draft.normalizedText.slice(0, candidate.span.start)) &&
      /^\s+[\p{L}]/u.test(draft.normalizedText.slice(candidate.span.end))) &&
    !excludedMoneySpans.some((span) =>
    Number.isInteger(span.start) && Number.isInteger(span.end) &&
    span.start >= 0 && span.end > span.start && span.end <= draft.normalizedText.length &&
    candidate.span.start < span.end && candidate.span.end > span.start));
  const owned = ownCandidates({ ...draft, candidates }, excludedRoleSpans, marketLabelPattern(context.market));
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
