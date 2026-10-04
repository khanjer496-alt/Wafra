/**
 * E3 · Goals (green): "What should Wafra do?". Each goal picked drops its
 * shape into the pattern beside the headline, and the line under the
 * headline says it is multi-select, then, truthfully, which Home section the
 * answers move to the top — the order itself is written to the existing
 * Customize Home preference (onboarding-e.ts: homeOrderForGoals). Any number,
 * including none: with none (and none saved before) the button says Skip for now.
 */
import React from 'react';
import { StyleSheet, View } from 'react-native';

import { EChoiceRow } from '@/components/onboarding/e-choice-row';
import { EBody, EHeadline, EStepFrame, bandButtonColor } from '@/components/onboarding/e-frame';
import { EButton } from '@/components/ui/band/e-button';
import { PatternMosaic } from '@/components/ui/pattern-mosaic';
import { useBand } from '@/hooks/use-band';
import { useLanguage } from '@/hooks/use-language';
import { useLargeTextLayout } from '@/hooks/use-large-text-layout';
import { bandCopy } from '@/lib/band-copy';
import { firstHomeSectionForGoals } from '@/lib/onboarding-e';
import { onboardingECopy } from '@/lib/onboarding-e-copy';
import type { PatternTile } from '@/lib/pattern';
import { GOAL_IDS, type GoalId } from '@/lib/types';

/** Tray tiles: loose ~40pt shapes, three across, as on board E3. */
const TRAY_TILE = 38;
const TRAY_GAP = 5;
const TRAY_COLUMNS = 3;

/**
 * The pattern's tiles in its reading order (row, then column, as Home packs
 * them). The band here is the pattern's own green, so a green shape takes
 * the board's on-band tones instead: mint for a solid, cream for a ring.
 */
export function trayTiles(tiles: readonly PatternTile[]): PatternTile[] {
  return [...tiles].sort((a, b) => a.row - b.row || a.col - b.col)
    .map((tile) => tile.color === 'green' ? { ...tile, color: tile.kind === 'ring' ? 'cream' : 'mint' } : tile);
}

/** Board E3's order: salary, bills, subscriptions, spend less, cash and cards. */
const SHOWN: readonly GoalId[] = ['salary', 'bills', 'subscriptions', 'spend-less', 'cash-cards'];

export function GoalsStep({ goals, saved = false, onToggle, onContinue, onBack, onClose, tiles, disabled }: {
  goals: readonly GoalId[];
  /** Goals were saved on an earlier pass: unpicking them all is a change, so the button stays Continue. */
  saved?: boolean;
  onToggle: (goal: GoalId) => void;
  onContinue: () => void;
  onBack: () => void;
  onClose?: () => void;
  /** The pattern so far: the name tile and the picked goals. */
  tiles: readonly PatternTile[];
  disabled: boolean;
}) {
  const language = useLanguage();
  const words = onboardingECopy(language);
  const bandWords = bandCopy(language);
  const band = useBand('flow');
  const largeText = useLargeTextLayout();
  const first = firstHomeSectionForGoals(goals);
  return <EStepFrame palette={band} step={2} onBack={onBack} onClose={onClose} backDisabled={disabled} testID="onboarding-goals"
    footer={<EButton palette={band} color={bandButtonColor(band)} label={goals.length > 0 || saved ? words.continue : words.skipForNow}
      onPress={onContinue} disabled={disabled} testID="onboarding-goals-continue" />}>
    <View style={[styles.head, largeText && styles.headStacked]}>
      <View style={styles.headline}><EHeadline palette={band} size={42}>{words.goalsTitle}</EHeadline></View>
      {/* Loose tiles straight on the band, as on the board: a fixed-width
          tray of three across, so picking a goal never reflows the headline. */}
      <View testID="onboarding-goals-pattern" accessible accessibilityRole="image" accessibilityLabel={bandWords.pattern}
        style={styles.tray}>
        <View accessibilityElementsHidden importantForAccessibility="no-hide-descendants" aria-hidden style={styles.trayTiles}>
          {trayTiles(tiles).map((tile) =>
            <PatternMosaic key={tile.key} tiles={[tile]} tile={TRAY_TILE} compact animate />)}
        </View>
      </View>
    </View>
    <EBody palette={band} style={styles.hint} testID="onboarding-goals-hint">
      {first ? words.goalsHint[first] : words.goalsHintNone}
    </EBody>
    <View style={styles.list} testID="onboarding-goal-options">
      {SHOWN.filter((goal) => GOAL_IDS.includes(goal)).map((goal) => <EChoiceRow key={goal} palette={band}
        label={words.goals[goal]} checked={goals.includes(goal)} onPress={() => onToggle(goal)} disabled={disabled}
        testID={`onboarding-goal-${goal}`} />)}
    </View>
  </EStepFrame>;
}

const styles = StyleSheet.create({
  head: { flexDirection: 'row', alignItems: 'flex-end', justifyContent: 'space-between', gap: 8 },
  headStacked: { flexDirection: 'column', alignItems: 'flex-start', gap: 12 },
  headline: { flex: 1, minWidth: 0 },
  tray: { width: TRAY_TILE * TRAY_COLUMNS + TRAY_GAP * (TRAY_COLUMNS - 1), paddingBottom: 6 },
  trayTiles: { flexDirection: 'row', flexWrap: 'wrap', gap: TRAY_GAP },
  list: { gap: 10 },
  hint: { fontSize: 16, lineHeight: 23 },
});
