'use strict';
const { test } = require('node:test');
const assert = require('node:assert/strict');
const path = require('node:path');
const { execFileSync } = require('node:child_process');

test('shipping Play query passes lifecycle races and real Billing 8 Purchase projections', { timeout: 180_000 }, () => {
  const output = execFileSync(process.execPath, [path.resolve(__dirname, '../wafra-play-billing-native.cjs')],
    { encoding: 'utf8', timeout: 170_000, maxBuffer: 2_000_000 });
  assert.match(output, /OK \(\d+ tests\)/);
  assert.match(output, /Kotlin bridge Java\/SAM\/cancellation types compiled/);
});
