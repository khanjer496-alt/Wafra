import { Platform, Pressable, StyleSheet, type ViewStyle } from 'react-native';

import { Icon, type IconName } from '@/components/ui/icon';
import { Radius } from '@/constants/theme';
import { useTheme } from '@/hooks/use-theme';
import { tapped } from '@/lib/haptics';

export type ActionIconButtonProps = {
  icon: IconName;
  label: string;
  onPress: () => void;
  variant?: 'plain' | 'bordered' | 'filled' | 'danger';
  disabled?: boolean;
};

export function ActionIconButton({
  icon,
  label,
  onPress,
  variant = 'bordered',
  disabled,
}: ActionIconButtonProps) {
  const theme = useTheme();
  const surface: ViewStyle =
    variant === 'filled'
      ? { backgroundColor: theme.primary, borderColor: theme.primary }
      : variant === 'danger'
        ? { backgroundColor: theme.expenseSoftBg, borderColor: theme.expenseSoftBorder }
        : variant === 'plain'
          ? { backgroundColor: 'transparent', borderColor: 'transparent' }
          : { backgroundColor: theme.backgroundElement, borderColor: theme.controlBorder };
  const color =
    variant === 'filled'
      ? theme.onPrimary
      : variant === 'danger'
        ? theme.expense
        : theme.textSecondary;

  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={label}
      accessibilityState={{ disabled: !!disabled }}
      disabled={disabled}
      onPress={() => {
        tapped();
        onPress();
      }}
      pressRetentionOffset={16}
      style={({ pressed }) => [
        styles.frame,
        Platform.OS === 'android' && styles.androidFrame,
        surface,
        { opacity: disabled ? 0.4 : pressed ? 0.72 : 1 },
      ]}>
      <Icon name={icon} size={17} color={color} />
    </Pressable>
  );
}

const styles = StyleSheet.create({
  frame: {
    minWidth: 44,
    minHeight: 44,
    alignItems: 'center',
    justifyContent: 'center',
    borderRadius: Radius.full,
    borderWidth: 1,
  },
  androidFrame: { minWidth: 48, minHeight: 48 },
});
