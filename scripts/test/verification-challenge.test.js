/**
 * A bank asking whether you made a payment has not told you that you did.
 *
 * `scripts/parser-benchmark/qualification.mjs` found this on its first run:
 *
 *   "Did you attempt a USD 1,299.00 purchase at TECH OUTLET? Reply YES or NO.
 *    We have not processed it."
 *
 * read as a POSTED purchase of USD 1,299.00, on both the market-pack path and
 * the market-agnostic one. A fraud-verification prompt is the worst possible
 * thing to auto-import: the amount is one the customer specifically did not
 * spend, and it arrives at the exact moment they are being defrauded.
 *
 * WHY IT HAPPENED, AND WHY THE FIX IS SHAPED THIS WAY
 *
 * `universal-parser.ts` already refuses "not processed" wording, but it scopes
 * that search to the clause holding the amount, and the disclaimer sits in a
 * later sentence. Widening the scope was the obvious fix and the wrong one: a
 * disclaimer about one transaction would then suppress a genuine second one in
 * the same message. So the question itself is the evidence instead.
 *
 * The status becomes `unknown`, not `informational` and not `failed`. Some
 * banks do challenge a charge that HAS posted, and `informational` routes the
 * row to `ignore`, which would hide real spending. `unknown` keeps it
 * reviewable while making it unpostable — the safe half of both readings.
 *
 * WHAT MUST NOT CHANGE is most of this file. Genuine posted alerts carry
 * "if this was not you, call us" constantly, and a pattern that caught that
 * would silently suppress real spending across every market. The assertions
 * below pin both directions.
 */
const { inspectMarketAlert } = require('./build/alert-semantics');
const { inspectGenericBankEventForReview } = require('./build/launch-alert-parser');
const { isTransactionVerificationChallenge } = require('./build/bank-alert-semantic-rules');

let pass = 0;
let fail = 0;
const ok = (name, cond, detail) => {
  if (cond) {
    pass++;
    console.log(`✓ ${name}`);
  } else {
    fail++;
    console.log(`✗ ${name}${detail ? ` — ${detail}` : ''}`);
  }
};

/** Both seams, because the bug was in both and only one was obvious. */
const marketStatus = (body, market = 'US', sender = 'CHASE') => {
  const review = inspectMarketAlert(body, market, { sender });
  return { decision: review.decision, status: review.status };
};
const genericStatus = (body, sender = 'BANK') => {
  const event = inspectGenericBankEventForReview(body, sender);
  return event ? { decision: event.decision, status: event.status } : null;
};
const postable = (r) => Boolean(r && r.decision === 'review' && r.status === 'posted');

/* ── The predicate itself ────────────────────────────────────────────── */

for (const [text, expected] of [
  ['Did you attempt a USD 1,299.00 purchase at TECH OUTLET?', true],
  ['Did you make this payment?', true],
  ['Have you used your card today?', true],
  ['Was this you? Reply Y or N', true],
  ['Was that transaction you?', true],
  ['Reply YES or NO to confirm.', true],
  ['هل قمت بهذه العملية؟', true],
  // The ones that must NOT match. Every one of these appears in genuine
  // posted alerts, and matching any of them suppresses real spending.
  ['If this was not you, call us immediately.', false],
  ['Did you know you can set budgets in the app?', false],
  ['Did you receive your statement?', false],
  ['Your card was charged AED 87.50 at CARREFOUR.', false],
  ['Thank you for your payment. Reply STOP to opt out.', false],
]) {
  ok(`predicate: ${expected ? 'challenge' : 'not a challenge'} — "${text.slice(0, 46)}"`,
    isTransactionVerificationChallenge(text) === expected);
}

/* ── The reported bug, on both seams ─────────────────────────────────── */

const fraudCheck = 'Did you attempt a USD 1,299.00 purchase at TECH OUTLET? Reply YES or NO. We have not processed it.';

ok('market path: a fraud-verification prompt never posts',
  !postable(marketStatus(fraudCheck)), JSON.stringify(marketStatus(fraudCheck)));

ok('generic path: a fraud-verification prompt never posts',
  !postable(genericStatus(fraudCheck, 'CHASE')), JSON.stringify(genericStatus(fraudCheck, 'CHASE')));

// `refuse` is this vocabulary's answer for any alert that is not a posted
// transaction — it is what a declined card gets too, and those rows are in the
// pinned global corpus. What matters is the status: `unknown`, not `posted`,
// and not `informational`, which is the value that would drop the row.
ok('...and its status is unknown rather than posted',
  marketStatus(fraudCheck).status === 'unknown',
  JSON.stringify(marketStatus(fraudCheck)));

ok('...not informational either, which is the value that hides a row',
  marketStatus(fraudCheck).status !== 'informational',
  JSON.stringify(marketStatus(fraudCheck)));

ok('a challenge about a charge the bank already made is still not posted',
  !postable(marketStatus('A payment of USD 240.00 to BRIGHT ELECTRICALS was made. Was this you? Reply Y or N.')));

/* ── What must not change ────────────────────────────────────────────── */

// Every row in the pinned 188-row corpus that the parser posts today must
// still post. A wording rule that suppresses real spending is the failure mode
// this guards, and the corpus is the only honest list of what "real" means.
const globalRows = require('./fixtures/global-alert-formats.js');
const shouldPost = globalRows.filter((row) =>
  row.expected?.decision === 'review' && row.expected?.status === 'posted');
const stillPosting = shouldPost.filter((row) =>
  postable(marketStatus(row.body, row.market, row.sender)));
ok(`every posting row in the pinned corpus still posts (${stillPosting.length}/${shouldPost.length})`,
  stillPosting.length === shouldPost.length,
  shouldPost.filter((row) => !postable(marketStatus(row.body, row.market, row.sender)))
    .map((row) => row.id).join(', '));

// And the corpus's own challenge-shaped rows, if any, must not have flipped.
const shouldNotPost = globalRows.filter((row) => row.expected?.status !== 'posted');
const stillRefusing = shouldNotPost.filter((row) =>
  !postable(marketStatus(row.body, row.market, row.sender)));
ok(`every non-posting row in the pinned corpus still refuses (${stillRefusing.length}/${shouldNotPost.length})`,
  stillRefusing.length === shouldNotPost.length);

ok('still posts: a plain unfamiliar-bank charge on the generic path',
  postable(genericStatus('ZABank: Card purchase of ZAR 389.45 at KLOOF GROCER on card ending 4412.', 'ZABANK')),
  JSON.stringify(genericStatus('ZABank: Card purchase of ZAR 389.45 at KLOOF GROCER on card ending 4412.', 'ZABANK')));

console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
