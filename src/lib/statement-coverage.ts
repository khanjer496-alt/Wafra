import type { StatementCoverageEntry } from '@/lib/types';

/**
 * Observed transaction-date ranges, grouped by the source the file named.
 *
 * The relay derives these bounds from parsed rows, not a bank-stated period
 * or a reconciled opening/closing balance. Neither an identified instrument
 * nor two transactions months apart proves that the intervening activity is
 * complete. Keep this distinction in the shared model, not only the UI copy.
 */
export type CoverageSummary = {
  sourceKey: string;
  label: string;
  range: string;
  throughMonth: string;
  sortDate: string;
  /** Whether the source names account/card digits; this is not completeness. */
  identified: boolean;
  /** No source-period or balance-reconciliation proof accompanies these ranges. */
  canAssessCompleteness: false;
  /** Retained for callers of the old contract; ranges prove no missing months. */
  missing: string[];
};

export function isIdentifiedCoverageSource(sourceKey: string): boolean {
  return /^(?:issuer:[a-f0-9]{16}:)?(?:account|card):[a-z]+:\d{4}$/.test(sourceKey);
}

function monthKey(date: string): string {
  return date.slice(0, 7);
}

/**
 * The UI language in the device's Region: "en-DE", "ar-SA-u-nu-latn".
 *
 * `region` is expo-localization's device Region (ledger-money's
 * displayRegion()), passed in by the caller — never derived from the
 * language tag, so an English (US) phone in the UAE keeps day-first UAE
 * dates. With no usable Region this is the launch-tested en-AE/ar-AE, exactly
 * as before. Arabic keeps Latin digits, as everywhere else in the app.
 * (reimbursement-report.ts carries the same rule; both stay import-free.)
 */
export function coverageLocale(language: string, region?: string | null): string {
  const base = language === 'ar' ? 'ar' : 'en';
  const code = region?.trim().toUpperCase();
  if (!code || !/^[A-Z]{2}$/.test(code)) return `${base}-AE`;
  const tag = `${base}-${code}${base === 'ar' ? '-u-nu-latn' : ''}`;
  try {
    return Intl.DateTimeFormat.supportedLocalesOf([tag]).length ? tag : `${base}-AE`;
  } catch {
    return `${base}-AE`;
  }
}

export function formatCoverageMonth(key: string, language: string, region?: string | null): string {
  const [year, month] = key.split('-').map(Number);
  return new Intl.DateTimeFormat(coverageLocale(language, region), {
    month: 'short', year: 'numeric', timeZone: 'UTC',
  }).format(new Date(Date.UTC(year, month - 1, 1)));
}

export function summarizeCoverage(
  entries: readonly StatementCoverageEntry[],
  language: string,
  today: Date = new Date(),
  /** Device Region for month names; see coverageLocale. */
  region?: string | null,
): CoverageSummary[] {
  const groups = new Map<string, StatementCoverageEntry[]>();
  for (const entry of entries) {
    const list = groups.get(entry.sourceKey) ?? [];
    list.push(entry);
    groups.set(entry.sourceKey, list);
  }
  const lastCompleteDate = new Date(Date.UTC(today.getUTCFullYear(), today.getUTCMonth() - 1, 1));
  const lastCompleteMonth = `${lastCompleteDate.getUTCFullYear()}-${String(lastCompleteDate.getUTCMonth() + 1).padStart(2, '0')}`;
  return [...groups.entries()].map(([sourceKey, rows]) => {
    const ordered = [...rows].sort((a, b) => a.startDate.localeCompare(b.startDate));
    const firstMonth = monthKey(ordered[0].startDate);
    const lastEndDate = ordered.reduce((latest, row) => (row.endDate > latest ? row.endDate : latest), ordered[0].endDate);
    const lastImportedMonth = monthKey(lastEndDate);
    const identified = isIdentifiedCoverageSource(sourceKey);
    return {
      sourceKey,
      label: ordered[ordered.length - 1].label,
      range: firstMonth === lastImportedMonth
        ? formatCoverageMonth(firstMonth, language, region)
        : `${formatCoverageMonth(firstMonth, language, region)} – ${formatCoverageMonth(lastImportedMonth, language, region)}`,
      throughMonth: formatCoverageMonth(lastCompleteMonth, language, region),
      sortDate: lastEndDate,
      identified,
      canAssessCompleteness: false as const,
      missing: [],
    };
  }).sort((a, b) => b.sortDate.localeCompare(a.sortDate));
}
