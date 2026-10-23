const assert = require('node:assert/strict');
const test = require('node:test');
const { createHash } = require('node:crypto');
const load = require('./load-ts.cjs').createLoader();
const { inspectGenericBankEventForReview, createLaunchAlertSession } = load('@/lib/launch-alert-parser');
const { parseHistoricalMessageRecords } = load('@/lib/historical-import');
const { setActiveMarket, setLedgerCurrency } = load('@/lib/markets');
const { setActiveCountry } = load('@/lib/country');
const policy = load('@/lib/best-effort-autopost');
const { currencyMinorUnits } = load('@/lib/currency-metadata');

// Launch-market policy round: what happens AFTER the universal parser read an
// alert. Synthetic text only, fictional institutions, people and values.

const CURRENCY = { US: 'USD', CA: 'CAD', GB: 'GBP', DE: 'EUR', ES: 'EUR', PL: 'PLN', KW: 'KWD', BH: 'BHD', NZ: 'NZD', AU: 'AUD', QA: 'QAR' };
const EXPONENT = { KWD: 3, BHD: 3 };
const configure = (country) => {
  const currency = CURRENCY[country];
  setActiveCountry(country);
  setLedgerCurrency(null);
  setActiveMarket('ZZ');
  setLedgerCurrency(currency, EXPONENT[currency] ?? 2);
  return createLaunchAlertSession({ overrides: {}, activeMarket: 'ZZ', pinnedCurrency: currency,
    fxLookup: () => null, bestEffort: { enabled: true, country } });
};

/** The real iPhone History path: 'posted', 'review' or 'dropped'. */
const history = (country, source, sender) => {
  const session = configure(country);
  const record = { v: 1, id: createHash('sha256').update(`${country}|${sender ?? ''}|${source}`).digest('hex'),
    text: source, receivedAt: '2026-10-11T12:00:00.000Z' };
  if (sender) record.sender = sender;
  const result = parseHistoricalMessageRecords([JSON.stringify(record)], {}, new Date('2026-10-11T12:05:00Z'),
    new Set(), session);
  assert.equal(result.invalidCount, 0);
  assert.equal(JSON.stringify(result).includes(source), false, 'no source text leaves History');
  return result.parsed.length ? 'posted' : result.reviewCandidates.length ? 'review' : 'dropped';
};
/** The first accepted History record, for exact-money checks. */
const historyParsed = (country, source, sender) => {
  const session = configure(country);
  const record = { v: 1, id: createHash('sha256').update(`parsed|${country}|${sender ?? ''}|${source}`).digest('hex'),
    text: source, receivedAt: '2026-10-11T12:00:00.000Z' };
  if (sender) record.sender = sender;
  return parseHistoricalMessageRecords([JSON.stringify(record)], {}, new Date('2026-10-11T12:05:00Z'),
    new Set(), session).parsed[0] ?? null;
};

// ── 1. A clear money movement with no generic context word reaches Review ──

for (const [country, sender, source] of [
  // Registered short code, account tail, no "your account"/"card ending" phrase.
  ['US', '650100', 'Northwind Bank: Check for $2,100.00 was deducted from account 8950 on 10/09/2026. Go online to view details.'],
  // Blank sender (iOS History), own account tail.
  ['KW', undefined, 'Acct. 0465 has been debited with KWD 5.800 from SAMPLE CO OP. Your Avl. balance is KWD 1,743.966'],
  // Gulf "thank you for using your VISA" purchase, blank sender.
  ['BH', undefined, 'Dear Customer, thank you for using your VISA 7490 for BHD 9.000 at SAMPLE SPA on 10/10 @ 21:15. Customer Service 17000000'],
]) test(`a completed movement without context words reaches Review, never posts: ${source.slice(0, 48)}`, () => {
  assert.equal(history(country, source, sender), 'review');
});

