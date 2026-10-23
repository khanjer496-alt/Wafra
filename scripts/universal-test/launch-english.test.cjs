'use strict';
const assert = require('node:assert/strict');
const test = require('node:test');
const { createHash } = require('node:crypto');
const load = require('./load-ts.cjs').createLoader();
const { inspectUniversalBankEvent } = load('@/lib/universal-parser');
const { createLaunchAlertSession } = load('@/lib/launch-alert-parser');
const { parseHistoricalMessageRecords } = load('@/lib/historical-import');
const { setActiveCountry } = load('@/lib/country');
const { setActiveMarket, setLedgerCurrency } = load('@/lib/markets');

// English completed-movement grammar for the US, Canada, UK, Ireland and the
// English alerts Gulf banks send. Every body is synthetic, written in the
// shape banks publish, with fictional merchants, names, tails and amounts.
// Each positive grammar has paired controls that must stay unbooked.
const observedAt = Date.parse('2026-10-12T12:00:00Z');
const EXPONENT = { OMR: 3 };

function session(row) {
  setActiveMarket('ZZ'); setActiveCountry(row.country); setLedgerCurrency(row.currency, EXPONENT[row.currency] ?? 2);
  return createLaunchAlertSession({ overrides: {}, pinnedCurrency: row.currency, activeMarket: 'ZZ',
    bestEffort: { enabled: true, country: row.country }, fxLookup: () => null, regionHint: row.country });
}
function android(row) {
  const reader = session(row);
  return reader.parseUnproven(row.body, row.sender, reader.inspect(row.body, row.sender), observedAt);
}
function history(row) {
  return parseHistoricalMessageRecords([JSON.stringify({ v: 1,
    id: createHash('sha256').update(row.body).digest('hex'), text: row.body,
    receivedAt: new Date(observedAt).toISOString() })], {}, new Date(observedAt), new Set(), session(row));
}
const us = (body, minor, type, family) => ({ country: 'US', currency: 'USD', sender: '24273', body, minor, type, family });
const ca = (body, minor, type, family) => ({ country: 'CA', currency: 'CAD', sender: '26600', body, minor, type, family });
const gb = (body, minor, type, family) => ({ country: 'GB', currency: 'GBP', sender: 'MyBank', body, minor, type, family });
const ie = (body, minor, type, family) => ({ country: 'IE', currency: 'EUR', sender: 'MyBank', body, minor, type, family });

