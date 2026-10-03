'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { createRequire } = require('node:module');
const { DatabaseSync } = require('node:sqlite');
const { webcrypto } = require('node:crypto');
const ts = require('typescript');
const root = path.resolve(__dirname, '../../..');
const serverRequire = createRequire(path.join(root, 'server/package.json'));
const built = name => require(path.join(root, 'scripts/test/build', name));
if (!globalThis.crypto) Object.defineProperty(globalThis, 'crypto', { value: webcrypto });
const modules = new Map();
function source(name) {
  if (modules.has(name)) return modules.get(name);
  const module = { exports: {} };
  modules.set(name, module.exports);
  const input = fs.readFileSync(path.join(root, 'server/src', `${name}.ts`), 'utf8') +
    (name === 'index' ? '\nexports.__statementCoverage = statementCoverage;\n' : '');
  const output = ts.transpileModule(input, {
    compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022, esModuleInterop: true },
  }).outputText;
  Function('require', 'module', 'exports', output)(id => id.startsWith('@/lib/') ? built(id.slice(6)) :
    id.startsWith('./') ? source(id.slice(2)) : serverRequire(id), module, module.exports);
  modules.set(name, module.exports);
  return module.exports;
}
const worker = source('index').default;
const { deviceKeypair, encodeKey, openSealed } = built('relay-crypto.cjs');
function database() {
  const db = new DatabaseSync(':memory:');
  db.exec(fs.readFileSync(path.join(root, 'server/schema.sql'), 'utf8'));
  for (const name of fs.readdirSync(path.join(root, 'server/migrations')).filter(name => name.endsWith('.sql')).sort()) {
    db.exec(fs.readFileSync(path.join(root, 'server/migrations', name), 'utf8'));
  }
  const statement = (sql, params = []) => {
    const run = () => ({ success: true, meta: { changes: Number(db.prepare(sql).run(...params).changes) } });
    return { bind: (...values) => statement(sql, values), first: async () => db.prepare(sql).get(...params) ?? null,
      all: async () => ({ results: db.prepare(sql).all(...params) }), run: async () => run(), runNow: run };
  };
  return { handle: db, prepare: sql => statement(sql), batch: async statements => {
    db.exec('BEGIN IMMEDIATE');
    try { const results = statements.map(statement => statement.runNow()); db.exec('COMMIT'); return results; }
    catch (error) { db.exec('ROLLBACK'); throw error; }
  } };
}
const ctx = { waitUntil: promise => promise.catch(() => {}) };
function call(env, method, endpoint, token, body, headers = {}) {
  return worker.fetch(new Request(`https://relay.test${endpoint}`, { method,
    headers: { ...(token ? { authorization: `Bearer ${token}` } : {}), ...headers },
    ...(body === undefined ? {} : { body }) }), env, ctx);
}
async function pair(env) {
  const keypair = deviceKeypair(webcrypto.getRandomValues(new Uint8Array(32)));
  const response = await call(env, 'POST', '/v1/pair', null,
    JSON.stringify({ publicKey: encodeKey(keypair.publicKey) }), { 'content-type': 'application/json' });
  assert.equal(response.status, 200);
  return { ...await response.json(), keypair };
}
function fill(db, deviceId, count) {
  const insert = db.prepare('INSERT INTO queue (id, device_id, epk, iv, ct, created_at) VALUES (?, ?, ?, ?, ?, unixepoch())');
  for (let i = 0; i < count; i++) insert.run(`filler-${deviceId}-${i}`, deviceId, 'filler', 'filler', 'filler');
}
const csv = 'Date,Description,Debit,Credit\n2026-09-01,ALPHA,100.00,\n2026-09-02,BETA,200.00,\n';
const upload = (env, device, body = csv) => call(env, 'POST', '/v1/import/csv', device.adminToken, body,
  { 'content-type': 'text/csv', 'x-wafra-ledger-currency': 'AED', 'x-wafra-ledger-exponent': '2' });
