import { inspectUnparsedLaunchAlert } from '@/lib/unparsed-launch-alert';

export interface LaunchReviewFixture {
  id: string;
  source: string;
  sender: string;
  expected: 'review' | 'refuse';
  market?: 'AE' | 'SA';
  direction?: 'debit' | 'credit';
  minorUnits?: string;
  provenance: 'synthetic' | 'consented-redacted';
  heldOut: boolean;
}

export interface LaunchReviewRolloutReport {
  total: number;
  heldOut: number;
  consentedHeldOut: number;
  expectedReview: number;
  expectedRefuse: number;
  reviewRecall: number;
  unsafeAdmissionRate: number;
  exactFieldRate: number;
  reviewBetaReady: boolean;
  blockers: string[];
  /** Runner-generated references only; fixture ids and alert text never leave the runner. */
  failures: { fixtureRef: string; reason: string }[];
}

const safeRatio = (numerator: number, denominator: number): number =>
  denominator === 0 ? 0 : numerator / denominator;

/**
 * Evaluate the conservative Gulf review fallback without emitting alert text,
 * sender ids, fixture ids, hashes, or model output. This gate can approve a
 * review beta only; it can never authorize automatic ledger posting.
 */
export const runLaunchReviewRollout = (
  fixtures: readonly LaunchReviewFixture[],
): LaunchReviewRolloutReport => {
  const failures: LaunchReviewRolloutReport['failures'] = [];
  const seenIds = new Set<string>();
  const seenSources = new Set<string>();
  let expectedReview = 0;
  let expectedRefuse = 0;
  let reviewed = 0;
  let unsafeAdmissions = 0;
  let exactFields = 0;
  let heldOut = 0;
  let consentedHeldOut = 0;

  fixtures.forEach((fixture, index) => {
    const fixtureRef = `fixture-${index + 1}`;
    const normalizedSource = fixture.source.normalize('NFKC').replace(/\s+/g, ' ').trim();
    if (!/^[a-z0-9][a-z0-9_-]{2,63}$/.test(fixture.id) || seenIds.has(fixture.id) ||
      !normalizedSource || seenSources.has(normalizedSource)) {
      failures.push({ fixtureRef, reason: 'invalid-or-duplicate-fixture' });
      return;
    }
    seenIds.add(fixture.id);
    seenSources.add(normalizedSource);
    if (fixture.heldOut) heldOut += 1;
    if (fixture.heldOut && fixture.provenance === 'consented-redacted') consentedHeldOut += 1;
    const decision = inspectUnparsedLaunchAlert(fixture.source, fixture.sender);
    if (fixture.expected === 'review') {
      expectedReview += 1;
      if (decision.outcome !== 'review') {
        failures.push({ fixtureRef, reason: 'missed-review' });
        return;
      }
      reviewed += 1;
      const exact = (!fixture.market || decision.review.market === fixture.market) &&
        (!fixture.direction || decision.review.direction === fixture.direction) &&
        (!fixture.minorUnits || decision.review.amount.minorUnits === fixture.minorUnits);
      if (exact) exactFields += 1;
      else failures.push({ fixtureRef, reason: 'field-mismatch' });
      return;
    }
    expectedRefuse += 1;
    if (decision.outcome === 'review') {
      unsafeAdmissions += 1;
      failures.push({ fixtureRef, reason: 'unsafe-admission' });
    }
  });

  const reviewRecall = safeRatio(reviewed, expectedReview);
  const unsafeAdmissionRate = safeRatio(unsafeAdmissions, expectedRefuse);
  const exactFieldRate = safeRatio(exactFields, expectedReview);
  const blockers = [
    ...(heldOut < 50 ? ['held-out-corpus-too-small'] : []),
    ...(consentedHeldOut < 25 ? ['consented-held-out-too-small'] : []),
    ...(expectedReview < 20 ? ['positive-review-coverage-too-small'] : []),
    ...(expectedRefuse < 20 ? ['hard-negative-coverage-too-small'] : []),
    ...(reviewRecall < 0.95 ? ['review-recall-below-95pct'] : []),
    ...(unsafeAdmissionRate > 0 ? ['unsafe-admission-detected'] : []),
    ...(exactFieldRate < 0.98 ? ['exact-field-rate-below-98pct'] : []),
    ...(failures.some((failure) => failure.reason === 'invalid-or-duplicate-fixture')
      ? ['invalid-corpus']
      : []),
  ];
  return {
    total: fixtures.length,
    heldOut,
    consentedHeldOut,
    expectedReview,
    expectedRefuse,
    reviewRecall,
    unsafeAdmissionRate,
    exactFieldRate,
    reviewBetaReady: blockers.length === 0,
    blockers,
    failures,
  };
};
