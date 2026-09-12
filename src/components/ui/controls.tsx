import React from 'react';
import { Pressable, StyleSheet, type StyleProp, type ViewStyle } from 'react-native';
import Animated, {
  useAnimatedStyle,
  useSharedValue,
  withTiming,
  Easing,
} from 'react-native-reanimated';

import { ThemedText } from '@/components/themed-text';
import { ActionIconButton } from '@/components/ui/action-icon-button';
import { Icon, type IconName } from '@/components/ui/icon';
import {
  SegmentedControl,
  type Segment as CanonicalSegment,
} from '@/components/ui/segmented-control';
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
  /** Shares width in a row of actions. Omit in columns or standalone actions. */
  inline?: boolean;
  /** Overrides the label colour on surfaces that ignore the OS theme. */
  labelColor?: string;
  /** Let long/localized labels grow the control instead of clipping to one line. */
  wrapLabel?: boolean;
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
  wrapLabel = true,
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
      <ThemedText
        type="smallBold"
        numberOfLines={wrapLabel ? undefined : 1}
        style={[styles.buttonLabel, { color: labelColor }]}>
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
        type="meta"
        style={{ color: active ? theme.background : theme.text }}>
        {label}
      </ThemedText>
    </Pressable>
  );
}

/* ── Segmented control ───────────────────────────────────────────────── */

export type { Segment } from '@/components/ui/segmented-control';

/** @deprecated Import SegmentedControl from ui/segmented-control. */
export function Segmented<T extends string>({
  segments,
  value,
  onChange,
  label,
}: {
  segments: CanonicalSegment<T>[];
  value: T;
  onChange: (next: T) => void;
  label: string;
}) {
  return <SegmentedControl segments={segments} value={value} onChange={onChange} label={label} />;
}

/* ── Icon button ─────────────────────────────────────────────────────── */

/** @deprecated Import ActionIconButton from ui/action-icon-button. */
export function IconButton({
  icon,
  onPress,
  label,
}: {
  icon: IconName;
  onPress: () => void;
  label: string;
}) {
  return <ActionIconButton icon={icon} label={label} onPress={onPress} />;
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
  buttonLabel: { flexShrink: 1, textAlign: 'center' },
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
});
