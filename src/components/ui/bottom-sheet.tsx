import React, { useEffect } from 'react';
import { Modal, Pressable, ScrollView, StyleSheet, View } from 'react-native';
import Animated, {
  Easing,
  useAnimatedStyle,
  useSharedValue,
  withSequence,
  withTiming,
} from 'react-native-reanimated';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { ThemedText } from '@/components/themed-text';
import { Icon } from '@/components/ui/icon';
import { EASE, Elevation, Motion, Radius, ScreenPadding, Spacing } from '@/constants/theme';
import { useKeyboardHeight } from '@/hooks/use-keyboard-height';
import { useTheme } from '@/hooks/use-theme';

const EASING = Easing.bezier(EASE[0], EASE[1], EASE[2], EASE[3]);
const OFFSCREEN = 700;

interface BottomSheetProps {
  visible: boolean;
  onClose: () => void;
  /** Caps label in the sheet header. */
  title: string;
  children: React.ReactNode;
}

/**
 * The one bottom sheet. 420ms up with a 12px overshoot, dismissed by the
 * backdrop or the ×; the content scrolls so a tall sheet never traps a button
 * under the keyboard.
 */
export function BottomSheet({ visible, onClose, title, children }: BottomSheetProps) {
  const theme = useTheme();
  const insets = useSafeAreaInsets();
  const keyboardHeight = useKeyboardHeight();
  const y = useSharedValue(OFFSCREEN);

  useEffect(() => {
    if (visible) {
      y.value = OFFSCREEN;
      y.value = withSequence(
        withTiming(-12, { duration: Motion.sheet * 0.8, easing: EASING }),
        withTiming(0, { duration: Motion.sheet * 0.2, easing: EASING }),
      );
    }
  }, [visible, y]);

  const sheetStyle = useAnimatedStyle(() => ({ transform: [{ translateY: y.value }] }));

  return (
    <Modal visible={visible} transparent animationType="fade" onRequestClose={onClose} statusBarTranslucent>
      {/*
        `accessible` must stay false on both wrappers. An accessibilityLabel —
        or a bare Pressable — makes the view an accessibility element, and an
        element absorbs its whole subtree into one node: VoiceOver would read
        every sheet in the app as a single button called "Dismiss" and never
        reach the title, the close button or any of the content. Tapping the
        backdrop still closes the sheet; the labelled way out is the Close
        button below, which is where a screen-reader user expects it.
      */}
      <Pressable accessible={false} style={styles.backdrop} onPress={onClose}>
        <Animated.View
          accessibilityViewIsModal
          style={[
            styles.sheet,
            {
              backgroundColor: theme.background,
              borderColor: theme.cardBorder,
              // Lift clear of the keyboard. A Modal is its own window and
              // never resizes for it on Android, so a sheet with inputs at
              // the bottom — the period picker's custom range — had its
              // fields buried under the keys with no way to scroll to them.
              paddingBottom: Spacing.five - 2 + (keyboardHeight > 0 ? 0 : insets.bottom),
              marginBottom: keyboardHeight,
            },
            Elevation,
            sheetStyle,
          ]}>
          {/* Swallows taps so a press inside the sheet never dismisses it. */}
          <Pressable accessible={false} onPress={() => {}}>
            <View style={styles.header}>
              <ThemedText type="micro" themeColor="textTertiary">
                {title}
              </ThemedText>
              <Pressable
                accessibilityRole="button"
                accessibilityLabel="Close"
                hitSlop={8}
                onPress={onClose}
                style={[styles.close, { borderColor: theme.cardBorder }]}>
                <Icon name="close" size={15} color={theme.textSecondary} />
              </Pressable>
            </View>
            <ScrollView
              showsVerticalScrollIndicator={false}
              bounces={false}
              // Or a tap on a chip while the keyboard is up only dismisses it.
              keyboardShouldPersistTaps="handled"
              contentContainerStyle={styles.content}>
              {children}
            </ScrollView>
          </Pressable>
        </Animated.View>
      </Pressable>
    </Modal>
  );
}

const styles = StyleSheet.create({
  backdrop: {
    flex: 1,
    backgroundColor: 'rgba(22, 19, 15, 0.42)',
    justifyContent: 'flex-end',
  },
  sheet: {
    borderTopLeftRadius: Radius.bottomSheet,
    borderTopRightRadius: Radius.bottomSheet,
    borderTopWidth: StyleSheet.hairlineWidth,
    paddingHorizontal: ScreenPadding,
    paddingTop: ScreenPadding,
    maxHeight: '88%',
  },
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingBottom: Spacing.three + 2,
  },
  close: {
    width: 30,
    height: 30,
    borderRadius: Radius.tile,
    borderWidth: 1,
    alignItems: 'center',
    justifyContent: 'center',
  },
  content: {
    gap: Spacing.four - 4,
    paddingBottom: Spacing.two,
  },
});
