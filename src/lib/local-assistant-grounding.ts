import { planAssistantQuestion, type AssistantToolRequest } from '@/lib/wafra-assistant';
import type { AppState } from '@/lib/types';
import type { Period } from '@/lib/period';

/** Only clearly independent questions may discard the previous turn. */
export function isIndependentAssistantQuestion(question: string): boolean {
  const q = question.trim().toLowerCase();
  if (/\b(?:it|this|these|that|those|them|same|instead|before that)\b/.test(q)) return false;
  if (/^(?:and\b|what about\b|how about\b|compare\b|show\b|top\b|exclude\b|excluding\b|without\b|ignore\b)/.test(q)) return false;
  return /^(?:how much (?:did|do|have|was|is)|what (?:are|is|did|do)|which\b|where\b|who\b|give me\b|tell me\b)/.test(q);
}

/** Let the existing obligation planner resolve its established follow-up grammar. */
export function localAssistantPreviousRequest(
  state: AppState, question: string, previous: AssistantToolRequest | null | undefined,
  now: Date, period: Period,
): AssistantToolRequest | null | undefined {
  if (!isIndependentAssistantQuestion(question)) return previous;
  if (previous && ['obligation-status', 'account-inventory', 'top-accounts'].includes(previous.tool)) {
    const contextual = planAssistantQuestion(state, question, now, previous, period);
    if (contextual.tool === 'obligation-status') return previous;
  }
  return null;
}

// These are intent-only rewrites. The complete remaining question goes through
// the existing planner, including its dates, named entities and rejection rules.
const REWRITES: readonly { tool: AssistantToolRequest['tool']; pattern: RegExp; replacement: string }[] = [
  { tool: 'spending-total', pattern: /^(?:give me|tell me|what is) (?:a |the |my )?(?:total (?:of )?)?(?:outgoing money|money going out|outgoings|expenditure)\b/i, replacement: 'how much did I spend' },
  { tool: 'income-total', pattern: /^(?:give me|tell me|what is) (?:the |my )?(?:incoming money|money coming in|incomings)\b/i, replacement: 'how much income did I receive' },
  { tool: 'top-merchants', pattern: /^(?:who|which shops) (?:got|gets|received) (?:most of )?my money\b/i, replacement: 'top merchants' },
  { tool: 'largest-purchases', pattern: /^(?:what are|show me) (?:my |the )?(?:priciest|costliest) (?:buys|purchases)\b/i, replacement: 'largest purchases' },
];

/** Bounded language aliases are deterministic and never need a model download. */
export function normalizeLocalAssistantQuestion(question: string): string {
  const q = question.trim();
  for (const rewrite of REWRITES) {
    if (rewrite.pattern.test(q)) return q.replace(rewrite.pattern, rewrite.replacement);
  }
  const neutral = q.replace(/[?!.؟]+$/, '').trim().toLowerCase();
  const aliases: Record<string, string> = {
    'my outgoings': 'How much did I spend?',
    'money going out': 'How much did I spend?',
    'money coming in': 'How much income did I receive?',
    'my incomings': 'How much income did I receive?',
    'my ongoing charges': 'What are my active subscriptions?',
    'things i subscribe to': 'What are my active subscriptions?',
    'كم صرفت': 'How much did I spend?',
    'كم صرفت هذا الشهر': 'How much did I spend this month?',
  };
  return aliases[neutral] ?? q;
}

const PROMPTS: Partial<Record<AssistantToolRequest['tool'], string>> = {
  'spending-total': 'How much did I spend?',
  'income-total': 'How much income did I receive?',
  'top-merchants': 'What are my top merchants?',
  'top-categories': 'What are my top categories?',
  'largest-purchases': 'What are my largest purchases?',
  'daily-average': 'What is my daily average spending?',
  'subscriptions': 'What are my active subscriptions?',
  'possible-duplicates': 'Show possible duplicate charges',
  'money-review': 'Review my spending',
  'data-coverage': 'What is my data coverage?',
  'upcoming-payments': 'What payments are due within the next 30 days?',
  'month-forecast': 'What is my spending forecast this month?',
};

export function groundLocalAssistantRequest(
  state: AppState, question: string, candidate: AssistantToolRequest,
  now: Date, period: Period,
): AssistantToolRequest {
  const neutral = question.trim().replace(/[?!.؟]+$/, '').trim().toLowerCase();
  // Complete, unconstrained phrases only. Never infer a period from a nearest
  // prototype for text with an unrecognized date or other trailing qualifier.
  const neutralQuestions: Partial<Record<AssistantToolRequest['tool'], readonly string[]>> = {
    'spending-total': ['my outgoings', 'money going out', 'كم صرفت', 'كم صرفت هذا الشهر'],
    'income-total': ['money coming in', 'my incomings'],
    'subscriptions': ['my ongoing charges', 'things i subscribe to'],
  };
  if (neutralQuestions[candidate.tool]?.includes(neutral)) {
    if ('period' in candidate) return { ...candidate, period: neutral === 'كم صرفت هذا الشهر'
      ? { mode: 'month', key: `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}` }
      : period };
    return candidate;
  }
  for (const rewrite of REWRITES) {
    if (candidate.tool !== rewrite.tool || !rewrite.pattern.test(question.trim())) continue;
    // Never append model-produced arguments to an existing deterministic plan.
    return planAssistantQuestion(state, question.trim().replace(rewrite.pattern, rewrite.replacement), now, null, period);
  }
  const suggestion = PROMPTS[candidate.tool];
  return {
    tool: 'help',
    clarification: 'I recognized a possible topic, but could not safely interpret the full question. Please specify the dates and any merchant or category you want to include.',
    ...(suggestion ? { suggestions: [suggestion] } : {}),
  };
}
