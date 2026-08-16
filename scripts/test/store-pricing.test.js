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
      product.approvedStorefrontPrices.AE = {
        applePricePointId: 'apple-ae-price-point',
        googleCurrency: 'AED',
        googleAmount: '29.99',
        readBack: { apple: true, google: true },
      };
      product.approvedStorefrontPrices.SA = {
        applePricePointId: 'apple-sa-price-point',
        googleCurrency: 'SAR',
        googleAmount: '29.99',
        readBack: { apple: true, google: true },
      };
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
  ok('approved pricing rejects a blank Apple price point', rejects(
    (value) => { value.products.monthly.approvedStorefrontPrices.AE.applePricePointId = ' '; },
    /Apple price point/,
  ));
  ok('approved pricing rejects the wrong storefront currency', rejects(
    (value) => { value.products.monthly.approvedStorefrontPrices.AE.googleCurrency = 'SAR'; },
    /Google AED amount/,
  ));
  ok('approved pricing rejects malformed Google amounts', rejects(
    (value) => { value.products.monthly.approvedStorefrontPrices.AE.googleAmount = '29.999'; },
    /Google AED amount/,
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
    (value) => { value.products.monthly.approvedStorefrontPrices.AE.readBack.google = false; },
    /read-back evidence/,
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
