import { useRouter } from 'expo-router';
import React from 'react';
import { Pressable, StyleSheet, View } from 'react-native';

import { Icon } from '@/components/ui/icon';
import { RichSentence } from '@/components/ui/rich-sentence';
import { Spacing } from '@/constants/theme';
import { useTheme } from '@/hooks/use-theme';
import type { Insight } from '@/lib/insights';

interface InsightCardProps {
  insight: Insight;
}

/**
 * One written observation.
 *
 * It used to be a card with an alpha-tinted icon bubble, which put a second
 * surface and a second tint inside a list that is already a list. It is a row
 * now: the glyph carries the tone, the sentence carries the finding, and the
 * figures inside it are set in the mono face so they stay scannable without
 * being pulled into a column they do not deserve.
 */
export function InsightCard({ insight }: InsightCardProps) {
  const theme = useTheme();
  const router = useRouter();

  const tone =
    insight.tone === 'warning'
      ? theme.warning
      : insight.tone === 'positive'
        ? theme.income
        : theme.textSecondary;

  const body = (
    <View style={styles.row}>
      <View style={styles.glyph}>
        <Icon name={insight.icon} size={18} color={tone} />
      </View>
      <View style={styles.text}>
        <RichSentence text={`${insight.title}. ${insight.body}`} />
      </View>
      {insight.href && <Icon name="chevron-right" size={15} color={theme.textTertiary} />}
    </View>
  );

  if (!insight.href) {
    return <View style={[styles.wrap, { borderTopColor: theme.cardBorder }]}>{body}</View>;
  }
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={insight.title}
      // No non-null assertion. The guard above already proved it is there,
      // and asserting is how a missing href became a push to the empty path —
      // which is why the error screen said "wafra:///" and not the route it
      // failed to find.
      onPress={() => router.push(insight.href ?? '/flow')}
      style={({ pressed }) => [
        styles.wrap,
        { borderTopColor: theme.cardBorder },
        pressed && { transform: [{ scale: 0.985 }] },
      ]}>
      {body}
    </Pressable>
  );
}

const styles = StyleSheet.create({
  wrap: {
    borderTopWidth: StyleSheet.hairlineWidth,
  },
  row: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    gap: Spacing.three - 2,
    paddingVertical: Spacing.three - 3,
  },
  glyph: {
    width: 22,
    alignItems: 'center',
    paddingTop: 2,
  },
  text: {
    flex: 1,
  },
});
