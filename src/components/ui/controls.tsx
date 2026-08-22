import React from 'react';
import { Pressable, StyleSheet, View, type StyleProp, type ViewStyle } from 'react-native';
import Animated, {
  useAnimatedStyle,
  useSharedValue,
  withTiming,
  Easing,
} from 'react-native-reanimated';

import { ThemedText } from '@/components/themed-text';
import { Icon, type IconName } from '@/components/ui/icon';
import { EASE, Motion, Radius, Spacing } from '@/constants/theme';
import { useReducedMotion } from '@/hooks/use-reduced-motion';
import { useTheme } from '@/hooks/use-theme';
import { tapped } from '@/lib/haptics';

const EASING = Easing.bezier(EASE[0], EASE[1], EASE[2], EASE[3]);

/* ── Buttons ─────────────────────────────────────────────────────────── */

type ButtonVariant = 'filled' | 'outline' | 'ghost' | 'danger';

interface ButtonProps {
  label: string;
  onPress?: () => void;
  variant?: ButtonVariant;
  icon?: IconName;
  disabled?: boolean;
  /** Sits inline in a row of actions instead of filling the width. */
  inline?: boolean;
  /** Overrides the label colour on surfaces that ignore the OS theme. */
  labelColor?: string;
  style?: StyleProp<ViewStyle>;
}

/** The shared 48dp action. Sentence-case sans keeps controls human and calm. */
export function Button({
  label,
  onPress,
  variant = 'filled',
  icon,
  disabled,
  inline,
  labelColor: labelColorOverride,
  style,
}: ButtonProps) {
  const theme = useTheme();

  const surface: ViewStyle =
    variant === 'filled'
      ? { backgroundColor: theme.primary }
      : variant === 'outline'
        ? { borderWidth: 1, borderColor: theme.controlBorder }
        : variant === 'danger'
          ? { borderWidth: 1, borderColor: theme.expenseSoftBorder, backgroundColor: theme.expenseSoftBg }
          : {};

  const labelColor =
    labelColorOverride ??
    (variant === 'filled' ? theme.onPrimary : variant === 'danger' ? theme.expense : theme.text);

  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={label}
      accessibilityState={{ disabled: !!disabled }}
      disabled={disabled}
      onPress={
        onPress
          ? () => {
              tapped();
              onPress();
            }
          : undefined
      }
      style={({ pressed }) => [
        styles.button,
        inline ? styles.buttonInline : styles.buttonBlock,
        surface,
        { opacity: disabled ? 0.4 : 1, transform: [{ scale: pressed ? 0.985 : 1 }] },
        style,
      ]}>
      {icon && <Icon name={icon} size={15} color={labelColor} />}
      <ThemedText type="smallBold" numberOfLines={1} style={{ color: labelColor }}>
        {label}
      </ThemedText>
    </Pressable>
  );
}

/* ── Switch ──────────────────────────────────────────────────────────── */

/** 44×26 track, 20px thumb, 3px inset — the size in the design, not the OS one. */
export function Toggle({
  value,
  onChange,
  label,
}: {
  value: boolean;
  onChange: (next: boolean) => void;
  label?: string;
}) {
  const theme = useTheme();
  const reducedMotion = useReducedMotion();
  const offset = useSharedValue(value ? 18 : 0);

  React.useEffect(() => {
    const next = value ? 18 : 0;
    offset.value = reducedMotion
      ? next
      : withTiming(next, { duration: Motion.rowPress, easing: EASING });
  }, [value, offset, reducedMotion]);

  const thumb = useAnimatedStyle(() => ({ transform: [{ translateX: offset.value }] }));

  return (
    <Pressable
      accessibilityRole="switch"
      accessibilityLabel={label}
      accessibilityState={{ checked: value }}
      hitSlop={10}
      onPress={() => {
        tapped();
        onChange(!value);
      }}
      style={[
        styles.track,
        {
          backgroundColor: value ? theme.primary : theme.track,
          borderColor: value ? theme.primary : theme.controlBorder,
        },
      ]}>
      <Animated.View style={[styles.thumb, { backgroundColor: value ? '#FFFFFF' : theme.backgroundElement }, thumb]} />
    </Pressable>
  );
}

/* ── Chips ───────────────────────────────────────────────────────────── */

