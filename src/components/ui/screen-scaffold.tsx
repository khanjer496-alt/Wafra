import React, { useMemo } from 'react';
import {
  KeyboardAvoidingView,
  Platform,
  ScrollView,
  StyleSheet,
  View,
  type RefreshControlProps,
  type ScrollViewProps,
  type StyleProp,
  type ViewStyle,
} from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { ThemedView } from '@/components/themed-view';
import { ScreenHeader, type ScreenHeaderProps } from '@/components/ui/screen-header';
import { MaxContentWidth, ScreenPadding, Spacing } from '@/constants/theme';
import { useKeyboardHeight } from '@/hooks/use-keyboard-height';
import { useTabBarClearance } from '@/hooks/use-tab-bar-clearance';

export type ScreenScaffoldProps = {
  children: React.ReactNode;
  header?: ScreenHeaderProps;
  headerMode?: 'auto' | 'native' | 'inline';
  footer?: React.ReactNode;
  scroll?: boolean;
  scrollRef?: React.Ref<ScrollView>;
  virtualized?: boolean;
  scrollProps?: Omit<
    ScrollViewProps,
    | 'contentContainerStyle'
    | 'refreshControl'
    | 'contentInset'
    | 'scrollIndicatorInsets'
  >;
  refreshControl?: React.ReactElement<RefreshControlProps>;
  keyboardAware?: boolean;
  tabbed?: boolean;
  contentStyle?: StyleProp<ViewStyle>;
  testID?: string;
};

export type ScreenContentInsets = {
  contentContainerStyle: StyleProp<ViewStyle>;
  contentInset: { top: number; bottom: number };
  scrollIndicatorInsets: { top: number; bottom: number };
};

export function useScreenContentInsets({
  tabbed = false,
  hasFooter = false,
}: {
  tabbed?: boolean;
  hasFooter?: boolean;
}): ScreenContentInsets {
  const insets = useSafeAreaInsets();
  const tabBarClearance = useTabBarClearance();
  const footerClearance = hasFooter ? 48 + Spacing.four : 0;
  const bottom = tabbed
    ? tabBarClearance + footerClearance
    : (Platform.OS === 'android' ? 0 : insets.bottom) + footerClearance + Spacing.four;
  const top = tabbed && Platform.OS !== 'android' ? insets.top + Spacing.three : Spacing.three;

  // Stable inset objects let memoized lists skip unrelated search/menu renders.
  return useMemo(() => ({
    contentContainerStyle: [
      styles.content,
      Platform.OS !== 'ios' && { paddingTop: top, paddingBottom: bottom },
    ],
    contentInset: { top, bottom },
    scrollIndicatorInsets: { top, bottom },
  }), [top, bottom]);
}

