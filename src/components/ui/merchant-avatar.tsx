import { Image } from 'expo-image';
import React, { useState } from 'react';
import { StyleSheet, View } from 'react-native';

import { CategoryAvatar } from '@/components/ui/category-avatar';
import { merchantLogoFor } from '@/components/ui/merchant-logo-assets';
import { Radius } from '@/constants/theme';
import type { CategoryId } from '@/lib/types';

interface MerchantAvatarProps {
  title: string;
  category: CategoryId;
  size?: number;
}

/** Official bundled artwork. Unknown merchants keep their category glyph. */
export function MerchantAvatar({ title, category, size = 34 }: MerchantAvatarProps) {
  const logo = merchantLogoFor(title);
  if (!logo) return <CategoryAvatar category={category} size={size} />;
  // Remount on identity change so an earlier failed image cannot hide another
  // merchant's logo when a list reuses this row.
  return <LogoTile key={logo.id} logo={logo} category={category} size={size} />;
}

function LogoTile({ logo, category, size }: {
  logo: NonNullable<ReturnType<typeof merchantLogoFor>>;
  category: CategoryId;
  size: number;
}) {
  const [failed, setFailed] = useState(false);
  if (failed) return <CategoryAvatar category={category} size={size} />;

  return (
    <View
      accessibilityElementsHidden
      importantForAccessibility="no-hide-descendants"
      style={[
        styles.tile,
        { width: size, height: size, borderRadius: size >= 40 ? Radius.control : Radius.tile },
      ]}>
      <Image
        source={logo.source}
        contentFit="contain"
        accessible={false}
        onError={() => setFailed(true)}
        style={{ width: size - 8, height: size - 8 }}
      />
    </View>
  );
}

const styles = StyleSheet.create({
  tile: {
    alignItems: 'center',
    justifyContent: 'center',
    // Original brand colours on a neutral plate in either theme. Never tint,
    // invert, or remotely request artwork using a user's transaction title.
    backgroundColor: '#FFFFFF',
  },
});
