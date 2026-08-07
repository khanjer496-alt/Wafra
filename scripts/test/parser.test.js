const { parseSms, parseSmsBatch, bankProfileForSender } = require('./build/sms-parser');

let pass = 0, fail = 0;
/**
 * `options` is the optional third argument to parseSms — today just
 * `{ sender }`. Every call that omits it exercises the no-sender path, which
 * is the one the Worker and every pre-existing caller take.
 */
function t(name, msg, expect, options) {
  const p = parseSms(msg, undefined, options);
  const errs = [];
  if (expect === null) {
    if (p !== null) errs.push(`expected SKIP, got ${JSON.stringify({m:p.merchant,a:p.amountFils,k:p.kind,t:p.type})}`);
  } else {
    if (!p) errs.push('expected parse, got null');
    else {
      if (expect.merchant !== undefined && p.merchant !== expect.merchant) errs.push(`merchant "${p.merchant}" != "${expect.merchant}"`);
      if (expect.amountFils !== undefined && p.amountFils !== expect.amountFils) errs.push(`amount ${p.amountFils} != ${expect.amountFils}`);
      if (expect.kind !== undefined && p.kind !== expect.kind) errs.push(`kind ${p.kind} != ${expect.kind}`);
      if (expect.type !== undefined && p.type !== expect.type) errs.push(`type ${p.type} != ${expect.type}`);
      if (expect.category !== undefined && p.categoryGuess !== expect.category) errs.push(`cat ${p.categoryGuess} != ${expect.category}`);
      if (expect.date !== undefined && p.date !== expect.date) errs.push(`date ${p.date} != ${expect.date}`);
      if (expect.transfer !== undefined && p.transferHint !== expect.transfer) errs.push(`transfer ${p.transferHint} != ${expect.transfer}`);
      // Card kind and snapshot kind decide whether a figure is cash in an
      // account or headroom on a card, so they are worth asserting inline.
      if (expect.card !== undefined && JSON.stringify(p.card) !== JSON.stringify(expect.card)) errs.push(`card ${JSON.stringify(p.card)} != ${JSON.stringify(expect.card)}`);
      if (expect.snapshotKind !== undefined && p.snapshotKind !== expect.snapshotKind) errs.push(`snapshotKind ${p.snapshotKind} != ${expect.snapshotKind}`);
      if (expect.snapshotFils !== undefined && p.snapshotFils !== expect.snapshotFils) errs.push(`snapshotFils ${p.snapshotFils} != ${expect.snapshotFils}`);
      // A statement with no minimum and no due day produces no reminder, so
      // the user simply misses the payment — worth asserting inline.
      if (expect.minDueFils !== undefined && p.minDueFils !== expect.minDueFils) errs.push(`minDueFils ${p.minDueFils} != ${expect.minDueFils}`);
      if (expect.dueDay !== undefined && p.dueDay !== expect.dueDay) errs.push(`dueDay ${p.dueDay} != ${expect.dueDay}`);
      // WHICH LEG of a card settlement this is. One payment sends two SMS, and
      // importing both as money arriving on the card settles the statement
      // twice. On iOS the relay drops the body before the row is sealed, so
      // `raw` is not there to re-read — the side has to be decided here or not
      // at all, and dedupe.ts's pairing has 18 references to it.
      if (expect.side !== undefined && p.cardPaymentSide !== expect.side) errs.push(`cardPaymentSide ${p.cardPaymentSide} != ${expect.side}`);
      if (expect.reference !== undefined && p.reference !== expect.reference) errs.push(`reference ${p.reference} != ${expect.reference}`);
      if (expect.currency !== undefined && p.currency !== expect.currency) errs.push(`currency ${p.currency} != ${expect.currency}`);
      // FX PROVENANCE. The local amount is the same either way; what differs is
      // whether the bank quoted it or this file's cross-rate table guessed it,
      // and fx.ts's reference-rate backfill may only correct the guesses. Stored
      // as one indistinguishable number it either rewrites real charges or
      // leaves every estimate wrong forever.
      if (expect.originalCurrency !== undefined && p.originalCurrency !== expect.originalCurrency) errs.push(`originalCurrency ${p.originalCurrency} != ${expect.originalCurrency}`);
      if (expect.originalAmountMinor !== undefined && p.originalAmountMinor !== expect.originalAmountMinor) errs.push(`originalAmountMinor ${p.originalAmountMinor} != ${expect.originalAmountMinor}`);
      if (expect.fxSource !== undefined && p.fxSource !== expect.fxSource) errs.push(`fxSource ${p.fxSource} != ${expect.fxSource}`);
      // `other` means two opposite things — a settlement that HAS no category,
      // and a row nothing could read. heal.ts and the accuracy report both
      // branch on the difference.
      if (expect.deliberate !== undefined && Boolean(p.categoryDeliberate) !== expect.deliberate) errs.push(`categoryDeliberate ${p.categoryDeliberate} != ${expect.deliberate}`);
    }
  }
  if (errs.length) { fail++; console.log(`✗ ${name}\n    ${errs.join('\n    ')}`); }
  else { pass++; console.log(`✓ ${name}`); }
}

/** For the handful of claims that are about something other than one parse. */
function ok(name, condition, detail) {
  if (condition) { pass++; console.log(`✓ ${name}`); }
  else { fail++; console.log(`✗ ${name}\n    ${detail ?? ''}`); }
}

// ── The exact failure modes from the user's phone ──
t('merchant stops at "with"',
  'Purchase of AED 50.00 to TABBY with Credit Card ending 1234. Avl limit AED 5,000.00',
  { merchant: 'Tabby', amountFils: 5000, category: 'shopping', type: 'expense' });

t('noon minutes → groceries, stops at with',
  'AED 43.00 was debited for payment to NOON MINUTES with Card no. XX99',
  { merchant: 'Noon Minutes', amountFils: 4300, category: 'groceries' });

t('OTP messages are skipped entirely',
  'Your OTP for a purchase of AED 260.00 at AMAZON.AE is 482910. Do not share this code.',
  null);

t('balance amount is not mistaken for purchase (balance first)',
  'Avl Bal AED 14,045.84. Purchase of AED 190.53 at PLAYSTATION NETWORK on 15/07/2026',
  { merchant: 'Playstation Network', amountFils: 19053, category: 'entertainment' });

t('balance amount skipped when it comes after',
  'Purchase of AED 187.50 with Debit Card ending 1234 at CARREFOUR MALL OF EMIRATES, DUBAI on 17/07/2026. Avl balance AED 9,149.34',
  { merchant: 'Carrefour Mall Of Emirates', amountFils: 18750, date: '2026-07-17' });

// ── Regression coverage ──
t('salary credit, no fake merchant',
  'Salary of AED 18,500.00 has been credited to your account ending 5678',
  { merchant: 'Salary', type: 'income', amountFils: 1850000, category: 'salary' });

t('salik payment', 'AED 55.00 was debited from your account for payment to SALIK RECHARGE on 16/07/2026',
  { merchant: 'Salik Recharge', category: 'transport', date: '2026-07-16' });

t('bill due detected as reminder not expense',
  'Your DEWA bill of AED 450.00 is due on 25/07/2026. Please pay before the due date.',
  { kind: 'billDue', merchant: 'DEWA', amountFils: 45000, category: 'utilities', date: '2026-07-25' });

t('credit card minimum due is a bill',
  'Statement generated. Total due AED 3,240.00, minimum due AED 162.00 by 05/08/2026',
  { kind: 'billDue', amountFils: 324000 });

t('declined transaction skipped',
  'Your transaction of AED 500.00 at SHARAF DG was declined due to insufficient funds.',
  null);

t('promo message skipped',
  'Get AED 100 cashback offer when you shop now! T&C apply. https://promo.example',
  null);

t('refund is income',
  'Refund of AED 89.00 has been credited to your card from DELIVEROO',
  { type: 'income', amountFils: 8900 });

t('atm withdrawal',
  'AED 1,000.00 withdrawn from your account at ENBD ATM DEIRA on 12/07/2026. Available balance AED 3,210.38',
  { amountFils: 100000, type: 'expense' });

t('acronym kept in titlecase', 'Purchase of AED 30.00 at KFC with card ending 22',
  { merchant: 'KFC', category: 'dining' });

t('random chat message with amount is skipped',
  'Hey can you send me AED 200 for the dinner yesterday?',
  null);

t('careem ride', 'AED 34.50 was charged to your card at CAREEM on 14/07/2026',
  { merchant: 'Careem', category: 'transport' });

// ── v2: card identity, statements, payments, currency, overrides ──
const p1 = parseSms('Purchase of AED 250.00 with Credit Card ending 4821 at IKEA on 10/07/2026');
t('card identity extracted', 'Purchase of AED 250.00 with Credit Card ending 4821 at IKEA on 10/07/2026',
  { merchant: 'Ikea', kind: 'transaction' });
if (p1 && p1.card && p1.card.last4 === '4821' && p1.card.kind === 'credit') { pass++; console.log('✓ card last4 + credit kind'); }
else { fail++; console.log('✗ card last4 + credit kind', JSON.stringify(p1 && p1.card)); }

const p2 = parseSms('AED 90.00 was debited from a/c XX9012 for payment to DEWA');
if (p2 && p2.card && p2.card.last4 === '9012' && p2.card.kind === 'account') { pass++; console.log('✓ account hint extracted'); }
else { fail++; console.log('✗ account hint extracted', JSON.stringify(p2 && p2.card)); }

const stmt = parseSms('Your Credit Card ending 4821 statement is generated. Total due AED 3,240.00, minimum due AED 162.00 by 05/08/2026');
if (stmt && stmt.kind === 'cardStatement' && stmt.amountFils === 324000 && stmt.minDueFils === 16200 && stmt.date === '2026-08-05' && stmt.card.last4 === '4821') {
  pass++; console.log('✓ card statement parsed with min due + date');
} else { fail++; console.log('✗ card statement parsed', JSON.stringify(stmt)); }

const pay = parseSms('Payment of AED 3,240.00 received towards your Credit Card ending 4821. Thank you.');
if (pay && pay.kind === 'cardPayment' && pay.amountFils === 324000 && pay.card.last4 === '4821') {
  pass++; console.log('✓ card payment is a transfer, not spending');
} else { fail++; console.log('✗ card payment', JSON.stringify(pay)); }

t('multi-currency prefers AED in parens',
  'Purchase of USD 9.99 (AED 36.70) at NETFLIX with Credit Card ending 4821',
  { amountFils: 3670, merchant: 'Netflix', category: 'entertainment' });

t('foreign-only currency converts to AED at the peg',
  'Purchase of USD 49.99 at STEAM GAMES with Credit Card ending 4821',
  { amountFils: 18359 });

const ov = parseSms('Purchase of AED 55.00 at MYSTERY VENDOR with card ending 11', { 'mystery vendor': 'health' });
if (ov && ov.categoryGuess === 'health') { pass++; console.log('✓ merchant override applied'); }
else { fail++; console.log('✗ merchant override applied', JSON.stringify(ov && ov.categoryGuess)); }


// ── transfer hints: bank-side card payments are not spending ──
const bankLeg = parseSms('AED 3,240.00 was debited from your a/c XX9012 towards your Credit Card ending 4821');
if (bankLeg && bankLeg.kind === 'transaction' && bankLeg.transferHint === true) { pass++; console.log('✓ bank-side card payment flagged as transfer'); }
else { fail++; console.log('✗ bank-side card payment flagged as transfer', JSON.stringify(bankLeg && {k: bankLeg.kind, t: bankLeg.transferHint})); }

const ownTransfer = parseSms('AED 5,000.00 was debited from your account for own account transfer');
if (ownTransfer && ownTransfer.transferHint === true) { pass++; console.log('✓ own-account transfer flagged'); }
else { fail++; console.log('✗ own-account transfer flagged', JSON.stringify(ownTransfer)); }

const normalSpend = parseSms('Purchase of AED 187.50 with Debit Card ending 1234 at CARREFOUR on 17/07/2026');
if (normalSpend && normalSpend.transferHint === false) { pass++; console.log('✓ normal purchase not flagged as transfer'); }
else { fail++; console.log('✗ normal purchase not flagged as transfer'); }

// ── masked PANs and "has been paid" settlements (real-device formats) ──
const maskedPaid = parseSms('Your Credit Card 4782********4833 Has Been Paid AED 10,700.00. Thank you for banking with us.');
if (maskedPaid && maskedPaid.kind === 'cardPayment' && maskedPaid.card && maskedPaid.card.last4 === '4833' && maskedPaid.transferHint === true) {
  pass++; console.log('✓ masked-PAN "has been paid" is a card payment');
} else { fail++; console.log('✗ masked-PAN "has been paid" is a card payment', JSON.stringify(maskedPaid && { k: maskedPaid.kind, c: maskedPaid.card, m: maskedPaid.merchant })); }

const maskedPaid2 = parseSms('Payment of AED 7,663.00 has been received on your Credit Card 5492********4711.');
if (maskedPaid2 && maskedPaid2.kind === 'cardPayment' && maskedPaid2.card && maskedPaid2.card.last4 === '4711') {
  pass++; console.log('✓ masked-PAN payment-received keeps the LAST four digits');
} else { fail++; console.log('✗ masked-PAN payment-received keeps the LAST four digits', JSON.stringify(maskedPaid2 && maskedPaid2.card)); }

const maskedDebit = parseSms('AED 10,700.00 debited from your a/c XX9012 towards Credit Card 4782********4833 payment.');
if (maskedDebit && maskedDebit.transferHint === true && !/[*Xx]{2,}/.test(maskedDebit.merchant)) {
  pass++; console.log('✓ debit leg toward a masked card is a transfer, PAN never a merchant');
} else { fail++; console.log('✗ debit leg toward a masked card is a transfer, PAN never a merchant', JSON.stringify(maskedDebit && { t: maskedDebit.transferHint, m: maskedDebit.merchant })); }

// No card in the message means no card purchase — it is an account debit, and
// it must still not be mistaken for a payment INTO a card.
const unknownDebit = parseSms('AED 250.00 was debited from your account XX9012 on 12/07/2026.');
if (unknownDebit && unknownDebit.merchant === 'Account debit' && unknownDebit.transferHint === false) {
  pass++; console.log('✓ unknown-merchant account debit titled Account debit, not Card payment');
} else { fail++; console.log('✗ unknown-merchant account debit titled Account debit', JSON.stringify(unknownDebit && { m: unknownDebit.merchant, t: unknownDebit.transferHint })); }

// ── amount sanity + credit-card forcing ──
const absurd = parseSms('AED 100,181,428,624.00 was debited from your account XX9012.');
if (absurd === null) { pass++; console.log('✓ absurd amount (> AED 1M) rejected'); }
else { fail++; console.log('✗ absurd amount rejected', JSON.stringify(absurd.amountFils)); }

const bigButReal = parseSms('AED 550,000.00 was debited from your a/c XX9012 at EMAAR PROPERTIES.');
if (bigButReal && bigButReal.amountFils === 55000000) { pass++; console.log('✓ large-but-plausible amount kept'); }
else { fail++; console.log('✗ large-but-plausible amount kept', JSON.stringify(bigButReal && bigButReal.amountFils)); }

const stmtKind = parseSms('Statement generated. Total due AED 3,240.00, minimum due AED 162.00 by 05/08/2026 on your card ending 8573');
if (stmtKind && stmtKind.kind === 'cardStatement' && stmtKind.card && stmtKind.card.kind === 'credit') {
  pass++; console.log('✓ statement forces credit-card identity');
} else { fail++; console.log('✗ statement forces credit-card identity', JSON.stringify(stmtKind && stmtKind.card)); }

// ── income is never a spending category; senders extracted after "from" ──
const payout = parseSms('AED 776.00 has been credited to your account XX0004 from TALABAT MIDDLE EAST');
if (payout && payout.type === 'income' && payout.merchant === 'Talabat Middle East' && payout.categoryGuess === 'business') {
  pass++; console.log('✓ Talabat payout is business income with sender name');
} else { fail++; console.log('✗ Talabat payout is business income with sender name', JSON.stringify(payout && { m: payout.merchant, c: payout.categoryGuess, t: payout.type })); }

const salaryStill = parseSms('Salary of AED 18,500.00 has been credited to your account ending 5678');
if (salaryStill && salaryStill.categoryGuess === 'salary') { pass++; console.log('✓ salary keyword still wins for income'); }
else { fail++; console.log('✗ salary keyword still wins for income', JSON.stringify(salaryStill && salaryStill.categoryGuess)); }

const spendStill = parseSms('Purchase of AED 55.00 at TALABAT with Debit Card ending 1234');
if (spendStill && spendStill.type === 'expense' && spendStill.categoryGuess === 'dining') {
  pass++; console.log('✓ Talabat spending still categorized dining');
} else { fail++; console.log('✗ Talabat spending still categorized dining', JSON.stringify(spendStill && spendStill.categoryGuess)); }

// ── comprehensive sweep: suffix amounts, ATM, fees, deposits, categories ──
t('amount BEFORE currency parses',
  'Your account XX9012 has been debited with 1,234.56 AED at CARREFOUR MALL OF EMIRATES on 15/07/2026',
  { amountFils: 123456, merchant: 'Carrefour Mall Of Emirates', category: 'groceries' });

const sfxBal = parseSms('Your a/c XX9012 is debited with 250.00 AED. Avl bal 9,262.00 AED');
if (sfxBal && sfxBal.amountFils === 25000) { pass++; console.log('✓ suffix amount skips suffix balance'); }
else { fail++; console.log('✗ suffix amount skips suffix balance', JSON.stringify(sfxBal && sfxBal.amountFils)); }

const atm = parseSms('AED 500.00 cash withdrawal from ATM at ENBD BRANCH DEIRA. Avl Bal AED 6,123.00');
if (atm && atm.merchant === 'ATM withdrawal' && atm.type === 'expense') { pass++; console.log('✓ ATM withdrawal titled correctly'); }
else { fail++; console.log('✗ ATM withdrawal titled correctly', JSON.stringify(atm && atm.merchant)); }

const fee = parseSms('Your card ending 1234 has been charged AED 262.50 as annual fee.');
if (fee && fee.merchant === 'Bank fee') { pass++; console.log('✓ bank fee titled correctly'); }
else { fail++; console.log('✗ bank fee titled correctly', JSON.stringify(fee && fee.merchant)); }

const dep = parseSms('AED 3,000.00 deposited into your account XX0002 via CDM.');
if (dep && dep.type === 'income' && dep.merchant === 'Cash deposit') { pass++; console.log('✓ cash deposit titled correctly'); }
else { fail++; console.log('✗ cash deposit titled correctly', JSON.stringify(dep && { m: dep.merchant, t: dep.type })); }

t('Emarat fuel is transport',
  'Purchase of AED 120.00 at EMARAT 1049 with Debit Card ending 1234',
  { category: 'transport' });

t('Empower is utilities',
  'Payment of AED 890.00 to EMPOWER with Debit Card ending 1234',
  { category: 'utilities' });

const noonCom = parseSms('Purchase of AED 55.00 at NOON COM with Credit Card ending 4821');
if (noonCom && noonCom.merchant === 'Noon') { pass++; console.log('✓ NOON COM normalizes to Noon'); }
else { fail++; console.log('✗ NOON COM normalizes to Noon', JSON.stringify(noonCom && noonCom.merchant)); }

const insur = parseSms('Purchase of AED 2,400.00 at SUKOON INSURANCE with Credit Card ending 4821');
if (insur && insur.categoryGuess === 'health') { pass++; console.log('✓ insurance categorized health'); }
else { fail++; console.log('✗ insurance categorized health', JSON.stringify(insur && insur.categoryGuess)); }

// ── accounting sweep: refund income is not revenue, pre-auth holds skip, cheques named ──
const refundIncome = parseSms('Refund of AED 89.00 has been credited to your card from DELIVEROO');
if (refundIncome && refundIncome.categoryGuess === 'other') { pass++; console.log('✓ refund income filed as other, not business revenue'); }
else { fail++; console.log('✗ refund income filed as other', JSON.stringify(refundIncome && refundIncome.categoryGuess)); }

const cashback = parseSms('Cashback of AED 25.00 has been credited to your Credit Card ending 4821');
if (cashback && cashback.type === 'income' && cashback.categoryGuess === 'other') { pass++; console.log('✓ cashback income filed as other'); }
else { fail++; console.log('✗ cashback income filed as other', JSON.stringify(cashback && { t: cashback.type, c: cashback.categoryGuess })); }

t('pre-auth hold skipped',
  'A pre-auth hold of AED 500.00 has been placed on your card ending 1234 at HOTEL ATLANTIS',
  null);

const chq = parseSms('Cheque no. 000123 for 5,000.00 AED has been debited from your account XX9012');
if (chq && chq.merchant === 'Cheque' && chq.type === 'expense') { pass++; console.log('✓ cheque debit titled Cheque'); }
else { fail++; console.log('✗ cheque debit titled Cheque', JSON.stringify(chq && chq.merchant)); }

const remit = parseSms('Inward remittance of 5,000.00 AED has been credited to your account XX0002.');
if (remit && remit.type === 'income' && remit.transferHint === true && remit.merchant === 'Inward remittance') {
  pass++; console.log('✓ inward remittance is a transfer, not income');
} else { fail++; console.log('✗ inward remittance is a transfer, not income', JSON.stringify(remit && { t: remit.type, h: remit.transferHint, m: remit.merchant })); }

// ── balance/limit snapshots captured from alerts ──
const snapLimit = parseSms('Purchase of AED 250.00 with Credit Card ending 4821 at IKEA. Avl Limit AED 5,939.00');
if (snapLimit && snapLimit.snapshotKind === 'limit' && snapLimit.snapshotFils === 593900 && snapLimit.amountFils === 25000) {
  pass++; console.log('✓ available-limit snapshot captured (amount untouched)');
} else { fail++; console.log('✗ available-limit snapshot captured', JSON.stringify(snapLimit && { k: snapLimit.snapshotKind, f: snapLimit.snapshotFils, a: snapLimit.amountFils })); }

const snapBal = parseSms('Your a/c XX9012 is debited with 250.00 AED. Avl bal 9,262.00 AED');
if (snapBal && snapBal.snapshotKind === 'balance' && snapBal.snapshotFils === 926200) {
  pass++; console.log('✓ balance snapshot captured in suffix form');
} else { fail++; console.log('✗ balance snapshot captured in suffix form', JSON.stringify(snapBal && { k: snapBal.snapshotKind, f: snapBal.snapshotFils })); }

const snapOut = parseSms('Payment of AED 3,240.00 received towards your Credit Card ending 4821. Total outstanding AED 4,061.00');
if (snapOut && snapOut.snapshotKind === 'outstanding' && snapOut.snapshotFils === 406100) {
  pass++; console.log('✓ outstanding snapshot captured on card payment');
} else { fail++; console.log('✗ outstanding snapshot captured on card payment', JSON.stringify(snapOut && { k: snapOut.snapshotKind, f: snapOut.snapshotFils })); }

const snapNone = parseSms('Purchase of AED 55.00 at MYSTERY VENDOR with card ending 11');
if (snapNone && snapNone.snapshotFils === null) { pass++; console.log('✓ no snapshot when message has none'); }
else { fail++; console.log('✗ no snapshot when message has none', JSON.stringify(snapNone && snapNone.snapshotFils)); }

// ── online-service descriptor normalization ──
t('OPENAI descriptor becomes ChatGPT',
  'Purchase of AED 73.41 at OPENAI *CHATGPT SUBSCR with Credit Card ending 4821',
  { merchant: 'ChatGPT' });

t('PayPal RealDebrid descriptor becomes Real-Debrid',
  'Purchase of AED 16.50 at PAYPAL *REALDEBRID with Credit Card ending 4821',
  { merchant: 'Real-Debrid' });

t('Anthropic descriptor becomes Claude',
  'Purchase of AED 73.41 at ANTHROPIC CLAUDE.AI with Credit Card ending 4821',
  { merchant: 'Claude' });

t('Apple billing descriptor becomes Apple',
  'Purchase of AED 19.99 at APPLE.COM/BILL ITUNES with Credit Card ending 4821',
  { merchant: 'Apple' });

// ── word-bounded service matching: CANVAS* stores must never group under Canva ──
t('Canva descriptor still normalizes',
  'Purchase of AED 36.70 at CANVA* PRO SUBSCRIPTION with Credit Card ending 4821',
  { merchant: 'Canva' });

const canvasShop = parseSms('Purchase of AED 365.78 at CANVAS TRADING LLC with Credit Card ending 4821');
if (canvasShop && canvasShop.merchant !== 'Canva') {
  pass++; console.log('✓ CANVAS merchant does not become Canva');
} else {
  fail++; console.log('✗ CANVAS merchant does not become Canva', JSON.stringify(canvasShop && canvasShop.merchant));
}

// ── multi-line FAB-style format: header kind, own-line merchant, Avl Bal on credit = limit ──
const FAB_ALLDEBRID =
  'Credit Card Purchase\nCard No XXXX4711\nEUR 2.99\nALLDEBRID.COM MONTROUGE FRA\n' +
  '03/07/26 05:53\nAvl Bal AED 9705.65\nJuly statement due on 27/07/2026';
const ad = parseSms(FAB_ALLDEBRID);
{
  const errs = [];
  if (!ad) errs.push('did not parse');
  else {
    if (ad.kind !== 'transaction') errs.push(`kind ${ad.kind} != transaction (statement-due footer misfired)`);
    if (ad.merchant !== 'AllDebrid') errs.push(`merchant "${ad.merchant}" != AllDebrid`);
    if (!ad.card || ad.card.last4 !== '4711' || ad.card.kind !== 'credit')
      errs.push(`card ${JSON.stringify(ad.card)} != credit 4711`);
    if (ad.snapshotKind !== 'limit') errs.push(`snapshotKind ${ad.snapshotKind} != limit (Avl Bal on credit is headroom)`);
    if (ad.snapshotFils !== 970565) errs.push(`snapshotFils ${ad.snapshotFils} != 970565`);
    if (ad.amountFils !== 1292) errs.push(`amount ${ad.amountFils} != 1292 (EUR 2.99 converted)`);
    if (ad.date !== '2026-07-03') errs.push(`date ${ad.date} != 2026-07-03 (txn datetime beats due footer)`);
  }
  if (errs.length) { fail++; console.log(`✗ multi-line credit purchase (AllDebrid)\n    ${errs.join('\n    ')}`); }
  else { pass++; console.log('✓ multi-line credit purchase (AllDebrid)'); }
}

t('multi-line local-currency purchase names the merchant line',
  'Credit Card Purchase\nCard No XXXX4711\nAED 16.00\nMawgif DUBAI ARE\n03/07/26 15:51\nAvl Bal AED 9693.97\nJuly statement due on 27/07/2026',
  { merchant: 'Mawgif', amountFils: 1600, category: 'transport', date: '2026-07-03' });

// ── grammar shapes that are not tied to any one bank ──
//
// These used to be labelled "ENBD style", "Liv style", "Mashreq style",
// "DIB style" — invented bodies with a bank name attached to them. The bank
// names were the invented part: not one of the 26 real messages in
// scripts/test/fixtures/uae-accuracy-report.txt names its own bank except
// HSBC. What each of these actually pins is a GRAMMAR SHAPE, so that is what
// they are called now. Per-bank coverage lives in the BANK COVERAGE section at
// the bottom of this file, where each bank's real formats are asserted against
// its own sender ID.
t('"Avl Cr. Limit" is a limit snapshot, and the merchant stops at the comma',
  'Purchase of AED 89.50 with Credit Card ending 4844 at CARREFOUR, DUBAI. Avl Cr. Limit AED 14,671.30',
  { merchant: 'Carrefour', amountFils: 8950, category: 'groceries' });

t('"You spent ... on your debit card" parses',
  'You spent AED 45.00 on your debit card 1354 at STARBUCKS DIFC on 20/07/2026',
  { merchant: 'Starbucks Difc', amountFils: 4500, category: 'dining', date: '2026-07-20' });

t('"debited from your account ... towards" names the payee',
  'AED 250.00 has been debited from your account XX1234 towards DU MONTHLY BILL on 18/07/2026',
  { amountFils: 25000, category: 'telecom' });

t('"was used for ... Available Balance" suffix format',
  'Your Debit Card XXX4833 was used for AED 132.75 at LULU HYPERMARKET AL BARSHA on 19/07/2026. Available Balance AED 6,292.43',
  { merchant: 'Lulu Hypermarket Al Barsha', amountFils: 13275, category: 'groceries' });

t('the Dhs currency alias parses like AED',
  'Dhs 320.00 debited from your account for payment to SEWA on 16/07/2026',
  { merchant: 'SEWA', amountFils: 32000, category: 'utilities' });

// ── FAB account credit: "Your balance is" quotes the balance with no Avl prefix ──
const fabCredit = parseSms(
  'An amount of AED 5000.00 has been credited to your FAB account XXXX0004 on 26/06/2026 .Your balance is AED 401913.68');
{
  const errs = [];
  if (!fabCredit) errs.push('did not parse');
  else {
    if (fabCredit.type !== 'income') errs.push(`type ${fabCredit.type} != income`);
    if (fabCredit.amountFils !== 500000) errs.push(`amount ${fabCredit.amountFils} != 500000 (balance mistaken for amount)`);
    if (fabCredit.snapshotKind !== 'balance') errs.push(`snapshotKind ${fabCredit.snapshotKind} != balance`);
    if (fabCredit.snapshotFils !== 40191368) errs.push(`snapshotFils ${fabCredit.snapshotFils} != 40191368`);
    if (!fabCredit.card || fabCredit.card.last4 !== '0004') errs.push(`card ${JSON.stringify(fabCredit.card)} != ..0004`);
    if (fabCredit.date !== '2026-06-26') errs.push(`date ${fabCredit.date} != 2026-06-26`);
  }
  if (errs.length) { fail++; console.log(`✗ FAB "Your balance is" account credit\n    ${errs.join('\n    ')}`); }
  else { pass++; console.log('✓ FAB "Your balance is" account credit'); }
}

t('bare "daily limit" mention is NOT a snapshot source of truth',
  'Purchase of AED 200.00 at CARREFOUR with Debit Card ending 1234. Daily limit AED 5,000 applies',
  { amountFils: 20000 });

const dailyLimit = parseSms(
  'Purchase of AED 200.00 at CARREFOUR with Debit Card ending 1234. Daily limit AED 5,000 applies');
if (dailyLimit && dailyLimit.snapshotKind === null) {
  pass++; console.log('✓ daily-limit mention captures no snapshot');
} else {
  fail++; console.log('✗ daily-limit mention captures no snapshot',
    JSON.stringify(dailyLimit && { k: dailyLimit.snapshotKind, f: dailyLimit.snapshotFils }));
}

// ── real-device corpus (user-shared formats, July 2026) ──
t('parking confirmation is a transport expense, not "Paid Upto..."',
  'Confirmation\nPlateNo-1239301\nPlateSource-Dubai\nTicketNo-4479126\nFee-AED2.38\nVAT-AED0.019\nPaid upto 09/07/26 09:08PM',
  { merchant: 'Parking', amountFils: 238, category: 'transport', date: '2026-07-09' });

t('older-style zone parking also parses',
  'Confirmation\nPlate-DXB S 41279\nTicket-870527 Valid only in Zone-393K\nFee-AED4\nTnxFee-AED 0.30\nPaid upto 17/07/19 01:50 PM\nMax.allowed time in Zone 393K-24Hrs',
  { merchant: 'Parking', amountFils: 400, category: 'transport' });

t('VAT micro-debit is a VAT fee, not a card purchase',
  'AED 0.05 has been debited from your account no. 095-XXX11XXX-01 Value Added Tax(VAT) @5%:O12348070. The available balance is AED 1,320.34.',
  { merchant: 'VAT fee', amountFils: 5 });

const payInstr = parseSms(
  'Dear Customer, Your payment instructions of AED 7,663.94 to 5492********4711 has been processed on 10/07/2026 01:19');
if (payInstr && payInstr.merchant === 'Card •4711 payment' && payInstr.transferHint === true &&
    payInstr.amountFils === 766394 && payInstr.card && payInstr.card.kind === 'credit') {
  pass++; console.log('✓ payment instructions to masked PAN is a card-payment transfer');
} else {
  fail++; console.log('✗ payment instructions to masked PAN is a card-payment transfer',
    JSON.stringify(payInstr && { m: payInstr.merchant, t: payInstr.transferHint, a: payInstr.amountFils }));
}

t('payment instructions to a named biller keeps the biller name',
  'Dear Customer, Your payment instructions of AED 313.95 to homeinet for consumer number 5554026 has been processed on 13/07/2026 22:01',
  { merchant: 'Homeinet', amountFils: 31395 });

const towardsCard = parseSms(
  'AED 1,027.60 has been deducted from your account 095XXX11XXX01 towards payment of your Credit Card ending 4722.');
if (towardsCard && towardsCard.transferHint === true) {
  pass++; console.log('✓ "towards payment of your Credit Card" is a transfer');
} else {
  fail++; console.log('✗ "towards payment of your Credit Card" is a transfer',
    JSON.stringify(towardsCard && { m: towardsCard.merchant, t: towardsCard.transferHint }));
}

