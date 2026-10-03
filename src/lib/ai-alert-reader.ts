/**
 * Capture-side entry point for AI reading of unrecognised alerts.
 *
 * Called ONLY after every proven path refused an alert and the refusal
 * pipeline found nothing to review (auto-import.ts inspectRefused,
 * 'ignored/unrecognized'). Returns a grounded UniversalBankEvent that becomes
 * a Review item with suggested fields, or null. It never posts, never
 * downloads and never runs for a UAE/Saudi sender. With the model absent (the
 * default: nothing downloads until the person asks) it resolves null
 * immediately, so capture behaves exactly as before.
 */
import { gateAiAlert } from '@/lib/ai-alert-extractor';
import { AI_ALERT_AUTOPOST_ENABLED, AI_ALERT_PREFILL_ENABLED } from '@/lib/ai-alert-flags';
import { aiAlertModelStatus, readAlertWithModel } from '@/lib/ai-alert-model';
import { bestEffortAutoPostEnabled } from '@/lib/best-effort-autopost';
import { activeCountryDateOrder, getActiveCountry } from '@/lib/country';
import {
  detectLaunchMarketFromAlert,
  detectLaunchMarketFromSender,
  ledgerCurrencyExponent,
  pinnedLedgerCurrencyCode,
} from '@/lib/markets';
import type { UniversalBankEvent } from '@/lib/universal-types';

export async function aiReviewEventForRefusedAlert(
  source: string,
  sender: string,
  observedAt: number,
): Promise<UniversalBankEvent | null> {
  try {
    if (!AI_ALERT_PREFILL_ENABLED) return null;
    // Cheapest check first: with no downloaded model nothing else runs.
    const { state } = aiAlertModelStatus();
    if (state !== 'downloaded' && state !== 'ready') return null;
    // Never for UAE/Saudi: not by sender, not by the alert's own AED/SAR
    // routing, not for a user whose country is a launch market.
    if (detectLaunchMarketFromSender(sender)) return null;
    const routed = detectLaunchMarketFromAlert(source, sender);
    if (routed) return null;
    const country = getActiveCountry();
    if (country === 'AE' || country === 'SA') return null;
    const prediction = await readAlertWithModel(source);
    if (!prediction) return null;
    const ledgerCurrency = pinnedLedgerCurrencyCode();
    const result = gateAiAlert(source, prediction, {
      sender,
      country,
      routedMarket: routed,
      ledgerCurrency,
      ledgerExponent: ledgerCurrency ? ledgerCurrencyExponent() : null,
      observedAt,
      dateOrder: activeCountryDateOrder(),
      autoPostEnabled: AI_ALERT_AUTOPOST_ENABLED,
      bestEffortEnabled: bestEffortAutoPostEnabled(),
    });
    // A 'post' outcome is not wired into the ledger in this build (every
    // language gate is OFF); it is treated as a prefill like any other.
    return result.outcome === 'refuse' ? null : result.event;
  } catch {
    // The AI reader must never abort a scan.
    return null;
  }
}
