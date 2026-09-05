import type React from 'react';
import type { SFSymbol } from 'expo-symbols';
import type { ColorValue, StyleProp, ViewStyle } from 'react-native';

export type PlatformSymbolProps = {
  name: SFSymbol;
  fallback: React.ReactNode;
  size: number;
  tintColor: ColorValue;
  weight: 'regular' | 'semibold';
  style?: StyleProp<ViewStyle>;
};
