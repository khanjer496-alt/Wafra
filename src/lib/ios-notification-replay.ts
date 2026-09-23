import { identifySourceFreeReviewAlert, parsedFinancialCandidateReview } from '@/lib/auto-import';
import { duplicateGuard, type DuplicateCandidate } from '@/lib/dedupe';
import type { LocalMessageParseOutcome } from '@/lib/local-message-record';
import { bankIdentityForName } from '@/lib/markets';
import type { Transaction } from '@/lib/types';

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/**
 * iOS notification observations have no stable provider event identity. A
 * match to a saved alert may be an OS replay or a real repeated purchase.
 * Preserve the second observation for an explicit user decision instead of
 * silently merging it. Later authoritative SMS can still reconcile a push.
 */
export function createIosNotificationReplayGuard(
  transactions: readonly Transaction[],
  retainedReviewSourceKeys: readonly string[] = [],
): (outcome: LocalMessageParseOutcome, observationId: string) => LocalMessageParseOutcome {
  const guard = duplicateGuard(transactions.filter((row) => row.source === 'sms'));
  // A durable queue receipt makes that same observation ACK-only. Reposting
  // through fuzzy matching could undo user edits made since the first save.
  // Never feed this receipt into the bank-event duplicate indexes above.
  // SMS healing can clear viaPush while retaining this receipt.
  const savedObservations = new Set(transactions.flatMap((row) =>
    row.source === 'sms' && typeof row.notificationObservationId === 'string' &&
      UUID_RE.test(row.notificationObservationId) ? [row.notificationObservationId.toLowerCase()] : []));
  const savedReviews = new Set(retainedReviewSourceKeys);
  return (outcome, observationId) => {
    const isNotification = outcome.kind === 'parsed' || outcome.kind === 'declined'
      ? outcome.row.channel === 'push' : outcome.kind === 'review' && outcome.item.channel === 'push';
    if (outcome.kind !== 'invalid' && isNotification && UUID_RE.test(observationId) && savedReviews.has(
      `local_review_source_${observationId.replace(/-/g, '').toLowerCase()}`,
    )) {
      return { kind: 'ignored', market: outcome.market, milestone: 'none' };
    }
    if (outcome.kind !== 'parsed' || outcome.row.kind !== 'transaction') return outcome;
    if (outcome.row.channel === 'push' && savedObservations.has(observationId.toLowerCase())) {
      return { kind: 'ignored', market: outcome.market, milestone: 'none' };
    }
    const { row } = outcome;
    const bankIdentity = row.bankHint ? bankIdentityForName(row.bankHint) : undefined;
    const candidate: DuplicateCandidate = {
      date: row.date!,
      amountFils: row.amountFils,
      title: row.merchant,
      type: row.type,
      ts: row.smsTs,
      channel: row.channel,
      eventKind: 'transaction',
      ...(row.card ? { captureInstrument: {
        last4: row.card.last4,
        kind: row.card.kind,
        ...(bankIdentity ? { bankIdentity } : {}),
      } } : {}),
    };
    // Earlier SMS on this same page must also protect a later notification.
    if (row.channel !== 'push') {
      guard.add(candidate);
      return outcome;
    }
    // Deliberately no smsKey: an arrival timestamp or observation UUID is not
    // exact bank-event identity and cannot override merchant/instrument checks.
    if (!guard.has(candidate)) {
      guard.add(candidate);
      return outcome;
    }
    const reviewCandidate = Number.isFinite(row.smsTs)
      ? parsedFinancialCandidateReview(row, row.smsTs!) : null;
    const opaque = UUID_RE.test(observationId) ? observationId.replace(/-/g, '').toLowerCase() : null;
    const item = reviewCandidate && opaque ? identifySourceFreeReviewAlert(reviewCandidate, {
      id: `local_review_id_${opaque}`,
      sourceKey: `local_review_source_${opaque}`,
    }) : null;
    if (!item) throw new Error('Notification replay review unavailable');
    return {
      kind: 'review',
      market: outcome.market,
      item: { ...item, attentionReason: 'possible-notification-replay' },
      milestone: 'none',
    };
  };
}
