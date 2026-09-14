import { assertDiagnosticContinues, diagnosticYield } from '@/lib/diagnostic-export';
import { createLaunchAlertSession, hasBankAlertMoneyHint } from '@/lib/launch-alert-parser';
import { nonPostingReason } from '@/lib/sms-parser';
import { MARKETS } from '@/lib/markets';
import { canonicalCaptureSourceKey } from '@/lib/capture-source-identity';
import type { CategoryId } from '@/lib/types';

export interface DiagnosticMessageRow { id: number; address: string; body: string; date: number }
export type DiagnosticPageReader = (beforeDate: number, beforeId: number, max: number) => Promise<DiagnosticMessageRow[]>;

// Parsing accepts package names and broader bank hints. Export admission must
// be stricter: a personal/alphanumeric sender merely containing a bank word
// is not permission to include its messages in the user's bank-only file.
const BANK_SENDERS = MARKETS.flatMap(market => market.banks.map(bank =>
  new RegExp(`^(?:${bank.re.source})$`, 'i')));
export const isDiagnosticBankSender = (sender: string): boolean =>
  sender.length <= 80 && !/[\u0000-\u001f\u007f-\u009f\u061c\u200b-\u200f\u202a-\u202e\u2066-\u2069\ufeff]/u.test(sender) &&
  BANK_SENDERS.some(pattern => pattern.test(sender.normalize('NFKC').trim()));

/**
 * Stop after this many inbox rows when the caller asks for a bounded read.
 *
 * Unbounded is right for the export control: the user asked for their whole
 * readable history and watches a progress count while it runs. It is wrong for
 * the one-tap tester button, which reports aggregate parser ratios — every page
 * costs a native query that sorts the entire inbox (the provider takes no SQL
 * LIMIT) plus a parse on every bank hit, so a 15,000-message inbox spent
 * minutes behind a spinner that named no end. A recent slice answers the
 * question that report actually asks, and the coverage block below says
 * plainly that it stopped early rather than implying a complete read.
 */
const DEFAULT_MAX_CHECKED = 2_000;

/** Explicit optional bank-message read; not the unfiltered corpus-export API.
 * Never commits a scan cursor, imports a transaction or acknowledges a queue.
 * Unknown/personal senders and security challenges cannot enter the file. */
export async function collectDiagnosticBankMessages(readPage: DiagnosticPageReader, options: {
  currency: string | null; market: string; overrides: Record<string, CategoryId>;
  shouldContinue: () => boolean; onProgress?: (checked: number, included: number) => void;
  /** Omit for a complete read; `true` stops at DEFAULT_MAX_CHECKED rows. */
  bounded?: boolean;
}) {
  const maxChecked = options.bounded === true ? DEFAULT_MAX_CHECKED : Infinity;
  let beforeDate = Number.MAX_SAFE_INTEGER; let beforeId = Number.MAX_SAFE_INTEGER;
  let checked = 0; let excluded = 0; let totalChars = 0;
  const messages = [];
  const session = createLaunchAlertSession({ overrides: options.overrides,
    pinnedCurrency: options.currency, activeMarket: options.market });
  while (true) {
    assertDiagnosticContinues(options.shouldContinue);
    const page = await readPage(beforeDate, beforeId, 250);
    assertDiagnosticContinues(options.shouldContinue);
    if (!Array.isArray(page) || page.length > 250) throw new Error('diagnostic_invalid_page');
    for (let index = 0; index < page.length; index++) {
      const row = page[index];
      if (!row || !Number.isSafeInteger(row.id) || row.id < 0 || !Number.isSafeInteger(row.date) || row.date < 0 ||
        typeof row.address !== 'string' || typeof row.body !== 'string' ||
        !(row.date < beforeDate || (row.date === beforeDate && row.id < beforeId))) throw new Error('diagnostic_invalid_cursor');
      beforeDate = row.date; beforeId = row.id; checked++;
      const bank = isDiagnosticBankSender(row.address);
      const reason = nonPostingReason(row.body);
      if (bank && hasBankAlertMoneyHint(row.body) && reason !== 'security-challenge') {
        const result = session.parse(row.body, row.address, session.inspect(row.body, row.address));
        totalChars += row.body.length;
        if (totalChars > 32 * 1024 * 1024) throw new Error('diagnostic_too_large');
        messages.push({ sourceEventId: `a${row.id}`, canonicalSourceKey: canonicalCaptureSourceKey(`ha${row.id}`, row.date),
          sender: row.address, receivedAtMs: row.date, body: row.body,
          parser: result ? { kind: result.kind, type: result.type, amountMinor: result.amountFils,
            currency: result.currency, merchant: result.merchant, category: result.categoryGuess,
            categoryDeliberate: result.categoryDeliberate === true, transfer: result.transferHint,
            accountIdentified: result.card !== null, date: result.date } : null,
          refusal: result ? null : reason ?? 'not-parsed' });
      } else excluded++;
      if (index % 16 === 15) {
        await diagnosticYield(); assertDiagnosticContinues(options.shouldContinue);
      }
    }
    options.onProgress?.(checked, messages.length);
    assertDiagnosticContinues(options.shouldContinue);
    // A short page means the provider is exhausted; the row cap means we chose
    // to stop. Only the first is a complete read, and the flag must say so:
    // a bounded sample reported as complete would understate real inbox size
    // and make a parser-coverage ratio look like a whole-history audit.
    const exhausted = page.length < 250;
    if (exhausted || checked >= maxChecked) return { messages, coverage: {
      nativeFilteredInboxReadComplete: exhausted,
      stoppedAtCheckedLimit: !exhausted,
      checked, included: messages.length, excluded,
      emptyProviderDoesNotProveNoMessages: checked === 0,
      personalAndUnknownSendersExcluded: true, securityMessagesExcluded: true,
      scope: 'Currently readable bank-money SMS only. The native reader omits credential messages. Deleted SMS and bank-app notification history are not included.',
    } };
    await diagnosticYield();
  }
}