const positives = [
  // Card purchases.
  gb("MyBank: You've made a debit card payment of £18.20 at CORNER GROCER 1102 from your account ending 4410 on 14/09/2026.", 1820, 'expense', 'purchase'),
  gb('MyBank: Debit card payment of £41.75 at HILLTOP MARKET on 18/09/2026 from your account ending 7781.', 4175, 'expense', 'purchase'),
  ie('MyBank: Contactless payment of €3.90 at HARBOUR COFFEE CO made with your debit card ending 5521 on 03/10/2026.', 390, 'expense', 'purchase'),
  ie('MyBank: Card ending 6612 used for EUR27.30 at RIVERSIDE STORES on 12/09/2026 13:05.', 2730, 'expense', 'purchase'),
  us('Card Alert: A $64.10 transaction was made at MAPLE WHOLESALE #12 on your card ending in 3307 on 09/10/2026.', 6410, 'expense', 'purchase'),
  us('Card Alert: A charge of $912.00 at NORTHSTAR AIRWAYS was approved on your Card ending in 40021 on Sep 20, 2026.', 91200, 'expense', 'purchase'),
  us('Card Alert: Transaction for $22.40 was approved on credit card 8812 at PINE SUPERCENTER on 09/26/2026.', 2240, 'expense', 'purchase'),
  us('Card Alert: Your card ending in 5150 was charged $14.00 at CAMPUS LOT B.', 1400, 'expense', 'purchase'),
  us('Card Alert: $88.25 transaction at OAKLEY OUTLET on your Rewards Credit Card ending in 6620.', 8825, 'expense', 'purchase'),
  us('Card Alert: A transaction of $31.00 at WWW.EXAMPLE-SHOP.TEST on September 21, 2026.', 3100, 'expense', 'purchase'),
  { country: 'QA', currency: 'QAR', sender: 'MyBank', minor: 13250, type: 'expense', family: 'purchase',
    body: 'MyBank: Your Debit Card ending 7702 has been used for QAR 132.50 at PEARL HYPERMARKET on 15-Sep-2026 19:22. Avl. Bal. QAR 4,210.40' },
  // A security footer glued on without a full stop does not question the movement.
  gb("MyBank: You've made a debit card payment of £12.00 at CORNER GROCER from your account ending 4410 Not you? Call 0800 000 0000", 1200, 'expense', 'purchase'),
  // A genuine charge keeps booking with the usual conditional fraud footer.
  us("Card Alert: You made a $27.80 purchase at MAPLE MART with your card ending in 3307. If you didn't make this purchase, call us.", 2780, 'expense', 'purchase'),
  // Cash.
  us('Card Alert: You made an ATM withdrawal of $160.00 on Sep 13, 2026 from your account ending in 9921.', 16000, 'expense', 'cash-withdrawal'),
  ie('MyBank: ATM withdrawal of €120.00 from your account ending 2278 on 27/09/2026 at 10:41. Available balance: €840.10.', 12000, 'expense', 'cash-withdrawal'),
  ca('Bank Alert: A withdrawal of $60.00 was made from your chequing account ending in 1180 at an ATM on Sep 19, 2026.', 6000, 'expense', 'cash-withdrawal'),
  // Fees.
  // A registered institution sender: the session's cheap posting-hint gate
  // does not know "taken" (see launch-alert-parser UNIVERSAL_POSTED_EVENT_HINT).
  { ...gb("Lloyds: We've taken your monthly fee of £4.00 from your account ending 3381 on 15/09/2026.", 400, 'expense', 'fee'), sender: 'Lloyds' },
  us('Bank Alert: A service charge of $13.47 was taken from your account xxxx1757 on 09/20/2026.', 1347, 'expense', 'fee'),
  // Person-to-person and transfers.
  gb("MyBank: You've sent £52.00 to A PATEL from your account ending 6603 on 15 Sep 2026.", 5200, 'expense', 'transfer'),
  ie('MyBank: You sent €140.00 to CIARAN WALSH from your Current Account ending 4419 on 16/09/2026.', 14000, 'expense', 'transfer'),
  gb("MyBank: You've received £63.00 from MR D OKAFOR into your account ending 8124. Reference: TICKETS", 6300, 'income', 'transfer'),
  gb('MyBank: Priya Shah sent you £15.00 / Lunch', 1500, 'income', 'transfer'),
  us('Venmo: You paid Jordan Reyes $18.00 for "pizza". Transaction ID 5512009.', 1800, 'expense', 'transfer'),
  // Deposits.
  us('Bank Alert: A mobile deposit of $820.00 has posted to your Checking account ending in 5102 on Sep 30, 2026.', 82000, 'income', 'transfer'),
  ca('Bank Alert: A deposit of $1,975.00 (PAYROLL - BIRCHWOOD LTD) was made to your account ending in 7733 on 2026-09-30.', 197500, 'income', 'transfer'),
  us('Bank Alert: ATM deposit of $340.00 posted to your account ending 2287 on Aug 21, 2026.', 34000, 'income', 'transfer'),
  us('Bank Alert: A direct deposit of $615.00 to account ending 4430 is available.', 61500, 'income', 'transfer'),
  // Bill payments.
  us('Bank Alert: Your $97.40 payment to CITY POWER CO was sent on Sep 18, 2026 from your account ending in 9921.', 9740, 'expense', 'purchase'),
  ca('Bank Alert: Your bill payment of $72.15 to LAKESIDE HYDRO was completed from your chequing account ending in 1180 on Oct 1, 2026.', 7215, 'expense', 'purchase'),
];

for (const row of positives) test(`posts: ${row.body.slice(0, 72)}`, () => {
  const event = inspectUniversalBankEvent(row.body, { sender: row.sender });
  assert.equal(event.status, 'posted', `status ${event.status} ${event.issues}`);
  assert.equal(event.family, row.family);
  assert.equal(event.direction, row.type === 'income' ? 'credit' : 'debit');
  const parsed = android(row);
  assert.ok(parsed, `Android posts (${event.issues})`);
  assert.equal(parsed.kind, 'transaction');
  assert.equal(parsed.type, row.type);
  assert.equal(parsed.amountFils, row.minor);
  assert.equal(parsed.currency, row.currency);
  assert.ok(parsed.bestEffort, 'marked best effort');
});

