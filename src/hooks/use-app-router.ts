import { useNavigationContainerRef, useRouter as useExpoRouter, type Href, type Router } from 'expo-router';
import { useMemo } from 'react';

import { singlePageId } from '@/lib/navigation-identity';

/** Use the stack's identity matching so queued taps cannot mount duplicate pages.
 * Unlike a tap timeout, this also works when the JS thread is slow. Existing
 * copies of the same destination are reused; different query params stay distinct.
 */
type AppRouter = Omit<Router, 'push'> & {
  push: (href: Href, options?: Parameters<Router['push']>[1] & { preserveTabHistory?: boolean }) => void;
};

/** Minimal shape of a React Navigation state, enough to find the focused route. */
type NavState = {
  index?: number;
  routes: { name: string; state?: NavState; params?: object }[];
};

/**
 * Whether the tab shell is the focused top-level route — the same answer as
 * `useSegments()[0] === '(tabs)'`, but read from the root state at call time.
 *
 * It must not be a subscription. Every screen and row calls `useRouter()`
 * (45 files, all four tab screens included), so subscribing here re-rendered
 * every mounted tab on every tab switch only to refresh a value that is read
 * when a link is pressed. The walk mirrors expo-router 55's
 * `getRouteInfoFromState`: the container's first route is the internal
 * `__root` slot, and the first segment is the focused child beneath it (or the
 * `screen` param when that child has not rendered its state yet).
 */
export function isTabShellFocused(root: NavState | undefined): boolean {
  if (!root?.routes?.length) return false;
  const top = root.routes[root.index ?? 0];
  if (top?.name !== '__root') return false;
  const inner = top.state;
  // expo-router reads `state.index ? state.index : 0` below the root slot.
  const first = inner?.routes?.length
    ? inner.routes[inner.index || 0]?.name
    : (top.params as { screen?: unknown } | undefined)?.screen;
  if (typeof first !== 'string') return false;
  return (first.startsWith('/') ? first.slice(1) : first).split('/')[0] === '(tabs)';
}

export function useRouter(): AppRouter {
  const router = useExpoRouter();
  // The container ref is a stable object; reading it does not subscribe.
  const navigation = useNavigationContainerRef();
  return useMemo(() => ({
    ...router,
    push: (href, options) => {
      // Tabs belong to the existing root shell. Pushing from a detail screen
      // would mount another shell (and another background capture owner).
      const { preserveTabHistory = false, ...navigationOptions } = options ?? {};
      if (isTabDestination(href) && !preserveTabHistory) {
        // Before the root navigator is ready nothing is focused, which (like
        // useSegments' empty default) reads as "outside the tabs": dismissTo.
        // Every tab link is a press, so this window is not reachable today.
        const root = navigation.isReady() ? (navigation.getRootState() as NavState | undefined) : undefined;
        if (isTabShellFocused(root)) router.navigate(href, navigationOptions);
        else router.dismissTo(href, navigationOptions);
        return;
      }
      router.push(href, { dangerouslySingular: singlePageId, ...navigationOptions });
    },
  }), [router, navigation]);
}

function isTabDestination(href: Href): boolean {
  const pathname = (typeof href === 'string' ? href : href.pathname).split(/[?#]/)[0];
  return ['/', '/(tabs)', '/(tabs)/', '/flow', '/bills', '/wallet',
    '/(tabs)/index', '/(tabs)/flow', '/(tabs)/bills', '/(tabs)/wallet'].includes(pathname);
}
