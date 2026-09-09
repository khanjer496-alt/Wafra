import { missingUniversalField, type UniversalBankEvent, type UniversalParseContext } from '@/lib/universal-types';
import { inspectMarketAlert } from '@/lib/alert-semantics';
import type { MoneyDirection, PostingStatus, UniversalMarket } from '@/lib/alert-market-pack-types';
import { extractUniversalFields } from '@/lib/universal-fields';
import { extractUniversalMoney, inspectUniversalMoneyDraft } from '@/lib/universal-money';

const emptyEvent = (issue: string): UniversalBankEvent => ({
    version: 1, decision: 'ignore', family: 'unknown', status: 'unknown', direction: 'unknown',
    amount: missingUniversalField(), statementTotal: missingUniversalField(), minimumDue: missingUniversalField(),
    balance: missingUniversalField(), creditLimit: missingUniversalField(), merchant: missingUniversalField(),
    transactionDate: missingUniversalField(), dueDate: missingUniversalField(), statementDate: missingUniversalField(),
    instrument: missingUniversalField(), observations: [], issues: [issue],
});

// These supply existing language vocabularies, not a claim about the source's
// country. ISO money remains inspectable outside this finite market registry.
const LANGUAGE_PACKS: readonly UniversalMarket[] = ['US', 'FR', 'DE', 'ES', 'IT', 'NL', 'IN', 'QA'];
const commonDirection = (directions: MoneyDirection[]): MoneyDirection => {
  const known = [...new Set(directions.filter((value) => value === 'debit' || value === 'credit'))];
  return known.length === 1 ? known[0] : 'unknown';
};
const conservativeStatus = (statuses: PostingStatus[]): PostingStatus => {
  for (const value of ['failed', 'future', 'informational', 'posted'] as const) {
    if (statuses.includes(value)) return value;
  }
  return 'unknown';
};

// Callers supply only the fixed grammar strings below. Never cache message
// text, extracted values or parser results across people, messages or scans.
const phrasePatterns = new Map<string, RegExp>();
const phrase = (pattern: string): RegExp => {
  const cached = phrasePatterns.get(pattern);
  if (cached) return cached;
  const compiled = new RegExp(
    `(?:^|[^\\p{L}\\p{M}\\p{N}])(?:${pattern})(?=$|[^\\p{L}\\p{M}\\p{N}])`, 'iu');
  if (phrasePatterns.size >= 64) phrasePatterns.clear();
  phrasePatterns.set(pattern, compiled);
  return compiled;
};