/** Pill used for filters and quick-picks. Active = solid ink. */
export function Chip({
  label,
  active,
  onPress,
  highlighted,
  leading,
}: {
  label: string;
  active?: boolean;
  onPress?: () => void;
  /** Draws attention without claiming selection (the suggested-limit chip). */
  highlighted?: boolean;
  leading?: React.ReactNode;
}) {
  const theme = useTheme();
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={label}
      accessibilityState={{ selected: !!active }}
      onPress={
        onPress
          ? () => {
              tapped();
              onPress();
            }
          : undefined
      }
      style={({ pressed }) => [
        styles.chip,
        {
          backgroundColor: active
            ? theme.text
            : highlighted
              ? theme.primarySoft
              : 'transparent',
          borderColor: active
            ? theme.text
            : highlighted
              ? theme.primaryBorder
              : theme.controlBorder,
          transform: [{ scale: pressed ? 0.985 : 1 }],
        },
      ]}>
      {leading}
      <ThemedText
        type="nano"
        style={{ color: active ? theme.background : theme.text }}>
        {label}
      </ThemedText>
    </Pressable>
  );
}

/* ── Segmented control ───────────────────────────────────────────────── */

export interface Segment<T extends string> {
  value: T;
  label: string;
}

export function Segmented<T extends string>({
  segments,
  value,
  onChange,
}: {
  segments: Segment<T>[];
  value: T;
  onChange: (next: T) => void;
}) {
  const theme = useTheme();
  return (
    <View style={[styles.segTrack, { backgroundColor: theme.backgroundSelected }]}>
      {segments.map((s) => {
        const active = s.value === value;
        return (
          <Pressable
            key={s.value}
            accessibilityRole="tab"
            accessibilityLabel={s.label}
            accessibilityState={{ selected: active }}
            onPress={() => {
              if (s.value !== value) tapped();
              onChange(s.value);
            }}
            style={[
              styles.segment,
              active && {
                backgroundColor: theme.backgroundElement,
                shadowColor: '#16130F',
                shadowOpacity: 0.08,
                shadowRadius: 2,
                shadowOffset: { width: 0, height: 1 },
                elevation: 1,
              },
            ]}>
            <ThemedText
              type="nano"
              style={{ fontSize: 11.5, color: active ? theme.text : theme.textTertiary }}>
              {s.label}
            </ThemedText>
          </Pressable>
        );
      })}
    </View>
  );
}

/* ── Icon button ─────────────────────────────────────────────────────── */

export function IconButton({
  icon,
  onPress,
  label,
  size = 34,
}: {
  icon: IconName;
  onPress?: () => void;
  label: string;
  size?: number;
}) {
  const theme = useTheme();
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={label}
      hitSlop={8}
      onPress={
        onPress
          ? () => {
              tapped();
              onPress();
            }
          : undefined
      }
      style={({ pressed }) => [
        styles.iconButton,
        {
          width: size,
          height: size,
          borderColor: theme.controlBorder,
          backgroundColor: pressed ? theme.backgroundSelected : 'transparent',
        },
      ]}>
      <Icon name={icon} size={16} color={theme.text} />
    </Pressable>
  );
}

const styles = StyleSheet.create({
  button: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: Spacing.two,
    borderRadius: Radius.control,
    minHeight: 48,
  },
  buttonBlock: {
    paddingHorizontal: Spacing.four,
    paddingVertical: Spacing.three,
  },
  buttonInline: {
    flex: 1,
    paddingHorizontal: Spacing.three,
    paddingVertical: Spacing.three,
  },
  track: {
    width: 44,
    height: 26,
    borderRadius: Radius.full,
    borderWidth: StyleSheet.hairlineWidth,
    padding: 3,
    justifyContent: 'center',
  },
  thumb: {
    width: 20,
    height: 20,
    borderRadius: 10,
  },
  chip: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: Spacing.two - 2,
    minHeight: 44,
    paddingHorizontal: Spacing.three - 2,
    borderRadius: Radius.full,
    borderWidth: 1,
  },
  segTrack: {
    flexDirection: 'row',
    padding: 3,
    borderRadius: 11,
    gap: 3,
  },
  segment: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
    minHeight: 44,
    paddingVertical: Spacing.two + 2,
    borderRadius: 9,
  },
  iconButton: {
    alignItems: 'center',
    justifyContent: 'center',
    borderRadius: Radius.tile,
    borderWidth: 1,
  },
});
