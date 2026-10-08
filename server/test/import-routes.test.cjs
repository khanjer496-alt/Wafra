// /v1/import/* through the real Worker.
//
// The handler is server/src/index.ts bundled by esbuild (see package.json),
// driven with real Requests against a real SQLite database built from
// schema.sql and every migration — D1 IS SQLite, so the adapter below only
// renames methods. What this file owns, and scripts/test/worker.test.js does
// not yet: the statement budget's refunds and abuse ceilings, the base64
// password header, the named PDF failure codes, and .xlsx through the CSV
// route. Sealed rows are opened with WebCrypto exactly as crypto.ts seals
// them, so "the same rows as the CSV" is asserted on what a phone receives.
const fs = require('node:fs');
const path = require('node:path');
const { webcrypto } = require('node:crypto');
const { DatabaseSync } = require('node:sqlite');
const { buildXlsx, textPdf } = require('./fixtures.cjs');

globalThis.crypto ??= webcrypto;
const worker = require('../.test-build/worker.cjs').default;

let passed = 0;
let failed = 0;
function ok(name, condition, detail = '') {
  if (condition) {
    passed += 1;
    console.log(`✓ ${name}`);
  } else {
    failed += 1;
    console.log(`✗ ${name}${detail ? ` · ${detail}` : ''}`);
  }
}

const serverRoot = path.join(__dirname, '..');

function makeDb() {
  const db = new DatabaseSync(':memory:');
  db.exec(fs.readFileSync(path.join(serverRoot, 'schema.sql'), 'utf8'));
  const migrations = path.join(serverRoot, 'migrations');
  for (const name of fs.readdirSync(migrations).filter((file) => file.endsWith('.sql')).sort()) {
    db.exec(fs.readFileSync(path.join(migrations, name), 'utf8'));
  }
  // Test-only seam: runs after a statement executes, with its SQL and params.
  const hooks = { after: null };
  const statement = (sql, params = []) => ({
    bind: (...values) => statement(sql, values),
    first: async () => {
      const row = db.prepare(sql).get(...params) ?? null;
      if (hooks.after) await hooks.after(sql, params);
      return row;
    },
    all: async () => ({ results: db.prepare(sql).all(...params) }),
    run: async () => {
      const result = db.prepare(sql).run(...params);
      if (hooks.after) await hooks.after(sql, params);
      return { success: true, meta: { changes: Number(result.changes) } };
    },
  });
  return {
    handle: db,
    hooks,
    prepare: (sql) => statement(sql),
    batch: async (statements) => {
      db.exec('BEGIN IMMEDIATE');
      try {
        const results = [];
        for (const s of statements) results.push(await s.run());
        db.exec('COMMIT');
        return results;
      } catch (error) {
        db.exec('ROLLBACK');
        throw error;
      }
    },
  };
}

const usage = (env, actor, scope) => env.DB.handle.prepare(
  'SELECT usage_count FROM cost_limits WHERE actor_id = ? AND scope = ?',
).get(actor, scope)?.usage_count ?? 0;
const windowStart = () => Math.floor(Date.now() / 3_600_000) * 3_600;
const preset = (env, actor, scope, count, start = windowStart()) => env.DB.handle.prepare(
  `INSERT INTO cost_limits (actor_id, scope, window_start, usage_count) VALUES (?, ?, ?, ?)
   ON CONFLICT(actor_id, scope) DO UPDATE SET window_start = excluded.window_start, usage_count = excluded.usage_count`,
).run(actor, scope, start, count);

function call(env, method, pathname, { token, body, headers = {} } = {}) {
  const init = { method, headers: { ...headers } };
  if (body !== undefined) {
    init.body = typeof body === 'string' || body instanceof Uint8Array ? body : JSON.stringify(body);
    init.headers['content-type'] ??= 'application/json';
  }
  if (token) init.headers.authorization = `Bearer ${token}`;
  return worker.fetch(new Request(`https://relay.test${pathname}`, init), env);
}

const b64 = (bytes) => Buffer.from(bytes).toString('base64');

async function pair(env) {
  const keys = await webcrypto.subtle.generateKey({ name: 'X25519' }, true, ['deriveBits']);
  const publicKey = b64(await webcrypto.subtle.exportKey('raw', keys.publicKey));
  const res = await call(env, 'POST', '/v1/pair', { body: { publicKey } });
  return { keys, ...(await res.json()) };
}

