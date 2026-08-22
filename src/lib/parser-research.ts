import {
  FEEDBACK_DIAGNOSTIC_MAX_BYTES,
  FEEDBACK_RETENTION_DAYS,
  type ParserResearchWirePayload,
  PARSER_RESEARCH_DELIVERY,
  PARSER_RESEARCH_FEEDBACK_TEXT,
} from '@/lib/feedback-wire';
import { inspectAlertDraft } from '@/lib/alert-draft';
import { bankProfileForSender, nonPostingReason, parseSms } from '@/lib/sms-parser';
import type { SmsCorpusMessage } from '@/lib/sms-corpus';
import {
  isParserResearchTemplateWord,
  PARSER_RESEARCH_REDACTION,
  PARSER_RESEARCH_SCHEMA,
  PARSER_RESEARCH_SHAPES_MAX,
  PARSER_RESEARCH_TEMPLATE_MAX,
} from '@/lib/parser-research-contract';

export {
  PARSER_RESEARCH_REDACTION,
  PARSER_RESEARCH_SCHEMA,
  PARSER_RESEARCH_SHAPES_MAX,
  PARSER_RESEARCH_TEMPLATE_MAX,
} from '@/lib/parser-research-contract';
export const PARSER_RESEARCH_PASTE_MAX = 120_000;

export interface ParserResearchBuild {
  version: string;
  platform: string;
  language: string;
  marketId: string;
  currency: string;
}

export interface ParserResearchShape {
  sender: string;
  template: string;
  outcome: 'needs-parser-work';
  count: number;
}

export interface ParserResearchCounts {
  checked: number;
  financial: number;
  sensitiveExcluded: number;
  nonFinancialExcluded: number;
  alreadyParsedExcluded: number;
  uniqueTemplates: number;
  attachedTemplates: number;
  omittedTemplates: number;
}

export interface ParserResearchSubmission {
  preview: string;
  wire: ParserResearchWirePayload;
  counts: ParserResearchCounts;
}

export interface ParserResearchProgress {
  stage: 'checking' | 'finalizing';
  completed: number;
  total: number;
}

export interface ParserResearchCooperativeOptions {
  shouldContinue?: () => boolean;
}

export interface ManualParserResearchExport {
  schema: 1;
  kind: 'wafra-parser-report';
  notice: string;
  delivery: {
    mode: 'manual';
    uploadedByWafra: false;
    destinationChosenByUser: true;
  };
  build: ParserResearchBuild;
  counts: ParserResearchCounts;
  templates: ParserResearchShape[];
  redaction: typeof PARSER_RESEARCH_REDACTION;
}

/**
 * Build the local file the tester can hand to Codex themselves.
 *
 * This intentionally does not reuse the relay wire envelope: that object says
 * the tester authorized Wafra, GitHub Actions and Anthropic Claude. A manual
 * export makes none of those claims. It carries only the already-redacted
 * diagnostic value and says plainly that Wafra uploaded nothing.
 */
export function buildManualParserResearchExport(
  submission: ParserResearchSubmission,
): ManualParserResearchExport {
  return {
    schema: 1,
    kind: 'wafra-parser-report',
    notice: 'Wafra did not upload this file. The user chooses where to share it.',
    delivery: {
      mode: 'manual',
      uploadedByWafra: false,
      destinationChosenByUser: true,
    },
    build: {
      version: submission.wire.appVersion,
      platform: submission.wire.platform,
      language: submission.wire.locale,
      marketId: submission.wire.diagnostic.build.marketId,
      currency: submission.wire.diagnostic.build.currency,
    },
    counts: submission.counts,
    templates: submission.wire.diagnostic.shapes as ParserResearchShape[],
    redaction: PARSER_RESEARCH_REDACTION,
  };
}

/** The exact bytes shown on screen and written into the shared JSON file. */
export function serializeManualParserResearchExport(
  report: ManualParserResearchExport,
): string {
  return JSON.stringify(report, null, 2);
}

/**
 * Words a parser test needs to preserve. Every other letter-run becomes
 * `[text]`, so an unknown merchant, beneficiary or account nickname cannot
 * escape merely because a heuristic failed to recognise it as a name.
 */
