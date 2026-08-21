/**
 * Send feedback.
 *
 * Ordinary feedback is deliberately message-only. It never scans the ledger,
 * builds card diagnostics, or opens a file share sheet, so typing and sending
 * stay constant-time even on a large history. The exact wire report remains
 * visible before confirmation.
 *
 * Parser evidence is a separate action in internal builds. It opens the
 * bounded parser-research flow, which performs its own on-device filtering,
 * exact preview and named GitHub/AI consent. Keeping the two purposes separate
 * makes the ordinary path simple without weakening the parser path's privacy
 * contract.
 *
 * No `Alert.alert` anywhere. On react-native-web it is `static alert() {}` — an
 * empty method — so an alert-driven confirmation puts the committing call in a
 * button that is never drawn. See routes.test.js, which pins this repo-wide.
 * The answers this screen gives are drawn inline (`notice`) and the one
 * question it asks goes through ConfirmSheet.
 */
import Constants from 'expo-constants';
import { useRouter, type Href } from 'expo-router';
import React, { useMemo, useState } from 'react';
import {
  Platform,
  ScrollView,
  StyleSheet,
  TextInput,
  View,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';

import { ThemedText } from '@/components/themed-text';
import { ThemedView } from '@/components/themed-view';
import { ConfirmSheet } from '@/components/ui/confirm-sheet';
import { Button } from '@/components/ui/controls';
import { Icon } from '@/components/ui/icon';
import { Block, Row, ScreenHeader, Section, SectionHeader } from '@/components/ui/layout';
import { Fonts, MaxContentWidth, Radius, ScreenPadding, Spacing } from '@/constants/theme';
import { useTheme } from '@/hooks/use-theme';
import {
  buildFeedbackPayload,
  FEEDBACK_MESSAGE_MAX,
  FeedbackTransportMissingError,
  formatFeedbackPayload,
  scrubFeedbackMessage,
  submitFeedback,
} from '@/lib/feedback';
import { FeedbackSendError } from '@/lib/feedback-transport';
import { t, tf } from '@/lib/i18n';
import { ledgerCurrencyDisplay } from '@/lib/markets';
import { isParserResearchBuild } from '@/lib/parser-research-source';
import { useStore } from '@/lib/store';

/**
 * Why the report did not go, in the user's terms — and specifically whether
 * trying again is worth their time.
 *
 * The send handler used to answer this with two branches: "no transport in
 * this build", and everything else as "try again later". Its own comment made
 * the case against that — "collapsing them is how a user ends up retrying a
 * build that has no transport in it at all" — and then collapsed the five
 * causes underneath.
 *
 * The distinction it was drawing is real but it drew it in the wrong place.
 * `no_relay_url` is the SAME failure as a missing transport: a build that
 * shipped without a server address will fail identically forever, and "later"
 * never arrives. A 413 needs a smaller attachment. A 4xx will be refused again
 * unchanged. Only a network failure is actually worth retrying, and it was the
 * one case the old wording happened to fit.
 *
 * Exported for the suite: this is a pure mapping and testing it through a
 * rendered screen would test React instead.
 */
export function describeSendFailure(error: unknown): { title: string; body: string } {
  if (error instanceof FeedbackTransportMissingError) {
    return { title: t('feedbackNoTransportTitle'), body: t('feedbackNoTransportBody') };
  }
  if (error instanceof FeedbackSendError) {
    switch (error.code) {
      case 'no_relay_url':
        return { title: t('feedbackFailedTitle'), body: t('feedbackNoRelayBody') };
      case 'network':
        return { title: t('feedbackOfflineTitle'), body: t('feedbackOfflineBody') };
      case 'too_large':
      case 'diagnostic_too_large':
        return { title: t('feedbackTooLargeTitle'), body: t('feedbackTooLargeBody') };
      case 'rate_limited':
        return { title: t('feedbackBusyTitle'), body: t('feedbackBusyBody') };
    }
    // A 429 the Worker did not label is still a rate limit, and saying "send
    // it again in a while" is right for it and wrong for the 4xx above it.
    if (error.status === 429) {
      return { title: t('feedbackBusyTitle'), body: t('feedbackBusyBody') };
    }
    if (error.status !== null) {
      return {
        title: t('feedbackRefusedTitle'),
        body: tf('feedbackRefusedBody', { code: error.code ?? String(error.status) }),
      };
    }
  }
  // Everything unrecognised, including `bad_response` and `no_id`: the report
  // may or may not have arrived, so the only honest advice is to keep a copy.
  return { title: t('feedbackFailedTitle'), body: t('feedbackFailedBody') };
}

/**
 * The ledger the cheap placeholder payload is built from. A constant so its
 * identity never changes and the memo holding it never re-runs.
 */
const EMPTY_LEDGER: Parameters<typeof buildFeedbackPayload>[0]['ledger'] = {
  accounts: [],
  transactions: [],
  cardDues: [],
  merchantOverrides: {},
};

export default function FeedbackScreen() {
  const theme = useTheme();
  const router = useRouter();
  const { state } = useStore();

  const language: 'en' | 'ar' = state.language === 'ar' ? 'ar' : 'en';
  const version = Constants.expoConfig?.version ?? '1.0.0';

  const [message, setMessage] = useState('');
  const [confirming, setConfirming] = useState(false);
  const [sending, setSending] = useState(false);
  const [notice, setNotice] = useState<{ title: string; body: string } | null>(null);

  const build = useMemo(
    () => ({
      version,
      platform: Platform.OS,
      language,
      marketId: state.marketId,
      currency: ledgerCurrencyDisplay(),
      privateMode: state.privateMode,
    }),
    [version, language, state.marketId, state.privateMode],
  );

  const payload = useMemo(
    () => buildFeedbackPayload({
      message: scrubFeedbackMessage(message),
      detail: 'none',
      build,
      ledger: EMPTY_LEDGER,
    }),
    [build, message],
  );

  const preview = useMemo(() => formatFeedbackPayload(payload), [payload]);
  const ready = payload.message.length > 0 && !sending;

  const send = async () => {
    setSending(true);
    setNotice(null);
    try {
      const receipt = await submitFeedback(payload);
      setMessage('');
      setNotice({ title: t('feedbackSentTitle'), body: tf('feedbackSentBody', { id: receipt.id }) });
    } catch (error) {
      setNotice(describeSendFailure(error));
    } finally {
      setSending(false);
    }
  };

  const chevron = language === 'ar' ? 'chevron-left' : 'chevron-right';

  return (
    <ThemedView style={styles.root}>
      <SafeAreaView style={styles.safe} edges={['top', 'bottom']}>
        <View style={styles.headerWrap}>
          <ScreenHeader title={t('sendFeedback')} onBack={() => router.back()} />
        </View>

        <ScrollView
          contentContainerStyle={styles.content}
          keyboardShouldPersistTaps="handled"
          showsVerticalScrollIndicator={false}>
          <Section index={0}>
            <ThemedText type="default" themeColor="textSecondary">
              {t('feedbackIntro')}
            </ThemedText>
          </Section>

          {isParserResearchBuild() && (
            <Section index={1} style={styles.group}>
              <SectionHeader title={t('feedbackParserHeader')} />
              <Row
                onPress={() => router.push('/parser-research' as Href)}
                last
                accessibilityLabel={t('feedbackParserTitle')}>
                <View style={styles.parserIcon}>
                  <Icon name="code" size={19} color={theme.primary} />
                </View>
                <View style={styles.rowText}>
                  <ThemedText type="small">{t('feedbackParserTitle')}</ThemedText>
                  <ThemedText type="meta" themeColor="textTertiary">
                    {t('feedbackParserDetail')}
                  </ThemedText>
                </View>
                <Icon name={chevron} size={15} color={theme.textTertiary} />
              </Row>
            </Section>
          )}

          <Section index={2} style={styles.group}>
            <SectionHeader title={t('feedbackWriteHeader')} />
            <TextInput
              accessibilityLabel={t('feedbackInputA11y')}
              value={message}
              onChangeText={(next) => {
                setMessage(next);
                // A notice is about the report that produced it. Editing the
                // box makes it stale, so it goes when the text does.
                setNotice(null);
              }}
              multiline
              maxLength={FEEDBACK_MESSAGE_MAX}
              placeholder={t('feedbackPlaceholder')}
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
            <View style={styles.metaRow}>
              <ThemedText type="meta" themeColor="textTertiary" style={styles.metaGrow}>
                {t('feedbackDigitsMasked')}
              </ThemedText>
              <ThemedText type="meta" themeColor="textTertiary">
                {tf('feedbackChars', { used: message.length, max: FEEDBACK_MESSAGE_MAX })}
              </ThemedText>
            </View>
          </Section>

          <Section index={3} style={styles.group}>
            <Button
              label={sending ? t('feedbackSending') : t('feedbackSend')}
              icon="upload"
              disabled={!ready}
              onPress={() => setConfirming(true)}
            />
            {!ready && !sending ? (
              <ThemedText type="meta" themeColor="textTertiary">
                {t('feedbackNeedsMessage')}
              </ThemedText>
            ) : null}
            {notice && (
              <Block>
                <ThemedText type="small">{notice.title}</ThemedText>
                <ThemedText type="meta" themeColor="textSecondary">
                  {notice.body}
                </ThemedText>
              </Block>
            )}
          </Section>

          {/* The whole point of the screen. Last, because it is long. */}
          <Section index={4} style={styles.group}>
            <SectionHeader title={t('feedbackPreviewHeader')} />
            <ThemedText type="meta" themeColor="textTertiary">
              {t('feedbackPreviewNote')}
            </ThemedText>
            <Block>
              {/* Always left-aligned and LTR-read, in the mono face: this is a
                  machine-readable report whose indentation is load-bearing, and
                  mirroring it under RTL would shred the card diagnostic's
                  columns without making a single line easier to read. */}
              <ThemedText type="nano" themeColor="textSecondary" style={styles.preview}>
                {preview}
              </ThemedText>
            </Block>
          </Section>
        </ScrollView>
      </SafeAreaView>

      <ConfirmSheet
        visible={confirming}
        onClose={() => setConfirming(false)}
        question={t('feedbackSendQ')}
        body={t('feedbackSendBody')}
        confirmLabel={t('feedbackSend')}
        onConfirm={() => void send()}
      />
    </ThemedView>
  );
}

const styles = StyleSheet.create({
  root: {
    flex: 1,
    alignItems: 'center',
  },
  safe: {
    flex: 1,
    width: '100%',
    maxWidth: MaxContentWidth,
  },
  headerWrap: {
    paddingHorizontal: ScreenPadding,
  },
  content: {
    paddingHorizontal: ScreenPadding,
    paddingBottom: Spacing.six,
    gap: Spacing.four + 2,
  },
  group: {
    gap: Spacing.two + 2,
  },
  textarea: {
    minHeight: 120,
    borderWidth: 1,
    borderRadius: Radius.sheet,
    padding: Spacing.three,
    fontSize: 15,
    lineHeight: 21,
    textAlignVertical: 'top',
  },
  metaRow: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    gap: Spacing.two,
  },
  metaGrow: {
    flex: 1,
  },
  rowText: {
    flex: 1,
    gap: Spacing.half,
  },
  parserIcon: {
    width: 36,
    height: 36,
    alignItems: 'center',
    justifyContent: 'center',
  },
  preview: {
    fontFamily: Fonts.mono,
    lineHeight: 15,
    textAlign: 'left',
    writingDirection: 'ltr',
  },
});
