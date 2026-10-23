const assert = require('node:assert/strict');
const { createLoader } = require('./load-ts.cjs');
const { inspectUniversalBankEvent: inspect } = createLoader()('@/lib/universal-parser');
let passed = 0, failed = 0;
const check = (name, fn) => {
  try { fn(); passed++; console.log('PASS ' + name); }
  catch (error) { failed++; console.error('FAIL ' + name + ': ' + error.message); }
};
const money = (currency, minorUnits, exponent) => ({ currency, minorUnits, exponent });

// Synthetic structural probes: these do not claim banks send these sentences.
for (const separator of [', ', '. ', '\n']) {
  check('unregistered Canadian bank: purchase and balance keep their own amounts ' + JSON.stringify(separator), () => {
    const event = inspect('Card purchase CAD 24.90 at MAPLE CAFE on 2026-09-05' + separator + 'Available balance CAD 500.00.', { sender: 'UNLISTED-BANK' });
    assert.equal(event.decision, 'review');
    assert.equal(event.family, 'purchase');
    assert.equal(event.status, 'posted');
    assert.equal(event.direction, 'debit');
    assert.deepEqual(event.amount.value, money('CAD', '2490', 2));
    assert.deepEqual(event.balance.value, money('CAD', '50000', 2));
    assert.equal(event.merchant.value, 'MAPLE CAFE');
    assert.equal(event.transactionDate.value, '2026-09-05');
  });
}
for (const [currency, literal, minor, exponent] of [
  ['JPY', '2400', '2400', 0], ['USD', '24.90', '2490', 2],
  ['KWD', '12٫345', '12345', 3], ['AUD', '24.90', '2490', 2],
  ['AED', '24.90', '2490', 2], ['SAR', '24.90', '2490', 2],
]) {
  check(currency + ': explicit native money does not need a country registration', () => {
    const event = inspect(`Card purchase ${currency} ${literal} at LOCAL CAFE on 2026-09-05.`);
    assert.equal(event.decision, 'review');
    assert.deepEqual(event.amount.value, money(currency, minor, exponent));
  });
}
check('French words and comma decimals retain exact money and merchant', () => {
  const event = inspect('Paiement par carte EUR 24,90 débité chez MAISON VERTE le 2026-09-05.');
  assert.equal(event.direction, 'debit');
  assert.deepEqual(event.amount.value, money('EUR', '2490', 2));
  assert.equal(event.merchant.value, 'MAISON VERTE');
});
check('statement fields are separate facts, never a purchase', () => {
  const event = inspect('Credit card statement. Statement date 2026-08-31. Minimum due USD 25.00. Total amount due USD 500.00. Due date 2026-09-25.');
  assert.equal(event.decision, 'review');
  assert.equal(event.family, 'statement');
  assert.equal(event.status, 'informational');
  assert.equal(event.amount.value, null);
  assert.deepEqual(event.minimumDue.value, money('USD', '2500', 2));
  assert.deepEqual(event.statementTotal.value, money('USD', '50000', 2));
  assert.equal(event.statementDate.value, '2026-08-31');
  assert.equal(event.dueDate.value, '2026-09-25');
});
check('minimum-only statement preserves unknown total', () => {
  const event = inspect('Credit card statement. Minimum due USD 25.00. Due date 2026-09-25.');
  assert.equal(event.family, 'statement');
  assert.equal(event.statementTotal.value, null);
  assert.equal(event.amount.value, null);
  assert.deepEqual(event.minimumDue.value, money('USD', '2500', 2));
});
check('ambiguous date and symbol never become a default ledger interpretation', () => {
  const event = inspect('Card purchase $ 24.90 at LOCAL CAFE on 03/04/2026.');
  assert.equal(event.decision, 'review');
  assert.equal(event.amount.evidence, 'ambiguous');
  assert.equal(event.amount.value, null);
  assert.equal(event.transactionDate.evidence, 'ambiguous');
  assert.equal(event.transactionDate.value, null);
});
check('three-decimal grouping ambiguity stays selectable, not guessed', () => {
  const event = inspect('Card purchase KWD 12.345 at LOCAL CAFE on 2026-09-05.');
  assert.equal(event.amount.evidence, 'ambiguous');
  assert.equal(event.amount.value, null);
  assert.ok(event.amount.alternatives.length >= 2);
});
for (const [suffix, status] of [['was declined', 'failed'], ['requires OTP 123456', 'informational']]) {
  check('non-posting evidence prevents promotion: ' + status, () => {
    const event = inspect('Card purchase USD 24.90 at LOCAL CAFE ' + suffix + '.');
    assert.equal(event.decision, 'ignore');
    assert.equal(event.status, status);
  });
}
for (const suffix of ['requires OTP123456', 'is pending authorization', 'is awaiting approval']) {
  check('a challenge or pending movement remains non-posting: ' + suffix, () => {
    const event = inspect('Card purchase AED 24.90 at LOCAL CAFE ' + suffix + '.');
    assert.equal(event.decision, 'ignore');
    assert.notEqual(event.status, 'posted');
  });
}
check('a separate OTP-safety footer cannot erase a valid unknown-issuer purchase', () => {
  const event = inspect('Card purchase SAR 24.90 at LOCAL CAFE on 2026-09-05. Never share your OTP.');
  assert.equal(event.decision, 'review');
  assert.deepEqual(event.amount.value, money('SAR', '2490', 2));
  assert.equal(event.status, 'posted');
});
check('merchant words cannot manufacture a failed transaction', () => {
  const event = inspect('Card purchase USD 24.90 at DECLINED CAFE on 2026-09-05.');
  assert.equal(event.status, 'posted');
  assert.equal(event.decision, 'review');
  assert.equal(event.merchant.value, 'DECLINED CAFE');
});
for (const merchant of ['NEW BALANCE', 'BALANCE CAFE']) {
  check('merchant labels cannot become monetary roles: ' + merchant, () => {
    const event = inspect(`Card purchase at ${merchant} for USD 24.90 on 2026-09-05.`);
    assert.equal(event.family, 'purchase');
    assert.deepEqual(event.amount.value, money('USD', '2490', 2));
    assert.equal(event.balance.value, null);
    assert.equal(event.statementTotal.value, null);
    assert.equal(event.merchant.value, merchant);
  });
}
check('credit-card settlement facts cannot become ordinary income', () => {
  const event = inspect('Payment of USD 500.00 received towards your Credit Card ending 1234 on 2026-09-05.');
  assert.equal(event.family, 'card-payment');
  assert.ok(event.issues.includes('settlement-adapter-required'));
});
for (const noun of ['Cash withdrawal', 'Cash deposit']) {
  check('a ' + noun + ' amount cannot be replaced by its fee', () => {
    const event = inspect(`${noun} USD 100.00 completed. Service fee USD 2.00 charged.`);
    assert.deepEqual(event.amount.value, money('USD', '10000', 2));
  });
}
check('explicit unsuccessful posting cannot be confirmed as a payment', () => {
  const event = inspect('Your card purchase of USD 100.00 at SHOP was not successful. Available balance USD 1000.00.');
  assert.equal(event.status, 'failed');
  assert.equal(event.decision, 'ignore');
});
for (const source of [
  'Credit card statement. Last payment USD 500.00 received on 2026-09-01. Minimum due USD 25.00. Due date 2026-09-25.',
  'Credit card statement generated. Amount USD 500.00. Due date 2026-09-25.',
]) {
  check('statement header protects historical and unlabeled figures from posting', () => {
    const event = inspect(source);
    assert.equal(event.family, 'statement');
    assert.equal(event.status, 'informational');
    assert.equal(event.amount.value, null);
    assert.equal(event.statementTotal.value, null);
  });
}
for (const source of [
  'Your transaction was declined. CAD 24.90.',
  'Notice CAD 24.90. Transaction failed.',
  'Your payment is pending authorization. CAD 24.90.',
]) {
  check('unknown role retains source-wide failure context', () => {
    assert.equal(inspect(source).decision, 'ignore');
  });
}
for (const source of ['Scheduled payment. CAD 24.90.', 'Available balance\nCAD 500.00', 'Credit limit notice. CAD 1000.00.']) {
  check('unknown role cannot erase clear future or informational context', () => {
    const event = inspect(source);
    assert.ok(['future', 'informational'].includes(event.status));
  });
}
check('unknown principal remains distinct from a separately labelled balance', () => {
  const event = inspect('Bank notice CAD 24.90. Available balance CAD 500.00.');
  assert.equal(event.status, 'unknown');
  assert.deepEqual(event.amount.value, money('CAD', '2490', 2));
  assert.deepEqual(event.balance.value, money('CAD', '50000', 2));
});
check('a zero balance remains a balance fact', () => {
  const event = inspect('Available balance JPY 0.');
  assert.equal(event.family, 'balance');
  assert.equal(event.amount.value, null);
  assert.deepEqual(event.balance.value, money('JPY', '0', 0));
});
check('oversized input cannot be partly accepted', () => {
  const event = inspect('Card purchase USD 24.90 at LOCAL CAFE.' + ' '.repeat(5000));
  assert.equal(event.decision, 'ignore');
  assert.ok(event.issues.includes('input-too-long'));
});
check('result contains structured fields, not a retained message body', () => {
  const source = 'Card purchase USD 24.90 at LOCAL CAFE on 2026-09-05.';
  assert.ok(!JSON.stringify(inspect(source)).includes(source));
});
for (const currency of ['AED', 'SAR', 'CAD']) {
  check(currency + ': unfamiliar wording preserves exact money for explicit review', () => {
    const event = inspect(`Bank notice: ${currency} 24.90. Details need confirmation.`);
    assert.equal(event.decision, 'review');
    assert.equal(event.status, 'unknown');
    assert.equal(event.direction, 'unknown');
    assert.equal(event.family, 'unknown');
    assert.deepEqual(event.amount.value, money(currency, '2490', 2));
    assert.ok(event.issues.includes('amount-role-unresolved'));
  });
}
check('unfamiliar multiple figures require amount selection', () => {
  const event = inspect('Bank notice: CAD 24.90; CAD 500.00. Details need confirmation.');
  assert.equal(event.decision, 'review');
  assert.equal(event.status, 'unknown');
  assert.equal(event.amount.evidence, 'ambiguous');
  assert.equal(event.amount.value, null);
  assert.equal(event.amount.alternatives.length, 2);
});
for (const label of ['Account', 'Reference']) {
  check(label + ': identifier digits cannot be offered as a transaction amount', () => {
    const event = inspect(`${label} 1234 CAD 24.90. Details need confirmation.`);
    assert.deepEqual(event.amount.value, money('CAD', '2490', 2));
    assert.ok(event.observations.every((row) => row.field.value?.minorUnits !== '123400'));
  });
}
for (const source of [
  'OTP123456. CAD 24.90.', 'Your OTP is 123456. Purchase CAD 24.90.',
  'Bank notice: CAD 24.90. Your OTP123456.',
  'Bank notice: CAD 24.90 failed.', 'Offer CAD 24.90 apply now.',
]) {
  check('unknown-format fallback does not erase clear non-posting controls', () => {
    assert.equal(inspect(source).decision, 'ignore');
  });
}


