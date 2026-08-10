import { inspectMarketAlert } from '@/lib/alert-semantics';
import type { CurrencyCode } from '@/lib/currency-metadata';
import type {
  AlertFamily,
  MoneyDirection,
  PostingStatus,
  UniversalMarket,
} from '@/lib/alert-market-pack-types';

export const UNIVERSAL_AUTO_IMPORT_GATES = {
  minimumConsentedRealFixtures: 300,
  minimumInstitutions: 5,
  minimumNonPostedFixtures: 60,
  minimumFailedFixtures: 20,
  minimumFutureFixtures: 20,
  minimumFixturesPerFamily: 10,
  postedPrecision: 0.997,
  postedRecall: 0.95,
  statusAccuracy: 0.99,
  reviewDecisionRecall: 0.95,
  exactMoneyAndDirection: 0.995,
  familyPrecision: 0.98,
  subscriptionPrecision: 0.98,
  minimumFamilyRecall: 0.9,
  subscriptionRecall: 0.98,
  maximumDuplicateRate: 0.001,
} as const;

type BenchmarkFamily = Exclude<AlertFamily, 'unknown'>;

export const REQUIRED_BENCHMARK_FAMILIES: readonly BenchmarkFamily[] = [
  'purchase', 'transfer', 'cash-withdrawal', 'refund', 'fee', 'utility',
  'recurring-payment', 'statement', 'balance', 'authentication',
];

export type FixtureProvenance = 'standard-derived' | 'synthetic' | 'consented-redacted';

export interface ExpectedBenchmarkMoney {
  currency: CurrencyCode;
  minorUnits: string;
  direction: MoneyDirection;
}

export interface ExpectedBenchmarkOutcome {
  /** Review means the alert is eligible for user confirmation, never automatic import. */
  decision: 'review' | 'refuse';
  status: PostingStatus;
  family: AlertFamily;
  /** The exact primary transaction amount, or null when no transaction may be selected. */
  money: ExpectedBenchmarkMoney | null;
}

export interface MarketBenchmarkFixture {
  id: string;
  market: UniversalMarket;
  institution: string;
  channel: string;
  templateVersion: string;
  split: 'authoring' | 'held-out';
  provenance: FixtureProvenance;
  /** Redacted source evidence. Reports must never copy this value. */
  source: string;
  expected: ExpectedBenchmarkOutcome;
}

export interface BenchmarkMetric {
  passed: number;
  total: number;
  ratio: number;
}

export interface BenchmarkFailure {
  /** Runner-generated opaque reference; caller-authored IDs never leave the runner. */
  fixtureRef: string;
  reasons: string[];
}

export interface MarketRolloutReport {
  market: UniversalMarket;
  stage: 'research' | 'review' | 'automatic';
  blockers: string[];
  fixtureCount: number;
  consentedRealFixtureCount: number;
  heldOutRealFixtureCount: number;
  metrics: {
    postedPrecision: BenchmarkMetric;
    postedRecall: BenchmarkMetric;
    statusAccuracy: BenchmarkMetric;
    reviewDecisionRecall: BenchmarkMetric;
    exactMoneyAndDirection: BenchmarkMetric;
    familyPrecision: BenchmarkMetric;
    subscriptionPrecision: BenchmarkMetric;
    subscriptionRecall: BenchmarkMetric;
    familyRecall: Record<BenchmarkFamily, BenchmarkMetric>;
  };
  /** Runner-generated fixture refs and mismatch kinds only. Source and caller IDs stay private. */
  failures: BenchmarkFailure[];
}

interface ExecutedFixture {
  fixture: MarketBenchmarkFixture;
  fixtureRef: string;
  actual: ReturnType<typeof inspectMarketAlert>;
  moneyExact: boolean;
  failureReasons: string[];
}

const metric = (passed: number, total: number): BenchmarkMetric => ({
  passed,
  total,
  ratio: total ? passed / total : 0,
});

const executeFixture = (fixture: MarketBenchmarkFixture, fixtureRef: string): ExecutedFixture => {
  const actual = inspectMarketAlert(fixture.source, fixture.market);
  const candidate = actual.primaryCandidateIndex === null
    ? null
    : actual.draft.candidates[actual.primaryCandidateIndex] ?? null;
  const expectedMoney = fixture.expected.money;
  const moneyExact = fixture.expected.status !== 'posted'
    ? true
    : expectedMoney !== null &&
      candidate?.currency === expectedMoney.currency &&
      candidate.minorUnits === expectedMoney.minorUnits &&
      actual.direction === expectedMoney.direction;
  const failureReasons: string[] = [];

  if (actual.status !== fixture.expected.status) failureReasons.push('status');
  if (actual.family !== fixture.expected.family) failureReasons.push('family');
  if (actual.decision !== fixture.expected.decision) failureReasons.push('decision');
  if (!moneyExact) failureReasons.push('money-or-direction');
  if (fixture.expected.decision === 'refuse' && actual.decision !== 'refuse') {
    failureReasons.push('forbidden-import');
  }

  return { fixture, fixtureRef, actual, moneyExact, failureReasons };
};

