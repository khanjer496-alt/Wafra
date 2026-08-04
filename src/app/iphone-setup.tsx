/**
 * iPhone capture — the setup flow, and afterwards the control panel for it.
 *
 * WHY THIS IS A SCREEN AND NOT A SETTINGS ROW. On Android, Wafra's promise
 * ("you never type a transaction") is delivered by a permission dialog. On
 * iPhone, Apple gives no app access to Messages, so the same promise is
 * delivered by a Shortcuts personal automation the user builds by hand in
 * Apple's app. That is roughly ten taps we do not control, in an app most
 * people have never opened, and one of those taps — the run mode — silently
 * decides whether the product works at all. A flow that walks the user through
 * it is not onboarding polish; it is the feature.
 *
 * FOUR RULES THIS SCREEN IS BUILT AROUND.
 *
 * 1. BE HONEST ABOUT THE TAP COUNT. Four here, about ten in Shortcuts. The flow
 *    says so on the first screen instead of implying we control all fourteen,
 *    because a user who expects three taps and meets fourteen abandons at tap
 *    five.
 *
 * 2. TEACH THE ONE THING THAT CANNOT BE AUTOMATED. There is no file format
 *    field, no URL parameter and no API that presets "Run Immediately". Left on
 *    "Ask Before Running", every bank message waits for a tap that never comes,
 *    Wafra stays empty, and the user blames Wafra. It gets its own step and the
 *    loudest treatment on the screen.
 *
 * 3. END ON PROOF, NOT ON "YOU ARE ALL SET". The last step waits for a real
 *    captured transaction and shows it — the actual merchant, the actual
 *    amount, filed into the actual ledger. Believing it works and hoping it
 *    works are different products.
 *
 * 4. TELL THE TRUTH ABOUT WHAT LEAVES THE PHONE. The Shortcut's filter is three
 *    characters wide, so messages that are not from a bank do reach the relay.
 *    They are parsed, nothing is stored, and the text is dropped — but it left
 *    the device, and that belongs on this screen rather than only in a privacy
 *    label.
 *
 * The screen is also the only place that unpairs, because unpairing has a
 * consequence nothing in the app can undo: the bearer token is baked into the
 * user's Shortcut, and no code here can reach in and fix it.
 */
import Constants from 'expo-constants';
import * as Clipboard from 'expo-clipboard';
import * as Linking from 'expo-linking';
import { useRouter } from 'expo-router';
import React, { useCallback, useEffect, useRef, useState } from 'react';
import { Alert, Platform, Pressable, ScrollView, StyleSheet, View } from 'react-native';
import Animated, { FadeIn, FadeInDown } from 'react-native-reanimated';
import { SafeAreaView } from 'react-native-safe-area-context';

import { describeRelay, relativeSince, useRelayStatus } from '@/components/relay-status';
import { ThemedText } from '@/components/themed-text';
import { ThemedView } from '@/components/themed-view';
import { Button } from '@/components/ui/controls';
import { Icon, type IconName } from '@/components/ui/icon';
import { Block, LabelTable, Row, ScreenHeader, Section } from '@/components/ui/layout';
import { Money } from '@/components/ui/money';
import { PulseDot } from '@/components/ui/states';
import { CategoryTile } from '@/components/ui/tile';
import { useToast } from '@/components/ui/toast';
import { Fonts, MaxContentWidth, Radius, ScreenPadding, Spacing } from '@/constants/theme';
import { useTheme } from '@/hooks/use-theme';
import { getCategory } from '@/lib/categories';
import { shortDate } from '@/lib/format';
import { getActiveMarket } from '@/lib/markets';
import { isProActive, requiresPro } from '@/lib/purchases';
import {
  configuredRelayUrl,
  getRelayPairing,
  isRelaySupported,
  pairRelay,
  runRelayImport,
  unpairRelay,
  type RelayPairing,
} from '@/lib/relay';
import {
  ensureRelayWake,
  relayWakeStatus,
  stopRelayWake,
  type RelayWakeStatus,
} from '@/lib/relay-wake';
import { useStore } from '@/lib/store';
import type { Transaction } from '@/lib/types';

/* ───────────────────────── Configuration ───────────────────────── */

/**
 * The iCloud share link for the ready-made "Wafra Capture" shortcut.
 *
 * It is READ FROM CONFIG, never hardcoded in a component. iCloud share links
 * are bound to the Apple ID that created them, re-sharing mints a new URL, and
 * deleting the source shortcut breaks every link already handed out. Baking one
 * into the binary means a single accidental deletion bricks setup for every new
 * user until an App Store release ships.
 */
function configuredShortcutUrl(): string | null {
  const extra = Constants.expoConfig?.extra as { shortcutUrl?: unknown } | undefined;
  const url = typeof extra?.shortcutUrl === 'string' ? extra.shortcutUrl.trim() : '';
  return url || null;
}

/** Opens the Shortcuts app. There is no scheme that lands on the Automation tab. */
const SHORTCUTS_SCHEME = 'shortcuts://';

/**
 * The one substring every UAE bank alert carries. Not a bank sender ID: the
 * Message trigger's Sender field only accepts contacts and phone numbers, and
 * bank alerts arrive from alphanumeric sender IDs it will not match. Three
 * characters cover every bank at once.
 */
function messageFilter(): string {
  return getActiveMarket().currency.code;
}

