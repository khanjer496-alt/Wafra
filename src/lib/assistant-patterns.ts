import type { Transaction } from '@/lib/types';
import { isSpending } from '@/lib/ledger';
import {
  canonicalCaptureSourceKey,
  isUnboundAndroidSourceKey,
  isUsableCaptureSourceIdentity,
} from '@/lib/capture-source-identity';

export interface AssistantPattern {
  id: string;
  kind: 'recurring-change' | 'unusual-charge' | 'possible-duplicate';
  title: string;
  accountId: string;
  date: string;
  transactionIds: string[];
  baselineTransactionIds: string[];
  amountFils: number;
  baselineFils?: number;
  deltaFils?: number;
  direction?: 'increase' | 'decrease';
  reason: string;
}

/** These are conservative product heuristics, not fraud or price predictions. */
const MAX_FINDINGS = 20;
const MAX_DUPLICATE_GROUP = 8;
const TWO_MINUTES = 120_000;
const DAY = 86_400_000;
const UNUSUAL_HISTORY_DAYS = 180;
// The cadence windows match subscriptions.ts. Requiring every interval here
// deliberately sets a higher bar than suggesting that a merchant may recur.
const CADENCES = [
  { name: 'weekly', min: 6, max: 8 },
  { name: 'monthly', min: 26, max: 35 },
  { name: 'yearly', min: 350, max: 380 },
] as const;
const GENERIC_MERCHANT = /^(?:card (?:purchase|transaction|payment)|purchase|transaction|account debit|(?:outgoing|incoming|bank|own account|own|self|savings|telegraphic) transfer|(?:inward|outward) remittance)$/;
const merchantKey = (title: string): string => title.trim().replace(/\s+/g, ' ').toLowerCase();
const textOrder = (a: string, b: string): number => a < b ? -1 : a > b ? 1 : 0;

function dayNumber(date: string): number | null {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(date)) return null;
  const value = Date.parse(`${date}T00:00:00Z`);
  return Number.isFinite(value) && new Date(value).toISOString().slice(0, 10) === date
    ? value / DAY : null;
}

function today(now: Date): string {
  return `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}-${String(now.getDate()).padStart(2, '0')}`;
}

function hasConversion(transaction: Transaction): boolean {
  return transaction.originalCurrency !== undefined || transaction.originalAmountMinor !== undefined ||
    transaction.fxSource !== undefined || transaction.fxRate !== undefined || transaction.fxRateDate !== undefined;
}

function baseEligible(transaction: Transaction, now: Date): boolean {
  if (!Number.isFinite(now.getTime()) || !transaction.id || !transaction.accountId ||
    transaction.accountId.startsWith('__unassigned') || typeof transaction.title !== 'string' ||
    !merchantKey(transaction.title) || GENERIC_MERCHANT.test(merchantKey(transaction.title)) ||
    !Number.isSafeInteger(transaction.amountFils) || transaction.amountFils <= 0 ||
    dayNumber(transaction.date) === null || transaction.date > today(now)) return false;
  if (Number.isFinite(transaction.ts) && transaction.ts! > now.getTime()) return false;
  // Callers supply shared-ledger spending and live-account filtering. Keep the
  // obvious movement/settlement guards here too so these functions fail closed
  // when used independently. A fallback bill-receipt account is not evidence.
  return isSpending(transaction) && !transaction.isTransfer && !transaction.transferEvidence &&
    !transaction.transferDecision && !transaction.transferMatch && !transaction.cardPaymentSide &&
    transaction.paymentFlowSide !== 'funding' &&
    !(transaction.paymentFlowSide === 'receipt' && !transaction.paymentInstrumentSource);
}

export interface AssistantPatternCoverage {
  eligibleCount: number;
  skippedFxCount: number;
  skippedSplitCount: number;
  skippedOtherCount: number;
}

/**
 * Disjoint counts for recurring/unusual analysis. Split receipts and anything
 * carrying conversion metadata are omitted: full receipt amount and converted
 * ledger values cannot establish an allocated charge or merchant price change.
 * Native ledger minor units (including zero/three decimal currencies) otherwise
 * need no conversion. This does not assert that enough baseline history exists.
 */
export function patternAnalysisCoverage(selected: Transaction[], now: Date): AssistantPatternCoverage {
  const result = { eligibleCount: 0, skippedFxCount: 0, skippedSplitCount: 0, skippedOtherCount: 0 };
  for (const transaction of selected) {
    if (!baseEligible(transaction, now) || instrumentKey(transaction) === null) result.skippedOtherCount += 1;
    else if (hasConversion(transaction)) result.skippedFxCount += 1;
    else if (transaction.splits?.length) result.skippedSplitCount += 1;
    else result.eligibleCount += 1;
  }
  return result;
}

