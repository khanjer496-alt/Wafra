/** Convert a private format match into source-owned Review facts. No inference or posting. */
import { applyAiSourceReview, preparePrivateFormatSourceReview } from '@/lib/ai-alert-source-contract';
import { normalizeAlertText } from '@/lib/alert-draft';
import { getActiveCountry } from '@/lib/country';
import { detectLaunchMarketFromAlert, detectLaunchMarketFromSender } from '@/lib/markets';
import type { LearnedFields } from '@/lib/learned-alert-formats';
import type { UniversalBankEvent, UniversalParseContext } from '@/lib/universal-types';
import { extractUniversalDates } from '@/lib/universal-dates';
import { privateAlertSourceDateContext } from '@/lib/private-alert-teaching';

/** Private formats can fill missing facts in financial Review, including a
 * known purchase/transfer family. They never override an already parsed row. */
export const canEnrichPrivateFormatReview = (event: UniversalBankEvent): boolean =>
  event.decision === 'review' && ['unknown', 'purchase', 'transfer', 'cash-withdrawal', 'refund', 'fee', 'utility', 'recurring-payment'].includes(event.family) &&
  !['failed', 'future', 'informational'].includes(event.status) &&
  (event.direction === 'unknown' || event.merchant.evidence === 'missing' || event.transactionDate.evidence === 'missing');

export interface PrivateAlertReviewMatch {
  kind: 'prefill';
  fields: LearnedFields;
  /** Opaque matching metadata remains ephemeral; never put it in a Review event. */
  templateId: string;
}
export interface PrivateAlertReviewContext {
  country?: string | null;
  dateOrder?: UniversalParseContext['dateOrder'];
  routedMarket?: string | null;
  launchRoute?: boolean;
}

const sourceCalendars = (source: string): string[] => [...source.matchAll(
  /\p{N}{1,4}(?:[/.-]\p{N}{1,4}){2}|\p{N}{1,2}[-\s]+\p{L}{3,12}[-\s]+\p{N}{4}|\p{L}{3,12}\.?\s+\p{N}{1,2},?\s+\p{N}{4}/gu,
)].map(match => match[0]);

export function privateAlertFormatReviewEvent(
  source: string,
  sender: string,
  observedAt: number,
  match: PrivateAlertReviewMatch,
  context: PrivateAlertReviewContext = {},
): UniversalBankEvent | null {
  try {
    const country = context.country === undefined ? getActiveCountry() : context.country;
    if (context.launchRoute || ['AE', 'SA'].includes(context.routedMarket ?? '') || country === 'AE' || country === 'SA' ||
      detectLaunchMarketFromSender(sender) || detectLaunchMarketFromAlert(source, sender) || match?.kind !== 'prefill') return null;
    const fields = match.fields;
    if (!fields || !Number.isSafeInteger(fields.amountMinor) || fields.amountMinor <= 0 ||
      !['debit', 'credit'].includes(fields.direction)) return null;
    const sourceContext = privateAlertSourceDateContext(source, sender, { ...context, country });
    const parseContext = { sender, observedAt, dateOrder: sourceContext.dateOrder ?? undefined };
    const prepared = preparePrivateFormatSourceReview(source, parseContext, match);
    if (!prepared) return null;
    const alreadyRead = (name: string) => prepared.request.schema.fields.some(field => field.name === name && 'choices' in field);
    const proposal = { amountId: 'none', family: 'unknown', merchantQuote: alreadyRead('merchantQuote') ? 'none' : '',
      dateQuote: alreadyRead('dateQuote') ? 'none' : '' };
    let event = applyAiSourceReview(prepared, proposal);
    if (!event || event.amount.evidence !== 'explicit' || !event.amount.value ||
      [event.statementTotal, event.minimumDue, event.creditLimit, event.dueDate, event.statementDate]
        .some(field => field.evidence !== 'missing') ||
      event.amount.value.currency !== fields.currency || event.amount.value.exponent !== fields.exponent ||
      event.amount.value.minorUnits !== String(fields.amountMinor)) return null;
    // The learned role does not overrule an explicit source direction.
    if (event.direction !== 'unknown' && event.direction !== fields.direction) return null;
    if (fields.merchant !== undefined) {
      if (typeof fields.merchant !== 'string' || !fields.merchant) return null;
      if (event.merchant.evidence !== 'missing') {
        if (event.merchant.evidence !== 'explicit' || event.merchant.value !== fields.merchant) return null;
      } else proposal.merchantQuote = fields.merchant;
    }
    if (fields.date !== undefined) {
      if (typeof fields.date !== 'string' || !/^\d{4}-\d{2}-\d{2}$/u.test(fields.date)) return null;
      if (event.transactionDate.evidence !== 'missing') {
        if (event.transactionDate.evidence !== 'explicit' || event.transactionDate.value !== fields.date) return null;
      } else {
        const candidates = sourceCalendars(source).filter(quote => {
          const parsed = extractUniversalDates('Transaction date: ' + normalizeAlertText(quote), parseContext, []).transactionDate;
          return parsed.evidence === 'explicit' && parsed.value === fields.date;
        });
        if (candidates.length !== 1) return null;
        proposal.dateQuote = candidates[0];
      }
    }
    event = applyAiSourceReview(prepared, proposal);
    if (!event) return null;
    const fixedProvenance = (issues: string[]) => [...new Set(issues.filter(issue => issue !== 'ai-proposed'))];
    for (const field of [event.amount, event.merchant, event.transactionDate]) field.issues = fixedProvenance(field.issues);
    event.issues = [...fixedProvenance(event.issues), 'learned-format'];
    if (event.direction === 'unknown') {
      // Human-confirmed template semantics are a proposal, never proof of completion.
      event.direction = fields.direction;
      event.status = 'unknown';
    }
    event.decision = 'review';
    return event;
  } catch {
    return null;
  }
}
