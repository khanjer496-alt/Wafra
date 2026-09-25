import { useIsFocused } from '@react-navigation/native';
import { StatusBar } from 'expo-status-bar';
import { useRouter } from 'expo-router';
import React, { useEffect, useRef } from 'react';
import {
  KeyboardAvoidingView,
  Platform,
  Pressable,
  ScrollView,
  StyleSheet,
  View,
  type RefreshControlProps,
  type ScrollViewProps,
  type StyleProp,
  type ViewStyle,
} from 'react-native';
import Animated, { useAnimatedStyle, useSharedValue, withSpring } from 'react-native-reanimated';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { ThemedText } from '@/components/themed-text';
import { Icon, type IconName } from '@/components/ui/icon';
import { BandLayout, MaxContentWidth, MotionSpring, Spacing, type BandId, type BandPalette } from '@/constants/theme';
import { useBand } from '@/hooks/use-band';
import { useKeyboardHeight } from '@/hooks/use-keyboard-height';
import { useLanguage } from '@/hooks/use-language';
import { useLargeTextLayout } from '@/hooks/use-large-text-layout';
import { useMotionPreference } from '@/hooks/use-reduced-motion';
import { useTabBarClearance } from '@/hooks/use-tab-bar-clearance';
import { bandCopy } from '@/lib/band-copy';

/** Side gutter inside the band and the sheet (the boards' 20pt). */
export const BAND_GUTTER = 20;

export interface BandAction {
  icon: IconName;
  /** Spoken label; the action shows only its icon. */
  label: string;
  onPress: () => void;
  testID?: string;
}

export interface BandNav {
  /** A back chevron. `true` pops the route; a function replaces that. */
  back?: boolean | (() => void);
  /** A close cross instead of back, for modal flows. */
  close?: () => void;
  /** Short screen name beside the back control. Headlines belong in the band. */
  title?: string;
  /** Round icon actions at the end of the row (44pt, translucent). */
  actions?: readonly BandAction[];
  /** Anything else at the start of the row (Home's pattern). */
  leading?: React.ReactNode;
  /** Anything else at the end of the row, before the actions (Home's Ask/Add). */
  trailing?: React.ReactNode;
}

export type BandScaffoldProps = {
  /** Which tab colour the screen wears. Detail screens take their parent's. */
  band: BandId;
  /** The nav row. Omit for a band with no row. */
  nav?: BandNav;
  /** Free band content under the nav row: the one figure that matters. */
  bandContent?: React.ReactNode;
  /** The sheet's content. */
  children: React.ReactNode;
  /** A control pinned to the bottom of the screen, on the sheet colour. */
  footer?: React.ReactNode;
  /**
   * `false` for a screen whose sheet holds its own virtualized list: the band
   * stays put and the sheet fills the rest. Put nothing scrollable in the band.
   */
  scroll?: boolean;
  scrollRef?: React.Ref<ScrollView>;
  scrollProps?: Omit<ScrollViewProps, 'contentContainerStyle' | 'refreshControl' | 'contentInset' | 'scrollIndicatorInsets'>;
  refreshControl?: React.ReactElement<RefreshControlProps>;
  keyboardAware?: boolean;
  keyboardVerticalOffset?: number;
  /** A tab root: the sheet clears the tab bar. */
  tabbed?: boolean;
  /** Extra bottom space for a control floating over the content (Android's Home Add). */
  floatingClearance?: number;
  /** Style of the sheet's inner content column. */
  contentStyle?: StyleProp<ViewStyle>;
  /** Style of the band's inner column. */
  bandStyle?: StyleProp<ViewStyle>;
  testID?: string;
  bandTestID?: string;
  sheetTestID?: string;
  /** Presentation-only scheme override (previews). */
  scheme?: 'light' | 'dark';
};

