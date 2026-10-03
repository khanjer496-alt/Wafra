/**
 * Per-language rollout gates for AI reading of unrecognised bank alerts.
 *
 * Review PREFILL (suggestions a person confirms) may run for every language
 * once the model is on the device. Automatic POSTING from a model reading is
 * allowed only for a language listed here with `autoPost: true`, and a
 * language may be switched on only after it passes on at least
 * `AI_AUTOPOST_MIN_REAL_LABELLED` labelled REAL messages (not synthetic, not
 * public samples used for tuning) with false posts ≤ 0.3 % and fully correct
 * posted rows ≥ 98 %. No language has that evidence yet: every gate is OFF.
 * See docs/universal-parser-rollout.md ("AI reading of unrecognised alerts").
 */
import type { AiCueLanguage } from '@/lib/ai-alert-cues';

export const AI_AUTOPOST_MIN_REAL_LABELLED = 500;
export const AI_AUTOPOST_MAX_FALSE_POST_RATE = 0.003;
export const AI_AUTOPOST_MIN_POSTED_PRECISION = 0.98;

export interface AiLanguageGate {
  autoPost: boolean;
  /** Labelled real messages the gate was evaluated on (0 = none yet). */
  realLabelled: number;
}

export const AI_LANGUAGE_GATES: Readonly<Record<AiCueLanguage, AiLanguageGate>> = Object.freeze({
  en: { autoPost: false, realLabelled: 0 },
  ar: { autoPost: false, realLabelled: 0 },
  es: { autoPost: false, realLabelled: 0 },
  pt: { autoPost: false, realLabelled: 0 },
  fr: { autoPost: false, realLabelled: 0 },
  de: { autoPost: false, realLabelled: 0 },
  it: { autoPost: false, realLabelled: 0 },
  nl: { autoPost: false, realLabelled: 0 },
  tr: { autoPost: false, realLabelled: 0 },
  id: { autoPost: false, realLabelled: 0 },
  'hi-latn': { autoPost: false, realLabelled: 0 },
});

export function aiAutoPostAllowedForLanguage(language: AiCueLanguage): boolean {
  const gate = AI_LANGUAGE_GATES[language];
  return !!gate && gate.autoPost && gate.realLabelled >= AI_AUTOPOST_MIN_REAL_LABELLED;
}