// Once the worldwide parser reads these completed movements itself, they may
// book instead of waiting in Review, but only with the exact stated money and
// direction: an outgoing transfer already sent, and a card used at a shop.
for (const [country, sender, source, amountFils, currency] of [
  ['PL', 'NorthwindPay', 'You sent 65,23 PLN to SAMPLE SP. Z O.O. It will arrive tomorrow. Transfer sent', 6523, 'PLN'],
  ['US', '288400', 'Brought to you by Sample Cards: Card 4865 was used at SAMPLE MART in USA for $9.00.', 900, 'USD'],
]) test(`a completed movement reaches Review or books its exact money: ${source.slice(0, 48)}`, () => {
  const state = history(country, source, sender);
  assert.ok(state === 'review' || state === 'posted', state);
  if (state === 'posted') {
    const parsed = historyParsed(country, source, sender);
    assert.equal(parsed.type, 'expense');
    assert.equal(parsed.amountFils, amountFils);
    assert.equal(parsed.currency, currency);
  }
});

test('a repeated bare $ no longer overflows the Review sanitizer and drops the alert', () => {
  configure('US');
  const source = 'Deposit posted You have a direct deposit of $123.45 Account ending in (...1234) Posted Oct 10, 2026 at 5:37 AM ET Amount $123.45';
  const event = inspectGenericBankEventForReview(source, 'com.example.bank');
  assert.ok(event);
  const keys = event.amount.alternatives.map((money) => `${money.currency}/${money.minorUnits}/${money.exponent}`);
  assert.equal(new Set(keys).size, keys.length, 'identical readings appear once');
  assert.ok(keys.length <= 16);
  assert.ok(keys.includes('USD/12345/2'));
  assert.equal(history('US', source, 'com.example.bank'), 'review');
});

// ── Paired controls: the same shapes that must NOT reach Review or post ──

for (const [country, sender, source] of [
  ['PL', 'NorthwindPay', 'You sent 65,23 PLN to SAMPLE SP. Z O.O. Transfer declined'],
  ['PL', 'NorthwindPay', 'Your transfer of 65,23 PLN to SAMPLE SP. Z O.O. is pending.'],
  ['US', '650100', 'Northwind Bank: $2,100.00 will be debited from acct 8950 on 10/20/2026.'],
  ['US', '650100', 'If you sent $250.00 to ALEX ROE from acct 8950, no action is needed.'],
  ['US', '650100', 'Northwind Bank: Did you make a purchase of $45.00 at SAMPLE MART with card 1234? Reply YES or NO.'],
  ['US', '650100', 'USD 45.00 was not debited from acct 8950 at SAMPLE MART.'],
  ['US', '650100', 'Your one-time code is 482913 for a purchase of $45.00 at SAMPLE MART with card 1234.'],
  ['US', '650100', 'Earn 5% cashback: spend $45.00 at SAMPLE MART with card 1234 this week.'],
  ['US', '650100', 'ALEX ROE requested $45.00 from you. Tap to pay.'],
  ['US', undefined, 'I sent you $25.00 for dinner, did you get it?'],
  ['US', undefined, 'SAM LEE sent you $25.00 for dinner'],
  ['US', 'SampleRides', 'Thanks for riding with Sample Rides. Your fare: $23.40.'],
  ['US', 'WALLETPAY', 'Your wallet amount of $482.00 is credited to 98XXXXXX10. Sign up today: w4l.example/k2'],
  ['US', '+15550001111', 'You sent $250.00 to ALEX ROE. Not you? Call 1-800-555-0100.'],
  ['US', '650100', 'Balance on acct 8950 is $1,234.56 as of 10/10/2026.'],
  ['US', '+15550001111', "Sample Store: A charge of $499.99 was made with card 1234. If this wasn't you, call 1-888-555-0100."],
  ['US', undefined, 'Card 1234 was used at SAMPLE MART for $899.00. Review it: https://sample-secure.example/x'],
  ['US', '650100', "Your deposit of $45.00 can't be made to acct 8950."],
  ['US', '650100', 'Your transfer of $45.00 could not be made from acct 8950.'],
  ['US', undefined, "You've received $500.00 on Sample Cash! Accept within 24 hours."],
  ['US', '+15550001111', "You've received $750.00 from SAMPLE TREASURY via Venmo. Contact agent Mike to release."],
  ['US', undefined, "You've received a new message from Sam about the $50.00 Venmo."],
  ['US', 'SAMPLEBNK', 'Upgrade to Sample CashBack Visa card 1234 today: $200.00 credited when you sign up.'],
]) test(`paired control stays out of Review and the ledger: ${source.slice(0, 48)}`, () => {
  assert.equal(history(country, source, sender), 'dropped');
});

