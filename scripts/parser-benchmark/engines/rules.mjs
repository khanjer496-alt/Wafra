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
const { inspectGenericBankEventForReview } = require(path.join(build, 'launch-alert-parser'));

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

/**
 * The seam for a market Wafra has no pack for.
 *
 * `inspectMarketAlert` needs a market pack and throws without one, so it is
 * the wrong thing to ask about Brazil. `auto-import.ts` reaches for
 * `inspectGenericBankEventForReview` in exactly that case, and a `null` from
 * it is a deliberate refusal — the message never established bank context —
 * not a failure to parse. The qualification harness has to see that
 * difference, because refusing is the safe answer and crashing is not.
 */
export const reviewUnknownMarket = (message, { sender } = {}) => {
  const event = inspectGenericBankEventForReview(message, sender ?? '');
  if (!event) return null;
  const money = event.amount?.value ?? null;
  return {
    decision: event.decision,
    status: event.status,
    family: event.family,
    direction: event.direction,
    currency: money?.currency ?? null,
    minorUnits: money?.minorUnits ?? null,
    institution: null,
  };
};