const fabDue = parseSms(
  'Dear Customer, the payment due date of your FAB Credit Card ending with 4833 is 06-07-2026. The total amount due is AED 8,144.40 and the Minimum due amount is AED 407.22. Please ignore the message, if already paid.');
if (fabDue && fabDue.kind === 'cardStatement' && fabDue.amountFils === 814440 &&
    fabDue.minDueFils === 40722 && fabDue.date === '2026-07-06') {
  pass++; console.log('✓ FAB due-date reminder is a card statement, not a fake expense');
} else {
  fail++; console.log('✗ FAB due-date reminder is a card statement, not a fake expense',
    JSON.stringify(fabDue && { k: fabDue.kind, a: fabDue.amountFils, min: fabDue.minDueFils, d: fabDue.date }));
}

const tt = parseSms(
  'From HSBC: 20MAR25 TT Payment to 041-339***-001 AED 1,108.00+ Your available balance is AED 946.48');
if (tt && tt.merchant === 'Bank transfer' && tt.transferHint === true && tt.type === 'income' && tt.amountFils === 110800) {
  pass++; console.log('✓ HSBC TT payment is a bank transfer, not a garbage-titled expense');
} else {
  fail++; console.log('✗ HSBC TT payment is a bank transfer',
    JSON.stringify(tt && { m: tt.merchant, t: tt.transferHint, ty: tt.type, a: tt.amountFils }));
}

t('HSBC DDR debit names the receiving bank',
  'From HSBC: Account 41 -339***-1 was debited for AED 1108.00 on 4560902 for DUBAI ISLAMIC BANK PJSC . Please safe keep this unique DDR Reference No. 8883070.',
  { merchant: 'Dubai Islamic Bank', amountFils: 110800 });

t('DD instalment names the bank it was sent to',
  'Dear Customer, your DD instalment of AED 2,476.89 has been debited from your FAB Account and has been sent to Dubai Islamic Bank as per your UAE Direct Debit Service Instructions. Terms and conditions apply.',
  { merchant: 'Dubai Islamic Bank', amountFils: 247689 });

t('ADCB Salik debit names Salik via the for-clause',
  'AED300.00 debited from Acc/Cr.Card XXX7720 for Salik on 11-02-2025 09:03:37 through ADCB Mobile App.Avl.Limit is AED 2508.31',
  { merchant: 'Salik', amountFils: 30000, category: 'transport' });

t('YAP cash withdrawal is an ATM withdrawal',
  "You've withdrawn AED 200.00 from YAP card ending with 3397 at DIB SHROUQ PLAZA AJMAN/AJMAN.",
  { merchant: 'ATM withdrawal', amountFils: 20000 });

t('instant transfer is titled Outgoing transfer',
  'Dear Customer, AED 1,176.00 has been debited from your account 095XXX11XXX01 towards instant transfer. The available balance is AED 17,795.55.',
  { merchant: 'Outgoing transfer', amountFils: 117600 });

t('FAB multi-line Keeta purchase ignores the instalment promo footer',
  'Credit Card Purchase \nCard No XXXX4711 \nAED 76.50 \nTAP*Keeta Dubai ARE \n15/12/25 22:34 \nAvailable Balance AED 7875.65\nYour December statement payment due date is 26/12/2025\n0% instalments up to 12 months, NO fees on international purchases. bit.ly/4nR8uHP Conditions apply.',
  { merchant: 'Keeta', amountFils: 7650, category: 'dining', date: '2025-12-15' });

t('telecom roaming rate card is not a transaction',
  'Haven’t purchased any roaming minutes?\nYou can use your wallet credit for pay as you go calls as per the below rates:\nMake local calls for 5 AED/Minute.\nCall UAE or GCC countries for 9 AED/Minute.',
  null);

t('biller AutoPay receipt is skipped (bank side already counted)',
  'Dear Valued Customer, Payment of AED 351.35 on 15/04/2019 has been received and posted to your account no 5552906 Thank you for using AutoPay service.',
  null);

// CHANGED from `category: 'entertainment'`. What this test is FOR is unchanged
// and still asserted: a Google-billed descriptor must resolve to the shop that
// was bought from, not to the acquirer. The category moved because ChatGPT now
// has a category of its own — the vocabulary rule it used to hit carried a
// comment admitting `entertainment` was a placeholder for the whole developer
// and AI tooling family.
t('ChatGPT via Google descriptor categorizes as software',
  'Purchase of AED 76.99 with Debit Card ending 4733 at Google ChatGPT, 650-5550000. Avl Balance is AED 11,102.89.  Pls refer stmt for exact amt.',
  { merchant: 'ChatGPT', category: 'software' });

t('grab.com purchase names Grab and categorizes transport',
  'Purchase of AED 16.92 with Debit Card ending 4744 at WWW.GRAB.COM, BANGKOK. Avl Balance is AED 26,306.05.  Pls refer stmt for exact amt.',
  { merchant: 'Grab', category: 'transport' });

t('foodstuff trader categorizes as groceries',
  'Purchase of AED 244.00 with Credit Card ending 4722 at TOROUS FOODSTUFF LLC, SHARJAH. Avl Cr. Limit is AED 14,280.35',
  { category: 'groceries' });

t('local market categorizes as groceries',
  'Purchase of AED 258.10 with Credit Card ending 4722 at AFAMIA MARKET, SHARJAH. Avl Cr. Limit is AED 14,664.12',
  { category: 'groceries' });

t('padel court categorizes as health',
  'Purchase of AED 93.00 with Debit Card ending 4744 at OLE PADEL FOR SPORTS P, AJMAN. Avl Balance is AED 25,692.53.',
  { category: 'health' });

t('vending machine categorizes as groceries',
  'Purchase of AED 2.00 with Debit Card ending 4744 at THE BLUE BOX VENDING 4, DUBAI. Avl Balance is AED 25,536.40.',
  { category: 'groceries' });

t('Liv ATM with empty location still an ATM withdrawal',
  'Cash Withdrawal of AED 5,000.00 with Debit Card ending 4744 at , SHARJAH. Avl Bal is AED 3,422.29.Most Liv. users enjoy going cashless and pay with their debit card.',
  { merchant: 'ATM withdrawal', amountFils: 500000 });

// ── round-2 corpus (user-shared formats) ──
const ttIssue = parseSms(
  'AED 3,500.00 has been deducted from your account  095-XXX11XXX-01 for issuance of Telegraphic Transfer.');
if (ttIssue && ttIssue.merchant === 'Telegraphic transfer' && ttIssue.transferHint === true && ttIssue.amountFils === 350000) {
  pass++; console.log('✓ telegraphic transfer issuance is a transfer');
} else {
  fail++; console.log('✗ telegraphic transfer issuance is a transfer',
    JSON.stringify(ttIssue && { m: ttIssue.merchant, t: ttIssue.transferHint, a: ttIssue.amountFils }));
}

const outward = parseSms(
  'Outward Remittance \nDebit \nAccount XXXX0002 \nAED 7000.00\nValue Date 06/05/25  \nAvailable Balance AED 4877.51');
if (outward && outward.merchant === 'Outward remittance' && outward.transferHint === true && outward.amountFils === 700000) {
  pass++; console.log('✓ outward remittance multi-line is a transfer, not "Value Date"');
} else {
  fail++; console.log('✗ outward remittance multi-line is a transfer',
    JSON.stringify(outward && { m: outward.merchant, t: outward.transferHint, a: outward.amountFils }));
}

const adcbDue = parseSms(
  'Min payment of AED100.00 on your Cr.Card XXX7720 is due by Jul 19 2026. Total billed amt is AED1174.49. Pls ignore this message if already paid.');
if (adcbDue && adcbDue.kind === 'cardStatement' && adcbDue.amountFils === 117449 &&
    adcbDue.minDueFils === 10000 && adcbDue.date === '2026-07-19') {
  pass++; console.log('✓ ADCB min-payment reminder is a statement with month-name date');
} else {
  fail++; console.log('✗ ADCB min-payment reminder is a statement',
    JSON.stringify(adcbDue && { k: adcbDue.kind, a: adcbDue.amountFils, min: adcbDue.minDueFils, d: adcbDue.date }));
}

const payAgainst = parseSms(
  'Your payment of AED 3506.37 against Credit Card no. XXX7720 was received at 07:06 PM on 11/12/2025. Thank you.');
if (payAgainst && payAgainst.kind === 'cardPayment' && payAgainst.amountFils === 350637) {
  pass++; console.log('✓ "payment against Credit Card was received" is a card payment');
} else {
  fail++; console.log('✗ "payment against Credit Card was received" is a card payment',
    JSON.stringify(payAgainst && { k: payAgainst.kind, a: payAgainst.amountFils }));
}

t('tabby charge-tomorrow preview is skipped (real charge arrives separately)',
  'Your Noon order for AED 49.75 is due tomorrow and will be charged to your default card. Pay it now at https://s.tabby.ai/s3b4DC',
  null);

t('instalment conversion offer is skipped',
  '*Convert now* Pay as low as AED 226.8 per month for the purchase of AED 7379.54 at AL AIN AHLIA INS CO with credit card ending 9190 via clicking https://www.emiratesnbd.com/en/ipp/?ipp=5551144',
  null);

// SECOND USER'S CORPUS. Emirates Islamic sends the same conversion offer as
// the ENBD one above, and never writes "convert now" or "easy payment plan" in
// it — so the whole rule missed, and the row it produced took the INSTALMENT
// quote, not even the purchase it was pitching against: a AED 74.87 expense
// against a AED 2,246.14 purchase that is already on the ledger from its own
// alert. Nothing here was charged.
t('a monthly instalment quote with no product name is still an offer',
  'Pay as low as AED 74.87 per month for the purchase of AED 2246.14 at www.shein.com with credit card ending 4411 via clicking https://www.emiratesislamic.ae/eng/epp/?ref=00000',
  null);
// CONTROL, and the reason "purchase of AED" can never be the marker: the same
// phrase is the commonest posting clause in the corpus.
t('"purchase of AED" on its own is still a purchase',
  'Purchase of AED 2,246.14 with Credit Card ending 4411 at www.shein.com,Dubai-AE. Avl Balance is AED 3,000.00.',
  { merchant: 'Shein', amountFils: 224614 });
// CONTROL: banks staple the EPP pitch UNDER a real purchase alert. The
// settled tense in the alert has to keep the purchase.
t('an instalment pitch stapled to a settled purchase keeps the purchase',
  'AED 2,246.14 has been debited from your Credit Card 4411 at SHEIN. Avl Bal AED 3,000.00. Pay as low as AED 74.87 per month via https://www.emiratesislamic.ae/eng/epp/?ref=00000',
  { amountFils: 224614 });

// AN OVERLIMIT FEE THAT "WILL APPLY" HAS NOT BEEN CHARGED. Six copies of this
// warning booked AED 288.75 each — AED 1,732.50 of spending that never
// happened — because "will apply" is the one forecast written without "be",
// and because the "20% available limit" in the first sentence was being read
// as a settled balance figure. It is a proportion, not an amount.
t('an overlimit fee that will apply has not been charged',
  'Your Credit Card XXX0000 has less than 20% available limit for further usage. An overlimit fee of AED288.75 will apply for usage exceeding credit limit.',
  null);
// CONTROL: the same fee, actually charged, is a real expense.
t('an overlimit fee that HAS been charged is a real expense',
  'An overlimit fee of AED 288.75 has been charged to your Credit Card XXX0000. Avl Bal AED 1,200.00.',
  { amountFils: 28875 });
// CONTROL: a quoted available balance is still settlement evidence — the
// percentage lookbehind must not have taken that away.
t('a quoted available balance still proves the money moved',
  'AED 89.50 spent at CARREFOUR with Credit Card XXX0000. Available balance AED 5,376.00. An overlimit fee of AED 288.75 will apply on further usage.',
  { amountFils: 8950, merchant: 'Carrefour' });

t('overdue nag is skipped',
  'Dear Customer AED 205.84 for A/C no XXXXXX7720 is overdue. Please pay immediately to avoid blockage on credit facility. Kindly ignore if paid.',
  null);

t('SEWA payment receipt is skipped (bank side already counted)',
  'Thank You! We have received AED 1480.90 for account(s) 5557118 on 21-04-23. Rate our service https://ratesewa.tiny.us/2yt9x7aw .Get your payment receipt here https://sewapayment.tiny.us/ycxdp5rv',
  null);

t('e& money cashback promo is skipped despite the word purchase',
  "Get AED 15 Cashback!\n\nComplete your first purchase using your e& money card with AED 300 or more and get AED 15 cashback! Hurry, it's for a limited time \n\nhttps://bit.ly/eandmoneycrd\nT&Cs apply https://bit.ly/4caSsE2\n\nTo OPTOUT, SMS B AD-e& money to 7726",
  null);

t('real-estate ad with payment plan is skipped',
  'New Launch! Masaar 3 by Arada\nLuxury Villas & Townhouse \n2,3,4 & 5 Beds \nStarts from AED 1.79 MN\n60/40 Payment Plan\nCall Us Now\n5553243\nwa.link/eqm3uu',
  null);

t('refund is income, not another expense',
  'Purchase amount of AED 3.78 at PAYPAL on your Debit Card has been refunded to your card account. Avl Bal is AED 3,998.93.',
  { type: 'income', amountFils: 378 });

t('HSBC embedded merchant before "Purchase from" is extracted',
  'From HSBC: 02MAR23 DX BLENDS CAFE Purchase from 041-339***-001 AED 20.00- by Card Ending with 3081. Your available balance is AED 12,877.32',
  { merchant: 'Dx Blends Cafe', amountFils: 2000, category: 'dining' });

t('merchant with slash parses fully (McDonalds drive-thru)',
  'Purchase of AED 11.00 with Debit Card ending 4744 at MCDONALDS-ITTIHAD D/T, SHARJAH. Avl Balance is AED 5,893.56.',
  { merchant: 'Mcdonalds-ittihad D/t', category: 'dining' });

t('parenthetical descriptor drops (noon Food)',
  'Purchase of AED 46.80 with Debit Card ending 4744 at noon Food(Noon ECommerce), 5558888. Avl Balance is AED 5,304.17.',
  { merchant: 'Noon Food', category: 'dining' });

t('SEWA bill notice is a due reminder, not an expense',
  'Dear Customer, Bill amount for your account 5557118 is AED 785.4, billed on 07-Jan-22.Please pay by 22-Jan-22. Click here to view bill  https://sewapayment.tiny.us/359aezc3',
  { kind: 'billDue' });

// The reported shape, verbatim apart from the account identifiers. Twelve of
// these landed in one user's ledger as AED 775.81 expenses each — AED 9,309 of
// spending that never happened — because "if you have already paid" made
// hasDebit true and isBillDue requires !hasDebit.
t('e& due-date notice is a reminder, not a charge',
  'Dear Customer, The due date for your e& bill is nearing. A total amount of AED 775.81 including VAT is due for FISH BASKET REST. with the Party-ID 3014835 on 15-08-2026 . To pay your bill, please visit businessonline.etisalat.ae/quickpay. Kindly disregard this message if you have already paid. Thank you.',
  { kind: 'billDue', merchant: 'E&', amountFils: 77581, date: '2026-08-15', dueDay: 15, category: 'telecom' });

// The article at the front of that sentence used to win the merchant: the
// capture ran from "the" all the way to "e&" and titled the row
// "Due Date For Your E&".
t('a bill reminder is titled by the biller, not by the sentence it opens',
  'Dear Customer, The due date for your DEWA bill is nearing. AED 450.00 is due on 25/08/2026.',
  { kind: 'billDue', merchant: 'DEWA' });

// POSTPAID contains PAID. Unanchored, that noun alone turned the commonest
// telecom reminder in the UAE into a posted expense.
t('a postpaid bill reminder is not a payment',
  'Your Etisalat postpaid bill of AED 210.00 is due on 03/09/2026.',
  { kind: 'billDue', amountFils: 21000, date: '2026-09-03' });

// The other half of the guard: the same biller actually debiting the account
// still has to post. Suppression must never beat evidence.
t('an e& bill actually debited still posts',
  'AED 775.81 has been debited from your account XXXX0002 for your e& bill payment on 15/08/2026.',
  { kind: 'transaction', type: 'expense', merchant: 'E&', amountFils: 77581 });

// Grubtech sells a POS/order-management system TO restaurants. Nobody has
// ever eaten at one — it is a monthly software bill for the operator, and 55
// charges of AED 1,295.63 sat in a user's dining budget.
t('Grubtech is the POS vendor, not a restaurant',
  'Purchase of AED 1,295.63 with Debit Card ending 1354 at GRUBTECH, DUBAI. Avl Balance is AED 100.00.',
  { merchant: 'Grubtech', category: 'software' });

// ...and the food-adjacent B2B names beside it read the same way.
t('Foodics is restaurant software',
  'Purchase of AED 420.00 with Credit Card ending 3749 at FOODICS, DUBAI.',
  { category: 'software' });

// The consumer-facing rail it used to sit next to must still be Dining: qlub
// appends itself to the VENUE name on a real restaurant bill.
t('qlub is still a restaurant bill',
  'Purchase of AED 210.00 with Credit Card ending 3749 at Kokoro qlub, sharjah.',
  { category: 'dining' });

// The bank's own channel code in front of the payee. Reported from an ADCB
// card that sent NO SMS for either charge — the only record was an app
// notification, and the descriptor there is verbatim what the transaction
// detail screen shows. MERCHANT_RE has no colon in its class and must not gain
// one ("Authorisation code:", "Amount:" are all in this corpus), so the match
// failed outright and both charges arrived titled "Card purchase" — a title no
// bill reminder can ever reconcile against.
t('a bank channel code in front of the payee is not the payee',
  'Your ADCB Credit Card XXX2518 has been used for AED 450.45 at MB BILL DR:ETISALAT TELEP DUBAI on 04/08/2026.',
  { merchant: 'Etisalat Telep', amountFils: 45045, category: 'telecom', type: 'expense' });

t('...and the same shape on the other Etisalat line',
  'Your ADCB Credit Card XXX2518 has been used for AED 313.95 at MB BILL DR:ETISALAT GSM DUBAI on 04/08/2026.',
  { merchant: 'Etisalat Gsm', amountFils: 31395, category: 'telecom' });

// The emirate is peeled by cleanDescriptor like any other descriptor tail, so
// a one-word payee survives the whole path.
t('a channel-code bill keeps a short payee whole',
  'Your ADCB Credit Card XXX2518 has been used for AED 620.00 at MB BILL DR:DEWA DUBAI on 04/08/2026.',
  { merchant: 'DEWA', amountFils: 62000, category: 'utilities' });

// A colon that ends a LABEL is still not a merchant. This is the reason the
// rule is anchored on the channel shape rather than on the colon.
t('a labelled figure is not read as a channel bill',
  'Purchase of AED 88.00 with Debit Card ending 1354 at SPINNEYS, DUBAI. Authorisation code: 123456',
  { merchant: 'Spinneys', amountFils: 8800 });

t('supermarket truncation SUPE categorizes as groceries',
  'Purchase of AED 120.24 with Credit Card ending 4722 at ABDULLA AND NASIR SUPE, SHARJAH. Avl Cr. Limit is AED 14,808.82',
  { category: 'groceries' });

t('restaurant suffix categorizes as dining',
  'Purchase of AED 35.00 with Debit Card ending 4733 at BUKHARI AL KHALEEJ RES, Sharjah. Avl Balance is AED 16,574.99.',
  { category: 'dining' });

t('insurance truncation categorizes as health',
  'Purchase of AED 866.25 with Debit Card ending 4733 at DUBAI NATIONAL INSURAN, DUBAI. Avl Balance is AED 9,700.15.',
  { category: 'health' });

t('colon-style parking confirmation also parses as Parking',
  'Confirmation\nPlate: DXB 5559301-DD\nZone: Sharjah\nTicketNo: 5556576\nPaid: 2 AED\nValid Up To: 12-04-26 20:07 PM',
  { merchant: 'Parking', amountFils: 200, category: 'transport' });

t('Smart Dubai fee categorizes as government',
  'Purchase of AED 30.00 with Debit Card ending 4744 at Smart Dubai Government, Dubai. Avl Balance is AED 4,917.80.',
  { merchant: 'Smart Dubai Government', category: 'government' });

t('Ministry of Interior categorizes as government',
  'Credit Card Purchase \nCard No XXXX9960 \nAED 353.00 \nMinistry of Interior AUH ARE \n20/02/25 20:37 \nAvailable Balance AED 2535.22 Your February statement payment due date is 26/02/2025',
  { category: 'government' });

t('hotel resort categorizes as travel',
  'Credit Card Purchase \nCard No XXXX4711 \nAED 300.00 \nTHE OBEROI BEACH RESOR AJMAN ARE \n22/04/25 14:09 \nAvailable Balance AED 3142.40\nYour April statement payment due date is 26/04/2025',
  { category: 'travel' });

const enbdSnap = parseSms(
  'Purchase of AED 89.50 with Credit Card ending 4844 at CARREFOUR, DUBAI. Avl Cr. Limit AED 14,671.30');
if (enbdSnap && enbdSnap.snapshotKind === 'limit' && enbdSnap.snapshotFils === 1467130) {
  pass++; console.log('✓ ENBD Avl Cr. Limit captured as limit snapshot');
} else {
  fail++; console.log('✗ ENBD Avl Cr. Limit captured as limit snapshot',
    JSON.stringify(enbdSnap && { k: enbdSnap.snapshotKind, f: enbdSnap.snapshotFils }));
}

// ── foreign-currency fallback conversion ──
t('USD-only subscription charge converts at the peg',
  'Your Credit Card ending 4833 was used for USD 20.00 at OPENAI *CHATGPT',
  { merchant: 'ChatGPT', amountFils: 7345 });

t('AED figure always beats foreign conversion',
  'Purchase of USD 9.99 (AED 36.70) at NETFLIX.COM with Credit Card ending 1234',
  { amountFils: 3670 });

t('suffix-form foreign amount converts too',
  'Debited 5.00 USD at PAYPAL *REALDEBRID using Credit Card ending 4821',
  { merchant: 'Real-Debrid', amountFils: 1836 });

// ── carrier-billed store purchases are never utility-bill reminders ──
t('App Store / Google Play "bill" message is not a bill due',
  'Your App Store & Google Play bill of AED 7,551.00 is due on 28/07/2026',
  null);

// ── known service anywhere in the message names the row ──
t('service name found without an at/to/from clause',
  'USD 20.00 charged on Credit Card ending 4833 - OPENAI CHATGPT SUBSCRIPTION',
  { merchant: 'ChatGPT', amountFils: 7345 });

// ── real-world descriptor categorization (the "everything is Other" fix) ──
t('unbranded supermarket classifies as groceries',
  'Purchase of AED 84.20 at AL MADINA SUPERMARKET with Debit Card ending 1234',
  { category: 'groceries' });

t('pharmacy chain classifies as health',
  'Purchase of AED 36.00 at LIFE PHARMACY BR 44 with Credit Card ending 1234',
  { category: 'health' });

t('abbreviated restaurant descriptor classifies as dining',
  'Purchase of AED 27.50 at IKON REST CAFETERIA with Debit Card ending 1234',
  { category: 'dining' });

t('ride app classifies as transport',
  'Purchase of AED 18.00 at YANGO RIDES DUBAI with Debit Card ending 1234',
  { category: 'transport' });

// A haircut is a service, not retail. This asserted `shopping` because the
// shopping rule listed `salon|barber|spa|beauty|laundry` and ran first — the
// parenthesis in the old name was already admitting the answer was wrong. Those
// words now live on the personal-care and home-services rules above shopping,
// so a limit on Shopping no longer moves because someone had their hair cut.
t('salon classifies as personal care, not retail',
  'Purchase of AED 120.00 at SUGAR LOUNGE SALON with Credit Card ending 1234',
  { category: 'personal-care' });

t('a laundry pickup is a home service, not retail',
  'Purchase of AED 65.00 at WASHMEN LAUNDRY with Debit Card ending 1234',
  { category: 'home-services' });

t('gym membership classifies as health',
  'Purchase of AED 350.00 at GYMNATION FITNESS with Credit Card ending 1234',
  { category: 'health' });

t('hotel stay classifies as travel',
  'Purchase of AED 640.00 at ROTANA HOTEL DUBAI with Credit Card ending 1234',
  { category: 'travel' });

t('generic trading shop classifies as shopping',
  'Purchase of AED 95.00 at AL NOOR GENERAL TRADING with Debit Card ending 1234',
  { category: 'shopping' });

// ── Structural families from the user's real corpus ──
// Bank bill-pay. The payee is a nickname the user registered, so the FORMAT
// is what gets recognised, never the name.
t('bill-pay payee becomes the title, not a generic fallback',
  'Dear Customer, Your payment instructions of AED 313.95 to homeinet for consumer number 1234026 has been processed on 13/07/2026 22:01',
  { merchant: 'Homeinet', category: 'utilities', type: 'expense' });

t('bill-pay to an unguessable nickname still lands in a sane bucket',
  'Dear Customer, Your payment instructions of AED 7416.0 to Villabill for consumer number 1234036 has been processed on 04/05/2026 01:15',
  { merchant: 'Villabill', category: 'utilities' });

t('a named biller keeps its own category over the bill-pay default',
  'Dear Customer, Your payment instructions of AED 417.9 to Du for consumer number 1238865 has been processed on 21/10/2022 17:03',
  { merchant: 'Du', category: 'telecom' });

t('utility direct debit names the biller instead of "Card purchase"',
  'AED 1,938.41 has been debited from your account no. 095-XXX11XXX-01 SEWA NO.-8765. The available balance is AED 7,587.88.',
  { merchant: 'SEWA', category: 'utilities', type: 'expense' });

t('etisalat direct debit reads as telecom',
  'AED 681.45 has been debited from your account no. 095-XXX11XXX-01 ETISALAT NO.-1849. The available balance is AED 1,961.35.',
  { merchant: 'Etisalat', category: 'telecom' });

t('a fee schedule is not a transaction',
  'Branch Teller Services are charged at AED 52.5 per transaction. Enjoy free banking at 430 ATMs across the UAE, including 190 CDMs.',
  null);

t('acquirer prefixes are stripped from the merchant',
  'Purchase of CNY 62.2 with Credit Card ending 4844 at ALP*Taobao, Shanghai. Avl Cr. Limit is AED 11,186.46.',
  { merchant: 'Taobao', category: 'shopping' });

// CHANGED from `category: 'dining'`. The claim in the name held — this is a
// named merchant, not "other" — but the category was wrong, and wrong in the
// expensive direction. Grubtech's customer is the RESTAURANT, not the diner:
// it is a POS/order-management subscription the operator pays monthly. The
// user who found it was carrying 55 charges of AED 1,295.63 against a dining
// budget for software.
t('restaurant-tech processors are software, not "other"',
  'Purchase of AED 313.95 with Debit Card ending 4733 at WWW GRUBTECH COM, DUBAI. Avl Balance is AED 36,326.96.',
  { merchant: 'Grubtech', category: 'software' });

// CHANGED from `category: 'entertainment'`. The name of this test was always
// the claim — developer tooling has A HOME rather than falling to "other" —
// and the home is now the right one instead of the nearest one.
t('developer tooling has a home instead of falling to "other"',
  'Purchase of USD 20.00 with Debit Card ending 4733 at CURSOR, AI POWERED IDE, +9715504. Avl Balance is AED 13,933.26.',
  { merchant: 'Cursor', category: 'software' });

// Direct-debit instalments to a bank are debt servicing, not "other".
t('HSBC DDR instalment reads as a loan payment',
  'From HSBC: Account 41-339123-1 was debited for AED 1108.00 on 120902 for DUBAI ISLAMIC BANK PJSC . Please safe keep this unique DDR Reference No. 123070.',
  { merchant: 'Dubai Islamic Bank', category: 'loan', type: 'expense' });

t('FAB direct-debit instalment reads as a loan payment',
  'Dear Customer, your DD instalment of AED 2,476.89 has been debited from your FAB Account and has been sent to Dubai Islamic Bank as per your UAE Direct Debit Service Instructions.',
  { category: 'loan', type: 'expense' });

// Money arriving must not be filed as spending because a reference line
// happens to contain the word "Payment".
t('a payout credited to the account is income, not spending',
  'AED 1,165.33 has been credited to your account no. 095XXX11XXX01 File Ref 1234535B/O DELIVERY HERO TALABAT DB LLCTalabat Biweekly Payment till',
  { type: 'income', category: 'business' });

t('rent received is income',
  'AED 15,000.00 has been credited to your account no. 095-XXX11XXX-01 IPI TT REF: 99OTT1238075 AHMADBADRIMOHAMMADALKAILI RENTPAYMENTS',
  { type: 'income' });

t('a bare article never becomes the merchant',
  'Dear Customer, Your payment to the account number 124822 has been processed. Amount Due: AED 408.45 Amount Paid: AED 408.45',
  { merchant: 'Payment to •4822', amountFils: 40845 });

// ── The second corpus from the user's phone ──

// Masked figures. The bank redacts leading digits; what is left is a fragment,
// and reading it invented a 32,031.55 purchase out of a card number.
t('a masked amount is not a transaction',
  'Credit Card Purchase \nCard No XXXX4777 \nUSD .00 \nen.dragonpass.com.cn Manchester GBR \n22/03/23 17:43 \nAvailable Balance AED ····0200.77',
  null);
t('a masked amount is not a transaction (local currency)',
  'Credit Card Purchase \nCard No XXXX4711 \nAED ····0000.00 \neToro ME LTD etoro ARE \n26/01/26 10:58 \nAvl Bal AED 2752.14',
  null);
const maskedBal = parseSms(
  'Credit Card Purchase \nCard No XXXX4711 \nAED 267.00 \nOFF PRICE GENERAL TRAD SHARJAH ARE \n11/07/26 19:38 \nAvl Bal AED ····9235.93',
);
if (maskedBal && maskedBal.amountFils === 26700 && maskedBal.snapshotFils === null) {
  pass++; console.log('✓ a masked balance is not reported as a balance');
} else { fail++; console.log('✗ a masked balance is not reported as a balance', JSON.stringify(maskedBal && { a: maskedBal.amountFils, s: maskedBal.snapshotFils })); }

// qlub is the UAE QR table-payment platform: it appends itself to the venue's
// own name, so every descriptor carrying it is a restaurant bill.
t('a qlub descriptor is a restaurant bill',
  'Credit Card Purchase \nCard No XXXX4711 \nAED 722.67 \nKokoro qlub, sharjah sharjah ARE \n15/05/26 18:45 \nAvl Bal AED 4946.17',
  { merchant: 'Kokoro Qlub', category: 'dining', amountFils: 72267 });
t('qlub glued to the venue name still reads as dining',
  'Purchase of AED 456.93 with Debit Card ending 4733 at LaBoheme-Muntazahqlub, Sharjah. Avl Balance is AED 14,588.51.',
  { category: 'dining', amountFils: 45693 });

// Descriptors the merchant used to be thrown away from entirely.
t('a leading % is part of the brand',
  'Purchase of AED 40.00 with Debit Card ending 4733 at % ARABICA, DUBAI. Avl Balance is AED 5,594.91.',
  { merchant: '% Arabica', category: 'dining' });
t('an acquirer terminal ID is not part of the shop name',
  'Purchase of AED 86.10 with Debit Card ending 4744 at BLOOMFIELD TREAT-····5814, JLT DUBAI. Avl Balance is AED 6,668.29.',
  { merchant: 'Bloomfield Treat', amountFils: 8610 });
t('a padded location block is not part of the shop name',
  'Debit Card Purchase \nDebit Account XXXX0002 \nCard XXXX4799 \nUSD 200.00 \nEXINITY ME LTD        Dubai           AE \n06/10/25 17:51',
  { merchant: 'Exinity Me Ltd' });
t('a descriptor containing PURCHASE keeps its merchant',
  'Debit Card Purchase \nDebit Account XXXX0002 \nCard XXXX4811 \nAED 379.00 \nWL *STEAM PURCHASE    425-889-9642 WA US \n09/09/25 08:55',
  { merchant: 'Steam', category: 'entertainment', amountFils: 37900 });
t('a glued emirate suffix does not split one shop into two',
  'Your credit card xxx4766 was used for AED 150.00 on 18/07/2026 20:07:52 at AL NIMAR AL ABYADHdSHARJAH- AE. Available credit limit is now AED 2189.45.',
  { merchant: 'Al Nimar Al Abyadh', amountFils: 15000 });
t('a payment-link gateway is not the merchant',
  'Credit Card Purchase \nCard No XXXX4711 \nAED 250.00 \nZiina  *qasr al zain m Sharjah ARE \n29/05/26 12:39',
  { merchant: 'Qasr Al Zain M' });
t('a .com merchant keeps its domain',
  'Purchase of USD 84.00 with Debit Card ending 4733 at Name.com, Inc, 720-2374. Avl Balance is AED 14,315.39.',
  { merchant: 'Name.com' });

// Transfer rails name the rail, not a shop.
t('a FastPay transfer names the person',
  'Dear Ahmed Salem, AED 750.00 has been debited from your Saving Bank Account ending with 2501 for a FastPay transfer to Khalid Rashid. If this is not you; contact us immediately.',
  { merchant: 'Transfer to Khalid Rashid', amountFils: 75000 });
