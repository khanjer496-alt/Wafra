// Per-user alert format learning (src/lib/learned-alert-formats.ts).
// In-memory TS loader (no shared build dir). Run: node --test scripts/test/learned-alert-formats.test.cjs
const assert = require('node:assert/strict');
const test = require('node:test');
const { createLoader } = require('../universal-test/load-ts.cjs');

const L = createLoader()('@/lib/learned-alert-formats');
const NOW = Date.parse('2026-09-25T10:00:00Z');

const learnInto = (store, source, sender, confirmed, context = {}) => {
  const result = L.recordLearnedConfirmation(store, { source, sender, confirmed, context, now: NOW });
  assert.equal(result.ok, true, `learning refused: ${result.reason} for ${source}`);
  return result.store;
};
const match = (source, sender, store, options = {}) => L.matchLearnedFormat(source, sender, store, { now: NOW, ...options });
const usd = (amountMinor, extra = {}) => ({ amountMinor, currency: 'USD', exponent: 2, direction: 'debit', ...extra });

/* ── English: learn, then match variants ─────────────────────────────── */
const CHASE = 'Chase: Your card ending 4421 was charged USD 24.86 at NORTH STAR MARKET on 09/03/2026. Available balance USD 900.00.';
const chaseStore = () => learnInto(L.emptyLearnedFormatStore(), CHASE, 'CHASE',
  usd(2486, { merchant: 'NORTH STAR MARKET', date: '2026-09-03' }), { country: 'US' });

test('one confirmation learns a template and pre-fills matching variants', () => {
  const store = chaseStore();
  assert.equal(store.templates.length, 1);
  const hit = match('Chase: Your card ending 9912 was charged USD 1,205.10 at SQ *BLUE BOTTLE COFFEE on 09/21/2026. Available balance USD 12.40.', 'CHASE', store);
  assert.equal(hit.kind, 'prefill');
  assert.equal(hit.confirmations, 1);
  assert.deepEqual(hit.fields, {
    amountMinor: 120510, currency: 'USD', exponent: 2, direction: 'debit',
    merchant: 'SQ *BLUE BOTTLE COFFEE', date: '2026-09-21', cardLast4: '9912',
  });
});

test('upper case, and $ written for the learned USD, still match', () => {
  const store = chaseStore();
  const hit = match('CHASE: YOUR CARD ENDING 1111 WAS CHARGED USD 3.00 AT TARGET 0001 ON 01/02/2026. AVAILABLE BALANCE USD 5.00.', 'CHASE', store);
  assert.equal(hit.kind, 'prefill');
  assert.equal(hit.fields.amountMinor, 300);
  assert.equal(hit.fields.date, '2026-01-02');
  const dollar = match('Chase: Your card ending 1111 was charged $3.00 at TARGET 0001 on 01/02/2026. Available balance $5.00.', 'CHASE', store);
  assert.equal(dollar.kind, 'prefill');
  assert.deepEqual([dollar.fields.amountMinor, dollar.fields.currency], [300, 'USD']);
});

test('second consistent confirmation turns prefill into post (N=2), N is configurable', () => {
  let store = chaseStore();
  store = learnInto(store, 'Chase: Your card ending 1234 was charged USD 5.00 at TARGET 0001 on 09/04/2026. Available balance USD 895.00.', 'CHASE',
    usd(500, { merchant: 'TARGET 0001', date: '2026-09-04' }), { country: 'US' });
  assert.equal(store.templates.length, 1);
  assert.equal(store.templates[0].confirmations, 2);
  const message = 'Chase: Your card ending 1234 was charged USD 7.25 at CVS/PHARMACY #0921 on 09/05/2026. Available balance USD 887.75.';
  assert.equal(match(message, 'CHASE', store).kind, 'post');
  assert.equal(match(message, 'chase', store).kind, 'post', 'sender is normalised');
  assert.equal(match(message, 'CHASE', store, { postThreshold: 3 }).kind, 'prefill');
  assert.equal(match(message, 'CHASE', chaseStore(), { postThreshold: 1 }).kind, 'post');
});

