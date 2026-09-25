import * as DocumentPicker from 'expo-document-picker';
import { File } from 'expo-file-system';
import { useRouter } from 'expo-router';
import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { ActivityIndicator, AppState, Platform, Pressable, StyleSheet, View } from 'react-native';

import { ThemedText } from '@/components/themed-text';
import { LedgerCurrencySheet } from '@/components/ledger-currency-sheet';
import { Button } from '@/components/ui/controls';
import { Icon } from '@/components/ui/icon';
import { Block } from '@/components/ui/layout';
import { TextField } from '@/components/ui/text-field';
import { Radius, Spacing } from '@/constants/theme';
import { useLanguage } from '@/hooks/use-language';
import { useTheme } from '@/hooks/use-theme';
import { createCaptureExecutor } from '@/lib/capture-executor';
import {
  clearStatementPickerCache,
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
import { statementDateOrderForCountry } from '@/lib/country';
import { useStore } from '@/lib/store';
import { statementDateNote, SUPPLEMENT_COPY } from '@/lib/supplement-copy';
import { displayRegion } from '@/lib/ledger-money';
import { summarizeCoverage } from '@/lib/statement-coverage';
import { countPhrase, nextUploadDelay } from '@/lib/statement-batch';
import { t } from '@/lib/i18n';
import { committed, failed } from '@/lib/haptics';

type Busy = 'connect' | 'capabilities' | 'statement' | null;

type PendingProtectedPdf = {
  asset: PickedStatement;
  file: File;
};

/** What one import added, for the three-number result summary. */
type ImportSummary = {
  added: number;
  review: number;
  skipped: number;
};

/** One line per picked file, so a batch never fails or succeeds silently. */
type FileResult = {
  name: string;
  ok: boolean;
  detail: string;
};

/** A picked file's place in the batch while it is being read. */
type LiveFile = {
  name: string;
  status: 'waiting' | 'reading' | 'done' | 'locked' | 'failed';
  detail?: string;
};


const sleep = (ms: number) => new Promise<void>((resolve) => setTimeout(resolve, ms));
/** How long to back off after the relay still answers 429 despite pacing. */
const RATE_LIMIT_RETRY_MS = 61_000;
/**
 * Picker copies an upload is still reading. Module-level on purpose: an
 * import loop outlives the screen that started it, and a remounted screen's
 * cache cleanup must not delete the copy that loop is still sending.
 */
const inFlightPickerUris = new Set<string>();

function interpolate(template: string, values: Record<string, string | number>): string {
  return template.replace(/\{(\w+)\}/g, (_, key: string) => String(values[key] ?? ''));
}

/** A fixed visual state for the E2E design preview only; never set in the app. */
export interface SupplementImportsPreview {
  summary?: ImportSummary;
  progress?: { index: number; total: number };
  status?: string;
  error?: string;
  files?: FileResult[];
}

export interface SupplementImportsProps {
  /** First-run setup: a footer to move on, with or without a statement. */
  onboarding?: { onContinue(): void };
  preview?: SupplementImportsPreview;
}

export function SupplementImports({ onboarding, preview }: SupplementImportsProps = {}) {
  const router = useRouter();
  const language = useLanguage();
  const copy = SUPPLEMENT_COPY[language];
  const theme = useTheme();
  const {
    state,
    getStateSnapshot,
    importBatch,
    stageReviewAlerts,
    ensureDurable,
    setMarket,
    setLedgerMoney,
    stageStatementCoverage,
  } = useStore();
  const captureExecutor = useMemo(
    () => createCaptureExecutor({
      ledger: {
        getState: getStateSnapshot,
        importBatch,
        stageReviewAlerts,
        ensureDurable,
        setMarket: (market) => setMarket(market),
      },
    }),
    [ensureDurable, getStateSnapshot, importBatch, setMarket, stageReviewAlerts],
  );

  const [cfg, setCfg] = useState<RelayConfig | null>(null);
  const [loadingConfig, setLoadingConfig] = useState(true);
  const [capabilities, setCapabilities] = useState<ImportCapabilities | null>(null);
  const [busy, setBusy] = useState<Busy>(preview?.progress ? 'statement' : null);
  const [error, setError] = useState<string | null>(preview?.error ?? null);
  const [status, setStatus] = useState<string | null>(preview?.status ?? null);
  const [pendingPdfs, setPendingPdfs] = useState<PendingProtectedPdf[]>([]);
  const [fileResults, setFileResults] = useState<FileResult[]>(preview?.files ?? []);
  const [liveFiles, setLiveFiles] = useState<LiveFile[]>([]);
  const [progress, setProgress] = useState<{ index: number; total: number } | null>(preview?.progress ?? null);
  const [summary, setSummary] = useState<ImportSummary | null>(preview?.summary ?? null);
  const [filesOpen, setFilesOpen] = useState(false);
  const [detailsOpen, setDetailsOpen] = useState(false);
  const aliveRef = useRef(true);
  const pendingPdfsRef = useRef<PendingProtectedPdf[]>([]);
  const pendingPdf = pendingPdfs[0] ?? null;
  const queuedRetryNeededRef = useRef(false);
  const queuedRetryInFlightRef = useRef(false);
  const queuedRetryContextRef = useRef<{
    files: number;
    accepted: number;
    rejected: number;
    pages: number;
    alreadyProcessed: number;
  } | null>(null);
  const [pdfPassword, setPdfPassword] = useState('');
  const [currencySheetVisible, setCurrencySheetVisible] = useState(false);
  const coverage = useMemo(
    () => summarizeCoverage(state.statementCoverage ?? [], language, undefined, displayRegion()),
    [language, state.statementCoverage],
  );

  useEffect(() => {
    pendingPdfsRef.current = pendingPdfs;
  }, [pendingPdfs]);

  useEffect(() => {
    aliveRef.current = true;
    // A statement copy left in the picker cache by an earlier session that
    // ended mid-import (app killed, crash) is cleared when the screen opens.
    clearStatementPickerCache(inFlightPickerUris);
    return () => {
      aliveRef.current = false;
      for (const pending of pendingPdfsRef.current) {
        try {
          if (pending.file.exists) pending.file.delete();
        } catch {
          // Picker cache cleanup is best effort.
        }
      }
      // And again on the way out, except a copy an upload is still reading.
      clearStatementPickerCache(inFlightPickerUris);
    };
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
    if (value.code === 'ambiguous_card_signs') return copy.errCardSigns;
    if (value.code === 'ambiguous_dates') return copy.errDates;
    if (value.code === 'rate_limited' || value.code === 'queue_full') return copy.errRate;
    if (value.code === 'service') return copy.serviceError;
    return copy.errUnexpected;
  }, [copy]);

  const loadCapabilities = useCallback(async (active: RelayConfig): Promise<ImportCapabilities | null> => {
    if (getStateSnapshot().privateMode) return null;
    setBusy('capabilities');
    setError(null);
    try {
      const loaded = await getImportCapabilities(active);
      setCapabilities(loaded);
      return loaded;
    } catch (e) {
      setCapabilities(null);
      setError(errorText(e));
      return null;
    } finally {
      setBusy(null);
    }
  }, [errorText, getStateSnapshot]);

  useEffect(() => {
    let live = true;
    if (preview) {
      setLoadingConfig(false);
      return () => { live = false; };
    }
    void getRelayConfig()
      .then((existing) => {
        if (!live) return;
        setCfg(existing);
        if (existing && !getStateSnapshot().privateMode) void loadCapabilities(existing);
      })
      .finally(() => {
        if (live) setLoadingConfig(false);
      });
    return () => { live = false; };
  }, [getStateSnapshot, loadCapabilities, preview]);

  /**
   * The secure import connection, made on the first "Choose file" tap. The
   * disclosure above that button says where files go; there is no separate
   * connect step to read first.
   */
  const connect = async (): Promise<{ cfg: RelayConfig; capabilities: ImportCapabilities } | null> => {
    if (loadingConfig || busy !== null) return null;
    if (!DEFAULT_RELAY_URL) {
      setError(copy.unavailable);
      return null;
    }
    setBusy('connect');
    setError(null);
    setStatus(null);
    try {
      const existing = await getRelayConfig();
      if (existing) {
        setCfg(existing);
        const loaded = await loadCapabilities(existing);
        return loaded ? { cfg: existing, capabilities: loaded } : null;
      }
      const connected = await pairDevice(DEFAULT_RELAY_URL);
      setCfg(connected);
      const loaded = await loadCapabilities(connected);
      committed();
      return loaded ? { cfg: connected, capabilities: loaded } : null;
    } catch (e) {
      setError(errorText(e));
      return null;
    } finally {
      setBusy(null);
    }
  };

  const syncQueued = useCallback(async (): Promise<{ imported: number; review: number }> => {
    let imported = 0;
    let review = 0;
    // The relay intentionally serves at most 200 rows per page. A multi-file
    // statement import can queue more than that, so one successful page must not
    // be mistaken for a completed import. Drain page-by-page, yielding between
    // durable commits so the Settings screen and tab bar stay responsive.
    for (let page = 0; page < 50; page += 1) {
      const outcome = await captureExecutor.execute('supplemental');
      if (outcome.kind === 'not-hydrated') throw new Error(copy.notHydrated);
      if (outcome.kind === 'needs-setup') throw new Error(copy.unavailable);
      if (outcome.kind !== 'imported' && outcome.kind !== 'up-to-date') return { imported, review };
      imported += outcome.transactions;
      review += outcome.reviewAlerts;
      if (outcome.moreQueued !== true) return { imported, review };
      await new Promise<void>((resolve) => setTimeout(resolve, 0));
    }
    throw new Error(copy.syncFailedUnknown);
  }, [captureExecutor, copy.notHydrated, copy.syncFailedUnknown, copy.unavailable]);

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
      stageStatementCoverage({ ...item, format, importedAt });
    }
  }, [stageStatementCoverage]);

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

  /**
   * The batch summary. "Already in your ledger" is said only about rows the
   * phone actually received and found there; files the relay recognised as a
   * recent re-upload queued nothing, and say so instead.
   */
  const batchSummary = useCallback((
    context: { files: number; accepted: number; rejected: number; alreadyProcessed: number },
    imported: number,
  ): string => {
    if (imported === 0 && context.alreadyProcessed === context.files) return copy.statementsAlreadyProcessed;
    return interpolate(imported > 0 ? copy.statementsSuccess : copy.statementsNoNew, {
      files: countPhrase(language, copy.filesCount, context.files),
      rows: countPhrase(language, copy.rowsRead, context.accepted),
      rejected: context.rejected,
      imported,
    });
  }, [copy, language]);

  const finishQueuedImport = useCallback(async (
    files: number,
    accepted: number,
    rejected: number,
    pages: number,
    alreadyProcessed = 0,
  ): Promise<boolean> => {
    setStatus(interpolate(copy.acceptedFiling, { accepted }));
    try {
      // Paint the accepted state before planning/reconciling a potentially large ledger.
      await new Promise<void>((resolve) => setTimeout(resolve, 0));
      const { imported, review } = await syncQueued();
      queuedRetryNeededRef.current = false;
      queuedRetryContextRef.current = null;
      setStatus(batchSummary({ files, accepted, rejected, alreadyProcessed }, imported));
      setSummary((current) => ({
        added: (current?.added ?? 0) + imported,
        review: (current?.review ?? 0) + review,
        skipped: (current?.skipped ?? 0) + rejected,
      }));
      committed();
      return true;
    } catch (e) {
      // The rows stay queued on the relay; say what stopped them landing here
      // instead of folding every failure into the "not synced yet" status.
      setStatus(interpolate(copy.acceptedPending, { accepted }));
      setError(interpolate(copy.syncFailed, { reason: syncFailureReason(e) }));
      queuedRetryNeededRef.current = true;
      queuedRetryContextRef.current = { files, accepted, rejected, pages, alreadyProcessed };
      failed();
      return false;
    }
  }, [batchSummary, copy, syncFailureReason, syncQueued]);

  // Successful upload means the normalized rows are already safe in the relay
  // queue. If the immediate phone-side drain loses a network turn, retry once
  // shortly afterwards and again whenever the app returns to foreground. The
  // capture executor still owns save-before-ACK, so a retry cannot retire rows
  // until the local encrypted ledger write is durable.
  useEffect(() => {
    if (!cfg || state.privateMode) return;

    const retryQueued = async () => {
      if (!queuedRetryNeededRef.current || queuedRetryInFlightRef.current) return;
      queuedRetryInFlightRef.current = true;
      try {
        const { imported, review } = await syncQueued();
        queuedRetryNeededRef.current = false;
        const context = queuedRetryContextRef.current;
        queuedRetryContextRef.current = null;
        setError(null);
        if (context) {
          setStatus(batchSummary(context, imported));
          setSummary((current) => ({
            added: (current?.added ?? 0) + imported,
            review: (current?.review ?? 0) + review,
            skipped: (current?.skipped ?? 0) + context.rejected,
          }));
        }
        committed();
      } catch {
        // Keep the queued rows untouched. A later foreground transition gets
        // another chance without asking the user to upload the statement again.
      } finally {
        queuedRetryInFlightRef.current = false;
      }
    };

    const timer = setTimeout(() => { void retryQueued(); }, 1_500);
    const subscription = AppState.addEventListener('change', (next) => {
      if (next === 'active') void retryQueued();
    });
    return () => {
      clearTimeout(timer);
      subscription.remove();
    };
  }, [batchSummary, cfg, state.privateMode, syncQueued]);

  /** What one successfully uploaded file contributed, in words. */
  const fileImportedDetail = (accepted: {
    acceptedRows: number; rejectedRows: number; cardSignRowsSkipped: number; alreadyProcessed: boolean;
  }): string => {
    if (accepted.alreadyProcessed) return copy.fileAlreadyProcessed;
    const rows = countPhrase(language, copy.rowsRead, accepted.acceptedRows);
    const parts = [accepted.rejectedRows > 0
      ? interpolate(copy.fileImportedSkipped, { rows, skipped: accepted.rejectedRows })
      : interpolate(copy.fileImported, { rows })];
    if (accepted.cardSignRowsSkipped > 0) {
      parts.push(interpolate(copy.cardSignSkipped, { count: accepted.cardSignRowsSkipped }));
    }
    return parts.join(' ');
  };

  const pickAndUpload = async (cfg: RelayConfig, capabilities: ImportCapabilities) => {
    if (pendingPdfs.length > 0) return;
    if (!state.ledgerMoney) {
      setCurrencySheetVisible(true);
      return;
    }
    const ledgerMoney = state.ledgerMoney;
    const dateOrder = statementDateOrderForCountry(state.country);
    setError(null);
    setStatus(null);
    setFileResults([]);
    setSummary(null);
    setFilesOpen(false);
    const pickedFiles: File[] = [];
    const retainedUris = new Set<string>();
    // Declared outside the try so a failure later in the batch still hands the
    // deferred locked PDFs to the password prompt instead of leaking their copies.
    const protectedPdfs: PendingProtectedPdf[] = [];
    try {
      const picked = await DocumentPicker.getDocumentAsync({
        type: [...capabilities.pdf.accepts, ...capabilities.csv.accepts],
        copyToCacheDirectory: true,
        multiple: true,
      });
      if (picked.canceled || picked.assets.length === 0) return;
      setBusy('statement');
      setLiveFiles(picked.assets.map((asset) => ({ name: asset.name, status: 'waiting' })));
      // Each file's row moves waiting → reading → done / locked / failed.
      const markFile = (position: number, status: LiveFile['status'], detail?: string) => {
        if (!aliveRef.current) return;
        setLiveFiles((current) => current.map((item, i) => i === position ? { ...item, status, detail } : item));
      };
      let acceptedRows = 0;
      let rejectedRows = 0;
      let pages = 0;
      let uploadedFiles = 0;
      let alreadyProcessedFiles = 0;
      const total = picked.assets.length;
      const fileResults: FileResult[] = [];
      const coverage: { item: StatementImportCoverage | null; format: 'pdf' | 'csv' }[] = [];
      // The relay rate-limits each format separately; pace each below it.
      const starts: Record<'pdf' | 'csv', number[]> = { pdf: [], csv: [] };
      let limitReached = false;
      // Wait visibly, and give up the wait if the screen goes away.
      const waitFor = async (ms: number, position: number) => {
        const until = Date.now() + ms;
        while (aliveRef.current && Date.now() < until) {
          setStatus(interpolate(copy.waitingForLimit, {
            seconds: Math.ceil((until - Date.now()) / 1000), index: position, total,
          }));
          await sleep(Math.min(1_000, until - Date.now()));
        }
        return aliveRef.current;
      };
      for (let index = 0; index < picked.assets.length; index += 1) {
        const asset = picked.assets[index];
        const file = new File(asset.uri);
        pickedFiles.push(file);
        const csv = /\.(?:csv|tsv)$/i.test(asset.name) ||
          capabilities.csv.accepts.includes(asset.mimeType?.split(';', 1)[0].toLowerCase() ?? '');
        const format = csv ? 'csv' : 'pdf';
        if (limitReached || !aliveRef.current) {
          fileResults.push({ name: asset.name, ok: false, detail: copy.fileNotTried });
          markFile(index, 'failed', copy.fileNotTried);
          continue;
        }
        inFlightPickerUris.add(asset.uri);
        try {
          let accepted: Awaited<ReturnType<typeof uploadPdfStatement | typeof uploadCsvStatement>> | null = null;
          for (let attempt = 0; accepted === null; attempt += 1) {
            const delay = nextUploadDelay(starts[format], Date.now());
            if (delay > 0 && !(await waitFor(delay, index + 1))) throw new CloudImportError('network');
            setStatus(interpolate(copy.uploadingProgress, { index: index + 1, total }));
            setProgress({ index: index + 1, total });
            markFile(index, 'reading');
            starts[format].push(Date.now());
            try {
              accepted = csv
                ? await uploadCsvStatement(cfg, asset, capabilities, ledgerMoney, dateOrder)
                : await uploadPdfStatement(cfg, asset, capabilities, ledgerMoney, undefined, dateOrder);
            } catch (uploadError) {
              // One patient retry: pacing keeps the minute limit, so a 429 here
              // is usually the hourly budget, and a second one ends the batch.
              if (attempt === 0 && uploadError instanceof CloudImportError && uploadError.code === 'rate_limited' &&
                  await waitFor(RATE_LIMIT_RETRY_MS, index + 1)) continue;
              throw uploadError;
            }
          }
          acceptedRows += accepted.acceptedRows;
          rejectedRows += accepted.rejectedRows;
          uploadedFiles += 1;
          if (accepted.alreadyProcessed) alreadyProcessedFiles += 1;
          if ('pages' in accepted && typeof accepted.pages === 'number') pages += accepted.pages;
          coverage.push({ item: accepted.coverage, format });
          fileResults.push({ name: asset.name, ok: true, detail: fileImportedDetail(accepted) });
          markFile(index, 'done', fileImportedDetail(accepted));
        } catch (e) {
          if (!csv && e instanceof CloudImportError &&
              (e.code === 'pdf_password_required' || e.code === 'pdf_password_incorrect')) {
            // Retain every locked picker copy and ask for one password at a
            // time. Keeping the secrets sequential means Wafra can accept a
            // mixed batch of protected statements without ever holding a list
            // of passwords in memory or asking the user to re-pick skipped
            // files.
            retainedUris.add(asset.uri);
            fileResults.push({ name: asset.name, ok: false, detail: copy.fileLocked });
            markFile(index, 'locked', copy.fileLocked);
            protectedPdfs.push({ asset, file });
            continue;
          }
          // Any other failure is this file's, not the batch's: record why and
          // carry on, so the files that did import still get their coverage
          // and their rows filed below.
          if (e instanceof CloudImportError && (e.code === 'rate_limited' || e.code === 'queue_full')) {
            limitReached = true;
          }
          const failedDetail = interpolate(copy.fileFailed, {
            reason: e instanceof Error && e.message === copy.notHydrated ? e.message : errorText(e),
          });
          fileResults.push({ name: asset.name, ok: false, detail: failedDetail });
          markFile(index, 'failed', failedDetail);
          continue;
        } finally {
          inFlightPickerUris.delete(asset.uri);
        }
        if (index + 1 < picked.assets.length) {
          await new Promise<void>((resolve) => setTimeout(resolve, 0));
        }
      }
      if (aliveRef.current) setFileResults(fileResults);
      await rememberCoverage(coverage);
      if (protectedPdfs.length > 0) {
        setPendingPdfs(protectedPdfs);
        setPdfPassword('');
        setError(null);
      }
      if (uploadedFiles > 0) {
        await finishQueuedImport(uploadedFiles, acceptedRows, rejectedRows, pages, alreadyProcessedFiles);
      } else {
        setStatus(null);
        if (fileResults.some((result) => !result.ok && result.detail !== copy.fileLocked)) failed();
      }
    } catch (e) {
      if (protectedPdfs.length > 0) {
        setPendingPdfs(protectedPdfs);
        setPdfPassword('');
      }
      setError(e instanceof Error && e.message === copy.notHydrated ? e.message : errorText(e));
      failed();
    } finally {
      for (const file of pickedFiles) {
        if (retainedUris.has(file.uri)) continue;
        try {
          if (file.exists) file.delete();
        } catch {
          // The OS may already have reclaimed this picker cache copy; the
          // remaining copies in the batch still get their turn.
        }
      }
      setBusy(null);
      setProgress(null);
      if (aliveRef.current) setLiveFiles([]);
    }
  };

  /** One tap: connect if needed, then open the file picker. */
  const chooseFile = async () => {
    if (loadingConfig || busy !== null || pendingPdfs.length > 0) return;
    if (!state.ledgerMoney) {
      setCurrencySheetVisible(true);
      return;
    }
    let ready: { cfg: RelayConfig; capabilities: ImportCapabilities } | null =
      cfg && capabilities ? { cfg, capabilities } : null;
    if (!ready && cfg) {
      const loaded = await loadCapabilities(cfg);
      ready = loaded ? { cfg, capabilities: loaded } : null;
    }
    if (!ready && !cfg) ready = await connect();
    if (!ready) return;
    await pickAndUpload(ready.cfg, ready.capabilities);
  };

  const retryProtectedPdf = async () => {
    if (!cfg || !capabilities || !pendingPdf || !pdfPassword || busy !== null) return;
    if (!state.ledgerMoney) {
      setCurrencySheetVisible(true);
      return;
    }
    setBusy('statement');
    setError(null);
    try {
      const accepted = await uploadPdfStatement(
        cfg,
        pendingPdf.asset,
        capabilities,
        state.ledgerMoney,
        pdfPassword,
        statementDateOrderForCountry(state.country),
      );
      await rememberCoverage([{ item: accepted.coverage, format: 'pdf' }]);
      const unlockedName = pendingPdf.asset.name;
      setFileResults((current) => [
        ...current.filter((result) => result.name !== unlockedName || result.detail !== copy.fileLocked),
        { name: unlockedName, ok: true, detail: fileImportedDetail(accepted) },
      ]);
      await finishQueuedImport(
        1, accepted.acceptedRows, accepted.rejectedRows, accepted.pages, accepted.alreadyProcessed ? 1 : 0,
      );
      try { if (pendingPdf.file.exists) pendingPdf.file.delete(); } catch { /* best effort */ }
      setPendingPdfs((current) => current[0]?.file.uri === pendingPdf.file.uri
        ? current.slice(1)
        : current.filter((item) => item.file.uri !== pendingPdf.file.uri));
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
    setPendingPdfs((current) => current[0]?.file.uri === pendingPdf.file.uri
      ? current.slice(1)
      : current.filter((item) => item.file.uri !== pendingPdf.file.uri));
    setPdfPassword('');
    setError(null);
  };

  const locked = state.privateMode;
  const pdfMb = capabilities ? Math.round(capabilities.pdf.maxBytes / 1048576) : 0;
  const csvMb = capabilities ? Math.round(capabilities.csv.maxBytes / 1048576) : 0;
  const reading = busy === 'statement';
  const failedFiles = fileResults.filter((result) => !result.ok);
  const shownFiles = filesOpen ? fileResults : failedFiles;
  const numbers = summary
    ? [
        { key: 'added', value: summary.added, label: copy.resultAdded, tone: theme.primary },
        { key: 'review', value: summary.review, label: copy.resultReview, tone: summary.review > 0 ? theme.warning : theme.text },
        { key: 'skipped', value: summary.skipped, label: copy.resultSkipped, tone: theme.textSecondary },
      ]
    : [];

  return (
    <View style={styles.root}>
      {/* First-run setup already said this one step earlier. */}
      {!onboarding && <ThemedText type="default" themeColor="textSecondary">{copy.intro}</ThemedText>}

      {locked ? (
        <Block>
          <View style={styles.cardHead}>
            <Icon name="lock" size={20} color={theme.warning} />
            <ThemedText type="small" style={styles.cardCopy}>{copy.privateTitle}</ThemedText>
          </View>
          <ThemedText type="meta" themeColor="textTertiary">{copy.privateBody}</ThemedText>
          <Button label={copy.reviewPrivacy} variant="outline" onPress={() => router.push('/settings?section=privacy')} />
        </Block>
      ) : (
        <>
          {/* What to download, before the button that asks for it. */}
          <View
            testID="statement-download-hint"
            style={[styles.hint, { backgroundColor: theme.backgroundElement, borderColor: theme.cardBorder }]}>
            <ThemedText type="smallBold" accessibilityRole="header">{copy.downloadTitle}</ThemedText>
            {[copy.downloadStep, Platform.OS === 'android' ? copy.findStepAndroid : copy.findStepIos].map((line, index) => (
              <View key={line} style={styles.hintRow} accessible accessibilityLabel={`${index + 1}. ${line}`}>
                <View style={[styles.hintNumber, { backgroundColor: theme.primarySoft }]}>
                  <ThemedText type="micro" themeColor="primary" tabular>{index + 1}</ThemedText>
                </View>
                <ThemedText type="small" style={styles.cardCopy}>{line}</ThemedText>
              </View>
            ))}
          </View>

          {!state.ledgerMoney && (
            <View style={styles.currencyPrompt}>
              <View style={styles.cardCopy}>
                <ThemedText type="small">{t('ledgerCurrencyTitle')}</ThemedText>
                <ThemedText type="meta" themeColor="textTertiary">{t('ledgerCurrencyBody')}</ThemedText>
              </View>
              <Button
                variant="outline"
                label={t('chooseLedgerCurrency')}
                onPress={() => setCurrencySheetVisible(true)}
                disabled={busy !== null}
              />
            </View>
          )}

          <View style={styles.chooser}>
            <View style={styles.disclosure}>
              <Icon name="lock" size={15} color={theme.textSecondary} />
              <ThemedText type="meta" themeColor="textSecondary" style={styles.messageText}>
                {copy.uploadDisclosure}
              </ThemedText>
            </View>
            <View style={styles.disclosure} testID="statement-date-note">
              <Icon name="calendar" size={15} color={theme.textSecondary} />
              <ThemedText type="meta" themeColor="textSecondary" style={styles.messageText}>
                {statementDateNote(state.country, language)}
              </ThemedText>
            </View>
            <Button
              icon="upload"
              label={busy === 'connect' || busy === 'capabilities' ? copy.connecting
                : reading ? copy.uploading : fileResults.length > 0 ? copy.chooseStatements : copy.chooseFile}
              onPress={() => void chooseFile()}
              disabled={loadingConfig || busy !== null || pendingPdfs.length > 0 || !state.ledgerMoney}
            />
            <ThemedText type="meta" themeColor="textTertiary" style={styles.center}>
              {copy.formats}
            </ThemedText>
          </View>

          {reading && (
            <View
              testID="statement-progress"
              accessible
              accessibilityRole="progressbar"
              accessibilityLabel={status ?? copy.uploading}
              accessibilityValue={progress ? { min: 0, max: progress.total, now: progress.index } : undefined}
              style={[styles.progressCard, { backgroundColor: theme.backgroundElement, borderColor: theme.cardBorder }]}>
              <View style={styles.cardHead}>
                <ActivityIndicator color={theme.primary} />
                <ThemedText type="small" style={styles.cardCopy}>
                  {progress ? interpolate(copy.progressLabel, progress) : copy.uploading}
                </ThemedText>
              </View>
              {progress && (
                <View style={[styles.track, { backgroundColor: theme.track }]}>
                  <View style={[styles.fill, {
                    backgroundColor: theme.primary,
                    width: `${Math.round((progress.index / progress.total) * 100)}%`,
                  }]} />
                </View>
              )}
              {/* The bar already says "2 of 3"; the status line adds only waits and filing. */}
              {status && status !== interpolate(copy.uploadingProgress, progress ?? { index: 0, total: 0 })
                ? <ThemedText type="meta" themeColor="textSecondary">{status}</ThemedText> : null}
            </View>
          )}

          {reading && liveFiles.length > 1 && (
            <View testID="statement-file-status" style={styles.results}>
              {liveFiles.map((file, index) => {
                const statusText = file.status === 'waiting'
                  ? copy.fileStatusWaiting
                  : file.status === 'reading'
                    ? copy.fileStatusReading
                    : file.detail ?? '';
                return (
                  <View
                    key={`${index}:${file.name}`}
                    style={styles.resultRow}
                    accessible
                    accessibilityLabel={interpolate(copy.fileStatusLabel, { name: file.name, status: statusText })}>
                    {file.status === 'reading' ? (
                      <ActivityIndicator size="small" color={theme.primary} />
                    ) : (
                      <Icon
                        name={file.status === 'done' ? 'check'
                          : file.status === 'locked' ? 'lock'
                            : file.status === 'failed' ? 'alert' : 'receipt'}
                        size={15}
                        color={file.status === 'done' ? theme.primary
                          : file.status === 'failed' ? theme.expense : theme.textTertiary}
                      />
                    )}
                    <View style={styles.cardCopy}>
                      <ThemedText type="meta" numberOfLines={1}>{file.name}</ThemedText>
                      <ThemedText
                        type="meta"
                        themeColor={file.status === 'failed' ? 'expense' : 'textSecondary'}>
                        {statusText}
                      </ThemedText>
                    </View>
                  </View>
                );
              })}
            </View>
          )}

          {summary && !reading && (
            <View
              testID="statement-result-summary"
              accessible
              accessibilityRole="summary"
              accessibilityLiveRegion="polite"
              accessibilityLabel={interpolate(copy.summaryLabel, summary)}
              style={[styles.summary, { backgroundColor: theme.backgroundElement, borderColor: theme.cardBorder }]}>
              {numbers.map((item, index) => (
                <React.Fragment key={item.key}>
                  {index > 0 && <View style={[styles.summaryDivider, { backgroundColor: theme.cardBorder }]} />}
                  <View style={styles.summaryCell}>
                    <ThemedText type="title" tabular style={{ color: item.tone }}>{item.value}</ThemedText>
                    <ThemedText type="meta" themeColor="textSecondary" style={styles.center}>{item.label}</ThemedText>
                  </View>
                </React.Fragment>
              ))}
            </View>
          )}

          {!reading && status && (!summary || error) ? (
            <View style={[styles.message, { backgroundColor: theme.primarySoft, borderColor: theme.primaryBorder }]}>
              <Icon name="check" size={17} color={theme.primary} />
              <ThemedText type="meta" style={styles.messageText}>{status}</ThemedText>
            </View>
          ) : null}

          {fileResults.length > 0 && !reading && (
            <View style={styles.results}>
              {shownFiles.map((result, index) => (
                <View
                  key={`${index}:${result.name}`}
                  style={styles.resultRow}
                  accessible
                  accessibilityLabel={`${result.ok ? copy.resultOkLabel : copy.resultFailedLabel}: ${result.name}. ${result.detail}`}
                >
                  <Icon
                    name={result.ok ? 'check' : 'alert'}
                    size={15}
                    color={result.ok ? theme.primary : theme.expense}
                  />
                  <View style={styles.cardCopy}>
                    <ThemedText type="meta" numberOfLines={1}>{result.name}</ThemedText>
                    <ThemedText type="meta" themeColor={result.ok ? 'textTertiary' : 'expense'}>
                      {result.detail}
                    </ThemedText>
                  </View>
                </View>
              ))}
              {fileResults.length > failedFiles.length && (
                <Button
                  variant="ghost"
                  label={filesOpen ? copy.hideFiles : interpolate(copy.showFiles, { count: fileResults.length })}
                  onPress={() => setFilesOpen((value) => !value)}
                />
              )}
            </View>
          )}

          {pendingPdf && (
            <Block style={styles.passwordCard}>
              <View style={styles.cardHead}>
                <View style={[styles.iconWell, { backgroundColor: theme.primarySoft }]}>
                  <Icon name="lock" size={20} color={theme.primary} />
                </View>
                <View style={styles.cardCopy}>
                  <ThemedText type="small">{copy.passwordTitle}</ThemedText>
                  <ThemedText type="meta" numberOfLines={1}>{pendingPdf.asset.name}</ThemedText>
                  <ThemedText type="meta" themeColor="textTertiary">
                    {pendingPdfs.length > 1
                      ? interpolate(copy.passwordQueueBody, { count: pendingPdfs.length })
                      : copy.passwordBody}
                  </ThemedText>
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

          {error && (
            <View
              accessibilityRole="alert"
              accessibilityLiveRegion="polite"
              style={[styles.message, { backgroundColor: theme.expenseSoftBg, borderColor: theme.expenseSoftBorder }]}>
              <Icon name="alert" size={17} color={theme.expense} />
              <ThemedText type="meta" style={[styles.messageText, { color: theme.expense }]}>{error}</ThemedText>
            </View>
          )}
          {cfg && !capabilities && busy === null && !loadingConfig && error && (
            <Button variant="outline" label={copy.retry} onPress={() => void loadCapabilities(cfg)} />
          )}

          {coverage.length > 0 && (
            <Block style={styles.coverageCard}>
              <View style={styles.cardHead}>
                <View style={[styles.iconWell, { backgroundColor: theme.backgroundSelected }]}>
                  <Icon name="calendar" size={20} color={theme.text} />
                </View>
                <ThemedText type="small" style={styles.cardCopy}>{copy.coverageTitle}</ThemedText>
              </View>
              {coverage.map((item) => {
                const shownMissing = item.missing.slice(0, 4);
                const more = item.missing.length - shownMissing.length;
                return (
                  <View key={item.sourceKey} style={[styles.coverageRow, { borderTopColor: theme.cardBorder }]}>
                    <View style={styles.coverageHead}>
                      <ThemedText type="smallBold" style={styles.coverageLabel}>
                        {item.sourceKey === 'bank-statements' ? copy.coverageUnidentifiedLabel : item.label}
                      </ThemedText>
                      <ThemedText type="meta" themeColor="textSecondary" tabular>{item.range}</ThemedText>
                    </View>
                    {/* A statement that names no account cannot prove there are no gaps. */}
                    <ThemedText type="meta" themeColor={item.identified && item.missing.length ? 'expense' : 'textTertiary'}>
                      {!item.identified
                        ? copy.coverageUnknown
                        : item.missing.length
                          ? interpolate(copy.coverageMissing, {
                              months: `${shownMissing.join(', ')}${more > 0 ? ` +${more}` : ''}`,
                            })
                          : interpolate(copy.coverageComplete, { month: item.throughMonth })}
                    </ThemedText>
                  </View>
                );
              })}
            </Block>
          )}

          <Pressable
            accessibilityRole="button"
            accessibilityLabel={copy.howItWorks}
            accessibilityState={{ expanded: detailsOpen }}
            onPress={() => setDetailsOpen((value) => !value)}
            style={({ pressed }) => [styles.howLink, { opacity: pressed ? 0.6 : 1 }]}>
            <ThemedText type="linkPrimary">{copy.howItWorks}</ThemedText>
            <Icon name={detailsOpen ? 'chevron-down' : 'chevron-right'} size={14} color={theme.primary} />
          </Pressable>
          {detailsOpen && (
            <View style={[styles.privacy, { borderTopColor: theme.cardBorder }]} testID="statement-how-it-works">
              <ThemedText type="small">{copy.privacyTitle}</ThemedText>
              <ThemedText type="meta" themeColor="textTertiary">{copy.privacyBody}</ThemedText>
              <ThemedText type="meta" themeColor="textTertiary">{copy.statementBody}</ThemedText>
              {capabilities && (
                <ThemedText type="nano" themeColor="textTertiary" tabular>
                  {interpolate(copy.statementLimits, {
                    pdfMb, csvMb, pages: capabilities.pdf.maxPages, rows: capabilities.pdf.maxRows,
                  })}
                </ThemedText>
              )}
            </View>
          )}
        </>
      )}

      {onboarding && (
        <View style={styles.onboardingFooter}>
          <Button
            label={summary ? copy.continue : copy.later}
            variant={summary ? 'filled' : 'ghost'}
            onPress={onboarding.onContinue}
            disabled={busy !== null}
          />
        </View>
      )}
      <LedgerCurrencySheet
        visible={currencySheetVisible}
        value={state.ledgerMoney?.currency ?? null}
        onClose={() => setCurrencySheetVisible(false)}
        onSelect={setLedgerMoney}
      />
    </View>
  );
}

const styles = StyleSheet.create({
  root: { gap: Spacing.three },
  hint: {
    borderWidth: 1,
    borderRadius: Radius.sheet,
    padding: Spacing.three,
    gap: Spacing.two + Spacing.one,
  },
  hintRow: { flexDirection: 'row', alignItems: 'flex-start', gap: Spacing.two + Spacing.one },
  hintNumber: {
    width: 24,
    height: 24,
    borderRadius: Radius.full,
    alignItems: 'center',
    justifyContent: 'center',
    marginTop: 1,
  },
  chooser: { gap: Spacing.two + Spacing.one, paddingVertical: Spacing.one },
  center: { textAlign: 'center' },
  currencyPrompt: { gap: Spacing.two },
  passwordCard: { gap: Spacing.three },
  coverageCard: { gap: Spacing.two },
  progressCard: {
    borderWidth: 1,
    borderRadius: Radius.control,
    padding: Spacing.three,
    gap: Spacing.two + Spacing.one,
  },
  track: { height: 6, borderRadius: Radius.full, overflow: 'hidden' },
  fill: { height: 6, borderRadius: Radius.full },
  summary: {
    flexDirection: 'row',
    alignItems: 'stretch',
    borderWidth: 1,
    borderRadius: Radius.sheet,
    paddingVertical: Spacing.three,
  },
  summaryCell: { flex: 1, alignItems: 'center', gap: Spacing.half, paddingHorizontal: Spacing.one },
  summaryDivider: { width: StyleSheet.hairlineWidth },
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
  disclosure: { flexDirection: 'row', alignItems: 'flex-start', gap: Spacing.two },
  results: { gap: Spacing.two },
  resultRow: { flexDirection: 'row', alignItems: 'flex-start', gap: Spacing.two },
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
  howLink: { minHeight: 44, flexDirection: 'row', alignItems: 'center', gap: Spacing.one, alignSelf: 'flex-start' },
  privacy: {
    gap: Spacing.two,
    borderTopWidth: StyleSheet.hairlineWidth,
    paddingTop: Spacing.three,
  },
  onboardingFooter: { paddingTop: Spacing.two },
});