// ── 2. Posting-policy gates made precise, each with its paired control ──

const decide = (country, source, sender) => {
  const session = configure(country);
  return session.parseUnproven(source, sender, session.inspect(source, sender), Date.parse('2026-10-11T12:00:00Z'));
};

test('"CashBack Mastercard" names the card, so a completed purchase on it posts', () => {
  const parsed = decide('CA', 'Sample Bank: A purchase of $120.00 was made at SAMPLE WHOLESALE with your Sample CashBack Mastercard ending in 8765 on Oct 1, 2026.', '26600');
  assert.ok(parsed);
  assert.equal(parsed.amountFils, 12000);
  assert.equal(parsed.currency, 'CAD');
  assert.equal(parsed.type, 'expense');
  for (const offer of [
    'Earn 5% cashback with your Sample Mastercard ending in 8765 on purchases over $120.00.',
    'Your cashback of $12.00 was credited to your Sample Mastercard ending in 8765.',
    'Get $120.00 cash back when you spend with your Sample CashBack Mastercard ending in 8765. Offer ends Oct 31.',
  ]) assert.equal(policy.hasNonCompletedWording(offer, null, '26600'), true, offer);
});

test('a biller code is a receipt field; a security code still withholds the money', () => {
  assert.equal(policy.isNotAutoPostableMoney('Sample Bank: Your bill payment of $186.40 to SAMPLE ENERGY (Biller code 12345) was successful on 04/10/2026.'), false);
  assert.equal(policy.isNotAutoPostableMoney('Sample Bank: Use security code 482913 to approve your payment of $186.40 to SAMPLE ENERGY.'), true);
  assert.equal(policy.isNotAutoPostableMoney('Sample Bank: $186.40 to SAMPLE ENERGY. Code: 482913'), true);
});

test('a debit already taken under an existing e-mandate is completed; a mandate set-up or future debit is not', () => {
  assert.equal(policy.hasNonCompletedWording('Rs.649.00 has been debited from your Sample Bank Credit Card ending 9012 towards SAMPLEFLIX.COM on 10-09-2026 as per your e-mandate (SI).', null, 'VM-SMPLBK'), false);
  for (const pending of [
    'Your e-mandate for Rs.649.00 towards SAMPLEFLIX.COM is registered on card ending 9012.',
    'Rs.649.00 will be debited from card ending 9012 on 12-10-2026 as per your e-mandate.',
    'As per your mandate, Rs.649.00 is scheduled from card ending 9012.',
  ]) assert.equal(policy.hasNonCompletedWording(pending, null, 'VM-SMPLBK'), true, pending);
});

test('the own-instrument tail reads product names, card networks and glued masks, never a payer or a visa', () => {
  for (const own of [
    'A refund of $59.99 from SAMPLE STORE has been credited to your Flexi Debit Visa ending 4321.',
    'Dear UPI User, ur A/cX1234 credited by Rs500 on 09Oct26 (Ref no 625212345678)',
    "You've received RM500.00 from AHMAD into your Savings Account-i ****1234.",
    'Dear Customer, thank you for using your VISA 7490 for BHD 9.000 at SAMPLE SPA.',
    'Your Amex ••1234 was charged $45.00 at SAMPLE MART.',
  ]) assert.equal(policy.namesOwnInstrumentTail(own), true, own);
  for (const notOwn of [
    'Credit from Sample Bank Account 1234 of JOHN ROE: USD 5,000.00',
    'You have received USD 5,000.00 from account XXXX9876 of JOHN',
    'Transfer of USD 5,000.00 credited from card 1234 holder JOHN',
    'You have received USD 5,000.00 from your friend JOHN ROE.',
    // A visa, a model number or a year after a network word is not a card.
    'You have received $500.00 refund for your visa 2026 application.',
    'You have received $250.00 for your AC 1234 repair.',
    'You have received $500.00 into your Visa 2026.',
    // Payer labels and a holder after the tail name the payer's instrument.
    'You have received $1,500.00. Payer: account 4321.',
    'You have received $1,500.00. Remitter: account 4321.',
    'You have received $1,500.00, account 4321 of JOHN ROE.',
    "You have received $1,500.00 from your uncle John's card 4321.",
  ]) assert.equal(policy.namesOwnInstrumentTail(notOwn, 'credit'), false, notOwn);
});