/** The round translucent icon action on a band. */
export function BandIconButton({ action, palette }: { action: BandAction; palette: BandPalette }) {
  return <Pressable testID={action.testID} accessibilityRole="button" accessibilityLabel={action.label}
    onPress={action.onPress} hitSlop={2}
    style={({ pressed }) => [styles.iconAction, { backgroundColor: palette.tile, opacity: pressed ? 0.7 : 1 }]}>
    <Icon name={action.icon} size={20} color={palette.onBand} strokeWidth={2} />
  </Pressable>;
}

/**
 * The band's nav row: back or close, a short title, then round icon actions.
 * Under the accessibility text sizes the title takes its own line so it is
 * never squeezed between the controls.
 */
export function BandNavRow({ nav, palette }: { nav: BandNav; palette: BandPalette }) {
  const router = useRouter();
  const words = bandCopy(useLanguage());
  const largeText = useLargeTextLayout();
  const onBack = typeof nav.back === 'function' ? nav.back : nav.back ? () => router.back() : undefined;
  const lead = onBack ? <Pressable testID="band-back" accessibilityRole="button" accessibilityLabel={words.back}
    onPress={onBack} style={({ pressed }) => [styles.navControl, { opacity: pressed ? 0.6 : 1 }]}>
    <Icon name="chevron-left" size={24} color={palette.onBand} strokeWidth={2.2} />
  </Pressable> : nav.close ? <Pressable testID="band-close" accessibilityRole="button" accessibilityLabel={words.close}
    onPress={nav.close} style={({ pressed }) => [styles.navControl, { opacity: pressed ? 0.6 : 1 }]}>
    <Icon name="close" size={22} color={palette.onBand} strokeWidth={2.2} />
  </Pressable> : null;
  const title = nav.title ? <ThemedText type="subtitle" accessibilityRole="header"
    style={[styles.navTitle, largeText && styles.navTitleStacked, { color: palette.onBand }]}>{nav.title}</ThemedText> : null;
  return <View style={styles.navWrap}>
    <View style={styles.navRow}>
      <View style={styles.navStart}>
        {lead}
        {nav.leading}
        {!largeText ? title : null}
      </View>
      <View style={styles.navEnd}>
        {nav.trailing}
        {nav.actions?.map((action) => <BandIconButton key={action.label} action={action} palette={palette} />)}
      </View>
    </View>
    {largeText ? title : null}
  </View>;
}

/**
 * The colour band on its own: nav row, then free content. BandScaffold uses
 * it; a screen with its own virtualized list can render it as the list header
 * (with `BandSheetCap` right after) to keep the band scrolling away.
 */
export function BandHeader({ palette, nav, children, style, testID, topInset = 0 }: {
  palette: BandPalette;
  nav?: BandNav;
  children?: React.ReactNode;
  style?: StyleProp<ViewStyle>;
  testID?: string;
  /** Status-bar height when the band itself must cover it. */
  topInset?: number;
}) {
  return <View testID={testID} style={[styles.band, { backgroundColor: palette.band, paddingTop: topInset + Spacing.two }]}>
    <View style={[styles.column, styles.bandColumn, style]}>
      {nav ? <BandNavRow nav={nav} palette={palette} /> : null}
      {children}
    </View>
  </View>;
}

/**
 * Bottom padding a `scroll={false}` sheet's own list needs: the tab bar (or
 * the home indicator on iOS) plus the usual breathing room.
 */
export function useBandBottomInset({ tabbed = false, floatingClearance = 0 }: { tabbed?: boolean; floatingClearance?: number } = {}): number {
  const insets = useSafeAreaInsets();
  const tabBarClearance = useTabBarClearance();
  const systemBottom = tabbed ? tabBarClearance : Platform.OS === 'android' ? 0 : insets.bottom;
  return systemBottom + (tabbed ? 0 : Spacing.four) + floatingClearance;
}

/** The sheet's rounded top edge, for list screens that compose their own sheet. */
export function BandSheetCap({ palette }: { palette: BandPalette }) {
  return <View style={[styles.sheetCap, { backgroundColor: palette.sheet }]} />;
}