function instrumentKey(transaction: Transaction): string | null {
  const instrument = transaction.captureInstrument;
  if (!instrument) return '';
  if (!/^\d{4}$/.test(instrument.last4) ||
    !['credit', 'debit', 'account', 'unknown'].includes(instrument.kind)) return null;
  return JSON.stringify([instrument.last4, instrument.kind, instrument.bankIdentity?.trim().toLowerCase() ?? '']);
}

function groupKey(transaction: Transaction): string | null {
  const instrument = instrumentKey(transaction);
  return instrument === null ? null : JSON.stringify([merchantKey(transaction.title), transaction.accountId, instrument]);
}

function compareRows(a: Transaction, b: Transaction): number {
  return textOrder(a.date, b.date) || (a.ts ?? 0) - (b.ts ?? 0) || textOrder(a.id, b.id);
}

function groups(history: Transaction[], now: Date): Map<string, Transaction[]> {
  const counts = new Map<string, number>();
  for (const transaction of history) counts.set(transaction.id, (counts.get(transaction.id) ?? 0) + 1);
  const result = new Map<string, Transaction[]>();
  for (const transaction of history) {
    if (counts.get(transaction.id) !== 1 || !baseEligible(transaction, now) || hasConversion(transaction) ||
      transaction.splits?.length) continue;
    const key = groupKey(transaction);
    if (key === null) continue;
    const group = result.get(key) ?? [];
    group.push(transaction);
    result.set(key, group);
  }
  for (const group of result.values()) group.sort(compareRows);
  return result;
}

function median(amounts: number[]): number {
  const sorted = [...amounts].sort((a, b) => a - b);
  // Baseline windows always have odd lengths, so their median is an exact
  // observed minor-unit amount. No half-unit rounding is needed in evidence.
  return sorted[Math.floor(sorted.length / 2)];
}

function resultOrder(a: AssistantPattern, b: AssistantPattern): number {
  return textOrder(b.date, a.date) || textOrder(a.title, b.title) || textOrder(a.accountId, b.accountId) || textOrder(a.id, b.id);
}

function patternId(kind: AssistantPattern['kind'], ids: string[]): string {
  return `${kind}:${JSON.stringify(ids)}`;
}

/** Latest selected charge versus a stable preceding run; no future lookahead. */
export function findRecurringChanges(
  history: Transaction[], selected: Transaction[], now: Date, notSubscriptions: string[] = [],
): AssistantPattern[] {
  const selectedIds = new Set(selected.map(transaction => transaction.id));
  const dismissed = new Set(notSubscriptions.map(merchantKey));
  const findings: AssistantPattern[] = [];
  for (const group of groups(history, now).values()) {
    const latest = group.filter(transaction => selectedIds.has(transaction.id)).at(-1);
    if (!latest || dismissed.has(merchantKey(latest.title))) continue;
    const observations = group.filter(transaction => compareRows(transaction, latest) <= 0);
    // Several charges on one day do not establish a regular recurring charge.
    if (group.filter(transaction => transaction.date === latest.date).length !== 1) continue;
    let index = observations.length - 1;
    while (index >= 0 && Math.abs(observations[index].amountFils - latest.amountFils) / latest.amountFils <= 0.05) index -= 1;
    const currentRun = observations.slice(index + 1);
    if (index < 2) continue;
    const priorAmount = observations[index].amountFils;
    const priorRun: Transaction[] = [];
    while (index >= 0 && priorRun.length < 5 &&
      Math.abs(observations[index].amountFils - priorAmount) / priorAmount <= 0.05) {
      priorRun.unshift(observations[index]);
      index -= 1;
    }
    if (priorRun.length < 3) continue;
    if (priorRun.length % 2 === 0) priorRun.shift();
    const baseline = median(priorRun.map(transaction => transaction.amountFils));
    if (priorRun.some(transaction => Math.abs(transaction.amountFils - baseline) / baseline > 0.05)) continue;
    const delta = latest.amountFils - baseline;
    if (Math.abs(delta) / baseline < 0.1) continue;
    const cadenceRows = [...priorRun, ...currentRun];
    const gaps = cadenceRows.slice(1).map((transaction, i) => dayNumber(transaction.date)! - dayNumber(cadenceRows[i].date)!);
    const cadence = CADENCES.find(candidate => gaps.every(gap => gap >= candidate.min && gap <= candidate.max));
    if (!cadence) continue;
    const direction = delta > 0 ? 'increase' : 'decrease';
    findings.push({ id: patternId('recurring-change', [latest.id]), kind: 'recurring-change',
      title: latest.title.trim(), accountId: latest.accountId, date: latest.date,
      transactionIds: [latest.id], baselineTransactionIds: priorRun.map(transaction => transaction.id),
      amountFils: latest.amountFils, baselineFils: baseline, deltaFils: delta, direction,
      reason: `The latest recorded charge is ${delta > 0 ? 'higher' : 'lower'} than the median of ${priorRun.length} earlier charges on a ${cadence.name} pattern. Amounts alone do not show whether price, usage, or plan changed.` });
  }
  return findings.sort(resultOrder).slice(0, MAX_FINDINGS);
}

