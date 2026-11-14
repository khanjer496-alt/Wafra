import React from 'react';
import { View } from 'react-native';

import { ThemedText } from '@/components/themed-text';
import { Radius } from '@/constants/theme';
import { useTheme } from '@/hooks/use-theme';

/** Decorative identity only: the adjacent row supplies the accessible name. */
export function MonogramAvatar({ name, size = 36, ground, color }: {
  name: string; size?: number; ground?: string; color?: string;
}) {
  const theme = useTheme();
  const initial = Array.from(name.trim())[0]?.toLocaleUpperCase() ?? '—';
  return <View testID="monogram-avatar" accessible={false} accessibilityElementsHidden
    importantForAccessibility="no-hide-descendants" pointerEvents="none"
    style={{ width: size, height: size, borderRadius: size >= 40 ? Radius.control : Radius.tile,
      alignItems: 'center', justifyContent: 'center', backgroundColor: ground ?? theme.primarySoft }}>
    <ThemedText allowFontScaling={false} style={{ color: color ?? theme.text,
      fontSize: Math.round(size * 0.46), lineHeight: Math.round(size * 0.65), fontWeight: '700' }}>{initial}</ThemedText>
  </View>;
}
