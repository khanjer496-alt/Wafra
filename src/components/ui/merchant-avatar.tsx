import React from 'react';

import { MonogramAvatar } from '@/components/ui/monogram-avatar';
import { useBand } from '@/hooks/use-band';
import type { CategoryId } from '@/lib/types';

interface MerchantAvatarProps {
  title: string;
  category: CategoryId;
  size?: number;
  /** Kept for existing callers; monograms use the shared tile ground. */
  plate?: boolean;
}

/** Wafra 1.0 uses local letters on every platform, including upgraded installs. */
function MerchantAvatarInner({ title, size = 34 }: MerchantAvatarProps) {
  const ground = useBand('home').glyphGround;
  return <MonogramAvatar name={title} size={size} ground={ground} />;
}

export const MerchantAvatar = React.memo(MerchantAvatarInner);