const CONTROL_OR_BIDI = /[\u0000-\u001F\u007F-\u009F\u061C\u200B-\u200F\u202A-\u202E\u2066-\u2069\uFEFF]/gu;
const EMAIL = /\b[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}\b/giu;
const URL = /\b(?:https?:\/\/|www\.)\S+/giu;
const IBAN = /\b[A-Z]{2}\s*\d{2}(?:[\s-]*[A-Z0-9]){10,30}\b/giu;
const LONG_TOKEN = /\b[A-Z0-9]{10,}\b/giu;
const ALLOWED_PUNCTUATION = /[^\p{L}#\s.,:;!?\-\/()[\]*+'"•=₹$€£¥،؛]/gu;
const ENTITY_AFTER_CUE = /(\b(?:at|for|from|merchant|payee|to)\b|(?:إلى|الى|لدى|عند|من))\s+([\p{L}][\p{L}\s'’&-]{0,80}?)(?=\s+(?:by|completed|for|from|has|have|is|on|ref|reference|successful|successfully|using|via|was|were|with|بنجاح|باستخدام|تم|عبر|في|مرجع|من|على)\b|[.,;،؛]|$)/giu;

const safeLiteral = (value: string): RegExp =>
  new RegExp(value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'), 'giu');

/** Convert one bank alert into a useful but non-identifying parser template. */
export function sanitizeParserTemplate(source: string, knownNames: readonly string[] = []): string {
  let value = source
    .slice(0, 1_200)
    .replace(CONTROL_OR_BIDI, ' ')
    .replace(URL, '[url]')
    .replace(EMAIL, '[email]')
    .replace(IBAN, '[iban]')
    .replace(LONG_TOKEN, '[text]')
    // Grammar words can also be real names (for example Will or Bill). Mask
    // recipient/merchant spans by position before the word allow-list runs.
    .replace(ENTITY_AFTER_CUE, (_match, cue: string) => `${cue} [text]`);

  for (const name of knownNames) {
    const trimmed = name.trim();
    if (trimmed.length >= 3) value = value.replace(safeLiteral(trimmed), '[text]');
  }

  value = value
    .replace(/\p{N}/gu, '#')
    .replace(/\p{L}+/gu, (word) =>
      isParserResearchTemplateWord(word) ? word : '[text]')
    .replace(ALLOWED_PUNCTUATION, ' ')
    .replace(/(?:\[text\][\s.,:;\-/]*){2,}/gu, '[text] ')
    .replace(/\s+/gu, ' ')
    .trim();
  return value.slice(0, PARSER_RESEARCH_TEMPLATE_MAX).trim();
}

const alphaAlias = (index: number): string => {
  let value = index + 1;
  let suffix = '';
  while (value > 0) {
    value -= 1;
    suffix = String.fromCharCode(65 + (value % 26)) + suffix;
    value = Math.floor(value / 26);
  }
  return `[sender ${suffix}]`;
};

/**
 * Parse a copied iOS Shortcut result. A blank line (or a line containing only
 * `---`) separates messages; an optional first line `From: SENDER` is routing
 * context and is never sent unless it maps to a known bank profile.
 */
export function parsePastedParserMessages(source: string): SmsCorpusMessage[] {
  return source
    .slice(0, PARSER_RESEARCH_PASTE_MAX)
    .split(/\n\s*(?:---\s*)?\n+/u)
    .map((block) => block.trim())
    .filter(Boolean)
    .map((block) => {
      const lines = block.split('\n');
      const senderLine = /^\s*(?:from|sender)\s*:\s*(.+)\s*$/iu.exec(lines[0] ?? '');
      return {
        sender: senderLine?.[1]?.trim() ?? '',
        body: (senderLine ? lines.slice(1) : lines).join('\n').trim(),
        receivedAtMs: 0,
      };
    })
    .filter((message) => message.body.length > 0);
}

function formatPreview(
  build: ParserResearchBuild,
  counts: ParserResearchCounts,
  shapes: ParserResearchShape[],
): string {
  const lines = [
    'WAFRA PARSER RESEARCH',
    `wire schema: 1 · report schema: ${PARSER_RESEARCH_SCHEMA}`,
    `purpose: ${PARSER_RESEARCH_FEEDBACK_TEXT}`,
    `build: ${build.version} · ${build.platform} · ${build.language}`,
    `market: ${build.marketId} · currency: ${build.currency} · Private Mode: off`,
    `checked: ${counts.checked}`,
    `financial matches: ${counts.financial}`,
    `security/OTP messages excluded: ${counts.sensitiveExcluded}`,
    `other messages excluded: ${counts.nonFinancialExcluded}`,
    `already supported alerts excluded: ${counts.alreadyParsedExcluded}`,
    `unique unsupported templates: ${counts.uniqueTemplates}`,
    `templates attached: ${counts.attachedTemplates}`,
    `templates omitted by size limit: ${counts.omittedTemplates}`,
    '',
    'REDACTION',
    '- raw message bodies: not sent',
    '- dates/timestamps: not sent',
    '- every digit: #',
    '- recipient/merchant spans and words outside the financial grammar: [text]',
    '- unknown sender IDs and phone numbers: aliases',
    '',
    `DELIVERY: AI review consent: yes; Wafra relay copy retained up to ${FEEDBACK_RETENTION_DAYS} days; GitHub Actions and Anthropic Claude process this report under their own retention policies; code and synthetic tests may appear in a public draft PR, but this report must not be published or merged automatically.`,
    '',
    'TEMPLATES',
  ];
  shapes.forEach((shape, index) => {
    lines.push(`${index + 1}. ${shape.sender} · ${shape.outcome} · seen ${shape.count}x`);
    lines.push(`   ${shape.template}`);
  });
  return lines.join('\n');
}

interface ParserResearchAccumulator {
  sensitiveExcluded: number;
  nonFinancialExcluded: number;
  alreadyParsedExcluded: number;
  financial: number;
  unknownSenders: Map<string, string>;
  templates: Map<string, ParserResearchShape>;
}

const createParserResearchAccumulator = (): ParserResearchAccumulator => ({
  sensitiveExcluded: 0,
  nonFinancialExcluded: 0,
  alreadyParsedExcluded: 0,
  financial: 0,
  unknownSenders: new Map(),
  templates: new Map(),
});

const addParserResearchMessage = (
  accumulator: ParserResearchAccumulator,
  message: SmsCorpusMessage,
): void => {
    const body = message.body.trim();
    if (!body) {
      accumulator.nonFinancialExcluded += 1;
      return;
    }
    if (nonPostingReason(body) !== null) {
      accumulator.sensitiveExcluded += 1;
      return;
    }
    const parsed = parseSms(body, undefined, { sender: message.sender || undefined });
    const draft = parsed ? null : inspectAlertDraft(body);
    if (!parsed && draft?.decision !== 'review') {
      accumulator.nonFinancialExcluded += 1;
      return;
    }
    accumulator.financial += 1;
    // The workflow proves a new test fails before it accepts a fix. Already
    // supported alerts cannot satisfy that gate, so do not spend privacy or
    // agent budget sending them.
    if (parsed) {
      accumulator.alreadyParsedExcluded += 1;
      return;
    }

    const bank = bankProfileForSender(message.sender || undefined)?.name ?? null;
    const senderKey = message.sender.trim().toLocaleLowerCase('en');
    let sender = bank;
    if (!sender) {
      const existing = accumulator.unknownSenders.get(senderKey);
      sender = existing ?? alphaAlias(accumulator.unknownSenders.size);
      if (!existing) accumulator.unknownSenders.set(senderKey, sender);
    }
    const template = sanitizeParserTemplate(body);
    if (!template) {
      accumulator.nonFinancialExcluded += 1;
      accumulator.financial -= 1;
      return;
    }
    const outcome = 'needs-parser-work' as const;
    const key = `${sender}\u0000${outcome}\u0000${template}`;
    const prior = accumulator.templates.get(key);
    if (prior) prior.count += 1;
    else accumulator.templates.set(key, { sender, template, outcome, count: 1 });
};

const finishParserResearchSubmission = (
  accumulator: ParserResearchAccumulator,
  checked: number,
  build: ParserResearchBuild,
  shapes: ParserResearchShape[],
  uniqueTemplateCount: number,
): ParserResearchSubmission => {
  const counts: ParserResearchCounts = {
    checked,
    financial: accumulator.financial,
    sensitiveExcluded: accumulator.sensitiveExcluded,
    nonFinancialExcluded: accumulator.nonFinancialExcluded,
    alreadyParsedExcluded: accumulator.alreadyParsedExcluded,
    uniqueTemplates: uniqueTemplateCount,
    attachedTemplates: shapes.length,
    omittedTemplates: Math.max(0, uniqueTemplateCount - shapes.length),
  };
  const preview = formatPreview(build, counts, shapes);
  const diagnostic = {
    reportSchema: PARSER_RESEARCH_SCHEMA,
    kind: 'parser-research' as const,
    detailRequested: 'parser-research' as const,
    detail: 'parser-research' as const,
    withheld: null,
    delivery: PARSER_RESEARCH_DELIVERY,
    build: {
      marketId: build.marketId,
      currency: build.currency,
      privateMode: false as const,
    },
    counts,
    shapes,
    cardDiagnostic: null,
    redaction: PARSER_RESEARCH_REDACTION,
  };
  const wire: ParserResearchWirePayload = {
    schema: 1,
    text: PARSER_RESEARCH_FEEDBACK_TEXT,
    appVersion: build.version,
    platform: build.platform,
    locale: build.language,
    aiReviewConsent: true,
    diagnostic,
  };
  const diagnosticBytes = new TextEncoder().encode(JSON.stringify(diagnostic)).byteLength;
  if (diagnosticBytes > FEEDBACK_DIAGNOSTIC_MAX_BYTES) {
    throw new Error('parser_research_report_too_large');
  }
  return { preview, wire, counts };
};

/** Build the exact bounded object shown to the tester and posted to the relay. */
export function buildParserResearchSubmission(
  messages: readonly SmsCorpusMessage[],
  build: ParserResearchBuild,
): ParserResearchSubmission {
  const accumulator = createParserResearchAccumulator();
  for (const message of messages) addParserResearchMessage(accumulator, message);
  const allShapes = [...accumulator.templates.values()].sort(compareParserResearchShapes);
  return finishParserResearchSubmission(
    accumulator,
    messages.length,
    build,
    allShapes.slice(0, PARSER_RESEARCH_SHAPES_MAX),
    allShapes.length,
  );
}

const RESEARCH_PARSE_TIME_BUDGET_MS = 8;
const RESEARCH_PARSE_SLICE_MAX = 64;
const compareParserResearchShapes = (a: ParserResearchShape, b: ParserResearchShape): number =>
  b.count - a.count || a.template.localeCompare(b.template);

const yieldToUi = (): Promise<void> =>
  new Promise((resolve) => setTimeout(resolve, 0));

const assertParserResearchContinues = (shouldContinue: () => boolean): void => {
  if (!shouldContinue()) throw new Error('parser_research_cancelled');
};

/** Insert after equal-ranked entries so this stays equivalent to stable Array.sort. */
const keepTopParserResearchShape = (
  topShapes: ParserResearchShape[],
  shape: ParserResearchShape,
): void => {
  let index = 0;
  while (
    index < topShapes.length &&
    compareParserResearchShapes(shape, topShapes[index]) >= 0
  ) index += 1;
  topShapes.splice(index, 0, shape);
  if (topShapes.length > PARSER_RESEARCH_SHAPES_MAX) topShapes.pop();
};

/**
 * Analyze a large inbox without monopolizing React Native's JavaScript thread.
 * The accumulator is identical to the synchronous builder; only scheduling is
 * different, so privacy filtering and the exported report remain byte-stable.
 */
export async function buildParserResearchSubmissionCooperatively(
  messages: readonly SmsCorpusMessage[],
  build: ParserResearchBuild,
  onProgress?: (progress: ParserResearchProgress) => void,
  options: ParserResearchCooperativeOptions = {},
): Promise<ParserResearchSubmission> {
  const shouldContinue = options.shouldContinue ?? (() => true);
  assertParserResearchContinues(shouldContinue);
  const accumulator = createParserResearchAccumulator();
  let sliceStartedAt = Date.now();
  let sliceSize = 0;
  for (let index = 0; index < messages.length; index += 1) {
    assertParserResearchContinues(shouldContinue);
    addParserResearchMessage(accumulator, messages[index]);
    sliceSize += 1;
    const checked = index + 1;
    const hasMore = checked < messages.length;
    if (hasMore && (
      sliceSize >= RESEARCH_PARSE_SLICE_MAX ||
      Date.now() - sliceStartedAt >= RESEARCH_PARSE_TIME_BUDGET_MS
    )) {
      onProgress?.({ stage: 'checking', completed: checked, total: messages.length });
      await yieldToUi();
      assertParserResearchContinues(shouldContinue);
      sliceStartedAt = Date.now();
      sliceSize = 0;
    }
  }
  onProgress?.({
    stage: 'checking',
    completed: messages.length,
    total: messages.length,
  });
  assertParserResearchContinues(shouldContinue);

  const uniqueTemplateCount = accumulator.templates.size;
  onProgress?.({ stage: 'finalizing', completed: 0, total: uniqueTemplateCount });
  await yieldToUi();
  assertParserResearchContinues(shouldContinue);

  const topShapes: ParserResearchShape[] = [];
  let finalized = 0;
  sliceStartedAt = Date.now();
  sliceSize = 0;
  for (const shape of accumulator.templates.values()) {
    assertParserResearchContinues(shouldContinue);
    keepTopParserResearchShape(topShapes, shape);
    finalized += 1;
    sliceSize += 1;
    const hasMore = finalized < uniqueTemplateCount;
    if (hasMore && (
      sliceSize >= RESEARCH_PARSE_SLICE_MAX ||
      Date.now() - sliceStartedAt >= RESEARCH_PARSE_TIME_BUDGET_MS
    )) {
      onProgress?.({ stage: 'finalizing', completed: finalized, total: uniqueTemplateCount });
      await yieldToUi();
      assertParserResearchContinues(shouldContinue);
      sliceStartedAt = Date.now();
      sliceSize = 0;
    }
  }
  onProgress?.({
    stage: 'finalizing',
    completed: finalized,
    total: uniqueTemplateCount,
  });
  assertParserResearchContinues(shouldContinue);
  return finishParserResearchSubmission(
    accumulator,
    messages.length,
    build,
    topShapes,
    uniqueTemplateCount,
  );
}
