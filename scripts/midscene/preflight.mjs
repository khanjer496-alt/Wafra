#!/usr/bin/env node
/**
 * Refuse to start without a model, and say which variable is missing.
 *
 * Midscene without credentials does not skip: it launches Chromium, exports
 * nothing, and fails inside the first `ai*` call with a provider error several
 * frames deep. That reads like the app is broken. Check it here instead, where
 * the message can name the variable and the run costs nothing.
 *
 * Wafra's own AGENTS.md rule applies to whatever you set: no secrets in
 * source, logs, docs or commits. Export these in your shell, or keep them in
 * scripts/midscene/.env.local, which .gitignore already excludes.
 */
const KEY = ['MIDSCENE_MODEL_API_KEY', 'OPENAI_API_KEY'];
const NAME = ['MIDSCENE_MODEL_NAME'];
const BASE_URL = ['MIDSCENE_MODEL_BASE_URL', 'OPENAI_BASE_URL'];

const missing = [];
const have = (names) => names.find((n) => (process.env[n] ?? '').trim() !== '');

if (!have(KEY)) missing.push(`an API key: set ${KEY.join(' or ')}`);
if (!have(NAME)) missing.push(`a model: set ${NAME[0]} (a vision-language model — Midscene reads screenshots)`);
// Midscene 1.13 has no implicit provider default: a key and a model with no
// endpoint fail deep inside the first step with "failed to get base URL of
// model (intent=default)", which names neither the variable nor this suite.
if (!have(BASE_URL)) missing.push(`an endpoint: set ${BASE_URL.join(' or ')} (there is no implicit default)`);

if (missing.length) {
  console.error('midscene/preflight: no model is configured, so no AI step can run.\n');
  for (const m of missing) console.error(`  - ${m}`);
  console.error('\n  A non-OpenAI provider also needs its family: MIDSCENE_MODEL_FAMILY,');
  console.error('  or the matching MIDSCENE_USE_* switch (Qwen-VL, Gemini, Doubao, UI-TARS).');
  console.error('\n  See scripts/midscene/README.md.');
  process.exit(1);
}

console.log('midscene/preflight: model configured');
console.log(`  model   ${process.env[have(NAME)]}`);
console.log(`  key     ${have(KEY)} (set, not printed)`);
console.log(`  baseUrl ${process.env[have(BASE_URL)]}`);
