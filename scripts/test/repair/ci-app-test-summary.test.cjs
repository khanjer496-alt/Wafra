const test = require('node:test');
const assert = require('node:assert/strict');
const { summarize } = require('../../ci/summarize-app-tests.cjs');

test('structured report preserves a failing exit and strips control bytes', () => {
  const result = summarize('ok 1 - fixture\n\u001b[31mnot ok 2 - broken fixture\u001b[0m\n  error: expected true\n\u0007AssertionError: mismatch\n', 1);
  assert.equal(result.passed, false);
  assert.equal(result.exitCode, 1);
  assert.equal(result.failures.length, 3);
  assert.doesNotMatch(JSON.stringify(result), /\\u001b|\\u0007/);
  assert.equal(result.failures[0].text, 'not ok 2 - broken fixture');
});

test('a failing exit with no recognized assertion remains a failure', () => {
  assert.deepEqual(summarize('process ended without an assertion', 137), {
    exitCode: 137, passed: false, logLineCount: 1, failures: [], truncated: false,
  });
});

test('success and bounded failure evidence do not depend on timing', () => {
  assert.equal(summarize('completed', 0).passed, true);
  const result = summarize(Array.from({ length: 101 }, (_, i) => `not ok ${i + 1} - fixture`).join('\n'), 1);
  assert.equal(result.failures.length, 100);
  assert.equal(result.truncated, true);
});

test('C1 controls, including the 8-bit CSI introducer, are removed too', () => {
  const result = summarize('not ok 1 - x\u009b31m y\u0085\u009f', 1);
  assert.equal(result.failures[0].text, 'not ok 1 - x y');
  assert.doesNotMatch(result.failures[0].text, /[\u0080-\u009f]/);
});
