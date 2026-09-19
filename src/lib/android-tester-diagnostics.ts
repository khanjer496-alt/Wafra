import Constants from 'expo-constants';
import * as Device from 'expo-device';
import { Platform } from 'react-native';

import NotificationReader from '../../modules/notification-reader';
import SmsReader from '../../modules/sms-reader';
import {
  getAndroidNotificationImportDiagnostics,
  hasSmsDeliveryPermission,
  hasSmsPermission,
} from '@/lib/auto-import';
import { canonicalCaptureSourceKey } from '@/lib/capture-source-identity';
import { collectDiagnosticBankMessages } from '@/lib/diagnostic-messages';
import { buildFeedbackPayload } from '@/lib/feedback';
import {
  FEEDBACK_DIAGNOSTIC_MAX_BYTES,
  FEEDBACK_RETENTION_DAYS,
} from '@/lib/feedback-wire';
import {
  submitTesterDiagnostics,
  type TesterDiagnosticWirePayload,
} from '@/lib/feedback-transport';
import { getLaunchMetrics } from '@/lib/launch-performance';
import { ledgerCurrencyDisplay } from '@/lib/markets';
import { getBankLogoCacheDiagnostics } from '@/lib/bank-logo-resolver';
import { getMerchantLogoCacheDiagnostics } from '@/lib/merchant-logo-resolver';
import { notificationDeliveryAllowed } from '@/lib/notifications';
import { sanitizeParserTemplate } from '@/lib/parser-research';
import { getRuntimePerformanceSnapshot } from '@/lib/runtime-performance';
import { bankProfileForSender, PARSER_BACKFILL_VERSION, PARSER_VERSION } from '@/lib/sms-parser';
import { getStorageFailures } from '@/lib/storage-diagnostics';
import { isTransferCandidate, transferOwnership } from '@/lib/transfer-reconciliation';
import type { AppState } from '@/lib/types';

const SAMPLE_LIMIT_PER_OUTCOME = 6;
const DIAGNOSTIC_SMS_CHECK_LIMIT = 1_000;
const DIAGNOSTIC_TEXT = 'Android tester diagnostics.' as const;
const encoder = new TextEncoder();

type SafeParserSample = {
  sender: string;
  template: string;
  outcome: 'parsed' | 'rejected';
  count: number;
  result?: {
    kind: string;
    type: string;
    category: string;
    categorySource: 'rule' | 'fallback';
  };
  refusal?: string;
};

const safeAgeMs = (timestamp: number | null | undefined, now: number): number | null =>
  Number.isFinite(timestamp) && Number(timestamp) > 0
    ? Math.max(0, now - Number(timestamp))
    : null;

const countBy = (values: readonly string[]): Record<string, number> => {
  const result: Record<string, number> = {};
  for (const value of values) result[value] = (result[value] ?? 0) + 1;
  return result;
};

function ledgerSourceDiagnostics(state: AppState) {
  const sourceIdentityCounts = new Map<string, number>();
  for (const transaction of state.transactions) {
    if (!transaction.smsKey) continue;
    const key = canonicalCaptureSourceKey(transaction.smsKey, transaction.ts);
    sourceIdentityCounts.set(key, (sourceIdentityCounts.get(key) ?? 0) + 1);
  }
  let repeatedSourceIdentities = 0;
  let repeatedRows = 0;
  for (const count of sourceIdentityCounts.values()) {
    if (count <= 1) continue;
    repeatedSourceIdentities += 1;
    repeatedRows += count - 1;
  }
  const otherRows = state.transactions.filter((row) => row.category === 'other');

  return {
    sourceIdentityCounts,
    summary: {
      rows: state.transactions.length,
      withSmsSourceIdentity: state.transactions.filter((row) => Boolean(row.smsKey)).length,
      viaPush: state.transactions.filter((row) => row.viaPush === true).length,
      statementPdf: state.transactions.filter((row) => row.captureSource === 'pdf').length,
      statementCsv: state.transactions.filter((row) => row.captureSource === 'csv').length,
      manual: state.transactions.filter((row) => row.source === 'manual' || row.source == null).length,
      repeatedSourceIdentities,
      repeatedRows,
      explicitOwnNotMarkedTransfer: state.transactions.filter((row) =>
        row.transferEvidence?.explicitOwn === true && row.isTransfer !== true).length,
      categoryCounts: countBy(state.transactions.map((row) => row.category)),
      transactionTypeCounts: countBy(state.transactions.map((row) => row.type)),
      // "Other" is not synonymous with a parser miss. Transfer/remittance and
      // settlement rows deliberately live there, while parser coverage below
      // separately reports purchases whose category was actually unresolved.
      // Keep this source-free breakdown so a support file can tell those cases
      // apart without exposing any merchant, amount or account identity.
      otherBreakdown: {
        rows: otherRows.length,
        expense: otherRows.filter((row) => row.type === 'expense').length,
        income: otherRows.filter((row) => row.type === 'income').length,
        transferCandidates: otherRows.filter(isTransferCandidate).length,
        confirmedOwnTransfers: otherRows.filter((row) => transferOwnership(row) === 'own').length,
        unresolvedTransfers: otherRows.filter((row) => transferOwnership(row) === 'unknown').length,
        cardPaymentRows: otherRows.filter((row) => row.cardPaymentSide !== undefined).length,
        billPaymentRows: otherRows.filter((row) => row.paymentFlowSide !== undefined).length,
      },
    },
  };
}

