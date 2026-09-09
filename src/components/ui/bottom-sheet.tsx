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
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { ThemedText } from '@/components/themed-text';
import { Icon } from '@/components/ui/icon';
import { EASE, Elevation, Radius, ScreenPadding, Spacing } from '@/constants/theme';
import { useKeyboardHeight } from '@/hooks/use-keyboard-height';
import { useLanguage } from '@/hooks/use-language';
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
  /** Caps label in the sheet header. */
  title: string;
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

  const finishDismiss = useCallback(() => {
    setMounted(false);
    onClose();
  }, [onClose]);

  const requestDismiss = useCallback(() => {
    if (reducedMotion) {
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

    if (reducedMotion) {
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
    if (reducedMotion) {
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
        .enabled(dismissible && !reducedMotion)
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
  const bottomClearance = Spacing.five - 2 + (keyboardHeight > 0 ? 0 : insets.bottom);
  const hasFooter = footer !== null && footer !== undefined && typeof footer !== 'boolean';

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
                maxHeight: Math.max(0, Math.min(screenHeight * 0.88, screenHeight - keyboardHeight - insets.top)),
              },
              Elevation,
              sheetStyle,
            ]}>
            {/* Swallows taps so a press inside the sheet never dismisses it. */}
            <Pressable accessible={false} onPress={() => {}} style={styles.sheetBody}>
              <GestureDetector gesture={drag}>
                <Animated.View style={styles.dragRegion}>
                  {dismissible ? (
                    <View
                      accessible={false}
                      style={[styles.grabber, { backgroundColor: theme.cardBorderStrong }]}
                    />
                  ) : null}
                  <View style={styles.header}>
                    <ThemedText type="smallBold" accessibilityRole="header" style={styles.title}>
                      {title}
                    </ThemedText>
                    {dismissible ? (
                      <Pressable
                        accessibilityRole="button"
                        accessibilityLabel={t('close', language)}
                        hitSlop={8}
                        onPress={requestDismiss}
                        style={[
                          styles.close,
                          Platform.OS === 'android' && styles.androidClose,
                          { borderColor: theme.controlBorder },
                        ]}>
                        <Icon name="close" size={20} color={theme.textSecondary} />
                      </Pressable>
                    ) : null}
                  </View>
                </Animated.View>
              </GestureDetector>
              <ScrollView
                style={styles.scroll}
                showsVerticalScrollIndicator={false}
                bounces={false}
                // Or a tap on a chip while the keyboard is up only dismisses it.
                keyboardShouldPersistTaps="handled"
                contentContainerStyle={styles.content}>
                {children}
              </ScrollView>
              {hasFooter ? (
                <View testID={testID ? `${testID}-footer` : undefined} style={[styles.footer, { paddingBottom: bottomClearance, borderTopColor: theme.cardBorder }]}>{footer}</View>
              ) : null}
            </Pressable>
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
  title: { flex: 1, minWidth: 0 },
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
    paddingBottom: Spacing.two,
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
  scroll: { flexShrink: 1, minHeight: 0 },
  content: {
    gap: Spacing.four - 4,
    paddingHorizontal: ScreenPadding,
    paddingBottom: Spacing.two,
  },
  footer: {
    flexShrink: 0,
    borderTopWidth: StyleSheet.hairlineWidth,
    paddingTop: Spacing.four - 4,
    paddingHorizontal: ScreenPadding,
  },
});
