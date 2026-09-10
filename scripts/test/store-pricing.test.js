const fs = require('node:fs');
const path = require('node:path');

let pass = 0;
let fail = 0;
const ok = (name, condition, detail = '') => {
  if (condition) {
    pass += 1;
    console.log(`✓ ${name}`);
    return;
  }
  fail += 1;
  console.log(`✗ ${name}\n    ${detail}`);
};

(async () => {
  const root = path.resolve(__dirname, '../..');
  const pricing = JSON.parse(fs.readFileSync(path.join(root, 'docs/store-pricing.json'), 'utf8'));
  const metadata = JSON.parse(fs.readFileSync(path.join(root, 'docs/store-metadata.json'), 'utf8'));
  const { validateStorePricing } = await import('../lib/store-pricing.mjs');
  const clone = (value) => JSON.parse(JSON.stringify(value));
  const approvedPricing = () => {
    const value = clone(pricing);
    value.approvalStatus = 'approved';
    for (const product of Object.values(value.products)) {
      product.approvedBasePrice = {
        currency: product.referencePrice.currency,
        amount: product.referencePrice.amount,
        publisherApproved: true,
      };
      product.readBackEvidence = Object.fromEntries(['JPY', 'USD', 'KWD'].map((currency) => [currency, {
        appleVerified: true,
        googleVerified: true,
        appleFormattedPrice: `${currency} Apple price`,
        googleFormattedPrice: `${currency} Google price`,
      }]));
    }
    return value;
  };
  const rejects = (mutate, pattern) => {
    const value = approvedPricing();
    mutate(value);
    return validateStorePricing(value, metadata).some((error) => pattern.test(error));
  };

  ok('canonical pending pricing is valid', validateStorePricing(pricing, metadata).length === 0);
  ok('complete approved pricing is valid', validateStorePricing(approvedPricing(), metadata).length === 0);
  ok('approved pricing rejects an unapproved base price', rejects(
    (value) => { value.products.monthly.approvedBasePrice.publisherApproved = false; },
    /publisher-approved base price/,
  ));
  ok('approved pricing rejects a base currency that differs from the reference', rejects(
    (value) => { value.products.monthly.approvedBasePrice.currency = 'EUR'; },
    /publisher-approved base price/,
  ));
  ok('approved pricing rejects malformed base amounts', rejects(
    (value) => { value.products.monthly.approvedBasePrice.amount = '29.999'; },
    /publisher-approved base price/,
  ));
  ok('pricing rejects store introductory offers', rejects(
    (value) => { value.rules.introductoryOffer = true; },
    /introductory offers/,
  ));
  ok('pricing rejects Google base-plan drift', rejects(
    (value) => { value.products.monthly.googleBasePlanId = 'monthly-v2'; },
    /base plan/,
  ));
  ok('approved pricing requires store read-back evidence', rejects(
    (value) => { value.products.monthly.readBackEvidence.JPY.googleVerified = false; },
    /read-back evidence for JPY/,
  ));
  ok('pricing rejects product identifier drift', rejects(
    (value) => { value.products.yearly.productId = 'wafra_pro_annual'; },
    /wafra_pro_yearly/,
  ));

  console.log(`\nstore-pricing: ${pass} passed, ${fail} failed`);
  if (fail) process.exit(1);
})().catch((error) => {
  console.error(error);
  process.exit(1);
});