t('a mobile-banking IBAN transfer is a bank transfer',
  'AED 36.00 has been debited from your account no. 095XXX11XXX01 MOBILE BANKING TRANSFER TO AE····0021XXX85XXX01. The available balance is AED 26,209.80.',
  { merchant: 'Bank transfer', amountFils: 3600 });
t('an in-app fund transfer is an outgoing transfer',
  'Dear Customer, AED 50.00 has been deducted from your account 2501 for Fund Transfer through Liv app.',
  { merchant: 'Outgoing transfer', amountFils: 5000 });

// Marketing sentences hide behind the same "to"/"for" the merchant uses.
t('an imperative is never the merchant',
  'AED 3,685.00 has been debited from your account. Pay now to Avoid Charges on your card.',
  { merchant: 'Account debit' });
t('a sentence naming the reader is never the merchant',
  'AED 1,179.00 has been debited from your Emirates NBD account. Log in to View Your Statement.',
  { merchant: 'Account debit' });

// Both legs of a card settlement arrive as separate SMS. An unnamed transfer
// is money moving between your own places, so it must not count as spending
// on top of the card payment it pairs with.
const legTransfer = parseSms('AED 10,089.00 instant transfer was debited from your account XX9012 on 12/07/2026.');
if (legTransfer && legTransfer.merchant === 'Outgoing transfer' && legTransfer.transferHint === true) {
  pass++; console.log('✓ an unnamed outgoing transfer is a transfer, not spending');
} else { fail++; console.log('✗ an unnamed outgoing transfer is a transfer', JSON.stringify(legTransfer && { m: legTransfer.merchant, t: legTransfer.transferHint })); }

// ...but a transfer that names a person really did leave, so it stays an expense.
const toPerson = parseSms('Dear Ahmed Salem, AED 750.00 has been debited from your Saving Bank Account ending with 2501 for a FastPay transfer to Khalid Rashid.');
if (toPerson && toPerson.merchant === 'Transfer to Khalid Rashid' && toPerson.transferHint === false) {
  pass++; console.log('✓ a transfer naming a person stays an expense');
} else { fail++; console.log('✗ a transfer naming a person stays an expense', JSON.stringify(toPerson && { m: toPerson.merchant, t: toPerson.transferHint })); }

// Transliterated Arabic trade words: translations, not guesses about shops.
t('aseer is juice, so it is dining',
  'Credit Card Purchase \nCard No XXXX4711 \nAED 12.00 \nAL ASEER AL MALAKI FO SHARJAH ARE \n07/07/26 18:42',
  { category: 'dining' });
t('thimar is fruit, so it is groceries',
  'Credit Card Purchase \nCard No XXXX4711 \nAED 5.00 \nAL THIMAR AL LIBNANIA SHARJAH ARE \n09/07/26 19:16',
  { category: 'groceries' });
t('saydaliya is a pharmacy',
  'Purchase of AED 45.00 with Debit Card ending 4733 at AL NOOR SAYDALIYA, SHARJAH. Avl Balance is AED 867.00.',
  { category: 'health' });

// Money ARRIVING is income, never a transfer to be netted out. Marking
// incoming transfers as transfers zeroed a real user's monthly income.
const inbound = parseSms('AED 12,000.00 has been credited to your account XX9012 on 12/07/2026.');
if (inbound && inbound.type === 'income' && inbound.transferHint === false) {
  pass++; console.log('\u2713 an unnamed incoming transfer still counts as income');
} else { fail++; console.log('\u2717 an unnamed incoming transfer still counts as income', JSON.stringify(inbound && { m: inbound.merchant, t: inbound.type, h: inbound.transferHint })); }

// "Centre" is a shop in a UAE descriptor far more often than not — but only
// once the rules that own the other kinds of centre have had their turn.
for (const [descriptor, category] of [
  ['CITY NAS CENTER', 'shopping'],
  ['COSMO CENTER', 'shopping'],
  ['DELTA CENTRE TR LLC SP', 'shopping'],
  ['MEDICAL CENTER DUBAI', 'health'],
  ['CAR CENTRE SERVICES', 'transport'],
]) {
  t(`${descriptor} reads as ${category}`,
    `Purchase of AED 50.00 with Debit Card ending 4733 at ${descriptor}, DUBAI. Avl Balance is AED 100.00.`,
    { category });
}

// Food and grocery words the acquirer truncates or misspells. Each is a common
// noun — "cafteria", "barbecua", "burgr", "ice cre" — not a claim about a
// particular shop, which is why they are safe where a shop name is not.
for (const [descriptor, category] of [
  ['CHARCOAL GARDEN', 'dining'],
  ['ICE CAP CAFTERIA LLC', 'dining'],
  ['LOG CABIN BARBECUA LLC', 'dining'],
  ['THE BURGR FACTORY', 'dining'],
  ['GALADARI ICE CRE', 'dining'],
  ['ARABIAN FISH HOUSE CA', 'dining'],
  ['CAFFEINE AND CULTURE C', 'dining'],
  ['MAIZ TACOS', 'dining'],
  ['SWEDISH CANDY', 'dining'],
  ['AL JOUD SPICES TR', 'groceries'],
  ['RAMZ AL MADEENA GRO', 'groceries'],
  ['NEW CITY CNT.HYMKT BR.', 'groceries'],
]) {
  t(`${descriptor} reads as ${category}`,
    `Purchase of AED 50.00 with Debit Card ending 4733 at ${descriptor}, DUBAI. Avl Balance is AED 100.00.`,
    { category });
}

// Terminal IDs arrive as PLAIN DIGITS on the device. The dots in the accuracy
// report are that report's own masking of digit runs, applied on export — no
// bank sends them, so a rule written against the dots never fired in the app.
t('a plain-digit terminal ID is not part of the shop name',
  'Purchase of AED 86.10 with Debit Card ending 4744 at BLOOMFIELD TREAT-245814, JLT DUBAI. Avl Balance is AED 8,946.97.',
  { merchant: 'Bloomfield Treat', amountFils: 8610 });
t('padded terminal IDs strip too',
  'Purchase of AED 20.00 with Debit Card ending 4755 at FRUITPUNCH      -154118, SHJ. Avl Balance is AED 3,358.39.',
  { merchant: 'Fruitpunch' });
// ...and a real name ending in digits is not a terminal ID.
t('a shop whose name ends in a number keeps it',
  'Purchase of AED 100.00 with Debit Card ending 4733 at Loop DXB LLC 1, Dubai. Avl Balance is AED 25,928.01.',
  { merchant: 'Loop DXB Llc 1' });

// Fourth corpus. The first two are regressions from my own guards.
t('a shop with US in its name keeps it',
  'Purchase of AED 397.00 with Debit Card ending 4733 at HOMES R US TRADING LLC, DUBAI. Avl Balance is AED 39,788.47.',
  { merchant: 'Homes R Us Trading Llc', category: 'shopping' });
t('a Tap* payment link is not an imperative',
  'Purchase of AED 128.60 with Debit Card ending 4744 at Tap*OpenSooq, Dubai. Avl Balance is AED 2,954.09.',
  { merchant: 'Opensooq' });

const sweep = parseSms('AED 3,000.00 has been debited from your account no. 095-XXX11XXX-01 RULE TRANSFER TO SAVINGS WITH ONE-SHOT SAVING. The available balance is AED 2257.74.');
if (sweep && sweep.merchant === 'Savings transfer' && sweep.transferHint === true) {
  pass++; console.log('\u2713 a savings sweep is a transfer, not spending');
} else { fail++; console.log('\u2717 a savings sweep is a transfer', JSON.stringify(sweep && { m: sweep.merchant, h: sweep.transferHint })); }

t('a URL descriptor resolves to the service',
  'Purchase of AED 200.00 with Debit Card ending 4744 at HTTP //WWW.BINANCE.COM, BUY DIGITAL A. Avl Balance is AED 4,019.17.',
  { merchant: 'Binance' });
t('a URL descriptor keeps its host when no service matches',
  'Purchase of AED 299.00 with Debit Card ending 4744 at HTTP WWW CARS24 COM, RAS AL KHAIM. Avl Balance is AED 4,469.89.',
  { merchant: 'Cars24' });
t('a Coursera hash is one merchant',
  'Purchase of AED 147.55 with Debit Card ending 4744 at COURSRA*B190SEQUMEGZ4E, MOUNTAIN VIEW. Avl Balance is AED 1,878.30.',
  { merchant: 'Coursera', category: 'education' });
t('a call-cost notice has not charged anything yet',
  'Last call cost is AED 1.57 (VAT included) for Out of Credit Call Service. Amount will be deducted from next recharge.',
  null);
// CHANGED, deliberately, from `merchant: 'Payment to •2543'`. The original
// claim — that the CATEGORY comes from the channel line — is unchanged and
// still asserted here. What is new is that the same line also names the
// PAYEE, and an account fragment was never a name: "Payment to •2543" cannot
// group with last month's Etisalat bill, cannot key a merchant override and
// cannot become a subscription. A channel naming no biller still keeps the
// account title — the control immediately below is that case.
t('a biller portal receipt takes its merchant and category from the channel',
  'Dear Customer, Your payment to the account number ····2543 has been processed.\nAmount Due: AED 408.45 \nAmount Paid: AED 408.45 \nPayment Channel: Etisalat Mobile App',
  { merchant: 'Etisalat', category: 'telecom' });
t('a channel that names no biller keeps the account title',
  'Dear Customer, Your payment to the account number \u00b7\u00b7\u00b7\u00b72543 has been processed.\nAmount Due: AED 408.45\nAmount Paid: AED 408.45\nRemaining Balance: AED 0\nTransaction Date: 2022-03-11\nPayment Channel: Bank Website\nCard Number: NA\nMode of Payment : Credit/Debit',
  { merchant: 'Payment to \u20222543', amountFils: 40845, date: '2022-03-11' });

// Third corpus, from the shipped build.
t('Trip.com is travel, dot and all',
  'Purchase of GBP 37.6 with Debit Card ending 4733 at TRIP.COM, LONDON. Avl Balance is AED 43,415.07.',
  { category: 'travel' });
t('an ISO-3 country code is not part of the merchant',
  'Credit Card Purchase \nCard No XXXX4711 \nQAR 34.00 \nQDF CONCOURSE A DOHA QAT \n28/06/25 06:58',
  { merchant: 'Qdf Concourse A Doha' });
t('a trailing phone number is not part of the merchant',
  'Credit Card Purchase \nCard No XXXX4711 \nAED 132.99 \nMUZZ LTD +····1111 GBR \n21/02/25 20:17',
  { merchant: 'Muzz Ltd' });
t('an inline trailing phone number is stripped too',
  'Purchase of AED 30.00 with Credit Card ending 4722 at SHEETWA, +····4074. Avl Cr. Limit is AED 20,677.34',
  { merchant: 'Sheetwa' });

// Categories that had no entry at all.
t('YouTube Premium is entertainment',
  'Purchase of AED 23.99 with Debit Card ending 4744 at GOOGLE*YOUTUBEPREMIUM, G.CO HELPPAY#. Avl Balance is AED 1,154.47.',
  { merchant: 'YouTube Premium', category: 'entertainment' });
t('the full RTA name is transport',
  'Purchase of AED 10.50 with Debit Card ending 4755 at ROAD & TRANSPORT AUTH, DUBAI. Avl Balance is AED 296.50.',
  { category: 'transport' });
t('an Apple bill is entertainment',
  'Payment of AED 3.99 to APPLE.COM/BILL with Credit Card ending 4722. Avl Cr. Limit is AED 15,008.43.',
  { merchant: 'Apple', category: 'entertainment' });
t('dietary supplements are health',
  'Purchase of AED 13.04 with Debit Card ending 4733 at PUZZLE DIETARY SUPP BR, SHARJAH. Avl Balance is AED 20,659.45.',
  { category: 'health' });

t('SPRM is a supermarket',
  'Purchase of AED 10.00 with Debit Card ending 4744 at NEW STAR FAMILIES SPRM, DUBAI. Avl Balance is AED 5,062.82.',
  { category: 'groceries' });

// ── Guess rather than dump in "other" ──
// Corrections are permanent now, so a wrong guess costs one tap while an
// "other" row costs a cluttered bucket forever.
const shop = (name, place) =>
  `Purchase of AED 42.00 with Debit Card ending 4744 at ${name}, ${place}. Avl Balance is AED 846.57.`;

t('aseer time is a restaurant', shop('ASEER TIME', 'AJMAN'), { category: 'dining' });
t('alpha flight service is airport catering', shop('ALPHA FLIGHT SERVICE', 'SHARJAH'), { category: 'dining' });
t('car centre is transport', shop('CAR CENTER SERVICES', 'SHARJAH'), { category: 'transport' });
t('dott is micromobility', shop('Dott PENDING', 'Dubai'), { category: 'transport' });
t('mamzar park is leisure', shop('AL MAMZAR PARK', 'DUBAI'), { category: 'entertainment' });
// Playing sport is health, matching gym/padel/fitness. A shop that SELLS
// sportswear is still retail, which is why shopping is tested beside it.
t('a sports playground is health', shop('OLE FOR SPORTS PLAYGR', 'AJMAN'), { category: 'health' });
t('a football academy is health', shop('FOOTBALL ACADEMY', 'DUBAI'), { category: 'health' });
t('a sportswear retailer is still shopping', shop('SUN & SAND SPORTS', 'DUBAI'), { category: 'shopping' });
t('majid al futtaim is retail', shop('MAJID AL FUTTAIM', 'DUBAI'), { category: 'shopping' });
t('bioniq is supplements', shop('SP BIONIQ-GLOBAL', '+9715474'), { category: 'health' });
t('a finance house instalment is a loan', shop('AAFAQ ISLAMIC FINANCE', 'DUBAI'), { category: 'loan' });

// ── THE ACQUIRER'S TRUNCATION ──
//
// The descriptor is a fixed-width field, so the last word of a shop's name
// arrives as a stump. These stumps are read against the MERCHANT NAME only,
// and only after every keyword table has already had its turn, so a rule here
// can only ever turn `other` into something.
t('SUP is a cut SUPERMARKET', shop('AL BAIT ALHAMAWI SUP', 'AJMAN'), { category: 'groceries' });
t('SU is a cut SUPERMARKET too', shop('ABDULLA AND NASIR SU', 'AJMAN'), { category: 'groceries' });
t('CEN is a cut CENTRE', shop('ATLAS TOWER GIFT CEN', 'AJMAN'), { category: 'shopping' });
// CONTROL: the stump is only a stump at the END of the descriptor. "SU" and
// "CEN" loose inside a name are ordinary letters.
t('a stump inside the name claims nothing', shop('SU CEN TRADERS FOR OIL', 'SHARJAH'),
  { category: 'other', deliberate: false });
// CONTROL: the stumps read the merchant, never the body — which is the only
// reason "discount" and "gift" can be vocabulary at all. Both are promo-footer
// words, and against a body they would categorise by advertisement.
t('a promo footer cannot categorise the row it sits on',
  'AED 2,476.89 has been debited from your Account XXX0000 to ETISALAT. Get a gift voucher and 10% discount on your next bill.',
  { category: 'telecom' });
t('a discount store is retail', shop('AL WAHDA DISCOUNTS C', 'AJMAN'), { category: 'shopping' });
t('a shisha cafe is a meal out', shop('BAIT AL SHISHA SMOKI', 'AJMAN'), { category: 'dining' });
t('a Portuguese chicken shop is dining', shop('OPORTO PORTUGUESE CHIC', 'DUBAI'), { category: 'dining' });
t('a snooker hall is entertainment', shop('SNOOKER WORLD', 'AJMAN'), { category: 'entertainment' });
t('Typo is stationery', shop('TYPO', 'DUBAI'), { category: 'shopping' });
// CONTROL: "typo" is an English word. Only a descriptor that OPENS with it is
// the shop.
t('typo elsewhere in a name is not the shop', shop('AL TYPO GEN CONTRACTING', 'DUBAI'),
  { category: 'other', deliberate: false });
// CHANGED from 'entertainment' with the rest of the tooling rule. The claim
// under test is the SUFFIX tolerance, which is untouched.
t('fiverr matches even with a region suffix', shop('FiverrEU', 'Nicosia'), { category: 'software' });

// A district name in the descriptor must not decide the category: every shop
// and cafe in City Walk carries it.
t('a roastery in City Walk is dining, not entertainment',
  shop('NIGHTJAR CITY WALK', 'DUBAI'), { category: 'dining' });

// ── Dates: a wrong date files a transaction in the wrong month ──
t('impossible calendar date is rejected, not rolled into the next month',
  'Purchase of AED 90.00 with Credit Card ending 4833 at LULU on 30/02/2026',
  { date: null });

t('unresolvable numeric date still falls through to the named-month form',
  'Your ADCB Credit Card 1234 statement. Total amount due AED 1,500.00. Generated on 30/13/2026. Please pay by Jul 19 2026.',
  { date: '2026-07-19' });

t('US-style MM/DD resolves when it has no DD/MM reading',
  'Purchase of AED 250.00 with Credit Card ending 4833 at CARREFOUR on 12/25/2026',
  { date: '2026-12-25' });

t('DD/MM still wins when both readings are valid',
  'Purchase of AED 250.00 with Credit Card ending 4833 at CARREFOUR on 05/06/2026',
  { date: '2026-06-05' });

t('leap day parses',
  'Purchase of AED 10.00 with Credit Card ending 4833 at LULU on 29/02/2024',
  { date: '2024-02-29' });

t('29 Feb in a non-leap year is rejected',
  'Purchase of AED 10.00 with Credit Card ending 4833 at LULU on 29/02/2025',
  { date: null });

// ── Formats from a second user's inbox (a 346-message accuracy report) ──
// Every case below was in that report because the parser could not read it.

// The single biggest family: the payee sits BEFORE the amount, with none of
// the prepositions the merchant matcher looks for. 32 messages arrived titled
// "Card purchase" and could never group into a merchant.
t('payment-for names the payee, not "Card purchase"',
  'Payment for GINNYS PLUS TRADING of AED 2.25 has been made using Credit Card ending with 4110. Available limit AED 59,797.61.',
  { merchant: 'Ginnys Plus Trading', amountFils: 225, type: 'expense' });

t('payment-for survives the newline banks put before the card number',
  'Payment for CARIBOU COFFEE of AED 26.00 has been made using Credit Card ending with\n 4110. Available limit AED 63,155.07.',
  { merchant: 'Caribou Coffee', amountFils: 2600, category: 'dining' });

t('payment-for keeps a descriptor with punctuation in it',
  'Payment for ENOC SITE - 49/6915 of AED 108.01 has been made using Credit Card ending with 4110. Available limit AED 65,810.74.',
  { merchant: 'ENOC Site - 49/6915', amountFils: 10801, category: 'transport' });

// The acquirer descriptor is a fixed-width field, so the city is glued onto a
// truncated name with no separator at all.
t('glued city is stripped off a truncated descriptor',
  'Debit Card Purchase\nCard XXXX5083\nAED 29.00\nFRIENDS AVENUE CATERINDUBAI           AE \n14/10/25 14:14 \nAvailable Balance AED 1047.24',
  { merchant: 'Friends Avenue', amountFils: 2900, category: 'dining', date: '2025-10-14' });

t('stripping the glued city keeps the last letter of the name',
  'Debit Card Purchase\nCard XXXX5083\nAED 10.00\nDUBAI INTEGRATED ECONODUBAI           AE \n03/02/26 14:26 \nBalance AED 9774.87',
  { merchant: 'Dubai Integrated Economic Zones', amountFils: 1000, date: '2026-02-03' });

t('two glued places both come off',
  'Debit Card Purchase\nCard XXXX5083\nAED 59.00\n····8730 TGI FRIDAYS DUBADUBAI           AE \n19/05/26 14:02 \nBalance AED 1920.62',
  { merchant: 'TGI Fridays', amountFils: 5900, category: 'dining' });

t('gateway prefix is not the merchant',
  'Debit Card Purchase\nCard XXXX5083\nAED 378.00\nZiina  *CLEANTIZER SERDubai           AE \n01/05/26 22:19 \nBalance AED 8202.35',
  { merchant: 'Cleantizer', amountFils: 37800 });

t('the same merchant from HSBC resolves to the same name',
  'From HSBC: 27SEP24 ZIINA* CLENTIZER96 Purchase from 041-340***-001 AED 103.95- by Card Ending with 6737. Your available balance is AED 7,604.23',
  { merchant: 'Cleantizer', amountFils: 10395 });

t('a truncated HSBC descriptor resolves to the same name as the full one',
  'From HSBC: 24JUN25 DUBAI INTEGRATED ECO Purchase from 041-340***-001 AED 10.00- by Card Ending with 6737. Your available balance is AED 1,430.28',
  { merchant: 'Dubai Integrated Economic Zones', amountFils: 1000 });

t('one merchant, three spellings, one name',
  'Purchase of AED 96.00 with Debit Card ending 4502 at URBANCLAP TECHNOLOGIES, DUBAI. Avl Balance is AED 258.91.',
  { merchant: 'UrbanClap', amountFils: 9600 });

// CHANGED from 'entertainment': FinArt is an AI app and moved with the tooling
// rule. The claim under test — that the help URL is not read as the location —
// is asserted by the merchant and is untouched.
t('Google bills through a help URL, not a location',
  'Debit Card Purchase\nCard XXXX5083\nAED 49.99\nGOOGLE*FINART AI EXPE G.CO/HELPPAY#CA US \n13/12/25 11:59 \nBalance AED 6576.11',
  { merchant: 'Finart Ai Expe', amountFils: 4999, category: 'software' });

// A savings pot has a name, and the name is rarely the word "savings".
t('a named savings pot is a transfer, not AED 7,000 of spending',
  'AED 7,000.00 has been debited from your account no. 095XXX13XXX01 TO LIV FROM EMERGENCY FUNDS. The available balance is AED 7,939.20.',
  { merchant: 'Savings transfer', amountFils: 700000, transfer: true });

t('an automated savings rule is a transfer too',
  'AED 4,000.00 has been debited from your account no. 096XXX13XXX 0007 RULE TRANSFER TO EMERGENCY FUNDS WITH ONE-SHOT SAV. The available balance is AED 4,000.95.',
  { merchant: 'Savings transfer', amountFils: 400000, transfer: true });

t('a refund says so',
  "We've issued your refund of 58.89 AED for your cancelled order.",
  { merchant: 'Refund', type: 'income', amountFils: 5889 });

t("Etisalat's own app is telecom, not Other",
  'Debit Card Purchase\nCard XXXX5083\nAED 450.45\ne& Digital App        Abu Dhabi       AE \n27/06/26 11:43 \nBalance AED ····3038.72',
  { merchant: 'E& Digital App', category: 'telecom' });

t('a truncated government descriptor still reads as government',
  'Your Credit Card ending *** 6383 was used for AED 231.95 at BUSINESS HUB GOVERNMEN. Your available limit is AED 1659.58',
  { category: 'government', amountFils: 23195 });

t('Lime scooters are transport under any of their three descriptors',
  'Purchase of AED 33.00 with Debit Card ending 4502 at LIME*TEMP HOLD, +····3345. Avl Balance is AED 68.89.',
  { merchant: 'Lime', category: 'transport', amountFils: 3300 });

// A masked amount stays unreadable: a fragment of a figure is not the figure.
t('a masked amount is still refused, not guessed',
  'Your Credit Card ending *** 6383 was used for AED ····0710.00 at MSPLUS DOCUMENTS CL.... Your available limit is AED 3019.69',
  null);

// ══ Polarity: "Credit Card" is a NOUN, never the verb "credited" ══
// Every message below used to arrive as INCOME in the Business category, so
// the ledger moved by twice the amount in the wrong direction. The card word
// supplied the credit evidence; the verb supplied none, because only the past
// tense "was used" was known and UAE banks overwhelmingly write the perfect.
t('a credit-card purchase in the perfect tense is spending, not revenue',
  'Your Credit Card ending 4844 has been used for AED 89.50 at CARREFOUR. Avl Cr. Limit AED 14,671.30',
  { kind: 'transaction', type: 'expense', amountFils: 8950, merchant: 'Carrefour', category: 'groceries',
    card: { last4: '4844', kind: 'credit' }, transfer: false, snapshotFils: 1467130, snapshotKind: 'limit' });

// The control: the tense is the ONLY difference, which is what proves the
// defect was the verb list and not the card.
t('...and the same purchase in the past tense still is',
  'Your Credit Card ending 4844 was used for AED 89.50 at CARREFOUR. Avl Cr. Limit AED 14,671.30',
  { type: 'expense', amountFils: 8950, merchant: 'Carrefour', category: 'groceries',
    card: { last4: '4844', kind: 'credit' }, snapshotKind: 'limit' });

t('a supplementary-card plural auxiliary is spending too',
  'Your Credit Card ending 4844 have been used for AED 89.50 at CARREFOUR.',
  { type: 'expense', amountFils: 8950, merchant: 'Carrefour', category: 'groceries',
    card: { last4: '4844', kind: 'credit' } });

t('"utilised" is the same verb in ADIB/DIB wording',
  'Credit Card ending 4844 has been utilised for AED 89.50 at CARREFOUR.',
  { type: 'expense', amountFils: 8950, merchant: 'Carrefour', category: 'groceries' });

t('a transaction "made on" a card carries no debit verb at all',
  'A transaction of AED 89.50 has been made on your Credit Card ending 4844 at CARREFOUR.',
  { type: 'expense', amountFils: 8950, merchant: 'Carrefour', category: 'groceries',
    card: { last4: '4844', kind: 'credit' } });

// The minimal form: no verb anywhere. The only thing that used to make this
// parse was "Credit Card" being read as the verb — and it booked AED 250 of
// telecom spending as AED 250 of business revenue.
t('a bill paid via a credit card, with no verb, is still spending',
  'AED 250.00 to ETISALAT via Credit Card 1234.',
  { type: 'expense', amountFils: 25000, merchant: 'Etisalat', category: 'telecom',
    card: { last4: '1234', kind: 'credit' } });

// ══ Polarity, the mirror image: real income booked as spending ══
// "paid"/"payment" beat "salary"/"received" in the old unordered race. The
// clause that says WHERE the money went now settles it first.
t('a salary paid INTO your account is income, not a AED 10,000 expense',
  'Your salary of AED 10,000.00 has been paid into your account 1234.',
  { type: 'income', amountFils: 1000000, merchant: 'Salary', category: 'salary',
    card: { last4: '1234', kind: 'account' } });

t('salary paid to an a/c reads the same way',
  'Salary AED 10,000.00 paid to a/c 1234 by ACME LLC.',
  { type: 'income', amountFils: 1000000, category: 'salary' });

// Also the merchant: MERCHANT_STOP had no "as", so the sentence ran on into
// the name and freelance income arrived as spending at "Acme Llc As Payment".
t('an invoice payment received from a client is business income',
  'AED 10,000.00 received from ACME LLC as payment for invoice 88. A/c 1234.',
  { type: 'income', amountFils: 1000000, merchant: 'Acme Llc', category: 'business',
    card: { last4: '1234', kind: 'account' } });

t('a refund paid BACK to your card is income, not a second purchase',
  'AED 300.00 refund from NOON has been paid back to your Card 1234.',
  { type: 'income', amountFils: 30000, merchant: 'Noon', category: 'other',
    card: { last4: '1234', kind: 'unknown' } });

t('money received from a person is income',
  'You have received a payment of AED 250.00 from Ahmed via Ziina.',
  { type: 'income', amountFils: 25000, merchant: 'Ahmed' });

t('cash paid IN at a deposit machine is income',
  'Cash deposit of AED 2,000 paid in at CDM. A/c 1234.',
  { type: 'income', amountFils: 200000, card: { last4: '1234', kind: 'account' } });

// A cash advance is borrowing, not revenue — and the ATM title only applies
// once the direction is right, so the polarity bug corrupted the title too.
t('a credit-card cash advance is spending, titled as a withdrawal',
  'Cash advance of AED 1,000.00 on your Credit Card 1234 at ATM.',
  { type: 'expense', amountFils: 100000, merchant: 'ATM withdrawal', category: 'other',
    card: { last4: '1234', kind: 'credit' } });

// ══ Declines: a refusal and a purchase live in the same sentence ══
// Negative evidence has to beat positive evidence, and the list has to be
// exhaustive — every phrase missed here became a phantom expense.
t('"not approved" is a decline', 'Your Card ending 1234 was used for AED 500.00 at NOON. Transaction was not approved.', null);
t('"rejected" is a decline', 'Your Card ending 1234 was used for AED 500.00 at NOON. Transaction was rejected due to card limit.', null);
t('"voided" is a decline', 'Your Card ending 1234 was used for AED 500.00 at NOON. Transaction was voided.', null);
t('a cancelled payment is a decline', 'Your payment of AED 500.00 at NOON has been cancelled.', null);
t('bare "failed" is a decline, not only "has failed"', 'AED 500.00 spent at NOON. Payment failed.', null);

// ══ The dotted card abbreviation ══
// ADCB writes "Cr.Card XXX7720" with no space. Requiring whitespace before
// "card" meant neither leg of a settlement was recognised, so a card payment
// booked as spending on BOTH sides and one payment landed on the ledger twice.
// No corpus message and no test on either branch covered this wording, which is
// why two full suites stayed green over it.
t(
  'a dotted Cr.Card receipt is a card payment, not a purchase',
  'Thank you for your payment of AED 500.00 towards Cr.Card XXX7720.',
  { kind: 'cardPayment', amountFils: 50000, transferHint: true },
);
t(
  '...and its account-side leg is a transfer, so the pair cannot double-count',
  'AED 500.00 has been debited from your account 1234 towards Cr.Card XXX7720.',
  { type: 'expense', amountFils: 50000, transferHint: true },
);
t(
  'a full stop before "Card" is still two clauses, not an abbreviation',
  'Your payment of AED 200.00 was received towards your account. Card 1234 was used at NOON.',
  { type: 'expense', amountFils: 20000, transferHint: false },
);

// ══ Suppression must never beat evidence ══
// Each of these was a REAL posting that a boilerplate footer deleted. They are
// invisible failures: no row, no error, and the money simply is not there.
//
// The rule they encode: a footer phrase only gets to suppress a message that
// shows no posted transaction at all, and a code word only counts when its
// digits are in the SAME SENTENCE.
t(
  'an OTP footer cannot reach across a full stop to an unrelated reference number',
  'AED 89.50 spent at CARREFOUR using Debit Card 1234. Do not share your OTP with anyone. Ref: 123456.',
  { type: 'expense', amountFils: 8950, merchant: 'Carrefour' },
);
t(
  'an authorisation code is an approval reference on a posting, not an OTP',
  'AED 250.00 spent at NOON with Credit Card 4110. Authorisation code: 123456.',
  { type: 'expense', amountFils: 25000, merchant: 'Noon' },
);
t(
  '3D Secure plus a reference number is still a posting',
  'Purchase of AED 250.00 at NOON with Credit Card 4110 authenticated via 3D Secure. Ref: 883421.',
  { type: 'expense', amountFils: 25000, merchant: 'Noon' },
);
t(
  'a cancelled SUBSCRIPTION refund is money returned, not a decline',
  'Your NETFLIX subscription was cancelled. AED 56.00 has been refunded to your Credit Card 4110.',
  { type: 'income', amountFils: 5600 },
);
t(
  'a cancelled BOOKING refund is money returned, not a decline',
  'Your booking at EMIRATES was cancelled and AED 1,200.00 has been credited to your Credit Card 4110.',
  { type: 'income', amountFils: 120000 },
);
t(
  'an insufficient-balance FEE is money that actually left the account',
  'AED 25.00 has been debited from your account 1234 as an insufficient balance fee. Avl Bal AED 400.00',
  { type: 'expense', amountFils: 2500 },
);
// ══ Money that is not a purchase, and purchases that are not money ══
// Every one of these was verified against the compiled parser before the fix.
t(
  'crediting a BILLER account is the user paying a bill, in either word order',
  'Your Etisalat account has been credited with AED 320.00. Thank you for your payment.',
  { type: 'expense', amountFils: 32000, merchant: 'Etisalat', categoryGuess: 'telecom' },
);
t(
  '...and a toll account too, with no "your payment" to lean on',
  'Your Salik account has been credited with AED 100.00.',
  { type: 'expense', amountFils: 10000, merchant: 'Salik', categoryGuess: 'transport' },
);
t(
  'crediting the user OWN account is still income',
  'Your account 1234 has been credited with AED 5,000.00. Avl Bal AED 12,000.00',
  { type: 'income', amountFils: 500000 },
);
t(
  'a bare credit-limit notice states no transaction amount',
  'Thank you for your payment. Your available credit limit on Card 4110 is now AED 42,000.00.',
  null,
);
t(
  '...but a limit quoted AFTER a real purchase does not eat the purchase',
  'AED 250.00 spent at NOON with Credit Card 4110. Available limit on card 4110 is now AED 9,750.00',
  { type: 'expense', amountFils: 25000, merchant: 'Noon' },
);
t(
  'a discount ceiling is not a purchase',
  'Get AED 100.00 off your next purchase at NOON with your ADCB card.',
  null,
);
t(
  'a statement records its CLOSING BALANCE, not its minimum payment',
  'Your card 4110 statement for July is available. Closing balance AED 8,500.00. Minimum payment AED 425.00 due 20/08/2026.',
  { kind: 'cardStatement', amountFils: 850000, minDueFils: 42500 },
);
t(
  'a verbless field-list alert parses on a CREDIT card, as it already did on debit',
  'Txn alert: AED 45.00, TALABAT, Credit Card 4110, 30/07/2026.',
  { type: 'expense', amountFils: 4500, card: { last4: '4110', kind: 'credit' } },
);
t(
  'moving money into your own savings is not spending',
  'AED 5,000.00 transferred from your Current Account 1234 to your Savings Account 5678.',
  { type: 'expense', amountFils: 500000, transferHint: true },
);
t(
  'paying your own credit card from your account is a settlement, not spending',
  'You have transferred AED 500.00 from account 1234 to your credit card 4110.',
  { type: 'expense', amountFils: 50000, transferHint: true },
);
t(
  '...but paying a PERSON is a real transfer out',
  'AED 500.00 was transferred from your account 1234 to MOHAMMED ALI.',
  { type: 'expense', amountFils: 50000, transferHint: false },
);

