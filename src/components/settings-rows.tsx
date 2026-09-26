/**
 * The row shapes Settings, "Data and help" and Customize Home share, in
 * design language E.
 *
 * Every row leads with a glyph tile on the sheet's one glyph ground, in the
 * sheet's text colour — one tone for every row, because colour on a list means
 * status only. Rows sit on the sheet with a hairline rule between them
 * (60pt, the boards' `link_row`). The two rules from the Settings header
 * comment still hold here: a chevron promises that something opens, and a row
 * that leads to the paywall shows the lock before it is tapped.
 *
 * At the accessibility text sizes a trailing value takes its own line under
 * the title instead of squeezing it.
 */
import React from 'react';
import { Pressable, StyleSheet, View } from 'react-native';

import { ThemedText } from '@/components/themed-text';
import { GlyphTile } from '@/components/ui/band/glyph-tile';
import { Toggle } from '@/components/ui/controls';
import { Icon, type IconName } from '@/components/ui/icon';
import { Fonts, Spacing, type BandPalette } from '@/constants/theme';
import { useBand } from '@/hooks/use-band';
import { useLargeTextLayout } from '@/hooks/use-large-text-layout';
import { tapped } from '@/lib/haptics';

/** The row tile's size: the boards draw 36pt tiles on 60pt rows. */
export const SETTINGS_TILE = 36;

/** Sheet palette for these rows. Every band shares the sheet tokens. */
function useRowPalette(palette?: BandPalette): BandPalette {
  const settings = useBand('settings');
  return palette ?? settings;
}

export function SettingsIconTile({ icon, tone = 'default', children, palette }: {
  icon?: IconName;
  tone?: 'default' | 'danger';
  children?: React.ReactNode;
  palette?: BandPalette;
}) {
  const band = useRowPalette(palette);
  // The foundation's glyph tile whenever a bundled icon fits; a custom glyph
  // (the language letter, the biometric mark) or the destructive row gets the
  // same shape and ground drawn here.
  if (icon && !children && tone === 'default') {
    return <GlyphTile icon={icon} palette={band} size={SETTINGS_TILE} />;
  }
  return (
    <View
      accessible={false}
      importantForAccessibility="no-hide-descendants"
      style={[styles.tile, { backgroundColor: band.glyphGround }]}>
      {children ?? (icon ? (
        <Icon name={icon} size={18} strokeWidth={2} color={tone === 'danger' ? band.statusOver : band.text} />
      ) : null)}
    </View>
  );
}

/** A small group heading on the sheet ("Capture", "You"). */
export function SettingsGroupTitle({ title, palette, trailing }: {
  title: string;
  palette?: BandPalette;
  trailing?: React.ReactNode;
}) {
  const band = useRowPalette(palette);
  return (
    <View style={styles.groupRow}>
      <ThemedText type="smallBold" accessibilityRole="header" style={[styles.groupTitle, { color: band.textSecondary }]}>
        {title}
      </ThemedText>
      {trailing}
    </View>
  );
}

