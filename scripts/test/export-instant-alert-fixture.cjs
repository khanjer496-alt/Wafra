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
  // Synthetic leading-principal negation controls, shared with the pure API.
  "AED 24.86 has not been debited from your account ending 4421.",
  "USD 24.86 has not been credited to your account ending 4421.",
  "Dear Customer, AED 24.86 wasn’t deducted from your account ending 4421.",
  "AED 24.86 has not been transferred to your account ending 4421.",
  "EUR 24.86 has not been refunded to your card ending 4421.",
  "AED 24.86 hasn’t been deposited to your account ending 4421.",
  // Synthetic personal-conversation negatives; these are not bank evidence.
  'I spent AED 50.00 at Carrefour today.',
  'Hi Ann, I have just spent USD 50.00 at Example Market.',
  'Hello, I have already spent EUR 50.00 at Example Market.',
  "Hey, I've just spent SAR 50.00 at Example Market.",
  'أنا دفعت 50.00 درهم اليوم.',
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
  ['Your OTP for the transaction of AED 500.00 is 448122.', true],
  ['Verification code: 123 456 for AED 25.00 purchase.', true],
  ['OTP ١٢٣٤٥٦ for AED 25.00 purchase.', true],
  ['Your OTP is １２３４５６ for USD 25.00 purchase.', true],
  ['Sicherheitscode: 123 456 für EUR 25,00.', true],
  ['Card ending 1234 was used for JOD 15.251. Never share your OTP.', false],
  ['Transfer of USD 25.00 completed. Ref 123456. Never share your OTP.', false],
  ['Card ending 1234 was used for JOD 15.251. Never share your OTP for any transaction. Your reference is 123456.', false],
  ['Transfer USD 25.00 completed. Never share your verification code for payments. Transaction reference is 123456.', false],
  ['Card ending 1234 was used for USD 25.00. Never share your OTP for transactions, your reference is 123456.', false],
  ['Your OTP for the transaction of AED 5,000.00 is 448122.', true],
  ['Your OTP for transaction reference TX123456 is 448122.', true],
  ['Your security code for payment reference ABCD1234 is 448122.', true],
  ['Your OTP for transaction ref 789012 is 448122.', true],
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
  const format = new RegExp(sources.credentialFormat, 'gu');
  const sensitive = body => credential.test(body.normalize('NFKC').replace(format, ''));

  const messages = [...new Set([...corpusMessages(), ...TRAPS])];
  const fixture = {
    reads: messages.map((body) => ({ body, read: read(body) })),
    sensitive: SENSITIVE.map(([body, expected]) => {
      if (sensitive(body) !== expected) throw new Error(`credential pattern disagrees: ${body}`);
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
