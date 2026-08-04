// The relay CLIENT.
//
// worker.test.js proves the service behaves. This proves the phone does — and
// it does it against the REAL src/lib/relay.ts, compiled by run.sh with the
// native surfaces (keychain, AsyncStorage, expo-crypto, app config) swapped for
// the stubs in ./stubs and nothing else changed. Every rule this file asserts
// is one that fails SILENTLY in production if it breaks:
//
//   • The key is reused across reinstalls. Re-pairing mints a new bearer token,
//     and the old one is baked into the user's Shortcut where no code can reach
//     it — capture would be dead while the app looked perfectly healthy.
//   • The keychain item is readable while the phone is locked. The
//     expo-secure-store default is WHEN_UNLOCKED, and nearly every sync happens
//     in a pocket. Wrong value, no error, permanently stale ledger.
//   • Rows are acknowledged only AFTER the ledger commit. Ack early and a crash
//     in between loses the transaction for good; the whole pull-then-ack design
//     exists for this.
//   • A duplicate never becomes a second entry, and a row that can never be
//     opened is acked rather than re-downloaded for three days.
//   • The background layer stages and stops. If it ever wrote the ledger it
//     would race StoreProvider's persister and lose.
//
// The last section runs the real Worker against a real SQLite database and
// drives the real client through it end to end: pair, a Shortcut POSTs a bank
// SMS, the phone collects it sealed, opens it, files it, acknowledges it. That
// is the one test that proves seal() and openSealed() agree in the direction
// that matters — on the actual wire, not on two libraries in isolation.
const { webcrypto } = require('crypto');
globalThis.crypto = webcrypto;

const { DatabaseSync } = require('node:sqlite');
const { readFileSync } = require('node:fs');

const SCHEMA_PATH = require.resolve('../../server/schema.sql');

const relay = require('./build/relay.cjs');
const { seal } = require('./build/crypto');
const { deviceKeypair, encodeKey, decodeKey } = require('./build/relay-crypto.cjs');
const { parseSms } = require('./build/sms-parser');
const secure = require('./build/stub-secure-store');
const storage = require('./build/stub-async-storage');
const Constants = require('./build/stub-expo-constants').default;
const rn = require('./build/stub-react-native');
const worker = require('./build/worker').default;

let pass = 0, fail = 0;
function ok(name, cond, detail = '') {
  if (cond) { pass++; console.log(`✓ ${name}`); }
  else { fail++; console.log(`✗ ${name} ${detail}`); }
}
function eq(name, actual, expected) {
  const a = JSON.stringify(actual), e = JSON.stringify(expected);
  ok(name, a === e, `\n    got ${a}\n    want ${e}`);
}

const SECURE_KEY = 'wafra.relay.v1';
const INBOX_KEY = 'wafra/relay/inbox/v1';
const ENTITLEMENT_KEY = 'wafra/relay/entitlement/v1';

/* ───────────────────────── The fake transport ─────────────────────────
 *
 * `fetch` is the entire boundary between the client and the relay, so faking
 * it — rather than the client's own functions — leaves every line of relay.ts
 * under test, including the bearer header, the JSON bodies and the status-code
 * handling that decides whether a user is told their pairing is dead.
 */
function transport() {
  const calls = [];
  const routes = new Map();
  const api = {
    calls,
    on(key, handler) {
      routes.set(key, handler);
      return api;
    },
    /** Just the route keys, in order — what was called and in what sequence. */
    sequence: () => calls.map((c) => c.key),
    count: (key) => calls.filter((c) => c.key === key).length,
    last: (key) => [...calls].reverse().find((c) => c.key === key) ?? null,
    install() {
      globalThis.fetch = async (url, init = {}) => {
        const u = new URL(String(url));
        const method = (init.method ?? 'GET').toUpperCase();
        const key = `${method} ${u.pathname}`;
        const call = {
          key,
          method,
          url: String(url),
          path: u.pathname,
          body: typeof init.body === 'string' ? JSON.parse(init.body) : null,
          auth: init.headers?.authorization ?? null,
        };
        calls.push(call);
        const handler = routes.get(key);
        if (!handler) return json(404, { error: 'not_found' });
        return handler(call);
      };
      return api;
    },
  };
  return api;
}

function json(status, data) {
  return new Response(data === undefined ? null : JSON.stringify(data), {
    status,
    headers: { 'content-type': 'application/json' },
  });
}

