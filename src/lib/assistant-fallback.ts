import { CATEGORIES } from '@/lib/categories';
import { monthKey, shiftMonthKey } from '@/lib/format';
import {
  assistantPlanFitsQuestion,
  type AssistantPlan,
  type AssistantTool,
} from '@/lib/assistant-contract';
import type { AssistantQueryResult } from '@/lib/assistant-query';
import type { AppState, CategoryId } from '@/lib/types';

const normalize = (value: string): string =>
  value.normalize('NFKC').toLocaleLowerCase().replace(/[^\p{L}\p{N}.]+/gu, ' ').trim();

const contains = (question: string, expression: RegExp): boolean => expression.test(question);

const GENERIC_QUERY_WORDS = new Set([
  'account', 'bill', 'business', 'card', 'expense', 'income', 'merchant', 'paid',
  'payment', 'payout', 'purchase', 'salary', 'sales', 'shop', 'spend', 'spent', 'transfer',
  'this', 'last', 'previous', 'current', 'month', 'year', 'show', 'find', 'list',
  'me', 'my', 'from', 'by', 'دخل', 'دفع', 'راتب', 'شراء', 'فاتورة', 'مبيعات',
  'تحويل', 'اعرض', 'هذا', 'هذه', 'الشهر', 'السنة', 'من',
  'how', 'much', 'what', 'which', 'when', 'where', 'did', 'do', 'does', 'i', 'we',
  'receive', 'received', 'pay', 'sent', 'send', 'get', 'got', 'the', 'a', 'an',
  'with', 'during', 'above', 'below', 'over', 'under', 'more', 'less', 'at', 'least',
  'most', 'aed', 'sar', 'usd', 'eur', 'inr', 'gbp', 'jod', 'kwd',
]);

const toolFor = (question: string): AssistantTool => {
  if (contains(question, /\bcash\s*out\b|نقد.*خارج|خرج.*حساب/iu)) return 'explain-cash-out';
  if (contains(question, /\b(?:paid|payments?|settled|payment history|history|which card|which account)\b|دفعت|سددت|سجل.*فواتير|أي.*بطاق|أي.*حساب/iu)) {
    return 'search-transactions';
  }
  if (contains(question, /\b(?:bill|bills|due|owed)\b|فاتور|مستحق/iu)) return 'list-bills';
  if (contains(question, /\b(?:subscription|subscriptions|recurring|monthly)\b|اشتراك|متكرر/iu)) {
    return 'list-recurring';
  }
  if (contains(question, /\b(?:total|summary|summarize|net|overall)\b|ملخص|إجمالي|الصافي/iu)) {
    return 'summarize-period';
  }
  return 'search-transactions';
};

const categoryFor = (question: string): CategoryId | null => {
  const direct = CATEGORIES.find((row) =>
    question.includes(normalize(row.label)) || question.includes(normalize(row.labelAr)));
  if (direct) return direct.id;
  if (/internet|mobile|phone|اتصال|إنترنت/iu.test(question)) return 'telecom';
  if (/electric|water|utility|كهرب|مياه|مرافق/iu.test(question)) return 'utilities';
  if (/salary|payroll|wage|راتب/iu.test(question)) return 'salary';
  if (/payout|sales|business|تجاري|مبيعات/iu.test(question)) return 'business';
  return null;
};

const merchantFor = (question: string, state: AppState): string | null => {
  const titles = [...new Set(state.transactions.map((row) => row.title.trim()).filter(Boolean))]
    .sort((a, b) => b.length - a.length);
  return titles.find((title) => {
    const key = normalize(title);
    if (key.length >= 3 && question.includes(key)) return true;
    const distinctive = key.split(' ')
      .filter((token) => token.length >= 4 && !GENERIC_QUERY_WORDS.has(token));
    return distinctive.length > 0 && distinctive.every((token) => question.includes(token));
  }) ?? null;
};

const namedQueryFor = (question: string): string | null => {
  const patterns = [
    /\b(?:income|payments?|payouts?|refunds?)\s+(?:from|by)\s+([\p{L}\p{N}][\p{L}\p{N} ]{1,60}?)(?=\s+(?:this|last|previous|current|in|during|above|below)\b|$)/u,
    /\b(?:show|find|list)\s+(?:me\s+|my\s+)?([\p{L}\p{N}][\p{L}\p{N} ]{1,60}?)\s+(?:income|payments?|payouts?|expenses?|spending|transactions?)\b/u,
    /\bfrom\s+([\p{L}\p{N}][\p{L}\p{N} ]{1,60}?)(?=\s+(?:this|last|previous|current|in|during|above|below)\b|$)/u,
    /\bdid\s+([\p{L}\p{N}][\p{L}\p{N} ]{1,60}?)\s+(?:pay|send)\s+(?:me|us)\b/u,
    /(?:دخل|مبيعات|دفعات)\s+(?:من\s+)?([\p{L}\p{N}][\p{L}\p{N} ]{1,60}?)(?=\s+(?:هذا|هذه|الشهر|السنة|السابق|الماضي)\b|$)/u,
  ];
  for (const pattern of patterns) {
    const candidate = pattern.exec(question)?.[1]?.trim() ?? '';
    const tokens = candidate.split(' ').filter(Boolean);
    if (tokens.some((token) => token.length >= 3 && !GENERIC_QUERY_WORDS.has(token))) {
      return candidate;
    }
  }
  return null;
};