export function SettingsLinkRow({
  title,
  subtitle,
  value,
  onPress,
  icon,
  glyph,
  last = false,
  locked = false,
  lockLabel,
  tone = 'default',
  testID,
  palette,
}: {
  title: string;
  subtitle?: string | null;
  /** A short current value drawn at the trailing edge ("System", "English"). */
  value?: string | null;
  onPress: () => void;
  icon?: IconName;
  /** A custom glyph for the tile, when no bundled icon fits. */
  glyph?: React.ReactNode;
  last?: boolean;
  locked?: boolean;
  lockLabel?: string;
  /** `danger` for the one destructive row (Erase). */
  tone?: 'default' | 'danger';
  testID?: string;
  palette?: BandPalette;
}) {
  const band = useRowPalette(palette);
  const largeText = useLargeTextLayout();
  const label = [title, value, subtitle, locked ? lockLabel : null].filter(Boolean).join(' · ');
  return (
    <View testID={testID}>
      <Pressable
        accessibilityRole="button"
        accessibilityLabel={label}
        onPress={() => {
          tapped();
          onPress();
        }}
        style={({ pressed }) => [
          styles.row,
          !last && { borderBottomWidth: StyleSheet.hairlineWidth, borderBottomColor: band.rule },
          { opacity: pressed ? 0.7 : 1 },
        ]}>
        {icon || glyph ? <SettingsIconTile icon={icon} tone={tone} palette={band}>{glyph}</SettingsIconTile> : null}
        <View style={styles.rowText}>
          <ThemedText type="smallBold" style={[styles.title, { color: tone === 'danger' ? band.statusOver : band.text }]}>
            {title}
          </ThemedText>
          {subtitle ? (
            <ThemedText type="meta" style={{ color: band.textSecondary }}>
              {subtitle}
            </ThemedText>
          ) : null}
          {value && largeText ? (
            <ThemedText type="small" style={{ color: band.textSecondary }}>{value}</ThemedText>
          ) : null}
        </View>
        {value && !largeText ? (
          <ThemedText type="small" numberOfLines={1} style={[styles.value, { color: band.textSecondary }]}>
            {value}
          </ThemedText>
        ) : null}
        {locked && <Icon name="lock" size={14} color={band.textSecondary} />}
        <Icon name="chevron-right" size={18} strokeWidth={2} color={band.textSecondary} />
      </Pressable>
    </View>
  );
}

/**
 * The label and its sub-line are part of the target, but the row itself is
 * not a button: a pressable row would swallow the switch's own accessibility
 * state. So the text is the press target and the switch stays focusable.
 */
export function SettingsSwitchRow({
  title,
  subtitle,
  value,
  onChange,
  onTextPress,
  icon,
  glyph,
  last = false,
  testID,
  palette,
}: {
  title: string;
  subtitle?: string | null;
  value: boolean;
  onChange: (next: boolean) => void;
  /** What tapping the words does. Defaults to flipping the switch. */
  onTextPress?: () => void;
  icon?: IconName;
  glyph?: React.ReactNode;
  last?: boolean;
  testID?: string;
  palette?: BandPalette;
}) {
  const band = useRowPalette(palette);
  return (
    <View testID={testID}>
      <View style={[styles.row, !last && { borderBottomWidth: StyleSheet.hairlineWidth, borderBottomColor: band.rule }]}>
        {icon || glyph ? <SettingsIconTile icon={icon} palette={band}>{glyph}</SettingsIconTile> : null}
        <Pressable
          accessible={false}
          style={styles.rowText}
          onPress={() => {
            tapped();
            if (onTextPress) onTextPress();
            else onChange(!value);
          }}>
          <ThemedText type="smallBold" style={[styles.title, { color: band.text }]}>{title}</ThemedText>
          {subtitle ? (
            <ThemedText type="meta" style={{ color: band.textSecondary }}>
              {subtitle}
            </ThemedText>
          ) : null}
        </Pressable>
        <Toggle value={value} onChange={onChange} label={title} />
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  tile: {
    width: SETTINGS_TILE,
    height: SETTINGS_TILE,
    borderRadius: Math.round(SETTINGS_TILE * 0.28),
    alignItems: 'center',
    justifyContent: 'center',
    flexShrink: 0,
  },
  row: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 14,
    minHeight: 60,
    paddingVertical: Spacing.two,
  },
  rowText: {
    flex: 1,
    minWidth: 0,
    gap: 2,
  },
  title: { fontFamily: Fonts.sansSemi, fontSize: 16, lineHeight: 22 },
  value: {
    flexShrink: 1,
    maxWidth: '45%',
  },
  groupRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: Spacing.two,
    paddingTop: Spacing.three,
    paddingBottom: Spacing.half,
  },
  groupTitle: { fontSize: 13, lineHeight: 18, flexShrink: 1 },
});