/**
 * At least five earlier observations, three times the median, and a deviation
 * of at least three median absolute deviations and one minor unit. We use up
 * to 29 earlier charges from the preceding 180 days, so a very old spending
 * regime cannot dominate.
 * Use an odd observation count so the median is an exact observed minor unit.
 * A heuristic outlier is an invitation to inspect, never a fraud accusation.
 */
export function findUnusualCharges(history: Transaction[], selected: Transaction[], now: Date): AssistantPattern[] {
  const selectedIds = new Set(selected.map(transaction => transaction.id));
  const findings: AssistantPattern[] = [];
  for (const group of groups(history, now).values()) {
    let dayStart = 0;
    for (let index = 0; index < group.length; index += 1) {
      const transaction = group[index];
      if (index > 0 && group[index - 1].date !== transaction.date) dayStart = index;
      if (!selectedIds.has(transaction.id) || dayStart < 5) continue;
      // Date-only rows cannot reliably order purchases on the same day.
      const recent = group.slice(Math.max(0, dayStart - 29), dayStart)
        .filter(prior => dayNumber(transaction.date)! - dayNumber(prior.date)! <= UNUSUAL_HISTORY_DAYS);
      if (recent.length < 5) continue;
      const earlier = recent.length % 2 ? recent : recent.slice(1);
      const baseline = median(earlier.map(prior => prior.amountFils));
      const mad = median(earlier.map(prior => Math.abs(prior.amountFils - baseline)));
      const delta = transaction.amountFils - baseline;
      if (transaction.amountFils / baseline < 3 || delta < Math.max(1, 3 * mad)) continue;
      findings.push({ id: patternId('unusual-charge', [transaction.id]), kind: 'unusual-charge',
        title: transaction.title.trim(), accountId: transaction.accountId, date: transaction.date,
        transactionIds: [transaction.id], baselineTransactionIds: earlier.map(prior => prior.id),
        amountFils: transaction.amountFils, baselineFils: baseline, deltaFils: delta, direction: 'increase',
        reason: `This charge is at least three times the median of ${earlier.length} recent earlier charges at the same merchant and account in the preceding 180 days, and stands out from their usual variation. A larger purchase may be expected; review its details.` });
    }
  }
  return findings.sort(resultOrder).slice(0, MAX_FINDINGS);
}

function capturedTime(transaction: Transaction, now: Date): number | null {
  // Manual entry creation time is not proof of when a purchase occurred.
  if (transaction.source !== 'sms' || !isUsableCaptureSourceIdentity(transaction.smsKey, transaction.ts)) return null;
  const legacy = transaction.smsKey?.match(/^s(\d{10,})-/);
  const value = transaction.ts ?? (legacy ? Number(legacy[1]) : undefined);
  if (!Number.isSafeInteger(value) || value! <= 0 || value! > now.getTime() ||
    !Number.isFinite(new Date(value!).getTime())) return null;
  // Allow timezone/midnight differences, but a capture clock many days away
  // from the posted date cannot establish near-simultaneous purchases.
  return Math.abs(Math.floor(value! / DAY) - dayNumber(transaction.date)!) <= 1 ? value! : null;
}

function capturedIdentity(transaction: Transaction): string | null {
  const key = transaction.smsKey;
  if (transaction.source !== 'sms' || !key?.trim() || key.length > 256 ||
    !isUsableCaptureSourceIdentity(key, transaction.ts)) return null;
  const canonical = canonicalCaptureSourceKey(key, transaction.ts);
  return isUnboundAndroidSourceKey(canonical) ? null : canonical;
}

/**
 * Same exact merchant, account, instrument, full charge and currency evidence.
 * Never merges or deletes anything. Clusters are disjoint, max eight records,
 * and every pair must qualify: a chain of nearby purchases cannot span hours.
 * Date-only/manual equal purchases and FX/split receipts are intentionally out.
 */
