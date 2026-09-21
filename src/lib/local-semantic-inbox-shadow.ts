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

export const localSemanticInboxShadowStatus = (): LocalSemanticInboxShadowStatus => ({ ...status });

const yieldTurn = (): Promise<void> => new Promise((resolve) => setTimeout(resolve, 0));

export type InboxPageReader = (beforeDateMs: number, beforeId: number, max: number) => Promise<InboxSms[]>;

export function runLocalSemanticInboxShadow(
  read: InboxPageReader,
  options: { maxChecked?: number; shouldContinue?: () => boolean; queueDropped?: () => number } = {},
): Promise<LocalSemanticInboxShadowStatus> {
  if (inFlight) return inFlight;
  inFlight = (async () => {
    const maxChecked = Number.isSafeInteger(options.maxChecked) && Number(options.maxChecked) > 0
      ? Math.min(MAX_CHECKED, Number(options.maxChecked)) : MAX_CHECKED;
    status = { state: 'running', checked: 0, eligible: 0, queued: 0, startedAt: Date.now(), finishedAt: null };
    let beforeDate = Number.MAX_SAFE_INTEGER;
    let beforeId = Number.MAX_SAFE_INTEGER;
    const droppedBefore = options.queueDropped?.() ?? 0;
    try {
      while (status.checked < maxChecked) {
        if (options.shouldContinue && !options.shouldContinue()) { status.state = 'stopped'; break; }
        const page = await read(beforeDate, beforeId, Math.min(PAGE_SIZE, maxChecked - status.checked));
        if (!Array.isArray(page) || page.length === 0) { status.state = 'complete'; break; }
        for (const row of page) {
          if (!row || typeof row.body !== 'string' || typeof row.address !== 'string' ||
              !Number.isSafeInteger(row.id) || !Number.isSafeInteger(row.date)) continue;
          status.checked += 1;
          beforeDate = row.date;
          beforeId = row.id;
          if (!hasBankAlertMoneyHint(row.body) || nonPostingReason(row.body) === 'security-challenge') continue;
          const event = inspectGenericBankEventForReview(row.body, row.address);
          if (!event) continue;
          status.eligible += 1;
          queueLocalSemanticParserShadow(row.body, event);
          status.queued += 1;
        }
        if ((options.queueDropped?.() ?? 0) > droppedBefore) { status.state = 'stopped'; break; }
        if (page.length < PAGE_SIZE) { status.state = 'complete'; break; }
        await yieldTurn();
      }
      if (status.state === 'running') status.state = 'complete';
    } catch {
      status.state = 'failed';
    } finally {
      status.finishedAt = Date.now();
      inFlight = null;
    }
    return { ...status };
  })();
  return inFlight;
}
