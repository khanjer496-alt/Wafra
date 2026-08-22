export interface SmsCorpusRow {
  id: number;
  address: string;
  body: string;
  /** Epoch milliseconds. */
  date: number;
}

export interface SmsCorpusMessage {
  sender: string;
  body: string;
  receivedAtMs: number;
}

export interface SmsCorpusDocument {
  schema: 'wafra-sms-corpus-v1';
  exportedAt: string;
  messages: SmsCorpusMessage[];
}

export type SmsCorpusPageReader = (
  beforeDateMs: number,
  beforeId: number,
  max: number,
) => Promise<SmsCorpusRow[]>;

export interface SmsCorpusCollectionOptions {
  shouldContinue?: () => boolean;
}

const PAGE_SIZE = 500;
const FIRST_CURSOR = Number.MAX_SAFE_INTEGER;

const validRow = (row: SmsCorpusRow): boolean =>
  Number.isSafeInteger(row.id) &&
  row.id >= 0 &&
  Number.isSafeInteger(row.date) &&
  row.date >= 0 &&
  typeof row.address === 'string' &&
  typeof row.body === 'string';

const precedesCursor = (
  row: SmsCorpusRow,
  beforeDateMs: number,
  beforeId: number,
): boolean => row.date < beforeDateMs || (row.date === beforeDateMs && row.id < beforeId);

/**
 * Collect every received SMS through a stable (date, id) cursor.
 *
 * The native reader is deliberately injected so pagination and failure
 * behavior are testable without an Android inbox. A non-progressing or
 * malformed native page fails closed instead of looping forever or emitting a
 * file that quietly claims completeness.
 */
export const collectSmsCorpus = async (
  readPage: SmsCorpusPageReader,
  onProgress?: (count: number) => void,
  options: SmsCorpusCollectionOptions = {},
): Promise<SmsCorpusMessage[]> => {
  const shouldContinue = options.shouldContinue ?? (() => true);
  const assertContinues = (): void => {
    if (!shouldContinue()) throw new Error('sms_corpus_cancelled');
  };
  const messages: SmsCorpusMessage[] = [];
  let beforeDateMs = FIRST_CURSOR;
  let beforeId = FIRST_CURSOR;

  while (true) {
    assertContinues();
    const page = await readPage(beforeDateMs, beforeId, PAGE_SIZE);
    assertContinues();
    if (page.length === 0) return messages;
    if (page.length > PAGE_SIZE || page.some((row) => !validRow(row))) {
      throw new Error('invalid_sms_corpus_page');
    }
    if (page.some((row) => !precedesCursor(row, beforeDateMs, beforeId))) {
      throw new Error('non_progressing_sms_corpus_page');
    }

    for (const row of page) {
      messages.push({
        sender: row.address,
        body: row.body,
        receivedAtMs: row.date,
      });
    }
    onProgress?.(messages.length);

    const last = page[page.length - 1];
    beforeDateMs = last.date;
    beforeId = last.id;
    if (page.length < PAGE_SIZE) return messages;
  }
};

export const serializeSmsCorpus = (
  messages: SmsCorpusMessage[],
  nowMs: number = Date.now(),
): string => JSON.stringify({
  schema: 'wafra-sms-corpus-v1',
  exportedAt: new Date(nowMs).toISOString(),
  messages,
} satisfies SmsCorpusDocument, null, 2);
