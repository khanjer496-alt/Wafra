import { isUsableCaptureSourceIdentity } from '@/lib/capture-source-identity';
import { normalizeAlertReviewTray, type AlertReviewTrayState } from '@/lib/alert-review-tray';
import { canonicalUniversalSourceKey } from '@/lib/universal-import';
import type { AppState } from '@/lib/types';

/** Internal capture attestation, recomputed while the original source is available. */
export interface ReviewSourceBinding {
  legacyId: string;
  legacySourceKey: string;
  id: string;
  sourceKey: string;
  observedAt: number;
}

export interface ReviewSourceBindingResult {
  reviewTray: AlertReviewTrayState;
  transactionKeyUpdates: { id: string; smsKey: string }[];
  changed: boolean;
}

type BindingState = Pick<AppState, 'transactions' | 'reviewTray'>;
const legacySource = (value: unknown): value is string =>
  typeof value === 'string' && /^arc1_[a-f0-9]{64}$/.test(value);
const timestamp = (value: unknown): value is number =>
  typeof value === 'number' && Number.isSafeInteger(value) && value >= 0 &&
  Number.isFinite(new Date(value).getTime());

/** Tell capture which old identities actually need source-backed reconciliation. */
export const collectLegacyReviewSourceKeys = (state: BindingState): string[] =>
  [...new Set([
    ...state.transactions.map((transaction) => transaction.smsKey),
    ...state.reviewTray.pending.map((item) => item.sourceKey),
    ...state.reviewTray.tombstones.map((item) => item.sourceKey),
  ].filter(legacySource))].sort();

const tupleKeys = ['id', 'legacyId', 'legacySourceKey', 'observedAt', 'sourceKey'];
const binding = (value: unknown): ReviewSourceBinding | null => {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return null;
  const keys = Object.keys(value).sort();
  if (keys.length !== tupleKeys.length || keys.some((key, index) => key !== tupleKeys[index])) return null;
  const candidate = value as ReviewSourceBinding;
  if (!legacySource(candidate.legacySourceKey) ||
    candidate.legacyId !== `ari1_${candidate.legacySourceKey.slice(5)}` ||
    typeof candidate.id !== 'string' || !/^ari1_[a-f0-9]{64}$/.test(candidate.id) ||
    candidate.id === candidate.legacyId ||
    typeof candidate.sourceKey !== 'string' ||
    !/^android_message_review_source_a(?:0|[1-9]\d{0,39})$/.test(candidate.sourceKey) ||
    !timestamp(candidate.observedAt)) return null;
  return { legacyId: candidate.legacyId, legacySourceKey: candidate.legacySourceKey,
    id: candidate.id, sourceKey: candidate.sourceKey, observedAt: candidate.observedAt };
};
const providerNumber = (item: ReviewSourceBinding): bigint =>
  BigInt(item.sourceKey.slice('android_message_review_source_a'.length));

/**
 * Repair opaque capture identity only. The host must obtain these tuples from
 * its own raw+sender+time+device-key comparison, never from UI or a backup.
 * Nothing here can prove that a native ID belongs to a hash without that
 * attestation. In particular, amount/date similarity is never a binding.
 *
 * One old hash can describe indistinguishable native twins. Assign it to the
 * lowest supplied provider ID once; other native occurrences remain distinct.
 * Financial fields and transactions are never replaced or removed here.
 */