for (const [country, sender, source] of [
  ['US', undefined, 'You have received $500.00 refund for your visa 2026 application.'],
  ['US', '+15550001111', 'You have received $500.00 refund for your visa 2026 application.'],
  ['GB', undefined, 'You have received £1,250.00 from HMRC for your visa 2025 overpayment.'],
  ['US', undefined, 'You have received $250.00 for your AC 1234 repair.'],
  ['US', '+15550001111', 'You have received $1,500.00. Payer: Sample Bank account 4321.'],
  ['US', '+15550001111', 'You have received $1,500.00, Sample Bank account 4321 of JOHN ROE.'],
  ['US', undefined, "You have received $1,500.00 from your uncle John's Visa 4321."],
]) test(`an unaccountable credit naming no own instrument never posts: ${source.slice(0, 48)}`, () => {
  assert.notEqual(history(country, source, sender), 'posted');
});

test('a senderless credit to a named own card posts; the same credit naming no instrument still waits', () => {
  const owned = 'Sample Bank: A refund of $59.99 from SAMPLE STORE has been credited to your Flexi Debit Visa ending 4321 on 06/10/2026.';
  const parsed = decide('NZ', owned, '');
  assert.ok(parsed);
  assert.equal(parsed.amountFils, 5999);
  assert.equal(parsed.type, 'income');
  assert.equal(decide('NZ', 'A refund of $59.99 from SAMPLE STORE has been credited on 06/10/2026.', ''), null);
});

// ── Senderless "money arrived" claims: contracted wording and rails ──

for (const [country, source] of [
  ['ES', 'Has recibido un Bizum de 25,00 € de LAURA ROE. Concepto: cena'],
  ['AU', "You've received $50.00 from JOHN CITIZEN via Osko. Description: Dinner"],
]) test(`a senderless credit naming a payment rail waits in Review: ${source.slice(0, 40)}`, () => {
  assert.equal(history(country, source, undefined), 'review');
});

for (const [country, source] of [
  ['AU', "You've received $50.00 from me, did you get it?"],
  ['AU', "You've received $50.00 via Osko. Click here to claim: osko-refund.example/x"],
  ['ES', 'Has recibido un Bizum de 25,00 € pendiente de aceptar.'],
]) test(`a claim-shaped chat, lure or pending credit stays out: ${source.slice(0, 40)}`, () => {
  assert.equal(history(country, source, undefined), 'dropped');
});

// ── 3. History agrees with Android on a certified Gulf-neighbour template ──

const muscat = 'تم خصم OMR 1.250 من حسابك رقم XXXXXXX4821 بإستخدام بطاقة الخصم المباشر في SAMPLE CAFE MUSCAT-123456 بتاريخ 2026/10/09 18:20:11. رصيدك الحالي هو 812.340 OMR.';

test("Bank Muscat's certified card purchase from its own sender posts from History as on Android", () => {
  CURRENCY.OM = 'OMR';
  EXPONENT.OMR = 3;
  const session = configure('OM');
  const parsed = session.parse(muscat, 'BankMuscat', session.inspect(muscat, 'BankMuscat'), undefined, Date.parse('2026-10-11T12:00:00Z'));
  assert.ok(parsed, 'the certified template posts on the parser seam');
  assert.equal(parsed.bestEffort, undefined);
  assert.equal(history('OM', muscat, 'BankMuscat'), 'posted');
});

for (const variant of [
  muscat.replace('تم خصم', 'تم رفض خصم'),
  muscat.replace('تم خصم', 'سيتم خصم'),
]) test(`a declined or future Bank Muscat text is not accepted as the certified template: ${variant.slice(0, 24)}`, () => {
  assert.notEqual(history('OM', variant, 'BankMuscat'), 'posted');
});

// ── 4. Money-lane hand-off: constructed events, because the reader changes
// that emit these shapes (kr / دينار ambiguity, threshold flags) merge
// separately. Each decides on the policy alone.

