/**
 * Send feedback.
 *
 * The screen is built around one rule, and every layout decision on it follows
 * from that rule rather than from taste: THE USER READS WHAT THEY SEND. Not a
 * description of it, not a checklist of what "may be included" — the report
 * itself, rendered by the same `formatFeedbackPayload()` that produces the
 * bytes handed to the transport. If the two ever disagree the guarantee is
 * worthless, so there is exactly one function that turns a payload into text
 * and both the preview and the send path call it.
 *
 * Order on the screen is therefore: the box, then the choice, then the ACTION,
 * then the report. Putting the report above the button would have been the
 * tidier reading order and would have buried Send under a few thousand lines
 * of card diagnostic on a real ledger. The button names what is attached; the
 * confirmation sheet says the report above is what leaves; and the report is
 * right there for anyone who wants it, as long as it really is.
 *
 * No `Alert.alert` anywhere. On react-native-web it is `static alert() {}` — an
 * empty method — so an alert-driven confirmation puts the committing call in a
 * button that is never drawn. See routes.test.js, which pins this repo-wide.
 * The answers this screen gives are drawn inline (`notice`) and the one
 * question it asks goes through ConfirmSheet.
 */
import Constants from 'expo-constants';
import { useRouter } from 'expo-router';
import React, { useMemo, useState } from 'react';
import { Platform, ScrollView, StyleSheet, TextInput, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';

import { ThemedText } from '@/components/themed-text';
import { ThemedView } from '@/components/themed-view';
import { ChoiceSheet, type Choice } from '@/components/ui/choice-sheet';
import { ConfirmSheet } from '@/components/ui/confirm-sheet';
import { Button } from '@/components/ui/controls';
import { Icon } from '@/components/ui/icon';
import { Block, Row, ScreenHeader, Section, SectionHeader } from '@/components/ui/layout';
import { Fonts, MaxContentWidth, Radius, ScreenPadding, Spacing } from '@/constants/theme';
import { useTheme } from '@/hooks/use-theme';
import {
  buildFeedbackPayload,
  FEEDBACK_DETAILS,
  FEEDBACK_MESSAGE_MAX,
  FeedbackTransportMissingError,
  formatFeedbackPayload,
  scrubFeedbackMessage,
  submitFeedback,
  type FeedbackDetail,
} from '@/lib/feedback';
import { t, tf } from '@/lib/i18n';
import { ledgerCurrencyDisplay } from '@/lib/markets';
import { shareText } from '@/lib/share-text';
import { useStore } from '@/lib/store';

/** The three levels, each with the one sentence that decides between them. */
const DETAIL_COPY: Record<FeedbackDetail, { label: () => string; hint: () => string }> = {
  none: { label: () => t('feedbackDetailNone'), hint: () => t('feedbackDetailNoneHint') },
  shapes: { label: () => t('feedbackDetailShapes'), hint: () => t('feedbackDetailShapesHint') },
  figures: { label: () => t('feedbackDetailFigures'), hint: () => t('feedbackDetailFiguresHint') },
};

export default function FeedbackScreen() {
  const theme = useTheme();
  const router = useRouter();
  const { state } = useStore();

  const language: 'en' | 'ar' = state.language === 'ar' ? 'ar' : 'en';
  const version = Constants.expoConfig?.version ?? '1.0.0';

  const [message, setMessage] = useState('');
  const [detail, setDetail] = useState<FeedbackDetail>('none');
  const [detailSheet, setDetailSheet] = useState(false);
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

  /**
   * The expensive half, memoised WITHOUT the message.
   *
   * At `figures` this runs `cardDiagnostics()` over the whole ledger, and
   * rebuilding it on every keystroke would make the box stutter on exactly the
   * phones that have most to report. The message is a plain string field, so
   * it is folded in below where it costs nothing — and the two together are
   * still one payload produced by one function, which is what the preview
   * guarantee rests on.
   */
  const attachment = useMemo(
    () =>
      buildFeedbackPayload({
        message: '',
        detail,
        build,
        ledger: {
          accounts: state.accounts,
          transactions: state.transactions,
          cardDues: state.cardDues,
          merchantOverrides: state.merchantOverrides,
        },
      }),
    [detail, build, state.accounts, state.transactions, state.cardDues, state.merchantOverrides],
  );

  const payload = useMemo(
    () => ({ ...attachment, message: scrubFeedbackMessage(message) }),
    [attachment, message],
  );

  const preview = useMemo(() => formatFeedbackPayload(payload), [payload]);

  /**
   * Private Mode does not hide the other two levels, it disables them WITH the
   * reason on the row.
   *
   * Same call the country picker makes for a market pack the ledger will not
   * accept: an option that is simply absent teaches the user the app cannot do
   * it, while an option greyed out under one line of explanation teaches them
   * what the constraint actually is — and here the constraint is a setting
   * they chose and can go and change.
   */
  const choices: Choice<FeedbackDetail>[] = FEEDBACK_DETAILS.map((value) => {
    const blocked = state.privateMode && value !== 'none';
    return {
      value,
      label: DETAIL_COPY[value].label(),
      detail: blocked ? t('feedbackPrivateBlocked') : DETAIL_COPY[value].hint(),
      disabled: blocked,
    };
  });

  const ready = payload.message.length > 0 && !sending;

  const send = async () => {
    setSending(true);
    setNotice(null);
    try {
      const receipt = await submitFeedback(payload);
      setMessage('');
      setNotice({ title: t('feedbackSentTitle'), body: tf('feedbackSentBody', { id: receipt.id }) });
    } catch (error) {
      // Two different truths, and collapsing them is how a user ends up
      // retrying a build that has no transport in it at all. The stub throws a
      // named error precisely so this branch can exist.
      setNotice(
        error instanceof FeedbackTransportMissingError
          ? { title: t('feedbackNoTransportTitle'), body: t('feedbackNoTransportBody') }
          : { title: t('feedbackFailedTitle'), body: t('feedbackFailedBody') },
      );
    } finally {
      setSending(false);
    }
  };

  // The report as a FILE, not as an intent payload: at `figures` it carries
  // every card row and crosses Android's Binder ceiling, which kills the app
  // outright rather than failing a promise. See share-text.ts.
  const saveCopy = () => {
    shareText('wafra-feedback.txt', preview).catch(() => {});
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

          <Section index={1} style={styles.group}>
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

          <Section index={2} style={styles.group}>
            <SectionHeader title={t('feedbackAttachHeader')} />
            <Row onPress={() => setDetailSheet(true)} last accessibilityLabel={t('feedbackAttachRow')}>
              <View style={styles.rowText}>
                <ThemedText type="small">{t('feedbackAttachRow')}</ThemedText>
                <ThemedText type="meta" themeColor="textTertiary">
                  {DETAIL_COPY[payload.detail].label()}
                </ThemedText>
              </View>
              <Icon name={chevron} size={15} color={theme.textTertiary} />
            </Row>
            {/* The setting is respected out loud. `buildFeedbackPayload` forces
                the level down to `none` whatever this screen asks for, and a
                user whose choice was overridden silently would rightly read
                that as the app doing something behind their back. */}
            {state.privateMode && (
              <Block style={styles.privacyCopy}>
                <Icon name="lock" size={16} color={theme.textTertiary} />
                <ThemedText type="meta" themeColor="textSecondary" style={styles.privacyCopyText}>
                  {t('feedbackPrivateOn')}
                </ThemedText>
              </Block>
            )}
          </Section>

          <Section index={3} style={styles.group}>
            <Button
              label={sending ? t('feedbackSending') : t('feedbackSend')}
              icon="upload"
              disabled={!ready}
              onPress={() => setConfirming(true)}
            />
            <Button label={t('feedbackSaveCopy')} variant="outline" onPress={saveCopy} />
            {!ready && !sending && (
              <ThemedText type="meta" themeColor="textTertiary">
                {t('feedbackNeedsMessage')}
              </ThemedText>
            )}
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

      {/* Outside the ScrollView: a sheet mounted inside a scrolling parent
          inherits its clipping and its scroll offset on web. */}
      <ChoiceSheet
        visible={detailSheet}
        onClose={() => setDetailSheet(false)}
        title={t('feedbackAttachRow')}
        options={choices}
        value={payload.detail}
        onSelect={setDetail}
      />
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
  privacyCopy: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    gap: Spacing.two,
  },
  privacyCopyText: {
    flex: 1,
    lineHeight: 18,
  },
  preview: {
    fontFamily: Fonts.mono,
    lineHeight: 15,
    textAlign: 'left',
    writingDirection: 'ltr',
  },
});
