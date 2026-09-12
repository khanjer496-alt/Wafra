import { Image } from 'expo-image';
import React, { useEffect, useState } from 'react';
import { StyleSheet, View } from 'react-native';

import { CategoryAvatar } from '@/components/ui/category-avatar';
import { merchantLogoFor } from '@/components/ui/merchant-logo-assets';
import { Radius } from '@/constants/theme';
import { resolveRemoteMerchantLogo, type RemoteMerchantLogo } from '@/lib/merchant-logo-resolver';
import type { CategoryId } from '@/lib/types';
import { useStore } from '@/lib/store';

interface MerchantAvatarProps {
  title: string;
  category: CategoryId;
  size?: number;
}

/** Bundled artwork first; only locally verified identities may use CDN artwork. */
export function MerchantAvatar({ title, category, size = 34 }: MerchantAvatarProps) {
  const { state } = useStore();
  const allowRemote = !state.privateMode; // Preserve the existing local-only opt-out.
  const bundled = merchantLogoFor(title);
  const [remote, setRemote] = useState<RemoteMerchantLogo | null>(null);

  useEffect(() => {
    let alive = true;
    setRemote(null);
    // `other` frequently contains user-created biller names and local one-off
    // merchants. Keep the local category fallback unless reviewed bundled
    // artwork already established an identity above this guard.
    if (!allowRemote || bundled || category === 'other') return () => { alive = false; };
    void resolveRemoteMerchantLogo(title).then(value => {
      if (alive) setRemote(value);
    });
    return () => { alive = false; };
  }, [title, category, bundled, allowRemote]);

  if (bundled) {
    return <LogoTile key={bundled.id} id={bundled.id} source={bundled.source} category={category} size={size} />;
  }
  if (allowRemote && remote) {
    return <LogoTile key={remote.id} id={remote.id} source={{ uri: remote.logoUrl }} category={category} size={size} />;
  }
  return <CategoryAvatar category={category} size={size} />;
}

function LogoTile({ id, source, category, size }: {
  id: string;
  source: number | { uri: string };
  category: CategoryId;
  size: number;
}) {
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
        cachePolicy="memory-disk"
        recyclingKey={id}
        transition={0}
        accessible={false}
        onError={() => setFailed(true)}
        style={{ width: Math.max(1, size - 8), height: Math.max(1, size - 8) }}
      />
    </View>
  );
}

const styles = StyleSheet.create({
  tile: {
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: '#FFFFFF',
  },
});