const interpretedUpload = (env, device, body, order, currency = 'AED') => call(env, 'POST', '/v1/import/csv', device.adminToken, body,
  { 'content-type': 'text/csv', 'x-wafra-ledger-currency': currency, 'x-wafra-ledger-exponent': '2', 'x-wafra-date-order': order });
const realRows = (env, deviceId) => env.DB.handle.prepare("SELECT * FROM queue WHERE device_id = ? AND id NOT LIKE 'filler-%'").all(deviceId);
function pdf(lines) {
  const stream = `BT /F1 12 Tf 50 750 Td ${lines.map((line, i) =>
    `${i ? '0 -20 Td ' : ''}(${line.replace(/([()\\])/g, '\\$1')}) Tj`).join(' ')} ET`;
  const objects = ['<< /Type /Catalog /Pages 2 0 R >>', '<< /Type /Pages /Kids [3 0 R] /Count 1 >>',
    '<< /Type /Page /Parent 2 0 R /MediaBox [0 0 612 792] /Resources << /Font << /F1 4 0 R >> >> /Contents 5 0 R >>',
    '<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>',
    `<< /Length ${Buffer.byteLength(stream)} >>\nstream\n${stream}\nendstream`];
  let text = '%PDF-1.4\n'; const offsets = [0];
  for (const [index, object] of objects.entries()) {
    offsets.push(Buffer.byteLength(text)); text += `${index + 1} 0 obj\n${object}\nendobj\n`;
  }
  const xref = Buffer.byteLength(text);
  text += `xref\n0 ${objects.length + 1}\n0000000000 65535 f \n` +
    offsets.slice(1).map(offset => `${String(offset).padStart(10, '0')} 00000 n \n`).join('') +
    `trailer\n<< /Size ${objects.length + 1} /Root 1 0 R >>\nstartxref\n${xref}\n%%EOF\n`;
  return new Uint8Array(Buffer.from(text));
}
const uploadPdf = (env, device, lines) => call(env, 'POST', '/v1/import/pdf', device.adminToken, pdf(lines),
  { 'content-type': 'application/pdf', 'x-wafra-ledger-currency': 'AED', 'x-wafra-ledger-exponent': '2' });

test('partial queue capacity never reports a complete statement; retries deliver only missing rows', async t => {
  const env = { DB: database() }; t.after(() => env.DB.handle.close());
  const device = await pair(env); fill(env.DB.handle, device.deviceId, 9999);
  const partial = await upload(env, device);
  assert.equal(partial.status, 429);
  const body = await partial.json();
  assert.equal(body.error, 'queue_full');
  assert.equal(body.acceptedRows, 1);
  assert.equal(body.remainingRows, 1);
  assert.equal(body.coverage ?? null, null);
  assert.equal(realRows(env, device.deviceId).length, 1);
  env.DB.handle.prepare("DELETE FROM queue WHERE id LIKE 'filler-%'").run();
  const retried = await upload(env, device);
  assert.equal(retried.status, 202);
  const accepted = await retried.json();
  assert.equal(accepted.alreadyProcessed, false);
  assert.match(accepted.statementImportId, /^[a-f0-9]{32}$/);
  const queued = realRows(env, device.deviceId);
  assert.equal(queued.length, 2);
  const decoded = queued.map(row => openSealed(device.keypair.secretKey, row));
  assert.deepEqual(decoded.map(row => row.amountFils).sort((a, b) => a - b), [10000, 20000]);
  assert.deepEqual(decoded.map(row => [row.statementRowIndex, row.amountFils]).sort((a, b) => a[0] - b[0]),
    [[0, 10000], [1, 20000]]);
  const again = await upload(env, device);
  assert.equal(again.status, 202);
  const replay = await again.json();
  assert.equal(replay.alreadyProcessed, true);
  assert.equal(replay.statementImportId, accepted.statementImportId);
  assert.equal(realRows(env, device.deviceId).length, 2);
});

