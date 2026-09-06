import React, { lazy, Suspense } from 'react';

import MarketingHome from '@/marketing/home';

// The explicitly seeded demo must exercise the same Home as the native route.
// Keep the public marketing entry point unchanged outside the test export.
const JournalHomeScreen = lazy(() => import('@/screens/journal-home-screen'));

export default function WebHomeScreen() {
  if (process.env.EXPO_PUBLIC_WAFRA_E2E_DEMO !== '1') return <MarketingHome />;

  return (
    <Suspense fallback={<main aria-busy="true">Loading Wafra…</main>}>
      <JournalHomeScreen />
    </Suspense>
  );
}
