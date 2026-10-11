import { hasNonCompletedWording } from '@/lib/best-effort-autopost';

/**
 * Exact per-bank alert templates for the Gulf neighbours (Qatar, Kuwait,
 * Bahrain, Oman). Pure (its one import is the shared wording guard) so both
 * the SMS posting path (gulf-neighbour-alerts.ts) and the certification registry
 * (universal-template-certification.ts) read the same grammar.
 *
 * Only shapes with real-alert evidence belong here. Today that is one Bank
 * Muscat family, reconstructed from the structure of three community-derived
 * alerts (see docs/universal-parser-rollout.md, "Gulf neighbours"). Bank
 * Muscat's deposit, transfer, payment, ATM and refund alerts have no sample
 * at all, so they have no template: they go through the marked launch-grammar
 * path or Review.
 */

export interface GulfNeighbourTemplateReading {
  templateId: string;
  market: 'OM';
  institution: 'bank-muscat';
  family: 'purchase';
  direction: 'debit';
  currency: 'OMR';
  minorUnits: number;
  exponent: 3;
  /** Last four of the masked ACCOUNT the template names. */
  last4: string;
  merchant: string;
  /** YYYY-MM-DD, already validated as a calendar date. */
  date: string;
}

/**
 * OM-BM-1, Bank Muscat debit-card purchase (Arabic): "money was deducted from
 * your account using the debit card at MERCHANT on DATE; your balance is".
 * The currency code stands either before or after the amount (never both),
 * the amount and balance carry exactly three decimals as every observed alert
 * does (grouped with commas or not at all, never with a stray separator), and
 * the whole message must match: nothing before, nothing after.
 *
 * The merchant slot is a card descriptor: Latin letters, digits, space and
 * & ' * / - (a full stop only inside a token, never ". "). It can therefore
 * never hold an Arabic sentence or a second English sentence such as
 * "SHOP. Transaction failed" lying between the merchant and بتاريخ.
 */
export const BANK_MUSCAT_CARD_PURCHASE_TEMPLATE =
  /^تم خصم (?:OMR ?(?<pre>(?:\d{1,3}(?:,\d{3})+|\d+)\.\d{3})|(?<post>(?:\d{1,3}(?:,\d{3})+|\d+)\.\d{3}) ?OMR) من حسابك رقم [Xx*]{3,}(?<last4>\d{4}) ب[إا]ستخدام بطاقة الخصم المباشر في (?<merchant>[A-Za-z0-9&'*/-](?:[A-Za-z0-9&'*/ -]|\.(?! )){1,95}) بتاريخ (?<y>\d{4})\/(?<m>\d{2})\/(?<d>\d{2}) \d{2}:\d{2}:\d{2}\. رصيدك الحالي هو -?(?:\d{1,3}(?:,\d{3})+|\d+)\.\d{3} OMR\.?$/u;

/**
 * Words that, anywhere in a template-shaped alert, mean it is not the bank's
 * plain completed purchase: the money came back, was stopped, is waiting or
 * is disputed, or the slot holds a sentence rather than a card descriptor.
 * Checked on top of the shared non-completed wording guard.
 */
const TEMPLATE_VETO =
  /\b(?:refund(?:ed|s)?|return(?:ed|s)?|revers(?:al|ed|e)|blocked|suspended|disputed?|chargeback|transaction|txn|amount|unsuccessful|fail(?:ed|ure|s)?|declined|pending|hold)\b|إلغاء|الغاء|ألغي|الغي|ملغ|مرفوض|رفض|فشل|لم\s+تتم|لم\s+تنجح|غير\s+(?:ناجح|مكتمل)|تعليق|إيقاف|ايقاف|استرجاع|استرداد|إرجاع|ارجاع|إعادة|اعادة|بانتظار|قيد\s+(?:المراجعة|المعالجة)|معلق|لا\s+تشارك|إذا\s+لم\s+تقم|اذا\s+لم\s+تقم/iu;

/** True when the whole message carries wording no certified purchase template may post. */
export const templateVetoed = (source: string): boolean =>
  hasNonCompletedWording(source) || TEMPLATE_VETO.test(source);

export const normalizeTemplateSource = (source: string): string =>
  source.slice(0, 4096).normalize('NFKC').replace(/\s+/gu, ' ').trim();

/**
 * Card terminals prefix or suffix the merchant with a numeric terminal id
 * ("7031-SAMPLE BOOKSHOP", "SAMPLE MOTORS-40917 SOHAR"). Only a run of four or
 * more digits joined by a hyphen is removed; digits inside a name stay.
 */
const stripTerminalIds = (merchant: string): string =>
  merchant
    .replace(/^\d{4,}\s?-\s?/u, '')
    .replace(/\s?-\s?\d{4,}(?=\s|$)/gu, '')
    .replace(/\s+/gu, ' ')
    .trim();

const validDay = (y: string, m: string, d: string): string | null => {
  const year = Number(y); const month = Number(m); const day = Number(d);
  if (year < 2000 || month < 1 || month > 12 || day < 1) return null;
  const last = new Date(Date.UTC(year, month, 0)).getUTCDate();
  return day <= last ? `${y}-${m}-${d}` : null;
};

/** The template reading of `source`, or null when it is not exactly this template. */
export function readBankMuscatCardPurchase(source: string): GulfNeighbourTemplateReading | null {
  const normalized = normalizeTemplateSource(source);
  // The WHOLE message is checked, not only what the anchored shape left over.
  if (templateVetoed(normalized)) return null;
  const match = BANK_MUSCAT_CARD_PURCHASE_TEMPLATE.exec(normalized);
  if (!match?.groups) return null;
  const figure = match.groups.pre ?? match.groups.post;
  if (!figure) return null;
  const minorUnits = Number(figure.replace(/[,.]/g, ''));
  if (!Number.isSafeInteger(minorUnits) || minorUnits <= 0) return null;
  const merchant = stripTerminalIds(match.groups.merchant);
  // A merchant must name something; a bare id or punctuation is not one.
  if (!/\p{L}{2}/u.test(merchant) || merchant.length > 80) return null;
  const date = validDay(match.groups.y, match.groups.m, match.groups.d);
  if (!date) return null;
  return {
    templateId: 'om-bank-muscat-card-purchase-v1',
    market: 'OM',
    institution: 'bank-muscat',
    family: 'purchase',
    direction: 'debit',
    currency: 'OMR',
    minorUnits,
    exponent: 3,
    last4: match.groups.last4,
    merchant,
    date,
  };
}
