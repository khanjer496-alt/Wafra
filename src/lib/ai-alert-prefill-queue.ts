/**
 * Background queue for AI Review suggestions on capture paths whose parsing
 * is synchronous (iOS live capture: local-message-record.ts; iOS History
 * import: historical-import.ts). Android's scan is already asynchronous and
 * calls ai-alert-reader.ts inline.
 *
 * Rules:
 *  - only alerts every parser, the learned formats and the refusal pipeline
 *    left UNRECOGNISED, observed within PLATFORM_READ_RECENT_MS (a live
 *    alert, not a years-long History import);
 *  - bounded: at most MAX_QUEUE jobs wait; extra jobs are dropped (the alert
 *    is simply handled as before, i.e. not reviewed);
 *  - one at a time, off the capture loop: the drain runs after the page
 *    finished, each reading has the reader's own timeout;
 *  - the message text lives only in this in-memory job until it is read,
 *    then the reference is cleared; nothing here is persisted or logged;
 *  - a reading can only STAGE a Review item (through the sink the store
 *    registers). It never posts. Without a sink (tests, background wake with
 *    no store) jobs are refused and nothing is kept.
 */
import { aiReviewEventForRefusedAlert, aiAlertPrefillEnabled, PLATFORM_READ_RECENT_MS } from '@/lib/ai-alert-reader';
import { aiAlertModelStatus } from '@/lib/ai-alert-model';
import { aiReviewCandidate, identifySourceFreeReviewAlert } from '@/lib/auto-import';
import { onDeviceAI } from '@/lib/on-device-ai';
import type { ReviewEntry } from '@/lib/alert-review-tray';

export const AI_PREFILL_MAX_QUEUE = 8;

export interface AiPrefillJob {
  source: string;
  sender: string;
  observedAt: number;
  channel: 'inbox' | 'push' | 'shortcut';
  identity: { id: string; sourceKey: string };
  /** Earliest expiry to give the Review item (History keeps a full window from import time). */
  expiresAtFloor?: number;
}

type Sink = (items: ReviewEntry[]) => unknown;

let sink: Sink | null = null;
let reader: typeof aiReviewEventForRefusedAlert = aiReviewEventForRefusedAlert;

/** Tests only: substitute the reader (null restores the real one). */
export function setAiPrefillReaderForTests(next: typeof aiReviewEventForRefusedAlert | null): void {
  reader = next ?? aiReviewEventForRefusedAlert;
}
const queue: AiPrefillJob[] = [];
let draining: Promise<void> | null = null;
let inFlight: string | null = null;
/** Bumped by clearAiPrefillQueue: a reading that started before it is dropped. */
let generation = 0;

/** The store registers where readings land; null unregisters (and drops waiting jobs). */
export function setAiPrefillSink(next: Sink | null): void {
  sink = next;
  if (!next) clearAiPrefillQueue();
}

/**
 * Drop every waiting job and discard the one being read. Called when the
 * person opts out of capture, turns Private Mode on, erases, restores or
 * loads another ledger, so no suggestion outlives the choice.
 */
export function clearAiPrefillQueue(): void {
  for (const job of queue) { job.source = ''; job.sender = ''; }
  queue.length = 0;
  generation += 1;
}

const startDrain = (): void => {
  if (draining || !queue.length) return;
  draining = drain().finally(() => {
    draining = null;
    // A job queued after the loop saw an empty queue must not be stranded.
    startDrain();
  });
};

const anyEngineMayRun = (): boolean => {
  const known = onDeviceAI.peekAvailability();
  if (!known || known.status === 'available') return true;
  const { state } = aiAlertModelStatus();
  return state === 'downloaded' || state === 'ready';
};

/** Queue one unrecognised alert. Returns false when it was not kept. */
export function enqueueAiPrefill(job: AiPrefillJob, now: number = Date.now()): boolean {
  if (!sink || !aiAlertPrefillEnabled()) return false;
  if (typeof job.source !== 'string' || !job.source.trim() || job.source.length > 4096) return false;
  if (!Number.isFinite(job.observedAt) || now - job.observedAt > PLATFORM_READ_RECENT_MS) return false;
  if (queue.length >= AI_PREFILL_MAX_QUEUE || !anyEngineMayRun()) return false;
  if (inFlight === job.identity.sourceKey ||
    queue.some((waiting) => waiting.identity.sourceKey === job.identity.sourceKey)) return false;
  queue.push({ ...job });
  startDrain();
  return true;
}

async function drain(): Promise<void> {
  // Let the capture page finish (and its own Review write land) first.
  await new Promise((resolve) => setTimeout(resolve, 0));
  for (let job = queue.shift(); job; job = queue.shift()) {
    let item: ReviewEntry | null = null;
    const started = generation;
    inFlight = job.identity.sourceKey;
    try {
      const reading = await reader(job.source, job.sender, job.observedAt);
      const candidate = reading
        ? aiReviewCandidate(job.source, job.sender, reading.event, job.observedAt, job.channel)
        : null;
      const identified = candidate ? identifySourceFreeReviewAlert(candidate, job.identity) : null;
      item = identified && job.expiresAtFloor
        ? { ...identified, expiresAt: Math.max(identified.expiresAt, job.expiresAtFloor) }
        : identified;
    } catch {
      item = null;
    } finally {
      // Drop the only copy of the text this queue held.
      job.source = '';
      job.sender = '';
      inFlight = null;
    }
    if (item && sink && started === generation && aiAlertPrefillEnabled()) {
      try { await sink([item]); } catch { /* the alert stays as it was: not reviewed */ }
    }
  }
}

/** Tests only: wait until the queue is empty. */
export async function flushAiPrefillQueue(): Promise<void> {
  while (draining) await draining;
}

export const aiPrefillQueueLength = (): number => queue.length;
