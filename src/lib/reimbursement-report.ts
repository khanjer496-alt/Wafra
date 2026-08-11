import { internalTransferIds, isSpending, liveAccountIds } from '@/lib/ledger';
import type { Account, CategoryId, Transaction } from '@/lib/types';

export interface ExpenseReportOptions {
  transactions: Transaction[];
  accounts: Account[];
  currency: string;
  language: 'en' | 'ar';
  from: string;
  to: string;
  generatedAt?: Date;
}

const ARABIC_CATEGORIES: Record<CategoryId, string> = {
  groceries: 'بقالة',
  dining: 'مطاعم',
  transport: 'تنقّل',
  'cash-withdrawal': 'سحب نقدي',
  utilities: 'خدمات',
  telecom: 'اتصالات',
  rent: 'إيجار',
  shopping: 'تسوّق',
  health: 'صحة',
  'personal-care': 'عناية شخصية',
  'home-services': 'خدمات منزلية',
  education: 'تعليم',
  travel: 'سفر',
  entertainment: 'ترفيه',
  software: 'برمجيات',
  investing: 'استثمار',
  charity: 'صدقة وزكاة',
  government: 'جهات حكومية',
  loan: 'تمويل',
  salary: 'راتب',
  business: 'أعمال',
  other: 'أخرى',
};

const ENGLISH_CATEGORIES: Record<CategoryId, string> = {
  groceries: 'Groceries',
  dining: 'Dining',
  transport: 'Transport',
  'cash-withdrawal': 'Cash withdrawal',
  utilities: 'Utilities',
  telecom: 'Telecom',
  rent: 'Rent',
  shopping: 'Shopping',
  health: 'Health',
  'personal-care': 'Personal care',
  'home-services': 'Home services',
  education: 'Education',
  travel: 'Travel',
  entertainment: 'Entertainment',
  software: 'Software',
  investing: 'Investing',
  charity: 'Charity / zakat',
  government: 'Government',
  loan: 'Loan',
  salary: 'Salary',
  business: 'Business',
  other: 'Other',
};

