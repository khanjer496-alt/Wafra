import React from 'react';
import { StyleSheet, View } from 'react-native';

import { ThemedText } from '@/components/themed-text';
import { Icon } from '@/components/ui/icon';
import { Radius, Spacing, type BandPalette } from '@/constants/theme';
import { useTheme } from '@/hooks/use-theme';
import { useLargeTextLayout } from '@/hooks/use-large-text-layout';

/** Optional E palette keeps older guide previews compatible. */
function useSetupTheme(palette?: BandPalette) {
  const theme = useTheme();
  return palette ? { ...theme, background: palette.sheet, card: palette.card, cardBorder: palette.rule,
    primary: palette.tint, primarySoft: palette.statusOkSoft, primaryBorder: palette.rule,
    text: palette.text, textSecondary: palette.textSecondary, textTertiary: palette.textSecondary,
    track: palette.rule, backgroundSelected: palette.glyphGround,
    expense: palette.statusOver, expenseSoftBg: palette.statusOverSoft, expenseSoftBorder: palette.statusOver } : theme;
}

/**
 * Presentational pieces of the guided iPhone setup. They draw state they are
 * given and never read setup progress or native proof themselves, so the same
 * pieces render the real flow and its web design preview.
 */

export interface StepProgressProps {
  palette?: BandPalette;
  /** 1-based index of the current step; `total + 1` means every step is done. */
  current: number;
  labels: readonly string[];
  /** "Step {step} of {total}" with both placeholders. */
  template: string;
}

/** Numbered progress for a short guided flow. One announcement, not three. */
export function StepProgress({ current, labels, template, palette }: StepProgressProps) {
  const theme = useSetupTheme(palette);
  const largeText = useLargeTextLayout();
  const total = labels.length;
  const shown = Math.min(Math.max(current, 1), total);
  const label = `${template.replace('{step}', String(shown)).replace('{total}', String(total))}: ${labels[shown - 1]}`;
  return (
    <View
      testID="setup-step-progress"
      accessible
      accessibilityRole="progressbar"
      accessibilityLabel={label}
      accessibilityValue={{ min: 0, max: total, now: shown }}
      style={[styles.progress, largeText && { flexDirection: 'column' }]}>
      {labels.map((item, index) => {
        const done = index + 1 < current;
        const active = index + 1 === current;
        return (
          <View key={item} style={[styles.progressItem, largeText && { flex: undefined }]}>
            <View style={[styles.progressBar, {
              backgroundColor: done || active ? theme.primary : theme.track,
            }]} />
            <View style={styles.progressLabelLine}>
              {done
                ? <Icon name="check" size={12} color={theme.primary} />
                : <ThemedText type="micro" style={{ color: active ? theme.primary : theme.textTertiary }} tabular>
                  {index + 1}
                </ThemedText>}
              <ThemedText type="micro" style={[styles.progressLabel, { color: active ? theme.text : theme.textTertiary }]}>
                {item}
              </ThemedText>
            </View>
          </View>
        );
      })}
    </View>
  );
}

/** Apple's own on-screen words, in the order they are tapped. */
export function GuideChips({ labels, spokenPrefix, palette }: { labels: readonly string[]; spokenPrefix?: string; palette?: BandPalette }) {
  const theme = useSetupTheme(palette);
  if (labels.length === 0) return null;
  const spoken = `${spokenPrefix ? `${spokenPrefix}: ` : ''}${labels.join(', ')}`;
  return (
    <View style={styles.chips} accessible accessibilityLabel={spoken} testID="setup-guide-chips">
      {labels.map((label, index) => (
        <View key={`${index}:${label}`} style={styles.chipLine}>
          {/* Icon mirrors directional chevrons for Arabic itself. */}
          {index > 0 && <Icon name="chevron-right" size={14} color={theme.textTertiary} />}
          <View style={[styles.chip, { backgroundColor: theme.backgroundSelected, borderColor: theme.cardBorder }]}>
            <ThemedText type="smallBold" style={[styles.chipText, { color: theme.text }]}>{label}</ThemedText>
          </View>
        </View>
      ))}
    </View>
  );
}

export interface SetupResultProps {
  palette?: BandPalette;
  tone: 'pass' | 'fail' | 'info';
  title: string;
  body?: string;
}

