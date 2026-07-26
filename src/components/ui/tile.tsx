import React from 'react';
import { StyleSheet, View } from 'react-native';

import { Icon, type IconName } from '@/components/ui/icon';
import { Radius } from '@/constants/theme';
import { useTheme } from '@/hooks/use-theme';
import { getCategory } from '@/lib/categories';
import type { Account, CategoryId } from '@/lib/types';

interface TileProps {
  icon: IconName;
  size?: number;
  /** Defaults to `backgroundSelected`. */
  background?: string;
  /** Defaults to `textSecondary`. */
  tint?: string;
}

/** Rounded square holding a glyph. The one badge shape in the app. */
export function Tile({ icon, size = 34, background, tint }: TileProps) {
  const theme = useTheme();
  return (
    <View
      style={[
        styles.tile,
        {
          width: size,
          height: size,
          borderRadius: Radius.tile,
          backgroundColor: background ?? theme.backgroundSelected,
        },
      ]}>
      <Icon name={icon} size={Math.round(size * 0.5)} color={tint ?? theme.textSecondary} />
    </View>
  );
}

/**
 * Category identity: the glyph plus one neutral tint. Income is the single
 * exception — it gets the accent tint, because "money arrived" is meaning.
 */
export function CategoryTile({ category, size = 34 }: { category: CategoryId; size?: number }) {
  const theme = useTheme();
  const meta = getCategory(category);
  const income = meta.type === 'income';
  return (
    <Tile
      icon={meta.icon}
      size={size}
      background={income ? theme.primarySoft : theme.backgroundSelected}
      tint={income ? theme.primary : theme.textSecondary}
    />
  );
}

/** Account identity, tinted by kind: what you have, what you owe, what's cash. */
export function AccountTile({ account, size = 36 }: { account: Account; size?: number }) {
  const theme = useTheme();
  const credit = account.cardType === 'credit';
  if (account.kind === 'cash') {
    return <Tile icon="cash" size={size} />;
  }
  if (credit) {
    return (
      <Tile
        icon="wallet"
        size={size}
        background={theme.expenseSoftBg}
        tint={theme.expense}
      />
    );
  }
  return (
    <Tile
      icon={account.kind === 'card' ? 'wallet' : 'bank'}
      size={size}
      background={theme.primarySoft}
      tint={theme.primary}
    />
  );
}

const styles = StyleSheet.create({
  tile: {
    alignItems: 'center',
    justifyContent: 'center',
  },
});