/* ── Near misses refuse ─────────────────────────────────────────────── */
for (const [name, source, sender = 'CHASE'] of [
  ['pending word added', 'Chase: Your card ending 4421 was charged USD 24.86 at NORTH STAR MARKET on 09/03/2026. Available balance USD 900.00. Pending.'],
  ['declined instead of charged', 'Chase: Your card ending 4421 was declined USD 24.86 at NORTH STAR MARKET on 09/03/2026. Available balance USD 900.00.'],
  ['pending status in merchant position', 'Chase: Your card ending 4421 was charged USD 24.86 at PENDING AUTH on 09/03/2026. Available balance USD 900.00.'],
  ['direction word flipped', 'Chase: Your card ending 4421 was credited USD 24.86 at NORTH STAR MARKET on 09/03/2026. Available balance USD 900.00.'],
  ['different currency', 'Chase: Your card ending 4421 was charged EUR 24.86 at NORTH STAR MARKET on 09/03/2026. Available balance USD 900.00.'],
  ['extra amount not in a slot', 'Chase: Your card ending 4421 was charged USD 24.86 at NORTH STAR MARKET USD 3.00 on 09/03/2026. Available balance USD 900.00.'],
  ['balance slot in another currency', 'Chase: Your card ending 4421 was charged USD 24.86 at NORTH STAR MARKET on 09/03/2026. Available balance EUR 900.00.'],
  ['extra sentence', 'Chase: Your card ending 4421 was charged USD 24.86 at NORTH STAR MARKET on 09/03/2026. Available balance USD 900.00. Call us now.'],
  ['missing balance clause', 'Chase: Your card ending 4421 was charged USD 24.86 at NORTH STAR MARKET on 09/03/2026.'],
  ['OTP text appended', 'Chase: Your card ending 4421 was charged USD 24.86 at NORTH STAR MARKET on 09/03/2026. Available balance USD 900.00. OTP 123456.'],
  ['invalid date', 'Chase: Your card ending 4421 was charged USD 24.86 at NORTH STAR MARKET on 13/45/2026. Available balance USD 900.00.'],
  ['future date', 'Chase: Your card ending 4421 was charged USD 24.86 at NORTH STAR MARKET on 12/03/2026. Available balance USD 900.00.'],
  ['card digits of another length', 'Chase: Your card ending 44211 was charged USD 24.86 at NORTH STAR MARKET on 09/03/2026. Available balance USD 900.00.'],
  ['different sender', CHASE, 'CITI'],
  ['no sender for a sender template', CHASE, null],
]) {
  test(`refuses near miss: ${name}`, () => {
    assert.deepEqual(match(source, sender, chaseStore()), { kind: 'none' });
  });
}

test('refusal also holds at N=1 post threshold (strictness does not depend on confidence)', () => {
  const store = chaseStore();
  assert.equal(match('Chase: Your card ending 4421 was credited USD 24.86 at NORTH STAR MARKET on 09/03/2026. Available balance USD 900.00.', 'CHASE', store, { postThreshold: 1 }).kind, 'none');
});

/* ── undo, reject, contradiction ────────────────────────────────────── */
test('removeLearnedTemplate undoes learning; clearLearnedFormats empties the store', () => {
  const store = chaseStore();
  const id = store.templates[0].id;
  assert.equal(match(CHASE, 'CHASE', store).kind, 'prefill');
  assert.equal(match(CHASE, 'CHASE', L.removeLearnedTemplate(store, id)).kind, 'none');
  assert.deepEqual(L.clearLearnedFormats(), { version: 1, templates: [] });
});

test('a rejected row blocks its template, and a contradictory confirmation blocks too', () => {
  const store = chaseStore();
  const blocked = L.blockLearnedTemplate(store, store.templates[0].id, NOW);
  assert.equal(match(CHASE, 'CHASE', blocked).kind, 'none');
  // Relearning the same shape keeps it blocked.
  const again = learnInto(blocked, CHASE, 'CHASE', usd(2486, { merchant: 'NORTH STAR MARKET', date: '2026-09-03' }), { country: 'US' });
  assert.equal(again.templates[0].blocked, true);
  assert.equal(match(CHASE, 'CHASE', again).kind, 'none');
  // Same shape confirmed with the other direction.
  const contradicted = learnInto(chaseStore(), CHASE, 'CHASE', { ...usd(2486, { merchant: 'NORTH STAR MARKET', date: '2026-09-03' }), direction: 'credit' }, { country: 'US' });
  assert.equal(contradicted.templates[0].blocked, true);
  assert.equal(contradicted.templates[0].confirmations, 0);
  assert.equal(match(CHASE, 'CHASE', contradicted).kind, 'none');
});

