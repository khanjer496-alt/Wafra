// Relay tests.
//
// Three things are asserted here, and nothing else in the tree can catch any of
// them.
//
// THE SEAL MUST ROUND-TRIP. A sealed row the phone cannot open would look
// exactly like a working service right up until a user tried to sync. Node's
// WebCrypto implements X25519 the same way Workers do, so server/src/crypto.ts
// runs here unmodified — and the device half is NOT reimplemented in this file:
// these tests drive the real src/lib/relay-crypto.ts that ships in the app, so
// a change to either side that breaks the other fails right here rather than on
// someone's phone.
//
// THE ROUTES MUST BEHAVE. The handler exercised below is the real
// `export default { fetch }` from server/src/index.ts, driven against a real
// SQLite database created from the real server/schema.sql. No route logic is
// stubbed; only the D1 binding's method names are adapted. This replaced an
// earlier approach that asserted route behaviour by regex-matching the Worker's
// own source text — which passes on a runtime-broken Worker and fails on a
// rename, i.e. it is wrong in both directions.
//
// THE MESSAGE TEXT MUST NOT SURVIVE. Everything else this service does is
// negotiable; that is not. Every section that queues a row also asserts the
// text is nowhere in the database, and that what the phone opens carries the
// structured fields without the body it came from.
const path = require('path');
const fs = require('fs');
const ts = require('typescript');
const Module = require('node:module');

const repoRoot = path.join(__dirname, '..', '..');
const buildDir = path.join(__dirname, 'build');

// ── Two things that must happen before the Worker is required ──
//
// 1. postal-mime and unpdf are server/ dependencies, and build/ sits under
//    scripts/test — Node's upward node_modules walk never reaches
//    server/node_modules, so requiring the real Worker dies with
//    MODULE_NOT_FOUND before a single assertion runs. Only these two names are
//    redirected: a blanket fallback would silently satisfy a typo'd require.
const SERVER_ONLY_PACKAGES = new Set(['postal-mime', 'unpdf']);
const serverModules = path.join(repoRoot, 'server', 'node_modules');
const resolveFilename = Module._resolveFilename;
Module._resolveFilename = function (request, ...rest) {
  if (SERVER_ONLY_PACKAGES.has(request)) {
    return resolveFilename.call(this, path.join(serverModules, request), ...rest);
  }
  return resolveFilename.call(this, request, ...rest);
};

// 2. The Worker imports three server modules besides crypto.ts. If run.sh has
//    not put them in build/, compile them here rather than exploding at
//    require() time — a suite that cannot load reads like a broken checkout
//    instead of like the coverage hole it is. When run.sh supplies them this
//    loop does nothing.
if (fs.existsSync(buildDir)) {
  for (const name of ['ingest-row', 'imports', 'push']) {
    const compiled = path.join(buildDir, `${name}.js`);
    if (fs.existsSync(compiled)) continue;
    const source = path.join(repoRoot, 'server', 'src', `${name}.ts`);
    fs.writeFileSync(
      compiled,
      ts.transpileModule(fs.readFileSync(source, 'utf8'), {
        compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 },
        fileName: source,
      }).outputText,
    );
  }
}

const { webcrypto } = require('crypto');
globalThis.crypto = webcrypto;

const { DatabaseSync } = require('node:sqlite');

const {
  seal, hashToken, keyedFingerprint, randomToken, timingSafeEqual,
  b64decode, b64encode, b64url,
} = require('./build/crypto');
const { deviceKeypair, openSealed, encodeKey, decodeKey } = require('./build/relay-crypto.cjs');
const { relaySender, MAX_RELAY_SENDER_LENGTH } = require('./build/ingest-row');
const { parseSms } = require('./build/sms-parser');
const { setActiveMarket } = require('./build/markets');
const { RELAY_TEST_MESSAGE } = require('./build/relay-protocol');
const worker = require('./build/worker').default;

let pass = 0, fail = 0;
function ok(name, cond, detail = '') {
  if (cond) { pass++; console.log(`✓ ${name}`); }
  else { fail++; console.log(`✗ ${name} ${detail}`); }
}

const enc = new TextEncoder();

/* ───────────────────── A D1 binding over node:sqlite ─────────────────────
 *
 * D1 IS SQLite, so this is a method-name adapter rather than a fake: the same
 * SQL the Worker sends to Cloudflare is the SQL that runs here, including
 * `unixepoch()`, `INSERT … RETURNING` and the `?1` numbered placeholders. That
 * matters — a hand-rolled query matcher would happily pass while the real
 * statement was malformed.
 *
 * run() returns `{ meta: { changes } }` and not node:sqlite's bare `changes`
 * because the Worker READS that number to decide real things: whether the
 * replay guard suppressed an insert, and whether an invite was actually
 * redeemed. An adapter that forwarded the raw object would make every write
 * look like it changed nothing, and the suite would go green for the wrong
 * reason — the queue would simply always appear empty.
 */
function makeDb() {
  const db = new DatabaseSync(':memory:');
  db.exec(fs.readFileSync(path.join(repoRoot, 'server', 'schema.sql'), 'utf8'));
  const statement = (sql, params = []) => ({
    bind: (...values) => statement(sql, values),
    first: async () => db.prepare(sql).get(...params) ?? null,
    all: async () => ({ results: db.prepare(sql).all(...params) }),
    run: async () => {
      const result = db.prepare(sql).run(...params);
      return { success: true, meta: { changes: Number(result.changes) } };
    },
  });
  return {
    handle: db,
    prepare: (sql) => statement(sql),
    batch: async (statements) => {
      const results = [];
      for (const s of statements) results.push(await s.run());
      return results;
    },
  };
}

const ALL_TABLES = [
  'vaults', 'devices', 'device_invites', 'queue',
  'push_registrations', 'ingest_receipts', 'ingest_limits', 'pair_limits',
];

/** Every byte the database holds, for the "nothing readable is stored" checks. */
function dumpDb(db) {
  return JSON.stringify(ALL_TABLES.map((t) => db.handle.prepare(`SELECT * FROM ${t}`).all()));
}

function count(db, table) {
  return db.handle.prepare(`SELECT COUNT(*) AS n FROM ${table}`).get().n;
}

const ORIGIN = 'https://relay.test';

function call(env, method, pathname, { token, body, headers, ctx } = {}) {
  const init = { method, headers: { ...headers } };
  if (body !== undefined) {
    init.body = typeof body === 'string' || body instanceof Uint8Array
      ? body
      : JSON.stringify(body);
    init.headers['content-type'] = init.headers['content-type'] ?? 'application/json';
  }
  if (token) init.headers.authorization = `Bearer ${token}`;
  const req = new Request(`${ORIGIN}${pathname}`, init);
  return ctx ? worker.fetch(req, env, ctx) : worker.fetch(req, env);
}

/**
 * A Worker that wants to wake a phone hands the send to ctx.waitUntil, and the
 * default context detaches it — correct in production, invisible to a test.
 * Passing one of these makes the wake observable without changing the handler.
 */
function collector() {
  const pending = [];
  return {
    ctx: { waitUntil: (promise) => pending.push(promise) },
    settled: () => Promise.all(pending),
  };
}

async function pairDevice(env, options = {}) {
  const keypair = deviceKeypair(webcrypto.getRandomValues(new Uint8Array(32)));
  const res = await call(env, 'POST', '/v1/pair', {
    body: { publicKey: encodeKey(keypair.publicKey), ...options },
  });
  return { keypair, res, ...(await res.json()) };
}

/** Collect a device's queue and open it with the shipping client code. */
async function syncOpened(env, device) {
  const res = await call(env, 'GET', '/v1/sync', { token: device.syncToken });
  const { items } = await res.json();
  return { items, rows: items.map((i) => openSealed(device.keypair.secretKey, i)) };
}

/* A Shortcut may retry, and the relay is idempotent for 15 minutes on the body
 * it received. Every ingest that is meant to produce a NEW row therefore needs
 * its own identity, or half of these sections would silently queue nothing. */
let eventCounter = 0;
const nextEvent = () => `event-${String(++eventCounter).padStart(6, '0')}`;

