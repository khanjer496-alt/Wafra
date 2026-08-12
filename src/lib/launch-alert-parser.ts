import { inspectUniversalAlert, type UniversalAlertReview } from '@/lib/alert-market-detection';
import {
  detectLaunchMarketFromAlert,
  getActiveMarket,
  pinnedLedgerCurrencyCode,
  withMarketPackForParsing,
} from '@/lib/markets';
import { parseSms, type ParsedSms } from '@/lib/sms-parser';
import type { CategoryId } from '@/lib/types';

// Cheap supersets used only to decide whether market routing must run. The
// parser/reviewer remains the authority; matching one of these never imports.
export const REVIEW_MONEY_HINT = /\b(?:USD|GBP|EUR|INR|QAR|KWD|BHD|OMR|EGP|JOD|Rs\.?|KD|BD|RO|R\.O\.|LE|L\.E\.|JD)\b|[$€£₹]|ر\.ق|د\.ك|د\.ب|ر\.ع|ج\.م|د\.[أا]/iu;
const LAUNCH_MONEY_HINT = /\b(?:AED|Dhs?\.?|SAR|SR)\b|د\.?[إا]\.?|دراهم|درهم|ر\.?\s?س\.?|ريال/iu;

export interface LaunchAlertSession {
  inspect(source: string, sender: string): UniversalAlertReview | null;
  parse(
    source: string,
    sender: string,
    inspection?: UniversalAlertReview | null,
    forcedMarket?: string,
  ): ParsedSms | null;
  detectedMarket(): 'AE' | 'SA' | null;
}

/**
 * One ordered capture session's launch-parser policy.
 *
 * Keeping routing, global-issuer refusal and the single Gulf-market lock here
 * lets the phone scanner and the private corpus audit execute exactly the same
 * decision. The session is intentionally stateful: once a corpus establishes
 * UAE or Saudi, a conflicting alert cannot silently switch money systems.
 */
export const createLaunchAlertSession = ({
  overrides,
  regionHint = null,
  pinnedCurrency = pinnedLedgerCurrencyCode(),
  activeMarket = getActiveMarket().id,
}: {
  overrides: Record<string, CategoryId>;
  regionHint?: string | null;
  pinnedCurrency?: string | null;
  activeMarket?: string;
}): LaunchAlertSession => {
  let sessionMarket: 'AE' | 'SA' | null =
    pinnedCurrency === 'AED' ? 'AE' : pinnedCurrency === 'SAR' ? 'SA' : null;
  let detected: 'AE' | 'SA' | null = null;

  const inspect = (source: string, sender: string): UniversalAlertReview | null => {
    if (!REVIEW_MONEY_HINT.test(source)) return null;
    try {
      return inspectUniversalAlert({ source, sender, regionHint });
    } catch {
      return null;
    }
  };

  const parse = (
    source: string,
    sender: string,
    inspection: UniversalAlertReview | null = null,
    forcedMarket?: string,
  ): ParsedSms | null => {
    if (
      inspection?.route.decision === 'single' &&
      inspection.route.market !== 'AE' &&
      inspection.route.market !== 'SA'
    ) return null;
    const routed = forcedMarket === 'AE' || forcedMarket === 'SA'
      ? forcedMarket
      : inspection?.route.decision === 'single' &&
          (inspection.route.market === 'AE' || inspection.route.market === 'SA')
        ? inspection.route.market
        : detectLaunchMarketFromAlert(source, sender);
    if ((REVIEW_MONEY_HINT.test(source) || LAUNCH_MONEY_HINT.test(source)) && !routed) return null;
    const desired = routed ?? sessionMarket ?? activeMarket;
    if (desired !== 'AE' && desired !== 'SA') return null;
    if (sessionMarket && desired !== sessionMarket) return null;
    const result = withMarketPackForParsing(desired, () =>
      parseSms(source, overrides, { sender }));
    if (result && routed) {
      sessionMarket ??= routed;
      detected = routed;
    }
    return result;
  };

  return { inspect, parse, detectedMarket: () => detected };
};
