import { useLocalSearchParams } from 'expo-router';
import { useRouter } from '@/hooks/use-app-router';
import React, { useState } from 'react';
import { StyleSheet, View } from 'react-native';

import { GoalJar } from '@/components/goals/goal-jar';
import { ThemedText } from '@/components/themed-text';
import { AmountSheet } from '@/components/ui/amount-sheet';
import { BottomSheet } from '@/components/ui/bottom-sheet';
import { ConfirmSheet } from '@/components/ui/confirm-sheet';
import { Button } from '@/components/ui/controls';
import { Icon, type IconName } from '@/components/ui/icon';
import { BandScaffold } from '@/components/ui/band-scaffold';
import { BandFigure } from '@/components/ui/band/band-figure';
import { EButton } from '@/components/ui/band/e-button';
import { TextField } from '@/components/ui/text-field';
import { Fonts, Spacing } from '@/constants/theme';
import { useBand } from '@/hooks/use-band';
import { useLargeTextLayout } from '@/hooks/use-large-text-layout';
import { useLanguage } from '@/hooks/use-language';
import { formatAED, formatAmountForInput, parseAmountWithMoneySpec } from '@/lib/format';
import { goalProgress } from '@/lib/money-places';
import { moneyPlacesWords } from '@/lib/money-places-copy';
import { useStoreActions, useStoreSelector } from '@/lib/store';
import { t } from '@/lib/i18n';

const GOAL_ICONS: IconName[] = ['target', 'plane', 'home', 'gift', 'car', 'cap', 'diamond', 'chart'];
const goalIcon = (emoji: string): IconName => (GOAL_ICONS as string[]).includes(emoji) ? emoji as IconName : 'target';
/** Zero is a real "saved so far". */
const ZERO = /^\s*0+(?:[.,٫]0*)?\s*$/;

/**
 * One savings goal: how much is set aside against the target, and the two
 * things to do about it — add to it, or edit it.
 *
 * A goal stores only its target and what has been saved (types.ts). So there
 * is no pace, no "reaches it by", and no contribution history here: each
 * would be invented. And adding money records a note in Wafra; it moves
 * nothing between accounts, which the screen says in so many words.
 */
export default function GoalRoute() {
  const { id } = useLocalSearchParams<{ id?: string | string[] }>();
  const goalId = typeof id === 'string' ? id : '';
  return <GoalScreen key={goalId} goalId={goalId} />;
}

