import { Platform } from 'react-native';

import SmsReader from '../../modules/sms-reader';
import {
  collectSmsCorpus,
  type SmsCorpusCollectionOptions,
  type SmsCorpusMessage,
} from '@/lib/sms-corpus';

/**
 * Build marker: after Expo's inlining and Metro's release constant folding,
 * only one string reaches the bundle. build-apk.yml fails a Play bundle that
 * carries "=on" (scripts/android-build-flags.cjs). The gate is derived from it.
 */
export const PARSER_RESEARCH_BUILD_FLAG =
  process.env.EXPO_PUBLIC_WAFRA_PARSER_RESEARCH === '1'
    ? 'wafra-build-flag:parser-research=on'
    : 'wafra-build-flag:parser-research=off';

const RESEARCH_BUILD_ENABLED = PARSER_RESEARCH_BUILD_FLAG.endsWith('=on');

export const isParserResearchBuild = (): boolean => RESEARCH_BUILD_ENABLED;

/** Android can scan only when the internal native corpus gate is also open. */
export const canCollectParserResearchInbox = (): boolean => {
  if (!RESEARCH_BUILD_ENABLED || Platform.OS !== 'android') return false;
  try {
    return SmsReader?.isCorpusExportEnabled?.() === true &&
      SmsReader.getInboxCorpusPage != null;
  } catch {
    return false;
  }
};

/**
 * Read plaintext into memory only long enough for parser-research.ts to filter
 * and redact it. This module has no file or network API.
 */
export const collectParserResearchInbox = async (
  onProgress?: (count: number) => void,
  options: SmsCorpusCollectionOptions = {},
): Promise<SmsCorpusMessage[]> => {
  const reader = SmsReader;
  if (!canCollectParserResearchInbox() || !reader?.getInboxCorpusPage) {
    throw new Error('parser_research_inbox_unavailable');
  }
  return collectSmsCorpus(
    (beforeDateMs, beforeId, max) =>
      reader.getInboxCorpusPage!(beforeDateMs, beforeId, max),
    onProgress,
    options,
  );
};
