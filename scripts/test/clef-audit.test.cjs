// Offline Clef audit (scripts/parser-ai/clef-audit*.cjs): request shape, answer
// validation, scoring/calibration maths, privacy guards and one end-to-end run
// against a stubbed Workers AI endpoint. No network.
// Run: node --test scripts/test/clef-audit.test.cjs
const assert = require('node:assert/strict');
const test = require('node:test');
const lib = require('../parser-ai/clef-audit-lib.cjs');
const cli = require('../parser-ai/clef-audit.cjs');
const { buildPublicRealEvalSet } = require('../parser-ai/public-real-eval-set.cjs');

const row = (over = {}) => ({
  id: 'r1', source: 'synthetic', country: 'AE', sender: 'BANK', body: 'Purchase of AED 12.00 at CAFE',
  label: { status: 'completed', shouldPost: true, family: 'purchase', direction: 'debit' }, ...over,
});

const choice = (options, picked, p) => ({
  type: 'choice', choice: picked, confidence: p,
  probabilities: Object.fromEntries(options.map((o) => [o, o === picked ? p : (1 - p) / (options.length - 1)])),
});
const response = ({ status = 'completed', family = 'purchase', direction = 'debit', p = 0.95, post = 0.95 } = {}) => ({
  model: 'clef-flash',
  answers: {
    status: choice(Object.keys(lib.QUESTIONS.status.criteria), status, p),
    family: choice(Object.keys(lib.QUESTIONS.family.criteria), family, p),
    direction: choice(Object.keys(lib.QUESTIONS.direction.criteria), direction, p),
    shouldPost: { type: 'noul', noul: post },
  },
  usage: { input_tokens: 300, output_tokens: 0 },
});

test('the request carries the message only as state and asks the four closed questions', () => {
  const req = lib.buildClefRequest(row(), 'clef-flash');
  assert.equal(req.model, 'clef-flash');
  assert.deepEqual(req.state, { sender: 'BANK', country: 'AE', message: 'Purchase of AED 12.00 at CAFE' });
  assert.deepEqual(Object.keys(req.questions), ['status', 'family', 'direction', 'shouldPost']);
  assert.equal(req.questions.shouldPost.type, 'noul');
  assert.ok(!JSON.stringify(req.questions).includes('CAFE'));
  assert.throws(() => lib.buildClefRequest(row(), 'llama'), /unknown model/);
});

test('answers are read from the bare body or the Cloudflare result envelope', () => {
  const bare = lib.readClefAnswers(response({ post: 0.2 }));
  assert.equal(bare.status.choice, 'completed');
  assert.equal(bare.status.confidence, 0.95);
  assert.equal(bare.shouldPost.choice, false);
  assert.equal(bare.shouldPost.confidence, 0.8);
  const wrapped = lib.readClefAnswers({ success: true, errors: [], result: response() });
  assert.equal(wrapped.family.choice, 'purchase');
});

test('answers outside the closed vocabulary or with bad probabilities are rejected', () => {
  const bad = response();
  bad.answers.status.choice = 'maybe';
  assert.throws(() => lib.readClefAnswers(bad), /bad status answer/);
  const noPost = response();
  delete noPost.answers.shouldPost;
  assert.throws(() => lib.readClefAnswers(noPost), /bad shouldPost/);
  const outOfRange = response();
  outOfRange.answers.direction.probabilities.credit = 1.5;
  assert.throws(() => lib.readClefAnswers(outOfRange), /bad direction probability/);
  assert.throws(() => lib.readClefAnswers({ result: {} }), /no answers/);
});

