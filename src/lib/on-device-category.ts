import { CATEGORIES, categorySupportsType } from '@/lib/categories';
import { onLocalSemanticBackgroundCancelled } from '@/lib/local-semantic-background-policy';
import {
  onDeviceAI as defaultOnDeviceAI,
  textLanguage,
  type OnDeviceAI,
  type OnDeviceAILanguage,
  type OnDeviceAIProvider,
  type OnDeviceClosedSchema,
} from '@/lib/on-device-ai';
import type { CategoryId } from '@/lib/types';
import { categorizeMerchant, type DirectionalCategoryRule } from '@/lib/universal-categorization';

/**
 * Category suggestions for merchants Wafra's rules could not place.
 *
 * Order of authority:
 *   1. The deterministic categorizer (the user's own merchant rules first,
 *      then the shipped vocabulary). When it resolves a category, the model is
 *      never asked.
 *   2. Only for an unresolved expense merchant: the platform model picks one
 *      closed Wafra category id from the merchant NAME alone (no amount, date,
 *      account or message text), or "unsure".
 * The result is only a suggestion. Nothing is written until the user taps it,
 * and the suggestion is not persisted.
 */

const UNSURE = 'unsure';
export const SUGGESTIBLE_EXPENSE_CATEGORIES: readonly CategoryId[] = CATEGORIES
  .filter((category) => category.type === 'expense' && category.id !== 'other')
  .map((category) => category.id);

export const CATEGORY_SUGGESTION_SCHEMA: OnDeviceClosedSchema = Object.freeze({
  name: 'WafraCategory',
  fields: Object.freeze([
    { name: 'category', description: 'The spending category the merchant name clearly indicates, or unsure',
      choices: [...SUGGESTIBLE_EXPENSE_CATEGORIES, UNSURE] },
  ]),
});

const INSTRUCTIONS = [
  'You label a shop or service by what it sells, using only its name as printed on a bank statement.',
  'Pick one category id from the list. Answer unsure when the name alone does not clearly say what it sells,',
  'for example a person\'s name, a payment processor, a transfer, or an unfamiliar brand.',
  `Categories: ${CATEGORIES.filter((category) => SUGGESTIBLE_EXPENSE_CATEGORIES.includes(category.id))
    .map((category) => `${category.id} (${category.label})`).join(', ')}`,
].join('\n');

export type CategoryAdvice =
  | { kind: 'rule'; category: CategoryId }
  | { kind: 'on-device-ai'; category: CategoryId; provider: OnDeviceAIProvider }
  | { kind: 'none'; reason: string };

/** Keep the merchant a label: bounded length, no long digit runs (references, card or phone numbers). */
export function merchantForModel(merchant: string): string {
  return merchant.normalize('NFKC')
    .replace(/[\u0000-\u001F\u007F-\u009F\u061C\u200B-\u200F\u2028\u2029\u202A-\u202E\u2066-\u2069\uFEFF]/gu, ' ')
    .replace(/[0-9٠-٩۰-۹]{4,}/gu, '#')
    .replace(/\s+/gu, ' ')
    .trim()
    .slice(0, 80);
}

/** Only an allowed expense id from the closed list; "unsure" and anything else is no suggestion. */
export function acceptModelCategory(value: unknown): CategoryId | null {
  if (typeof value !== 'string' || value === UNSURE) return null;
  if (!SUGGESTIBLE_EXPENSE_CATEGORIES.includes(value as CategoryId)) return null;
  return categorySupportsType(value, 'expense') ? value as CategoryId : null;
}

export function createCategoryAdvisor(ai: OnDeviceAI = defaultOnDeviceAI, maxEntries = 200) {
  const cache = new Map<string, CategoryAdvice>();
  return {
    async suggest(input: {
      merchant: string;
      appLanguage: OnDeviceAILanguage;
      overrides?: Readonly<Record<string, CategoryId>>;
      rules?: readonly DirectionalCategoryRule[];
      market?: string;
      cancelled?: () => boolean;
    }): Promise<CategoryAdvice> {
      const deterministic = categorizeMerchant({
        merchant: input.merchant, type: 'expense', overrides: input.overrides, rules: input.rules, market: input.market,
      });
      if (!deterministic.needsReview && deterministic.category !== 'other') {
        return { kind: 'rule', category: deterministic.category };
      }
      const merchant = merchantForModel(input.merchant);
      if (merchant.replace(/[#\s]/gu, '').length < 2) return { kind: 'none', reason: 'merchant-unusable' };
      const key = merchant.toLowerCase();
      const hit = cache.get(key);
      if (hit) return hit;
      const result = await ai.respond({
        task: 'categorize',
        instructions: INSTRUCTIONS,
        prompt: `Merchant: ${merchant}`,
        schema: CATEGORY_SUGGESTION_SCHEMA,
        language: textLanguage(merchant, input.appLanguage),
        maxTokens: 32,
        timeoutMs: 6_000,
        cancelled: input.cancelled,
      });
      if (result.kind !== 'ok') return { kind: 'none', reason: result.kind };
      const category = acceptModelCategory(result.value.category);
      const advice: CategoryAdvice = category
        ? { kind: 'on-device-ai', category, provider: result.provider }
        : { kind: 'none', reason: 'model-unsure' };
      if (cache.size >= maxEntries) cache.delete(cache.keys().next().value!);
      cache.set(key, advice);
      return advice;
    },
    clear() { cache.clear(); },
  };
}

export const categoryAdvisor = createCategoryAdvisor();
// Session memory only. Ledger erase/restore, private mode and backgrounding
// drop cached merchant names along with other optional local-AI state.
onLocalSemanticBackgroundCancelled(() => categoryAdvisor.clear());
