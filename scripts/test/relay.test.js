// The relay CLIENT.
//
// worker.test.js proves the service behaves. This proves the phone does — and
// it does it against the REAL src/lib/relay.ts, compiled by run.sh with the
// native surfaces (keychain, expo-crypto, react-native) swapped for the stubs
// in ./stubs and nothing else changed. Every rule this file asserts is one that
// fails SILENTLY in production if it breaks:
//
//   • THE PRIVATE KEY IS 32 BYTES THIS FILE HANDED IN. The device crypto takes
//     its entropy as an argument because React Native has no
//     `crypto.getRandomValues` and noble's own key generation throws under
//     Hermes — on the FIRST line of pairing, so iOS could never pair on a real
//     device while every Node test passed. Node HAS getRandomValues, so no test
//     here can catch that by running; what it can do is assert the entropy
//     still arrives as an argument, which is what "the public half matches the
//     secret half" does.
//   • THE TOKENS ARE SCOPED. The Shortcut carries the ingest token and lives
//     outside the app forever, readable by anyone who opens the automation. If
//     it could reach /v1/sync or /v1/ack it could read and delete the user's
//     queue. Asserted against the real Worker, not against a mock.
//   • THE BACKGROUND KEYCHAIN ITEM IS THE SMALL ONE. A headless wake gets the
//     sync bearer and the private key at AFTER_FIRST_UNLOCK; the admin bearer
//     stays in an item that is unreadable while the phone is locked. A wrong
//     accessibility class produces no error at all — just a permanently stale
//     ledger, or a destructive credential readable in a pocket.
//   • ROWS ARE ACKNOWLEDGED, NEVER DELETED ON READ. Acking before the ledger
//     commit is the one way to actually lose a transaction.
//   • A ROW THAT CAN NEVER BE OPENED IS ACKNOWLEDGED ANYWAY. Otherwise every
//     sync re-downloads it until the retention window runs out.
//   • THE MESSAGE TEXT IS IN NONE OF IT. The last section proves that against a
//     real database rather than by reading the source.
//
// That last section runs the real Worker over a real SQLite database built from
// the real schema.sql and drives the real client through it end to end: pair, a
// Shortcut POSTs a bank SMS, the phone collects it sealed, opens it, and
// acknowledges it. It is the one test that proves seal() and openSealed() agree
// in the direction that matters — on the wire, not on two libraries in
// isolation.
const { webcrypto } = require('crypto');
globalThis.crypto = webcrypto;

const { DatabaseSync } = require('node:sqlite');
const { readFileSync } = require('node:fs');

const SCHEMA_PATH = require.resolve('../../server/schema.sql');

// Read at module load by relay.ts, exactly as Expo inlines it into a build. Set
// before the require below, deliberately: a build with no relay configured must
// refuse to pair rather than guess a hostname, and that is tested too.
process.env.EXPO_PUBLIC_WAFRA_RELAY_URL = 'https://relay.test';

const relay = require('./build/relay.cjs');
const { seal } = require('./build/crypto');
const { deviceKeypair, encodeKey, decodeKey } = require('./build/relay-crypto.cjs');
const { parseSms } = require('./build/sms-parser');
const { setActiveMarket } = require('./build/markets');
const secure = require('./build/stub-secure-store');
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

