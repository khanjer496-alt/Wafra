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
 *
 * Design language E: the green band holds the plain title and the optional
 * topic chips; the sheet holds the message, the exact outbound report ("What
 * we'll send", truthful to the last field) and Send.
 */
import { workflowCopy } from '@/components/workflows/workflow-copy';
import Constants from 'expo-constants';
import { useRouter, type Href } from 'expo-router';
import React, { useMemo, useState } from 'react';
import {
  Platform,
  Pressable,
  StyleSheet,
  View,
} from 'react-native';

import { BandTitle } from '@/components/settings-band/band-title';
import { SettingsGroupTitle, SettingsLinkRow } from '@/components/settings-rows';
import { ThemedText } from '@/components/themed-text';
import { EButton } from '@/components/ui/band/e-button';
import { BandScaffold, type BandNav } from '@/components/ui/band-scaffold';
import { ConfirmSheet } from '@/components/ui/confirm-sheet';
import { TextField } from '@/components/ui/text-field';
import { BandLayout, Fonts, Spacing, type BandPalette } from '@/constants/theme';
import { useBand } from '@/hooks/use-band';
import {
  buildFeedbackPayload,
  FEEDBACK_MESSAGE_MAX,
  FeedbackTransportMissingError,
  formatFeedbackPayload,
  scrubFeedbackMessage,
  submitFeedback,
} from '@/lib/feedback';
import { feedbackCopy } from '@/lib/feedback-copy';
import { FeedbackSendError } from '@/lib/feedback-transport';
import { FEEDBACK_TOPICS, type FeedbackTopic } from '@/lib/feedback-wire';
import { tapped } from '@/lib/haptics';
import { t, tf } from '@/lib/i18n';
import { ledgerCurrencyDisplay } from '@/lib/markets';
import { isParserResearchBuild } from '@/lib/parser-research-source';
import { settingsECopy } from '@/lib/settings-e-copy';
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
  // Design language E: Feedback is a flow, so it wears the green band.
  const band = useBand('flow');
  const router = useRouter();
  const { state } = useStore();

  const language: 'en' | 'ar' = state.language === 'ar' ? 'ar' : 'en';
  const version = Constants.expoConfig?.version ?? '1.0.0';

  const [message, setMessage] = useState('');
  const [confirming, setConfirming] = useState(false);
  const [sending, setSending] = useState(false);
  const [notice, setNotice] = useState<{ title: string; body: string } | null>(null);
  // Declared last so earlier hook positions are unchanged.
  const [topic, setTopic] = useState<FeedbackTopic | null>(null);
  const chipCopy = feedbackCopy(language);

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
      topic,
      message: scrubFeedbackMessage(message),
      detail: 'none',
      build,
      ledger: EMPTY_LEDGER,
    }),
    [build, message, topic],
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

  const words = workflowCopy(language);
  const eWords = settingsECopy(language);
  const feedbackNav: BandNav = { back: true };

  return (
    <>
      <BandScaffold
        band="flow"
        testID="feedback-screen"
        keyboardAware
        nav={feedbackNav}
        contentStyle={styles.content}
        scrollProps={{ keyboardShouldPersistTaps: 'handled', showsVerticalScrollIndicator: false }}
        bandContent={(
          <View style={styles.bandBody}>
            <BandTitle title={t('sendFeedback')} palette={band} testID="feedback-title" />
            <View style={styles.typeHead}>
              <ThemedText type="smallBold" style={{ color: band.onBand }}>{chipCopy.typeHeader}</ThemedText>
              <ThemedText type="meta" style={{ color: band.onBandSecondary }}>{chipCopy.typeOptional}</ThemedText>
            </View>
            <View style={styles.chips} testID="feedback-topic-chips" accessibilityRole="radiogroup"
              accessibilityLabel={chipCopy.typeHeader}>
              {FEEDBACK_TOPICS.map((value) => {
                const selected = topic === value;
                return (
                  <TopicChip
                    key={value}
                    testID={`feedback-topic-${value}`}
                    palette={band}
                    label={chipCopy.topic[value]}
                    selected={selected}
                    onPress={() => {
                      tapped();
                      // Tapping the chosen chip again clears the choice: the type is optional.
                      setTopic(selected ? null : value);
                      setNotice(null);
                    }}
                  />
                );
              })}
            </View>
          </View>
        )}>
          {isParserResearchBuild() && (
            <View style={styles.group}>
              <SettingsGroupTitle title={eWords.feedbackParser} palette={band} />
              <SettingsLinkRow
                palette={band}
                title={t('feedbackParserTitle')}
                subtitle={t('feedbackParserDetail')}
                icon="code"
                last
                onPress={() => router.push('/parser-research' as Href)}
              />
            </View>
          )}

          <View style={styles.group}>
            <SettingsGroupTitle title={eWords.feedbackMessage} palette={band} />
            <ThemedText type="meta" style={{ color: band.textSecondary }}>{words.feedbackBody}</ThemedText>
            <TextField
              label={t('feedbackInputA11y')}
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
              style={styles.textarea}
            />
            <View style={styles.metaRow}>
              <ThemedText type="meta" style={[styles.metaGrow, { color: band.textSecondary }]}>
                {t('feedbackDigitsMasked')}
              </ThemedText>
              <ThemedText type="meta" tabular style={{ color: band.textSecondary }}>
                {tf('feedbackChars', { used: message.length, max: FEEDBACK_MESSAGE_MAX })}
              </ThemedText>
            </View>
          </View>

          {/* Show the exact outbound preview before the confirmation action. */}
          <View style={styles.group} testID="feedback-what-we-send">
            <SettingsGroupTitle title={eWords.feedbackWhatWeSend} palette={band} />
            <ThemedText type="meta" style={{ color: band.textSecondary }}>
              {t('feedbackPreviewNote')}
            </ThemedText>
            <View style={[styles.previewCard, { backgroundColor: band.card, borderColor: band.rule }]}>
              {/* Always left-aligned and LTR-read, in the mono face: this is a
                  machine-readable report whose indentation is load-bearing, and
                  mirroring it under RTL would shred the card diagnostic's
                  columns without making a single line easier to read. */}
              <ThemedText type="code" style={[styles.preview, { color: band.textSecondary }]}>
                {preview}
              </ThemedText>
            </View>
          </View>
          <View style={styles.group}>
            <EButton
              palette={band}
              label={sending ? t('feedbackSending') : t('feedbackSend')}
              icon="upload"
              disabled={!ready}
              onPress={() => setConfirming(true)}
            />
            {!ready && !sending ? (
              <ThemedText type="meta" style={{ color: band.textSecondary }}>
                {t('feedbackNeedsMessage')}
              </ThemedText>
            ) : null}
            {notice && (
              <View accessibilityLiveRegion="polite" style={[styles.previewCard, { backgroundColor: band.card, borderColor: band.rule }]}>
                <ThemedText type="smallBold" style={{ color: band.text }}>{notice.title}</ThemedText>
                <ThemedText type="meta" style={{ color: band.textSecondary }}>
                  {notice.body}
                </ThemedText>
              </View>
            )}
          </View>
      </BandScaffold>

      <ConfirmSheet
        visible={confirming}
        onClose={() => setConfirming(false)}
        question={t('feedbackSendQ')}
        body={t('feedbackSendBody')}
        confirmLabel={t('feedbackSend')}
        onConfirm={() => void send()}
      />
    </>
  );
}

