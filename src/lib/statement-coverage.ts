import type { StatementCoverageEntry } from '@/lib/types';

/**
 * Which months of statement history the ledger holds, per statement source.
 *
 * Gap-checking is only honest for a source the statement itself identified —
 * a masked account or card number (`account:…` / `card:…` keys from the
 * relay). A statement that names no account lands in a shared bucket
 * (`bank-statements`, or `bank:<issuer>` when only the bank is known), and
 * several different accounts can share that bucket: a current-account
 * statement for January and a card statement for February would read as
 * "no gaps" when neither account is complete. Those sources are summarised
 * with their imported range only and flagged unidentified, never as complete
 * and never with a missing-months list.
 */
export type CoverageSummary = {
  sourceKey: string;
  label: string;
  range: string;
  throughMonth: string;
  sortDate: string;
  /** False when the statement named no account/card; no completeness claim. */
  identified: boolean;
  /** Missing months in the last year; always empty for an unidentified source. */
  missing: string[];
};

export function isIdentifiedCoverageSource(sourceKey: string): boolean {
  return /^(?:account|card):[a-z]+:\d{4}$/.test(sourceKey);
}

function monthKey(date: string): string {
  return date.slice(0, 7);
}

function monthIndex(key: string): number {
  const [year, month] = key.split('-').map(Number);
  return year * 12 + month - 1;
}

function monthFromIndex(index: number): string {
  const year = Math.floor(index / 12);
  const month = index % 12 + 1;
  return `${year}-${String(month).padStart(2, '0')}`;
}

function nextMonth(key: string): string {
  const [year, month] = key.split('-').map(Number);
  const date = new Date(Date.UTC(year, month, 1));
  return `${date.getUTCFullYear()}-${String(date.getUTCMonth() + 1).padStart(2, '0')}`;
}

/**
 * The UI language in the device's Region: "en-DE", "ar-SA-u-nu-latn".
 *
 * Replaces a hard-coded en-AE/ar-AE, which gave every user UAE date and
 * number conventions. Arabic keeps Latin digits, as everywhere else in the
 * app. Without a usable Region the bare language is used. `region` overrides
 * the device's for tests. (Kept local rather than shared so this module stays
 * import-free; reimbursement-report.ts carries the same rule.)
 */
export function coverageLocale(language: string, region: string | null = deviceRegion()): string {
  const base = language === 'ar' ? 'ar' : 'en';
  const numbering = base === 'ar' ? '-u-nu-latn' : '';
  const code = region?.trim().toUpperCase();
  if (!code || !/^[A-Z]{2}$/.test(code)) return `${base}${numbering}`;
  const tag = `${base}-${code}${numbering}`;
  try {
    return Intl.DateTimeFormat.supportedLocalesOf([tag]).length ? tag : `${base}${numbering}`;
  } catch {
    return base;
  }
}

function deviceRegion(): string | null {
  try {
    const locale = new Intl.DateTimeFormat().resolvedOptions().locale ?? '';
    return locale.match(/[-_]([A-Za-z]{2})(?:[-_]|$)/)?.[1]?.toUpperCase() ?? null;
  } catch {
    return null;
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
    const missing: string[] = [];
    if (identified) {
      const covered = new Set<string>();
      for (const row of ordered) {
        let cursor = monthKey(row.startDate);
        const end = monthKey(row.endDate);
        for (let guard = 0; guard < 240; guard += 1) {
          covered.add(cursor);
          if (cursor === end) break;
          cursor = nextMonth(cursor);
        }
      }
      const lastCompleteIndex = monthIndex(lastCompleteMonth);
      let cursor = monthFromIndex(Math.max(monthIndex(firstMonth), lastCompleteIndex - 11));
      for (let guard = 0; guard < 12; guard += 1) {
        if (!covered.has(cursor)) missing.push(formatCoverageMonth(cursor, language));
        if (cursor === lastCompleteMonth) break;
        cursor = nextMonth(cursor);
      }
    }
    return {
      sourceKey,
      label: ordered[ordered.length - 1].label,
      range: firstMonth === lastImportedMonth
        ? formatCoverageMonth(firstMonth, language)
        : `${formatCoverageMonth(firstMonth, language)} – ${formatCoverageMonth(lastImportedMonth, language)}`,
      throughMonth: formatCoverageMonth(lastCompleteMonth, language),
      sortDate: lastEndDate,
      identified,
      missing,
    };
  }).sort((a, b) => b.sortDate.localeCompare(a.sortDate));
}
