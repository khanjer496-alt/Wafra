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

/** Build the exact bounded object shown to the tester and posted to the relay. */
export function buildParserResearchSubmission(
  messages: readonly SmsCorpusMessage[],
  build: ParserResearchBuild,
): ParserResearchSubmission {
  let sensitiveExcluded = 0;
  let nonFinancialExcluded = 0;
  let alreadyParsedExcluded = 0;
  let financial = 0;
  const unknownSenders = new Map<string, string>();
  const templates = new Map<string, ParserResearchShape>();

  for (const message of messages) {
    const body = message.body.trim();
    if (!body) {
      nonFinancialExcluded += 1;
      continue;
    }
    if (nonPostingReason(body) !== null) {
      sensitiveExcluded += 1;
      continue;
    }
    const parsed = parseSms(body, undefined, { sender: message.sender || undefined });
    const draft = parsed ? null : inspectAlertDraft(body);
    if (!parsed && draft?.decision !== 'review') {
      nonFinancialExcluded += 1;
      continue;
    }
    financial += 1;
    // The workflow proves a new test fails before it accepts a fix. Already
    // supported alerts cannot satisfy that gate, so do not spend privacy or
    // agent budget sending them.
    if (parsed) {
      alreadyParsedExcluded += 1;
      continue;
    }

    const bank = bankProfileForSender(message.sender || undefined)?.name ?? null;
    const senderKey = message.sender.trim().toLocaleLowerCase('en');
    let sender = bank;
    if (!sender) {
      const existing = unknownSenders.get(senderKey);
      sender = existing ?? alphaAlias(unknownSenders.size);
      if (!existing) unknownSenders.set(senderKey, sender);
    }
    const template = sanitizeParserTemplate(body);
    if (!template) {
      nonFinancialExcluded += 1;
      financial -= 1;
      continue;
    }
    const outcome = 'needs-parser-work' as const;
    const key = `${sender}\u0000${outcome}\u0000${template}`;
    const prior = templates.get(key);
    if (prior) prior.count += 1;
    else templates.set(key, { sender, template, outcome, count: 1 });
  }

  const allShapes = [...templates.values()].sort((a, b) =>
    b.count - a.count || a.template.localeCompare(b.template));
  const shapes = allShapes.slice(0, PARSER_RESEARCH_SHAPES_MAX);
  const counts: ParserResearchCounts = {
    checked: messages.length,
    financial,
    sensitiveExcluded,
    nonFinancialExcluded,
    alreadyParsedExcluded,
    uniqueTemplates: allShapes.length,
    attachedTemplates: shapes.length,
    omittedTemplates: Math.max(0, allShapes.length - shapes.length),
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
}
