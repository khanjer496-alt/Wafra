import type { CategoryId, TransactionType } from '@/lib/types';
import type { UniversalBankEvent } from '@/lib/universal-types';
import { categorySupportsType, readMerchantCategoryOverride, scopedMerchantOverrideKey } from '@/lib/categories';
import { classifyMerchantDescription, normalizeArabic, normalizeServiceName, stripInvisible } from '@/lib/sms-parser';

export type CategorizationMeaning = 'purchase' | 'refund' | 'own-transfer' | 'card-payment' |
  'cash-withdrawal' | 'fee' | 'salary' | 'business-income' | 'unknown';
export interface DirectionalCategoryRule {
  merchant: string;
  type: TransactionType;
  category: CategoryId;
}
export interface CategorizationInput {
  /** An extracted seller/description, never the whole bank notification. */
  merchant: string;
  type: TransactionType;
  meaning?: CategorizationMeaning;
  /** Optional source-market refinement; absence and other countries use the global vocabulary. */
  market?: string;
  manualCategory?: CategoryId;
  overrides?: Readonly<Record<string, CategoryId>>;
  rules?: readonly DirectionalCategoryRule[];
}
export interface CategorySuggestion {
  merchant: string;
  category: CategoryId;
  source: 'manual' | 'merchant-rule' | 'movement' | 'merchant-activity' | 'merchant-vocabulary' | 'unresolved';
  reason: string;
  needsReview: boolean;
}

const key = (value: string): string => normalizeArabic(value).normalize('NFKC').replace(/\s+/gu, ' ').trim().toLowerCase();
const PROCESSOR_PREFIX = /^(?:paypal|stripe|sq|square|tap|2c2p|opn|ziina|mamo)\s*[*]\s*/iu;
const PROCESSOR_ONLY = /^(?:paypal|stripe|sq|square|tap|2c2p|opn|ziina|mamo)$/iu;
// A freelance marketplace or payment plan does not identify what was bought.
// Qualified local businesses (FIVERR GENERAL TRADING) still reach activity rules.
const OPAQUE_PLATFORM = /^(?:fiverr(?:\.com)?(?:\s+pro)?|klarna(?:\.com)?|tabby(?:\.ai)?|tamara(?:\.com|\.co)?)$/iu;
const MONEY_SERVICE = /^(?:(?:al\s*ansari|al\s*fardan|lulu|uae|sharaf|index|orient|wall\s*street|al\s*rostamani|gcc|joyalukkas)\s+exchange|western\s+union|moneygram|stc\s*pay|urpay)\b/iu;
const words = (...terms: string[]): RegExp => new RegExp(
  `(?<![\\p{L}\\p{N}])(?:${terms.map((term) => term.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')).join('|')})(?![\\p{L}\\p{N}])`, 'iu');
const ACTIVITY: readonly [RegExp, CategoryId][] = [
  [/\b(?:supermarket|hypermarket|grocer(?:y|ies))\b|سوبر\s*ماركت|بقال[ةه]/iu, 'groceries'],
  [/\b(?:restaurant|caf[eé]|cafeteria|coffee|bakery|bistro|pizzeria)\b|مطعم|مقه[ىي]|كافتيريا/iu, 'dining'],
  [/\b(?:pharmacy|hospital|clinic|dental|medical\s+cent(?:er|re))\b|صيدلي[ةه]|مستشف[ىي]|عياد[ةه]/iu, 'health'],
  [/\b(?:salon|barber|spa)\b|صالون|حلاق/iu, 'personal-care'],
  [/\b(?:furniture|garments?|hardware|jewellery|jewelry)\b|اثاث|أثاث|ملابس/iu, 'shopping'],
  [/\b(?:garage|motors|car\s+wash|auto\s+repair|spare\s+parts)\b/iu, 'transport'],
  [/\b(?:plumbing|locksmith|landscaping|interior\s+design)\b|(?<!dry )\bcleaning\b/iu, 'home-services'],
  [/\b(?:airlines?|airways|hotels?|resorts?)\b/iu, 'travel'],
  [/\b(?:tuition|university|college|school)\b|مدرس[ةه]|جامع[ةه]/iu, 'education'],
  [words('supermarché', 'épicerie', 'supermarkt', 'lebensmittel', 'supermercado', 'supermercato', 'alimentari', 'सुपरमार्केट', 'किराना'), 'groceries'],
  [/超市|スーパーマーケット/u, 'groceries'],
  [words('boulangerie', 'bäckerei', 'restaurante', 'ristorante', 'panetteria', 'bakkerij', 'padaria', 'रेस्तरां'), 'dining'],
  [/餐厅|餐廳|レストラン/u, 'dining'],
  [words('pharmacie', 'apotheke', 'farmacia', 'farmácia', 'apotheek', 'फार्मेसी', 'eczane', 'eczanesi', 'eczanesİ'), 'health'],
  [/药店|藥店|薬局|医院|醫院/u, 'health'],
  [words('friseur', 'coiffeur', 'peluquería', 'parrucchiere', 'kapsalon', 'cabeleireiro', 'salão de beleza'), 'personal-care'],
  [words('waterbedrijf'), 'utilities'],
  [words('telekom'), 'telecom'],
  [words('université', 'universität', 'universidad', 'università', 'universiteit', 'universidade'), 'education'],
  [words('software', 'logiciel', 'सॉफ्टवेयर'), 'software'],
  [/ソフトウェア|软件|軟體/u, 'software'],
];