// Worldwide completion shapes (semantics lane). Synthetic wording with fictional
// values: each positive proves status, direction and family, never a bank claim.
for (const [source, family, direction] of [
  ["You've made a debit card payment of GBP 31.50 at BOOTS on 28/09/2026.", 'purchase', 'debit'],
  ['Card ending 7711 used for EUR 27.80 at SUPERVALU on 04/10/2026.', 'purchase', 'debit'],
  ['An ATM withdrawal of USD 80.00 was made from your account ending in 4471.', 'cash-withdrawal', 'debit'],
  ['A USD 76.40 transaction was made at TARGET on your card ending in 1209.', 'purchase', 'debit'],
  ["You've sent GBP 60.00 to ALEX MORGAN from your account ending 6201.", 'transfer', 'debit'],
  ["You've received GBP 35.00 from DANA LEE into your account ending 4410.", 'transfer', 'credit'],
  ['Payvia: You paid Priya Shah USD 90.00 for rent share.', 'transfer', 'debit'],
  ['Payment of SGD 42.00 to KOPI HOUSE was successful.', 'purchase', 'debit'],
  ['Realizaste una compra por MXN 124.90 en MERCADO LUZ con tu tarjeta *4417.', 'purchase', 'debit'],
  ['Dear Customer, Acct XX456 is debited with INR 500.00 on 04-Oct-26. Info: ATM*CASH WDL*S1ABC456. Available Balance is INR 9,240.50.', 'cash-withdrawal', 'debit'],
  ['Dear Customer, Acct XX456 is debited with INR 59.00 on 01-Oct-26. Info: ANNUAL CHGS. Available Balance is INR 9,181.50.', 'fee', 'debit'],
  ['INR 210.00 debited\nA/c no. XX7788\n03-10-26, 11:05:41\nUPI/P2M/627711112222/CAFE COFFEE\nOrchid Bank', 'purchase', 'debit'],
  ['INR 900.00 credited\nA/c no. XX7788\n04-10-26, 18:05:33 IST\nUPI/P2A/627722223333/RAVI KUMAR\nOrchid Bank', 'transfer', 'credit'],
  ['Dear Customer, PKR 2,000.00 has been debited from your A/C 0202XXXX1199 on 03-10-2026 via Raast to SANA MALIK.', 'transfer', 'debit'],
  ['Dear Customer, A/C ##8899 debited by NPR 450.00 on 04/10/2026. Remarks: Fonepay QR Payment to LOCAL MART.', 'purchase', 'debit'],
]) {
  check('worldwide completed shape: ' + source.slice(0, 48), () => {
    const event = inspect(source);
    assert.equal(event.status, 'posted');
    assert.equal(event.family, family);
    assert.equal(event.direction, direction);
  });
}
// The same shapes with a decline, hold, schedule, request, condition, code or
// lure must never read as posted (negative controls per class).
for (const source of [
  "You've made a debit card payment of GBP 31.50 at BOOTS but it was declined.",
  'A pre-authorisation of USD 75.00 was made at GRAND HOTEL on your card ending in 1209.',
  'A USD 52.00 transaction will be made on 11/05/2026 on your card ending in 1209.',
  'Did you make a USD 120.00 transaction at EXAMPLE STORE? Reply YES or NO.',
  'Your card can be used for purchases up to USD 500.00 abroad.',
  "You've received a payment request of GBP 45.00 from DANA LEE.",
  'You sent a request for GBP 30.00 to ALEX MORGAN.',
  'Someone sent you GBP 50.00 - claim it here https://example.test/claim',
  "You've sent GBP 45.00 to DANA LEE but the payment was returned.",
  'If a deposit of USD 2,000.00 was made to your account, please verify it in the app.',
  'Payment of SGD 42.00 to KOPI HOUSE failed. Please retry.',
  'Realizaste una compra por MXN 124.90 en MERCADO LUZ, pero fue rechazada.',
  'Pagaste ARS 1.875,00 en KIOSCO NORTE: pago pendiente de confirmación.',
  'Solicitud: te pidió BRL 40,00 por Pix. Aprove no app.',
  'Acct XX456 will be debited with INR 500.00 on 15-Oct-26. Info: NACH.',
  'UPI txn of Rs 250.00 from Acct XX456 to VPA shop@bank failed. Info: UPI.',
  'Acct XX456 credited with INR 3,000.00 on 05-Oct-26. Info: REVERSAL pending confirmation.',
  'Acct XX456 debited Rs 600.00 on 04-Oct-26. Is this you? Reply Y or N.',
  'Avl Bal INR 9,240.00 in Acct XX456 as on 04-Oct-26. Info: NEFT',
]) {
  check('worldwide negative control stays unposted: ' + source.slice(0, 48), () => {
    const event = inspect(source);
    const postable = event.status === 'posted' && event.decision === 'review' &&
      ['purchase', 'cash-withdrawal', 'refund', 'fee', 'utility', 'recurring-payment', 'transfer'].includes(event.family) &&
      (event.direction === 'debit' || event.direction === 'credit');
    assert.equal(postable, false, JSON.stringify([event.status, event.family, event.direction, event.decision]));
  });
}
check('a narration cannot turn an incoming credit into a cash withdrawal', () => {
  const event = inspect('Dear Customer, Acct XX456 is credited with INR 300.00 on 05-Oct-26. Info: ATM deposit. Available Balance is INR 9,240.50.');
  assert.equal(event.direction, 'credit');
  assert.notEqual(event.family, 'cash-withdrawal');
});
check('a generic debit with no narration, rail or masked account tail keeps its family unresolved', () => {
  const event = inspect('Chase Bank: USD 42.10 was debited from your account.');
  assert.equal(event.family, 'unknown');
});

