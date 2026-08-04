/**
 * "Is iPhone capture actually working?" — the answer, in one row.
 *
 * This exists because the iOS design has a failure mode Android does not: the
 * Shortcuts automation lives in Apple's app, Wafra cannot read it, and the most
 * likely mistake — leaving the run mode on "Ask Before Running" — produces no
 * error anywhere. The automation simply never fires, the ledger stays empty,
 * and the user concludes the app is broken. Nothing in the system reports this
 * except the absence of rows, so the absence of rows has to be the signal.
 *
 * `describeRelay` is a pure function on purpose: the same sentence appears on
 * Wallet, in Settings and at the top of the setup screen, and they must never
 * disagree about whether capture is healthy.
 */
import { useFocusEffect } from 'expo-router';
import React, { useCallback, useState } from 'react';
import { Pressable, StyleSheet, View } from 'react-native';

import { ThemedText } from '@/components/themed-text';
import { Icon, type IconName } from '@/components/ui/icon';
import { PulseDot } from '@/components/ui/states';
import { Radius, Spacing } from '@/constants/theme';
import { useTheme } from '@/hooks/use-theme';
import { isRelaySupported, relayStatus, type RelayStatus } from '@/lib/relay';

/** What the hook reports where there is no relay at all. */
const UNSUPPORTED: RelayStatus = {
  supported: false,
  paired: false,
  deviceId: null,
  market: null,
  pairedAt: null,
  pending: 0,
  lastSyncAt: 0,
  lastRowAt: 0,
  lastError: null,
  looksUnconfigured: false,
};

/** "4 minutes ago", "yesterday" — a timestamp nobody has to decode. */
export function relativeSince(ts: number, now: number = Date.now()): string {
  const mins = Math.max(0, Math.round((now - ts) / 60_000));
  if (mins < 1) return 'just now';
  if (mins < 60) return `${mins} minute${mins === 1 ? '' : 's'} ago`;
  const hours = Math.round(mins / 60);
  if (hours < 24) return `${hours} hour${hours === 1 ? '' : 's'} ago`;
  const days = Math.round(hours / 24);
  return days === 1 ? 'yesterday' : `${days} days ago`;
}

/**
 * `warn` is the state this whole component was built for. It is deliberately
 * the loudest of the four: a silently-broken automation is worse than an
 * obviously-broken one, so once we suspect it we say so in clay red.
 */
export type RelayTone = 'off' | 'waiting' | 'live' | 'warn';

export interface RelayDescription {
  tone: RelayTone;
  icon: IconName;
  title: string;
  detail: string;
  /** What the row's tap should do about it. */
  action: 'setup' | 'manage';
}

export function describeRelay(status: RelayStatus, now: number = Date.now()): RelayDescription {
  if (!status.paired) {
    return {
      tone: 'off',
      icon: 'phone',
      title: 'Automatic capture is off',
      detail: 'Set it up once and bank messages file themselves',
      action: 'setup',
    };
  }

  // The relay has forgotten this device — unpaired from another install, or
  // swept after a long silence. The Shortcut is still firing into nothing, and
  // this row is the only place the user can ever learn that.
  if (status.lastError === 'unauthorized') {
    return {
      tone: 'warn',
      icon: 'alert',
      title: 'Wafra lost its pairing',
      detail: 'Your Shortcut is posting into nothing. Set it up again to fix it.',
      action: 'setup',
    };
  }

  if (status.looksUnconfigured) {
    return {
      tone: 'warn',
      icon: 'alert',
      title: 'Nothing has arrived yet',
      detail: 'Your automation may still be asking before it runs — check Run Immediately',
      action: 'manage',
    };
  }

  if (status.lastRowAt === 0) {
    return {
      tone: 'waiting',
      icon: 'spark',
      title: 'Waiting for your first message',
      detail: status.pairedAt
        ? `Paired ${relativeSince(status.pairedAt, now)} · nothing captured yet`
        : 'Nothing captured yet',
      action: 'manage',
    };
  }

  return {
    tone: 'live',
    icon: 'spark',
    title: `Last message ${relativeSince(status.lastRowAt, now)}`,
    detail:
      status.pending > 0
        ? `${status.pending} waiting to file · opens on this iPhone only`
        : 'Captured, sealed, and filed — the text was never kept',
    action: 'manage',
  };
}

/**
 * Reads the relay's state and re-reads it every time the screen is focused.
 *
 * Focus rather than an interval: the numbers change when a sync runs, syncs run
 * on foreground, and a timer that fires behind a modal is a battery cost for a
 * row nobody is looking at.
 *
 * `reloadKey` covers the case focus does not. A screen that pairs, syncs or
 * unpairs changes this state WITHOUT ever losing focus, and a status line that
 * still says "capture is off" one second after pairing succeeded is worse than
 * no status line at all. Pass anything that changes when the relay changes.
 */
export function useRelayStatus(reloadKey: unknown = null): RelayStatus | null {
  const [status, setStatus] = useState<RelayStatus | null>(null);

  const load = useCallback(() => {
    // Android and web have no relay, and callers pass frequently-changing keys
    // (a transaction count, a step name). Without this the hook would hit
    // AsyncStorage on every one of those changes to learn nothing.
    if (!isRelaySupported()) {
      setStatus(UNSUPPORTED);
      return;
    }
    let alive = true;
    relayStatus()
      .then((s) => {
        if (alive) setStatus(s);
      })
      .catch(() => {});
    return () => {
      alive = false;
    };
    // The key is the dependency: it is why this function is re-created.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [reloadKey]);

  useFocusEffect(load);

  return status;
}

/**
 * The row itself. Renders nothing off iOS — Android reads SMS on-device and
 * has no relay to report on, and web has no keychain at all.
 */
export function RelayStatusRow({ onPress }: { onPress: (action: 'setup' | 'manage') => void }) {
  const theme = useTheme();
  const status = useRelayStatus();

  if (!isRelaySupported() || !status) return null;

  const d = describeRelay(status);
  const warn = d.tone === 'warn';

  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={`${d.title}. ${d.detail}`}
      onPress={() => onPress(d.action)}
      style={({ pressed }) => [
        styles.row,
        {
          borderColor: warn ? theme.expenseSoftBorder : theme.cardBorder,
          backgroundColor: warn
            ? theme.expenseSoftBg
            : pressed
              ? theme.backgroundSelected
              : theme.backgroundElement,
        },
      ]}>
      {d.tone === 'live' ? (
        <View style={styles.dotSlot}>
          <PulseDot color={theme.primary} />
        </View>
      ) : (
        <Icon
          name={d.icon}
          size={17}
          color={warn ? theme.expense : d.tone === 'waiting' ? theme.primary : theme.textSecondary}
        />
      )}
      <View style={styles.text}>
        <ThemedText type="small" style={warn ? { color: theme.expense } : undefined}>
          {d.title}
        </ThemedText>
        <ThemedText type="meta" themeColor="textTertiary">
          {d.detail}
        </ThemedText>
      </View>
      <Icon name="chevron-right" size={16} color={warn ? theme.expense : theme.textTertiary} />
    </Pressable>
  );
}

const styles = StyleSheet.create({
  row: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: Spacing.two + 2,
    borderWidth: 1,
    borderRadius: Radius.sheet,
    paddingHorizontal: Spacing.three,
    paddingVertical: Spacing.three - 2,
  },
  // Keeps the 7px pulse on the same optical centre line as a 17px icon, so the
  // row does not shift sideways when capture goes live.
  dotSlot: {
    width: 17,
    alignItems: 'center',
  },
  text: {
    flex: 1,
    gap: 1,
  },
});