function parserSample(
  sender: string,
  body: string,
  parser: {
    kind: string;
    type: string;
    merchant: string;
    category: string;
    categoryDeliberate: boolean;
  } | null,
  refusal: string | null,
): SafeParserSample | null {
  const template = sanitizeParserTemplate(body, parser ? [parser.merchant] : []);
  if (!template) return null;
  const bank = bankProfileForSender(sender || undefined)?.name ?? '[sender A]';
  if (parser) {
    return {
      sender: bank,
      template,
      outcome: 'parsed',
      count: 1,
      result: {
        kind: parser.kind,
        type: parser.type,
        category: parser.category,
        categorySource: parser.categoryDeliberate ? 'rule' : 'fallback',
      },
    };
  }
  return {
    sender: bank,
    template,
    outcome: 'rejected',
    count: 1,
    refusal: refusal ?? 'not-parsed',
  };
}

function aggregateSamples(samples: SafeParserSample[]): SafeParserSample[] {
  const map = new Map<string, SafeParserSample>();
  for (const sample of samples) {
    const key = JSON.stringify({
      sender: sample.sender,
      template: sample.template,
      outcome: sample.outcome,
      result: sample.result ?? null,
      refusal: sample.refusal ?? null,
    });
    const current = map.get(key);
    if (current) current.count += 1;
    else map.set(key, { ...sample });
  }
  const all = [...map.values()].sort((a, b) => b.count - a.count || a.template.localeCompare(b.template));
  const parsed = all.filter((sample) => sample.outcome === 'parsed').slice(0, SAMPLE_LIMIT_PER_OUTCOME);
  const rejected = all.filter((sample) => sample.outcome === 'rejected').slice(0, SAMPLE_LIMIT_PER_OUTCOME);
  return [...rejected, ...parsed];
}

function fitDiagnostic(report: Record<string, unknown>): Record<string, unknown> {
  const size = () => encoder.encode(JSON.stringify(report)).byteLength;
  const parser = report.parser as { samples?: SafeParserSample[] } | undefined;
  while (size() > FEEDBACK_DIAGNOSTIC_MAX_BYTES && parser?.samples?.length) {
    parser.samples.pop();
  }
  if (size() > FEEDBACK_DIAGNOSTIC_MAX_BYTES) {
    throw new Error('tester_diagnostic_too_large');
  }
  return report;
}

export type TesterDiagnosticProgress =
  | { stage: 'checking'; checked: number; included: number }
  | { stage: 'sending' };

