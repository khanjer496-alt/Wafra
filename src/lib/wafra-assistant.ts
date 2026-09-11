import { categoryLabel } from '@/lib/categories';
import { formatAED } from '@/lib/format';
import { internalTransferIds, isSpending, liveAccountIds } from '@/lib/ledger';
import { currentMonthPeriod, inPeriod, previousPeriod, type Period } from '@/lib/period';
import { activeSubscriptions, detectSubscriptions, trueSubscriptions } from '@/lib/subscriptions';
import type { AppState, CategoryId, Transaction } from '@/lib/types';

export type AssistantTool =
  | 'spending-total'
  | 'income-total'
  | 'merchant-breakdown'
  | 'category-breakdown'
  | 'subscriptions'
  | 'compare-periods';

export interface AssistantAnswer {
  tool: AssistantTool;
  title: string;
  body: string;
  facts?: { label: string; value: string }[];
}

const normalize = (value: string) => value.trim().toLowerCase();

function ledgerScope(state: AppState) {
  const live = liveAccountIds(state.accounts);
  const internal = internalTransferIds(state.transactions, state.accounts);
  return { live, internal };
}

function spendingRows(state: AppState, period: Period): Transaction[] {
  const { live, internal } = ledgerScope(state);
  return state.transactions.filter((tx) => inPeriod(tx.date, period) && isSpending(tx, live, internal));
}

function incomeRows(state: AppState, period: Period): Transaction[] {
  const { live, internal } = ledgerScope(state);
  return state.transactions.filter((tx) =>
    inPeriod(tx.date, period) &&
    live.has(tx.accountId) &&
    !internal.has(tx.id) &&
    tx.type === 'income' &&
    !tx.isTransfer,
  );
}

function total(rows: Transaction[]): number {
  return rows.reduce((sum, tx) => sum + tx.amountFils, 0);
}

function selectedPeriod(question: string, now: Date): Period {
  const current = currentMonthPeriod(now);
  if (/last month|previous month|الشهر الماضي|الشهر السابق/.test(question)) {
    return previousPeriod(current) ?? current;
  }
  return current;
}

function merchantFromQuestion(question: string, rows: Transaction[]): string | null {
  const q = normalize(question);
  const titles = [...new Set(rows.map((tx) => tx.title.trim()).filter(Boolean))]
    .sort((a, b) => b.length - a.length);
  return titles.find((title) => q.includes(normalize(title))) ?? null;
}

function categoryFromQuestion(question: string): CategoryId | null {
  const q = normalize(question);
  const aliases: [RegExp, CategoryId][] = [
    [/dining|restaurant|food|eating out|مطاعم|أكل/, 'dining'],
    [/grocery|groceries|supermarket|بقالة|سوبرماركت/, 'groceries'],
    [/transport|taxi|careem|uber|مواصلات/, 'transport'],
    [/shopping|shops|تسوق/, 'shopping'],
    [/software|apps|subscriptions software|برامج|برمجيات/, 'software'],
    [/utilities|electricity|water|مرافق|كهرباء|ماء/, 'utilities'],
    [/telecom|phone|mobile|اتصالات/, 'telecom'],
    [/rent|إيجار/, 'rent'],
    [/travel|flight|hotel|سفر/, 'travel'],
    [/entertainment|movies|gaming|ترفيه/, 'entertainment'],
  ];
  return aliases.find(([pattern]) => pattern.test(q))?.[1] ?? null;
}

export function answerWafraQuestion(
  state: AppState,
  question: string,
  now = new Date(),
): AssistantAnswer {
  const q = normalize(question);
  const period = selectedPeriod(q, now);
  const spending = spendingRows(state, period);
  const income = incomeRows(state, period);

  if (/subscription|subscriptions|اشتراك|اشتراكات/.test(q)) {
    const { live, internal } = ledgerScope(state);
    const subs = activeSubscriptions(trueSubscriptions(
      detectSubscriptions(state.transactions, state.notSubscriptions, now, live, internal),
    )).sort((a, b) => b.lastAmountFils - a.lastAmountFils);
    const monthly = subs.reduce((sum, item) => sum + item.monthlyEquivalentFils, 0);
    return {
      tool: 'subscriptions',
      title: 'Subscriptions',
      body: subs.length
        ? `I found ${subs.length} active subscription${subs.length === 1 ? '' : 's'}, about ${formatAED(monthly)} per month.`
        : 'I do not see any active subscriptions yet.',
      facts: subs.slice(0, 5).map((item) => ({ label: item.title, value: formatAED(item.lastAmountFils) })),
    };
  }

  const category = categoryFromQuestion(q);
  if (category) {
    const rows = spending.filter((tx) => tx.category === category);
    return {
      tool: 'category-breakdown',
      title: categoryLabel(category),
      body: `You spent ${formatAED(total(rows))} across ${rows.length} transaction${rows.length === 1 ? '' : 's'} in this category.`,
      facts: rows.slice(0, 5).map((tx) => ({ label: tx.title, value: formatAED(tx.amountFils) })),
    };
  }

  const merchant = merchantFromQuestion(q, spending);
  if (merchant) {
    const rows = spending.filter((tx) => normalize(tx.title) === normalize(merchant));
    return {
      tool: 'merchant-breakdown',
      title: merchant,
      body: `You spent ${formatAED(total(rows))} at ${merchant} across ${rows.length} transaction${rows.length === 1 ? '' : 's'}.`,
    };
  }

  if (/compare|more than|less than|increase|decrease|changed|vs|versus|مقارنة|زاد|نقص/.test(q)) {
    const previous = previousPeriod(period);
    const prior = previous ? total(spendingRows(state, previous)) : 0;
    const current = total(spending);
    const delta = current - prior;
    const pct = prior > 0 ? Math.round((Math.abs(delta) / prior) * 100) : null;
    return {
      tool: 'compare-periods',
      title: 'Spending change',
      body: prior === 0
        ? `You spent ${formatAED(current)} this period. I do not have enough previous-period spending to make a reliable comparison.`
        : `You spent ${formatAED(current)}, ${pct}% ${delta >= 0 ? 'more' : 'less'} than the previous period.`,
      facts: [
        { label: 'This period', value: formatAED(current) },
        { label: 'Previous period', value: formatAED(prior) },
      ],
    };
  }

  if (/income|salary|earned|received|دخل|راتب|استلم/.test(q)) {
    return {
      tool: 'income-total',
      title: 'Income',
      body: `You received ${formatAED(total(income))} across ${income.length} income transaction${income.length === 1 ? '' : 's'}.`,
    };
  }

  return {
    tool: 'spending-total',
    title: 'Spending',
    body: `You spent ${formatAED(total(spending))} across ${spending.length} transaction${spending.length === 1 ? '' : 's'}.`,
  };
}

export function suggestedAssistantQuestions(state: AppState): string[] {
  const suggestions = [
    'How much did I spend this month?',
    'Why did my spending change?',
    'What are my biggest subscriptions?',
  ];
  const { live, internal } = ledgerScope(state);
  const topMerchant = state.transactions.find((tx) => isSpending(tx, live, internal))?.title;
  if (topMerchant) suggestions.push(`How much did I spend at ${topMerchant}?`);
  return suggestions;
}
