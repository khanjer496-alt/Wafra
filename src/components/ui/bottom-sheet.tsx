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
      <Pressable accessibilityLabel="Dismiss" style={styles.backdrop} onPress={onClose}>
        <Animated.View
          style={[
            styles.sheet,
            {
              backgroundColor: theme.background,
              borderColor: theme.cardBorder,
              paddingBottom: Spacing.five - 2 + insets.bottom,
            },
            Elevation,
            sheetStyle,
          ]}>
          {/* Swallows taps so a press inside the sheet never dismisses it. */}
          <Pressable onPress={() => {}}>
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
