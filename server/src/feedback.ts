/**
 * What the app is allowed to tell the relay when a user files feedback.
 *
 * This is the one place in the service where user-written PROSE is stored, and
 * it is deliberately not the same kind of thing as a bank message. The rule the
 * rest of this Worker is built around — parse the message, drop the text — is
 * about data the user never chose to send us: an SMS their bank pushed at them,
 * captured by an automation, relayed while they were asleep. Feedback is the
 * opposite: they opened a screen, typed a sentence, and pressed send. Refusing
 * to keep that would not protect anyone; it would just mean nobody can report a
 * parser bug.
 *
 * What the promise costs here instead is FOUR things, all enforced:
 *
 *  1. It lands in its own table, never in `queue`. It is not sealed to a device
 *     because a maintainer has to read it — so it is not pretending to be
 *     private, and the retention ceiling is short (see FEEDBACK_RETENTION_
 *     SECONDS in ../src/index.ts's sweep) rather than the queue's thirty days.
 *  2. Ordinary diagnostics are redacted by the client and bounded here. The
 *     parser-research path has a stronger contract: this module validates one
 *     exact allow-listed shape before it can authorize an AI workflow. Extra
 *     fields, free text and unmasked numbers are rejected rather than passed to
 *     a model.
 *  3. Nothing here logs, persists, or echoes. Same rule as ingest-row.ts, and
 *     server/test/schema.test.cjs asserts the absence of the surface.
 *  4. Over-long input is REFUSED, never truncated. Truncating a bug report is
 *     how you end up storing the first four thousand characters of a bank
 *     statement in a field that was supposed to hold a sentence.
 */
import {
  FEEDBACK_DIAGNOSTIC_MAX_BYTES,
  FEEDBACK_WIRE_SCHEMA,
  PARSER_RESEARCH_FEEDBACK_TEXT,
  type FeedbackWirePayload,
} from '@/lib/feedback-wire';
import {
  isSafeParserResearchSender,
  isSafeParserResearchTemplate,
  PARSER_RESEARCH_SCHEMA,
  PARSER_RESEARCH_SHAPES_MAX,
} from '@/lib/parser-research-contract';

/**
 * Whole-body ceiling. A feedback POST is a sentence and a small diagnostic; a
 * request bigger than this is a client bug or an attempt to use the endpoint as
 * free storage. Generous enough that a user who pastes a long alert plus a
 * redacted diagnostic never sees it.
 */
export const MAX_FEEDBACK_BYTES = 32 * 1024;

/**
 * The user's own words. Long enough for a real description with a pasted
 * example in it, short enough that the field cannot become a file upload.
 * Counted in CODE POINTS, not UTF-16 units, so an Arabic report is not worth
 * half as many characters as an English one.
 */
export const MAX_FEEDBACK_TEXT_LENGTH = 4_000;

/**
 * The redacted diagnostic, measured as serialized JSON.
 *
 * This is the number that answers "a diagnostic from a 14,000-row ledger is
 * large". It is not large because the ledger is large — it is large because a
 * client sent rows instead of counts. Sixteen kilobytes fits every aggregate
 * shape worth sending (counts per category, parser version, a handful of
 * anonymised failing-message shapes) and fits no ledger at all, so the failure
 * is a 413 at the wire rather than a database full of transactions.
 */
export const MAX_DIAGNOSTIC_BYTES = FEEDBACK_DIAGNOSTIC_MAX_BYTES;

/** Feedback is deleted this long after it arrives, acted on or not. */
export const FEEDBACK_RETENTION_SECONDS = 14 * 24 * 60 * 60;

/** The `repository_dispatch` event type the Actions workflow listens for. */
export const FEEDBACK_DISPATCH_EVENT = 'wafra-feedback';

export const FEEDBACK_PLATFORMS = ['ios', 'android', 'web'] as const;
export type FeedbackPlatform = (typeof FEEDBACK_PLATFORMS)[number];

export interface FeedbackRecord {
  text: string;
  appVersion: string;
  platform: FeedbackPlatform;
  /** BCP-47-ish tag, or null when the client did not send one. */
  locale: string | null;
  /** Serialized JSON, or null. Stored as the client sent it, bounded. */
  diagnostic: string | null;
  /** True only for the strictly shaped, client-redacted parser research path. */
  aiReviewConsent: boolean;
}

const objectRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === 'object' && value !== null && !Array.isArray(value);

const exactKeys = (
  value: Record<string, unknown>,
  keys: readonly string[],
): boolean => {
  const actual = Object.keys(value);
  return actual.length === keys.length &&
    keys.every((key) => Object.prototype.hasOwnProperty.call(value, key));
};

const boundedCount = (value: unknown): value is number =>
  typeof value === 'number' && Number.isSafeInteger(value) && value >= 0 && value <= 1_000_000;

/**
 * The only diagnostic allowed to authorize an agent run. This validates the
 * privacy contract rather than trusting a boolean beside an arbitrary report.
 */