check('an extracted "at an ATM" merchant keeps the cash-machine word as movement evidence', () => {
  const event = inspect('AUD 200.00 was withdrawn at an ATM using your card ending 2211 on 28/09/2026.');
  assert.equal(event.status, 'posted');
  assert.equal(event.family, 'cash-withdrawal');
  assert.equal(event.direction, 'debit');
});
for (const verdict of ['refusé', 'declined', 'rechazada', 'failed']) {
  check('a lifecycle word at the end of an over-long merchant name still withdraws the posting: ' + verdict, () => {
    const event = inspect(`Card payment of EUR 25.00 at LIBRAIRIE CENTRALE ${verdict}. Available balance EUR 300.00.`);
    assert.notEqual(event.status, 'posted');
  });
}
check('a wallet receipt keeps a trailing success word out of the merchant mask', () => {
  const event = inspect('Payment Tk 330.00 to Lotus Mart Ltd successful. Balance Tk 310.00. TrxID ZXC4V5BN6M at 04/10/2026 21:05');
  assert.equal(event.status, 'posted');
  assert.equal(event.direction, 'debit');
  assert.equal(event.family, 'purchase');
});
check('a family fallback stands down when a fee line sits beside the charge', () => {
  const event = inspect('Fee JD 1.000; Your card ending 1234 was charged JD 12.345 at TESCO on 2026-04-03.', { market: 'JO', sender: 'ARABBANK' });
  assert.equal(event.family, 'unknown');
});
check('scripts without word spaces hold back cancelled, scheduled and promotional notices', () => {
  for (const source of ['【ご利用のお知らせ】\n◇利用金額：2,480円\nこの利用は取り消されました。', '【キャンペーン】ご利用で2,000円分のポイントを受け取りました。', '消费满100元立减20元']) {
    assert.notEqual(inspect(source).status, 'posted', source);
  }
});


