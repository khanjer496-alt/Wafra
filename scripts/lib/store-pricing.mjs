const MONEY = /^\d+(?:\.\d{1,2})?$/;
const EXPECTED_PRODUCTS = {
  monthly: {
    productId: 'wafra_pro_monthly',
    googleBasePlanId: 'monthly',
    referenceAmount: '9.99',
  },
  yearly: {
    productId: 'wafra_pro_yearly',
    googleBasePlanId: 'yearly',
    referenceAmount: '74.99',
  },
};

const SAMPLE_CURRENCIES = ['JPY', 'USD', 'KWD'];

const validReadBack = (value) => value && typeof value === 'object' &&
  value.appleVerified === true && value.googleVerified === true &&
  typeof value.appleFormattedPrice === 'string' && value.appleFormattedPrice.trim() !== '' &&
  typeof value.googleFormattedPrice === 'string' && value.googleFormattedPrice.trim() !== '';

export function validateStorePricing(pricing, metadata) {
  const errors = [];
  if (pricing.schemaVersion !== 2) errors.push('pricing schemaVersion must be 2');
  if (pricing.distribution !== 'worldwide' || metadata.launchScope?.distribution !== 'worldwide') {
    errors.push('pricing and store metadata must both use worldwide distribution');
  }
  if (pricing.strategy !== 'storefront-native-price-points') {
    errors.push('pricing strategy must use storefront-native price points');
  }
  if (pricing.rules?.introductoryOffer !== false) {
    errors.push('store introductory offers must stay disabled while the local three-day period ships');
  }
  if (pricing.rules?.display !==
    'Always use the Apple or Google storefront-formatted price returned by RevenueCat.') {
    errors.push('pricing display rule must require the storefront-formatted RevenueCat price');
  }
  if (pricing.rules?.manualFxPricing !== false) {
    errors.push('global pricing must not hand-convert a ledger or reference currency');
  }
  if (JSON.stringify(pricing.readBackSampleCurrencies) !== JSON.stringify(SAMPLE_CURRENCIES)) {
    errors.push('pricing read-back samples must cover representative 0/2/3-decimal storefront currencies');
  }
  const actualPlans = Object.keys(pricing.products ?? {}).sort();
  if (JSON.stringify(actualPlans) !== JSON.stringify(Object.keys(EXPECTED_PRODUCTS))) {
    errors.push('pricing products must be exactly monthly and yearly');
  }

  for (const [plan, expected] of Object.entries(EXPECTED_PRODUCTS)) {
    const product = pricing.products?.[plan];
    if (!product) {
      errors.push(`pricing product ${plan} is missing`);
      continue;
    }
    if (product.productId !== expected.productId) {
      errors.push(`pricing product ${plan} must use ${expected.productId}`);
    }
    if (product.googleBasePlanId !== expected.googleBasePlanId) {
      errors.push(`pricing product ${plan} Google base plan must use ${expected.googleBasePlanId}`);
    }
    if (product.referencePrice?.currency !== 'USD' ||
        product.referencePrice?.amount !== expected.referenceAmount) {
      errors.push(`pricing product ${plan} reference price must be USD ${expected.referenceAmount}`);
    }
  }

  if (pricing.approvalStatus === 'approved') {
    for (const [plan, product] of Object.entries(pricing.products ?? {})) {
      const approved = product.approvedBasePrice;
      if (!approved || typeof approved.currency !== 'string' || !/^[A-Z]{3}$/.test(approved.currency) ||
          approved.currency !== product.referencePrice?.currency ||
          !MONEY.test(approved.amount ?? '') || approved.publisherApproved !== true) {
        errors.push(`approved ${plan} pricing needs one publisher-approved base price`);
      }
      for (const currency of SAMPLE_CURRENCIES) {
        if (!validReadBack(product.readBackEvidence?.[currency])) {
          errors.push(`approved ${plan} pricing needs Apple and Google formatted-price read-back evidence for ${currency}`);
        }
      }
    }
  } else if (pricing.approvalStatus !== 'pending-commercial-approval') {
    errors.push('pricing approvalStatus must be pending-commercial-approval or approved');
  }

  return errors;
}