// Controls: the suppressions above must still fire where they belong.
t(
  'a genuine OTP quoting the transaction it protects is still suppressed',
  'Your one-time password for a purchase of AED 250.00 at NOON on card 4110 is 123456.',
  null,
);
t(
  'insufficient FUNDS as a refusal reason is still a decline',
  'Your purchase of AED 500.00 at NOON was declined due to insufficient funds.',
  null,
);
t('a FAILED status line is a decline', 'AED 500 purchase at NOON. Status: FAILED.', null);
t('"could not be authorised" is a decline', 'Your purchase of AED 500.00 at NOON could not be authorised.', null);
t('"did not go through" is a decline', 'Your purchase of AED 500.00 at NOON did not go through.', null);
t('"denied" is a decline', 'Your purchase of AED 500.00 at NOON was denied.', null);
t('"refused" is a decline', 'Your purchase of AED 500.00 at NOON was refused by the bank.', null);
t('an aborted transaction is a decline', 'AED 500.00 debited at NOON. Transaction aborted.', null);
t('a stopped purchase on a blocked card is a decline', 'Your card 1234 was blocked; the AED 500.00 purchase at NOON was stopped.', null);
// Issuer reason codes arrive with no refusal verb at all — the code IS the signal.
t('"DO NOT HONOUR" is a decline', 'Purchase of AED 500.00 at NOON. Reason: DO NOT HONOUR.', null);
t('an expired card is a decline', 'Purchase of AED 500.00 at NOON. Reason: card expired.', null);
t('a card blocked for online use is a decline', 'Purchase of AED 500.00 at NOON. Your card is blocked for online transactions.', null);
// These returned null before only because they carried no known debit verb.
// Teaching the parser "transaction of ..." would have turned each into a
// phantom AED 500, so they are pinned here as the trap they are.
t('a rejected "transaction of" stays a decline once the verb is known', 'Your transaction of AED 500 at NOON has been rejected.', null);
t('an invalid "transaction of" stays a decline too', 'Transaction of AED 500.00 at NOON on card 1234 is invalid.', null);

// ══ Reversals: money coming BACK is a posting, not a refusal ══
// "reversed" used to sit in the decline list, so a reversal was DISCARDED and
// the original expense stayed on the ledger with nothing to offset it.
t('a reversed purchase returns the money',
  'The transaction of AED 500.00 at NOON on your Credit Card 1234 has been reversed.',
  { kind: 'transaction', type: 'income', amountFils: 50000, merchant: 'Noon', category: 'other',
    card: { last4: '1234', kind: 'credit' }, transfer: false });

t('a reversal onto a card with no payee is titled Refund',
  'AED 500.00 has been reversed to your Card ending 1234.',
  { type: 'income', amountFils: 50000, merchant: 'Refund', category: 'other',
    card: { last4: '1234', kind: 'unknown' } });

// Verb and noun describe the identical event: one bank writing "reversal" and
// another writing "reversed" must not produce an AED 500 difference.
t('the NOUN form of the same reversal reads identically',
  'A reversal of AED 500.00 has been credited to your account 1234.',
  { type: 'income', amountFils: 50000, merchant: 'Refund', category: 'other',
    card: { last4: '1234', kind: 'account' } });

// A chargeback is an offset against an earlier expense. Filing it as Business
// invents revenue, which is a claim about the user's tax position.
t('a chargeback is an offset, not business revenue',
  'A chargeback of AED 500.00 has been credited to your card 1234.',
  { type: 'income', amountFils: 50000, merchant: 'Refund', category: 'other',
    card: { last4: '1234', kind: 'unknown' } });

t('"credited back" is the same offset',
  'AED 500.00 has been credited back to your Card ending 1234 by NOON.',
  { type: 'income', amountFils: 50000, category: 'other' });

// The boundary the reversal fix must not cross: a released pre-auth hold was
// never posted, so crediting it double-counts against the settlement SMS.
t('a released hold is NOT a reversal', 'The amount of AED 500.00 held on your card has been released.', null);

// ══ Covered Card: the whole Islamic-banking segment ══
// DIB, ADIB, EIB, Ajman and SIB never write "credit card" — the product is a
// Covered Card. Read as a debit card, its available HEADROOM was stored as
// cash in an account, silently inflating net worth by a full credit limit.
t('a Covered Card is a credit card, and its Avl Bal is headroom',
  'Your Covered Card ending 4844 was used for AED 89.50 at CARREFOUR. Avl Bal AED 14,671.30',
  { type: 'expense', amountFils: 8950, merchant: 'Carrefour', category: 'groceries',
    card: { last4: '4844', kind: 'credit' }, snapshotFils: 1467130, snapshotKind: 'limit' });

t('a Charge Card is read the same way',
  'Your Charge Card ending 4844 was used for AED 89.50 at CARREFOUR. Avl Bal AED 14,671.30',
  { card: { last4: '4844', kind: 'credit' }, snapshotKind: 'limit' });

// The worst case of all: with neither "credit" nor "debit" in the card name,
// no word list fired and the purchase vanished with no row and no error. For
// a DIB/ADIB customer that is the whole card missing from the app.
t('a Covered Card purchase is not silently dropped',
  'Your Covered Card ending 4844 has been used for AED 89.50 at CARREFOUR.',
  { type: 'expense', amountFils: 8950, merchant: 'Carrefour', category: 'groceries',
    card: { last4: '4844', kind: 'credit' } });

// ══ OTP and pre-auth: an ATTEMPT is not a transaction ══
// These quote the amount and the merchant, so every missed phrasing fabricates
// a purchase that never happened.
t('the "Use NNNNNN to..." OTP form is skipped', 'Use 458213 to authenticate your purchase of AED 500.00 at NOON on Card 1234.', null);
t('the "Enter NNNNNN to..." OTP form is skipped', 'Enter 458213 to confirm the payment of AED 500.00 to NOON.', null);
t('3D Secure is an OTP', '3D Secure: 458213. Purchase of AED 500.00 at NOON on Card 1234.', null);
t('"do not disclose" is an OTP warning like "do not share"', 'Security code 458213. Do not disclose. Purchase of AED 500.00 at NOON.', null);
t('"NNNNNN is the code" is an OTP', 'Dear customer, 458213 is the code for your AED 500.00 purchase at NOON.', null);
// A hold is followed by a real settlement SMS, so importing it double-counts —
// and holds live at hotels, car rentals and fuel pumps, where amounts are big.
t('"pre authorization" with a space is still a hold', 'Pre authorization: purchase of AED 500.00 at HERTZ on Card 1234.', null);
t('an authorization hold is a hold', 'An authorization hold: purchase of AED 500.00 at HERTZ on Card 1234.', null);
t('an earmarked amount is a hold', 'A purchase of AED 500.00 at HERTZ has been earmarked on your Card 1234.', null);
t('a reserved amount is a hold', 'A purchase of AED 500.00 at HERTZ has been reserved on your Card 1234.', null);
t('a provisional debit pending settlement is a hold', 'AED 500.00 debited provisionally at HERTZ on Card 1234. Pending settlement.', null);

// ══ Promo footers must not delete real transactions ══
// PROMO_RE matches "cashback" — which is the NAME of the user's own card
// product — and the evidence test only accepted the long verb forms.
t('a purchase on a Cashback Card is still a purchase',
  'Your Cashback Card 1234 purchase AED 89.50 at CARREFOUR.',
  { type: 'expense', amountFils: 8950, merchant: 'Carrefour', category: 'groceries',
    card: { last4: '1234', kind: 'unknown' } });

t('a loyalty footer does not erase the purchase it is attached to',
  'AED 89.50 spent at CARREFOUR on Card 1234. Congratulations, you unlocked a reward.',
  { type: 'expense', amountFils: 8950, merchant: 'Carrefour', category: 'groceries' });

t('a T&Cs footer does not need a balance line to survive',
  'AED 89.50 debited at CARREFOUR on Card 1234. T&Cs apply.',
  { type: 'expense', amountFils: 8950, merchant: 'Carrefour', category: 'groceries' });

// ══ The descriptor ends where the sentence about it begins ══
// "Zara And The" can never group with Zara, so merchant totals, subscription
// detection and category overrides all fragment.
t('a merchant name stops before "and the"',
  'AED 50 spent at ZARA and the balance updated.',
  { type: 'expense', amountFils: 5000, merchant: 'Zara', category: 'shopping' });

t('and before "but the"',
  'AED 50 spent at ZARA but the card was blocked.',
  { type: 'expense', amountFils: 5000, merchant: 'Zara', category: 'shopping' });

// ══ SUPPRESSION MUST NEVER BEAT EVIDENCE ══
//
// Every fixture below is a message the parser DELETED or INVENTED after the
// suppression vocabulary was widened without being anchored. They are pinned
// here as a class, because the failure mode is the same one every time: a
// pattern written to describe the sentence ABOUT a transaction was matched
// anywhere in the body, so a merchant's name or a footer disclaimer decided
// whether the user's money existed.

// ── A footer disclaimer is not an OTP ──
// "Do not disclose your PIN" and "3D Secure" are stapled to the foot of real
// posted-transaction alerts by issuers all over the UAE. Matched
// unconditionally and tested first, they deleted every purchase carrying one:
// silent, total, and invisible to the user, who sees no row and no error.
t('a "do not disclose your PIN" footer does not delete the purchase it sits on',
  'AED 89.50 spent at CARREFOUR using Debit Card 1234. Balance AED 5,376.00. Do not disclose your PIN.',
  { kind: 'transaction', type: 'expense', amountFils: 8950, merchant: 'Carrefour',
    category: 'groceries', card: { last4: '1234', kind: 'debit' },
    snapshotFils: 537600, transfer: false });

t('a purchase AUTHENTICATED by 3D Secure is a purchase, not an OTP',
  'Purchase of AED 250.00 at NOON with Credit Card 4110 was authenticated via 3D Secure. Avl Bal AED 900.00',
  { kind: 'transaction', type: 'expense', amountFils: 25000, merchant: 'Noon',
    category: 'shopping', card: { last4: '4110', kind: 'credit' },
    snapshotFils: 90000, snapshotKind: 'limit' });

// The boundary that keeps the above honest: a real OTP names itself, and the
// 3D Secure CHALLENGE quotes the code. Both still die.
t('a 3D Secure challenge quoting the code is still an OTP',
  '3D Secure code 458213 for your purchase of AED 250.00 at NOON on Card 4110.', null);
t('a bare "never share" notice with no transaction is still suppressed',
  'Never share your card details or PIN with anyone. Stay safe with your bank.', null);

// ── A merchant's name is not a reason code ──
// Time Out Market Dubai is a real, high-traffic food hall in Souk Al Bahar.
// DECLINED_RE's unanchored "time-?out" read the venue as a refusal, and the
// same collision was waiting in every descriptor below.
t('TIME OUT MARKET is a food hall, not a transaction timeout',
  'AED 32.00 spent at TIMEOUT MARKET DUBAI with Debit Card 1234',
  { kind: 'transaction', type: 'expense', amountFils: 3200, merchant: 'Timeout Market',
    card: { last4: '1234', kind: 'debit' } });

for (const [name, shop] of [
  ['DENIED', 'ACCESS DENIED CAFE'],
  ['FAILED', 'FAILED BAKERY'],
  ['VOIDED', 'VOIDED GAMES'],
  ['CANCELLED', 'CANCELLED CULTURE'],
  ['INVALID', 'INVALID TRADING LLC'],
  ['EXPIRED', 'EXPIRED VINYL STORE'],
]) {
  t(`a descriptor containing ${name} is a shop, not a decline`,
    `AED 25.00 spent at ${shop} with Debit Card 1234`,
    { kind: 'transaction', type: 'expense', amountFils: 2500 });
}

// ...and a real refusal still beats the purchase verb sitting beside it.
t('a decline is still a decline when the shop name is masked out',
  'Your purchase of AED 500.00 at TIMEOUT MARKET DUBAI failed: the transaction timed out.', null);
t('"transaction timeout" as a reason code is still a decline',
  'Purchase of AED 500.00 at NOON. Reason: transaction timeout.', null);

// ── A posted authorisation awaiting settlement is posted ──
// A card purchase sits in "pending settlement" for two or three days AFTER it
// is authorised, and the bank says so on the alert for the purchase itself.
t('"pending settlement" on a purchase does not delete the purchase',
  'AED 250.00 purchase at NOON with Credit Card 4110 is currently pending settlement.',
  { kind: 'transaction', type: 'expense', amountFils: 25000, merchant: 'Noon',
    category: 'shopping', card: { last4: '4110', kind: 'credit' } });

// The hold it must not be confused with: money that has NOT moved is still
// dropped, and a settlement footer on a hold changes nothing.
t('a provisional debit pending settlement is still a hold',
  'AED 500.00 debited provisionally at HERTZ on Card 1234. Pending settlement.', null);
t('a pending AUTHORISATION is still a hold',
  'AED 500.00 at HERTZ is pending authorisation on Card 1234.', null);

// ── "currently" is not "rent" ──
// guessCategory reads the WHOLE message, so an unanchored keyword files a row
// by a substring of an adverb.
t('an adverb containing "rent" does not file the row under Rent',
  'AED 250.00 purchase at NOON with Credit Card 4110 is currently pending settlement.',
  { category: 'shopping' });
t('a real rent payment still is one',
  'AED 6,500.00 was debited from your account for RENT PAYMENT to AL HABTOOR PROPERTIES on 01/07/2026',
  { category: 'rent' });

// ── Paying a bill is not being paid ──
// Every UAE biller confirms a settlement in this wording. "credited to your"
// booked it as income: a 2x swing on one message, since the spend vanishes and
// revenue appears in its place.
t('a payment CREDITED TO a biller account is a bill, not income',
  'Your payment of AED 200.00 has been credited to your du account 1234567.',
  { kind: 'transaction', type: 'expense', amountFils: 20000, merchant: 'Du',
    category: 'telecom', transfer: false });

// The mirror image, which must not move: a credit clause whose subject is
// money arriving is still income.
t('a salary credited to your account is still income',
  'Your salary of AED 18,500.00 has been credited to your account ending 5678',
  { type: 'income', amountFils: 1850000, merchant: 'Salary', category: 'salary' });

// ── A card settlement is a card settlement, not any payment near a card ──
// CARD_PAYMENT_RE's word gap was widened to three bare words, so the phrase
// stepped out of its own clause onto a card named in the next one.
// transferHint:true means "not spending", so a real AED 200 electricity bill
// left the month's spending AND the debit card was re-typed as credit.
t('a utility bill paid BY card is spending, not a card settlement',
  'Your payment of AED 200.00 has been received for your electricity bill using card 1234',
  { kind: 'transaction', type: 'expense', amountFils: 20000, merchant: 'Electricity',
    category: 'utilities', transfer: false, card: { last4: '1234', kind: 'unknown' } });

// The settlements the widened gap existed for still work — the product name
// between "your" and "Card" really is two words on most UAE issuers.
t('a two-word card product name is still a card settlement',
  'Your payment of AED 1,500.00 has been received towards your ADIB Covered Card ending 4417.',
  { kind: 'cardPayment', amountFils: 150000, merchant: 'Card •4417 payment', transfer: true,
    card: { last4: '4417', kind: 'credit' } });

// ── A marketing summary is not a transaction ──
// Every dirham of it is already on the ledger, one real transaction at a time.
t('a monthly spend summary does not fabricate a purchase',
  'You spent AED 4,320.00 this month with your ADCB Credit Card. See the breakdown in the app.',
  null);
t('a "total spending" recap is a summary too',
  'Your total spending for July was AED 4,320.00 across 47 transactions.', null);

// The gate that keeps it safe: a summary FOOTER on a real alert must not take
// the transaction with it.
t('a spend-to-date footer does not delete the purchase it is attached to',
  'AED 89.50 spent at CARREFOUR on Card 1234. You have spent AED 4,320.00 this month.',
  { kind: 'transaction', type: 'expense', amountFils: 8950, merchant: 'Carrefour',
    category: 'groceries' });

// ── A balance is never the amount ──
// amountWithFx used to fall back to the FIRST figure when a body stated no
// transaction amount — a figure BALANCE_PREFIX_RE had already identified as a
// balance or an available limit. Downstream, auto-import turns a statement
// into a CardDue with totalDue = the limit and minDue = 5% of it: thousands of
// dirhams of debt that does not exist.
t('a card payment with no stated amount reports nothing, not the limit',
  'Thank you for your payment towards your RAKBANK Credit Card ending 4711. Your available limit is now AED 50,000.00',
  null);
t('...and neither does a statement with no total',
  'Your RAKBANK Credit Card ending 4711 statement is ready. Payment due by 18/08/2026. Available limit AED 50,000.00',
  null);
t('"is now" is a balance sentence like "is"',
  'AED 500.00 was debited at CARREFOUR on Card 1234. Your balance is now AED 9,149.34.',
  { amountFils: 50000, snapshotFils: 914934 });


// ══ ROUND 2: THE SAME PRINCIPLE, THE OTHER NINETEEN MESSAGES ══
//
// Every fixture below is a message that was still wrong after the first pass
// at "suppression must never beat evidence" — either because a suppression
// rule was widened without being anchored (a footer deleting a real purchase)
// or because an anchor was drawn so tightly that it caught the wrong noun (a
// bare "account" read as a biller). They are pinned as a class because the
// failure mode is always one of exactly two shapes:
//
//   money the user has, deleted        a footer, a reason code or a hold
//                                      phrase matched anywhere in the body
//   money the user never spent, made   a threshold, a forecast or a summary
//                                      read as if it had posted
//
// Both are silent. Neither produces an error, and the user is never told.

// ── Money paid INTO your own account is income ──
// The biller fix required nothing after "credited to your", so the bare noun
// "credited to your ACCOUNT" was treated exactly like "credited to your DU
// account" — and money arriving, with a RISING balance quoted in the same
// sentence, was booked as an EXPENSE. That is the same 2x swing the biller fix
// exists to prevent, pointed the other way.
t('a payment credited to your OWN account is income, not an expense',
  'A payment of AED 2,000.00 has been credited to your account 1234 on 12/07/2026. New balance AED 32,000.00',
  { kind: 'transaction', type: 'income', amountFils: 200000, merchant: 'Incoming transfer',
    card: { last4: '1234', kind: 'account' }, snapshotFils: 3200000, transfer: false });
t('...with the payer named in the sentence',
  'A payment of AED 2,000.00 is credited to your account 1234 by ACME TRADING LLC.',
  { type: 'income', amountFils: 200000, merchant: 'Incoming transfer' });
t('...on the short-gap "has been credited" variant',
  'Dear Customer, a payment of AED 1,500.00 has been credited to your account 1234. Ref TRF12345.',
  { type: 'income', amountFils: 150000 });
t('..."your payment" into your own account is still income',
  'Your payment of AED 5,000.00 has been credited to your account 1234. Balance AED 20,000.00',
  { type: 'income', amountFils: 500000, snapshotFils: 2000000 });
t('...and with no account number at all',
  'Your payment of AED 2,000.00 has been credited to your account. Available balance AED 32,000.00',
  { type: 'income', amountFils: 200000, snapshotFils: 3200000 });
// The negative control that located the bug: one word before "payment" used to
// defeat the rule and bring the sign back.
t('a dividend payment credited to your account is income',
  'A dividend payment of AED 1,200.00 has been credited to your account 1234.',
  { type: 'income', amountFils: 120000 });
// A bank is never the payee of money arriving in your own account.
t('a salary payment credited to a BANK-named account is still income',
  'Your salary payment of AED 12,000.00 has been credited to your RAKBANK account 1234.',
  { type: 'income', amountFils: 1200000, merchant: 'Salary', category: 'salary' });
t('profit credited to an Islamic savings account is income',
  'Profit of AED 34.22 has been credited to your ADIB Savings Account 1234.',
  { type: 'income', amountFils: 3422, merchant: 'Incoming transfer' });

// ── Paying a biller is spending, whatever verb the biller chose ──
// The first pass covered "credited" only, so the rest of the family still
// booked a bill payment as REVENUE: the spend vanishes and income appears.
t('a payment RECEIVED TOWARDS a biller account is a bill',
  'Payment of AED 350.00 received towards your DEWA account. Thank you.',
  { kind: 'transaction', type: 'expense', amountFils: 35000, merchant: 'DEWA',
    category: 'utilities', transfer: false });
t('..."received for your <biller> account" too',
  'Payment of AED 350.00 received for your DEWA account 123456. Thank you.',
  { type: 'expense', amountFils: 35000, merchant: 'DEWA', category: 'utilities' });
t('..."we have received X towards your <biller> account"',
  'We have received AED 350.00 towards your Etisalat account 9876.',
  { type: 'expense', amountFils: 35000, merchant: 'Etisalat', category: 'telecom' });
t('...and with no payment noun anywhere in the sentence',
  'Thank you. AED 500.00 received towards your Salik account.',
  { type: 'expense', amountFils: 50000, merchant: 'Salik', category: 'transport' });
t('a bare "credited to your du account" is a phone bill',
  'AED 200.00 has been credited to your du account 1234567.',
  { type: 'expense', amountFils: 20000, merchant: 'Du', category: 'telecom' });
t('...and so is "credited to your du BILL account"',
  'An amount of AED 200.00 was credited to your du bill account.',
  { type: 'expense', amountFils: 20000, merchant: 'Du', category: 'telecom' });

// ── A reporting period makes it a summary, however it is spelled ──
// "this month" was covered and "in the last 30 days" was not, so the same
// marketing message fabricated the same AED 4,320 purchase one word away from
// the fixture that was pinned.
t('a "last 30 days" recap does not fabricate a purchase',
  'Dear Customer, you spent AED 4,320.00 in the last 30 days. Download the ADCB app.', null);
t('...nor does it when the card is named',
  'You spent AED 4,320.00 in the last 30 days with your ADCB Credit Card.', null);
// "year to date" also hid behind the merchant gate: MERCHANT_RE read the "to"
// and filed the row under a shop called "Date".
t('a "year to date" recap is a summary, and "Date" is not a shop',
  'You spent AED 4,320.00 year to date with your ADCB Credit Card.', null);

// ── A figure in an offer is a threshold, not a posting ──
// No card, no merchant, no posting verb — just a number you would have to
// spend to qualify.
t('an instalment-plan threshold does not fabricate a purchase',
  'Enjoy 0% instalment plans on purchases above AED 1,000.00 with your Mashreq card.', null);
t('a points offer at "any store" does not fabricate a purchase',
  'Offer: Purchase of AED 250.00 at any store earns you double points this month.', null);
// The controls that were already right and must stay so.
t('a cashback offer is still skipped',
  'Get 50% cashback up to AED 200.00 when you use your ADCB card at Carrefour this weekend.', null);
t('a credit-limit increase is not a transaction',
  'Your credit limit has been increased to AED 50,000.00.', null);

// ── A future or scheduled event has not moved any money ──
// The real debit or credit arrives as its own SMS, so posting the forecast
// counts the same money twice.
t('a salary that WILL be credited is not credited yet',
  'Your salary of AED 15,000.00 will be credited on 25 Aug.', null);
t('a scheduled payment has not left the account',
  'A payment of AED 1,000.00 is scheduled from your account 1234 tomorrow.', null);
t('a fee the card WILL be charged is not charged yet',
  'Your ADCB card ending 4110 will be charged AED 199.00 for annual fee next month.', null);
t('an instalment that WILL be deducted is not deducted yet',
  'Loan instalment of AED 2,500.00 will be deducted from account 1234 on 05 Aug.', null);
// A returned cheque is money that stayed put, and it is stated in the perfect
// tense so no future rule can see it.
t('a cheque returned unpaid is money that did NOT leave',
  'Your cheque number 000123 for AED 2,500.00 has been returned unpaid.', null);
// The boundary: a real posting that mentions a future event in its footer
// keeps its row, and so does a standing instruction that has just RUN.
t('a future-instalment footer does not delete the posting it sits on',
  'AED 2,500.00 has been debited from your account 1234 for your loan. The next instalment will be deducted on 05 Sep.',
  { kind: 'transaction', type: 'expense', amountFils: 250000 });
t('a cashback-will-be-credited footer does not delete the purchase',
  'AED 250.00 spent at NOON with Credit Card 4110. Avl Cr AED 9,000.00. AED 25.00 cashback will be credited next month.',
  { type: 'expense', amountFils: 25000, merchant: 'Noon' });
t('"your SCHEDULED payment has been processed" is a posting, not a schedule',
  'Your scheduled payment of AED 1,000.00 has been processed from account 1234.',
  { kind: 'transaction', type: 'expense', amountFils: 100000 });

// ── The word OTP in a do-not-share clause is a footer ──
// This is the single commonest footer on a UAE card alert, and matching the
// bare noun deleted every purchase that carried one. Remove five characters —
// OTP for PIN — and the identical message imported fine, which is how 424
// passing tests sat on top of a live deletion.
const CARREFOUR_BAL = 'AED 89.50 spent at CARREFOUR using Debit Card 1234. Balance AED 5,376.00. ';
const CARREFOUR_ROW = {
  kind: 'transaction', type: 'expense', amountFils: 8950, merchant: 'Carrefour',
  category: 'groceries', card: { last4: '1234', kind: 'debit' }, snapshotFils: 537600,
  transfer: false,
};
for (const footer of [
  'Do not share your OTP or PIN with anyone.',
  'Never share your OTP with anyone.',
  'Bank will never ask for your OTP.',
  'Do not share your one-time password with anyone.',
  'For your security, never share your password or OTP.',
  'Do not share your security code with anyone.',
  'Bank will never ask for your verification code.',
  'Never share your security code.',
  'Beware of fraud: do not share your verification code.',
  'Do not disclose your PIN.',
]) {
  t(`a purchase survives the footer "${footer}"`, CARREFOUR_BAL + footer, CARREFOUR_ROW);
}
t('...and the "Avl Bal" rendering of the same alert',
  'AED 89.50 spent at CARREFOUR using Debit Card 1234. Avl Bal AED 5,376.00. Do not share your OTP with anyone.',
  { type: 'expense', amountFils: 8950, merchant: 'Carrefour', snapshotFils: 537600 });
t('the authentic ENBD "Do not share your OTP/PIN" footer keeps its purchase',
  'Your Credit Card 4110 was used for AED 250.00 at NOON on 31/07/2026. Avl Cr Limit AED 9,000.00. Do not share your OTP/PIN with anyone.',
  { type: 'expense', amountFils: 25000, merchant: 'Noon',
    card: { last4: '4110', kind: 'credit' }, snapshotFils: 900000, snapshotKind: 'limit' });
t('a one-time-password footer keeps its purchase',
  'AED 1,200.00 spent at EMIRATES using Credit Card 4110. Avl Cr AED 9,000.00. Your one-time password should never be shared.',
  { type: 'expense', amountFils: 120000 });
t('an OTP footer on an outgoing transfer keeps the transfer',
  'AED 5,000.00 transferred to AHMED ALI from your account 1234. Do not share your OTP.',
  { kind: 'transaction', type: 'expense', amountFils: 500000,
    card: { last4: '1234', kind: 'account' } });

// The boundary that keeps all of the above honest: a message whose SUBJECT is
// the code quotes its digits, and every one of those still dies. The
// discriminator is the digits, not the noun — a footer names the OTP too.
t('an OTP that quotes its code is still an OTP',
  'Your OTP is 458213 for a purchase of AED 260.00 at AMAZON.AE.', null);
t('"OTP for your transaction ... is NNNNNN" is still an OTP',
  'OTP for your transaction of AED 260.00 at NOON is 458213.', null);
t('a one-time password quoting its code is still an OTP',
  'Your one-time password is 458213. Valid for 5 minutes.', null);
t('"NNNNNN is your verification code" is still an OTP',
  '458213 is your verification code for a purchase of AED 260.00 at NOON with Credit Card 4110.', null);
t('"Use NNNNNN to complete" is still an OTP',
  'Use 458213 to complete your purchase of AED 260.00 at NOON.', null);

// ── A CODE CHALLENGE WITH A COUNTDOWN IS NOT A PURCHASE ──
//
// The worst phantom in the real accuracy report: six confirmed messages, up to
// AED 7,379.54 each, every one of them booked as spending. And they are not
// isolated — the challenge is followed by the POSTING for the same purchase
// (the report shows the pair: the AED 290.00 challenge at THE VIOLE, then
// "Purchase of AED 290.00 ... at FAT*THE VIOLE"), so EVERY online card payment
// this user made was counted twice.
//
// The discriminator is NOT the phrase "auth code" — that is also the acquirer's
// approval reference on a posted alert, and listing it once deleted every
// posting that quoted one (see the control block below, which is the older
// regression this must not undo). The discriminator is that a challenge code
// EXPIRES: it is quoted AND carries a validity window in minutes. An approval
// reference is a receipt and never has a countdown on one.
//
// Digits are masked here the way the app's own export masks them; the shape,
// which is what the parser matches on, is the real one.
t('an auth-code challenge with a 5-minute window is not a purchase',
  'DO NOT SHARE! The Auth code is 4606 for AED 272.00 at Next for card ending 1354. Use in 5 mins. If not requested call +971 600 50 0000',
  null);
t('...and the masked rendering the export produces is the same message',
  'DO NOT SHARE! The Auth code is ····4606 for AED 272.00 at Next for card ending 1354. Use in 5 mins. If not requested call +971 600 50 0000',
  null);
t('...at AED 7,379.54, which is what a missed one costs',
  'DO NOT SHARE! The Auth code is ····2427 for AED 7379.54 at AL AIN AHLIA for card ending 9190. Use in 5 mins. If not requested call +971 600 50 0000',
  null);
t('...and the AED 1.00 card-verification challenge',
  'DO NOT SHARE! The Auth code is ····6159 for AED 1.00 at CPAY-CARD-AED-ADYEN for card ending 1354. Use in 5 mins. If not requested call +971 600 50 0000',
  null);
// The second issuer wording: the code is at the END, after the whole
// transaction, and the window is its own sentence.
t('a DoubleSecure auth code that expires in 5 minutes is not a purchase',
  'Your DoubleSecure Auth Code for card ending 8783 at CPAY-CARD-AED of AED 1.00 is 5969. This code expires in 5 minutes. Do not share this code with anyone. If not requested, please contact +971 600 54 00 00',
  null);
t('...with a masked code and a real merchant behind it',
  'Your DoubleSecure Auth Code for card ending 8783 at AL ANSARI EXCHANGE LLC of AED 258.00 is ····3957. This code expires in 5 minutes. Do not share this code with anyone. If not requested, please contact +971 600 54 00 00',
  null);
t('...and the XPOWERPLUS one',
  'Your DoubleSecure Auth Code for card ending 8783 at XPOWERPLUS of AED 1.00 is ····6097. This code expires in 5 minutes. Do not share this code with anyone. If not requested, please contact +971 600 54 00 00',
  null);
// This one names itself an OTP and STILL fabricated AED 208: 92 characters of
// transaction sit between the noun and its digits, which overran the
// same-sentence gap OTP_RE allows.
t('an OTP whose code is 90+ characters after the noun is still an OTP',
  'Do not share your OTP with anyone. If not initiated by you, please call +971 600 50 2030. OTP for transaction at www landmarkgroup com for AED 208.00 on your ADCB Credit Card XXX7720 is ····6786. OTP valid for 10 minutes',
  null);

// CONTROLS — the approval reference on a POSTING keeps its money. Deleting
// these is the exact regression that removing "authorisation code" from the
// OTP vocabulary was meant to fix, so the suppression above is required to
// need the countdown as well as the noun.
t('an approval reference with no countdown is still a posting',
  'AED 250.00 spent at NOON with Credit Card 4110. Auth code 123456.',
  { type: 'expense', amountFils: 25000, merchant: 'Noon',
    card: { last4: '4110', kind: 'credit' } });
