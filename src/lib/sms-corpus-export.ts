import * as FileSystem from 'expo-file-system/legacy';
import * as Sharing from 'expo-sharing';
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
  const directory = FileSystem.cacheDirectory;
  if (!directory || !(await Sharing.isAvailableAsync())) {
    throw new Error('sms_corpus_share_unavailable');
  }
  const uri = `${directory}wafra-sms-corpus-${date}.json`;
  await FileSystem.writeAsStringAsync(uri, serializeSmsCorpus(messages), {
    encoding: FileSystem.EncodingType.UTF8,
  });
  // Never fall back to a React Native text-sharing payload. A large inbox can
  // exceed Android's Binder transaction limit and kill the process before a
  // JavaScript catch can run. Sharing the short file URI has constant size.
  await Sharing.shareAsync(uri, {
    mimeType: 'application/json',
    dialogTitle: 'Share parser corpus',
    UTI: 'public.json',
  });
  return messages.length;
};