/** A test result that reads as pass or fail before a word is read. */
export function SetupResult({ tone, title, body, palette }: SetupResultProps) {
  const theme = useSetupTheme(palette);
  const colors = tone === 'pass'
    ? { bg: theme.primarySoft, border: theme.primaryBorder, fg: theme.primary, icon: 'check' as const }
    : tone === 'fail'
      ? { bg: theme.expenseSoftBg, border: theme.expenseSoftBorder, fg: theme.expense, icon: 'alert' as const }
      : { bg: theme.backgroundSelected, border: theme.cardBorder, fg: theme.textSecondary, icon: 'alert' as const };
  return (
    <View
      testID={`setup-result-${tone}`}
      accessible
      accessibilityRole={tone === 'fail' ? 'alert' : undefined}
      accessibilityLiveRegion="polite"
      accessibilityLabel={[title, body].filter(Boolean).join('. ')}
      style={[styles.result, { backgroundColor: colors.bg, borderColor: colors.border }]}>
      <View style={[styles.resultIcon, { backgroundColor: colors.fg }]}>
        <Icon name={colors.icon} size={14} color={theme.background} strokeWidth={2.4} />
      </View>
      <View style={styles.resultCopy}>
        <ThemedText type="smallBold" style={{ color: colors.fg }}>{title}</ThemedText>
        {body ? <ThemedText type="small" style={{ color: theme.textSecondary }}>{body}</ThemedText> : null}
      </View>
    </View>
  );
}

export interface SetupStepProps {
  palette?: BandPalette;
  /** Short visible marker such as "1" or "3.2". */
  badge: string;
  /** What VoiceOver reads for the badge, e.g. "Screen 2 of 5". Defaults to the badge. */
  badgeLabel?: string;
  title: string;
  body?: string;
  chips?: readonly string[];
  chipsPrefix?: string;
  result?: SetupResultProps | null;
  testID?: string;
  children?: React.ReactNode;
}

/** One step, one sentence, one primary action (passed as children). */
export function SetupStep({ badge, badgeLabel, title, body, chips, chipsPrefix, result, testID, children, palette }: SetupStepProps) {
  const theme = useSetupTheme(palette);
  return (
    <View testID={testID ?? 'setup-step'} style={[styles.card, { backgroundColor: theme.card, borderColor: theme.cardBorder }]}>
      <View style={styles.head}>
        <View style={[styles.badge, { backgroundColor: theme.primarySoft }]}
          accessibilityElementsHidden importantForAccessibility="no-hide-descendants">
          <ThemedText type="smallBold" style={{ color: theme.primary }} tabular>{badge}</ThemedText>
        </View>
        <ThemedText type="heading" accessibilityRole="header" accessibilityLabel={`${badgeLabel ?? badge}. ${title}`}
          style={[styles.title, { color: theme.text }]}>{title}</ThemedText>
      </View>
      {body ? <ThemedText type="default" style={{ color: theme.textSecondary }}>{body}</ThemedText> : null}
      {chips && chips.length > 0 ? <GuideChips palette={palette} labels={chips} spokenPrefix={chipsPrefix} /> : null}
      {result ? <SetupResult {...result} palette={palette} /> : null}
      {children ? <View style={styles.actions}>{children}</View> : null}
    </View>
  );
}

const styles = StyleSheet.create({
  progress: { flexDirection: 'row', gap: Spacing.two },
  progressItem: { flex: 1, gap: Spacing.one },
  progressBar: { height: 4, borderRadius: Radius.full },
  progressLabelLine: { flexDirection: 'row', alignItems: 'center', gap: Spacing.one },
  progressLabel: { flexShrink: 1 },
  card: {
    borderWidth: 1,
    borderRadius: Radius.sheet,
    padding: Spacing.three + Spacing.one,
    gap: Spacing.three,
  },
  head: { flexDirection: 'row', alignItems: 'center', gap: Spacing.two + Spacing.one },
  badge: {
    minWidth: 36,
    minHeight: 36,
    paddingHorizontal: Spacing.two,
    borderRadius: Radius.full,
    alignItems: 'center',
    justifyContent: 'center',
  },
  title: { flex: 1, flexShrink: 1 },
  chips: { flexDirection: 'row', flexWrap: 'wrap', alignItems: 'center', rowGap: Spacing.two, columnGap: Spacing.one },
  chipLine: { flexDirection: 'row', alignItems: 'center', gap: Spacing.one, flexShrink: 1, maxWidth: '100%' },
  chip: {
    minHeight: 32,
    paddingHorizontal: Spacing.two + Spacing.one,
    paddingVertical: Spacing.one,
    borderRadius: Radius.tile,
    borderWidth: StyleSheet.hairlineWidth,
    justifyContent: 'center',
  },
  chipText: { flexShrink: 1 },
  result: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    gap: Spacing.two + Spacing.one,
    borderWidth: 1,
    borderRadius: Radius.control,
    padding: Spacing.three,
  },
  resultIcon: { width: 22, height: 22, borderRadius: Radius.full, alignItems: 'center', justifyContent: 'center', marginTop: 1 },
  resultCopy: { flex: 1, gap: Spacing.half },
  actions: { gap: Spacing.two },
});
