/**
 * ⚠️ RECONSTRUCTED PLUMBING HARNESS — FAIL-CLOSED STUB ⚠️
 *
 * `certifyUniversalTemplate` is imported by `auto-import.ts` but was never
 * committed to this repository, in any ref or commit. Its absence stops Metro
 * resolving the module, which blocks every bundle and therefore the on-device
 * runtime verification.
 *
 * THIS STUB IS NOT THE CERTIFICATION LOGIC. It exists only so a bundle can be
 * produced for device testing.
 *
 * Why it returns 'review' and nothing else: at the call site, a decision of
 * 'automatic' or 'semantic-generalized' is what admits a universally-parsed
 * event to `parsedUniversalPosting` — that is, straight into the ledger
 * without a human looking at it. A stub that guessed would silently
 * auto-import transactions on unfamiliar banks. So this one refuses to
 * certify anything: every event is routed to Review, which is the safe
 * direction and matches the project's rule that semantic mistakes must become
 * Review rather than money.
 *
 * The visible consequence in a harness build is that
 * `notificationImportStats.certificationReview` counts everything and
 * `certificationAutomatic` / `semanticGeneralized` stay at zero. That is
 * expected and is NOT evidence about the real certifier's behaviour. Do not
 * read template-certification metrics from a build containing this file.
 */

import type { UniversalBankEvent } from '@/lib/universal-types';

export type UniversalTemplateDecision =
  | 'automatic'
  | 'semantic-generalized'
  | 'review'
  | 'adapter-required'
  | 'never-post';

export interface UniversalTemplateCertificationInput {
  market: string;
  institution: string | null;
  source: string;
  event: UniversalBankEvent;
  rail: string | null;
  allowSemanticGeneralization: boolean;
}

export interface UniversalTemplateCertification {
  decision: UniversalTemplateDecision;
  templateId: string | null;
  /** Why this decision was reached; surfaced in source-free diagnostics. */
  reason: string;
}

export function certifyUniversalTemplate(
  _input: UniversalTemplateCertificationInput,
): UniversalTemplateCertification {
  return {
    decision: 'review',
    templateId: null,
    reason: 'certification-module-not-recovered',
  };
}
