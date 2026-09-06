import { missingUniversalField, type UniversalBankEvent, type UniversalField, type UniversalInstrument, type UniversalParseContext } from '@/lib/universal-types';
import { normalizeAlertText, type SourceSpan } from '@/lib/alert-draft';
import { extractUniversalDates } from '@/lib/universal-dates';

interface Observation<T> { value: T; span: SourceSpan }
const resolve = <T>(items: Observation<T>[]): UniversalField<T> => {
  if (!items.length) return missingUniversalField();
  const values = items.map((item) => item.value).filter((value, index, all) =>
    all.findIndex((other) => JSON.stringify(other).toLocaleLowerCase() === JSON.stringify(value).toLocaleLowerCase()) === index);
  return {
    value: values.length === 1 ? values[0] : null,
    evidence: values.length === 1 ? 'explicit' : 'ambiguous',
    spans: items.map((item) => item.span), alternatives: values.length === 1 ? [] : values,
    issues: values.length > 1 ? ['conflicting-field-values'] : [],
  };
};

const MERCHANT_LABEL = /(?:^|[^\p{L}\p{N}])(?:merchant|payee|beneficiary|seller|commerçant|bénéficiaire|händler|empfänger|comercio|beneficiario|esercente|begunstigde|利用先|التاجر|المستفيد)\s*[:：=-]\s*/giu;
const MERCHANT_PREPOSITION = /(?:^|[^\p{L}\p{N}])(?:at|to|from|chez|bei|en|em|an|presso|bij|لدى|عند|لصالح)\s+/giu;
const MERCHANT_TAIL = /\s+(?:(?:on|le|am|el|il|op|em)\s+\d|(?:with|using|via|über)\b|to\s+(?:(?:your|the)\s+)?(?:card|account)\b|\d{1,2}:\d{2}\b|(?:ref(?:erence)?|txn|transaction\s+(?:id|date))\b|(?:was|has|have|is|were|will)\b|بتاريخ|رقم\s+(?:المرجع|العملية))/iu;
const BALANCE_FIELD_TAIL = /\s+(?:(?:available|current|remaining|closing)\s+(?:credit\s+)?(?:balance|limit)|avl\.?\s*(?:bal(?:ance)?|limit)|balance|credit\s+limit|الرصيد(?:\s+(?:المتاح|الحالي))?)\s*[:=-]?\s*$/iu;
const BALANCE_FIELD_BEFORE_MONEY = new RegExp(
  BALANCE_FIELD_TAIL.source.replace(/\$$/u, '') + String.raw`(?=(?:[A-Z]{3}\s*[+-]?\d|[+-]?\d[\d.,]*\s*[A-Z]{3}\b))`, 'iu');
// These are clauses about the payment, not words in its seller's name. Keep
// their text outside the merchant span so downstream status checks can see it.
// A bare status word only terminates at the end or before a reason: names such
// as DECLINED CAFE and THE PENDING CAFE remain intact.
const MERCHANT_STATUS_TAIL = /\s+(?:(?:abgelehnt|geweigerd|rechazado)(?=\s*(?:$|op\b|wegen\b|omdat\b))|requires?\s+(?:(?:an?|your)\s+)?(?:otp(?=\b|\d)|verification\s+code\b|security\s+code\b|one[ -]time\s+(?:code|password)\b)|(?:declined|failed|rejected|unsuccessful)(?=\s*(?:$|due\b|because\b|for\b))|pending(?:\s+(?:authori[sz]ation|processing|approval|confirmation|verification)\b|\s*$)|awaiting\s+(?:authori[sz]ation|approval|confirmation|verification)\b|scheduled\s+(?:for|on|to)\b)/iu;
const NOT_MERCHANT = /^(?:未払い|今回|本次交易)$|^(?:su|tu|sua)\s+(?:cuenta|conta)\b|^(?:(?:your|the|an?)\s+)?(?:account|a\/?c|card|credit\s+card|debit\s+card|bank\s+account|statement|USD|AED|SAR|EUR|GBP|INR)\b|^(?:view|avoid|contact|call|visit|check|download|log\s*in|pay|confirm|verify|report)\b|^(?:حساب|بطاق|كشف\s+الحساب)/iu;
const MOVEMENT_CONTEXT = /\b(?:purchase|charged|paid|debited|credited|received|sent|transfer(?:red)?|spent|payment|paiement|débité|crédité|kartenzahlung|abgebucht|belastet|compra|pagado|pagamento|acquisto|addebitato|pinbetaling|betaling|kaartbetaling|betaald|afgeschreven|abonnementzahlung|remboursement|reembolso)\b|شراء|خصم|دفع|تحويل|استلام/iu;

