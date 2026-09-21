import AsyncStorage from '@react-native-async-storage/async-storage';

import {
  setGrowthEventSink,
  type GrowthEvent,
  type GrowthEventPayload,
} from '@/lib/growth-funnel';

const STORAGE_KEY = 'wafra:growth-funnel-diagnostics:v1';
const MAX_EVENTS = 160;

export interface GrowthDiagnosticEvent {
  at: number;
  event: GrowthEvent;
  payload: Pick<GrowthEventPayload, 'focus' | 'tracking' | 'platform' | 'placement' | 'outcome'> & {
    source?: string;
  };
}

let writeChain = Promise.resolve();

function safePayload(payload: GrowthEventPayload): GrowthDiagnosticEvent['payload'] {
  // Closed, low-cardinality product-state values only. This sink has no field
  // for an amount, merchant, account/card id, bank message or ledger row.
  return {
    ...(payload.focus ? { focus: payload.focus } : {}),
    ...(payload.tracking ? { tracking: payload.tracking } : {}),
    ...(payload.platform ? { platform: payload.platform } : {}),
    ...(payload.placement ? { placement: payload.placement } : {}),
    ...(payload.outcome ? { outcome: payload.outcome } : {}),
    ...(('source' in payload && typeof payload.source === 'string') ? { source: payload.source } : {}),
  };
}

async function readEvents(): Promise<GrowthDiagnosticEvent[]> {
  try {
    const raw = await AsyncStorage.getItem(STORAGE_KEY);
    if (!raw) return [];
    const parsed: unknown = JSON.parse(raw);
    if (!Array.isArray(parsed)) return [];
    return parsed.filter((row): row is GrowthDiagnosticEvent => Boolean(
      row && typeof row === 'object' && Number.isFinite((row as GrowthDiagnosticEvent).at) &&
      typeof (row as GrowthDiagnosticEvent).event === 'string',
    )).slice(-MAX_EVENTS);
  } catch {
    return [];
  }
}

function append(event: GrowthEvent, payload: GrowthEventPayload): void {
  writeChain = writeChain.then(async () => {
    const events = await readEvents();
    events.push({ at: Date.now(), event, payload: safePayload(payload) });
    await AsyncStorage.setItem(STORAGE_KEY, JSON.stringify(events.slice(-MAX_EVENTS)));
  }).catch(() => {
    // Diagnostics must never block onboarding/capture/navigation.
  });
}

/** Install one on-device, source-free sink for the existing growth vocabulary. */
export function installGrowthFunnelDiagnostics(): void {
  setGrowthEventSink(append);
}

export async function getGrowthFunnelDiagnostics(now = Date.now()) {
  await writeChain.catch(() => {});
  const events = await readEvents();
  const counts: Record<string, number> = {};
  for (const row of events) counts[row.event] = (counts[row.event] ?? 0) + 1;
  return {
    schema: 1,
    retainedEvents: events.length,
    counts,
    events: events.map((row) => ({
      ageMs: Math.max(0, now - row.at),
      event: row.event,
      payload: row.payload,
    })),
  };
}

installGrowthFunnelDiagnostics();
