import React from 'react';
import { StyleSheet, View } from 'react-native';

import { Icon } from '@/components/ui/icon';
import { getCategory } from '@/lib/categories';
import type { CategoryId } from '@/lib/types';

interface CategoryAvatarProps {
  category: CategoryId;
  size?: number;
}

/** Category glyph on a tinted circle. */
export function CategoryAvatar({ category, size = 44 }: CategoryAvatarProps) {
  const meta = getCategory(category);
  return (
    <View
      style={[
        styles.circle,
        {
          width: size,
          height: size,
          borderRadius: size / 2,
          backgroundColor: `${meta.color}22`,
        },
      ]}>
      <Icon name={meta.icon} size={size * 0.5} color={meta.color} strokeWidth={1.8} />
    </View>
  );
}

const styles = StyleSheet.create({
  circle: {
    alignItems: 'center',
    justifyContent: 'center',
  },
});
