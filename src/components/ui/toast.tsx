import React, { createContext, useCallback, useContext, useRef, useState } from 'react';
import { Pressable, StyleSheet, View } from 'react-native';
import Animated, { Easing, FadeOutDown, SlideInDown } from 'react-native-reanimated';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { ThemedText } from '@/components/themed-text';
import { Radius, Spacing } from '@/constants/theme';
import { useTheme } from '@/hooks/use-theme';

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

export function ToastProvider({ children }: { children: React.ReactNode }) {
  const theme = useTheme();
  const insets = useSafeAreaInsets();
  const [toast, setToast] = useState<ToastState | null>(null);
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);

  const show = useCallback((message: string, actions: ToastAction[] = [], durationMs = 6000) => {
    if (timer.current) clearTimeout(timer.current);
    setToast({ message, actions });
    timer.current = setTimeout(() => setToast(null), durationMs);
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
          entering={SlideInDown.duration(320).easing(Easing.out(Easing.exp))}
          exiting={FadeOutDown.duration(200)}
          style={[styles.wrap, { bottom: Math.max(insets.bottom, Spacing.two) + 96 }]}
          pointerEvents="box-none">
          <View
            style={[
              styles.toast,
              { backgroundColor: theme.backgroundSelected, borderColor: theme.cardBorder },
            ]}>
            <ThemedText type="small" style={styles.message} numberOfLines={2}>
              {toast.message}
            </ThemedText>
            {toast.actions.map((a) => (
              <Pressable
                key={a.label}
                onPress={() => {
                  dismiss();
                  a.onPress();
                }}
                hitSlop={6}>
                <ThemedText type="smallBold" style={{ color: theme.primary }}>
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
    gap: Spacing.three,
    maxWidth: 480,
    marginHorizontal: Spacing.three,
    borderRadius: Radius.md + 2,
    borderWidth: StyleSheet.hairlineWidth,
    paddingHorizontal: Spacing.three,
    paddingVertical: Spacing.two + 4,
    shadowColor: '#000',
    shadowOpacity: 0.3,
    shadowRadius: 14,
    shadowOffset: { width: 0, height: 6 },
    elevation: 10,
  },
  message: {
    flexShrink: 1,
  },
});
