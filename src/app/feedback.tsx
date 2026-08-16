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
import React, { useEffect, useMemo, useState } from 'react';
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
import { FeedbackSendError } from '@/lib/feedback-transport';
import {
  FEEDBACK_DIAGNOSTIC_MAX_BYTES,
  serializeFeedbackWire,
} from '@/lib/feedback-wire';
import { t, tf } from '@/lib/i18n';
import { ledgerCurrencyDisplay } from '@/lib/markets';
import { shareText } from '@/lib/share-text';
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
   * The expensive half, kept OFF the render path.
   *
   * At `figures` this runs `cardDiagnostics()` over the whole ledger. Measured
   * on a 14,314-row ledger with twelve cards and sixty statements it takes
   * ~270ms in Node, which is seconds under Hermes on a mid-range phone — and
   * it used to run synchronously inside a `useMemo`, during the render caused
   * by choosing the level. So the sheet closed and the app stopped answering,
   * with no spinner, nothing to cancel, and no way to tell it apart from a
   * crash. That is what was reported: "lags and stops working when I press
   * what to attach ... selecting third option".
   *
   * It was already memoised WITHOUT the message so typing did not rebuild it.
   * That was right and is kept; it was never the problem. The problem was that
   * the one render it did run on was a render the user was watching.
   *
   * `requestIdleCallback` yields until the JS thread has room after the choice
   * tap, so React can paint the "preparing" state before the work begins. It
   * does not promise that the sheet animation has finished. This DEFERS the
   * cost, it does not remove it — the work is still one synchronous pass when
   * it fires. What it buys is that the app says what it is doing instead of
   * appearing dead, and that Send cannot fire against a payload that has not
   * been built.
   */
  const cheapest = useMemo(
    () => buildFeedbackPayload({ message: '', detail: 'none', build, ledger: EMPTY_LEDGER }),
    [build],
  );
  const [attachment, setAttachment] = useState(cheapest);
  const [preparing, setPreparing] = useState(false);
  const { accounts, transactions, cardDues, merchantOverrides } = state;

  useEffect(() => {
    let cancelled = false;
    setPreparing(true);
    const task = requestIdleCallback(() => {
      if (cancelled) return;
      const next = buildFeedbackPayload({
        message: '',
        detail,
        build,
        ledger: { accounts, transactions, cardDues, merchantOverrides },
      });
      if (cancelled) return;
      setAttachment(next);
      setPreparing(false);
    }, { timeout: 500 });
    return () => {
      cancelled = true;
      cancelIdleCallback(task);
    };
  }, [detail, build, accounts, transactions, cardDues, merchantOverrides]);

  const payload = useMemo(
    () => ({ ...attachment, message: scrubFeedbackMessage(message) }),
    [attachment, message],
  );

  const preview = useMemo(() => formatFeedbackPayload(payload), [payload]);
  const attachmentTooLarge = useMemo(
    () => serializeFeedbackWire(attachment).diagnosticBytes > FEEDBACK_DIAGNOSTIC_MAX_BYTES,
    [attachment],
  );

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

  // `preparing` gates Send as hard as an empty message does. The payload the
  // user is looking at is the one that gets posted, so sending while a level
  // is still being built would post the previous level's attachment under the
  // new level's label — the exact disagreement this screen exists to prevent.
  const ready = payload.message.length > 0 && !sending && !preparing && !attachmentTooLarge;

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
            {attachmentTooLarge && !preparing ? (
              <ThemedText type="meta" themeColor="textTertiary">
                {t('feedbackTooLargeBody')}
              </ThemedText>
            ) : !ready && !sending ? (
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
              {/* Never the previous level's report under the new level's
                  heading. While the attachment is being built the preview says
                  so and shows nothing, because a stale preview here is not a
                  cosmetic lag — it is the screen's one guarantee being false
                  for as long as the build takes. */}
              <ThemedText type="nano" themeColor="textSecondary" style={styles.preview}>
                {preparing ? t('feedbackPreparing') : preview}
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
