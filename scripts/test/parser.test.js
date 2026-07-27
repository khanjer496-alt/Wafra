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
      if (expect.transfer !== undefined && p.transferHint !== expect.transfer) errs.push(`transfer ${p.transferHint} != ${expect.transfer}`);
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

// This asserted `transport` until the location field started deciding the
// category: the ride was hailed in BANGKOK, so it is now holiday transport and
// reads as travel. The merchant is unchanged — only where the row is filed
// moved, and it moved because a Grab ride abroad belongs with the trip that
// paid for it rather than among the month's commuting at home.
t('a Grab ride hailed in Bangkok is the trip, and still names Grab',
  'Purchase of AED 16.92 with Debit Card ending 4744 at WWW.GRAB.COM, BANGKOK. Avl Balance is AED 26,306.05.  Pls refer stmt for exact amt.',
  { merchant: 'Grab', category: 'travel' });

t('...but a Grab ride in Dubai is still transport',
  'Purchase of AED 16.92 with Debit Card ending 4744 at WWW.GRAB.COM, DUBAI. Avl Balance is AED 26,306.05.  Pls refer stmt for exact amt.',
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

// Three payment shapes that were being imported as EXPENSES carrying a
// transfer hint. `allocatePayments` only credits income-side transfers, so a
// card the user had paid stayed open and the app went on calling it overdue —
// the whole point of tracking dues, wrong.
{
  const cases = [
    ['payment instructions to a masked card number',
     'Dear Customer, Your payment instructions of AED 7,663.94 to 5492********3749 has been processed on 10/07/2026 01:19',
     766394, '3749'],
    ['deducted from an account towards a card',
     'AED 4,061.69 has been deducted from your account 095XXX11XXX01 towards payment of your Credit Card ending 8575.',
     406169, '8575'],
    ['the same, on a second card',
     'AED 1,027.60 has been deducted from your account 095XXX11XXX01 towards payment of your Credit Card ending 8917.',
     102760, '8917'],
  ];
  for (const [name, raw, amt, last4] of cases) {
    const r = parseSms(raw);
    if (r && r.kind === 'cardPayment' && r.amountFils === amt && r.card && r.card.last4 === last4
        && r.card.kind === 'credit' && r.transferHint === true) {
      pass++; console.log(`✓ ${name} is a card payment`);
    } else {
      fail++; console.log(`✗ ${name} is a card payment`,
        JSON.stringify(r && { k: r.kind, a: r.amountFils, c: r.card }));
    }
  }
}

// The account the money LEFT is named first in those messages. The card it
// landed on is the one the payment belongs to.
t('a card payment is filed against the card, not the debited account',
  'AED 4,061.69 has been deducted from your account 095XXX11XXX01 towards payment of your Credit Card ending 8575.',
  { card: { last4: '8575', kind: 'credit' } });

// The new patterns must not swallow their neighbours.
t('payment instructions to a biller stay a utility bill',
  'Dear Customer, Your payment instructions of AED 417.9 to Du for consumer number 1238865 has been processed on 21/10/2022 17:03',
  { merchant: 'Du', category: 'telecom' });

t('a loan repayment towards something that is not a card stays an expense',
  'AED 2,500.00 has been deducted from your account 095XXX11XXX01 towards payment of your personal loan.',
  { category: 'loan', type: 'expense' });

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

// This test's own name recorded the gap: a salon was filed as shopping
// because there was nowhere else for it to go. There is now.
t('a salon is personal care, not shopping',
  'Purchase of AED 120.00 at SUGAR LOUNGE SALON with Credit Card ending 1234',
  { category: 'personal-care' });

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

// The biller-reference path reads the capitals before an account number. On
// its own that is also every reference label a bank prints, and an unmatched
// name used to be *called* a utility — which is how a fish shop, a furniture
// store and a transfer beneficiary became standing monthly bills.
t('an unrecognized name before a reference number is not a utility',
  'AED 20,918.00 has been debited from your account no. 095-XXX11XXX-01 FISHBASKET NO.-8765.',
  { category: 'other' });

t('a reference label is never the merchant',
  'Your card ending 1234 was used for AED 100.00 at CARREFOUR HYPERMARKET DUBAI. ACCOUNT NO.-556677',
  { merchant: 'Carrefour Hypermarket', category: 'groceries' });

t('a stripped reference label is trimmed off the name',
  'Dear Customer, AED 627.00 paid to FBINTER NO.-991 from card ending 1234.',
  { merchant: 'Fbinter' });

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
  { merchant: 'UrbanClap', amountFils: 9600, category: 'home-services' });

// Home services and personal care had no category to go to, so a corpus full
// of cleaners and salons piled into "other" — 44 of 94 occurrences before
// these rules, 13 after.
t('a cleaning company is a home service',
  'Payment for CLEANTIZER CLEANING SERVICES of AED 350.00 has been made using Credit Card ending with 4110. Available limit AED 59,797.61.',
  { merchant: 'Cleantizer', category: 'home-services' });

t('what the business is, when no brand matches',
  'Purchase of AED 180.00 with Debit Card ending 4502 at AL SAFA LAUNDRY, DUBAI. Avl Balance is AED 258.91.',
  { category: 'home-services' });

