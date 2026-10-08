import { Image } from 'expo-image';
import React, { useEffect, useState } from 'react';
import { Platform, StyleSheet, View } from 'react-native';

import { CategoryAvatar } from '@/components/ui/category-avatar';
import { merchantLogoFor } from '@/components/ui/merchant-logo-assets';
import { Radius } from '@/constants/theme';
import { useBand } from '@/hooks/use-band';
import { useTheme } from '@/hooks/use-theme';
import { useColorScheme } from '@/hooks/use-color-scheme';
import { resolveRemoteMerchantLogo, type RemoteMerchantLogo } from '@/lib/merchant-logo-resolver';
import type { CategoryId } from '@/lib/types';
import { usePrivateMode } from '@/lib/store';

interface MerchantAvatarProps {
  title: string;
  category: CategoryId;
  size?: number;
  /**
   * Set on a dark band (the Spending band, Home's ink, a recap card): artwork
   * sits on a light plate, so a black logo (Apple, Zara, Uber) or one tinted
   * to the sheet's text is not drawn black on near-black.
   */
  plate?: boolean;
}

/** The light plate under artwork on a dark band, in both schemes. */
const LOGO_PLATE = '#F7F4EE';

/** Bundled artwork first; only locally verified identities may use CDN artwork. */
function MerchantAvatarInner({ title, category, size = 34, plate = false }: MerchantAvatarProps) {
  const privateMode = usePrivateMode();
  const ground = useBand('home').glyphGround;
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
    return <LogoTile key={bundled.id} id={bundled.id} source={bundled.source} tint={bundled.tint} category={category} size={size} plate={plate} />;
  }
  if (allowRemote && remote) {
    return <LogoTile key={remote.id} id={remote.id} source={{ uri: remote.logoUrl }} category={category} size={size} plate={plate} />;
  }
  // No artwork: the category glyph on the shared glyph ground, so the row
  // keeps a tile like its neighbours with logos.
  return <CategoryAvatar category={category} size={size} ground={ground} />;
}

export const MerchantAvatar = React.memo(MerchantAvatarInner);

function LogoTile({ id, source, tint, category, size, plate = false }: {
  plate?: boolean;
  id: string;
  source: number | { uri: string };
  tint?: 'theme' | 'dark';
  category: CategoryId;
  size: number;
}) {
  const theme = useTheme();
  const dark = useColorScheme() === 'dark';
  const ground = useBand('home').glyphGround;
  const [failed, setFailed] = useState(false);
  if (failed) return <CategoryAvatar category={category} size={size} ground={ground} />;

  return (
    <View
      testID={`merchant-logo-${id.replace(/[^a-z0-9:-]/gi, '-')}`}
      pointerEvents="none"
      accessibilityElementsHidden
      importantForAccessibility="no-hide-descendants"
      style={[
        styles.tile,
        { width: size, height: size, borderRadius: size >= 40 ? Radius.control : Radius.tile },
        plate && { backgroundColor: LOGO_PLATE },
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
        // On the plate the artwork keeps its own (dark) colours: the plate is light in both schemes.
        tintColor={plate ? tint === 'theme' ? '#16130F' : undefined
          : tint === 'theme' || (tint === 'dark' && dark) ? theme.text : undefined}
        accessible={false}
        onError={() => setFailed(true)}
        style={plate ? { width: Math.round(size * 0.78), height: Math.round(size * 0.78) } : { width: size, height: size }}
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