/* ── learning refusals ──────────────────────────────────────────────── */
test('learning refuses ungrounded, duplicated, non-completed and launch-market input', () => {
  const learn = (source, confirmed, sender = 'CHASE', context = {}) =>
    L.learnFromConfirmation({ source, sender, confirmed, context, now: NOW });
  assert.equal(learn(CHASE, usd(2487)).reason, 'amount-not-grounded');
  assert.equal(learn('Chase: charged USD 5.00 at X, fee USD 5.00 today.', usd(500)).reason, 'amount-not-unique');
  assert.equal(learn(CHASE, usd(2486, { merchant: 'Northstar' })).reason, 'merchant-not-grounded');
  assert.equal(learn('Chase: pending charge USD 5.00 at SHOP on card 1234.', usd(500)).reason, 'non-completed-wording');
  assert.equal(learn('Your card 1234 was declined for USD 5.00 at SHOP.', usd(500)).reason, 'non-completed-wording');
  assert.equal(learn('KFH: purchase KWD 1.250 at SHOP card 1234.', { amountMinor: 1250, currency: 'KWD', exponent: 3, direction: 'debit' }, 'KFH').reason, 'amount-not-grounded');
  assert.equal(learn('Migros A101 272,02 TL alışveriş 03.07.2026 kart 1234', { amountMinor: 27202, currency: 'TRY', exponent: 2, direction: 'debit' }, 'GARANTI').reason, 'ambiguous-money');
  assert.equal(learn(CHASE, { ...usd(2486), exponent: 3 }).reason, 'invalid-input');
  // AE/SA launch senders and routes.
  assert.equal(L.isLearnableSender('ADCBAlert'), false);
  assert.equal(L.isLearnableSender('CHASE'), true);
  assert.equal(L.isLearnableSender(null), true);
  assert.equal(learn('ADCB: Your card 1234 was used for AED 50.00 at SHOP on 01/09/2026.', { amountMinor: 5000, currency: 'AED', exponent: 2, direction: 'debit' }, 'ADCBAlert').reason, 'launch-market');
  assert.equal(learn(CHASE, usd(2486), 'CHASE', { routedMarket: 'SA' }).reason, 'launch-market');
  assert.equal(learn(CHASE, usd(2486), 'CHASE', { launchRoute: true }).reason, 'launch-market');
  assert.equal(match(CHASE, 'CHASE', chaseStore(), { routedMarket: 'AE' }).kind, 'none');
});

/* ── advisory footer boilerplate ────────────────────────────────────── */
test('a "never share your OTP" footer in the learned boilerplate does not block matching', () => {
  const source = 'Citi: USD 18.20 spent at UBER *TRIP with card *5521. Never share your OTP or PIN with anyone.';
  const store = learnInto(L.emptyLearnedFormatStore(), source, 'CITI', usd(1820, { merchant: 'UBER *TRIP' }), { country: 'US' });
  const hit = match('Citi: USD 7.00 spent at NETFLIX.COM with card *5521. Never share your OTP or PIN with anyone.', 'CITI', store);
  assert.equal(hit.kind, 'prefill');
  assert.equal(hit.fields.merchant, 'NETFLIX.COM');
  assert.equal(match('Citi: USD 7.00 spent at NETFLIX.COM with card *5521. Your OTP is 443322. Never share your OTP or PIN with anyone.', 'CITI', store).kind, 'none');
});

/* ── other languages and shapes ─────────────────────────────────────── */
test('Arabic (Arabic-Indic digits normalised)', () => {
  const store = learnInto(L.emptyLearnedFormatStore(),
    'تم خصم 150.00 EGP من حسابك 1325 لعملية شراء من B.TECH بتاريخ 3 مارس 2026', 'CIB',
    { amountMinor: 15000, currency: 'EGP', exponent: 2, direction: 'debit', merchant: 'B.TECH', date: '2026-03-03' }, { country: 'EG' });
  const hit = match('تم خصم ١٠٣٫٤١ EGP من حسابك ٧٠٤٧ لعملية شراء من SEOUDI MARKET بتاريخ 16 سبتمبر 2026', 'CIB', store);
  assert.equal(hit.kind, 'prefill');
  assert.deepEqual([hit.fields.amountMinor, hit.fields.merchant, hit.fields.date, hit.fields.cardLast4], [10341, 'SEOUDI MARKET', '2026-09-16', '7047']);
  assert.equal(match('تم إيداع 150.00 EGP من حسابك 1325 لعملية شراء من B.TECH بتاريخ 3 مارس 2026', 'CIB', store).kind, 'none');
});