t('movers are a home service, not transport',
  'Purchase of AED 1,200.00 with Debit Card ending 4502 at SWIFT PACKERS AND MOVERS, DUBAI. Avl Balance is AED 258.91.',
  { category: 'home-services' });

t('a salon is personal care',
  'Purchase of AED 120.00 with Debit Card ending 4502 at ROYAL GENTS SALOON, DUBAI. Avl Balance is AED 258.91.',
  { category: 'personal-care' });

t('a barber is personal care, not shopping',
  'Purchase of AED 65.00 with Debit Card ending 4502 at THE BARBER SHOP DXB, DUBAI. Avl Balance is AED 258.91.',
  { category: 'personal-care' });

// A free-zone authority is a government body. The pattern matched "economic
// depart" and DED but not "economic zone", so the largest government payee in
// the corpus read as "other" eleven times.
t('a free-zone authority is government',
  'From HSBC: 24JUN25 DUBAI INTEGRATED ECO Purchase from 041-340***-001 AED 10.00- by Card Ending with 6737. Your available balance is AED 1,430.28',
  { merchant: 'Dubai Integrated Economic Zones', category: 'government' });

t('DMCC is government, not dining',
  'Purchase of AED 550.00 with Debit Card ending 4502 at DMCC FREE ZONE AUTHORITY, DUBAI. Avl Balance is AED 258.91.',
  { category: 'government' });

// The generic rules must not swallow neighbours that merely share a word.
t('a laundry detergent aisle is still groceries',
  'Purchase of AED 42.00 with Debit Card ending 4502 at CARREFOUR HYPERMARKET, DUBAI. Avl Balance is AED 258.91.',
  { category: 'groceries' });

t('a spa hotel stay is still travel',
  'Purchase of AED 900.00 with Debit Card ending 4502 at ANANTARA RESORT HOTEL, DUBAI. Avl Balance is AED 258.91.',
  { category: 'travel' });

t('Google bills through a help URL, not a location',
  'Debit Card Purchase\nCard XXXX5083\nAED 49.99\nGOOGLE*FINART AI EXPE G.CO/HELPPAY#CA US \n13/12/25 11:59 \nBalance AED 6576.11',
  { merchant: 'Finart Ai Expe', amountFils: 4999, category: 'entertainment' });

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

// ── A statement's STATED pay-by date beats the date it was generated on ──
// The parsed date becomes CardDue.dueDate, so reading the generation date
// filed the statement weeks (here, months) before the money was actually owed
// and the Bills tab, the overdue badge and payment matching all inherited it.
t('a stated pay-by date beats the generation date',
  'Your ADCB Credit Card 1234 statement. Total amount due AED 1,500.00. Generated on 30/12/2026. Please pay by Jul 19 2027.',
  { kind: 'cardStatement', amountFils: 150000, date: '2027-07-19' });

t('a numeric pay-by date beats a numeric generation date',
  'Your Credit Card ending 4821 statement is generated on 04/07/2026. Total due AED 3,240.00, minimum due AED 162.00. Please pay by 24/07/2026.',
  { kind: 'cardStatement', amountFils: 324000, date: '2026-07-24' });

// The due phrase and its date sit either side of the card clause here, so the
// bridge between them has to span it without wandering onto another figure.
t('FAB "payment due date of your card ... is <date>" still reads the due date',
  'Dear Customer, the payment due date of your FAB Credit Card ending with 4833 is 06-07-2026. The total amount due is AED 8,144.40 and the Minimum due amount is AED 407.22. Please ignore the message, if already paid.',
  { kind: 'cardStatement', amountFils: 814440, date: '2026-07-06' });

// The FAB shape above reads correctly even from the plain date extractor,
// because its due date is the only date present. Put a generation date in
// front of it and only a due-anchored read gets the right answer.
t('FAB due-date phrasing beats a generation date placed before it',
  'Dear Customer, your statement was generated on 01-07-2026. The payment due date of your FAB Credit Card ending with 4833 is 06-07-2026. The total amount due is AED 8,144.40 and the Minimum due amount is AED 407.22.',
  { kind: 'cardStatement', amountFils: 814440, date: '2026-07-06' });

t('ADCB "is due by <Mon DD YYYY>" is unchanged',
  'Min payment of AED100.00 on your Cr.Card XXX7720 is due by Jul 19 2026. Total billed amt is AED1174.49. Pls ignore this message if already paid.',
  { kind: 'cardStatement', amountFils: 117449, date: '2026-07-19' });

t('a statement carrying only one date still reads it',
  'Statement generated. Total due AED 3,240.00, minimum due AED 162.00 by 05/08/2026 on your card ending 8573',
  { kind: 'cardStatement', date: '2026-08-05' });

// Due-date preference is confined to the statement branch. On a purchase, the
// transaction's own timestamp must keep beating the "statement due on <date>"
// footer the same message carries — otherwise every charge on these cards
// would be filed on its statement's pay-by date instead of the day it happened.
t('a purchase with a statement-due footer still dates from the purchase',
  'Credit Card Purchase\nCard No XXXX4711\nAED 16.00\nMawgif DUBAI ARE\n03/07/26 15:51\nAvl Bal AED 9693.97\nJuly statement due on 27/07/2026',
  { kind: 'transaction', amountFils: 1600, date: '2026-07-03' });