// The same wording when declined, pending/held, future, conditional,
// questioned, negated, an OTP, a promotion or a money request.
const controls = [
  gb("MyBank: You've made a debit card payment of £18.20 at CORNER GROCER from your account ending 4410. It was declined."),
  gb('MyBank: Debit card payment of £18.20 at CORNER GROCER is pending.'),
  gb("MyBank: If you've made a debit card payment of £18.20 at CORNER GROCER, ignore this message."),
  gb('MyBank: Have you made a debit card payment of £18.20 at CORNER GROCER? Reply YES or NO.'),
  gb("MyBank: You haven't made a debit card payment of £18.20 at CORNER GROCER yet."),
  gb('MyBank: Your debit card payment of £18.20 at CORNER GROCER will be taken on 20/10/2026.'),
  gb('MyBank: Your verification code is 482913. Use it to approve a debit card payment of £18.20 at CORNER GROCER.'),
  gb('MyBank: Get 10% off! Make a debit card payment of £18.20 at CORNER GROCER and earn cashback.'),
  gb('MyBank: A PATEL has requested a payment of £18.20 from you.'),
  ie('MyBank: ATM withdrawal of €120.00 from your account ending 2278 was declined.'),
  ie('MyBank: If an ATM withdrawal of €120.00 is made from your account, we will text you.'),
  ie('MyBank: An ATM withdrawal of €120.00 from your account ending 2278 was not completed.'),
  us('Card Alert: A charge of $912.00 at NORTHSTAR AIRWAYS was not approved on your Card ending in 40021.'),
  us('Card Alert: A charge of $912.00 at NORTHSTAR AIRWAYS is pending approval on your Card ending in 40021.'),
  us('Card Alert: A charge of $912.00 at NORTHSTAR AIRWAYS has been authorized on your Card ending in 40021.'),
  us('Card Alert: If a charge of $912.00 at NORTHSTAR AIRWAYS was approved on your Card, call us.'),
  us('Card Alert: A temporary hold of $912.00 at NORTHSTAR AIRWAYS was placed on your Card ending in 40021.'),
  us('Card Alert: A charge or hold for $45.10 on June 23, 2026 was placed on your card (2697) at FRESH MART.'),
  us('Card Alert: A $64.10 transaction was attempted at MAPLE WHOLESALE on your card ending in 3307.'),
  us('Card Alert: A $64.10 transaction at MAPLE WHOLESALE on your card ending in 3307 is pending.'),
  us('Card Alert: SOMEONE made a $64.10 transaction with MAPLE WHOLESALE on Oct 2, 2026.'),
  us('Card Alert: ALEX has not made a $64.10 transaction with MAPLE WHOLESALE.'),
  us('Card Alert: Your card ending in 5150 will be charged $14.00 at CAMPUS LOT B.'),
  us('Card Alert: Your card ending in 5150 was not charged $14.00 at CAMPUS LOT B.'),
  { country: 'QA', currency: 'QAR', sender: 'MyBank',
    body: 'MyBank: Your Debit Card ending 7702 has not been used for QAR 132.50 at PEARL HYPERMARKET.' },
  { country: 'QA', currency: 'QAR', sender: 'MyBank',
    body: 'MyBank: If your Debit Card ending 7702 has been used for QAR 132.50 at PEARL HYPERMARKET without consent, call us.' },
  gb("MyBank: You've sent £52.00 to A PATEL. The payment failed and has been returned."),
  gb("MyBank: You've sent a request for £52.00 to A PATEL."),
  gb('MyBank: Have you sent £52.00 to A PATEL? Reply YES or NO.'),
  gb("MyBank: You've received a payment request of £63.00 from MR D OKAFOR."),
  gb("MyBank: You haven't received £63.00 from MR D OKAFOR yet."),
  gb("MyBank: Congratulations! You've received £63.00 from PRIZE DESK. Claim it now."),
  gb("MyBank: You've received £63.00 from MR D OKAFOR. Pending confirmation."),
  gb('MyBank: Priya Shah sent you a request for £15.00'),
  gb('MyBank: Has Priya Shah sent you £15.00?'),
  us('Venmo: You paid Jordan Reyes $18.00 for "pizza". Payment pending.'),
  us('Venmo: If you paid Jordan Reyes $18.00 by mistake, cancel it.'),
  us('Bank Alert: A mobile deposit of $820.00 will be posted to your Checking account on Oct 2, 2026.'),
  us('Bank Alert: A mobile deposit of $820.00 to your Checking account is pending review.'),
  us('Bank Alert: A mobile deposit of $820.00 to your Checking account was rejected.'),
  us('Bank Alert: A direct deposit of $615.00 to account ending 4430 will be available tomorrow.'),
  ca('Bank Alert: A deposit of $1,975.00 was not made to your account ending in 7733.'),
  ca('Bank Alert: A deposit of $1,975.00 to your account ending in 7733 has been scheduled.'),
  us('Bank Alert: Your $97.40 payment to CITY POWER CO is scheduled for Sep 18, 2026.'),
  us('Bank Alert: Your $97.40 payment to CITY POWER CO was not sent. Insufficient funds.'),
  us('Bank Alert: Your $97.40 payment to CITY POWER CO will be sent on Sep 18, 2026.'),
  ca('Bank Alert: Your bill payment of $72.15 to LAKESIDE HYDRO has failed.'),
  ca('Bank Alert: Your bill payment of $72.15 to LAKESIDE HYDRO is due on Oct 1, 2026.'),
  gb("MyBank: We'll take your monthly fee of £4.00 from your account on 15/10/2026."),
  gb("MyBank: We haven't taken your monthly fee of £4.00 this month."),
  // Wording that borrows a completed verb without moving money.
  us('Card Alert: Your transaction limit of $5,000.00 has been approved.'),
  us('Card Alert: Your transaction limit of $5,000.00 was made available on your card ending in 3307.'),
  us('Card Alert: Your purchase of $640.00 at MAPLE WHOLESALE was approved for instalments.'),
  us('Card Alert: Make a $50.00 purchase at MAPLE WHOLESALE this week.'),
  us('Card Alert: Your first $50.00 purchase at MAPLE WHOLESALE earns a bonus.'),
  gb("MyBank: We've taken £5.00 off your next order at CORNER GROCER."),
  gb('MyBank: Priya Shah sent you a gift card worth £15.00.'),
  us('Card Alert: A charge of $64.10 at MAPLE WHOLESALE could not be completed.'),
  us('Bank Alert: Your $97.40 payment to CITY POWER CO was sent for approval.'),
  us('Bank Alert: A deposit of $500.00 was made to JORDAN REYES account from your account ending 9921.'),
  // A movement sentence that ends in a question, and a conditional consent
  // warning, ask rather than report (also with the issuer routed to US/GB).
  us('Card Alert: Your card ending 3307 was used for $45.00 at MAPLE MART?'),
  us('Card Alert: You spent $45.00 at MAPLE MART?'),
  us('Card Alert: If your card ending 3307 was used for $45.00 at MAPLE MART without consent, call us.'),
  gb('MyBank: If your card was used for £45.00 at MAPLE MART without your consent, call us.'),
  us('Bank Alert: A service charge of $13.47 will be taken from your account xxxx1757.'),
  us('Bank Alert: A service charge of $13.47 was not taken from your account xxxx1757.'),
  us('Card Alert: Your transaction of $40.00 at MAPLE MART was approved for a refund.'),
  us('Card Alert: We have charged back $40.00 to MAPLE MART on your card ending 3307.'),
  us('Card Alert: Your card ending 3307 has been used for $1.00 verification at MAPLE MART.'),
  us('Bank Alert: A direct deposit of $500.00 is available for early access if you enroll.'),
  us("Bank Alert: You've received $80.00 from JORDAN REYES. It will be available tomorrow."),
  us('Bank Alert: Your bill payment of $50.00 to CITY POWER was completed. We will debit your account on Oct 20.'),
  // A hypothetical alert setting, and personal chat from a phone number.
  us('If you make a purchase over $62.55 at MAPLE MART, we will send you an alert.'),
  { ...us('lol just spent $65.00 at MAPLE MART 😂'), sender: '+1 415 555 0134' },
  { ...gb('I paid £20.00 at the CORNER PUB, you owe me half'), sender: '+44 7700 900123' },
];

