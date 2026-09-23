#!/usr/bin/env node
// Requires pinned local llama-server already running; no remote inference.
const fs = require('node:fs'),
  path = require('node:path');
const root = path.resolve(__dirname, '../..');
const modelPath = process.env.WAFRA_QWEN_MODEL || '/tmp/wafra-local-ai-eval/Qwen3-0.6B-Q8_0.gguf';
const expectedHash = '9465e63a22add5354d9bb4b99e90117043c7124007664907259bd16d043bb031';
const endpoint = 'http://127.0.0.1:18791';
const outputPath = path.resolve(
  process.argv[2] ||
    path.join(
      '/tmp/wafra-local-ai-eval',
      `qwen-probe-${new Date().toISOString().replace(/[:.]/g, '-')}.json`,
    ),
);
async function fetchLocal(route, options = {}) {
  const response = await fetch(endpoint + route, {
    ...options,
    signal: AbortSignal.timeout(30000),
  });
  if (!response.ok) throw Error(`${route}: HTTP ${response.status}: ${await response.text()}`);
  return response.json();
}
async function verifyModelAssociation() {
  if (fs.statSync(modelPath).size !== 639446688) throw Error('Pinned Qwen model size mismatch');
  const hash = require('node:crypto').createHash('sha256');
  for await (const chunk of fs.createReadStream(modelPath)) hash.update(chunk);
  if (hash.digest('hex') !== expectedHash) throw Error('Pinned Qwen model hash mismatch');
  // The endpoint association is a server assertion, not remote attestation.
  // Run a dedicated local server with the documented exact -m path and no alias.
  const models = await fetchLocal('/v1/models');
  const ids = models.data?.map((model) => model.id) || [];
  if (ids.length !== 1 || ![modelPath, path.basename(modelPath)].includes(ids[0])) {
    throw Error(`Local server model does not match verified file: ${JSON.stringify(ids)}`);
  }
  return { endpoint, reportedModelId: ids[0], verifiedModelPath: modelPath };
}
const frozen = JSON.parse(
  fs.readFileSync(path.join(root, 'scripts/test/fixtures/local-ai-held-out.json')),
);
const tools = [
  'spending-total',
  'income-total',
  'top-merchants',
  'top-categories',
  'possible-duplicates',
  'subscriptions',
  'upcoming-payments',
  'data-coverage',
  'abstain',
];
const schema = {
  type: 'object',
  properties: {
    tool: { type: 'string', enum: tools },
    period: { type: 'string' },
    merchant: { type: 'string' },
    withinDays: { type: 'integer' },
    limit: { type: 'integer' },
    excludeRefunds: { type: 'boolean' },
  },
  required: ['tool', 'period', 'merchant', 'withinDays', 'limit', 'excludeRefunds'],
  additionalProperties: false,
};
const instruction =
  'You interpret personal finance questions. Return JSON only. Never execute a payment or give advice. Tools: ' +
  tools.join(', ') +
  '. Today is 2026-09-23. Default period is current. Use period current, YYYY-MM, YYYY, last-week, or unsupported. merchant empty if absent. withinDays defaults 30, limit defaults 5. excludeRefunds defaults false. Unsupported questions or filters => abstain. City filters unsupported. Detect English, Arabic and mixed questions. Do not discard requested constraints. /no_think';
const expectations = frozen.assistant.map(([language, text, expected]) => ({
  language,
  text,
  expected: {
    tool: expected ?? 'abstain',
    period: 'current',
    merchant: '',
    withinDays: 30,
    limit: 5,
    excludeRefunds: false,
  },
}));
// Argument expectations are separately fixed for the instruction-model capability probe.
expectations[14].expected = {
  tool: 'spending-total',
  period: '2024-02',
  merchant: 'IKEA',
  withinDays: 30,
  limit: 5,
  excludeRefunds: true,
};
expectations[15].expected = {
  tool: 'top-merchants',
  period: '2025',
  merchant: '',
  withinDays: 30,
  limit: 3,
  excludeRefunds: false,
};
expectations[16].expected = {
  tool: 'upcoming-payments',
  period: 'current',
  merchant: '',
  withinDays: 2,
  limit: 5,
  excludeRefunds: false,
};
expectations[18].expected = {
  tool: 'spending-total',
  period: 'last-week',
  merchant: 'Amazon',
  withinDays: 30,
  limit: 5,
  excludeRefunds: false,
};
const bankSchema = {
  type: 'object',
  properties: {
    status: { type: 'string', enum: ['posted', 'abstain'] },
    family: {
      type: 'string',
      enum: ['purchase', 'transfer', 'refund', 'cash-withdrawal', 'fee', 'card-payment', 'unknown'],
    },
    amount: { type: 'string' },
    currency: { type: 'string' },
    merchant: { type: 'string' },
  },
  required: ['status', 'family', 'amount', 'currency', 'merchant'],
  additionalProperties: false,
};
const bankInstruction =
  'Extract a completed bank transaction from the message into JSON. Copy the amount digits exactly, currency code and merchant exactly from the message; never calculate or invent. Missing merchant => empty string. Posted families purchase, transfer, refund, cash-withdrawal, fee, card-payment. OTP, declined, pending, conditional offers or ambiguity => status abstain, family unknown, all strings empty. /no_think';
