import React from 'react';

import type { PlatformSymbolProps } from '@/components/ui/platform-symbol.types';

/** Android and web use Wafra's bundled SVG glyphs without loading icon fonts. */
export function PlatformSymbol({ fallback }: PlatformSymbolProps) {
  return <React.Fragment>{fallback}</React.Fragment>;
}
