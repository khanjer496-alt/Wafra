import React, { lazy, Suspense } from 'react';

import MarketingHome from '@/marketing/home';

const LedgerHomeScreen = lazy(() => import('@/screens/ledger-home-screen'));

export default function WebHomeScreen() {
  if (process.env.EXPO_PUBLIC_WAFRA_E2E_DEMO !== '1') return <MarketingHome />;

  return (
    <Suspense fallback={<main aria-busy="true">Loading Wafra…</main>}>
      <LedgerHomeScreen />
    </Suspense>
  );
}