for (const row of controls) test(`never books: ${row.body.slice(0, 72)}`, () => {
  assert.equal(android(row), null);
  assert.equal(history(row).parsed.length, 0);
});

// Credit-card settlements are neither spending nor income: the existing
// card-payment family keeps them out of ordinary posting.
const settlements = [
  us('Card Alert: A payment of $250.00 posted to your Freedom credit card ending 0814 on 12/18/2026.'),
  us('Card Alert: Payment of $410.20 posted on 09/14/2026 for credit card 1950.'),
  us('Card Alert: You paid $1,200.00 to your Venture Card (9792) on May 8, 2026.'),
  us("Card Alert: We've received your $380.00 payment."),
  us('Bank Alert: Your $520.00 payment to NORTHBANK CARD 8252 was sent on Jul 2, 2026.'),
];
for (const row of settlements) test(`settlement, not spending or income: ${row.body.slice(0, 64)}`, () => {
  const event = inspectUniversalBankEvent(row.body, { sender: row.sender });
  assert.equal(event.family, 'card-payment');
  assert.ok(event.issues.includes('settlement-adapter-required'));
  const parsed = android(row);
  assert.ok(!parsed || parsed.kind !== 'transaction', 'never an ordinary transaction');
});

for (const market of ['US', 'GB']) test(`routed to ${market}: a question or a consent warning is not posted`, () => {
  for (const body of [
    'Your card ending 3307 was used for USD 45.00 at MAPLE MART?',
    'If your card ending 3307 was used for USD 45.00 at MAPLE MART without consent, call us.',
  ]) assert.notEqual(inspectUniversalBankEvent(body, { market }).status, 'posted', body);
});