test('delivery to a peer cannot masquerade as delivery to the importing device', async t => {
  const env = { DB: database() }; t.after(() => env.DB.handle.close());
  const device = await pair(env), peer = await pair(env);
  const vault = env.DB.handle.prepare('SELECT vault_id FROM devices WHERE id = ?').get(device.deviceId).vault_id;
  env.DB.handle.prepare('UPDATE devices SET vault_id = ? WHERE id = ?').run(vault, peer.deviceId);
  fill(env.DB.handle, device.deviceId, 10000);
  const response = await upload(env, device);
  assert.equal(response.status, 429);
  const body = await response.json();
  assert.equal(body.acceptedRows, 0);
  assert.equal(body.remainingRows, 2);
  assert.equal(realRows(env, peer.deviceId).length, 2);
  env.DB.handle.prepare("DELETE FROM queue WHERE id LIKE 'filler-%'").run();
  assert.equal((await upload(env, device)).status, 202);
  assert.equal(realRows(env, device.deviceId).length, 2);
  assert.equal(realRows(env, peer.deviceId).length, 2);
});

async function forwarding(env, device) {
  const response = await call(env, 'POST', '/v1/email-token', device.adminToken);
  assert.equal(response.status, 201);
  return response.json();
}
async function forwardCsv(env, address, contents = csv) {
  const mime = ['From: bank@example.test', `To: ${address}`, 'Message-ID: <route-audit@example.test>',
    'MIME-Version: 1.0', 'Content-Type: multipart/mixed; boundary="audit"', '',
    '--audit', 'Content-Type: text/plain; charset=utf-8', '', 'Attached statement',
    '--audit', 'Content-Type: text/csv; name="statement.csv"',
    'Content-Disposition: attachment; filename="statement.csv"', 'Content-Transfer-Encoding: base64', '',
    Buffer.from(contents).toString('base64'), '--audit--', ''].join('\r\n');
  let rejected = '';
  await worker.email({ to: address, raw: new Response(mime).body, rawSize: Buffer.byteLength(mime),
    headers: new Headers({ 'message-id': '<route-audit@example.test>' }), setReject: reason => { rejected = reason; } }, env, ctx);
  return rejected;
}

test('forwarded attachment reports partial queue delivery and same-message retry completes it', async t => {
  const env = { DB: database(), EMAIL_DOMAIN: 'in.example.test' }; t.after(() => env.DB.handle.close());
  const device = await pair(env), email = await forwarding(env, device);
  fill(env.DB.handle, device.deviceId, 9999);
  assert.match(await forwardCsv(env, email.forwardingAddress), /queue|queued|space/i);
  assert.equal(realRows(env, device.deviceId).length, 1);
  env.DB.handle.prepare("DELETE FROM queue WHERE id LIKE 'filler-%'").run();
  assert.equal(await forwardCsv(env, email.forwardingAddress), '');
  assert.equal(realRows(env, device.deviceId).length, 2);
  assert.deepEqual(realRows(env, device.deviceId).map(row => openSealed(device.keypair.secretKey, row).statementRowIndex).sort(), [0, 1]);
});

test('HTTP email import refuses a success response when its queue is full', async t => {
  const env = { DB: database(), EMAIL_DOMAIN: 'in.example.test' }; t.after(() => env.DB.handle.close());
  const device = await pair(env), email = await forwarding(env, device);
  fill(env.DB.handle, device.deviceId, 10000);
  const response = await call(env, 'POST', '/v1/email/ingest', email.emailToken,
    JSON.stringify({ text: 'Purchase of AED 50.00 at CARREFOUR with Debit Card ending 1234', eventId: 'audit-email-0001' }),
    { 'content-type': 'application/json' });
  assert.equal(response.status, 429);
  assert.equal((await response.json()).error, 'queue_full');
});

test('observed statement ranges distinguish known issuers including Unicode identities', async () => {
  const coverage = source('index').__statementCoverage;
  const row = { date: '2026-09-01', card: { kind: 'credit', last4: '1234' } };
  const first = await coverage([{ ...row, bankHint: 'ADCB' }]);
  const second = await coverage([{ ...row, bankHint: 'HSBC' }]);
  const arabic = await coverage([{ ...row, bankHint: 'بنك الأول' }]);
  const otherArabic = await coverage([{ ...row, bankHint: 'بنك الثاني' }]);
  assert.notEqual(first.sourceKey, second.sourceKey);
  assert.notEqual(arabic.sourceKey, otherArabic.sourceKey);
  assert.ok(first.sourceKey.length <= 80 && arabic.sourceKey.length <= 80);
  assert.match(first.label, /ADCB/);
});

