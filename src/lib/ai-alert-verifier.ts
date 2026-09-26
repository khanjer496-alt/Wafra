/**
 * AI SECOND OPINION on alerts the deterministic parser DID read (including
 * AE/SA). The model never overrides the rules and never changes a value; it
 * can only ask for a human look:
 *  - 'review'  the model is very sure the alert is NOT a completed movement
 *              (pending / declined / OTP / promotion / request / scheduled)
 *              while the rules posted it → hold in Review instead of posting;
 *  - 'check'   a high-confidence disagreement on amount, currency or
 *              direction, where the model's reading is itself grounded in the
 *              text (its amount is a real money token; its direction has a
 *              text cue of that polarity) → post as the rules said, marked
 *              "Check this";
 *  - 'agree'   anything else (including low confidence).
 * Behind AI_ALERT_VERIFIER_ENABLED (default OFF) and not wired into capture in
 * this build: scripts/parser-ai/verifier-eval.cjs measures flag rate and flag
 * precision first.
 */
import type { AiAlertPrediction } from '@/lib/ai-alert-extractor';
import { cueSupportedDirection, localCurrencyAliases } from '@/lib/ai-alert-cues';
import { inspectUniversalMoneyDraft } from '@/lib/universal-money';

export interface RulesReading {
  /** Minor units and ISO currency of the alert's own amount as the rules read it. */
  minorUnits: string;
  currency: string;
  direction: 'debit' | 'credit';
}

export interface VerifierThresholds {
  status: number;
  amount: number;
  direction: number;
}

export const DEFAULT_VERIFIER_THRESHOLDS: VerifierThresholds = Object.freeze({ status: 0.995, amount: 0.97, direction: 0.99 });

export type VerifierReason = 'status-not-completed' | 'amount-differs' | 'currency-differs' | 'direction-differs';
export interface VerifierVerdict {
  verdict: 'agree' | 'check' | 'review';
  reasons: VerifierReason[];
}

const NOT_COMPLETED = new Set(['pending', 'declined', 'otp', 'promo', 'request', 'future']);

export function verifyRulesReading(
  source: string,
  rules: RulesReading,
  prediction: AiAlertPrediction,
  country: string | null,
  thresholds: VerifierThresholds = DEFAULT_VERIFIER_THRESHOLDS,
): VerifierVerdict {
  if (NOT_COMPLETED.has(prediction.status) && prediction.statusP >= thresholds.status) {
    return { verdict: 'review', reasons: ['status-not-completed'] };
  }
  const reasons: VerifierReason[] = [];
  const amounts = prediction.spans.filter((s) => s.label === 'AMT');
  const first = amounts[0];
  if (first && first.p >= thresholds.amount) {
    const draft = inspectUniversalMoneyDraft(source, { currencyAliases: localCurrencyAliases(country) });
    const hits = draft.candidates.filter((c) => c.span.start < first.end && first.start < c.span.end);
    if (hits.length === 1 && hits[0].interpretations.length === 1) {
      const model = hits[0].interpretations[0];
      // A rules amount that appears as a money token elsewhere (the card's
      // own converted figure) is not a disagreement about the principal.
      const rulesFigurePresent = draft.candidates.some((c) =>
        c.interpretations.some((i) => i.minorUnits === rules.minorUnits && i.currency === rules.currency));
      if (model.currency !== rules.currency && !rulesFigurePresent) reasons.push('currency-differs');
      else if (model.minorUnits !== rules.minorUnits && model.currency === rules.currency) reasons.push('amount-differs');
    }
  }
  if (prediction.direction !== 'none' && prediction.direction !== rules.direction &&
    prediction.directionP >= thresholds.direction && cueSupportedDirection(source) === prediction.direction) {
    reasons.push('direction-differs');
  }
  return { verdict: reasons.length ? 'check' : 'agree', reasons };
}
