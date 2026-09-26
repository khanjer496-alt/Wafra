/**
 * Capture-side entry point for AI reading of unrecognised alerts.
 *
 * Called ONLY after every proven path, the person's learned formats and the
 * refusal pipeline found nothing to review (auto-import.ts inspectRefused and
 * the iOS queue in ai-alert-prefill-queue.ts, 'ignored/unrecognized'). Returns
 * a grounded UniversalBankEvent that becomes a Review item labelled
 * "Suggested by on-device AI", or null. It never posts, never downloads and
 * never runs for a UAE/Saudi sender, route or user.
 *
 * Engines, in order:
 *  1. the phone's own model (Apple Foundation Models / Gemini Nano, see
 *     ai-alert-platform-reader.ts) when the OS reports it available, the
 *     phone is not in Low Power Mode, the alert is recent and the rate budget
 *     allows — one request at a time, with a timeout;
 *  2. the downloaded tagger (ai-alert-model*.ts), only when the person
 *     downloaded it in Settings;
 *  3. nothing: the alert is handled exactly as before.
 * Both readings pass through the same deterministic gate (gateAiAlert); the
 * phone model's direction is kept only when a direction cue in the text
 * agrees with it, otherwise the person picks it in Review.
 */
import { gateAiAlert, type AiAlertPrediction } from '@/lib/ai-alert-extractor';
import { AI_ALERT_AUTOPOST_ENABLED, AI_ALERT_PREFILL_ENABLED } from '@/lib/ai-alert-flags';
import { aiAlertModelStatus, readAlertWithModel } from '@/lib/ai-alert-model';
import { readAlertWithPlatformModel } from '@/lib/ai-alert-platform-reader';
import { bestEffortAutoPostEnabled } from '@/lib/best-effort-autopost';
import { activeCountryDateOrder, getActiveCountry } from '@/lib/country';
import {
  detectLaunchMarketFromAlert,
  detectLaunchMarketFromSender,
  ledgerCurrencyExponent,
  pinnedLedgerCurrencyCode,
} from '@/lib/markets';
import { onDeviceAI, type OnDeviceAI } from '@/lib/on-device-ai';
import type { UniversalBankEvent } from '@/lib/universal-types';
import { AppState } from 'react-native';

export interface AiReviewReading {
  event: UniversalBankEvent;
  engine: 'platform' | 'tagger';
}

/** Only alerts observed this recently are sent to the phone's model (live capture, not a years-long history import). */
export const PLATFORM_READ_RECENT_MS = 3 * 24 * 60 * 60 * 1000;
/** At most this many phone-model readings per rolling window. */
export const PLATFORM_READ_BUDGET = { max: 6, windowMs: 10 * 60 * 1000 } as const;

/* ── setting mirror: "Suggest fields with on-device AI" (undefined = ON) ── */
let prefillSetting = true;
export function setAiAlertPrefillEnabled(enabled: boolean | undefined): void {
  prefillSetting = enabled !== false;
}
export const aiAlertPrefillEnabled = (): boolean => prefillSetting;

let platformReads: number[] = [];
/** Tests only. */
export function resetAiAlertReaderBudget(): void {
  platformReads = [];
}

const takeBudget = (now: number): boolean => {
  platformReads = platformReads.filter((at) => now - at < PLATFORM_READ_BUDGET.windowMs);
  if (platformReads.length >= PLATFORM_READ_BUDGET.max) return false;
  platformReads.push(now);
  return true;
};

export interface AiReaderDeps {
  ai: OnDeviceAI | null;
  readTagger: (source: string) => Promise<AiAlertPrediction | null>;
  taggerReady: () => boolean;
  now: () => number;
  /**
   * The app is in the foreground. The phone model is only asked then: Android
   * AICore refuses background inference, and a background wake must not wait
   * on it.
   */
  foreground: () => boolean;
}

const defaultDeps: AiReaderDeps = {
  ai: onDeviceAI,
  readTagger: readAlertWithModel,
  taggerReady: () => {
    const { state } = aiAlertModelStatus();
    return state === 'downloaded' || state === 'ready';
  },
  now: () => Date.now(),
  foreground: () => AppState?.currentState === 'active',
};

const CUE_BLOCKERS = new Set(['direction-cue-missing', 'direction-cue-conflict', 'direction-family-conflict']);

export async function aiReviewEventForRefusedAlert(
  source: string,
  sender: string,
  observedAt: number,
  deps: AiReaderDeps = defaultDeps,
): Promise<AiReviewReading | null> {
  try {
    if (!AI_ALERT_PREFILL_ENABLED || !prefillSetting) return null;
    // Never for UAE/Saudi: not by sender, not by the alert's own AED/SAR
    // routing, not for a user whose country is a launch market.
    if (detectLaunchMarketFromSender(sender)) return null;
    const routed = detectLaunchMarketFromAlert(source, sender);
    if (routed) return null;
    const country = getActiveCountry();
    if (country === 'AE' || country === 'SA') return null;
    const ledgerCurrency = pinnedLedgerCurrencyCode();
    if (ledgerCurrency === 'AED' || ledgerCurrency === 'SAR') return null;
    const gate = (prediction: AiAlertPrediction) => gateAiAlert(source, prediction, {
      sender,
      country,
      routedMarket: routed,
      ledgerCurrency,
      ledgerExponent: ledgerCurrency ? ledgerCurrencyExponent() : null,
      observedAt,
      dateOrder: activeCountryDateOrder(),
      // The phone model never posts; the tagger's post path is not wired.
      autoPostEnabled: prediction.engine === 'tagger' ? AI_ALERT_AUTOPOST_ENABLED : false,
      bestEffortEnabled: bestEffortAutoPostEnabled(),
    });

    // 1. The phone's own model.
    const now = deps.now();
    // Low Power Mode / Battery Saver skips every optional model reading.
    if (deps.ai && await deps.ai.lowPowerMode()) return null;
    if (deps.ai && deps.foreground() && Number.isFinite(observedAt) && now - observedAt <= PLATFORM_READ_RECENT_MS) {
      const availability = await deps.ai.getAvailability();
      if (availability.status === 'available' && takeBudget(now)) {
        const prediction = await readAlertWithPlatformModel(source, deps.ai);
        const result = prediction ? gate(prediction) : null;
        if (result && result.outcome !== 'refuse') {
          const blockers: readonly string[] = result.outcome === 'prefill' ? result.blockers : [];
          const cueBacked = !blockers.some((blocker) => CUE_BLOCKERS.has(blocker));
          const event: UniversalBankEvent = cueBacked ? result.event : { ...result.event, direction: 'unknown' };
          return { event, engine: 'platform' };
        }
      }
    }

    // 2. The downloaded tagger (cheapest check first: nothing runs without it).
    if (!deps.taggerReady()) return null;
    const prediction = await deps.readTagger(source);
    if (!prediction) return null;
    const result = gate(prediction);
    // A 'post' outcome is not wired into the ledger in this build (every
    // language gate is OFF); it is treated as a prefill like any other.
    return result.outcome === 'refuse' ? null : { event: result.event, engine: 'tagger' };
  } catch {
    // The AI reader must never abort a scan.
    return null;
  }
}