const missing = () => ({ value: null, evidence: 'missing', spans: [], alternatives: [], issues: [] });
const money = (currency, minorUnits, exponent) => ({ currency, minorUnits: String(minorUnits), exponent });
const constructed = (source, amount, extraObservations = []) => {
  const start = source.search(/\d/);
  const span = { start, end: start + (source.slice(start).match(/^[\d.,\s]+\d/)?.[0].length ?? 1) };
  const field = { ...amount, spans: [span] };
  return {
    version: 1, decision: 'review', family: 'purchase', status: 'posted', direction: 'debit',
    amount: field, statementTotal: missing(), minimumDue: missing(), balance: missing(), creditLimit: missing(),
    merchant: { value: 'SAMPLE MART', evidence: 'explicit', spans: [], alternatives: [], issues: [] },
    transactionDate: missing(), dueDate: missing(), statementDate: missing(), instrument: missing(),
    observations: [{ role: 'transaction', field }, ...extraObservations], issues: [],
  };
};
const decidePolicy = (source, event, country, ledgerCurrency, ledgerExponent) => policy.decideBestEffortAutoPost({
  source, event, enabled: true, country, routedMarket: null, launchSenderMarket: null, ledgerCurrency, ledgerExponent,
  observedAt: Date.parse('2026-10-11T12:00:00Z'), fxLookup: () => null, sender: 'SAMPLEBANK',
});
const krReadings = (minor) => ['SEK', 'DKK', 'NOK', 'ISK'].map((c) => money(c, c === 'ISK' ? minor / 100 : minor, c === 'ISK' ? 0 : 2));

test('a bare "kr" resolves only through a Nordic country, never for anyone else', () => {
  // No Nordic-language word: the reader's country alone decides the krone.
  const source = 'Card purchase 245,00 kr at SAMPLE MART card 1234';
  const amount = { value: null, evidence: 'ambiguous', alternatives: krReadings(24500), issues: ['currency-symbol'] };
  for (const [country, currency] of [['SE', 'SEK'], ['DK', 'DKK'], ['NO', 'NOK']]) {
    const decision = decidePolicy(source, constructed(source, amount), country, currency, 2);
    assert.equal(decision.outcome, 'post', country);
    assert.deepEqual(decision.original, money(currency, 24500, 2));
  }
  // Swedish wording is Swedish money: under a Danish or Norwegian reader it
  // is another country's krone, and waits in Review.
  const swedish = 'Kortköp 245,00 kr hos SAMPLE MART med kort 1234';
  assert.equal(decidePolicy(swedish, constructed(swedish, amount), 'SE', 'SEK', 2).outcome, 'post');
  for (const [country, currency] of [['DK', 'DKK'], ['NO', 'NOK']]) {
    assert.deepEqual(decidePolicy(swedish, constructed(swedish, amount), country, currency, 2), { outcome: 'review', reason: 'currency-unclear' });
  }
  assert.deepEqual(decidePolicy(source, constructed(source, amount), 'DE', 'EUR', 2), { outcome: 'review', reason: 'currency-unclear' });
  assert.deepEqual(decidePolicy(source, constructed(source, amount), 'US', 'USD', 2), { outcome: 'review', reason: 'currency-unclear' });
});

const dinar = (figure, readings) => ({ value: null, evidence: 'ambiguous', alternatives: readings,
  issues: ['currency-symbol', 'decimal-or-grouping'] });

