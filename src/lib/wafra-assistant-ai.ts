import type {
  AssistantAnswer,
  AssistantTool,
  AssistantToolRequest,
} from '@/lib/wafra-assistant';
import { EXPENSE_CATEGORIES } from '@/lib/categories';

const ASSISTANT_CATEGORY_IDS = new Set<string>(EXPENSE_CATEGORIES.map((category) => category.id));

/**
 * Provider-neutral catalog for the future interpretation model.
 *
 * The model gets these capabilities plus the user's question. It does not get
 * the ledger, SMS bodies, account numbers, or transaction history in order to
 * choose a tool. Wafra executes the chosen tool locally afterwards.
 */
export const ASSISTANT_TOOL_CATALOG: readonly {
  tool: AssistantTool;
  purpose: string;
  arguments: readonly string[];
}[] = [
  { tool: 'spending-total', purpose: 'Total economic spending for a period', arguments: ['period'] },
  { tool: 'income-total', purpose: 'Total income for a period', arguments: ['period'] },
  { tool: 'merchant-breakdown', purpose: 'Spending at one known merchant', arguments: ['period', 'merchant'] },
  { tool: 'category-breakdown', purpose: 'Spending inside one Wafra category', arguments: ['period', 'category'] },
  { tool: 'subscriptions', purpose: 'Active recurring subscriptions and monthly equivalent', arguments: [] },
  { tool: 'compare-periods', purpose: 'Compare spending with the preceding equivalent period', arguments: ['period'] },
  { tool: 'top-merchants', purpose: 'Largest merchants by spending', arguments: ['period', 'limit'] },
  { tool: 'top-categories', purpose: 'Largest categories by spending', arguments: ['period', 'limit'] },
  { tool: 'upcoming-payments', purpose: 'Bills, card dues and subscriptions due soon', arguments: ['withinDays'] },
  { tool: 'cash-outflow', purpose: 'Cash that actually left funded accounts', arguments: ['period'] },
  { tool: 'month-forecast', purpose: 'Conservative current-month spending pace forecast', arguments: ['period'] },
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

  switch (candidate.tool) {
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
      return validPeriod(candidate.period) &&
        (candidate.limit === undefined ||
          (Number.isSafeInteger(candidate.limit) && (candidate.limit as number) >= 1 &&
            (candidate.limit as number) <= 10));
    case 'spending-total':
    case 'income-total':
    case 'compare-periods':
    case 'cash-outflow':
    case 'month-forecast':
      return validPeriod(candidate.period);
    default:
      return false;
  }
}

function validPeriod(value: unknown): boolean {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return false;
  const period = value as Record<string, unknown>;
  if (period.mode === 'all') return true;
  if (period.mode === 'month') return typeof period.key === 'string' && validMonthKey(period.key);
  if (period.mode === 'year') return Number.isSafeInteger(period.year) &&
    (period.year as number) >= 2000 && (period.year as number) <= 2200;
  if (period.mode === 'range') {
    return typeof period.from === 'string' && typeof period.to === 'string' &&
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