export const reconcileReviewSourceBindings = (
  state: BindingState,
  bindings: readonly ReviewSourceBinding[],
  now: number,
): ReviewSourceBindingResult => {
  const unchanged = (): ReviewSourceBindingResult => ({
    reviewTray: state.reviewTray, transactionKeyUpdates: [], changed: false,
  });
  if (!timestamp(now) || !Array.isArray(bindings) || bindings.length === 0) return unchanged();
  const wanted = new Set(collectLegacyReviewSourceKeys(state));
  if (!wanted.size) return unchanged();
  const groups = new Map<string, ReviewSourceBinding[]>();
  for (const value of bindings) {
    const item = binding(value);
    if (!item || !wanted.has(item.legacySourceKey)) continue;
    const group = groups.get(item.legacySourceKey) ?? [];
    group.push(item);
    groups.set(item.legacySourceKey, group);
  }
  const chosen: ReviewSourceBinding[] = [];
  for (const group of groups.values()) {
    // A hash includes its observed time; contradictory times or provider-ID
    // mappings cannot both be attestations of that same source.
    const first = group[0];
    if (group.some((item) => item.observedAt !== first.observedAt)) continue;
    const sourceIds = new Map<string, string>();
    const idSources = new Map<string, string>();
    let conflicting = false;
    for (const item of group) {
      if ((sourceIds.has(item.sourceKey) && sourceIds.get(item.sourceKey) !== item.id) ||
        (idSources.has(item.id) && idSources.get(item.id) !== item.sourceKey)) conflicting = true;
      sourceIds.set(item.sourceKey, item.id);
      idSources.set(item.id, item.sourceKey);
    }
    if (conflicting) continue;
    chosen.push([...group].sort((a, b) => providerNumber(a) < providerNumber(b) ? -1 :
      providerNumber(a) > providerNumber(b) ? 1 : 0)[0]);
  }
  const accepted = chosen.filter((item) => {
    if (chosen.some((other) => other.legacySourceKey !== item.legacySourceKey &&
      (other.id === item.id ||
        canonicalUniversalSourceKey(other.sourceKey, other.observedAt) === canonicalUniversalSourceKey(item.sourceKey, item.observedAt)))) return false;
    const canonical = canonicalUniversalSourceKey(item.sourceKey, item.observedAt);
    if (state.reviewTray.pending.some((pending) =>
      (pending.sourceKey === item.legacySourceKey &&
        (pending.id !== item.legacyId || pending.observedAt !== item.observedAt)) ||
      (pending.sourceKey !== item.legacySourceKey &&
        (pending.id === item.id || canonicalUniversalSourceKey(pending.sourceKey, pending.observedAt) === canonical)))) return false;
    // Re-keying cannot merge two existing confirmed occurrences. Keep them
    // intact for explicit resolution instead of silently assigning one source.
    if (state.transactions.some((transaction) => transaction.smsKey !== item.legacySourceKey &&
      transaction.smsKey && isUsableCaptureSourceIdentity(transaction.smsKey, transaction.ts) &&
      canonicalUniversalSourceKey(transaction.smsKey, transaction.ts) === canonical)) return false;
    return true;
  });
  if (!accepted.length) return unchanged();
  const byLegacy = new Map(accepted.map((item) => [item.legacySourceKey, item]));
  let trayChanged = false;
  const pending = state.reviewTray.pending.map((item) => {
    const next = byLegacy.get(item.sourceKey);
    if (!next || item.id !== next.legacyId || item.observedAt !== next.observedAt) return item;
    trayChanged = true;
    return { ...item, id: next.id, sourceKey: next.sourceKey };
  });
  const tombstones = state.reviewTray.tombstones.map((item) => {
    const next = byLegacy.get(item.sourceKey);
    if (!next) return item;
    trayChanged = true;
    return { ...item, sourceKey: canonicalUniversalSourceKey(next.sourceKey, next.observedAt) };
  });
  const transactionKeyUpdates = state.transactions.flatMap((transaction) => {
    const next = transaction.smsKey ? byLegacy.get(transaction.smsKey) : undefined;
    return next ? [{ id: transaction.id, smsKey: canonicalUniversalSourceKey(next.sourceKey, next.observedAt) }] : [];
  });
  if (!trayChanged && !transactionKeyUpdates.length) return unchanged();
  return {
    reviewTray: normalizeAlertReviewTray({ ...state.reviewTray, pending, tombstones }, now),
    transactionKeyUpdates,
    changed: true,
  };
};
