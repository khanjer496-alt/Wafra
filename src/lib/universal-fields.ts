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

const MERCHANT_LABEL = /(?:^|[^\p{L}\p{N}])(?:desc(?:ription)?|narration|merchant|payee|beneficiary|seller|commerçant|bénéficiaire|händler|empfänger|comercio|beneficiario|esercente|begunstigde|利用先|التاجر|المستفيد)\s*[:：=-]\s*/giu;
const MERCHANT_PREPOSITION = /(?:^|[^\p{L}\p{N}])(?:at|to|trf\s+to|from|chez|bei|von|en|em|an|presso|bij|لدى|عند|لصالح)\s+/giu;
const MERCHANT_TAIL = /\s+(?:(?:avl|avail(?:able)?)\.?\s*(?:bal(?:ance)?|lmt|limit)\b|(?:on|le|am|el|il|op|em)\s+\d|on\s+(?:jan|feb|mar|apr|may|jun|jul|aug|sep|oct|nov|dec)[a-z]*\.?\s+\d|from\s+(?:your\s+)?(?:account|a\/?c|card|checking|savings)\b|posted\b|(?:with|using|via|über)\b|to\s+(?:(?:your|the)\s+)?(?:card|account)\b|\d{1,2}:\d{2}\b|(?:ref(?:erence)?(?:\s*no)?|refno|txn|transaction\s+(?:id|date))\b|(?:was|has|have|is|were|will|wurde|wurden|ist|wird)\b|con\s+(?:tu|su)\s+tarjeta\b|com\s+o\s+cart[aã]o\b|بتاريخ|رقم\s+(?:المرجع|العملية))/iu;
const BALANCE_FIELD_TAIL = /\s+(?:(?:available|current|remaining|closing)\s+(?:credit\s+)?(?:balance|limit)|(?:avl|avail)\.?\s*(?:bal(?:ance)?|limit)|balance|credit\s+limit|الرصيد(?:\s+(?:المتاح|الحالي))?)\s*[:=-]?\s*$/iu;
const BALANCE_FIELD_BEFORE_MONEY = new RegExp(
  BALANCE_FIELD_TAIL.source.replace(/\$$/u, '') + String.raw`(?=(?:[A-Z]{3}\s*[+-]?\d|[+-]?\d[\d.,]*\s*[A-Z]{3}\b))`, 'iu');
