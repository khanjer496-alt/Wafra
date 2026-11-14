import React from 'react';

import { MonogramAvatar } from '@/components/ui/monogram-avatar';
import { BandPalettes } from '@/constants/theme';
import { useColorScheme } from '@/hooks/use-color-scheme';
import { useTheme } from '@/hooks/use-theme';
import type { Account } from '@/lib/types';

function BankAvatarInner({ account, size = 36 }: { account: Account; size?: number }) {
  const theme = useTheme();
  const dark = useColorScheme() === 'dark';
  const card = account.kind === 'card' || account.cardType !== undefined;
  const slate = BandPalettes[dark ? 'dark' : 'light'].accounts;
  return <MonogramAvatar name={account.bankName || account.name} size={size}
    ground={card ? slate.glyphGround : theme.primarySoft} color={card ? slate.tint : theme.primary} />;
}

export const BankAvatar = React.memo(BankAvatarInner);
