import type { AlertFamily, PostingStatus, UniversalMarket } from '@/lib/alert-market-pack-types';

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
  exactMoneyAndDirection: 0.995,
  familyPrecision: 0.98,
  subscriptionPrecision: 0.98,
  maximumDuplicateRate: 0.001,
} as const;

export const REQUIRED_BENCHMARK_FAMILIES: readonly AlertFamily[] = [
  'purchase', 'transfer', 'cash-withdrawal', 'refund', 'fee', 'utility',
  'recurring-payment', 'statement', 'balance', 'authentication',
];

export type FixtureProvenance = 'standard-derived' | 'synthetic' | 'consented-redacted';

export interface MarketBenchmarkFixture {
  id: string;
  market: UniversalMarket;
  institution: string;
  channel: string;
  templateVersion: string;
  split: 'authoring' | 'held-out';
  provenance: FixtureProvenance;
  expectedStatus: PostingStatus;
  expectedMoneyExact: boolean;
  expectedFamily: AlertFamily;
  actualStatus: PostingStatus;
  actualMoneyExact: boolean;
  actualFamily: AlertFamily;
  duplicate: boolean;
  forbiddenImport: boolean;
}

export interface MarketRolloutReport {
  market: UniversalMarket;
  stage: 'research' | 'review' | 'automatic';
  blockers: string[];
  fixtureCount: number;
  consentedRealFixtureCount: number;
  heldOutRealFixtureCount: number;
}

const ratio = (pass: number, total: number): number => total ? pass / total : 0;

export const evaluateMarketRollout = (
  market: UniversalMarket,
  fixtures: readonly MarketBenchmarkFixture[],
  uaeSaudiRegressions: number,
): MarketRolloutReport => {
  const scoped = fixtures.filter((fixture) => fixture.market === market);
  const real = scoped.filter((fixture) => fixture.provenance === 'consented-redacted');
  const benchmark = real.filter((fixture) => fixture.split === 'held-out');
  const institutions = new Set(benchmark.map((fixture) => fixture.institution));
  const actualPosted = benchmark.filter((fixture) => fixture.actualStatus === 'posted');
  const expectedPosted = benchmark.filter((fixture) => fixture.expectedStatus === 'posted');
  const postedCorrect = actualPosted.filter((fixture) => fixture.expectedStatus === 'posted').length;
  const statusCorrect = benchmark.filter(
    (fixture) => fixture.actualStatus === fixture.expectedStatus,
  ).length;
  const moneyCorrect = actualPosted.filter(
    (fixture) => fixture.expectedStatus === 'posted' && fixture.actualMoneyExact,
  ).length;
  const familyCorrect = actualPosted.filter(
    (fixture) => fixture.expectedStatus === 'posted' && fixture.actualFamily === fixture.expectedFamily,
  ).length;
  const subscriptions = actualPosted.filter(
    (fixture) => fixture.actualFamily === 'recurring-payment',
  );
  const subscriptionCorrect = subscriptions.filter(
    (fixture) => fixture.expectedStatus === 'posted' && fixture.expectedFamily === 'recurring-payment',
  ).length;
  const templateKey = (fixture: MarketBenchmarkFixture): string =>
    `${fixture.institution}\u0000${fixture.channel}\u0000${fixture.templateVersion}`;
  const authoringTemplates = new Set(
    scoped.filter((fixture) => fixture.split === 'authoring').map(templateKey),
  );
  const splitLeakage = benchmark.some((fixture) => authoringTemplates.has(templateKey(fixture)));
  const blockers: string[] = [];

  if (benchmark.length < UNIVERSAL_AUTO_IMPORT_GATES.minimumConsentedRealFixtures) {
    blockers.push('not-enough-consented-real-fixtures');
  }
  if (institutions.size < UNIVERSAL_AUTO_IMPORT_GATES.minimumInstitutions) {
    blockers.push('not-enough-institutions');
  }
  if (benchmark.filter((fixture) => fixture.expectedStatus !== 'posted').length <
    UNIVERSAL_AUTO_IMPORT_GATES.minimumNonPostedFixtures) {
    blockers.push('not-enough-non-posted-fixtures');
  }
  if (benchmark.filter((fixture) => fixture.expectedStatus === 'failed').length <
    UNIVERSAL_AUTO_IMPORT_GATES.minimumFailedFixtures) blockers.push('not-enough-failed-fixtures');
  if (benchmark.filter((fixture) => fixture.expectedStatus === 'future').length <
    UNIVERSAL_AUTO_IMPORT_GATES.minimumFutureFixtures) blockers.push('not-enough-future-fixtures');
  for (const family of REQUIRED_BENCHMARK_FAMILIES) {
    if (benchmark.filter((fixture) => fixture.expectedFamily === family).length <
      UNIVERSAL_AUTO_IMPORT_GATES.minimumFixturesPerFamily) {
      blockers.push(`family-coverage:${family}`);
    }
  }
  if (ratio(postedCorrect, actualPosted.length) < UNIVERSAL_AUTO_IMPORT_GATES.postedPrecision) {
    blockers.push('posted-precision');
  }
  if (ratio(postedCorrect, expectedPosted.length) < UNIVERSAL_AUTO_IMPORT_GATES.postedRecall) {
    blockers.push('posted-recall');
  }
  if (ratio(statusCorrect, benchmark.length) < UNIVERSAL_AUTO_IMPORT_GATES.statusAccuracy) {
    blockers.push('status-accuracy');
  }
  if (ratio(moneyCorrect, actualPosted.length) < UNIVERSAL_AUTO_IMPORT_GATES.exactMoneyAndDirection) {
    blockers.push('money-or-direction-exactness');
  }
  if (ratio(familyCorrect, actualPosted.length) < UNIVERSAL_AUTO_IMPORT_GATES.familyPrecision) {
    blockers.push('family-precision');
  }
  if (subscriptions.length &&
    ratio(subscriptionCorrect, subscriptions.length) < UNIVERSAL_AUTO_IMPORT_GATES.subscriptionPrecision) {
    blockers.push('subscription-precision');
  }
  if (ratio(actualPosted.filter((fixture) => fixture.duplicate).length, actualPosted.length) >
    UNIVERSAL_AUTO_IMPORT_GATES.maximumDuplicateRate) blockers.push('duplicate-rate');
  if (splitLeakage) blockers.push('template-split-leakage');
  if (scoped.some((fixture) => fixture.forbiddenImport)) blockers.push('forbidden-import');
  if (uaeSaudiRegressions > 0) blockers.push('uae-saudi-regression');

  const stage = blockers.length === 0 ? 'automatic' : scoped.length ? 'review' : 'research';
  return {
    market,
    stage,
    blockers,
    fixtureCount: scoped.length,
    consentedRealFixtureCount: real.length,
    heldOutRealFixtureCount: benchmark.length,
  };
};