test('a dinar figure resolves through the country first, then its own decimal convention', () => {
  const iq = 'تم خصم 1,250,000 دينار من بطاقتك 1234 لدى SAMPLE MART';
  // The dinar's exponent comes from the currency table (the money lane makes
  // IQD zero-decimal); the policy only has to pick Iraq's single reading.
  const iqExponent = currencyMinorUnits('IQD');
  const iqMinor = 1250000 * 10 ** iqExponent;
  const iqDecision = decidePolicy(iq, constructed(iq, dinar('1,250,000', [
    money('IQD', iqMinor, iqExponent), money('JOD', 1250000, 3), money('KWD', 1250000, 3), money('JOD', 1250000000, 3),
  ])), 'IQ', 'IQD', iqExponent);
  if (iqExponent === 0) {
    assert.equal(iqDecision.outcome, 'post');
    assert.equal(iqDecision.amountFils, iqMinor);
  } else {
    // Until the table makes IQD zero-decimal, a lone reading under a
    // decimal-or-grouping doubt is never trusted (it may be the 1000x one).
    assert.deepEqual(iqDecision, { outcome: 'review', reason: 'amount-unclear' });
  }

  const jo = 'تم خصم 75.000 دينار من بطاقتك 1234 لدى SAMPLE MART';
  const joReadings = [money('JOD', 75000, 3), money('JOD', 75000000, 3), money('KWD', 75000, 3), money('KWD', 75000000, 3), money('IQD', 75000, 0)];
  const joDecision = decidePolicy(jo, constructed(jo, dinar('75.000', joReadings)), 'JO', 'JOD', 3);
  assert.equal(joDecision.outcome, 'post');
  assert.equal(joDecision.amountFils, 75000, 'the full stop is the decimal point in Jordan');

  // A comma leaves the Jordanian figure undecided; a dinar outside the
  // dinar countries is unclear money.
  const joComma = 'تم خصم 75,000 دينار من بطاقتك 1234 لدى SAMPLE MART';
  assert.equal(decidePolicy(joComma, constructed(joComma, dinar('75,000', joReadings)), 'JO', 'JOD', 3).outcome, 'review');
  assert.deepEqual(decidePolicy(jo, constructed(jo, dinar('75.000', joReadings)), 'AE', 'AED', 2), { outcome: 'review', reason: 'currency-unclear' });
});

test('an alert-threshold figure is not a competing amount; a second movement still is', () => {
  const source = 'Northwind: A charge of $82.95 at SAMPLE MART was more than the $3.00 limit in your Alerts settings.';
  const amount = { value: money('USD', 8295, 2), evidence: 'explicit', alternatives: [], issues: [] };
  const threshold = { role: 'unknown', field: { value: money('USD', 300, 2), evidence: 'explicit', spans: [], alternatives: [], issues: ['aggregate-money-field'] } };
  assert.equal(decidePolicy(source, constructed(source, amount, [threshold]), 'US', 'USD', 2).outcome, 'post');
  const second = { role: 'transaction', field: { value: money('USD', 1200, 2), evidence: 'explicit', spans: [], alternatives: [], issues: [] } };
  assert.deepEqual(decidePolicy(source, constructed(source, amount, [second]), 'US', 'USD', 2), { outcome: 'review', reason: 'competing-amounts' });
  const unflagged = { role: 'unknown', field: { ...threshold.field, issues: [] } };
  assert.deepEqual(decidePolicy(source, constructed(source, amount, [unflagged]), 'US', 'USD', 2), { outcome: 'review', reason: 'competing-amounts' });
});

// ── 5. Chat and alert settings from an unaccountable sender never post ──

for (const [country, sender, source] of [
  ['US', '+14155550134', 'lol just spent $65.00 at SAMPLE GAS 0091 😂'],
  ['US', undefined, 'lol just spent $65.00 at SAMPLE GAS 0091 😂'],
  ['GB', '+447700900123', 'Paid £42.00 at SAMPLE BISTRO for dinner, send me your half'],
  ['KW', '+96550123456', 'دفعت 39.017 د.ك في SAMPLE MALL عن العشاء، حوّل لي نصيبك'],
  ['US', 'SAMPLEBANK', 'Sample Bank: If you make a purchase over $126.67 at SAMPLE GAS 0091, we will send you an alert.'],
  ['US', undefined, 'If you make a purchase over $126.67 at SAMPLE.COM/BILL, we will send you an alert. Avl bal $12,736.02'],
  ['QA', 'SampleBank', 'إذا قمت بعملية شراء بأكثر من 141.38 QAR لدى SAMPLE 23 فسنرسل لك تنبيهاً.'],
]) test(`chat or an alert setting never books: ${source.slice(0, 44)}`, () => {
  assert.notEqual(history(country, source, sender), 'posted');
  if (sender) assert.equal(decide(country, source, sender), null);
});

test('the genuine completed charge with the "If you made this purchase" footer still books', () => {
  const source = 'Sample Bank: You made a $45.00 purchase at SAMPLE MART with card ending 1234. If you made this purchase, no action is needed.';
  assert.equal(policy.hasNonCompletedWording(source, null, 'SAMPLEBANK'), false);
  const parsed = decide('US', source, '65010');
  assert.ok(parsed);
  assert.equal(parsed.amountFils, 4500);
});

