import { formatMinorUnits, formatMoneyText as localeMoneyText, type LedgerMoneySpec } from '@/lib/ledger-money';
import { getLanguage } from '@/lib/i18n';
import { moneyCodeRun } from '@/lib/money-code-run';

/** Inline UI uses the same Arabic order as Money, independent of the device's language. */
export function formatMoneyText(minor: number, spec: LedgerMoneySpec, options?: Parameters<typeof localeMoneyText>[2]): string {
  if (getLanguage() !== 'ar') return localeMoneyText(minor, spec, options);
  const figure = formatMinorUnits(Math.abs(minor), spec, options);
  const sign = minor < 0 && /[1-9١-٩۱-۹]/.test(figure) ? '-' : '';
  return moneyCodeRun(sign + figure, spec.currency, 'ar');
}