const KEY = 'wafra.relay.v1';
const BACKGROUND_KEY = 'wafra.relay.background.v1';
const PROOF_KEY = 'wafra.relay.automation-proof.v1';
const BASE = 'https://relay.test';

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
    sequence: () => calls.map((c) => c.key),
    count: (key) => calls.filter((c) => c.key === key).length,
    last: (key) => [...calls].reverse().find((c) => c.key === key) ?? null,
    install() {
      globalThis.fetch = async (url, init = {}) => {
        const u = new URL(String(url));
        const method = (init.method ?? 'GET').toUpperCase();
        const call = {
          key: `${method} ${u.pathname}`,
          method,
          url: String(url),
          path: u.pathname,
          body: typeof init.body === 'string' ? JSON.parse(init.body) : null,
          auth: init.headers?.authorization ?? null,
        };
        calls.push(call);
        const handler = routes.get(call.key);
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

/** A clean phone: empty keychain, iOS. */
function freshDevice() {
  secure.__keychain.reset();
  rn.Platform.OS = 'ios';
}

function storedConfig(key = KEY) {
  const raw = secure.__keychain.items.get(key);
  return raw ? JSON.parse(raw) : null;
}

/** The public key the relay would seal to, recovered from the stored secret. */
function devicePublicKey() {
  return encodeKey(deviceKeypair(decodeKey(storedConfig().privateKey)).publicKey);
}

/** Four scoped credentials, shaped as the Worker issues them. */
function credentials(market = 'AE') {
  return {
    deviceId: webcrypto.randomUUID(),
    ingestToken: `ingest-${'i'.repeat(40)}`,
    syncToken: `sync-${'s'.repeat(40)}`,
    adminToken: `admin-${'a'.repeat(40)}`,
    market,
  };
}

const AE_PURCHASE =
  'Purchase of AED 40.00 with Debit Card ending 4733 at CARREFOUR, DUBAI. Avl Balance is AED 7,476.59.';
const AE_SECOND =
  'Purchase of AED 12.50 with Debit Card ending 4733 at ARABICA, DUBAI. Avl Balance is AED 7,464.09.';
const NOT_A_TRANSACTION = 'Your OTP is 483920. Do not share it with anyone.';
// Same sentence, two readings. On a Sharia-compliant issuer the word "credit"
// never appears and "available limit" is what marks a credit card, so without
// the sender this card is kind 'unknown' — a grey, nameless tile — and with it
// it is correctly a credit card. It is the cleanest proof that the sender
// reaches the parser as an INPUT rather than merely riding along as data.
const ADIB_CARD =
  'Your ADIB Card ending 4417 was used for AED 120.00 at LULU HYPERMARKET. Your available limit is AED 8,240.00.';
const SA_PURCHASE =
  'Purchase of SAR 45.00 with mada Card ending 4733 at PANDA, RIYADH. Avl Balance is SAR 1,200.00.';

/** A parsed row shaped exactly as the Worker seals it. */
function rowFor(text, extra = {}) {
  const parsed = parseSms(text, undefined, { sender: extra.sender });
  if (!parsed) throw new Error('fixture does not parse');
  const { raw: _drop, ...rest } = parsed;
  return {
    ...rest,
    sender: 'EmiratesNBD',
    captureSource: 'shortcut',
    market: 'AE',
    receivedAt: new Date(Date.UTC(2026, 6, 17, 9, 0)).toISOString(),
    ...extra,
  };
}

async function queueItem(id, row, publicKey) {
  return { id, ...(await seal(publicKey ?? devicePublicKey(), row)) };
}

(async () => {
  /* ═════════════════════════ Pairing ═════════════════════════ */

  {
    freshDevice();
    const net = transport().install();
    const issued = credentials();
    net.on('POST /v1/pair', () => json(200, issued));

    const cfg = await relay.pairDevice(BASE, 'Khalid iPhone', 'AE');
    const req = net.last('POST /v1/pair');

    ok('pair: posts a 32-byte X25519 public key', decodeKey(req.body.publicKey).length === 32);
    ok('pair: the public half matches the secret half kept in the keychain',
      devicePublicKey() === req.body.publicKey);
    eq('pair: tells the relay which market pack to parse under', req.body.market, 'AE');
    eq('pair: passes the device name the user chose', req.body.deviceName, 'Khalid iPhone');

    // Four scopes, not one. The Shortcut gets `ingestToken` and nothing else.
    eq('pair: keeps all four scoped credentials',
      [cfg.ingestToken, cfg.syncToken, cfg.adminToken, cfg.deviceId],
      [issued.ingestToken, issued.syncToken, issued.adminToken, issued.deviceId]);
    // A bearer token's destination is never taken from the response body: the
    // Shortcut must post back to the origin this app deliberately paired with.
    eq('pair: the ingest URL is this relay, not one the response chose',
      cfg.ingestUrl, `${BASE}/v1/ingest`);
    eq('pair: setup starts unproven', cfg.setupState, 'paired');

    const main = secure.__keychain.writes.find((w) => w.key === KEY);
    const background = secure.__keychain.writes.find((w) => w.key === BACKGROUND_KEY);
    ok('pair: both keychain items name an accessibility class',
      main.options.keychainAccessible !== undefined &&
        background.options.keychainAccessible !== undefined);
    eq('pair: the background item is readable after first unlock, so a locked-phone wake can sync',
      background.options.keychainAccessible, secure.AFTER_FIRST_UNLOCK_THIS_DEVICE_ONLY);
    ok('pair: the item holding the admin token is NOT readable while the phone is locked',
      main.options.keychainAccessible !== background.options.keychainAccessible &&
        main.options.keychainAccessible === secure.WHEN_UNLOCKED_THIS_DEVICE_ONLY);

    // What a headless task can read while the phone is in a pocket is exactly
    // what it needs to collect rows — and nothing that can delete anything.
    const bg = storedConfig(BACKGROUND_KEY);
    eq('pair: the background item carries only collect-and-open credentials',
      Object.keys(bg).sort(),
      ['baseUrl', 'deviceId', 'privateKey', 'setupState', 'syncToken']);
    ok('pair: no admin or ingest token is reachable from a locked device',
      !JSON.stringify(bg).includes(issued.adminToken) &&
        !JSON.stringify(bg).includes(issued.ingestToken));
  }

  {
    freshDevice();
    transport().install();
    let message = '';
    try {
      await relay.pairDevice(null);
    } catch (e) {
      message = e.message;
    }
    ok('pair: a build with no relay configured refuses rather than guessing a host',
      /not configured/i.test(message), message);
  }

  {
    freshDevice();
    const net = transport().install();
    const { adminToken: _missing, ...incomplete } = credentials();
    net.on('POST /v1/pair', () => json(200, incomplete));
    let thrown = null;
    try {
      await relay.pairDevice(BASE);
    } catch (e) {
      thrown = e;
    }
    ok('pair: a response missing a scope is refused, not half-stored',
      thrown !== null && thrown.retryable === false && storedConfig() === null);
  }

  /* ═══════════════ What the keychain is allowed to hand back ═══════════════ */

  {
    freshDevice();
    const net = transport().install();
    net.on('POST /v1/pair', () => json(200, credentials()));
    await relay.pairDevice(BASE);
    const stored = storedConfig();

    // A device paired before market selection existed has no `market` field.
    // Rejecting it would read as "not paired", the app would offer to pair
    // again, and the newly minted ingest token would not be the one inside the
    // user's Shortcut: capture would die on a setup that was working.
    const { market: _gone, ...legacy } = stored;
    secure.__keychain.items.set(KEY, JSON.stringify(legacy));
    const healed = await relay.getRelayConfig();
    eq('config: a pairing made before market selection still loads', healed?.market, 'AE');

    secure.__keychain.items.set(KEY, JSON.stringify({ ...stored, syncToken: 'short' }));
    eq('config: a credential that is not credential-shaped fails closed',
      await relay.getRelayConfig(), null);
    secure.__keychain.items.set(KEY, JSON.stringify({ ...stored, privateKey: 'AAAA' }));
    eq('config: so does a private key that is not 32 bytes',
      await relay.getRelayConfig(), null);
    secure.__keychain.items.set(
      KEY, JSON.stringify({ ...stored, ingestUrl: 'https://elsewhere.test/v1/ingest' }));
    eq('config: and an ingest URL that does not belong to the paired relay',
      await relay.getRelayConfig(), null);

    secure.__keychain.items.set(KEY, JSON.stringify(stored));
    secure.__keychain.failReads = true;
    eq('config: a keychain that refuses to answer reads as "not paired", not as a crash',
      await relay.getRelayConfig(), null);
    secure.__keychain.failReads = false;
  }

  /** Pairs a device against a canned relay and returns the transport. */
  async function paired(market = 'AE') {
    freshDevice();
    const net = transport().install();
    net.on('POST /v1/pair', () => json(200, credentials(market)));
    const cfg = await relay.pairDevice(BASE, undefined, market);
    return { net, cfg };
  }

  /* ═════════════════════ Changing country ═════════════════════ */

  {
    const { net, cfg } = await paired('AE');
    net.on('PATCH /v1/device', () => json(200, { market: 'SA' }));
    const next = await relay.setRelayMarket(cfg, 'SA');
    const req = net.last('PATCH /v1/device');
    eq('market: changing country is a PATCH, never a re-pair', net.count('POST /v1/pair'), 1);
    eq('market: it names the new pack', req.body.market, 'SA');
    eq('market: with the admin credential', req.auth, `Bearer ${cfg.adminToken}`);
    eq('market: the app remembers it', (await relay.getRelayConfig()).market, 'SA');
    eq('market: and the returned config carries it', next.market, 'SA');
  }

  {
    const { net, cfg } = await paired('AE');
    net.on('PATCH /v1/device', () => json(500, { error: 'nope' }));
    let threw = false;
    try {
      await relay.setRelayMarket(cfg, 'SA');
    } catch {
      threw = true;
    }
    // Storing first would leave the app showing a pack the relay is not using,
    // which surfaces as a parser bug and is invisible from either side.
    ok('market: a refused change is not remembered as done',
      threw && (await relay.getRelayConfig()).market === 'AE');
    let rejected = false;
    try {
      await relay.setRelayMarket(cfg, 'ZZ');
    } catch {
      rejected = true;
    }
    ok('market: a pack this build does not ship never reaches the network',
      rejected && net.count('PATCH /v1/device') === 1);
  }

  /* ═════════════════ Sync: open, keep, acknowledge ═════════════════ */

  {
    const { net, cfg } = await paired();
    const items = [
      await queueItem('11111111-1111-4111-8111-111111111111',
        rowFor(AE_SECOND, { receivedAt: new Date(Date.UTC(2026, 6, 17, 10, 0)).toISOString() })),
      await queueItem('22222222-2222-4222-8222-222222222222', rowFor(AE_PURCHASE)),
    ];
    net.on('GET /v1/sync', () => json(200, { items }));

    const result = await relay.syncRelay(cfg);
    eq('sync: every row it can open comes back', result.parsed.length, 2);
    eq('sync: authenticated with the SYNC token, not the admin one',
      net.last('GET /v1/sync').auth, `Bearer ${cfg.syncToken}`);
    // buildImportPlan sees a card's earliest appearance first, so the account
    // it auto-creates is the one the oldest message describes.
    ok('sync: rows arrive oldest first', result.parsed[0].smsTs < result.parsed[1].smsTs);
    eq("sync: the timestamp is the message's, not the moment we synced",
      result.parsed[0].smsTs, Date.UTC(2026, 6, 17, 9, 0));
    ok('sync: the bank that sent it survives, so the card is not grey',
      result.parsed.every((row) => row.sender === 'EmiratesNBD'));
    ok('sync: no message text comes back — the relay has none to give',
      !JSON.stringify(result.parsed).includes('Avl Balance') &&
        result.parsed.every((row) => row.raw === undefined));
    // Reading is not receiving. The relay deletes on acknowledgement precisely
    // so a crash between the two costs a retry rather than a transaction.
    eq('sync: nothing is acknowledged by collecting it', net.count('POST /v1/ack'), 0);
    eq('sync: but every collected row is named, for the caller to ack after it commits',
      result.ids.length, 2);
  }

  {
    const { net, cfg } = await paired();
    const stranger = deviceKeypair(webcrypto.getRandomValues(new Uint8Array(32)));
    const items = [
      await queueItem('11111111-1111-4111-8111-111111111111', rowFor(AE_PURCHASE)),
      // Sealed to another device: this can never become readable here.
      await queueItem('22222222-2222-4222-8222-222222222222', rowFor(AE_SECOND),
        encodeKey(stranger.publicKey)),
      // Authentic, but not a row this version knows how to file.
      { id: '33333333-3333-4333-8333-333333333333',
        ...(await seal(devicePublicKey(), { hello: 'world' })) },
      // Authentic and otherwise well-formed — except it carries message text,
      // which the relay is never allowed to return.
      { id: '44444444-4444-4444-8444-444444444444',
        ...(await seal(devicePublicKey(), { ...rowFor(AE_PURCHASE), raw: AE_PURCHASE })) },
      // Not shaped like a queue item at all.
      { id: 'not-a-uuid', epk: 1, iv: null, ct: false },
    ];
    net.on('GET /v1/sync', () => json(200, { items }));

    const result = await relay.syncRelay(cfg);
    eq('unopenable: the good row still lands', result.parsed.length, 1);
    eq('unopenable: everything else is counted rather than silently dropped',
      result.unreadable, 4);
    // Not acking them means re-downloading them on every sync until retention
    // expires. The malformed ITEM has no trustworthy id, so it is not acked.
    eq('unopenable: the ones with a real queue id are acknowledged so they stop coming back',
      result.ids.sort(),
      ['11111111-1111-4111-8111-111111111111', '22222222-2222-4222-8222-222222222222',
        '33333333-3333-4333-8333-333333333333', '44444444-4444-4444-8444-444444444444']);
  }

  {
    const { net, cfg } = await paired();
    const probe = {
      id: '55555555-5555-4555-8555-555555555555',
      ...(await seal(devicePublicKey(), { relayTest: true })),
    };
    net.on('GET /v1/sync', () => json(200, { items: [probe] }));
    const result = await relay.syncRelay(cfg);
    eq('probe: the setup test is not a transaction', result.parsed.length, 0);
    eq('probe: it is counted as what it is', result.testReceived, 1);
    eq('probe: and reserved for the screen that is waiting for it',
      result.testIds, ['55555555-5555-4555-8555-555555555555']);
  }

  {
    const { net, cfg } = await paired();
    net.on('GET /v1/sync', () => json(401, { error: 'unauthorized' }));
    let thrown = null;
    try {
      await relay.syncRelay(cfg);
    } catch (e) {
      thrown = e;
    }
    ok('lost pairing: 401 is permanent and says so, so the UI can offer setup again',
      thrown?.name === 'RelayError' && thrown.retryable === false);

    net.on('GET /v1/sync', () => {
      throw new Error('radio off');
    });
    let offline = null;
    try {
      await relay.syncRelay(cfg);
    } catch (e) {
      offline = e;
    }
    ok('offline: a dead network is retryable, not a reason to unpair',
      offline?.name === 'RelayError' && offline.retryable === true);
  }

  {
    const { net, cfg } = await paired();
    net.on('POST /v1/ack', () => new Response(null, { status: 204 }));
    const ids = Array.from({ length: 250 }, (_, i) =>
      `${String(i).padStart(8, '0')}-0000-4000-8000-000000000000`);
    await relay.ackRelay(cfg, ids);
    eq('ack: a page larger than the relay accepts is split, not truncated',
      net.count('POST /v1/ack'), 2);
    eq('ack: with the sync credential', net.last('POST /v1/ack').auth, `Bearer ${cfg.syncToken}`);
    eq('ack: and every id is named exactly once',
      net.calls.filter((c) => c.key === 'POST /v1/ack').reduce((n, c) => n + c.body.ids.length, 0),
      250);
  }

  /* ═════════════════ Proof that the automation ever fired ═════════════════ */

  {
    const { cfg } = await paired();
    eq('proof: a fresh pairing has never seen a real bank row',
      await relay.getRelayAutomationProof(), null);
    await relay.recordRelayAutomationProof(1_800_000_000_000);
    eq('proof: the headless task can record one',
      await relay.getRelayAutomationProof(), 1_800_000_000_000);
    const write = [...secure.__keychain.writes].reverse().find((w) => w.key === PROOF_KEY);
    eq('proof: written where a locked-phone wake can write it',
      write.options.keychainAccessible, secure.AFTER_FIRST_UNLOCK_THIS_DEVICE_ONLY);
    const marked = await relay.markRelayVerified(cfg);
    eq('proof: the synthetic pipe test stays a separate, weaker claim',
      marked.setupState, 'verified');
  }

  /* ═════════════════ The sealed row's own contract ═════════════════
   *
   * The blob is authenticated — GCM proves the relay sealed it to this device —
   * but "authentic" is not "well-formed". A future server version, or one field
   * gone wrong, must not be able to put a NaN amount or a message body into the
   * ledger, so every field is checked before anything is filed.
   */

  const row = {
    kind: 'transaction',
    type: 'expense',
    merchant: 'Coffee shop',
    amountFils: 2500,
    currency: 'AED',
    date: '2026-08-03',
    dueDay: null,
    minDueFils: null,
    card: { last4: '1234', kind: 'debit' },
    reference: null,
    transferHint: false,
    snapshotFils: null,
    snapshotKind: null,
    categoryGuess: 'dining',
    categoryDeliberate: true,
    sender: 'EmiratesNBD',
    receivedAt: '2026-08-03T09:10:11.000Z',
    captureSource: 'shortcut',
    market: 'AE',
  };
  const paymentRow = {
    ...row,
    kind: 'cardPayment',
    merchant: 'Card •1234 payment',
    card: { last4: '1234', kind: 'credit' },
    transferHint: true,
    categoryGuess: 'other',
  };
  const statementRow = {
    ...row,
    kind: 'cardStatement',
    merchant: 'Credit card statement',
    dueDay: 3,
    minDueFils: 500,
    card: null,
    categoryGuess: 'other',
  };

  ok('row: structured English and Arabic sender labels are accepted',
    relay.validRelaySender(row.sender) && relay.validRelaySender('بنك أبوظبي الأول'));
  ok('row: sender remains optional, so a Shortcut built before it existed still works',
    relay.validRelaySender(undefined) && relay.isParsedRelayRow({ ...row, sender: undefined }));
  ok('row: sender rejects padding, multiline/control text, bidi overrides and oversized labels',
    !relay.validRelaySender(' EmiratesNBD') &&
      !relay.validRelaySender('ENBD\nFAB') &&
      !relay.validRelaySender(`ENBD‮${'x'.repeat(5)}`) &&
      !relay.validRelaySender('x'.repeat(81)));
  ok('row: an invalid sender invalidates the whole sealed row',
    !relay.isParsedRelayRow({ ...row, sender: 'ENBD\nforged' }));
  ok('row: a legitimate rawless structured row is accepted',
    !('raw' in row) && relay.isParsedRelayRow(row));
  ok('row: raw Message Content is forbidden even when empty',
    !relay.isParsedRelayRow({ ...row, raw: 'full bank SMS' }) &&
      !relay.isParsedRelayRow({ ...row, raw: '' }) &&
      !relay.isParsedRelayRow({ ...row, raw: undefined }));
  ok('row: every required parser field must be present',
    [
      'kind', 'type', 'amountFils', 'currency', 'merchant', 'date', 'dueDay',
      'minDueFils', 'card', 'reference', 'transferHint', 'snapshotFils',
      'snapshotKind', 'categoryGuess',
    ].every((field) => {
      const incomplete = { ...row };
      delete incomplete[field];
      return !relay.isParsedRelayRow(incomplete);
    }));
  ok('row: money, currency, category and snapshot values fail closed',
    !relay.isParsedRelayRow({ ...row, amountFils: 0 }) &&
      !relay.isParsedRelayRow({ ...row, amountFils: -1 }) &&
      !relay.isParsedRelayRow({ ...row, amountFils: 1.5 }) &&
      !relay.isParsedRelayRow({ ...row, currency: 'aed' }) &&
      !relay.isParsedRelayRow({ ...row, currency: 'AED 100' }) &&
      !relay.isParsedRelayRow({ ...row, categoryGuess: 'forged' }) &&
      !relay.isParsedRelayRow({ ...row, snapshotFils: 5000, snapshotKind: null }) &&
      !relay.isParsedRelayRow({ ...row, snapshotFils: null, snapshotKind: 'balance' }) &&
      !relay.isParsedRelayRow({ ...row, snapshotFils: 5000, snapshotKind: 'forged' }));
  ok('row: card identity and kind are validated structurally',
    !relay.isParsedRelayRow({ ...row, card: { last4: '123', kind: 'debit' } }) &&
      !relay.isParsedRelayRow({ ...row, card: { last4: '1234', kind: 'forged' } }) &&
      !relay.isParsedRelayRow({ ...row, card: { kind: 'debit' } }) &&
      !relay.isParsedRelayRow({ ...paymentRow, card: null }) &&
      !relay.isParsedRelayRow({ ...paymentRow, card: { last4: '1234', kind: 'debit' } }));
  ok('row: card-payment side accepts only the two accounting values',
    relay.isParsedRelayRow({ ...paymentRow, cardPaymentSide: undefined }) &&
      relay.isParsedRelayRow({ ...paymentRow, cardPaymentSide: 'debit' }) &&
      relay.isParsedRelayRow({ ...paymentRow, cardPaymentSide: 'receipt' }) &&
      !relay.isParsedRelayRow({ ...paymentRow, cardPaymentSide: 'forged' }) &&
      !relay.isParsedRelayRow({ ...row, cardPaymentSide: 'debit' }));
  ok('row: a complete no-PAN card statement remains valid for sender-bank resolution',
    relay.isParsedRelayRow(statementRow) &&
      relay.isParsedRelayRow({ ...statementRow, card: { last4: '1234', kind: 'credit' } }));
  ok('row: kind-specific due, card and transfer invariants fail closed',
    !relay.isParsedRelayRow({ ...row, dueDay: 3 }) &&
      !relay.isParsedRelayRow({ ...statementRow, dueDay: 4 }) &&
      !relay.isParsedRelayRow({ ...statementRow, card: { last4: '1234', kind: 'debit' } }) &&
      !relay.isParsedRelayRow({ ...statementRow, transferHint: true }) &&
      !relay.isParsedRelayRow({ ...paymentRow, transferHint: false }) &&
      !relay.isParsedRelayRow({ ...paymentRow, minDueFils: 500 }) &&
      !relay.isParsedRelayRow({ ...row, kind: 'billDue', dueDay: 3, transferHint: true }));
  ok('row: a market this build does not ship is not accepted as one',
    relay.isParsedRelayRow({ ...row, market: 'SA' }) &&
      !relay.isParsedRelayRow({ ...row, market: 'ZZ' }) &&
      !relay.isParsedRelayRow({ ...row, market: 'ae' }));
  ok('row: a valid row becomes a scanned message with its bank and its timestamp',
    relay.relayRowToScannedSms(row).sender === row.sender &&
      relay.relayRowToScannedSms(row).smsTs === Date.parse(row.receivedAt) &&
      relay.relayRowToScannedSms(row).receivedAt === undefined &&
      relay.relayRowToScannedSms(row).market === undefined &&
      !('raw' in relay.relayRowToScannedSms(row)));

  /* ═════════ End to end: the Shortcut, the Worker, and the phone ═════════
   *
   * No canned responses here. The transport is the real `export default
   * { fetch }` from server/src/index.ts over a real SQLite database built from
   * the real schema.sql, and the client is the real relay.ts.
   */
  {
    freshDevice();
    const db = new DatabaseSync(':memory:');
    db.exec(readFileSync(SCHEMA_PATH, 'utf8'));
    // D1 is SQLite. The adapter renames methods and reports `changes`, which is
    // what the Worker reads to tell a queued row from one a replay receipt
    // refused — get that wrong and the duplicate assertions below go green for
    // the wrong reason.
    const statement = (sql, params = []) => ({
      bind: (...values) => statement(sql, values),
      first: async () => db.prepare(sql).get(...params) ?? null,
      all: async () => ({ results: db.prepare(sql).all(...params) }),
      run: async () => {
        const info = db.prepare(sql).run(...params);
        return { results: [], meta: { changes: Number(info.changes ?? 0) } };
      },
    });
    const env = {
      DB: {
        prepare: (sql) => statement(sql),
        batch: async (statements) => {
          const out = [];
          for (const s of statements) out.push(await s.run());
          return out;
        },
      },
      // 32 bytes, standard base64 — the Worker secret that encrypts push tokens
      // at rest. Without it the Worker registers nothing and sends no wake.
      PUSH_TOKEN_KEY: Buffer.from(webcrypto.getRandomValues(new Uint8Array(32))).toString('base64'),
      EXPO_PROJECT_ID: '11111111-2222-4333-8444-555555555555',
    };

    const pushes = [];
    const deferred = [];
    // Workers hands the handler an ExecutionContext; collecting what it defers
    // is what lets this assert the wake instead of racing it.
    const ctx = { waitUntil: (promise) => deferred.push(promise) };
    const settle = async () => {
      while (deferred.length) await deferred.shift();
    };
    globalThis.fetch = async (url, init = {}) => {
      const target = String(url);
      // The Worker's own wake call to Expo. Recorded rather than performed.
      if (target.startsWith('https://exp.host/')) {
        pushes.push(JSON.parse(init.body));
        return json(200, { data: { status: 'ok' } });
      }
      return worker.fetch(new Request(target, init), env, ctx);
    };

    const cfg = await relay.pairDevice(BASE, 'iPhone', 'AE');
    ok('e2e: the real Worker paired the real client',
      !!cfg.ingestToken && !!cfg.syncToken && !!cfg.adminToken && !!cfg.deviceId);
    ok('e2e: the three bearers are three different secrets',
      new Set([cfg.ingestToken, cfg.syncToken, cfg.adminToken]).size === 3);

    await relay.registerRelayPush(cfg, 'ExponentPushToken[e2e-device-token]', env.EXPO_PROJECT_ID);
    ok('e2e: the push address is stored as ciphertext, never as itself',
      !JSON.stringify(db.prepare('SELECT * FROM push_registrations').all())
        .includes('e2e-device-token'));

    /**
     * What the user's Shortcut does, verbatim. `eventId` is what the published
     * Shortcut sends once per automation run and reuses if its HTTP action
     * retries; omitting it falls back to the body as the identity, which is why
     * posting the same text twice below collapses without one.
     */
    const shortcutPost = (text, sender, receivedAt = '2026-07-17T09:00:00.000Z', eventId) =>
      fetch(cfg.ingestUrl, {
        method: 'POST',
        headers: { authorization: `Bearer ${cfg.ingestToken}`, 'content-type': 'application/json' },
        body: JSON.stringify({ text, sender, receivedAt, ...(eventId ? { eventId } : {}) }),
      });

    const accepted = await shortcutPost(ADIB_CARD, 'ADIB');
    eq('e2e: the relay accepts a bank message', accepted.status, 202);
    const ignored = await shortcutPost(NOT_A_TRANSACTION, 'Careem');
    eq('e2e: and stores nothing for a message that is not one', ignored.status, 204);
    eq('e2e: the queue holds exactly the one transaction',
      db.prepare('SELECT COUNT(*) n FROM queue').get().n, 1);
    const dumpAll = () =>
      JSON.stringify([
        db.prepare('SELECT * FROM queue').all(),
        db.prepare('SELECT * FROM devices').all(),
        db.prepare('SELECT * FROM ingest_receipts').all(),
        db.prepare('SELECT * FROM push_registrations').all(),
      ]);
    ok('e2e: with the message text nowhere in the database', !dumpAll().includes('LULU'));
    ok('e2e: and the bank that sent it nowhere either — it is inside the seal',
      !dumpAll().includes('ADIB'));

    await settle();
    eq('e2e: queuing a row woke the phone', pushes.length, 1);
    eq('e2e: with nothing in the payload but "come and collect"',
      pushes[0].data, { kind: 'wafra.sync', v: 1 });
    ok('e2e: and no title or body that could leak a purchase',
      !('title' in pushes[0]) && !('body' in pushes[0]) && pushes[0]._contentAvailable === true);

    // The Shortcut's token lives outside the app forever and is readable by
    // anyone who opens the automation. It must not be able to touch the queue.
    const ingestReadsQueue = await fetch(`${BASE}/v1/sync`, {
      headers: { authorization: `Bearer ${cfg.ingestToken}` },
    });
    const ingestAcks = await fetch(`${BASE}/v1/ack`, {
      method: 'POST',
      headers: { authorization: `Bearer ${cfg.ingestToken}`, 'content-type': 'application/json' },
      body: JSON.stringify({ ids: ['11111111-1111-4111-8111-111111111111'] }),
    });
    const ingestDeletes = await fetch(`${BASE}/v1/device`, {
      method: 'DELETE',
      headers: { authorization: `Bearer ${cfg.ingestToken}` },
    });
    eq("e2e: the Shortcut's token cannot read the queue", ingestReadsQueue.status, 401);
    eq('e2e: cannot acknowledge it', ingestAcks.status, 401);
    eq('e2e: and cannot delete the device', ingestDeletes.status, 401);
    const syncCannotDelete = await fetch(`${BASE}/v1/device`, {
      method: 'DELETE',
      headers: { authorization: `Bearer ${cfg.syncToken}` },
    });
    eq('e2e: nor can the credential a locked phone carries', syncCannotDelete.status, 401);

    const collected = await relay.syncRelay(cfg);
    eq('e2e: the phone opened what the Worker sealed', collected.parsed.length, 1);
    const captured = collected.parsed[0];
    eq('e2e: the amount is exact', captured.amountFils, 12000);
    // Without the sender this card is 'unknown' — a grey tile with no bank.
    // With it, the Sharia-compliant issuer's "available limit" wording is read
    // for what it is and the card is a credit card.
    eq('e2e: the sender reached the PARSER, not just the row',
      captured.card, { last4: '4417', kind: 'credit' });
    eq('e2e: the bank label survives for card attribution', captured.sender, 'ADIB');
    eq("e2e: the timestamp is the message's, not the relay's receipt time",
      captured.smsTs, Date.parse('2026-07-17T09:00:00.000Z'));
    ok('e2e: no message text came back with it', captured.raw === undefined);

    eq('e2e: collecting does not delete', db.prepare('SELECT COUNT(*) n FROM queue').get().n, 1);
    await relay.ackRelay(cfg, collected.ids);
    eq('e2e: acknowledging does', db.prepare('SELECT COUNT(*) n FROM queue').get().n, 0);
    const again = await relay.syncRelay(cfg);
    eq('e2e: and nothing is left to collect twice', again.parsed.length, 0);

    // A Shortcut whose HTTP action retries. The relay's keyed replay receipt
    // collapses it, so one purchase cannot be filed as two.
    await shortcutPost(AE_PURCHASE, 'EmiratesNBD');
    await shortcutPost(AE_PURCHASE, 'EmiratesNBD');
    await settle();
    eq('e2e: a Shortcut that fires twice queues one row',
      db.prepare('SELECT COUNT(*) n FROM queue').get().n, 1);
    const retried = await relay.syncRelay(cfg);
    await relay.ackRelay(cfg, retried.ids);

    // The same message under two packs is two different transactions. Under AE
    // a Saudi alert is converted at a fallback rate and loses its category;
    // under SA it is read as the bank actually sent it.
    // Distinct eventIds: these two posts carry the SAME text, and without them
    // the relay would (correctly) collapse the second as a Shortcut retry.
    await shortcutPost(SA_PURCHASE, 'ALRAJHI', '2026-07-18T09:00:00.000Z', 'sa-under-ae-01');
    const underAe = await relay.syncRelay(cfg);
    await relay.ackRelay(cfg, underAe.ids);
    eq('market: an SA message on an AE device is converted and guessed at',
      [underAe.parsed[0].currency, underAe.parsed[0].amountFils],
      ['AED', 4407]);

    const switched = await relay.setRelayMarket(cfg, 'SA');
    await shortcutPost(SA_PURCHASE, 'ALRAJHI', '2026-07-19T09:00:00.000Z', 'sa-under-sa-01');
    const underSa = await relay.syncRelay(switched);
    await relay.ackRelay(switched, underSa.ids);
    eq('market: the same message on an SA device is read as sent',
      [underSa.parsed[0].currency, underSa.parsed[0].amountFils],
      ['SAR', 4500]);
    ok('market: and it was the DEVICE that decided, not the relay',
      underAe.parsed[0].amountFils !== underSa.parsed[0].amountFils);

    // Unpair reaches the real Worker and takes the device with it.
    await relay.unpairDevice(switched);
    eq('e2e: unpairing erases the device server-side',
      db.prepare('SELECT COUNT(*) n FROM devices').get().n, 0);
    eq('e2e: its push registration goes with it',
      db.prepare('SELECT COUNT(*) n FROM push_registrations').get().n, 0);
    eq('e2e: and every local credential too',
      [secure.__keychain.items.get(KEY), secure.__keychain.items.get(BACKGROUND_KEY)],
      [undefined, undefined]);
    eq('e2e: the app now reports no pairing at all', await relay.getRelayConfig(), null);
  }

  /* ── The collector above the client: src/lib/capture.ts ─────────────── */
  //
  // Everything above drives relay.ts. This drives the module that decides what
  // to DO with what relay.ts returns, because two defects lived there and
  // neither was visible from either side alone:
  //
  //   • THE SETUP PROBE. syncRelay() reports a probe id in both `ids` and
  //     `testIds`, and only /ios-setup may acknowledge it. Home mounts
  //     useAutoImport(true) underneath the setup flow, so returning to Wafra
  //     after running the Shortcut fires a foreground scan; that scan acked the
  //     probe, the setup screen's poll timed out, and the retry it offered was
  //     byte-identical, so the relay's replay receipt refused it and refreshed
  //     its own expiry. Every "Try again" extended the block.
  //   • THE STAGING WIPE. commit() cleared the whole staging key rather than
  //     the rows it read, so a push wake that appended and ACKNOWLEDGED rows
  //     during the user's review had them deleted from the phone after the
  //     relay had already let them go.
  //
  // capture.ts cannot be required — background-relay.ts pulls expo-task-manager
  // in at module scope — so it is transpiled here with its dependencies
  // replaced by doubles, the same way db.test.js executes store.tsx. The
  // storage adapter is NOT a double: the real web backgroundRelayStorage runs,
  // because the compare-and-swap is the thing under test.
  {
    const ts = require('typescript');
    const fs = require('fs');
    const path = require('path');
    const ROOT = path.join(__dirname, '../..');
    const execute = (rel, requireModule) => {
      const filename = path.join(ROOT, rel);
      const output = ts.transpileModule(fs.readFileSync(filename, 'utf8'), {
        compilerOptions: {
          module: ts.ModuleKind.CommonJS,
          target: ts.ScriptTarget.ES2022,
          esModuleInterop: true,
        },
        fileName: filename,
      }).outputText;
      const loaded = { exports: {} };
      Function('require', 'module', 'exports', '__filename', '__dirname', output)(
        requireModule, loaded, loaded.exports, filename, path.dirname(filename),
      );
      return loaded.exports;
    };

    // AsyncStorage as a Map, so a "push wake" can be made to land at an exact
    // point between the read and the commit.
    const disk = new Map();
    const storage = execute('src/lib/background-relay-storage.ts', (id) => {
      if (id === '@react-native-async-storage/async-storage') {
        return {
          __esModule: true,
          default: {
            getItem: async (k) => (disk.has(k) ? disk.get(k) : null),
            setItem: async (k, v) => void disk.set(k, v),
            removeItem: async (k) => void disk.delete(k),
          },
        };
      }
      throw new Error(`unexpected storage dependency ${id}`);
    }).backgroundRelayStorage;

    const QUEUE_KEY = 'wafra/background-relay/v1';
    const row = (ts_, merchant) => ({
      smsTs: ts_, amountFils: 1000, type: 'debit', merchant,
      currency: 'AED', category: 'other',
    });
    const stage = (rows) => disk.set(QUEUE_KEY, JSON.stringify(rows));
    const staged = () => JSON.parse(disk.get(QUEUE_KEY) ?? '[]').map((r) => r.merchant);

    let synced = { parsed: [], ids: [], unreadable: 0, testReceived: 0, testIds: [] };
    let acked = [];
    const captureDep = (id) => {
      if (id === '@/lib/background-relay-storage') return { backgroundRelayStorage: storage };
      if (id === '@/lib/background-relay') {
        return {
          // The real reader's shape: parse whatever is on disk right now.
          readBackgroundRelayRows: async () =>
            JSON.parse(disk.get(QUEUE_KEY) ?? '[]'),
          clearBackgroundRelayRows: async () => void disk.delete(QUEUE_KEY),
        };
      }
      if (id === '@/lib/relay') {
        return {
          isRelayPlatform: () => true,
          getRelayConfig: async () => ({ setupState: 'verified' }),
          syncRelay: async () => synced,
          ackRelay: async (_cfg, ids) => void acked.push(...ids),
        };
      }
      if (id === '@/lib/auto-import') {
        return {
          isSmsScanningAvailable: () => false,
          scanInbox: async () => ({ parsed: [], newestTs: 0 }),
          buildImportPlan: (parsed) => ({ parsed }),
        };
      }
      if (id === '@/lib/sms-parser') return { PARSER_VERSION: 1 };
      throw new Error(`unexpected capture dependency ${id}`);
    };

    const capture = execute('src/lib/capture.ts', captureDep);
    const state = { parserVersion: 1, lastScanTs: 0, privateMode: false, merchantOverrides: {} };

    /* Defect A — the foreground scan must not eat the setup probe. */
    {
      disk.clear();
      acked = [];
      synced = {
        parsed: [row(1000, 'CARREFOUR')],
        // A probe id is reported twice on purpose; see relay.ts.
        ids: ['aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa', 'pppppppp-pppp-4ppp-8ppp-pppppppppppp'],
        unreadable: 0, testReceived: 1,
        testIds: ['pppppppp-pppp-4ppp-8ppp-pppppppppppp'],
      };
      const result = await capture.collectNewMessages(state);
      await result.commit();
      eq('probe: a foreground scan acknowledges the bank row and reserves the probe',
        acked, ['aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa']);
      ok('probe: so the setup screen still has something left to observe',
        !acked.includes('pppppppp-pppp-4ppp-8ppp-pppppppppppp'),
        'acking it here is why "Run test" timed out on a working phone');
    }

    /* And a scan that finds ONLY a probe must acknowledge nothing at all. */
    {
      disk.clear();
      acked = [];
      synced = {
        parsed: [], ids: ['pppppppp-pppp-4ppp-8ppp-pppppppppppp'],
        unreadable: 0, testReceived: 1,
        testIds: ['pppppppp-pppp-4ppp-8ppp-pppppppppppp'],
      };
      const result = await capture.collectNewMessages(state);
      await result.commit();
      eq('probe: a scan that finds only a probe acks nothing', acked, []);
    }

    /* Defect B — the commit clears the rows it read and no others. */
    {
      disk.clear();
      acked = [];
      stage([row(1, 'ADNOC'), row(2, 'SPINNEYS'), row(3, 'TALABAT')]);
      synced = { parsed: [], ids: [], unreadable: 0, testReceived: 0, testIds: [] };
      const result = await capture.collectNewMessages(state);
      eq('staging: the import reads what the wake left behind',
        result.parsed.map((r) => r.merchant), ['ADNOC', 'SPINNEYS', 'TALABAT']);
      await result.commit();
      eq('staging: an uncontended commit clears the queue', staged(), []);
    }

    {
      disk.clear();
      acked = [];
      stage([row(1, 'ADNOC'), row(2, 'SPINNEYS'), row(3, 'TALABAT')]);
      synced = { parsed: [], ids: [], unreadable: 0, testReceived: 0, testIds: [] };
      const result = await capture.collectNewMessages(state);
      // The user is now reviewing. A push wake appends two rows and — this is
      // the part that makes it data loss rather than a re-sync — acknowledges
      // them to the relay, which drops them from the server queue.
      stage([
        row(1, 'ADNOC'), row(2, 'SPINNEYS'), row(3, 'TALABAT'),
        row(4, 'NOON'), row(5, 'CAREEM'),
      ]);
      await result.commit();
      eq('staging: a commit refuses to delete rows a wake appended after the read',
        staged(), ['ADNOC', 'SPINNEYS', 'TALABAT', 'NOON', 'CAREEM']);

      // Nothing is stranded: the next pass reads all five, and the ledger
      // fingerprints the three it already has.
      const next = await capture.collectNewMessages(state);
      eq('staging: the next import picks the whole queue up',
        next.parsed.map((r) => r.merchant),
        ['ADNOC', 'SPINNEYS', 'TALABAT', 'NOON', 'CAREEM']);
      await next.commit();
      eq('staging: and clears it once nothing has moved', staged(), []);
    }

    /* The unpaired branch stages rows too, and clears them the same way. */
    {
      disk.clear();
      acked = [];
      stage([row(1, 'ADNOC')]);
      const unpaired = execute('src/lib/capture.ts', (id) => {
        if (id === '@/lib/relay') {
          return {
            isRelayPlatform: () => true,
            getRelayConfig: async () => ({ setupState: 'paired' }),
            syncRelay: async () => { throw new Error('an unfinished setup must not sync'); },
            ackRelay: async () => { throw new Error('an unfinished setup must not ack'); },
          };
        }
        return captureDep(id);
      });
      const result = await unpaired.collectNewMessages(state);
      eq('staging: an unfinished setup still folds in what a wake collected',
        result.parsed.map((r) => r.merchant), ['ADNOC']);
      stage([row(1, 'ADNOC'), row(2, 'NOON')]);
      await result.commit();
      eq('staging: and its commit is conditional too',
        staged(), ['ADNOC', 'NOON']);
    }

    /* A snapshot of nothing owns nothing. */
    {
      disk.clear();
      acked = [];
      synced = { parsed: [row(9, 'LULU')], ids: ['bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb'],
        unreadable: 0, testReceived: 0, testIds: [] };
      const result = await capture.collectNewMessages(state);
      // The queue was empty when this import read it; a wake filled it after.
      stage([row(10, 'NOON')]);
      await result.commit();
      eq('staging: an import that read an empty queue deletes nothing from it',
        staged(), ['NOON']);
      eq('staging: while its own relay rows are still acknowledged',
        acked, ['bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb']);
    }
  }

  // The parser's active pack is module-level state. Leave it as found, so a
  // suite that runs after this one is not reading Saudi rules.
  setActiveMarket('AE');
  console.log(`\n${pass} passed, ${fail} failed`);
  process.exit(fail ? 1 : 0);
})().catch((e) => {
  console.error(e);
  process.exit(1);
});