t('...spelled "Authorisation code", unlabelled and mid-message',
  'Your card ending 1234 was used for AED 231.95 at BUSINESS HUB GOVERNMEN. Authorisation code 998877. Available limit AED 1659.58.',
  { type: 'expense', amountFils: 23195, merchant: 'Business Hub Governmen' });
t('...and a 30-DAY window is an offer footer, not a code countdown',
  'AED 250.00 spent at NOON with Credit Card 4110. Authorisation code: 123456. Offer valid for 30 days.',
  { type: 'expense', amountFils: 25000, merchant: 'Noon' });
// A merchant whose NAME carries the vocabulary. The challenge rule reads a
// quoted code and a countdown, neither of which a descriptor can supply.
t('a purchase at a merchant named AUTH CODE CAFE is a purchase',
  'Purchase of AED 75.00 with Debit Card ending 1234 at AUTH CODE CAFE, Dubai. Avl Balance is AED 883.43.',
  { type: 'expense', amountFils: 7500, merchant: 'Auth Code Cafe' });
t('...and one at AUTHENTIC KEBAB HOUSE',
  'Purchase of AED 45.00 with Debit Card ending 1234 at AUTHENTIC KEBAB HOUSE, Dubai. Avl Balance is AED 883.43.',
  { type: 'expense', amountFils: 4500, merchant: 'Authentic Kebab House' });
// A validity window that belongs to the PURCHASE, under an OTP footer that
// names no digits. Both halves of the conjunction have to be present.
t('a footer naming the OTP beside an unrelated minutes window keeps the purchase',
  'AED 20.00 spent at RTA PARKING with Debit Card 1234. Your parking ticket is valid for 60 minutes. Do not share your OTP with anyone.',
  { type: 'expense', amountFils: 2000, merchant: 'RTA Parking' });
t('...and one where the footer, a reference number and a window are all present',
  'AED 89.50 spent at CARREFOUR using Debit Card 1234. Do not share your OTP with anyone. Ref: 123456. Offer valid for 30 minutes.',
  { type: 'expense', amountFils: 8950, merchant: 'Carrefour' });
// And the posting that arrives AFTER the challenge — the leg that must survive,
// because suppressing the challenge is only correct if this one is kept.
t('the posting the challenge was protecting is still imported',
  'Purchase of AED 290.00 with Debit Card ending 1354 at FAT*THE VIOLE, Dubai. Avl Balance is AED 45,506.98.',
  { kind: 'transaction', type: 'expense', amountFils: 29000,
    card: { last4: '1354', kind: 'debit' } });

// ── A LOYALTY RATE AND A QUALIFYING THRESHOLD ARE NOT AMOUNTS ──
//
// Real marketing from the same inbox, all booked as spending. The figure is a
// conversion rate ("2 bonus TPs for every AED 1 spent") or the threshold you
// must reach to qualify ("10X Shukrans on AED150 spent"). Note that "spent"
// appears in the real postings above too, so the word cannot be the
// discriminator — the grammar around the figure is.
t('"for every AED 1 spent" is a rate, not a AED 1 purchase',
  'Savour exquisite Indian delicacies at Gazebo and earn 2 bonus TPs for every AED 1 spent. Learn more at adcb.com/tpapp',
  null);
t('"on every AED 1 spent" is the same rate, on a card that is only named',
  'In celebration of your birthday month, earn up to 50,000 extra FAB Rewards! Use your FAB credit card and get extra 2 FAB rewards on every AED 1 spent. To start earning, SMS BDAY to 2121. Conditions apply.',
  null);
t('"up to 10X Shukrans on AED150 spent" is a threshold, not AED 150 spent',
  "Get up to 10X Shukrans on AED150 spent and 500 Bonus on 3 spends each of 150 AED till 19 Nov'23 in our 13th Anniversary.",
  null);
// CONTROLS — the same rewards wording stapled to a real card alert, and the
// ordinary posting whose amount IS the subject of "spent".
t('a rewards line on a real card charge does not delete the charge',
  'Your Credit Card 4110 has been charged AED 24.90 for LIV PRIME. Earn 2 rewards for every AED 1 spent.',
  { type: 'expense', amountFils: 2490, card: { last4: '4110', kind: 'credit' } });
t('"AED 150.00 spent at ..." is a posting, not a threshold',
  'AED 150.00 spent at CARREFOUR with Credit Card 4110. Avl Cr AED 5,000.00.',
  { type: 'expense', amountFils: 15000, merchant: 'Carrefour', category: 'groceries' });

// ── The fraud-reporting footer is not a decline ──
// "If this was not authorised by you, please call ..." is stapled to POSTED
// alerts by nearly every UAE issuer, and DECLINED_RE's "not authoris" and
// "unauthoris" deleted the posting underneath it. Blast radius: every issuer
// that uses it.
t('an "if this was not authorised" footer does not delete the purchase',
  'Dear Customer, AED 89.50 was spent at CARREFOUR on your Debit Card ending 1234. If this was not authorised by you, please call 600 54 0000 immediately.',
  { kind: 'transaction', type: 'expense', amountFils: 8950, merchant: 'Carrefour',
    category: 'groceries', card: { last4: '1234', kind: 'debit' } });
for (const footer of [
  'If you have not authorised this transaction, call 600522228.',
  'To report an unauthorised transaction call 600522228.',
  'Report unauthorised use to 600522228.',
  'Please call us if this was not you.',
]) {
  t(`a purchase survives the fraud footer "${footer}"`,
    `AED 89.50 spent at CARREFOUR using Debit Card 1234. Avl Bal AED 5,376.00. ${footer}`,
    { type: 'expense', amountFils: 8950, merchant: 'Carrefour', snapshotFils: 537600,
      card: { last4: '1234', kind: 'debit' } });
}
t('"if you did not authorise this" is a footer, not a decline',
  'A purchase of AED 250.00 at NOON was made using your Credit Card 4110. If you did not authorise this, call us.',
  { type: 'expense', amountFils: 25000, merchant: 'Noon',
    card: { last4: '4110', kind: 'credit' } });

// ...and the indicative form, which is a real decline, still deletes it.
t('"your transaction was not authorised" is a decline',
  'Your transaction of AED 250.00 at NOON was not authorised.', null);
t('a card declined for insufficient funds is a decline',
  'Your card was declined for AED 250.00 at NOON due to insufficient funds.', null);

// ── A refusal the merchant descriptor swallowed is still a refusal ──
// maskMerchantNames blanks the descriptor so a shop called TIMEOUT MARKET
// cannot read as a reason code — but the descriptor runs to the end of the
// clause, so it also HID the refusal, and a declined AED 250 was imported as a
// real purchase titled "Noon Declined Due To Insufficient Funds".
t('a decline whose verb sits inside the descriptor is still a decline',
  'Your transaction of AED 250.00 at NOON declined due to insufficient funds.', null);
t('...on insufficient BALANCE too',
  'Transaction of AED 250.00 at SPINNEYS declined due to insufficient balance.', null);
t('...on a timeout',
  'Your transaction of AED 250.00 at NOON timed out. Please retry.', null);
t('...on a bare failure',
  'Your transaction of AED 250.00 at CARREFOUR failed. Please retry.', null);
t('...and on a failed biller payment',
  'Your payment of AED 250.00 to DEWA failed. Please retry.', null);
// The collision this must not reintroduce: the shop names stay shops, because
// the unmasked pass only reads VERBAL forms no descriptor contains.
t('TIME OUT MARKET survives the unmasked decline pass',
  'AED 32.00 spent at TIMEOUT MARKET DUBAI with Debit Card 1234',
  { type: 'expense', amountFils: 3200, merchant: 'Timeout Market' });
t('ACCESS DENIED CAFE survives the unmasked decline pass',
  'AED 25.00 spent at ACCESS DENIED CAFE with Debit Card 1234',
  { type: 'expense', amountFils: 2500 });

// ── An EPP offer is appended to the purchase it advertises against ──
// ADCB, RAKBANK and Emirates NBD all staple the conversion pitch to the alert
// for the purchase that triggered it, so this gate deleted exactly the large
// purchases banks pitch EPP on.
t('a "Convert now to 0% EPP" footer does not delete the purchase',
  'AED 1,850.00 spent at SHARAF DG on Credit Card 4110. Convert now to 0% EPP. Avl Cr AED 10,000.00',
  { kind: 'transaction', type: 'expense', amountFils: 185000, merchant: 'Sharaf Dg',
    category: 'shopping', card: { last4: '4110', kind: 'credit' } });
t('...nor does an "Easy Payment Plan" footer',
  'AED 3,000.00 spent at SHARAF DG with Credit Card 4110. Avl Cr AED 12,000.00. Convert now to Easy Payment Plan.',
  { type: 'expense', amountFils: 300000, merchant: 'Sharaf Dg' });
t('...nor an "interest payment plan" footer',
  'AED 2,500.00 spent at IKEA with Credit Card 4110. Avl Cr AED 6,000.00. Interest payment plan available.',
  { type: 'expense', amountFils: 250000, merchant: 'Ikea' });
// A standalone offer restates the purchase in the PRESENT and has no settled
// tense anywhere, so it is still skipped — the purchase it quotes is already
// on the ledger from its own alert.
t('a standalone EPP offer is still skipped',
  'Convert your purchases to 0% Easy Payment Plan. Call now.', null);

// ── The release of a hold IS the settlement notice ──
// The parser's own comment says the real charge "arrives as its own SMS", and
// this is that SMS: the hold-release sentence is the one sentence that proves
// the money moved, and PREAUTH_RE fired on it.
t('a released authorisation hold does not delete the settlement',
  'AED 1,500.00 charged at ROVE HOTEL with Credit Card 4110. The authorisation hold has been released.',
  { kind: 'transaction', type: 'expense', amountFils: 150000, merchant: 'Rove Hotel',
    category: 'travel', card: { last4: '4110', kind: 'credit' } });
t('..."Pre-authorisation released" too',
  'AED 1,500.00 charged at ROVE HOTEL with Credit Card 4110. Pre-authorisation released.',
  { type: 'expense', amountFils: 150000, merchant: 'Rove Hotel' });
t('...and a released TEMPORARY hold quoted with its own figure',
  'AED 250.00 spent at ENOC with Debit Card 1234. Your earlier temporary hold of AED 300.00 is released.',
  { type: 'expense', amountFils: 25000, merchant: 'ENOC', category: 'transport',
    card: { last4: '1234', kind: 'debit' } });
// The hold itself is still dropped, quoted balance and all — an evidence gate
// would have let every one of these through, which is why the RELEASE clause
// is anchored instead.
t('a hold that was PLACED is still a hold',
  'An authorisation hold of AED 1,500.00 has been placed on your Credit Card 4110 at ROVE HOTEL.', null);
t('a blocked amount is still a hold, even beside an available limit',
  'AED 900.00 has been blocked on your Credit Card 4110 at ROVE HOTEL. Avl Cr AED 7,000.00', null);
t('a pre-authorisation is still a hold, even beside an available limit',
  'A pre-authorisation of AED 900.00 has been placed on your Credit Card 4110 at HERTZ. Avl Cr AED 7,000.00', null);

// ── A refund is a posting, so a footer must not delete it ──
// The evidence gate is a FLOOR, not a whitelist of sentence shapes: the bare
// "AED N refunded to your card" — how most issuers word it — carried no listed
// verb phrase, so a PIN footer deleted money coming back. A deleted refund is
// money the ledger keeps counting as spent.
t('a refund carrying a PIN footer is still a refund',
  'AED 350.00 refunded to your Credit Card 4110 by NOON. Do not disclose your PIN.',
  { kind: 'transaction', type: 'income', amountFils: 35000, merchant: 'Refund',
    card: { last4: '4110', kind: 'credit' } });
t('...and one carrying an OTP footer',
  'AED 350.00 refunded to your Credit Card 4110 by NOON. Never share your OTP.',
  { type: 'income', amountFils: 35000, merchant: 'Refund' });
t('...and the perfect-tense wording that already worked',
  'AED 350.00 has been refunded to your Credit Card 4110 by NOON. Do not disclose your PIN.',
  { type: 'income', amountFils: 35000, merchant: 'Refund' });

// ── A field-list alert carries no verb, and is still a posting ──
// The gate must not apply a stricter standard than the code path it guards:
// the parser reads an amount, a card, a merchant and a date as a purchase
// everywhere else.
t('a terse comma-delimited alert survives a security footer',
  'Transaction alert: AED 89.50, CARREFOUR, Debit Card 1234, 31/07/2026. Do not share this with anyone.',
  { kind: 'transaction', type: 'expense', amountFils: 8950, category: 'groceries',
    card: { last4: '1234', kind: 'debit' } });
t('...and reads the same way without one',
  'Transaction alert: AED 89.50, CARREFOUR, Debit Card 1234, 31/07/2026.',
  { type: 'expense', amountFils: 8950, card: { last4: '1234', kind: 'debit' } });

// ══════════════════════ Arabic ══════════════════════
//
// UAE banks send the same alert in Arabic, in English, or with both halves in
// one body. None of this is a second parser: it is the SAME grammar carrying
// an Arabic vocabulary, on a message that has been normalised into one
// spelling first.
//
// The literals below are written the way a BANK sends them — with ة, ى, أ,
// tatweel and Arabic-Indic digits. The parser folds them; the rules inside the
// parser are written post-fold. If a rule is ever written the natural way it
// will silently never fire, and these are the tests that catch it.

// ── The baseline Arabic purchase ──
// د.إ already worked; everything else here is new. Note the balance is
// suppressed as the amount and still captured as the snapshot — the same
// double duty BALANCE_PREFIX_RE does in English.
t('an Arabic purchase: verb, payee, card and balance',
  'شراء بمبلغ د.إ 150.00 لدى كارفور بالبطاقة المنتهية 1234. الرصيد المتاح د.إ 9,149.34',
  { kind: 'transaction', type: 'expense', amountFils: 15000, merchant: 'كارفور',
    category: 'groceries', card: { last4: '1234', kind: 'debit' }, transfer: false,
    snapshotFils: 914934, snapshotKind: 'balance', date: null });

// "درهم" spelled out is a currency the parser could not see, so the whole
// message was dropped. The payee clause is the other half of this case: the
// message names the card with من AND the shop with لدى, and a stop-list applied
// after the match had already consumed past the shop returned the plumbing as
// the merchant name.
t('the word "درهم" is a currency, and من-the-card is not the payee',
  'تم خصم مبلغ 75.50 درهم من بطاقتك المنتهية بـ4833 لدى مطعم الطازج',
  { kind: 'transaction', type: 'expense', amountFils: 7550, merchant: 'مطعم الطازج',
    category: 'dining', card: { last4: '4833', kind: 'debit' } });

// ── Arabic-Indic digits and separators: silent WRONG NUMBERS, not nulls ──
// JS \d is ASCII-only, so nothing numeric matches until the digits are folded.
t('Arabic-Indic digits in the amount, the fils and the card',
  'شراء بمبلغ ١٥٠٫٧٥ درهم لدى صيدلية النهدي بالبطاقة المنتهية ١٢٣٤',
  { type: 'expense', amountFils: 15075, merchant: 'صيدلية النهدي', category: 'health',
    card: { last4: '1234', kind: 'debit' } });

// The worst of the lot: U+066C is a THOUSANDS separator and was not in
// [\d,], so extraction stopped at the first group and AED 12,345.67 was
// recorded as AED 12.00 — a 1000x under-record with no null, no error and
// nothing for the user to notice.
t('the Arabic thousands separator does not truncate the amount',
  'شراء بمبلغ ١٢٬٣٤٥٫٦٧ درهم لدى ايكيا',
  { type: 'expense', amountFils: 1234567, merchant: 'ايكيا', category: 'shopping', card: null });

// The same separator inside a fully ENGLISH body — banks emit them on
// Arabic-locale handsets. Normalisation therefore runs on every message, never
// behind an is-this-Arabic branch.
t('an Arabic separator inside an English message is still a separator',
  'Purchase of AED 12٬345.67 at CARREFOUR with card ending 1234.',
  { type: 'expense', amountFils: 1234567, merchant: 'Carrefour', category: 'groceries' });

// One invisible RLM between the currency and the digits nulled the entire
// message. Banks inject them around every number in Arabic and bilingual
// bodies, so this was total silent loss on an English template.
t('a single bidi mark does not delete the transaction',
  'Purchase of AED ‏150.00 at CARREFOUR with card ending 1234.',
  { kind: 'transaction', amountFils: 15000, merchant: 'Carrefour', category: 'groceries',
    card: { last4: '1234', kind: 'unknown' } });

// ── Polarity, in Arabic ──
// إيداع and راتب have to reach the credit side, and راتب has to reach the
// salary test — income short-circuits before the keyword list. The merchant
// must stay the structural title: "في حسابك" is plumbing, and reading it as a
// payee invents one.
t('an Arabic salary credit is income, with no invented payee',
  'تم إيداع راتب بمبلغ 18,500.00 درهم في حسابك المنتهي 5678',
  { kind: 'transaction', type: 'income', amountFils: 1850000, merchant: 'Salary',
    category: 'salary', card: { last4: '5678', kind: 'account' } });

// Four hooks at once: the Arabic ATM words pin the title, بتاريخ carries the
// date, الرصيد المتاح is a snapshot and not the amount, and "من جهاز" is
// rejected as a payee. الآلي folds to الالي — a rule written with the madda
// can never fire, which is the single most likely implementation mistake here.
t('an Arabic ATM withdrawal',
  'سحب نقدي بمبلغ 500.00 درهم من جهاز الصراف الآلي بتاريخ 12/07/2026. الرصيد المتاح 3,210.38 درهم',
  { kind: 'transaction', type: 'expense', amountFils: 50000, merchant: 'ATM withdrawal',
    category: 'other', date: '2026-07-12', snapshotFils: 321038, snapshotKind: 'balance' });

// ── The suppression gates, in Arabic ──
// These are dangerous in the OPPOSITE direction to everything above: each one
// carries a real debit verb and a real amount, so the moment the Arabic
// vocabulary landed they would have posted as money that never moved. The gate
// has to be Arabic-aware from the first commit, not after.
t('an Arabic OTP is an attempt, not a transaction',
  'رمز التحقق الخاص بك لعملية شراء بمبلغ 260.00 درهم هو 482910. لا تشارك هذا الرمز مع أحد.',
  null);
t('an Arabic decline did not move money',
  'عملية الشراء بمبلغ 500.00 درهم لدى شرف دي جي مرفوضة لعدم كفاية الرصيد.',
  null);
t('an Arabic pre-auth hold is not a posting',
  'تم حجز مبلغ 300.00 درهم على بطاقتك المنتهية 1234.',
  null);

// ── Bilingual bodies ──
// One purchase, both languages, one body. English wins wherever both halves
// carry the same fact: the Latin name is what SERVICE_NAMES, the merchant
// overrides and subscription grouping are all keyed on.
t('a bilingual alert is one row, and the English name wins',
  'Purchase of AED 50.00 at CARREFOUR with Credit Card ending 1234.\nشراء بمبلغ 50.00 درهم لدى كارفور بالبطاقة الائتمانية المنتهية 1234.',
  { kind: 'transaction', type: 'expense', amountFils: 5000, merchant: 'Carrefour',
    category: 'groceries', card: { last4: '1234', kind: 'credit' } });

t('English still wins when the Arabic half comes first',
  'تم خصم 250.00 درهم لدى نون\nAED 250.00 was debited at NOON with card ending 4110',
  { kind: 'transaction', type: 'expense', amountFils: 25000, merchant: 'Noon',
    category: 'shopping', card: { last4: '4110', kind: 'unknown' } });

// The batch path splits on blank lines, so a bilingual alert whose halves are
// blank-line separated became TWO transactions for one purchase and doubled
// the user's spending. It affects the paste path and the Worker; the device
// path calls parseSms per message and was always safe.
{
  const rows = parseSmsBatch(
    'Purchase of AED 50.00 at CARREFOUR with Credit Card ending 1234.\n\nشراء بمبلغ 50.00 درهم لدى كارفور بالبطاقة الائتمانية المنتهية 1234.',
  );
  ok('a blank-line-separated bilingual alert is not counted twice',
    rows.length === 1 && rows[0].amountFils === 5000 && rows[0].merchant === 'Carrefour',
    `got ${rows.length} rows: ${JSON.stringify(rows.map((r) => [r.amountFils, r.merchant]))}`);
}
// ...but two real charges of the same amount on the same card in one paste are
// two charges. The collapse only fires across SCRIPTS, so this must stay 2.
{
  const rows = parseSmsBatch(
    'AED 4.00 was debited at SALIK with card ending 1234.\n\nAED 4.00 was debited at SALIK with card ending 1234.',
  );
  ok('two identical English charges in one paste are still two rows',
    rows.length === 2, `got ${rows.length}`);
}
// ...and the collapse never compared the MERCHANT, so two DIFFERENT purchases
// that happened to agree on amount, card and day — one alert in each language,
// which is exactly what a bilingual handset receives — merged into one and the
// user's coffee simply never happened.
{
  const rows = parseSmsBatch(
    'AED 50.00 spent at CARREFOUR with Debit Card 1234 on 05/07/2026\n\nتم شراء بمبلغ 50.00 درهم لدى ستاربكس من بطاقتك المنتهية 1234 بتاريخ 05/07/2026',
  );
  ok('two different shops across the two scripts are two rows, not one',
    rows.length === 2,
    `got ${rows.length} rows: ${JSON.stringify(rows.map((r) => [r.amountFils, r.merchant]))}`);
}
// The restatement it must still collapse: same amount, same card, same day AND
// the same shop under its two spellings.
{
  const rows = parseSmsBatch(
    'AED 50.00 spent at CARREFOUR with Debit Card 1234 on 05/07/2026\n\nتم شراء بمبلغ 50.00 درهم لدى كارفور من بطاقتك المنتهية 1234 بتاريخ 05/07/2026',
  );
  ok('the same shop in both scripts still collapses to the Latin row',
    rows.length === 1 && rows[0].merchant === 'Carrefour',
    `got ${rows.length} rows: ${JSON.stringify(rows.map((r) => [r.amountFils, r.merchant]))}`);
}
// A credit and a debit of the same amount on the same card are two events,
// whatever scripts they arrive in.
{
  const rows = parseSmsBatch(
    'AED 50.00 was refunded to your card 1234 on 05/07/2026\n\nتم خصم 50.00 درهم من بطاقتك المنتهية 1234 بتاريخ 05/07/2026',
  );
  ok('opposite directions never collapse into one row', rows.length === 2, `got ${rows.length}`);
}

// ── Cross-script merchant identity ──
//
// categoryGuess was tried as a proxy for "is this the same shop" and is far
// too coarse in BOTH directions, so it produced one blocker each way.
//
// It SPLIT restatements: the Latin brand table knows SHARAF DG is shopping and
// has no entry for شرف دي جي, which guesses "other", so one AED 200 purchase
// became AED 400 of spending. A guess of "other" means "I do not know" — it is
// not a claim that this is a different shop. Nothing downstream rescues it:
// auto-import's dedupe key is (date, amount, title) and the two titles differ.
for (const [latin, arabic, amount] of [
  ['SHARAF DG', 'شرف دي جي', 20000],
  ['VIRGIN MEGASTORE', 'فيرجن ميجاستور', 20000],
  ['HOME CENTRE', 'هوم سنتر', 20000],
  ['ZARA HOME', 'زارا هوم', 25000],
  ['ADNOC', 'ادنوك', 20000],
  ['CARREFOUR', 'كارفور', 8950],
  ['LULU', 'لولو', 6000],
  ['STARBUCKS', 'ستاربكس', 6000],
  ['TALABAT', 'طلبات', 4500],
]) {
  const money = (amount / 100).toFixed(2);
  const rows = parseSmsBatch(
    `AED ${money} spent at ${latin} with Debit Card 1234\n\nتم شراء بمبلغ ${money} درهم لدى ${arabic} من بطاقتك 1234`,
  );
  ok(`${latin} and ${arabic} are one purchase, not two`,
    rows.length === 1 && rows[0].amountFils === amount,
    `got ${rows.length} rows: ${JSON.stringify(rows.map((r) => [r.amountFils, r.merchant]))}`);
  // ...in either message order, and the Latin row is the one kept.
  const flipped = parseSmsBatch(
    `تم شراء بمبلغ ${money} درهم لدى ${arabic} من بطاقتك 1234\n\nAED ${money} spent at ${latin} with Debit Card 1234`,
  );
  ok(`...and with the Arabic half first, the Latin row wins (${latin})`,
    flipped.length === 1 && !/[؀-ۿ]/.test(flipped[0].merchant),
    `got ${flipped.length} rows: ${JSON.stringify(flipped.map((r) => r.merchant))}`);
}

// ...and it MERGED distinct shops, because a category is not an identity:
// Amazon and نون are both shopping, Carrefour and لولو are both groceries,
// Talabat and ستاربكس are both dining. Each of those pairs lost a real
// purchase — two AED 150 purchases became one.
for (const [latin, arabic] of [
  ['AMAZON', 'نون'],
  ['CARREFOUR', 'لولو'],
  ['TALABAT', 'ستاربكس'],
  ['IKEA', 'ستاربكس'],
  ['SPINNEYS', 'نون'],
]) {
  const rows = parseSmsBatch(
    `AED 150.00 spent at ${latin} with Debit Card 1234\n\nتم شراء بمبلغ 150.00 درهم لدى ${arabic} بطاقتك 1234`,
  );
  ok(`${latin} and ${arabic} are two purchases, not one`,
    rows.length === 2,
    `got ${rows.length} rows: ${JSON.stringify(rows.map((r) => [r.amountFils, r.merchant]))}`);
}

// ── Money moved but was not spent ──
// Settling a credit card. transferHint is the only thing keeping the whole
// card balance out of the month's spending. Needs the card STEM (بطاقتك will
// never match a literal بطاقة) and الائتمانية resolving the kind to credit.
t('an Arabic credit-card settlement is a transfer, not spending',
  'تم سداد بطاقتك الائتمانية المنتهية 4833 بمبلغ 7,663.94 درهم',
  { type: 'expense', amountFils: 766394, transfer: true, category: 'other',
    card: { last4: '4833', kind: 'credit' } });

// ── A reminder is not a posting ──
// This is where a bare "دفع" as a debit verb breaks everything: "مستحقة الدفع"
// contains it, isBillDue requires !hasDebit, and every Arabic bill reminder
// would post as a real AED 450 expense that never happened.
t('an Arabic bill reminder is a due, not an expense',
  'فاتورة هيئة كهرباء ومياه دبي بمبلغ 450.00 درهم مستحقة الدفع بتاريخ 25/07/2026',
  { kind: 'billDue', type: 'expense', amountFils: 45000, merchant: 'هيئة كهرباء ومياه دبي',
    category: 'utilities', date: '2026-07-25', dueDay: 25 });

// The total has to beat the minimum, exactly as it does in English — read the
// wrong one and the row records AED 162 for a AED 3,240 statement.
t('an Arabic card statement: total beats minimum, and the minimum survives',
  'كشف حساب البطاقة المنتهية 4833: إجمالي المبلغ المستحق 3,240.00 درهم، الحد الأدنى للدفع 162.00 درهم، تاريخ الاستحقاق 05/08/2026',
  { kind: 'cardStatement', amountFils: 324000, minDueFils: 16200, merchant: 'Card •4833',
    card: { last4: '4833', kind: 'credit' }, date: '2026-08-05', dueDay: 5 });

// ── Vocabulary and spelling variants ──
// The native-script twin of the transliterated trade words (mataam, qahwa).
// مقهى folds to مقهي, so the category here comes from قهوه — a rule spelled
// مقهى would never fire.
t('an Arabic cafe is dining, and the name runs to the end',
  'شراء بمبلغ 42.00 درهم لدى مقهى القهوة العربية بالبطاقة المنتهية 1234',
  { amountFils: 4200, merchant: 'مقهى القهوة العربية', category: 'dining',
    card: { last4: '1234', kind: 'debit' } });

// Tatweel is elective letter-stretching used for RTL justification and a
// damma is a vowel mark: درهــم is not درهم and خصــم is not خصم until both
// are stripped, so every token in this message failed to match.
t('tatweel and harakat are decoration, not spelling',
  'تم خصــم مبلغ 60.00 درهــم لدى مطعمٌ الشـام',
  { amountFils: 6000, merchant: 'مطعم الشام', category: 'dining' });

// One brand, two spellings across banks. The fold is what stops إيكيا and
// ايكيا becoming two merchants in every grouping, override lookup and
// subscription check — while the row still SHOWS the bank's own spelling.
// The ADIB/DIB word order: the payee and the funding card in one clause,
// separated by the bare preposition من. With no stop for it the capture ran
// straight through and the row was titled "كارفور من" — one shop under two
// identities, which fragments every merchant override, subscription grouping
// and per-merchant total between them.
t('the payee stops at "من بطاقتك", not after it',
  'تم شراء بمبلغ 75.50 درهم لدى كارفور من بطاقتك المنتهية 4833',
  { type: 'expense', amountFils: 7550, merchant: 'كارفور', category: 'groceries',
    card: { last4: '4833', kind: 'debit' } });

// ...and the same stop must not cut a name that BEGINS with من. Arabic trade
// names do: منازل الشام is a real Sharjah restaurant group.
t('a merchant whose name starts with من survives the stop',
  'تم شراء بمبلغ 60.00 درهم لدى منازل الشام من بطاقتك المنتهية 4833',
  { amountFils: 6000, merchant: 'منازل الشام' });

t('an alef-hamza spelling categorises like its plain twin, and keeps its spelling',
  'شراء بمبلغ 30.00 درهم لدى إيكيا بالبطاقة المنتهية 1234',
  { amountFils: 3000, merchant: 'إيكيا', category: 'shopping',
    card: { last4: '1234', kind: 'debit' } });

// The merchant is sliced out of the UN-folded text. Slice it out of the folded
// text instead and the user is shown "هييه كهرباء ومياه دبي" for a bank that
// wrote "هيئة" — a corrupted name that also splits the override key in two.
{
  const p = parseSms('فاتورة هيئة كهرباء ومياه دبي بمبلغ 450.00 درهم مستحقة الدفع بتاريخ 25/07/2026');
  ok('a merchant name keeps the bank\'s own orthography',
    p && p.merchant.includes('هيئة'), `merchant was "${p && p.merchant}"`);
}
// And `raw` is the text the BANK sent, bidi marks and all: it is what the
// accuracy report shows the user when they report an unparsed format.
{
  const msg = 'Purchase of AED ‏150.00 at CARREFOUR with card ending 1234.';
  const p = parseSms(msg);
  ok('the raw field is the bank\'s own text, not the normalised one',
    p && p.raw === msg, `raw was ${JSON.stringify(p && p.raw)}`);
}

// ── The connector before the card, in every word order ──
// The stop list knew only the bare من, so the SAME shop came back under a
// different name for every connector a bank chose: "كارفور باستخدام", "كارفور
// على", "كارفور بواسطة". باستخدام ("using your card") is the commonest of them
// in Emirates NBD and ADCB Arabic alerts — more common than the من case that
// was fixed — so this was the larger half of the bug. One shop under four
// identities fragments every merchant override, subscription grouping and
// per-merchant total between them.
for (const [connector, order] of [
  ['', 'لدى كارفور بطاقتك'],
  ['من', 'لدى كارفور من بطاقتك'],
  ['باستخدام', 'لدى كارفور باستخدام بطاقتك'],
  ['على', 'لدى كارفور على بطاقتك'],
  ['بواسطة', 'لدى كارفور بواسطة بطاقتك'],
]) {
  t(`the Arabic payee stops before "${connector || '(no connector)'} بطاقتك"`,
    `تم شراء بمبلغ 250.00 درهم ${order} 1234`,
    { type: 'expense', amountFils: 25000, merchant: 'كارفور', category: 'groceries',
      card: { last4: '1234', kind: 'debit' } });
}
t('...and the same holds for a dining payee',
  'تم شراء بمبلغ 250.00 درهم لدى ستاربكس باستخدام بطاقتك 1234',
  { amountFils: 25000, merchant: 'ستاربكس', category: 'dining' });
// ...and none of the connectors may cut a trade name that BEGINS with one.
// منازل الشام is a real Sharjah restaurant group and علي بابا is Alibaba.
t('a merchant whose name starts with من survives every connector stop',
  'تم شراء بمبلغ 250.00 درهم لدى منازل الشام بطاقتك 1234',
  { amountFils: 25000, merchant: 'منازل الشام' });
t('a merchant whose name starts with على survives too',
  'تم شراء بمبلغ 250.00 درهم لدى علي بابا بطاقتك 1234',
  { amountFils: 25000, merchant: 'علي بابا' });

// ── The Arabic mirror of the OTP footer ──
// رمز التحقق sat in the unconditional half while لا تشارك had been moved into
// the gated one, so the IDENTICAL do-not-share footer deleted the purchase or
// not depending on which noun the bank happened to choose. لا تفصح عن رمز
// التحقق is the standard Arabic rendering of "do not disclose your
// verification code".
t('an Arabic purchase survives "لا تفصح عن رمز التحقق"',
  'شراء بمبلغ AED 89.50 لدى كارفور من بطاقتك 1234. لا تفصح عن رمز التحقق لاحد.',
  { kind: 'transaction', type: 'expense', amountFils: 8950, merchant: 'كارفور',
    category: 'groceries', card: { last4: '1234', kind: 'debit' } });
