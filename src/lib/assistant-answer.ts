import { formatAED } from '@/lib/format';
import { periodLabel } from '@/lib/period';
import { t, tf, type Lang } from '@/lib/i18n';
import type { AssistantQueryResult } from '@/lib/assistant-query';

export interface AssistantAnswerCopy {
  title: string;
  body: string;
}

/** Exact prose assembled from domain results; no generated number reaches UI. */
export const assistantAnswerCopy = (
  result: AssistantQueryResult,
  language: Lang,
): AssistantAnswerCopy => {
  const period = periodLabel(result.period);
  if (result.unsupportedReason === 'invalid-amount') {
    return {
      title: t('assistantUnsupportedTitle', language),
      body: t('assistantInvalidAmountBody', language),
    };
  }
  if (result.unsupportedReason === 'historical-bills') {
    return {
      title: t('assistantUnsupportedTitle', language),
      body: t('assistantHistoricalBillsBody', language),
    };
  }
  if (result.unsupportedReason === 'ambiguous-query') {
    return {
      title: t('assistantUnsupportedTitle', language),
      body: t('assistantAmbiguousQueryBody', language),
    };
  }
  if (result.tool === 'search-transactions') {
    if (result.matchedCount === 0) {
      return { title: t('assistantNoMatchesTitle', language), body: t('assistantNoMatchesBody', language) };
    }
    return {
      title: tf('assistantFoundTitle', { count: result.matchedCount }, language),
      body: tf('assistantFoundBody', {
        period,
        total: formatAED(Math.abs(result.countedTotalFils), { decimals: true }),
        sign: result.countedTotalFils >= 0 ? '+' : '−',
      }, language),
    };
  }
  if (result.tool === 'summarize-period') {
    return {
      title: period,
      body: tf('assistantSummaryBody', {
        income: formatAED(result.incomeFils, { decimals: true }),
        spending: formatAED(result.spendingFils, { decimals: true }),
        net: formatAED(Math.abs(result.countedTotalFils), { decimals: true }),
        sign: result.countedTotalFils >= 0 ? '+' : '−',
      }, language),
    };
  }
  if (result.tool === 'explain-cash-out') {
    return {
      title: tf('assistantCashOutTitle', {
        amount: formatAED(result.cashOutFils, { decimals: true }),
      }, language),
      body: tf('assistantCashOutBody', {
        cards: formatAED(result.cardPaymentsFils, { decimals: true }),
        accounts: formatAED(result.accountOutflowFils, { decimals: true }),
        count: result.matchedCount,
      }, language),
    };
  }
  if (result.tool === 'list-bills') {
    if (result.bills.length === 0) {
      return { title: t('assistantNoBillsTitle', language), body: t('assistantNoBillsBody', language) };
    }
    const open = result.bills.filter((row) => row.status !== 'paid');
    const total = open.reduce((sum, row) => sum + row.amountFils, 0);
    return {
      title: tf('assistantBillsTitle', { count: open.length }, language),
      body: tf('assistantBillsBody', { total: formatAED(total, { decimals: true }) }, language),
    };
  }
  if (result.recurring.length === 0) {
    return {
      title: t('assistantNoRecurringTitle', language),
      body: t('assistantNoRecurringBody', language),
    };
  }
  const total = result.recurring.reduce((sum, row) => sum + row.amountFils, 0);
  return {
    title: tf('assistantRecurringTitle', { count: result.recurring.length }, language),
    body: tf('assistantRecurringBody', { total: formatAED(total, { decimals: true }) }, language),
  };
};
