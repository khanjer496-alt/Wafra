import { Slot } from 'expo-router';
import React, { lazy, Suspense } from 'react';

const AppTabsLayout = lazy(() => import('@/components/app-tabs-layout'));

export default function WebTabsLayout() {
  if (process.env.EXPO_PUBLIC_WAFRA_E2E_DEMO !== '1') return <Slot />;

  return (
    <Suspense fallback={null}>
      <AppTabsLayout />
    </Suspense>
  );
}