t('a purchase with a "payment due date is" footer still dates from the purchase',
  'Credit Card Purchase \nCard No XXXX9960 \nAED 353.00 \nMinistry of Interior AUH ARE \n20/02/25 20:37 \nAvailable Balance AED 2535.22 Your February statement payment due date is 26/02/2025',
  { kind: 'transaction', amountFils: 35300, date: '2025-02-20' });

// ── Card payments are settlements, not spending ──
t('a payment received on a card is a cardPayment transfer',
  'Payment of AED 2,000.00 received on your card ending 8575. Thank you.',
  { kind: 'cardPayment', amountFils: 200000, transfer: true, category: 'other' });

t('a payment received towards a credit card is a cardPayment transfer',
  'Payment of AED 3,240.00 has been received towards your Credit Card ending 4821.',
  { kind: 'cardPayment', amountFils: 324000, transfer: true });

// The card a payment lands on decides which statement it settles.
const payCard = parseSms('Payment of AED 2,000.00 received on your card ending 8575. Thank you.');
if (payCard && payCard.card && payCard.card.last4 === '8575' && payCard.card.kind === 'credit') {
  pass++; console.log('✓ a card payment is attributed to the card it names');
} else {
  fail++; console.log('✗ a card payment is attributed to the card it names',
    JSON.stringify(payCard && payCard.card));
}

// A statement that quotes no minimum must report null, never a percentage —
// the import bridge is what decides whether to estimate, and it flags it.
const noMin = parseSms('Your Credit Card ending 4821 statement is generated. Total due AED 3,240.00. Please pay by 24/07/2026.');
if (noMin && noMin.kind === 'cardStatement' && noMin.minDueFils === null) {
  pass++; console.log('✓ an unstated minimum parses as null, not a guess');
} else {
  fail++; console.log('✗ an unstated minimum parses as null, not a guess',
    JSON.stringify(noMin && { k: noMin.kind, min: noMin.minDueFils }));
}

// ── Audit round: rules that were claiming messages they should not ──

// The worst of them. `7-?11` was unanchored, so it matched the DIGITS OF A
// CARD NUMBER: "Card No XXXX4711" contains "711". Every purchase on that card
// that matched no other rule was filed as groceries — and the card ending 4711
// is the one most of the multi-line corpus is on.
t('a card number containing 711 is not a corner shop',
  'Purchase of AED 1.00 with Debit Card ending 4711 at XPOWERPLUS, DUBAI. Avl Balance is AED 7,097.56.',
  { merchant: 'Xpowerplus', category: 'other', amountFils: 100 });
t('...and the rule still reads a real 7-Eleven',
  'Purchase of AED 12.00 with Debit Card ending 4744 at 7-ELEVEN AL BARSHA, DUBAI. Avl Balance is AED 846.57.',
  { category: 'groceries' });

// `water` was unbounded, so utilities claimed every waterpark ahead of the
// entertainment rule that names them — including WILD WADI, which is listed
// there by name. Utilities also unlocks the relaxed bill path, so a day out
// could mint a standing monthly bill.
t('a waterpark is entertainment, not a utility',
  'Purchase of AED 42.00 with Debit Card ending 4744 at AQUAVENTURE WATERPARK, DUBAI. Avl Balance is AED 846.57.',
  { category: 'entertainment' });
t('the fish market is groceries, not a utility',
  'Purchase of AED 42.00 with Debit Card ending 4744 at WATERFRONT MARKET, DUBAI. Avl Balance is AED 846.57.',
  { category: 'groceries' });
t('a water authority is still a utility',
  'Purchase of AED 42.00 with Debit Card ending 4744 at SHARJAH WATER AUTHORITY, DUBAI. Avl Balance is AED 846.57.',
  { category: 'utilities' });

// `metro` was unbounded and transport runs before travel.
t('a hotel whose name starts with Metro is travel',
  'Purchase of AED 42.00 with Debit Card ending 4744 at METROPOLITAN HOTEL DUBAI, DUBAI. Avl Balance is AED 846.57.',
  { category: 'travel' });
t('the Metro itself is still transport',
  'Purchase of AED 42.00 with Debit Card ending 4744 at DUBAI METRO STATION, DUBAI. Avl Balance is AED 846.57.',
  { category: 'transport' });

// PLACE_TAIL_RE peeled a GLUED "RAK" — three letters that end an Arabic word
// far more often than they name Ras Al Khaimah. "Al Muba" was the result.
t('a glued RAK is the end of the name, not an emirate',
  'Purchase of AED 42.00 with Debit Card ending 4744 at AL MUBARAK, DUBAI. Avl Balance is AED 846.57.',
  { merchant: 'Al Mubarak' });
t('...but the emirate written out still comes off',
  'Credit Card Purchase \nCard No XXXX3749 \nAED 78.80 \nGOLDEN CITY RAS AL KHAIMA ARE \n10/05/25 11:57 \nAvailable Balance AED 1474.55',
  { merchant: 'Golden City', amountFils: 7880 });

