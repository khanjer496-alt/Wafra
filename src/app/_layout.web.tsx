import { Stack, usePathname } from 'expo-router';
import React, { lazy, Suspense } from 'react';

import { PrivateRouteHead } from '@/components/private-route-head';
// Installs the harness-only Larger Text emulation before any screen reads
// Dimensions. Inert outside the seeded E2E export.
import '@/lib/e2e-font-scale';

const AppRootLayout = lazy(() => import('@/components/app-root-layout'));

export default function WebRootLayout() {
  const pathname = usePathname();
  const isPublicMarketingPage =
    process.env.EXPO_PUBLIC_WAFRA_E2E_DEMO !== '1' && pathname === '/';

  return (
    <>
      <PrivateRouteHead />
      {isPublicMarketingPage ? (
        <Stack screenOptions={{ headerShown: false }}>
          <Stack.Screen name="(tabs)" />
        </Stack>
      ) : (
        <Suspense fallback={null}>
          <AppRootLayout />
        </Suspense>
      )}
    </>
  );
}