t('...and "لا تشارك رمز التحقق مع أحد"',
  'تم شراء بمبلغ 89.50 درهم لدى كارفور بطاقتك 1234. لا تشارك رمز التحقق مع أحد',
  { type: 'expense', amountFils: 8950, merchant: 'كارفور' });
t('...and "لن يطلب البنك رمز التحقق الخاص بك"',
  'تم شراء بمبلغ 89.50 درهم لدى كارفور بطاقتك 1234. لن يطلب البنك رمز التحقق الخاص بك',
  { type: 'expense', amountFils: 8950, merchant: 'كارفور' });
t('...and the الرمز السري footer that was already gated',
  'تم خصم 250.00 درهم لدى نون من بطاقتك 4110. لا تشارك الرمز السري مع احد.',
  { type: 'expense', amountFils: 25000, merchant: 'نون', category: 'shopping' });
// The boundary: an Arabic OTP that QUOTES its code still dies.
t('an Arabic OTP quoting its code is still an OTP',
  'رمز التحقق الخاص بك هو 458213 لعملية شراء بمبلغ 260.00 درهم لدى نون', null);

// ── Found while building the above, English-only, same class of bug ──
// CATEGORY_KEYWORDS carried an unanchored 7-?11, and guessCategory is fed the
// WHOLE message — so any card, account or reference number containing 711
// filed the row as groceries.
t('a card number containing 711 is not a 7-Eleven',
  'AED 75.50 was debited with Debit Card ending 4711',
  { type: 'expense', amountFils: 7550, category: 'other', card: { last4: '4711', kind: 'debit' } });
t('...and neither is 7110',
  'AED 20.00 was debited with Debit Card ending 7110',
  { type: 'expense', amountFils: 2000, category: 'other' });
t('a real 7-Eleven still is one',
  'AED 20.00 was debited at 7-ELEVEN with Debit Card ending 4822',
  { type: 'expense', amountFils: 2000, merchant: '7-eleven', category: 'groceries' });

// ═════════════════════════════════════════════════════════════════════════
//  BANK COVERAGE
// ═════════════════════════════════════════════════════════════════════════
//
// One section per UAE bank, so a reader can see at a glance which bank has
// which of its formats covered. Every fixture is tagged with its PROVENANCE
// and the tag is printed with the assertion:
//
//   REAL   transcribed character-for-character from
//          scripts/test/fixtures/uae-accuracy-report.txt, with the report's
//          own message number. Ground truth. Change the expectation only if
//          you have decided the parser SHOULD read a real message differently.
//   RECON  reconstructed. The SHAPE is modelled on the real families and the
//          product vocabulary is real ("Covered Card", "Murabaha", "Saving
//          Space", "RAKMoneyTransfer"), but the exact sentence is not a
//          message anyone received. Never cite one of these as evidence of
//          what a bank sends.
//
// ── About bank attribution ──
//
// Not one of the 26 real message bodies names its own bank, except HSBC.
// "From HSBC:" is the only in-body bank marker in the whole corpus. Every
// other UAE bank identifies itself through the SMS SENDER ID alone, which is
// why parseSms now takes an optional { sender } and why a fixture with a bank
// name stuffed into its body would be LESS realistic, not more.
//
// So the bank named on each section below is an attribution, not something
// the parser reads out of the text:
//
//   HSBC          certain — it is written in the body.
//   ENBD / Liv    high — one core platform, two brands; the "Purchase of ...
//                 with ... Card ending ... at ..." and "has been debited from
//                 your account no. 095…" families are theirs, and the 095/096
//                 account prefixes are Emirates NBD's.
//   ADCB          medium-high for the multi-line block, medium for
//                 "Card ending *** ####".
//   Mashreq       medium — "Payment for <MERCHANT> of AED <n> has been made
//                 using Credit Card ending with <4>" is definitely not
//                 ENBD/Liv or ADCB; Mashreq and CBD are the two candidates.
//   FAB           medium — the "Card No" + "Avl Bal" rendering of the block.
//   ADIB/RAKBANK/
//   Wio/DIB       reconstructed throughout; see each section.
//
// Every fixture is asserted WITHOUT a sender unless the assertion is
// specifically about sender awareness, because the Cloudflare Worker ingest
// path has no sender to give. The sender-gated cases are grouped at the end of
// each section and always come in pairs: same message, with and without.

const coverage = [];
let currentBank = '';
function bank(name, senders, note) {
  currentBank = name;
  console.log(`\n── ${name}  (sender IDs: ${senders})`);
  if (note) console.log(`   ${note}`);
}
/** A format this bank sends. `src` is 'REAL' (corpus) or 'RECON' (reconstructed). */
function fmt(src, format, msg, expect, options) {
  coverage.push([currentBank, format, src]);
  t(`${currentBank} · [${src}] ${format}`, msg, expect, options);
}

// ─────────────────────────── HSBC ───────────────────────────
bank('HSBC', '"HSBC"', 'The one bank that writes its name in the body.');

// REAL corpus #10 (seen 5x). Merchant sits BEFORE the verb, and the sign
// suffix on the amount carries direction: "-" out, "+" in.
fmt('REAL', 'purchase — merchant before the verb, "AED n-" sign suffix',
  'From HSBC: 24JUN25 DUBAI INTEGRATED ECO Purchase from 041-340***-001 AED 10.00- by Card Ending with 6737. Your available balance is AED 1,430.28',
  { kind: 'transaction', type: 'expense', amountFils: 1000, merchant: 'Dubai Integrated Economic Zones',
    card: { last4: '6737', kind: 'unknown' }, snapshotFils: 143028, snapshotKind: 'balance' });

// REAL corpus #163 (seen 1x). The account fragment "041-340***-001" sits
// immediately before the currency and must not be read as the amount.
fmt('REAL', 'purchase with a PayPal acquirer descriptor',
  'From HSBC: 08SEP25 PAYPAL *CXIANGHUI01L Purchase from 041-340***-001 AED 259.40- by Card Ending with 6737. Your available balance is AED 7.03',
  { type: 'expense', amountFils: 25940, snapshotFils: 703, snapshotKind: 'balance',
    card: { last4: '6737', kind: 'unknown' } });

// REAL corpus #288 (seen 1x). "GlobalE /HoneyLove" — the cross-border
// processor prefixes the shop.
fmt('REAL', 'purchase through a cross-border processor',
  'From HSBC: 12JUL24 GlobalE /HoneyLove Purchase from 041-340***-001 AED 316.80- by Card Ending with 6737. Your available balance is AED 8,721.31',
  { type: 'expense', amountFils: 31680, merchant: 'HoneyLove', category: 'shopping' });

// ─────────────────── Emirates NBD and Liv ───────────────────
bank('Emirates NBD / Liv', '"EmiratesNBD", "Liv"',
  'One core platform, two brands — the same two families cover both.');

// REAL corpus #1 (seen 15x). Family A: "Purchase of <cur> <amt> with <kind>
// Card ending <4> at <DESCRIPTOR>[, <PLACE>]. Avl Balance is <cur> <bal>."
fmt('REAL', 'family A — "Purchase of ... with Debit Card ending ... at ..."',
  'Purchase of AED 96.00 with Debit Card ending 4502 at URBANCLAP TECHNOLOGIES, DUBAI. Avl Balance is AED 258.91.',
  { kind: 'transaction', type: 'expense', amountFils: 9600, merchant: 'UrbanClap',
    card: { last4: '4502', kind: 'debit' }, snapshotFils: 25891, snapshotKind: 'balance' });

// REAL corpus #241 (seen 1x). A phone-number tail on the descriptor and a
// "Pls refer stmt for exact amt" footer that must not become the merchant.
fmt('REAL', 'family A — descriptor with a phone tail and an exact-amount footer',
  'Purchase of AED 3.70 with Debit Card ending 4502 at CANVA* PAAAAGKXBV6MRRQ, +····3388. Avl Balance is AED 2.87.  Pls refer stmt for exact amt.',
  { type: 'expense', amountFils: 370, merchant: 'Canva', snapshotFils: 287 });

// RECONSTRUCTED: the credit-card sibling of family A. Same template, the tail
// swaps "Avl Balance" for "Avl Cr. Limit", and headroom must be stored as a
// LIMIT rather than as cash in an account.
fmt('RECON', 'family A — credit-card sibling quotes "Avl Cr. Limit"',
  'Purchase of AED 89.50 with Credit Card ending 4844 at CARREFOUR, DUBAI. Avl Cr. Limit is AED 14,671.30',
  { type: 'expense', amountFils: 8950, merchant: 'Carrefour', category: 'groceries',
    card: { last4: '4844', kind: 'credit' }, snapshotFils: 1467130, snapshotKind: 'limit' });

// RECONSTRUCTED: the "Cash Withdrawal of ..." verb on the same template. The
// ATM's own address decides nothing — a withdrawal at DEIRA CITY CENTRE used
// to be filed as shopping because the address contains "CENTRE".
fmt('RECON', 'family A — cash withdrawal, category pinned with the title',
  'Cash Withdrawal of AED 500.00 with Debit Card ending 4502 at EMIRATES NBD ATM DEIRA CITY CENTRE. Avl Balance is AED 1,258.91.',
  { type: 'expense', amountFils: 50000, merchant: 'ATM withdrawal', category: 'other',
    snapshotFils: 125891, snapshotKind: 'balance' });

// REAL corpus #21 (seen 4x). Family E: an account-side debit whose purpose is
// uppercase free text with no delimiter. This one sweeps into a Liv pot.
fmt('REAL', 'family E — account debit into a Liv savings pot',
  'AED 7,000.00 has been debited from your account no. 095XXX13XXX01 TO LIV FROM EMERGENCY FUNDS. The available balance is AED 7,939.20.',
  { type: 'expense', amountFils: 700000, merchant: 'Savings transfer', transfer: true,
    snapshotFils: 793920, snapshotKind: 'balance' });

// REAL corpus #36 (seen 3x). The automated-rule form of the same sweep.
fmt('REAL', 'family E — automated savings rule transfer',
  'AED 4,000.00 has been debited from your account no. 096XXX13XXX 0007 RULE TRANSFER TO EMERGENCY FUNDS WITH ONE-SHOT SAV. The available balance is AED 4,000.95.',
  { type: 'expense', amountFils: 400000, merchant: 'Savings transfer', transfer: true,
    snapshotFils: 400095 });

// RECONSTRUCTED: Liv's savings pots are called Goals. "LIV GOAL" names the
// brand before the noun, so it reads without a sender.
fmt('RECON', 'family E — a named Liv Goal is a self-transfer, not a merchant',
  'AED 500.00 has been debited from your account no. 095XXX13XXX01 TO LIV GOAL RAINY DAY. The available balance is AED 3,000.00.',
  { type: 'expense', amountFils: 50000, merchant: 'Savings transfer', transfer: true,
    category: 'other', snapshotFils: 300000 });

// SENDER-GATED PAIR. A bare "GOAL" with no brand in front of it is a shop as
// often as it is a savings pot (GOAL SPORTS is a real one), so the parser is
// only allowed to read it as a pot once the sender says Liv sent this.
fmt('RECON', 'family E — a bare "GOAL" is an unknown payee with no sender',
  'AED 500.00 has been debited from your account no. 095XXX13XXX01 TO GOAL RAINY DAY. The available balance is AED 3,000.00.',
  { type: 'expense', amountFils: 50000, merchant: 'Goal Rainy Day', transfer: false });
fmt('RECON', 'family E — ...and a Liv savings pot once the sender says Liv',
  'AED 500.00 has been debited from your account no. 095XXX13XXX01 TO GOAL RAINY DAY. The available balance is AED 3,000.00.',
  { type: 'expense', amountFils: 50000, merchant: 'Savings transfer', transfer: true },
  { sender: 'Liv' });

// ─────────────────────────── ADCB ───────────────────────────
bank('ADCB', '"ADCB"',
  'Family C (the multi-line block) and family F ("Card ending *** ####").');

// REAL corpus #6 (seen 6x). The bare "Balance AED n" footer: neither an
// Avl/Total prefix nor a your/current/new one, so this whole family used to
// report no balance at all while its "Available Balance" siblings did.
fmt('REAL', 'family C — multi-line debit block with a bare "Balance" footer',
  'Debit Card Purchase  \nCard XXXX5083\nAED 10.00\nDUBAI INTEGRATED ECONODUBAI           AE \n03/02/26 14:26 \nBalance AED 9774.87',
  { kind: 'transaction', type: 'expense', amountFils: 1000,
    merchant: 'Dubai Integrated Economic Zones', date: '2026-02-03',
    card: { last4: '5083', kind: 'debit' }, snapshotFils: 977487, snapshotKind: 'balance' });

// REAL corpus #15 (seen 4x). The variant that also carries a "Debit Account"
// line, and says "Available Balance" where #6 says "Balance".
fmt('REAL', 'family C — with a Debit Account line and "Available Balance"',
  'Debit Card Purchase \nDebit Account XXXX7001 \nCard XXXX5083 \nAED 29.00 \nFRIENDS AVENUE CATERINDUBAI           AE \n14/10/25 14:14 \nAvailable Balance AED 1047.24',
  { type: 'expense', amountFils: 2900, merchant: 'Friends Avenue', date: '2025-10-14',
    snapshotFils: 104724, snapshotKind: 'balance' });

// REAL corpus #13 (seen 4x). The descriptor is a fixed-width field, so the
// city is padded away from the name rather than glued onto it.
fmt('REAL', 'family C — padded descriptor, city in its own column',
  'Debit Card Purchase  \nCard XXXX5083\nAED 53.58\nMARK AND SAVE         Dubai           AE \n19/02/26 15:45 \nBalance AED 1780.67',
  { type: 'expense', amountFils: 5358, merchant: 'Mark & Save', category: 'groceries',
    date: '2026-02-19', snapshotFils: 178067 });

// REAL corpus #101 (seen 1x). A terminal ID leads the descriptor and the
// emirate is glued twice onto a truncated name ("DUBADUBAI").
fmt('REAL', 'family C — leading terminal id and a doubly-glued emirate',
  'Debit Card Purchase  \nCard XXXX5083\nAED 59.00\n····8730 TGI FRIDAYS DUBADUBAI           AE \n19/05/26 14:02 \nBalance AED 1920.62',
  { type: 'expense', amountFils: 5900, merchant: 'TGI Fridays', category: 'dining',
    snapshotFils: 192062 });

// REAL corpus #44 (seen 2x). The balance is MASKED here, so it is unknowable
// and must stay null rather than be read as 5,193.16.
fmt('REAL', 'family C — a masked balance footer quotes nothing',
  'Debit Card Purchase  \nCard XXXX5083\nAED 756.00\nZiina                 Dubai           AE \n29/12/25 17:47 \nBalance AED ····5193.16',
  { type: 'expense', amountFils: 75600, snapshotFils: null, snapshotKind: null });

// REAL corpus #218 (seen 1x). The "***" between "ending" and the digits is
// the BANK's masking, not the accuracy report's, and it used to defeat the
// card pattern outright — so a real message lost its card identity and its
// row could not be attached to any account.
fmt('REAL', 'family F — "Credit Card ending *** 6383" keeps its card identity',
  'Your Credit Card ending *** 6383 was used for AED 231.95 at BUSINESS HUB GOVERNMEN. Your available limit is AED 1659.58',
  { kind: 'transaction', type: 'expense', amountFils: 23195, merchant: 'Business Hub Governmen',
    category: 'government', card: { last4: '6383', kind: 'credit' },
    snapshotFils: 165958, snapshotKind: 'limit', date: null, transfer: false });

// REAL corpus #225 (seen 1x). Same family, but the amount itself is masked —
// what survives is a fragment, not a number, so the row is dropped rather
// than filed as a 710.00 purchase.
fmt('REAL', 'family F — a masked amount is dropped, never guessed',
  'Your Credit Card ending *** 6383 was used for AED ····0710.00 at MSPLUS DOCUMENTS CL.... Your available limit is AED 3019.69',
  null);

// The marketing recap, in the vocabulary ADCB actually uses. Every dirham of
// it is already on the ledger, one real transaction at a time — and the
// "last 30 days" spelling is one word away from the "this month" one that was
// pinned in round 1.
fmt('RECON', 'family G — a "last 30 days" spend recap fabricates nothing',
  'Dear Customer, you spent AED 4,320.00 in the last 30 days. Download the ADCB app.', null);

// ...and the footer the same issuer staples to REAL alerts. It says the same
// thing about a transaction that DID happen, and deleted it.
fmt('RECON', 'family F — the fraud-reporting footer keeps its purchase',
  'Your Credit Card ending *** 6383 was used for AED 231.95 at BUSINESS HUB GOVERNMEN. Your available limit is AED 1659.58. If this was not authorised by you, please call 600 54 0000.',
  { kind: 'transaction', type: 'expense', amountFils: 23195, merchant: 'Business Hub Governmen',
    card: { last4: '6383', kind: 'credit' }, snapshotFils: 165958, snapshotKind: 'limit' });

// ────────────────────────── Mashreq ─────────────────────────
bank('Mashreq', '"Mashreq", "MashreqNeo"',
  'Family B — 28 of the corpus messages, the most common credit-card family on that phone.');

// REAL corpus #2 (seen 11x). The payee sits BEFORE the amount with none of
// the prepositions the merchant pattern looks for.
fmt('REAL', 'family B — "Payment for <MERCHANT> of AED <n> ... Credit Card ending with <4>"',
  'Payment for GINNYS PLUS TRADING of AED 2.25 has been made using Credit Card ending with 4110. Available limit AED 59,797.61.',
  { kind: 'transaction', type: 'expense', amountFils: 225, merchant: 'Ginnys Plus Trading',
    card: { last4: '4110', kind: 'credit' }, snapshotFils: 5979761, snapshotKind: 'limit' });

// REAL corpus #8 (seen 6x). Identical family, hard-wrapped between "with" and
// the four digits — the wrap is in the message the handset receives.
fmt('REAL', 'family B — hard wrap between "ending with" and the digits',
  'Payment for CARIBOU COFFEE of AED 26.00 has been made using Credit Card ending with\n 4110. Available limit AED 63,155.07.',
  { type: 'expense', amountFils: 2600, merchant: 'Caribou Coffee', category: 'dining',
    card: { last4: '4110', kind: 'credit' }, snapshotFils: 6315507, snapshotKind: 'limit',
    transfer: false });

// RECONSTRUCTED: the account side of the same bank.
fmt('RECON', 'account-side purchase debit',
  'AED 320.00 has been debited from your Mashreq Account XXXX9012 for a purchase at TALABAT on 12/07/2026. Available Balance AED 5,100.00',
  { type: 'expense', amountFils: 32000, merchant: 'Talabat', category: 'dining',
    date: '2026-07-12', card: { last4: '9012', kind: 'account' }, snapshotFils: 510000 });

// RECONSTRUCTED: Mashreq renders a statement due date as a NOUN lead-in
// ("Payment due date"), where ENBD writes "due on". One missing word left the
// statement with no due day, and a statement with no due day raises no
// reminder — the user just misses the payment.
fmt('RECON', 'card statement — "Payment due date DD/MM/YYYY" yields a due day',
  'Your Mashreq Credit Card ending 4110 statement is ready. Total Amount Due AED 3,240.00. Minimum Amount Due AED 162.00. Payment due date 05/08/2026.',
  { kind: 'cardStatement', amountFils: 324000, minDueFils: 16200, merchant: 'Card •4110',
    card: { last4: '4110', kind: 'credit' }, date: '2026-08-05', dueDay: 5 });

// An offer quotes a THRESHOLD to qualify for. There is no card, no merchant
// and no posting verb behind the figure, and it was imported as a AED 1,000
// purchase.
fmt('RECON', 'a 0% instalment offer is not a AED 1,000 purchase',
  'Enjoy 0% instalment plans on purchases above AED 1,000.00 with your Mashreq card.', null);

// ──────────────────────────── FAB ───────────────────────────
bank('FAB', '"FAB"',
  'The "Card No" + "Avl Bal" rendering of the multi-line block.');

// RECONSTRUCTED, from the format comment in sms-parser.ts: the credit-card
// sibling of the ADCB block says "Card No" rather than "Card" and "Avl Bal"
// rather than "Balance", and a foreign-currency amount converts.
fmt('RECON', 'multi-line credit block — "Card No" + "Avl Bal", FX amount',
  'Credit Card Purchase\nCard No XXXX4711\nEUR 2.99\nALLDEBRID.COM MONTROUGE FRA\n03/07/26 05:53\nAvl Bal AED 13107.74',
  { type: 'expense', merchant: 'AllDebrid', date: '2026-07-03',
    card: { last4: '4711', kind: 'credit' }, snapshotFils: 1310774, snapshotKind: 'limit' });

// RECONSTRUCTED: the bank-account leg of a card bill settlement. Both legs
// arrive, so without the transfer flag the same amount is counted twice.
fmt('RECON', 'card bill paid from the account side is a transfer, not spending',
  'Your payment instructions of AED 7,663.94 to 5492********4711 has been processed',
  { type: 'expense', amountFils: 766394, merchant: 'Card •4711 payment', transfer: true,
    card: { last4: '4711', kind: 'credit' } });

// ──────────────────────────── ADIB ──────────────────────────
bank('ADIB', '"ADIB", "ADIBAlerts"',
  'RECONSTRUCTED throughout. The product vocabulary is real — a Sharia-compliant\n   issuer never says "credit card"; the product is a Covered Card, income is\n   profit rather than interest, and finance is Murabaha or Ijara.');

// The single most important ADIB fact for the parser: "Covered Card" is its
// credit card. Reading it as a debit card filed the card wrong AND stored a
// full credit limit of headroom as cash in an account.
fmt('RECON', 'Covered Card purchase — an Islamic credit card is a credit card',
  'Dear Customer, your ADIB Covered Card ending with 4417 has been used for AED 250.00 at CARREFOUR MALL OF THE EMIRATES, DUBAI on 12/07/2026. Your available limit is AED 8,240.00.',
  { kind: 'transaction', type: 'expense', amountFils: 25000,
    merchant: 'Carrefour Mall Of The Emirates', category: 'groceries', date: '2026-07-12',
    card: { last4: '4417', kind: 'credit' }, snapshotFils: 824000, snapshotKind: 'limit',
    transfer: false });

fmt('RECON', 'debit card purchase — "Available Balance" means cash, not headroom',
  'AED 250.00 was spent on your ADIB Card ending 4417 at LULU HYPERMARKET, DUBAI on 12/07/26. Available Balance: AED 8,240.00',
  { type: 'expense', amountFils: 25000, merchant: 'Lulu Hypermarket', category: 'groceries',
    card: { last4: '4417', kind: 'unknown' }, snapshotFils: 824000, snapshotKind: 'balance' });

// The ATM's street address is a shopping mall as often as not. One event must
// not take three different categories depending on which machine was used.
fmt('RECON', 'ATM withdrawal at a mall is cash out, not shopping',
  'AED 500.00 has been withdrawn from your ADIB Account XXX1234 at ADIB ATM AL WAHDA MALL on 12/07/2026. Available Balance AED 2,900.00',
  { type: 'expense', amountFils: 50000, merchant: 'ATM withdrawal', category: 'other',
    date: '2026-07-12', card: { last4: '1234', kind: 'account' }, snapshotFils: 290000 });

fmt('RECON', 'salary credited to the account',
  'Your ADIB Account XXXX1234 has been credited with AED 18,500.00 being Salary for Jul 2026. Available Balance AED 21,400.00',
  { type: 'income', amountFils: 1850000, merchant: 'Salary', category: 'salary',
    card: { last4: '1234', kind: 'account' }, snapshotFils: 2140000 });

// Islamic banks credit PROFIT, never interest — and bank profit is an offset,
// not business revenue.
fmt('RECON', 'profit credited is income but never business revenue',
  'Profit of AED 34.22 has been credited to your ADIB Savings Account XXXX1234. Available Balance AED 20,034.22',
  { type: 'income', amountFils: 3422, category: 'other', merchant: 'Incoming transfer',
    card: { last4: '1234', kind: 'account' }, snapshotFils: 2003422 });

fmt('RECON', 'Covered Card statement with a total, a minimum and a due day',
  'Your ADIB Covered Card ending 4417 statement is ready. Total Amount Due AED 8,240.00. Minimum Amount Due AED 412.00. Payment due by 18/08/2026.',
  { kind: 'cardStatement', amountFils: 824000, minDueFils: 41200, merchant: 'Card •4417',
    card: { last4: '4417', kind: 'credit' }, date: '2026-08-18', dueDay: 18 });

// A card BILL settlement, not fresh spending: the card's own statement is
// already on the ledger, so counting this as a purchase double-counts it.
// "ADIB Covered Card" is two words between "your" and "card", and the pattern
// used to allow exactly one.
fmt('RECON', 'payment received toward a two-word card product name',
  'Payment of AED 3,000.00 has been received towards your ADIB Covered Card ending 4417. Thank you.',
  { kind: 'cardPayment', type: 'expense', amountFils: 300000, merchant: 'Card •4417 payment',
    card: { last4: '4417', kind: 'credit' }, transfer: true, category: 'other' });

// Murabaha (cost-plus sale) is what an Islamic bank calls a loan. Every one of
// these was landing in Other, hiding the user's largest recurring outflow.
fmt('RECON', 'Murabaha instalment is debt, not "other"',
  'Your Murabaha instalment of AED 2,150.00 has been debited from your ADIB account XXXX1234 on 05/07/2026. Available Balance AED 12,000.00',
  { type: 'expense', amountFils: 215000, category: 'loan', date: '2026-07-05',
    card: { last4: '1234', kind: 'account' }, snapshotFils: 1200000, merchant: 'Account debit' });

// Takaful is Islamic insurance, which this parser files under health.
fmt('RECON', 'Takaful contribution is insurance',
  'Your Takaful contribution of AED 450.00 has been debited from your ADIB account XXXX1234 on 05/07/2026. Available Balance AED 12,000.00',
  { type: 'expense', amountFils: 45000, category: 'health', date: '2026-07-05' });

// SENDER-GATED PAIR. ADIB abbreviates its own product to "your ADIB Card" in
// some templates. On a conventional bank that sentence is a debit card; on a
// Sharia-compliant issuer, which never writes the word "credit", a card
// quoting available HEADROOM is the Covered Card. Only the sender can tell
// the two apart — and getting it wrong stores a credit limit as cash.
fmt('RECON', 'a kindless "Card" quoting a limit stays UNKNOWN with no sender',
  'Your ADIB Card ending 4417 has been used for AED 250.00 at CARREFOUR. Your available limit is AED 8,240.00',
  { type: 'expense', amountFils: 25000, card: { last4: '4417', kind: 'unknown' } });
fmt('RECON', '...and as the Covered Card once the sender says ADIB',
  'Your ADIB Card ending 4417 has been used for AED 250.00 at CARREFOUR. Your available limit is AED 8,240.00',
  { type: 'expense', amountFils: 25000, card: { last4: '4417', kind: 'credit' },
    snapshotKind: 'limit' },
  { sender: 'ADIB' });
// ...but a card the message calls a DEBIT card stays one, sender or not.
fmt('RECON', 'an explicit debit card is never promoted by the sender',
  'Your ADIB Debit Card ending 4417 has been used for AED 250.00 at CARREFOUR. Your available limit is AED 8,240.00',
  { type: 'expense', card: { last4: '4417', kind: 'debit' } },
  { sender: 'ADIB' });

// A marketing summary of a month the ledger already holds, one real
// transaction at a time. Booked as a purchase it added a AED 4,320 expense
// that never happened, on top of the AED 4,320 of real rows it was describing.
fmt('RECON', 'monthly spend summary — a restatement, never a posting',
  'You spent AED 4,320.00 this month with your ADCB Credit Card. See the breakdown in the app.',
  null);

// The ADIB/DIB Arabic word order, with باستخدام rather than من between the
// payee and the funding card. It is the commonest connector of the set, and
// without a stop for it the shop arrived named "كارفور باستخدام".
fmt('RECON', 'Arabic purchase — the payee stops before "باستخدام بطاقتك"',
  'تم شراء بمبلغ 250.00 درهم لدى كارفور باستخدام بطاقتك 1234',
  { kind: 'transaction', type: 'expense', amountFils: 25000, merchant: 'كارفور',
    category: 'groceries', card: { last4: '1234', kind: 'debit' } });

// ────────────────────────── RAKBANK ─────────────────────────
bank('RAKBANK', '"RAKBANK", "RAKBANKUAE"',
  'RECONSTRUCTED throughout. "RAKMoneyTransfer" is a real product name; the\n   register ("has been used for", "Available Limit:") is standard mid-tier UAE.');

// The opposite failure to ADIB's, and worse for being invisible: on a
// conventional card the words "Credit Card" used to make an unrecognised verb
// read as INCOME, so a AED 350 grocery run ADDED AED 350 of business revenue.
fmt('RECON', 'credit card purchase — "has been used for" is spending, not income',
  'Your RAKBANK Credit Card ending 7712 has been used for AED 350.00 at CARREFOUR HYPERMARKET DUBAI on 12/07/2026. Available Limit: AED 9,800.00',
  { kind: 'transaction', type: 'expense', amountFils: 35000, merchant: 'Carrefour Hypermarket',
    category: 'groceries', date: '2026-07-12', card: { last4: '7712', kind: 'credit' },
    snapshotFils: 980000, snapshotKind: 'limit' });

fmt('RECON', 'account purchase debit',
  'AED 180.00 has been debited from your RAKBANK Account XXXX1234 for a purchase at SPINNEYS on 12/07/2026. Available Balance: AED 4,300.00',
  { type: 'expense', amountFils: 18000, merchant: 'Spinneys', category: 'groceries',
    card: { last4: '1234', kind: 'account' }, snapshotFils: 430000 });

fmt('RECON', 'ATM withdrawal on a debit card',
  'AED 500.00 has been withdrawn using your RAKBANK Debit Card ending 7712 at RAKBANK ATM AL QUOZ on 12/07/2026. Available Balance: AED 2,900.00',
  { type: 'expense', amountFils: 50000, merchant: 'ATM withdrawal', category: 'other',
    date: '2026-07-12', card: { last4: '7712', kind: 'debit' } });

fmt('RECON', 'salary credit',
  'Your salary of AED 18,500.00 has been credited to your RAKBANK Account XXXX1234. Available Balance: AED 21,400.00',
  { type: 'income', amountFils: 1850000, category: 'salary', merchant: 'Salary',
    card: { last4: '1234', kind: 'account' } });

// "Due date DD/MM/YYYY" — a noun lead-in where ENBD writes "due on".
fmt('RECON', 'card statement — "Due date DD/MM/YYYY" yields a due day',
  'Your RAKBANK Credit Card ending 7712 statement is generated. Total Amount Due AED 4,120.55. Minimum Amount Due AED 206.03. Due date 18/08/2026.',
  { kind: 'cardStatement', type: 'expense', amountFils: 412055, minDueFils: 20603,
    merchant: 'Card •7712', card: { last4: '7712', kind: 'credit' },
    date: '2026-08-18', dueDay: 18 });

// A different word order to ADIB's, not a synonym: "received YOUR payment ...
// towards your ... Card" puts the possessive before the noun, which the
// received/credited/processed form cannot reach however wide its word gap is.
fmt('RECON', 'card bill settlement in the "received your payment" word order',
  'We have received your payment of AED 4,120.55 towards your RAKBANK Credit Card ending 7712.',
  { kind: 'cardPayment', type: 'expense', amountFils: 412055, merchant: 'Card •7712 payment',
    card: { last4: '7712', kind: 'credit' }, transfer: true });

// RAKMoneyTransfer names a RAIL and a real payee. The bank's own product name
// must not make this look like a move inside the bank.
fmt('RECON', 'RAKMoneyTransfer to a person keeps the payee and stays spending',
  'AED 1,200.00 has been debited from your RAKBANK Account XXXX1234 for RAKMoneyTransfer to AHMED KHALID. Available Balance: AED 4,300.00',
  { type: 'expense', amountFils: 120000, merchant: 'Ahmed Khalid', transfer: false,
    card: { last4: '1234', kind: 'account' }, snapshotFils: 430000 });

// The same settlement with the AMOUNT left out. The available limit is the
// only figure in the body, and returning it made a AED 50,000 card payment
// whose snapshotFils was the SAME number — the parser asserting that one
// figure is both the balance and the amount. Downstream, auto-import turns
// that into a CardDue of AED 50,000 with a AED 2,500 minimum: thousands of
// dirhams of debt that does not exist. A message that does not state its
// amount cannot be imported, and null says so.
fmt('RECON', 'card settlement with no stated amount — the limit is not the amount',
  'Thank you for your payment towards your RAKBANK Credit Card ending 4711. Your available limit is now AED 50,000.00',
  null);