// The country-code strip ate a real trailing word. The vocabulary already
// knows "toys r us" by its full name; the descriptor cleanup was destroying
// the very string the rule matches on.
t('a shop whose name ends in US keeps it',
  'Purchase of AED 42.00 with Debit Card ending 4744 at TOYS R US, DUBAI. Avl Balance is AED 846.57.',
  { merchant: 'Toys R Us', category: 'shopping' });

// A bill reminder took its amount from the balance fallback, which can only
// ever return a figure the message introduced as a BALANCE or a LIMIT. This is
// the tail segment of the multi-line FAB format already tested above, as it
// arrives when a long message is split: no purchase line, so nothing marks it
// as a transaction, and it used to import as a AED 9,705.65 bill.
t('a due reminder never takes the available balance as its amount',
  'Avl Bal AED 9705.65\nJuly statement due on 27/07/2026',
  null);

// HSBC runs the transaction date together with no separators. Nothing in the
// grammar could read it, so every HSBC message was filed on the day it was
// imported rather than the day it happened.
t('the HSBC date prefix is read',
  'From HSBC: 24JUN25 DUBAI INTEGRATED ECO Purchase from 041-340***-001 AED 10.00- by Card Ending with 6737. Your available balance is AED 1,430.28',
  { date: '2025-06-24' });
t('the HSBC date prefix is read on a transfer too',
  'From HSBC: 20MAR25 TT Payment to 041-339***-001 AED 1,108.00+ Your available balance is AED 946.48',
  { date: '2025-03-20', merchant: 'Bank transfer' });

// ── "other" means two opposite things ──
// A brokerage mapped to "other" on purpose is a row the parser understands.
// A row that failed every rule is not. The accuracy report could not tell them
// apart and called all of them unread formats.
{
  const cases = [
    ['a brokerage is deliberately uncategorized',
     'Credit Card Purchase \nCard No XXXX3749 \nAED 3000.00 \neToro ME LTD etoro ARE \n24/12/25 22:48 \nAvailable Balance AED 5409.02', true],
    ['a crypto on-ramp is deliberately uncategorized',
     'Purchase of AED 2,062.26 with Debit Card ending 8783 at CRYPTO.COM, SAN GILJAN. Avl Balance is AED 37,091.01.', true],
    ['a card settlement is deliberately uncategorized',
     'Payment of AED 2,000.00 received on your card ending 8575. Thank you.', true],
    ['a savings sweep is deliberately uncategorized',
     'AED 7,000.00 has been debited from your account no. 095XXX13XXX01 TO LIV FROM EMERGENCY FUNDS. The available balance is AED 7,939.20.', true],
    ['an unknown shop is NOT deliberately uncategorized',
     'Purchase of AED 1.00 with Debit Card ending 8783 at XPOWERPLUS, DUBAI. Avl Balance is AED 7,097.56.', false],
  ];
  for (const [name, raw, want] of cases) {
    const r = parseSms(raw);
    if (r && r.categoryGuess === 'other' && Boolean(r.categoryDeliberate) === want) {
      pass++; console.log(`✓ ${name}`);
    } else {
      fail++; console.log(`✗ ${name}`,
        JSON.stringify(r && { c: r.categoryGuess, d: r.categoryDeliberate }));
    }
  }
  // A category the vocabulary DID choose is a decision too.
  const known = parseSms('Purchase of AED 42.00 with Debit Card ending 4744 at CARREFOUR, DUBAI. Avl Balance is AED 846.57.');
  if (known && known.categoryGuess === 'groceries' && known.categoryDeliberate === true) {
    pass++; console.log('✓ a matched category is marked deliberate');
  } else {
    fail++; console.log('✗ a matched category is marked deliberate', JSON.stringify(known && { c: known.categoryGuess, d: known.categoryDeliberate }));
  }
}

