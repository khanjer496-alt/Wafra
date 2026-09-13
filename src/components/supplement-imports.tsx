import * as DocumentPicker from 'expo-document-picker';
import { File } from 'expo-file-system';
import { useRouter } from 'expo-router';
import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Platform, StyleSheet, View } from 'react-native';

import { ThemedText } from '@/components/themed-text';
import { Button } from '@/components/ui/controls';
import { Icon } from '@/components/ui/icon';
import { Block, SectionHeader } from '@/components/ui/layout';
import { TextField } from '@/components/ui/text-field';
import { Radius, Spacing } from '@/constants/theme';
import { useLanguage } from '@/hooks/use-language';
import { useTheme } from '@/hooks/use-theme';
import { createCaptureExecutor } from '@/lib/capture-executor';
import {
  getImportCapabilities,
  uploadCsvStatement,
  uploadPdfStatement,
  type PickedStatement,
} from '@/lib/cloud-import';
import {
  CloudImportError,
  type ImportCapabilities,
  type StatementImportCoverage,
} from '@/lib/cloud-import-contract';
import {
  DEFAULT_RELAY_URL,
  getRelayConfig,
  pairDevice,
  RelayError,
  type RelayConfig,
} from '@/lib/relay';
import { useStore } from '@/lib/store';
import { SUPPLEMENT_COPY } from '@/lib/supplement-copy';
import { committed, failed } from '@/lib/haptics';
import type { StatementCoverageEntry } from '@/lib/types';

type Busy = 'connect' | 'capabilities' | 'statement' | null;

type PendingProtectedPdf = {
  asset: PickedStatement;
  file: File;
};

type CoverageSummary = {
  sourceKey: string;
  label: string;
  range: string;
  throughMonth: string;
  sortDate: string;
  missing: string[];
};

function interpolate(template: string, values: Record<string, string | number>): string {
  return template.replace(/\{(\w+)\}/g, (_, key: string) => String(values[key] ?? ''));
}

function monthKey(date: string): string {
  return date.slice(0, 7);
}

function monthIndex(key: string): number {
  const [year, month] = key.split('-').map(Number);
  return year * 12 + month - 1;
}

function monthFromIndex(index: number): string {
  const year = Math.floor(index / 12);
  const month = index % 12 + 1;
  return `${year}-${String(month).padStart(2, '0')}`;
}

function nextMonth(key: string): string {
  const [year, month] = key.split('-').map(Number);
  const date = new Date(Date.UTC(year, month, 1));
  return `${date.getUTCFullYear()}-${String(date.getUTCMonth() + 1).padStart(2, '0')}`;
}

function formatMonth(key: string, language: string): string {
  const [year, month] = key.split('-').map(Number);
  return new Intl.DateTimeFormat(language === 'ar' ? 'ar-AE' : 'en-AE', {
    month: 'short', year: 'numeric', timeZone: 'UTC',
  }).format(new Date(Date.UTC(year, month - 1, 1)));
}

function summarizeCoverage(entries: readonly StatementCoverageEntry[], language: string): CoverageSummary[] {
  const groups = new Map<string, StatementCoverageEntry[]>();
  for (const entry of entries) {
    const list = groups.get(entry.sourceKey) ?? [];
    list.push(entry);
    groups.set(entry.sourceKey, list);
  }
  const today = new Date();
  const lastCompleteDate = new Date(Date.UTC(today.getUTCFullYear(), today.getUTCMonth() - 1, 1));
  const lastCompleteMonth = `${lastCompleteDate.getUTCFullYear()}-${String(lastCompleteDate.getUTCMonth() + 1).padStart(2, '0')}`;
  return [...groups.entries()].map(([sourceKey, rows]) => {
    const ordered = [...rows].sort((a, b) => a.startDate.localeCompare(b.startDate));
    const firstMonth = monthKey(ordered[0].startDate);
    const lastImportedMonth = monthKey(ordered[ordered.length - 1].endDate);
    const covered = new Set<string>();
    for (const row of ordered) {
      let cursor = monthKey(row.startDate);
      const end = monthKey(row.endDate);
      for (let guard = 0; guard < 240; guard += 1) {
        covered.add(cursor);
        if (cursor === end) break;
        cursor = nextMonth(cursor);
      }
    }
    const missing: string[] = [];
    const lastCompleteIndex = monthIndex(lastCompleteMonth);
    const firstExpected = monthFromIndex(Math.max(monthIndex(firstMonth), lastCompleteIndex - 11));
    let cursor = firstExpected;
    for (let guard = 0; guard < 12; guard += 1) {
      if (!covered.has(cursor)) missing.push(formatMonth(cursor, language));
      if (cursor === lastCompleteMonth) break;
      cursor = nextMonth(cursor);
    }
    return {
      sourceKey,
      label: ordered[ordered.length - 1].label,
      range: firstMonth === lastImportedMonth
        ? formatMonth(firstMonth, language)
        : `${formatMonth(firstMonth, language)} – ${formatMonth(lastImportedMonth, language)}`,
      throughMonth: formatMonth(lastCompleteMonth, language),
      sortDate: ordered[ordered.length - 1].endDate,
      missing,
    };
  }).sort((a, b) => b.sortDate.localeCompare(a.sortDate));
}

