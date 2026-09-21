/**
 * The local Ask Wafra intent router, and the index it reads.
 *
 * The router itself needs the 35 MB encoder, which is native-only and not on
 * disk in a Node test run — `local-semantic-runtime.ts` is the fail-closed web
 * stub here. So this suite pins the two things that CAN go wrong without a
 * device and would not be noticed until one:
 *
 *   1. The index and the tool catalog disagreeing. Every prototype must name a
 *      tool the catalog actually exposes, and every catalog tool must have a
 *      prototype. The second direction is the bug that prompted this work:
 *      fifteen of twenty-five tools had no prototype, so "how much did I blow
 *      on food last month" routed to income-total — not because the model was
 *      wrong, but because `category-breakdown` had nothing to be near.
 *
 *   2. The router refusing rather than guessing when the encoder is absent.
 *      An assistant that silently answered the wrong question offline would be
 *      worse than one that says it cannot answer yet.
 *
 * The routing ACCURACY numbers are not asserted here and cannot be: they need
 * the encoder. They were measured separately on thirty held-out questions
 * phrased differently from every anchor — 27/30 top-1, and with the gates on,
 * twenty routed with twenty correct and ten sent to a clarifying question. All
 * three misses fell inside the margin gate. Re-run that with
 * `scripts/local-ai/build-assistant-index.mjs` after changing anchors.
 */
const { ASSISTANT_TOOL_CATALOG } = require('./build/wafra-assistant-ai');
const { LOCAL_ROUTE_THRESHOLDS, routeAssistantQuestion } = require('./build/local-assistant-router');
const anchors = require('../local-ai/assistant-anchors.js');
const index = require('../../assets/local-ai/assistant-prototype-index.e5.int8.json');

let pass = 0;
let fail = 0;
const ok = (name, cond, detail) => {
  if (cond) {
    pass++;
    console.log(`✓ ${name}`);
  } else {
    fail++;
    console.log(`✗ ${name}${detail ? ` — ${detail}` : ''}`);
  }
};

const catalogTools = new Set(ASSISTANT_TOOL_CATALOG.map((entry) => entry.tool));

/* ── The index agrees with the catalog, in both directions ───────────── */

const anchorTools = new Set(anchors.map((group) => group.tool));

ok('every anchor names a tool the catalog exposes',
  anchors.every((group) => catalogTools.has(group.tool)),
  anchors.filter((group) => !catalogTools.has(group.tool)).map((g) => g.tool).join(', '));

ok(`every catalog tool has anchors (${anchorTools.size}/${catalogTools.size})`,
  [...catalogTools].every((tool) => anchorTools.has(tool)),
  [...catalogTools].filter((tool) => !anchorTools.has(tool)).join(', '));

ok('every prototype in the shipped index names a catalog tool',
  index.prototypes.every((p) => catalogTools.has(p.tool)),
  [...new Set(index.prototypes.filter((p) => !catalogTools.has(p.tool)).map((p) => p.tool))].join(', '));

ok('the shipped index covers every anchor id',
  anchors.every((group) => index.prototypes.some((p) => p.id === group.id)),
  anchors.filter((g) => !index.prototypes.some((p) => p.id === g.id)).map((g) => g.id).join(', '));

ok('the shipped index has no prototype the anchors do not define',
  index.prototypes.every((p) => anchors.some((group) => group.id === p.id)));

/* ── The index is structurally what the runtime expects ──────────────── */

ok('index pins the same model version as the runtime downloads',
  index.modelVersion === 'e5-arb-32768@e1b3907e6c83#int8-70fd5ee627d2', index.modelVersion);

ok('index declares 384 dimensions', index.embeddingDimensions === 384);

ok('every vector has exactly 384 components',
  index.prototypes.every((p) => Array.isArray(p.vector) && p.vector.length === 384));

ok('every vector is unit length',
  index.prototypes.every((p) => {
    const norm = Math.sqrt(p.vector.reduce((sum, v) => sum + v * v, 0));
    return Math.abs(norm - 1) < 1e-3;
  }));

ok('every vector is finite — one NaN silently poisons every comparison',
  index.prototypes.every((p) => p.vector.every((v) => Number.isFinite(v))));

ok('scoring is raw cosine with max-per-id aggregation, as the router assumes',
  index.scoreScale === 'raw-cosine' && index.aggregation === 'max-per-prototype-id');

/* ── The anchors cover the languages the encoder exists for ──────────── */

const arabic = /[؀-ۿ]/u;
const withoutArabic = anchors.filter((group) => !group.phrasings.some((p) => arabic.test(p)));
ok('every intent has at least one Arabic-script phrasing',
  withoutArabic.length === 0, withoutArabic.map((g) => g.id).join(', '));

const thin = anchors.filter((group) => group.phrasings.length < 5);
ok('every intent has at least five phrasings',
  thin.length === 0, thin.map((g) => `${g.id}:${g.phrasings.length}`).join(', '));

ok('no phrasing is duplicated across intents — one string cannot mean two things',
  (() => {
    const seen = new Map();
    for (const group of anchors) {
      for (const phrasing of group.phrasings) {
        const key = phrasing.trim().toLowerCase();
        if (seen.has(key) && seen.get(key) !== group.id) return false;
        seen.set(key, group.id);
      }
    }
    return true;
  })());

/* ── Gates ───────────────────────────────────────────────────────────── */

ok('thresholds are present and conservative',
  LOCAL_ROUTE_THRESHOLDS.minimumScore >= 0.5 && LOCAL_ROUTE_THRESHOLDS.minimumMargin > 0,
  JSON.stringify(LOCAL_ROUTE_THRESHOLDS));

ok('thresholds are frozen — a gate that can be reassigned at runtime is not a gate',
  Object.isFrozen(LOCAL_ROUTE_THRESHOLDS));

/* ── Without an encoder it refuses, and says why ─────────────────────── */

(async () => {
  const offline = await routeAssistantQuestion('how much did I spend this month');
  ok('with no encoder on the device the router refuses rather than guessing',
    offline.status === 'unavailable', JSON.stringify(offline));
  ok('...and names the reason so the caller can fall back deliberately',
    typeof offline.reason === 'string' && offline.reason.length > 0, JSON.stringify(offline));

  const empty = await routeAssistantQuestion('   ');
  ok('an empty question is refused without touching the encoder',
    empty.status === 'unavailable' && empty.reason === 'empty-question', JSON.stringify(empty));

  console.log(`\n${pass} passed, ${fail} failed`);
  process.exit(fail ? 1 : 0);
})();
