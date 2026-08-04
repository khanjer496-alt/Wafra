// Relay tests.
//
// Two things are asserted here that nothing else can catch.
//
// THE SEAL MUST ROUND-TRIP. A sealed row the phone cannot open would look
// exactly like a working service right up until a user tried to sync. Node's
// WebCrypto implements X25519 the same way Workers do, so server/src/crypto.ts
// runs here unmodified — and the device side is not reimplemented: these tests
// require the REAL src/lib/relay-crypto.ts that ships in the app, so a change
// to either half that breaks the other fails right here.
//
// THE ROUTES MUST BEHAVE. The Worker used to have zero route tests, which left
// auth, rate limiting, the 204 not-a-transaction path and the sync/ack
// contract entirely unverified. The handler exercised below is the real
// `export default { fetch }` from server/src/index.ts, driven against a real
// SQLite database created from the real schema.sql — no route logic is
// stubbed, only the D1 binding's method names are adapted.
const { webcrypto } = require('crypto');
globalThis.crypto = webcrypto;

const { DatabaseSync } = require('node:sqlite');
const { readFileSync } = require('node:fs');

// require.resolve rather than __dirname: it resolves relative to this module
// no matter where node was invoked from, and it is the one path helper the
// lint config's globals allow here.
const SCHEMA_PATH = require.resolve('../../server/schema.sql');

const { seal, hashToken, randomToken, timingSafeEqual, b64decode, b64encode, b64url } =
  require('./build/crypto');
const { deviceKeypair, openSealed, encodeKey, decodeKey } = require('./build/relay-crypto.mjs');
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
 * `unixepoch()` and the `?1` numbered placeholders. That matters — a
 * hand-rolled query matcher would happily pass while the real statement was
 * malformed.
 */
function makeDb() {
  const db = new DatabaseSync(':memory:');
  db.exec(readFileSync(SCHEMA_PATH, 'utf8'));
  const statement = (sql, params = []) => ({
    bind: (...values) => statement(sql, values),
    first: async () => db.prepare(sql).get(...params) ?? null,
    all: async () => ({ results: db.prepare(sql).all(...params) }),
    run: async () => db.prepare(sql).run(...params),
  });
  return {
    handle: db,
    prepare: (sql) => statement(sql),
    batch: async (statements) => {
      for (const s of statements) await s.run();
    },
  };
}

/** Every byte the database holds, for the "nothing readable is stored" checks. */
function dumpDb(db) {
  return JSON.stringify([
    db.handle.prepare('SELECT * FROM devices').all(),
    db.handle.prepare('SELECT * FROM queue').all(),
  ]);
}

const ORIGIN = 'https://relay.test';

function call(env, method, path, { token, body, headers } = {}) {
  const init = { method, headers: { ...headers } };
  if (body !== undefined) {
    init.body = typeof body === 'string' ? body : JSON.stringify(body);
    init.headers['content-type'] = 'application/json';
  }
  if (token) init.headers.authorization = `Bearer ${token}`;
  return worker.fetch(new Request(`${ORIGIN}${path}`, init), env);
}

async function pairDevice(env, market) {
  const keypair = deviceKeypair(webcrypto.getRandomValues(new Uint8Array(32)));
  const res = await call(env, 'POST', '/v1/pair', {
    body: { publicKey: encodeKey(keypair.publicKey), ...(market ? { market } : {}) },
  });
  return { keypair, res, ...(await res.json()) };
}

/** Collect a device's queue and open it with the shipping client code. */
async function syncOpened(env, device) {
  const res = await call(env, 'GET', '/v1/sync', { token: device.token });
  const { items } = await res.json();
  return { items, rows: items.map((i) => openSealed(device.keypair.secretKey, i)) };
}

/* Messages chosen because each one proves a different route behaviour, rather
 * than just "a transaction happened". */
const AE_PURCHASE =
  'Purchase of AED 40.00 with Debit Card ending 4733 at % ARABICA, DUBAI. Avl Balance is AED 7,476.59.';
const AE_LIMIT_CARD =
  'Purchase of AED 250.00 with Card ending 8821 at CARREFOUR DUBAI. Available Limit is AED 4,000.00.';
const SA_PURCHASE =
  'Purchase of SAR 45.00 with Card ending 1234 at PANDA RIYADH. Available balance SAR 900.00';
