import { SymbolView } from 'expo-symbols';

import type { PlatformSymbolProps } from '@/components/ui/platform-symbol.types';

/** iOS upgrades the same semantic glyph to its native SF Symbol. */
export function PlatformSymbol({ name, fallback: _fallback, ...props }: PlatformSymbolProps) {
  return <SymbolView name={name} {...props} accessible={false} accessibilityElementsHidden
    importantForAccessibility="no-hide-descendants" />;
}