/**
 * One topic on the band: a 38pt chip in the band's own tone (BandChip's
 * look) that is a radio, because exactly one topic — or none — is chosen.
 * Tapping the chosen one again clears it.
 */
function TopicChip({ label, selected, onPress, palette, testID }: {
  label: string;
  selected: boolean;
  onPress: () => void;
  palette: BandPalette;
  testID?: string;
}) {
  const fg = selected ? palette.onSelected : palette.onBand;
  return (
    <Pressable testID={testID} accessibilityRole="radio" accessibilityLabel={label}
      accessibilityState={{ checked: selected, selected }} onPress={onPress} hitSlop={3}
      style={({ pressed }) => [styles.chip, { backgroundColor: selected ? palette.selected : palette.tile, opacity: pressed ? 0.75 : 1 }]}>
      <ThemedText type={selected ? 'smallBold' : 'small'} style={{ color: fg }}>{label}</ThemedText>
    </Pressable>
  );
}

const styles = StyleSheet.create({
  chip: {
    minHeight: BandLayout.chipHeight,
    borderRadius: BandLayout.chipHeight / 2,
    paddingHorizontal: 16,
    justifyContent: 'center',
    alignItems: 'center',
  },
  content: {
    gap: Spacing.four,
  },
  bandBody: { gap: 14, paddingBottom: Spacing.two },
  typeHead: { flexDirection: 'row', alignItems: 'baseline', flexWrap: 'wrap', columnGap: Spacing.two },
  group: {
    gap: Spacing.two,
  },
  textarea: {
    minHeight: 120,
    fontSize: 15,
    lineHeight: 21,
    textAlignVertical: 'top',
  },
  chips: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: Spacing.two,
  },
  metaRow: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    gap: Spacing.two,
  },
  metaGrow: {
    flex: 1,
  },
  previewCard: {
    gap: Spacing.one,
    padding: Spacing.three,
    borderRadius: 18,
    borderWidth: StyleSheet.hairlineWidth,
  },
  preview: {
    fontFamily: Fonts.mono,
    lineHeight: 15,
    textAlign: 'left',
    writingDirection: 'ltr',
  },
});
