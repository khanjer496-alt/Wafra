import Constants from 'expo-constants';
import { useRouter } from 'expo-router';
import React, { useEffect, useMemo, useState } from 'react';
import { Keyboard, Platform, ScrollView, StyleSheet, TextInput, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';

import { ThemedText } from '@/components/themed-text';
import { ThemedView } from '@/components/themed-view';
import { ConfirmSheet } from '@/components/ui/confirm-sheet';
import { Button } from '@/components/ui/controls';
import { Icon } from '@/components/ui/icon';
import { Block, ScreenHeader, Section, SectionHeader } from '@/components/ui/layout';
import { Fonts, MaxContentWidth, Radius, ScreenPadding, Spacing } from '@/constants/theme';
import { useTheme } from '@/hooks/use-theme';
import { requestSmsPermission } from '@/lib/auto-import';
import {
  FeedbackSendError,
  submitParserResearchFeedback,
} from '@/lib/feedback-transport';
import { t, tf } from '@/lib/i18n';
import { ledgerCurrencyDisplay } from '@/lib/markets';
import {
  buildParserResearchSubmission,
  PARSER_RESEARCH_PASTE_MAX,
  parsePastedParserMessages,
  type ParserResearchSubmission,
} from '@/lib/parser-research';
import {
  canCollectParserResearchInbox,
  collectParserResearchInbox,
  isParserResearchBuild,
} from '@/lib/parser-research-source';
import { useStore } from '@/lib/store';

const researchSendFailure = (error: unknown): { title: string; body: string } => {
  if (error instanceof FeedbackSendError) {
    if (error.code === 'network') {
      return { title: t('feedbackOfflineTitle'), body: t('feedbackOfflineBody') };
    }
    if (error.code === 'too_large' || error.code === 'diagnostic_too_large') {
      return { title: t('feedbackTooLargeTitle'), body: t('feedbackTooLargeBody') };
    }
    if (error.code === 'rate_limited' || error.status === 429) {
      return { title: t('feedbackBusyTitle'), body: t('feedbackBusyBody') };
    }
    if (error.status !== null) {
      return {
        title: t('feedbackRefusedTitle'),
        body: tf('feedbackRefusedBody', { code: error.code ?? String(error.status) }),
      };
    }
  }
  return { title: t('feedbackFailedTitle'), body: t('feedbackFailedBody') };
};

export default function ParserResearchScreen() {
  const router = useRouter();
  const theme = useTheme();
  const { state } = useStore();
  const language: 'en' | 'ar' = state.language === 'ar' ? 'ar' : 'en';
  const enabled = isParserResearchBuild();
  const automaticInbox = canCollectParserResearchInbox();
  const [pasted, setPasted] = useState('');
  const [submission, setSubmission] = useState<ParserResearchSubmission | null>(null);
  const [preparing, setPreparing] = useState(false);
  const [checked, setChecked] = useState(0);
  const [confirming, setConfirming] = useState(false);
  const [sending, setSending] = useState(false);
  const [notice, setNotice] = useState<{ title: string; body: string } | null>(null);
  const blocked = state.privateMode || !enabled;

  useEffect(() => {
    if (!blocked) return;
    setSubmission(null);
    setConfirming(false);
  }, [blocked]);

  const build = useMemo(() => ({
    version: Constants.expoConfig?.version ?? '1.0.0',
    platform: Platform.OS,
    language,
    marketId: state.marketId,
    currency: ledgerCurrencyDisplay(),
  }), [language, state.marketId]);

  const prepare = async () => {
    Keyboard.dismiss();
    setPreparing(true);
    setChecked(0);
    setNotice(null);
    setSubmission(null);
    try {
      const messages = automaticInbox
        ? await (async () => {
            const granted = await requestSmsPermission();
            if (!granted) throw new Error('parser_research_permission');
            return collectParserResearchInbox(setChecked);
          })()
        : parsePastedParserMessages(pasted);
      const next = buildParserResearchSubmission(messages, build);
      // Do not retain the tester's pasted plaintext once the safe report exists.
      setPasted('');
      if (next.counts.attachedTemplates === 0) {
        setNotice({
          title: t('parserResearchNoneTitle'),
          body: t('parserResearchNoneBody'),
        });
      } else {
        setSubmission(next);
      }
    } catch (error) {
      setNotice(error instanceof Error && error.message === 'parser_research_permission'
        ? { title: t('smsCorpusPermissionTitle'), body: t('smsCorpusPermissionBody') }
        : { title: t('parserResearchFailedTitle'), body: t('parserResearchFailedBody') });
    } finally {
      setPreparing(false);
    }
  };

  const send = async () => {
    if (!submission || state.privateMode || !enabled) {
      setSubmission(null);
      setConfirming(false);
      setNotice({
        title: t('parserResearchFailedTitle'),
        body: state.privateMode
          ? t('parserResearchPrivateBlocked')
          : t('parserResearchUnavailable'),
      });
      return;
    }
    setSending(true);
    setNotice(null);
    try {
      const receipt = await submitParserResearchFeedback(submission.wire);
      setSubmission(null);
      setNotice({
        title: t('parserResearchSentTitle'),
        body: receipt.dispatched
          ? tf('parserResearchSentDispatched', { id: receipt.id })
          : tf('parserResearchSentStored', { id: receipt.id }),
      });
    } catch (error) {
      setNotice(researchSendFailure(error));
    } finally {
      setSending(false);
    }
  };

  const canPrepare = !blocked && !preparing && (automaticInbox || pasted.trim().length > 0);

  return (
    <ThemedView style={styles.root}>
      <SafeAreaView style={styles.safe} edges={['top', 'bottom']}>
        <View style={styles.headerWrap}>
          <ScreenHeader title={t('parserResearchTitle')} onBack={() => router.back()} />
        </View>
        <ScrollView
          contentContainerStyle={styles.content}
          keyboardShouldPersistTaps="handled"
          showsVerticalScrollIndicator={false}>
          <Section index={0} style={styles.group}>
            <ThemedText type="default" themeColor="textSecondary">
              {!enabled
                ? t('parserResearchUnavailable')
                : automaticInbox
                  ? t('parserResearchAndroidIntro')
                  : t(Platform.OS === 'ios'
                      ? 'parserResearchIosIntro'
                      : 'parserResearchPasteIntro')}
            </ThemedText>
            <Block style={styles.privacyCopy}>
              <Icon name="lock" size={16} color={theme.textTertiary} />
              <ThemedText type="meta" themeColor="textSecondary" style={styles.privacyText}>
                {t('parserResearchPrivacy')}
              </ThemedText>
            </Block>
          </Section>

          {enabled && !automaticInbox && (
            <Section index={1} style={styles.group}>
              <SectionHeader title={t('parserResearchPasteHeader')} />
              <ThemedText type="meta" themeColor="textTertiary">
                {t('parserResearchPasteHelp')}
              </ThemedText>
              <TextInput
                accessibilityLabel={t('parserResearchPasteA11y')}
                value={pasted}
                onChangeText={(value) => {
                  setPasted(value);
                  setSubmission(null);
                  setNotice(null);
                }}
                multiline
                maxLength={PARSER_RESEARCH_PASTE_MAX}
                placeholder={t('parserResearchPastePlaceholder')}
                placeholderTextColor={theme.textTertiary}
                style={[
                  styles.textarea,
                  {
                    backgroundColor: theme.backgroundElement,
                    borderColor: theme.cardBorder,
                    color: theme.text,
                    textAlign: language === 'ar' ? 'right' : 'left',
                  },
                ]}
              />
            </Section>
          )}

          {enabled && <Section index={2} style={styles.group}>
            {blocked && (
              <ThemedText type="meta" themeColor="textTertiary">
                {t('parserResearchPrivateBlocked')}
              </ThemedText>
            )}
            <Button
              label={preparing
                ? tf('parserResearchPreparing', { count: checked })
                : t(automaticInbox ? 'parserResearchPrepareInbox' : 'parserResearchPreparePaste')}
              icon="code"
              disabled={!canPrepare}
              onPress={() => void prepare()}
            />
          </Section>}

          {submission && (
            <Section index={3} style={styles.group}>
              <SectionHeader title={t('feedbackPreviewHeader')} />
              <ThemedText type="meta" themeColor="textTertiary">
                {t('parserResearchPreviewNote')}
              </ThemedText>
              <Block>
                <ScrollView
                  nestedScrollEnabled
                  showsVerticalScrollIndicator
                  style={styles.previewScroll}>
                  <ThemedText type="nano" themeColor="textSecondary" style={styles.preview}>
                    {submission.preview}
                  </ThemedText>
                </ScrollView>
              </Block>
              <Button
                label={sending ? t('feedbackSending') : t('parserResearchSend')}
                icon="upload"
                disabled={sending || blocked}
                onPress={() => setConfirming(true)}
              />
            </Section>
          )}

          {notice && (
            <Section index={4}>
              <Block>
                <ThemedText type="small">{notice.title}</ThemedText>
                <ThemedText type="meta" themeColor="textSecondary">{notice.body}</ThemedText>
              </Block>
            </Section>
          )}
        </ScrollView>
      </SafeAreaView>
      <ConfirmSheet
        visible={confirming && !blocked}
        onClose={() => setConfirming(false)}
        question={t('parserResearchSendQ')}
        body={t('parserResearchSendBody')}
        confirmLabel={t('parserResearchSend')}
        onConfirm={() => void send()}
      />
    </ThemedView>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1, alignItems: 'center' },
  safe: { flex: 1, width: '100%', maxWidth: MaxContentWidth },
  headerWrap: { paddingHorizontal: ScreenPadding },
  content: {
    paddingHorizontal: ScreenPadding,
    // A 280-character template plus the full provider disclosure is tall. Keep
    // enough trailing scroll range for the final consent button to clear the
    // home indicator on smaller iPhones and large Dynamic Type.
    paddingBottom: Spacing.six + 96,
    gap: Spacing.four + 2,
  },
  group: { gap: Spacing.two + 2 },
  privacyCopy: { flexDirection: 'row', alignItems: 'flex-start', gap: Spacing.two },
  privacyText: { flex: 1, lineHeight: 18 },
  textarea: {
    minHeight: 180,
    borderWidth: 1,
    borderRadius: Radius.sheet,
    padding: Spacing.three,
    fontSize: 14,
    lineHeight: 20,
    textAlignVertical: 'top',
  },
  preview: {
    fontFamily: Fonts.mono,
    lineHeight: 15,
    textAlign: 'left',
    writingDirection: 'ltr',
  },
  previewScroll: {
    maxHeight: 180,
  },
});