export function isConsentedParserResearchDiagnostic(value: unknown): boolean {
  if (!objectRecord(value) || !exactKeys(value, [
    'reportSchema', 'kind', 'detailRequested', 'detail', 'withheld', 'delivery',
    'build', 'counts', 'shapes', 'cardDiagnostic', 'redaction',
  ]) || value.kind !== 'parser-research' || value.reportSchema !== PARSER_RESEARCH_SCHEMA ||
    value.detailRequested !== 'parser-research' || value.detail !== 'parser-research' ||
    value.withheld !== null || value.cardDiagnostic !== null) {
    return false;
  }
  const delivery = value.delivery;
  const redaction = value.redaction;
  const build = value.build;
  const counts = value.counts;
  const shapes = value.shapes;
  if (!objectRecord(delivery) || !exactKeys(delivery, [
    'retentionDays', 'reviewedBy', 'thirdPartyAi',
  ]) || delivery.retentionDays !== 14 ||
    delivery.reviewedBy !== 'wafra-maintainers' || delivery.thirdPartyAi !== true ||
    !objectRecord(redaction) || !exactKeys(redaction, [
      'rawMessages', 'digits', 'freeText', 'senders', 'timestamps',
    ]) || redaction.rawMessages !== false ||
    redaction.digits !== 'masked' || redaction.freeText !== 'allowlist' ||
    redaction.senders !== 'known-bank-or-alias' || redaction.timestamps !== false ||
    !objectRecord(build) || !exactKeys(build, ['marketId', 'currency', 'privateMode']) ||
    typeof build.marketId !== 'string' || !/^(?:AE|SA)$/.test(build.marketId) ||
    typeof build.currency !== 'string' || !/^[A-Z]{3}$/.test(build.currency) ||
    build.privateMode !== false ||
    !objectRecord(counts) || !exactKeys(counts, [
      'checked', 'financial', 'sensitiveExcluded', 'nonFinancialExcluded',
      'alreadyParsedExcluded', 'uniqueTemplates', 'attachedTemplates', 'omittedTemplates',
    ]) || !Object.values(counts).every(boundedCount) ||
    !Array.isArray(shapes) || shapes.length < 1 ||
    shapes.length > PARSER_RESEARCH_SHAPES_MAX) {
    return false;
  }
  const safeShapes = shapes.every((shape) => {
    if (!objectRecord(shape) || typeof shape.sender !== 'string' ||
      !exactKeys(shape, ['sender', 'template', 'outcome', 'count']) ||
      typeof shape.template !== 'string' || typeof shape.count !== 'number' ||
      !Number.isSafeInteger(shape.count) || shape.count < 1 || shape.count > 1_000_000 ||
      shape.outcome !== 'needs-parser-work') return false;
    return isSafeParserResearchSender(shape.sender) &&
      isSafeParserResearchTemplate(shape.template);
  });
  if (!safeShapes) return false;

  const checked = counts.checked as number;
  const financial = counts.financial as number;
  const sensitiveExcluded = counts.sensitiveExcluded as number;
  const nonFinancialExcluded = counts.nonFinancialExcluded as number;
  const alreadyParsedExcluded = counts.alreadyParsedExcluded as number;
  const uniqueTemplates = counts.uniqueTemplates as number;
  const attachedTemplates = counts.attachedTemplates as number;
  const omittedTemplates = counts.omittedTemplates as number;
  const attachedOccurrences = shapes.reduce(
    (total, shape) => total + ((shape as Record<string, unknown>).count as number),
    0,
  );
  return checked === financial + sensitiveExcluded + nonFinancialExcluded &&
    alreadyParsedExcluded <= financial &&
    attachedOccurrences <= financial - alreadyParsedExcluded &&
    attachedTemplates === shapes.length &&
    uniqueTemplates === attachedTemplates + omittedTemplates;
}

export interface FeedbackReject {
  error: string;
  status: number;
}

export function isFeedbackReject(
  value: FeedbackRecord | FeedbackReject,
): value is FeedbackReject {
  return 'error' in value;
}

const textEncoder = new TextEncoder();

/**
 * Control characters have no business in a bug report, but a bug report is
 * PROSE and newlines do. Tab and newline survive; CR collapses into newline so
 * a Windows-ish client and an iOS one produce the same stored text; every other
 * C0/C1 codepoint and the bidi overrides are dropped.
 *
 * Dropped rather than rejecting the whole report. The sender validator in
 * ingest-row.ts follows the same fail-soft boundary for its optional label:
 * malformed metadata must not cost the underlying transaction or report.
 */