export async function buildAndroidTesterDiagnostic(
  state: AppState,
  onProgress?: (checked: number, included: number) => void,
): Promise<Record<string, unknown>> {
  if (Platform.OS !== 'android') throw new Error('tester_diagnostic_android_only');
  const now = Date.now();
  // Snapshot responsiveness before diagnostic generation starts doing its own
  // bounded ledger/inbox analysis. Otherwise a slow support export measures
  // itself and reports that pause as ordinary app jank.
  const runtimeBeforeDiagnostic = getRuntimePerformanceSnapshot();
  const buildVersion = Constants.expoConfig?.version ?? '1.0.0';
  const ledger = ledgerSourceDiagnostics(state);
  const feedbackCoverage = buildFeedbackPayload({
    message: '',
    detail: 'shapes',
    build: {
      version: buildVersion,
      platform: 'android',
      language: state.language === 'ar' ? 'ar' : 'en',
      marketId: state.marketId,
      currency: state.ledgerMoney?.currency ?? ledgerCurrencyDisplay(),
      privateMode: state.privateMode,
    },
    ledger: {
      accounts: state.accounts,
      transactions: state.transactions,
      cardDues: state.cardDues,
      merchantOverrides: state.merchantOverrides,
    },
  });

  let notificationDiagnostics: unknown = null;
  try {
    notificationDiagnostics = await NotificationReader?.getDiagnostics?.() ?? null;
  } catch {
    notificationDiagnostics = { unavailable: true };
  }
  let processExitDiagnostics: unknown[] = [];
  try {
    processExitDiagnostics = NotificationReader?.getProcessExitDiagnostics?.() ?? [];
  } catch {
    processExitDiagnostics = [];
  }
  let processMemoryDiagnostics: unknown = null;
  try {
    processMemoryDiagnostics = NotificationReader?.getProcessMemoryDiagnostics?.() ?? null;
  } catch {
    processMemoryDiagnostics = null;
  }

  const readSmsGranted = await hasSmsPermission().catch(() => false);
  const receiveSmsGranted = await hasSmsDeliveryPermission().catch(() => false);
  const appNotificationGranted = await notificationDeliveryAllowed().catch(() => false);
  let instantAlertsPreference = false;
  try {
    instantAlertsPreference = SmsReader?.getInstantAlerts?.() ?? false;
  } catch {
    instantAlertsPreference = false;
  }
  const smsReader = SmsReader;
  const parser: Record<string, unknown> = {
    currentVersion: PARSER_VERSION,
    historyRepairVersion: PARSER_BACKFILL_VERSION,
    storedVersion: state.parserVersion ?? null,
    storedHistoryRepairVersion: state.parserVersion ?? null,
    coverage: feedbackCoverage.counts,
    samples: [] as SafeParserSample[],
    inbox: {
      readPermission: readSmsGranted,
      scanPerformed: false,
      skippedReason: state.privateMode
        ? 'private-mode'
        : state.captureOptOut
          ? 'capture-opt-out'
          : state.historyImport?.status === 'running'
            ? 'history-import-running'
            : readSmsGranted
              ? null
              : 'read-sms-not-granted',
    },
  };

  if (!state.privateMode && !state.captureOptOut && readSmsGranted &&
    state.historyImport?.status !== 'running' && smsReader?.getInboxSms) {
    try {
      const collected = await collectDiagnosticBankMessages(
        (beforeDate, beforeId, max) => smsReader.getInboxSms(0, beforeDate, beforeId, max),
        {
          currency: state.ledgerMoney?.currency ?? null,
          market: state.marketId,
          overrides: state.merchantOverrides,
          shouldContinue: () => true,
          maxChecked: DIAGNOSTIC_SMS_CHECK_LIMIT,
          onProgress,
        },
      );
      let parsedExpectedLedger = 0;
      let parsedExpectedLedgerPresent = 0;
      let parserRejected = 0;
      const samples: SafeParserSample[] = [];
      const missingIdentitySamples: SafeParserSample[] = [];
      for (const message of collected.messages) {
        if (!message.parser) parserRejected += 1;
        const expectsLedgerRow = message.parser?.kind === 'transaction' ||
          message.parser?.kind === 'cardPayment';
        if (expectsLedgerRow) {
          parsedExpectedLedger += 1;
          if (ledger.sourceIdentityCounts.has(message.canonicalSourceKey)) {
            parsedExpectedLedgerPresent += 1;
          } else if (message.parser) {
            const missingSample = parserSample(
              message.sender,
              message.body,
              {
                kind: message.parser.kind,
                type: message.parser.type,
                merchant: message.parser.merchant,
                category: message.parser.category,
                categoryDeliberate: message.parser.categoryDeliberate,
              },
              null,
            );
            if (missingSample) missingIdentitySamples.push(missingSample);
          }
        }
        const sample = parserSample(
          message.sender,
          message.body,
          message.parser ? {
            kind: message.parser.kind,
            type: message.parser.type,
            merchant: message.parser.merchant,
            category: message.parser.category,
            categoryDeliberate: message.parser.categoryDeliberate,
          } : null,
          message.refusal,
        );
        if (sample) samples.push(sample);
      }
      parser.samples = aggregateSamples(samples);
      parser.parsedWithoutExactStoredSourceIdentitySamples = aggregateSamples(missingIdentitySamples)
        .filter((sample) => sample.outcome === 'parsed')
        .slice(0, SAMPLE_LIMIT_PER_OUTCOME);
      parser.inbox = {
        readPermission: true,
        scanPerformed: true,
        skippedReason: null,
        auditScope: collected.coverage.truncated ? 'recent-bounded' : 'complete-readable-inbox',
        checkedLimit: collected.coverage.checkedLimit,
        readComplete: collected.coverage.nativeFilteredInboxReadComplete,
        checked: collected.coverage.checked,
        bankMoneyMessages: collected.coverage.included,
        excluded: collected.coverage.excluded,
        parserRejected,
        parsedExpectedLedger,
        parsedExpectedLedgerPresent,
        // This is identity coverage, not proof of a lost transaction: card-payment
        // and statement/live reconciliation can intentionally merge two source
        // events into one ledger row. Targeted masked samples above make the
        // remaining cases actionable without overstating what the count proves.
        parsedWithoutExactStoredSourceIdentity: Math.max(0, parsedExpectedLedger - parsedExpectedLedgerPresent),
      };
    } catch {
      parser.inbox = {
        readPermission: true,
        scanPerformed: false,
        skippedReason: 'inbox-read-failed',
      };
    }
  }

  const history = state.historyImport;
  const report: Record<string, unknown> = {
    schema: 1,
    kind: 'wafra-android-tester-diagnostics',
    generatedAt: new Date(now).toISOString(),
    retentionDays: FEEDBACK_RETENTION_DAYS,
    privacy: {
      rawSmsUploaded: false,
      exactAmountsUploaded: false,
      merchantNamesUploaded: false,
      accountNamesOrNumbersUploaded: false,
      installationOrDeviceIdUploaded: false,
      parserTemplates: 'digits-masked-and-free-text-allowlisted',
      privateModeBankingDataWithheld: state.privateMode,
    },
    build: {
      version: buildVersion,
      buildNumber: Constants.nativeBuildVersion ??
        (Constants.expoConfig?.android?.versionCode != null
          ? String(Constants.expoConfig.android.versionCode)
          : null),
      platform: 'android',
      osVersion: Device.osVersion ?? String(Platform.Version),
      androidApi: Platform.Version,
      manufacturer: Device.manufacturer ?? null,
      model: Device.modelName ?? null,
      deviceYearClass: Device.deviceYearClass ?? null,
      totalMemoryBytes: Device.totalMemory ?? null,
      language: state.language,
      market: state.marketId,
      currency: state.ledgerMoney?.currency ?? ledgerCurrencyDisplay(),
    },
    performance: {
      launch: getLaunchMetrics(),
      runtimeJs: runtimeBeforeDiagnostic,
      // Counts only: no merchant/bank names, URLs or cache keys leave device.
      presentationCaches: {
        merchantLogos: getMerchantLogoCacheDiagnostics(),
        bankLogos: getBankLogoCacheDiagnostics(),
      },
      recentProcessExits: processExitDiagnostics.map((entry) => {
        const row = entry as Record<string, unknown>;
        const timestamp = typeof row.timestamp === 'number' ? row.timestamp : null;
        return {
          ageMs: timestamp === null ? null : safeAgeMs(timestamp, now),
          reason: row.reason ?? null,
          reasonLabel: row.reasonLabel ?? null,
          status: row.status ?? null,
          importance: row.importance ?? null,
          pssKb: row.pssKb ?? null,
          rssKb: row.rssKb ?? null,
        };
      }),
      currentProcessMemory: processMemoryDiagnostics,
      dataScale: {
        accounts: state.accounts.length,
        transactions: state.transactions.length,
        bills: state.bills.length,
        cardDues: state.cardDues.length,
        statementCoverageEntries: state.statementCoverage.length,
        pendingReviewAlerts: state.reviewTray.pending.length,
        merchantOverrides: Object.keys(state.merchantOverrides).length,
      },
    },
    persistence: {
      recentFailures: getStorageFailures().map((failure) => ({
        ageMs: safeAgeMs(Date.parse(failure.at), now),
        op: failure.op,
        kind: failure.kind,
        code: failure.code,
        category: failure.category,
      })),
    },
    import: {
      captureOptOut: state.captureOptOut,
      lastScanAgeMs: safeAgeMs(state.lastScanTs, now),
      history: history ? {
        status: history.status,
        scanned: history.scanned,
        found: history.found,
        error: history.error,
        startedAgeMs: safeAgeMs(history.startedAt, now),
        updatedAgeMs: safeAgeMs(history.updatedAt, now),
      } : null,
      ledgerSources: state.privateMode ? null : ledger.summary,
    },
    parser,
    notifications: {
      liveSms: {
        readPermission: readSmsGranted,
        receivePermission: receiveSmsGranted,
        appNotificationPermission: appNotificationGranted,
        instantAlertsPreference,
      },
      native: notificationDiagnostics,
      lastImport: getAndroidNotificationImportDiagnostics(),
    },
  };
  return fitDiagnostic(report);
}

export async function sendAndroidTesterDiagnostic(
  state: AppState,
  onProgress?: (progress: TesterDiagnosticProgress) => void,
) {
  const diagnostic = await buildAndroidTesterDiagnostic(state, (checked, included) =>
    onProgress?.({ stage: 'checking', checked, included }));
  const wire: TesterDiagnosticWirePayload = {
    schema: 1,
    text: DIAGNOSTIC_TEXT,
    appVersion: Constants.expoConfig?.version ?? '1.0.0',
    platform: 'android',
    locale: state.language === 'ar' ? 'ar' : 'en',
    aiReviewConsent: false,
    diagnostic,
  };
  onProgress?.({ stage: 'sending' });
  return submitTesterDiagnostics(wire);
}