test('a statement due row never stretches the covered transaction range to its due date', async () => {
  const coverage = source('index').__statementCoverage;
  const card = { kind: 'credit', last4: '1234' };
  const result = await coverage([
    { kind: 'transaction', date: '2026-08-27', card },
    { kind: 'transaction', date: '2026-09-20', card },
    { kind: 'cardStatement', date: '2026-10-20', card },
  ]);
  assert.equal(result.startDate, '2026-08-27');
  assert.equal(result.endDate, '2026-09-20');
});

test('forwarded attachment cannot silently skip a conflicting statement currency', async t => {
  const env = { DB: database(), EMAIL_DOMAIN: 'in.example.test' }; t.after(() => env.DB.handle.close());
  const device = await pair(env), email = await forwarding(env, device);
  assert.match(await forwardCsv(env, email.forwardingAddress, `Currency: USD\n${csv}`), /currency|cannot|could not/i);
  assert.equal(realRows(env, device.deviceId).length, 0);
});

test('CSV currency mismatch has a named error before any queue write', async t => {
  const env = { DB: database() }; t.after(() => env.DB.handle.close());
  const device = await pair(env);
  const response = await upload(env, device, `Currency: USD\n${csv}`);
  assert.equal(response.status, 422);
  assert.equal((await response.json()).error, 'statement_currency_mismatch');
  assert.equal(realRows(env, device.deviceId).length, 0);
});

test('PDF import reports partial delivery and retries without duplicating accepted rows', async t => {
  const env = { DB: database() }; t.after(() => env.DB.handle.close()); const device = await pair(env);
  const lines = ['Account number XXXX1234', '2026-09-01 ALPHA 100.00 DR', '2026-09-02 BETA 200.00 DR'];
  fill(env.DB.handle, device.deviceId, 9999);
  const partial = await uploadPdf(env, device, lines);
  assert.equal(partial.status, 429);
  assert.equal((await partial.json()).acceptedRows, 1);
  env.DB.handle.prepare("DELETE FROM queue WHERE id LIKE 'filler-%'").run();
  assert.equal((await uploadPdf(env, device, lines)).status, 202);
  assert.equal(realRows(env, device.deviceId).length, 2);
  assert.deepEqual(realRows(env, device.deviceId).map(row => openSealed(device.keypair.secretKey, row).statementRowIndex).sort(), [0, 1]);
});

test('PDF currency and multiple-account extraction failures retain their named errors', async t => {
  const env = { DB: database() }; t.after(() => env.DB.handle.close()); const device = await pair(env);
  for (const [lines, error] of [
    [['Currency: USD', 'Account number XXXX1234', '2026-09-01 ALPHA 100.00 DR'], 'statement_currency_mismatch'],
    [['Account number XXXX1234', '2026-09-01 ALPHA 100.00 DR',
      'Account number XXXX5678', '2026-09-02 BETA 200.00 DR'], 'multiple_statement_accounts'],
  ]) {
    const response = await uploadPdf(env, device, lines);
    assert.equal(response.status, 422);
    assert.equal((await response.json()).error, error);
  }
  assert.equal(realRows(env, device.deviceId).length, 0);
});

test('an interrupted queue batch keeps durable receipts so retry cannot duplicate its completed rows', async t => {
  const env = { DB: database() }; t.after(() => env.DB.handle.close()); const device = await pair(env);
  const batch = env.DB.batch; let calls = 0;
  env.DB.batch = async statements => {
    if (++calls === 2) throw new Error('interrupted queue write');
    return batch(statements);
  };
  await assert.rejects(upload(env, device), /interrupted queue write/);
  assert.equal(realRows(env, device.deviceId).length, 1);
  env.DB.batch = batch;
  assert.equal((await upload(env, device)).status, 202);
  assert.equal(realRows(env, device.deviceId).length, 2);
});

