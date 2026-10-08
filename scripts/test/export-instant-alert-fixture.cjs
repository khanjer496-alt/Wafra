// Records what the charge banner says for every corpus message, using the
// exact pattern strings the iPhone compiles (WafraInstantAlertPatterns, from
// generate-ios-instant-alert.mjs) and the shared restatement of InstantAlert's
// control flow. native-live-capture-store.sh feeds the result to
// native-instant-alert.swift, which must read every message identically.
//
// Usage: node scripts/test/export-instant-alert-fixture.cjs <output.json>

const fs = require('fs');
const path = require('path');
const { pathToFileURL } = require('url');
const { createReader, corpusMessages } = require('./instant-alert-reader.cjs');

// The traps instant-alert.test.js pins by name, so the iPhone sees them too.
const TRAPS = [
  'Payment of AED 34.47 to Example Market with Credit Card ending 1234. Avl Cr. Limit is AED 18,764.51.',
  'Payment of AED 34.47 to Example Market with Credit Card ending 1234 was declined.',
  'Pending payment of AED 34.47 to Example Market with Credit Card ending 1234.',
  'Credit Card Purchase\nCard No XXXX1234\nAED 174.00\nEXAMPLE SHOP\n07/09/26 12:02\nAvl Bal AED 14980.91\nSeptember statement due on 26/09/2026\nPay school fees in 12 instalments at 0% interest with no fees. Conditions apply.',
  'Credit Card Purchase\nCard No XXXX1234\nAED 174.00\nEXAMPLE SHOP\nPay school fees in 12 instalments.\nTransaction declined.',
  'Your OTP for the transaction of AED 500.00 is 448122. Do not share it with anyone.',
  'Available Balance AED ····1985.47 on your account.',
  'Your salary of AED 28,537.50 has been credited to your account 0002.',
  'Purchase of AED 150.00 with Debit Card ending 2518 at BISSAN MEDICAL CENTRE, DUBAI. Avl Balance is AED 2,024.14.',
  'Thank you for using your card ending 0000 for GHS 120.00 at MAC LEGENDARY ENTERPRISE. Avl.Limit: AED 56,458.26',
  'تم خصم مبلغ 150.00 درهم من حسابك رقم 1234 لدى بيسان الطبي',
  'عملية شراء بمبلغ AED 250.00 لدى نون من بطاقتك المنتهية 8575',
  'تم إيداع الراتب بمبلغ 12,000.00 درهم في حسابك',
  'المبلغ المستحق على بطاقتك 5,000.00 درهم',
  'Purchase of AED 10.00 with Card ending 001 SR at CARREFOUR',
  'Purchase of 45.00 د.إ at Example Market with card ending 1234',
];

const SENSITIVE = [
  ['Your OTP is 448122. Do not share it.', true],
  ['448122 is your verification code', true],
  ['رمز التحقق: 448122', true],
  ['Purchase of AED 150.00 with Debit Card ending 2518 at BISSAN MEDICAL CENTRE', false],
];

async function main() {
  const output = process.argv[2];
  if (!output) throw new Error('usage: export-instant-alert-fixture.cjs <output.json>');
  const generator = await import(pathToFileURL(path.join(__dirname, '../generate-ios-instant-alert.mjs')).href);
  const sources = generator.instantAlertPatternSources();
  const re = (name) => new RegExp(sources[name], 'iu');
  const { read } = createReader({
    UNSAFE_TRANSACTION_RE: re('unsafeTransaction'),
    PURCHASE_PREFIX_RE: re('purchasePrefix'),
    PROMO_FOOTER_RE: re('promoFooter'),
    REFUSE_RE: re('refuse'),
    CREDIT_RE: re('credit'),
    DEBIT_RE: re('debit'),
    AMOUNT_RE: re('amount'),
    LAST4_RE: re('last4'),
    MERCHANT_RE: re('merchant'),
    PAYMENT_MERCHANT_RE: re('paymentMerchant'),
    BANK_WORD_RE: re('bankWord'),
  });
  const credential = re('credential');

  const messages = [...new Set([...corpusMessages(), ...TRAPS])];
  const fixture = {
    reads: messages.map((body) => ({ body, read: read(body) })),
    sensitive: SENSITIVE.map(([body, expected]) => {
      if (credential.test(body) !== expected) throw new Error(`credential pattern disagrees: ${body}`);
      return { body, sensitive: expected };
    }),
  };
  const spoken = fixture.reads.filter((row) => row.read).length;
  if (spoken < 20) throw new Error(`only ${spoken} banners in the fixture; the patterns did not load`);
  fs.writeFileSync(output, JSON.stringify(fixture));
  console.log(`instant-alert fixture: ${fixture.reads.length} messages, ${spoken} banners`);
}

main().catch((error) => {
  console.error(error instanceof Error ? error.message : String(error));
  process.exit(1);
});
