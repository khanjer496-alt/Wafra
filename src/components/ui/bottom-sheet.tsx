import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  Modal,
  Platform,
  Pressable,
  ScrollView,
  StyleSheet,
  View,
  useWindowDimensions,
} from 'react-native';
import {
  Gesture,
  GestureDetector,
  GestureHandlerRootView,
} from 'react-native-gesture-handler';
import Animated, {
  Easing,
  Extrapolation,
  ReduceMotion,
  interpolate,
  runOnJS,
  useAnimatedStyle,
  useSharedValue,
  withSpring,
  withTiming,
} from 'react-native-reanimated';
import { initialWindowMetrics, useSafeAreaInsets } from 'react-native-safe-area-context';

import { ThemedText } from '@/components/themed-text';
import { Icon } from '@/components/ui/icon';
import { EASE, Elevation, Radius, ScreenPadding, Spacing } from '@/constants/theme';
import { useKeyboardHeight } from '@/hooks/use-keyboard-height';
import { useLanguage } from '@/hooks/use-language';
import { useLargeTextLayout } from '@/hooks/use-large-text-layout';
import { useReducedMotion } from '@/hooks/use-reduced-motion';
import { useTheme } from '@/hooks/use-theme';
import { t } from '@/lib/i18n';

const EASING = Easing.bezier(EASE[0], EASE[1], EASE[2], EASE[3]);
const OPEN_SPRING = {
  damping: 27,
  stiffness: 300,
  mass: 0.86,
  overshootClamping: true,
  reduceMotion: ReduceMotion.System,
} as const;

const CLOSE_DURATION = 240;

type BottomSheetCommonProps = {
  visible: boolean;
  onClose: () => void;
  /** Sentence-case title in the sheet header. */
  title: string;
  /** Optional secondary line directly beneath the sheet title. */
  subtitle?: string;
  /** Optional visual identity shown before the title block. */
  headerLeading?: React.ReactNode;
  /** Keep the 44dp close target while allowing visually lighter sheets. */
  closeVariant?: 'outline' | 'plain';
  children: React.ReactNode;
  testID?: string;
};

export type BottomSheetProps = BottomSheetCommonProps & (
  | { dismissible?: true; footer?: React.ReactNode }
  | { dismissible: false; footer: React.ReactElement }
);

/**
 * The one bottom sheet. It follows the finger from its grabber, settles with a
 * restrained native-feeling spring, and finishes dismissing before its caller
 * clears the selected item. The content scrolls independently so a tall sheet
 * never traps a button under the keyboard.
 */