const suggestion = (merchant: string, category: CategoryId, source: CategorySuggestion['source'], reason: string): CategorySuggestion => ({
  merchant, category, source, reason, needsReview: source === 'unresolved',
});

function merchantRule(input: CategorizationInput, names: string[]): { category?: CategoryId; conflict?: true } {
  for (const name of names) {
    const matches = (input.rules ?? []).filter((rule) => rule.type === input.type && key(rule.merchant) === key(name) &&
      categorySupportsType(rule.category, input.type));
    const unique = [...new Set(matches.map((rule) => rule.category))];
    if (unique.length > 1) return { conflict: true };
    if (unique.length) return { category: unique[0] };
  }
  // Directional decisions win over legacy aliases. Within either tier, the
  // exact source name precedes a cleaned/canonical fallback name.
  for (const scopedOnly of [true, false]) for (const name of names) {
    if (scopedOnly && !Object.prototype.hasOwnProperty.call(input.overrides ?? {}, scopedMerchantOverrideKey(name, input.type))) continue;
    const category = readMerchantCategoryOverride(input.overrides, name, input.type);
    if (category) return { category };
  }
  return {};
}

/**
 * Category proposals consume the extracted seller and financial meaning only.
 * Existing vocabulary remains the baseline; policy resolves contradictory
 * activity, payment-processor and user-rule evidence before using that guess.
 * No transaction, amount, transfer flag or stored user decision is changed here.
 */