// ── 6. English-lane hand-offs on the wording guard ──

test('"Don\'t recognise it? Call us" is a footer; "Do you recognise this payment?" still asks', () => {
  assert.equal(policy.isNotAutoPostableMoney("Sample Bank: You paid £45.00 to SAMPLE MART with card ending 1234. Don't recognise it? Call 0800 000 000."), false);
  assert.equal(policy.isNotAutoPostableMoney('Sample Bank: Do you recognise this payment of £45.00 to SAMPLE MART? Reply Y or N.'), true);
  assert.equal(policy.isNotAutoPostableMoney('Sample Bank: £45.00 to SAMPLE MART. We need you to recognise this payment in the app.'), true);
});

test('"transaction was made" is completed movement wording for the footer exemptions', () => {
  // A link on a senderless alert stands only beside completed own-card money.
  const genuine = 'Sample Card: A $25.00 transaction was made at SAMPLE.ORG on card ending 1234. See it at https://app.sample.example/activity';
  const notMade = 'Sample Card: A $25.00 transaction could not be made at SAMPLE.ORG on card ending 1234.';
  assert.equal(policy.hasNonCompletedWording(genuine, null, ''), false);
  assert.equal(policy.hasNonCompletedWording(notMade, null, ''), true);
});

test('each first-wave language refuses its own decline word and keeps its completed one', () => {
  for (const [declined, completed] of [
    ['Kartenzahlung über 34,90 EUR bei SAMPLE nicht ausgeführt.', 'Kartenzahlung über 34,90 EUR bei SAMPLE ausgeführt.'],
    ['Paiement de 42,30 EUR chez SAMPLE non abouti.', 'Paiement de 42,30 EUR chez SAMPLE effectué.'],
    ['Pago de 23,40 € en SAMPLE denegado.', 'Pago de 23,40 € en SAMPLE realizado.'],
    ['Betaling van € 23,45 aan SAMPLE afgewezen.', 'Betaling van € 23,45 aan SAMPLE geslaagd.'],
    ['Compra de 25,40 EUR em SAMPLE falhou.', 'Compra de 25,40 EUR em SAMPLE aprovada.'],
    ['Pagamento di 35,00 EUR presso SAMPLE negato.', 'Pagamento di 35,00 EUR presso SAMPLE eseguito.'],
    ['Płatność kartą 45,99 PLN SAMPLE odrzucona.', 'Płatność kartą 45,99 PLN SAMPLE zrealizowana.'],
    ['Köp 245,00 kr SAMPLE nekades.', 'Köp 245,00 kr SAMPLE genomfört.'],
    ['Betaling 45,00 kr SAMPLE afvist.', 'Betaling 45,00 kr SAMPLE gennemført.'],
    ['Betaling 129 kr SAMPLE avvist.', 'Betaling 129 kr SAMPLE gjennomført.'],
    ['Platba kartou 459,00 Kč SAMPLE zamítnuta.', 'Platba kartou 459,00 Kč SAMPLE provedena.'],
  ]) {
    assert.equal(policy.hasNonCompletedWording(declined, null, 'SAMPLEBANK'), true, declined);
    assert.equal(policy.hasNonCompletedWording(completed, null, 'SAMPLEBANK'), false, completed);
  }
});

test('a payee confirming the reader\'s outgoing transfer is never booked as income', () => {
  for (const source of [
    'MARIA ROE has received your $210.57 transfer.',
    'MARIA ROE has received your 140.24 USD transfer. Avl bal 8,762.72 USD',
    'SAMPLE PAYROLL has received your bank transfer of $1,164.79.',
  ]) {
    const parsed = decide('US', source, '227898');
    assert.ok(!parsed || parsed.type !== 'income', source);
  }
});

