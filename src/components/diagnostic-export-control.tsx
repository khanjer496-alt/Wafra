import Constants from 'expo-constants';
import React, { useEffect, useRef, useState } from 'react';
import { AppState as NativeAppState, Platform, View } from 'react-native';
import { ThemedText } from '@/components/themed-text';
import { BottomSheet } from '@/components/ui/bottom-sheet';
import { Button, Toggle } from '@/components/ui/controls';
import { Row } from '@/components/ui/layout';
import { merchantLogoDecision } from '@/components/ui/merchant-logo-assets';
import { hasSmsPermission, requestSmsPermission } from '@/lib/auto-import';
import { buildDiagnosticExport, serializeDiagnosticExport } from '@/lib/diagnostic-export';
import { collectDiagnosticBankMessages } from '@/lib/diagnostic-messages';
import { shareTextFile } from '@/lib/share-text';
import { useStore } from '@/lib/store';
import SmsReader from '../../modules/sms-reader';

import { diagnosticCopy as copy } from '@/lib/diagnostic-copy';

/** Opens a consent sheet first. Preparing and sharing are separate actions. */
export function DiagnosticExportControl() {
  const { state, getStateSnapshot, getStateGeneration } = useStore();
  const ledgerGeneration = getStateGeneration();
  const w = copy[state.language === 'ar' ? 'ar' : 'en'];
  const [open, setOpen] = useState(false); const [messages, setMessages] = useState(false);
  const [busy, setBusy] = useState(false); const [progress, setProgress] = useState('');
  const [error, setError] = useState(false); const [prepared, setPrepared] = useState<string | null>(null);
  const [preparedCount, setPreparedCount] = useState(0);
  const epoch = useRef(0); const running = useRef(false); const shareGuard = useRef<(() => boolean) | null>(null);
  const mounted = useRef(true);
  const clear = () => { epoch.current++; setPrepared(null); shareGuard.current = null; setBusy(false); setProgress(''); };
  useEffect(() => {
    mounted.current = true;
    const lifecycleEpoch = epoch;
    const subscription = NativeAppState.addEventListener('change', next => {
      if (next !== 'active') { epoch.current++; setPrepared(null); shareGuard.current = null; }
    });
    return () => { mounted.current = false; lifecycleEpoch.current++; subscription.remove(); };
  }, []);
  useEffect(() => { epoch.current++; setPrepared(null); shareGuard.current = null; }, [state.privateMode, ledgerGeneration]);

  const prepare = async () => {
    if (running.current) return;
    running.current = true; setBusy(true); setError(false); setPrepared(null);
    const id = ++epoch.current; const generation = getStateGeneration();
    const snapshot = getStateSnapshot(); const include = messages && !snapshot.privateMode;
    const active = () => {
      const current = getStateSnapshot();
      return mounted.current && id === epoch.current && generation === getStateGeneration() &&
        current.marketId === snapshot.marketId && current.monthStartDay === snapshot.monthStartDay &&
        current.ledgerMoney?.currency === snapshot.ledgerMoney?.currency && current.ledgerMoney?.exponent === snapshot.ledgerMoney?.exponent &&
        (!include || (!current.privateMode && current.captureOptOut === snapshot.captureOptOut));
    };
    try {
      const report = await buildDiagnosticExport(snapshot, {
        version: Constants.expoConfig?.version ?? 'unknown',
        build: String(Platform.OS === 'android' ? Constants.expoConfig?.android?.versionCode ?? 'unknown' : Constants.expoConfig?.ios?.buildNumber ?? 'unknown'),
        platform: Platform.OS,
      }, { includeRetainedMessages: include, shouldContinue: active,
        logoFor: title => { const value = merchantLogoDecision(title); return { id: value.logo?.id ?? null, reason: value.reason }; },
        onProgress: (done, total) => { if (active()) setProgress(`${done} / ${total} ${w.records}`); },
      });
      let bankMessages: unknown[] = []; let bankMessageCoverage: unknown = { included: false, reason: 'not-requested' };
      if (include && Platform.OS === 'android' && SmsReader) {
        if (!(await hasSmsPermission()) && !(await requestSmsPermission())) throw new Error('diagnostic_sms_permission');
        if (!active()) throw new Error('diagnostic_cancelled');
        const reader = SmsReader;
        const collected = await collectDiagnosticBankMessages((date, row, max) => reader.getInboxSms(0, date, row, max), {
          currency: snapshot.ledgerMoney?.currency ?? null, market: snapshot.marketId, overrides: snapshot.merchantOverrides,
          shouldContinue: active, onProgress: checked => { if (active()) setProgress(`${checked} ${w.read}`); },
        });
        bankMessages = collected.messages; bankMessageCoverage = collected.coverage;
      } else if (include) bankMessageCoverage = { included: false, reason: 'platform-inbox-unavailable', retainedLedgerMessagesOnly: true };
      const text = await serializeDiagnosticExport({ ...report,
        coverage: { ...report.coverage, phoneInboxIncluded: bankMessages.length > 0 }, bankMessages, bankMessageCoverage }, active);
      if (!active()) throw new Error('diagnostic_cancelled');
      shareGuard.current = active; setPreparedCount(report.coverage.transactionCount); setPrepared(text);
    } catch { if (mounted.current && id === epoch.current) setError(true); }
    finally { running.current = false; if (mounted.current) setBusy(false); }
  };
  const share = async () => {
    if (running.current) return;
    if (!prepared || busy || !shareGuard.current?.()) { clear(); return; }
    running.current = true; setBusy(true);
    try {
      await shareTextFile('wafra-diagnostics.json', prepared, { mimeType: 'application/json', dialogTitle: w.title });
      if (mounted.current) setOpen(false);
    } catch { if (mounted.current) setError(true); }
    finally { running.current = false; if (mounted.current) clear(); }
  };
  return <>
    <Row accessibilityLabel={w.title} onPress={() => { clear(); setMessages(false); setError(false); setOpen(true); }}>
      <View style={{ flex: 1, gap: 4 }}><ThemedText type="smallBold">{w.title}</ThemedText>
        <ThemedText type="meta" themeColor="textSecondary">{w.intro}</ThemedText></View>
    </Row>
    <BottomSheet visible={open} title={w.title} onClose={() => { clear(); setOpen(false); }} testID="diagnostic-export-sheet">
      <ThemedText type="small">{w.warning}</ThemedText>
      <ThemedText type="meta" themeColor="textSecondary">{prepared ? preparedCount : state.transactions.length} {w.records} · {w.intro}</ThemedText>
      {state.privateMode ? <ThemedText type="small">{w.private}</ThemedText> :
        <View style={{ flexDirection: 'row', alignItems: 'center', gap: 12 }}>
          <ThemedText type="small" style={{ flex: 1 }}>{w.messages}</ThemedText>
          <Toggle value={messages} onChange={value => { if (!busy) { clear(); setMessages(value); } }} label={w.messages} />
        </View>}
      <ThemedText type="meta" themeColor="textSecondary">{messages ? w.messageNote : w.noSource}</ThemedText>
      {busy && <ThemedText accessibilityLiveRegion="polite">{w.busy}… {progress}</ThemedText>}
      {error && <ThemedText accessibilityRole="alert">{w.failed}</ThemedText>}
      {prepared && <ThemedText>{w.ready}</ThemedText>}
      <Button label={prepared ? w.share : w.prepare} disabled={busy || !state.hydrated}
        onPress={() => { void (prepared ? share() : prepare()); }} />
      <Button label={w.cancel} variant="outline" onPress={() => { clear(); setOpen(false); }} />
    </BottomSheet>
  </>;
}