/**
 * A screen in design language E: a colour band holding the one figure that
 * matters, and a sheet that overlaps it by 28pt with the detail.
 *
 * Same responsibilities as ScreenScaffold — safe areas, scrolling, pull to
 * refresh, tab-bar clearance, keyboard avoidance, large text, testIDs — with
 * the band scrolling away with the content. The status bar area stays the
 * band colour (so light status-bar content never lands on the cream sheet),
 * the top overscroll shows the band and the bottom overscroll shows the sheet.
 *
 * Motion: on first mount the sheet rises 40pt on the 260/24 spring. The band
 * never moves. Android keeps its measured motion bypass and Reduce Motion (or
 * a running screen reader) shows the sheet in place at once.
 *
 * Screens that use it hide the native stack header (`headerShown: false`);
 * the band's nav row replaces it.
 */
export function BandScaffold({
  band,
  nav,
  bandContent,
  children,
  footer,
  scroll = true,
  scrollRef,
  scrollProps,
  refreshControl,
  keyboardAware = false,
  keyboardVerticalOffset = 0,
  tabbed = false,
  floatingClearance = 0,
  contentStyle,
  bandStyle,
  testID,
  bandTestID,
  sheetTestID,
  scheme,
}: BandScaffoldProps) {
  const palette = useBand(band, scheme);
  const insets = useSafeAreaInsets();
  const tabBarClearance = useTabBarClearance();
  const focused = useIsFocused();
  const keyboardHeight = useKeyboardHeight(keyboardAware && Platform.OS !== 'ios');
  const { ready, reducedMotion } = useMotionPreference();

  // First appearance: the sheet rises into place once. Never on Android
  // (device traces tied screen-entry motion to jank there) and never under
  // Reduce Motion; later renders never move it again.
  const animates = Platform.OS !== 'android';
  const rise = useSharedValue(animates && !reducedMotion ? BandLayout.sheetRise : 0);
  const risen = useRef(false);
  useEffect(() => {
    if (reducedMotion || !animates) {
      risen.current = true;
      rise.value = 0;
      return;
    }
    if (!ready || risen.current) return;
    risen.current = true;
    rise.value = withSpring(0, { ...MotionSpring, overshootClamping: true });
  }, [animates, ready, reducedMotion, rise]);
  const riseStyle = useAnimatedStyle(() => ({ transform: [{ translateY: rise.value }] }));

  const keyboardBottom = keyboardAware && Platform.OS !== 'ios' ? keyboardHeight : 0;
  const hasFooter = footer !== undefined;
  // Android reserves the navigation-bar area outright (a sheet-coloured strip
  // below everything), like ScreenScaffold, so scrolled text never runs under
  // the system bar. iOS lets the sheet run to the edge and pads its content.
  const androidReserve = Platform.OS === 'android' && !tabbed ? insets.bottom : 0;
  const systemBottom = tabbed ? tabBarClearance : Platform.OS === 'android' ? 0 : insets.bottom;
  // The footer sits in the layout flow below the scroll view, so content
  // never needs to clear it; it clears the tab bar or home indicator itself.
  const bottom = (hasFooter ? Spacing.four : systemBottom + (tabbed ? 0 : Spacing.four)) +
    floatingClearance + keyboardBottom;
  const footerBottom = systemBottom + Spacing.two + keyboardBottom;

  const header = <BandHeader palette={palette} nav={nav} style={bandStyle} testID={bandTestID ?? (testID ? `${testID}-band` : undefined)}>
    {bandContent}
  </BandHeader>;

  const sheet = <Animated.View testID={sheetTestID ?? (testID ? `${testID}-sheet` : undefined)}
    style={[styles.sheet, !scroll && styles.flex, { backgroundColor: palette.sheet }, riseStyle]}>
    <View style={[styles.column, styles.sheetColumn, !scroll && styles.flex,
      scroll && { paddingBottom: bottom }, contentStyle]}>
      {children}
    </View>
    {/* iOS bounces: the bottom overscroll shows the sheet, not the band behind
        it. Only there — on the web an absolute child would lengthen the page,
        and Android does not bounce. */}
    {scroll && Platform.OS === 'ios' ? <View pointerEvents="none" style={[styles.overscroll, { backgroundColor: palette.sheet }]} /> : null}
  </Animated.View>;

  const resolvedRefreshControl = refreshControl
    ? React.cloneElement(refreshControl, {
        tintColor: refreshControl.props.tintColor ?? palette.onBand,
        // Android draws the arrow on its own disc: give it the card surface so
        // a light tint never lands on the default white.
        colors: refreshControl.props.colors ?? [palette.tint],
        progressBackgroundColor: refreshControl.props.progressBackgroundColor ?? palette.card,
      })
    : undefined;

  const content = scroll ? (
    <ScrollView
      ref={scrollRef}
      {...scrollProps}
      style={[styles.flex, scrollProps?.style]}
      contentInsetAdjustmentBehavior="never"
      contentContainerStyle={styles.scrollContent}
      scrollIndicatorInsets={{ top: 0, bottom }}
      refreshControl={resolvedRefreshControl}>
      {header}
      {sheet}
    </ScrollView>
  ) : (
    <View style={styles.flex}>
      {header}
      {sheet}
    </View>
  );

  const frame = <>
    {content}
    {hasFooter ? (
      <View style={[styles.footer, { backgroundColor: palette.sheet, paddingBottom: footerBottom }]}>
        <View style={styles.column}>{footer}</View>
      </View>
    ) : null}
    {androidReserve > 0 ? <View style={{ height: androidReserve, backgroundColor: palette.sheet }} /> : null}
  </>;

  return <View testID={testID} style={[styles.root, { backgroundColor: palette.band, paddingTop: insets.top }]}>
    {/* The status bar follows the focused screen's band. */}
    {focused ? <StatusBar style={palette.statusBar} /> : null}
    {keyboardAware ? (
      <KeyboardAvoidingView style={styles.flex} keyboardVerticalOffset={keyboardVerticalOffset}
        behavior={Platform.OS === 'ios' ? 'padding' : undefined}>
        {frame}
      </KeyboardAvoidingView>
    ) : frame}
  </View>;
}

