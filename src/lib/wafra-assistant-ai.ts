import type {
  AssistantAnswer,
  AssistantTool,
  AssistantToolRequest,
} from '@/lib/wafra-assistant';
import { EXPENSE_CATEGORIES, INCOME_CATEGORIES } from '@/lib/categories';

const ASSISTANT_CATEGORY_IDS = new Set<string>([...EXPENSE_CATEGORIES, ...INCOME_CATEGORIES].map((category) => category.id));
const PERIOD_FILTER_ARGUMENTS = ['period', 'accountIds', 'merchant', 'category',
  'merchants', 'categories', 'excludedMerchants', 'excludedCategories', 'excludedAccountIds'] as const;

/**
 * Provider-neutral catalog for the future interpretation model.
 *
 * The model gets these capabilities plus the user's question. It does not get
 * the ledger, SMS bodies, account numbers, or transaction history in order to
 * choose a tool. Wafra executes the chosen tool locally afterwards. Account
 * identifiers must be resolved locally, never invented by a model.
 */
export const ASSISTANT_TOOL_CATALOG: readonly {
  tool: AssistantTool;
  purpose: string;
  arguments: readonly string[];
}[] = [
  { tool: 'help', purpose: 'Explain what financial questions Wafra can answer', arguments: [] },
  { tool: 'spending-total', purpose: 'Total recorded economic spending, with optional locally resolved filters', arguments: PERIOD_FILTER_ARGUMENTS },
  { tool: 'income-total', purpose: 'Total recorded income, with optional account, source or income-category filters', arguments: PERIOD_FILTER_ARGUMENTS },
  { tool: 'merchant-breakdown', purpose: 'Spending at one exact known merchant', arguments: PERIOD_FILTER_ARGUMENTS },
  { tool: 'category-breakdown', purpose: 'Spending inside one Wafra category, including split allocations', arguments: PERIOD_FILTER_ARGUMENTS },
  { tool: 'subscriptions', purpose: 'Active recurring subscriptions and monthly equivalent', arguments: [] },
  { tool: 'compare-periods', purpose: 'Compare filtered spending with an explicit comparison period or matching elapsed preceding period', arguments: [...PERIOD_FILTER_ARGUMENTS, 'comparisonPeriod'] },
  { tool: 'top-merchants', purpose: 'Largest merchants by recorded spending', arguments: [...PERIOD_FILTER_ARGUMENTS, 'limit'] },
  { tool: 'top-categories', purpose: 'Largest categories by recorded spending', arguments: [...PERIOD_FILTER_ARGUMENTS, 'limit'] },
  { tool: 'largest-purchases', purpose: 'Largest individual purchases in a period', arguments: [...PERIOD_FILTER_ARGUMENTS, 'limit'] },
  { tool: 'daily-average', purpose: 'Average recorded spending per elapsed day', arguments: PERIOD_FILTER_ARGUMENTS },
  { tool: 'net-income-spending', purpose: 'Recorded income minus economic spending', arguments: PERIOD_FILTER_ARGUMENTS },
  { tool: 'upcoming-payments', purpose: 'Bills, card dues and subscriptions due soon', arguments: ['withinDays'] },
  { tool: 'cash-outflow', purpose: 'Recorded cash outflow, optionally for locally resolved accounts', arguments: ['period', 'accountIds', 'excludedAccountIds'] },
  { tool: 'month-forecast', purpose: 'Current-month pace estimate when observed history is sufficient', arguments: PERIOD_FILTER_ARGUMENTS },
  { tool: 'recurring-changes', purpose: 'Review comparable recorded recurring-charge changes', arguments: PERIOD_FILTER_ARGUMENTS },
  { tool: 'unusual-charges', purpose: 'Review purchases unusually high against established earlier history', arguments: PERIOD_FILTER_ARGUMENTS },
  { tool: 'possible-duplicates', purpose: 'Review possible duplicate purchases without changing any records', arguments: PERIOD_FILTER_ARGUMENTS },
  { tool: 'data-coverage', purpose: 'Describe recorded activity and known import limitations without claiming full bank coverage', arguments: PERIOD_FILTER_ARGUMENTS },
] as const;