function scrubProse(value: string): string {
  let out = '';
  for (const character of value.replace(/\r\n?/g, '\n')) {
    const codePoint = character.codePointAt(0) as number;
    const control =
      (codePoint <= 0x1f && character !== '\n' && character !== '\t') ||
      (codePoint >= 0x7f && codePoint <= 0x9f) ||
      (codePoint >= 0x202a && codePoint <= 0x202e) ||
      (codePoint >= 0x2066 && codePoint <= 0x2069);
    if (!control) out += character;
  }
  // Collapse runs of blank lines, trim the ends. Interior single newlines stay.
  return out.replace(/\n{3,}/g, '\n\n').trim();
}

/**
 * Validate a parsed feedback body.
 *
 * Takes the ALREADY-PARSED value rather than the raw string so the route keeps
 * one place where a JSON failure is turned into a response, and so this module
 * has no opinion about transport. `null` — which is what the route passes when
 * `JSON.parse` threw — is `bad_json`, same as a body that parsed to an array or
 * a bare string: none of them is the object this contract describes.
 */
export function validateFeedback(value: unknown): FeedbackRecord | FeedbackReject {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) {
    return { error: 'bad_json', status: 400 };
  }
  const body = value as Partial<Record<keyof FeedbackWirePayload, unknown>>;

  if (body.schema !== FEEDBACK_WIRE_SCHEMA) return { error: 'bad_schema', status: 400 };

  if (typeof body.text !== 'string') return { error: 'empty', status: 400 };
  const text = scrubProse(body.text);
  if (!text) return { error: 'empty', status: 400 };
  if ([...text].length > MAX_FEEDBACK_TEXT_LENGTH) {
    return { error: 'text_too_long', status: 400 };
  }

  if (typeof body.appVersion !== 'string') return { error: 'bad_app_version', status: 400 };
  const appVersion = body.appVersion.trim();
  // A version string is machine-written. Anything outside this alphabet is a
  // client sending something that is not a version.
  if (!/^[A-Za-z0-9][A-Za-z0-9._+-]{0,31}$/.test(appVersion)) {
    return { error: 'bad_app_version', status: 400 };
  }

  const platform = FEEDBACK_PLATFORMS.find((candidate) => candidate === body.platform);
  if (!platform) return { error: 'bad_platform', status: 400 };

  let locale: string | null = null;
  if (body.locale !== undefined && body.locale !== null) {
    if (typeof body.locale !== 'string') return { error: 'bad_locale', status: 400 };
    const candidate = body.locale.trim();
    if (candidate) {
      // BCP-47's own length ceiling is 35 characters for a single tag.
      if (!/^[A-Za-z0-9]{1,8}(?:-[A-Za-z0-9]{1,8})*$/.test(candidate) || candidate.length > 35) {
        return { error: 'bad_locale', status: 400 };
      }
      locale = candidate;
    }
  }

  let diagnostic: string | null = null;
  let diagnosticValue: Record<string, unknown> | null = null;
  if (body.diagnostic !== undefined && body.diagnostic !== null) {
    if (typeof body.diagnostic !== 'object' || Array.isArray(body.diagnostic)) {
      return { error: 'bad_diagnostic', status: 400 };
    }
    let serialized: string;
    try {
      serialized = JSON.stringify(body.diagnostic);
    } catch {
      // Cyclic, or a value whose toJSON threw. Not something to store.
      return { error: 'bad_diagnostic', status: 400 };
    }
    if (typeof serialized !== 'string') return { error: 'bad_diagnostic', status: 400 };
    if (textEncoder.encode(serialized).byteLength > MAX_DIAGNOSTIC_BYTES) {
      return { error: 'diagnostic_too_large', status: 413 };
    }
    diagnostic = serialized;
    diagnosticValue = body.diagnostic as Record<string, unknown>;
  }

  const aiReviewConsent = body.aiReviewConsent === true;
  if (body.aiReviewConsent !== false && body.aiReviewConsent !== true) {
    return { error: 'ai_consent_unsupported', status: 400 };
  }
  if (aiReviewConsent &&
    (text !== PARSER_RESEARCH_FEEDBACK_TEXT ||
      !isConsentedParserResearchDiagnostic(diagnosticValue))) {
    return { error: 'ai_consent_unsupported', status: 400 };
  }

  return { text, appVersion, platform, locale, diagnostic, aiReviewConsent };
}

/**
 * `owner/repo`, or null.
 *
 * Interpolated into an api.github.com path, so it is validated rather than
 * trusted: a var holding `a/b/../../x` would otherwise aim the dispatch at
 * another endpoint entirely. A misconfigured value reads as "not configured",
 * which is the same graceful degradation as an absent token.
 */
export function githubRepository(value: unknown): string | null {
  if (typeof value !== 'string') return null;
  const trimmed = value.trim();
  // Each half must START with an alphanumeric, which is what makes `owner/..`
  // and `../repo` unrepresentable — those normalize away a path segment and
  // would point the POST at a different GitHub endpoint.
  return /^[A-Za-z0-9][A-Za-z0-9._-]{0,99}\/[A-Za-z0-9][A-Za-z0-9._-]{0,99}$/.test(trimmed)
    ? trimmed
    : null;
}