/** Completed movement predicates, independent of issuer/country selection. */
const completedMovement = (source: string): { status: PostingStatus; direction: 'debit' | 'credit'; family: UniversalBankEvent['family'] } | null => {
  const text = source.normalize('NFKC').replace(/\s+/gu, ' ');
  const debitPatterns = [
    phrase(String.raw`spend\s+at|sent\s+to`),
    phrase(String.raw`paiement(?:\s+par\s+carte)?\s+(?:effectué|réalisé|exécuté)`),
    phrase(String.raw`kartenzahlung\s+(?:erfolgreich|abgeschlossen)`),
    phrase(String.raw`compra\s+realizada(?:\s+con\s+tarjeta)?`),
    phrase(String.raw`(?:factura[\s\S]{0,100}pagada|pago\s+se\s+ha\s+completado)`),
    phrase(String.raw`compra\s+aprovada\s+no\s+cartão`),
    phrase(String.raw`mensalidade[\s\S]{0,100}paga|pagamento\s+concluído`),
    phrase(String.raw`pagamento\s+con\s+carta\s+eseguito`),
    phrase(String.raw`acquisto\s+completato`),
    phrase(String.raw`kaartbetaling\s+voltooid`),
    phrase(String.raw`overboeking\s+voltooid[\s\S]{0,100}afgeschreven`),
    phrase(String.raw`alışveriş(?:iniz)?\s+(?:gerçekleşmiştir|tamamlandı)`),
    phrase(String.raw`تم\s+(?:سداد|خصم)`),
    /भुगतान\s+सफल\s+हुआ/u,
    /(?:カード利用|購入)が完了しました/u,
    /(?:消费|支付|付款)(?:成功|已完成)/u,
  ];
  const refundPatterns = [
    phrase(String.raw`remboursement\s+(?:non\s+)?reçu`),
    phrase(String.raw`remboursement\s+de[\s\S]{0,100}reçu\s+de`),
    phrase(String.raw`reembolso\s+recibido`),
    phrase(String.raw`rimborso\s+accreditato`),
    /(?:रिफंड|धनवापसी)[\s\S]{0,140}जमा\s+हो\s+(?:गई|गया)\s+है/u,
    /退款到账|退款到賬|退款[^。]{0,90}已到账/u,
  ];
  const depositPattern = phrase(String.raw`deposit\s*\/\s*transfer\s+to\s+your\s+account|überweisung\s+eingegangen`);
  const statuses: PostingStatus[] = [];
  const matches = (pattern: RegExp): boolean => {
    let found = false;
    for (const match of text.matchAll(new RegExp(pattern.source, pattern.flags + 'g'))) {
      found = true;
      const prefix = text.slice(Math.max(0, match.index! - 100), match.index!)
        .split(/[;!?。।]|\.(?=\s|$)/u).at(-1) ?? '';
      const suffix = text.slice(match.index! + match[0].length, match.index! + match[0].length + 70);
      const conditional = phrase(String.raw`if|unless|si|se|wenn|falls|als|indien|إذا|اذا|إن|هل`).test(prefix) || /如果|若|अगर|यदि/u.test(prefix) ||
        /^\s*(?:か|吗|嗎|m[ıiuü])(?=\s|[?,，]|$)/u.test(suffix) || /[?؟]/u.test(suffix);
      const future = phrase(String.raw`will|scheduled|upcoming|sera|será|wird`).test(prefix) ||
        phrase(String.raw`will|sera|será|wird`).test(match[0]);
      const negative = phrase(String.raw`no|not|never|pas|aucun|aucune|nessun|nessuna|geen|niet|nicht|kein(?:e[nmrs]?)?|não|nao|لم|لن|ليس|لا`).test(prefix) ||
        phrase(String.raw`non|pas|jamais|niet|nicht|não|geen`).test(match[0]) ||
        /\bno\s+(?:(?:está|ha\s+sido)\s+)?(?:pagad[oa]|realizad[oa]|completad[oa]|recibid[oa])\b/iu.test(match[0]) ||
        /\bremboursement\s+non\s+reçu\b/iu.test(match[0]) ||
        /^\s*(?:नहीं|नहि|失败|失敗|尚未|未完成)/u.test(suffix);
      statuses.push(conditional ? 'informational' : future ? 'future' : negative ? 'failed' : 'posted');
    }
    return found;
  };
  const debit = debitPatterns.map(matches).some(Boolean);
  const refund = refundPatterns.map(matches).some(Boolean);
  const deposit = matches(depositPattern);
  const status = conservativeStatus(statuses);
  // Contradictory positive direction is unresolved; a negative qualification
  // still restricts posting even if another predicate appears in the clause.
  if (status !== 'posted' && statuses.length) return { status, direction: 'debit', family: 'unknown' };
  if (debit === (refund || deposit)) return null;
  return refund ? { status, direction: 'credit', family: 'refund' }
    : deposit ? { status, direction: 'credit', family: 'transfer' } : { status, direction: 'debit', family: 'purchase' };
};