export function findPossibleDuplicates(history: Transaction[], selected: Transaction[], now: Date): AssistantPattern[] {
  const selectedIds = new Set(selected.map(transaction => transaction.id));
  const findings: AssistantPattern[] = [];
  for (const group of groups(history, now).values()) {
    const latest = group.filter(transaction => selectedIds.has(transaction.id)).at(-1);
    if (!latest) continue;
    const latestTime = capturedTime(latest, now);
    const byAmount = new Map<number, Transaction[]>();
    for (const transaction of group) {
      const time = capturedTime(transaction, now);
      if (transaction.date > latest.date || (transaction.date === latest.date && latestTime !== null &&
        time !== null && time > latestTime) || transaction.source !== 'sms' ||
        (time === null && capturedIdentity(transaction) === null)) continue;
      const matching = byAmount.get(transaction.amountFils) ?? [];
      matching.push(transaction);
      byAmount.set(transaction.amountFils, matching);
    }
    for (const matching of byAmount.values()) {
      const byIdentity = new Map<string, Transaction[]>();
      for (const transaction of matching) {
        const identity = capturedIdentity(transaction);
        if (identity === null) continue;
        const sameSource = byIdentity.get(identity) ?? [];
        sameSource.push(transaction);
        byIdentity.set(identity, sameSource);
      }
      const clusters: Transaction[][] = [], used = new Set<string>();
      for (const sameSource of byIdentity.values()) {
        if (sameSource.length < 2) continue;
        const times = sameSource.map(transaction => capturedTime(transaction, now)).filter((time): time is number => time !== null);
        // A reused source key with contradictory clocks is not identity proof.
        const minimum = times.reduce((value, time) => Math.min(value, time), Number.POSITIVE_INFINITY);
        const maximum = times.reduce((value, time) => Math.max(value, time), Number.NEGATIVE_INFINITY);
        if (times.length > 1 && maximum - minimum > TWO_MINUTES) continue;
        const firstDay = dayNumber(sameSource[0].date)!;
        const lastDay = dayNumber(sameSource[sameSource.length - 1].date)!;
        // Even a usable key may have been reused or manually reassigned. It
        // cannot override widely contradictory posting dates.
        if (lastDay - firstDay > 1) continue;
        for (let index = 0; index < sameSource.length; index += MAX_DUPLICATE_GROUP) {
          const cluster = sameSource.slice(index, index + MAX_DUPLICATE_GROUP);
          if (cluster.length < 2) continue;
          clusters.push(cluster);
          for (const transaction of cluster) used.add(transaction.id);
        }
      }
      const timed = matching.filter(transaction => !used.has(transaction.id))
        .map(transaction => ({ transaction, time: capturedTime(transaction, now) }))
        .filter((entry): entry is { transaction: Transaction; time: number } => entry.time !== null)
        .sort((a, b) => a.time - b.time || compareRows(a.transaction, b.transaction));
      let timedCluster: Transaction[] = [], startedAt = 0;
      for (const { transaction, time } of timed) {
        if (!timedCluster.length || timedCluster.length === MAX_DUPLICATE_GROUP || time - startedAt > TWO_MINUTES) {
          timedCluster = [];
          clusters.push(timedCluster);
          startedAt = time;
        }
        timedCluster.push(transaction);
      }
      for (const cluster of clusters) {
        cluster.sort(compareRows);
        const selectedLatest = cluster.filter(transaction => selectedIds.has(transaction.id)).at(-1);
        if (cluster.length < 2 || !selectedLatest) continue;
        const amount = cluster[0].amountFils * cluster.length;
        if (!Number.isSafeInteger(amount)) continue;
        const identity = capturedIdentity(cluster[0]);
        const sameSource = identity !== null && cluster.every(transaction => capturedIdentity(transaction) === identity);
        const ids = cluster.map(transaction => transaction.id);
        findings.push({ id: patternId('possible-duplicate', ids), kind: 'possible-duplicate',
          title: selectedLatest.title.trim(), accountId: selectedLatest.accountId, date: selectedLatest.date,
          transactionIds: ids, baselineTransactionIds: [], amountFils: amount,
          reason: `These ${cluster.length} records have the same merchant, account and charge amount, and ${sameSource ? 'the same recorded bank alert' : 'recorded times within two minutes of one another'}. Review whether these were separate purchases. No records have been changed.` });
      }
    }
  }
  return findings.sort(resultOrder).slice(0, MAX_FINDINGS);
}