const NOT_A_TRANSACTION = 'Your OTP is 483920. Do not share it with anyone.';

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

  // Non-ASCII merchant names are the norm on an Arabic-locale handset, and a
  // UTF-8 mistake in either half would surface as mojibake in the ledger.
  const arabic = { merchant: 'كارفور دبي', amountFils: 18750 };
  ok('seal: an Arabic merchant name survives the round trip',
    openSealed(device.secretKey, await seal(pub, arabic)).merchant === arabic.merchant);

  // Every seal uses a fresh ephemeral key, so identical rows must not produce
  // identical ciphertext — otherwise the database leaks which charges repeat.
  const again = await seal(pub, payload);
  ok('seal: the same payload seals differently each time', again.ct !== blob.ct);

  // A different device must not be able to open it.
  const other = deviceKeypair(webcrypto.getRandomValues(new Uint8Array(32)));
  let denied = false;
  try { openSealed(other.secretKey, blob); } catch { denied = true; }
  ok('seal: another device cannot open it', denied);

  // Tampering must fail rather than silently decode — GCM's whole job.
  const bad = { ...blob, ct: b64encode((() => {
    const b = b64decode(blob.ct); b[0] ^= 0xff; return b;
  })()) };
  let rejected = false;
  try { openSealed(device.secretKey, bad); } catch { rejected = true; }
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

  /* ═══════════════════════ Tokens ═══════════════════════ */

  const t = randomToken();
  ok('token: url-safe and long enough', /^[A-Za-z0-9_-]{40,}$/.test(t), t);
  ok('token: two tokens differ', randomToken() !== randomToken());
  ok('token: hash is stable', (await hashToken(t)) === (await hashToken(t)));
  ok('token: hash is not the token', (await hashToken(t)) !== t);
  ok('compare: equal strings match', timingSafeEqual('abc', 'abc'));
  ok('compare: different strings do not', !timingSafeEqual('abc', 'abd'));
  ok('compare: different lengths do not', !timingSafeEqual('abc', 'abcd'));
  ok('b64url: no padding and no url-unsafe characters',
    /^[A-Za-z0-9_-]+$/.test(b64url(await crypto.subtle.digest('SHA-256', enc.encode('x')))));

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

    const paired = await pairDevice(env);
    ok('pair: returns a device id, a token and an ingest url',
      paired.res.status === 200 && !!paired.deviceId && !!paired.token &&
      paired.ingestUrl === `${ORIGIN}/v1/ingest`);
    ok('pair: defaults to the AE market pack', paired.market === 'AE');

    const sa = await pairDevice(env, 'SA');
    ok('pair: honours the market pack the device asked for', sa.market === 'SA');
    const bogus = await pairDevice(env, 'ZZ');
    ok('pair: falls back to AE for a market the app has no pack for', bogus.market === 'AE');
    ok('pair: two devices get different tokens', paired.token !== sa.token);

    const stored = env.DB.handle.prepare('SELECT token_hash FROM devices').all();
    ok('pair: the token is stored as a digest, never in the clear',
      stored.length === 3 && !stored.some((r) => r.token_hash === paired.token));
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
        headers: { authorization: `Basic ${me.token}` }, body: { text: AE_PURCHASE },
      })).status === 401);

    // ── Body handling ──
    ok('ingest: rejects an empty message',
      (await call(env, 'POST', '/v1/ingest', { token: me.token, body: { text: '   ' } })).status === 400);
    ok('ingest: rejects a body with no text at all',
      (await call(env, 'POST', '/v1/ingest', { token: me.token, body: { sender: 'ADIB' } })).status === 400);
    ok('ingest: refuses an oversized body',
      (await call(env, 'POST', '/v1/ingest', { token: me.token, body: 'x'.repeat(9000) })).status === 413);
    ok('ingest: refuses an oversized body on the declared length alone',
      (await call(env, 'POST', '/v1/ingest', {
        token: me.token, headers: { 'content-length': '99999' }, body: { text: AE_PURCHASE },
      })).status === 413);

    // Shortcuts is fiddly about JSON, so a bare text body is accepted too.
    ok('ingest: accepts a bare (non-JSON) message body',
      (await call(env, 'POST', '/v1/ingest', { token: me.token, body: AE_PURCHASE })).status === 202);

    // ── The 204 path ──
    const otp = await call(env, 'POST', '/v1/ingest', {
      token: me.token, body: { text: NOT_A_TRANSACTION },
    });
    ok('ingest: a message that is not a transaction is 204',
      otp.status === 204 && (await otp.text()) === '');
    ok('ingest: the 204 path really did store nothing',
      env.DB.handle.prepare('SELECT COUNT(*) n FROM queue').get().n === 1);

    // ── The database holds nothing readable ──
    ok('ingest: the message text is nowhere in the database',
      !dumpDb(env.DB).includes('ARABICA') && !dumpDb(env.DB).includes('Avl Balance'));

    // ── Sender attribution ──
    //
    // This is what makes an iOS card branded instead of grey: no UAE bank but
    // HSBC names itself in the body, so without the sender the parser cannot
    // tell an Islamic issuer's "Card" (a CREDIT card quoting a limit) from a
    // conventional bank's debit card.
    await call(env, 'POST', '/v1/ingest', {
      token: me.token, body: { text: AE_LIMIT_CARD, sender: 'ADIB' },
    });
    const synced = await syncOpened(env, me);
    const withSender = synced.rows.find((r) => r.amountFils === 25000);
    ok('ingest: the sender is carried into the sealed row', withSender?.sender === 'ADIB');
    ok('ingest: the sender changes how the message parses',
      withSender?.card?.kind === 'credit', JSON.stringify(withSender?.card));
    ok('ingest: the sender is not stored outside the seal', !dumpDb(env.DB).includes('ADIB'));

    const noSender = await pairDevice(env);
    await call(env, 'POST', '/v1/ingest', { token: noSender.token, body: { text: AE_LIMIT_CARD } });
    const plain = (await syncOpened(env, noSender)).rows[0];
    ok('ingest: without a sender the same message reads as a debit card',
      plain.card.kind === 'debit' && plain.sender === undefined);

    ok('ingest: a sender longer than any real sender id is truncated, not stored whole',
      await (async () => {
        const long = await pairDevice(env);
        await call(env, 'POST', '/v1/ingest', {
          token: long.token, body: { text: AE_PURCHASE, sender: 'A'.repeat(500) },
        });
        return (await syncOpened(env, long)).rows[0].sender.length === 64;
      })());

    // ── Timestamps ──
    const when = '2026-07-02T09:15:00.000Z';
    const stamped = await pairDevice(env);
    await call(env, 'POST', '/v1/ingest', {
      token: stamped.token, body: { text: AE_PURCHASE, receivedAt: when },
    });
    const stampedRow = (await syncOpened(env, stamped)).rows[0];
    ok('ingest: the message timestamp is honoured', stampedRow.receivedAt === when);
    ok('ingest: the timestamp is also carried as epoch ms for the dedupe key',
      stampedRow.smsTs === Date.parse(when));

    const skewed = await pairDevice(env);
    for (const value of ['2099-01-01T00:00:00.000Z', 'not a date', null, '1990-01-01T00:00:00Z']) {
      await call(env, 'POST', '/v1/ingest', {
        token: skewed.token, body: { text: AE_PURCHASE, receivedAt: value },
      });
    }
    const skewedRows = (await syncOpened(env, skewed)).rows;
    ok('ingest: an implausible timestamp falls back to now rather than being trusted',
      skewedRows.length === 4 && skewedRows.every((r) => Math.abs(r.smsTs - Date.now()) < 60_000));

    // ── Message identity ──
    //
    // The timestamp fingerprint is the app's strong duplicate guard, but a
    // Shortcut retry can carry a drifted clock. The digest does not drift.
    const ided = await pairDevice(env);
    await call(env, 'POST', '/v1/ingest', {
      token: ided.token, body: { text: AE_PURCHASE, receivedAt: '2026-07-02T09:15:00.000Z' },
    });
    await call(env, 'POST', '/v1/ingest', {
      token: ided.token, body: { text: AE_PURCHASE, receivedAt: '2026-07-02T09:15:41.000Z' },
    });
    await call(env, 'POST', '/v1/ingest', { token: ided.token, body: { text: AE_LIMIT_CARD } });
    const idedRows = (await syncOpened(env, ided)).rows;
    ok('ingest: the same text yields the same message id despite a drifted clock',
      idedRows[0].msgId === idedRows[1].msgId && idedRows[0].smsTs !== idedRows[1].smsTs);
    ok('ingest: a different message yields a different message id',
      idedRows[2].msgId !== idedRows[0].msgId);
    ok('ingest: the message id is a base64url digest, not the text',
      /^[A-Za-z0-9_-]{43}$/.test(idedRows[0].msgId));
  }

  /* ═════════════════ Route: the market pack drives parsing ═════════════════ */

  {
    const env = { DB: makeDb() };
    const ae = await pairDevice(env, 'AE');
    const sa = await pairDevice(env, 'SA');

    await call(env, 'POST', '/v1/ingest', { token: ae.token, body: { text: SA_PURCHASE } });
    await call(env, 'POST', '/v1/ingest', { token: sa.token, body: { text: SA_PURCHASE } });

    const aeRow = (await syncOpened(env, ae)).rows[0];
    const saRow = (await syncOpened(env, sa)).rows[0];

    // The same message, two packs. Under AE the SAR amount is misread and the
    // merchant means nothing; under SA it is 45.00 at a supermarket. This is
    // what the hardcoded default cost every non-UAE user.
    ok('market: an SA device reads SAR 45.00 correctly', saRow.amountFils === 4500);
    ok('market: the AE pack misreads the same message',
      aeRow.amountFils !== 4500, `AE read ${aeRow.amountFils}`);
    ok('market: the SA pack applies its own category vocabulary',
      saRow.categoryGuess === 'groceries' && aeRow.categoryGuess !== 'groceries');
    ok('market: the row records which pack parsed it',
      saRow.market === 'SA' && aeRow.market === 'AE');

    // PATCH, not re-pair: re-pairing would mint a new token and orphan the one
    // baked into the user's Shortcut.
    ok('market: rejects a market the app has no pack for',
      (await call(env, 'PATCH', '/v1/device', { token: ae.token, body: { market: 'ZZ' } })).status === 400);
    ok('market: rejects a missing market',
      (await call(env, 'PATCH', '/v1/device', { token: ae.token, body: {} })).status === 400);
    ok('market: rejects an unauthenticated change',
      (await call(env, 'PATCH', '/v1/device', { body: { market: 'SA' } })).status === 401);

    const patched = await call(env, 'PATCH', '/v1/device', {
      token: ae.token, body: { market: 'sa' },
    });
    ok('market: accepts a change and normalises the case',
      patched.status === 200 && (await patched.json()).market === 'SA');

    await call(env, 'POST', '/v1/ingest', { token: ae.token, body: { text: SA_PURCHASE } });
    const afterPatch = (await syncOpened(env, ae)).rows.at(-1);
    ok('market: the change takes effect on the next message',
      afterPatch.amountFils === 4500 && afterPatch.market === 'SA');
  }

  /* ═══════════════════════ Route: rate limiting ═══════════════════════ */

  {
    const env = { DB: makeDb() };
    const me = await pairDevice(env);
    const other = await pairDevice(env);
    // 300 real ingests would be 300 X25519 seals; the limiter counts queue rows
    // in the last hour, so the rows are planted directly.
    const insert = env.DB.handle.prepare(
      'INSERT INTO queue (id, device_id, epk, iv, ct, created_at) VALUES (?, ?, ?, ?, ?, unixepoch())',
    );
    for (let i = 0; i < 300; i++) insert.run(`plant-${i}`, me.deviceId, 'e', 'i', 'c');

    ok('rate limit: refuses once the hourly ceiling is reached',
      (await call(env, 'POST', '/v1/ingest', { token: me.token, body: { text: AE_PURCHASE } }))
        .status === 429);
    ok('rate limit: is per device, not global',
      (await call(env, 'POST', '/v1/ingest', { token: other.token, body: { text: AE_PURCHASE } }))
        .status === 202);

    // Rows older than the window must stop counting, or one busy day would lock
    // a device out permanently.
    env.DB.handle
      .prepare('UPDATE queue SET created_at = unixepoch() - 7200 WHERE id LIKE ?')
      .run('plant-%');
    ok('rate limit: the window slides — old rows stop counting',
      (await call(env, 'POST', '/v1/ingest', { token: me.token, body: { text: AE_PURCHASE } }))
        .status === 202);
  }

  /* ═════════════════ Routes: /v1/sync and /v1/ack ═════════════════ */

  {
    const env = { DB: makeDb() };
    const me = await pairDevice(env);
    const nosy = await pairDevice(env);

    ok('sync: rejects a request with no token',
      (await call(env, 'GET', '/v1/sync')).status === 401);
    ok('ack: rejects a request with no token',
      (await call(env, 'POST', '/v1/ack', { body: { ids: ['x'] } })).status === 401);

    const emptySync = await call(env, 'GET', '/v1/sync', { token: me.token });
    ok('sync: an empty queue is an empty list, not an error',
      emptySync.status === 200 && (await emptySync.json()).items.length === 0);

    await call(env, 'POST', '/v1/ingest', {
      token: me.token, body: { text: AE_PURCHASE, sender: 'ADIB' },
    });
    await call(env, 'POST', '/v1/ingest', {
      token: me.token, body: { text: AE_LIMIT_CARD, sender: 'ADIB' },
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

    // Pull-then-acknowledge: a dropped response must lose nothing.
    const second = await call(env, 'GET', '/v1/sync', { token: me.token });
    ok('sync: rows are NOT deleted on read', (await second.json()).items.length === 2);

    ok('sync: another device sees none of these rows',
      (await (await call(env, 'GET', '/v1/sync', { token: nosy.token })).json()).items.length === 0);

    ok('ack: rejects an empty id list',
      (await call(env, 'POST', '/v1/ack', { token: me.token, body: { ids: [] } })).status === 400);
    ok('ack: rejects a non-array',
      (await call(env, 'POST', '/v1/ack', { token: me.token, body: { ids: 'all' } })).status === 400);
    ok('ack: refuses more ids than a sync can return',
      (await call(env, 'POST', '/v1/ack', {
        token: me.token, body: { ids: Array.from({ length: 201 }, (_, i) => `${i}`) },
      })).status === 400);

    // A device must not be able to clear someone else's queue by guessing ids.
    await call(env, 'POST', '/v1/ack', {
      token: nosy.token, body: { ids: first.items.map((i) => i.id) },
    });
    ok("ack: cannot acknowledge another device's rows",
      (await (await call(env, 'GET', '/v1/sync', { token: me.token })).json()).items.length === 2);

    const acked = await call(env, 'POST', '/v1/ack', {
      token: me.token, body: { ids: [first.items[0].id] },
    });
    ok('ack: returns 204', acked.status === 204);
    const afterAck = await (await call(env, 'GET', '/v1/sync', { token: me.token })).json();
    ok('ack: deletes exactly the rows named',
      afterAck.items.length === 1 && afterAck.items[0].id === first.items[1].id);

    // The 72-hour ceiling is enforced on sync as well as by the nightly cron.
    env.DB.handle.prepare('UPDATE queue SET created_at = unixepoch() - ?').run(80 * 3600);
    ok('sync: rows past the 72-hour ceiling are swept',
      (await (await call(env, 'GET', '/v1/sync', { token: me.token })).json()).items.length === 0);
  }

  /* ═════════════════ Route: /v1/device (unpair) ═════════════════ */

  {
    const env = { DB: makeDb() };
    const me = await pairDevice(env);
    const survivor = await pairDevice(env);
    await call(env, 'POST', '/v1/ingest', { token: me.token, body: { text: AE_PURCHASE } });
    await call(env, 'POST', '/v1/ingest', { token: survivor.token, body: { text: AE_PURCHASE } });

    ok('unpair: rejects a request with no token',
      (await call(env, 'DELETE', '/v1/device')).status === 401);

    const gone = await call(env, 'DELETE', '/v1/device', { token: me.token });
    ok('unpair: returns 204', gone.status === 204);
    ok('unpair: the token stops working immediately',
      (await call(env, 'GET', '/v1/sync', { token: me.token })).status === 401);
    ok('unpair: the device row is gone',
      env.DB.handle.prepare('SELECT COUNT(*) n FROM devices').get().n === 1);
    ok('unpair: the queued rows go with it',
      env.DB.handle.prepare('SELECT COUNT(*) n FROM queue').get().n === 1);
    ok('unpair: another device is untouched',
      (await (await call(env, 'GET', '/v1/sync', { token: survivor.token })).json()).items.length === 1);
  }

  /* ═════════════════ Routing and the nightly cron ═════════════════ */

  {
    const env = { DB: makeDb() };
    const health = await call(env, 'GET', '/v1/health');
    ok('health: 200 and ok', health.status === 200 && (await health.json()).ok === true);
    ok('routing: an unknown path is 404', (await call(env, 'GET', '/v1/nope')).status === 404);
    ok('routing: the right path with the wrong method is 404',
      (await call(env, 'GET', '/v1/pair')).status === 404);
    ok('routing: there is no route that hands back the queue unauthenticated',
      (await call(env, 'GET', '/v1/queue')).status === 404);

    const me = await pairDevice(env);
    await call(env, 'POST', '/v1/ingest', { token: me.token, body: { text: AE_PURCHASE } });
    env.DB.handle.prepare('UPDATE queue SET created_at = unixepoch() - ?').run(80 * 3600);
    env.DB.handle.prepare('UPDATE devices SET last_seen = unixepoch() - ?').run(400 * 86400);
    await worker.scheduled({ scheduledTime: Date.now(), cron: '17 3 * * *' }, env);
    ok('cron: sweeps expired queue rows',
      env.DB.handle.prepare('SELECT COUNT(*) n FROM queue').get().n === 0);
    ok('cron: drops devices that have been silent for a year',
      env.DB.handle.prepare('SELECT COUNT(*) n FROM devices').get().n === 0);
  }

  console.log(`\n${pass} passed, ${fail} failed`);
  process.exit(fail ? 1 : 0);
})().catch((e) => {
  console.error(e);
  process.exit(1);
});
