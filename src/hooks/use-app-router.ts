import { useRouter as useExpoRouter, useSegments, type Href, type Router } from 'expo-router';
import { useMemo } from 'react';

import { singlePageId } from '@/lib/navigation-identity';

/** Use the stack's identity matching so queued taps cannot mount duplicate pages.
 * Unlike a tap timeout, this also works when the JS thread is slow. Existing
 * copies of the same destination are reused; different query params stay distinct.
 */
type AppRouter = Omit<Router, 'push'> & {
  push: (href: Href, options?: Parameters<Router['push']>[1] & { preserveTabHistory?: boolean }) => void;
};

export function useRouter(): AppRouter {
  const router = useExpoRouter();
  const inTabs = useSegments()[0] === '(tabs)';
  return useMemo(() => ({
    ...router,
    push: (href, options) => {
      // Tabs belong to the existing root shell. Pushing from a detail screen
      // would mount another shell (and another background capture owner).
      const { preserveTabHistory = false, ...navigationOptions } = options ?? {};
      if (isTabDestination(href) && !preserveTabHistory) {
        if (inTabs) router.navigate(href, navigationOptions);
        else router.dismissTo(href, navigationOptions);
        return;
      }
      router.push(href, { dangerouslySingular: singlePageId, ...navigationOptions });
    },
  }), [router, inTabs]);
}

function isTabDestination(href: Href): boolean {
  const pathname = (typeof href === 'string' ? href : href.pathname).split(/[?#]/)[0];
  return ['/', '/(tabs)', '/(tabs)/', '/flow', '/bills', '/wallet',
    '/(tabs)/index', '/(tabs)/flow', '/(tabs)/bills', '/(tabs)/wallet'].includes(pathname);
}
