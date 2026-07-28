import React, { createContext, useCallback, useContext, useRef, useState } from 'react';
import { AccessibilityInfo, Pressable, StyleSheet, View } from 'react-native';
import Animated, { Easing, FadeOutDown, SlideInDown } from 'react-native-reanimated';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { ThemedText } from '@/components/themed-text';
import { Icon } from '@/components/ui/icon';
import { EASE, Motion, Spacing } from '@/constants/theme';
import { useTheme } from '@/hooks/use-theme';

const EASING = Easing.bezier(EASE[0], EASE[1], EASE[2], EASE[3]);

export interface ToastAction {
  label: string;
  onPress: () => void;
}

interface ToastState {
  message: string;
  actions: ToastAction[];
}

interface ToastContextValue {
  show: (message: string, actions?: ToastAction[], durationMs?: number) => void;
}

const ToastContext = createContext<ToastContextValue>({ show: () => {} });

export function useToast(): ToastContextValue {
  return useContext(ToastContext);
}

/**
 * The success bar: solid ink, a mint check, and its undo.
 *
 * It is the loudest surface in the app on purpose — an undo with a deadline
 * has to be seen before the deadline passes.
 */
export function ToastProvider({ children }: { children: React.ReactNode }) {
  const theme = useTheme();
  const insets = useSafeAreaInsets();
  const [toast, setToast] = useState<ToastState | null>(null);
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);

  const show = useCallback((message: string, actions: ToastAction[] = [], durationMs = 6000) => {
    if (timer.current) clearTimeout(timer.current);
    setToast({ message, actions });
    timer.current = setTimeout(() => setToast(null), durationMs);

    // A toast carrying Undo is a deadline. Six seconds is comfortable when you
    // can see it land; it is not enough to hear it read out, swipe to the
    // button and press it. Extend the deadline once we know a screen reader is
    // on — the check is async, so the timer above starts immediately and is
    // replaced rather than waited for.
    AccessibilityInfo.isScreenReaderEnabled()
      .then((on) => {
        AccessibilityInfo.announceForAccessibility(message);
        if (!on) return;
        if (timer.current) clearTimeout(timer.current);
        timer.current = setTimeout(() => setToast(null), durationMs * 3);
      })
      .catch(() => {});
  }, []);

  const dismiss = useCallback(() => {
    if (timer.current) clearTimeout(timer.current);
    setToast(null);
  }, []);

  return (
    <ToastContext.Provider value={{ show }}>
      {children}
      {toast && (
        <Animated.View
          entering={SlideInDown.duration(Motion.sheet).easing(EASING)}
          exiting={FadeOutDown.duration(200)}
          // Clears the floating tab bar rather than sitting under it.
          style={[styles.wrap, { bottom: Math.max(insets.bottom, Spacing.two) + 84 }]}
          accessibilityLiveRegion="polite"
          pointerEvents="box-none">
          <View style={styles.toast}>
            <Icon name="check" size={16} color={theme.primary} strokeWidth={2.1} />
            <ThemedText type="small" style={styles.message} numberOfLines={2}>
              {toast.message}
            </ThemedText>
            {toast.actions.map((a) => (
              <Pressable
                key={a.label}
                accessibilityRole="button"
                onPress={() => {
                  dismiss();
                  a.onPress();
                }}
                hitSlop={6}>
                <ThemedText type="nano" style={{ color: theme.primary }}>
                  {a.label}
                </ThemedText>
              </Pressable>
            ))}
          </View>
        </Animated.View>
      )}
    </ToastContext.Provider>
  );
}

const styles = StyleSheet.create({
  wrap: {
    position: 'absolute',
    left: 0,
    right: 0,
    alignItems: 'center',
  },
  toast: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: Spacing.three - 4,
    maxWidth: 480,
    marginHorizontal: Spacing.three,
    backgroundColor: '#16130F',
    borderRadius: 13,
    paddingHorizontal: Spacing.three,
    paddingVertical: Spacing.three - 2,
    shadowColor: '#16130F',
    shadowOpacity: 0.18,
    shadowRadius: 12,
    shadowOffset: { width: 0, height: 8 },
    elevation: 8,
  },
  message: {
    flexShrink: 1,
    color: '#F2EFE8',
  },
});
