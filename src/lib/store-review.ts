import AsyncStorage from '@react-native-async-storage/async-storage';
import Constants from 'expo-constants';
import { AppState, Platform } from 'react-native';

import { toISODate } from '@/lib/format';

/**
 * The platform's own rating prompt: Google Play In-App Review on Android,
 * the App Store review request (SKStoreReviewController) on iOS, through
 * expo-store-review.
 *
 * It is asked for only right after something went well (a statement import
 * that added rows, a closed month that cost less than the one before), and
 * only from someone who has lived with the app: onboarded, at least
 * STORE_REVIEW_MIN_USE_DAYS separate days of use and STORE_REVIEW_MIN_ROWS
 * rows in the ledger. Never on first launch, never behind App Lock or in the
 * background, and never from onboarding, the paywall, Review, an error or a
 * purchase: those screens do not call it (store-review.test.cjs holds the
 * call sites to that).
 *
 * At most once per app version, at most once every STORE_REVIEW_MIN_GAP_DAYS
 * days and never more than STORE_REVIEW_MAX_REQUESTS times in all. A request
 * counts when it is made: the OS decides whether to show anything and does
 * not say. There is no Wafra dialog before it ("do you like Wafra?") and
 * nothing is offered for a rating; store policy forbids both.
 *
 * The memory is a device preference beside the other one-time prompts
 * (widgets-hint, home-pace-nudge): local dates and request times, no ledger
 * data, never part of a backup, never sent anywhere. Every failure is silent
 * and fails closed: an unreadable or unwritable memory means no request.
 */
const STORAGE_KEY = 'wafra/ui/store-review/v1';

export const STORE_REVIEW_MIN_USE_DAYS = 3;
export const STORE_REVIEW_MIN_ROWS = 10;
export const STORE_REVIEW_MIN_GAP_DAYS = 120;
export const STORE_REVIEW_MAX_REQUESTS = 3;
const DAY_MS = 86_400_000;

export interface StoreReviewRequest {
  /** Epoch ms when the request was made. */
  at: number;
  /** The app version (Constants.expoConfig.version) it was made from. */
  version: string;
}

export interface StoreReviewMemory {
  /** Distinct local days (YYYY-MM-DD) the app came to the foreground; only the first few are kept. */
  useDays: string[];
  requests: StoreReviewRequest[];
}

const emptyMemory = (): StoreReviewMemory => ({ useDays: [], requests: [] });
const ISO_DAY = /^\d{4}-\d{2}-\d{2}$/;

/** A stored value, cleaned; anything unrecognisable is dropped. */
export function readStoreReviewMemory(raw: unknown): StoreReviewMemory {
  if (!raw || typeof raw !== 'object') return emptyMemory();
  const value = raw as { useDays?: unknown; requests?: unknown };
  const useDays = Array.isArray(value.useDays)
    ? [...new Set(value.useDays.filter((day): day is string => typeof day === 'string' && ISO_DAY.test(day)))]
    : [];
  const requests = Array.isArray(value.requests)
    ? value.requests.flatMap((entry): StoreReviewRequest[] => {
        const item = entry as { at?: unknown; version?: unknown } | null;
        return item && typeof item.at === 'number' && Number.isFinite(item.at) && typeof item.version === 'string'
          ? [{ at: item.at, version: item.version }] : [];
      })
    : [];
  return { useDays: useDays.slice(0, STORE_REVIEW_MIN_USE_DAYS), requests };
}

/** The memory with `todayISO` counted as a day of use; the same object when nothing changes. */
export function withUseDay(memory: StoreReviewMemory, todayISO: string): StoreReviewMemory {
  if (!ISO_DAY.test(todayISO) || memory.useDays.includes(todayISO)) return memory;
  // Only "has it reached the minimum" is ever asked, so stop recording there.
  if (memory.useDays.length >= STORE_REVIEW_MIN_USE_DAYS) return memory;
  return { ...memory, useDays: [...memory.useDays, todayISO] };
}

/** The once-per-version, once-per-120-days and three-in-all rules. */
export function storeReviewThrottleAllows(memory: StoreReviewMemory, version: string, nowMs: number): boolean {
  if (memory.requests.length >= STORE_REVIEW_MAX_REQUESTS) return false;
  if (memory.requests.some((request) => request.version === version)) return false;
  const last = Math.max(...memory.requests.map((request) => request.at), -Infinity);
  if (last === -Infinity) return true;
  // A clock set back past the last request cannot prove the gap: fail closed.
  if (nowMs < last) return false;
  return nowMs - last >= STORE_REVIEW_MIN_GAP_DAYS * DAY_MS;
}

