import { Image } from 'expo-image';
import React, { useEffect, useState } from 'react';
import { Platform, StyleSheet, View } from 'react-native';

import { Icon } from '@/components/ui/icon';
import { Radius } from '@/constants/theme';
import { useTheme } from '@/hooks/use-theme';
import { resolveBankLogo, type ResolvedBankLogo } from '@/lib/bank-logo-resolver';
import type { Account } from '@/lib/types';
import { usePrivateMode } from '@/lib/store';

function BankAvatarInner({ account, size = 36 }: { account: Account; size?: number }) {
  const theme = useTheme();
  const privateMode = usePrivateMode();
  const allowRemote = !privateMode; // Narrow context: unrelated ledger changes do not rerender every visible row.
  const [logo, setLogo] = useState<ResolvedBankLogo | null>(null);
  const [failed, setFailed] = useState(false);

  useEffect(() => {
    let alive = true;
    setLogo(null);
    setFailed(false);
    if (!allowRemote || !account.bankName) return () => { alive = false; };
    // Wallet can render many discovered accounts at once. Artwork is optional;
    // defer its cache/network work until interaction has a chance to paint.
    const idle = requestIdleCallback(() => {
      void resolveBankLogo(account.bankName).then(value => {
        if (alive) setLogo(value);
      });
    });
    return () => {
      alive = false;
      cancelIdleCallback(idle);
    };
  }, [account.bankName, allowRemote]);

  if (!allowRemote || !logo || failed) {
    const credit = account.cardType === 'credit';
    return <View style={[
      styles.tile,
      {
        width: size,
        height: size,
        borderRadius: Radius.tile,
        backgroundColor: credit ? theme.expenseSoftBg : theme.primarySoft,
      },
    ]}>
      <Icon
        name={account.kind === 'card' || account.cardType ? 'wallet' : 'bank'}
        size={Math.round(size * 0.5)}
        color={credit ? theme.expense : theme.primary}
      />
    </View>;
  }

  return <View
    pointerEvents="none"
    accessibilityElementsHidden
    importantForAccessibility="no-hide-descendants"
    testID={`bank-logo-${logo.domain.replace(/[^a-z0-9.-]/gi, '-')}`}
    style={[styles.tile, { width: size, height: size, borderRadius: size >= 40 ? Radius.control : Radius.tile }]}>
    <Image
      source={{ uri: logo.logoUrl }}
      contentFit="contain"
      cachePolicy={Platform.OS === 'android' ? 'disk' : 'memory-disk'}
      recyclingKey={logo.id}
      transition={0}
      accessible={false}
      onError={() => setFailed(true)}
      style={{ width: Math.max(1, size - 8), height: Math.max(1, size - 8) }}
    />
  </View>;
}

export const BankAvatar = React.memo(BankAvatarInner);

const styles = StyleSheet.create({
  tile: {
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: '#FFFFFF',
  },
});