// ── Second accuracy export: merchants the vocabulary had no entry for ──
// Every descriptor below is quoted from uae-accuracy-report-2.txt, where it
// was read correctly and then dumped in "other".
for (const [descriptor, category] of [
  // Acquirer truncations of "AUTO SERVICE" / "AUTO AC", and the parking
  // operator's vowel-free descriptor.
  ['PRKN-MTPA', 'transport'],
  ['TIER AE RIDE', 'transport'],
  ['AL HABTOOR MOTORS CO L', 'transport'],
  ['FARIQ AL AWAIEL AUTO S', 'transport'],
  ['SHABAB AL KHAN AUTO AC', 'transport'],
  ['MENA MOBILITY LLC', 'transport'],
  // The existing rule was `pull ?& ?bear`; the acquirer spells out the AND.
  ['PULL AND BEAR', 'shopping'],
  ['DALMA READY MADE GAR T', 'shopping'],
  ['RUKN AL ASAAD READYMAD', 'shopping'],
  ['AL SAAD FURNITURE EST', 'shopping'],
  ['BRAND FOLIO LLC', 'shopping'],
  ['G O A T', 'shopping'],
  ['UNDER ARMOUR-C.PHUKET FES', 'shopping'],
  ['CRC SPORTS-PHUKET 4', 'shopping'],
  ['A025-AIIZ-JUNGCEYLON PHUK', 'shopping'],
  ['SP YZY SPLY', 'shopping'],
  ['QDF CONCOURSE A DOHA', 'shopping'],
  ['DUBAI RETAIL ASSETS', 'shopping'],
  ['HUTONG', 'dining'],
  ['POINT SEVEN SPECIALIT', 'dining'],
  ['WAQT AL KHAFAYEF CAF', 'dining'],
  ['AL BAAR WA AL BAHR ROA', 'dining'],
  ['BLOOMFIELD TREAT-245814', 'dining'],
  ['TOPS-PATONG', 'groceries'],
  ['SERRURIER', 'home-services'],
  ['AL KHABEER AL AWAL PH', 'health'],
  // "INSURA" is one character shorter than the `insuran` the rule wanted.
  // Insurance has no category of its own; it lands where insurance lands.
  ['UNITED FIDELITY INSURA', 'health'],
  ['DAYPASSAPP.COM', 'travel'],
  ['MAILTRACK.IO', 'entertainment'],
  ['Google VPN Proton Fas', 'entertainment'],
]) {
  t(`${descriptor} reads as ${category}`,
    `Purchase of AED 42.00 with Debit Card ending 4744 at ${descriptor}, DUBAI. Avl Balance is AED 846.57.`,
    { category });
}

// ...and the neighbours those new alternations could have eaten.
for (const [descriptor, category] of [
  ['MOTOR CITY GARDENS', 'other'],      // \bmotors\b is plural on purpose
  ['CAFU FUEL DELIVERY', 'transport'],  // \bcaf\b must not reach CAFU
  ['SUN & SAND SPORTS', 'shopping'],    // crc sports must not move sportswear
  ['GYMNATION FITNESS', 'health'],
  ['ANANTARA RESORT HOTEL', 'travel'],
  ['CARREFOUR HYPERMARKET', 'groceries'],
]) {
  t(`${descriptor} still reads as ${category}`,
    `Purchase of AED 42.00 with Debit Card ending 4744 at ${descriptor}, DUBAI. Avl Balance is AED 846.57.`,
    { category });
}

// ── The gateway prefix is evidence, not noise ──
// cleanDescriptor strips GOOGLE*/PAYPAL */TAP* off the NAME, because the
// gateway is not the shop. But the prefix says what kind of purchase it was,
// and guessCategory reads the raw message, where it survives. These rules sit
// below every brand rule so the sub-merchant always wins.

t('a Play Store charge is entertainment',
  'Purchase of AED 49.99 with Debit Card ending 1354 at GOOGLE*CANDLE COUPLE, G.CO/HELPPAY#. Avl Balance is AED 30,417.54.  Pls refer stmt for exact amt.',
  { merchant: 'Candle Couple', category: 'entertainment', amountFils: 4999 });

t('a PayPal star is followed by a payee, so it is a purchase',
  'From HSBC: 08SEP25 PAYPAL *CXIANGHUI01L Purchase from 041-340***-001 AED 259.40- by Card Ending with 6737. Your available balance is AED 7.03',
  { merchant: 'Cxianghui01l', category: 'shopping', amountFils: 25940 });

t('a PayPal star with a foreign-fee note is still a purchase',
  'Your Cr.Card XXX7720 was used for AED99.18 (plus foreign transaction fee of 2.1%) on 15/06/2024 17:49:27 at PAYPAL *FARHANAUSMA,····9001-GB. Avl. Cr.limit is AED4322.45',
  { merchant: 'Farhanausma', category: 'shopping', amountFils: 9918 });

t('a UAE checkout platform is shopping',
  'Debit Card Purchase \nDebit \nAccount XXXX0002 \nCard XXXX8335\nAED 1.00\nzbooni.com/marketplaceDubai           AE \n08/03/25 12:58 \nAvailable Balance AED 2633.19',
  { category: 'shopping', amountFils: 100 });

t('the glued NEXT UAE AED ECOM storefront is shopping',
  'Purchase of AED 272.00 with Debit Card ending 1354 at NEXTUAEAEDECOMIC1, DUBAI. Avl Balance is AED 16,536.80.',
  { category: 'shopping', amountFils: 27200 });

// Two charges the gateway rules must NOT call purchases: both are the
// verification hold a wallet places when a card is added. `other` here is an
// answer, not a shrug, so the accuracy report must not report them.
{
  const cases = [
    ['a Google wallet hold is not an in-app purchase',
     'Credit Card Purchase \nCard No XXXX3749 \nAED 4.00 \nGOOGLE*WALLET TEMP G.CO/HELPPAY# USA \n26/11/25 22:56 \nAvailable Balance AED 995.02'],
    ['PayPal with no star and no payee is a card verification',
     'Your Cr.Card XXX7720 was used for USD1.00 on 15/06/2024 17:49:15 at PAYPAL,····7733-LU. Avl. Cr.limit is AED4417.96'],
  ];
  for (const [name, raw] of cases) {
    const r = parseSms(raw);
    if (r && r.categoryGuess === 'other' && r.categoryDeliberate === true) {
      pass++; console.log(`✓ ${name}`);
    } else {
      fail++; console.log(`✗ ${name}`, JSON.stringify(r && { c: r.categoryGuess, d: r.categoryDeliberate }));
    }
  }
}