export function categorizeMerchant(input: CategorizationInput): CategorySuggestion {
  if (!input || (input.type !== 'income' && input.type !== 'expense')) {
    return suggestion('', 'other', 'unresolved', 'direction-unresolved');
  }
  const raw = typeof input.merchant === 'string' ? input.merchant.trim() : '';
  const safe = raw.length <= 256 && !/[\u0000-\u001F\u007F-\u009F]/u.test(raw);
  let merchant = safe ? stripInvisible(raw).normalize('NFKC').replace(/\s+/gu, ' ').trim() : '';
  if (input.manualCategory && categorySupportsType(input.manualCategory, input.type)) {
    return suggestion(merchant, input.manualCategory, 'manual', 'user-transaction-choice');
  }
  const meaning = input.meaning ?? 'unknown';
  const neutral = ['refund', 'own-transfer', 'card-payment', 'fee'].includes(meaning);
  if (neutral) return suggestion(merchant, 'other', 'movement', meaning);
  if (meaning === 'cash-withdrawal' && input.type === 'expense') {
    return suggestion(merchant || 'ATM withdrawal', 'cash-withdrawal', 'movement', meaning);
  }
  if (!safe || !merchant) return suggestion('', 'other', 'unresolved', 'merchant-unresolved');
  if (/\b(?:card|account)\b[\s\S]{0,100}\b(?:ending|credited|debited|charged|used)\b/iu.test(merchant) &&
    /\b[A-Z]{3}\s*[\d,.]+/iu.test(merchant)) {
    return suggestion('', 'other', 'unresolved', 'notification-is-not-a-merchant');
  }
  // These are processor delimiters already represented in the parser corpus.
  // Removing a rail does not say what the remaining seller trades in.
  for (let depth = 0; depth < 3 && PROCESSOR_PREFIX.test(merchant); depth++) {
    merchant = merchant.replace(PROCESSOR_PREFIX, '').trim();
  }
  if (PROCESSOR_PREFIX.test(merchant)) return suggestion(merchant, 'other', 'unresolved', 'processor-prefix-limit');
  const market = input.market === 'AE' || input.market === 'SA' ? input.market : null;
  const activities = [...new Set(ACTIVITY.filter(([pattern]) => pattern.test(merchant)).map(([, category]) => category))];
  const canonical = normalizeServiceName(merchant);
  // A protected non-service business must keep its own name. Canonicalizing
  // CLAUDE RESTAURANT to CLAUDE would erase the very evidence used to classify it.
  const canonicalCategory = canonical ? classifyMerchantDescription(canonical, 'expense', market).categoryGuess : null;
  const safeCanonical = canonical && (!activities.length || activities.includes(canonicalCategory!)) ? canonical : merchant;
  const rule = merchantRule(input, [raw, merchant, safeCanonical]);
  if (rule.conflict) return suggestion(merchant, 'other', 'unresolved', 'conflicting-merchant-rules');
  if (rule.category) return suggestion(safeCanonical, rule.category, 'merchant-rule', 'user-merchant-choice');
  if (input.type === 'income') {
    if (meaning === 'salary') return suggestion(merchant, 'salary', 'movement', meaning);
    if (meaning === 'business-income') return suggestion(merchant, 'business', 'movement', meaning);
    return suggestion(merchant, 'other', 'unresolved', 'income-purpose-unresolved');
  }
  if (meaning === 'salary' || meaning === 'business-income') {
    return suggestion(merchant, 'other', 'unresolved', 'meaning-direction-conflict');
  }
  if (PROCESSOR_ONLY.test(merchant)) return suggestion(merchant, 'other', 'unresolved', 'processor-does-not-identify-trade');
  if (MONEY_SERVICE.test(merchant)) return suggestion(merchant, 'other', 'unresolved', 'financial-purpose-unresolved');
  if (OPAQUE_PLATFORM.test(merchant) || (canonical && OPAQUE_PLATFORM.test(canonical))) {
    return suggestion(safeCanonical, 'other', 'unresolved', 'platform-purchase-unresolved');
  }
  // Named exceptions are existing redacted/canonical specimens. They outrank
  // regional substring matches, which cannot make an exchange house a grocer.
  if (/^mark\s*(?:&|and)\s*save$/iu.test(merchant)) {
    return suggestion('Mark & Save', 'groceries', 'merchant-vocabulary', 'canonical-merchant');
  }
  if (/^danube\s+home\b/iu.test(merchant)) {
    return suggestion(merchant, 'shopping', 'merchant-vocabulary', 'qualified-merchant');
  }
  if (activities.length > 1) return suggestion(merchant, 'other', 'unresolved', 'conflicting-merchant-activity');
  if (activities.length === 1) return suggestion(safeCanonical, activities[0], 'merchant-activity', 'explicit-merchant-activity');
  if (/\bgeneral\s+trad(?:e|ing)\b/iu.test(merchant)) {
    return suggestion(merchant, 'shopping', 'merchant-activity', 'explicit-retail-activity');
  }
  if (/\binterior\s+decor\b|\bmarketing\b/iu.test(merchant) && !canonical) {
    return suggestion(merchant, 'other', 'unresolved', 'merchant-activity-unresolved');
  }
  const result = classifyMerchantDescription(merchant, 'expense', market);
  if (result.categoryGuess === 'other') return suggestion(result.merchant, 'other', 'unresolved', 'merchant-activity-unresolved');
  if (result.categoryGuess === 'telecom' && market !== 'AE' && /\bdu\b/iu.test(merchant) &&
    !/\b(?:telecom|mobile|postpaid|prepaid|internet|telephone)\b/iu.test(merchant)) {
    return suggestion(merchant, 'other', 'unresolved', 'ambiguous-regional-merchant');
  }
  // Keep a source descriptor if its cleaned alias alone loses the activity
  // that justified the category (for example LIME*RIDE COST -> bare Lime).
  const canonicalKeepsCategory = classifyMerchantDescription(result.merchant, 'expense', market).categoryGuess === result.categoryGuess;
  return suggestion(canonicalKeepsCategory ? result.merchant : merchant, result.categoryGuess,
    'merchant-vocabulary', 'existing-merchant-vocabulary');
}

export function suggestUniversalCategory(
  event: UniversalBankEvent,
  options: Omit<CategorizationInput, 'merchant' | 'type' | 'meaning'> & { type?: TransactionType } = {},
): CategorySuggestion {
  const type = options.type ?? (event.direction === 'debit' ? 'expense' : event.direction === 'credit' ? 'income' : null);
  if (!type) return suggestion(event.merchant.value ?? '', 'other', 'unresolved', 'direction-unresolved');
  const meaning: CategorizationMeaning = event.family === 'refund' ? 'refund'
    : event.family === 'card-payment' ? 'card-payment'
      : event.family === 'cash-withdrawal' ? 'cash-withdrawal'
        : event.family === 'fee' ? 'fee' : 'unknown';
  return categorizeMerchant({ ...options, type, meaning, merchant: event.merchant.value ?? '' });
}
