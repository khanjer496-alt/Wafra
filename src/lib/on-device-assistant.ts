import { CATEGORIES } from '@/lib/categories';
import {
  onDeviceAI as defaultOnDeviceAI,
  textLanguage,
  type OnDeviceAI,
  type OnDeviceAILanguage,
  type OnDeviceClosedSchema,
} from '@/lib/on-device-ai';
import { currentMonthPeriod, previousPeriod, type Period } from '@/lib/period';
import type { AssistantTool, AssistantToolRequest } from '@/lib/wafra-assistant';
import { ASSISTANT_TOOL_CATALOG, isAssistantToolRequest } from '@/lib/wafra-assistant-ai';

/**
 * Ask Wafra's platform-model fallback.
 *
 * Runs only when the deterministic planner recognised nothing (exact plain
 * Help) in a fresh question. The model sees the question and the closed tool
 * catalog, never the ledger. It may choose ONE catalog tool plus closed
 * arguments; Wafra then:
 *   - resolves the period itself from explicit wording (the model's period
 *     choice must agree with that wording or the plan is rejected);
 *   - refuses questions carrying dates it cannot map (digits, month names,
 *     weekdays, relative days/weeks): the deterministic planner owns dates;
 *   - accepts a merchant only if it is copied from the question;
 *   - never accepts account, card or bill identifiers from the model;
 *   - runs the result through `isAssistantToolRequest`, then the ledger
 *     executor computes every figure.
 */

/** Tools a model may choose. Obligation status needs locally resolved identifiers. */
export const ON_DEVICE_ASK_TOOLS: readonly AssistantTool[] = ASSISTANT_TOOL_CATALOG
  .map((entry) => entry.tool)
  .filter((tool) => tool !== 'help' && tool !== 'obligation-status');
// credit-card-settlement-summary is offered without a month only: its
// monthKey semantics are left to the deterministic planner.

const PERIOD_CHOICES = ['default', 'this-month', 'last-month', 'this-year', 'last-year', 'all-time'] as const;
type PeriodChoice = typeof PERIOD_CHOICES[number];
const ACCOUNT_KIND_CHOICES = ['none', 'all', 'bank', 'card', 'credit-card', 'debit-card'] as const;
const METRIC_CHOICES = ['default', 'amount', 'count'] as const;
const BASELINE_CHOICES = ['none', 'highest-month', 'typical-month', 'closest-month', 'last-similar-month'] as const;
const CATEGORY_IDS: readonly string[] = CATEGORIES.map((category) => category.id);

export const ASK_PLAN_SCHEMA: OnDeviceClosedSchema = Object.freeze({
  name: 'WafraAskPlan',
  fields: Object.freeze([
    { name: 'tool', description: 'The one Wafra tool that answers the question, or none', choices: [...ON_DEVICE_ASK_TOOLS, 'none'] },
    { name: 'period', description: 'The time range the question names; default when it names none', choices: PERIOD_CHOICES },
    { name: 'category', description: 'A Wafra category the question is about, or none', choices: [...CATEGORY_IDS, 'none'] },
    { name: 'merchant', description: 'A shop or merchant name copied exactly from the question, or an empty string', maxLength: 80 },
    { name: 'accountKind', description: 'Kind of account the question is about', choices: ACCOUNT_KIND_CHOICES },
    { name: 'metric', description: 'Rank accounts by amount or by purchase count', choices: METRIC_CHOICES },
    { name: 'baseline', description: 'For comparisons with past months only', choices: BASELINE_CHOICES },
  ]),
});

const INSTRUCTIONS = [
  'You route a question about the user\'s own recorded money to one tool of a personal finance app.',
  'You never see the user\'s data and you never calculate, estimate or state any amount.',
  'Choose the single tool whose purpose answers the question. Choose none when the question is not about the user\'s recorded transactions, accounts, bills or subscriptions, or when no tool fits.',
  'Fill only the fields the question states. Use default, none or an empty string otherwise. Copy a merchant name exactly as the user wrote it.',
  'The question may be in English or Arabic.',
  'Tools:',
  ...ASSISTANT_TOOL_CATALOG
    .filter((entry) => ON_DEVICE_ASK_TOOLS.includes(entry.tool))
    .map((entry) => `- ${entry.tool}: ${entry.purpose}`),
  `Categories: ${CATEGORIES.map((category) => `${category.id} (${category.label})`).join(', ')}`,
].join('\n');

