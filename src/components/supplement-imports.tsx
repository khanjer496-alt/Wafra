import * as DocumentPicker from 'expo-document-picker';
import { File } from 'expo-file-system';
import { useRouter } from '@/hooks/use-app-router';
import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { ActivityIndicator, AppState, Platform, Pressable, StyleSheet, View } from 'react-native';

import { ThemedText } from '@/components/themed-text';
import { LedgerCurrencySheet } from '@/components/ledger-currency-sheet';
import { EButton } from '@/components/ui/band/e-button';
import { Icon } from '@/components/ui/icon';
import { TextField } from '@/components/ui/text-field';
import { Fonts, Radius, Spacing, type BandPalette } from '@/constants/theme';
import { useBand } from '@/hooks/use-band';
import { useLanguage } from '@/hooks/use-language';
import { useLargeTextLayout } from '@/hooks/use-large-text-layout';
import { createCaptureExecutor } from '@/lib/capture-executor';
import {
  clearStatementPickerCache,
  getImportCapabilities,
  uploadCsvStatement,
  uploadPdfStatement,
  type PickedStatement,
  type StatementDateOrder,
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
import { displayRegion } from '@/lib/ledger-money';
import { summarizeCoverage } from '@/lib/statement-coverage';
import { countPhrase, nextUploadDelay } from '@/lib/statement-batch';
import { drainStatementQueue, newStatementRange } from '@/lib/statement-import-flow';
import { t } from '@/lib/i18n';
import { committed, failed } from '@/lib/haptics';

type CoverageRange = { item: StatementImportCoverage | null; format: 'pdf' | 'csv' };

type Busy = 'connect' | 'capabilities' | 'statement' | null;

type PendingProtectedPdf = {
  asset: PickedStatement;
  file: File | null;
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

/** The two parts of the importer, for a screen that puts one on its band. */
export interface SupplementImportsParts {
  /** The plain line, the upload disclosure and the choose-file control. */
  band: React.ReactNode;
  /** Files, results, the password step, what to download and the date note. */
  sheet: React.ReactNode;
}

export interface SupplementImportsProps {
  /** First-run setup: a footer to move on, with or without a statement. */
  onboarding?: { onContinue(): void };
  preview?: SupplementImportsPreview;
  /**
   * Statement import frames the importer on the sand band: the choose-file
   * control goes on the band, the rest on the sheet. Without it both parts
   * stack on whatever sheet embeds the importer.
   */
  frame?: (parts: SupplementImportsParts) => React.ReactElement;
}

export function SupplementImports({ onboarding, preview, frame }: SupplementImportsProps = {}) {
  const router = useRouter();
  const language = useLanguage();
  const copy = SUPPLEMENT_COPY[language];
  const band = useBand('settings');
  const largeText = useLargeTextLayout();
  const {
    state,
    getStateSnapshot,
    getStateGeneration,
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
        getStateGeneration,
        importBatch,
        stageReviewAlerts,
        ensureDurable,
        setMarket: (market) => setMarket(market),
      },
    }),
    [ensureDurable, getStateGeneration, getStateSnapshot, importBatch, setMarket, stageReviewAlerts],
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
    ranges: readonly CoverageRange[];
    generation: number;
    reportedImported: number;
    totalRejected: number;
  } | null>(null);
  const [pdfPassword, setPdfPassword] = useState('');
  const [dateOrder, setDateOrder] = useState<StatementDateOrder>(null);
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
        if (inFlightPickerUris.has(pending.asset.uri)) continue;
        try {
          if (pending.file?.exists) pending.file.delete();
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
    if (value.code === 'statement_does_not_reconcile') return copy.errReconcile;
    if (value.code === 'ambiguous_card_signs') return copy.errCardSigns;
    if (value.code === 'ambiguous_dates') return copy.errDates;
    if (value.code === 'statement_options_conflict') return copy.errOptionsConflict;
    if (value.code === 'statement_currency_mismatch') return copy.errCurrencyMismatch;
    if (value.code === 'multiple_statement_accounts') return copy.errMultipleAccounts;
    if (value.code === 'queue_full') return copy.errQueueFull;
    if (value.code === 'rate_limited') return copy.errRate;
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

  const syncQueued = useCallback((generation: number) => drainStatementQueue(
    () => captureExecutor.execute('supplemental'),
    () => aliveRef.current && getStateGeneration() === generation && !getStateSnapshot().privateMode,
  ), [captureExecutor, getStateGeneration, getStateSnapshot]);

  // Ranges are recorded only after the accepted queue is durably filed.
  // recordStatementCoverage persists the full encrypted ledger on every call,
  // and awaiting it inside the per-file loop stalled the picker once per
  // statement — the "laggy import" report. Duplicate ranges (the same account
  // exported twice) collapse to one write here rather than one persist each.
  const rememberCoverage = useCallback(async (
    items: readonly CoverageRange[],
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
    files: number, accepted: number, rejected: number, pages: number,
    alreadyProcessed = 0, ranges: readonly CoverageRange[] = [],
    generation = getStateGeneration(), reportedImported = 0, totalRejected = rejected, isRetry = false,
  ): Promise<boolean> => {
    const pending = queuedRetryContextRef.current;
    if (!isRetry && pending && pending.generation === generation) {
      files += pending.files;
      accepted += pending.accepted;
      pages += pending.pages;
      alreadyProcessed += pending.alreadyProcessed;
      ranges = [...pending.ranges, ...ranges];
      reportedImported += pending.reportedImported;
      totalRejected += pending.totalRejected;
    }
    queuedRetryContextRef.current = null;
    setStatus(accepted > 0 ? interpolate(copy.acceptedFiling, { accepted }) : copy.queueFiling);
    const result = await syncQueued(generation);
    if (generation !== getStateGeneration() || !aliveRef.current) {
      queuedRetryNeededRef.current = false;
      queuedRetryContextRef.current = null;
      return false;
    }
    setSummary(current => ({
      added: (current?.added ?? 0) + result.imported,
      review: (current?.review ?? 0) + result.review,
      skipped: (current?.skipped ?? 0) + rejected,
    }));
    const imported = reportedImported + result.imported;
    if (result.complete) {
      try {
        await rememberCoverage(ranges);
        await ensureDurable();
        if (generation !== getStateGeneration() || !aliveRef.current) return false;
        queuedRetryNeededRef.current = false;
        queuedRetryContextRef.current = null;
        setError(null);
        setStatus(files > 0 ? batchSummary({ files, accepted, rejected: totalRejected, alreadyProcessed }, imported) : copy.queueFiled);
        committed();
        return true;
      } catch (error) {
        result.error = error;
      }
    }
    setStatus(accepted > 0 ? interpolate(copy.acceptedPending, { accepted }) : copy.queuePending);
    setError(result.reason === 'review' ? copy.syncNeedsReview :
      interpolate(copy.syncFailed, { reason: syncFailureReason(result.error) }));
    queuedRetryNeededRef.current = true;
    // Counts already shown are not added again on the next attempt.
    queuedRetryContextRef.current = { files, accepted, rejected: 0, pages,
      alreadyProcessed, ranges, generation, reportedImported: imported, totalRejected };
    failed();
    return false;
  }, [batchSummary, copy, ensureDurable, getStateGeneration, rememberCoverage, syncFailureReason, syncQueued]);

  useEffect(() => {
    if (!cfg || state.privateMode) return;
    const retryQueued = async () => {
      if (!queuedRetryNeededRef.current || queuedRetryInFlightRef.current || busy !== null) return;
      const context = queuedRetryContextRef.current;
      if (!context) return;
      queuedRetryInFlightRef.current = true;
      try {
        await finishQueuedImport(context.files, context.accepted, context.rejected, context.pages,
          context.alreadyProcessed, context.ranges, context.generation, context.reportedImported, context.totalRejected, true);
      } finally {
        queuedRetryInFlightRef.current = false;
      }
    };
    const timer = setTimeout(() => { void retryQueued(); }, 1_500);
    const subscription = AppState.addEventListener('change', next => {
      if (next === 'active') void retryQueued();
    });
    return () => { clearTimeout(timer); subscription.remove(); };
  }, [busy, cfg, finishQueuedImport, state.privateMode]);

  const recoverQueuedRows = useCallback(async (generation: number) => {
    const progress = await syncQueued(generation);
    if (getStateGeneration() !== generation || !aliveRef.current) return { ...progress, progressStored: false };
    setSummary(current => ({ added: (current?.added ?? 0) + progress.imported,
      review: (current?.review ?? 0) + progress.review, skipped: current?.skipped ?? 0 }));
    const pending = queuedRetryContextRef.current;
    const matching = pending?.generation === generation ? pending : null;
    const progressStored = !!matching || !progress.complete;
    if (matching || !progress.complete) {
      queuedRetryNeededRef.current = true;
      queuedRetryContextRef.current = matching
        ? { ...matching, reportedImported: matching.reportedImported + progress.imported }
        : { files: 0, accepted: 0, rejected: 0, pages: 0, alreadyProcessed: 0, ranges: [],
            generation, reportedImported: progress.imported, totalRejected: 0 };
    }
    setStatus(progress.complete ? copy.queueFiled : copy.queuePending);
    return { ...progress, progressStored };
  }, [copy, getStateGeneration, syncQueued]);

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
    const generation = getStateGeneration();
    const current = getStateSnapshot();
    if (!current.hydrated || current.privateMode || !current.ledgerMoney) return;
    const ledgerMoney = current.ledgerMoney;
    setError(null);
    setStatus(null);
    setFileResults([]);
    if (!queuedRetryContextRef.current) setSummary(null);
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
      let recoveredImported = 0;
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
        const file = Platform.OS === 'web' ? null : new File(asset.uri);
        if (file) pickedFiles.push(file);
        const csv = /\.(?:csv|tsv)$/i.test(asset.name) ||
          capabilities.csv.accepts.includes(asset.mimeType?.split(';', 1)[0].toLowerCase() ?? '');
        const format = csv ? 'csv' : 'pdf';
        if (limitReached || !aliveRef.current || getStateGeneration() !== generation || getStateSnapshot().privateMode) {
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
            if (getStateGeneration() !== generation || getStateSnapshot().privateMode || !aliveRef.current) throw new CloudImportError('network');
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
          coverage.push({ item: newStatementRange(accepted, getStateSnapshot().transactions), format });
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
            if (e.code === 'queue_full') {
              // A rejected upload may already have queued some rows. Drain
              // safely even when no file returned a success response, otherwise
              // this screen could never free its own full queue for a retry.
              const progress = await recoverQueuedRows(generation);
              if (!progress.progressStored) recoveredImported += progress.imported;
            }
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
      if (protectedPdfs.length > 0) {
        setPendingPdfs(protectedPdfs);
        setPdfPassword('');
        setError(null);
      }
      if (uploadedFiles > 0) {
        await finishQueuedImport(uploadedFiles, acceptedRows, rejectedRows, pages, alreadyProcessedFiles, coverage, generation, recoveredImported);
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
    if (loadingConfig || busy !== null || queuedRetryInFlightRef.current || pendingPdfs.length > 0) return;
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
    if (!cfg || !capabilities || !pendingPdf || !pdfPassword || busy !== null || queuedRetryInFlightRef.current) return;
    const current = getStateSnapshot();
    if (!current.hydrated || current.privateMode || !aliveRef.current) return;
    if (!current.ledgerMoney) {
      setCurrencySheetVisible(true);
      return;
    }
    const generation = getStateGeneration();
    inFlightPickerUris.add(pendingPdf.asset.uri);
    setBusy('statement');
    setError(null);
    try {
      const accepted = await uploadPdfStatement(
        cfg,
        pendingPdf.asset,
        capabilities,
        current.ledgerMoney,
        pdfPassword,
        dateOrder,
      );
      const unlockedName = pendingPdf.asset.name;
      setFileResults((current) => [
        ...current.filter((result) => result.name !== unlockedName || result.detail !== copy.fileLocked),
        { name: unlockedName, ok: true, detail: fileImportedDetail(accepted) },
      ]);
      await finishQueuedImport(
        1, accepted.acceptedRows, accepted.rejectedRows, accepted.pages, accepted.alreadyProcessed ? 1 : 0,
        [{ item: newStatementRange(accepted, getStateSnapshot().transactions), format: 'pdf' }], generation,
      );
      try { if (pendingPdf.file?.exists) pendingPdf.file.delete(); } catch { /* best effort */ }
      setPendingPdfs((current) => current[0]?.asset.uri === pendingPdf.asset.uri
        ? current.slice(1)
        : current.filter((item) => item.asset.uri !== pendingPdf.asset.uri));
      setPdfPassword('');
    } catch (e) {
      if (e instanceof CloudImportError && e.code === 'queue_full') await recoverQueuedRows(generation);
      setError(errorText(e));
      if (!(e instanceof CloudImportError) || e.code !== 'pdf_password_incorrect') failed();
    } finally {
      inFlightPickerUris.delete(pendingPdf.asset.uri);
      if (!aliveRef.current) {
        try { if (pendingPdf.file?.exists) pendingPdf.file.delete(); } catch { /* best effort */ }
      }
      // Clear the entered secret from React state after a failed attempt too.
      setPdfPassword('');
      setBusy(null);
    }
  };

  const cancelProtectedPdf = () => {
    if (!pendingPdf) return;
    try { if (pendingPdf.file?.exists) pendingPdf.file.delete(); } catch { /* best effort */ }
    setPendingPdfs((current) => current[0]?.asset.uri === pendingPdf.asset.uri
      ? current.slice(1)
      : current.filter((item) => item.asset.uri !== pendingPdf.asset.uri));
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
        { key: 'added', value: summary.added, label: copy.resultAdded, tone: band.statusOk },
        { key: 'review', value: summary.review, label: copy.resultReview, tone: summary.review > 0 ? band.statusNear : band.text },
        { key: 'skipped', value: summary.skipped, label: copy.resultSkipped, tone: band.textSecondary },
      ]
    : [];
  const framed = frame !== undefined;
  // The band part sits on the sand band when a screen frames it, on the
  // sheet when it is embedded (past bank texts, the setup preview).
  const ink = framed ? { text: band.onBand, secondary: band.onBandSecondary, rule: band.onBandSecondary }
    : { text: band.text, secondary: band.textSecondary, rule: band.rule };
  // The true privacy line, shown before the control that acts on it: files go
  // to Wafra's import service, are read there, then deleted.
  const disclosure = (
    <View style={styles.lineRow} testID="statement-privacy">
      <Icon name="lock" size={15} color={ink.secondary} />
      <ThemedText type="meta" style={[styles.grow, { color: ink.secondary }]}>
        {copy.uploadDisclosure}
      </ThemedText>
    </View>
  );
  const chooseLabel = busy === 'connect' || busy === 'capabilities' ? copy.connecting
    : reading ? copy.uploading : fileResults.length > 0 ? copy.chooseStatements : copy.chooseFile;
  const chooseDisabled = loadingConfig || busy !== null || pendingPdfs.length > 0 || !state.ledgerMoney;

  const bandPart = (
    <View style={styles.bandPart} testID="statement-band">
      {/* First-run setup already said this one step earlier. */}
      {!onboarding && <ThemedText type="default" style={{ color: ink.text }}>{copy.intro}</ThemedText>}
      {!locked && (
        <>
          {/* Why the control below is off until a ledger currency is chosen. */}
          {!state.ledgerMoney && (
            <View style={styles.section} testID="statement-currency-prompt">
              <ThemedText type="smallBold" style={{ color: ink.text }}>{t('ledgerCurrencyTitle')}</ThemedText>
              <ThemedText type="meta" style={{ color: ink.secondary }}>{t('ledgerCurrencyBody')}</ThemedText>
              <EButton
                palette={band}
                variant="secondary"
                label={t('chooseLedgerCurrency')}
                onPress={() => setCurrencySheetVisible(true)}
                disabled={busy !== null}
              />
            </View>
          )}
          {disclosure}
          <ThemedText type="meta" style={{ color: ink.secondary }}>{copy.dateFormatTitle}</ThemedText>
          <View style={styles.dateChoices} accessibilityRole="radiogroup" accessibilityLabel={copy.dateFormatTitle}>
            {([{ value: null, label: copy.dateDetect }, { value: 'day-first', label: copy.dateDayFirst },
              { value: 'month-first', label: copy.dateMonthFirst }] as const).map(option => (
              <Pressable key={option.label} accessibilityRole="radio"
                aria-checked={dateOrder === option.value} aria-disabled={busy !== null}
                accessibilityState={{ checked: dateOrder === option.value, disabled: busy !== null }}
                onPress={() => setDateOrder(option.value)} disabled={busy !== null}
                style={[styles.dateChoice, { borderColor: dateOrder === option.value ? ink.text : ink.rule }]}>
                <ThemedText type="meta" style={{ color: ink.text }}>{option.label}</ThemedText>
              </Pressable>
            ))}
          </View>
          <Pressable
            testID="statement-choose"
            accessibilityRole="button"
            accessibilityLabel={chooseLabel}
            accessibilityHint={copy.formats}
            accessibilityState={{ disabled: chooseDisabled, busy: busy !== null }}
            onPress={() => void chooseFile()}
            disabled={loadingConfig || busy !== null || pendingPdfs.length > 0 || !state.ledgerMoney}
            style={({ pressed }) => [styles.choose, { borderColor: ink.rule, opacity: chooseDisabled ? 0.5 : pressed ? 0.7 : 1 }]}>
            {busy !== null ? <ActivityIndicator color={ink.text} /> : <Icon name="upload" size={22} color={ink.text} strokeWidth={2} />}
            <ThemedText type="smallBold" style={[styles.chooseLabel, { color: ink.text }]}>{chooseLabel}</ThemedText>
          </Pressable>
          <ThemedText type="meta" style={[styles.center, { color: ink.secondary }]}>{copy.formats}</ThemedText>
        </>
      )}
    </View>
  );

  const sheetPart = (
    <View style={styles.root}>
      {locked ? (
        <View style={styles.section} testID="statement-private">
          <View style={styles.lineRow}>
            <Icon name="lock" size={18} color={band.statusNear} />
            <ThemedText type="smallBold" style={[styles.grow, { color: band.text }]}>{copy.privateTitle}</ThemedText>
          </View>
          <ThemedText type="meta" style={{ color: band.textSecondary }}>{copy.privateBody}</ThemedText>
          <EButton palette={band} variant="secondary" label={copy.reviewPrivacy} onPress={() => router.push('/settings?section=privacy')} />
        </View>
      ) : (
        <>
          {reading && (
            <View
              testID="statement-progress"
              accessible
              accessibilityRole="progressbar"
              accessibilityLabel={status ?? copy.uploading}
              accessibilityValue={progress ? { min: 0, max: progress.total, now: progress.index } : undefined}
              style={styles.section}>
              <View style={styles.lineRow}>
                <ActivityIndicator color={band.tint} />
                <ThemedText type="smallBold" style={[styles.grow, { color: band.text }]}>
                  {progress ? interpolate(copy.progressLabel, progress) : copy.uploading}
                </ThemedText>
              </View>
              {progress && (
                <View style={[styles.track, { backgroundColor: band.glyphGround }]}>
                  <View style={[styles.fill, {
                    backgroundColor: band.tint,
                    width: `${Math.round((progress.index / progress.total) * 100)}%`,
                  }]} />
                </View>
              )}
              {/* The bar already says "2 of 3"; the status line adds only waits and filing. */}
              {status && status !== interpolate(copy.uploadingProgress, progress ?? { index: 0, total: 0 })
                ? <ThemedText type="meta" style={{ color: band.textSecondary }}>{status}</ThemedText> : null}
            </View>
          )}

          {reading && liveFiles.length > 1 && (
            <View testID="statement-file-status" style={styles.files}>
              {liveFiles.map((file, index) => {
                const statusText = file.status === 'waiting'
                  ? copy.fileStatusWaiting
                  : file.status === 'reading'
                    ? copy.fileStatusReading
                    : file.detail ?? '';
                return (
                  <FileRow
                    key={`${index}:${file.name}`}
                    palette={band}
                    name={file.name}
                    status={statusText}
                    tone={file.status === 'done' ? 'ok' : file.status === 'failed' ? 'over'
                      : file.status === 'locked' ? 'near' : 'quiet'}
                    busy={file.status === 'reading'}
                    last={index === liveFiles.length - 1}
                    accessibilityLabel={interpolate(copy.fileStatusLabel, { name: file.name, status: statusText })}
                  />
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
              style={styles.summary}>
              {numbers.map((item) => (
                <View key={item.key} style={styles.summaryCell}>
                  <ThemedText tabular style={[styles.summaryFigure, { color: item.tone }]}>{item.value}</ThemedText>
                  <ThemedText type="meta" style={{ color: band.textSecondary }}>{item.label}</ThemedText>
                </View>
              ))}
            </View>
          )}

          {!reading && status && (!summary || error) ? (
            <View style={styles.lineRow} accessibilityLiveRegion="polite">
              <Icon name="check" size={17} color={band.statusOk} />
              <ThemedText type="meta" style={[styles.grow, { color: band.text }]}>{status}</ThemedText>
            </View>
          ) : null}

          {fileResults.length > 0 && !reading && (
            <View style={styles.files} testID="statement-file-results">
              {shownFiles.map((result, index) => (
                <FileRow
                  key={`${index}:${result.name}`}
                  palette={band}
                  name={result.name}
                  status={result.detail}
                  tone={result.ok ? 'ok' : 'over'}
                  last={index === shownFiles.length - 1}
                  accessibilityLabel={`${result.ok ? copy.resultOkLabel : copy.resultFailedLabel}: ${result.name}. ${result.detail}`}
                />
              ))}
              {fileResults.length > failedFiles.length && (
                <EButton
                  palette={band}
                  variant="quiet"
                  label={filesOpen ? copy.hideFiles : interpolate(copy.showFiles, { count: fileResults.length })}
                  onPress={() => setFilesOpen((value) => !value)}
                />
              )}
            </View>
          )}

          {pendingPdf && (
            <View style={styles.section} testID="statement-password">
              <View style={styles.lineRow}>
                <FileTile palette={band} icon="lock" />
                <View style={styles.grow}>
                  <ThemedText type="smallBold" style={{ color: band.text }}>{copy.passwordTitle}</ThemedText>
                  <ThemedText type="meta" numberOfLines={1} style={{ color: band.text }}>{pendingPdf.asset.name}</ThemedText>
                  <ThemedText type="meta" style={{ color: band.textSecondary }}>
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
              <View style={[styles.actions, largeText && styles.actionsStacked]}>
                <EButton palette={band} variant="secondary" label={copy.passwordCancel} onPress={cancelProtectedPdf}
                  disabled={busy !== null} style={!largeText && styles.action} />
                <EButton palette={band} label={busy === 'statement' ? copy.uploading : copy.passwordRetry}
                  onPress={() => void retryProtectedPdf()} disabled={!pdfPassword || busy !== null} style={!largeText && styles.action} />
              </View>
            </View>
          )}

          {error && (
            <View accessibilityRole="alert" accessibilityLiveRegion="polite" style={styles.lineRow}>
              <Icon name="alert" size={17} color={band.statusOver} />
              <ThemedText type="meta" style={[styles.grow, { color: band.statusOver }]}>{error}</ThemedText>
            </View>
          )}
          {cfg && !capabilities && busy === null && !loadingConfig && error && (
            <EButton palette={band} variant="secondary" label={copy.retry} onPress={() => void loadCapabilities(cfg)} />
          )}

          {/* What to download: the statement the button above asks for. */}
          <View testID="statement-download-hint" style={styles.section}>
            <ThemedText type="smallBold" accessibilityRole="header" style={[styles.sectionTitle, { color: band.text }]}>
              {copy.downloadTitle}
            </ThemedText>
            {[copy.downloadStep, Platform.OS === 'android' ? copy.findStepAndroid : copy.findStepIos].map((line, index) => (
              <View key={line} style={styles.hintRow} accessible accessibilityLabel={`${index + 1}. ${line}`}>
                <View style={[styles.hintNumber, { borderColor: band.text }]}>
                  <ThemedText type="micro" style={{ color: band.text }}>{index + 1}</ThemedText>
                </View>
                <ThemedText type="small" style={[styles.grow, { color: band.text }]}>{line}</ThemedText>
              </View>
            ))}
          </View>

          {/* How dates in the file are read (the upload disclosure itself sits above the choose control). */}
          <View style={styles.section}>
            <View style={styles.lineRow} testID="statement-date-note">
              <Icon name="calendar" size={15} color={band.textSecondary} />
              <ThemedText type="meta" style={[styles.grow, { color: band.textSecondary }]}>
                {copy.dateAutoNote}
              </ThemedText>
            </View>
          </View>

          {coverage.length > 0 && (
            <View style={styles.section} testID="statement-coverage">
              <ThemedText type="smallBold" accessibilityRole="header" style={[styles.sectionTitle, { color: band.text }]}>
                {copy.coverageTitle}
              </ThemedText>
              {coverage.map((item) => {
                return (
                  <View key={item.sourceKey} style={[styles.coverageRow, { borderTopColor: band.rule }]}>
                    <View style={styles.coverageHead}>
                      <ThemedText type="smallBold" style={[styles.coverageLabel, { color: band.text }]}>
                        {item.sourceKey === 'bank-statements' ? copy.coverageUnidentifiedLabel : item.label}
                      </ThemedText>
                      <ThemedText type="meta" tabular style={{ color: band.textSecondary }}>{item.range}</ThemedText>
                    </View>
                    <ThemedText type="meta" style={{ color: band.textSecondary }}>
                      {copy.coverageRangeOnly}
                    </ThemedText>
                  </View>
                );
              })}
            </View>
          )}

          <Pressable
            accessibilityRole="button"
            accessibilityLabel={copy.howItWorks}
            accessibilityState={{ expanded: detailsOpen }}
            onPress={() => setDetailsOpen((value) => !value)}
            style={({ pressed }) => [styles.howLink, { opacity: pressed ? 0.6 : 1 }]}>
            <ThemedText type="smallBold" style={{ color: band.tint }}>{copy.howItWorks}</ThemedText>
            <Icon name={detailsOpen ? 'chevron-down' : 'chevron-right'} size={14} color={band.tint} />
          </Pressable>
          {detailsOpen && (
            <View style={[styles.privacy, { borderTopColor: band.rule }]} testID="statement-how-it-works">
              <ThemedText type="small" style={{ color: band.text }}>{copy.privacyTitle}</ThemedText>
              <ThemedText type="meta" style={{ color: band.textSecondary }}>{copy.privacyBody}</ThemedText>
              <ThemedText type="meta" style={{ color: band.textSecondary }}>{copy.statementBody}</ThemedText>
              {capabilities && (
                <ThemedText type="nano" tabular style={{ color: band.textSecondary }}>
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
          <EButton
            palette={band}
            label={summary ? copy.continue : copy.later}
            variant={summary ? 'primary' : 'quiet'}
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

  if (frame) return frame({ band: bandPart, sheet: sheetPart });
  return (
    <View style={styles.root}>
      {bandPart}
      {sheetPart}
    </View>
  );
}

/** The statement's document tile: a small card with a rule, the glyph in the secondary ink. */
function FileTile({ palette, icon = 'receipt' }: { palette: BandPalette; icon?: 'receipt' | 'lock' }) {
  return (
    <View testID="statement-file-tile" style={[styles.fileTile, { backgroundColor: palette.card, borderColor: palette.rule }]}>
      <Icon name={icon} size={20} color={palette.textSecondary} strokeWidth={1.8} />
    </View>
  );
}

/**
 * One picked file: the document tile, its name, and its status in the
 * status colour (added in green, a failure in red, locked in amber, waiting
 * and reading in the secondary ink).
 */
function FileRow({ palette, name, status, tone, busy = false, last, accessibilityLabel }: {
  palette: BandPalette;
  name: string;
  status: string;
  tone: 'ok' | 'near' | 'over' | 'quiet';
  busy?: boolean;
  last: boolean;
  accessibilityLabel: string;
}) {
  const color = tone === 'ok' ? palette.statusOk : tone === 'near' ? palette.statusNear
    : tone === 'over' ? palette.statusOver : palette.textSecondary;
  return (
    <View
      style={[styles.fileRow, !last && { borderBottomWidth: StyleSheet.hairlineWidth, borderBottomColor: palette.rule }]}
      accessible
      accessibilityLabel={accessibilityLabel}>
      <FileTile palette={palette} />
      <View style={styles.grow}>
        <ThemedText type="smallBold" numberOfLines={1} style={{ color: palette.text }}>{name}</ThemedText>
        <View style={styles.fileStatus}>
          {busy ? <ActivityIndicator size="small" color={palette.textSecondary} /> : null}
          <ThemedText type="meta" style={[styles.grow, { color }]}>{status}</ThemedText>
        </View>
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  dateChoices: { flexDirection: 'row', flexWrap: 'wrap', gap: 8 },
  dateChoice: { minHeight: 44, justifyContent: 'center', paddingHorizontal: 12, borderWidth: 1, borderRadius: 12 },
  root: { gap: Spacing.four },
  bandPart: { gap: Spacing.two + Spacing.one },
  choose: {
    minHeight: 96,
    borderWidth: 2,
    borderStyle: 'dashed',
    borderRadius: 22,
    paddingHorizontal: Spacing.three,
    paddingVertical: Spacing.three,
    flexDirection: 'row',
    flexWrap: 'wrap',
    alignItems: 'center',
    justifyContent: 'center',
    gap: Spacing.two + 2,
  },
  chooseLabel: { fontSize: 16, lineHeight: 22, textAlign: 'center', flexShrink: 1 },
  center: { textAlign: 'center' },
  section: { gap: Spacing.two + 2 },
  sectionTitle: { fontSize: 17, lineHeight: 24 },
  lineRow: { flexDirection: 'row', alignItems: 'flex-start', gap: Spacing.two + 2 },
  grow: { flex: 1, minWidth: 0, gap: Spacing.half },
  hintRow: { flexDirection: 'row', alignItems: 'flex-start', gap: Spacing.two + Spacing.one },
  hintNumber: {
    width: 24,
    height: 24,
    borderRadius: Radius.full,
    borderWidth: 1.5,
    alignItems: 'center',
    justifyContent: 'center',
    marginTop: 1,
  },
  track: { height: 6, borderRadius: Radius.full, overflow: 'hidden' },
  fill: { height: 6, borderRadius: Radius.full },
  summary: { flexDirection: 'row', flexWrap: 'wrap', gap: Spacing.three },
  summaryCell: { flexGrow: 1, flexBasis: 80, gap: Spacing.half },
  summaryFigure: { fontFamily: Fonts.sansSemi, fontVariant: ['tabular-nums'], fontSize: 30, lineHeight: 36, letterSpacing: -1 },
  files: { gap: 0 },
  fileRow: { flexDirection: 'row', alignItems: 'center', gap: Spacing.three, paddingVertical: 13 },
  fileTile: { width: 40, height: 48, borderRadius: 8, borderWidth: 1, alignItems: 'center', justifyContent: 'center' },
  fileStatus: { flexDirection: 'row', alignItems: 'center', gap: Spacing.two },
  actions: { flexDirection: 'row', gap: Spacing.two },
  actionsStacked: { flexDirection: 'column' },
  action: { flex: 1 },
  coverageRow: { borderTopWidth: StyleSheet.hairlineWidth, paddingTop: Spacing.two, gap: Spacing.half },
  coverageHead: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'baseline', gap: Spacing.two, flexWrap: 'wrap' },
  coverageLabel: { flexShrink: 1 },
  howLink: { minHeight: 44, flexDirection: 'row', alignItems: 'center', gap: Spacing.one, alignSelf: 'flex-start' },
  privacy: {
    gap: Spacing.two,
    borderTopWidth: StyleSheet.hairlineWidth,
    paddingTop: Spacing.three,
  },
  onboardingFooter: { paddingTop: Spacing.two },
});