test('a state word inside an ALL-CAPS shop name does not make a purchase a refund', () => {
  const event = inspectUniversalBankEvent('Platba kartou 250,00 CZK u REFUND SHOP dne 12.09.2026.', {});
  assert.notEqual(event.direction, 'credit');
  assert.notEqual(event.family, 'refund');
  const genuine = inspectUniversalBankEvent('Refund of CZK 250,00 from SHOP MART credited to your card.', {});
  assert.equal(genuine.family, 'refund');
  assert.equal(genuine.direction, 'credit');
});

test('a payment to a person using the card is not a payment TO the card', () => {
  const event = inspectUniversalBankEvent('You paid $50.00 to your friend using your debit card', {});
  assert.notEqual(event.family, 'card-payment');
});

// A Chase-style threshold notice: the configured threshold is never the
// principal and the limit clause does not make it a balance/limit notice.
test('an alert threshold is not the transaction amount', () => {
  const event = inspectUniversalBankEvent(
    'Card acct 9093: A charge of $41.95 at GOLDEN SPOON on Mar 29, 2026 at 12:00 PM ET is greater than your $3.00 limit in your Alerts settings.',
    { sender: '24273' });
  assert.equal(event.status, 'posted');
  assert.equal(event.family, 'purchase');
  assert.equal(event.direction, 'debit');
  assert.deepEqual(event.amount.alternatives.find((money) => money.currency === 'USD')?.minorUnits, '4195');
});

