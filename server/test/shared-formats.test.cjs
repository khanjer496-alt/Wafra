// /v1/formats/* and /v1/admin/formats* through the real Worker, against a real
// SQLite database built from schema.sql plus every migration (D1 IS SQLite).
const fs = require('node:fs');
const path = require('node:path');
const { webcrypto } = require('node:crypto');
const { DatabaseSync } = require('node:sqlite');

globalThis.crypto ??= webcrypto;
const worker = require('../.test-build/worker.cjs').default;

let passed = 0;
let failed = 0;
function ok(name, condition, detail = '') {
  if (condition) {
    passed += 1;
    console.log(`\u2713 ${name}`);
  } else {
    failed += 1;
    console.log(`\u2717 ${name}${detail ? ` \u00b7 ${detail}` : ''}`);
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


function call(env, method, pathname, { token, body, headers = {} } = {}) {
  const init = { method, headers: { ...headers } };
  if (body !== undefined) {
    init.body = typeof body === 'string' ? body : JSON.stringify(body);
    init.headers['content-type'] ??= 'application/json';
  }
  if (token) init.headers.authorization = `Bearer ${token}`;
  return worker.fetch(new Request(`https://relay.test${pathname}`, init), env);
}

const b64 = (bytes) => Buffer.from(bytes).toString('base64');
async function publicKey() {
  const keys = await webcrypto.subtle.generateKey({ name: 'X25519' }, true, ['deriveBits']);
  return b64(await webcrypto.subtle.exportKey('raw', keys.publicKey));
}
// Votes count only from vaults at least a day old; most cases want an
// established vault, so pairing back-dates it unless `fresh` is asked for.
async function pair(env, { fresh = false } = {}) {
  const res = await call(env, 'POST', '/v1/pair', { body: { publicKey: await publicKey() } });
  const device = await res.json();
  if (!fresh) {
    env.DB.handle.prepare(
      'UPDATE vaults SET created_at = created_at - 172800 WHERE id = (SELECT vault_id FROM devices WHERE id = ?)',
    ).run(device.deviceId);
  }
  return device;
}
async function joinSameVault(env, owner) {
  const invite = await (await call(env, 'POST', '/v1/device-invites', { token: owner.adminToken })).json();
  const res = await call(env, 'POST', '/v1/join', {
    body: { publicKey: await publicKey(), inviteToken: invite.inviteToken, deviceName: 'Second phone' },
  });
  return res.json();
}

const shape = (overrides = {}) => ({
  v: 1,
  sender: 'ACMEBANK',
  direction: 'debit',
  currency: 'USD',
  aliases: { usd: 'USD' },
  dateOrder: null,
  advisory: false,
  tokens: [
    { k: 'L', v: 'Purchase of ' },
    { k: 'AMT' },
    { k: 'L', v: ' at ' },
    { k: 'MER' },
  ],
  ...overrides,
});
const submit = (env, who, body) => call(env, 'POST', '/v1/formats/submit', { token: who.syncToken, body });
const sha = (text) => require('node:crypto').createHash('sha256').update(text).digest('hex');
const canonical = (value) => Array.isArray(value)
  ? `[${value.map(canonical).join(',')}]`
  : value && typeof value === 'object'
    ? `{${Object.keys(value).sort().map((k) => `${JSON.stringify(k)}:${canonical(value[k])}`).join(',')}}`
    : JSON.stringify(value);
const rows = (env, sql, ...params) => ({ results: env.DB.handle.prepare(sql).all(...params) });

(async () => {
  /* ─────────────────────────── validation ─────────────────────────── */
  {
    const env = { DB: makeDb() };
    const me = await pair(env);
    const reject = async (name, bad) => {
      const res = await submit(env, me, { shape: bad });
      ok(name, res.status === 400 && (await res.json()).error === 'invalid_shape');
    };
    await reject('unknown top-level key is refused', { ...shape(), note: 'x' });
    await reject('unknown token key is refused', shape({ tokens: [{ k: 'AMT', extra: 1 }] }));
    await reject('a digit in a literal is refused', shape({ tokens: [{ k: 'L', v: 'Card 1234 ' }, { k: 'AMT' }] }));
    await reject('an @ in a literal is refused', shape({ tokens: [{ k: 'L', v: 'mail a@b ' }, { k: 'AMT' }] }));
    await reject('a URL in a literal is refused', shape({ tokens: [{ k: 'L', v: 'see www.x.com ' }, { k: 'AMT' }] }));
    await reject('a phone-number sender is refused', shape({ sender: '+971 50 123 4567' }));
    await reject('an email sender is refused', shape({ sender: 'a@b.com' }));
    await reject('two AMT slots are refused', shape({ tokens: [{ k: 'AMT' }, { k: 'L', v: ' ' }, { k: 'AMT' }] }));
    await reject('no AMT slot is refused', shape({ tokens: [{ k: 'L', v: 'hello' }] }));
    await reject('alias that is not the currency is refused', shape({ aliases: { eur: 'EUR' } }));
    await reject('bad currency is refused', shape({ currency: 'usd' }));
    await reject('bad version is refused', shape({ v: 2 }));
    await reject('oversized canonical JSON is refused', shape({
      tokens: [{ k: 'AMT' }, ...Array.from({ length: 100 }, () => ({ k: 'L', v: 'x'.repeat(100) }))],
    }));
    const noShape = await call(env, 'POST', '/v1/formats/submit', { token: me.syncToken, body: '{' });
    ok('malformed JSON is invalid_shape', noShape.status === 400);
    ok('nothing was stored by rejected submissions', rows(env, 'SELECT * FROM shared_format_shapes').results.length === 0);
  }

  /* ─────────────────────────── auth ─────────────────────────── */
  {
    const env = { DB: makeDb() };
    const me = await pair(env);
    const anon = await call(env, 'POST', '/v1/formats/submit', { body: { shape: shape() } });
    ok('unauthenticated submit is 401', anon.status === 401);
    const wrongScope = await call(env, 'POST', '/v1/formats/submit', { token: me.ingestToken, body: { shape: shape() } });
    ok('an ingest-scope token cannot submit', wrongScope.status === 401);
    const published = await call(env, 'GET', '/v1/formats/published');
    ok('published list needs no auth', published.status === 200);
  }

  /* ─────────────── k = 3 distinct vaults, hash, privacy ─────────────── */
  {
    const env = { DB: makeDb() };
    const a = await pair(env);
    const a2 = await joinSameVault(env, a);
    const b = await pair(env);
    const c = await pair(env);

    const reordered = JSON.parse(JSON.stringify(shape()));
    const flipped = Object.fromEntries(Object.entries(reordered).reverse());
    ok('canonical hash is stable across key order',
      sha(canonical(shape())) === sha(canonical(flipped)));

    const first = await submit(env, a, { shape: shape() });
    ok('first vault: pending', (await first.json()).status === 'pending');
    const again = await submit(env, a2, { shape: flipped });
    ok('a second device in the SAME vault (keys reordered) does not count',
      (await again.json()).status === 'pending');
    const stored = rows(env, 'SELECT * FROM shared_format_shapes').results;
    ok('one shape row, hash matches the server-computed canonical hash, 1 vault',
      stored.length === 1 && stored[0].shape_hash === sha(canonical(shape())) && stored[0].vault_count === 1);
    ok('votes are keyed by a hash, not the vault id',
      rows(env, 'SELECT vault_hash FROM shared_format_votes').results.every((r) => /^[0-9a-f]{64}$/.test(r.vault_hash) && r.vault_hash !== a.vaultId));

    const second = await submit(env, b, { shape: shape() });
    ok('second distinct vault: still pending', (await second.json()).status === 'pending');
    const list2 = await (await call(env, 'GET', '/v1/formats/published')).json();
    ok('not published at 2 vaults', list2.formats.length === 0);

    const third = await submit(env, c, { shape: shape() });
    ok('third distinct vault publishes', (await third.json()).status === 'published');
    const list3 = await (await call(env, 'GET', '/v1/formats/published')).json();
    ok('published list returns {hash, shape}',
      list3.formats.length === 1 && list3.formats[0].hash === stored[0].shape_hash &&
        canonical(list3.formats[0].shape) === canonical(shape()));
    ok('response bodies carry only the status',
      JSON.stringify(await (await submit(env, c, { shape: shape() })).json()) === '{"status":"published"}');

    /* ETag / 304 */
    const res = await call(env, 'GET', '/v1/formats/published');
    const etag = res.headers.get('etag');
    ok('published has ETag and public cache-control',
      !!etag && res.headers.get('cache-control') === 'public, max-age=3600');
    const notModified = await call(env, 'GET', '/v1/formats/published', { headers: { 'if-none-match': etag } });
    ok('If-None-Match with the current ETag is 304', notModified.status === 304);
    const stale = await call(env, 'GET', '/v1/formats/published', { headers: { 'if-none-match': '"nope"' } });
    ok('a stale ETag gets the full body', stale.status === 200 && (await stale.json()).formats.length === 1);

    /* admin */
    const hash = stored[0].shape_hash;
    const adminEnv = { ...env, FORMATS_ADMIN_TOKEN: 'admin-secret-for-tests' };
    const unset = await call(env, 'GET', '/v1/admin/formats', { token: 'admin-secret-for-tests' });
    ok('admin list is 404 when the secret is unset', unset.status === 404);
    const unsetBlock = await call(env, 'POST', '/v1/admin/formats/block', { token: 'x', body: { hash } });
    ok('admin block is 404 when the secret is unset', unsetBlock.status === 404);
    ok('admin list is 404 without a token', (await call(adminEnv, 'GET', '/v1/admin/formats')).status === 404);
    ok('admin list is 404 with a wrong token', (await call(adminEnv, 'GET', '/v1/admin/formats', { token: 'wrong' })).status === 404);
    ok('admin block is 404 with a wrong token', (await call(adminEnv, 'POST', '/v1/admin/formats/block', { token: 'wrong', body: { hash } })).status === 404);
    ok('a device token is not an admin token', (await call(adminEnv, 'GET', '/v1/admin/formats', { token: a.adminToken })).status === 404);
    ok('wrong token blocked nothing', rows(env, 'SELECT status FROM shared_format_shapes').results[0].status === 'published');

    const listing = await (await call(adminEnv, 'GET', '/v1/admin/formats', { token: 'admin-secret-for-tests' })).json();
    ok('admin list returns shapes with counts and status',
      listing.formats.length === 1 && listing.formats[0].hash === hash && listing.formats[0].vaultCount === 3 &&
        listing.formats[0].status === 'published' && listing.formats[0].sender === 'ACMEBANK');
    const badHash = await call(adminEnv, 'POST', '/v1/admin/formats/block', { token: 'admin-secret-for-tests', body: { hash: 'zz' } });
    ok('block rejects a malformed hash', badHash.status === 400);
    const unknown = await call(adminEnv, 'POST', '/v1/admin/formats/block', { token: 'admin-secret-for-tests', body: { hash: '0'.repeat(64) } });
    ok('block of an unknown hash is 404', unknown.status === 404);
    const blocked = await call(adminEnv, 'POST', '/v1/admin/formats/block', { token: 'admin-secret-for-tests', body: { hash } });
    ok('right token blocks the shape', blocked.status === 200 && (await blocked.json()).status === 'blocked');
    const afterBlock = await (await call(env, 'GET', '/v1/formats/published')).json();
    ok('blocked shape is removed from the published list', afterBlock.formats.length === 0);
    ok('ETag changes when the list changes', (await call(env, 'GET', '/v1/formats/published')).headers.get('etag') !== etag);
    const d = await pair(env);
    const resubmit = await submit(env, d, { shape: shape() });
    ok('a blocked shape answers blocked and is never published again',
      (await resubmit.json()).status === 'blocked' &&
        (await (await call(env, 'GET', '/v1/formats/published')).json()).formats.length === 0 &&
        rows(env, 'SELECT status, published_at FROM shared_format_shapes').results[0].published_at === null);
  }

  /* ─────────────────────────── rate limit ─────────────────────────── */
  {
    const env = { DB: makeDb() };
    const me = await pair(env);
    let last;
    for (let i = 0; i < 20; i += 1) {
      last = await submit(env, me, { shape: shape({ sender: `BANK${String.fromCharCode(65 + i)}` }) });
    }
    ok('20 distinct submissions a day are accepted', last.status === 200);
    const over = await submit(env, me, { shape: shape({ sender: 'BANKZ' }) });
    ok('the 21st in a day is 429 rate_limited', over.status === 429 && (await over.json()).error === 'rate_limited');
    const other = await pair(env);
    ok('another vault is unaffected', (await submit(env, other, { shape: shape({ sender: 'BANKZ' }) })).status === 200);
    env.DB.handle.prepare('UPDATE shared_format_votes SET created_at = created_at - 90000').run();
    ok('the window slides after a day', (await submit(env, me, { shape: shape({ sender: 'BANKY' }) })).status === 200);
  }

  /* ─────────────── review fixes: vault age, names, expiry, weak ETag, sender ─────────────── */
  {
    const env = { DB: makeDb() };
    const fresh = [await pair(env, { fresh: true }), await pair(env, { fresh: true }), await pair(env, { fresh: true })];
    for (const who of fresh) await submit(env, who, { shape: shape() });
    ok('three vaults paired today cannot publish a shape',
      rows(env, 'SELECT status, vault_count FROM shared_format_shapes').results
        .every((r) => r.status === 'pending' && r.vault_count === 0));
    env.DB.handle.prepare('UPDATE shared_format_votes SET counts_after = counts_after - 172800').run();
    const late = await pair(env);
    ok('their votes count once the vaults are a day old',
      (await (await submit(env, late, { shape: shape() })).json()).status === 'published');

    const name = await submit(env, late, {
      shape: shape({ tokens: [{ k: 'L', v: 'Dear ' }, { k: 'L', v: 'naser', m: 1 }, { k: 'L', v: ' spent ' }, { k: 'AMT' }] }),
    });
    ok('a flagged word that is not banking boilerplate is refused', name.status === 400);
    const boiler = await submit(env, late, {
      shape: shape({ tokens: [{ k: 'L', v: 'debited', m: 1 }, { k: 'L', v: ' ' }, { k: 'AMT' }] }),
    });
    ok('a flagged banking word is accepted', boiler.status === 200);
    const amp = await submit(env, late, { shape: shape({ sender: 'AT&T' }) });
    ok('a sender with & is accepted, as the app allows', amp.status === 200);
    const lower = await submit(env, late, { shape: shape({ sender: 'acmebank' }) });
    ok('a lower-case sender is refused, as the app normalises to upper case', lower.status === 400);
    const longWord = await submit(env, late, {
      shape: shape({ tokens: [{ k: 'L', v: 'x'.repeat(30) }, { k: 'AMT' }] }),
    });
    ok('a 24+ character word is refused', longWord.status === 400);

    env.DB.handle.prepare("UPDATE shared_format_shapes SET first_seen = first_seen - 31 * 86400 WHERE status = 'pending'").run();
    await submit(env, late, { shape: shape({ sender: 'NEWBANK' }) });
    const left = rows(env, 'SELECT bank_sender, status FROM shared_format_shapes').results;
    ok('pending shapes older than 30 days are deleted, published ones kept',
      left.every((r) => r.status === 'published' || r.bank_sender === 'NEWBANK') &&
        left.some((r) => r.status === 'published'));
    ok('their votes go with them',
      rows(env, 'SELECT COUNT(*) AS n FROM shared_format_votes WHERE shape_hash NOT IN (SELECT shape_hash FROM shared_format_shapes)').results[0].n === 0);

    const list = await call(env, 'GET', '/v1/formats/published');
    const etag = list.headers.get('etag');
    const weak = await call(env, 'GET', '/v1/formats/published', { headers: { 'if-none-match': `W/${etag}` } });
    ok('a weakened ETag from the CDN still gets 304', weak.status === 304);
  }

  console.log(`\n${passed} passed, ${failed} failed`);
  if (failed > 0) process.exit(1);
})().catch((error) => {
  console.error(error);
  process.exit(1);
});
