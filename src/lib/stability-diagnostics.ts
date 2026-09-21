import AsyncStorage from '@react-native-async-storage/async-storage';
import { AppState, Platform } from 'react-native';

import StabilityNative, { type AndroidHistoricalExit } from '../../modules/wafra-stability';

const EVENT_KEY = 'wafra:stability-events:v1';
const SESSION_KEY = 'wafra:stability-session:v1';
const MAX_EVENTS = 32;

type StabilityEvent = {
  at: number;
  kind: 'fatal-js' | 'js-error' | 'unclean-foreground-exit';
  errorName?: string;
  stackFrames?: string[];
};

type ErrorUtilsLike = {
  getGlobalHandler?: () => (error: Error, isFatal?: boolean) => void;
  setGlobalHandler?: (handler: (error: Error, isFatal?: boolean) => void) => void;
};

let installed = false;
let writes = Promise.resolve();

async function readEvents(): Promise<StabilityEvent[]> {
  try {
    const raw = await AsyncStorage.getItem(EVENT_KEY);
    if (!raw) return [];
    const parsed: unknown = JSON.parse(raw);
    if (!Array.isArray(parsed)) return [];
    return parsed.filter((row): row is StabilityEvent => Boolean(
      row && typeof row === 'object' && Number.isFinite((row as StabilityEvent).at) &&
      typeof (row as StabilityEvent).kind === 'string',
    )).slice(-MAX_EVENTS);
  } catch {
    return [];
  }
}

function sourceOnlyFrames(error: Error): string[] | undefined {
  if (typeof error.stack !== 'string') return undefined;
  // Keep only frame-shaped lines ("at fn (…)" / "fn@…"). The free-form error
  // message may span several lines and may quote data, so it is never kept.
  // Remove URL/file prefixes and bound the length of what remains.
  const frames = error.stack.split('\n')
    .filter((line) => /^\s*at\s|@/.test(line))
    .slice(0, 6)
    .map((line) => line
      .replace(/https?:\/\/[^\s)]+/g, '<bundle>')
      .replace(/file:\/\/[^\s)]+/g, '<bundle>')
      .trim().slice(0, 180)).filter(Boolean);
  return frames.length ? frames : undefined;
}

function append(event: StabilityEvent): void {
  writes = writes.then(async () => {
    const events = await readEvents();
    events.push(event);
    await AsyncStorage.setItem(EVENT_KEY, JSON.stringify(events.slice(-MAX_EVENTS)));
  }).catch(() => {
    // A diagnostic recorder may never mask or cause a crash.
  });
}

async function markSession(active: boolean): Promise<void> {
  try {
    await AsyncStorage.setItem(SESSION_KEY, JSON.stringify({ active, updatedAt: Date.now() }));
  } catch {
    // Best-effort marker only.
  }
}

async function detectPreviousUncleanForegroundExit(): Promise<void> {
  try {
    const raw = await AsyncStorage.getItem(SESSION_KEY);
    const parsed = raw ? JSON.parse(raw) as { active?: unknown; updatedAt?: unknown } : null;
    if (parsed?.active === true && Number.isFinite(parsed.updatedAt) &&
      Date.now() - Number(parsed.updatedAt) < 7 * 24 * 60 * 60 * 1000) {
      // This deliberately says "unclean", not "crash": a force-stop while the
      // app is foregrounded looks the same from JS. Android's native exit
      // reason below disambiguates crash/ANR/low-memory on Android 11+.
      append({ at: Date.now(), kind: 'unclean-foreground-exit' });
    }
  } catch {
    // Corrupt diagnostic state is ignored rather than affecting launch.
  }
  await markSession(AppState.currentState === 'active');
}

export function installStabilityDiagnostics(): void {
  if (installed) return;
  installed = true;
  void detectPreviousUncleanForegroundExit();

  AppState.addEventListener('change', (next) => {
    void markSession(next === 'active');
  });

  const errorUtils = (globalThis as typeof globalThis & { ErrorUtils?: ErrorUtilsLike }).ErrorUtils;
  if (!errorUtils?.setGlobalHandler) return;
  const previous = errorUtils.getGlobalHandler?.();
  errorUtils.setGlobalHandler((error, isFatal) => {
    append({
      at: Date.now(),
      kind: isFatal ? 'fatal-js' : 'js-error',
      errorName: typeof error?.name === 'string' ? error.name.slice(0, 80) : 'Error',
      stackFrames: error instanceof Error ? sourceOnlyFrames(error) : undefined,
    });
    previous?.(error, isFatal);
  });
}

export async function getStabilityDiagnostics(now = Date.now()) {
  await writes.catch(() => {});
  const local = await readEvents();
  let androidExits: AndroidHistoricalExit[] = [];
  if (Platform.OS === 'android' && StabilityNative?.getHistoricalExits) {
    try {
      androidExits = await StabilityNative.getHistoricalExits(12);
    } catch {
      androidExits = [];
    }
  }
  return {
    schema: 1,
    local: local.map((row) => ({
      ...row,
      at: undefined,
      ageMs: Math.max(0, now - row.at),
    })),
    androidHistoricalExits: androidExits.map((row) => ({
      ...row,
      timestamp: undefined,
      ageMs: Math.max(0, now - row.timestamp),
    })),
  };
}

installStabilityDiagnostics();
