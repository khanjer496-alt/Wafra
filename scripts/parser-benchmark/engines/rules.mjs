/**
 * The shipping rule parser, as a benchmark engine.
 *
 * This is the baseline every candidate is measured against. It does not wrap
 * or adapt anything: `parseLedger` is `parseSms` and `reviewAlert` is
 * `inspectMarketAlert`, so a number this engine scores is a number the app
 * scores. Anything else would benchmark the adapter.
 */
import { createRequire } from 'node:module';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const require = createRequire(import.meta.url);
const build = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)), '../../test/build',
);
const { parseSms } = require(path.join(build, 'sms-parser'));
const { withMarketPackForParsing } = require(path.join(build, 'markets'));
const { inspectMarketAlert } = require(path.join(build, 'alert-semantics'));

export const name = 'rules';
export const description = 'src/lib/sms-parser.ts + alert-semantics.ts as shipped';

/**
 * AE/SA ledger parse. The market pack has to be active for the call — the
 * parser reads the ledger currency from it — and `withMarketPackForParsing`
 * restores the previous one afterwards, so scoring AE rows cannot leak into
 * the SA rows that follow.
 */
export const parseLedger = (message, { market = 'AE', sender, observedAt } = {}) =>
  withMarketPackForParsing(market, () => parseSms(message, {}, { sender, observedAt }));

/** Market-agnostic semantic review, the seam the global corpus is labelled at. */
export const reviewAlert = (message, market, { sender } = {}) => {
  const review = inspectMarketAlert(message, market, { sender });
  const candidate = review.draft.candidates[0] ?? null;
  return {
    decision: review.decision,
    status: review.status,
    family: review.family,
    direction: review.direction,
    currency: candidate?.currency ?? null,
    minorUnits: candidate?.minorUnits ?? null,
    institution: review.institution?.institution ?? null,
  };
};