/** A clean phone: empty keychain, empty storage, iOS, a configured relay. */
function freshDevice() {
  secure.__keychain.reset();
  storage.__storage.reset();
  rn.Platform.OS = 'ios';
  Constants.expoConfig = { extra: { relayUrl: 'https://relay.test' } };
}

function storedIdentity() {
  const raw = secure.__keychain.items.get(SECURE_KEY);
  return raw ? JSON.parse(raw) : null;
}

/** The public key the relay would seal to, recovered from the stored secret. */
function devicePublicKey() {
  return encodeKey(deviceKeypair(decodeKey(storedIdentity().sk)).publicKey);
}

function stagedInbox() {
  const raw = storage.__storage.items.get(INBOX_KEY);
  return raw ? JSON.parse(raw) : null;
}

const AE_PURCHASE =
  'Purchase of AED 40.00 with Debit Card ending 4733 at CARREFOUR, DUBAI. Avl Balance is AED 7,476.59.';
const AE_SECOND =
  'Purchase of AED 12.50 with Debit Card ending 4733 at ARABICA, DUBAI. Avl Balance is AED 7,464.09.';
const NOT_A_TRANSACTION = 'Your OTP is 483920. Do not share it with anyone.';

/** A parsed row shaped exactly as the Worker seals it. */
function rowFor(text, { msgId, smsTs = Date.UTC(2026, 6, 17, 9, 0), sender = 'EmiratesNBD' } = {}) {
  const parsed = parseSms(text);
  if (!parsed) throw new Error('fixture does not parse');
  const { raw: _drop, ...rest } = parsed;
  return {
    ...rest,
    sender,
    smsTs,
    receivedAt: new Date(smsTs).toISOString(),
    msgId: msgId ?? `msg-${text.length}-${smsTs}`,
    market: 'AE',
  };
}

async function queueItem(id, row, publicKey) {
  return { id, ...(await seal(publicKey ?? devicePublicKey(), row)) };
}

/** Enough of AppState for buildImportPlan and the subscription gate. */
function ledgerState(overrides = {}) {
  return {
    transactions: [],
    accounts: [],
    accountHints: {},
    cardDues: [],
    bills: [],
    merchantOverrides: {},
    notSubscriptions: [],
    lastScanTs: 0,
    pro: true,
    trialStartTs: Date.now(),
    ...overrides,
  };
}

/** Records what was filed, and when, relative to the network calls. */
function recorder(tape) {
  const batches = [];
  const importBatch = (input) => {
    batches.push(input);
    tape.push('import');
    return input.transactions.map((_, i) => `tx-${batches.length}-${i}`);
  };
  return { batches, importBatch };
}