test('money that did not or may not have moved, bills and samples are not completed wording', () => {
  for (const notMoved of [
    'Nothing was charged to your card ending 2946 for the $77.75 order at SAMPLE MART.',
    'Your card ending 2358 might have been charged 49.489 KWD at SAMPLE MART.',
    'It looks like $147.52 may have been spent at SAMPLE VIDEO with your card ending in 3523.',
    'Your account ending in 7636 was used for £533.85 at SAMPLE TRAVEL or was it not you?',
    'Northwind: You received $65.00 via Zelle. Enroll to receive it.',
    'You have received a new bill from SAMPLE POWER for $325.51, due Nov 8, 2026.',
    'Sample alert. You made a $18.14 purchase at SAMPLE MART.',
  ]) assert.equal(policy.hasNonCompletedWording(notMoved, null, 'SAMPLEBANK'), true, notMoved);
  for (const moved of [
    'Your card ending 2946 was charged $77.75 at SAMPLE MART.',
    'Your account ending in 7636 was used for £533.85 at SAMPLE TRAVEL. Not you? Call 0800 000 000.',
    'Northwind: You received $65.00 via Zelle from MARIA ROE.',
    'Bill paid $190.98 - SAMPLE SOFTWARE',
    'You made a $18.14 purchase at SAMPLE ALERT SHOP with card ending 1234.',
  ]) assert.equal(policy.hasNonCompletedWording(moved, null, 'SAMPLEBANK'), false, moved);
});

test('money sent to the reader\'s own named card is a card payment, not spending', () => {
  assert.equal(decide('US', 'Sample Bank: You sent $20.00 to your SAMPLE CREDIT CRD AUTOPAY card ending 9220.', '73981'), null);
  const p2p = decide('US', 'Sample Bank: You sent $20.00 to your friend MARIA ROE using your debit card ending 9220.', '73981');
  assert.ok(!p2p || p2p.amountFils === 2000);
});

test('a bank\'s joined second header counts like its plain one; a domain or generic word does not', () => {
  for (const sender of ['KFH', 'KFH-Info', 'NBKAlerts', 'SANLAM_UT', 'T-CASH']) assert.equal(policy.isRegisteredAlertSender(sender), true, sender);
  for (const sender of ['secure-bank.com', 'INFO-X', 'Info', '+15550001111', 'alerts@mail.example']) assert.equal(policy.isRegisteredAlertSender(sender), false, sender);
});

test('second-review regressions: lone 1000x readings, French plural futures and over-broad footers', () => {
  const usd = (figure) => ({ value: null, evidence: 'ambiguous', alternatives: [money('USD', figure, 2), money('CAD', figure, 2)],
    issues: ['currency-symbol', 'decimal-or-grouping'] });
  const tiny = 'You spent $0.125 at SAMPLE MART with card ending 1234.';
  assert.equal(decidePolicy(tiny, constructed(tiny, usd(12500)), 'US', 'USD', 2).outcome, 'review');
  const kwOnlyGrouped = { value: null, evidence: 'ambiguous', alternatives: [money('KWD', 12500000, 3)], issues: ['decimal-or-grouping'] };
  const kw = 'Purchase of KWD 12.500 at SAMPLE MART with card ending 1234.';
  assert.equal(decidePolicy(kw, constructed(kw, kwOnlyGrouped), 'KW', 'KWD', 3).outcome, 'review');
  for (const future of [
    'Frais de 2,50 EUR seront débités sur compte 1234.',
    'Frais de 2,50 EUR vont être débités sur compte 1234.',
    'Frais de 2,50 EUR non débités sur compte 1234.',
    'Gebühr 2,50 EUR werden morgen belastet, Konto 1234.',
  ]) assert.equal(policy.hasNonCompletedWording(future, null, 'SAMPLEBANK'), true, future);
  for (const footer of [
    'You spent $45.00 at SAMPLE MART with card ending 1234. You may have been charged a foreign transaction fee.',
    'We have received bill payment of $186.40 for SAMPLE POWER account 1234.',
    'You spent $45.00 at SAMPLE MART. If you receive a call claiming to be us, we will never ask you to move money.',
    'You spent $45.00 at SAMPLE MART. If you pay your full balance each month, you\'ll avoid interest.',
    'You spent $45.00 at SAMPLE MART. Register to receive e-statements.',
    'You spent $45.00 at SIGN UP FITNESS with card ending 1234.',
    'Köp 245,00 kr NEKAD AB, kort 1234',
    'Pagamento di 35,00 EUR presso NEGATI SRL eseguito.',
  ]) assert.equal(policy.hasNonCompletedWording(footer, null, 'SAMPLEBANK'), false, footer);
});
