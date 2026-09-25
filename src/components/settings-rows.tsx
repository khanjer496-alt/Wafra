/**
 * The row shapes Settings and "Data and help" share.
 *
 * Every row leads with a small tinted glyph tile so a long list can be scanned
 * by shape before it is read. The two rules from the Settings header comment
 * still hold here: a chevron promises that something opens, and a row that
 * leads to the paywall shows the lock before it is tapped.
 */
import React from 'react';
import { Pressable, StyleSheet, View } from 'react-native';

import { ThemedText } from '@/components/themed-text';
import { Toggle } from '@/components/ui/controls';
import { Icon, type IconName } from '@/components/ui/icon';
import { Row } from '@/components/ui/layout';
import { Spacing } from '@/constants/theme';
import { useTheme } from '@/hooks/use-theme';
import { tapped } from '@/lib/haptics';

export function SettingsIconTile({ icon, tone = 'default', children }: {
  icon?: IconName;
  tone?: 'default' | 'danger';
  children?: React.ReactNode;
}) {
  const theme = useTheme();
  return (
    <View
      accessible={false}
      importantForAccessibility="no-hide-descendants"
      style={[styles.tile, {
        backgroundColor: tone === 'danger' ? theme.expenseSoftBg : theme.primarySoft,
      }]}>
      {children ?? (icon ? (
        <Icon name={icon} size={17} color={tone === 'danger' ? theme.expense : theme.primary} />
      ) : null)}
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
  testID,
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
  testID?: string;
}) {
  const theme = useTheme();
  const label = [title, value, subtitle, locked ? lockLabel : null].filter(Boolean).join(' · ');
  return (
    <View testID={testID}>
      <Row onPress={onPress} last={last} accessibilityLabel={label}>
        {icon || glyph ? <SettingsIconTile icon={icon}>{glyph}</SettingsIconTile> : null}
        <View style={styles.rowText}>
          <ThemedText type="small">{title}</ThemedText>
          {subtitle ? (
            <ThemedText type="meta" themeColor="textSecondary">
              {subtitle}
            </ThemedText>
          ) : null}
        </View>
        {value ? (
          <ThemedText type="small" themeColor="textSecondary" numberOfLines={1} style={styles.value}>
            {value}
          </ThemedText>
        ) : null}
        {locked && <Icon name="lock" size={13} color={theme.warning} />}
        <Icon name="chevron-right" size={15} color={theme.textTertiary} />
      </Row>
    </View>
  );
}

/**
 * The label and its sub-line are part of the target, but the Row itself is
 * not a button: a Pressable Row would swallow the switch's own accessibility
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
}) {
  return (
    <View testID={testID}>
      <Row last={last}>
        {icon || glyph ? <SettingsIconTile icon={icon}>{glyph}</SettingsIconTile> : null}
        <Pressable
          accessible={false}
          style={styles.rowText}
          onPress={() => {
            tapped();
            if (onTextPress) onTextPress();
            else onChange(!value);
          }}>
          <ThemedText type="small">{title}</ThemedText>
          {subtitle ? (
            <ThemedText type="meta" themeColor="textSecondary">
              {subtitle}
            </ThemedText>
          ) : null}
        </Pressable>
        <Toggle value={value} onChange={onChange} label={title} />
      </Row>
    </View>
  );
}

const styles = StyleSheet.create({
  tile: {
    width: 32,
    height: 32,
    borderRadius: 9,
    alignItems: 'center',
    justifyContent: 'center',
    flexShrink: 0,
  },
  rowText: {
    flex: 1,
    gap: Spacing.half,
  },
  value: {
    flexShrink: 1,
    maxWidth: '45%',
  },
});