// Review round 1: confirmed false bookings, each with a paired positive.
const reviewControls = {
  'noun opener with a non-completed continuation': [
    'A charge of $150.00 at HOTEL requires approval.',
    'A charge of $150.00 at HOTEL needs your approval.',
    'A charge of $150.00 at HOTEL is waiting for your approval.',
    'A charge of $150.00 at HOTEL may appear on your card.',
    'A charge of $9.99 at NETFLIX renews on 10/20.',
    'A charge of $9.99 at NETFLIX tomorrow.',
    'A charge of $9.99 at NETFLIX is coming up.',
    'A charge of $9.99 at NETFLIX: trial ends soon.',
    'A charge of $25.00 at SHOP was reported as fraud.',
    'Debit card payment of $56.20 at TESCO was returned.',
    'Example: A charge of $120.00 at SHOP was approved.',
    'For example, a charge of $120.00 at SHOP was approved.',
    'Sample alert. A charge of $120.00 at SHOP was approved.',
  ],
  'an ATM limit or offer is not a withdrawal': [
    'ATM withdrawal of $500.00 daily limit applies.',
    'ATM withdrawal of $200.00 limit reached for today.',
    'ATM withdrawal of $200.00 is available with your new card.',
  ],
  'an approval that is not final': [
    'A charge of $1,245.00 at BEST BUY was approved. It may take 2 days to post.',
    'A charge of $1,245.00 at BEST BUY was approved, subject to final settlement.',
    'A charge of $1.00 at SHELL was approved. Final amount will be updated.',
    'Your card ending 1234 has been used for $1.00 at SHELL for card verification.',
  ],
  'P2P money not yet arrived, returned or bounced': [
    'J SMITH sent you $45.00. Accept it?',
    'J SMITH sent you $45.00 and is waiting for you to enroll.',
    "J SMITH sent you $45.00, it's on the way.",
    'You received $150.00 from TOM BAKER. Accept within 7 days.',
    'Your $142.80 payment to PG&E was sent back to you.',
    'You\'ve sent $45.00 to J SMITH but it bounced back.',
    'You\'ve sent $45.00 to J SMITH. It was returned.',
    'You\'ve received $45.00 from J SMITH. It was returned to sender.',
  ],
  'own-account moves are not spending or income': [
    'You transferred $150.00 to your savings account.',
    'You sent $150.00 to your Savings account.',
    "You've sent $45.00 to your Savings pot",
    'You received $150.00 from your Savings account into your Checking.',
  ],
  'later settlement': [
    'Your bill payment of $85.60 to HYDRO ONE was processed. Funds will be withdrawn on 10/20.',
    'A deposit of $1,500.00 is available in your account on 10/20.',
    "We'd like to remind you we've charged $9.99 to your card each month starting next month.",
    'Your bill payment of $85.60 to HYDRO ONE was made available for scheduling.',
  ],
  'hedges, negations and declines': [
    'Your card ending 1234 may have been used for $45.00 at MAPLE MART.',
    'Your card ending 1234 might have been used for $45.00 at MAPLE MART.',
    'We have charged nothing from your account for $50.00.',
    'Card ending 4455 used for $12.40 at SHOP. Not enough funds.',
  ],
  'a question joined to the movement': [
    "Your card ending 1234 has been used for $45.00 at MAPLE MART, didn't make this?",
    'Your card ending 1234 has been used for $45.00 at MAPLE MART, or did you not make it?',
    'Your card ending 1234 has been used for $45.00 at MAPLE MART or was it not you?',
    'Your card ending 1234 has been used for $45.00 at MAPLE MART, really not you?',
  ],
  'pre-existing: conditional openers, test charges, chargebacks, enrolment': [
    'Note - if a charge of $120.00 at SHOP was made, call us.',
    'Once a purchase of $120.00 at SHOP is made, we will alert you.',
    'A charge of $1.00 at SHOP was made as a test charge.',
    'Your card was charged back $50.00 at SHOP.',
    'You received $150.00 via Zelle. Enroll to receive it.',
  ],
  'round-2 lab: header examples, nothing charged': [
    'Bank Alert: Example: A charge of $500.00 at MAPLE MART was approved.',
    'Bank Alert: Sample alert. You made a $20.78 purchase at MAPLE MART.',
    'Bank Alert / Sample alert. You made a $20.78 purchase at MAPLE MART.',
    'Nothing was charged to your card ending 2946 for the $77.75 order at MAPLE MART.',
  ],
  'a received bill is an obligation': [
    'You have received a new bill from CITY POWER for $95.61. Pay by 10/30.',
    'You have received a new bill from CITY POWER for $95.61.',
  ],
  'a limit or threshold is not a transaction': [
    'Your $500.00 transaction limit was more than the amount set.',
    'Your $500.00 alert threshold transaction was greater than the threshold.',
  ],
};
for (const [cluster, bodies] of Object.entries(reviewControls)) for (const body of bodies) {
  test(`review r1, never books (${cluster}): ${body.slice(0, 60)}`, () => {
    const row = us(body);
    assert.equal(android(row), null);
    assert.equal(history(row).parsed.length, 0);
  });
}

