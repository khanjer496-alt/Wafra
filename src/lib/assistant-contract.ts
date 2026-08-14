import type { CategoryId } from '@/lib/types';

export const ASSISTANT_CONTRACT_VERSION = 1;
export const ASSISTANT_TOOLS = [
  'search-transactions',
  'summarize-period',
  'explain-cash-out',
  'list-bills',
  'list-recurring',
] as const;
export const ASSISTANT_PERIODS = [
  'current-month',
  'previous-month',
  'current-year',
  'all-time',
  'range',
] as const;
export const ASSISTANT_DIRECTIONS = ['any', 'income', 'expense', 'transfer'] as const;

export type AssistantTool = typeof ASSISTANT_TOOLS[number];
export type AssistantPeriodMode = typeof ASSISTANT_PERIODS[number];
export type AssistantDirection = typeof ASSISTANT_DIRECTIONS[number];

/** Closed, value-free plan produced by the model. It can query, never write. */
export interface AssistantPlan {
  tool: AssistantTool;
  period: AssistantPeriodMode;
  from: string | null;
  to: string | null;
  query: string | null;
  direction: AssistantDirection;
  category: CategoryId | null;
  account: string | null;
  minimumMajor: string | null;
  maximumMajor: string | null;
}

export interface AssistantPlanningContext {
  todayISO: string;
  currency: string;
  categories: readonly CategoryId[];
  accounts: readonly string[];
  language: 'en' | 'ar';
}

const CATEGORY_IDS: readonly CategoryId[] = [
  'groceries', 'dining', 'transport', 'cash-withdrawal', 'utilities', 'telecom',
  'rent', 'shopping', 'health', 'personal-care', 'home-services', 'education',
  'travel', 'entertainment', 'software', 'investing', 'charity', 'government',
  'loan', 'salary', 'business', 'other',
];
const PLAN_KEYS = [
  'account', 'category', 'direction', 'from', 'maximumMajor', 'minimumMajor',
  'period', 'query', 'to', 'tool',
];
const ISO_DATE_RE = /^\d{4}-\d{2}-\d{2}$/;
const MAJOR_RE = /^\d{1,12}(?:\.\d{1,3})?$/;

const nullableString = (value: unknown, max: number): value is string | null =>
  value === null || (typeof value === 'string' && value.trim().length <= max);

/** Reject expanded, malformed or write-capable model output. */
export const parseAssistantPlan = (value: unknown): AssistantPlan | null => {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return null;
  const row = value as Record<string, unknown>;
  if (Object.keys(row).sort().join('|') !== PLAN_KEYS.join('|')) return null;
  if (!ASSISTANT_TOOLS.includes(row.tool as AssistantTool)) return null;
  if (!ASSISTANT_PERIODS.includes(row.period as AssistantPeriodMode)) return null;
  if (!ASSISTANT_DIRECTIONS.includes(row.direction as AssistantDirection)) return null;
  if (row.category !== null && !CATEGORY_IDS.includes(row.category as CategoryId)) return null;
  if (!nullableString(row.query, 120) || !nullableString(row.account, 80)) return null;
  if (!nullableString(row.from, 10) || !nullableString(row.to, 10)) return null;
  if (row.from !== null && !ISO_DATE_RE.test(row.from)) return null;
  if (row.to !== null && !ISO_DATE_RE.test(row.to)) return null;
  if (!nullableString(row.minimumMajor, 20) || !nullableString(row.maximumMajor, 20)) return null;
  if (row.minimumMajor !== null && !MAJOR_RE.test(row.minimumMajor)) return null;
  if (row.maximumMajor !== null && !MAJOR_RE.test(row.maximumMajor)) return null;
  if (row.period === 'range' && (!row.from || !row.to || row.from > row.to)) return null;
  if (row.tool === 'list-bills' && row.period !== 'current-month') return null;
  return row as unknown as AssistantPlan;
};

const HISTORICAL_BILL_QUESTION = /\b(?:paid|payments?|settled|payment history|history|last|previous|yesterday|which card|which account|january|february|march|april|may|june|july|august|september|october|november|december|20\d{2})\b|دفعت|سددت|سجل.*فواتير|السابق|الماضي|أمس|أي.*بطاق|أي.*حساب/iu;

/** A valid plan must also preserve the time meaning of the original question. */
export const assistantPlanFitsQuestion = (plan: AssistantPlan, question: string): boolean =>
  !(plan.tool === 'list-bills' && HISTORICAL_BILL_QUESTION.test(question));

export const ASSISTANT_PLAN_SCHEMA = {
  type: 'object',
  additionalProperties: false,
  required: PLAN_KEYS,
  properties: {
    tool: { type: 'string', enum: ASSISTANT_TOOLS },
    period: { type: 'string', enum: ASSISTANT_PERIODS },
    from: { type: ['string', 'null'] },
    to: { type: ['string', 'null'] },
    query: { type: ['string', 'null'] },
    direction: { type: 'string', enum: ASSISTANT_DIRECTIONS },
    category: { type: ['string', 'null'], enum: [...CATEGORY_IDS, null] },
    account: { type: ['string', 'null'] },
    minimumMajor: { type: ['string', 'null'] },
    maximumMajor: { type: ['string', 'null'] },
  },
} as const;

export const assistantSystemPrompt = (context: AssistantPlanningContext): string => `You route questions about a private money ledger into one read-only tool. Return JSON only.

Today: ${context.todayISO}. Ledger currency: ${context.currency}. UI language: ${context.language}.
Available account names: ${context.accounts.join(', ') || 'none'}.
Category IDs: ${context.categories.join(', ')}.

Rules:
- Never answer the question and never calculate money. Select a tool and filters only.
- search-transactions finds named merchants, payers, transfers, salaries or individual entries.
- summarize-period answers overall income/spending/net questions.
- explain-cash-out explains money that left bank/debit/cash accounts including card repayments once.
- list-bills answers only the current open/due saved bill status; always use current-month.
- Questions about a paid bill, payment history, or which card/account paid it must use search-transactions.
- list-recurring answers subscriptions and repeated commitments.
- Put a merchant/person phrase in query, without filler words. Keep proper names unchanged.
- direction is transfer only when the user explicitly asks for transfers.
- Amount fields are decimal major units as strings, without a currency symbol.
- Use range only when both exact ISO dates are present. Otherwise choose the closest named period.
- All unused nullable fields must be null.`;