test('scoring separates leads from overconfident Clef errors and computes calibration', () => {
  const audit = lib.newAudit();
  const right = { status: 'completed', family: 'purchase', direction: 'debit', shouldPost: true };
  // Row 1: parser misses the posting; Clef gets everything right at 0.95.
  lib.scoreClefRow(audit, row({ id: 'a' }), { ...right, status: 'unknown', shouldPost: false },
    lib.readClefAnswers(response()), 0.9);
  // Row 2: an OTP; parser right, Clef confidently wrong on status.
  lib.scoreClefRow(audit,
    row({ id: 'b', label: { status: 'otp', shouldPost: false, family: 'non-posting', direction: 'none' } }),
    { status: 'otp', family: 'non-posting', direction: 'none', shouldPost: false },
    lib.readClefAnswers(response({ status: 'completed', family: 'non-posting', direction: 'none', p: 0.92, post: 0.1 })), 0.9);
  const s = lib.summarizeClefAudit(audit);
  assert.equal(s.rows, 2);
  assert.equal(s.fields.status.parserAccuracy, 0.5);
  assert.equal(s.fields.status.clefAccuracy, 0.5);
  assert.equal(s.fields.status.agreement, 0);
  assert.equal(s.fields.shouldPost.clefAccuracy, 1);
  assert.deepEqual(s.leads.map((l) => `${l.id}:${l.field}`), ['a:status', 'a:shouldPost']);
  assert.deepEqual(s.overconfident.map((l) => `${l.id}:${l.field}`), ['b:status']);
  // shouldPost Brier: row a (0.95 yes, true) -> 2 * 0.05^2; row b (0.1 yes, false) -> 2 * 0.1^2.
  assert.equal(s.fields.shouldPost.clefBrier, Number(((2 * 0.0025 + 2 * 0.01) / 2).toFixed(4)));
  // status ECE: one bin holds both rows, mean confidence 0.935, accuracy 0.5.
  assert.equal(s.fields.status.clefEce, 0.435);
});

test('only the built-in privacy-safe sets can be selected', () => {
  assert.deepEqual(cli.parseArgs([]).sets, ['repo', 'public']);
  assert.throws(() => cli.parseArgs(['--sets', 'private']), /unknown set private/);
  assert.throws(() => cli.parseArgs(['--sets', '/tmp/export.json']), /unknown set/);
  assert.throws(() => cli.parseArgs(['--model', 'gpt']), /--model/);
  assert.throws(() => cli.parseArgs(['--concurrency', '64']), /--concurrency/);
  assert.throws(() => cli.parseArgs(['--threshold', '2']), /--threshold/);
});

test('sampling is deterministic and spread across the set', () => {
  const items = Array.from({ length: 10 }, (_, i) => i);
  assert.deepEqual(cli.sample(items, 5), [0, 2, 4, 6, 8]);
  assert.deepEqual(cli.sample(items, 20), items);
});

test('a live run needs credentials unless it is a dry run', async () => {
  await assert.rejects(cli.main(['--sets', 'public'], {}, () => {}), /CLOUDFLARE_ACCOUNT_ID/);
});

test('end to end against a stubbed Workers AI: report holds ids and metrics, never message text', async (t) => {
  const bodies = buildPublicRealEvalSet({ localPath: null }).filter((r) => r.origin === 'committed').map((r) => r.body);
  const calls = [];
  const realFetch = globalThis.fetch;
  t.after(() => { globalThis.fetch = realFetch; });
  globalThis.fetch = async (url, init) => {
    calls.push({ url, auth: init.headers.authorization, body: JSON.parse(init.body) });
    // Fail one request to exercise the failure path without leaking its body.
    if (calls.length === 3) return { ok: false, status: 400, json: async () => ({ echo: init.body }) };
    return { ok: true, status: 200, json: async () => ({ success: true, result: response() }) };
  };
  const lines = [];
  const report = await cli.main(['--sets', 'public', '--limit', '6', '--concurrency', '1'],
    { CLOUDFLARE_ACCOUNT_ID: 'acct', CLOUDFLARE_API_TOKEN: 'test-token-7f3a' }, (line) => lines.push(line));
  assert.equal(calls.length, 6);
  assert.equal(calls[0].url, 'https://api.cloudflare.com/client/v4/accounts/acct/ai/run/@cf/cloudflare/clef-flash');
  assert.equal(calls[0].auth, 'Bearer test-token-7f3a');
  assert.equal(calls[0].body.model, 'clef-flash');
  assert.equal(report.rows, 5);
  assert.deepEqual(report.requests, { sent: 5, cached: 0, failed: 1 });
  assert.deepEqual(report.failures.map((f) => f.error), ['Workers AI HTTP 400']);
  const out = JSON.stringify(report) + lines.join('\n');
  for (const body of bodies) assert.ok(!out.includes(body), 'report must not contain message text');
  assert.ok(!out.includes('test-token-7f3a'), 'report must not contain the token');
});
