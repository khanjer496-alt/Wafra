const { parseSms } = require('./build/sms-parser');

let pass = 0, fail = 0;
function t(name, msg, expect) {
  const p = parseSms(msg);
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
    }
  }
  if (errs.length) { fail++; console.log(`✗ ${name}\n    ${errs.join('\n    ')}`); }
  else { pass++; console.log(`✓ ${name}`); }
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
  { merchant: 'Incoming transfer', type: 'income', amountFils: 1850000, category: 'salary' });

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

// ── multi-bank corpus: each UAE bank speaks its own SMS dialect ──
t('ENBD style: Avl Cr. Limit is a limit snapshot, merchant before comma',
  'Purchase of AED 89.50 with Credit Card ending 4844 at CARREFOUR, DUBAI. Avl Cr. Limit AED 14,671.30',
  { merchant: 'Carrefour', amountFils: 8950, category: 'groceries' });

t('Liv style: "You spent ... on your debit card" parses',
  'You spent AED 45.00 on your Liv debit card 1354 at STARBUCKS DIFC on 20/07/2026',
  { merchant: 'Starbucks Difc', amountFils: 4500, category: 'dining', date: '2026-07-20' });

t('Mashreq style: "debited from account ... for" names the payee',
  'AED 250.00 has been debited from your account XX1234 towards DU MONTHLY BILL on 18/07/2026',
  { amountFils: 25000, category: 'telecom' });

t('ADCB style: transaction with available balance suffix',
  'Your Debit Card XXX4833 was used for AED 132.75 at LULU HYPERMARKET AL BARSHA on 19/07/2026. Available Balance AED 6,292.43',
  { merchant: 'Lulu Hypermarket Al Barsha', amountFils: 13275, category: 'groceries' });

t('DIB style: Dhs alias amount parses',
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

t('ChatGPT via Google descriptor categorizes as entertainment',
  'Purchase of AED 76.99 with Debit Card ending 4733 at Google ChatGPT, 650-5550000. Avl Balance is AED 11,102.89.  Pls refer stmt for exact amt.',
  { merchant: 'ChatGPT', category: 'entertainment' });

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

t('salon classifies as shopping (personal care)',
  'Purchase of AED 120.00 at SUGAR LOUNGE SALON with Credit Card ending 1234',
  { category: 'shopping' });

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

t('restaurant-tech processors are dining, not "other"',
  'Purchase of AED 313.95 with Debit Card ending 4733 at WWW GRUBTECH COM, DUBAI. Avl Balance is AED 36,326.96.',
  { merchant: 'Grubtech', category: 'dining' });

t('developer tooling has a home instead of falling to "other"',
  'Purchase of USD 20.00 with Debit Card ending 4733 at CURSOR, AI POWERED IDE, +9715504. Avl Balance is AED 13,933.26.',
  { merchant: 'Cursor', category: 'entertainment' });

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
t('a biller portal receipt takes its category from the channel',
  'Dear Customer, Your payment to the account number ····2543 has been processed.\nAmount Due: AED 408.45 \nAmount Paid: AED 408.45 \nPayment Channel: Etisalat Mobile App',
  { merchant: 'Payment to \u20222543'.replace('\u2022', '\u2022'), category: 'telecom' });

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
t('fiverr matches even with a region suffix', shop('FiverrEU', 'Nicosia'), { category: 'entertainment' });

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

console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
