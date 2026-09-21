/**
 * Local intent routing for Ask Wafra: question in, tool name out.
 *
 * Today `buildAssistantInterpretationEnvelope` sends the question and the tool
 * catalog to a remote model to decide which tool to run. That works and it
 * needs the network, which means Ask Wafra does not answer on a plane, in a
 * basement, or for anyone who would rather their questions about their own
 * money not leave the phone. This routes the same decision on-device, using
 * the E5 encoder the app already downloads and hash-verifies.
 *
 * WHAT IT DOES NOT DO
 *
 * It does not compute anything. It returns the NAME of a deterministic ledger
 * tool and nothing else — no amount, no period, no merchant, no total. Every
 * figure a user sees is computed by `wafra-assistant.ts` from the local
 * ledger, exactly as it is today. A model that cannot produce a number cannot
 * produce a wrong one, and that is the entire reason this layer is allowed to
 * exist.
 *
 * It also cannot invent a tool. The result is matched against
 * `ASSISTANT_TOOL_CATALOG` before it is returned, so a prototype index that
 * somehow named an unknown tool routes to `null` rather than to authority the
 * index granted itself.
 *
 * WHEN IT REFUSES
 *
 * Two gates, and both exist because of what
 * `validation/semantic-parser/FINDINGS.md` measured. A confidence threshold
 * tuned in-domain produced unsafe results one dialect away, and two models
 * agreeing at high confidence agreed on every case where the first was wrong.
 * So confidence alone is not trusted here either:
 *
 *   minimumScore   the question has to land near SOMETHING. A question about
 *                  the weather is near nothing, and gets no tool.
 *   minimumMargin  the nearest two intents have to be distinguishable. "How
 *                  much did Noon take from me" sits between merchant spending
 *                  and net income at a margin of 0.003 — the honest answer is
 *                  a clarifying question, not a coin flip.
 *
 * On a held-out set of thirty questions phrased differently from every anchor,
 * those gates routed twenty and asked about ten, and all twenty routed were
 * correct. The three wrong answers were all inside the margin gate. That is
 * the shape to preserve: wrong answers become questions.
 *
 * COST
 *
 * One encode plus a dot product per prototype: ~5 ms on a desktop CPU for 252
 * prototypes, against 0.5-2 s for a generative model. Device figures are the
 * ones that count and are not in yet.
 */
import {
  LOCAL_ASSISTANT_PROTOTYPE_INDEX,
} from '@/lib/local-semantic-bundle';
import { getLocalSemanticEncoder, localSemanticRuntimeStatus } from '@/lib/local-semantic-runtime';
import { ASSISTANT_TOOL_CATALOG } from '@/lib/wafra-assistant-ai';
import type { AssistantTool } from '@/lib/wafra-assistant';

export interface LocalAssistantRoute {
  /** The deterministic tool to run. Never a value, never a figure. */
  tool: AssistantTool;
  /** The prototype id that matched, for diagnostics and the review card. */
  intentId: string;
  /** Raw cosine against the nearest prototype. Never shown to a user. */
  score: number;
  /** Gap to the runner-up intent. Never shown to a user. */
  margin: number;
}

export type LocalAssistantRouteOutcome =
  | { status: 'routed'; route: LocalAssistantRoute }
  /** Understood the shape but not confidently enough to pick. Ask the user. */
  | { status: 'ambiguous'; between: readonly string[]; score: number; margin: number }
  /** Nothing in the catalog is close. Not a question Wafra answers. */
  | { status: 'unrecognised'; score: number }
  /** The encoder is not on the device yet, or failed. Fall back to remote. */
  | { status: 'unavailable'; reason: string };

/**
 * Selected to route confidently or not at all, then held fixed.
 *
 * These are NOT tuned per market or per language. A threshold is a property of
 * the distribution it was fitted on, which is precisely how the parser-side
 * experiment produced unsafe results on an unseen dialect, so there is one set
 * for every language the encoder handles and it errs toward asking.
 */
export const LOCAL_ROUTE_THRESHOLDS = Object.freeze({
  minimumScore: 0.80,
  minimumMargin: 0.02,
});

const KNOWN_TOOLS: ReadonlySet<string> = new Set(
  ASSISTANT_TOOL_CATALOG.map((entry) => entry.tool),
);

const dot = (left: ArrayLike<number>, right: ArrayLike<number>): number => {
  let total = 0;
  for (let index = 0; index < left.length; index += 1) {
    total += Number(left[index]) * Number(right[index]);
  }
  return total;
};

interface RankedIntent { id: string; tool: string | null; score: number }

/**
 * `aggregation: 'max-per-prototype-id'` — an intent has many phrasings and is
 * represented by its best one, not by their average. Averaging would pull an
 * intent toward whichever phrasings happen to be most numerous.
 */
const rank = (embedding: ArrayLike<number>): RankedIntent[] => {
  const best = new Map<string, RankedIntent>();
  for (const prototype of LOCAL_ASSISTANT_PROTOTYPE_INDEX.prototypes) {
    const score = dot(embedding, prototype.vector);
    const previous = best.get(prototype.id);
    if (!previous || score > previous.score) {
      best.set(prototype.id, {
        id: prototype.id,
        tool: (prototype as { tool?: string }).tool ?? null,
        score,
      });
    }
  }
  return [...best.values()].sort((left, right) => right.score - left.score);
};

/**
 * Route a natural-language question to a deterministic tool.
 *
 * English, Arabic and Arabizi go through the same embedding space, so there is
 * no language detection step and no per-language rule set to keep in sync.
 */
export async function routeAssistantQuestion(
  question: string,
): Promise<LocalAssistantRouteOutcome> {
  const text = question.trim();
  if (!text) return { status: 'unavailable', reason: 'empty-question' };

  const runtime = localSemanticRuntimeStatus();
  if (runtime.state !== 'ready') {
    // Kick the download so a later question can be answered locally, but never
    // block this one on ~35 MB: the caller falls back to the remote path.
    void getLocalSemanticEncoder().catch(() => undefined);
    return { status: 'unavailable', reason: `runtime:${runtime.state}` };
  }

  let ranked: RankedIntent[];
  try {
    const encoder = await getLocalSemanticEncoder();
    const embedding = await encoder.encode(text);
    if (embedding.length !== LOCAL_ASSISTANT_PROTOTYPE_INDEX.embeddingDimensions) {
      return { status: 'unavailable', reason: 'dimension-mismatch' };
    }
    ranked = rank(embedding);
  } catch (error) {
    return {
      status: 'unavailable',
      reason: error instanceof Error ? error.message.slice(0, 120) : 'encode-failed',
    };
  }

  const top = ranked[0];
  if (!top) return { status: 'unavailable', reason: 'empty-index' };
  if (top.score < LOCAL_ROUTE_THRESHOLDS.minimumScore) {
    return { status: 'unrecognised', score: top.score };
  }

  const margin = top.score - (ranked[1]?.score ?? 0);
  if (margin < LOCAL_ROUTE_THRESHOLDS.minimumMargin) {
    return {
      status: 'ambiguous',
      between: ranked.slice(0, 2).map((entry) => entry.id),
      score: top.score,
      margin,
    };
  }

  // The index names a tool; the catalog decides whether that tool exists. An
  // index is data, and data does not get to widen what the assistant can run.
  if (!top.tool || !KNOWN_TOOLS.has(top.tool)) {
    return { status: 'unrecognised', score: top.score };
  }

  return {
    status: 'routed',
    route: { tool: top.tool as AssistantTool, intentId: top.id, score: top.score, margin },
  };
}
