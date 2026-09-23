import { Image } from 'expo-image';
import React, { useEffect, useState } from 'react';
import { Platform, StyleSheet, View } from 'react-native';

import { CategoryAvatar } from '@/components/ui/category-avatar';
import { merchantLogoFor } from '@/components/ui/merchant-logo-assets';
import { Radius } from '@/constants/theme';
import { useTheme } from '@/hooks/use-theme';
import { useColorScheme } from '@/hooks/use-color-scheme';
import { resolveRemoteMerchantLogo, type RemoteMerchantLogo } from '@/lib/merchant-logo-resolver';
import type { CategoryId } from '@/lib/types';
import { usePrivateMode } from '@/lib/store';

interface MerchantAvatarProps {
  title: string;
  category: CategoryId;
  size?: number;
}

/** Bundled artwork first; only locally verified identities may use CDN artwork. */
function MerchantAvatarInner({ title, category, size = 34 }: MerchantAvatarProps) {
  const privateMode = usePrivateMode();
  const allowRemote = !privateMode; // Narrow context: unrelated ledger changes do not rerender every visible row.
  const bundled = merchantLogoFor(title);
  const [remote, setRemote] = useState<RemoteMerchantLogo | null>(null);

  useEffect(() => {
    let alive = true;
    setRemote(null);
    if (!allowRemote || bundled) return () => { alive = false; };
    // Remote logo enrichment is presentation-only. Defer cache/network work
    // until the JS thread is idle so virtualized rows never compete with
    // scrolling, navigation, or opening a transaction.
    const idle = requestIdleCallback(() => {
      void resolveRemoteMerchantLogo(title).then(value => {
        if (alive) setRemote(value);
      });
    });
    return () => {
      alive = false;
      cancelIdleCallback(idle);
    };
  }, [title, category, bundled, allowRemote]);

  if (bundled) {
    return <LogoTile key={bundled.id} id={bundled.id} source={bundled.source} tint={bundled.tint} category={category} size={size} />;
  }
  if (allowRemote && remote) {
    return <LogoTile key={remote.id} id={remote.id} source={{ uri: remote.logoUrl }} category={category} size={size} />;
  }
  return <CategoryAvatar category={category} size={size} />;
}

export const MerchantAvatar = React.memo(MerchantAvatarInner);

function LogoTile({ id, source, tint, category, size }: {
  id: string;
  source: number | { uri: string };
  tint?: 'theme' | 'dark';
  category: CategoryId;
  size: number;
}) {
  const theme = useTheme();
  const dark = useColorScheme() === 'dark';
  const [failed, setFailed] = useState(false);
  if (failed) return <CategoryAvatar category={category} size={size} />;

  return (
    <View
      testID={`merchant-logo-${id.replace(/[^a-z0-9:-]/gi, '-')}`}
      pointerEvents="none"
      accessibilityElementsHidden
      importantForAccessibility="no-hide-descendants"
      style={[
        styles.tile,
        { width: size, height: size, borderRadius: size >= 40 ? Radius.control : Radius.tile },
      ]}>
      <Image
        source={source}
        contentFit="contain"
        // Remote logos are decorative and can have very high cardinality on a
        // long ledger. On Android keep the durable disk cache but do not grow
        // Expo Image's process-wide decoded-image memory cache as the user
        // scrolls through new merchants. Bundled assets stay memory-backed.
        cachePolicy={Platform.OS === 'android' && typeof source !== 'number' ? 'disk' : 'memory-disk'}
        recyclingKey={id}
        transition={0}
        tintColor={tint === 'theme' || (tint === 'dark' && dark) ? theme.text : undefined}
        accessible={false}
        onError={() => setFailed(true)}
        style={{ width: size, height: size }}
      />
    </View>
  );
}

const styles = StyleSheet.create({
  tile: {
    alignItems: 'center',
    justifyContent: 'center',
    overflow: 'hidden',
  },
});