const normalize = (value: string): string => value.normalize('NFKC').toLowerCase()
  .replace(/[\u064B-\u065F\u0670]/gu, '').replace(/\s+/gu, ' ').trim();

// Anything naming a specific date or a span other than the closed choices
// belongs to the deterministic planner.
const EXPLICIT_DATE = new RegExp([
  '[0-9٠-٩۰-۹]',
  '\\b(?:jan(?:uary)?|feb(?:ruary)?|mar(?:ch)?|apr(?:il)?|may|june?|july?|aug(?:ust)?|sep(?:t(?:ember)?)?|oct(?:ober)?|nov(?:ember)?|dec(?:ember)?)\\b',
  '\\b(?:mon|tues|wednes|thurs|fri|satur|sun)day\\b',
  '\\b(?:today|yesterday|tomorrow|tonight|weeks?|weekend|fortnight|quarter|days?|months|years|since|between|until|before|after|next|during|payday|q[1-4])\\b',
  '\\b(?:ramadan|ramadhan|eid|lately|recently|so far|summer|winter|spring|autumn|holidays?|morning|evening|night)\\b',
  'رمضان|عيد|مؤخرا|مؤخراً|أشهر|اشهر|شهور|سنوات|قبل|بعد|القادم|القادمة|الراتب|الصيف|الشتاء',
  'يناير|فبراير|مارس|أبريل|ابريل|مايو|يونيو|يوليو|أغسطس|اغسطس|سبتمبر|أكتوبر|اكتوبر|نوفمبر|ديسمبر',
  'كانون|شباط|آذار|اذار|نيسان|أيار|ايار|حزيران|تموز|آب|أيلول|ايلول|تشرين',
  'اليوم|أمس|امس|غدا|غداً|أسبوع|اسبوع|أيام|ايام|منذ|بين|حتى',
].join('|'), 'iu');

const PERIOD_HINTS: readonly [Exclude<PeriodChoice, 'default'>, RegExp][] = [
  ['last-month', /\b(?:last|previous|past) month\b|الشهر (?:الماضي|السابق)/iu],
  ['this-month', /\b(?:this|current) month\b|(?:هذا|هالـ?) ?الشهر|الشهر (?:الحالي|هذا)/iu],
  ['last-year', /\b(?:last|previous|past) year\b|السنة (?:الماضية|السابقة)|العام (?:الماضي|السابق)/iu],
  ['this-year', /\b(?:this|current) year\b|(?:هذه|هذي) السنة|(?:هذا|هالـ?) ?العام|السنة الحالية|العام الحالي/iu],
  ['all-time', /\b(?:all[- ]time|ever|overall|in total)\b|طوال الوقت|على الإطلاق/iu],
];

/** The period the question's own words name, if exactly one; 'default' if none; null if ambiguous. */
export function questionPeriodChoice(question: string): PeriodChoice | null {
  const hits = PERIOD_HINTS.filter(([, pattern]) => pattern.test(question)).map(([choice]) => choice);
  if (hits.length > 1) return null;
  return hits[0] ?? 'default';
}

const wordKey = (value: string): string => ` ${normalize(value).replace(/[^\p{L}\p{N}&']+/gu, ' ').trim()} `;
/** Whole-word, case/diacritic-insensitive containment. */
function containsWords(text: string, phrase: string): boolean {
  const needle = wordKey(phrase);
  return needle.trim().length >= 2 && wordKey(text).includes(needle);
}

function categoryNamed(question: string, id: string): boolean {
  const category = CATEGORIES.find((item) => item.id === id);
  return Boolean(category && [category.label, category.labelAr, id.replace(/-/g, ' ')]
    .some((label) => containsWords(question, label)));
}