export function SupplementImports() {
  const router = useRouter();
  const language = useLanguage();
  const copy = SUPPLEMENT_COPY[language];
  const theme = useTheme();
  const {
    state,
    importBatch,
    stageReviewAlerts,
    ensureDurable,
    setMarket,
    recordStatementCoverage,
  } = useStore();
  const stateRef = useRef(state);
  stateRef.current = state;
  const captureExecutor = useMemo(
    () => createCaptureExecutor({
      ledger: {
        getState: () => stateRef.current,
        importBatch,
        stageReviewAlerts,
        ensureDurable,
        setMarket: (market) => setMarket(market),
      },
    }),
    [ensureDurable, importBatch, setMarket, stageReviewAlerts],
  );

  const [cfg, setCfg] = useState<RelayConfig | null>(null);
  const [loadingConfig, setLoadingConfig] = useState(true);
  const [capabilities, setCapabilities] = useState<ImportCapabilities | null>(null);
  const [busy, setBusy] = useState<Busy>(null);
  const [error, setError] = useState<string | null>(null);
  const [status, setStatus] = useState<string | null>(null);
  const [pendingPdf, setPendingPdf] = useState<PendingProtectedPdf | null>(null);
  const pendingPdfRef = useRef<PendingProtectedPdf | null>(null);
  const [pdfPassword, setPdfPassword] = useState('');
  const coverage = useMemo(
    () => summarizeCoverage(state.statementCoverage ?? [], language),
    [language, state.statementCoverage],
  );

  useEffect(() => {
    pendingPdfRef.current = pendingPdf;
  }, [pendingPdf]);

  useEffect(() => () => {
    const pending = pendingPdfRef.current;
    try {
      if (pending?.file.exists) pending.file.delete();
    } catch {
      // Picker cache cleanup is best effort.
    }
  }, []);

  const errorText = useCallback((value: unknown): string => {
    if (!(value instanceof CloudImportError)) return copy.errUnexpected;
    if (value.code === 'network') return copy.errNetwork;
    if (value.code === 'unauthorized') return copy.errAuth;
    if (
      value.code === 'invalid_pdf' || value.code === 'pdf_required' ||
      value.code === 'invalid_csv' || value.code === 'csv_required'
    ) return copy.errInvalid;
    if (value.code === 'too_large' || value.code === 'too_many_pages' || value.code === 'too_many_rows') return copy.errLarge;
    if (value.code === 'unreadable_pdf') return copy.errUnreadable;
    if (value.code === 'pdf_too_long') return copy.errPdfTooLong;
    if (value.code === 'pdf_password_incorrect') return copy.passwordWrong;
    if (value.code === 'unsupported_statement_format') return copy.errFormat;
    if (value.code === 'rate_limited' || value.code === 'queue_full') return copy.errRate;
    if (value.code === 'service') return copy.serviceError;
    return copy.errUnexpected;
  }, [copy]);

  const loadCapabilities = useCallback(async (active: RelayConfig) => {
    if (stateRef.current.privateMode) return;
    setBusy('capabilities');
    setError(null);
    try {
      setCapabilities(await getImportCapabilities(active));
    } catch (e) {
      setCapabilities(null);
      setError(errorText(e));
    } finally {
      setBusy(null);
    }
  }, [errorText]);

  useEffect(() => {
    let live = true;
    void getRelayConfig()
      .then((existing) => {
        if (!live) return;
        setCfg(existing);
        if (existing && !stateRef.current.privateMode) void loadCapabilities(existing);
      })
      .finally(() => {
        if (live) setLoadingConfig(false);
      });
    return () => { live = false; };
  }, [loadCapabilities]);

  const connect = async () => {
    if (loadingConfig || busy !== null) return;
    if (!DEFAULT_RELAY_URL) {
      setError(copy.unavailable);
      return;
    }
    setBusy('connect');
    setError(null);
    setStatus(null);
    try {
      const existing = await getRelayConfig();
      if (existing) {
        setCfg(existing);
        await loadCapabilities(existing);
        return;
      }
      const connected = await pairDevice(DEFAULT_RELAY_URL);
      setCfg(connected);
      await loadCapabilities(connected);
      committed();
    } catch (e) {
      setError(errorText(e));
    } finally {
      setBusy(null);
    }
  };

  const syncQueued = useCallback(async (): Promise<number> => {
    const outcome = await captureExecutor.execute('supplemental');
    if (outcome.kind === 'not-hydrated') throw new Error(copy.notHydrated);
    if (outcome.kind === 'needs-setup') throw new Error(copy.unavailable);
    return outcome.kind === 'imported' || outcome.kind === 'up-to-date'
      ? outcome.transactions
      : 0;
  }, [captureExecutor, copy.notHydrated, copy.unavailable]);

  // Coverage is written after the whole batch has uploaded, not between files.
  // recordStatementCoverage persists the full encrypted ledger on every call,
  // and awaiting it inside the per-file loop stalled the picker once per
  // statement — the "laggy import" report. Duplicate ranges (the same account
  // exported twice) collapse to one write here rather than one persist each.
  const rememberCoverage = useCallback(async (
    items: readonly { item: StatementImportCoverage | null; format: 'pdf' | 'csv' }[],
  ) => {
    const importedAt = Date.now();
    const seen = new Set<string>();
    for (const { item, format } of items) {
      if (!item) continue;
      const key = `${format}:${item.sourceKey}:${item.startDate}:${item.endDate}`;
      if (seen.has(key)) continue;
      seen.add(key);
      await recordStatementCoverage({ ...item, format, importedAt });
    }
  }, [recordStatementCoverage]);

  // Why the sync failed, in words that carry no statement content. Import
  // errors are already user copy; a relay error is classified rather than
  // echoed, because its message is an English sentence from the transport
  // layer; anything else is named generically.
  const syncFailureReason = useCallback((value: unknown): string => {
    if (value instanceof CloudImportError) return errorText(value);
    if (value instanceof RelayError) return value.retryable ? copy.syncFailedOffline : copy.syncFailedUnknown;
    if (value instanceof Error && (value.message === copy.notHydrated || value.message === copy.unavailable)) {
      return value.message;
    }
    return copy.syncFailedUnknown;
  }, [copy, errorText]);

  const finishQueuedImport = useCallback(async (
    files: number,
    accepted: number,
    rejected: number,
    pages: number,
  ): Promise<boolean> => {
    setStatus(interpolate(copy.acceptedPending, { accepted }));
    try {
      // Paint the accepted state before planning/reconciling a potentially large ledger.
      await new Promise<void>((resolve) => setTimeout(resolve, 0));
      const imported = await syncQueued();
      setStatus(interpolate(imported > 0 ? copy.statementsSuccess : copy.statementsNoNew, {
        files, accepted, rejected, pages, imported,
      }));
      committed();
      return true;
    } catch (e) {
      // The rows stay queued on the relay; say what stopped them landing here
      // instead of folding every failure into the "not synced yet" status.
      setStatus(interpolate(copy.acceptedPending, { accepted }));
      setError(interpolate(copy.syncFailed, { reason: syncFailureReason(e) }));
      failed();
      return false;
    }
  }, [copy, syncFailureReason, syncQueued]);

  const pickAndUpload = async () => {
    if (!cfg || !capabilities || pendingPdf) return;
    setError(null);
    setStatus(null);
    const pickedFiles: File[] = [];
    let retainedUri: string | null = null;
    // Declared outside the try so a failure later in the batch still hands the
    // deferred locked PDF to the password prompt instead of leaking its copy.
    let protectedPdf: PendingProtectedPdf | null = null;
    try {
      const picked = await DocumentPicker.getDocumentAsync({
        type: [...capabilities.pdf.accepts, ...capabilities.csv.accepts],
        copyToCacheDirectory: true,
        multiple: true,
      });
      if (picked.canceled || picked.assets.length === 0) return;
      setBusy('statement');
      let acceptedRows = 0;
      let rejectedRows = 0;
      let pages = 0;
      let uploadedFiles = 0;
      const coverage: { item: StatementImportCoverage | null; format: 'pdf' | 'csv' }[] = [];
      let skippedProtected = 0;
      for (let index = 0; index < picked.assets.length; index += 1) {
        const asset = picked.assets[index];
        const file = new File(asset.uri);
        pickedFiles.push(file);
        const csv = /\.(?:csv|tsv)$/i.test(asset.name) ||
          capabilities.csv.accepts.includes(asset.mimeType?.split(';', 1)[0].toLowerCase() ?? '');
        try {
          const accepted = csv
            ? await uploadCsvStatement(cfg, asset, capabilities)
            : await uploadPdfStatement(cfg, asset, capabilities);
          acceptedRows += accepted.acceptedRows;
          rejectedRows += accepted.rejectedRows;
          uploadedFiles += 1;
          if ('pages' in accepted) pages += accepted.pages;
          coverage.push({ item: accepted.coverage, format: csv ? 'csv' : 'pdf' });
        } catch (e) {
          if (!csv && e instanceof CloudImportError &&
              (e.code === 'pdf_password_required' || e.code === 'pdf_password_incorrect')) {
            // Keep only this picker cache copy until the user supplies the
            // password, and carry on with the rest of the batch: one locked
            // statement used to abandon every file picked after it. The
            // prompt holds one file; further locked PDFs are reported, not lost.
            if (protectedPdf) {
              skippedProtected += 1;
            } else {
              retainedUri = asset.uri;
              protectedPdf = { asset, file };
            }
            continue;
          }
          throw e;
        }
        if (index + 1 < picked.assets.length) {
          await new Promise<void>((resolve) => setTimeout(resolve, 0));
        }
      }
      await rememberCoverage(coverage);
      if (protectedPdf) {
        setPendingPdf(protectedPdf);
        setPdfPassword('');
        setError(null);
      }
      const synced = uploadedFiles > 0
        ? await finishQueuedImport(uploadedFiles, acceptedRows, rejectedRows, pages)
        : true;
      if (synced && skippedProtected > 0) {
        setError(interpolate(copy.passwordSkipped, { count: skippedProtected }));
      }
    } catch (e) {
      if (protectedPdf) {
        setPendingPdf(protectedPdf);
        setPdfPassword('');
      }
      setError(e instanceof Error && e.message === copy.notHydrated ? e.message : errorText(e));
      failed();
    } finally {
      for (const file of pickedFiles) {
        if (file.uri === retainedUri) continue;
        try {
          if (file.exists) file.delete();
        } catch {
          // The OS may already have reclaimed this picker cache copy; the
          // remaining copies in the batch still get their turn.
        }
      }
      setBusy(null);
    }
  };

  const retryProtectedPdf = async () => {
    if (!cfg || !capabilities || !pendingPdf || !pdfPassword || busy !== null) return;
    setBusy('statement');
    setError(null);
    try {
      const accepted = await uploadPdfStatement(cfg, pendingPdf.asset, capabilities, pdfPassword);
      await rememberCoverage([{ item: accepted.coverage, format: 'pdf' }]);
      await finishQueuedImport(1, accepted.acceptedRows, accepted.rejectedRows, accepted.pages);
      try { if (pendingPdf.file.exists) pendingPdf.file.delete(); } catch { /* best effort */ }
      setPendingPdf(null);
      setPdfPassword('');
    } catch (e) {
      setError(errorText(e));
      if (!(e instanceof CloudImportError) || e.code !== 'pdf_password_incorrect') failed();
    } finally {
      // Clear the entered secret from React state after a failed attempt too.
      setPdfPassword('');
      setBusy(null);
    }
  };

  const cancelProtectedPdf = () => {
    if (!pendingPdf) return;
    try { if (pendingPdf.file.exists) pendingPdf.file.delete(); } catch { /* best effort */ }
    setPendingPdf(null);
    setPdfPassword('');
    setError(null);
  };

  const locked = state.privateMode;
  const pdfMb = capabilities ? Math.round(capabilities.pdf.maxBytes / 1048576) : 0;
  const csvMb = capabilities ? Math.round(capabilities.csv.maxBytes / 1048576) : 0;

  return (
    <View style={styles.root}>
      <SectionHeader title={copy.header} />
      <View style={styles.hero}>
        <ThemedText type="heading">{copy.title}</ThemedText>
        <ThemedText type="default" themeColor="textSecondary">
          {Platform.OS === 'android' ? copy.introAndroid : copy.introIos}
        </ThemedText>
      </View>

      {locked ? (
        <Block>
          <View style={styles.cardHead}>
            <Icon name="lock" size={20} color={theme.warning} />
            <ThemedText type="small">{copy.privateTitle}</ThemedText>
          </View>
          <ThemedText type="meta" themeColor="textTertiary">{copy.privateBody}</ThemedText>
          <Button label={copy.reviewPrivacy} variant="outline" onPress={() => router.push('/settings?section=privacy')} />
        </Block>
      ) : loadingConfig ? (
        <Block><ThemedText type="meta" themeColor="textTertiary">{copy.checking}</ThemedText></Block>
      ) : !cfg ? (
        <Block>
          <View style={styles.cardHead}>
            <Icon name="lock" size={20} color={theme.primary} />
            <ThemedText type="small">{copy.connectTitle}</ThemedText>
          </View>
          <ThemedText type="meta" themeColor="textTertiary">{copy.connectBody}</ThemedText>
          <Button
            label={busy === 'connect' ? copy.connecting : copy.connect}
            onPress={() => void connect()}
            disabled={busy !== null}
          />
        </Block>
      ) : (
        <>
          {busy === 'capabilities' && (
            <ThemedText type="meta" themeColor="textTertiary">{copy.checking}</ThemedText>
          )}
          {!capabilities && busy !== 'capabilities' && (
            <Button variant="outline" label={copy.retry} onPress={() => void loadCapabilities(cfg)} disabled={busy !== null} />
          )}

          <Block style={styles.importCard}>
            <View style={styles.cardHead}>
              <View style={[styles.iconWell, { backgroundColor: theme.primarySoft }]}>
                <Icon name="upload" size={20} color={theme.primary} />
              </View>
              <View style={styles.cardCopy}>
                <ThemedText type="small">{copy.statementTitle}</ThemedText>
                <ThemedText type="meta" themeColor="textTertiary">{copy.statementBody}</ThemedText>
              </View>
            </View>
            {capabilities && (
              <ThemedText type="nano" themeColor="textTertiary" tabular>
                {interpolate(copy.statementLimits, {
                  pdfMb, csvMb, pages: capabilities.pdf.maxPages, rows: capabilities.pdf.maxRows,
                })}
              </ThemedText>
            )}
            <Button
              icon="upload"
              label={busy === 'statement' ? copy.uploading : copy.chooseStatements}
              onPress={() => void pickAndUpload()}
              disabled={!capabilities || busy !== null || !!pendingPdf}
            />
          </Block>

          {pendingPdf && (
            <Block style={styles.passwordCard}>
              <View style={styles.cardHead}>
                <View style={[styles.iconWell, { backgroundColor: theme.primarySoft }]}>
                  <Icon name="lock" size={20} color={theme.primary} />
                </View>
                <View style={styles.cardCopy}>
                  <ThemedText type="small">{copy.passwordTitle}</ThemedText>
                  <ThemedText type="meta" themeColor="textTertiary">{copy.passwordBody}</ThemedText>
                </View>
              </View>
              <TextField
                label={copy.passwordLabel}
                value={pdfPassword}
                onChangeText={(value) => { setPdfPassword(value); setError(null); }}
                placeholder={copy.passwordPlaceholder}
                secureTextEntry
                autoCapitalize="none"
                autoCorrect={false}
                textContentType="password"
              />
              <View style={styles.actions}>
                <Button inline label={copy.passwordCancel} variant="outline" onPress={cancelProtectedPdf} disabled={busy !== null} />
                <Button inline label={busy === 'statement' ? copy.uploading : copy.passwordRetry}
                  onPress={() => void retryProtectedPdf()} disabled={!pdfPassword || busy !== null} />
              </View>
            </Block>
          )}

          <Block style={styles.coverageCard}>
            <View style={styles.cardHead}>
              <View style={[styles.iconWell, { backgroundColor: theme.backgroundSelected }]}>
                <Icon name="calendar" size={20} color={theme.text} />
              </View>
              <View style={styles.cardCopy}>
                <ThemedText type="small">{copy.coverageTitle}</ThemedText>
                {coverage.length === 0 && (
                  <ThemedText type="meta" themeColor="textTertiary">{copy.coverageEmpty}</ThemedText>
                )}
              </View>
            </View>
            {coverage.map((item) => {
              const shownMissing = item.missing.slice(0, 4);
              const more = item.missing.length - shownMissing.length;
              return (
                <View key={item.sourceKey} style={[styles.coverageRow, { borderTopColor: theme.cardBorder }]}>
                  <View style={styles.coverageHead}>
                    <ThemedText type="smallBold" style={styles.coverageLabel}>{item.label}</ThemedText>
                    <ThemedText type="meta" themeColor="textSecondary" tabular>{item.range}</ThemedText>
                  </View>
                  <ThemedText type="meta" themeColor={item.missing.length ? 'expense' : 'textTertiary'}>
                    {item.missing.length
                      ? interpolate(copy.coverageMissing, {
                          months: `${shownMissing.join(', ')}${more > 0 ? ` +${more}` : ''}`,
                        })
                      : interpolate(copy.coverageComplete, { month: item.throughMonth })}
                  </ThemedText>
                </View>
              );
            })}
          </Block>
        </>
      )}

      {error && (
        <View style={[styles.message, { backgroundColor: theme.expenseSoftBg, borderColor: theme.expenseSoftBorder }]}>
          <Icon name="alert" size={17} color={theme.expense} />
          <ThemedText type="meta" style={[styles.messageText, { color: theme.expense }]}>{error}</ThemedText>
        </View>
      )}
      {status && (
        <View style={[styles.message, { backgroundColor: theme.primarySoft, borderColor: theme.primaryBorder }]}>
          <Icon name="check" size={17} color={theme.primary} />
          <ThemedText type="meta" style={styles.messageText}>{status}</ThemedText>
        </View>
      )}

      <View style={[styles.privacy, { borderTopColor: theme.cardBorder }]}>
        <Icon name="lock" size={17} color={theme.primary} />
        <View style={styles.cardCopy}>
          <ThemedText type="small">{copy.privacyTitle}</ThemedText>
          <ThemedText type="meta" themeColor="textTertiary">{copy.privacyBody}</ThemedText>
        </View>
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  root: { gap: Spacing.three },
  hero: { gap: Spacing.one },
  importCard: { gap: Spacing.three },
  passwordCard: { gap: Spacing.three },
  coverageCard: { gap: Spacing.two },
  cardHead: { flexDirection: 'row', alignItems: 'center', gap: Spacing.two + 2 },
  cardCopy: { flex: 1, gap: Spacing.half },
  iconWell: {
    width: 42,
    height: 42,
    borderRadius: Radius.control,
    alignItems: 'center',
    justifyContent: 'center',
  },
  actions: { flexDirection: 'row', gap: Spacing.two },
  coverageRow: { borderTopWidth: StyleSheet.hairlineWidth, paddingTop: Spacing.two, gap: Spacing.half },
  coverageHead: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'baseline', gap: Spacing.two, flexWrap: 'wrap' },
  coverageLabel: { flexShrink: 1 },
  message: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    gap: Spacing.two,
    borderWidth: 1,
    borderRadius: Radius.control,
    padding: Spacing.three,
  },
  messageText: { flex: 1 },
  privacy: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    gap: Spacing.two,
    borderTopWidth: StyleSheet.hairlineWidth,
    paddingTop: Spacing.three,
  },
});
