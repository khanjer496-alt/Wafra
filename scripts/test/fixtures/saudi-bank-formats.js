/**
 * Public, redacted Saudi bank-alert acceptance fixtures.
 *
 * These are the two Bank Albilad formats already attributed in
 * public-sources.md. Keep the Saudi market explicit: parsing them under the
 * default UAE pack silently converts SAR into AED and defeats the fixture.
 */
module.exports = Object.freeze([
  {
    id: 'bank-albilad-arabic-pos-credit-card',
    market: 'SA',
    bank: 'Bank Albilad',
    channel: 'sms',
    evidence: 'public-redacted',
    body: `شراء عبر نقاط البيع
بطاقة: **1234;الإئتمانية
لدى: Some merchant
دولة: السعودية
مبلغ: 12.00 SAR
رصيد: 1234.56 SAR
في: 2019-05-07 23:44`,
    expect: {
      kind: 'transaction',
      type: 'expense',
      amountFils: 1200,
      currency: 'SAR',
      merchant: 'Some Merchant',
      date: '2019-05-07',
      card: { last4: '1234', kind: 'credit' },
      reference: null,
      transferHint: false,
      snapshotFils: 123456,
      snapshotKind: 'limit',
    },
  },
  {
    id: 'bank-albilad-arabic-mada-pos',
    market: 'SA',
    bank: 'Bank Albilad',
    channel: 'sms',
    evidence: 'public-redacted',
    body: `مشتريات نقاط البيع
بطاقة: **4567;مدى
من: xx005
مبلغ: 34.00 SAR
لدى: Some restaurant
دولة: السعودية
في: 2019/05/07 01:29`,
    expect: {
      kind: 'transaction',
      type: 'expense',
      amountFils: 3400,
      currency: 'SAR',
      merchant: 'Some Restaurant',
      date: '2019-05-07',
      card: { last4: '4567', kind: 'debit' },
      reference: null,
      transferHint: false,
      snapshotFils: null,
      snapshotKind: null,
    },
  },
]);
