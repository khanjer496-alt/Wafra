import { fetch as expoFetch } from 'expo/fetch';

import type { AppState } from '@/lib/types';
import type { AssistantToolRequest } from '@/lib/wafra-assistant';

const RESERVED_TOKEN = '__WAFRA_';
const MAX_QUESTION_CHARS = 1_000;
const REQUEST_TIMEOUT_MS = 6_000;

export type AssistantSemanticSubject =
  | 'account'
  | 'card'
  | 'bill'
  | 'merchant'
  | 'category'
  | 'subscription'
  | 'payment'
  | 'income'
  | 'spending'
  | 'unknown';

export interface AssistantSemanticContext {
  previousTool?: string;
  previousSubject?: AssistantSemanticSubject;
  language: 'en' | 'ar' | 'other';
}

interface RedactionCandidate {
  value: string;
  token: string;
}

export interface AssistantRedaction {
  question: string;
  candidates: readonly RedactionCandidate[];
  matchedTokens: readonly string[];
  digitTokens: readonly string[];
}

interface AssistantInterpretationResponse {
  supported?: unknown;
  confidence?: unknown;
  canonicalQuestion?: unknown;
}

const escapeRegExp = (value: string) => value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

function uniqueEntityValues(state: AppState): { kind: string; value: string }[] {
  const values: { kind: string; value: string }[] = [];
  for (const account of state.accounts) {
    values.push({ kind: 'ACCOUNT', value: account.name });
    if (account.bankName) values.push({ kind: 'BANK', value: account.bankName });
    if (account.last4) values.push({ kind: 'LAST4', value: account.last4 });
  }
  for (const bill of state.bills) values.push({ kind: 'BILL', value: bill.title });
  for (const transaction of state.transactions) values.push({ kind: 'MERCHANT', value: transaction.title });

  const seen = new Set<string>();
  return values
    .map(({ kind, value }) => ({ kind, value: value.trim() }))
    .filter(({ value }) => {
      if (!value || value.length > 160) return false;
      const key = value.normalize('NFKC').toLocaleLowerCase('en-US');
      if (seen.has(key)) return false;
      seen.add(key);
      return true;
    })
    .sort((a, b) => b.value.length - a.value.length || a.value.localeCompare(b.value));
}

function redactionPlan(state: AppState): RedactionCandidate[] {
  return uniqueEntityValues(state).map((entry, index) => ({
    value: entry.value,
    token: `${RESERVED_TOKEN}${entry.kind}_${index + 1}__`,
  }));
}

function replaceEntity(text: string, candidate: RedactionCandidate): string {
  const escaped = escapeRegExp(candidate.value);
  // Prefix capture avoids relying on look-behind support in every Hermes build.
  const pattern = new RegExp(`(^|[^\\p{L}\\p{N}])${escaped}(?=$|[^\\p{L}\\p{N}])`, 'giu');
  return text.replace(pattern, (_whole, prefix: string) => `${prefix}${candidate.token}`);
}

function occurrences(text: string, pattern: RegExp): string[] {
  return [...text.matchAll(pattern)].map((match) => match[0]);
}

function sameMultiset(left: readonly string[], right: readonly string[]): boolean {
  if (left.length !== right.length) return false;
  const sorted = (values: readonly string[]) => [...values].sort();
  return sorted(left).every((value, index) => value === sorted(right)[index]);
}

/**
 * Replace locally known financial identities before any language leaves the
 * device. Raw SMS, amounts, balances, ledger rows and local ids are never part
 * of this request. Every digit run is also tokenized: this hides amounts,
 * dates, card tails and reference numbers while still letting the model repair
 * language around an opaque numeric placeholder.
 */
export function redactAssistantQuestion(state: AppState, question: string): AssistantRedaction | null {
  const trimmed = question.trim().slice(0, MAX_QUESTION_CHARS);
  if (!trimmed || trimmed.includes(RESERVED_TOKEN)) return null;
  const candidates = redactionPlan(state);
  let redacted = trimmed;
  for (const candidate of candidates) redacted = replaceEntity(redacted, candidate);

  const allCandidates = [...candidates];
  let genericNumberIndex = 0;
  // Do not rewrite the numeric indexes inside placeholders emitted above.
  redacted = redacted.split(/(__WAFRA_[A-Z0-9_]+__)/g).map((part) => {
    if (/^__WAFRA_[A-Z0-9_]+__$/.test(part)) return part;
    return part.replace(/\d{1,18}/g, (value) => {
      const token = `${RESERVED_TOKEN}NUMBER_${++genericNumberIndex}__`;
      allCandidates.push({ value, token });
      return token;
    });
  }).join('');

  const matchedTokens = occurrences(redacted, /__WAFRA_[A-Z0-9_]+__/g);
  const digitTokens = occurrences(redacted, /\b\d+\b/g);
  return { question: redacted, candidates: allCandidates, matchedTokens, digitTokens };
}