// The star is the whole discriminator between those two PayPal rules, and the
// sub-merchant still outranks both.
t('a PayPal subscription keeps its own service and category',
  'Purchase of AED 16.50 at PAYPAL *REALDEBRID with Credit Card ending 4821',
  { merchant: 'Real-Debrid', category: 'entertainment' });

// ── One trip, not twelve scattered rows ──
// WHERE beats WHAT. Twelve charges on one card whose LOCATION field is in
// Thailand: a resort, a boat charter, a driver, a guesthouse, a phone shop, a
// mall, a coffee shop — and four whose own brands the vocabulary knows
// perfectly well. All of it is the holiday, so the location decides before any
// merchant rule runs.
for (const descriptor of [
  'PHUKET DELIGHT',
  'NIKORN MARINE',
  'PRASERT ON-PUTTHA',
  'PHONEINN',
  'PZD131 CENTRAL PHUKET',
  'AT TWENTY TWO HOUSE',
  'AROMAYA',
  // These four have brand rules — shopping, shopping, shopping, groceries —
  // and the location beats every one of them.
  'A025-AIIZ-JUNGCEYLON PHUK',
  'CRC SPORTS-PHUKET 4',
  'UNDER ARMOUR-C.PHUKET FES',
  'TOPS-PATONG',
]) {
  t(`${descriptor} on holiday reads as travel`,
    `Purchase of AED 42.00 with Debit Card ending 8783 at ${descriptor}, PHUKET. Avl Balance is AED 846.57.  Pls refer stmt for exact amt.`,
    { category: 'travel' });
}

t('a Bangkok location is the trip too',
  'Purchase of AED 0.10 with Debit Card ending 8783 at WWW.2C2P.COM*2C2P BOLT (M, BANGKOK. Avl Balance is AED 35,848.02.  Pls refer stmt for exact amt.',
  { category: 'travel', amountFils: 10 });

// The multi-line format has no location line — the country code at the end of
// the descriptor line IS the location field. The padded tail cannot be used
// for this: "Ziina  *qasr al zain m Sharjah ARE" pads inside the shop's name.
t('a THA country code on the descriptor line is the trip',
  'Credit Card Purchase \nCard No XXXX3749 \nAED 80.81 \nTOPS-PATONG PHUKET THA \n24/01/26 11:47 \nAvl Bal AED 3696.56',
  { category: 'travel', amountFils: 8081 });

// The whole point of reading the LOCATION field and not the message: a Thai
// restaurant in the UAE is a UAE dinner. Both formats, because they find the
// location in completely different ways.
t('a Thai-named restaurant located in Dubai is dining, not travel',
  'Purchase of AED 42.00 with Debit Card ending 8783 at BANGKOK RESTAURANT LLC, DUBAI. Avl Balance is AED 846.57.',
  { category: 'dining' });
t('...the same in the multi-line format',
  'Credit Card Purchase \nCard No XXXX3749 \nAED 60.00 \nPHUKET THAI KITCHEN Dubai ARE \n24/01/26 11:47 \nAvl Bal AED 3696.56',
  { merchant: 'Phuket Thai Kitchen', category: 'dining' });

// The rest of that card, either side of the trip, is untouched.
for (const [descriptor, place, category] of [
  ['PULL AND BEAR', 'DUBAI', 'shopping'],
  ['DUBAI RETAIL ASSETS', 'DUBAI', 'shopping'],
  ['TIER AE RIDE', 'Berlin', 'transport'],
  ['CRYPTO.COM', 'SAN GILJAN', 'other'],
]) {
  t(`${descriptor} in ${place} is unaffected by the trip rule`,
    `Purchase of AED 42.00 with Debit Card ending 8783 at ${descriptor}, ${place}. Avl Balance is AED 846.57.`,
    { category });
}

// I did NOT generalise the trip rule to "any non-ARE country code": these two
// carry one and must stay unresolved. USD 300 of ebooks billed from Accra is
// not a holiday.
for (const [name, raw] of [
  ['an ebook charge from Accra is not a trip',
   'Credit Card Purchase \nCard No XXXX9960 \nUSD 300.00 \nWASSAGY EBOOKS MAAHEKO-ACCRA GHA \n03/04/25 16:29 \nAvailable Balance AED 1242.83'],
  ['a Brussels web charge is not a trip',
   'Credit Card Purchase \nCard No XXXX3644 \nUSD 50.00 \nYAMM.COM BRUSSELS BEL \n07/07/26 14:53 \nAvl Bal AED 7806.31'],
]) {
  const r = parseSms(raw);
  if (r && r.categoryGuess === 'other' && !r.categoryDeliberate) {
    pass++; console.log(`✓ ${name}`);
  } else {
    fail++; console.log(`✗ ${name}`, JSON.stringify(r && { c: r.categoryGuess, d: r.categoryDeliberate }));
  }
}

