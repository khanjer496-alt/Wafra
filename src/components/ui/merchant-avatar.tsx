import React from 'react';
import { StyleSheet, View } from 'react-native';

import { ThemedText } from '@/components/themed-text';
import { CategoryAvatar } from '@/components/ui/category-avatar';
import { brandMarkFor } from '@/lib/brand-marks';
import type { CategoryId } from '@/lib/types';

interface MerchantAvatarProps {
  title: string;
  category: CategoryId;
  size?: number;
}

/**
 * Badge for a transaction row: the merchant's own mark when the brand is
 * known, otherwise the category glyph.
 *
 * Both are drawn locally. The favicon version of this fetched every merchant
 * name — read out of a bank SMS — from a third-party logo host, which sent
 * spending history off the device one row at a time and contradicted the
 * reason this app parses SMS on-device at all. Bundled marks work offline, on
 * first launch, and leak nothing.
 *
 * The circle is shared with the category fallback so a list of mixed known
 * and unknown merchants still reads as one column.
 */
export function MerchantAvatar({ title, category, size = 44 }: MerchantAvatarProps) {
  const brand = brandMarkFor(title);
  if (!brand) return <CategoryAvatar category={category} size={size} />;

  // Longer marks step down so "rta" and "n" sit at the same optical weight.
  const scale = brand.mark.length <= 1 ? 0.46 : brand.mark.length === 2 ? 0.36 : 0.28;

  return (
    <View
      style={[
        styles.circle,
        {
          width: size,
          height: size,
          borderRadius: size / 2,
          backgroundColor: `${brand.color}22`,
        },
      ]}>
      <ThemedText
        style={{
          color: brand.color,
          fontSize: Math.round(size * scale),
          lineHeight: Math.round(size * scale * 1.15),
          fontWeight: '800',
          letterSpacing: brand.mark.length > 1 ? -0.2 : 0,
        }}>
        {brand.mark}
      </ThemedText>
    </View>
  );
}

const styles = StyleSheet.create({
  circle: {
    alignItems: 'center',
    justifyContent: 'center',
  },
});
