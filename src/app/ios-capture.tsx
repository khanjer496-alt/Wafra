/**
 * iOS automatic capture — pairing and setup.
 *
 * On Android this screen does not exist: the app reads the SMS inbox directly
 * and nothing leaves the phone. iOS gives no app access to SMS at all, so the
 * only route is a Shortcuts automation the user builds themselves, posting
 * each bank message to the relay. This screen is where they get the URL and
 * token to paste into it.
 *
 * It is written to be honest about the trade rather than to sell it. The two
 * limits at the bottom — no history, and setup happening in another app — are
 * the reasons a meaningful share of users will not finish, and hiding them
 * would only move the disappointment later.
 */
import * as Clipboard from 'expo-clipboard';
import { useRouter } from 'expo-router';
import React, { useCallback, useEffect, useState } from 'react';
import { Alert, Linking, ScrollView, StyleSheet, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';

import { ThemedText } from '@/components/themed-text';
import { ThemedView } from '@/components/themed-view';
import { Button } from '@/components/ui/controls';
import { Icon } from '@/components/ui/icon';
import { Block, Row, ScreenHeader, Section, SectionHeader } from '@/components/ui/layout';
import { useToast } from '@/components/ui/toast';
import { MaxContentWidth, Radius, ScreenPadding, Spacing } from '@/constants/theme';
import { useTheme } from '@/hooks/use-theme';
import { getPairing, isRelayConfigured, pair, unpair, type Pairing } from '@/lib/relay';

const STEPS: { title: string; body: string }[] = [
  {
    title: 'Open Shortcuts → Automation',
    body: 'Tap +, then "When I get a message". Shortcuts is an Apple app; it is already on the phone.',
  },
  {
    title: 'Choose your banks as senders',
    body: 'Add the sender IDs your bank texts from — ADCB, FAB, Liv, Emirates NBD. Set it to Run Immediately and turn the notification off.',
  },
  {
    title: 'Add one action: Get Contents of URL',
    body: 'Paste the URL below, set Method to POST, and add the two headers below.',
  },
  {
    title: 'Set the request body',
    body: 'Request Body: JSON. Add a text field named "text" and set its value to the Shortcut Input. Optionally add a "sender" field set to the message sender, which is how Wafra learns which bank a new card belongs to.',
  },
];

export default function IosCaptureScreen() {
  const theme = useTheme();
  const router = useRouter();
  const toast = useToast();

  const [pairing, setPairing] = useState<Pairing | null>(null);
  const [loading, setLoading] = useState(true);
  const [working, setWorking] = useState(false);

  useEffect(() => {
    getPairing()
      .then(setPairing)
      .finally(() => setLoading(false));
  }, []);

  const onPair = useCallback(async () => {
    setWorking(true);
    try {
      setPairing(await pair());
    } catch {
      // The message names the likely cause rather than the error code: at this
      // point the only realistic failures are no network and a Worker that was
      // never deployed, and neither is something a status number explains.
      Alert.alert(
        'Could not reach the relay',
        'Check your connection and try again. If this keeps happening, the relay for this build may not be deployed yet.',
      );
    } finally {
      setWorking(false);
    }
  }, []);

  const onUnpair = useCallback(() => {
    Alert.alert(
      'Turn off automatic capture?',
      'This erases the device key and anything still queued. Transactions already imported stay. You will need to delete the Shortcut automation yourself.',
      [
        { text: 'Cancel', style: 'cancel' },
        {
          text: 'Turn off',
          style: 'destructive',
          onPress: async () => {
            setWorking(true);
            try {
              await unpair();
              setPairing(null);
              toast.show('Automatic capture is off.');
            } finally {
              setWorking(false);
            }
          },
        },
      ],
    );
  }, [toast]);

  const copy = useCallback(
    async (label: string, value: string) => {
      await Clipboard.setStringAsync(value);
      toast.show(`${label} copied.`);
    },
    [toast],
  );

  const copyRow = (label: string, value: string, mask = false) => (
    <Row onPress={() => copy(label, value)} accessibilityLabel={`Copy ${label}`}>
      <View style={styles.rowText}>
        <ThemedText type="meta" themeColor="textTertiary">
          {label}
        </ThemedText>
        <ThemedText type="code" numberOfLines={1} style={styles.value}>
          {mask ? `${value.slice(0, 10)}${'•'.repeat(12)}` : value}
        </ThemedText>
      </View>
      <Icon name="upload" size={15} color={theme.textTertiary} />
    </Row>
  );

  return (
    <ThemedView style={styles.root}>
      <SafeAreaView style={styles.safe} edges={['top', 'bottom']}>
        <View style={styles.headerWrap}>
          <ScreenHeader title="Automatic capture" onBack={() => router.back()} />
        </View>

        <ScrollView contentContainerStyle={styles.content} showsVerticalScrollIndicator={false}>
          <Section index={0} style={styles.intro}>
            <ThemedText type="default" themeColor="textSecondary">
              iPhone gives no app access to your messages, so Wafra cannot read them the way
              the Android app does. What it can do is receive them from a Shortcut you build
              once — about six taps, in an app you may never have opened.
            </ThemedText>
          </Section>

          {!isRelayConfigured() ? (
            <Section index={1}>
              <Block style={styles.notice}>
                <Icon name="alert" size={20} color={theme.textSecondary} />
                <ThemedText type="small">This build has no relay</ThemedText>
                <ThemedText type="default" themeColor="textSecondary">
                  EXPO_PUBLIC_WAFRA_RELAY_URL was not set when this app was built, so there
                  is nothing to pair with. Everything else in Wafra works; only automatic
                  capture is unavailable.
                </ThemedText>
              </Block>
            </Section>
          ) : loading ? null : !pairing ? (
            <Section index={1} style={styles.intro}>
              <Button
                label={working ? 'Setting up…' : 'Set up automatic capture'}
                icon="download"
                disabled={working}
                onPress={onPair}
              />
              <ThemedText type="meta" themeColor="textTertiary">
                This creates a key on this phone. The key never leaves it, and there is no
                account, email or password involved.
              </ThemedText>
            </Section>
          ) : (
            <>
              <Section index={1}>
                <SectionHeader title="Paste these into the Shortcut" />
                {copyRow('URL', pairing.ingestUrl)}
                {copyRow('Authorization', `Bearer ${pairing.token}`, true)}
                {copyRow('Content-Type', 'application/json')}
                <Row last>
                  <ThemedText type="meta" themeColor="textTertiary">
                    Tap any row to copy it. The token is the only thing protecting your
                    queue — treat it like a password.
                  </ThemedText>
                </Row>
              </Section>

              <Section index={2}>
                <SectionHeader title="Build the automation" />
                {STEPS.map((s, i) => (
                  <Row key={i} last={i === STEPS.length - 1}>
                    <View style={styles.stepIndex}>
                      <ThemedText type="code" themeColor="textTertiary">
                        {i + 1}
                      </ThemedText>
                    </View>
                    <View style={styles.rowText}>
                      <ThemedText type="small">{s.title}</ThemedText>
                      <ThemedText type="meta" themeColor="textTertiary">
                        {s.body}
                      </ThemedText>
                    </View>
                  </Row>
                ))}
              </Section>

              <Section index={3} style={styles.intro}>
                <Button
                  label="Open Shortcuts"
                  variant="outline"
                  icon="arrow-up-right"
                  onPress={() => {
                    Linking.openURL('shortcuts://').catch(() => {
                      toast.show('Could not open Shortcuts.');
                    });
                  }}
                />
                <Button
                  label="Turn off automatic capture"
                  variant="danger"
                  icon="trash"
                  disabled={working}
                  onPress={onUnpair}
                />
              </Section>
            </>
          )}

          <Section index={4}>
            <SectionHeader title="Two things to know" />
            <Row>
              <View style={styles.rowText}>
                <ThemedText type="small">It starts empty</ThemedText>
                <ThemedText type="meta" themeColor="textTertiary">
                  A Shortcut only fires on new messages, so there is no history to import.
                  The Android app scans years of inbox; here you accumulate from today. Use
                  statement import for the past.
                </ThemedText>
              </View>
            </Row>
            <Row last>
              <View style={styles.rowText}>
                <ThemedText type="small">Only the parsed row is stored</ThemedText>
                <ThemedText type="meta" themeColor="textTertiary">
                  The relay reads each message, keeps the merchant, amount and date, and
                  drops the text. What it keeps is encrypted to this phone and deleted the
                  moment the app collects it.
                </ThemedText>
              </View>
            </Row>
          </Section>
        </ScrollView>
      </SafeAreaView>
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
  },
  intro: {
    gap: Spacing.three - 2,
    paddingBottom: Spacing.four,
  },
  notice: {
    alignItems: 'flex-start',
    gap: Spacing.two,
    padding: Spacing.three,
    borderRadius: Radius.sheet,
  },
  rowText: {
    flex: 1,
    gap: Spacing.two - 3,
  },
  value: {
    fontSize: 12.5,
  },
  stepIndex: {
    width: 22,
  },
});
