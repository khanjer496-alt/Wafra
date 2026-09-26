/**
 * E3 · Goals (green): "What should Wafra do?". Each goal picked drops its
 * shape into the pattern beside the headline, and the line under the list
 * says, truthfully, which Home section the answers move to the top — the
 * order itself is written to the existing Customize Home preference
 * (onboarding-e.ts: homeOrderForGoals). Any number, including none.
 */
import React from 'react';
import { Pressable, StyleSheet, View } from 'react-native';

import { EBody, EHeadline, EStepFrame, bandButtonColor } from '@/components/onboarding/e-frame';
import { ThemedText } from '@/components/themed-text';
import { EButton } from '@/components/ui/band/e-button';
import { Icon } from '@/components/ui/icon';
import { PatternMosaic } from '@/components/ui/pattern-mosaic';
import { useBand } from '@/hooks/use-band';
import { useLanguage } from '@/hooks/use-language';
import { useLargeTextLayout } from '@/hooks/use-large-text-layout';
import { tapped } from '@/lib/haptics';
import { firstHomeSectionForGoals } from '@/lib/onboarding-e';
import { onboardingECopy } from '@/lib/onboarding-e-copy';
import type { PatternTile } from '@/lib/pattern';
import { GOAL_IDS, type GoalId } from '@/lib/types';

/** Board E3's order: salary, bills, subscriptions, spend less, cash and cards. */
const SHOWN: readonly GoalId[] = ['salary', 'bills', 'subscriptions', 'spend-less', 'cash-cards'];

export function GoalsStep({ goals, onToggle, onContinue, onBack, onClose, tiles, disabled }: {
  goals: readonly GoalId[];
  onToggle: (goal: GoalId) => void;
  onContinue: () => void;
  onBack: () => void;
  onClose?: () => void;
  /** The pattern so far: the name tile and the picked goals. */
  tiles: readonly PatternTile[];
  disabled: boolean;
}) {
  const words = onboardingECopy(useLanguage());
  const band = useBand('flow');
  const largeText = useLargeTextLayout();
  const first = firstHomeSectionForGoals(goals);
  return <EStepFrame palette={band} step={2} onBack={onBack} onClose={onClose} backDisabled={disabled} testID="onboarding-goals"
    footer={<EButton palette={band} color={bandButtonColor(band)} label={words.continue} onPress={onContinue}
      disabled={disabled} testID="onboarding-goals-continue" />}>
    <View style={[styles.head, largeText && styles.headStacked]}>
      <View style={styles.headline}><EHeadline palette={band} size={42}>{words.goalsTitle}</EHeadline></View>
      {/* On a sheet-coloured card: the goal shapes include the band's own green. */}
      <View style={[styles.patternCard, { backgroundColor: band.sheet }]}>
        <PatternMosaic tiles={tiles} tile={largeText ? 22 : 18} animate testID="onboarding-goals-pattern" />
      </View>
    </View>
    <View style={styles.list} testID="onboarding-goal-options">
      {SHOWN.filter((goal) => GOAL_IDS.includes(goal)).map((goal) => {
        const selected = goals.includes(goal);
        return <Pressable key={goal} accessibilityRole="checkbox" accessibilityState={{ checked: selected, disabled }}
          accessibilityLabel={words.goals[goal]} disabled={disabled} testID={`onboarding-goal-${goal}`}
          onPress={() => { tapped(); onToggle(goal); }}
          style={({ pressed }) => [styles.pill, {
            borderColor: selected ? band.onBand : band.onBandSecondary,
            backgroundColor: selected ? band.onBand : 'transparent',
            opacity: pressed ? 0.8 : 1,
          }]}>
          <ThemedText type="smallBold" style={[styles.pillLabel, { color: selected ? band.band : band.onBand }]}>
            {words.goals[goal]}
          </ThemedText>
          <Icon name={selected ? 'check' : 'plus'} size={20} color={selected ? band.band : band.onBand} strokeWidth={2} />
        </Pressable>;
      })}
    </View>
    <EBody palette={band} style={styles.hint}>{first ? words.goalsHint[first] : words.goalsHintNone}</EBody>
  </EStepFrame>;
}

const styles = StyleSheet.create({
  head: { flexDirection: 'row', alignItems: 'flex-end', justifyContent: 'space-between', gap: 12 },
  headStacked: { flexDirection: 'column', alignItems: 'flex-start' },
  headline: { flex: 1, minWidth: 0 },
  patternCard: { padding: 8, borderRadius: 14 },
  list: { gap: 10 },
  pill: {
    minHeight: 60, borderRadius: 30, borderWidth: 1.5, paddingHorizontal: 20, paddingVertical: 12,
    flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', gap: 12,
  },
  pillLabel: { flex: 1, minWidth: 0, fontSize: 17, lineHeight: 23 },
  hint: { fontSize: 15, lineHeight: 22 },
});