const styles = StyleSheet.create({
  root: { flex: 1 },
  flex: { flex: 1 },
  scrollContent: { flexGrow: 1 },
  column: { width: '100%', maxWidth: MaxContentWidth, alignSelf: 'center', paddingHorizontal: BAND_GUTTER },
  band: { paddingBottom: BandLayout.sheetOverlap + Spacing.four },
  bandColumn: { gap: Spacing.three },
  sheet: {
    flexGrow: 1,
    marginTop: -BandLayout.sheetOverlap,
    borderTopStartRadius: BandLayout.sheetRadius,
    borderTopEndRadius: BandLayout.sheetRadius,
  },
  sheetColumn: { paddingTop: Spacing.four, gap: 12 },
  sheetCap: {
    height: BandLayout.sheetOverlap,
    marginTop: -BandLayout.sheetOverlap,
    borderTopStartRadius: BandLayout.sheetRadius,
    borderTopEndRadius: BandLayout.sheetRadius,
  },
  overscroll: { position: 'absolute', left: 0, right: 0, top: '100%', height: 1000 },
  navWrap: { gap: Spacing.one },
  navRow: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', gap: Spacing.two, minHeight: 44, flexWrap: 'wrap' },
  navStart: { flexDirection: 'row', alignItems: 'center', gap: Spacing.one, flexShrink: 1, minWidth: 0 },
  navEnd: { flexDirection: 'row', alignItems: 'center', gap: Spacing.two, flexWrap: 'wrap', justifyContent: 'flex-end' },
  navControl: { width: 44, height: 44, marginStart: -10, alignItems: 'center', justifyContent: 'center' },
  navTitle: { flexShrink: 1 },
  navTitleStacked: { paddingTop: Spacing.one },
  iconAction: { width: 44, height: 44, borderRadius: 22, alignItems: 'center', justifyContent: 'center' },
  footer: { paddingTop: Spacing.two },
});