test('a named payee acknowledging your transfer is money out, never income', () => {
  for (const parsed of ['TOM BAKER has received your $150.00 transfer.', 'MARIA GARCIA has received your 20.91 USD transfer.',
    'MARIA GARCIA has received your C$242.83 transfer.']
    .flatMap((body) => [android(us(body)), history(us(body)).parsed[0]])) {
    assert.ok(!parsed || parsed.type !== 'income', JSON.stringify(parsed));
  }
});

// A credit-card bill payment is a settlement: never a plain expense.
for (const body of [
  'Your bill payment of $500.00 to AMERICAN EXPRESS was completed.',
  'Your bill payment of $500.00 to CAPITAL ONE was completed.',
  'Your bill payment of $500.00 to CITI CARDS was completed.',
  'Your bill payment of $500.00 to DISCOVER CARD was completed.',
  'Your $500.00 payment to AMEX was sent.',
  'Your $500.00 payment to CHASE CREDIT CRD AUTOPAY was sent.',
  'Online bill payment of $478.79 to CAPITAL ONE was deducted from your account.',
  'Your $500.00 payment to your Amex Platinum was sent.',
  'You transferred $500.00 to your Chase credit card.',
  'You sent $500.00 to your Capital One card ending 1234.',
  "You've sent $500.00 to AMEX CARD 1234.",
  'Your bill payment of $175.00 to TD VISA was completed.',
  'Your bill payment of $60.27 to MBNA was completed.',
]) test(`review r1, card bill payment is a settlement: ${body.slice(0, 60)}`, () => {
  for (const parsed of [android(us(body)), history(us(body)).parsed[0]]) {
    assert.ok(!parsed || parsed.kind !== 'transaction', `not an ordinary transaction: ${JSON.stringify(parsed)}`);
  }
});

// Paired positives: the genuine shapes beside those controls still book.
for (const [body, minor, type] of [
  ['Card Alert: A charge of $45.00 at MAPLE MART was made on your card ending 1234.', 4500, 'expense'],
  ['Card Alert: A charge of $45.00 at MAPLE MART was approved on your card ending 1234.', 4500, 'expense'],
  ['Card Alert: Debit card payment of $56.20 at CORNER GROCER on 18/09/2026 from your account ending 9012.', 5620, 'expense'],
  ['Card Alert: ATM withdrawal of $200.00 from your account ending 3390 on 27/09/2026 at 10:41.', 20000, 'expense'],
  ['Card Alert: Your card ending 1234 has been used for $45.00 at MAPLE MART. Not you? Call us.', 4500, 'expense'],
  ['Card Alert: Your card ending 1234 has been used for $45.00 at MAPLE MART Not you? Call 1-800-555-0100.', 4500, 'expense'],
  ['Bank Alert: Your bill payment of $85.60 to LAKESIDE HYDRO was completed from your account ending 1180.', 8560, 'expense'],
  ['Bank Alert: Your $142.80 payment to CITY POWER CO was sent from your account ending 9921.', 14280, 'expense'],
  ['Bank Alert: You sent $65.00 to JORDAN LEE from your account ending 9921.', 6500, 'expense'],
  ['Bank Alert: You sent $65.00 to JORDAN LEE. It will arrive in seconds.', 6500, 'expense'],
  ['Bank Alert: ATM deposit of $560.00 posted to your account ending 2287.', 56000, 'income'],
]) test(`review r1, still books: ${body.slice(0, 64)}`, () => {
  const parsed = android(us(body));
  assert.ok(parsed, 'Android posts');
  assert.equal(parsed.kind, 'transaction');
  assert.equal(parsed.type, type);
  assert.equal(parsed.amountFils, minor);
});

// Bounded amount and gap runs: no polynomial blow-up on long inputs.
test('long digit runs read in bounded time', () => {
  for (const size of [4000, 8000]) {
    for (const body of ['A charge of $' + '1'.repeat(size), 'Your $' + '9'.repeat(size) + ' transaction',
      '$' + '1,'.repeat(size / 2) + ' charge at']) {
      const started = process.hrtime.bigint();
      inspectUniversalBankEvent(body.slice(0, 4096), {});
      const ms = Number(process.hrtime.bigint() - started) / 1e6;
      assert.ok(ms < 250, `${size}: ${ms.toFixed(0)} ms`);
    }
  }
});
