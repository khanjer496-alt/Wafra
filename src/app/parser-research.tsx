import Constants from 'expo-constants';
import { useRouter } from 'expo-router';
import React, { useEffect, useMemo, useRef, useState } from 'react';
import {
  AccessibilityInfo,
  Keyboard,
  Platform,
  ScrollView,
  StyleSheet,
  TextInput,
  View,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';

import { ThemedText } from '@/components/themed-text';
import { ThemedView } from '@/components/themed-view';
import { Button } from '@/components/ui/controls';
import { Icon } from '@/components/ui/icon';
import { Block, ScreenHeader, Section, SectionHeader } from '@/components/ui/layout';
import { Fonts, MaxContentWidth, Radius, ScreenPadding, Spacing } from '@/constants/theme';
import { useTheme } from '@/hooks/use-theme';
import { requestSmsPermission } from '@/lib/auto-import';
import { t, tf } from '@/lib/i18n';
import { ledgerCurrencyDisplay } from '@/lib/markets';
import {
  buildManualParserResearchExport,
  buildParserResearchSubmissionCooperatively,
  PARSER_RESEARCH_PASTE_MAX,
  parsePastedParserMessages,
  serializeManualParserResearchExport,
  type ParserResearchProgress,
  type ParserResearchSubmission,
} from '@/lib/parser-research';
import {
  canCollectParserResearchInbox,
  collectParserResearchInbox,
  isParserResearchBuild,
} from '@/lib/parser-research-source';
import { shareTextFile } from '@/lib/share-text';
import { useStore } from '@/lib/store';

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
  const [preparingStage, setPreparingStage] = useState<'reading' | 'checking' | 'finalizing'>('reading');
  const [checked, setChecked] = useState(0);
  const [checkingTotal, setCheckingTotal] = useState(0);
  const [exporting, setExporting] = useState(false);
  const [notice, setNotice] = useState<{ title: string; body: string } | null>(null);
  const pasteInputRef = useRef<TextInput>(null);
  const blocked = state.privateMode || !enabled;
  const prepareGeneration = useRef(0);
  const blockedRef = useRef(blocked);
  blockedRef.current = blocked;

  useEffect(() => () => {
    prepareGeneration.current += 1;
  }, []);

  useEffect(() => {
    if (!blocked) return;
    prepareGeneration.current += 1;
    setPreparing(false);
    setSubmission(null);
  }, [blocked]);

  const build = useMemo(() => ({
    version: Constants.expoConfig?.version ?? '1.0.0',
    platform: Platform.OS,
    language,
    marketId: state.marketId,
    currency: ledgerCurrencyDisplay(),
  }), [language, state.marketId]);

  const manualJson = useMemo(() => {
    if (!submission) return '';
    return serializeManualParserResearchExport(
      buildManualParserResearchExport(submission),
    );
  }, [submission]);

  const prepare = async () => {
    if (blocked) return;
    if (!automaticInbox && !pasted.trim()) {
      const body = t('parserResearchPasteRequired');
      setNotice({
        title: t('parserResearchPasteRequiredTitle'),
        body,
      });
      pasteInputRef.current?.focus();
      AccessibilityInfo.announceForAccessibility(body);
      return;
    }
    Keyboard.dismiss();
    setPreparing(true);
    setPreparingStage('reading');
    setChecked(0);
    setCheckingTotal(0);
    setNotice(null);
    setSubmission(null);
    const generation = ++prepareGeneration.current;
    const isCurrent = () =>
      prepareGeneration.current === generation && !blockedRef.current;
    try {
      const messages = automaticInbox
        ? await (async () => {
            const granted = await requestSmsPermission();
            if (!granted) throw new Error('parser_research_permission');
            if (!isCurrent()) throw new Error('parser_research_cancelled');
            return collectParserResearchInbox((count) => {
              if (isCurrent()) setChecked(count);
            }, { shouldContinue: isCurrent });
          })()
        : parsePastedParserMessages(pasted);
      if (!isCurrent()) throw new Error('parser_research_cancelled');
      setPreparingStage('checking');
      setChecked(0);
      setCheckingTotal(messages.length);
      const next = await buildParserResearchSubmissionCooperatively(
        messages,
        build,
        (progress: ParserResearchProgress) => {
          if (!isCurrent()) return;
          setPreparingStage(progress.stage);
          setChecked(progress.completed);
          setCheckingTotal(progress.total);
        },
        { shouldContinue: isCurrent },
      );
      if (!isCurrent()) throw new Error('parser_research_cancelled');
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
      if (
        !isCurrent() ||
        (error instanceof Error && (
          error.message === 'parser_research_cancelled' ||
          error.message === 'sms_corpus_cancelled'
        ))
      ) return;
      setNotice(error instanceof Error && error.message === 'parser_research_permission'
        ? { title: t('smsCorpusPermissionTitle'), body: t('smsCorpusPermissionBody') }
        : { title: t('parserResearchFailedTitle'), body: t('parserResearchFailedBody') });
    } finally {
      if (isCurrent()) setPreparing(false);
    }
  };

  const exportReport = async () => {
    if (!submission || state.privateMode || !enabled) {
      setSubmission(null);
      setNotice({
        title: t('parserResearchFailedTitle'),
        body: state.privateMode
          ? t('parserResearchPrivateBlocked')
          : t('parserResearchUnavailable'),
      });
      return;
    }
    setExporting(true);
    setNotice(null);
    try {
      await shareTextFile('wafra-parser-report.json', manualJson, {
        mimeType: 'application/json',
        dialogTitle: t('parserResearchExport'),
      });
    } catch {
      setNotice({
        title: t('parserResearchExportFailedTitle'),
        body: t('parserResearchExportFailedBody'),
      });
    } finally {
      setExporting(false);
    }
  };

  const canPrepare = !blocked && !preparing;

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
                ref={pasteInputRef}
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
                    borderColor: theme.controlBorder,
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
                ? preparingStage === 'reading'
                  ? tf('parserResearchReading', { count: checked })
                  : preparingStage === 'checking'
                    ? tf('parserResearchPreparing', { count: checked, total: checkingTotal })
                    : t('parserResearchFinalizing')
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
                    {manualJson}
                  </ThemedText>
                </ScrollView>
              </Block>
              <Button
                label={exporting ? t('parserResearchExporting') : t('parserResearchExport')}
                icon="download"
                disabled={exporting || blocked}
                onPress={() => void exportReport()}
              />
              <ThemedText type="meta" themeColor="textTertiary">
                {t('parserResearchExportHelp')}
              </ThemedText>
            </Section>
          )}

          {notice && (
            <Section index={4} accessibilityLiveRegion="polite">
              <Block>
                <ThemedText type="small">{notice.title}</ThemedText>
                <ThemedText type="meta" themeColor="textSecondary">{notice.body}</ThemedText>
              </Block>
            </Section>
          )}
        </ScrollView>
      </SafeAreaView>
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
    // enough trailing scroll range for the final export button to clear the
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