export interface AssistantInterpretationEnvelope {
  v: 1;
  question: string;
  tools: typeof ASSISTANT_TOOL_CATALOG;
}

/** Input for the first model call: language only, no financial data. */
export function buildAssistantInterpretationEnvelope(question: string): AssistantInterpretationEnvelope {
  return {
    v: 1,
    question: question.trim().slice(0, 1_000),
    tools: ASSISTANT_TOOL_CATALOG,
  };
}

export interface AssistantExplanationEnvelope {
  v: 1;
  question: string;
  tool: AssistantTool;
  result: {
    title: string;
    body: string;
    facts: { label: string; value: string }[];
    data: Record<string, string | number | boolean | null>;
  };
  instruction: string;
}

/**
 * Input for an optional second model call after Wafra has done the math.
 *
 * Only the already-presentable result crosses the boundary. There is no route
 * here for raw SMS text, card/account identifiers, or arbitrary ledger rows.
 */
export function buildAssistantExplanationEnvelope(
  question: string,
  answer: AssistantAnswer,
): AssistantExplanationEnvelope {
  return {
    v: 1,
    question: question.trim().slice(0, 1_000),
    tool: answer.tool,
    result: {
      title: answer.title,
      body: answer.body,
      facts: (answer.facts ?? []).slice(0, 10).map((fact) => ({
        label: fact.label.slice(0, 160),
        value: fact.value.slice(0, 80),
      })),
      data: safeExplanationData(answer.data),
    },
    instruction:
      'Explain the supplied Wafra result clearly. Never invent, recompute, or alter financial figures. Say when the supplied data is insufficient.',
  };
}

/**
 * Defence in depth for the future provider boundary. Executor-owned answers do
 * not currently expose any of these fields, but this keeps an accidental
 * account/card/message identifier from crossing the boundary if a later tool
 * adds richer local result data.
 */
function safeExplanationData(
  data: AssistantAnswer['data'],
): Record<string, string | number | boolean | null> {
  if (!data) return {};
  const safe: Record<string, string | number | boolean | null> = {};
  for (const [key, value] of Object.entries(data)) {
    const normalizedKey = key.replace(/[^a-z0-9]/gi, '').toLowerCase();
    if (
      normalizedKey.includes('rawsms') ||
      normalizedKey.includes('rawmessage') ||
      normalizedKey.includes('accountid') ||
      normalizedKey.includes('cardid') ||
      normalizedKey.includes('transactionid') ||
      normalizedKey.includes('identifier')
    ) continue;
    if (value !== null && !['string', 'number', 'boolean'].includes(typeof value)) continue;
    if (typeof value === 'number' && !Number.isFinite(value)) continue;
    safe[key.slice(0, 80)] = typeof value === 'string' ? value.slice(0, 160) : value;
  }
  return safe;
}

/**
 * Narrow validator for a provider-produced plan before it can touch the local
 * executor. The exhaustive switch makes adding a new tool an explicit product
 * decision rather than silently granting a model new authority.
 */
