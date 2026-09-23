import { localSemanticBackgroundCancellation } from '@/lib/local-semantic-background-policy';
import { waitForForegroundHistoryIdle } from '@/lib/foreground-history-priority';
import AsyncStorage from '@react-native-async-storage/async-storage';

import { hasBankAlertMoneyHint, inspectGenericBankEventForReview } from '@/lib/launch-alert-parser';
import { queueLocalSemanticParserShadow } from '@/lib/local-semantic-shadow';
import { nonPostingReason } from '@/lib/sms-parser';

import type { InboxSms } from '../../modules/sms-reader';

/**
 * Explicit, tester-triggered shadow pass over the readable SMS inbox.
 *
 * Live capture only sees new messages and the startup parser-repair pass is
 * deliberately excluded from shadow mode, so an existing inbox never reaches
 * the encoder on its own. This walks the inbox newest-first, builds the
 * deterministic universal fact for money-bearing bodies only, and queues the
 * redacted window through the same bounded shadow queue live capture uses.
 * It never parses into the ledger, never stores a body, and stops as soon as
 * the queue starts dropping. Single-flight: a second call while one is
 * running returns the running pass.
 */
export interface LocalSemanticInboxShadowStatus {
  state: 'idle' | 'running' | 'complete' | 'stopped' | 'failed';
  checked: number;
  eligible: number;
  queued: number;
  startedAt: number | null;
  finishedAt: number | null;
}

const MAX_CHECKED = 40_000;
const PAGE_SIZE = 200;

let status: LocalSemanticInboxShadowStatus = {
  state: 'idle', checked: 0, eligible: 0, queued: 0, startedAt: null, finishedAt: null,
};
let inFlight: Promise<LocalSemanticInboxShadowStatus> | null = null;

const STORAGE_KEY = 'wafra:local-semantic-inbox-shadow:v1';
const persist = (): Promise<void> =>
  AsyncStorage.setItem(STORAGE_KEY, JSON.stringify(status)).catch(() => undefined);
let hydrated: Promise<void> | null = null;
/** Restore the last finished pass once, so an export after a restart still reports it. */
export function hydrateLocalSemanticInboxShadow(): Promise<void> {
  hydrated ??= (async () => {
    try {
      const raw = await AsyncStorage.getItem(STORAGE_KEY);
      const stored = raw ? JSON.parse(raw) as Partial<LocalSemanticInboxShadowStatus> : null;
      if (stored && status.state === 'idle' && typeof stored.state === 'string' &&
          ['complete', 'stopped', 'failed'].includes(stored.state)) {
        status = {
          state: stored.state as LocalSemanticInboxShadowStatus['state'],
          checked: Number.isFinite(stored.checked) ? Number(stored.checked) : 0,
          eligible: Number.isFinite(stored.eligible) ? Number(stored.eligible) : 0,
          queued: Number.isFinite(stored.queued) ? Number(stored.queued) : 0,
          startedAt: typeof stored.startedAt === 'number' ? stored.startedAt : null,
          finishedAt: typeof stored.finishedAt === 'number' ? stored.finishedAt : null,
        };
      }
    } catch { /* counting starts from idle */ }
  })();
  return hydrated;
}

export const localSemanticInboxShadowStatus = (): LocalSemanticInboxShadowStatus => ({ ...status });

const yieldTurn = (): Promise<void> => new Promise((resolve) => setTimeout(resolve, 0));

export type InboxPageReader = (beforeDateMs: number, beforeId: number, max: number) => Promise<InboxSms[]>;

export function runLocalSemanticInboxShadow(
  read: InboxPageReader,
  options: { maxChecked?: number; shouldContinue?: () => boolean; queueDropped?: () => number } = {},
): Promise<LocalSemanticInboxShadowStatus> {
  if (inFlight) return inFlight;
  const cancelled = localSemanticBackgroundCancellation();
  const shouldContinue = () => !cancelled() && (options.shouldContinue?.() ?? true);
  inFlight = (async () => {
    const maxChecked = Number.isSafeInteger(options.maxChecked) && Number(options.maxChecked) > 0
      ? Math.min(MAX_CHECKED, Number(options.maxChecked)) : MAX_CHECKED;
    status = { state: 'running', checked: 0, eligible: 0, queued: 0, startedAt: Date.now(), finishedAt: null };
    let beforeDate = Number.MAX_SAFE_INTEGER;
    let beforeId = Number.MAX_SAFE_INTEGER;
    const droppedBefore = options.queueDropped?.() ?? 0;
    try {
      while (status.checked < maxChecked) {
        if (!shouldContinue()) { status.state = 'stopped'; break; }
        await waitForForegroundHistoryIdle();
        if (!shouldContinue()) { status.state = 'stopped'; break; }
        const page = await read(beforeDate, beforeId, Math.min(PAGE_SIZE, maxChecked - status.checked));
        if (!Array.isArray(page) || page.length === 0) { status.state = 'complete'; break; }
        let sliceRows = 0;
        let sliceStartedAt = Date.now();
        for (const row of page) {
          if (sliceRows >= 5 || Date.now() - sliceStartedAt >= 8) {
            await yieldTurn();
            await waitForForegroundHistoryIdle();
            sliceRows = 0;
            sliceStartedAt = Date.now();
          }
          if (!shouldContinue()) { status.state = 'stopped'; break; }
          sliceRows++;
          if (!row || typeof row.body !== 'string' || typeof row.address !== 'string' ||
              !Number.isSafeInteger(row.id) || !Number.isSafeInteger(row.date)) continue;
          status.checked += 1;
          beforeDate = row.date;
          beforeId = row.id;
          if (!hasBankAlertMoneyHint(row.body) || nonPostingReason(row.body) === 'security-challenge') continue;
          const event = inspectGenericBankEventForReview(row.body, row.address);
          if (!shouldContinue()) { status.state = 'stopped'; break; }
          if (!event) continue;
          status.eligible += 1;
          queueLocalSemanticParserShadow(row.body, event);
          status.queued += 1;
        }
        if (status.state === 'stopped') break;
        if ((options.queueDropped?.() ?? 0) > droppedBefore) { status.state = 'stopped'; break; }
        if (page.length < PAGE_SIZE) { status.state = 'complete'; break; }
        await yieldTurn();
      }
      if (status.state === 'running') status.state = 'complete';
    } catch {
      status.state = 'failed';
    } finally {
      status.finishedAt = Date.now();
      await persist();
    }
    return { ...status };
  })().finally(() => { inFlight = null; });
  return inFlight;
}