function restoreCanonicalQuestion(
  original: AssistantRedaction,
  canonical: string,
): string | null {
  if (!canonical || canonical.length > MAX_QUESTION_CHARS || canonical.includes('\n')) return null;
  const outputTokens = occurrences(canonical, /__WAFRA_[A-Z0-9_]+__/g);
  if (!sameMultiset(original.matchedTokens, outputTokens)) return null;
  const outputDigits = occurrences(canonical, /\b\d+\b/g);
  if (!sameMultiset(original.digitTokens, outputDigits)) return null;

  // Catch a model inventing a locally known bank/account/merchant that was not
  // present in the outbound question. Re-redact its output with the SAME stable
  // plan; any newly appearing token means it introduced a financial identity.
  let safetyPass = canonical;
  for (const candidate of original.candidates) safetyPass = replaceEntity(safetyPass, candidate);
  const safetyTokens = occurrences(safetyPass, /__WAFRA_[A-Z0-9_]+__/g);
  if (!sameMultiset(original.matchedTokens, safetyTokens)) return null;

  let restored = canonical;
  for (const candidate of original.candidates) restored = restored.split(candidate.token).join(candidate.value);
  return restored.trim();
}

function semanticSubject(request?: AssistantToolRequest | null): AssistantSemanticSubject | undefined {
  if (!request) return undefined;
  if (request.tool === 'credit-card-settlement-summary') return 'card';
  if (request.tool === 'obligation-status') return request.obligation;
  if (request.tool === 'account-inventory') {
    return request.accountKind?.includes('card') ? 'card' : 'account';
  }
  if (request.tool === 'top-accounts' || request.tool === 'compare-accounts') {
    return request.tool === 'top-accounts' && request.accountKind === 'card' ? 'card' : 'account';
  }
  if (request.tool === 'merchant-breakdown' || request.tool === 'top-merchants') return 'merchant';
  if (request.tool === 'category-breakdown' || request.tool === 'top-categories') return 'category';
  if (request.tool === 'subscriptions' || request.tool === 'recurring-changes') return 'subscription';
  if (request.tool === 'upcoming-payments') return 'payment';
  if (request.tool === 'income-total') return 'income';
  if ('period' in request) return 'spending';
  return 'unknown';
}

export function assistantSemanticContext(
  language: string,
  previousRequest?: AssistantToolRequest | null,
): AssistantSemanticContext {
  return {
    ...(previousRequest ? { previousTool: previousRequest.tool } : {}),
    ...(semanticSubject(previousRequest) ? { previousSubject: semanticSubject(previousRequest) } : {}),
    language: language === 'ar' ? 'ar' : language === 'en' ? 'en' : 'other',
  };
}

function relayBaseUrl(): string | null {
  const raw = process.env.EXPO_PUBLIC_WAFRA_RELAY_URL?.trim();
  if (!raw) return null;
  try {
    const url = new URL(raw);
    if (url.protocol !== 'https:') return null;
    return url.toString().replace(/\/+$/, '');
  } catch {
    return null;
  }
}

/**
 * Language only: the relay/model receives a redacted sentence plus generic
 * conversational context. It never gets ledger rows, amounts, local ids, raw
 * SMS, card numbers or the mapping needed to reverse placeholders.
 */
export async function interpretAssistantLanguage(
  state: AppState,
  question: string,
  previousRequest?: AssistantToolRequest | null,
): Promise<string | null> {
  if (state.privateMode) return null;
  const base = relayBaseUrl();
  const redacted = redactAssistantQuestion(state, question);
  if (!base || !redacted) return null;

  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), REQUEST_TIMEOUT_MS);
  try {
    const response = await expoFetch(`${base}/v1/assistant/interpret`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        v: 1,
        question: redacted.question,
        context: assistantSemanticContext(state.language, previousRequest),
      }),
      signal: controller.signal,
    });
    if (!response.ok) return null;
    const parsed = await response.json() as AssistantInterpretationResponse;
    if (parsed.supported !== true || parsed.confidence !== 'high' || typeof parsed.canonicalQuestion !== 'string') return null;
    return restoreCanonicalQuestion(redacted, parsed.canonicalQuestion.trim());
  } catch {
    return null;
  } finally {
    clearTimeout(timeout);
  }
}