export interface StoreReviewEligibilityInput {
  onboarded: boolean;
  /** Rows in the ledger. */
  ledgerRows: number;
  /** Distinct days of use recorded so far. */
  useDays: number;
  /** The financial UI is not hidden behind App Lock. */
  privacyGateCleared: boolean;
  /** The app is in the foreground. */
  active: boolean;
}

/** Whether this person, at this moment, may be asked at all (the throttle aside). */
export function storeReviewEligible(input: StoreReviewEligibilityInput): boolean {
  return input.onboarded && input.privacyGateCleared && input.active &&
    input.useDays >= STORE_REVIEW_MIN_USE_DAYS && input.ledgerRows >= STORE_REVIEW_MIN_ROWS;
}

/**
 * A finished recap is a good moment only for a period that has closed and
 * cost less than the one before it (which must have had spending to compare).
 */
export function recapWentWell(
  snapshot: { to: string; previousSpendFils: number | null; spendChangeFils: number | null },
  todayISO: string,
): boolean {
  return snapshot.to < todayISO && (snapshot.previousSpendFils ?? 0) > 0 &&
    snapshot.spendChangeFils !== null && snapshot.spendChangeFils < 0;
}

async function loadMemory(): Promise<StoreReviewMemory | null> {
  try {
    const raw = await AsyncStorage.getItem(STORAGE_KEY);
    return raw === null ? emptyMemory() : readStoreReviewMemory(JSON.parse(raw));
  } catch {
    return null;
  }
}

async function saveMemory(memory: StoreReviewMemory): Promise<boolean> {
  try {
    await AsyncStorage.setItem(STORAGE_KEY, JSON.stringify(memory));
    return true;
  } catch {
    return false;
  }
}

let notedDay: string | null = null;

async function noteUseDay(now = new Date()): Promise<void> {
  const today = toISODate(now);
  if (notedDay === today) return;
  notedDay = today;
  const memory = await loadMemory();
  if (!memory) return;
  const next = withUseDay(memory, today);
  if (next !== memory) await saveMemory(next);
}

/**
 * Counts today, and every later day the app returns to the foreground, as a
 * day of use. At most one storage write a day, none once the minimum is met.
 */
export function startStoreReviewUseDays(): () => void {
  if (Platform.OS === 'web') return () => {};
  if (AppState.currentState === 'active') void noteUseDay();
  const subscription = AppState.addEventListener('change', (next) => {
    if (next === 'active') void noteUseDay();
  });
  return () => subscription.remove();
}

let requesting = false;

/**
 * Asks the OS for its rating prompt when every rule allows it. Call it only
 * from the good moments named above, after the moment's own check. Resolves
 * true when a request was made (the OS may still show nothing); never throws.
 */
export async function requestStoreReviewIfDue(input: {
  onboarded: boolean;
  ledgerRows: number;
  privacyGateCleared: boolean;
}): Promise<boolean> {
  if (Platform.OS === 'web' || requesting) return false;
  requesting = true;
  try {
    const memory = await loadMemory();
    if (!memory) return false;
    const eligible = (): boolean => storeReviewEligible({
      ...input, useDays: memory.useDays.length, active: AppState.currentState === 'active',
    });
    if (!eligible()) return false;
    const version = Constants.expoConfig?.version;
    const now = Date.now();
    if (!version || !storeReviewThrottleAllows(memory, version, now)) return false;
    // Loaded only here, so a build without the native module (or Expo Go
    // without it) fails this promise instead of the app's startup.
    const StoreReview = await import('expo-store-review');
    // isAvailableAsync, not hasAction: hasAction is also true when a store
    // URL is configured, and requestReview then opens the store page instead
    // of the in-app prompt. No native prompt, no request.
    if (!(await StoreReview.isAvailableAsync())) return false;
    // The app may have left the foreground while this was read (App Lock
    // only re-engages after a longer absence, which starts in the background).
    if (!eligible()) return false;
    // Counted before it is made: a request whose record cannot be kept is not made.
    if (!(await saveMemory({ ...memory, requests: [...memory.requests, { at: now, version }] }))) return false;
    await StoreReview.requestReview();
    return true;
  } catch {
    return false;
  } finally {
    requesting = false;
  }
}