// These are clauses about the payment, not words in its seller's name. Keep
// their text outside the merchant span so downstream status checks can see it.
// A bare status word only terminates at the end or before a reason: names such
// as DECLINED CAFE and THE PENDING CAFE remain intact.
const MERCHANT_STATUS_TAIL = /\s+(?:(?:abgelehnt|geweigerd|rechazado)(?=\s*(?:$|op\b|wegen\b|omdat\b))|requires?\s+(?:(?:an?|your)\s+)?(?:otp(?=\b|\d)|verification\s+code\b|security\s+code\b|one[ -]time\s+(?:code|password)\b)|(?:declined|failed|rejected|unsuccessful)(?=\s*(?:$|due\b|because\b|for\b))|pending(?:\s+(?:authori[sz]ation|processing|approval|confirmation|verification)\b|\s*$)|awaiting\s+(?:authori[sz]ation|approval|confirmation|verification)\b|scheduled\s+(?:for|on|to)\b|(?:pendente|pendiente|rechazad[oa]|recusad[oa]|negad[oa]|declinad[oa]|cancelad[oa]|(?:n[aã]o|no)\s+(?:aprovad[oa]|aprobad[oa]|autorizad[oa]))(?=\s*(?:$|de\b|por\b|pelo\b|pela\b))|(?:se\s+(?:cargar|abonar|aplicar|reflejar)[aá]|ser[aá]\s+(?:cargad|abonad|debitad|creditad|lan[cç]ad|processad)[oa]|retenid[oa]|bloquead[oa]|estornad[oa]|en\s+revisi[oó]n|no\s+procede|requiere|aguarda|on\s+hold|requires?\s+your)(?=$|[^\p{L}\p{N}])|(?:em\s+processamento|en\s+proceso|aguardando\s+(?:aprova[cç][aã]o|confirma[cç][aã]o|autoriza[cç][aã]o)|pendiente\s+de\s+(?:autorizaci[oó]n|aprobaci[oó]n))(?=$|[^\p{L}\p{N}]))/iu;
// Portuguese/Spanish lifecycle words above follow the same rule as English:
// a trailing status word is not part of the merchant name, so it cannot be
// masked away as merchant text and let a pending/declined alert post.
const NOT_MERCHANT = /^(?:未払い|今回|本次交易)$|^(?:ihr(?:e|er|em|en)?|tu|su|sus|votre|vos|sua|seu)\s+(?:karte|konto|tarjeta|cuenta|carte|compte|cart[aã]o|conta)\b|^(?:cheq(?:ue)?|current|savings?|checking|credit|debit)\s+(?:a\/?c|acc(?:oun)?t)\b|^(?:su|tu|sua)\s+(?:cuenta|conta)\b|^(?:(?:your|the|an?)\s+)?(?:account|a\/?c|card|credit\s+card|debit\s+card|bank\s+account|statement|USD|AED|SAR|EUR|GBP|INR)\b|^(?:view|avoid|contact|call|visit|check|download|log\s*in|pay|confirm|verify|report)\b|^(?:حساب|بطاق|كشف\s+الحساب)/iu;
const MOVEMENT_CONTEXT = /\b(?:made\s+an?|withdrew|used\s+for|purchase|charged|paid|debited|credited|received|sent|transfer(?:red)?|spent|payment|paiement|débité|crédité|kartenzahlung|abgebucht|belastet|compra|pagado|pagamento|acquisto|addebitato|pinbetaling|betaling|kaartbetaling|betaald|afgeschreven|abonnementzahlung|remboursement|reembolso)\b|شراء|خصم|دفع|تحويل|استلام/iu;

