import { CATEGORIES } from '@/lib/categories';
import type { ReviewAlert } from '@/lib/alert-review-tray';
import type { CategoryId, TransactionType } from '@/lib/types';

export const ALERT_AI_SUGGESTION_VERSION = 1;

export interface AlertAiSuggestion {
  type: TransactionType;
  title: string;
  category: CategoryId;
  betweenOwnAccounts: boolean;
  confidence: number;
  engineVersion: number;
}

export interface OnDeviceAlertModelRequest {
  /** Ephemeral input. Callers must never persist or transmit it. */
  source: string;
  market: ReviewAlert['market'];
  institution: string;
  family: ReviewAlert['family'];
  direction: ReviewAlert['direction'];
}

export type OnDeviceAlertModel = (request: OnDeviceAlertModelRequest) => Promise<unknown>;

const FORBIDDEN_OUTPUT_KEYS = new Set([
  'amount', 'amountFils', 'minorUnits', 'currency', 'direction', 'date', 'accountId',
  'instrument', 'status', 'posted', 'reference', 'smsKey', 'sourceKey',
]);

/**
 * Validate an optional on-device model proposal.
 *
 * The grounded parser owns money, direction, status, date and instrument.
 * A model can only help label an item the user is already reviewing. The
 * returned value is a suggestion—not a Transaction or an import command.
 */
export const constrainAlertAiProposal = (
  item: ReviewAlert,
  proposal: unknown,
): AlertAiSuggestion | null => {
  if (!proposal || typeof proposal !== 'object' || Array.isArray(proposal)) return null;
  const value = proposal as Record<string, unknown>;
  if (Object.keys(value).some((key) => FORBIDDEN_OUTPUT_KEYS.has(key))) return null;
  const title = typeof value.title === 'string' ? value.title.trim() : '';
  const category = value.category;
  const confidence = value.confidence;
  if (!title || title.length > 80 || /[\u0000-\u001F\u007F]/u.test(title) ||
    typeof category !== 'string' || typeof confidence !== 'number' ||
    !Number.isFinite(confidence) || confidence < 0.65 || confidence > 1) {
    return null;
  }
  const type: TransactionType = item.direction === 'credit' ? 'income' : 'expense';
  if (!CATEGORIES.some((candidate) => candidate.id === category && candidate.type === type)) {
    return null;
  }
  const betweenOwnAccounts = item.family === 'transfer' && value.betweenOwnAccounts === true;
  return {
    type,
    title,
    category: category as CategoryId,
    betweenOwnAccounts,
    confidence,
    engineVersion: ALERT_AI_SUGGESTION_VERSION,
  };
};

/**
 * Run an explicitly supplied on-device model. This module has no network
 * client and no default provider, so merely importing it cannot disclose an
 * alert. The source is bounded in memory and never appears in the result.
 */
export const suggestAlertOnDevice = async (
  source: string,
  item: ReviewAlert,
  model: OnDeviceAlertModel,
): Promise<AlertAiSuggestion | null> => {
  if (!source || source.length > 4096) return null;
  try {
    return constrainAlertAiProposal(item, await model({
      source,
      market: item.market,
      institution: item.institution,
      family: item.family,
      direction: item.direction,
    }));
  } catch {
    return null;
  }
};