(async () => {
  /* ═════════════════════════ Pairing ═════════════════════════ */

  {
    freshDevice();
    const net = transport().install();
    net.on('POST /v1/pair', () =>
      json(200, {
        deviceId: 'dev-1',
        token: 'tok-1',
        market: 'AE',
        ingestUrl: 'https://relay.test/v1/ingest',
      }),
    );

    const pairing = await relay.pairRelay({ market: 'AE' });
    const req = net.last('POST /v1/pair');

    ok('pair: posts a 32-byte X25519 public key', decodeKey(req.body.publicKey).length === 32);
    eq('pair: tells the relay which market pack to parse under', req.body.market, 'AE');
    eq('pair: returns the ingest URL the Shortcut will POST to', pairing.ingestUrl,
      'https://relay.test/v1/ingest');
    ok('pair: the secret key never leaves the client', !('sk' in pairing));
    ok('pair: the public half matches the secret half kept in the keychain',
      devicePublicKey() === req.body.publicKey);

    // The default (WHEN_UNLOCKED) makes every locked-phone sync fail silently.
    const write = secure.__keychain.writes.find((w) => w.key === SECURE_KEY);
    eq('pair: the keychain item is readable while the phone is locked',
      write.options.keychainAccessible, secure.AFTER_FIRST_UNLOCK_THIS_DEVICE_ONLY);
    ok('pair: no biometric prompt is demanded — a headless task cannot answer one',
      write.options.requireAuthentication === false);
    eq('pair: the item is namespaced to its own keychain service',
      write.options.keychainService, 'app.wafra.relay');

    // The bearer token is a live credential; AsyncStorage is not a keychain.
    ok('pair: the token is not left lying in plain storage',
      !JSON.stringify([...storage.__storage.items.values()]).includes('tok-1'));

    // A reinstall must NOT mint a new key: the old token is inside the user's
    // Shortcut and re-pairing would kill capture while the app looked fine.
    const again = await relay.pairRelay({ market: 'AE' });
    eq('pair: pairing twice does not pair twice', net.count('POST /v1/pair'), 1);
    eq('pair: the existing token is handed back unchanged', again.token, pairing.token);
    eq('pair: the existing device id is kept', again.deviceId, 'dev-1');
  }

  {
    freshDevice();
    Constants.expoConfig = { extra: {} };
    transport().install();
    let message = '';
    try {
      await relay.pairRelay({ market: 'AE' });
    } catch (e) {
      message = e.message;
    }
    ok('pair: refuses to guess a hostname when no relay is configured',
      message.includes('relayUrl'), message);
  }

  {
    freshDevice();
    rn.Platform.OS = 'android';
    const net = transport().install();
    ok('platform: Android has no relay — it reads SMS on-device', !relay.isRelaySupported());
    const result = await relay.runRelayImport(ledgerState(), () => []);
    eq('platform: import is skipped as unsupported off iOS', result.skipped, 'unsupported');
    eq('platform: and nothing touches the network', net.calls.length, 0);
    rn.Platform.OS = 'ios';
  }

  /* ═════════════════ Sync: stage, dedupe, discard ═════════════════ */

  /** Pairs a device against a canned relay and returns the transport. */
  async function paired() {
    freshDevice();
    const net = transport().install();
    net.on('POST /v1/pair', () =>
      json(200, { deviceId: 'dev-1', token: 'tok-1', ingestUrl: 'https://relay.test/v1/ingest' }),
    );
    await relay.pairRelay({ market: 'AE' });
    return net;
  }

  {
    const net = await paired();
    const items = [
      await queueItem('q1', rowFor(AE_PURCHASE, { msgId: 'm1' })),
      await queueItem('q2', rowFor(AE_SECOND, { msgId: 'm2', smsTs: Date.UTC(2026, 6, 17, 10, 0) })),
    ];
    net.on('GET /v1/sync', () => json(200, { items }));

    const first = await relay.syncRelay();
    eq('sync: stages every row it can open', first.staged, 2);
    eq('sync: reports what is waiting for the foreground', first.pending, 2);
    eq('sync: authenticates with the bearer token', net.last('GET /v1/sync').auth, 'Bearer tok-1');
    // Acking here would be the one way to actually lose a transaction.
    eq('sync: acknowledges nothing on its own', net.count('POST /v1/ack'), 0);

    const staged = stagedInbox();
    eq('sync: staging survives in storage, not in memory', staged.rows.length, 2);
    ok('sync: the staged row carries the merchant the parser found',
      /carrefour/i.test(staged.rows[0].row.merchant));
    ok('sync: the message text is nowhere in staging — the relay never returned it',
      !JSON.stringify(staged).includes('Avl Balance'));

    // The relay does NOT delete on read, so the same rows come back until they
    // are acked. They must not be staged a second time.
    const second = await relay.syncRelay();
    eq('sync: rows already staged are not staged again', second.staged, 0);
    eq('sync: and the pending count does not double', second.pending, 2);
  }

  {
    const net = await paired();
    // Same message, new queue id: a Shortcut that fired twice, or a retry with
    // a drifted clock. The digest is what collapses it; the timestamp does not.
    let items = [await queueItem('q1', rowFor(AE_PURCHASE, { msgId: 'same' }))];
    net.on('GET /v1/sync', () => json(200, { items }));
    await relay.syncRelay();
    items = [
      await queueItem('q9', rowFor(AE_PURCHASE, { msgId: 'same', smsTs: Date.UTC(2026, 6, 17, 9, 3) })),
    ];
    const dup = await relay.syncRelay();
    eq('dedupe: a repeat of a message already seen is not staged', dup.staged, 0);
    eq('dedupe: it is counted as a duplicate', dup.duplicates, 1);
    eq('dedupe: and it is queued for acknowledgement so it stops coming back',
      stagedInbox().discard, ['q9']);
  }

  {
    const net = await paired();
    const stranger = deviceKeypair(webcrypto.getRandomValues(new Uint8Array(32)));
    const items = [
      await queueItem('q1', rowFor(AE_PURCHASE, { msgId: 'good' })),
      // Sealed to another device: this can never become readable here.
      await queueItem('q2', rowFor(AE_SECOND, { msgId: 'other' }), encodeKey(stranger.publicKey)),
      // Authentic but not a row: a future server version, or a bug.
      { id: 'q3', ...(await seal(devicePublicKey(), { hello: 'world' })) },
    ];
    net.on('GET /v1/sync', () => json(200, { items }));

    const result = await relay.syncRelay();
    eq('unopenable: the good row still lands', result.staged, 1);
    eq('unopenable: rows sealed to another key are counted, not retried forever',
      result.unopenable, 2);
    eq('unopenable: they are queued for acknowledgement instead',
      stagedInbox().discard, ['q2', 'q3']);
  }

  {
    const net = await paired();
    net.on('GET /v1/sync', () => json(401, { error: 'unauthorized' }));
    const result = await relay.syncRelay();
    eq('lost pairing: surfaces as unauthorized rather than as silence',
      result.error, 'unauthorized');
    const status = await relay.relayStatus();
    eq('lost pairing: the status carries it to the UI', status.lastError, 'unauthorized');
    ok('lost pairing: the device is still paired locally — the Shortcut holds the same token',
      status.paired);
  }

  {
    const net = await paired();
    net.on('GET /v1/sync', () => {
      throw new Error('offline');
    });
    const result = await relay.syncRelay();
    ok('offline: a failed sync is an error value, not a rejection', result.error !== null);
    eq('offline: nothing is staged and nothing is lost', result.staged, 0);
    eq('offline: no acknowledgement is attempted', net.count('POST /v1/ack'), 0);
  }

  /* ═════════════════ Import, then acknowledge ═════════════════ */

  {
    const net = await paired();
    const items = [
      await queueItem('q1', rowFor(AE_PURCHASE, { msgId: 'm1' })),
      await queueItem('q2', rowFor(AE_SECOND, { msgId: 'm2', smsTs: Date.UTC(2026, 6, 17, 10, 0) })),
    ];
    const tape = [];
    let ackBody = null;
    net.on('GET /v1/sync', () => json(200, { items }));
    net.on('POST /v1/ack', (call) => {
      tape.push('ack');
      ackBody = call.body;
      return new Response(null, { status: 204 });
    });

    const { batches, importBatch } = recorder(tape);
    const result = await relay.runRelayImport(ledgerState(), importBatch);

    eq('import: both captured messages are filed', result.ids.length, 2);
    eq("import: through the app's own batch pipeline", batches.length, 1);
    ok('import: the amount survives the round trip',
      batches[0].transactions.some((t) => t.amountFils === 4000));
    ok('import: the merchant survives it too',
      batches[0].transactions.some((t) => /carrefour/i.test(t.title)));
    // The relay has no message text to give back, so the "report this format"
    // affordance has nothing to attach. Honest, and deliberately not faked.
    ok('import: relayed rows carry no raw text', batches[0].transactions.every((t) => !t.raw));

    eq('ack: happens after the ledger commit, never before', tape, ['import', 'ack']);
    eq('ack: names exactly the rows that were collected', ackBody.ids.slice().sort(), ['q1', 'q2']);
    eq('ack: staging is emptied once the relay has been told', stagedInbox().rows.length, 0);

    // `lastScanTs` is the ANDROID inbox cursor. Advancing it from a relay
    // import would make a later on-device scan skip everything in between.
    eq('import: the Android inbox cursor is left where it was', batches[0].lastScanTs, 0);
  }

  {
    const net = await paired();
    const items = [await queueItem('q1', rowFor(AE_PURCHASE, { msgId: 'm1' }))];
    net.on('GET /v1/sync', () => json(200, { items }));
    net.on('POST /v1/ack', () => new Response(null, { status: 204 }));

    let threw = false;
    try {
      await relay.runRelayImport(ledgerState(), () => {
        throw new Error('the store blew up');
      });
    } catch {
      threw = true;
    }
    ok('ack: a ledger write that fails is not swallowed', threw);
    eq('ack: and nothing is acknowledged', net.count('POST /v1/ack'), 0);
    eq('ack: the row is still staged, so the next run files it', stagedInbox().rows.length, 1);
  }

  {
    const net = await paired();
    const before = net.calls.length;
    const result = await relay.runRelayImport(
      ledgerState({ pro: false, trialStartTs: Date.now() - 30 * 86400000 }),
      () => [],
    );
    eq('paywall: a lapsed subscriber does not sync', result.skipped, 'not-pro');
    eq('paywall: and their phone does not talk to the relay at all',
      net.calls.length - before, 0);
  }

  /* ═════════════════ The background layers ═════════════════ */

  {
    const net = await paired();
    const items = [await queueItem('q1', rowFor(AE_PURCHASE, { msgId: 'm1' }))];
    net.on('GET /v1/sync', () => json(200, { items }));
    net.on('POST /v1/ack', () => new Response(null, { status: 204 }));

    // No mirrored entitlement yet: a headless task cannot read the ledger, and
    // it must fail closed rather than sync for someone who is not paying.
    const cold = await relay.backgroundSyncRelay();
    eq('background: refuses to run without a known entitlement', cold.skipped, 'not-pro');
    eq('background: and makes no request while it refuses', net.count('GET /v1/sync'), 0);

    await relay.cacheEntitlement({ pro: true, trialStartTs: 0 });
    ok('background: the mirror is a tiny separate key, not the ledger',
      JSON.parse(storage.__storage.items.get(ENTITLEMENT_KEY)).pro === true);

    const staged = [];
    const stop = relay.subscribeRelayStaged((r) => staged.push(r.staged));
    const warm = await relay.backgroundSyncRelay();
    stop();

    eq('background: stages what the relay was holding', warm.sync.staged, 1);
    eq('background: tells the foreground rows have landed', staged, [1]);
    // This is the load-bearing one: importBatch is a method on the React store,
    // and a headless write behind the provider's back is silently overwritten.
    eq('background: never files and never acknowledges', net.count('POST /v1/ack'), 0);
    eq('background: the row waits for the foreground', stagedInbox().rows.length, 1);

    // And the foreground picks up exactly what the background left.
    const tape = [];
    const { importBatch } = recorder(tape);
    const drained = await relay.runRelayImport(ledgerState(), importBatch);
    eq('background: the foreground files the staged row', drained.ids.length, 1);
    eq('background: through the same collect-then-ack path', tape, ['import']);
  }

  {
    await paired();
    await relay.cacheEntitlement({ pro: true, trialStartTs: 0 });
    globalThis.fetch = async () => {
      throw new Error('radio off');
    };
    const result = await relay.backgroundSyncRelay();
    ok('background: a dead network is a value, not a crash report', result.sync.error !== null);
  }

  /* ═════════════════ Push registration ═════════════════ */

  {
    const net = await paired();
    net.on('POST /v1/push', () => json(200, { push: 'on' }));

    const first = await relay.registerRelayPushToken('ExponentPushToken[abc123]');
    eq('push: the token is registered with the relay', first, 'registered');
    eq('push: as an Expo token', net.last('POST /v1/push').body.platform, 'expo');
    eq('push: authenticated as this device', net.last('POST /v1/push').auth, 'Bearer tok-1');
    ok('push: the status says instant delivery is on', (await relay.relayStatus()).pushEnabled);

    const again = await relay.registerRelayPushToken('ExponentPushToken[abc123]');
    eq('push: an unchanged token costs no request', again, 'unchanged');
    eq('push: really, no second request', net.count('POST /v1/push'), 1);

    const cleared = await relay.registerRelayPushToken('');
    eq('push: clearing it is a registration too', cleared, 'registered');
    eq('push: an empty token is how the app says stop knocking',
      net.last('POST /v1/push').body.token, '');
    ok('push: and the status stops promising seconds',
      !(await relay.relayStatus()).pushEnabled);
  }

  {
    const net = await paired();
    net.on('POST /v1/push', () => json(500, { error: 'nope' }));
    const result = await relay.registerRelayPushToken('ExponentPushToken[xyz]');
    eq('push: a refused registration is reported, not assumed', result, 'failed');
    ok('push: and is not remembered as done, so the next launch retries',
      !(await relay.relayStatus()).pushEnabled);
  }

  /* ═════════ End to end: the Shortcut, the Worker, and the phone ═════════
   *
   * No canned responses here. The transport is the real `export default
   * { fetch }` from server/src/index.ts over a real SQLite database built from
   * the real schema.sql, and the client is the real relay.ts. If seal() and
   * openSealed() ever disagree, this is where it shows.
   */
  {
    freshDevice();
    const db = new DatabaseSync(':memory:');
    db.exec(readFileSync(SCHEMA_PATH, 'utf8'));
    const statement = (sql, params = []) => ({
      bind: (...values) => statement(sql, values),
      first: async () => db.prepare(sql).get(...params) ?? null,
      all: async () => ({ results: db.prepare(sql).all(...params) }),
      run: async () => db.prepare(sql).run(...params),
    });
    const env = {
      DB: {
        prepare: (sql) => statement(sql),
        batch: async (statements) => {
          for (const s of statements) await s.run();
        },
      },
    };

    const pushes = [];
    globalThis.fetch = async (url, init = {}) => {
      const target = String(url);
      // The Worker's own wake call to Expo. Recorded rather than performed.
      if (target.startsWith('https://exp.host/')) {
        pushes.push(JSON.parse(init.body));
        return json(200, { data: { status: 'ok' } });
      }
      return worker.fetch(new Request(target, init), env);
    };

    const pairing = await relay.pairRelay({ market: 'AE' });
    ok('e2e: the real Worker paired the real client', !!pairing.token && !!pairing.deviceId);

    await relay.registerRelayPushToken('ExponentPushToken[e2e]');

    /** What the user's Shortcut does, verbatim. */
    const shortcutPost = (text, sender) =>
      fetch(pairing.ingestUrl, {
        method: 'POST',
        headers: { authorization: `Bearer ${pairing.token}`, 'content-type': 'application/json' },
        body: JSON.stringify({ text, sender, receivedAt: '2026-07-17T09:00:00.000Z' }),
      });

    const accepted = await shortcutPost(AE_PURCHASE, 'EmiratesNBD');
    eq('e2e: the relay accepts a bank message', accepted.status, 202);
    const ignored = await shortcutPost(NOT_A_TRANSACTION, 'Careem');
    eq('e2e: and stores nothing for a message that is not one', ignored.status, 204);
    eq('e2e: the queue holds exactly the one transaction',
      db.prepare('SELECT COUNT(*) n FROM queue').get().n, 1);
    ok('e2e: with the message text nowhere in the database',
      !JSON.stringify(db.prepare('SELECT * FROM queue').all()).includes('CARREFOUR'));

    eq('e2e: queuing a row woke the phone', pushes.length, 1);
    eq('e2e: with an empty payload — Expo and Apple learn nothing but the timing',
      pushes[0].data, {});
    ok('e2e: and no title or body that could leak a purchase',
      !('title' in pushes[0]) && !('body' in pushes[0]) && pushes[0]._contentAvailable === true);

    const tape = [];
    const { batches, importBatch } = recorder(tape);
    const result = await relay.runRelayImport(ledgerState(), importBatch);

    eq('e2e: the phone opened what the Worker sealed and filed it', result.ids.length, 1);
    const tx = batches[0].transactions[0];
    eq('e2e: the amount is exact', tx.amountFils, 4000);
    ok('e2e: the merchant came through', /carrefour/i.test(tx.title));
    eq('e2e: the date is the message timestamp the Shortcut sent, not now', tx.date, '2026-07-17');
    // The sender is the only thing that says which bank sent a message, and it
    // is what makes an iOS card branded instead of grey.
    ok('e2e: the card was attributed to the bank the message came from',
      /emirates/i.test(JSON.stringify(batches[0].newAccounts)));
    eq('e2e: acknowledging really empties the queue',
      db.prepare('SELECT COUNT(*) n FROM queue').get().n, 0);

    // A second collection now finds nothing — the proof that ack is what
    // deletes, and that nothing is filed twice.
    const empty = await relay.runRelayImport(ledgerState(), importBatch);
    eq('e2e: nothing is left to collect', empty.ids.length, 0);
    eq('e2e: and nothing was filed a second time', batches.length, 1);

    // Unpair reaches the real Worker and takes the device with it.
    await relay.unpairRelay();
    eq('e2e: unpairing erases the device server-side',
      db.prepare('SELECT COUNT(*) n FROM devices').get().n, 0);
    eq('e2e: and the key with it', secure.__keychain.items.get(SECURE_KEY), undefined);
    ok('e2e: the app now reports capture as off', !(await relay.relayStatus()).paired);
  }

  console.log(`\n${pass} passed, ${fail} failed`);
  process.exit(fail ? 1 : 0);
})().catch((e) => {
  console.error(e);
  process.exit(1);
});
