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
  const [loadedLogo, setLoadedLogo] = useState<string | null>(null);

  useEffect(() => {
    let alive = true;
    setLogo(null);
    setFailed(false);
    setLoadedLogo(null);
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

  const credit = account.cardType === 'credit';
  const fallbackColor = credit ? theme.expenseSoftBg : theme.primarySoft;
  const fallback = <Icon
    name={account.kind === 'card' || account.cardType ? 'wallet' : 'bank'}
    size={Math.round(size * 0.5)}
    color={credit ? theme.expense : theme.primary}
  />;

  if (!allowRemote || !logo || failed) {
    return <View style={[
      styles.tile,
      {
        width: size,
        height: size,
        borderRadius: Radius.tile,
        backgroundColor: fallbackColor,
      },
    ]}>
      {fallback}
    </View>;
  }

  const logoIdentity = `${account.bankName}:${logo.id}:${logo.logoUrl}`;
  const imageReady = loadedLogo === logoIdentity;
  return <View
    pointerEvents="none"
    accessibilityElementsHidden
    importantForAccessibility="no-hide-descendants"
    testID={`bank-logo-${logo.domain.replace(/[^a-z0-9.-]/gi, '-')}`}
    style={[styles.tile, { width: size, height: size, borderRadius: size >= 40 ? Radius.control : Radius.tile,
      backgroundColor: imageReady ? '#FFFFFF' : fallbackColor }]}>
    {/* Resolution supplies a URL, not decoded artwork. Keep identity visible
        while artwork loads instead of showing an empty white tile. */}
    {!imageReady && fallback}
    <Image
      key={logoIdentity}
      source={{ uri: logo.logoUrl }}
      contentFit="contain"
      cachePolicy={Platform.OS === 'android' ? 'disk' : 'memory-disk'}
      recyclingKey={logo.id}
      transition={0}
      accessible={false}
      onLoad={() => setLoadedLogo(logoIdentity)}
      onError={() => setFailed(true)}
      style={{ position: 'absolute', top: 4, left: 4,
        width: Math.max(1, size - 8), height: Math.max(1, size - 8), opacity: imageReady ? 1 : 0 }}
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