/* ───────────────────────── Steps ───────────────────────── */

type Step = 'why' | 'pair' | 'shortcut' | 'automation' | 'proof' | 'live';

/** The walkthrough, in order. `live` is the control panel and sits outside it. */
const WALKTHROUGH: Step[] = ['why', 'pair', 'shortcut', 'automation', 'proof'];

/* ───────────────────────── Small parts ───────────────────────── */

/**
 * Progress as a rail of segments rather than "Step 3 of 5" alone: the flow is
 * long enough that a user needs to see the end of it from the middle.
 */
function StepRail({ index }: { index: number }) {
  const theme = useTheme();
  return (
    <View
      style={styles.rail}
      accessibilityRole="progressbar"
      accessibilityLabel={`Step ${index + 1} of ${WALKTHROUGH.length}`}>
      {WALKTHROUGH.map((s, i) => (
        <View
          key={s}
          style={[
            styles.railSegment,
            { backgroundColor: i <= index ? theme.primary : theme.track },
          ]}
        />
      ))}
    </View>
  );
}

/** Eyebrow + headline + standfirst. Every step opens the same way. */
function StepHead({
  eyebrow,
  title,
  body,
}: {
  eyebrow: string;
  title: string;
  body?: string;
}) {
  return (
    <View style={styles.head}>
      <ThemedText type="micro" themeColor="textTertiary">
        {eyebrow}
      </ThemedText>
      <ThemedText style={styles.headline}>{title}</ThemedText>
      {body && (
        <ThemedText type="default" themeColor="textSecondary">
          {body}
        </ThemedText>
      )}
    </View>
  );
}

/** A divider row with an icon: the shape onboarding uses for its three points. */
function PointRow({
  icon,
  title,
  detail,
  tone = 'default',
  last,
}: {
  icon: IconName;
  title: string;
  detail: string;
  tone?: 'default' | 'warning';
  last?: boolean;
}) {
  const theme = useTheme();
  return (
    <Row last={last}>
      <View style={styles.pointIcon}>
        <Icon
          name={icon}
          size={18}
          color={tone === 'warning' ? theme.warning : theme.textSecondary}
        />
      </View>
      <View style={styles.rowText}>
        <ThemedText type="small">{title}</ThemedText>
        <ThemedText type="meta" themeColor="textTertiary">
          {detail}
        </ThemedText>
      </View>
    </Row>
  );
}

/**
 * A numbered instruction that happens in Apple's app, not ours.
 *
 * `emphasis` exists for exactly one of them. Making every step look important
 * is the same as making none of them look important, and there is precisely one
 * step here where a miss costs the user the entire product.
 */
function TapStep({
  n,
  title,
  detail,
  emphasis,
  last,
}: {
  n: number;
  title: string;
  detail?: string;
  emphasis?: boolean;
  last?: boolean;
}) {
  const theme = useTheme();

  if (emphasis) {
    return (
      <View
        style={[
          styles.emphasis,
          { backgroundColor: theme.primarySoft, borderColor: theme.primaryBorder },
        ]}>
        <View style={styles.emphasisHead}>
          <View style={[styles.numberDot, { backgroundColor: theme.primary }]}>
            <ThemedText type="nano" style={{ color: theme.onPrimary, letterSpacing: 0 }}>
              {n}
            </ThemedText>
          </View>
          <ThemedText type="small" style={{ color: theme.primary, flex: 1 }}>
            {title}
          </ThemedText>
        </View>
        {detail && (
          <ThemedText type="meta" themeColor="textSecondary">
            {detail}
          </ThemedText>
        )}
      </View>
    );
  }

  return (
    <Row last={last}>
      <View style={[styles.numberDot, { borderWidth: 1, borderColor: theme.cardBorderStrong }]}>
        <ThemedText type="nano" themeColor="textTertiary" style={{ letterSpacing: 0 }}>
          {n}
        </ThemedText>
      </View>
      <View style={styles.rowText}>
        <ThemedText type="small">{title}</ThemedText>
        {detail && (
          <ThemedText type="meta" themeColor="textTertiary">
            {detail}
          </ThemedText>
        )}
      </View>
    </Row>
  );
}

/** A secret, shown as mono, with the copy affordance that makes it usable. */
function CopyField({
  label,
  value,
  masked,
  note,
}: {
  label: string;
  value: string;
  /** Bearer tokens are shown as a fingerprint until the user asks for them. */
  masked?: boolean;
  note?: string;
}) {
  const theme = useTheme();
  const [copied, setCopied] = useState(false);
  const [revealed, setRevealed] = useState(!masked);

  const copy = async () => {
    await Clipboard.setStringAsync(value);
    setCopied(true);
    setTimeout(() => setCopied(false), 2400);
  };

  const shown = revealed ? value : `${value.slice(0, 6)}${'·'.repeat(18)}${value.slice(-4)}`;

  return (
    <View style={styles.copyField}>
      <View style={styles.copyHead}>
        <ThemedText type="micro" themeColor="textTertiary">
          {label}
        </ThemedText>
        {masked && (
          <Pressable accessibilityRole="button" hitSlop={8} onPress={() => setRevealed((r) => !r)}>
            <ThemedText type="micro" style={{ color: theme.primary }}>
              {revealed ? 'Hide' : 'Show'}
            </ThemedText>
          </Pressable>
        )}
      </View>
      <View
        style={[
          styles.copyBox,
          { borderColor: theme.cardBorder, backgroundColor: theme.backgroundElement },
        ]}>
        <ThemedText type="code" themeColor="textSecondary" style={styles.copyValue}>
          {shown}
        </ThemedText>
        <Button
          variant={copied ? 'ghost' : 'outline'}
          label={copied ? 'Copied' : 'Copy'}
          icon={copied ? 'check' : undefined}
          onPress={copy}
          style={styles.copyButton}
        />
      </View>
      {note && (
        <ThemedText type="meta" themeColor="textTertiary">
          {note}
        </ThemedText>
      )}
    </View>
  );
}