function GoalScreen({ goalId }: { goalId: string }) {
  const router = useRouter();
  // Goals are money set aside by hand: the indigo flow band, a jar filling with gold coins.
  const band = useBand('flow');
  const large = useLargeTextLayout();
  const language = useLanguage();
  const w = moneyPlacesWords(language);
  const state = useStoreSelector(({ state: s }) => ({ goals: s.goals, ledgerMoney: s.ledgerMoney }));
  const { editGoal, deleteGoal } = useStoreActions();
  const goal = state.goals.find((candidate) => candidate.id === goalId) ?? null;

  const [adding, setAdding] = useState(false);
  const [editing, setEditing] = useState(false);
  const [deleting, setDeleting] = useState(false);
  const [title, setTitle] = useState('');
  const [targetText, setTargetText] = useState('');
  const [savedText, setSavedText] = useState('');

  if (!goal) {
    return (
      <BandScaffold band="flow" testID="goal-screen" nav={{ back: () => router.back(), title: w.goalTitle }}
        contentStyle={styles.content}>
        <ThemedText type="default" themeColor="textSecondary">{w.goalMissing}</ThemedText>
      </BandScaffold>
    );
  }

  const progress = goalProgress(goal);

  const money = state.ledgerMoney;
  const targetFils = money ? parseAmountWithMoneySpec(targetText, money) : null;
  const savedFils = ZERO.test(savedText) ? 0 : money ? parseAmountWithMoneySpec(savedText, money) : null;
  const editValid = Boolean(title.trim()) && targetFils !== null && targetFils > 0 && savedFils !== null;

  const openEdit = () => {
    setTitle(goal.title);
    setTargetText(formatAmountForInput(goal.targetFils));
    setSavedText(formatAmountForInput(goal.savedFils));
    setEditing(true);
  };
  const saveEdit = () => {
    if (!editValid || targetFils === null || savedFils === null) return;
    editGoal(goal.id, { title: title.trim(), targetFils, savedFils });
    setEditing(false);
  };

  return (
    <>
      <BandScaffold
        band="flow"
        testID="goal-screen"
        nav={{ back: () => router.back(),
          actions: [{ label: w.editGoal, icon: 'sliders', onPress: openEdit, testID: 'goal-edit-action' }] }}
        contentStyle={styles.content}
        scrollProps={{ showsVerticalScrollIndicator: false }}
        bandContent={(
          <View style={styles.hero} testID="goal-progress">
            {/* The jar and its percent are one spoken image; the name below stays the screen's header. */}
            <View style={[styles.progress, large && styles.progressStacked]} accessible accessibilityRole="image"
              accessibilityLabel={`${w.progressA11y(progress.percent)}. ${w.savedOf(formatAED(goal.savedFils), formatAED(goal.targetFils))}`}>
              <GoalJar testID="goal-jar" savedFils={goal.savedFils} targetFils={goal.targetFils} palette={band} />
              <View style={[styles.percentBlock, large && styles.percentBlockStacked]}>
                <ThemedText tabular maxFontSizeMultiplier={1.2} style={[styles.percent, { color: band.onBand }]}>{`${progress.percent}%`}</ThemedText>
                <ThemedText type="meta" maxFontSizeMultiplier={1.4} style={{ color: band.onBandSecondary }}>{w.savedWord}</ThemedText>
              </View>
            </View>
            <View style={styles.titleRow}>
              <Icon name={goalIcon(goal.emoji)} size={20} color={band.onBand} />
              <ThemedText accessibilityRole="header" maxFontSizeMultiplier={1.6} style={[styles.goalName, { color: band.onBand }]}>{goal.title}</ThemedText>
            </View>
            <ThemedText type="default" tabular style={[styles.center, { color: band.onBandSecondary }]}>
              {w.savedOf(formatAED(goal.savedFils), formatAED(goal.targetFils))}
            </ThemedText>
          </View>
        )}>
        <EButton palette={band} label={w.addMoney} icon="plus" onPress={() => setAdding(true)} testID="goal-add-money" />
        <ThemedText type="meta" themeColor="textSecondary" testID="goal-no-money-moves">{w.noMoneyMoves}</ThemedText>

        <View style={styles.section} testID="goal-left">
          <ThemedText type="heading" accessibilityRole="header">{progress.reached ? w.reached : w.leftToSave}</ThemedText>
          {progress.reached
            ? <ThemedText type="small" style={{ color: band.statusOk }}>{w.savedOf(formatAED(goal.savedFils), formatAED(goal.targetFils))}</ThemedText>
            : <BandFigure fils={progress.leftFils} palette={band} size="large" color={band.text} secondaryColor={band.textSecondary} />}
        </View>

        <View style={styles.actions}>
          <EButton palette={band} variant="secondary" label={w.editGoal} onPress={openEdit} testID="goal-edit" />
          <Button variant="ghost" labelColor={band.statusOver} label={w.deleteGoal} onPress={() => setDeleting(true)} />
        </View>
      </BandScaffold>

      {adding && (
        <AmountSheet
          visible
          onClose={() => setAdding(false)}
          title={w.addMoney}
          question={w.addMoneyQuestion(goal.title)}
          placeholder={t('amountInLedgerCurrency')}
          onSubmit={(fils) => editGoal(goal.id, { savedFils: goal.savedFils + fils })}
        />
      )}
      <BottomSheet visible={editing} onClose={() => setEditing(false)} title={w.editGoal}
        footer={<EButton palette={band} label={w.save} onPress={saveEdit} disabled={!editValid} testID="goal-save" />}>
        <TextField label={w.goalName} value={title} onChangeText={setTitle} placeholder={w.goalName} />
        <TextField numeric label={w.goalTarget} value={targetText} onChangeText={setTargetText} placeholder={w.goalTarget}
          leading={<ThemedText type="smallBold" themeColor="textSecondary">{money?.currency ?? '—'}</ThemedText>} />
        <TextField numeric label={w.goalSavedSoFar} value={savedText} onChangeText={setSavedText} placeholder={w.goalSavedSoFar}
          leading={<ThemedText type="smallBold" themeColor="textSecondary">{money?.currency ?? '—'}</ThemedText>} />
        <ThemedText type="meta" themeColor="textSecondary">{w.noMoneyMoves}</ThemedText>
      </BottomSheet>
      {deleting && (
        <ConfirmSheet
          visible
          onClose={() => setDeleting(false)}
          question={t('deleteGoalTitle')}
          body={goal.title}
          confirmLabel={t('delete')}
          destructive
          onConfirm={() => {
            deleteGoal(goal.id);
            router.back();
          }}
        />
      )}
    </>
  );
}

const styles = StyleSheet.create({
  content: { gap: Spacing.three },
  hero: { alignItems: 'center', gap: Spacing.one, paddingBottom: Spacing.two },
  progress: { flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: Spacing.four, marginBottom: Spacing.two },
  progressStacked: { flexDirection: 'column', gap: Spacing.two },
  percentBlock: { alignItems: 'flex-start', minWidth: 0 },
  percentBlockStacked: { alignItems: 'center' },
  percent: { fontFamily: Fonts.sansSemi, fontSize: 40, lineHeight: 46, letterSpacing: -1.5 },
  titleRow: { flexDirection: 'row', alignItems: 'center', justifyContent: 'center', flexWrap: 'wrap', gap: Spacing.two },
  goalName: { fontFamily: Fonts.sansSemi, fontSize: 30, lineHeight: 36, letterSpacing: -1, textAlign: 'center', flexShrink: 1 },
  center: { textAlign: 'center' },
  section: { gap: Spacing.one, paddingTop: Spacing.two },
  actions: { gap: Spacing.one, paddingTop: Spacing.two },
});