// The EPP pitch RAKBANK appends to a large purchase alert. The offer only
// exists because the purchase just posted, so suppressing on it deleted
// exactly the transactions banks pitch EPP on.
fmt('RECON', 'a "Convert now" EPP footer keeps the purchase it advertises against',
  'AED 1,850.00 spent at SHARAF DG on Credit Card 4110. Convert now to 0% EPP. Avl Cr AED 10,000.00',
  { kind: 'transaction', type: 'expense', amountFils: 185000, merchant: 'Sharaf Dg',
    category: 'shopping', card: { last4: '4110', kind: 'credit' } });

// ──────────────────────────── Wio ───────────────────────────
bank('Wio', '"Wio", "ae.wio.personal" (notification package)',
  'RECONSTRUCTED and the WEAKEST section here — Wio is app-push-first and sends\n   little SMS, so the sentences are modelled, not observed. What is solid is the\n   product noun "Saving Space" and the bare "Balance:" tail.');

fmt('RECON', 'card purchase with a bare "Balance:" tail',
  'AED 45.50 spent at CARREFOUR with your Wio Card ending 8801. Balance: AED 3,120.00',
  { type: 'expense', amountFils: 4550, merchant: 'Carrefour', category: 'groceries',
    card: { last4: '8801', kind: 'unknown' }, snapshotFils: 312000, snapshotKind: 'balance' });

// "transferred" appeared in NEITHER word list — only the opposite-direction
// phrase "transferred to your" — so an outgoing transfer returned null and the
// money simply vanished from the ledger. Money only ever disappeared outwards,
// which is what kept it invisible.
fmt('RECON', 'sweep into a Saving Space is a self-transfer, not spending',
  'AED 1,000.00 has been transferred from your Wio Personal account to your Saving Space Emergency. Balance: AED 4,200.00',
  { type: 'expense', amountFils: 100000, merchant: 'Savings transfer', transfer: true,
    category: 'other', snapshotFils: 420000, snapshotKind: 'balance' });

fmt('RECON', 'incoming payment credited to the account',
  'AED 2,500.00 has been credited to your Wio Personal account from ACME TRADING LLC. Balance: AED 6,700.00',
  { type: 'income', amountFils: 250000, merchant: 'Acme Trading Llc', snapshotFils: 670000 });

// SENDER-GATED PAIR. "Space" on its own is a cafe as often as a savings pot.
fmt('RECON', 'a bare "Space" is an unnamed account debit with no sender',
  'AED 300.00 has been transferred from your Wio account to your Space Rainy Day. Balance: AED 900.00',
  { type: 'expense', amountFils: 30000, merchant: 'Account debit', transfer: false });
fmt('RECON', '...and a Saving Space once the sender says Wio',
  'AED 300.00 has been transferred from your Wio account to your Space Rainy Day. Balance: AED 900.00',
  { type: 'expense', amountFils: 30000, merchant: 'Savings transfer', transfer: true },
  { sender: 'ae.wio.personal' });

// ──────────────────────────── DIB ───────────────────────────
bank('DIB', '"DIB", "DubaiIslamic"',
  'RECONSTRUCTED. Same Islamic vocabulary as ADIB with a different brand token —\n   treat the two as one grammar.');

fmt('RECON', 'Covered Card purchase',
  'Your DIB Covered Card ending 5566 has been used for AED 120.00 at TALABAT on 12/07/2026. Your available limit is AED 6,400.00',
  { type: 'expense', amountFils: 12000, merchant: 'Talabat', category: 'dining',
    date: '2026-07-12', card: { last4: '5566', kind: 'credit' },
    snapshotFils: 640000, snapshotKind: 'limit' });

fmt('RECON', 'Covered Card statement with "Payment due date"',
  'Your DIB Covered Card ending 5566 statement is ready. Total Amount Due AED 2,340.00. Minimum Amount Due AED 117.00. Payment due date 20/08/2026.',
  { kind: 'cardStatement', amountFils: 234000, minDueFils: 11700, merchant: 'Card •5566',
    card: { last4: '5566', kind: 'credit' }, date: '2026-08-20', dueDay: 20 });

// The Arabic word order both Islamic banks use: payee and funding card in one
// clause, joined by the bare preposition من. Without a stop for it the row was
// titled "كارفور من" and the same shop had two identities.
fmt('RECON', 'Arabic purchase — "لدى <merchant> من بطاقتك" word order',
  'تم شراء بمبلغ 75.50 درهم لدى كارفور من بطاقتك المنتهية 5566',
  { type: 'expense', amountFils: 7550, merchant: 'كارفور', category: 'groceries',
    card: { last4: '5566', kind: 'debit' } });

// Ijara (lease) is the other name an Islamic bank gives a loan.
fmt('RECON', 'Ijara instalment is debt',
  'Your Ijara instalment of AED 3,400.00 has been debited from your DIB account XXXX5566 on 05/07/2026. Available Balance AED 18,000.00',
  { type: 'expense', amountFils: 340000, category: 'loan', date: '2026-07-05' });

// ───────────────────── Non-bank senders ─────────────────────
bank('(not a bank)', 'merchant and delivery senders',
  'The parser must read what a shop sends too, and must not mistake it for a\n   bank alert.');

// REAL corpus #346 (seen 1x). Suffix currency, no card, no bank.
fmt('REAL', 'merchant refund with a suffix currency and no card',
  "We've issued your refund of 58.89 AED for your cancelled order.",
  { type: 'income', amountFils: 5889, merchant: 'Refund', category: 'other', card: null });

// ─────────── Sender attribution and the no-sender guarantee ───────────
bank('(sender plumbing)', 'all of the above', 'That the sender is read, and that omitting it changes nothing.');

for (const [sender, expected] of [
  ['ADIB', 'ADIB'],
  ['RAKBANK', 'RAKBANK'],
  ['MashreqNeo', 'Mashreq'],
  ['EmiratesNBD', 'Emirates NBD'],
  ['Liv', 'Liv'],
  ['ae.wio.personal', 'Wio'],
  ['ADCB', 'ADCB'],
  ['DubaiIslamic', 'DIB'],
  ['HSBC', 'HSBC'],
  ['FAB', 'FAB'],
]) {
  const got = bankProfileForSender(sender);
  ok(`sender ${JSON.stringify(sender)} attributes to ${expected}`,
    got !== null && got.name === expected, `got ${JSON.stringify(got && got.name)}`);
}
ok('an unknown sender attributes to nothing',
  bankProfileForSender('SHEIN') === null && bankProfileForSender('') === null,
  'a non-bank sender must not select a bank grammar');
ok('no sender at all attributes to nothing', bankProfileForSender() === null);

// THE INVARIANT the sender feature rests on: the Cloudflare Worker ingest
// path (server/src/index.ts) calls parseSms with no sender at all, and so did
// every caller before senders existed. Passing an unknown sender, or none,
// must produce byte-identical output.
{
  const bodies = [
    'Purchase of AED 96.00 with Debit Card ending 4502 at URBANCLAP TECHNOLOGIES, DUBAI. Avl Balance is AED 258.91.',
    'Payment for CARIBOU COFFEE of AED 26.00 has been made using Credit Card ending with\n 4110. Available limit AED 63,155.07.',
    'Debit Card Purchase  \nCard XXXX5083\nAED 10.00\nDUBAI INTEGRATED ECONODUBAI           AE \n03/02/26 14:26 \nBalance AED 9774.87',
    'From HSBC: 24JUN25 DUBAI INTEGRATED ECO Purchase from 041-340***-001 AED 10.00- by Card Ending with 6737. Your available balance is AED 1,430.28',
    'Your Credit Card ending *** 6383 was used for AED 231.95 at BUSINESS HUB GOVERNMEN. Your available limit is AED 1659.58',
    'شراء بمبلغ د.إ 150.00 لدى كارفور بالبطاقة المنتهية 1234. الرصيد المتاح د.إ 9,149.34',
  ];
  const same = bodies.every((b) =>
    JSON.stringify(parseSms(b)) === JSON.stringify(parseSms(b, undefined, {})) &&
    JSON.stringify(parseSms(b)) === JSON.stringify(parseSms(b, undefined, { sender: 'SHEIN' })));
  ok('omitting the sender, or passing an unknown one, changes nothing', same);
}
// And a known sender must not change a message whose bank grammar has nothing
// to say about it — sender awareness disambiguates, it never re-reads.
{
  const b = 'Purchase of AED 96.00 with Debit Card ending 4502 at URBANCLAP TECHNOLOGIES, DUBAI. Avl Balance is AED 258.91.';
  ok('a known sender with nothing to add leaves the row untouched',
    JSON.stringify(parseSms(b)) === JSON.stringify(parseSms(b, undefined, { sender: 'EmiratesNBD' })));
}

// ── The matrix ──
{
  const byBank = new Map();
  for (const [b, f, s] of coverage) {
    if (!byBank.has(b)) byBank.set(b, []);
    byBank.get(b).push(`${s === 'REAL' ? 'real ' : 'recon'}  ${f}`);
  }
  console.log('\n── BANK COVERAGE MATRIX ──');
  for (const [b, rows] of byBank) {
    console.log(`  ${b}  (${rows.filter((r) => r.startsWith('real')).length} real, ${rows.filter((r) => r.startsWith('recon')).length} reconstructed)`);
    for (const r of rows) console.log(`      ${r}`);
  }
}


/* ═══════════════════════════════════════════════════════════════════════════
 * EXTRACTION — ported from the other branch's parser suite as its fields
 * landed here.
 *
 * The two suites were blind to each other's defect class: this one is the
 * regression net for suppression (declines, OTPs, pre-auths, spend summaries),
 * and stayed green through six real corpus messages that carried no date, six
 * credit cards typed as debit, and a settlement whose two legs were
 * indistinguishable. Everything below is the other half of that.
 * ═════════════════════════════════════════════════════════════════════════ */

// ── compact dates ──
//
// Six real corpus messages carried no date at all and were filed on whatever
// day they happened to be imported, which puts a June purchase in whichever
// month the user first opened the app.
t('HSBC runs the date together with no separators at all',
  'From HSBC: 24JUN25 DUBAI INTEGRATED ECO Purchase from 041-340***-001 AED 10.00- by Card Ending with 6737. Your available balance is AED 1,430.28',
  { type: 'expense', amountFils: 1000, date: '2025-06-24',
    merchant: 'Dubai Integrated Economic Zones',
    card: { last4: '6737', kind: 'unknown' }, snapshotFils: 143028, snapshotKind: 'balance' });

t('Mashreq puts the day first and drops the separators',
  'Please note the details of a recent transaction on your Mashreq Credit Card. Your Etisalat Card ending with 0000 was used for a purchase of USD 24.00 at GOOGLE *Domains g.co/helppay# US on 22Jan18 09:35 AM. Available limit is AED 2207.33.',
  { type: 'expense', amountFils: 8814, date: '2018-01-22',
    // The shop, not the plastic: this arrives on a CO-BRANDED Etisalat card,
    // and reading the issuer's name filed a domain renewal as a phone bill.
    // CHANGED from 'entertainment' to 'software'. The claim is unchanged and is
    // in fact sharper now — the co-branded issuer must not win, and the rule
    // that beats it still sits above telecom, it just says `software`.
    merchant: 'Google Domains', category: 'software',
    originalCurrency: 'USD', originalAmountMinor: 2400, fxSource: 'fallback',
    snapshotFils: 220733, snapshotKind: 'limit' });

t('the day-first form with dashes and a four-digit year',
  'AED 55.00 debited from a/c 1234 on 21-SEP-2023 11:10 PM at NOON',
  { type: 'expense', amountFils: 5500, date: '2023-09-21' });

// The loosest date form runs LAST. Tried first it reads the leading digits of
// an ordinary numeric date as a day, fails on the month, and stops the numeric
// reader from ever being reached.
t('a numeric date still wins over the compact reader',
  'Purchase of AED 187.50 with Debit Card ending 1234 at CARREFOUR on 17/07/2026',
  { date: '2026-07-17' });

// ── ADCB "Cr.Card": an abbreviation is still an explicit statement ──
//
// Six real messages. Read as debit cards, every ADCB purchase attached to a
// phantom debit account, so the card's own statement and its payments landed
// somewhere else and it could never show as settled.
t('"Cr.Card" is an explicit credit abbreviation, not an untyped card',
  'AED300.00 debited from Acc/Cr.Card XXX7720 for Salik on 11-02-2025 09:03:37 through ADCB Mobile App.Avl.Limit is AED 2508.31',
  { type: 'expense', amountFils: 30000, merchant: 'Salik', category: 'transport',
    card: { last4: '7720', kind: 'credit' }, date: '2025-02-11',
    snapshotFils: 250831, snapshotKind: 'limit' });

t('...and on the "was used for" alert shape as well',
  'Your Cr.Card XXX7720 was used for AED12.00 on 20/04/2024 19:58:59 at ABO ALO,SHARJAH-AE. Avl. Cr.limit is AED3572.61',
  { type: 'expense', amountFils: 1200, card: { last4: '7720', kind: 'credit' },
    date: '2024-04-20', snapshotFils: 357261, snapshotKind: 'limit' });

// The header states the kind and the footer advertises the opposite. Reading
// the whole body let an advert for a card the customer does not own re-type
// the card they actually used.
t('a card-offer footer does not overrule the transaction\'s own words',
  'Debit Card Purchase Card No 5492********4833 AED 45.00 STARBUCKS DUBAI. Apply for a Credit Card today.',
  { type: 'expense', amountFils: 4500, card: { last4: '4833', kind: 'debit' } });

// ── masked identities ──
t('ADIB\'s compact alert omits the word "card" and keeps the LAST four',
  'XXX456789 was used for AED 120.00 at CARREFOUR',
  { type: 'expense', amountFils: 12000, merchant: 'Carrefour',
    card: { last4: '6789', kind: 'unknown' } });

t('a formatted masked account number attributes the row instead of losing it',
  'AED 1,938.41 has been debited from your account no. 095-XXX11XXX-0001 SEWA NO.-8765',
  { type: 'expense', amountFils: 193841, merchant: 'SEWA', category: 'utilities',
    card: { last4: '0001', kind: 'account' } });

// The banking boilerplate that follows a great many alerts has the exact shape
// of a biller reference. Matched blindly it retitled a real card purchase
// "Account" and filed it as a utility bill.
t('a trailing "ACCOUNT NO.-" footer is not a biller name',
  'Purchase of AED 45.00 with Debit Card 1234 at STARBUCKS. ACCOUNT NO.-556677',
  { type: 'expense', amountFils: 4500, merchant: 'Starbucks', category: 'dining' });

t('...nor is a trailing "REF NO.-" footer',
  'AED 250.00 spent at NOON with Credit Card 4110. REF NO.-123456',
  { type: 'expense', amountFils: 25000, merchant: 'Noon', category: 'shopping' });

// ── snapshot vocabulary ──
//
// The bare form is the balance footer of the biggest message family in the
// real corpus; the ADCB form appears on six more. Neither of the two branches
// read both, so the corpus split into a balance-bearing half and a
// balance-less half depending on how the bank happened to spell it.
t('a bare "Balance AED n" line is a balance',
  'Debit Card Purchase  \nCard XXXX5083\nAED 10.00\nDUBAI INTEGRATED ECONODUBAI           AE \n03/02/26 14:26 \nBalance AED 9774.87',
  { type: 'expense', amountFils: 1000, snapshotFils: 977487, snapshotKind: 'balance' });

t('ADCB writes "Avl. Cr.limit" with a full stop, not a space',
  'Your Cr.Card XXX7720 was used for USD1.00 on 15/06/2024 17:49:15 at PAYPAL,····7733-LU. Avl. Cr.limit is AED4417.96',
  { snapshotFils: 441796, snapshotKind: 'limit', originalCurrency: 'USD',
    originalAmountMinor: 100, fxSource: 'fallback' });

// The gap between the balance noun and its figure used to be "anything that is
// not a digit", and what sits in that gap is routinely an ACCOUNT NUMBER. The
// figure has to be introduced by a currency token, on either side of it.
t('an account number between the noun and the figure is not the balance',
  'AED 250.00 was debited from your card. Avl bal for a/c 9988 is AED 7,500.00',
  { amountFils: 25000, snapshotFils: 750000, snapshotKind: 'balance' });

t('...and the currency may follow the figure instead of leading it',
  'Your a/c XX9012 is debited with 250.00 AED. Avl bal 9,262.00 AED',
  { amountFils: 25000, snapshotFils: 926200, snapshotKind: 'balance' });

// A redacted figure is a FRAGMENT, not a number: 9,235.93 out of a balance
// that may really be 129,235.93. Unknown beats guessed.
t('a masked balance stays unknown rather than reporting its tail',
  'AED 250.00 spent at NOON with card 1234. Avl Bal AED ····9235.93',
  { amountFils: 25000, snapshotFils: null, snapshotKind: null });

// ── which LEG of a card settlement a message is ──
//
// One payment produces two SMS. Reading them both as money arriving on the
// card pays the statement twice, and the only thing that separates them is the
// verb. That used to be re-read from `raw` downstream, which iOS cannot do:
// the relay drops the text before the row reaches the phone. dedupe.ts has 18
// references to this field.
for (const [name, message, side] of [
  ['receipt leg: payment received towards the card',
    'Payment of AED 3,240.00 received towards your Credit Card ending 4821. Thank you.', 'receipt'],
  ['receipt leg: card has been paid',
    'Your Credit Card 4782********4833 Has Been Paid AED 10,700.00. Thank you for banking with us.', 'receipt'],
  ['receipt leg: payment received on a masked card',
    'Payment of AED 7,663.00 has been received on your Credit Card 5492********4711.', 'receipt'],
  ['debit leg: deducted from the account towards payment of the card',
    'AED 4,061.69 has been deducted from your account 095XXX11XXX01 towards payment of your Credit Card ending 8575.', 'debit'],
  ['debit leg: payment instructions to a masked PAN',
    'Your payment instructions of AED 7,663.94 to 5492********4711 has been processed', 'debit'],
]) {
  t(name, message, { kind: 'cardPayment', side });
}

// The debit leg used to fall through to the generic path entirely and be
// imported as SPENDING, so a paid card showed the payment twice — once as an
// expense on the account and once as the receipt on the card.
t('the account-side leg is a settlement, not a purchase',
  'AED 5,000.00 has been debited from your account 1234 towards the payment of your Credit Card 4110.',
  { kind: 'cardPayment', amountFils: 500000, side: 'debit', transfer: true });

// Silence, not a guess: consumers keep an "unknown" branch and it has to stay
// reachable.
t('wording that names no leg leaves the side unset',
  'Payment of AED 500.00 against your Credit Card ending 4821.',
  { kind: 'cardPayment', side: undefined });

t('an ordinary purchase carries no card-payment side',
  'Purchase of AED 187.50 with Debit Card ending 1234 at CARREFOUR on 17/07/2026',
  { side: undefined });

{
  // The field is structured, not a re-reading of the text: it has to still be
  // there once `raw` is gone, which is exactly what the relay sends.
  const receipt = parseSms('Payment of AED 4,061.69 received towards your Credit Card ending 8575.');
  const { raw, ...sealed } = receipt;
  ok('the side survives a row with its message text discarded',
    sealed.raw === undefined && sealed.cardPaymentSide === 'receipt', JSON.stringify(sealed));
}

// ── FX provenance ──
//
// The local amount is identical either way. What differs is whether the BANK
// quoted it or this file's cross-rate table did, and fx.ts's reference-rate
// backfill may only correct the second kind.
t('a bank-quoted local amount beside a foreign one is provenance "bank"',
  'Purchase of USD 9.99 (AED 36.70) at NETFLIX with Credit Card ending 4821',
  { amountFils: 3670, merchant: 'Netflix', category: 'entertainment',
    originalCurrency: 'USD', originalAmountMinor: 999, fxSource: 'bank' });

t('a foreign-only amount is converted, and says so',
  'Purchase of USD 49.99 at STEAM GAMES with Credit Card ending 4821',
  { amountFils: 18359, originalCurrency: 'USD', originalAmountMinor: 4999, fxSource: 'fallback' });

t('a purely local amount carries no FX fields at all',
  'Purchase of AED 187.50 with Debit Card ending 1234 at CARREFOUR on 17/07/2026',
  { originalCurrency: undefined, originalAmountMinor: undefined, fxSource: undefined });

// ── currency and reference ──
ok('every row states the ledger currency it is denominated in',
  parseSms('Purchase of AED 50.00 to TABBY with Credit Card ending 1234').currency === 'AED');

t('a transaction reference is lifted without its label',
  'AED 1,938.41 has been debited from your account no. 095-XXX11XXX-0001. Ref: TT12345678',
  { reference: 'TT12345678' });

t('a message with no reference says so rather than inventing one',
  'Purchase of AED 187.50 with Debit Card ending 1234 at CARREFOUR on 17/07/2026',
  { reference: null });

// ── "other" means two opposite things ──
//
// A settlement or a savings sweep is `other` on purpose; a row nothing could
// read is `other` by default. heal.ts keeps the raw SMS for the second kind
// only, and the accuracy report counts only the second kind as a miss.
t('a card settlement is deliberately uncategorised',
  'Payment of AED 3,240.00 received towards your Credit Card ending 4821. Thank you.',
  { kind: 'cardPayment', category: 'other', deliberate: true });

t('a row nothing could classify is NOT deliberate',
  'Purchase of AED 55.00 at CXIANGHUI01L with Debit Card ending 1234',
  { category: 'other', deliberate: false });

t('a vocabulary hit is deliberate',
  'Purchase of AED 43.00 at CARREFOUR with Debit Card ending 1234',
  { category: 'groceries', deliberate: true });

// ── the market vocabulary cannot silently die ──
//
// Every Arabic literal in a market pack is matched against text that has
// already been folded (آ أ إ ٱ → ا, ى → ي, ة → ه). A rule written in natural
// spelling throws nothing and warns about nothing — it simply never fires,
// while the list still reads like coverage. Eleven of the UAE pack's
// twenty-four rules were dead that way.
{
  const { MARKETS } = require('./build/markets');
  const { foldOrthography } = require('./build/sms-parser');
  const dead = [];
  for (const m of MARKETS) {
    for (const [re] of m.keywords) {
      if (foldOrthography(re.source) !== re.source) dead.push(`${m.id}: ${re.source}`);
    }
  }
  ok('every market keyword is written POST-FOLD, so none of them is a dead regex',
    dead.length === 0, dead.join('\n    '));
}

// ...and the folded vocabulary really does match natural spelling on the way in.
t('a naturally-spelled Arabic cafe still classifies as dining',
  'شراء بمبلغ 45.00 درهم لدى مقهى الرواق من بطاقتك المنتهية 4833',
  { type: 'expense', amountFils: 4500, category: 'dining', merchant: 'مقهى الرواق' });

t('a naturally-spelled Arabic pharmacy still classifies as health',
  'شراء بمبلغ 30.00 درهم لدى صيدلية النهدي من بطاقتك المنتهية 4833',
  { type: 'expense', amountFils: 3000, category: 'health' });

t('a co-op (جمعية) is groceries',
  'شراء بمبلغ 90.00 درهم لدى جمعية الاتحاد من بطاقتك المنتهية 4833',
  { type: 'expense', amountFils: 9000, category: 'groceries' });

// ══ A FOOTER, A LABEL AND A FORM FIELD ARE NOT THE PAYEE ══
//
// Every message in this block is a real family from a second user's inbox,
// with the account fragments replaced by obviously-synthetic digits and the
// masking left exactly as that phone's own export produced it. The shape is
// what the parser matches on, so the shape is preserved verbatim.

// 36 occurrences across six families. "IBAN/Account/Card XXXX8575" is the
// DESTINATION LABEL — the bank's own words for "we are not telling you who" —
// and it was being filed as a shop called "Iban/". A transfer to an IBAN names
// nobody, so it takes the structural title and the transfer hint: money moving
// between accounts is not this month's spending.
t('a transfer to an IBAN has no merchant, only a destination label',
  'Dear Customer, your funds transfer request of  AED 4,070.80 to IBAN/Account/Card XXXX5678  has been processed successfully from your account/card XXXX1234 on 16/04/2026 01:18',
  { merchant: 'Outgoing transfer', amountFils: 407080, date: '2026-04-16', transfer: true });
// 11 occurrences. The merchant grammar was reaching into the CALL-CENTRE
// FOOTER: "from overseas)" is not a payee, it is the second half of "if
// calling from overseas".
t('the call-centre footer is not the payee',
  'Dear Customer, your funds transfer request of AED 20,000.00 from account XXXX1234 to account XXXX5678 has been processed on 27/07/2026 19:01. For more information please call ····5500 (+····1511 if calling from overseas).',
  { merchant: 'Outgoing transfer', amountFils: 2000000, date: '2026-07-27', transfer: true });
// CONTROL: the same "from" still introduces a real merchant. The footer is
// blanked, not the preposition.
t('blanking the footer does not blank a real merchant clause',
  'From HSBC: 24JUN25 DUBAI INTEGRATED ECO Purchase from 041-340***-001 AED 10.00- by Card Ending with 6737. For more information please call ····5500 (+····1511 if calling from overseas).',
  { merchant: 'Dubai Integrated Economic Zones' });
// CONTROL: a merchant whose name really does contain the word.
t('an overseas-named shop is still a shop',
  'Purchase of AED 65.00 with Debit Card ending 1234 at OVERSEAS EXPRESS CARGO, Dubai. Avl Balance is AED 500.00.',
  { merchant: 'Overseas Express Cargo' });

// A tax is what the money WAS, not who received it.
t('VAT on toll charges is a VAT fee, not a shop called Vat',
  'AED 15.70 has been deducted from your account ····1711 for VAT on toll transaction(s) during June 2026. Your current account balance is AED 146.80.',
  { merchant: 'VAT fee', amountFils: 1570 });
// CONTROL: the "for <payee>" grammar this narrows is otherwise untouched.
t('a named payee after "for" is still read',
  'AED 25.00 has been debited from your account 1234 for SALIK on 12/06/2026.',
  { merchant: 'Salik', category: 'transport' });

// The abbreviated card-summary block. Every label is short and the dates are
// ISO, so neither the statement vocabulary nor the date grammar could read it:
// a STATEMENT imported as a AED 154.32 purchase at a shop called "Last Stmt
// 2022-05-11", and the payment that is actually due raised no reminder.
{
  const p = parseSms('Card XXXX8722\nAvailable Balance AED 440.10\nLast Stmt 2022-05-11\nMin Amt AED 154.32\nPymt due 2022-06-06\nLast Pymt AED 50.00\nLast Pymt date 2022-05-07');
  ok('the abbreviated card summary is a statement, not a purchase',
    p && p.kind === 'cardStatement' && p.merchant === 'Card •8722' && p.minDueFils === 15432 &&
      p.date === '2022-06-06' && p.dueDay === 6 && p.card.kind === 'credit',
    JSON.stringify(p && { k: p.kind, m: p.merchant, min: p.minDueFils, d: p.date, c: p.card }));
}
// CONTROL: "Pls refer stmt for exact amt" is the commonest footer in this
// corpus and sits on ordinary purchases. A bare "stmt" stem would have turned
// every one of them into a statement.
t('a "refer stmt" footer does not make a purchase a statement',
  'Purchase of AED 2,062.26 with Debit Card ending 8783 at CRYPTO.COM, SAN GILJAN. Avl Balance is AED 37,091.01.  Pls refer stmt for exact amt.',
  { kind: 'transaction', merchant: 'Crypto.com', amountFils: 206226 });

// A telecom recharge confirmation. "to settle the Out of Credit Call Service
// Balance" is a purpose clause, and it was being read as the payee.
t('a purpose clause after "to" is not the payee',
  'Your recharge transaction for AED 5.00 was successfully processed, AED 1.57 of you last recharge have been used to settle the Out of Credit Call Service Balance.',
  { merchant: 'Mobile recharge', amountFils: 500, category: 'telecom' });
// CONTROL: the notice that no money has moved yet still suppresses.
t('a call-cost notice is still not a transaction',
  'Last call cost is AED 1.57 (VAT included) for Out of Credit Call Service. Amount will be deducted from next recharge.',
  null);
// CONTROL: a Salik/nol recharge is transport, and must not be swept up by the
// airtime rule — "recharge" alone is not a telecom marker.
t('a Salik recharge is not a mobile recharge',
  'AED 100.00 has been debited from your account 1234 for SALIK account recharge on 12/06/2026.',
  { category: 'transport' });

// ══ THE BILLER'S OWN RECEIPT, IN BOTH LANGUAGES ══
//
// 56 occurrences across five families — the largest unread group in this
// corpus. Etisalat sends a labelled Arabic block: the account, the amount DUE,
// the amount PAID, then the channel. It arrived as "Card purchase", and its
// amount was taken from whichever figure came first rather than from the PAID
// label, which is right only while the bill is settled in full.
const AR_RECEIPT_HEAD =
  'عزيزي العميل،\n لقد تمت عملية الدفع بنجاح لحساب رقم ····1993\n';
t('the Arabic biller receipt names its biller and takes the amount PAID',
  AR_RECEIPT_HEAD +
    'المبلغ المستحق 00.00 درهم\nالمبلغ المدفوع: 20 درهم\nالمبلغ المتبقي: 00.00 درهم\n' +
    'تاريخ المعاملة: 2020-04-15\nوقت المعاملة : 22:10:17\n' +
    'تم الدفع عن طريق: تطبيق إتصالات للهواتف الذكية\nرقم البطاقة : XXXXXXXXXXXX5678\nطريقة الدفع: بطاقة',
  { merchant: 'Etisalat', amountFils: 2000, category: 'telecom', date: '2020-04-15' });
// The same family paid with a CREDIT card. "بطاقة ائتمان" is the indefinite
// spelling, and with the definite article baked into the card-kind stem it
// matched nothing: a real credit card was typed DEBIT, which mints a second
// phantom account for a card the user already has.
t('an Arabic credit card without the article is still a credit card',
  AR_RECEIPT_HEAD +
    'المبلغ المستحق 00.00 درهم\nالمبلغ المدفوع: 25.0 درهم\nالمبلغ المتبقي: 00.00 درهم\n' +
    'تاريخ المعاملة: 2020-04-15\n' +
    'تم الدفع عن طريق: تطبيق إتصالات للهواتف الذكية\nرقم البطاقة : XXXXXXXXXXXX5678\nطريقة الدفع: بطاقة ائتمان',
  { merchant: 'Etisalat', amountFils: 2500, category: 'telecom', card: { last4: '5678', kind: 'credit' } });
// The web-channel variant, where the due and the paid figures agree.
t('the Arabic receipt paid through the website is the same biller',
  AR_RECEIPT_HEAD +
    'المبلغ المستحق: 849.45 درهم\nالمبلغ المدفوع: 849.45 درهم\nالمبلغ المتبقي: 00.00 درهم\n' +
    'تاريخ المعاملة: 2020-04-15\nتم الدفع عن طريق: الموقع الإلكتروني لإتصالات\nرقم المعاملة: B2C126',
  { merchant: 'Etisalat', amountFils: 84945, category: 'telecom' });
// THE POINT OF READING THE LABEL: a PARTIAL payment. The due figure comes
// first and is larger, so first-figure extraction would record money that
// never moved. No such message is in the corpus — every sample is settled in
// full — so this is the same family with one figure changed, which is why it
// is asserted on the amount alone.
t('a partly-paid biller receipt records what was PAID, not what was due',
  AR_RECEIPT_HEAD +
    'المبلغ المستحق: 849.45 درهم\nالمبلغ المدفوع: 100.00 درهم\nالمبلغ المتبقي: 749.45 درهم\n' +
    'تم الدفع عن طريق: الموقع الإلكتروني لإتصالات',
  { amountFils: 10000 });
// "تطبيق" (application) CONTAINS "طبي" (medical), and Arabic letters are not
// word characters, so the health rule matched inside the word: four of the
// five Arabic receipt families were filed as HEALTH by that one substring.
t('an Arabic app is not a medical app',
  'شراء بمبلغ 45.00 درهم لدى تطبيق كريم من بطاقتك المنتهية 4833',
  { category: 'transport' });
// CONTROL: the health words the boundary must not have cost.
t('an Arabic medical centre is still health',
  'شراء بمبلغ 45.00 درهم لدى المركز الطبي الدولي من بطاقتك المنتهية 4833',
  { category: 'health' });
t('an Arabic doctor is still health',
  'شراء بمبلغ 45.00 درهم لدى عيادة طبيب الاسنان من بطاقتك المنتهية 4833',
  { category: 'health' });

// ══ GATEWAY AND ACQUIRER PREFIXES ══
//
// The star is the acquirer's own field separator and no shop name contains
// one, so what follows it is the merchant. Leaving the prefix on filed the
// SAME shop under two names — the gateway's alert and the bank's posting for
// one purchase.
t('a gateway prefix before the star is not the merchant',
  'Purchase of AED 290.00 with Debit Card ending 1354 at FAT*THE VIOLE, Dubai. Avl Balance is AED 45,506.98.',
  { merchant: 'The Viole', amountFils: 29000 });
t('Amazon Pay acting as the acquirer is still Amazon',
  'Purchase of AED 30.00 with Debit Card ending 1354 at AMZ*Centraldereservasc, Dubai. Avl Balance is AED 100.00.',
  { merchant: 'Amazon' });
