import React from 'react';
import { StyleSheet, View } from 'react-native';

import { Icon } from '@/components/ui/icon';
import { Radius } from '@/constants/theme';
import { useTheme } from '@/hooks/use-theme';
import { getCategory } from '@/lib/categories';
import type { CategoryId } from '@/lib/types';

interface CategoryAvatarProps {
  category: CategoryId;
  size?: number;
}

/**
 * The category glyph on a quiet rounded tile.
 *
 * A square with a small radius rather than a circle: rows then line up on a
 * common left edge, and the tile stops competing with the merchant name beside
 * it. Income is the one exception that earns a tint, because "money arrived" is
 * meaning rather than identity.
 */
export function CategoryAvatar({ category, size = 34 }: CategoryAvatarProps) {
  const theme = useTheme();
  const meta = getCategory(category);
  const income = meta.type === 'income';

  return (
    <View
      style={[
        styles.tile,
        {
          width: size,
          height: size,
          borderRadius: size >= 40 ? Radius.control : Radius.tile,
          backgroundColor: income ? theme.primarySoft : theme.backgroundSelected,
        },
      ]}>
      <Icon
        name={meta.icon}
        size={Math.round(size * 0.5)}
        color={income ? theme.primary : theme.textSecondary}
        strokeWidth={1.8}
      />
    </View>
  );
}

const styles = StyleSheet.create({
  tile: {
    alignItems: 'center',
    justifyContent: 'center',
  },
});
