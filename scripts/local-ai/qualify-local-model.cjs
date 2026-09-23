#!/usr/bin/env node
'use strict';
// Host-only, synthetic qualification. Never connects this model to a ledger.
const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');
const { execFileSync } = require('node:child_process');
const { isDeepStrictEqual } = require('node:util');
const { performance } = require('node:perf_hooks');
const { schemas, prompts, validate, compileAsk } = require('./qualification-contract.cjs');
const { createLoader } = require('../universal-test/load-ts.cjs');
const boundary = createLoader()('@/lib/wafra-assistant-ai');
const root = path.resolve(__dirname, '../..');
const [candidateId, outputArgument] = process.argv.slice(2);
const candidate = require('./candidates-v2.json').candidates.find(c => c.id === candidateId);
if (!candidate || !outputArgument) throw new Error('Usage: qualify-local-model.cjs <candidate-id> <new-report-path>');
const outputPath = path.resolve(outputArgument);
if (fs.existsSync(outputPath) || fs.existsSync(outputPath + '.jsonl')) throw new Error('Refusing to overwrite evaluation evidence');
const endpoint = new URL(process.env.WAFRA_QUALIFY_ENDPOINT ?? 'http://127.0.0.1:18821');
if (endpoint.protocol !== 'http:' || !['127.0.0.1', 'localhost', '[::1]'].includes(endpoint.hostname) || endpoint.username || endpoint.password) {
  throw new Error('Qualification requires a local HTTP endpoint');
}
const cache = process.env.WAFRA_QUALIFY_CACHE ?? '/tmp/wafra-local-ai-eval';
const modelPath = path.join(cache, candidate.file);
const apiKey = fs.readFileSync(process.env.WAFRA_QUALIFY_KEY_FILE ?? path.join(cache, 'qualification-v2-api-key'), 'utf8').trim();
const digest = value => crypto.createHash('sha256').update(value).digest('hex');
const expectedFixtureHashes = {
  bank: '48ed63f642e0b8de708c82dffc6165a7022761a200e9c7d97ce183318619c711',
  ask: '61fd0baae952dadc3dfa827695da6b23fe7cbf3b347cc5fce1ac1147710fc131',
};
const fixtureData = {};
for (const domain of ['bank', 'ask']) {
  const bytes = fs.readFileSync(path.join(root, `scripts/test/fixtures/local-ai-${domain}-v2.json`));
  if (digest(bytes) !== expectedFixtureHashes[domain]) throw new Error(`Frozen ${domain} fixture changed`);
  fixtureData[domain] = JSON.parse(bytes);
  for (const row of fixtureData[domain]) {
    const result = validate(domain, row.text, row.expected);
    if (!result.valid) throw new Error(`Invalid gold contract: ${row.id}: ${result.errors.join('; ')}`);
    if (domain === 'ask' && !productionShape(row.expected).valid) throw new Error(`Gold cannot compile to a production request: ${row.id}`);
  }
}
async function localFetch(route, options = {}) {
  const url = new URL(route, endpoint);
  if (url.origin !== endpoint.origin) throw new Error('Refusing nonlocal qualification route');
  const response = await fetch(url, {
    ...options, headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${apiKey}` },
    signal: AbortSignal.timeout(90000), redirect: 'manual',
  });
  if (!response.ok) {
    const error = new Error(`Local ${route} HTTP ${response.status}`);
    error.http = { route, status: response.status,
      body: (await response.text()).slice(0, 65536).replaceAll(apiKey, '<redacted>') };
    throw error;
  }
  return response.json();
}
const positive = (domain, value) => domain === 'bank' ? value?.decision === 'candidate' : typeof value?.tool === 'string' && value.tool !== 'help';
const percentile = (values, p) => [...values].sort((a, b) => a - b)[Math.max(0, Math.ceil(values.length * p) - 1)] ?? null;
function productionShape(output) {
  const request = compileAsk(output);
  if (!['help', 'subscriptions', 'upcoming-payments'].includes(request.tool) && request.period === undefined) {
    request.period = { mode: 'month', key: '2026-09' }; // Explicit host UI selection, not a model guess.
  }
  if (['top-merchants', 'top-categories', 'largest-purchases'].includes(request.tool) && request.limit === undefined) request.limit = 5;
  if (request.tool === 'upcoming-payments' && request.withinDays === undefined) request.withinDays = 30;
  return { valid: boundary.isAssistantToolRequest(request), request };
}
function summarize(rows) {
  const summary = {};
  for (const domain of ['bank', 'ask']) {
    const selected = rows.filter(row => row.domain === domain);
    const positives = selected.filter(row => positive(domain, row.expected));
    const negatives = selected.filter(row => !positive(domain, row.expected));
    const accepted = selected.filter(row => row.validation.valid && row.productionShapeValid !== false && positive(domain, row.output));
    const correctPositive = positives.filter(row => row.exact).length;
    summary[domain] = {
      cases: selected.length, supported: positives.length, requiredAbstentions: negatives.length,
      validJson: selected.filter(row => row.output !== null).length,
      validContract: selected.filter(row => row.validation.valid).length,
      exact: selected.filter(row => row.exact).length,
      exactSupported: correctPositive,
      supportedExactRate: positives.length ? correctPositive / positives.length : 0,
      rawFalseAccepts: negatives.filter(row => positive(domain, row.output)).length,
      guardedAccepted: accepted.length,
      guardedWrongAccepted: accepted.filter(row => !row.exact).length,
      guardedFalseAccepts: accepted.filter(row => !positive(domain, row.expected)).length,
      p50Ms: percentile(selected.map(row => row.elapsedMs), 0.5),
      p95Ms: percentile(selected.map(row => row.elapsedMs), 0.95),
      candidateGatePassed: selected.length === fixtureData[domain].length && correctPositive / positives.length >= 0.95 && accepted.every(row => row.exact),
    };
  }
  return summary;
}
(async () => {
  if (fs.statSync(modelPath).size !== candidate.bytes) throw new Error('Model size mismatch');
  const hash = crypto.createHash('sha256');
  for await (const chunk of fs.createReadStream(modelPath)) hash.update(chunk);
  if (hash.digest('hex') !== candidate.sha256) throw new Error('Model SHA-256 mismatch');
  const models = await localFetch('/v1/models');
  const ids = models.data?.map(model => model.id) ?? [];
  if (ids.length !== 1 || ![modelPath, candidate.file].includes(ids[0])) throw new Error('Local server is not associated with the verified model');
  const pids = [...new Set(execFileSync('lsof', [`-tiTCP:${endpoint.port}`, '-sTCP:LISTEN'], { encoding: 'utf8' }).trim().split(/\s+/))];
  if (pids.length !== 1 || !/^\d+$/.test(pids[0])) throw new Error('Cannot identify dedicated local server');
  const pid = pids[0];
  const command = execFileSync('ps', ['-p', pid, '-o', 'command='], { encoding: 'utf8' });
  if (!command.includes('llama-server') || !command.includes(modelPath)) throw new Error('Server process does not use pinned path');
  const argv = command.trim().split(/\s+/);
  for (const [flag, value] of [['-c', '2048'], ['-np', '1'], ['-t', '2'], ['-tb', '2'], ['--cache-ram', '0'], ['--reasoning', 'off']]) {
    const index = argv.indexOf(flag);
    if (index < 0 || argv[index + 1] !== value) throw new Error(`Server setting differs from protocol: ${flag}`);
  }
  const serverCommand = command.trim().replaceAll(apiKey, '<redacted>')
    .replace(/--api-key-file\s+\S+/g, '--api-key-file <local-api-key-file>');
  if (process.argv.includes('--preflight-only')) {
    console.log(JSON.stringify({ candidate: candidate.id, verified: true, serverCommand }));
    return;
  }
  let peakSampledRssKiB = 0;
  const sampleMemory = () => {
    try {
      const rss = Number(execFileSync('ps', ['-p', pid, '-o', 'rss='], { encoding: 'utf8' }).trim());
      if (Number.isFinite(rss)) peakSampledRssKiB = Math.max(peakSampledRssKiB, rss);
    } catch { /* Process disappearance is also caught by HTTP. */ }
  };
  const report = {
    generatedAt: new Date().toISOString(), candidate, fixtures: expectedFixtureHashes,
    runnerSha256: digest(fs.readFileSync(__filename)), serverCommand,
    contractSha256: digest(fs.readFileSync(path.join(__dirname, 'qualification-contract.cjs'))),
    prompts, schemas, endpoint: endpoint.origin, reportedModelId: ids[0],
    scope: 'Synthetic host-only qualification. Correct schema/source spans do not establish meaning. No personal data, mobile runtime, real-bank coverage or ledger writes.',
    settings: { temperature: 0, seed: 23, maxTokens: 320, reasoning: false, cachePrompt: false, context: 2048, threads: 2, slots: 1 },
    gate: { minimumSupportedExactRate: 0.95, maximumGuardedWrongAccepted: 0, purpose: 'Candidate for larger evaluation only; passing is not production qualification.' },
    completed: false, rows: [],
  };
  fs.mkdirSync(path.dirname(outputPath), { recursive: true });
  const checkpoint = fs.openSync(outputPath + '.jsonl', 'wx', 0o600);
  sampleMemory();
  const memoryTimer = setInterval(sampleMemory, 500);
  let activeCase = null;
  try {
    for (const domain of ['bank', 'ask']) {
      for (const row of fixtureData[domain]) {
        activeCase = { domain, id: row.id };
        const start = performance.now();
        const result = await localFetch('/v1/chat/completions', {
          method: 'POST', body: JSON.stringify({
            messages: [{ role: 'system', content: prompts[domain] }, { role: 'user', content: row.text }],
            temperature: 0, seed: 23, max_tokens: 320, cache_prompt: false,
            chat_template_kwargs: { enable_thinking: false },
            response_format: { type: 'json_schema', json_schema: { name: `wafra_${domain}`, strict: true, schema: schemas[domain] } },
          }),
        });
        const content = result.choices?.[0]?.message?.content ?? '';
        let output = null;
        try { output = JSON.parse(content); } catch { /* Retain invalid output as evidence. */ }
        const validation = validate(domain, row.text, output);
        const compiled = domain === 'ask' && validation.valid ? productionShape(output) : null;
        const observed = { domain, ...row, output, raw: content, validation,
          productionShapeValid: compiled?.valid ?? null, compiledRequest: compiled?.request ?? null,
          exact: isDeepStrictEqual(output, row.expected), elapsedMs: Math.round(performance.now() - start),
          usage: result.usage, timings: result.timings, finishReason: result.choices?.[0]?.finish_reason };
        report.rows.push(observed);
        fs.writeSync(checkpoint, JSON.stringify(observed) + '\n');
        if (report.rows.length % 8 === 0) console.log(`${candidate.id}: ${report.rows.length}/96 cases completed`);
      }
    }
    report.completed = true;
  } catch (error) {
    report.failure = { case: activeCase, message: error.message, http: error.http ?? null };
    process.exitCode = 1;
  } finally {
    clearInterval(memoryTimer); sampleMemory(); fs.closeSync(checkpoint);
    report.peakSampledRssKiB = peakSampledRssKiB;
    report.memoryCaveat = '500 ms sampled process RSS on Mac; not true peak, mobile RAM, or isolated model allocation.';
    report.summary = summarize(report.rows);
    fs.writeFileSync(outputPath, JSON.stringify(report, null, 2) + '\n', { flag: 'wx' });
    console.log(JSON.stringify({ completed: report.completed, peakSampledRssKiB, summary: report.summary }, null, 2));
  }
})().catch(error => { console.error(error.message); process.exitCode = 1; });