const ownsMovement = (text: string, at: number, moneySpans: readonly SourceSpan[]): boolean => {
  let start = at;
  while (start > 0 && at - start < 160) {
    const index = start - 1, character = text[index];
    if (/[\n;!?。।]/u.test(character) || (character === '.' && !/\bno\.$/iu.test(text.slice(Math.max(0, index - 3), index + 1)) &&
        (!/\d/u.test(text[index - 1] ?? '') || !/\d/u.test(text[index + 1] ?? '')))) break;
    start -= 1;
  }
  const prefix = text.slice(start, at);
  if (/\b(?:call|contact|visit|log\s*in)\b/iu.test(prefix) || /\b(?:due|owing)\s*$/iu.test(prefix)) return false;
  return MOVEMENT_CONTEXT.test(prefix) || moneySpans.some((span) => span.start >= start && span.end <= at);
};

const merchantFields = (text: string, moneySpans: readonly SourceSpan[]): UniversalField<string> => {
  const observations: Observation<string>[] = [];
  const refundFrom = /(?:remboursement\s+(?:de\s+[A-Z]{3}\s*\d[\d.,]*\s+)?reçu|reembolso\s+recibido)\s+de\s+/giu;
  const billSupplier = /(?:stromrechnung\s+von|factura\s+de\s+agua\s+de|assinatura\s+da|mensalidade\s+da)\s+/giu;
  const symbolicAt = /\s@\s+/gu;
  for (const pattern of [MERCHANT_LABEL, MERCHANT_PREPOSITION, refundFrom, symbolicAt, billSupplier]) {
    for (const match of text.matchAll(pattern)) {
      // "From HSBC:" is an issuer header; "contact us at ..." is support.
      // A bare preposition requires movement evidence in its own clause.
      if ((pattern === MERCHANT_PREPOSITION || pattern === symbolicAt) && !ownsMovement(text, match.index!, moneySpans)) continue;
      if (pattern === billSupplier && /\b(?:call|contact|visit|log\s*in|for\s+help)\b/iu.test(
        text.slice(Math.max(0, match.index! - 160), match.index!).split(/[.!?;。।\n]/u).at(-1) ?? '',
      )) continue;
      const start = match.index! + match[0].length;
      const candidate = text.slice(start, start + 97).match(/^[\p{L}%][\p{L}\p{M}\p{N}% &'’*/+()._-]{0,95}/u)?.[0];
      if (!candidate) continue;
      let value = candidate.split(/\.(?=\s|$)/u)[0];
      const tails = [pattern === billSupplier ? value.search(/\s+(?:(?:no|não|será|está)\s+)?(?:pagada|paga)(?=\s*$)|\s+será\s+(?:cobrada|renovada)\b/iu) : -1, value.search(MERCHANT_TAIL), value.search(MERCHANT_STATUS_TAIL), value.search(BALANCE_FIELD_BEFORE_MONEY)]
        .filter((index) => index >= 0);
      const timeTail = text.slice(start, start + 97).search(/\s+\d{1,2}:\d{2}(?=\s|[.。।!?;]|$)/u);
      if (timeTail >= 0 && timeTail <= value.length) tails.push(timeTail);
      // Money after a merchant ends its name. A connector such as "for" or
      // "of" belongs to the price, while NEW BALANCE remains a whole name.
      const nextMoney = moneySpans.filter((span) => span.start >= start && span.start < start + value.length)
        .sort((a, b) => a.start - b.start)[0];
      if (nextMoney) {
        const beforeMoney = value.slice(0, nextMoney.start - start).replace(/\s+per\s*$/iu, '');
        const balanceLabel = beforeMoney.search(BALANCE_FIELD_TAIL);
        tails.push(balanceLabel >= 0 ? balanceLabel : beforeMoney.length);
      }
      if (tails.length) value = value.slice(0, Math.min(...tails));
      value = value.trim().replace(/\s+(?:for|of)$/iu, '').replace(/[.*_-]+$/u, '').trim();
      const end = start + value.length;
      if ((value.match(/\p{L}/gu) ?? []).length < 2 || NOT_MERCHANT.test(value) ||
          /\b(?:your|yours|please)\b/iu.test(value) || /^[A-Z]{2}\d[A-Z\d ]{6,}$/iu.test(value)) continue;
      // Reaching the bounded read limit is not proof that the name ended.
      if (end >= start + 96 && /[\p{L}\p{N}]/u.test(text[end] ?? '')) continue;
      if (moneySpans.some((span) => start < span.end && end > span.start)) continue;
      observations.push({ value, span: { start, end } });
    }
  }
  // These bounded, source-evidenced forms place the seller before a local
  // payment marker. Do not expose a broad reverse-word scan as merchant proof.
  const localForms = [
    /(\d{4}-\d{2}-\d{2}\s+tarihinde\s+(?:\d{4}\s+ile\s+biten\s+kartınızla\s+)?)([\p{L}\p{M}][\p{L}\p{M}\p{N} &'’.*_-]{1,95}?)\s+işyerinde(?:ki)?\s+(?=[A-Z]{3}\s*\d)/giu,
    /(कार्ड\s+\d{4}\s+से\s+)([\p{L}\p{M}][\p{L}\p{M}\p{N} &'’.*_-]{1,95}?)\s+पर\s+(?=[A-Z]{3}\s*\d)/gu,
    /((?:^|[।\n\]])\s*)([\p{L}\p{M}][\p{L}\p{M}\p{N} &'’.*_-]{1,95}?)\s+से\s+(?=[A-Z]{3}\s*\d[\d.,]*\s+(?:की\s+रिफंड\s+राशि|का\s+रिफंड))/gu,
    /((?:银行卡(?:于\d{4}-\d{2}-\d{2})?|^|[。:：，,\s])在)([\p{L}\p{M}\p{N} &'’.*_-]{2,96}?)消费(?:成功|失败|被拒绝)/gu,
    /(退款到账通知[:：]\s*)([\p{L}\p{M}\p{N} &'’.*_-]{2,96}?)退回(?=[A-Z]{3}\s*\d)/gu,
    /((?:^|[.!?。।;\n\]])\s*)([\p{L}\p{M}][\p{L}\p{M}\p{N} &'’.*_-]{1,95}?)\s+işyerindeki\s+(?=[A-Z]{3}\s*\d)/giu,
    /((?:^|[.!?。।;\n\]])\s*)([\p{L}\p{M}][\p{L}\p{M}\p{N} &'’.*_-]{1,95}?)\s+alışverişiniz\s+tamamlandı/giu,
    /(تم\s+سداد\s+فاتورة\s+)([\p{L}\p{M}][\p{L}\p{M}\p{N} &'’.*_-]{1,95}?)\s+بنجاح(?=\s*[.。।;]|\s*$)/gu,
    /((?:^|[.!?。।;\n\]])\s*)([\p{L}\p{M}\p{N} &'’.*_-]{2,96}?)での購入が完了しました/gu,
    /((?:^|[.!?。।;\n\]])\s*)([\p{L}\p{M}\p{N} &'’.*_-]{2,96}?)の電気料金の請求です/gu,
    /((?:^|[.!?。।;\n\]])\s*您在)([\p{L}\p{M}\p{N} &'’.*_-]{2,96}?)的消费已完成/gu,
    /((?:^|[.!?。।;\n\]])\s*)([\p{L}\p{M}\p{N} &'’.*_-]{2,96}?)的退款(?=\s*(?:[A-Z]{3}\s*\d|[$€£¥]\s*\d)[\d.,]*\s*已到账)/gu,
  ];
  for (const pattern of localForms) for (const match of text.matchAll(pattern)) {
    const value = match[2].trim();
    const start = match.index! + match[1].length + match[2].indexOf(value);
    const end = start + value.length;
    if ((value.match(/\p{L}/gu) ?? []).length < 2 || NOT_MERCHANT.test(value) ||
        /\b(?:your|yours|please)\b/iu.test(value) || /^[A-Z]{2}\d[A-Z\d ]{6,}$/iu.test(value) ||
        moneySpans.some((span) => start < span.end && end > span.start)) continue;
    observations.push({ value, span: { start, end } });
  }
  return resolve(observations);
};

const instrumentFields = (text: string): UniversalField<UniversalInstrument> => {
  const observations: Observation<UniversalInstrument>[] = [];
  const pattern = /(?:^|[^\p{L}\p{N}])(card|account|a\/?c|wallet|بطاق[ةه](?:ك)?|حساب(?:ك)?|محفظ[ةه](?:ك)?)\s*(?:(?:ending(?:\s+(?:in|with))?|no\.?|number|last\s*4|رقم|المنتهية|المنتهيه|تنتهي(?:\s+بـ?)?|ينتهي(?:\s+بـ?)?)\s*)?[:#-]?\s*([\dXx*•·-]{2,40}(?:[ \t]+[\dXx*•·-]{1,40}){0,7})(?![\p{L}\p{N}]|[ \t]+[\dXx*•·-])/giu;
  for (const match of text.matchAll(pattern)) {
    const label = match[1].toLocaleLowerCase();
    const kind: UniversalInstrument['kind'] = /card|بطاق/u.test(label) ? 'card'
      : /wallet|محفظ/u.test(label) ? 'wallet' : 'account';
    const groups = match[2].split(/[ \t]+/u);
    const validGroups = groups.length === 1 || groups.every((group) => /^[\dXx*•·]{4}$/u.test(group));
    const last4 = validGroups ? match[2].match(/(\d{4})$/u)?.[1] ?? null : null;
    const end = match.index! + match[0].length;
    observations.push({ value: { kind, last4 }, span: { start: end - (last4?.length ?? match[2].length), end } });
  }
  return resolve(observations);
};

export function extractUniversalFields(
  source: string,
  context: UniversalParseContext = {},
  moneySpans: readonly SourceSpan[] = [],
): Pick<UniversalBankEvent, 'merchant' | 'transactionDate' | 'dueDate' | 'statementDate' | 'instrument'> {
  if (source.length > 4096) return {
    merchant: missingUniversalField('input-too-long'),
    transactionDate: missingUniversalField('input-too-long'),
    dueDate: missingUniversalField('input-too-long'),
    statementDate: missingUniversalField('input-too-long'),
    instrument: missingUniversalField('input-too-long'),
  };
  const text = normalizeAlertText(source);
  return {
    merchant: merchantFields(text, moneySpans),
    ...extractUniversalDates(text, context, moneySpans),
    instrument: instrumentFields(text),
  };
}