export function ScreenScaffold({
  children,
  header,
  headerMode = 'auto',
  footer,
  scroll = true,
  scrollRef,
  virtualized = false,
  scrollProps,
  refreshControl,
  keyboardAware = false,
  tabbed = false,
  contentStyle,
  testID,
}: ScreenScaffoldProps) {
  const safeAreaInsets = useSafeAreaInsets();
  const contentInsets = useScreenContentInsets({ tabbed, hasFooter: footer !== undefined });
  const keyboardHeight = useKeyboardHeight();
  const resolvedHeaderMode = headerMode === 'auto'
    ? (tabbed ? 'inline' : 'native')
    : headerMode;
  const usesNativeHeader = Platform.OS === 'ios' && header !== undefined &&
    resolvedHeaderMode === 'native' &&
    !(header.subtitle && header.largeTitle);

  if (virtualized && scroll) {
    throw new Error('ScreenScaffold virtualized content requires scroll={false}.');
  }

  const top = usesNativeHeader
    ? contentInsets.contentInset.top
    : (Platform.OS === 'android' ? 0 : safeAreaInsets.top) + (header === undefined ? Spacing.four : Spacing.three);
  const keyboardBottom = keyboardAware && Platform.OS !== 'ios' ? keyboardHeight : 0;
  const effectiveInsets = {
    contentInset: { top, bottom: contentInsets.contentInset.bottom + keyboardBottom },
    scrollIndicatorInsets: {
      top,
      bottom: contentInsets.scrollIndicatorInsets.bottom + keyboardBottom,
    },
  };
  // An inline iOS header has no navigation bar to position its scroll origin.
  // Keep this stable across ordinary renders and let explicit callers override it.
  const initialContentOffset = useMemo(
    () => Platform.OS === 'ios' && !usesNativeHeader
      ? { x: 0, y: -effectiveInsets.contentInset.top }
      : undefined,
    [effectiveInsets.contentInset.top, usesNativeHeader],
  );
  const footerClearance = footer !== undefined ? 48 + Spacing.four : 0;
  const footerBottom = contentInsets.contentInset.bottom - footerClearance;
  const inlineHeader = header && !usesNativeHeader
    ? <ScreenHeader {...header} mode="inline" />
    : null;
  const resolvedRefreshControl = refreshControl && Platform.OS === 'android'
    ? React.cloneElement(refreshControl, {
        progressViewOffset:
          refreshControl.props.progressViewOffset ?? effectiveInsets.contentInset.top,
      })
    : refreshControl;
  const virtualizedInlineHeader = inlineHeader && virtualized
    ? (
        <View
          style={[
            styles.virtualizedHeader,
            { paddingTop: effectiveInsets.contentInset.top },
          ]}>
          {inlineHeader}
        </View>
      )
    : inlineHeader;

  const content = scroll ? (
    <ScrollView
      ref={scrollRef}
      contentOffset={initialContentOffset}
      {...scrollProps}
      style={[styles.flex, scrollProps?.style]}
      contentInsetAdjustmentBehavior={usesNativeHeader ? 'automatic' : 'never'}
      contentContainerStyle={[
        contentInsets.contentContainerStyle,
        Platform.OS !== 'ios' && {
          paddingTop: effectiveInsets.contentInset.top,
          paddingBottom: effectiveInsets.contentInset.bottom,
        },
        contentStyle,
      ]}
      contentInset={effectiveInsets.contentInset}
      scrollIndicatorInsets={effectiveInsets.scrollIndicatorInsets}
      refreshControl={resolvedRefreshControl}>
      {inlineHeader}
      {children}
    </ScrollView>
  ) : (
    <View
      style={[
        styles.flex,
        virtualized ? undefined : contentInsets.contentContainerStyle,
        virtualized ? undefined : {
          paddingTop: effectiveInsets.contentInset.top,
          paddingBottom: effectiveInsets.contentInset.bottom,
        },
        contentStyle,
      ]}>
      {virtualizedInlineHeader}
      {children}
    </View>
  );

  const frame = (
    <>
      {content}
      {footer !== undefined ? (
        <View style={[styles.footer, { paddingBottom: footerBottom }]}>{footer}</View>
      ) : null}
      {usesNativeHeader ? <ScreenHeader {...header} mode="native" /> : null}
    </>
  );

  return (
    <ThemedView style={[styles.root, Platform.OS === 'android' && {
      // A scroll-content inset protects only the FIRST row. Reserve the actual
      // viewport instead, so scrolled text cannot run beneath the system bars.
      paddingTop: safeAreaInsets.top,
      paddingBottom: tabbed ? 0 : safeAreaInsets.bottom,
    }]} testID={testID}>
      {keyboardAware ? (
        <KeyboardAvoidingView
          style={styles.flex}
          behavior={Platform.OS === 'ios' ? 'padding' : undefined}>
          {frame}
        </KeyboardAvoidingView>
      ) : frame}
    </ThemedView>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1 },
  flex: { flex: 1 },
  content: {
    width: '100%',
    maxWidth: MaxContentWidth,
    alignSelf: 'center',
    paddingHorizontal: ScreenPadding,
    gap: 12,
  },
  virtualizedHeader: {
    width: '100%',
    maxWidth: MaxContentWidth,
    alignSelf: 'center',
    paddingHorizontal: ScreenPadding,
  },
  footer: {
    width: '100%',
    maxWidth: MaxContentWidth,
    alignSelf: 'center',
    paddingHorizontal: ScreenPadding,
    paddingTop: 6,
  },
});