const templateKey = (fixture: MarketBenchmarkFixture): string =>
  `${fixture.institution}\u0000${fixture.channel}\u0000${fixture.templateVersion}`;

const evidenceKey = (fixture: MarketBenchmarkFixture): string =>
  fixture.source.normalize('NFKC').toLocaleLowerCase('en-US').replace(/\s+/g, ' ').trim();

/**
 * Execute the shipping universal inspector against evidence-only fixtures and
 * decide whether a market has earned a wider rollout. Callers cannot supply
 * parser results, so a corpus cannot certify itself by copying expectations
 * into `actual*` fields.
 */
export const runMarketBenchmark = (
  market: UniversalMarket,
  fixtures: readonly MarketBenchmarkFixture[],
): MarketRolloutReport => {
  const scoped = fixtures.filter((fixture) => fixture.market === market);
  const executed = scoped.map((fixture, index) => executeFixture(fixture, `case-${index + 1}`));
  const real = executed.filter(
    ({ fixture }) => fixture.provenance === 'consented-redacted',
  );
  const heldOutReal = real.filter(({ fixture }) => fixture.split === 'held-out');
  const seenEvidence = new Set<string>();
  const benchmark = heldOutReal.filter(({ fixture }) => {
    const key = evidenceKey(fixture);
    if (seenEvidence.has(key)) return false;
    seenEvidence.add(key);
    return true;
  });
  const institutions = new Set(benchmark.map(({ fixture }) => fixture.institution));
  const actualPosted = benchmark.filter(({ actual }) => actual.status === 'posted');
  const expectedPosted = benchmark.filter(
    ({ fixture }) => fixture.expected.status === 'posted',
  );
  const postedCorrect = actualPosted.filter(
    ({ fixture }) => fixture.expected.status === 'posted',
  ).length;
  const statusCorrect = benchmark.filter(
    ({ fixture, actual }) => actual.status === fixture.expected.status,
  ).length;
  const expectedReview = benchmark.filter(
    ({ fixture }) => fixture.expected.decision === 'review',
  );
  const reviewCorrect = expectedReview.filter(
    ({ actual }) => actual.decision === 'review',
  ).length;
  const moneyCorrect = actualPosted.filter(
    ({ fixture, moneyExact }) => fixture.expected.status === 'posted' && moneyExact,
  ).length;
  const familyCorrect = actualPosted.filter(
    ({ fixture, actual }) => fixture.expected.status === 'posted' &&
      actual.family === fixture.expected.family,
  ).length;
  const subscriptions = actualPosted.filter(
    ({ actual }) => actual.family === 'recurring-payment',
  );
  const subscriptionCorrect = subscriptions.filter(
    ({ fixture }) => fixture.expected.status === 'posted' &&
      fixture.expected.family === 'recurring-payment',
  ).length;
  const familyRecall = Object.fromEntries(REQUIRED_BENCHMARK_FAMILIES.map((family) => {
    const expected = benchmark.filter(({ fixture }) => fixture.expected.family === family);
    const correct = expected.filter(({ fixture, actual }) => actual.family === fixture.expected.family);
    return [family, metric(correct.length, expected.length)];
  })) as Record<BenchmarkFamily, BenchmarkMetric>;
  const authoringTemplates = new Set(
    scoped.filter((fixture) => fixture.split === 'authoring').map(templateKey),
  );
  const splitLeakage = benchmark.some(
    ({ fixture }) => authoringTemplates.has(templateKey(fixture)),
  );
  const authoringEvidence = new Set(
    scoped.filter((fixture) => fixture.split === 'authoring').map(evidenceKey),
  );
  const sourceSplitLeakage = heldOutReal.some(
    ({ fixture }) => authoringEvidence.has(evidenceKey(fixture)),
  );
  const duplicateIds = new Set(scoped.map((fixture) => fixture.id)).size !== scoped.length;
  const duplicateEvidence = new Set(scoped.map(evidenceKey)).size !== scoped.length;
  const metrics = {
    postedPrecision: metric(postedCorrect, actualPosted.length),
    postedRecall: metric(postedCorrect, expectedPosted.length),
    statusAccuracy: metric(statusCorrect, benchmark.length),
    reviewDecisionRecall: metric(reviewCorrect, expectedReview.length),
    exactMoneyAndDirection: metric(moneyCorrect, actualPosted.length),
    familyPrecision: metric(familyCorrect, actualPosted.length),
    subscriptionPrecision: metric(subscriptionCorrect, subscriptions.length),
    subscriptionRecall: familyRecall['recurring-payment'],
    familyRecall,
  };
  const blockers: string[] = [];

  if (benchmark.length < UNIVERSAL_AUTO_IMPORT_GATES.minimumConsentedRealFixtures) {
    blockers.push('not-enough-consented-real-fixtures');
  }
  if (institutions.size < UNIVERSAL_AUTO_IMPORT_GATES.minimumInstitutions) {
    blockers.push('not-enough-institutions');
  }
  if (benchmark.filter(({ fixture }) => fixture.expected.status !== 'posted').length <
    UNIVERSAL_AUTO_IMPORT_GATES.minimumNonPostedFixtures) {
    blockers.push('not-enough-non-posted-fixtures');
  }
  if (benchmark.filter(({ fixture }) => fixture.expected.status === 'failed').length <
    UNIVERSAL_AUTO_IMPORT_GATES.minimumFailedFixtures) blockers.push('not-enough-failed-fixtures');
  if (benchmark.filter(({ fixture }) => fixture.expected.status === 'future').length <
    UNIVERSAL_AUTO_IMPORT_GATES.minimumFutureFixtures) blockers.push('not-enough-future-fixtures');
  for (const family of REQUIRED_BENCHMARK_FAMILIES) {
    if (benchmark.filter(({ fixture }) => fixture.expected.family === family).length <
      UNIVERSAL_AUTO_IMPORT_GATES.minimumFixturesPerFamily) {
      blockers.push(`family-coverage:${family}`);
    }
  }
  if (metrics.postedPrecision.ratio < UNIVERSAL_AUTO_IMPORT_GATES.postedPrecision) {
    blockers.push('posted-precision');
  }
  if (metrics.postedRecall.ratio < UNIVERSAL_AUTO_IMPORT_GATES.postedRecall) {
    blockers.push('posted-recall');
  }
  if (metrics.statusAccuracy.ratio < UNIVERSAL_AUTO_IMPORT_GATES.statusAccuracy) {
    blockers.push('status-accuracy');
  }
  if (metrics.reviewDecisionRecall.ratio < UNIVERSAL_AUTO_IMPORT_GATES.reviewDecisionRecall) {
    blockers.push('review-decision-recall');
  }
  if (metrics.exactMoneyAndDirection.ratio < UNIVERSAL_AUTO_IMPORT_GATES.exactMoneyAndDirection) {
    blockers.push('money-or-direction-exactness');
  }
  if (metrics.familyPrecision.ratio < UNIVERSAL_AUTO_IMPORT_GATES.familyPrecision) {
    blockers.push('family-precision');
  }
  if (subscriptions.length &&
    metrics.subscriptionPrecision.ratio < UNIVERSAL_AUTO_IMPORT_GATES.subscriptionPrecision) {
    blockers.push('subscription-precision');
  }
  for (const family of REQUIRED_BENCHMARK_FAMILIES) {
    if (metrics.familyRecall[family].ratio < UNIVERSAL_AUTO_IMPORT_GATES.minimumFamilyRecall) {
      blockers.push(`family-recall:${family}`);
    }
  }
  if (metrics.subscriptionRecall.ratio < UNIVERSAL_AUTO_IMPORT_GATES.subscriptionRecall) {
    blockers.push('subscription-recall');
  }
  if (splitLeakage) blockers.push('template-split-leakage');
  if (sourceSplitLeakage) blockers.push('source-split-leakage');
  if (duplicateIds) blockers.push('duplicate-fixture-id');
  if (duplicateEvidence) blockers.push('duplicate-fixture-source');
  if (executed.some(({ failureReasons }) => failureReasons.includes('forbidden-import'))) {
    blockers.push('forbidden-import');
  }

  // inspectMarketAlert is a single-message reviewer. It cannot execute the
  // shipping import/dedupe path, so claiming a measured duplicate rate here
  // would be another self-attested result. Keep automatic import closed until
  // duplicate scenarios run through that real path.
  blockers.push('duplicate-rate-unmeasured');

  return {
    market,
    stage: blockers.length === 0 ? 'automatic' : scoped.length ? 'review' : 'research',
    blockers,
    fixtureCount: scoped.length,
    consentedRealFixtureCount: real.length,
    heldOutRealFixtureCount: benchmark.length,
    metrics,
    failures: executed
      .filter(({ failureReasons }) => failureReasons.length > 0)
      .map(({ fixtureRef, failureReasons }) => ({
        fixtureRef,
        reasons: [...new Set(failureReasons)],
      })),
  };
};
