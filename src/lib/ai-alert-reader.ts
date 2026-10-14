/** Source-grounded advisory access to the phone's model. Never a ledger writer. */
import { prepareAiSourceReview, applyAiSourceReview } from '@/lib/ai-alert-source-contract';
import { AI_ALERT_PREFILL_ENABLED } from '@/lib/ai-alert-flags';
import { activeCountryDateOrder, getActiveCountry } from '@/lib/country';
import { detectLaunchMarketFromAlert, detectLaunchMarketFromSender } from '@/lib/markets';
import { onDeviceAI, textLanguage, supportsOnDeviceLanguage, type OnDeviceAI } from '@/lib/on-device-ai';
import type { UniversalBankEvent, UniversalParseContext } from '@/lib/universal-types';

export interface AiAlertReviewOptions {
  runtime?: OnDeviceAI;
  enabled?: boolean;
  country?: string | null;
  dateOrder?: UniversalParseContext['dateOrder'];
  cancelled?: () => boolean;
  timeoutMs?: number;
  /** Capture sessions bound actual inference, not ordinary parser calls. */
  allowInference?: () => boolean;
}

export async function aiReviewEventForRefusedAlert(
  source: string,
  sender: string,
  observedAt: number,
  options: AiAlertReviewOptions = {},
): Promise<UniversalBankEvent | null> {
  const requestedTimeout = options.timeoutMs ?? 2_500;
  const timeoutMs = Number.isFinite(requestedTimeout) ? Math.min(8_000, Math.max(500, requestedTimeout)) : 2_500;
  let expired = false;
  let timer: ReturnType<typeof setTimeout> | null = null;
  const deadline = new Promise<null>((resolve) => {
    timer = setTimeout(() => { expired = true; resolve(null); }, timeoutMs);
  });
  const cancelled = () => expired || options.cancelled?.() === true;
  try {
    if (!(options.enabled ?? AI_ALERT_PREFILL_ENABLED) || cancelled()) return null;
    if (detectLaunchMarketFromSender(sender) || detectLaunchMarketFromAlert(source, sender)) return null;
    const country = options.country === undefined ? getActiveCountry() : options.country;
    if (country === 'AE' || country === 'SA') return null;
    const prepared = prepareAiSourceReview(source, {
      sender, observedAt, dateOrder: options.dateOrder ?? activeCountryDateOrder(),
    });
    if (!prepared) return null;
    // Reserve the session attempt before native availability/queueing: a hung
    // native check cannot add one deadline for every message in a bulk scan.
    if (options.allowInference && !options.allowInference()) return null;
    const runtime = options.runtime ?? onDeviceAI;
    const availability = await Promise.race([runtime.getAvailability(), deadline]);
    const language = textLanguage(source, 'en');
    if (!availability || !supportsOnDeviceLanguage(availability, language) || cancelled()) return null;
    const result = await Promise.race([runtime.respond({
      task: 'alert-review', ...prepared.request, language,
      maxTokens: 256, timeoutMs, cancelled,
    }), deadline]);
    if (!result || result.kind !== 'ok' || cancelled()) return null;
    return applyAiSourceReview(prepared, result.value);
  } catch {
    // Unavailable/old native binaries or hostile output cannot abort capture.
    return null;
  } finally {
    if (timer !== null) clearTimeout(timer);
  }
}

/** One inference per scan/drain/import session by default; no eager downloads. */
export function createAiAlertReviewSession(options: AiAlertReviewOptions & { maxInferences?: number } = {}) {
  const requested = options.maxInferences ?? 1;
  let remaining = Number.isSafeInteger(requested) ? Math.min(4, Math.max(0, requested)) : 0;
  return {
    read(source: string, sender: string, observedAt: number): Promise<UniversalBankEvent | null> {
      if (remaining <= 0) return Promise.resolve(null);
      return aiReviewEventForRefusedAlert(source, sender, observedAt, {
        ...options,
        allowInference: () => {
          if (remaining <= 0 || (options.allowInference && !options.allowInference())) return false;
          remaining -= 1;
          return true;
        },
      });
    },
  };
}
