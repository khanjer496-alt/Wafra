import React from 'react';
import { RefreshControl, type RefreshControlProps } from 'react-native';

import { usePullToRefresh } from '@/hooks/use-auto-import';

type Props = Omit<RefreshControlProps, 'refreshing' | 'onRefresh'>;

/**
 * Pull-to-refresh that runs a capture scan.
 *
 * usePullToRefresh goes through useAutoImport, which reads the whole store,
 * so calling it in a screen re-rendered that screen on every store change,
 * import progress included. Here only this control re-renders. It passes
 * every other prop through: ScrollView gives it `style` and, on Android, the
 * scroll view itself as `children`, and ScreenScaffold adds
 * `progressViewOffset`.
 */
export function CaptureRefreshControl(props: Props) {
  const { refreshing, onRefresh } = usePullToRefresh();
  return <RefreshControl {...props} refreshing={refreshing} onRefresh={onRefresh} />;
}