test('Spanish with a shared $ symbol resolved only through the confirmed currency', () => {
  const store = learnInto(L.emptyLearnedFormatStore(),
    'Santander: Compra aprobada por $1,417.83 en OXXO con tu tarjeta terminada en 3947 el 06/05/2026.', 'Santander',
    { amountMinor: 141783, currency: 'MXN', exponent: 2, direction: 'debit', merchant: 'OXXO', date: '2026-05-06' }, { country: 'MX' });
  const hit = match('Santander: Compra aprobada por $250.00 en LIVERPOOL INSURGENTES con tu tarjeta terminada en 1111 el 21/08/2026.', 'Santander', store);
  assert.equal(hit.kind, 'prefill');
  assert.deepEqual([hit.fields.amountMinor, hit.fields.currency, hit.fields.date], [25000, 'MXN', '2026-08-21']);
  assert.equal(match('Santander: Compra rechazada por $250.00 en LIVERPOOL con tu tarjeta terminada en 1111 el 21/08/2026.', 'Santander', store).kind, 'none');
});

test('Turkish with the local TL spelling grounded by the confirmation', () => {
  const store = learnInto(L.emptyLearnedFormatStore(),
    'Garanti BBVA: 4546 ile biten kartınızla 21.03.2026 tarihinde YEMEKSEPETI işyerinde 2.585,50 TL tutarında harcama yapılmıştır.', 'GARANTI',
    { amountMinor: 258550, currency: 'TRY', exponent: 2, direction: 'debit', merchant: 'YEMEKSEPETI', date: '2026-03-21' }, { country: 'TR' });
  const hit = match('Garanti BBVA: 9021 ile biten kartınızla 02.09.2026 tarihinde MIGROS KADIKOY işyerinde 643,65 TL tutarında harcama yapılmıştır.', 'GARANTI', store);
  assert.equal(hit.kind, 'prefill');
  assert.deepEqual([hit.fields.amountMinor, hit.fields.currency, hit.fields.merchant, hit.fields.date, hit.fields.cardLast4],
    [64365, 'TRY', 'MIGROS KADIKOY', '2026-09-02', '9021']);
  assert.equal(match('Garanti BBVA: 9021 ile biten kartınızla 02.09.2026 tarihinde MIGROS işyerinde 643,65 USD tutarında harcama yapılmıştır.', 'GARANTI', store).kind, 'none');
});

test('Hinglish with Rs. and a DLT sender prefix', () => {
  const store = learnInto(L.emptyLearnedFormatStore(),
    'Aapke card XX4949 se ZOMATO par Rs.238.20 ka kharch hua hai, 09-05-2026.', 'VM-ICICIB',
    { amountMinor: 23820, currency: 'INR', exponent: 2, direction: 'debit', merchant: 'ZOMATO', date: '2026-05-09' }, { country: 'IN' });
  const hit = match('Aapke card XX1234 se BIG BAZAAR par Rs.1,249.50 ka kharch hua hai, 21-08-2026.', 'AD-ICICIB-S', store);
  assert.equal(hit.kind, 'prefill');
  assert.deepEqual([hit.fields.amountMinor, hit.fields.merchant, hit.fields.date, hit.fields.cardLast4], [124950, 'BIG BAZAAR', '2026-08-21', '1234']);
});

test('multi-line field list', () => {
  const learned = 'Acct:XXX7980\nAmt:NGN49,500.00 DR\nDesc:POS/BOLT NG\nDate:15/03/2026\nBal:NGN152,500.00';
  const store = learnInto(L.emptyLearnedFormatStore(), learned, 'GTBank',
    { amountMinor: 4950000, currency: 'NGN', exponent: 2, direction: 'debit', merchant: 'BOLT NG', date: '2026-03-15' }, { country: 'NG' });
  const hit = match('Acct:XXX1122\nAmt:NGN 4,500.00 DR\nDesc:POS/CHICKEN REPUBLIC LEKKI\nDate:22/06/2026\nBal:NGN 3,657,000.00', 'GTBank', store);
  assert.equal(hit.kind, 'prefill');
  assert.deepEqual([hit.fields.amountMinor, hit.fields.merchant, hit.fields.date], [450000, 'CHICKEN REPUBLIC LEKKI', '2026-06-22']);
  assert.equal(match('Acct:XXX1122\nAmt:NGN 4,500.00 CR\nDesc:POS/CHICKEN REPUBLIC\nDate:22/06/2026\nBal:NGN 3,657,000.00', 'GTBank', store).kind, 'none');
  // The merchant slot never spans a line break.
  assert.equal(match('Acct:XXX1122\nAmt:NGN 4,500.00 DR\nDesc:POS/CHICKEN\nREPUBLIC\nDate:22/06/2026\nBal:NGN 3,657,000.00', 'GTBank', store).kind, 'none');
});