async function openSealed(privateKey, item) {
  const epkRaw = Buffer.from(item.epk, 'base64');
  const epk = await webcrypto.subtle.importKey('raw', epkRaw, { name: 'X25519' }, false, []);
  const shared = await webcrypto.subtle.deriveBits({ name: 'X25519', public: epk }, privateKey, 256);
  const ikm = await webcrypto.subtle.importKey('raw', shared, 'HKDF', false, ['deriveKey']);
  const aes = await webcrypto.subtle.deriveKey(
    { name: 'HKDF', hash: 'SHA-256', salt: epkRaw, info: new TextEncoder().encode('wafra/v1/seal') },
    ikm, { name: 'AES-GCM', length: 256 }, false, ['decrypt'],
  );
  const plain = await webcrypto.subtle.decrypt(
    { name: 'AES-GCM', iv: Buffer.from(item.iv, 'base64') }, aes, Buffer.from(item.ct, 'base64'));
  return JSON.parse(new TextDecoder().decode(plain));
}

async function syncedRows(env, device) {
  const res = await call(env, 'GET', '/v1/sync', { token: device.syncToken });
  const { items } = await res.json();
  return Promise.all(items.map((item) => openSealed(device.keys.privateKey, item)));
}

const XLSX = 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet';
/** What a current app build sends; shipped builds send nothing. */
const FEATURES = { 'x-wafra-import-features': 'xlsx, pdf-error-detail' };
const LINE = ['2026-01-03 SALIK TOLL GATE 4.00 DR'];
const pdfHeaders = (extra = {}) => ({ 'content-type': 'application/pdf', ...extra });
const uploadPdf = (env, device, body, headers) =>
  call(env, 'POST', '/v1/import/pdf', { token: device.adminToken, headers: pdfHeaders(headers), body });
const passwordB64 = (text) => b64(Buffer.from(text, 'utf8'));