export function BottomSheet({
  visible,
  onClose,
  title,
  subtitle,
  headerLeading,
  closeVariant = 'plain',
  children,
  dismissible = true,
  footer,
  testID,
}: BottomSheetProps) {
  const theme = useTheme();
  const language = useLanguage();
  const insets = useSafeAreaInsets();
  const keyboardHeight = useKeyboardHeight();
  const reducedMotion = useReducedMotion();
  const { height: screenHeight } = useWindowDimensions();
  const [mounted, setMounted] = useState(visible);
  const y = useSharedValue(screenHeight);
  const dragStartY = useSharedValue(screenHeight);
  const dragging = useSharedValue(false);
  const opened = useRef(false);

  // Every caller passes an inline `onClose`, and a sheet that reads the store
  // re-renders on every ledger update while open. Holding the callback in a
  // ref keeps `finishDismiss`, the dismiss handlers and the pan gesture
  // stable, so a background import does not rebuild the native gesture
  // handler under the user's finger.
  const onCloseRef = useRef(onClose);
  onCloseRef.current = onClose;
  const finishDismiss = useCallback(() => {
    setMounted(false);
    onCloseRef.current();
  }, []);

  const requestDismiss = useCallback(() => {
    if (reducedMotion || Platform.OS === 'android') {
      finishDismiss();
      return;
    }
    y.value = withTiming(
      screenHeight,
      { duration: CLOSE_DURATION, easing: EASING, reduceMotion: ReduceMotion.System },
      (finished) => {
        if (finished) runOnJS(finishDismiss)();
      },
    );
  }, [finishDismiss, reducedMotion, screenHeight, y]);

  const requestImplicitDismiss = useCallback(() => {
    if (dismissible) requestDismiss();
  }, [dismissible, requestDismiss]);

  useEffect(() => {
    if (visible && !mounted) {
      setMounted(true);
      return;
    }
    if (visible || !mounted) return;
    opened.current = false;

    if (reducedMotion || Platform.OS === 'android') {
      setMounted(false);
      return;
    }
    y.value = withTiming(
      screenHeight,
      { duration: CLOSE_DURATION, easing: EASING, reduceMotion: ReduceMotion.System },
      (finished) => {
        if (finished) runOnJS(setMounted)(false);
      },
    );
  }, [mounted, reducedMotion, screenHeight, visible, y]);

  useEffect(() => {
    if (!mounted || !visible) {
      opened.current = false;
      return;
    }
    if (reducedMotion || Platform.OS === 'android') {
      // A screen reader or Reduce Motion can be enabled while the entrance is
      // already running. Assigning the resting value cancels that spring
      // immediately instead of waiting for the sheet to finish moving.
      opened.current = true;
      dragging.value = false;
      y.value = 0;
      return;
    }
    if (opened.current) return;
    opened.current = true;
    y.value = screenHeight;
    y.value = withSpring(0, OPEN_SPRING);
  }, [dragging, mounted, reducedMotion, screenHeight, visible, y]);

  const drag = useMemo(
    () =>
      Gesture.Pan()
        // Android Modal + gesture/spring animations can leave a stale window
        // composited for a frame (or longer when Hermes is busy). Android keeps
        // the explicit close/backdrop controls and settles sheets immediately;
        // iOS retains the native-feeling swipe interaction.
        .enabled(dismissible && !reducedMotion && Platform.OS !== 'android')
        .activeOffsetY(8)
        .failOffsetX([-24, 24])
        .onStart(() => {
          dragging.value = true;
          dragStartY.value = y.value;
        })
        .onUpdate((event) => {
          y.value = Math.max(0, dragStartY.value + event.translationY);
        })
        .onEnd((event) => {
          dragging.value = false;
          const shouldClose = y.value > screenHeight * 0.16 || event.velocityY > 850;
          if (shouldClose) {
            y.value = withTiming(
              screenHeight,
              {
                duration: CLOSE_DURATION,
                easing: EASING,
                reduceMotion: ReduceMotion.System,
              },
              (finished) => {
                if (finished) runOnJS(finishDismiss)();
              },
            );
            return;
          }
          y.value = withSpring(0, OPEN_SPRING);
        })
        .onFinalize((_event, success) => {
          // `onEnd` is skipped when the OS or another recognizer cancels an
          // active drag. Recover to the resting detent so the sheet and scrim
          // cannot be stranded halfway through a dismissal. Settle instantly:
          // cancellation can be caused by a screen reader becoming active,
          // and the app treats that as a reduced-motion preference.
          if (!success && dragging.value) {
            dragging.value = false;
            y.value = 0;
          }
        }),
    [dismissible, dragStartY, dragging, finishDismiss, reducedMotion, screenHeight, y],
  );

  const sheetStyle = useAnimatedStyle(() => ({ transform: [{ translateY: y.value }] }));
  const backdropStyle = useAnimatedStyle(() => ({
    opacity: interpolate(y.value, [0, screenHeight], [1, 0], Extrapolation.CLAMP),
  }));
  const windowBottomInset = Platform.OS === 'ios'
    ? Math.min(insets.bottom, initialWindowMetrics?.insets.bottom ?? insets.bottom)
    : insets.bottom;
  const bottomClearance = Spacing.five - 2 + (keyboardHeight > 0 ? 0 : windowBottomInset);
  const hasFooter = footer !== null && footer !== undefined && typeof footer !== 'boolean';
  // At the accessibility text sizes a pinned footer (two full-width wrapped
  // buttons) can take most of a phone screen and leave the content a sliver
  // to scroll in. There the actions scroll at the end of the content instead,
  // and the sheet may use the full height below the status bar.
  const largeText = useLargeTextLayout();
  const pinFooter = hasFooter && !largeText;
  const footerNode = hasFooter ? (
    <View testID={testID ? `${testID}-footer` : undefined}
      style={[styles.footer, !pinFooter && styles.footerInline, { paddingBottom: bottomClearance, borderTopColor: theme.cardBorder }]}>
      {footer}
    </View>
  ) : null;
  const closeButton = (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={t('close', language)}
      hitSlop={8}
      onPress={requestDismiss}
      style={({ pressed }) => [
        styles.close,
        Platform.OS === 'android' && styles.androidClose,
        closeVariant === 'plain' && styles.closePlain,
        { borderColor: theme.controlBorder,
          backgroundColor: pressed ? theme.backgroundSelected : 'transparent',
          opacity: pressed ? 0.7 : 1 },
      ]}>
      <Icon name="close" size={20} color={theme.textSecondary} />
    </Pressable>
  );

  // Keep the dismissal lifecycle, but do not build hidden native sheet trees.
  // All hooks stay above this guard so every open/close follows the same order.
  if (!mounted) return null;

  return (
    <Modal
      visible={mounted}
      transparent
      hardwareAccelerated
      animationType="none"
      onRequestClose={requestImplicitDismiss}
      statusBarTranslucent>
      {/*
        `accessible` must stay false on both wrappers. An accessibilityLabel —
        or a bare Pressable — makes the view an accessibility element, and an
        element absorbs its whole subtree into one node: VoiceOver would read
        every sheet in the app as a single button called "Dismiss" and never
        reach the title, the close button or any of the content. Tapping the
        backdrop still closes the sheet; the labelled way out is the Close
        button below, which is where a screen-reader user expects it.
      */}
      <GestureHandlerRootView style={styles.root}>
        <Animated.View
          pointerEvents="none"
          style={[styles.scrim, { backgroundColor: theme.scrim }, backdropStyle]}
        />
        <Pressable
          accessible={false}
          disabled={!dismissible}
          style={StyleSheet.absoluteFill}
          onPress={requestImplicitDismiss}
        />
        <View accessible={false} style={styles.backdrop} pointerEvents="box-none">
          <Animated.View
            accessibilityViewIsModal
            onAccessibilityEscape={dismissible ? requestDismiss : undefined}
            testID={testID}
            style={[
              styles.sheet,
              {
                backgroundColor: theme.background,
                borderColor: theme.cardBorder,
                // Lift clear of the keyboard. A Modal is its own window and
                // never resizes for it on Android, so a sheet with inputs at
                // the bottom — the period picker's custom range — had its
                // fields buried under the keys with no way to scroll to them.
                paddingBottom: hasFooter ? 0 : bottomClearance,
                marginBottom: keyboardHeight,
                maxHeight: Math.max(0, Math.min(screenHeight * (largeText ? 0.96 : 0.88), screenHeight - keyboardHeight - insets.top)),
              },
              Elevation,
              sheetStyle,
            ]}>
            {/*
              Do not make the whole sheet body a Pressable. A parent press
              responder competes with the vertical ScrollView on Android and
              makes short drags feel delayed or sticky. The sheet already sits
              above the backdrop sibling, so a plain View is enough here.
            */}
            <View accessible={false} style={styles.sheetBody}>
              <GestureDetector gesture={drag}>
                <Animated.View style={styles.dragRegion}>
                  {dismissible ? (
                    <View
                      accessible={false}
                      style={[styles.grabber, { backgroundColor: theme.cardBorderStrong }]}
                    />
                  ) : null}
                  {/* At the accessibility sizes the close button gets its own
                      row, so the title has the full width to wrap in. */}
                  {dismissible && largeText ? <View style={styles.closeRow}>{closeButton}</View> : null}
                  <View style={styles.header}>
                    {headerLeading}
                    <View style={styles.headerCopy}>
                      <ThemedText type="subtitle" accessibilityRole="header" style={styles.title}>
                        {title}
                      </ThemedText>
                      {subtitle ? (
                        <ThemedText type="meta" themeColor="textSecondary">
                          {subtitle}
                        </ThemedText>
                      ) : null}
                    </View>
                    {dismissible && !largeText ? closeButton : null}
                  </View>
                </Animated.View>
              </GestureDetector>
              <ScrollView
                style={styles.scroll}
                showsVerticalScrollIndicator={false}
                bounces={false}
                nestedScrollEnabled
                // Or a tap on a chip while the keyboard is up only dismisses it.
                keyboardShouldPersistTaps="handled"
                contentContainerStyle={[styles.content, hasFooter && !pinFooter && styles.contentWithInlineFooter]}>
                {children}
                {pinFooter ? null : footerNode}
              </ScrollView>
              {pinFooter ? footerNode : null}
            </View>
          </Animated.View>
        </View>
      </GestureHandlerRootView>
    </Modal>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1 },
  scrim: { ...StyleSheet.absoluteFillObject },
  backdrop: {
    flex: 1,
    justifyContent: 'flex-end',
  },
  sheet: {
    borderTopLeftRadius: Radius.bottomSheet,
    borderTopRightRadius: Radius.bottomSheet,
    borderTopWidth: StyleSheet.hairlineWidth,
  },
  sheetBody: { flexShrink: 1, minHeight: 0 },
  headerCopy: { flex: 1, minWidth: 0, gap: Spacing.one },
  title: { minWidth: 0 },
  dragRegion: {
    flexShrink: 0,
    paddingTop: Spacing.two,
    paddingHorizontal: ScreenPadding,
  },
  grabber: {
    width: 36,
    height: 5,
    borderRadius: Radius.full,
    alignSelf: 'center',
    marginBottom: Spacing.two,
  },
  header: {
    gap: Spacing.two,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingBottom: Spacing.three,
  },
  close: {
    flexShrink: 0,
    width: 44,
    height: 44,
    borderRadius: 22,
    borderWidth: 1,
    alignItems: 'center',
    justifyContent: 'center',
  },
  androidClose: { width: 48, height: 48 },
  closePlain: { borderWidth: 0 },
  closeRow: { flexDirection: 'row', justifyContent: 'flex-end' },
  scroll: { flexShrink: 1, minHeight: 0 },
  content: {
    gap: Spacing.three,
    paddingHorizontal: ScreenPadding,
    paddingBottom: Spacing.two,
  },
  footer: {
    flexShrink: 0,
    borderTopWidth: StyleSheet.hairlineWidth,
    paddingTop: Spacing.three,
    paddingHorizontal: ScreenPadding,
  },
  // Inside the scroll content, which already carries the side padding.
  footerInline: { paddingHorizontal: 0, marginTop: Spacing.two },
  contentWithInlineFooter: { paddingBottom: 0 },
});
