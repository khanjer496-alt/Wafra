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
const STOREFRONT_CURRENCIES = { AE: 'AED', SA: 'SAR' };

export function validateStorePricing(pricing, metadata) {
  const errors = [];
  if (pricing.schemaVersion !== 1) errors.push('pricing schemaVersion must be 1');
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

  const launchStorefronts = metadata.launchScope?.storefronts ?? [];
  if (JSON.stringify(pricing.launchStorefronts) !== JSON.stringify(launchStorefronts)) {
    errors.push('pricing launchStorefronts must match store metadata launch scope');
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
    for (const storefront of launchStorefronts) {
      if (!(storefront in (product.approvedStorefrontPrices ?? {}))) {
        errors.push(`pricing product ${plan} is missing storefront ${storefront}`);
      }
    }
  }

  if (pricing.approvalStatus === 'approved') {
    for (const [plan, product] of Object.entries(pricing.products ?? {})) {
      for (const storefront of launchStorefronts) {
        const approved = product.approvedStorefrontPrices?.[storefront];
        if (!approved || typeof approved.applePricePointId !== 'string' ||
            approved.applePricePointId.trim() === '' ||
            approved.googleCurrency !== STOREFRONT_CURRENCIES[storefront] ||
            !MONEY.test(approved.googleAmount ?? '')) {
          errors.push(`approved ${plan} pricing needs Apple price point and Google ${STOREFRONT_CURRENCIES[storefront]} amount for ${storefront}`);
        }
        if (approved?.readBack?.apple !== true || approved?.readBack?.google !== true) {
          errors.push(`approved ${plan} pricing needs Apple and Google read-back evidence for ${storefront}`);
        }
      }
    }
  } else if (pricing.approvalStatus !== 'pending-commercial-approval') {
    errors.push('pricing approvalStatus must be pending-commercial-approval or approved');
  }

  return errors;
}