// ── Named merchants from the second export ──
t('a bakery-cafe behind a Tap link is dining',
  'Debit Card Purchase  \nCard XXXX5083\nAED 134.00\nTAP*CASA PONS         Dubai           AE \n31/03/26 15:47 \nBalance AED 6002.98',
  { merchant: 'Casa Pons', category: 'dining', amountFils: 13400 });

t('a modest-fashion brand behind a Mamo link is shopping',
  'Credit Card Purchase \nCard No XXXX3749 \nAED 366.45 \nMamo*aneeq Dubai ARE \n24/01/26 11:47 \nAvl Bal AED 3696.56',
  { merchant: 'Aneeq', category: 'shopping', amountFils: 36645 });

t('a salon behind a Ziina link is personal care',
  'Credit Card Purchase \nCard No XXXX3749 \nAED 250.00 \nZiina  *qasr al zain m Sharjah ARE \n29/05/26 12:39 \nAvl Bal AED 4861.46',
  { merchant: 'Qasr Al Zain M', category: 'personal-care', amountFils: 25000 });

for (const [descriptor, category] of [
  ['OFF PRICE GENERAL TRAD', 'shopping'],
  ['AL BAHAR AL MUTAWASIT', 'dining'],
  ['THAI CORNER GENERAL TR', 'dining'],
  ['GOLDEN CITY RAS AL KHAIMA', 'dining'],
  ['Dubai Refreshment', 'groceries'],
  ['PM CONNECT PORTAL', 'entertainment'],
  ['MUZZ LTD', 'entertainment'],
]) {
  t(`${descriptor} reads as ${category}`,
    `Purchase of AED 42.00 with Debit Card ending 4744 at ${descriptor}, DUBAI. Avl Balance is AED 846.57.`,
    { category });
}

// ── A reversal is two events wearing one word ──
// `reversed` sat in DECLINED_RE, so a chargeback was discarded outright. The
// user confirmed the USD 300 Accra charge was fraud: the fraudulent expense is
// already in the ledger, and the credit undoing it never landed — charged for
// the fraud twice, and unrecoverable by healing, because a refused message
// leaves no row to heal.
//
// These wordings are constructed, not sampled. They are here to pin the
// REFUSAL boundary, which is the part that was already asserting something
// about messages nobody has seen. No format-reading rule rests on them.
t('a reversal credited to the account is money coming back',
  'Your transaction of AED 1,101.75 at WASSAGY EBOOKS has been reversed and credited to your account.',
  { type: 'income', amountFils: 110175, merchant: 'Wassagy Ebooks', category: 'other' });

t('a reversal credited to the CARD is money coming back too',
  'Your transaction of AED 1,101.75 has been reversed and credited to your Card ending 9960.',
  { type: 'income', amountFils: 110175, category: 'other' });

// Purchase wording must not flip the direction back to spending: the message
// names the original charge, and "reversed ... credited" outranks it.
t('a reversal keeps its direction even when worded as a purchase',
  'Your purchase of AED 1,101.75 at WASSAGY EBOOKS has been reversed and credited to your Card ending 9960.',
  { type: 'income', amountFils: 110175, merchant: 'Wassagy Ebooks', category: 'other' });

t('the reversal wording already handled still works',
  'Reversal of AED 1,101.75 has been credited to your Card ending 9960.',
  { type: 'income', amountFils: 110175, category: 'other' });

t('...and so does the refund wording',
  'AED 1,101.75 has been refunded to your Credit Card ending 9960.',
  { type: 'income', amountFils: 110175, category: 'other' });

// The failed-at-the-terminal reading is why the word was refused, and it must
// keep being refused. The last two are the reason the guard does NOT use
// CREDIT_WORDS: its bare `credit` matches the "Credit Card" and "available
// credit" that nearly every bank message carries.
t('a reversal with no sign of a credit is still refused',
  'Your transaction of AED 500.00 at SHARAF DG has been reversed.',
  null);
t('"Credit Card" is not evidence that money came back',
  'Your purchase of AED 500.00 on your Credit Card ending 9960 has been reversed.',
  null);
t('"available credit" is not evidence either',
  'Your transaction of AED 500.00 has been reversed. Available credit AED 1,000.00',
  null);

// declined: unchanged, including with credit wording. A declined transaction
// never debited, so there is nothing to put back and nothing to import.
t('a declined transaction is refused even when it mentions a credit',
  'Your transaction of AED 500.00 was declined and the amount has been credited to your account.',
  null);

// cancelled was never in the refusal set, and the corpus message proves the
// path works. Nothing to change.
t('a cancelled-order refund is unaffected',
  "We've issued your refund of 58.89 AED for your cancelled order.",
  { type: 'income', merchant: 'Refund', amountFils: 5889 });

