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

console.log(`universal parser: ${passed} passed, ${failed} failed`);
if (failed) process.exitCode = 1;