(async () => {
  /* ─────────────────────────── capabilities ─────────────────────────── */
  {
    const env = { DB: makeDb() };
    const me = await pair(env);
    const capabilities = async (headers) =>
      (await call(env, 'GET', '/v1/import/capabilities', { token: me.adminToken, headers })).json();
    const caps = await capabilities(FEATURES);
    ok('capabilities advertise the base64 PDF password header',
      JSON.stringify(caps.pdf.passwordEncoding) === '["b64"]' && caps.pdf.maxPasswordBytes === 256);
    ok('capabilities list CSV, TSV and .xlsx on the CSV route',
      ['text/csv', 'text/tab-separated-values', XLSX].every((type) => caps.csv.accepts.includes(type)));
    ok('capabilities give per-type byte ceilings and keep the text ceiling as maxBytes',
      caps.csv.maxBytes === 1024 * 1024 && caps.csv.maxBytesByType[XLSX] === 2 * 1024 * 1024 &&
        caps.csv.maxBytesByType['text/csv'] === 1024 * 1024);
    ok('PDF and CSV maxRows report the one Worker row ceiling',
      caps.pdf.maxRows === caps.csv.maxRows && caps.csv.maxRows === 200);

    const shipped = await capabilities({});
    ok('a shipped build (no feature header) is never offered .xlsx',
      !shipped.csv.accepts.includes(XLSX) && !(XLSX in shipped.csv.maxBytesByType) &&
        JSON.stringify(shipped.csv.accepts) === '["text/csv","application/csv","text/tab-separated-values"]' &&
        !/xlsx/i.test(shipped.csv.note));
    const pdfOnly = await capabilities({ 'x-wafra-import-features': 'pdf-error-detail' });
    const mixedCase = await capabilities({ 'x-wafra-import-features': ' future-thing ,XLSX' });
    const overlong = await capabilities({ 'x-wafra-import-features': `xlsx,${'x'.repeat(200)}` });
    ok('the feature header is per token, case-insensitive, ignores unknown tokens and an overlong value',
      !pdfOnly.csv.accepts.includes(XLSX) && mixedCase.csv.accepts.includes(XLSX) && !overlong.csv.accepts.includes(XLSX));
  }

  /* ─────────────────── statement budget: refunds ─────────────────── */
  {
    const env = { DB: makeDb() };
    const me = await pair(env);
    const locked = () => textPdf(LINE, { userPassword: Buffer.from('secret') });

    const prompt = await uploadPdf(env, me, locked());
    ok('a locked PDF without a password answers pdf_password_required',
      prompt.status === 422 && (await prompt.json()).error === 'pdf_password_required');
    ok('…and spends no import unit, but counts as an attempt and against the global backstop',
      usage(env, me.deviceId, 'statement_requests') === 0 && usage(env, me.deviceId, 'statement_attempts') === 1 &&
        usage(env, 'global', 'statement_requests') === 1 && usage(env, me.deviceId, 'pdf_password_attempts') === 0);

    const wrong = await uploadPdf(env, me, locked(), { 'x-wafra-pdf-password': 'guess' });
    const wrongB64 = await uploadPdf(env, me, locked(), { 'x-wafra-pdf-password-b64': passwordB64('guess2') });
    ok('wrong passwords answer pdf_password_incorrect without spending import units',
      wrong.status === 422 && (await wrong.json()).error === 'pdf_password_incorrect' &&
        wrongB64.status === 422 && (await wrongB64.json()).error === 'pdf_password_incorrect' &&
        usage(env, me.deviceId, 'statement_requests') === 0 && usage(env, me.deviceId, 'pdf_password_attempts') === 2);

    const right = await uploadPdf(env, me, locked(), { 'x-wafra-pdf-password-b64': passwordB64('secret') });
    const rightBody = await right.json();
    ok('the right password imports and spends exactly one unit',
      right.status === 202 && rightBody.acceptedRows === 1 && rightBody.alreadyProcessed === false &&
        usage(env, me.deviceId, 'statement_requests') === 1, JSON.stringify(rightBody));

    const replay = await uploadPdf(env, me, locked(), { 'x-wafra-pdf-password-b64': passwordB64('secret') });
    const replayBody = await replay.json();
    ok('re-uploading the processed file says alreadyProcessed and hands its unit back',
      replay.status === 202 && replayBody.alreadyProcessed === true && usage(env, me.deviceId, 'statement_requests') === 1,
      JSON.stringify({ replayBody, used: usage(env, me.deviceId, 'statement_requests') }));

    const csv = 'Date,Description,Debit,Credit\n01/07/2026,Taxi,20.00,';
    const firstCsv = await call(env, 'POST', '/v1/import/csv', { token: me.adminToken, headers: { 'content-type': 'text/csv' }, body: csv });
    const againCsv = await call(env, 'POST', '/v1/import/csv', { token: me.adminToken, headers: { 'content-type': 'text/csv' }, body: csv });
    ok('a CSV replay is refunded too',
      firstCsv.status === 202 && (await firstCsv.json()).alreadyProcessed === false &&
        againCsv.status === 202 && (await againCsv.json()).alreadyProcessed === true &&
        usage(env, me.deviceId, 'statement_requests') === 2);
    const attempts = usage(env, me.deviceId, 'statement_attempts');
    ok('every parse still counts as an attempt and against the global backstop',
      attempts === 7 && usage(env, 'global', 'statement_requests') === 7, String(attempts));
  }

  /* ─────────────────── statement budget: ceilings ─────────────────── */
  {
    const env = { DB: makeDb() };
    const me = await pair(env);
    preset(env, me.deviceId, 'statement_requests', 12);
    const exhausted = await uploadPdf(env, me, textPdf(LINE));
    ok('an exhausted import budget refuses before writing any other counter',
      exhausted.status === 429 && usage(env, me.deviceId, 'statement_attempts') === 0 &&
        usage(env, 'global', 'statement_requests') === 0 && usage(env, me.deviceId, 'statement_requests') === 12);
  }
  {
    const env = { DB: makeDb() };
    const me = await pair(env);
    preset(env, me.deviceId, 'pdf_password_attempts', 20);
    const locked = textPdf(LINE, { userPassword: Buffer.from('secret') });
    const guess = await uploadPdf(env, me, locked, { 'x-wafra-pdf-password-b64': passwordB64('secret') });
    ok('the 21st password attempt in an hour is rate_limited, even with the right password',
      guess.status === 429 && (await guess.json()).error === 'rate_limited');
    ok('…and its import unit is handed back',
      usage(env, me.deviceId, 'statement_requests') === 0 && usage(env, 'global', 'statement_requests') === 0);
    const noPassword = await uploadPdf(env, me, textPdf(LINE));
    ok('an upload without a password is not held by the password ceiling',
      noPassword.status === 202 && usage(env, me.deviceId, 'statement_requests') === 1);
  }
  {
    const env = { DB: makeDb() };
    const me = await pair(env);
    preset(env, me.deviceId, 'statement_attempts', 48);
    const blocked = await call(env, 'POST', '/v1/import/csv', {
      token: me.adminToken, headers: { 'content-type': 'text/csv' }, body: 'Date,Description,Debit,Credit\n01/07/2026,Taxi,20.00,',
    });
    ok('the per-device attempt ceiling bounds refunded outcomes and hands the unit back',
      blocked.status === 429 && usage(env, me.deviceId, 'statement_requests') === 0 &&
        usage(env, 'global', 'statement_requests') === 0);
  }
  {
    const env = { DB: makeDb() };
    const me = await pair(env);
    preset(env, 'global', 'statement_requests', 1000);
    const blocked = await uploadPdf(env, me, textPdf(LINE));
    ok('the global backstop still refuses, and the device unit is handed back',
      blocked.status === 429 && usage(env, me.deviceId, 'statement_requests') === 0 &&
        usage(env, me.deviceId, 'statement_attempts') === 1);
  }
  {
    // A refund lands only in the window it was charged to. Simulate the hour
    // rolling over (and another request charging the new hour) between this
    // request's reservation and its refund.
    const env = { DB: makeDb() };
    const me = await pair(env);
    const next = windowStart() + 3_600;
    env.DB.hooks.after = async (sql, params) => {
      if (/INSERT INTO cost_limits/.test(sql) && params[0] === me.deviceId && params[1] === 'statement_requests') {
        env.DB.hooks.after = null;
        preset(env, me.deviceId, 'statement_requests', 1, next);
      }
    };
    const prompt = await uploadPdf(env, me, textPdf(LINE, { userPassword: Buffer.from('secret') }));
    const row = env.DB.handle.prepare(
      "SELECT window_start, usage_count FROM cost_limits WHERE actor_id = ? AND scope = 'statement_requests'",
    ).get(me.deviceId);
    ok('a refund never decrements a newer hour window',
      prompt.status === 422 && row.window_start === next && row.usage_count === 1, JSON.stringify(row));
  }

  /* ──────────────────────── password transport ──────────────────────── */
  {
    const env = { DB: makeDb() };
    const me = await pair(env);
    const invalid = async (name, header) => {
      const before = usage(env, me.deviceId, 'statement_attempts');
      const res = await uploadPdf(env, me, textPdf(LINE), { 'x-wafra-pdf-password-b64': header });
      const body = await res.json();
      ok(`pdf_password_invalid (400, no budget): ${name}`,
        res.status === 400 && body.error === 'pdf_password_invalid' && usage(env, me.deviceId, 'statement_attempts') === before,
        JSON.stringify({ status: res.status, body }));
    };
    await invalid('not base64', '@@@@');
    await invalid('non-canonical padding bits', 'QR==');
    await invalid('missing padding', 'QQ');
    await invalid('not UTF-8', b64(Buffer.from([0xff, 0xfe])));
    await invalid('a line feed', passwordB64('pass\nword'));
    await invalid('a tab', passwordB64('pass\tword'));
    await invalid('a NUL', passwordB64('pass\0word'));
    await invalid('257 UTF-8 bytes', passwordB64('a'.repeat(257)));
    await invalid('129 Arabic letters (258 bytes)', passwordB64('ب'.repeat(129)));

    const longest = await uploadPdf(env, me, textPdf(LINE, { userPassword: Buffer.from('ب'.repeat(128), 'utf8') }),
      { 'x-wafra-pdf-password-b64': passwordB64('ب'.repeat(128)) });
    ok('a 256-byte Arabic password is accepted and opens its PDF', longest.status === 202, String(longest.status));

    const arabic = 'كلمة سر';
    const arabicPdf = () => textPdf(LINE, { userPassword: Buffer.from(arabic, 'utf8') });
    const arabicOk = await uploadPdf(env, me, arabicPdf(), { 'x-wafra-pdf-password-b64': passwordB64(arabic) });
    ok('an Arabic password travels in base64 and opens the statement', arabicOk.status === 202, String(arabicOk.status));

    const spaced = () => textPdf(['2026-01-04 SALIK TOLL GATE 8.00 DR'], { userPassword: Buffer.from('  pass word  ') });
    const legacySpaced = await uploadPdf(env, me, spaced(), { 'x-wafra-pdf-password': '  pass word  ' });
    const b64Spaced = await uploadPdf(env, me, spaced(), { 'x-wafra-pdf-password-b64': passwordB64('  pass word  ') });
    ok('base64 preserves leading/trailing spaces the legacy header loses',
      legacySpaced.status === 422 && (await legacySpaced.json()).error === 'pdf_password_incorrect' &&
        b64Spaced.status === 202);

    const both = await uploadPdf(env, me, textPdf(LINE, { userPassword: Buffer.from('right') }), {
      'x-wafra-pdf-password': 'right', 'x-wafra-pdf-password-b64': passwordB64('wrong'),
    });
    ok('the base64 header takes precedence over the legacy one',
      both.status === 422 && (await both.json()).error === 'pdf_password_incorrect');

    const legacy = await uploadPdf(env, me, textPdf(['2026-01-05 SALIK TOLL GATE 12.00 DR'], { userPassword: Buffer.from('legacy') }),
      { 'x-wafra-pdf-password': 'legacy' });
    const legacyTooLong = await uploadPdf(env, me, textPdf(LINE, { userPassword: Buffer.from('legacy') }),
      { 'x-wafra-pdf-password': 'x'.repeat(129) });
    ok('the legacy header keeps working, and still drops an unusable value as password_required',
      legacy.status === 202 && legacyTooLong.status === 422 &&
        (await legacyTooLong.json()).error === 'pdf_password_required');
  }

  /* ───────────────────────── PDF failure codes ───────────────────────── */
  {
    const env = { DB: makeDb() };
    const me = await pair(env);
    const code = async (bytes, headers = FEATURES) => {
      const res = await uploadPdf(env, me, bytes, headers);
      return `${res.status} ${(await res.json()).error}`;
    };
    const good = textPdf(LINE);
    ok('a truncated PDF is 422 pdf_damaged', (await code(good.slice(0, Math.floor(good.length / 2)))) === '422 pdf_damaged');
    ok('a certificate-encrypted PDF is 422 pdf_encryption_unsupported',
      (await code(textPdf(LINE, { encrypt: '<< /Filter /Adobe.PubSec /V 4 /R 4 >>' }))) === '422 pdf_encryption_unsupported');
    ok('a PDF without a text layer is 422 unreadable_pdf', (await code(textPdf([]))) === '422 unreadable_pdf');
    ok('a text PDF with no statement rows is still unsupported_statement_format',
      (await code(textPdf(['Dear customer, thank you']))) === '422 unsupported_statement_format');
    ok('failed parses that are not password prompts keep spending the import unit',
      usage(env, me.deviceId, 'statement_requests') === 4);

    // A shipped build sends no feature header and gets exactly the codes it
    // already knows.
    ok('without pdf-error-detail a truncated PDF is still 422 unreadable_pdf',
      (await code(good.slice(0, Math.floor(good.length / 2)), {})) === '422 unreadable_pdf');
    ok('without pdf-error-detail certificate encryption is still 422 unreadable_pdf',
      (await code(textPdf(LINE, { encrypt: '<< /Filter /Adobe.PubSec /V 4 /R 4 >>' }), {})) === '422 unreadable_pdf');
    ok('without pdf-error-detail a PDF with no text keeps unsupported_statement_format',
      (await code(textPdf([]), { 'x-wafra-import-features': 'xlsx' })) === '422 unsupported_statement_format');
  }

  /* ─────────────────────────── .xlsx on /csv ─────────────────────────── */
  {
    const csv = [
      'Date,Description,Debit,Credit',
      '2026-07-01,مطعم البيك,1234.50,',
      '2026-07-02,Salary July,,18500.00',
      '2026-07-03,Refund,-20.25,',
    ].join('\n');
    const xlsx = buildXlsx([
      ['Date', 'Description', 'Debit', 'Credit'],
      [{ n: '46204', style: 'date' }, 'مطعم البيك', { n: '1234.5', style: 'money' }, null],
      [{ n: '46205', style: 'customDate' }, { inline: ['Salary ', 'July'] }, null, { n: '18500' }],
      [{ n: '46206', style: 'date' }, 'Refund', { n: '-20.25' }, null],
    ]);
    const upload = async (contentType, body) => {
      const env = { DB: makeDb() };
      const me = await pair(env);
      const res = await call(env, 'POST', '/v1/import/csv', {
        token: me.adminToken, headers: { 'content-type': contentType, 'x-wafra-date-order': 'day-first', ...FEATURES }, body,
      });
      const json = await res.json();
      // The queue's order is not the statement's; statementRowIndex is.
      const rows = (await syncedRows(env, me)).map(({ statementImportId, ...row }) => row)
        .sort((a, b) => a.statementRowIndex - b.statementRowIndex);
      return { status: res.status, json, rows };
    };
    const fromCsv = await upload('text/csv', csv);
    const fromXlsx = await upload(XLSX, xlsx);
    ok('an .xlsx upload answers like its CSV export',
      fromXlsx.status === 202 && fromXlsx.json.acceptedRows === fromCsv.json.acceptedRows &&
        fromXlsx.json.rejectedRows === fromCsv.json.rejectedRows && fromXlsx.json.totalRows === fromCsv.json.totalRows &&
        fromXlsx.json.acceptedRows === 2 && fromXlsx.json.rejectedRows === 1,
      JSON.stringify({ csv: fromCsv.json, xlsx: fromXlsx.json }));
    ok('…and the phone receives exactly the same sealed rows',
      fromXlsx.rows.length === 2 && JSON.stringify(fromXlsx.rows) === JSON.stringify(fromCsv.rows),
      JSON.stringify({ csv: fromCsv.rows, xlsx: fromXlsx.rows }));
    ok('…carrying the exact money and the Arabic merchant',
      fromXlsx.rows[0]?.amountFils === 123450 && fromXlsx.rows[0]?.merchant === 'مطعم البيك' &&
        fromXlsx.rows[0]?.captureSource === 'csv');

    const tsv = await upload('text/tab-separated-values', csv.replace(/,/g, '\t'));
    ok('a .tsv upload under text/tab-separated-values is accepted', tsv.status === 202 && tsv.json.acceptedRows === 2);

    const env = { DB: makeDb() };
    const me = await pair(env);
    const post = (contentType, body, features = FEATURES) => call(env, 'POST', '/v1/import/csv', {
      token: me.adminToken, headers: { 'content-type': contentType, ...features }, body,
    });
    const shipped = await post(XLSX, xlsx, {});
    const shippedBody = await shipped.json();
    ok('without the xlsx feature an .xlsx upload is refused exactly as before (415 csv_required)',
      shipped.status === 415 && shippedBody.error === 'csv_required', JSON.stringify(shippedBody));
    const csvWithoutHeader = await post('text/csv', 'Date,Description,Debit,Credit\n01/07/2026,Taxi,20.00,', {});
    ok('CSV uploads need no feature header', csvWithoutHeader.status === 202);
    const garbage = await post(XLSX, 'Date,Description,Debit,Credit\n01/07/2026,Taxi,20.00,');
    ok('a non-workbook sent as .xlsx is 400 invalid_xlsx',
      garbage.status === 400 && (await garbage.json()).error === 'invalid_xlsx');
    const big = buildXlsx([['Date', 'Description', 'Debit', 'Credit'], [{ n: '46204', style: 'date' }, 'Shop', { n: '5' }, null]], {
      extraEntries: [{ name: 'xl/media/image1.bin', data: require('node:crypto').randomBytes(1_500_000), method: 0 }],
    });
    const bigOk = await post(XLSX, big);
    ok('an .xlsx between the CSV and XLSX ceilings is read', bigOk.status === 202, String(bigOk.status));
    const tooBig = await post(XLSX, new Uint8Array(2 * 1024 * 1024 + 1));
    ok('an .xlsx over 2 MB is 413 too_large', tooBig.status === 413 && (await tooBig.json()).error === 'too_large');
    const csvTooBig = await post('text/csv', new Uint8Array(1024 * 1024 + 1).fill(0x41));
    ok('a CSV keeps its 1 MB ceiling', csvTooBig.status === 413);
    const many = buildXlsx([['Date', 'Description', 'Debit', 'Credit'],
      ...Array.from({ length: 201 }, (_, i) => [{ n: String(46000 + i), style: 'date' }, `Row ${i}`, { n: '1' }, null])]);
    const manyRes = await post(XLSX, many);
    ok('an .xlsx past the row ceiling is 413 too_many_rows',
      manyRes.status === 413 && (await manyRes.json()).error === 'too_many_rows');
    const legacyXls = await post('application/vnd.ms-excel', new Uint8Array([0xd0, 0xcf, 0x11, 0xe0]));
    ok('legacy .xls is not accepted', legacyXls.status === 415 && (await legacyXls.json()).error === 'csv_required');
  }

  console.log(`\n${passed} passed, ${failed} failed`);
  if (failed > 0) process.exit(1);
})().catch((error) => {
  console.error(error);
  process.exit(1);
});
