import { useRouter } from 'expo-router';
import React, { useMemo, useState } from 'react';
import { Pressable, StyleSheet, View } from 'react-native';

import { ThemedText } from '@/components/themed-text';
import { ConfirmSheet } from '@/components/ui/confirm-sheet';
import { Button, Toggle } from '@/components/ui/controls';
import { Row } from '@/components/ui/layout';
import { ScreenScaffold } from '@/components/ui/screen-scaffold';
import { useToast } from '@/components/ui/toast';
import { Spacing } from '@/constants/theme';
import { useLargeTextLayout } from '@/hooks/use-large-text-layout';
import { tapped } from '@/lib/haptics';
import { t, tf } from '@/lib/i18n';
import { listLearnedFormatsForSettings, type LearnedFormatSettingsItem } from '@/lib/learned-alert-formats';
import { LEARNED_POST_THRESHOLD } from '@/lib/learned-format-capture';
import { useStore } from '@/lib/store';

function statusLabel(item: LearnedFormatSettingsItem): string {
  return t(item.status === 'blocked' ? 'learnedFormatsStopped'
    : item.status === 'automatic' ? 'learnedFormatsAutomatic' : 'learnedFormatsLearning');
}

/**
 * Settings → Learned bank formats. Lists each learned format by sender and a
 * MASKED shape only (never message text), with how often it was confirmed;
 * forget one or all; switch automatic adding off.
 */
export default function LearnedFormatsScreen() {
  const router = useRouter();
  const toast = useToast();
  const largeText = useLargeTextLayout();
  const { state, forgetLearnedFormat, setLearnedFormatAutoPost } = useStore();
  const [forgetting, setForgetting] = useState<LearnedFormatSettingsItem | 'all' | null>(null);
  const items = useMemo(
    () => listLearnedFormatsForSettings(state.learnedAlertFormats, { postThreshold: LEARNED_POST_THRESHOLD }),
    [state.learnedAlertFormats],
  );
  const autoPost = state.learnedFormatAutoPost !== false;

  const forget = (target: LearnedFormatSettingsItem | 'all') => {
    forgetLearnedFormat(target === 'all' ? null : target.id)
      .catch(() => toast.show(t('learnedFormatsSaveFailed'), { tone: 'error' }));
  };

  return (
    <>
      <ScreenScaffold
        testID="learned-formats-screen"
        header={{ title: t('learnedFormatsTitle'), back: { label: t('back'), onPress: router.back } }}
        contentStyle={styles.content}>
        <ThemedText type="default" themeColor="textSecondary">{t('learnedFormatsIntro')}</ThemedText>

        <Row last>
          <Pressable accessible={false} style={styles.copy} onPress={() => {
            tapped();
            setLearnedFormatAutoPost(!autoPost)
              .catch(() => toast.show(t('learnedFormatsSaveFailed'), { tone: 'error' }));
          }}>
            <ThemedText type="small">{t('learnedFormatsAutoTitle')}</ThemedText>
            <ThemedText type="meta" themeColor="textTertiary">{t('learnedFormatsAutoBody')}</ThemedText>
          </Pressable>
          <Toggle value={autoPost} label={t('learnedFormatsAutoTitle')} onChange={(next) => {
            setLearnedFormatAutoPost(next)
              .catch(() => toast.show(t('learnedFormatsSaveFailed'), { tone: 'error' }));
          }} />
        </Row>

        {items.length === 0 ? (
          <ThemedText testID="learned-formats-empty" type="small" themeColor="textSecondary">
            {t('learnedFormatsEmpty')}
          </ThemedText>
        ) : (
          <View testID="learned-formats-list">
            {items.map((item, index) => {
              const sender = item.sender ?? t('learnedFormatsNoSender');
              const direction = t(item.direction === 'debit' ? 'learnedFormatsMoneyOut' : 'learnedFormatsMoneyIn');
              const facts = [direction, item.currency, tf('learnedFormatsConfirmations', { count: item.confirmations })].join(' · ');
              return (
                <Row key={item.id} last={index === items.length - 1} style={largeText && styles.rowLarge}>
                  <View testID="learned-format-row" style={styles.copy}
                    accessible accessibilityLabel={`${sender}. ${item.shape}. ${facts}. ${statusLabel(item)}`}>
                    <ThemedText type="smallBold">{sender}</ThemedText>
                    <ThemedText type="small" themeColor="textSecondary">{item.shape}</ThemedText>
                    <ThemedText type="meta" themeColor="textTertiary">{facts}</ThemedText>
                    <ThemedText type="meta" themeColor={item.status === 'blocked' ? 'warning' : 'textTertiary'}>
                      {statusLabel(item)}
                    </ThemedText>
                  </View>
                  <Button inline={!largeText} variant="outline" label={t('learnedFormatsForget')}
                    onPress={() => setForgetting(item)} />
                </Row>
              );
            })}
          </View>
        )}

        {items.length > 0 ? (
          <Button variant="danger" label={t('learnedFormatsForgetAll')} onPress={() => setForgetting('all')} />
        ) : null}
        <ThemedText type="meta" themeColor="textTertiary">{t('learnedFormatsNotGulf')}</ThemedText>
      </ScreenScaffold>

      <ConfirmSheet
        visible={forgetting !== null}
        onClose={() => setForgetting(null)}
        question={t(forgetting === 'all' ? 'learnedFormatsForgetAllQ' : 'learnedFormatsForgetOne')}
        body={t('learnedFormatsForgetOneBody')}
        confirmLabel={t('learnedFormatsForget')}
        destructive
        onConfirm={() => {
          if (forgetting) forget(forgetting);
        }}
      />
    </>
  );
}

const styles = StyleSheet.create({
  content: { gap: Spacing.four },
  copy: { flex: 1, minWidth: 0, gap: 2 },
  rowLarge: { flexDirection: 'column', alignItems: 'stretch' },
});