test('a full peer is reported even when the requesting device received the whole statement', async t => {
  const env = { DB: database() }; t.after(() => env.DB.handle.close());
  const device = await pair(env), peer = await pair(env);
  const vault = env.DB.handle.prepare('SELECT vault_id FROM devices WHERE id = ?').get(device.deviceId).vault_id;
  env.DB.handle.prepare('UPDATE devices SET vault_id = ? WHERE id = ?').run(vault, peer.deviceId);
  fill(env.DB.handle, peer.deviceId, 10000);
  const response = await upload(env, device), body = await response.json();
  assert.equal(response.status, 429);
  assert.equal(body.acceptedRows, 2);
  assert.equal(body.remainingRows, 0);
  assert.equal(body.remainingDeliveries, 2);
  env.DB.handle.prepare("DELETE FROM queue WHERE id LIKE 'filler-%'").run();
  const retry = await upload(env, device);
  assert.equal(retry.status, 202);
  assert.equal((await retry.json()).alreadyProcessed, true, 'the importing device was already complete');
  assert.equal(realRows(env, device.deviceId).length, 2);
  assert.equal(realRows(env, peer.deviceId).length, 2);
});

test('email attachments with rejected transaction rows fail visibly before queuing that attachment', async t => {
  const env = { DB: database(), EMAIL_DOMAIN: 'in.example.test' }; t.after(() => env.DB.handle.close());
  const device = await pair(env), email = await forwarding(env, device);
  assert.match(await forwardCsv(env, email.forwardingAddress, `${csv}2026-09-03,GAMMA,not-money,\n`), /could not import every/i);
  assert.equal(realRows(env, device.deviceId).length, 0);
});

test('same-file date interpretation changes are rejected without replacing or duplicating queued money', async t => {
  const env = { DB: database() }; t.after(() => env.DB.handle.close()); const device = await pair(env);
  const body = 'Date,Description,Debit,Credit\n03/04/2026,ALPHA,100.00,\n';
  assert.equal((await interpretedUpload(env, device, body, 'month-first')).status, 202);
  const changed = await interpretedUpload(env, device, body, 'day-first');
  assert.equal(changed.status, 409);
  assert.equal((await changed.json()).error, 'statement_options_conflict');
  assert.deepEqual(realRows(env, device.deviceId).map(row => openSealed(device.keypair.secretKey, row).date), ['2026-03-04']);
});

test('an ambiguous-date retry cannot shift row indices over prior partial extraction receipts', async t => {
  const env = { DB: database() }; t.after(() => env.DB.handle.close()); const device = await pair(env);
  const body = 'Date,Description,Debit,Credit\n03/04/2026,ALPHA,100.00,\n2026-04-13,BETA,200.00,\n';
  const first = await interpretedUpload(env, device, body, 'unknown', 'USD');
  assert.equal(first.status, 202);
  assert.equal((await first.json()).acceptedRows, 1);
  const retry = await interpretedUpload(env, device, body, 'day-first', 'USD');
  assert.equal(retry.status, 409);
  assert.equal((await retry.json()).error, 'statement_options_conflict');
  assert.deepEqual(realRows(env, device.deviceId).map(row => openSealed(device.keypair.secretKey, row).amountFils), [20000]);
});

test('concurrent interpretations bind exactly one version of a statement', async t => {
  const env = { DB: database() }; t.after(() => env.DB.handle.close()); const device = await pair(env);
  const body = 'Date,Description,Debit,Credit\n03/04/2026,ALPHA,100.00,\n';
  const responses = await Promise.all(['month-first', 'day-first'].map(order => interpretedUpload(env, device, body, order)));
  assert.deepEqual(responses.map(response => response.status).sort(), [202, 409]);
  assert.equal(realRows(env, device.deviceId).length, 1);
});

test('changed ledger currency cannot reuse a bound file interpretation', async t => {
  const env = { DB: database() }; t.after(() => env.DB.handle.close()); const device = await pair(env);
  assert.equal((await interpretedUpload(env, device, csv, 'day-first', 'AED')).status, 202);
  const changed = await interpretedUpload(env, device, csv, 'day-first', 'USD');
  assert.equal(changed.status, 409);
  assert.equal((await changed.json()).error, 'statement_options_conflict');
  assert.ok(realRows(env, device.deviceId).every(row => openSealed(device.keypair.secretKey, row).currency === 'AED'));
});

