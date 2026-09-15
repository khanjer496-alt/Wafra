'use strict';
const assert = require('node:assert/strict');
const path = require('node:path');
const { test } = require('node:test');
const load = require('./load-typescript.cjs');

const root = path.resolve(__dirname, '../../..');

function state(privateMode = false) {
  return {
    privateMode,
    language: 'en',
    accounts: [
      { id: 'a', name: 'ADCB Credit Card ·2518', kind: 'card', bankName: 'ADCB', last4: '2518' },
      { id: 'b', name: 'FAB Credit Card ·3749', kind: 'card', bankName: 'FAB', last4: '3749' },
    ],
    bills: [{ id: 'bill', title: 'Etisalat Home', category: 'telecom', amountFils: 1, dueDay: 1, paidMonths: [] }],
    transactions: [{ id: 'tx', title: 'Carrefour', amountFils: 1, type: 'expense', category: 'groceries', accountId: 'a', date: '2026-09-01' }],
  };
}

function moduleWithFetch(fetch) {
  return load(path.join(root, 'src/lib/assistant-language.ts'), {
    'expo/fetch': { fetch },
  }, { process, URL, AbortController, Response });
}

test('semantic language request redacts local financial identities before transport', async () => {
  const calls = [];
  const mod = moduleWithFetch(async (_url, init) => {
    const body = JSON.parse(init.body);
    calls.push(body);
    const token = body.question.match(/__WAFRA_ACCOUNT_\d+__/)?.[0];
    return new Response(JSON.stringify({
      supported: true,
      confidence: 'high',
      canonicalQuestion: `did i settle ${token} after __WAFRA_MERCHANT_7__?`,
    }), { status: 200, headers: { 'content-type': 'application/json' } });
  });
  const previous = process.env.EXPO_PUBLIC_WAFRA_RELAY_URL;
  process.env.EXPO_PUBLIC_WAFRA_RELAY_URL = 'https://relay.example';
  try {
    const redacted = mod.redactAssistantQuestion(state(), 'did u settle ADCB Credit Card ·2518 after Carrefour?');
    assert.ok(redacted);
    assert.equal(redacted.question.includes('ADCB'), false);
    assert.equal(redacted.question.includes('2518'), false);
    assert.equal(redacted.question.includes('Carrefour'), false);

    // Use the actual stable merchant token rather than assuming its index.
    const merchantToken = redacted.matchedTokens.find(token => token.includes('MERCHANT'));
    const accountToken = redacted.matchedTokens.find(token => token.includes('ACCOUNT'));
    assert.ok(merchantToken && accountToken);
    calls.length = 0;
    const echo = moduleWithFetch(async (_url, init) => {
      const body = JSON.parse(init.body);
      calls.push(body);
      return new Response(JSON.stringify({ supported: true, confidence: 'high',
        canonicalQuestion: `did i settle ${accountToken} after ${merchantToken}?` }), { status: 200 });
    });
    const result = await echo.interpretAssistantLanguage(
      state(), 'did u settle ADCB Credit Card ·2518 after Carrefour?', { tool: 'top-accounts', period: { mode: 'month', key: '2026-09' }, accountKind: 'card' },
    );
    assert.equal(result, 'did i settle ADCB Credit Card ·2518 after Carrefour?');
    const wire = JSON.stringify(calls[0]);
    for (const secret of ['ADCB', '2518', 'Carrefour', 'FAB', '3749', 'Etisalat Home']) {
      assert.equal(wire.includes(secret), false, `${secret} must remain local`);
    }
    assert.deepEqual(calls[0].context, { previousTool: 'top-accounts', previousSubject: 'card', language: 'en' });
  } finally {
    if (previous === undefined) delete process.env.EXPO_PUBLIC_WAFRA_RELAY_URL;
    else process.env.EXPO_PUBLIC_WAFRA_RELAY_URL = previous;
  }
});

test('semantic language response cannot invent local entities or numbers', async () => {
  const previous = process.env.EXPO_PUBLIC_WAFRA_RELAY_URL;
  process.env.EXPO_PUBLIC_WAFRA_RELAY_URL = 'https://relay.example';
  try {
    const inventedBank = moduleWithFetch(async () => new Response(JSON.stringify({
      supported: true, confidence: 'high', canonicalQuestion: 'did i settle FAB card?',
    }), { status: 200 }));
    assert.equal(await inventedBank.interpretAssistantLanguage(state(), 'did i settle this card?', null), null);

    const inventedDate = moduleWithFetch(async () => new Response(JSON.stringify({
      supported: true, confidence: 'high', canonicalQuestion: 'how much did i spend in 2026?',
    }), { status: 200 }));
    assert.equal(await inventedDate.interpretAssistantLanguage(state(), 'how much money went out?', null), null);
  } finally {
    if (previous === undefined) delete process.env.EXPO_PUBLIC_WAFRA_RELAY_URL;
    else process.env.EXPO_PUBLIC_WAFRA_RELAY_URL = previous;
  }
});

test('Private Mode never calls the semantic language endpoint', async () => {
  let calls = 0;
  const mod = moduleWithFetch(async () => { calls += 1; return new Response('{}', { status: 200 }); });
  const previous = process.env.EXPO_PUBLIC_WAFRA_RELAY_URL;
  process.env.EXPO_PUBLIC_WAFRA_RELAY_URL = 'https://relay.example';
  try {
    assert.equal(await mod.interpretAssistantLanguage(state(true), 'what did i spend?', null), null);
    assert.equal(calls, 0);
  } finally {
    if (previous === undefined) delete process.env.EXPO_PUBLIC_WAFRA_RELAY_URL;
    else process.env.EXPO_PUBLIC_WAFRA_RELAY_URL = previous;
  }
});