// ── The promo guard's escape hatch did not cover two real formats ──
//
// PROMO_RE is a list of bare stems (`promo`, `bonus`, `discount`, `voucher`,
// `cashback`) and TXN_EVIDENCE_RE is the only thing that stops one of them
// discarding a real charge. Measured over both accuracy exports, 14 distinct
// messages / 56 occurrences carried NO evidence at all and survived only
// because nothing in them happened to look like marketing.
//
// The two formats below are the bulk of that, and both are corpus text:
// report-1 #8 and report-1 #6. The footer appended in the promo cases is the
// footer report-2 #6, #27 and #41 all carry verbatim from the same bank — the
// point of the test is that a real purchase does not disappear when its bank
// staples its standard advert onto the end.

// Format A: "Payment for <SHOP> of AED <x> has been made using Credit Card
// ending with <n>. Available limit AED <y>." — no "purchase of", and the
// balance is labelled "Available limit", which the evidence list did not know.
t('the "has been made using" purchase format counts as evidence money moved',
  'Payment for CARIBOU COFFEE of AED 26.00 has been made using Credit Card ending with 4110. Available limit AED 63,155.07.',
  { merchant: 'Caribou Coffee', amountFils: 2600, category: 'dining' });

t('...and it survives the bank stapling its advert to the end',
  'Payment for CARIBOU COFFEE of AED 26.00 has been made using Credit Card ending with 4110. Available limit AED 63,155.07.\n0% instalments up to 12 months, NO fees on international purchases. bit.ly/4nR8uHP Conditions apply.',
  { merchant: 'Caribou Coffee', amountFils: 2600, category: 'dining' });

// Format B: the multi-line alert whose balance line is a bare "Balance", so
// neither `avl bal` nor `available balance` fired. The header is the evidence.
t('the multi-line "Debit Card Purchase" header counts as evidence money moved',
  'Debit Card Purchase  \nCard XXXX5083\nAED 53.58\nMARK AND SAVE         Dubai           AE \n19/02/26 15:45 \nBalance AED 1780.67',
  { merchant: 'Mark & Save', amountFils: 5358, category: 'groceries' });

t('...and it survives the advert too',
  'Debit Card Purchase  \nCard XXXX5083\nAED 53.58\nMARK AND SAVE         Dubai           AE \n19/02/26 15:45 \nBalance AED 1780.67\n0% instalments up to 12 months, NO fees on international purchases. bit.ly/4nR8uHP Conditions apply.',
  { merchant: 'Mark & Save', amountFils: 5358, category: 'groceries' });

// The guard still has to throw away actual marketing. Widening the evidence
// list must not buy that back: none of these names a format, and the first two
// carry no debit verb and no readable charge either.
t('a pure promo is still refused',
  'Get AED 100 cashback offer when you shop now! T&C apply. https://promo.example',
  null);
t('a property advert is still refused',
  'New Launch! Masaar 3 by Arada\nLuxury Villas & Townhouse \n2,3,4 & 5 Beds \nStarts from AED 1.79 MN\n60/40 Payment Plan\nCall Us Now\n5553243\nwa.link/eqm3uu',
  null);

// ── `hold` was matching inside a longer word ──
//
// PREAUTH_RE refuses the message outright, and a refusal leaves no row to heal
// later, so an over-match here deletes spending permanently. "HOUSEHOLD OF" is
// `hold of`. The descriptor template is the one this file already uses for
// every category assertion (report-2's "Purchase of ... at <X>, DUBAI" shape);
// the shop name is a kind the app's own vocabulary lists (`house ?hold`).
t('a shop whose name contains HOUSEHOLD is not a pre-auth hold',
  'Purchase of AED 42.00 with Debit Card ending 4744 at HOUSEHOLD OF FURNITURE, DUBAI. Avl Balance is AED 846.57.',
  { amountFils: 4200, category: 'shopping' });

// ...and a genuine hold is still refused, in both wordings.
t('a real pre-auth hold is still refused',
  'A pre-auth hold of AED 500.00 has been placed on your card ending 1234 at HOTEL ATLANTIS',
  null);
t('a bare "hold of" hold is still refused',
  'A hold of AED 500.00 has been placed on your Credit Card ending 1234.',
  null);

// ── a statement is never money moving ──
//
// A card statement with no digits in it had nothing to attach a due to, so it
// fell through to the generic path: "Your ADCB credit card statement is
// ready. Total due AED 714.74" imported as INCOME of 714.74, filed as
// business revenue. A message announcing a bill must never become money
// moving, in either direction, however little else can be told about it.
t('statement with no card digits is refused',
  'Your ADCB credit card statement is ready. Total due AED 714.74, minimum due AED 100.00, due on 18/08/2026.',
  null);
t('statement with no card digits is refused (FAB wording)',
  'Your FAB Credit Card statement is ready. Total amount due AED 8,909.00, minimum due AED 445.00, payment due date 14/07/2026.',
  null);
// Narrow on purpose: a utility bill that says "total amount due" is a real
// bill reminder and must still reach the billDue path.
t('a utility bill saying total amount due is still a bill',
  'Your DEWA bill: total amount due AED 300.00, due on 15/07/2026.',
  { kind: 'billDue' });
// And a statement that DOES name its card is unaffected.
t('a statement naming its card still reads as one',
  'Dear Customer, your FAB Credit Card XXXX3324 statement: Minimum Amount Due AED 445.00. Payment Due Date 14/07/2026.',
  { kind: 'cardStatement' });

console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