const bankCases = [
  [
    'Card charged AED 85.25 at Cedar Cafe. Transaction completed.',
    {
      status: 'posted',
      family: 'purchase',
      amount: '85.25',
      currency: 'AED',
      merchant: 'Cedar Cafe',
    },
  ],
  [
    'USD 120.00 refunded by North Shop to your card.',
    {
      status: 'posted',
      family: 'refund',
      amount: '120.00',
      currency: 'USD',
      merchant: 'North Shop',
    },
  ],
  [
    'Cash withdrawal completed: SAR 200.00 at ATM.',
    {
      status: 'posted',
      family: 'cash-withdrawal',
      amount: '200.00',
      currency: 'SAR',
      merchant: '',
    },
  ],
  [
    'تم خصم AED 45.50 للشراء لدى متجر النور بنجاح.',
    {
      status: 'posted',
      family: 'purchase',
      amount: '45.50',
      currency: 'AED',
      merchant: 'متجر النور',
    },
  ],
  [
    'تم refund بقيمة AED 32.00 من Cedar Cafe إلى البطاقة.',
    {
      status: 'posted',
      family: 'refund',
      amount: '32.00',
      currency: 'AED',
      merchant: 'Cedar Cafe',
    },
  ],
  ...[
    'OTP 918273 for AED 85.25 purchase at Cedar Cafe.',
    'Purchase AED 85.25 at Cedar Cafe declined.',
    'Pending authorization AED 85.25 at Cedar Cafe.',
    'Spend AED 85.25 at Cedar Cafe to earn cashback.',
    'لم تتم عملية تحويل AED 85.25 بسبب عدم كفاية الرصيد.',
  ].map((text) => [
    text,
    { status: 'abstain', family: 'unknown', amount: '', currency: '', merchant: '' },
  ]),
];
(async () => {
  const serverAssociation = await verifyModelAssociation();
  const rows = [];
  for (const domain of ['assistant', 'bank'])
    for (const item of domain === 'assistant'
      ? expectations
      : bankCases.map(([text, expected]) => ({ text, expected }))) {
      const start = performance.now();
      const data = await fetchLocal('/v1/chat/completions', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          messages: [
            { role: 'system', content: domain === 'assistant' ? instruction : bankInstruction },
            { role: 'user', content: item.text },
          ],
          temperature: 0,
          seed: 23,
          max_tokens: 220,
          chat_template_kwargs: { enable_thinking: false },
          response_format: {
            type: 'json_schema',
            json_schema: {
              name: 'wafra',
              strict: true,
              schema: domain === 'assistant' ? schema : bankSchema,
            },
          },
        }),
      });
      let output;
      try {
        output = JSON.parse(data.choices[0].message.content);
      } catch {
        output = null;
      }
      const correct = !!output && Object.entries(item.expected).every(([k, v]) => output[k] === v);
      rows.push({
        domain,
        ...item,
        output,
        correct,
        ms: Math.round(performance.now() - start),
        usage: data.usage,
        finishReason: data.choices[0].finish_reason,
      });
    }
  const summary = {};
  for (const domain of ['assistant', 'bank']) {
    const a = rows.filter((r) => r.domain === domain);
    summary[domain] = {
      cases: a.length,
      exactCorrect: a.filter((r) => r.correct).length,
      invalidJson: a.filter((r) => !r.output).length,
      falseAccepts: a.filter(
        (r) =>
          (r.expected.tool === 'abstain' || r.expected.status === 'abstain') &&
          (domain === 'assistant' ? r.output?.tool !== 'abstain' : r.output?.status !== 'abstain'),
      ).length,
      totalMs: a.reduce((s, r) => s + r.ms, 0),
    };
  }
  for (const domain of ['assistant', 'bank']) {
    const a = rows.filter((r) => r.domain === domain),
      times = a.map((r) => r.ms).sort((a, b) => a - b);
    summary[domain].primaryLabelCorrect = a.filter((r) =>
      domain === 'assistant'
        ? r.output?.tool === r.expected.tool
        : r.output?.status === r.expected.status && r.output?.family === r.expected.family,
    ).length;
    summary[domain].p50Ms = times[Math.ceil(times.length * 0.5) - 1];
    summary[domain].p95Ms = times[Math.ceil(times.length * 0.95) - 1];
  }
  const report = {
    generatedAt: new Date().toISOString(),
    model: {
      repo: 'Qwen/Qwen3-0.6B-GGUF',
      revision: '23749fefcc72300e3a2ad315e1317431b06b590a',
      file: 'Qwen3-0.6B-Q8_0.gguf',
      bytes: 639446688,
      sha256: '9465e63a22add5354d9bb4b99e90117043c7124007664907259bd16d043bb031',
    },
    runtime:
      'llama.cpp 10360 (48d22e295), macOS arm64, localhost only, reasoning off, temperature 0, JSON schema, context 2048',
    scope:
      'Synthetic host feasibility probe, not production native integration or bank coverage proof. Frozen E5 assistant texts reused; argument labels fixed before inference.',
    serverAssociation,
    summary,
    rows,
  };
  fs.mkdirSync(path.dirname(outputPath), { recursive: true });
  fs.writeFileSync(outputPath, JSON.stringify(report, null, 2) + '\n', { flag: 'wx' });
  console.log(JSON.stringify({ outputPath, summary }, null, 2));
})().catch((e) => {
  console.error(e);
  process.exitCode = 1;
});