/* Messages chosen because each one proves a different route behaviour, rather
 * than just "a transaction happened". */
const AE_PURCHASE =
  'Purchase of AED 40.00 with Debit Card ending 4733 at % ARABICA, DUBAI. Avl Balance is AED 7,476.59.';
const AE_LIMIT_CARD =
  'Purchase of AED 250.00 with Card ending 8821 at CARREFOUR DUBAI. Available Limit is AED 4,000.00.';
const SA_PURCHASE =
  'Purchase of SAR 45.00 with Card ending 1234 at PANDA RIYADH. Available balance SAR 900.00';
const NOT_A_TRANSACTION = 'Your OTP is 483920. Do not share it with anyone.';
const CARD_PAYMENT_RECEIPT =
  'Payment of AED 4,061.69 received towards your Credit Card ending 8575. Thank you.';
const CARD_PAYMENT_DEBIT =
  'AED 4,061.69 has been deducted from your account 095XXX11XXX01 towards payment of your Credit Card ending 8575.';

(async () => {
  /* ═══════════════════════ Crypto: seal ↔ open ═══════════════════════ */

  const device = deviceKeypair(webcrypto.getRandomValues(new Uint8Array(32)));
  const pub = encodeKey(device.publicKey);

  ok('keypair: the public key is 32 bytes', device.publicKey.length === 32);
  ok('keypair: base64 survives a round trip through the wire format',
    b64encode(decodeKey(pub)) === pub);
  ok('keypair: the app encodes a key the Worker will accept', b64decode(pub).length === 32);

  const payload = { merchant: 'Kokoro Qlub', amountFils: 72267, categoryGuess: 'dining' };
  const blob = await seal(pub, payload);

  ok('seal: produces epk, iv and ciphertext',
    typeof blob.epk === 'string' && typeof blob.iv === 'string' && typeof blob.ct === 'string');
  ok('seal: ciphertext is not the plaintext', !blob.ct.includes('Kokoro'));

  const opened = openSealed(device.secretKey, blob);
  ok('seal: the device opens what the Worker sealed',
    JSON.stringify(opened) === JSON.stringify(payload), JSON.stringify(opened));

  // Arabic merchants are ordinary in this corpus, and a UTF-8 mistake in either
  // half would only ever surface as mojibake in someone's ledger.
  const arabic = { merchant: 'مقهى ٪ أرابيكا', amountFils: 18750, note: 'دبي' };
  const openedArabic = openSealed(device.secretKey, await seal(pub, arabic));
  ok('seal: an Arabic merchant name survives the round trip',
    openedArabic.merchant === arabic.merchant && openedArabic.note === arabic.note,
    JSON.stringify(openedArabic));

  // Every seal uses a fresh ephemeral key, so identical rows must not produce
  // identical ciphertext — otherwise the database leaks which charges repeat.
  const again = await seal(pub, payload);
  ok('seal: the same payload seals differently each time', again.ct !== blob.ct);

  // A different device must not be able to open it.
  const otherDevice = deviceKeypair(webcrypto.getRandomValues(new Uint8Array(32)));
  let denied = false;
  try { openSealed(otherDevice.secretKey, blob); } catch { denied = true; }
  ok('seal: another device cannot open it', denied);

  // Tampering must fail rather than silently decode — GCM's whole job.
  const tampered = { ...blob, ct: b64encode((() => {
    const bytes = b64decode(blob.ct); bytes[0] ^= 0xff; return bytes;
  })()) };
  let rejected = false;
  try { openSealed(device.secretKey, tampered); } catch { rejected = true; }
  ok('seal: a tampered ciphertext is rejected', rejected);

  // An all-zero ephemeral key derives an all-zero shared secret on a careless
  // implementation — i.e. anyone at all could forge a row.
  let lowOrderRejected = false;
  try {
    openSealed(device.secretKey, { ...blob, epk: b64encode(new Uint8Array(32)) });
  } catch { lowOrderRejected = true; }
  ok('open: an all-zero ephemeral key is rejected', lowOrderRejected);

  for (const [name, mutation] of [
    ['a short ephemeral key', { epk: b64encode(new Uint8Array(31)) }],
    ['a short nonce', { iv: b64encode(new Uint8Array(8)) }],
    ['a ciphertext shorter than its tag', { ct: b64encode(new Uint8Array(12)) }],
  ]) {
    let caught = false;
    try { openSealed(device.secretKey, { ...blob, ...mutation }); } catch { caught = true; }
    ok(`open: ${name} is rejected`, caught);
  }

  /* ═══════════════════════ Tokens and fingerprints ═══════════════════════ */

  const sample = randomToken();
  ok('token: url-safe and long enough', /^[A-Za-z0-9_-]{40,}$/.test(sample), sample);
  ok('token: two tokens differ', randomToken() !== randomToken());
  ok('token: hash is stable', (await hashToken(sample)) === (await hashToken(sample)));
  ok('token: hash is not the token', (await hashToken(sample)) !== sample);
  ok('compare: equal strings match', timingSafeEqual('abc', 'abc'));
  ok('compare: different strings do not', !timingSafeEqual('abc', 'abd'));
  ok('compare: different lengths do not', !timingSafeEqual('abc', 'abcd'));
  ok('b64url: no padding and no url-unsafe characters',
    /^[A-Za-z0-9_-]+$/.test(b64url(await crypto.subtle.digest('SHA-256', enc.encode('x')))));

  // The replay receipts are keyed on the device's own ingest token, so a retry
  // is recognised without the relay keeping the body — and one device's
  // receipts cannot be correlated with another's.
  ok('replay: the same token and event are stable',
    (await keyedFingerprint(sample, 'event:one')) === (await keyedFingerprint(sample, 'event:one')));
  ok('replay: another token cannot correlate the same event',
    (await keyedFingerprint(sample, 'event:one')) !==
      (await keyedFingerprint(randomToken(), 'event:one')));

  /* ═════════════ What has to survive the raw discard ═════════════
   *
   * Two facts about a message used to be recoverable only by re-reading its
   * text: which leg of a card settlement it is, and which bank sent it. Android
   * re-reads both, because Android still has the message. The relay does not —
   * it parses, drops the text, and seals what is left — so on iOS either fact
   * is simply gone unless it crosses as a structured field. The cost is not
   * cosmetic: two legs of one payment settle a statement twice, and a card
   * ending 3749 at one bank is indistinguishable from a card ending 3749 at
   * another.
   */

  // Pinned explicitly: the active market pack is module-level state that the
  // route sections below change, and a bare parseSms() here would otherwise
  // read whichever pack ran last.
  setActiveMarket('AE');

  const parsed = parseSms(AE_PURCHASE);
  const { raw: _purchaseText, ...purchaseRow } = parsed;
  const openedRow = openSealed(device.secretKey, await seal(pub, purchaseRow));
  ok('relay: the parsed row carries no raw message text',
    openedRow.raw === undefined && !JSON.stringify(openedRow).includes('Avl Balance'));
  ok('relay: the parsed row still carries what the app needs',
    openedRow.merchant === '% Arabica' && openedRow.amountFils === 4000 &&
      openedRow.categoryGuess === 'dining',
    JSON.stringify(openedRow));

  const settlement = parseSms(CARD_PAYMENT_RECEIPT);
  ok('relay: the parser decides the settlement leg before the text is dropped',
    settlement.kind === 'cardPayment' && settlement.cardPaymentSide === 'receipt',
    JSON.stringify(settlement && { k: settlement.kind, s: settlement.cardPaymentSide }));

  const { raw: _settlementText, ...settlementRow } = settlement;
  const shortcutRow = {
    ...settlementRow,
    captureSource: 'shortcut',
    sender: relaySender('  ADCB   Alerts '),
    receivedAt: new Date().toISOString(),
  };
  const openedShortcut = openSealed(device.secretKey, await seal(pub, shortcutRow));
  ok('relay: a Shortcut row carries the settlement leg and the bank, not the message',
    openedShortcut.cardPaymentSide === 'receipt' &&
      openedShortcut.sender === 'ADCB Alerts' &&
      openedShortcut.raw === undefined &&
      !JSON.stringify(openedShortcut).includes('Thank you'),
    JSON.stringify(openedShortcut));

  const debitLeg = parseSms(CARD_PAYMENT_DEBIT);
  const { raw: _debitText, ...debitRow } = debitLeg;
  const openedDebit = openSealed(device.secretKey, await seal(pub, debitRow));
  ok('relay: the opposite leg of one payment stays distinguishable without its text',
    openedDebit.cardPaymentSide === 'debit' && openedShortcut.cardPaymentSide === 'receipt',
    JSON.stringify([openedDebit.cardPaymentSide, openedShortcut.cardPaymentSide]));

  /* ═════════════════ What may be called a sender ═════════════════
   *
   * The refusals are spelled by codepoint rather than pasted in: every one of
   * them is invisible on the page, and a test whose input cannot be read is a
   * test nobody can check.
   */
  const NUL = String.fromCharCode(0x00);
  const LINE_FEED = String.fromCharCode(0x0a);
  const TAB = String.fromCharCode(0x09);
  const RIGHT_TO_LEFT_OVERRIDE = String.fromCharCode(0x202e);
  const LEFT_TO_RIGHT_ISOLATE = String.fromCharCode(0x2066);

  ok('sender: an ordinary bank label is accepted and trimmed',
    relaySender('Emirates NBD') === 'Emirates NBD' && relaySender(' ADCB ') === 'ADCB');
  ok('sender: absent, null and blank all mean "no bank label", not an error',
    relaySender(undefined) === null && relaySender(null) === null && relaySender('   ') === null);
  ok('sender: a non-string is refused rather than coerced',
    relaySender(42) === undefined && relaySender({ name: 'ADCB' }) === undefined &&
      relaySender(['ADCB']) === undefined && relaySender(true) === undefined);
  ok('sender: control characters are refused',
    relaySender(`ADCB${LINE_FEED}Purchase of AED 40.00`) === undefined &&
      relaySender(`ADCB${NUL}`) === undefined &&
      relaySender(`ADCB${TAB}X`) === undefined);
  ok('sender: bidi overrides that could disguise the bank are refused',
    relaySender(`${RIGHT_TO_LEFT_OVERRIDE}ADCB`) === undefined &&
      relaySender(`AD${LEFT_TO_RIGHT_ISOLATE}CB`) === undefined);
  // The failure mode this guards: a broken automation passing the message body
  // where the sender belongs. Refusing keeps eighty characters of a bank alert
  // out of the one field on the row that is not parser output.
  ok('sender: an over-long value is refused, never truncated into the row',
    relaySender('A'.repeat(MAX_RELAY_SENDER_LENGTH)) === 'A'.repeat(MAX_RELAY_SENDER_LENGTH) &&
      relaySender('A'.repeat(MAX_RELAY_SENDER_LENGTH + 1)) === undefined);

  // A sender this side accepts but the app rejects does not lose a label, it
  // loses the transaction: isParsedRelayRow drops the whole row, and by then
  // the message text is gone for good.
  const clientLimit = Number(
    /const MAX_RELAY_SENDER_LENGTH = (\d+);/.exec(
      fs.readFileSync(path.join(repoRoot, 'src/lib/relay.ts'), 'utf8'))?.[1]);
  ok('sender: the relay never accepts a label longer than the app will take',
    Number.isFinite(clientLimit) && MAX_RELAY_SENDER_LENGTH <= clientLimit,
    `server ${MAX_RELAY_SENDER_LENGTH} vs app ${clientLimit}`);

  /* ═══════════════════════ Route: /v1/pair ═══════════════════════ */

  {
    const env = { DB: makeDb() };

    for (const [name, body] of [
      ['a missing public key', {}],
      ['a non-string public key', { publicKey: 42 }],
      ['a key that is not 32 bytes', { publicKey: b64encode(new Uint8Array(16)) }],
      ['an absurdly long key', { publicKey: 'A'.repeat(200) }],
    ]) {
      const res = await call(env, 'POST', '/v1/pair', { body });
      ok(`pair: rejects ${name}`, res.status === 400, `got ${res.status}`);
    }

    const paired = await pairDevice(env, { deviceName: 'Zayed iPhone' });
    ok('pair: returns a device id and the three scoped tokens',
      paired.res.status === 200 && !!paired.deviceId &&
        !!paired.ingestToken && !!paired.syncToken && !!paired.adminToken);
    // Least privilege is the point of three tokens rather than one: the
    // Shortcut holds the ingest token and lives outside the app, where the user
    // can inspect and share it. It must not be able to read the queue back.
    ok('pair: the three tokens are all different',
      new Set([paired.ingestToken, paired.syncToken, paired.adminToken]).size === 3);
    ok('pair: defaults to the AE market pack', paired.market === 'AE');
    ok('pair: rejects a device name with control characters',
      (await call(env, 'POST', '/v1/pair', {
        body: { publicKey: encodeKey(deviceKeypair(webcrypto.getRandomValues(new Uint8Array(32))).publicKey), deviceName: `Zayed${LINE_FEED}iPhone` },
      })).status === 400);

    const sa = await pairDevice(env, { market: 'SA' });
    ok('pair: honours the market pack the device asked for', sa.market === 'SA');
    // A build shipping a pack this relay has not deployed yet must still be
    // able to connect: AE is what it would have parsed under anyway.
    const bogus = await pairDevice(env, { market: 'ZZ' });
    ok('pair: falls back to AE for a market the app has no pack for', bogus.market === 'AE');
    ok('pair: two devices get different tokens', paired.ingestToken !== sa.ingestToken);

    const stored = env.DB.handle
      .prepare('SELECT ingest_token_hash, sync_token_hash, admin_token_hash FROM devices')
      .all();
    const clearText = JSON.stringify(stored);
    ok('pair: no token is stored in the clear, only digests',
      stored.length === 3 &&
        !clearText.includes(paired.ingestToken) &&
        !clearText.includes(paired.syncToken) &&
        !clearText.includes(paired.adminToken));
    ok('pair: each device gets its own vault',
      env.DB.handle.prepare('SELECT COUNT(DISTINCT vault_id) AS n FROM devices').get().n === 3);

    // Plain HTTP is refused outright rather than served: a Shortcut posting a
    // bank alert over http would hand the message to every hop on the way.
    const insecure = await worker.fetch(
      new Request('http://relay.example/v1/health', { method: 'GET' }), env);
    ok('transport: plain http to a public host is refused', insecure.status === 400);
  }

  /* ═════════════ Scopes: one credential is not the others ═════════════ */

  {
    const env = { DB: makeDb() };
    const me = await pairDevice(env);

    ok('scope: the ingest token cannot read the queue',
      (await call(env, 'GET', '/v1/sync', { token: me.ingestToken })).status === 401);
    ok('scope: the ingest token cannot acknowledge rows',
      (await call(env, 'POST', '/v1/ack', {
        token: me.ingestToken, body: { ids: [crypto.randomUUID()] },
      })).status === 401);
    ok('scope: the ingest token cannot unpair the device',
      (await call(env, 'DELETE', '/v1/device', { token: me.ingestToken })).status === 401);
    ok('scope: the sync token cannot inject a message',
      (await call(env, 'POST', '/v1/ingest', {
        token: me.syncToken, body: { text: AE_PURCHASE },
      })).status === 401);
    ok('scope: the sync token cannot mint an invite',
      (await call(env, 'POST', '/v1/device-invites', { token: me.syncToken })).status === 401);
    ok('scope: the admin token cannot inject a message',
      (await call(env, 'POST', '/v1/ingest', {
        token: me.adminToken, body: { text: AE_PURCHASE },
      })).status === 401);
    ok('scope: the admin token is what manages the device',
      (await call(env, 'GET', '/v1/devices', { token: me.adminToken })).status === 200);
  }

  /* ═══════════════════════ Route: /v1/ingest ═══════════════════════ */

  {
    const env = { DB: makeDb() };
    const me = await pairDevice(env);

    // ── Authentication ──
    ok('ingest: rejects a request with no token',
      (await call(env, 'POST', '/v1/ingest', { body: { text: AE_PURCHASE } })).status === 401);
    ok('ingest: rejects a token that was never issued',
      (await call(env, 'POST', '/v1/ingest', { token: randomToken(), body: { text: AE_PURCHASE } }))
        .status === 401);
    ok('ingest: rejects an Authorization header that is not a Bearer token',
      (await call(env, 'POST', '/v1/ingest', {
        headers: { authorization: `Basic ${me.ingestToken}` }, body: { text: AE_PURCHASE },
      })).status === 401);

    // ── Body handling ──
    ok('ingest: rejects an empty message',
      (await call(env, 'POST', '/v1/ingest', { token: me.ingestToken, body: { text: '   ' } }))
        .status === 400);
    ok('ingest: rejects a body with no text at all',
      (await call(env, 'POST', '/v1/ingest', { token: me.ingestToken, body: { sender: 'ADIB' } }))
        .status === 400);
    ok('ingest: refuses an oversized body',
      (await call(env, 'POST', '/v1/ingest', { token: me.ingestToken, body: 'x'.repeat(9000) }))
        .status === 413);
    ok('ingest: refuses an oversized body on the declared length alone',
      (await call(env, 'POST', '/v1/ingest', {
        token: me.ingestToken, headers: { 'content-length': '99999' }, body: { text: AE_PURCHASE },
      })).status === 413);
    ok('ingest: rejects a malformed event id rather than storing it',
      (await call(env, 'POST', '/v1/ingest', {
        token: me.ingestToken, body: { text: AE_PURCHASE, eventId: 'no spaces allowed' },
      })).status === 400);

    // Shortcuts is fiddly about JSON, so a bare text body is accepted too.
    ok('ingest: accepts a bare (non-JSON) message body',
      (await call(env, 'POST', '/v1/ingest', { token: me.ingestToken, body: AE_PURCHASE }))
        .status === 202);
    ok('ingest: the bare body really was queued', count(env.DB, 'queue') === 1);

    // ── The 204 path ──
    const otp = await call(env, 'POST', '/v1/ingest', {
      token: me.ingestToken, body: { text: NOT_A_TRANSACTION, eventId: nextEvent() },
    });
    ok('ingest: a message that is not a transaction is 204',
      otp.status === 204 && (await otp.text()) === '');
    ok('ingest: the 204 path really did store nothing', count(env.DB, 'queue') === 1);

    // ── The setup probe ──
    const probe = await call(env, 'POST', '/v1/ingest', {
      token: me.ingestToken, body: { text: RELAY_TEST_MESSAGE, eventId: nextEvent() },
    });
    ok('ingest: the setup probe is accepted even though it is not a transaction',
      probe.status === 202 && count(env.DB, 'queue') === 2);

    // A PROBE IS NEVER A REPLAY. Its body is a constant, so every "Try again"
    // on the setup screen sends bytes identical to the last attempt. While the
    // probe took the ordinary replay receipt, the second attempt was
    // suppressed — and because the receipt UPSERT refreshes expires_at, each
    // retry pushed the block further out. A user whose first probe went astray
    // could retry forever on a correctly configured phone and be told, every
    // time, that nothing arrived.
    //
    // Sent with NO eventId, because that is the case that bites: with one, the
    // replay material is the event id and each retry differs anyway. Without
    // one the body IS the identity.
    const probeRetryA = await call(env, 'POST', '/v1/ingest', {
      token: me.ingestToken, body: { text: RELAY_TEST_MESSAGE },
    });
    const probeRetryB = await call(env, 'POST', '/v1/ingest', {
      token: me.ingestToken, body: { text: RELAY_TEST_MESSAGE },
    });
    ok('ingest: a repeated setup probe is queued again, not suppressed as a replay',
      probeRetryA.status === 202 && probeRetryB.status === 202 &&
        count(env.DB, 'queue') === 4,
      `queue=${count(env.DB, 'queue')}`);

    // ...and the guard it is exempt from still works for a real charge, which
    // is the half that must not regress: an HTTP retry of one purchase is one
    // purchase.
    const dupBody = { text: 'Purchase of AED 12.00 with Debit Card ending 1234 at ARABICA, DUBAI.' };
    const chargeA = await call(env, 'POST', '/v1/ingest', { token: me.ingestToken, body: dupBody });
    const beforeReplay = count(env.DB, 'queue');
    const chargeB = await call(env, 'POST', '/v1/ingest', { token: me.ingestToken, body: dupBody });
    ok('ingest: a repeated real charge is still suppressed as a replay',
      chargeA.status === 202 && chargeB.status === 202 &&
        count(env.DB, 'queue') === beforeReplay,
      `before=${beforeReplay} after=${count(env.DB, 'queue')}`);

    // ── The database holds nothing readable ──
    ok('ingest: the message text is nowhere in the database',
      !dumpDb(env.DB).includes('ARABICA') && !dumpDb(env.DB).includes('Avl Balance'));

    const firstRows = (await syncOpened(env, me)).rows;
    const probeRow = firstRows.find((r) => r.relayTest);
    ok('ingest: the probe seals a marker and no bank label',
      !!probeRow && probeRow.sender === undefined && probeRow.market === undefined,
      JSON.stringify(probeRow));
    ok('ingest: an accepted row records the pack it was parsed under',
      firstRows.some((r) => r.market === 'AE' && r.captureSource === 'shortcut'));

    // ── Sender attribution ──
    //
    // This is what makes an iOS card branded instead of grey: no UAE bank but
    // HSBC names itself in the body, so without the sender the parser cannot
    // tell an Islamic issuer's "Card" (a CREDIT card quoting a limit) from a
    // conventional bank's debit card.
    await call(env, 'POST', '/v1/ingest', {
      token: me.ingestToken, body: { text: AE_LIMIT_CARD, sender: 'ADIB', eventId: nextEvent() },
    });
    const withSender = (await syncOpened(env, me)).rows.find((r) => r.amountFils === 25000);
    ok('ingest: the sender is carried into the sealed row', withSender?.sender === 'ADIB');
    ok('ingest: the sender changes how the message parses',
      withSender?.card?.kind === 'credit', JSON.stringify(withSender?.card));
    ok('ingest: the sender is not stored outside the seal', !dumpDb(env.DB).includes('ADIB'));

    const noSender = await pairDevice(env);
    await call(env, 'POST', '/v1/ingest', {
      token: noSender.ingestToken, body: { text: AE_LIMIT_CARD },
    });
    const plain = (await syncOpened(env, noSender)).rows[0];
    // The merged parser refuses to guess here rather than defaulting to debit:
    // "Available Limit" is a credit-card phrase, but plenty of issuers word a
    // debit alert the same way, and a wrong card kind settles a payment against
    // the wrong statement. `unknown` is the honest answer, and the assertion
    // above is what says the sender is how it becomes known.
    ok('ingest: without a sender the same message cannot be attributed to a card kind',
      plain.card.kind === 'unknown' && plain.sender === undefined,
      JSON.stringify(plain.card));

    // Refused, not trimmed. Truncating an over-long value would store the first
    // eighty characters of a bank message in a field meant to hold a bank name.
    const overLong = await call(env, 'POST', '/v1/ingest', {
      token: me.ingestToken, body: { text: AE_PURCHASE, sender: 'A'.repeat(500) },
    });
    ok('ingest: an over-long sender is refused, never truncated into the row',
      overLong.status === 400);
    ok('ingest: the refusal does not echo what it refused',
      !(await overLong.text()).includes('AAAA'));

    // ── Timestamps ──
    const when = '2026-07-02T09:15:00.000Z';
    const stamped = await pairDevice(env);
    await call(env, 'POST', '/v1/ingest', {
      token: stamped.ingestToken, body: { text: AE_PURCHASE, receivedAt: when },
    });
    const stampedRow = (await syncOpened(env, stamped)).rows[0];
    ok('ingest: the message timestamp is honoured, not the relay receipt time',
      stampedRow.receivedAt === when, stampedRow.receivedAt);

    // An unbounded caller value lets a broken automation park a valid
    // transaction years in the past or in the future; a value that is merely
    // late is recoverable, one at the top of the ledger forever is not.
    const skewed = await pairDevice(env);
    for (const value of ['2099-01-01T00:00:00.000Z', 'not a date', null, '1990-01-01T00:00:00Z']) {
      await call(env, 'POST', '/v1/ingest', {
        token: skewed.ingestToken,
        body: { text: AE_PURCHASE, receivedAt: value, eventId: nextEvent() },
      });
    }
    const skewedRows = (await syncOpened(env, skewed)).rows;
    ok('ingest: an implausible timestamp falls back to now rather than being trusted',
      skewedRows.length === 4 &&
        skewedRows.every((r) => Math.abs(Date.parse(r.receivedAt) - Date.now()) < 60_000),
      JSON.stringify(skewedRows.map((r) => r.receivedAt)));

    // ── Retry idempotency ──
    //
    // Shortcuts and HTTP stacks retry completed requests. The relay keeps a
    // keyed HMAC receipt rather than the body, so a retry cannot file the same
    // purchase twice — and the caller still gets a success, because a retry
    // that looks like a failure is a retry that will be retried again.
    const retried = await pairDevice(env);
    const retryBody = { text: AE_PURCHASE, eventId: nextEvent() };
    const firstTry = await call(env, 'POST', '/v1/ingest', {
      token: retried.ingestToken, body: retryBody,
    });
    const secondTry = await call(env, 'POST', '/v1/ingest', {
      token: retried.ingestToken, body: retryBody,
    });
    ok('ingest: a retried request is accepted again', firstTry.status === 202 && secondTry.status === 202);
    ok('ingest: but the retry queues nothing a second time',
      (await syncOpened(env, retried)).items.length === 1);

    // Without an eventId the body is the identity — and the sender is part of
    // that body, because two banks can send the same wording for the same
    // amount on the same day and collapsing those loses a real transaction.
    const bodyKeyed = await pairDevice(env);
    await call(env, 'POST', '/v1/ingest', { token: bodyKeyed.ingestToken, body: { text: AE_PURCHASE } });
    await call(env, 'POST', '/v1/ingest', { token: bodyKeyed.ingestToken, body: { text: AE_PURCHASE } });
    ok('ingest: an identical body with no event id is deduplicated too',
      (await syncOpened(env, bodyKeyed)).items.length === 1);
    await call(env, 'POST', '/v1/ingest', {
      token: bodyKeyed.ingestToken, body: { text: AE_PURCHASE, sender: 'ADCB' },
    });
    ok('ingest: the same wording from a different bank is a different transaction',
      (await syncOpened(env, bodyKeyed)).items.length === 2);
  }

  /* ═════════════════ The market pack drives parsing ═════════════════ */

  {
    const env = { DB: makeDb() };
    const ae = await pairDevice(env, { market: 'AE' });
    const sa = await pairDevice(env, { market: 'SA' });

    await call(env, 'POST', '/v1/ingest', { token: ae.ingestToken, body: { text: SA_PURCHASE } });
    await call(env, 'POST', '/v1/ingest', { token: sa.ingestToken, body: { text: SA_PURCHASE } });

    const aeRow = (await syncOpened(env, ae)).rows[0];
    const saRow = (await syncOpened(env, sa)).rows[0];

    // The same message, two packs. Under AE the SAR amount is misread and the
    // merchant means nothing; under SA it is 45.00 at a supermarket. This is
    // what the hardcoded default cost every non-UAE user.
    ok('market: an SA device reads SAR 45.00 correctly', saRow.amountFils === 4500);
    ok('market: the AE pack does not read the same message the same way',
      aeRow.amountFils !== 4500, `AE read ${aeRow.amountFils}`);
    ok('market: the row records which pack parsed it',
      saRow.market === 'SA' && aeRow.market === 'AE');

    // PATCH, not re-pair: re-pairing would mint a new ingest token and orphan
    // the one baked into the user's Shortcut — the one piece of this system the
    // app cannot repair for them.
    ok('market: rejects a market the app has no pack for',
      (await call(env, 'PATCH', '/v1/device', { token: ae.adminToken, body: { market: 'ZZ' } }))
        .status === 400);
    ok('market: rejects a missing market',
      (await call(env, 'PATCH', '/v1/device', { token: ae.adminToken, body: {} })).status === 400);
    ok('market: rejects an unauthenticated change',
      (await call(env, 'PATCH', '/v1/device', { body: { market: 'SA' } })).status === 401);
    ok('market: the ingest token cannot change the pack',
      (await call(env, 'PATCH', '/v1/device', { token: ae.ingestToken, body: { market: 'SA' } }))
        .status === 401);

    const patched = await call(env, 'PATCH', '/v1/device', {
      token: ae.adminToken, body: { market: 'sa' },
    });
    ok('market: accepts a change and normalises the case',
      patched.status === 200 && (await patched.json()).market === 'SA');

    await call(env, 'POST', '/v1/ingest', {
      token: ae.ingestToken, body: { text: SA_PURCHASE, eventId: nextEvent() },
    });
    const afterPatch = (await syncOpened(env, ae)).rows.at(-1);
    ok('market: the change takes effect on the next message',
      afterPatch.amountFils === 4500 && afterPatch.market === 'SA');
  }

  /* ═══════════════════════ Rate limiting ═══════════════════════ */

  {
    const env = { DB: makeDb() };
    const me = await pairDevice(env);
    const other = await pairDevice(env);
    // 300 real ingests would be 300 X25519 seals. The limiter is a fixed-window
    // counter that stores no IP address and no message fingerprint, so the
    // counter is set directly instead.
    const windowStart = Math.floor(Date.now() / 3_600_000) * 3_600;
    env.DB.handle
      .prepare('INSERT INTO ingest_limits (device_id, window_start, request_count) VALUES (?, ?, ?)')
      .run(me.deviceId, windowStart, 300);

    ok('rate limit: refuses once the hourly ceiling is reached',
      (await call(env, 'POST', '/v1/ingest', {
        token: me.ingestToken, body: { text: AE_PURCHASE, eventId: nextEvent() },
      })).status === 429);
    ok('rate limit: is per device, not global',
      (await call(env, 'POST', '/v1/ingest', {
        token: other.ingestToken, body: { text: AE_PURCHASE, eventId: nextEvent() },
      })).status === 202);

    // The window must roll over, or one busy day would lock a device out
    // permanently.
    env.DB.handle
      .prepare('UPDATE ingest_limits SET window_start = ? WHERE device_id = ?')
      .run(windowStart - 7_200, me.deviceId);
    ok('rate limit: the window rolls over — an old hour stops counting',
      (await call(env, 'POST', '/v1/ingest', {
        token: me.ingestToken, body: { text: AE_PURCHASE, eventId: nextEvent() },
      })).status === 202);
    ok('rate limit: the counter keeps no IP address or message fingerprint',
      Object.keys(env.DB.handle.prepare('SELECT * FROM ingest_limits LIMIT 1').get()).join(',') ===
        'device_id,window_start,request_count');
  }

  /* ═════════════════ Routes: /v1/sync and /v1/ack ═════════════════ */

  {
    const env = { DB: makeDb() };
    const me = await pairDevice(env);
    const nosy = await pairDevice(env);

    ok('sync: rejects a request with no token', (await call(env, 'GET', '/v1/sync')).status === 401);
    ok('ack: rejects a request with no token',
      (await call(env, 'POST', '/v1/ack', { body: { ids: [crypto.randomUUID()] } })).status === 401);

    const emptySync = await call(env, 'GET', '/v1/sync', { token: me.syncToken });
    ok('sync: an empty queue is an empty list, not an error',
      emptySync.status === 200 && (await emptySync.json()).items.length === 0);

    await call(env, 'POST', '/v1/ingest', {
      token: me.ingestToken, body: { text: AE_PURCHASE, sender: 'ADIB' },
    });
    await call(env, 'POST', '/v1/ingest', {
      token: me.ingestToken, body: { text: AE_LIMIT_CARD, sender: 'ADIB' },
    });

    const first = await syncOpened(env, me);
    ok('sync: returns the queued rows sealed',
      first.items.length === 2 && first.items.every((i) => i.id && i.epk && i.iv && i.ct));
    ok('sync: the shipping client opens every row',
      first.rows.length === 2 && first.rows.every((r) => Number.isFinite(r.amountFils)));
    ok('sync: the parsed row carries no raw message text',
      first.rows.every((r) => r.raw === undefined) &&
        !JSON.stringify(first.rows).includes('Avl Balance'));
    ok('sync: the parsed row still carries what the app needs',
      first.rows[0].merchant === '% Arabica' && first.rows[0].amountFils === 4000 &&
        first.rows[0].categoryGuess === 'dining');
    ok('sync: the queue itself holds nothing readable',
      !dumpDb(env.DB).includes('ARABICA') && !dumpDb(env.DB).includes('CARREFOUR'));

    // Pull-then-acknowledge: a dropped response must lose nothing.
    const second = await call(env, 'GET', '/v1/sync', { token: me.syncToken });
    ok('sync: rows are NOT deleted on read', (await second.json()).items.length === 2);

    ok('sync: another device sees none of these rows',
      (await (await call(env, 'GET', '/v1/sync', { token: nosy.syncToken })).json()).items.length === 0);

    ok('ack: rejects an empty id list',
      (await call(env, 'POST', '/v1/ack', { token: me.syncToken, body: { ids: [] } })).status === 400);
    ok('ack: rejects a non-array',
      (await call(env, 'POST', '/v1/ack', { token: me.syncToken, body: { ids: 'all' } })).status === 400);
    ok('ack: refuses more ids than a sync can return',
      (await call(env, 'POST', '/v1/ack', {
        token: me.syncToken, body: { ids: Array.from({ length: 201 }, () => crypto.randomUUID()) },
      })).status === 400);
    ok('ack: refuses an id that is not a row id',
      (await call(env, 'POST', '/v1/ack', {
        token: me.syncToken, body: { ids: ["' OR 1=1 --"] },
      })).status === 400);

    // A device must not be able to clear someone else's queue by guessing ids.
    await call(env, 'POST', '/v1/ack', {
      token: nosy.syncToken, body: { ids: first.items.map((i) => i.id) },
    });
    ok("ack: cannot acknowledge another device's rows",
      (await (await call(env, 'GET', '/v1/sync', { token: me.syncToken })).json()).items.length === 2);

    const acked = await call(env, 'POST', '/v1/ack', {
      token: me.syncToken, body: { ids: [first.items[0].id] },
    });
    ok('ack: returns 204', acked.status === 204);
    const afterAck = await (await call(env, 'GET', '/v1/sync', { token: me.syncToken })).json();
    ok('ack: deletes exactly the rows named',
      afterAck.items.length === 1 && afterAck.items[0].id === first.items[1].id);
  }

  /* ═════════════════ Trusted devices: invite, join, fan-out ═════════════════
   *
   * A second phone in the same household reads the same ledger. It never
   * receives the first phone's private key or its long-lived credentials: it
   * generates its own keypair and is issued its own scoped tokens, and the
   * relay seals every row SEPARATELY to each device. That is why this section
   * opens the member's copy with the member's key — a fan-out that sealed one
   * blob to one key and handed it to both would be a silent no-op on the second
   * phone.
   */

  {
    const env = { DB: makeDb() };
    const owner = await pairDevice(env, { deviceName: 'Owner phone', market: 'AE' });

    ok('invite: the sync token cannot mint one',
      (await call(env, 'POST', '/v1/device-invites', { token: owner.syncToken })).status === 401);
    const invited = await call(env, 'POST', '/v1/device-invites', { token: owner.adminToken });
    const invite = await invited.json();
    ok('invite: an owner mints a short-lived one-use token',
      invited.status === 201 && !!invite.inviteToken && invite.expiresIn === 600);
    ok('invite: only the digest is stored, so a leak cannot enroll a phone',
      !dumpDb(env.DB).includes(invite.inviteToken));

    const memberKeys = deviceKeypair(webcrypto.getRandomValues(new Uint8Array(32)));
    const joinRes = await call(env, 'POST', '/v1/join', {
      body: {
        publicKey: encodeKey(memberKeys.publicKey),
        inviteToken: invite.inviteToken,
        deviceName: 'Second phone',
        market: 'SA',
      },
    });
    const member = { keypair: memberKeys, ...(await joinRes.json()) };
    ok('join: the invited phone gets its own scoped credentials',
      joinRes.status === 201 && member.deviceId !== owner.deviceId &&
        member.ingestToken !== owner.ingestToken && member.syncToken !== owner.syncToken);
    // Two phones sharing a ledger that parse the same family card under
    // different packs would file the same purchase twice, at two amounts.
    ok("join: the vault's existing pack wins over the joining phone's request",
      member.market === 'AE', member.market);
    ok('join: the invite is one-use',
      (await call(env, 'POST', '/v1/join', {
        body: {
          publicKey: encodeKey(deviceKeypair(webcrypto.getRandomValues(new Uint8Array(32))).publicKey),
          inviteToken: invite.inviteToken,
        },
      })).status === 400);
    ok('join: a token that was never an invite is refused',
      (await call(env, 'POST', '/v1/join', {
        body: {
          publicKey: encodeKey(deviceKeypair(webcrypto.getRandomValues(new Uint8Array(32))).publicKey),
          inviteToken: randomToken(),
        },
      })).status === 400);

    await call(env, 'POST', '/v1/ingest', {
      token: owner.ingestToken, body: { text: AE_PURCHASE, sender: 'ADCB' },
    });
    const ownerCopy = await syncOpened(env, owner);
    const memberCopy = await syncOpened(env, member);
    ok('fan-out: one message reaches both phones', ownerCopy.rows.length === 1 && memberCopy.rows.length === 1);
    ok('fan-out: the second phone opens its own copy with its own key',
      memberCopy.rows[0].amountFils === 4000 && memberCopy.rows[0].merchant === '% Arabica');
    ok('fan-out: the two copies are sealed separately, not shared',
      ownerCopy.items[0].ct !== memberCopy.items[0].ct);
    let crossOpen = false;
    try { openSealed(owner.keypair.secretKey, memberCopy.items[0]); crossOpen = true; } catch {}
    ok("fan-out: one phone cannot open the other's copy", !crossOpen);
    ok('fan-out: the message text is in neither copy and not in the database',
      !dumpDb(env.DB).includes('ARABICA'));

    // ── Managing the vault ──
    const listed = await (await call(env, 'GET', '/v1/devices', { token: owner.adminToken })).json();
    ok('devices: both phones are listed, with the caller marked',
      listed.devices.length === 2 &&
        listed.devices.filter((d) => d.isCurrent).length === 1 &&
        listed.devices.find((d) => d.isCurrent).id === owner.deviceId);
    ok('devices: the list carries no key material and no token',
      !JSON.stringify(listed).includes(owner.adminToken) &&
        !JSON.stringify(listed).includes(encodeKey(owner.keypair.publicKey)));

    const renamed = await call(env, 'PATCH', `/v1/devices/${member.deviceId}`, {
      token: owner.adminToken, body: { name: '  Fatima   iPhone ' },
    });
    ok('devices: an owner renames a phone, whitespace normalised',
      renamed.status === 200 && (await renamed.json()).name === 'Fatima iPhone');
    ok('devices: a member cannot rename the owner',
      (await call(env, 'PATCH', `/v1/devices/${owner.deviceId}`, {
        token: member.adminToken, body: { name: 'Mine now' },
      })).status === 403);
    ok('devices: a device id that is not a device id is refused',
      (await call(env, 'PATCH', '/v1/devices/not-a-uuid', {
        token: owner.adminToken, body: { name: 'x' },
      })).status === 400);
    ok('devices: a member cannot delete the vault',
      (await call(env, 'DELETE', '/v1/vault', { token: member.adminToken })).status === 403);

    ok('devices: the owner revokes the second phone',
      (await call(env, 'DELETE', `/v1/devices/${member.deviceId}`, { token: owner.adminToken }))
        .status === 204);
    ok('devices: a revoked phone stops working immediately',
      (await call(env, 'GET', '/v1/sync', { token: member.syncToken })).status === 401);
    ok('devices: its queued rows go with it', count(env.DB, 'queue') === 1);
    ok('devices: the last owner cannot delete itself and strand the vault',
      (await call(env, 'DELETE', `/v1/devices/${owner.deviceId}`, { token: owner.adminToken }))
        .status === 409);

    const wiped = await call(env, 'DELETE', '/v1/vault', { token: owner.adminToken });
    ok('vault: the owner can delete everything', wiped.status === 204);
    ok('vault: nothing is left behind in any table',
      ALL_TABLES.filter((t) => t !== 'pair_limits').every((t) => count(env.DB, t) === 0),
      JSON.stringify(ALL_TABLES.map((t) => [t, count(env.DB, t)])));
  }

  /* ═════════════════ Unpair: the user's delete button ═════════════════ */

  {
    const env = { DB: makeDb() };
    const me = await pairDevice(env);
    const survivor = await pairDevice(env);
    await call(env, 'POST', '/v1/ingest', { token: me.ingestToken, body: { text: AE_PURCHASE } });
    await call(env, 'POST', '/v1/ingest', {
      token: survivor.ingestToken, body: { text: AE_PURCHASE },
    });

    ok('unpair: rejects a request with no token',
      (await call(env, 'DELETE', '/v1/device')).status === 401);

    const gone = await call(env, 'DELETE', '/v1/device', { token: me.adminToken });
    ok('unpair: returns 204', gone.status === 204);
    ok('unpair: every one of that device\'s tokens stops working immediately',
      (await call(env, 'GET', '/v1/sync', { token: me.syncToken })).status === 401 &&
        (await call(env, 'POST', '/v1/ingest', {
          token: me.ingestToken, body: { text: AE_PURCHASE },
        })).status === 401);
    ok('unpair: the device row is gone', count(env.DB, 'devices') === 1);
    ok('unpair: the queued rows go with it', count(env.DB, 'queue') === 1);
    ok('unpair: the empty vault is collected too', count(env.DB, 'vaults') === 1);
    ok('unpair: another device is untouched',
      (await (await call(env, 'GET', '/v1/sync', { token: survivor.syncToken })).json())
        .items.length === 1);
  }

  /* ═════════════════ Route: /v1/push, and the wake ═════════════════
   *
   * The wake is what turns "a row is queued" into "the ledger is current"
   * without the user opening anything. Three properties are load-bearing and
   * none of them is observable from a phone:
   *
   *   • the payload says only "sync". A push carrying "AED 40 at Carrefour"
   *     would hand a readable transaction feed to Apple and to Expo, which is
   *     the exact thing this whole service is built to avoid;
   *   • wakes are coalesced. Apple throttles apps past roughly two or three
   *     background pushes an hour and then quietly stops delivering, so a busy
   *     shopping day must not spend the budget;
   *   • a failed push never costs a transaction. The row stays queued and the
   *     app's other collection layers pick it up regardless.
   */

  {
    const pushKey = b64encode(webcrypto.getRandomValues(new Uint8Array(32)));
    const projectId = crypto.randomUUID();
    const env = { DB: makeDb(), PUSH_TOKEN_KEY: pushKey, EXPO_PROJECT_ID: projectId };
    const me = await pairDevice(env);
    const TOKEN = 'ExponentPushToken[abcdef123456]';

    // Everything the Worker sends to Expo is captured rather than sent.
    const sent = [];
    let reply = () => new Response(JSON.stringify({ data: { status: 'ok' } }), { status: 200 });
    const realFetch = globalThis.fetch;
    globalThis.fetch = async (url, init = {}) => {
      if (String(url).startsWith('https://exp.host/')) {
        sent.push({ url: String(url), headers: init.headers, body: JSON.parse(init.body) });
        return reply();
      }
      return realFetch(url, init);
    };

    async function ingestAndSettle(callEnv, token, body) {
      const c = collector();
      const res = await call(callEnv, 'POST', '/v1/ingest', { token, body, ctx: c.ctx });
      await c.settled();
      return res;
    }

    try {
      ok('push: rejects a registration with no token',
        (await call(env, 'PUT', '/v1/push', { body: { expoPushToken: TOKEN, projectId } }))
          .status === 401);
      ok('push: the ingest token cannot point the wake somewhere else',
        (await call(env, 'PUT', '/v1/push', {
          token: me.ingestToken, body: { expoPushToken: TOKEN, projectId },
        })).status === 401);
      ok('push: refuses a token that is not an Expo token — this field is an address we POST to',
        (await call(env, 'PUT', '/v1/push', {
          token: me.adminToken, body: { expoPushToken: 'https://evil.example/hook', projectId },
        })).status === 400);
      ok('push: refuses a token minted for another Expo project',
        (await call(env, 'PUT', '/v1/push', {
          token: me.adminToken, body: { expoPushToken: TOKEN, projectId: crypto.randomUUID() },
        })).status === 400);

      await ingestAndSettle(env, me.ingestToken, { text: AE_PURCHASE, eventId: nextEvent() });
      ok('wake: a device that never registered is never knocked on', sent.length === 0);

      const on = await call(env, 'PUT', '/v1/push', {
        token: me.adminToken, body: { expoPushToken: TOKEN, projectId },
      });
      ok('push: registering returns 204', on.status === 204);
      // A push token is a bearer-like capability: knowing one is enough to
      // target the phone. It is stored encrypted, never as a column value.
      ok('push: the Expo token is stored encrypted, not in the clear',
        !dumpDb(env.DB).includes(TOKEN) && count(env.DB, 'push_registrations') === 1);

      await ingestAndSettle(env, me.ingestToken, { text: AE_PURCHASE, eventId: nextEvent() });
      ok('wake: queuing a row wakes the phone', sent.length === 1, `sent ${sent.length}`);
      ok('wake: addressed to the registered token', sent[0]?.body.to === TOKEN);
      ok('wake: content-available, so iOS delivers it headless',
        sent[0]?.body._contentAvailable === true);
      ok('wake: the payload says only "sync" — no amount, no merchant, no text',
        JSON.stringify(sent[0]?.body.data) === JSON.stringify({ kind: 'wafra.sync', v: 1 }) &&
          !('title' in sent[0].body) && !('body' in sent[0].body),
        JSON.stringify(sent[0]?.body));
      ok('wake: nothing from the message survives into the push',
        !JSON.stringify(sent[0]).includes('ARABICA') &&
          !JSON.stringify(sent[0]).includes('4,733') &&
          !JSON.stringify(sent[0]).includes('7,476.59'));
      ok('wake: no access token header when none is configured',
        !(sent[0]?.headers && sent[0].headers.authorization));

      // Coalescing. A second charge a minute later must not spend another wake.
      await ingestAndSettle(env, me.ingestToken, { text: AE_LIMIT_CARD, eventId: nextEvent() });
      ok('wake: a second row inside the window does not send a second push', sent.length === 1);
      ok('wake: but it is still queued — coalescing delays the knock, never the row',
        count(env.DB, 'queue') === 3);

      env.DB.handle.prepare('UPDATE push_registrations SET push_sent_at = unixepoch() - 700').run();
      await ingestAndSettle(env, me.ingestToken, { text: AE_PURCHASE, eventId: nextEvent() });
      ok('wake: once the window has passed the next row wakes it again', sent.length === 2);

      // An access token, when the Expo project demands one.
      env.DB.handle.prepare('UPDATE push_registrations SET push_sent_at = 0').run();
      await ingestAndSettle(
        { ...env, EXPO_ACCESS_TOKEN: 'secret-value' },
        me.ingestToken,
        { text: AE_PURCHASE, eventId: nextEvent() },
      );
      ok('wake: the access token is sent as a bearer header when configured',
        sent[2]?.headers.authorization === 'Bearer secret-value');

      // A token that will never work again is not an address worth keeping.
      reply = () => new Response(
        JSON.stringify({ data: { status: 'error', details: { error: 'DeviceNotRegistered' } } }),
        { status: 200 },
      );
      env.DB.handle.prepare('UPDATE push_registrations SET push_sent_at = 0').run();
      await ingestAndSettle(env, me.ingestToken, { text: AE_PURCHASE, eventId: nextEvent() });
      ok('wake: a dead token is deleted rather than kept', count(env.DB, 'push_registrations') === 0);

      // A relay that cannot reach Expo still has to accept the message.
      await call(env, 'PUT', '/v1/push', {
        token: me.adminToken, body: { expoPushToken: TOKEN, projectId },
      });
      reply = () => { throw new Error('expo is down'); };
      const queuedBefore = count(env.DB, 'queue');
      const stillOk = await ingestAndSettle(env, me.ingestToken, {
        text: AE_PURCHASE, eventId: nextEvent(),
      });
      ok('wake: a push that throws does not fail the ingest', stillOk.status === 202);
      ok('wake: and the row is queued anyway', count(env.DB, 'queue') === queuedBefore + 1);

      reply = () => new Response(JSON.stringify({ data: { status: 'ok' } }), { status: 200 });
      const off = await call(env, 'DELETE', '/v1/push', { token: me.adminToken });
      ok('push: the registration can be deleted', off.status === 204);
      ok('push: and the identifier is erased with it', count(env.DB, 'push_registrations') === 0);
      const before = sent.length;
      await ingestAndSettle(env, me.ingestToken, { text: AE_PURCHASE, eventId: nextEvent() });
      ok('wake: nothing is sent once it is off', sent.length === before);

      // Without the secret there is no way to decrypt a stored token, so the
      // route refuses rather than storing something it can never use.
      ok('push: an unconfigured relay says so instead of storing a token',
        (await call({ DB: env.DB }, 'PUT', '/v1/push', {
          token: me.adminToken, body: { expoPushToken: TOKEN, projectId },
        })).status === 503);
    } finally {
      globalThis.fetch = realFetch;
    }
  }

  /* ═════════════════ Forwarded email and PDF supplements ═════════════════ */

  {
    const env = { DB: makeDb(), EMAIL_DOMAIN: 'in.wafra.test' };
    const me = await pairDevice(env);

    const caps = await call(env, 'GET', '/v1/import/capabilities', { token: me.adminToken });
    ok('import: capabilities are admin-only and describe both supplements',
      caps.status === 200 && (await caps.json()).pdf.enabled === true);
    ok('import: capabilities are not readable with the ingest token',
      (await call(env, 'GET', '/v1/import/capabilities', { token: me.ingestToken })).status === 401);

    const minted = await call(env, 'POST', '/v1/email-token', { token: me.adminToken });
    const email = await minted.json();
    ok('email: an admin mints a forwarding address',
      minted.status === 201 && email.forwardingAddress === `${email.emailToken}@in.wafra.test`);
    // A separate scoped credential because SMTP headers expose the destination
    // address outside the app/relay TLS connection: it must not be the token
    // that can also read the queue.
    ok('email: the forwarding credential cannot read the queue',
      (await call(env, 'GET', '/v1/sync', { token: email.emailToken })).status === 401);
    ok('email: only its digest is stored', !dumpDb(env.DB).includes(email.emailToken));

    const forwarded = await call(env, 'POST', '/v1/email/ingest', {
      token: email.emailToken, body: { text: AE_PURCHASE },
    });
    ok('email: a forwarded bank alert is accepted', forwarded.status === 202);
    ok('email: and the message text is still nowhere in the database',
      !dumpDb(env.DB).includes('ARABICA'));
    const emailRow = (await syncOpened(env, me)).rows.at(-1);
    ok('email: the row is labelled as having come from email',
      emailRow.captureSource === 'email' && emailRow.amountFils === 4000,
      JSON.stringify(emailRow));
    ok('email: an empty forward is refused',
      (await call(env, 'POST', '/v1/email/ingest', { token: email.emailToken, body: { text: '' } }))
        .status === 400);

    const revoked = await call(env, 'DELETE', '/v1/email-token', { token: me.adminToken });
    ok('email: the address can be revoked', revoked.status === 204);
    ok('email: and the revoked address stops accepting mail',
      (await call(env, 'POST', '/v1/email/ingest', {
        token: email.emailToken, body: { text: AE_PURCHASE },
      })).status === 401);

    ok('pdf: a body that is not declared as a PDF is refused before it is read',
      (await call(env, 'POST', '/v1/import/pdf', {
        token: me.adminToken, headers: { 'content-type': 'application/json' }, body: { x: 1 },
      })).status === 415);
    ok('pdf: something that is not a PDF is refused on its header bytes',
      (await call(env, 'POST', '/v1/import/pdf', {
        token: me.adminToken, headers: { 'content-type': 'application/pdf' }, body: 'not a pdf',
      })).status === 400);
    ok('pdf: the ingest token cannot upload a statement',
      (await call(env, 'POST', '/v1/import/pdf', {
        token: me.ingestToken, headers: { 'content-type': 'application/pdf' }, body: '%PDF-1.4',
      })).status === 401);

    // Email forwarding is off unless the operator configured a domain, and the
    // route says so rather than minting an address that can never receive mail.
    const noDomain = { DB: makeDb() };
    const solo = await pairDevice(noDomain);
    ok('email: an unconfigured relay refuses to mint an address',
      (await call(noDomain, 'POST', '/v1/email-token', { token: solo.adminToken })).status === 503);
  }

  /* ═════════════════ Routing, and the scheduled sweep ═════════════════ */

  {
    const env = { DB: makeDb() };
    const health = await call(env, 'GET', '/v1/health');
    ok('health: 200 and ok', health.status === 200 && (await health.json()).ok === true);
    ok('routing: an unknown path is 404', (await call(env, 'GET', '/v1/nope')).status === 404);
    ok('routing: the right path with the wrong method is 404',
      (await call(env, 'GET', '/v1/pair')).status === 404);
    ok('routing: there is no route that hands back the queue unauthenticated',
      (await call(env, 'GET', '/v1/queue')).status === 404);
    ok('routing: responses are not cached and not content-sniffed',
      health.headers.get('cache-control') === 'no-store' &&
        health.headers.get('x-content-type-options') === 'nosniff');

    const me = await pairDevice(env);
    await call(env, 'POST', '/v1/ingest', { token: me.ingestToken, body: { text: AE_PURCHASE } });

    // The retention promise in server/README.md is enforced here rather than
    // left to a client remembering to acknowledge.
    env.DB.handle.prepare('UPDATE queue SET created_at = unixepoch() - ?').run(31 * 86_400);
    env.DB.handle.prepare('UPDATE devices SET last_seen = unixepoch() - ?').run(400 * 86_400);
    await worker.scheduled({ scheduledTime: Date.now(), cron: '17 3 * * *' }, env);
    ok('cron: sweeps queue rows past the retention ceiling', count(env.DB, 'queue') === 0);
    ok('cron: drops devices that have been silent for a year', count(env.DB, 'devices') === 0);
    ok('cron: and collects the vault they were the last member of',
      count(env.DB, 'vaults') === 0);

    // A silent device with rows still waiting is NOT dropped: deleting it would
    // destroy a queue the phone is still entitled to collect.
    const env2 = { DB: makeDb() };
    const quiet = await pairDevice(env2);
    await call(env2, 'POST', '/v1/ingest', { token: quiet.ingestToken, body: { text: AE_PURCHASE } });
    env2.DB.handle.prepare('UPDATE devices SET last_seen = unixepoch() - ?').run(400 * 86_400);
    await worker.scheduled({ scheduledTime: Date.now(), cron: '17 3 * * *' }, env2);
    ok('cron: a silent device with rows still waiting is kept', count(env2.DB, 'devices') === 1);
  }

  console.log(`\n${pass} passed, ${fail} failed`);
  process.exit(fail ? 1 : 0);
})().catch((e) => {
  console.error(e);
  process.exit(1);
});
