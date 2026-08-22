import type { Account, Transaction } from '@/lib/types';

export const LAUNCH_BENCHMARK_ROW_COUNTS = [0, 1_000, 5_000, 10_000] as const;
export type LaunchBenchmarkRowCount = (typeof LAUNCH_BENCHMARK_ROW_COUNTS)[number];

interface LaunchBenchmarkBackup {
  app: 'wafra';
  version: 1;
  exportedAt: string;
  data: {
    onboarded: true;
    ledgerMoney: { schemaVersion: 2; currency: 'USD'; exponent: 2 };
    marketId: 'AE';
    accounts: Account[];
    transactions: Transaction[];
  };
}

const isReviewedSize = (value: number): value is LaunchBenchmarkRowCount =>
  (LAUNCH_BENCHMARK_ROW_COUNTS as readonly number[]).includes(value);

/**
 * Build a generic JSON backup for an internal Release build benchmark.
 *
 * Restore the generated file through Settings, fully close the app, then time
 * the next cold launch. Restore uses the normal durable SQLCipher path, so the
 * following launch measures the same encrypted read and migration work as a
 * real ledger. The fixture contains no bank alerts or person-specific data.
 */
export function buildLaunchBenchmarkBackup(
  rowCount: number,
  nowMs: number = Date.now(),
): LaunchBenchmarkBackup {
  if (!isReviewedSize(rowCount)) throw new Error('unsupported_launch_benchmark_size');

  const dayMs = 24 * 60 * 60 * 1_000;
  const account: Account = {
    id: 'launch-benchmark-account',
    name: 'Sample account',
    kind: 'bank',
    openingFils: 0,
    color: '#1F6B52',
  };
  const transactions: Transaction[] = Array.from({ length: rowCount }, (_, index) => {
    const ts = nowMs - index * dayMs;
    return {
      id: `launch-benchmark-${String(index).padStart(6, '0')}`,
      type: 'expense',
      amountFils: 100 + (index % 10_000),
      category: 'other',
      accountId: account.id,
      title: 'Sample expense',
      date: new Date(ts).toISOString().slice(0, 10),
      ts,
      source: 'manual',
    };
  });

  return {
    app: 'wafra',
    version: 1,
    exportedAt: new Date(nowMs).toISOString(),
    data: {
      onboarded: true,
      ledgerMoney: { schemaVersion: 2, currency: 'USD', exponent: 2 },
      marketId: 'AE',
      accounts: [account],
      transactions,
    },
  };
}
