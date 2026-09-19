'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const path = require('node:path');
const loadTypescript = require('./load-typescript.cjs');

function harness(fetch) {
  const timers = new Map();
  let nextTimer = 0;
  let installed;
  const transport = loadTypescript(path.resolve(__dirname, '../../../src/lib/feedback-transport.ts'), {
    '@/lib/feedback': { setFeedbackTransport: fn => { installed = fn; } },
    '@/lib/feedback-wire': {
      FEEDBACK_DIAGNOSTIC_MAX_BYTES: 24000,
      serializeFeedbackWire: () => ({ body: '{}', bodyBytes: 2, diagnosticBytes: 0 }),
    },
    '@/lib/relay': { DEFAULT_RELAY_URL: 'https://relay.invalid' },
  }, {
    fetch, TextEncoder, AbortController,
    setTimeout: (fn, ms) => { const id = ++nextTimer; timers.set(id, { fn, ms }); return id; },
    clearTimeout: id => timers.delete(id),
  });
  transport.installFeedbackTransport();
  return {
    timers,
    send: {
      feedback: () => installed({}),
      research: () => transport.submitParserResearchFeedback({ diagnostic: {} }),
      diagnostic: () => transport.submitTesterDiagnostics({ diagnostic: {} }),
    },
    expire() {
      assert.equal(timers.size, 1, 'one active deadline per upload');
      const timer = [...timers.values()][0];
      assert.equal(timer.ms, 15000);
      timer.fn();
    },
  };
}

for (const kind of ['feedback', 'research', 'diagnostic']) {
  for (const stall of ['headers', 'body']) {
    test(`${kind}: a stalled ${stall} times out, aborts and clears its timer`, async () => {
      let signal;
      let readingBody = false;
      const h = harness(async (_url, options) => {
        signal = options.signal;
        // Deliberately ignore abort: the deadline must still settle the UI.
        if (stall === 'headers') return new Promise(() => {});
        return { ok: true, status: 202, json: () => {
          readingBody = true;
          return new Promise(() => {});
        } };
      });
      const pending = h.send[kind]();
      const rejected = assert.rejects(pending, error => error.code === 'network');
      for (let i = 0; i < 10; i++) await Promise.resolve();
      if (stall === 'body') assert.equal(readingBody, true);
      h.expire();
      await rejected;
      assert.equal(signal.aborted, true);
      assert.equal(h.timers.size, 0);
    });
  }

  test(`${kind}: success preserves receipt semantics and releases its deadline`, async () => {
    let signal;
    const h = harness(async (_url, options) => {
      signal = options.signal;
      return { ok: true, status: 202, json: async () => ({ id: 'report-1', dispatched: true }) };
    });
    const receipt = await h.send[kind]();
    assert.equal(receipt.id, 'report-1');
    assert.equal(receipt.dispatched, kind !== 'diagnostic');
    assert.equal(h.timers.size, 0);
    assert.equal(signal?.aborted, false);
  });

  for (const status of [429, 500]) {
    test(`${kind}: stalled ${status} error body preserves the known HTTP refusal`, async () => {
      let signal;
      let readingBody = false;
      const h = harness(async (_url, options) => {
        signal = options.signal;
        return { ok: false, status, json: () => {
          readingBody = true;
          return new Promise(() => {});
        } };
      });
      const pending = h.send[kind]();
      const rejected = assert.rejects(pending, error => error.code === null && error.status === status);
      for (let i = 0; i < 10; i++) await Promise.resolve();
      assert.equal(readingBody, true);
      h.expire();
      await rejected;
      assert.equal(signal.aborted, true);
      assert.equal(h.timers.size, 0);
    });
  }

  for (const failure of ['offline', 'http', 'invalid-json', 'no-id']) {
    test(`${kind}: ${failure} preserves its error and releases its deadline`, async () => {
      const h = harness(async () => {
        if (failure === 'offline') throw new Error('offline');
        return { ok: failure !== 'http', status: failure === 'http' ? 429 : 202, json: async () => {
          if (failure === 'invalid-json') throw new SyntaxError('invalid JSON');
          return failure === 'http' ? { error: 'rate_limited' } : null;
        } };
      });
      const code = { offline: 'network', http: 'rate_limited', 'invalid-json': 'bad_response', 'no-id': 'no_id' }[failure];
      await assert.rejects(h.send[kind](), error => error.code === code &&
        (failure !== 'http' || error.status === 429));
      assert.equal(h.timers.size, 0);
    });
  }
}
