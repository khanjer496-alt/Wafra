import { evaluateLocalReviewWindow } from '@/lib/local-semantic-review-runtime';
import { onLocalSemanticBackgroundCancelled } from '@/lib/local-semantic-background-policy';
import type { ReviewEntry, UniversalReviewAlert } from '@/lib/alert-review-tray';
import type { UniversalBankEvent } from '@/lib/universal-types';
import type { LocalParserFamilyAdvisoryResult } from '@/lib/local-semantic-model';

type Advisory = Extract<LocalParserFamilyAdvisoryResult, { kind: 'parser-family-advisory' }>;
export type LocalReviewSuggestion = Advisory | { kind: 'pending' | 'unavailable' };
const reviewFamilies = new Set(['purchase', 'transfer', 'cash-withdrawal', 'refund', 'fee', 'utility', 'recurring-payment']);
const unsafe = new Set(['authentication-not-posting', 'pending-not-posting', 'failed-not-posting',
  'promotion-not-posting', 'multiple-event-adapter-required', 'settlement-adapter-required']);
export const eligibleLocalReviewEvent = (event: UniversalBankEvent): boolean =>
  event.decision === 'review' && event.family === 'unknown' &&
  (event.status === 'posted' || event.status === 'unknown') &&
  event.amount.evidence !== 'missing' &&
  (event.amount.value !== null || event.amount.alternatives.length > 0) &&
  !event.issues.some(issue => unsafe.has(issue));

const keyFor = (item: ReviewEntry): string => JSON.stringify([
  item.id, item.sourceKey, item.observedAt, item.kind === 'universal' ? item.event : null,
]);

type Evaluate = (event: UniversalBankEvent, window: string, cancelled: () => boolean) => Promise<LocalParserFamilyAdvisoryResult>;
/** Session-only bounded cache. No source, spans, or AI-generated finance facts persist. */
export function createLocalReviewAdvisor(evaluate: Evaluate) {
  const cache = new Map<string, LocalReviewSuggestion>();
  const listeners = new Set<() => void>();
  let generation = 0;
  let queued = 0;
  let serial = Promise.resolve();
  const emit = () => { for (const listener of listeners) listener(); };
  return {
    get(item: ReviewEntry): LocalReviewSuggestion | null {
      return item.expiresAt > Date.now() ? cache.get(keyFor(item)) ?? null : null;
    },
    subscribe(listener: () => void): () => void {
      listeners.add(listener);
      return () => { listeners.delete(listener); };
    },
    clear(): void { generation++; cache.clear(); emit(); },
    enqueue(item: UniversalReviewAlert, inspected: UniversalBankEvent, window: string): Promise<void> {
      if (item.expiresAt <= Date.now() || !eligibleLocalReviewEvent(inspected) ||
          !eligibleLocalReviewEvent(item.event) || !window || window.length > 320) return Promise.resolve();
      const key = keyFor(item);
      if (cache.has(key) || queued >= 50) return Promise.resolve();
      queued++;
      // Do not grow a queue on full-history scans; newest Review entries win.
      if (cache.size >= 50) cache.delete(cache.keys().next().value!);
      const pending: LocalReviewSuggestion = { kind: 'pending' };
      cache.set(key, pending);
      emit();
      const started = generation;
      const cancelled = () => started !== generation || cache.get(key) !== pending || item.expiresAt <= Date.now();
      const run = async () => {
        if (cancelled()) return;
        let result: LocalReviewSuggestion;
        try {
          const candidate = await evaluate(item.event, window, cancelled);
          result = candidate.kind === 'parser-family-advisory' && reviewFamilies.has(candidate.family) ? candidate : { kind: 'unavailable' };
        } catch { result = { kind: 'unavailable' }; }
        if (cancelled()) return;
        cache.set(key, result);
        emit();
      };
      // Work runs after admission; ingestion never awaits inference.
      serial = serial.then(run, run).finally(() => { queued--; });
      return serial;
    },
  };
}

export const localReviewAdvisor = createLocalReviewAdvisor(evaluateLocalReviewWindow);
export const clearLocalReviewSuggestions = (): void => localReviewAdvisor.clear();
onLocalSemanticBackgroundCancelled(clearLocalReviewSuggestions);