const amountAfter = (question: string, expression: RegExp): string | null => {
  const match = expression.exec(question);
  return match?.[1]?.replace(/,/g, '') ?? null;
};

/**
 * Safe fallback when a local model is absent or emits invalid JSON.
 *
 * It intentionally recognizes only obvious phrasing. A fuzzy guess here can
 * select the wrong ledger scope, whereas returning a broad search is visible
 * and correctable from the source rows.
 */
const buildFallbackPlan = (
  rawQuestion: string,
  state: AppState,
  now = new Date(),
): AssistantPlan => {
  const question = normalize(rawQuestion);
  const current = monthKey(now);
  let period: AssistantPlan['period'] = 'current-month';
  if (/last month|previous month|الشهر الماضي|الشهر السابق/iu.test(question)) {
    period = 'previous-month';
  } else if (/this year|current year|هذه السنة|هذا العام/iu.test(question)) {
    period = 'current-year';
  } else if (/all time|ever|كل الوقت|منذ البداية/iu.test(question)) {
    period = 'all-time';
  }
  const account = state.accounts.find((row) => question.includes(normalize(row.name)))?.name ?? null;
  const merchant = merchantFor(question, state) ?? namedQueryFor(question);
  const direction = /\b(?:transfer|transfers)\b|تحويل/iu.test(question)
    ? 'transfer'
    : /\b(?:income|salary|payout|received|credited)\b|دخل|راتب|إيداع/iu.test(question)
      ? 'income'
      : /\b(?:spend|spent|spending|expense|purchase|paid|debited)\b|صرف|مصروف|شراء|دفع/iu.test(question)
        ? 'expense'
        : 'any';
  const minimumMajor = amountAfter(
    question,
    /(?:above|over|more than|at least|أكثر من|فوق)\s*(?:[a-z]{3}\s*)?([0-9][0-9,.]*)/iu,
  );
  const maximumMajor = amountAfter(
    question,
    /(?:below|under|less than|at most|أقل من|تحت)\s*(?:[a-z]{3}\s*)?([0-9][0-9,.]*)/iu,
  );
  // Month names adjacent to today are common enough to resolve without the
  // model inventing a date range. Everything else stays in the current scope.
  const previousName = new Intl.DateTimeFormat('en', { month: 'long' })
    .format(new Date(`${shiftMonthKey(current, -1)}-15T12:00:00`)).toLowerCase();
  if (question.includes(previousName)) period = 'previous-month';
  return {
    tool: toolFor(question),
    period,
    from: null,
    to: null,
    query: merchant,
    direction,
    category: categoryFor(question),
    account,
    minimumMajor,
    maximumMajor,
  };
};

const unresolvedSpecificTerms = (question: string): string[] =>
  question.split(' ').filter((token) =>
    token.length >= 3 && !/^\d+(?:\.\d+)?$/.test(token) && !GENERIC_QUERY_WORDS.has(token));

export interface AssistantFallbackResult {
  plan: AssistantPlan;
  unsupportedReason: Extract<
    AssistantQueryResult['unsupportedReason'],
    'historical-bills' | 'ambiguous-query'
  > | null;
}

/** Preserve named constraints or fail closed; never broaden a user question. */
export const fallbackAssistantQuestion = (
  rawQuestion: string,
  state: AppState,
  now = new Date(),
): AssistantFallbackResult => {
  const plan = buildFallbackPlan(rawQuestion, state, now);
  if (!assistantPlanFitsQuestion(plan, rawQuestion) ||
    (plan.tool === 'list-bills' && plan.period !== 'current-month')) {
    return { plan, unsupportedReason: 'historical-bills' };
  }
  const question = normalize(rawQuestion);
  const hasSafeConstraint = plan.query !== null || plan.account !== null || plan.category !== null ||
    plan.minimumMajor !== null || plan.maximumMajor !== null;
  if (plan.tool === 'search-transactions' && !hasSafeConstraint &&
    unresolvedSpecificTerms(question).length > 0) {
    return { plan, unsupportedReason: 'ambiguous-query' };
  }
  return { plan, unsupportedReason: null };
};
