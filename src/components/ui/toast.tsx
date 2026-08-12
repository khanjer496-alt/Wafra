import React, { createContext, useCallback, useContext, useRef, useState } from 'react';
import { AccessibilityInfo, Pressable, StyleSheet, View } from 'react-native';
import Animated, { Easing, FadeOutDown, SlideInDown } from 'react-native-reanimated';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { ThemedText } from '@/components/themed-text';
import { Icon, type IconName } from '@/components/ui/icon';
import { Colors, EASE, Motion, Spacing } from '@/constants/theme';
import { useTheme } from '@/hooks/use-theme';
import { useReducedMotion } from '@/hooks/use-reduced-motion';

const EASING = Easing.bezier(EASE[0], EASE[1], EASE[2], EASE[3]);

export interface ToastAction {
  label: string;
  onPress: () => void;
}

export type ToastTone = 'success' | 'info' | 'warning' | 'error';

export interface ToastOptions {
  actions?: ToastAction[];
  durationMs?: number;
  tone?: ToastTone;
}

interface ToastState {
  message: string;
  actions: ToastAction[];
  tone: ToastTone;
}

interface ToastShow {
  (message: string, options?: ToastOptions): void;
  (
    message: string,
    actions?: ToastAction[],
    durationMs?: number,
    tone?: ToastTone,
  ): void;
}

interface ToastContextValue {
  show: ToastShow;
}

const ToastContext = createContext<ToastContextValue>({ show: () => {} });

export function useToast(): ToastContextValue {
  return useContext(ToastContext);
}

const TONE_ICON: Record<ToastTone, IconName> = {
  success: 'check',
  info: 'spark',
  warning: 'alert',
  error: 'close',
};

const TONE_COLOR: Record<ToastTone, string> = {
  success: Colors.dark.income,
  info: Colors.dark.primary,
  warning: Colors.dark.warning,
  error: Colors.dark.expense,
};

/** A compact status surface with an optional, time-sensitive action. */
export function ToastProvider({ children }: { children: React.ReactNode }) {
  const theme = useTheme();
  const reducedMotion = useReducedMotion();
  const insets = useSafeAreaInsets();
  const [toast, setToast] = useState<ToastState | null>(null);
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);

  const show = useCallback((
    message: string,
    actionsOrOptions: ToastAction[] | ToastOptions = [],
    legacyDurationMs: number = 6000,
    legacyTone: ToastTone = 'info',
  ) => {
    const options = Array.isArray(actionsOrOptions)
      ? { actions: actionsOrOptions, durationMs: legacyDurationMs, tone: legacyTone }
      : actionsOrOptions;
    const actions = options.actions ?? [];
    const durationMs = options.durationMs ?? 6000;
    const tone = options.tone ?? 'info';

    if (timer.current) clearTimeout(timer.current);
    setToast({ message, actions, tone });
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
  }, []) as ToastShow;

  const dismiss = useCallback(() => {
    if (timer.current) clearTimeout(timer.current);
    setToast(null);
  }, []);

  return (
    <ToastContext.Provider value={{ show }}>
      {children}
      {toast && (
        <Animated.View
          entering={reducedMotion ? undefined : SlideInDown.duration(Motion.sheet).easing(EASING)}
          exiting={reducedMotion ? undefined : FadeOutDown.duration(200)}
          // Clears the floating tab bar rather than sitting under it.
          style={[styles.wrap, { bottom: Math.max(insets.bottom, Spacing.two) + 84 }]}
          accessibilityLiveRegion={toast.tone === 'error' ? 'assertive' : 'polite'}
          pointerEvents="box-none">
          {/* The fill is a near-black by design, which in the dark theme is
              also the page. Floating over a list it read as loose text lying on
              top of a row rather than a surface above it, so it carries its own
              hairline and a heavier shadow — the two things that say "this is
              in front" when the fill cannot. */}
          <View
            style={[
              styles.toast,
              { borderColor: theme.cardBorderStrong, shadowColor: '#000' },
            ]}>
            <Icon
              name={TONE_ICON[toast.tone]}
              size={16}
              color={TONE_COLOR[toast.tone]}
              strokeWidth={2.1}
            />
            <ThemedText type="small" style={styles.message} numberOfLines={2}>
              {toast.message}
            </ThemedText>
            {toast.actions.map((a) => (
              <Pressable
                key={a.label}
                accessibilityRole="button"
                style={styles.action}
                onPress={() => {
                  dismiss();
                  a.onPress();
                }}
                hitSlop={4}>
                <ThemedText type="nano" style={{ color: Colors.dark.primary }}>
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
    borderWidth: StyleSheet.hairlineWidth,
    paddingHorizontal: Spacing.three,
    paddingVertical: Spacing.three - 2,
    shadowOpacity: 0.4,
    shadowRadius: 18,
    shadowOffset: { width: 0, height: 10 },
    elevation: 12,
  },
  message: {
    flexShrink: 1,
    color: '#F2EFE8',
  },
  action: {
    minWidth: 44,
    minHeight: 44,
    alignItems: 'center',
    justifyContent: 'center',
  },
});