test('legacy complete replay has no invented binding or newly inferred range', async t => {
  const env = { DB: database() }; t.after(() => env.DB.handle.close()); const device = await pair(env);
  assert.equal((await upload(env, device)).status, 202);
  env.DB.handle.prepare('DELETE FROM statement_import_bindings').run();
  const retry = await upload(env, device), body = await retry.json();
  assert.equal(retry.status, 202);
  assert.equal(body.alreadyProcessed, true);
  assert.equal(body.legacyInterpretation, true);
  assert.equal(body.coverage, null);
  assert.equal(realRows(env, device.deviceId).length, 2);
  assert.equal(env.DB.handle.prepare('SELECT COUNT(*) AS n FROM statement_import_bindings').get().n, 0);
});

test('legacy partial delivery cannot invent missing rows under an unverified interpretation', async t => {
  const env = { DB: database() }; t.after(() => env.DB.handle.close()); const device = await pair(env);
  fill(env.DB.handle, device.deviceId, 9999);
  assert.equal((await upload(env, device)).status, 429);
  env.DB.handle.prepare('DELETE FROM statement_import_bindings').run();
  env.DB.handle.prepare("DELETE FROM queue WHERE id LIKE 'filler-%'").run();
  const retry = await upload(env, device);
  assert.equal(retry.status, 409);
  assert.equal((await retry.json()).error, 'statement_options_conflict');
  assert.equal(realRows(env, device.deviceId).length, 1);
});

test('exact retries renew the opaque binding and device erasure removes it', async t => {
  const env = { DB: database() }; t.after(() => env.DB.handle.close()); const device = await pair(env);
  await upload(env, device);
  const before = env.DB.handle.prepare('SELECT * FROM statement_import_bindings').get();
  assert.ok(!JSON.stringify(before).includes('ALPHA'));
  env.DB.handle.prepare('UPDATE statement_import_bindings SET expires_at = unixepoch() + 2').run();
  assert.equal((await upload(env, device)).status, 202);
  const binding = env.DB.handle.prepare('SELECT * FROM statement_import_bindings').get();
  assert.equal(binding.interpretation_digest, before.interpretation_digest);
  assert.ok(binding.expires_at > Math.floor(Date.now() / 1000) + 72 * 60 * 60 - 5);
  assert.equal((await call(env, 'DELETE', '/v1/device', device.adminToken)).status, 204);
  assert.equal(env.DB.handle.prepare('SELECT COUNT(*) AS n FROM statement_import_bindings').get().n, 0);
});

test('scheduled retention removes expired interpretation bindings', async t => {
  const env = { DB: database() }; t.after(() => env.DB.handle.close()); const device = await pair(env);
  await upload(env, device);
  env.DB.handle.prepare('UPDATE statement_import_bindings SET expires_at = unixepoch() - 1').run();
  await worker.scheduled({}, env, ctx);
  assert.equal(env.DB.handle.prepare('SELECT COUNT(*) AS n FROM statement_import_bindings').get().n, 0);
});

test('row ordinals and file identity survive re-delivery after replay receipts expire', async t => {
  const env = { DB: database() }; t.after(() => env.DB.handle.close()); const device = await pair(env);
  await upload(env, device);
  const identities = () => realRows(env, device.deviceId).map(row => {
    const opened = openSealed(device.keypair.secretKey, row);
    return [opened.statementImportId, opened.statementRowIndex, opened.amountFils];
  }).sort((a, b) => a[1] - b[1]);
  const original = identities();
  assert.deepEqual(original.map(row => row[1]), [0, 1]);
  env.DB.handle.prepare('DELETE FROM queue WHERE device_id = ?').run(device.deviceId);
  env.DB.handle.prepare('UPDATE ingest_receipts SET expires_at = unixepoch() - 1').run();
  assert.equal((await upload(env, device)).status, 202);
  assert.deepEqual(identities(), original);
});