// Account labels that are also ordinary finance words (and tool topics).
const GENERIC_ACCOUNT_WORDS = new Set(['cash', 'wallet', 'card', 'bank', 'savings', 'current', 'main', 'account',
  'credit card', 'debit card', 'نقد', 'نقدي', 'محفظة', 'بطاقة']);

const COMMON_CAPITALIZED = new Set(['i', 'wafra', 'what', 'how', 'show', 'give', 'tell', 'which', 'who', 'where', 'did',
  'do', 'is', 'are', 'can', 'my', 'please', 'list', 'compare', 'am', 'was', 'were', 'have', 'has']);
/**
 * An English capitalised word after the first word usually names a shop,
 * bank, card or person. If the plan does not carry it, answering would
 * silently drop that scope, so the plan is refused.
 */
function unexplainedProperNames(question: string, merchant: string | null): boolean {
  const words = question.replace(/[^\p{L}\p{N}&'\s]/gu, ' ').split(/\s+/u).filter(Boolean);
  const merchantWords = new Set((merchant ? wordKey(merchant).trim().split(' ') : []));
  return words.slice(1).some((word) => /^\p{Lu}/u.test(word) &&
    !COMMON_CAPITALIZED.has(word.toLowerCase()) && !merchantWords.has(normalize(word)));
}

export function mentionsUnmappedDate(question: string): boolean {
  return EXPLICIT_DATE.test(question);
}

/** Same resolution as the deterministic planner's parsePeriods, including the salary-day month. */
function resolvePeriod(choice: PeriodChoice, defaultPeriod: Period, now: Date): Period | null {
  switch (choice) {
    case 'this-month': return currentMonthPeriod(now);
    case 'last-month': return previousPeriod(currentMonthPeriod(now));
    case 'this-year': return { mode: 'year', year: now.getFullYear() };
    case 'last-year': return { mode: 'year', year: now.getFullYear() - 1 };
    case 'all-time': return { mode: 'all' };
    default: return defaultPeriod;
  }
}

/**
 * Turns validated model fields into a request the executor accepts, or null.
 * Pure: no model, clock or ledger access beyond the arguments.
 */
export function compileOnDeviceAskPlan(
  output: Readonly<Record<string, string>>,
  context: {
    question: string; defaultPeriod: Period; now: Date;
    /** Ledger merchant titles; a merchant must equal one of them. */
    knownMerchants?: readonly string[];
    /** Account/card/bank names; the plan cannot carry them, so naming one refuses. */
    knownAccountNames?: readonly string[];
  },
): AssistantToolRequest | null {
  const tool = output.tool as AssistantTool;
  if (!tool || tool === 'help' || !ON_DEVICE_ASK_TOOLS.includes(tool)) return null;
  const catalog = ASSISTANT_TOOL_CATALOG.find((entry) => entry.tool === tool);
  if (!catalog) return null;
  const accepts = (argument: string) => catalog.arguments.includes(argument);
  const question = context.question.trim();
  if (!question || question.length > 500 || mentionsUnmappedDate(question)) return null;

  const candidate: Record<string, unknown> = { tool };
  const expectedPeriod = questionPeriodChoice(question);
  if (expectedPeriod === null) return null;
  if (accepts('period')) {
    if (output.period !== expectedPeriod) return null;
    const period = resolvePeriod(expectedPeriod, context.defaultPeriod, context.now);
    if (!period) return null;
    candidate.period = period;
  } else if (output.period !== 'default' || expectedPeriod !== 'default') {
    return null;
  }

  // Scope must never silently widen: every named entity in the question has
  // to be carried by the plan, and the merchant must be a ledger merchant the
  // user actually named.
  const known = context.knownMerchants ?? [];
  const mentioned = known.filter((name) => containsWords(question, name));
  if ((context.knownAccountNames ?? []).some((name) => !GENERIC_ACCOUNT_WORDS.has(normalize(name)) &&
    containsWords(question, name))) return null;
  const merchantText = (output.merchant ?? '').trim();
  let merchant: string | null = null;
  if (merchantText) {
    if (!accepts('merchant') || !containsWords(question, merchantText)) return null;
    const matches = known.filter((name) => normalize(name) === normalize(merchantText));
    if (matches.length !== 1) return null;
    merchant = matches[0];
    candidate.merchant = merchant;
  } else if (tool === 'merchant-breakdown') {
    return null;
  }
  if (mentioned.some((name) => !merchant || normalize(name) !== normalize(merchant))) return null;
  if (unexplainedProperNames(question, merchant)) return null;

  if (output.category && output.category !== 'none') {
    if (!CATEGORY_IDS.includes(output.category)) return null;
    // category-breakdown is headed by the category label, so the scope is
    // visible; a category FILTER on another tool must be named by the user.
    if (tool === 'category-breakdown' || (accepts('category') && categoryNamed(question, output.category))) {
      candidate.category = output.category;
    }
  }
  if (tool === 'category-breakdown' && candidate.category === undefined) return null;

  // Numbers are never taken from the model: questions with digits never get
  // here, so a limit or day window could only be invented.
  if (output.accountKind && output.accountKind !== 'none' && accepts('accountKind')) candidate.accountKind = output.accountKind;
  if (output.metric && output.metric !== 'default' && accepts('metric')) candidate.metric = output.metric;
  if (accepts('baseline')) {
    if (!output.baseline || output.baseline === 'none') return null;
    candidate.baseline = output.baseline;
  }
  return isAssistantToolRequest(candidate) ? candidate : null;
}

const UNRECOGNIZED_HELP_KEYS = new Set(['tool', 'clarification', 'suggestions', 'unrecognized']);
/** Plain Help, or the planner's explicit "recognised nothing" Help. Safety clarifications never qualify. */
export function isExactPlainHelp(request: AssistantToolRequest): boolean {
  if (request.tool !== 'help') return false;
  const keys = Object.keys(request);
  if (keys.length === 1) return true;
  return (request as { unrecognized?: unknown }).unrecognized === true && keys.every((key) => UNRECOGNIZED_HELP_KEYS.has(key));
}

export type OnDeviceAskOutcome =
  | { source: 'on-device-ai'; request: AssistantToolRequest }
  | { source: 'deterministic'; request: AssistantToolRequest; reason: string };

export async function improveAssistantRequestOnDevice(input: {
  question: string;
  deterministicRequest: AssistantToolRequest;
  previousRequest?: AssistantToolRequest | null;
  defaultPeriod: Period;
  now: Date;
  knownMerchants?: readonly string[];
  knownAccountNames?: readonly string[];
  appLanguage: OnDeviceAILanguage;
  cancelled?: () => boolean;
  ai?: OnDeviceAI;
}): Promise<OnDeviceAskOutcome> {
  const keep = (reason: string): OnDeviceAskOutcome => ({ source: 'deterministic', request: input.deterministicRequest, reason });
  if (!isExactPlainHelp(input.deterministicRequest)) return keep('deterministic-plan-authoritative');
  if (input.previousRequest) return keep('conversation-context-present');
  const question = typeof input.question === 'string' ? input.question.trim() : '';
  if (!question || question.length > 500) return keep('invalid-question');
  if (mentionsUnmappedDate(question)) return keep('explicit-date');
  const ai = input.ai ?? defaultOnDeviceAI;
  const result = await ai.respond({
    task: 'ask-plan',
    instructions: INSTRUCTIONS,
    prompt: `Question: ${question}`,
    schema: ASK_PLAN_SCHEMA,
    language: textLanguage(question, input.appLanguage),
    maxTokens: 160,
    timeoutMs: 8_000,
    cancelled: input.cancelled,
  });
  if (input.cancelled?.()) return keep('cancelled');
  if (result.kind !== 'ok') return keep(result.kind);
  const request = compileOnDeviceAskPlan(result.value, {
    question, defaultPeriod: input.defaultPeriod, now: input.now,
    knownMerchants: input.knownMerchants, knownAccountNames: input.knownAccountNames,
  });
  return request ? { source: 'on-device-ai', request } : keep('plan-rejected');
}