// Scripts and field lists added in the world-semantics round. Each positive has
// a negative control in the same language.
for (const [label, source, status, direction] of [
  ['Thai card spend', 'บัตรกรุงศรี xx5678 ใช้จ่าย 890.00 บาท ที่ TOPS MARKET SILOM วันที่ 22/09/69 18:33 น. สอบถาม 1572', 'posted', 'debit'],
  ['Thai incoming transfer', '16/09/69 19:05 บชX123456X รับโอนจากX987654X 2,800.00 คงเหลือ 15,145.67บ', 'posted', 'credit'],
  ['Thai cash withdrawal', 'Krungthai: 25/09/69 10:12 บช.X5678X ถอนเงินสด ATM 2,000.00 บ. คงเหลือ 8,450.25 บ.', 'posted', 'debit'],
  ['Thai failed spend', 'บัตรกรุงศรี xx5678 ใช้จ่าย 890.00 บาท ไม่สำเร็จ วันที่ 22/09/69', 'failed', null],
  ['Thai promotion', 'ใช้จ่าย 1,000 บาท ผ่านบัตรกรุงศรี รับเครดิตเงินคืน 100 บาท สมัครวันนี้', null, null],
  ['Chinese channel payment', '您账户1234于09月18日12:30在【财付通-微信支付-云岭咖啡】快捷支付19.90元，余额2,345.67【招商银行】', 'posted', 'debit'],
  ['Chinese channel invitation', '【招商银行】您尾号1234的账户请使用快捷支付100元参与活动，详情见App。', null, null],
  ['Taiwan NT$ card spend', '【玉山銀行】您的玉山卡末四碼9012於09/17 20:15消費NT$890，消費地點：誠品書店。如非本人交易請撥客服。', 'posted', 'debit'],
  ['Korean withdrawal', '[Web발신]\n하나,09/22,18:40\n123-******-12345\n출금200,000원\n김민지\n잔액845,300원', 'posted', 'debit'],
  ['Korean scheduled withdrawal', '[Web발신]\n하나,12/25,09:00\n123-******-12345\n출금예정 200,000원\n잔액845,300원', null, null],
  ['Vietnamese wallet payment', 'Thanh toán thành công\nBạn đã thanh toán 45.000đ cho Circle K. Số dư Ví MoMo: 1.255.000đ', 'posted', 'debit'],
  ['Vietnamese failed payment', 'Thanh toán không thành công\nBạn đã thanh toán 45.000đ cho Circle K. Số dư Ví MoMo: 1.255.000đ', 'failed', null],
  ['Nigerian debit field list', 'Txn: Debit\nAcct:089**456\nAmt:NGN25,000.00\nDes:MOB/UTO/CHIOMA NWOSU/Sept dues\nDate:16/09/2026 11:05\nBal:NGN81,240.00', 'posted', 'debit'],
  ['Nigerian credit field list', 'Txn: Credit\nAc:21XXXXX456\nAmt:NGN 45,000.00\nDes:TRF FROM IBRAHIM MUSA\nDate:18-Sep-2026 15:22\nBal:NGN 61,880.10', 'posted', 'credit'],
  ['Nigerian DR suffix', 'Acct: 012****789\nAmt: NGN7,850.00 DR\nDesc: POS PURCHASE @ SHOPRITE LEKKI\nAvail Bal: NGN145,320.55', 'posted', 'debit'],
  ['Nigerian field-list heading with no labelled direction', 'Account update\nAcct:089**456\nAmt:NGN25,000.00\nBal:NGN81,240.00', null, null],
  ['Malaysian card txn line', 'RM0 CIMB: Debit Card 5678 txn RM128.40 at AEON CO. (M) BHD MID VALLEY on 14SEP26 18:05. Call 03-62047788 if unauthorised.', 'posted', 'debit'],
  ['Moroccan French card payment', "Attijariwafa bank: Paiement par carte ****1234 d'un montant de 450,00 MAD chez MARJANE CALIFORNIE le 15/09/2026 a 14:22. Solde disponible: 12 345,67 MAD.", 'posted', 'debit'],
  ['French card payment awaiting approval', "Banque: Paiement par carte ****1234 d'un montant de 450,00 MAD chez MARJANE en attente d'autorisation le 15/09/2026.", null, null],
  ['Canadian French purchase with card tail', 'Desjardins : Achat de 42,35 $ chez METRO PLUS LAVAL avec votre carte Visa se terminant par 1234 le 2026-09-27 à 18 h 12.', 'posted', 'debit'],
  ['French purchase noun with no card tail', 'Achat de 42,35 $ chez METRO PLUS LAVAL aujourd’hui seulement, profitez de nos offres', null, null],
  ['Turkish FAST credit', 'Sayın Müşterimiz, 4567 sonlu hesabınıza 18.09.2026 14:05 tarihinde AHMET YILMAZ tarafından FAST ile 2.500,00 TL gelmiştir. Açıklama: Kira payı', 'posted', 'credit'],
]) {
  check('world semantics: ' + label, () => {
    const event = inspect(source, { sender: 'BANKX' });
    if (status === null) { assert.notEqual(event.status, 'posted'); return; }
    assert.equal(event.status, status);
    if (direction) assert.equal(event.direction, direction);
  });
}

console.log(`universal parser: ${passed} passed, ${failed} failed`);
if (failed) process.exitCode = 1;
