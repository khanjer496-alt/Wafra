import { Image } from 'expo-image';
import React, { useEffect, useState } from 'react';
import { Platform, StyleSheet, View } from 'react-native';

import { MonogramAvatar } from '@/components/ui/monogram-avatar';
import { Radius } from '@/constants/theme';
import { useBand } from '@/hooks/use-band';
import { useColorScheme } from '@/hooks/use-color-scheme';
import { useTheme } from '@/hooks/use-theme';
import { resolveRemoteMerchantLogo, type RemoteMerchantLogo } from '@/lib/merchant-logo-resolver';
import type { CategoryId } from '@/lib/types';
import { brandfetchImageSource } from '@/lib/verified-logo-identities';
import { useOnlineLogosAllowed } from '@/lib/store';

interface MerchantAvatarProps {
  title: string;
  category: CategoryId;
  size?: number;
  /**
   * Set on a dark band (the Spending band, Home's ink, a recap card): artwork
   * sits on a light plate, so a black logo (Apple, Zara, Uber) is not drawn
   * black on near-black.
   */
  plate?: boolean;
}

/** The light plate under artwork on a dark band, in both schemes. */
const LOGO_PLATE = '#F7F4EE';

/**
 * Online logos on every platform, on by default: only a cleaned merchant name
 * goes to Brandfetch. Local-only mode turns lookups off. A miss, an error or
 * no network leaves the letter in place.
 */
function MerchantAvatarInner({ title, size = 34, plate = false }: MerchantAvatarProps) {
  // False until the store has hydrated, and while local-only mode is on.
  const allowRemote = useOnlineLogosAllowed();
  // Keyed by title: a recycled row never shows the previous merchant's logo for a frame.
  const [remote, setRemote] = useState<{ title: string; logo: RemoteMerchantLogo } | null>(null);

  useEffect(() => {
    let alive = true;
    setRemote(null);
    if (!allowRemote) return () => { alive = false; };
    // Remote logo enrichment is presentation-only. Defer cache/network work
    // until the JS thread is idle so virtualized rows never compete with
    // scrolling, navigation, or opening a transaction.
    const idle = requestIdleCallback(() => {
      void resolveRemoteMerchantLogo(title).then(value => {
        if (alive) setRemote(value ? { title, logo: value } : null);
      });
    });
    return () => {
      alive = false;
      cancelIdleCallback(idle);
    };
  }, [title, allowRemote]);

  if (allowRemote && remote?.title === title) {
    return <LogoTile key={remote.logo.id} id={remote.logo.id} uri={remote.logo.logoUrl} title={title} size={size} plate={plate} />;
  }
  return <MerchantMonogram title={title} size={size} />;
}

export const MerchantAvatar = React.memo(MerchantAvatarInner);

function MerchantMonogram({ title, size }: { title: string; size: number }) {
  const ground = useBand('home').glyphGround;
  return <MonogramAvatar name={title} size={size} ground={ground} />;
}

function LogoTile({ id, uri, title, size, plate = false }: {
  plate?: boolean;
  id: string;
  uri: string;
  title: string;
  size: number;
}) {
  const theme = useTheme();
  const dark = useColorScheme() === 'dark';
  const [failed, setFailed] = useState(false);
  const [loaded, setLoaded] = useState(false);
  // A logo that cannot load (offline, CDN miss) shows the same letter as an unknown merchant.
  if (failed) return <MerchantMonogram title={title} size={size} />;

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
        // Off the plate, a hairline edge keeps a dark mark readable in dark mode, as on bank tiles.
        !plate && loaded && dark ? { borderWidth: StyleSheet.hairlineWidth, borderColor: theme.cardBorder } : null,
      ]}>
      {/* Resolution supplies a URL, not decoded artwork. Keep the letter
          visible while the image loads instead of showing an empty tile. */}
      {!loaded && <View style={StyleSheet.absoluteFill}><MerchantMonogram title={title} size={size} /></View>}
      <Image
        // Hotlinked from Brandfetch's CDN with the Referer its terms require.
        source={brandfetchImageSource(uri)}
        contentFit="contain"
        // Remote logos are decorative and can have very high cardinality on a
        // long ledger. On Android keep the durable disk cache but do not grow
        // Expo Image's process-wide decoded-image memory cache as the user
        // scrolls through new merchants.
        cachePolicy={Platform.OS === 'android' ? 'disk' : 'memory-disk'}
        recyclingKey={id}
        transition={0}
        accessible={false}
        onLoad={() => setLoaded(true)}
        onError={() => setFailed(true)}
        style={[
          plate ? { width: Math.round(size * 0.78), height: Math.round(size * 0.78) } : { width: size, height: size },
          { opacity: loaded ? 1 : 0 },
        ]}
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