export function isAssistantToolRequest(value: unknown): value is AssistantToolRequest {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return false;
  const candidate = value as Record<string, unknown>;
  if (typeof candidate.tool !== 'string') return false;
  const catalog = ASSISTANT_TOOL_CATALOG.find((item) => item.tool === candidate.tool);
  if (!catalog || !onlyKeys(candidate, ['tool', ...catalog.arguments])) return false;
  if (candidate.accountIds !== undefined && (!Array.isArray(candidate.accountIds) ||
    candidate.accountIds.length === 0 || candidate.accountIds.length > 20 ||
    !candidate.accountIds.every((id) => validName(id)))) return false;
  if (candidate.merchant !== undefined && !validName(candidate.merchant)) return false;
  if (candidate.category !== undefined && (typeof candidate.category !== 'string' ||
    !ASSISTANT_CATEGORY_IDS.has(candidate.category))) return false;
  for (const key of ['merchants', 'excludedMerchants', 'excludedAccountIds'] as const) {
    const values = candidate[key];
    if (values !== undefined && (!Array.isArray(values) || values.length > 20 ||
      values.length === 0 || !values.every(validName))) return false;
  }
  for (const key of ['categories', 'excludedCategories'] as const) {
    const values = candidate[key];
    if (values !== undefined && (!Array.isArray(values) || values.length > 20 ||
      values.length === 0 || !values.every((item) => typeof item === 'string' && ASSISTANT_CATEGORY_IDS.has(item)))) return false;
  }
  if (candidate.merchant !== undefined && candidate.merchants !== undefined) return false;
  if (candidate.category !== undefined && candidate.categories !== undefined) return false;
  if (candidate.comparisonPeriod !== undefined && !validPeriod(candidate.comparisonPeriod)) return false;

  switch (candidate.tool) {
    case 'help':
    case 'subscriptions':
      return true;
    case 'upcoming-payments':
      return candidate.withinDays === undefined ||
        (Number.isSafeInteger(candidate.withinDays) && (candidate.withinDays as number) > 0 &&
          (candidate.withinDays as number) <= 90);
    case 'merchant-breakdown':
      return validPeriod(candidate.period) && typeof candidate.merchant === 'string' &&
        candidate.merchant.trim().length > 0 && candidate.merchant.length <= 160;
    case 'category-breakdown':
      return validPeriod(candidate.period) && typeof candidate.category === 'string' &&
        ASSISTANT_CATEGORY_IDS.has(candidate.category);
    case 'top-merchants':
    case 'top-categories':
    case 'largest-purchases':
      return validPeriod(candidate.period) &&
        (candidate.limit === undefined ||
          (Number.isSafeInteger(candidate.limit) && (candidate.limit as number) >= 1 &&
            (candidate.limit as number) <= 10));
    case 'spending-total':
    case 'income-total':
    case 'compare-periods':
    case 'daily-average':
    case 'net-income-spending':
    case 'cash-outflow':
    case 'month-forecast':
    case 'recurring-changes':
    case 'unusual-charges':
    case 'possible-duplicates':
    case 'data-coverage':
      return validPeriod(candidate.period);
    default:
      return false;
  }
}

function validName(value: unknown): value is string {
  return typeof value === 'string' && value.trim().length > 0 && value.length <= 160;
}

function onlyKeys(value: Record<string, unknown>, allowed: readonly string[]): boolean {
  return Object.keys(value).every((key) => allowed.includes(key));
}

function validPeriod(value: unknown): boolean {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return false;
  const period = value as Record<string, unknown>;
  if (period.mode === 'all') return onlyKeys(period, ['mode']);
  if (period.mode === 'month') return onlyKeys(period, ['mode', 'key']) && typeof period.key === 'string' && validMonthKey(period.key);
  if (period.mode === 'year') return onlyKeys(period, ['mode', 'year']) && Number.isSafeInteger(period.year) &&
    (period.year as number) >= 2000 && (period.year as number) <= 2200;
  if (period.mode === 'range') {
    return onlyKeys(period, ['mode', 'from', 'to']) && typeof period.from === 'string' && typeof period.to === 'string' &&
      validISODate(period.from) && validISODate(period.to) &&
      period.from <= period.to;
  }
  return false;
}

function validMonthKey(value: string): boolean {
  const match = /^(\d{4})-(\d{2})$/.exec(value);
  if (!match) return false;
  const year = Number(match[1]);
  const month = Number(match[2]);
  return year >= 2000 && year <= 2200 && month >= 1 && month <= 12;
}

function validISODate(value: string): boolean {
  const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(value);
  if (!match) return false;
  const year = Number(match[1]);
  const month = Number(match[2]);
  const day = Number(match[3]);
  if (year < 2000 || year > 2200 || month < 1 || month > 12 || day < 1 || day > 31) return false;
  const date = new Date(Date.UTC(year, month - 1, day));
  return date.getUTCFullYear() === year && date.getUTCMonth() === month - 1 && date.getUTCDate() === day;
}
