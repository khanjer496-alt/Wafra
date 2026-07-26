import React from 'react';
import { StyleSheet, View } from 'react-native';

import { ThemedText } from '@/components/themed-text';
import { Icon, type IconName } from '@/components/ui/icon';
import { Radius } from '@/constants/theme';
import { bankBrandForName, bankMonogram } from '@/lib/markets';

interface BankAvatarProps {
  /** Bank name (or account name) used to resolve the brand. */
  name: string;
  /** Account color, used when the bank isn't in the registry. */
  color: string;
  icon?: IconName;
  size?: number;
}

/**
 * Brand badge for account and card rows.
 *
 * Known banks render as a monogram in their own brand color; anything else
 * falls back to a tinted icon. Both are drawn locally, so the badge is
 * correct offline, needs no third-party favicon service (which leaked every
 * account name to a logo host and returned marks that read as the wrong
 * brand at this size), and stays on-theme instead of punching a white
 * square into a dark screen.
 */
export function BankAvatar({ name, color, icon = 'wallet', size = 42 }: BankAvatarProps) {
  const brand = bankBrandForName(name);
  const radius = Math.round(size * 0.31);
  const tint = brand?.color ?? color;

  const surface = {
    width: size,
    height: size,
    borderRadius: radius,
    backgroundColor: `${tint}1F`,
    borderColor: `${tint}47`,
  };

  if (!brand) {
    return (
      <View style={[styles.badge, styles.bordered, surface]}>
        <Icon name={icon} size={Math.round(size * 0.46)} color={tint} strokeWidth={1.8} />
      </View>
    );
  }

  const monogram = bankMonogram(brand.name);
  // Longer monograms step down so ADCB and LIV both sit on the same optical weight.
  const scale = monogram.length <= 2 ? 0.38 : monogram.length === 3 ? 0.31 : 0.25;

  return (
    <View style={[styles.badge, styles.bordered, surface]}>
      <ThemedText
        style={{
          color: tint,
          fontSize: Math.round(size * scale),
          lineHeight: Math.round(size * scale * 1.15),
          fontWeight: '800',
          letterSpacing: 0.2,
        }}>
        {monogram}
      </ThemedText>
    </View>
  );
}

const styles = StyleSheet.create({
  badge: {
    alignItems: 'center',
    justifyContent: 'center',
    overflow: 'hidden',
  },
  bordered: {
    borderWidth: StyleSheet.hairlineWidth,
    borderRadius: Radius.sm,
  },
});
