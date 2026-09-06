import { Stack, usePathname } from 'expo-router';
import React, { lazy, Suspense } from 'react';

import { PrivateRouteHead } from '@/components/private-route-head';

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