t('a gateway DOMAIN before the star is not the merchant either',
  'Purchase of AED 0.10 with Debit Card ending 8783 at WWW.2C2P.COM*2C2P BOLT (M, BANGKOK. Avl Balance is AED 35,848.02.  Pls refer stmt for exact amt.',
  { merchant: 'Bolt', amountFils: 10, category: 'transport' });
// ── A FULL STOP INSIDE THE DESCRIPTOR ──
//
// MERCHANT_STOP treats "." as a sentence end on purpose, and the single-label
// domain tail only ever rescued "CAPITAL.COM". Everything with two labels, or
// with initials in front, stopped on its first dot and came back as a
// candidate too short to keep — six of the second user's seven "could not
// read" cases, all of them titled "Card purchase".
t('a two-label host is the shop, not a sentence',
  'Purchase of AED 250.00 with Credit Card ending 4411 at www.shein.com,Dubai-AE. Avl Balance is AED 3,000.00.',
  { merchant: 'Shein', amountFils: 25000 });
// The host label is the brand's own spelling; title-casing it produced "G2g".
t('a digit between letters keeps the brand spelling',
  'Purchase of AED 50.00 with Credit Card ending 4411 at WWW.G2G.COM, SINGAPORE. Avl Balance is AED 3,000.00.',
  { merchant: 'G2G', amountFils: 5000 });
// Leading INITIALS, which is a different shape from a sentence-ending dot: the
// capture used to stop after "M", one letter.
t('leading initials survive the sentence-end stop',
  'Purchase of AED 120.00 with Credit Card ending 4411 at M.H. ALSHAYA-AMERICA,DUBAI-AE. Avl Balance is AED 3,000.00.',
  { merchant: 'M.H. Alshaya', amountFils: 12000 });
// Alshaya is the FRANCHISE OPERATOR. Its name on the descriptor is noise on
// the shop's; these two must not collapse into one merchant called Alshaya.
t('the franchise operator does not swallow the shop it runs',
  'Purchase of AED 300.00 with Credit Card ending 4411 at M.H.AL SHAYA FOOT LOCK, DUBAI. Avl Balance is AED 3,000.00.',
  { merchant: 'Foot Locker', amountFils: 30000 });
// CONTROL: the brand rules must not claim a shop whose name merely CONTAINS
// their letters — "BAREFOOT LOCKSMITH" holds "foot lock".
t('a locksmith is not Foot Locker',
  'Purchase of AED 90.00 with Credit Card ending 4411 at BAREFOOT LOCKSMITH, DUBAI. Avl Balance is AED 3,000.00.',
  { merchant: 'Barefoot Locksmith' });
t('an honorific is a name prefix, and the operator suffix is not the name',
  'Purchase of AED 400.00 with Credit Card ending 4411 at DR.VRANJES-D085-ALSHAY, DUBAI. Avl Balance is AED 3,000.00.',
  { merchant: 'Dr. Vranjes', amountFils: 40000 });
// CONTROL: the stop token still has to fire on a real sentence end, including
// one with no space after it. A dot may only continue a descriptor into a
// HOST that ends in a known TLD.
t('a glued full stop still ends the merchant name',
  'Purchase of AED 250.00 with Credit Card ending 4411 at ACME LTD.Please do not share your PIN with anyone.',
  { merchant: 'Acme Ltd', amountFils: 25000 });
// CONTROL: an honorific list, not `[A-Za-z]{2,3}\.` — that would have eaten
// "ABC." here and read the balance label as the shop.
t('a three-letter word before a full stop is the merchant, not a prefix',
  'Purchase of AED 250.00 with Credit Card ending 4411 at ABC. Avl Bal is AED 100.00.',
  { merchant: 'Abc', amountFils: 25000 });

t('an underscore descriptor with an email tail resolves to the processor',
  'Purchase of AED 186.29 with Debit Card ending 8783 at Simplex_Elastum, s@simplex.com. Avl Balance is AED 883.43.',
  { merchant: 'Simplex', amountFils: 18629 });
t('the SP acquirer prefix comes off',
  'Purchase of AED 189.12 with Debit Card ending 8783 at SP ALL-CHARMS, ····7501. Avl Balance is AED 36,826.25.  Pls refer stmt for exact amt.',
  { merchant: 'All-charms' });
// The year in "LUETTI 1980" is part of the NAME. A space and four digits is
// not a terminal id — that shape is glued on with a hyphen, or runs longer.
t('a year in a shop name survives the terminal-id strip',
  'Purchase of AED 389.00 with Debit Card ending 8783 at SP LUETTI 1980, +····0586. Avl Balance is AED 35,786.45.  Pls refer stmt for exact amt.',
  { merchant: 'Luetti 1980', amountFils: 38900 });
// CONTROL: a forecourt number is still not part of the name, or one petrol
// chain becomes one merchant per pump.
t('a site number is still not part of the name',
  'Purchase of AED 120.00 at EMARAT 1049 with Debit Card ending 1234',
  { merchant: 'Emarat', category: 'transport' });
t('a country and a phone tail both come off, in either order',
  'Purchase of AED 30.00 with Debit Card ending 1354 at SP TODD SNYDER +····0068 USA. Avl Balance is AED 100.00.',
  { merchant: 'Todd Snyder' });
t('a terminal id in FRONT of the name comes off',
  'Purchase of AED 68.38 with Debit Card ending 8783 at PZD131 CENTRAL PHUKET, PHUKET. Avl Balance is AED 37,488.79.  Pls refer stmt for exact amt.',
  { merchant: 'Central Phuket' });
t('a truncated chain name is canonicalised',
  'Purchase of AED 30.00 with Debit Card ending 1354 at D586-TEXAS RHOUSE Al S, Dubai. Avl Balance is AED 100.00.',
  { merchant: 'Texas Roadhouse' });
t('a branch suffix is the acquirer’s, not the shop’s',
  'Purchase of AED 30.00 with Debit Card ending 1354 at CITY LIFE PHY BR5-1303, Dubai. Avl Balance is AED 100.00.',
  { merchant: 'City Life Pharmacy' });

// ── CONTROLS for the prefix peels: names that legitimately START with a short
// token, and one that legitimately ENDS in digits. A rule that peels a first
// token has exactly one failure mode and it is silent.
t('a merchant beginning with a two-letter word keeps it',
  'Purchase of AED 30.00 with Debit Card ending 1354 at ON TECHNOLOGIES FZ LLC, Dubai. Avl Balance is AED 100.00.',
  { merchant: 'On Technologies Fz Llc' });
t('a merchant beginning with AT keeps it',
  'Purchase of AED 30.00 with Debit Card ending 1354 at AT TWENTY TWO HOUSE, Dubai. Avl Balance is AED 100.00.',
  { merchant: 'At Twenty Two House' });
t('a merchant beginning with a single letter keeps it',
  'Purchase of AED 30.00 with Debit Card ending 1354 at Z LOUNGE FZC, Dubai. Avl Balance is AED 100.00.',
  { merchant: 'Z Lounge Fzc' });
t('a merchant beginning with AL keeps it',
  'Purchase of AED 30.00 with Debit Card ending 1354 at AL BORJ HOUES HOLD TR, Dubai. Avl Balance is AED 100.00.',
  { merchant: 'Al Borj Houes Hold Tr' });
// A four-letter head with two digits is NOT the terminal-id shape.
t('a name with digits in its first word keeps the word',
  'Purchase of AED 30.00 with Debit Card ending 1354 at SHOP24 GROCERY, Dubai. Avl Balance is AED 100.00.',
  { merchant: 'Shop24 Grocery' });
// The floor, stated: the peel is DISCARDED unless four letters survive it, so
// a short name can never be peeled down to a fragment. The name here is a
// synthetic probe of that boundary — no such descriptor is in the corpus — and
// four is not an arbitrary number: "WWW.2C2P.COM*2C2P BOLT" peels down to
// exactly four, so raising it would lose a real merchant.
t('a peel that would leave a fragment is discarded',
  'Purchase of AED 30.00 with Debit Card ending 1354 at SP OIL, Dubai. Avl Balance is AED 100.00.',
  { merchant: 'Sp Oil' });

// ─────────────────────────────────────────────────────────────────────────────
// CATEGORY COVERAGE — the merchant was already right, the category was Other
// ─────────────────────────────────────────────────────────────────────────────
//
// 119 of 126 message families in the accuracy export parsed with the CORRECT
// merchant and landed in `other`. That is not a parsing failure, it is worse:
// the ledger is right and useless, because nothing groups, nothing can be
// budgeted, and every row reads to the user as "the app did not understand
// this".
//
// The descriptors below are the real ones from that export. The carrier
// sentence is the shape the same export documents for this bank; card digits
// are synthetic (1234 / 5678) because nothing here turns on their value.
//
// Every block is paired: the fixture, then the CONTROL that proves the rule
// did not over-reach. A category rule that fires on a common word mis-files
// thousands of rows silently, and the user cannot see that it is wrong.
const g = (name, place) =>
  `Purchase of AED 42.00 with Debit Card ending 1234 at ${name}, ${place}. Avl Balance is AED 846.57.`;

// ── DINING ──
// `lebanan` is لبنان, beside the `lebanese`/`libnan` the vocabulary already had.
t('a transliterated cuisine nationality is dining', g('JABAL LEBANAN AL JADEE', 'SHARJAH'),
  { merchant: 'Jabal Lebanan Al Jadee', category: 'dining' });
// `foo` is the acquirer's 22-character truncation of FOOD, the same class as
// the CATERIN and GOVERNMEN stubs already in this vocabulary.
t('a truncated FOOD descriptor is dining', g('AL WHAH INTERNATIONAL FOO', 'SHARJAH'),
  { merchant: 'Al Whah International Foo', category: 'dining' });
t('a lounge is a meal', g('Z LOUNGE FZC', 'SHARJAH'),
  { merchant: 'Z Lounge Fzc', category: 'dining' });
// CONTROL: an AIRPORT lounge is travel, and the travel rule runs first. This
// descriptor is a synthetic probe — no airport lounge is in the corpus — and it
// exists because `lounge` is the one word in this batch that spans categories.
t('an airport lounge is travel, not dining', g('MARHABA AIRPORT LOUNGE', 'DUBAI'),
  { category: 'travel' });
// CONTROL: personal-care runs above the dining fallback, so a salon that
// happens to be called a lounge is still a salon. This is a REAL existing
// fixture's message, re-asserted here for the new rule.
t('a salon called a lounge is still personal care',
  'Purchase of AED 120.00 at SUGAR LOUNGE SALON with Credit Card ending 1234',
  { category: 'personal-care' });
t('the roadhouse stub and the full name are one restaurant', g('D586-TEXAS RHOUSE Al S', 'SHARJAH'),
  { merchant: 'Texas Roadhouse', category: 'dining' });
// CONTROL: bare `texas` is NOT a dining signal — it is a US state, so it is the
// CITY field on any card used there, and guessCategory reads the whole message.
t('a shop in Texas is not a restaurant', g('BEST BUY 0421', 'TEXAS'),
  { category: 'other', deliberate: false });
t('Gazebo is the restaurant chain', g('GAZEBO', 'DUBAI'), { category: 'dining' });
t('Fujiyama is a restaurant', g('FUJIYAMA SAHARA CENTREBR', 'SHARJAH'), { category: 'dining' });

// ── GROCERIES / SHOPPING ──
t('Falcon Pack is groceries', g('FALCON PACK', 'SHARJAH'), { category: 'groceries' });
// The brand was in the vocabulary the whole time, spelled with an ampersand,
// while the acquirer spells the word out.
t('Sun and Sand Sports spelled with AND is still the retailer',
  g('SUN AND SAND SPORTS LLC', 'DUBAI'), { category: 'shopping' });
t('...and the plural branch spelling too', g('SUN AND SANDS SPORTS SHJ', 'SHARJAH'),
  { category: 'shopping' });
// CONTROL: the ampersand spelling, which is what the rule used to say.
t('the ampersand spelling still works', g('SUN & SAND SPORTS', 'DUBAI'), { category: 'shopping' });
t('a ...cart storefront is retail', g('COCOCART', 'DUBAI'),
  { merchant: 'Cococart', category: 'shopping' });
// The MASK is part of the shape here, not decoration: the export writes the
// acquirer's phone tail as "+····NNNN", and that is what the tail strip keys
// on. Digits synthetic, mask real.
t('Todd Snyder is a clothing brand',
  'Purchase of AED 42.00 with Debit Card ending 1234 at SP TODD SNYDER +····5678 USA. Avl Balance is AED 846.57.',
  { merchant: 'Todd Snyder', category: 'shopping' });
// A typo'd descriptor must land where its correctly-spelled twin lands, or one
// chain is filed under two categories. NOTE: the accuracy export labels this
// one GROCERIES; it reads as retail here because a household-goods trader is
// retail everywhere else in this vocabulary, and consistency beats one row.
t('a transposed HOUSEHOLD still reads as household goods', g('AL BORJ HOUES HOLD TR', 'SHARJAH'),
  { merchant: 'Al Borj Houes Hold Tr', category: 'shopping' });

// ── HEALTH / PERSONAL CARE ──
// `PHY` is the acquirer's abbreviation for a pharmacy, and also the stub of
// "physiotherapy". Both are health, which is what makes one short token safe.
t('a PHY descriptor is a pharmacy', g('CITY LIFE PHY BR5-1303', 'SHARJAH'),
  { merchant: 'City Life Pharmacy', category: 'health' });
t('a truncated HAIRDRE is a barber', g('HASSAN AL AZZEH HAIRDRE', 'SHARJAH'),
  { merchant: 'Hassan Al Azzeh Hairdre', category: 'personal-care' });
// CONTROL: the spelled-out forms the truncation rule replaced must all survive.
t('hairdressing spelled out is still personal care', g('AL NOOR HAIRDRESSING SALON', 'DUBAI'),
  { category: 'personal-care' });
// TRANSLITERATED trade words — the generalising half of this change. None of
// this user's four Arabic-named salons carries one, which is exactly why the
// vocabulary rather than their names is what got extended.
t('mashghal is a ladies salon', g('MASHGHAL AL ANAQA', 'SHARJAH'), { category: 'personal-care' });
t('hallaq is a barber', g('HALLAQ AL MADINA', 'SHARJAH'), { category: 'personal-care' });
t('tajmeel is beauty', g('MARKAZ TAJMEEL', 'DUBAI'), { category: 'personal-care' });
// CONTROL: `jamal` (beauty) is deliberately NOT vocabulary — it is one of the
// commonest men's names in the Gulf, so a general trader would become a salon.
t('a trader named Jamal is not a salon', g('JAMAL GENERAL TRADING', 'SHARJAH'),
  { category: 'shopping' });

// ── TRANSPORT ──
// `car par` was written to match only the acquirer's TRUNCATION, so the phrase
// spelled out in full fell through every rule.
t('a car park spelled out in full is transport', g('ISLAND PALACE CAR PARK', 'DUBAI'),
  { merchant: 'Island Palace Car Park', category: 'transport' });
t('Cars24 is automotive, which this app files under transport',
  'Purchase of AED 299.00 with Debit Card ending 1234 at HTTP WWW CARS24 COM, RAS AL KHAIM. Avl Balance is AED 4,469.89.',
  { merchant: 'Cars24', category: 'transport' });
// A road toll belongs beside Salik. The VAT on it is the same journey.
t('VAT on a road toll is transport, not an uncategorised fee',
  'AED 15.70 has been deducted from your account ····1711 for VAT on toll transaction(s) during June 2026. Your current account balance is AED 146.80.',
  { merchant: 'VAT fee', category: 'transport' });
// CONTROL, and the reason `toll` carries a negative lookahead: "toll free" is a
// footer on ordinary purchase alerts from several UAE banks. Without the guard
// every one of them would have been filed as transport.
t('a toll-free phone number in a footer is not a road toll',
  'Purchase of AED 42.00 with Debit Card ending 1234 at AL RAWABI GROCERY, DUBAI. Avl Balance is AED 846.57. For queries call our toll free number 600 54 0000.',
  { category: 'groceries' });

// ── ENTERTAINMENT ──
t('a truncated PLAYGROU is still a playground', g('ARD AL MALAIEB PLAYGROU', 'SHARJAH'),
  { merchant: 'Ard Al Malaieb Playgrou', category: 'entertainment' });
t('TOD.TV is a streaming service', g('TOD.TV', 'DUBAI'), { category: 'entertainment' });
t('Abu Dhabi Media is a broadcaster', g('ABU DHABI MEDIA PJSC', 'ABU DHABI'),
  { category: 'entertainment' });
// CONTROL, and the reason the broadcaster is spelled out in full: "DUBAI MEDIA
// C" is Dubai Media CITY, the free zone, and it is the CITY field on a real
// software purchase in this corpus. A bare `media` would have filed a SaaS
// charge as a broadcaster.
t('Dubai Media City is a place, not a broadcaster',
  'Purchase of AED 74.00 with Debit Card ending 1234 at VEDA INC INVESTMENT L., DUBAI MEDIA C. Avl Balance is AED 16,430.80.',
  { category: 'other', deliberate: false });

// ── SOFTWARE, a new category ──
//
// This family was already being collected — the vocabulary had a developer and
// AI tooling rule pointing at `entertainment` with a comment saying so. It now
// points at the category it always meant. `software` is in
// SUBSCRIPTION_CATEGORIES, or moving it would have demoted every AI
// subscription from "subscription" to "commitment".
t('PandaDoc is software', g('PANDADOC INC', 'USA'), { category: 'software' });
t('CopyAI is software', g('COPYAI', 'USA'), { category: 'software' });
t('Hopper HQ is software', g('HOPPER HQ LIMITED', 'GBR'), { category: 'software' });
// CONTROL: bare `hopper` is the flight-booking app, which is why the SaaS is
// spelled with its suffix.
t('Hopper without HQ is not claimed as software', g('HOPPER INC', 'MONTREAL'),
  { category: 'other', deliberate: false });
// The report lists "YAMM.COM" and "YET ANOTHER MAIL MERGE" under two different
// categories. They are the same Gmail add-on under two descriptors.
t('YAMM and Yet Another Mail Merge are one product',
  'Credit Card Purchase \nCard No XXXX5678 \nUSD 50.00 \nYAMM.COM BRUSSELS BEL \n07/07/26 14:53 \nAvl Bal AED 7806.31',
  { merchant: 'Yamm.com Brussels', category: 'software' });
t('...and its spelled-out descriptor lands in the same place',
  g('YET ANOTHER MAIL MERGE', 'FRA'), { category: 'software' });

// ── INVESTING, a new category ──
//
// This rule used to point at `other`, with the comment "moving money, not
// spending it". That reading is still right; `other` was the wrong way to say
// it, because `other` is ALSO what the parser returns when it understood
// nothing, and the user cannot tell those apart on screen.
t('a brokerage purchase is investing',
  'Purchase of AED 1,513.34 with Debit Card ending 1234 at CAPITAL.COM, s@capital.com. Avl Bal is AED 4,490.57. Pls refer stmt for exact amt',
  { merchant: 'Capital.com', category: 'investing', deliberate: true });
t('a crypto on-ramp is investing',
  'Purchase of AED 2,062.26 with Debit Card ending 1234 at CRYPTO.COM, SAN GILJAN. Avl Balance is AED 37,091.01.  Pls refer stmt for exact amt.',
  { merchant: 'Crypto.com', category: 'investing' });
t('a savings certificate is investing', g('NATIONAL BONDS', 'DUBAI'), { category: 'investing' });
t('IQOption is investing', g('IQOPTION.COM', 'CYP'), { category: 'investing' });
// CONTROL: bare `cro` — crypto.com's token, and how one descriptor arrives —
// is deliberately NOT vocabulary. Three letters with no context would fire
// inside far too much, and `crypto.com` already claims that merchant by name.
t('a three-letter token is not enough to claim a category', g('CRO', 'SAN GILJAN'),
  { category: 'other', deliberate: false });

// ── GOVERNMENT ──
// `economic depart` only ever matched one word order; the descriptor carries
// the other one.
t('Department of Economic is a government body', g('DEPARTMENT OF ECONOMIC', 'SHARJAH'),
  { category: 'government' });
// CONTROL: requiring the "of" is what keeps this off a department STORE.
t('a department store is retail', g('SALAM DEPARTMENT STORE', 'DUBAI'),
  { category: 'shopping' });

// ── A BANK'S OWN FEE ──
// The app has no `fees` category and inventing one for a single product would
// be a bigger claim than the evidence supports. What this rule buys is that the
// row stops being reported as an unread FORMAT: the parser understood it
// perfectly, there is just nothing else truthful to call it.
t('the bank\'s own subscription fee is a deliberate other',
  'Your Credit Card 1234 has been charged AED 24.90 for Liv. Prime.',
  { merchant: 'Liv Prime', category: 'other', deliberate: true });

// ── The categories the ground truth names and this change deliberately did
// NOT claim, each because the message carries no evidence for it ──
//
// A city is not a cuisine: PHUKET is the city field on a ferry, a supermarket,
// a mall and a sportswear shop in this same corpus, and BANGKOK is the city on
// a Bolt ride. So the Thai restaurants stay uncategorised, and so does "Little
// Bangkok". These assertions exist so that a future rule keyed on a place name
// fails here rather than in someone's ledger.
t('a Thai restaurant name carries no category evidence', g('PHUKET DELIGHT', 'PHUKET'),
  { category: 'other', deliberate: false });
t('a city in the descriptor does not make a category', g('LITTLE BANGKOK', 'DUBAI'),
  { category: 'other', deliberate: false });
t('a ferry operator named only MARINE stays uncategorised', g('NIKORN MARINE', 'PHUKET'),
  { category: 'other', deliberate: false });
// `studio` is a salon in this inbox and a gym, a photographer and a yoga hall
// in the next one. `the box` is a restaurant here and a storage company in
// Dubai. Both stay in Other on purpose.
t('a studio is not necessarily a salon',
  'Credit Card Purchase \nCard No XXXX5678 \nAED 25.00 \nAL MAZOON STUDIO BR 1 SHARJAH ARE \n13/05/25 20:28 \nAvailable Balance AED 524.10',
  { merchant: 'Al Mazoon Studio', category: 'other', deliberate: false });
t('THE BOX is a restaurant here and a storage company elsewhere',
  'Purchase of AED 98.00 with Credit Card ending 5678 at THE BOX, SHARJAH. Avl Cr. Limit is AED 18,354.23',
  { merchant: 'The Box', category: 'other', deliberate: false });
// A trade-licence suffix is not a trade. "Technologies" and "Investment LLC"
// are what a UAE company registration looks like, not what the business does.
t('TECHNOLOGIES in a company name claims nothing', g('ON TECHNOLOGIES FZ LLC', 'DUBAI'),
  { merchant: 'On Technologies Fz Llc', category: 'other', deliberate: false });
// A real-estate agency is the one guess with a downstream cost: `rent` unlocks
// the relaxed bill path in subscriptions.ts, so a wrong guess there does not
// merely mislabel a row, it can mint a permanent monthly bill.
t('a real-estate agency is not filed as rent', g('BLUE BAY REAL ESTATE L', 'DUBAI'),
  { category: 'other', deliberate: false });

// ── the version that reaches already-imported rows ──
//
// Every fix above applies to NEW messages only. A message is imported once and
// never offered again, so the stored rows are reached by a PARSER_VERSION bump
// triggering a full re-read, and by nothing else.
{
  const { PARSER_VERSION } = require('./build/sms-parser');
  ok('PARSER_VERSION is past 9, so an existing ledger is re-read',
    typeof PARSER_VERSION === 'number' && PARSER_VERSION > 9, String(PARSER_VERSION));
}

/* ── a merchant rule may not cross the direction it was chosen under ──────
 *
 * `EXPENSE_CATEGORIES` and `INCOME_CATEGORIES` are disjoint, and the entry
 * sheet draws one set or the other according to the row's type. So a rule that
 * puts `dining` on a credit does not merely mis-file the row, it puts the row
 * OFF-LIST: reopen that refund and the sheet shows Salary and Business with
 * neither selected, and the category the row actually holds is invisible to
 * the person who came to fix it.
 *
 * `overrideAppliesTo` in uncategorised.ts has refused to do this on the
 * bulk-rewrite path since c79a2d6. `categoryOf` consulted the override table
 * BEFORE its `type === 'income'` branch and so did it anyway — on the path
 * that decides every future row, which is the one the screen actually promises
 * ("future imports from {merchant} will use this category").
 */
{
  const { guessCategory, overrideFitsDirection } = require('./build/sms-parser');
  const { EXPENSE_CATEGORIES, INCOME_CATEGORIES } = require('./build/categories');

  ok('an expense rule does not file a credit',
    guessCategory('TALABAT', 'income', { talabat: 'dining' }, 'TALABAT') !== 'dining',
    guessCategory('TALABAT', 'income', { talabat: 'dining' }, 'TALABAT'));
  ok('the credit falls through to the income rules instead',
    guessCategory('TALABAT', 'income', { talabat: 'dining' }, 'TALABAT') ===
      guessCategory('TALABAT', 'income', {}, 'TALABAT'));
  ok('an income rule does not file a purchase',
    guessCategory('TALABAT', 'expense', { talabat: 'salary' }, 'TALABAT') !== 'salary',
    guessCategory('TALABAT', 'expense', { talabat: 'salary' }, 'TALABAT'));

  // Not "expenses only": correcting a credit from Business to Salary in the
  // entry sheet offers to remember that merchant, so an income rule is
  // reachable and has to go on working for that merchant's future credits.
  ok('an income rule still files a credit',
    guessCategory('SOME PAYER', 'income', { 'some payer': 'salary' }, 'SOME PAYER') === 'salary');
  ok('an expense rule still files a purchase',
    guessCategory('SOME SHOP', 'expense', { 'some shop': 'dining' }, 'SOME SHOP') === 'dining');

  // End to end, which is the shape that reached a real ledger: a reversal of a
  // purchase at a merchant the user had pinned.
  const reversal = parseSms(
    'Your purchase of AED 250.00 at TALABAT with card ending 4833 has been reversed on 05/07/2026.',
    { talabat: 'dining' },
  );
  ok('a reversal of a pinned purchase is not filed under the pin',
    reversal.type === 'income' && reversal.categoryGuess !== 'dining',
    JSON.stringify({ type: reversal.type, cat: reversal.categoryGuess }));
  ok('and the category it does get is one the income chips can draw',
    ['salary', 'business', 'other'].includes(reversal.categoryGuess), reversal.categoryGuess);

  // A utility refund reads as "...has been credited... SEWA NO.-8765". That
  // branch decided its direction from the message and its category from a
  // hardcoded 'expense', so the credit was filed `utilities` — the same
  // off-list harm with no override involved at all.
  //
  // THE ASSERTION HAS TO NAME THE CATEGORY. This read
  // `['salary','business','other'].includes(...)` over a fixture with no refund
  // word in it, which is two failures at once: it passes on `business`, and its
  // fixture could not have told `business` from the right answer anyway. The
  // direction was fixed and the category was still wrong, because `categoryOf`
  // was handed the PAYEE ("SEWA") and its refund/reversal vocabulary is looking
  // for words that only ever appear in the MESSAGE. Asked about "SEWA" alone it
  // finds a named payer and returns `business` — a refunded utility deposit, a
  // four-figure sum in this market, booked as business REVENUE, which
  // `categoryOf`'s own comment forbids in as many words.
  const CREDITED = 'AED 412.00 has been credited to your account no. 095-XXX11XXX-01 SEWA NO.-8765';
  for (const [label, body, expected] of [
    // Says refund: an OFFSET against an earlier expense, not revenue. `other`.
    ['a stated refund', `Dear Customer, refund of ${CREDITED} on 03/08/2026`, 'other'],
    ['a stated reversal', `Dear Customer, reversal of ${CREDITED} on 03/08/2026`, 'other'],
    // Says nothing but names a payer: the parser's documented answer for a
    // credit with an identified originator. Pinned rather than range-checked so
    // a future edit that changes it has to say so out loud.
    ['an unexplained credit', CREDITED, 'business'],
  ]) {
    for (const [pinLabel, overrides] of [
      ['on its own', undefined],
      // An expense pin on SEWA must not reach the credit either way.
      ['with SEWA pinned to an expense category', { sewa: 'utilities' }],
    ]) {
      const row = parseSms(body, overrides);
      ok(`a credited utility row is filed ${expected} (${label}, ${pinLabel})`,
        row !== null && row.type === 'income' && row.categoryGuess === expected,
        JSON.stringify(row && { type: row.type, cat: row.categoryGuess }));
    }
  }

  // The expense side legitimately wants the PAYEE and not the message: the
  // biller's own name is the whole point of this branch, and handing it the raw
  // text would let bank boilerplate decide the category of a utility bill.
  const debit = parseSms(
    'AED 1,938.41 has been debited from your account no. 095-XXX11XXX-01 SEWA NO.-8765. The available balance is AED 7,587.88.',
  );
  ok('and a debited utility bill is still read from the payee, not the boilerplate',
    debit.type === 'expense' && debit.merchant === 'SEWA' && debit.categoryGuess === 'utilities',
    JSON.stringify({ type: debit.type, merchant: debit.merchant, cat: debit.categoryGuess }));

  // The predicate and the chip lists are two spellings of one fact, and they
  // live in different files because sms-parser.ts is bundled into the Worker
  // and categories.ts reaches i18n. Assert they agree rather than trusting it.
  ok('the parser and categories.ts agree on which categories are credits',
    INCOME_CATEGORIES.every((c) => overrideFitsDirection(c.id, 'income')) &&
      INCOME_CATEGORIES.every((c) => !overrideFitsDirection(c.id, 'expense')) &&
      EXPENSE_CATEGORIES.every((c) => overrideFitsDirection(c.id, 'expense')) &&
      EXPENSE_CATEGORIES.every((c) => !overrideFitsDirection(c.id, 'income')),
    JSON.stringify({
      income: INCOME_CATEGORIES.map((c) => c.id),
      expense: EXPENSE_CATEGORIES.map((c) => c.id),
    }));

  // The pin is announced, so heal.ts can tell the user's answer from ours.
  // `categoryDeliberate` cannot: it is true for a vocabulary rule too.
  const pinned = parseSms(
    'Purchase of AED 76.50 with Debit Card ending 1234 at SPINNEYS, DUBAI.',
    { spinneys: 'home-services' },
  );
  ok('a category taken from the user\'s rule says so',
    pinned.categoryGuess === 'home-services' && pinned.categoryPinned === true,
    JSON.stringify({ cat: pinned.categoryGuess, pinned: pinned.categoryPinned }));
  const unpinned = parseSms('Purchase of AED 76.50 with Debit Card ending 1234 at SPINNEYS, DUBAI.');
  ok('a category the parser reached on its own does not',
    unpinned.categoryPinned === undefined, String(unpinned.categoryPinned));
}


// A statement date is usually the last thing in the sentence, and the day-first
// guard used to demand whitespace after the year — so the full stop alone made
// the date null, and import-plan.ts drops a due row with no date. The reminder
// was not degraded by the punctuation, it was deleted by it.
t('a day-first due date survives a trailing full stop',
  'Your ENBD Credit Card ending 4821 statement. Total amount due AED 3,240.00. Payment due on 05-Aug-2026.',
  { date: '2026-08-05' });

t('the same date without punctuation is unchanged',
  'Your ENBD Credit Card ending 4821 statement. Total amount due AED 3,240.00. Payment due on 05-Aug-2026',
  { date: '2026-08-05' });

// The two Mashreq shapes the guard exists for must not regress.
t('Mashreq separator-less day-first date still reads',
  'Purchase of AED 40.00 with Card 1234 at LULU on 22Jan18 09:35 AM',
  { date: '2018-01-22' });

t('Mashreq hyphenated day-first date still reads',
  'Purchase of AED 40.00 with Card 1234 at LULU on 21-SEP-2023 11:10 PM',
  { date: '2023-09-21' });


// ── Exchange houses are not shops ──
//
// From a real diagnostic: "LULU EXCHANGE" matched the `lulu` grocery keyword
// and a remittance was filed as a grocery shop — which overstates consumption
// for exactly the users who send money home every month.
t('Lulu Exchange is not the hypermarket',
  'Purchase of AED 500.00 with Debit Card ending 8783 at LULU EXCHANGE, DUBAI. Avl Balance is AED 1,000.00.',
  { merchant: 'Lulu Exchange', category: 'other' });

t('Lulu Hypermarket is still groceries',
  'Purchase of AED 120.00 with Debit Card ending 8783 at LULU HYPERMARKET, SHARJAH. Avl Balance is AED 500.00.',
  { category: 'groceries' });

t('bare Lulu is still groceries',
  'Purchase of AED 120.00 with Debit Card ending 8783 at LULU, SHARJAH. Avl Balance is AED 500.00.',
  { category: 'groceries' });

t('Al Ansari Exchange is not a shop',
  'Funds Transfer of AED 258.00 has been made using your Debit Card ending 8783 at AL ANSARI EXCHANGE LLC. Your current balance is AED 14,319.86.',
  { merchant: 'Al Ansari Exchange Llc', category: 'other' });

t('Western Union is not a shop',
  'Purchase of AED 300.00 with Debit Card ending 8783 at WESTERN UNION, DUBAI. Avl Balance is AED 500.00.',
  { category: 'other' });

console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