/* ───────────────────────── Screen ───────────────────────── */

export default function IphoneSetupScreen() {
  const theme = useTheme();
  const router = useRouter();
  const toast = useToast();
  const { state, importBatch, undoBatch } = useStore();

  const [step, setStep] = useState<Step | null>(null);
  // Pairing, syncing and unpairing all change the relay's state without this
  // screen ever losing focus, so the status hook is told to re-read on every
  // step change and after every action that touches the relay.
  const [reload, setReload] = useState(0);
  const status = useRelayStatus(`${step}:${reload}`);
  const [pairing, setPairing] = useState<RelayPairing | null>(null);
  const [pairError, setPairError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const relayUrl = configuredRelayUrl();
  const shortcutUrl = configuredShortcutUrl();
  const supported = isRelaySupported();

  /* ── Where the screen opens ──────────────────────────────────────────
     Already paired means this is a control panel, not a wizard. Sending a
     paired user back to "here is what iPhone capture is" would be the single
     most annoying thing this screen could do. */
  useEffect(() => {
    if (step !== null || status === null) return;
    setStep(status.paired ? 'live' : 'why');
  }, [status, step]);

  useEffect(() => {
    if (!supported) return;
    getRelayPairing()
      .then(setPairing)
      .catch(() => {});
  }, [supported]);

  /* ── How fast a captured row will actually land ──────────────────────
     Read, never assumed. A phone with notifications declined or Background
     App Refresh off still captures everything — it collects on launch instead
     of in seconds — and this screen must say which of those it is rather than
     promising the good case to everyone. */
  const [wake, setWake] = useState<RelayWakeStatus | null>(null);
  useEffect(() => {
    if (!supported || !pairing) return;
    let alive = true;
    // Registering here as well as on Home matters: a user who has just paired
    // is exactly the user whose layers have never been turned on.
    ensureRelayWake()
      .then((s) => alive && setWake(s))
      .catch(() => {
        relayWakeStatus()
          .then((s) => alive && setWake(s))
          .catch(() => {});
      });
    return () => {
      alive = false;
    };
  }, [supported, pairing, reload]);

  /** One sentence about latency that is true on THIS phone. */
  const deliveryLine = (): string => {
    if (wake?.push === 'on') {
      return 'Wafra is woken the moment a message is captured, so entries appear within seconds.';
    }
    if (wake?.background === 'on') {
      return 'Wafra collects in the background on iOS’s own schedule, and whenever you open it. Nothing is lost as long as that happens once every three days.';
    }
    return 'Wafra collects whatever is waiting each time you open it. Nothing is lost as long as that happens once every three days.';
  };

  const stepIndex = step ? WALKTHROUGH.indexOf(step) : -1;

  /* ── Pairing ─────────────────────────────────────────────────────── */

  const runPair = useCallback(async () => {
    setBusy(true);
    setPairError(null);
    try {
      const result = await pairRelay({ market: state.marketId });
      setPairing(result);
    } catch (e) {
      setPairError(e instanceof Error ? e.message : 'Pairing failed');
    } finally {
      setBusy(false);
    }
  }, [state.marketId]);

  useEffect(() => {
    if (step === 'pair' && !pairing && !busy && !pairError) runPair();
  }, [step, pairing, busy, pairError, runPair]);

  /* ── Proof: wait for a real transaction ──────────────────────────── */

  const [checks, setChecks] = useState(0);
  const [waitingSince, setWaitingSince] = useState(0);
  const [caught, setCaught] = useState<{ ids: string[]; rows: Omit<Transaction, 'id'>[] } | null>(
    null,
  );
  const [testState, setTestState] = useState<'idle' | 'sending' | 'sent' | 'error'>('idle');
  const [testNote, setTestNote] = useState<string | null>(null);

  // The polling loop reads the store, and importing changes the store. Holding
  // the latest values in a ref keeps the interval from being torn down and
  // rebuilt on every ledger write — which would reset its timer and, on a busy
  // account, mean it never actually fires.
  const latest = useRef({ state, importBatch });
  latest.current = { state, importBatch };

  useEffect(() => {
    if (step !== 'proof' || caught) return;
    let cancelled = false;

    const tick = async () => {
      try {
        const result = await runRelayImport(latest.current.state, latest.current.importBatch);
        if (cancelled) return;
        setChecks((c) => c + 1);
        // A trial that lapses mid-setup would otherwise poll forever against a
        // sync that refuses to run, showing "listening" while nothing can
        // arrive. Automatic capture is the paid feature; say so and stop.
        if (result.skipped === 'not-pro') {
          setStep('live');
          router.push('/pro');
          return;
        }
        if (result.ids.length > 0 && result.plan) {
          setCaught({ ids: result.ids, rows: result.plan.batch.transactions });
        }
      } catch {
        // A failed poll is not an error worth showing: the next one is five
        // seconds away and the queue holds rows for 72 hours regardless.
      }
    };

    tick();
    const handle = setInterval(tick, 5_000);
    return () => {
      cancelled = true;
      clearInterval(handle);
    };
  }, [step, caught, router]);

  useEffect(() => {
    if (step === 'proof' && waitingSince === 0) setWaitingSince(Date.now());
  }, [step, waitingSince]);

  /**
   * Send one message through the real pipe.
   *
   * This is not a simulation — it POSTs to the same `/v1/ingest` the Shortcut
   * will, with the same token, and the row comes back sealed through
   * `/v1/sync`. It proves pairing, the relay URL, the token, the market pack
   * and the seal in one round trip, and it is the only path an App Review
   * tester can follow without a UAE bank account. What it does NOT prove is the
   * automation, which is why it is the secondary action here and not the
   * primary one.
   */
  const sendTest = async () => {
    const id = pairing ?? (await getRelayPairing());
    if (!id) return;
    setTestState('sending');
    setTestNote(null);
    const now = new Date();
    const dd = String(now.getDate()).padStart(2, '0');
    const mm = String(now.getMonth() + 1).padStart(2, '0');
    const currency = getActiveMarket().currency.display;
    const text =
      `Purchase of ${currency} 1.00 with Debit Card ending 0000 at WAFRA SETUP TEST ` +
      `on ${dd}/${mm}/${now.getFullYear()}.`;
    try {
      const res = await fetch(id.ingestUrl, {
        method: 'POST',
        headers: {
          authorization: `Bearer ${id.token}`,
          'content-type': 'application/json',
        },
        body: JSON.stringify({ text, sender: 'WAFRA', receivedAt: now.toISOString() }),
      });
      if (res.status === 202) {
        setTestState('sent');
        setTestNote('Sent. It should come back through the relay within a few seconds.');
        return;
      }
      setTestState('error');
      setTestNote(
        res.status === 204
          ? 'The relay read it and found no transaction in it. That is a parser problem, not a setup problem.'
          : res.status === 401
            ? 'The relay rejected this phone. Set up again to pair a fresh key.'
            : res.status === 429
              ? 'Too many messages just now. Wait a minute and try again.'
              : `The relay answered ${res.status}.`,
      );
    } catch {
      setTestState('error');
      setTestNote('Could not reach the relay. Check your connection and try again.');
    }
  };

  /* ── Manual actions ──────────────────────────────────────────────── */

  const openShortcutLink = async () => {
    if (!shortcutUrl) return;
    try {
      await Linking.openURL(shortcutUrl);
    } catch {
      toast.show('Could not open Shortcuts. Copy the link and open it in Safari.');
    }
  };

  const openShortcutsApp = async () => {
    try {
      await Linking.openURL(SHORTCUTS_SCHEME);
    } catch {
      toast.show('Shortcuts is not installed on this iPhone.');
    }
  };

  const checkNow = async () => {
    setBusy(true);
    try {
      const result = await runRelayImport(state, importBatch);
      if (result.skipped === 'not-pro') {
        router.push('/pro');
        return;
      }
      if (result.ids.length > 0) {
        toast.show(
          `Filed ${result.ids.length} entr${result.ids.length === 1 ? 'y' : 'ies'}`,
          [{ label: 'Undo', onPress: () => undoBatch(result.ids) }],
        );
      } else if (result.sync?.error) {
        toast.show('Could not reach the relay just now.');
      } else {
        toast.show('Nothing new waiting.');
      }
    } finally {
      setBusy(false);
      setReload((r) => r + 1);
    }
  };

  const confirmUnpair = () => {
    Alert.alert(
      'Turn off iPhone capture?',
      'The relay erases this phone and everything queued for it. Your Shortcut keeps running and ' +
        'will start failing — delete it in the Shortcuts app, or nothing it sends will arrive.',
      [
        { text: 'Cancel', style: 'cancel' },
        {
          text: 'Turn off',
          style: 'destructive',
          onPress: async () => {
            setBusy(true);
            try {
              // The wake layers go first: a background task that keeps firing
              // for an unpaired device is a battery cost with nothing to fetch.
              await stopRelayWake();
              await unpairRelay();
              setPairing(null);
              setWake(null);
              setCaught(null);
              setChecks(0);
              setWaitingSince(0);
              setStep('why');
              toast.show('Capture is off. Delete the Wafra shortcut in Shortcuts too.');
            } finally {
              setBusy(false);
              setReload((r) => r + 1);
            }
          },
        },
      ],
    );
  };

  /* ── Guard states ────────────────────────────────────────────────── */

  const header = (title: string) => (
    <View style={styles.headerWrap}>
      <ScreenHeader title={title} onBack={() => router.back()} />
    </View>
  );

  if (!supported) {
    return (
      <ThemedView style={styles.root}>
        <SafeAreaView style={styles.safe} edges={['top', 'bottom']}>
          {header('iPhone capture')}
          <View style={styles.content}>
            <StepHead
              eyebrow="iPhone only"
              title="This one is for iPhone."
              body={
                Platform.OS === 'android'
                  ? 'On Android Wafra reads bank messages directly on the phone, with no relay and no network. There is nothing to set up here — turn on SMS reading in Settings instead.'
                  : 'Automatic capture needs the iPhone app. Everything else in Wafra works here.'
              }
            />
            <Button label="Back to Wafra" onPress={() => router.back()} />
          </View>
        </SafeAreaView>
      </ThemedView>
    );
  }

  if (!relayUrl) {
    return (
      <ThemedView style={styles.root}>
        <SafeAreaView style={styles.safe} edges={['top', 'bottom']}>
          {header('iPhone capture')}
          <View style={styles.content}>
            <StepHead
              eyebrow="Not available"
              title="Automatic capture is not switched on in this build."
              body="Wafra has no relay to pair with, so bank messages cannot be forwarded. Everything else works: add entries by hand, or paste a bank message to have it read for you."
            />
            <View style={styles.actions}>
              <Button label="Paste a bank message" onPress={() => router.push('/import-sms')} />
              <Button variant="outline" label="Back" onPress={() => router.back()} />
            </View>
            <ThemedText type="meta" themeColor="textTertiary">
              For whoever builds this app: deploy server/ and set expo.extra.relayUrl in app.json.
            </ThemedText>
          </View>
        </SafeAreaView>
      </ThemedView>
    );
  }

  /* ── Steps ───────────────────────────────────────────────────────── */

  const filter = messageFilter();

  const body = () => {
    switch (step) {
      /* ── 1. What this is, and what it costs ─────────────────────── */
      case 'why':
        return (
          <>
            <StepHead
              eyebrow="Step 1 of 5"
              title="Your iPhone can do this. It needs setting up once."
              body="Apple lets no app read your messages — so instead you build a Shortcut that hands each bank alert to Wafra the moment it lands. After that you never type a transaction again."
            />
            <View>
              <PointRow
                icon="mail"
                title="Bank messages file themselves"
                detail="Amount, merchant, card and category, the second the text arrives"
              />
              <PointRow
                icon="lock"
                title="The message is read, then thrown away"
                detail="Wafra's relay parses it, drops the text, and seals the row to this iPhone. It cannot read back what it stored."
              />
              <PointRow
                icon="alert"
                tone="warning"
                title={`Messages containing "${filter}" leave the phone`}
                detail="The filter is three characters wide, so the odd non-bank message goes too. Nothing that is not a transaction is ever stored."
                last
              />
            </View>
            <Block>
              <ThemedText type="micro" themeColor="textTertiary">
                What it takes
              </ThemedText>
              <View style={styles.split}>
                <View style={styles.splitCell}>
                  <ThemedText type="small" tabular style={styles.splitFigure}>
                    4
                  </ThemedText>
                  <ThemedText type="meta" themeColor="textTertiary">
                    taps in Wafra
                  </ThemedText>
                </View>
                <View
                  style={[
                    styles.splitCell,
                    styles.splitDivider,
                    { borderLeftColor: theme.cardBorder },
                  ]}>
                  <ThemedText type="small" tabular style={styles.splitFigure}>
                    10
                  </ThemedText>
                  <ThemedText type="meta" themeColor="textTertiary">
                    in Apple&apos;s Shortcuts app
                  </ThemedText>
                </View>
              </View>
              <ThemedText type="meta" themeColor="textTertiary">
                We walk you through every one of the ten. Apple owns that screen, so nobody can do it
                for you — but nobody should have to guess at it either.
              </ThemedText>
            </Block>
            <View style={styles.actions}>
              <Button
                label="Start setup"
                onPress={() => {
                  // Automatic capture is the paid feature on both platforms —
                  // the Android inbox scan is gated the same way. Pasting a
                  // message is not, which is why the wall below it is an
                  // alternative rather than a dead end.
                  if (requiresPro('relayCapture') && !isProActive(state)) {
                    router.push('/pro');
                    return;
                  }
                  setStep('pair');
                }}
              />
              <Button
                variant="ghost"
                label="Paste a message instead"
                onPress={() => router.push('/import-sms')}
              />
            </View>
          </>
        );

      /* ── 2. Pair ────────────────────────────────────────────────── */
      case 'pair':
        return (
          <>
            <StepHead
              eyebrow="Step 2 of 5"
              title={pairing ? 'This iPhone has a key of its own.' : 'Making this iPhone a key.'}
              body={
                pairing
                  ? 'No email, no password, no account. Your iPhone generated a key, sent the public half once, and keeps the private half in the keychain. Every row the relay queues is locked to it.'
                  : 'No account to create — just a key generated on this device.'
              }
            />

            {pairError ? (
              <Block tone="expense">
                <View style={styles.errorHead}>
                  <Icon name="alert" size={17} color={theme.expense} />
                  <ThemedText type="small" style={{ color: theme.expense }}>
                    Could not pair
                  </ThemedText>
                </View>
                <ThemedText type="meta" themeColor="textSecondary">
                  {pairError}
                </ThemedText>
                <View style={styles.actionsInline}>
                  <Button inline variant="outline" label="Try again" onPress={runPair} />
                </View>
              </Block>
            ) : pairing ? (
              <Animated.View entering={FadeIn.duration(300)}>
                <LabelTable
                  rows={[
                    {
                      label: 'Relay',
                      value: (
                        <ThemedText type="code" themeColor="textSecondary">
                          {relayUrl.replace(/^https?:\/\//, '')}
                        </ThemedText>
                      ),
                    },
                    {
                      label: 'This iPhone',
                      value: (
                        <ThemedText type="code" themeColor="textSecondary">
                          {pairing.deviceId.slice(0, 8)}
                        </ThemedText>
                      ),
                    },
                    {
                      label: 'Reads as',
                      value: (
                        <ThemedText type="small">
                          {getActiveMarket().name} · {getActiveMarket().currency.code}
                        </ThemedText>
                      ),
                    },
                  ]}
                />
              </Animated.View>
            ) : (
              <View style={styles.pairing}>
                <PulseDot color={theme.primary} />
                <ThemedText type="meta" themeColor="textTertiary">
                  Generating a key and pairing…
                </ThemedText>
              </View>
            )}

            <View style={styles.actions}>
              <Button label="Next" onPress={() => setStep('shortcut')} disabled={!pairing} />
            </View>
          </>
        );

      /* ── 3. The Shortcut ────────────────────────────────────────── */
      case 'shortcut':
        return (
          <>
            <StepHead
              eyebrow="Step 3 of 5"
              title="Add the Wafra shortcut."
              body={
                shortcutUrl
                  ? 'Copy your key, then open the shortcut. It asks for the key while it installs — tap the box, tap Paste, tap Add Shortcut.'
                  : 'This build has no ready-made shortcut to install, so it is built by hand. It is three actions and takes about two minutes.'
              }
            />

            {pairing && (
              <CopyField
                label="Your key"
                value={pairing.token}
                masked
                note="It goes into the shortcut and nowhere else. While it is on the clipboard any app can read it, so paste it and move on."
              />
            )}

            {shortcutUrl ? (
              <>
                <View>
                  <TapStep n={1} title="Tap Open shortcut below" />
                  <TapStep n={2} title="Tap the box that asks for your key, then Paste" />
                  <TapStep n={3} title="Tap Add Shortcut" last />
                </View>
                <View style={styles.actions}>
                  <Button label="Open shortcut" icon="upload" onPress={openShortcutLink} />
                </View>
              </>
            ) : (
              pairing && (
                <View style={styles.manual}>
                  <View>
                    <ThemedText type="micro" themeColor="textTertiary" style={styles.listLabel}>
                      In Shortcuts, new shortcut, one action
                    </ThemedText>
                    <TapStep
                      n={1}
                      title="Add the action Get Contents of URL"
                      detail="Set the method to POST"
                    />
                    <TapStep
                      n={2}
                      title="Add a header"
                      detail="Authorization · Bearer, then a space, then your key"
                    />
                    <TapStep
                      n={3}
                      title="Set the request body to JSON"
                      detail="text = Shortcut Input (message), sender = Shortcut Input (sender), receivedAt = Current Date"
                      last
                    />
                  </View>
                  <CopyField label="URL" value={pairing.ingestUrl} />
                </View>
              )
            )}

            <View style={styles.actions}>
              <Button
                variant={shortcutUrl ? 'outline' : 'filled'}
                label="I added it"
                onPress={() => setStep('automation')}
              />
            </View>
          </>
        );

      /* ── 4. The automation, and the one tap that decides it ─────── */
      case 'automation':
        return (
          <>
            <StepHead
              eyebrow="Step 4 of 5"
              title="One tap decides whether this works."
              body="Now tell iOS when to run the shortcut. This all happens in Apple's Shortcuts app, on the Automation tab."
            />

            <View>
              <TapStep n={1} title="Automation tab, then the + button" />
              <TapStep n={2} title="Scroll to Message and tap it" />
              <TapStep
                n={3}
                title={`Leave Sender empty. Type ${filter} into Message Contains`}
                detail={`Bank alerts come from names, not phone numbers, and the Sender field only matches contacts. "${filter}" is in every bank alert and catches all of them at once.`}
                last
              />
            </View>

            <TapStep
              n={4}
              emphasis
              title="Choose Run Immediately"
              detail="This is the one. Left on Ask Before Running, every bank message sits waiting for a tap, Wafra stays empty, and nothing anywhere tells you why."
            />

            <View>
              <TapStep n={5} title="Next, then pick the Wafra shortcut" />
              <TapStep n={6} title="Done" last />
            </View>

            <Block>
              <View style={styles.errorHead}>
                <Icon name="alert" size={17} color={theme.warning} />
                <ThemedText type="small">Expect a banner every time</ThemedText>
              </View>
              <ThemedText type="meta" themeColor="textSecondary">
                Since iOS 17, an automation set to Run Immediately always posts a notification when
                it fires. Apple requires it and there is no switch to turn it off — so after each
                bank message you will see two banners, theirs and ours.
              </ThemedText>
            </Block>

            <View style={styles.actions}>
              <Button label="Open Shortcuts" icon="upload" onPress={openShortcutsApp} />
              <Button
                variant="outline"
                label="Done — I set it up"
                onPress={() => setStep('proof')}
              />
            </View>
          </>
        );

      /* ── 5. Proof ───────────────────────────────────────────────── */
      case 'proof': {
        if (caught) {
          const rows = caught.rows.slice(0, 4);
          // A screen that exists to prove the thing works must not claim credit
          // for a path that was not exercised. A test message proves pairing,
          // the relay, the token and the seal — it does NOT prove the
          // automation, and saying otherwise here would be the one lie this
          // whole flow was built to remove.
          const wasTest = caught.rows.some((r) => /wafra setup test/i.test(r.title));
          return (
            <Animated.View entering={FadeIn.duration(400)} style={styles.stepBody}>
              <StepHead
                eyebrow="Step 5 of 5"
                title={wasTest ? 'The line is open.' : 'It works.'}
                body={
                  wasTest
                    ? 'Your test went out, came back sealed, and filed itself. That proves everything except the automation — the next real bank message is what proves that.'
                    : 'That came in through your automation, was parsed, sealed, and filed — and the message itself was thrown away on the way.'
                }
              />
              <View>
                {rows.map((tx, i) => (
                  <Animated.View
                    key={`${tx.date}-${tx.title}-${i}`}
                    entering={FadeInDown.delay(i * 90).duration(320)}>
                    <Row last={i === rows.length - 1}>
                      <CategoryTile category={tx.category} />
                      <View style={styles.rowText}>
                        <ThemedText type="small" numberOfLines={1}>
                          {tx.title}
                        </ThemedText>
                        <ThemedText type="meta" themeColor="textTertiary" numberOfLines={1}>
                          {getCategory(tx.category).label} · {shortDate(tx.date)}
                        </ThemedText>
                      </View>
                      <Money
                        fils={tx.amountFils}
                        prefix={false}
                        sign={tx.type === 'income' ? 'plus' : 'minus'}
                        color={tx.type === 'income' ? theme.income : theme.text}
                      />
                    </Row>
                  </Animated.View>
                ))}
              </View>
              <ThemedText type="meta" themeColor="textTertiary">
                From here it runs on its own. {deliveryLine()}
              </ThemedText>
              <View style={styles.actions}>
                <Button label="Done" onPress={() => setStep('live')} />
                <Button
                  variant="ghost"
                  label={
                    wasTest
                      ? 'Remove the test entry'
                      : caught.ids.length === 1
                        ? 'Undo this entry'
                        : `Undo these ${caught.ids.length} entries`
                  }
                  onPress={() => {
                    undoBatch(caught.ids);
                    toast.show('Removed. Capture is still on.');
                    setCaught(null);
                  }}
                />
              </View>
            </Animated.View>
          );
        }

        const waited = waitingSince ? Math.round((Date.now() - waitingSince) / 1000) : 0;
        return (
          <>
            <StepHead
              eyebrow="Step 5 of 5"
              title="Waiting for your first message."
              body={`Buy something small, or just wait for your bank's next alert. Wafra checks every few seconds while this screen is open. ${deliveryLine()}`}
            />

            <Block>
              <View style={styles.listening}>
                <PulseDot color={theme.primary} />
                <ThemedText type="micro" themeColor="textTertiary">
                  Listening
                </ThemedText>
                <View style={styles.spacer} />
                <ThemedText type="meta" themeColor="textTertiary" tabular>
                  {checks} check{checks === 1 ? '' : 's'}
                  {waited > 0 ? ` · ${waited < 60 ? `${waited}s` : `${Math.round(waited / 60)}m`}` : ''}
                </ThemedText>
              </View>
            </Block>

            {testNote && (
              <ThemedText
                type="meta"
                style={{ color: testState === 'error' ? theme.expense : theme.textTertiary }}>
                {testNote}
              </ThemedText>
            )}

            <View style={styles.actions}>
              <Button
                variant="outline"
                label={testState === 'sending' ? 'Sending…' : 'Send a test message'}
                onPress={sendTest}
                disabled={testState === 'sending'}
              />
              <Button variant="ghost" label="I will check later" onPress={() => setStep('live')} />
            </View>

            <ThemedText type="meta" themeColor="textTertiary">
              A test goes through the real relay with your real key, so it proves everything except
              the automation itself. It files a {getActiveMarket().currency.display} 1.00 entry you
              can undo.
            </ThemedText>
          </>
        );
      }

      /* ── Control panel ──────────────────────────────────────────── */
      case 'live': {
        if (!status) return null;
        const d = describeRelay(status);
        return (
          <>
            <StepHead
              eyebrow="iPhone capture"
              title={
                d.tone === 'warn'
                  ? 'Something is not right.'
                  : d.tone === 'waiting'
                    ? 'Set up. Nothing captured yet.'
                    : 'Capture is running.'
              }
              body={d.detail}
            />

            {d.tone === 'warn' && (
              <Block tone="expense">
                <View style={styles.errorHead}>
                  <Icon name="alert" size={17} color={theme.expense} />
                  <ThemedText type="small" style={{ color: theme.expense }}>
                    {d.title}
                  </ThemedText>
                </View>
                <ThemedText type="meta" themeColor="textSecondary">
                  {status.lastError === 'unauthorized'
                    ? 'The relay no longer recognises this iPhone. Pair again, then replace the key inside your shortcut.'
                    : `Open Shortcuts, find the Message automation, and check it says Run Immediately rather than Ask Before Running. Also check Message Contains is set to ${filter}.`}
                </ThemedText>
                <View style={styles.actionsInline}>
                  <Button inline variant="outline" label="Open Shortcuts" onPress={openShortcutsApp} />
                </View>
              </Block>
            )}

            <LabelTable
              rows={[
                {
                  label: 'Relay',
                  value: (
                    <ThemedText type="code" themeColor="textSecondary">
                      {relayUrl.replace(/^https?:\/\//, '')}
                    </ThemedText>
                  ),
                },
                {
                  label: 'Paired',
                  value: (
                    <ThemedText type="small">
                      {status.pairedAt ? relativeSince(status.pairedAt) : '—'}
                    </ThemedText>
                  ),
                },
                {
                  label: 'Last message',
                  value: (
                    <ThemedText type="small">
                      {status.lastRowAt ? relativeSince(status.lastRowAt) : 'None yet'}
                    </ThemedText>
                  ),
                },
                {
                  label: 'Last check',
                  value: (
                    <ThemedText type="small">
                      {status.lastSyncAt ? relativeSince(status.lastSyncAt) : 'Never'}
                    </ThemedText>
                  ),
                },
                {
                  label: 'Waiting',
                  value: (
                    <ThemedText type="small" tabular>
                      {status.pending}
                    </ThemedText>
                  ),
                },
                {
                  // The layer that is actually live, not the one we hoped for.
                  label: 'Arrives',
                  value: (
                    <ThemedText type="small">
                      {wake?.push === 'on'
                        ? 'In seconds'
                        : wake?.background === 'on'
                          ? 'In the background'
                          : 'When you open Wafra'}
                    </ThemedText>
                  ),
                },
              ]}
            />

            <ThemedText type="meta" themeColor="textTertiary">
              {deliveryLine()}
              {wake && wake.push !== 'on'
                ? ' Allowing notifications lets the relay wake Wafra the moment something is captured — the notification itself is empty and never says what you spent.'
                : ''}
            </ThemedText>

            <View style={styles.actions}>
              <Button
                label={busy ? 'Checking…' : 'Check for messages now'}
                icon="repeat"
                onPress={checkNow}
                disabled={busy}
              />
              <Button
                variant="outline"
                label="Walk through the steps again"
                onPress={() => setStep('why')}
              />
              <Button variant="danger" label="Turn off iPhone capture" onPress={confirmUnpair} />
            </View>

            <ThemedText type="meta" themeColor="textTertiary">
              Turning it off erases this phone and its queue from the relay. It cannot delete the
              shortcut on your iPhone — you have to do that in Shortcuts, or it keeps posting into
              nothing.
            </ThemedText>
          </>
        );
      }

      default:
        return null;
    }
  };

  return (
    <ThemedView style={styles.root}>
      <SafeAreaView style={styles.safe} edges={['top', 'bottom']}>
        {header('iPhone capture')}
        {stepIndex >= 0 && (
          <View style={styles.headerWrap}>
            <StepRail index={stepIndex} />
          </View>
        )}
        <ScrollView contentContainerStyle={styles.content} showsVerticalScrollIndicator={false}>
          <Section index={0} style={styles.stepBody} key={step}>
            {body()}
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
    paddingTop: Spacing.three,
    paddingBottom: Spacing.six,
  },
  stepBody: {
    gap: Spacing.four,
  },
  rail: {
    flexDirection: 'row',
    gap: 3,
    paddingBottom: Spacing.two,
  },
  railSegment: {
    flex: 1,
    height: 2,
    borderRadius: 1,
  },
  head: {
    gap: Spacing.two + 2,
  },
  // The onboarding headline scale, one notch down: this screen carries the same
  // weight as first-run but lives inside a navigation stack.
  headline: {
    fontFamily: Fonts.sansSemi,
    fontSize: 28,
    lineHeight: 33,
    letterSpacing: -0.95,
    maxWidth: 340,
  },
  manual: {
    gap: Spacing.three,
  },
  listLabel: {
    paddingBottom: Spacing.two,
  },
  pointIcon: {
    width: 24,
    alignItems: 'center',
  },
  rowText: {
    flex: 1,
    gap: Spacing.half,
  },
  numberDot: {
    width: 24,
    height: 24,
    borderRadius: 12,
    alignItems: 'center',
    justifyContent: 'center',
  },
  emphasis: {
    borderWidth: 1,
    borderRadius: Radius.sheet,
    padding: Spacing.three,
    gap: Spacing.two,
  },
  emphasisHead: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: Spacing.two + 2,
  },
  split: {
    flexDirection: 'row',
    paddingTop: Spacing.three - 2,
    paddingBottom: Spacing.three - 4,
  },
  splitCell: {
    flex: 1,
    gap: Spacing.half,
  },
  splitDivider: {
    borderLeftWidth: StyleSheet.hairlineWidth,
    paddingLeft: Spacing.three,
  },
  splitFigure: {
    fontSize: 22,
    lineHeight: 26,
  },
  pairing: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: Spacing.two + 2,
    paddingVertical: Spacing.three,
  },
  listening: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: Spacing.two + 2,
  },
  spacer: {
    flex: 1,
  },
  errorHead: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: Spacing.two + 2,
    paddingBottom: Spacing.two - 2,
  },
  copyField: {
    gap: Spacing.two,
  },
  copyHead: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
  },
  copyBox: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: Spacing.two,
    borderWidth: 1,
    borderRadius: Radius.control,
    paddingLeft: Spacing.three - 2,
    paddingRight: Spacing.one,
    paddingVertical: Spacing.one,
  },
  copyValue: {
    flex: 1,
  },
  copyButton: {
    minHeight: 36,
    paddingVertical: Spacing.two,
    paddingHorizontal: Spacing.three - 2,
  },
  actions: {
    gap: Spacing.two + 2,
  },
  actionsInline: {
    flexDirection: 'row',
    gap: Spacing.two + 2,
    paddingTop: Spacing.two,
  },
});