test('sender-less source (iOS History) uses an anchor signature key', () => {
  const learned = 'Monzo: You paid £12.40 to PRET A MANGER from your current account on 03 Sep 2026.';
  const store = learnInto(L.emptyLearnedFormatStore(), learned, null,
    { amountMinor: 1240, currency: 'GBP', exponent: 2, direction: 'debit', merchant: 'PRET A MANGER', date: '2026-09-03' }, { country: 'GB' });
  assert.match(store.templates[0].key, /^a:/);
  assert.equal(store.templates[0].sender, null);
  const hit = match('Monzo: You paid £3.10 to GREGGS PLC from your current account on 12 Sep 2026.', null, store);
  assert.equal(hit.kind, 'prefill');
  assert.deepEqual([hit.fields.amountMinor, hit.fields.merchant, hit.fields.date], [310, 'GREGGS PLC', '2026-09-12']);
  assert.equal(match('Monzo: You paid £3.10 to GREGGS PLC from your current account on 12 Sep 2026.', 'Monzo', store).kind, 'none');
  assert.equal(match('Monzo: You received £3.10 to GREGGS PLC from your current account on 12 Sep 2026.', null, store).kind, 'none');
});

/* ── Settings list: masked shape only ───────────────────────────────── */
test('settings list shows sender and a masked shape, never raw text', () => {
  const store = learnInto(L.emptyLearnedFormatStore(),
    'Barclays: You sent £40.00 to John Miller on 03/09/2026. Ref 88123.', 'Barclays',
    { amountMinor: 4000, currency: 'GBP', exponent: 2, direction: 'debit', date: '2026-09-03' }, { country: 'GB' });
  const [item] = L.listLearnedFormatsForSettings(store);
  assert.equal(item.sender, 'BARCLAYS');
  assert.equal(item.status, 'learning');
  assert.doesNotMatch(item.shape, /\d|john|miller|40/i);
  assert.match(item.shape, /\{AMOUNT\}/);
  assert.match(item.shape, /\{DATE\}/);
  const chase = L.listLearnedFormatsForSettings(chaseStore())[0].shape;
  assert.equal(chase, 'Chase: your card ending ••{CARD} was charged {AMOUNT} at {MERCHANT} on {DATE}. available balance {BALANCE}.');
  const serialized = JSON.stringify(chaseStore());
  assert.doesNotMatch(serialized, /4421|24\.86|NORTH|north|900/);
});

/* ── backup / restore ───────────────────────────────────────────────── */
test('validate round-trips, drops tampered templates, rejects malformed stores and clamps caps', () => {
  const store = chaseStore();
  assert.deepEqual(L.validateLearnedFormatStore(JSON.parse(JSON.stringify(store))), store);
  for (const bad of [null, [], {}, { version: 2, templates: [] }, { version: 1, templates: {} }, 'x']) {
    assert.equal(L.validateLearnedFormatStore(bad), null);
  }
  const tampered = JSON.parse(JSON.stringify(store));
  tampered.templates[0].direction = 'sideways';
  assert.deepEqual(L.validateLearnedFormatStore(tampered).templates, []);
  const reshaped = JSON.parse(JSON.stringify(store));
  reshaped.templates[0].tokens[0].v = 'citi';
  assert.deepEqual(L.validateLearnedFormatStore(reshaped).templates, [], 'id must match the shape');
  const withDigits = JSON.parse(JSON.stringify(store));
  withDigits.templates[0].tokens.push({ k: 'L', v: '4421' });
  assert.deepEqual(L.validateLearnedFormatStore(withDigits).templates, []);
  const duplicate = { version: 1, templates: [store.templates[0], store.templates[0]] };
  assert.equal(L.validateLearnedFormatStore(duplicate).templates.length, 1);

  // 45 distinct shapes for one sender are clamped to 40, newest first.
  let big = L.emptyLearnedFormatStore();
  const word = (i) => 'qwertyuiopasdfghjklzxcvbnm'[i % 26] + 'qwertyuiopasdfghjklzxcvbnm'[Math.floor(i / 26)];
  for (let i = 0; i < 45; i++) {
    const result = L.recordLearnedConfirmation(big, {
      source: `Chase: card ending 4421 charged USD 5.00 at SHOP extra${word(i)} tail`, sender: 'CHASE',
      confirmed: usd(500, { merchant: 'SHOP' }), now: NOW + i,
    });
    assert.equal(result.ok, true, result.reason);
    big = result.store;
  }
  assert.equal(big.templates.length, L.LEARNED_FORMATS_MAX_PER_KEY);
  const oversized = { version: 1, templates: [...big.templates, ...chaseStore().templates] };
  assert.equal(L.validateLearnedFormatStore(JSON.parse(JSON.stringify(oversized))).templates.length, 40);
});
