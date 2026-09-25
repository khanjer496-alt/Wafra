import { useLocalSearchParams, useRouter } from 'expo-router';
import React, { useState } from 'react';
import { StyleSheet, View } from 'react-native';
import Svg, { Circle } from 'react-native-svg';

import { ThemedText } from '@/components/themed-text';
import { AmountSheet } from '@/components/ui/amount-sheet';
import { BottomSheet } from '@/components/ui/bottom-sheet';
import { ConfirmSheet } from '@/components/ui/confirm-sheet';
import { Button } from '@/components/ui/controls';
import { Icon, type IconName } from '@/components/ui/icon';
import { ScreenScaffold } from '@/components/ui/screen-scaffold';
import type { ScreenHeaderProps } from '@/components/ui/screen-header';
import { TextField } from '@/components/ui/text-field';
import { Radius, Spacing } from '@/constants/theme';
import { useLanguage } from '@/hooks/use-language';
import { useLargeTextLayout } from '@/hooks/use-large-text-layout';
import { useTheme } from '@/hooks/use-theme';
import { formatAED, formatAmountForInput, parseAmountWithMoneySpec } from '@/lib/format';
import { goalProgress } from '@/lib/money-places';
import { moneyPlacesWords } from '@/lib/money-places-copy';
import { useStoreActions, useStoreSelector } from '@/lib/store';
import { t } from '@/lib/i18n';

const GOAL_ICONS: IconName[] = ['target', 'plane', 'home', 'gift', 'car', 'cap', 'diamond', 'chart'];
const goalIcon = (emoji: string): IconName => (GOAL_ICONS as string[]).includes(emoji) ? emoji as IconName : 'target';
/** Zero is a real "saved so far". */
const ZERO = /^\s*0+(?:[.,٫]0*)?\s*$/;

const RING = 148;
const STROKE = 12;

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
  const theme = useTheme();
  const language = useLanguage();
  const large = useLargeTextLayout();
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

  const header: ScreenHeaderProps = {
    title: goal?.title ?? w.goalTitle,
    back: { label: t('back'), onPress: () => router.back() },
  };

  if (!goal) {
    return (
      <ScreenScaffold headerMode="native" header={header} contentStyle={styles.content}>
        <ThemedText type="default" themeColor="textSecondary">{w.goalMissing}</ThemedText>
      </ScreenScaffold>
    );
  }

  const progress = goalProgress(goal);
  const radius = (RING - STROKE) / 2;
  const circumference = 2 * Math.PI * radius;

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
      <ScreenScaffold headerMode="native" header={header} contentStyle={styles.content}
        scrollProps={{ showsVerticalScrollIndicator: false }}>
        <View style={styles.hero} testID="goal-progress" accessible
          accessibilityLabel={`${goal.title}. ${w.progressA11y(progress.percent)}. ${w.savedOf(formatAED(goal.savedFils), formatAED(goal.targetFils))}`}>
          <View style={styles.ring}>
            <Svg width={RING} height={RING}>
              <Circle cx={RING / 2} cy={RING / 2} r={radius} stroke={theme.track} strokeWidth={STROKE} fill="none" />
              {progress.ratio > 0 && (
                <Circle
                  cx={RING / 2}
                  cy={RING / 2}
                  r={radius}
                  stroke={progress.reached ? theme.income : theme.primary}
                  strokeWidth={STROKE}
                  strokeLinecap="round"
                  fill="none"
                  strokeDasharray={`${circumference} ${circumference}`}
                  strokeDashoffset={circumference * (1 - progress.ratio)}
                  transform={`rotate(-90 ${RING / 2} ${RING / 2})`}
                />
              )}
            </Svg>
            <View style={styles.ringLabel} pointerEvents="none">
              <ThemedText type="amount" tabular>{`${progress.percent}%`}</ThemedText>
            </View>
          </View>
          <View style={styles.titleRow}>
            <Icon name={goalIcon(goal.emoji)} size={16} color={theme.textSecondary} />
            <ThemedText type="subtitle">{goal.title}</ThemedText>
          </View>
          <ThemedText type="small" themeColor="textSecondary" tabular>
            {w.savedOf(formatAED(goal.savedFils), formatAED(goal.targetFils))}
          </ThemedText>
          <ThemedText type="meta" themeColor={progress.reached ? 'income' : 'textSecondary'}>
            {progress.reached ? w.reached : w.toGo(formatAED(progress.leftFils))}
          </ThemedText>
        </View>

        <View style={[styles.actions, large && styles.stack]}>
          <Button inline={!large} label={w.addMoney} icon="plus" onPress={() => setAdding(true)} />
          <Button inline={!large} variant="outline" label={w.editGoal} onPress={openEdit} />
        </View>
        <View style={[styles.note, { borderColor: theme.cardBorder }]} testID="goal-no-money-moves">
          <Icon name="wallet" size={16} color={theme.textSecondary} />
          <ThemedText type="meta" themeColor="textSecondary" style={styles.grow}>{w.noMoneyMoves}</ThemedText>
        </View>
        <Button variant="ghost" labelColor={theme.expense} label={w.deleteGoal} onPress={() => setDeleting(true)} />
      </ScreenScaffold>

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
        footer={<Button label={w.save} onPress={saveEdit} disabled={!editValid} />}>
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
  hero: { alignItems: 'center', gap: Spacing.one, paddingVertical: Spacing.three },
  ring: { width: RING, height: RING, alignItems: 'center', justifyContent: 'center', marginBottom: Spacing.two },
  ringLabel: { position: 'absolute', alignItems: 'center', justifyContent: 'center' },
  titleRow: { flexDirection: 'row', alignItems: 'center', gap: Spacing.one + 2 },
  actions: { flexDirection: 'row', gap: Spacing.two },
  stack: { flexDirection: 'column' },
  note: {
    flexDirection: 'row', alignItems: 'flex-start', gap: Spacing.two, padding: Spacing.three,
    borderRadius: Radius.sheet, borderWidth: StyleSheet.hairlineWidth,
  },
  grow: { flex: 1, minWidth: 0 },
});