const ownsMovement = (text: string, at: number, moneySpans: readonly SourceSpan[]): boolean => {
  let start = at;
  while (start > 0 && at - start < 160) {
    const index = start - 1, character = text[index];
    // A run of mask dots ("a/c..1234") is masking, not a sentence end.
    if (/[\n;!?。।]/u.test(character) || (character === '.' && !/\bno\.$/iu.test(text.slice(Math.max(0, index - 3), index + 1)) &&
        text[index - 1] !== '.' && text[index + 1] !== '.' &&
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
  // "You made a $45.67 transaction with STARBUCKS" names the seller after
  // WITH, which is otherwise a payment-method word ("with your card").
  const transactionWith = /(?:^|[^\p{L}\p{N}])transaction\s+with\s+(?!(?:your|the|an?)\b)/giu;
  for (const pattern of [MERCHANT_LABEL, MERCHANT_PREPOSITION, refundFrom, symbolicAt, billSupplier, transactionWith]) {
    for (const match of text.matchAll(pattern)) {
      // "From HSBC:" is an issuer header; "contact us at ..." is support.
      // A bare preposition requires movement evidence in its own clause.
      if ((pattern === MERCHANT_PREPOSITION || pattern === symbolicAt || pattern === transactionWith) && !ownsMovement(text, match.index!, moneySpans)) continue;
      if (pattern === billSupplier && /\b(?:call|contact|visit|log\s*in|for\s+help)\b/iu.test(
        text.slice(Math.max(0, match.index! - 160), match.index!).split(/[.!?;。।\n]/u).at(-1) ?? '',
      )) continue;
      const labelEnd = match.index! + match[0].length;
      // A chain may open with digits: "7-ELEVEN", "24 SEVEN" — but only when letters follow.
      const candidate = text.slice(labelEnd, labelEnd + 97).match(/^(?:[\p{L}%]|\d{1,3}[- ]?(?=\p{L}))[\p{L}\p{M}\p{N}% &'’*/+()._-]{0,95}/u)?.[0];
      if (!candidate) continue;
      let value = candidate.split(/\.(?=\s|$)/u)[0];
      // A labelled description opens with the channel, not the seller:
      // "Desc: POS PURCHASE SHOPRITE LEKKI". The channel words stay outside the
      // merchant span so the posting evidence they carry is still read.
      let lead = 0;
      if (pattern === MERCHANT_LABEL) {
        const channel = value.match(/^(?:pos\s+purchase|pos|purchase|card\s+purchase|online\s+purchase)\s+(?=\p{L})/iu);
        if (channel) { lead = channel[0].length; value = value.slice(lead); }
      }
      const start = labelEnd + lead;
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
    // Portuguese "efetuada no PINGO DOCE com o cartão", Polish "w BIEDRONKA
    // zostala", Korean "12,000원 GS25 강남점 10/02", Hindi "BIGBASKET को भुगतान".
    /(efetuad[ao]\s+(?:no|na|em)\s+)([\p{L}\p{M}][\p{L}\p{M}\p{N} &'’.*_-]{1,95}?)\s+(?=com\b)/giu,
    /([A-Z]{3}\s+w\s+)([\p{L}\p{M}][\p{L}\p{M}\p{N} &'’.*_-]{1,95}?)\s+(?=zosta[lł]a)/gu,
    /(\d[\d,]*원\s+)([\p{L}\p{M}\p{N}][\p{L}\p{M}\p{N} &'’.*_-]{1,95}?)\s+(?=\d{1,2}\/\d{1,2}\b)/gu,
    /((?:^|[।,]\s*))([A-Za-z\p{M}][\p{L}\p{M}\p{N} &'’.*_-]{1,95}?)\s+को\s+(?=भुगतान)/gu,
    /(\d{4}-\d{2}-\d{2}\s+tarihinde\s+(?:\d{4}\s+ile\s+biten\s+kartınızla\s+)?)([\p{L}\p{M}][\p{L}\p{M}\p{N} &'’.*_-]{1,95}?)\s+işyerinde(?:ki)?\s+(?=[A-Z]{3}\s*\d)/giu,
    /(कार्ड\s+\d{4}\s+से\s+)([\p{L}\p{M}][\p{L}\p{M}\p{N} &'’.*_-]{1,95}?)\s+पर\s+(?=[A-Z]{3}\s*\d)/gu,
    /((?:^|[।\n\]])\s*)([\p{L}\p{M}][\p{L}\p{M}\p{N} &'’.*_-]{1,95}?)\s+से\s+(?=[A-Z]{3}\s*\d[\d.,]*\s+(?:की\s+रिफंड\s+राशि|का\s+रिफंड))/gu,
    /((?:银行卡(?:于\d{4}-\d{2}-\d{2})?|^|[。:：，,\s日])在)([\p{L}\p{M}\p{N} &'’.*_-]{2,96}?)消费(?:成功|失败|被拒绝)/gu,
    /(退款到账通知[:：]\s*)([\p{L}\p{M}\p{N} &'’.*_-]{2,96}?)退回(?=[A-Z]{3}\s*\d)/gu,
    /((?:^|[.!?。।;\n\]])\s*)([\p{L}\p{M}][\p{L}\p{M}\p{N} &'’.*_-]{1,95}?)\s+işyerindeki\s+(?=[A-Z]{3}\s*\d)/giu,
    // Turkish banks date the receipt day-first and name the shop with the
    // ablative: "02.10.2026 tarihinde MIGROS işyerinden 456,75 TL".
    /(\d{2}[./]\d{2}[./]\d{4}\s+tarihinde\s+)([\p{L}\p{M}][\p{L}\p{M}\p{N} &'’.*_-]{1,95}?)\s+işyerinden\s+(?=\d)/giu,
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
