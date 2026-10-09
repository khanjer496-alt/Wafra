/**
 * Where Home keeps its over-pace memory (home-hero.ts: nextPaceMemory): the
 * last pace it saw for the month and the day it last nudged, so the haptic
 * fires at most once a day across launches. A device preference, never part
 * of the ledger or a backup. Every failure is silent: a missed or repeated
 * nudge is not worth an error.
 */
import AsyncStorage from '@react-native-async-storage/async-storage';

import { readPaceMemory, type PaceMemory } from '@/lib/home-hero';

export const HOME_PACE_NUDGE_KEY = 'wafra/ui/home-pace-nudge/v1';

export async function loadPaceMemory(): Promise<PaceMemory | null> {
  try {
    const raw = await AsyncStorage.getItem(HOME_PACE_NUDGE_KEY);
    return raw ? readPaceMemory(JSON.parse(raw)) : null;
  } catch {
    return null;
  }
}

export async function savePaceMemory(memory: PaceMemory): Promise<void> {
  try {
    await AsyncStorage.setItem(HOME_PACE_NUDGE_KEY, JSON.stringify(memory));
  } catch {
    // Best effort; the next observation records again.
  }
}
