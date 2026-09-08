import { shareTextFile } from '@/lib/share-text';
import { Platform } from 'react-native';

import SmsReader from '../../modules/sms-reader';
import { collectSmsCorpus, serializeSmsCorpus } from '@/lib/sms-corpus';

const JS_CORPUS_EXPORT_ENABLED =
  process.env.EXPO_PUBLIC_WAFRA_SMS_CORPUS_EXPORT === '1';

/** Both the JavaScript bundle and native binary must opt into raw export. */
export const isSmsCorpusExportAvailable = (): boolean => {
  if (Platform.OS !== 'android' || !JS_CORPUS_EXPORT_ENABLED) return false;
  try {
    return SmsReader?.isCorpusExportEnabled?.() === true &&
      SmsReader.getInboxCorpusPage != null;
  } catch {
    return false;
  }
};

/**
 * Read locally, create one cache file, and hand its URI to Android's share
 * sheet. There is deliberately no network transport in this module.
 */
export const shareSmsCorpus = async (
  onProgress?: (count: number) => void,
): Promise<number> => {
  const reader = SmsReader;
  if (!isSmsCorpusExportAvailable() || !reader?.getInboxCorpusPage) {
    throw new Error('sms_corpus_export_unavailable');
  }
  const messages = await collectSmsCorpus(
    (beforeDateMs, beforeId, max) =>
      reader.getInboxCorpusPage!(beforeDateMs, beforeId, max),
    onProgress,
  );
  const date = new Date().toISOString().slice(0, 10);
  await shareTextFile(`wafra-sms-corpus-${date}.json`, serializeSmsCorpus(messages), {
    mimeType: 'application/json',
    dialogTitle: 'Share parser corpus',
  });
  return messages.length;
};

/** Personal testing build only: original inbox evidence alongside saved corrections. */
export const sharePersonalDataForReview = async (options: {
  getBackup: () => string;
  shouldContinue: () => boolean;
  onProgress?: (count: number) => void;
  dialogTitle?: string;
}): Promise<number> => {
  const reader = SmsReader;
  if (!isSmsCorpusExportAvailable() || !reader?.getInboxCorpusPage) {
    throw new Error('sms_corpus_export_unavailable');
  }
  const assertActive = () => {
    if (!options.shouldContinue()) throw new Error('sms_corpus_cancelled');
  };
  assertActive();
  const messages = await collectSmsCorpus(
    (beforeDateMs, beforeId, max) => reader.getInboxCorpusPage!(beforeDateMs, beforeId, max),
    options.onProgress,
    { shouldContinue: options.shouldContinue },
  );
  assertActive();
  // Use the ordinary backup's exclusion of entitlements and transient state.
  // Credentials live outside that backup and are never read by this exporter.
  const backup: unknown = JSON.parse(options.getBackup());
  assertActive();
  const exportedAt = new Date().toISOString();
  const text = JSON.stringify({
    schema: 'wafra-personal-review-v1',
    exportedAt,
    sms: { scope: 'all-received', messages },
    backup,
  }, null, 2);
  assertActive();
  await shareTextFile(`wafra-personal-review-${exportedAt.slice(0, 10)}.json`, text, {
    mimeType: 'application/json',
    dialogTitle: options.dialogTitle,
    shouldContinue: options.shouldContinue,
  });
  return messages.length;
};