/** User-controlled merchant, account, and note text must never become HTML. */
export function escapeReportHtml(value: string): string {
  return value
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

/**
 * The rows a financial export can stand behind: real spending, on an account
 * still in play, excluding both legs of a move between the user's own
 * accounts — the same rule every other total in the app applies. `liveAccounts`
 * and `internalTransfers` are optional so a bare transaction list (tests)
 * still gets the base transfer-flag rule, but callers with the accounts to
 * hand should pass both, or a legacy own-account sweep (no transfer flag,
 * caught only by `internalTransferIds`' structural title match) prints on the
 * report the user hands to someone else as a real expense.
 */
export function reportExpenses(
  transactions: Transaction[],
  from: string,
  to: string,
  liveAccounts?: Set<string>,
  internalTransfers?: Set<string>,
): Transaction[] {
  return transactions
    .filter(
      (tx) =>
        isSpending(tx, liveAccounts, internalTransfers) &&
        tx.date >= from &&
        tx.date <= to,
    )
    .sort((a, b) => a.date.localeCompare(b.date) || (a.ts ?? 0) - (b.ts ?? 0));
}

/**
 * A print-native, self-contained expense report. It deliberately has no
 * network assets: iOS WKWebView cannot print local asset URLs, and a finance
 * export should not fetch a font or logo from the internet while rendering.
 */
export function buildExpenseReportHtml(options: ExpenseReportOptions): string {
  const {
    accounts,
    currency,
    language,
    from,
    to,
    generatedAt = new Date(),
  } = options;
  const arabic = language === 'ar';
  const locale = arabic ? 'ar-AE' : 'en-AE';
  const copy = arabic
    ? {
        title: 'تقرير مصروفات',
        period: 'الفترة',
        generated: 'أُنشئ',
        entries: 'عملية',
        date: 'التاريخ',
        merchant: 'البيان',
        category: 'التصنيف',
        account: 'الحساب',
        amount: 'المبلغ',
        total: 'الإجمالي',
        empty: 'لا توجد مصروفات في هذه الفترة.',
        foot: 'أُنشئ على الجهاز بواسطة وفرة. راجع العمليات قبل تقديم التقرير.',
      }
    : {
        title: 'Expense report',
        period: 'Period',
        generated: 'Generated',
        entries: 'entries',
        date: 'Date',
        merchant: 'Merchant',
        category: 'Category',
        account: 'Account',
        amount: 'Amount',
        total: 'Total',
        empty: 'No expenses in this period.',
        foot: 'Generated on-device by Wafra. Review entries before submitting this report.',
      };
  const categories = arabic ? ARABIC_CATEGORIES : ENGLISH_CATEGORIES;
  const liveAccounts = liveAccountIds(accounts);
  const internal = internalTransferIds(options.transactions, liveAccounts);
  const rows = reportExpenses(options.transactions, from, to, liveAccounts, internal);
  const accountNames = new Map(accounts.map((account) => [account.id, account.name]));
  const totalFils = rows.reduce((sum, tx) => sum + tx.amountFils, 0);
  const money = new Intl.NumberFormat(locale, {
    style: 'currency',
    currency,
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  });
  const date = new Intl.DateTimeFormat(locale, {
    day: '2-digit',
    month: 'short',
    year: 'numeric',
  });
  const formatIso = (iso: string) => date.format(new Date(`${iso}T12:00:00Z`));
  const formatMoney = (fils: number) => money.format(fils / 100);

  const body = rows.length
    ? rows
        .map((tx) => {
          const account = accountNames.get(tx.accountId) ?? (arabic ? 'غير معروف' : 'Unknown');
          const note = tx.note
            ? `<div class="note">${escapeReportHtml(tx.note)}</div>`
            : '';
          return `<tr>
            <td class="nowrap">${escapeReportHtml(formatIso(tx.date))}</td>
            <td><strong>${escapeReportHtml(tx.title)}</strong>${note}</td>
            <td>${escapeReportHtml(categories[tx.category])}</td>
            <td>${escapeReportHtml(account)}</td>
            <td class="money nowrap">${escapeReportHtml(formatMoney(tx.amountFils))}</td>
          </tr>`;
        })
        .join('')
    : `<tr><td class="empty" colspan="5">${copy.empty}</td></tr>`;

  return `<!DOCTYPE html>
<html lang="${language}" dir="${arabic ? 'rtl' : 'ltr'}">
<head>
  <meta charset="utf-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1" />
  <style>
    @page { size: A4; margin: 18mm 15mm; }
    * { box-sizing: border-box; }
    body {
      margin: 0;
      color: #16130f;
      font-family: -apple-system, BlinkMacSystemFont, "Helvetica Neue", Arial, sans-serif;
      font-size: 10.5pt;
      line-height: 1.45;
    }
    header {
      display: flex;
      align-items: flex-start;
      justify-content: space-between;
      gap: 24px;
      padding-bottom: 18px;
      border-bottom: 2px solid #1f6b52;
    }
    .brand { color: #1f6b52; font-size: 13pt; font-weight: 700; letter-spacing: .02em; }
    h1 { margin: 7px 0 0; font-size: 25pt; line-height: 1.12; }
    .meta { color: #57524a; text-align: ${arabic ? 'left' : 'right'}; }
    .summary {
      display: flex;
      justify-content: space-between;
      align-items: flex-end;
      margin: 20px 0 12px;
      padding: 14px 16px;
      background: #f4f1ea;
      border-radius: 9px;
    }
    .eyebrow { color: #6b6559; font-size: 8.5pt; text-transform: uppercase; letter-spacing: .08em; }
    .total { margin-top: 2px; font-size: 20pt; font-weight: 700; font-variant-numeric: tabular-nums; }
    table { width: 100%; border-collapse: collapse; table-layout: fixed; }
    th {
      padding: 9px 7px;
      color: #6b6559;
      border-bottom: 1px solid #d3ccbd;
      font-size: 8.5pt;
      font-weight: 600;
      text-align: ${arabic ? 'right' : 'left'};
      text-transform: uppercase;
      letter-spacing: .04em;
    }
    td { padding: 10px 7px; border-bottom: 1px solid #e3ded2; vertical-align: top; }
    th:nth-child(1), td:nth-child(1) { width: 15%; }
    th:nth-child(2), td:nth-child(2) { width: 29%; }
    th:nth-child(3), td:nth-child(3) { width: 18%; }
    th:nth-child(4), td:nth-child(4) { width: 20%; }
    th:nth-child(5), td:nth-child(5) { width: 18%; }
    .money { text-align: ${arabic ? 'left' : 'right'}; font-variant-numeric: tabular-nums; }
    .nowrap { white-space: nowrap; }
    .note { margin-top: 2px; color: #6b6559; font-size: 8.5pt; overflow-wrap: anywhere; }
    .empty { padding: 32px 8px; color: #6b6559; text-align: center; }
    footer { margin-top: 18px; color: #6b6559; font-size: 8.5pt; }
    tr { break-inside: avoid; }
  </style>
</head>
<body>
  <header>
    <div>
      <div class="brand">وفرة · WAFRA</div>
      <h1>${copy.title}</h1>
    </div>
    <div class="meta">
      <div>${copy.period}: ${escapeReportHtml(formatIso(from))} – ${escapeReportHtml(formatIso(to))}</div>
      <div>${copy.generated}: ${escapeReportHtml(date.format(generatedAt))}</div>
    </div>
  </header>
  <section class="summary">
    <div>
      <div class="eyebrow">${copy.total}</div>
      <div class="total">${escapeReportHtml(formatMoney(totalFils))}</div>
    </div>
    <div class="meta">${rows.length} ${copy.entries}</div>
  </section>
  <table>
    <thead>
      <tr>
        <th>${copy.date}</th>
        <th>${copy.merchant}</th>
        <th>${copy.category}</th>
        <th>${copy.account}</th>
        <th class="money">${copy.amount}</th>
      </tr>
    </thead>
    <tbody>${body}</tbody>
  </table>
  <footer>${copy.foot}</footer>
</body>
</html>`;
}