/** References are identifiers even when immediately followed by a currency. */
const referenceSpans = (text: string) => [...text.matchAll(
  /\b(?:ref(?:erence)?(?:\s+(?:id|no\.?|number))?|(?:transaction|txn|customer|mandate)\s+(?:id|no\.?|number)|iban)\s*[:#-]?\s*([A-Z0-9*._-]{1,40})/giu,
)].filter((match) => /\d/u.test(match[1])).map((match) => ({
  start: match.index! + match[0].length - match[1].length,
  end: match.index! + match[0].length,
}));

/**
 * Source-level non-posting facts cannot be discarded with an unfamiliar money
 * clause or swallowed by an overlong merchant extraction. These are complete
 * predicates/document labels from the independent evidence corpus, not bare
 * merchant keywords. They only restrict posting; they never establish it.
 */
const explicitNonPosting = (source: string, includeLifecycle = true): {
  status: PostingStatus;
  family?: UniversalBankEvent['family'];
} | null => {
  const text = source.normalize('NFKC').replace(/\s+/gu, ' ');
  const unconditional = (pattern: RegExp, excludeAdvice = false): boolean => [...text.matchAll(new RegExp(pattern.source, pattern.flags + 'g'))]
    .some((match) => {
      const prefix = text.slice(Math.max(0, match.index! - 160), match.index!)
        .split(/[.!?;](?=\s|$)/u).at(-1) ?? '';
      return !/\b(?:if|unless|wenn|falls|als|indien|si|se|eğer)\b|अगर|यदि/iu.test(prefix) &&
        !(excludeAdvice && /\b(?:never|avoid|do\s+not|don't)\b/iu.test(prefix));
    });
  if (unconditional(/\b(?:password|passcode)\s*[:=]\s*\d{4,8}\b/iu, true)) {
    return { status: 'informational', family: 'authentication' };
  }
  if (/\bauthori[sz]ation\s+approved\s*:/iu.test(text) && /\btemporary\s+hold\b/iu.test(text)) {
    return { status: 'informational' };
  }
  if (includeLifecycle && unconditional(/\b(?:transfer|payment|purchase)\s+request\s+(?:received|approved|accepted)\b/iu)) {
    return { status: 'informational' };
  }
  if (/^\s*(?:(?:tu|su)\s+)?estado\s+de\s+cuenta\b/iu.test(text)) {
    return { status: 'informational', family: 'statement' };
  }
  const declined = [
    /(?:^|[.!?;])\s*(?:your\s+)?(?:card\s+)?(?:payment|transaction|purchase)\s+(?:(?:was|is|has\s+been)\s+)?(?:declined|failed|rejected|not\s+approved)(?=\s*(?:[.!?;]|$))/iu,
    /\b(?:kartenzahlung|zahlung)\b[^!?]{0,180}\babgelehnt(?=\s*(?:[.!?]|$))/iu,
    /\b(?:betaling|kaartbetaling)\b[^!?]{0,180}\bgeweigerd(?=\s*(?:op\b|[.!?]|$))/iu,
    /\b(?:kart\s+)?ödemeniz\s+reddedildi(?=\s*(?:[.!?]|$))/iu,
    /\bpago\b[^!?]{0,180}\brechazado(?=\s*(?:[.!?]|$))/iu,
    /(?:^|[。.!?])\s*(?:カード決済|カード支払い|決済|支払い)(?:が|は)?拒否されました/u,
  ];
  if (declined.some((pattern) => unconditional(pattern))) return { status: 'failed' };
  if (!includeLifecycle) return null;
  if (unconditional(/\boverboeking\b[^!?]{0,180}\baangevraagd\b/iu)) return { status: 'informational' };
  if (unconditional(/\b(?:subscription|membership)\s+will\s+(?:renew|be\s+renewed)\b/iu) ||
    unconditional(/\bsubscrição\b[^.!?]{0,100}\bserá\s+renovada\b/iu) ||
    unconditional(/\bassinatura\b[^!?]{0,120}\bserá\s+cobrada\b/iu) ||
    unconditional(/定期購読[^。]{0,100}更新予定/u)) return { status: 'future' };
  if (/^\s*(?:votre\s+)?facture\b[^.!?]{0,100}/iu.test(text) &&
    /\b(?:montant\s+à\s+payer|date\s+limite\s+de\s+paiement)\b/iu.test(text)) {
    return { status: 'future', family: 'bill' };
  }
  if (/^\s*(?:la\s+)?bolletta\b/iu.test(text) && /\b(?:da\s+pagare|scadenza)\b/iu.test(text)) {
    return { status: 'future', family: 'bill' };
  }
  if (/^\s*(?:आपका\s+)?बिजली\s+बिल/u.test(text) && /देय\s+राशि|भुगतान\s+की\s+अंतिम\s+तिथि/u.test(text)) {
    return { status: 'future', family: 'bill' };
  }
  if (/電気料金[^。]{0,50}請求/u.test(text) && /未払い|支払期限/u.test(text)) {
    return { status: 'future', family: 'bill' };
  }
  return null;
};

/**
 * Extract reviewable facts for any explicit ISO currency without requiring a
 * registered bank. Reuse the established numerical and semantic engines; this
 * seam adds field ownership, completeness and a common source-free result.
 * It never grants automatic posting eligibility or substitutes a capture date.
 */
export function inspectUniversalBankEvent(source: string, context: UniversalParseContext = {}): UniversalBankEvent {
  if (typeof source !== 'string' || !source.trim()) return emptyEvent('empty-input');
  if (source.length > 4096) return emptyEvent('input-too-long');
  const draft = inspectUniversalMoneyDraft(source, context);
  const fields = extractUniversalFields(source, context, draft.candidates.map((candidate) => candidate.span));
  const money = extractUniversalMoney(source, context,
    fields.merchant.evidence === 'explicit' ? fields.merchant.spans : [],
    [...fields.instrument.spans, ...fields.transactionDate.spans, ...fields.dueDate.spans,
      ...fields.statementDate.spans, ...referenceSpans(draft.normalizedText)]);
  if (money.draft.reasons.includes('too-many-money-candidates')) return emptyEvent('too-many-money-candidates');
  const span = money.transactionSpan ?? { start: 0, end: source.length };
  const roleUnresolved = money.amount.issues.includes('amount-role-unresolved');
  let maskedSource = source;
  // A name such as DECLINED CAFE is not posting-state evidence. Offsets refer
  // to the original source, and replacing with spaces preserves their meaning.
  if (fields.merchant.evidence === 'explicit') {
    for (const merchant of fields.merchant.spans) {
      const start = merchant.start, end = merchant.end;
      if (end > start) maskedSource = maskedSource.slice(0, start) + ' '.repeat(end - start) + maskedSource.slice(end);
    }
  }
  const semanticSource = maskedSource.slice(span.start, span.end);
  const packs = context.market ? [context.market] : LANGUAGE_PACKS;
  const scopedReadings = packs.map((market) => inspectMarketAlert(semanticSource, market, { sender: context.sender }));
  // An unowned number has not earned a posting clause. Preserve negative and
  // informational context across line/sentence boundaries; flattened text is
  // for classification only, never the source of amounts or source spans.
  const wholeContext = maskedSource.replace(/[\n\r;!?]|\.(?!\d)/gu, ' ');
  const wholeReadings = roleUnresolved
    ? packs.map((market) => inspectMarketAlert(wholeContext, market, { sender: context.sender })) : [];
  const separateInfo = money.observations.some((observation) =>
    ['balance', 'credit-limit', 'statement-total', 'minimum-due'].includes(observation.role));
  const wholeNegative = wholeReadings.some((reading) =>
    reading.status === 'failed' || reading.status === 'future' || reading.family === 'authentication');
  const readings = roleUnresolved && (wholeNegative || !separateInfo) ? wholeReadings : scopedReadings;
  let status = conservativeStatus(readings.map((reading) => reading.status));
  const families = [...new Set(readings.map((reading) => reading.family).filter((family) => family !== 'unknown'))];
  let family: UniversalBankEvent['family'] = families.length === 1 ? families[0] : 'unknown';
  // Language classification consumes the clause already selected by monetary
  // ownership instead of asking another parser to select the amount again.
  // A leading document predicate may describe the first monetary field (for
  // example Japanese label/value layouts). It cannot qualify a later amount.
  const firstPrincipal = money.amount.spans[0]?.start === draft.candidates[0]?.span.start;
  const questionTail = maskedSource.slice(span.end).match(/^\s*[?？؟]/u)?.[0].length ?? 0;
  const movement = completedMovement(maskedSource.slice(firstPrincipal ? 0 : span.start, span.end + questionTail));
  // Unknown amount ownership may not establish a posting, but it cannot erase
  // a directly negated, questioned or scheduled movement predicate either.
  const completion = !roleUnresolved || movement?.status !== 'posted' ? movement : null;
  if (completion) {
    if (completion.status !== 'posted' || status === 'unknown') status = completion.status;
    if (family === 'unknown' || (completion.direction === 'credit' && family === 'cash-withdrawal')) family = completion.family;
  }
  // A proven purchase owns its clause: a later reminder about another bill
  // must not cancel it. Unresolved posting needs the whole document context.
  const sourceControl = explicitNonPosting(source, false) ??
    explicitNonPosting(status === 'posted' && !roleUnresolved ? maskedSource.slice(span.start, span.end) : maskedSource);
  // A numeric challenge before an amount remains a challenge across line or
  // sentence boundaries. A separate non-numeric safety footer is different.
  const challengeHeader = /\b(?:otp|verification\s+code|security\s+code)\s*(?:is\s*)?[:=-]?\s*\p{N}/iu.test(
    source.slice(0, span.start),
  );
  const challenge = sourceControl?.family === 'authentication' || challengeHeader || /\botp(?=\d)/iu.test(semanticSource) ||
    (roleUnresolved && (draft.reasons.includes('authentication-or-otp') ||
      /\botp(?=\d)/iu.test(draft.normalizedText)));
  const controlText = roleUnresolved ? wholeContext : semanticSource;
  const pending = /\b(?:pending|awaiting)\s+(?:authori[sz]ation|approval|confirmation|processing|clearance)\b/iu.test(controlText);
  const explicitlyUnsuccessful = [...controlText.matchAll(
    /\bnot\s+(?:(?:yet|been|be|successfully)\s+){0,2}(?:successful|completed|processed|posted|approved|paid|debited|credited)\b/giu,
  )].some((match) => !/\bif(?:\s+\w+){0,6}\s*$/iu.test(
    controlText.slice(Math.max(0, match.index! - 65), match.index!),
  ));
  if (challenge || pending) status = 'informational';
  if (explicitlyUnsuccessful) status = 'failed';
  if (sourceControl) {
    status = sourceControl.status;
    if (sourceControl.family) family = sourceControl.family;
  }
  if (challenge) family = 'authentication';
  if (roleUnresolved && (status === 'posted' || status === 'unknown')) {
    status = 'unknown';
    family = 'unknown';
  }
  const hasStatement = money.statementTotal.evidence !== 'missing' || money.minimumDue.evidence !== 'missing';
  const hasBalance = money.balance.evidence !== 'missing' || money.creditLimit.evidence !== 'missing';
  const hasAmount = money.amount.evidence !== 'missing';
  // An amount's local clause cannot erase its containing document type.
  // "Last payment received" inside a statement is historical information.
  const firstMoney = draft.candidates[0]?.span.start ?? source.length;
  let header = source.slice(0, firstMoney);
  if (fields.merchant.evidence === 'explicit') {
    for (const merchant of fields.merchant.spans) {
      const start = merchant.start, end = Math.min(firstMoney, merchant.end);
      if (end > start) header = header.slice(0, start) + ' '.repeat(end - start) + header.slice(end);
    }
  }
  const statementHeader = sourceControl?.family === 'statement' ||
    inspectMarketAlert(header, context.market ?? 'US').family === 'statement';
  if (statementHeader || (hasStatement && (!hasAmount || status !== 'posted'))) {
    family = 'statement';
    status = 'informational';
  } else if (!hasAmount && hasBalance) {
    family = 'balance';
    status = 'informational';
  } else if (money.observations.some((observation) => observation.role === 'bill-due') && status !== 'posted') {
    family = 'bill';
    status = 'future';
  }
  // A credit-card bill payment is not fresh spending or business revenue.
  // Preserve it as a distinct fact until a settlement-specific adapter can
  // reconcile its bank/card sides. Generic "card payment at SHOP" is excluded.
  const cardSettlement = /\bpayment\b[\s\S]{0,100}\b(?:towards?|against)\s+(?:your\s+)?(?:(?:credit|covered|charge)\s+)?card\b|\bpayment\b[\s\S]{0,100}\b(?:received|credited)\s+(?:to|on|for)\s+(?:your\s+)?(?:credit|covered|charge)\s+card\b/iu.test(semanticSource);
  if (cardSettlement && status === 'posted') family = 'card-payment';
  // Multiple independently owned principal amounts are distinct movements or
  // unresolved event attribution, not alternative spellings of one amount.
  // A single candidate with multiple currency/decimal interpretations remains
  // explicitly selectable. A multi-principal document requires a split adapter.
  const multiplePostings = money.observations.filter((observation) => observation.role === 'transaction').length > 1;
  if (multiplePostings && status !== 'failed' && family !== 'statement' && family !== 'balance') {
    family = 'unknown';
    status = 'informational';
  }
  const knownDirection = commonDirection(readings.map((reading) => reading.direction));
  // Commas separate money fields, but a following opposite posting verb can
  // still qualify this same amount. Inspect through its sentence, stopping
  // before the next amount; never treat a conflict as absent direction.
  const afterClause = maskedSource.slice(span.end);
  const sentenceTail = afterClause.search(/[;!?\n。।]|\.(?=\s|$)/u);
  const nextMoneyStart = draft.candidates.find((candidate) => candidate.span.start >= span.end)?.span.start ?? source.length;
  const directionEnd = Math.min(span.end + (sentenceTail < 0 ? afterClause.length : sentenceTail), nextMoneyStart);
  const directionText = maskedSource.slice(span.start, directionEnd);
  const explicitDebit = phrase(String.raw`debited|charged|débité|belastet|abgebucht|cargado|addebitato|afgeschreven`).test(directionText);
  const explicitCredit = phrase(String.raw`credited|crédité|gutgeschrieben|abonado|accreditato|bijgeschreven`).test(directionText);
  const directionConflict = (explicitDebit && (explicitCredit || completion?.direction === 'credit')) ||
    (explicitCredit && completion?.direction === 'debit') ||
    new Set(readings.map((reading) => reading.direction).filter((value) => value === 'debit' || value === 'credit')).size > 1;
  const direction = status === 'posted' || status === 'unknown'
    ? roleUnresolved || directionConflict ? 'unknown' : knownDirection === 'unknown' && completion ? completion.direction : knownDirection : 'none';
  const authentication = challenge || readings.some((reading) => reading.family === 'authentication');
  const promotion = [...readings, ...wholeReadings].some((reading) => reading.draft.reasons.includes('promotion'));
  const reviewable = hasAmount || hasStatement || hasBalance;
  const decision = reviewable && status !== 'failed' && !authentication && !pending && !promotion ? 'review' : 'ignore';
  const issues = [
    ...money.amount.issues,
    ...money.observations.flatMap((observation) => observation.field.issues),
    ...Object.values(fields).flatMap((field) => field.issues),
    ...(status === 'unknown' ? ['posting-status-unresolved'] : []),
    ...(direction === 'unknown' ? ['direction-unresolved'] : []),
    ...(directionConflict ? ['direction-conflict'] : []),
    ...(multiplePostings ? ['multiple-event-adapter-required'] : []),
    ...(fields.merchant.evidence === 'missing' ? ['merchant-unresolved'] : []),
    ...(hasAmount && fields.transactionDate.evidence === 'missing' ? ['transaction-date-unresolved'] : []),
    ...(family === 'statement' && money.statementTotal.evidence === 'missing' ? ['statement-total-unresolved'] : []),
    ...(family === 'statement' && fields.dueDate.evidence === 'missing' ? ['due-date-unresolved'] : []),
    ...(authentication ? ['authentication-not-posting'] : []),
    ...(pending ? ['pending-not-posting'] : []),
    ...(cardSettlement ? ['settlement-adapter-required'] : []),
    ...(status === 'failed' ? ['failed-not-posting'] : []),
    ...(promotion ? ['promotion-not-posting'] : []),
  ];
  return {
    version: 1, decision, family, status, direction,
    amount: family === 'statement' || family === 'balance' ? missingUniversalField() : money.amount,
    statementTotal: money.statementTotal, minimumDue: money.minimumDue,
    balance: money.balance, creditLimit: money.creditLimit,
    ...fields, observations: money.observations, issues: [...new Set(issues)],
  };
}
