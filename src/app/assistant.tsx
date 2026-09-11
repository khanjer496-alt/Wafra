import { useRouter } from 'expo-router';
import React, { useMemo, useState } from 'react';
import { Pressable, StyleSheet, TextInput, View } from 'react-native';

import { ThemedText } from '@/components/themed-text';
import { Button } from '@/components/ui/controls';
import { Icon } from '@/components/ui/icon';
import { ScreenScaffold } from '@/components/ui/screen-scaffold';
import { Radius, Spacing } from '@/constants/theme';
import { useLargeTextLayout } from '@/hooks/use-large-text-layout';
import { useTheme } from '@/hooks/use-theme';
import { t } from '@/lib/i18n';
import { useStore } from '@/lib/store';
import { answerWafraQuestion, suggestedAssistantQuestions, type AssistantAnswer } from '@/lib/wafra-assistant';

export default function AssistantScreen() {
  const router = useRouter();
  const theme = useTheme();
  const largeText = useLargeTextLayout();
  const { state } = useStore();
  const suggestions = useMemo(() => suggestedAssistantQuestions(state), [state]);
  const [question, setQuestion] = useState('');
  const [answer, setAnswer] = useState<AssistantAnswer | null>(null);

  const ask = (value = question) => {
    const clean = value.trim();
    if (!clean) return;
    setQuestion(clean);
    setAnswer(answerWafraQuestion(state, clean));
  };

  return (
    <ScreenScaffold
      keyboardAware
      header={{
        title: t('assistantTitle'),
        back: { label: t('assistantBack'), onPress: () => router.back() },
      }}>
      <View style={styles.hero}>
        <View style={[styles.spark, { backgroundColor: theme.primarySoft }]}>
          <Icon name="spark" size={22} color={theme.primary} />
        </View>
        <View style={styles.heroCopy}>
          <ThemedText type="heading">{t('assistantHeading')}</ThemedText>
          <ThemedText type="default" themeColor="textSecondary">
            {t('assistantPrivacy')}
          </ThemedText>
        </View>
      </View>

      <View style={styles.suggestions}>
        {suggestions.map((item) => (
          <Pressable
            key={item}
            accessibilityRole="button"
            onPress={() => ask(item)}
            style={[styles.suggestion, { borderColor: theme.cardBorder, backgroundColor: theme.backgroundElement }]}>
            <ThemedText type="small">{item}</ThemedText>
            <Icon name="chevron-right" size={16} color={theme.textTertiary} />
          </Pressable>
        ))}
      </View>

      {answer ? (
        <View
          accessibilityLiveRegion="polite"
          style={[styles.answer, { borderColor: theme.primaryBorder, backgroundColor: theme.primarySoft }]}>
          <ThemedText type="micro" themeColor="primary">{answer.title}</ThemedText>
          <ThemedText type="default">{answer.body}</ThemedText>
          {answer.facts?.length ? (
            <View style={styles.facts}>
              {answer.facts.map((fact) => (
                <View key={`${fact.label}-${fact.value}`} style={[styles.factRow, largeText && styles.factRowLarge]}>
                  <ThemedText type="meta" themeColor="textSecondary" style={styles.factLabel}>{fact.label}</ThemedText>
                  <ThemedText type="smallBold" tabular>{fact.value}</ThemedText>
                </View>
              ))}
            </View>
          ) : null}
        </View>
      ) : null}

      <View style={styles.composer}>
        <TextInput
          value={question}
          onChangeText={setQuestion}
          onSubmitEditing={() => ask()}
          returnKeyType="send"
          accessibilityLabel={t('assistantPlaceholder')}
          maxLength={1000}
          placeholder={t('assistantPlaceholder')}
          placeholderTextColor={theme.textTertiary}
          style={[styles.input, { color: theme.text, borderColor: theme.controlBorder, backgroundColor: theme.backgroundElement }]}
        />
        <Button label={t('assistantAsk')} icon="spark" onPress={() => ask()} disabled={!question.trim()} />
      </View>
    </ScreenScaffold>
  );
}

const styles = StyleSheet.create({
  hero: { flexDirection: 'row', gap: 12, alignItems: 'flex-start' },
  spark: { width: 40, height: 40, borderRadius: Radius.tile, alignItems: 'center', justifyContent: 'center' },
  heroCopy: { flex: 1, minWidth: 0, gap: 4 },
  suggestions: { gap: 8 },
  suggestion: {
    minHeight: 52,
    borderWidth: StyleSheet.hairlineWidth,
    borderRadius: Radius.control,
    paddingHorizontal: 14,
    paddingVertical: 10,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: 10,
  },
  answer: { borderWidth: StyleSheet.hairlineWidth, borderRadius: Radius.sheet, padding: 14, gap: 10 },
  facts: { gap: 6, paddingTop: Spacing.one },
  factRow: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'baseline', gap: 12 },
  factRowLarge: { flexDirection: 'column', alignItems: 'stretch', gap: 2 },
  factLabel: { flex: 1 },
  composer: { gap: 8, paddingTop: Spacing.one },
  input: {
    minHeight: 52,
    borderWidth: 1,
    borderRadius: Radius.control,
    paddingHorizontal: 14,
    paddingVertical: 12,
    fontSize: 15,
  },
});
