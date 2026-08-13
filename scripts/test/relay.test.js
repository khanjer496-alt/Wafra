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
//     device while every ordinary Node test passed. The Hermes regressions
//     below temporarily remove Node's global while the expo-crypto stub keeps
//     its captured native CSPRNG, covering both first-time pairing and a
//     returning device's first decrypt.
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
  /* ═════════════════════ Shortcut installer URLs ═════════════════════ */

  {
    const icloud = 'https://www.icloud.com/shortcuts/0000000000000000000000000000abcd';
    const betaFile =
      'https://raw.githubusercontent.com/khanjer496-alt/Wafra/3f43134e280bfe7b0cd82aabe55a664139debf1a/assets/shortcuts/Wafra%20Capture.shortcut';

    eq('shortcut URL: public iCloud links remain the production format',
      relay.normalizeShortcutInstallUrl(icloud), icloud);
    eq('shortcut URL: a signed beta file is rejected by default',
      relay.normalizeShortcutInstallUrl(betaFile), null);
    eq('shortcut URL: the explicit beta gate accepts only the Wafra release asset',
      relay.normalizeShortcutInstallUrl(betaFile, true), betaFile);
    eq('shortcut URL: the beta gate does not accept arbitrary GitHub files',
      relay.normalizeShortcutInstallUrl(
        'https://raw.githubusercontent.com/other/repo/3f43134e280bfe7b0cd82aabe55a664139debf1a/assets/shortcuts/Wafra%20Capture.shortcut',
        true,
      ), null);
  }

  /* ═════════════════════════ Pairing ═════════════════════════ */

  {
    // Hermes has no Web Crypto global. expo-crypto still has a native CSPRNG,
    // represented by the test stub's captured WebCrypto function. Pairing must
    // bridge that primitive before Noble enters X25519, or a real iPhone throws
    // "crypto.getRandomValues must be defined" before making any request.
    const originalCrypto = globalThis.crypto;
    Object.defineProperty(globalThis, 'crypto', {
      configurable: true,
      value: undefined,
      writable: true,
    });
    try {
      freshDevice();
      const net = transport().install();
      net.on('POST /v1/pair', () => json(200, credentials()));

      await relay.pairDevice(BASE, 'Hermes iPhone', 'AE');

      ok('pair: Expo native randomness is bridged onto the missing Hermes crypto global',
        typeof globalThis.crypto?.getRandomValues === 'function');
      ok('pair: the Hermes bridge still reaches the relay with a valid public key',
        decodeKey(net.last('POST /v1/pair').body.publicKey).length === 32);
    } finally {
      Object.defineProperty(globalThis, 'crypto', {
        configurable: true,
        value: originalCrypto,
        writable: true,
      });
    }
  }

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
    const firstIssued = credentials();
    const replacementIssued = credentials();
    const issued = [firstIssued, replacementIssued];
    const net = transport().install()
      .on('POST /v1/pair', () => json(200, issued.shift()))
      .on('DELETE /v1/device', () => json(204));
    const first = await relay.pairDevice(BASE, 'First pairing', 'AE');
    const replacement = await relay.pairDevice(BASE, 'Replacement pairing', 'AE');

    let staleWriteRefused = false;
    try {
      await relay.markRelayVerified(first);
    } catch (error) {
      staleWriteRefused = error?.code === 'stale_pairing';
    }
    ok('credentials: an old setup poll cannot overwrite a replacement pairing',
      staleWriteRefused && storedConfig().syncToken === replacement.syncToken);

    let replacedCleanup = null;
    try {
      await relay.unpairDevice(first);
    } catch (error) {
      replacedCleanup = error;
    }
    ok('credentials: cleaning up an abandoned device cannot delete its replacement',
      replacedCleanup?.code === 'local_credentials_replaced' &&
        storedConfig().syncToken === replacement.syncToken &&
        net.last('DELETE /v1/device').auth === `Bearer ${first.adminToken}`,
      JSON.stringify({ code: replacedCleanup?.code, stored: storedConfig()?.syncToken }));
  }

  {
    freshDevice();
    const firstIssued = credentials();
    const replacementIssued = credentials();
    let finishFirst;
    let finishReplacement;
    const net = transport().install()
      .on('POST /v1/pair', (call) => new Promise((resolve) => {
        if (call.body.deviceName === 'First pairing') finishFirst = resolve;
        else finishReplacement = resolve;
      }))
      .on('DELETE /v1/device', () => json(204));

    const firstPending = relay.pairDevice(BASE, 'First pairing', 'AE');
    const replacementPending = relay.pairDevice(BASE, 'Replacement pairing', 'AE');
    finishReplacement(json(200, replacementIssued));
    const replacement = await replacementPending;
    finishFirst(json(200, firstIssued));
    let firstError = null;
    try {
      await firstPending;
    } catch (error) {
      firstError = error;
    }

    ok('credentials: a late abandoned pairing cannot overwrite a newer completion',
      firstError?.code === 'stale_pairing' &&
        storedConfig().syncToken === replacement.syncToken);
    ok('credentials: the late remote identity is retired with its own admin token',
      net.last('DELETE /v1/device').auth === `Bearer ${firstIssued.adminToken}`);
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
    eq('config: a strict destructive read distinguishes proven absence',
      await relay.getRelayConfigStrict(), null);

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
    eq('config: a strict destructive read returns a verified pairing',
      (await relay.getRelayConfigStrict())?.deviceId, stored.deviceId);

    secure.__keychain.items.set(KEY, JSON.stringify({ ...stored, syncToken: 'short' }));
    eq('config: a credential that is not credential-shaped fails closed',
      await relay.getRelayConfig(), null);
    let strictInvalid = null;
    try {
      await relay.getRelayConfigStrict();
    } catch (error) {
      strictInvalid = error;
    }
    ok('config: a destructive read refuses malformed stored credentials',
      strictInvalid?.code === 'local_credentials_unavailable' &&
        !strictInvalid.message.includes('short'));
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
    let strictUnavailable = null;
    try {
      await relay.getRelayConfigStrict();
    } catch (error) {
      strictUnavailable = error;
    }
    ok('config: a destructive read stops on an unavailable keychain without leaking native text',
      strictUnavailable?.code === 'local_credentials_unavailable' &&
        !strictUnavailable.message.includes('keychain'));
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
    // A returning phone already has its private key and never calls pairDevice
    // in this JS session. Its first Noble operation is ECDH while opening the
    // synced row, so that path must install the Hermes bridge independently.
    const { net, cfg } = await paired();
    const item = await queueItem(
      '01010101-0101-4101-8101-010101010101',
      rowFor(AE_PURCHASE),
    );
    net.on('GET /v1/sync', () => json(200, { items: [item] }));

    const originalCrypto = globalThis.crypto;
    Object.defineProperty(globalThis, 'crypto', {
      configurable: true,
      value: undefined,
      writable: true,
    });
    try {
      const result = await relay.syncRelay(cfg);
      ok('sync: a returning Hermes device installs the native randomness bridge before ECDH',
        typeof globalThis.crypto?.getRandomValues === 'function');
      eq('sync: a returning Hermes device opens its queued row without re-pairing',
        result.parsed.length, 1);
    } finally {
      Object.defineProperty(globalThis, 'crypto', {
        configurable: true,
        value: originalCrypto,
        writable: true,
      });
    }
  }

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

  /* ═════════════════ Revoked from another device ═════════════════
   *
   * The owner removes this phone from a second device. Nothing tells this
   * phone: the relay deletes the row that authenticates it and the only
   * symptom is a 401 on the next /v1/sync. That throw existed and nothing
   * consumed it — the Keychain kept a 'verified' config and its automation
   * proof, so Home reported live capture forever over a pipe that answered
   * 401 to every request, and the user had no way back to pairing from inside
   * the app. These assertions are what stops that returning.
   */

  {
    const { net, cfg } = await paired();
    const before = storedConfig();
    net.on('GET /v1/sync', () => json(401, { error: 'unauthorized' }));
    let thrown = null;
    try {
      await relay.syncRelay(cfg);
    } catch (e) {
      thrown = e;
    }
    ok('lost pairing: 401 is permanent and says so, so the UI can offer setup again',
      thrown?.name === 'RelayError' && thrown.retryable === false);
    eq('lost pairing: and names the one condition a retry cannot fix',
      [thrown?.code, thrown?.status], ['device_revoked', 401]);

    // The app must stop claiming to be paired, on both surfaces: the
    // foreground one every screen reads, and the locked-phone one the headless
    // wake reads — otherwise every push re-authenticates against a device the
    // relay has already deleted.
    eq('lost pairing: the app stops reporting a pairing at all',
      await relay.getRelayConfig(), null);
    eq('lost pairing: and the headless wake stops trying too',
      await relay.getBackgroundRelayConfig(), null);
    ok('lost pairing: a cut-off device is still distinguishable from one never set up',
      (await relay.getRelayRevokedAt()) > 0);

    // MARKED, NOT DESTROYED. A 401 is also what a captive portal or an
    // authenticating proxy answers. The X25519 private key is the only thing
    // that can ever open a row still sealed in the queue, and the admin token
    // is the only thing that can delete this device server-side; neither is
    // recoverable once erased, so a single 401 on one hostile network must not
    // be allowed to erase them.
    const kept = storedConfig();
    ok('lost pairing: the X25519 private key survives the refusal',
      kept?.privateKey === before.privateKey && decodeKey(kept.privateKey).length === 32);
    ok('lost pairing: so does the credential that can still erase this device',
      kept?.adminToken === before.adminToken);
    const strictMarked = await relay.getRelayConfigStrict();
    ok('lost pairing: destructive erase can still authenticate a marked device',
      strictMarked?.deviceId === cfg.deviceId &&
        strictMarked?.adminToken === cfg.adminToken &&
        strictMarked?.revokedAt === kept.revokedAt);
    const backgroundWrite = [...secure.__keychain.writes].reverse()
      .find((w) => w.key === BACKGROUND_KEY);
    ok('lost pairing: the locked-phone item is stamped at its own accessibility class',
      storedConfig(BACKGROUND_KEY)?.revokedAt === kept.revokedAt &&
        backgroundWrite.options.keychainAccessible ===
          secure.AFTER_FIRST_UNLOCK_THIS_DEVICE_ONLY);

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

  for (const status of [200, 401, 404]) {
    const { net, cfg } = await paired();
    net.on('DELETE /v1/device', () => json(status, {
      error: status === 401 ? 'unauthorized' : 'not_found',
    }));
    let thrown = null;
    try {
      await relay.unpairDevice(cfg);
    } catch (error) {
      thrown = error;
    }
    ok(`unpair: ${status} is not accepted as proof of remote deletion`,
      thrown?.status === status && storedConfig()?.adminToken === cfg.adminToken);
  }

  {
    const { net, cfg } = await paired();
    let attempts = 0;
    net.on('DELETE /v1/device', () => {
      attempts += 1;
      if (attempts === 1) secure.__keychain.failReads = true;
      return json(204);
    });
    let thrown = null;
    try {
      await relay.unpairDevice(cfg);
    } catch (error) {
      thrown = error;
    }
    secure.__keychain.failReads = false;
    ok('unpair: remote success cannot hide a failed local credential cleanup',
      thrown?.code === 'local_cleanup_unavailable' &&
        thrown?.retryable === true &&
        storedConfig()?.adminToken === cfg.adminToken,
      JSON.stringify({ code: thrown?.code, retryable: thrown?.retryable, stored: storedConfig() }));
    await relay.unpairDevice(cfg);
    ok('unpair: an idempotent remote retry can finish the pending local cleanup',
      attempts === 2 && storedConfig() === null);
  }

  {
    // The transient failures, against a phone that is genuinely fine. Getting
    // this wrong unpairs a working device from a hotel wifi.
    const { net, cfg } = await paired();
    net.on('GET /v1/sync', () => json(503, { error: 'unavailable' }));
    await relay.syncRelay(cfg).catch(() => {});
    net.on('GET /v1/sync', () => {
      throw new Error('radio off');
    });
    await relay.syncRelay(cfg).catch(() => {});
    ok('offline: neither a 5xx nor a dead radio marks a working phone revoked',
      (await relay.getRelayConfig())?.syncToken === cfg.syncToken &&
        (await relay.getRelayRevokedAt()) === null);
  }

  {
    // A 401 can land after the credential it was sent with has been replaced —
    // a sync in flight while the user re-pairs. Stamping on the STORED token
    // rather than the refused one would kill the pairing that replaced it.
    const { net, cfg } = await paired();
    net.on('GET /v1/sync', () => json(401, { error: 'unauthorized' }));
    await relay.syncRelay({ ...cfg, syncToken: `sync-${'z'.repeat(40)}` }).catch(() => {});
    ok('lost pairing: a 401 for a credential that has since been replaced stamps nothing',
      (await relay.getRelayConfig())?.syncToken === cfg.syncToken &&
        (await relay.getRelayRevokedAt()) === null);
  }

  {
    // The route back. /ios-setup reads getRelayConfig() to decide which step
    // to open on: null is what puts the user at step 1 instead of at the test
    // step, where the poll could only 401 forever.
    const { net, cfg } = await paired();
    net.on('GET /v1/sync', () => json(401, { error: 'unauthorized' }));
    await relay.syncRelay(cfg).catch(() => {});
    const fresh = await relay.pairDevice(BASE);
    ok('lost pairing: pairing again clears the mark and the phone works once more',
      (await relay.getRelayRevokedAt()) === null &&
        (await relay.getRelayConfig())?.deviceId === fresh.deviceId &&
        (await relay.getBackgroundRelayConfig())?.deviceId === fresh.deviceId);
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
      await relay.getRelayAutomationProof(cfg.deviceId), null);
    await relay.recordRelayAutomationProof(cfg, 1_800_000_000_000);
    eq('proof: the headless task can record one',
      await relay.getRelayAutomationProof(cfg.deviceId), 1_800_000_000_000);
    const write = [...secure.__keychain.writes].reverse().find((w) => w.key === PROOF_KEY);
    eq('proof: written where a locked-phone wake can write it',
      write.options.keychainAccessible, secure.AFTER_FIRST_UNLOCK_THIS_DEVICE_ONLY);
    const marked = await relay.markRelayVerified(cfg);
    eq('proof: the synthetic pipe test stays a separate, weaker claim',
      marked.setupState, 'verified');
  }

  {
    freshDevice();
    const firstIssued = credentials();
    const replacementIssued = credentials();
    const issued = [firstIssued, replacementIssued];
    transport().install()
      .on('POST /v1/pair', () => json(200, issued.shift()))
      .on('DELETE /v1/device', () => json(204));
    const first = await relay.pairDevice(BASE, 'First pairing', 'AE');
    await relay.recordRelayAutomationProof(first, 1_800_000_000_000);
    const replacement = await relay.pairDevice(BASE, 'Replacement pairing', 'AE');
    eq('proof: an old device marker cannot activate its replacement',
      await relay.getRelayAutomationProof(replacement.deviceId), null);
    await relay.recordRelayAutomationProof(first, 1_800_000_000_001);
    eq('proof: a late old headless wake cannot stamp the replacement',
      await relay.getRelayAutomationProof(replacement.deviceId), null);
    await relay.recordRelayAutomationProof(replacement, 1_800_000_000_002);
    eq('proof: the replacement becomes active only after its own wake',
      await relay.getRelayAutomationProof(replacement.deviceId), 1_800_000_000_002);
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
  ok('row: the cash-withdrawal category crosses the sealed iOS relay',
    relay.isParsedRelayRow({
      ...row,
      merchant: 'ATM withdrawal',
      categoryGuess: 'cash-withdrawal',
    }));
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
  ok('row: linked bill-flow sides accept only their accounting direction',
    relay.isParsedRelayRow({ ...row, paymentFlowSide: 'receipt' }) &&
      relay.isParsedRelayRow({
        ...row,
        merchant: 'Outgoing transfer',
        transferHint: true,
        paymentFlowSide: 'funding',
      }) &&
      !relay.isParsedRelayRow({ ...row, paymentFlowSide: 'funding' }) &&
      !relay.isParsedRelayRow({ ...row, transferHint: true, paymentFlowSide: 'receipt' }) &&
      !relay.isParsedRelayRow({ ...row, paymentFlowSide: 'forged' }) &&
      !relay.isParsedRelayRow({ ...statementRow, paymentFlowSide: 'receipt' }));
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
      relay.relayRowToScannedSms(row).market === 'AE' &&
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

    // The alert itself selects the Saudi pack even while the paired device's
    // stored preference is UAE. Explicit SAR/bank evidence must not be
    // converted through the wrong launch parser.
    // Distinct eventIds: these two posts carry the SAME text, and without them
    // the relay would (correctly) collapse the second as a Shortcut retry.
    await shortcutPost(SA_PURCHASE, 'ALRAJHI', '2026-07-18T09:00:00.000Z', 'sa-under-ae-01');
    const underAe = await relay.syncRelay(cfg);
    await relay.ackRelay(cfg, underAe.ids);
    eq('market: an SA message on an AE device is read in its own currency',
      [underAe.parsed[0].currency, underAe.parsed[0].amountFils],
      ['SAR', 4500]);

    const switched = await relay.setRelayMarket(cfg, 'SA');
    await shortcutPost(SA_PURCHASE, 'ALRAJHI', '2026-07-19T09:00:00.000Z', 'sa-under-sa-01');
    const underSa = await relay.syncRelay(switched);
    await relay.ackRelay(switched, underSa.ids);
    eq('market: the same message on an SA device is read as sent',
      [underSa.parsed[0].currency, underSa.parsed[0].amountFils],
      ['SAR', 4500]);
    ok('market: per-alert evidence wins over the stored device preference',
      underAe.parsed[0].currency === underSa.parsed[0].currency &&
        underAe.parsed[0].amountFils === underSa.parsed[0].amountFils);

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
  //     `testIds`, and only /ios-setup may acknowledge it. The tabs shell mounts
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
          isRelayRevokedError: () => false,
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

    /* A restricted OEM provider can keep READ_SMS looking granted while
     * yielding no history. That must not stamp a parser migration complete
     * over an established SMS ledger, or historical recurring payments can
     * never be offered again. */
    {
      let requestedSince = null;
      const historyCapture = execute('src/lib/capture.ts', (id) => {
        if (id === '@/lib/background-relay-storage') return { backgroundRelayStorage: storage };
        if (id === '@/lib/background-relay') {
          return {
            readBackgroundRelayRows: async () => [],
            clearBackgroundRelayRows: async () => {},
          };
        }
        if (id === '@/lib/relay') {
          return {
            isRelayPlatform: () => false,
            getRelayConfig: async () => null,
            syncRelay: async () => ({ parsed: [], ids: [], testIds: [] }),
            ackRelay: async () => {},
            isRelayRevokedError: () => false,
          };
        }
        if (id === '@/lib/auto-import') {
          return {
            isSmsScanningAvailable: () => true,
            scanInbox: async (since) => {
              requestedSince = since;
              return {
                parsed: [], reviewCandidates: [], declined: [], newestTs: 900,
                inboxScannedCount: 0, scannedCount: 1,
                detectedLaunchMarket: null, commit: async () => {},
              };
            },
          };
        }
        if (id === '@/lib/sms-parser') return { PARSER_VERSION: 24 };
        throw new Error(`unexpected history-capture dependency ${id}`);
      });
      let code = null;
      try {
        await historyCapture.collectNewMessages({
          hydrated: true,
          parserVersion: 23,
          lastScanTs: 900,
          privateMode: false,
          captureOptOut: false,
          merchantOverrides: {},
          transactions: [{ source: 'sms' }],
        });
      } catch (error) {
        code = error?.code;
      }
      eq('parser migration: a version change requests the complete inbox', requestedSince, 0);
      eq('parser migration: an empty restricted history cannot be stamped complete',
        code, 'ERR_SMS_HISTORY_UNAVAILABLE');
    }

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

    /* Defect C — a device the relay has cut off must not read as connected.
     *
     * Two shapes, because the revocation can be discovered either before this
     * scan starts (getRelayConfig() already answers null for a stamped
     * credential) or by the sync this scan makes. Both have to end at "you are
     * not connected", and neither may lose a row a wake had already staged. */
    {
      disk.clear();
      acked = [];
      const revoked = execute('src/lib/capture.ts', (id) => {
        if (id === '@/lib/relay') {
          return {
            ...captureDep('@/lib/relay'),
            // What the real getRelayConfig() answers once the credential has
            // been stamped: a revoked config is not a pairing.
            getRelayConfig: async () => null,
            syncRelay: async () => {
              throw new Error('a revoked device must not reach the network');
            },
          };
        }
        return captureDep(id);
      });
      const result = await revoked.collectNewMessages(state);
      ok('revoked: a cut-off device asks for setup rather than reporting "up to date"',
        result.needsSetup === true && result.parsed.length === 0 && result.source === 'relay');
    }

    {
      disk.clear();
      acked = [];
      stage([row(1, 'ADNOC')]);
      const cut = Object.assign(new Error('This device is no longer paired.'), {
        name: 'RelayError', code: 'device_revoked', retryable: false, status: 401,
      });
      const midScan = execute('src/lib/capture.ts', (id) => {
        if (id === '@/lib/relay') {
          return {
            ...captureDep('@/lib/relay'),
            syncRelay: async () => { throw cut; },
            ackRelay: async () => { throw new Error('a revoked device cannot acknowledge'); },
            isRelayRevokedError: (e) => e === cut,
          };
        }
        return captureDep(id);
      });
      const result = await midScan.collectNewMessages(state);
      eq('revoked: a revocation found mid-scan still delivers what a wake staged',
        result.parsed.map((r) => r.merchant), ['ADNOC']);
      await result.commit();
      eq('revoked: retiring them acknowledges nothing to a relay that refused us',
        [staged(), acked], [[], []]);
      const next = await midScan.collectNewMessages(state);
      ok('revoked: and with the queue drained it is an honest "not connected"',
        next.needsSetup === true && next.parsed.length === 0);
    }

    {
      // The failure that is NOT a revocation still has to propagate. Swallowing
      // an offline sync into needsSetup would send a user with a working
      // pairing back into the setup wizard every time a tunnel dropped.
      disk.clear();
      acked = [];
      const offline = execute('src/lib/capture.ts', (id) => {
        if (id === '@/lib/relay') {
          return {
            ...captureDep('@/lib/relay'),
            syncRelay: async () => {
              throw Object.assign(new Error('Could not reach Wafra.'), {
                name: 'RelayError', retryable: true,
              });
            },
          };
        }
        return captureDep(id);
      });
      let threw = false;
      try {
        await offline.collectNewMessages(state);
      } catch {
        threw = true;
      }
      ok('revoked: an ordinary sync failure still throws instead of reading as unpaired', threw);
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

    /* The executor is the durability seam used by every non-setup collector.
     * Failures are injected at that interface so these tests survive moving the
     * implementation between capture, store, and relay modules. */
    {
      const emptyPlan = {
        batch: {}, txCount: 0, dueCount: 0, healedCount: 0,
        newAccountCount: 0, billDues: [],
      };
      const changedPlan = { ...emptyPlan, txCount: 1 };
      const reviewOnlyPlan = {
        ...emptyPlan,
        batch: { lastScanTs: 900 },
      };
      const executorModule = execute('src/lib/capture-executor.ts', (id) => {
        if (id === '@/lib/auto-import') return { buildImportPlan: () => emptyPlan };
        if (id === '@/lib/capture') {
          return {
            collectNewMessages: async () => ({
              parsed: [], declined: [], newestTs: 0,
              source: 'none', needsSetup: false, commit: async () => {},
            }),
          };
        }
        if (id === '@/lib/relay') {
          return {
            ackRelay: async () => {},
            getBackgroundRelayConfig: async () => null,
            getRelayConfig: async () => null,
            markRelayVerified: async (cfg) => ({ ...cfg, setupState: 'verified', verifiedAt: 1 }),
            syncRelay: async () => ({
              parsed: [], ids: [], testIds: [], unreadable: 0, testReceived: 0,
              shortcutRows: 0, shortcutRowsWithBank: 0,
            }),
          };
        }
        throw new Error(`unexpected capture executor dependency ${id}`);
      });
      const hydrated = { hydrated: true, lastScanTs: 0 };
      const ledger = (durable, events) => ({
        getState: () => hydrated,
        importBatch: () => {
          events.push('persist');
          return { ids: ['tx_1'], durable };
        },
        ensureDurable: async () => void events.push('flush'),
        markParserVersion: () => void events.push('parser'),
      });

      {
        const events = [];
        const failed = Promise.reject(new Error('SQLCipher write failed'));
        const executor = executorModule.createCaptureExecutor({
          ledger: ledger(failed, events),
          dependencies: {
            collectRoutine: async () => ({
              parsed: [row(1, 'SHOP')], declined: [], newestTs: 1,
              source: 'relay',
              needsSetup: false,
              commit: async () => void events.push('ack'),
            }),
            planRows: () => changedPlan,
          },
        });
        let threw = false;
        try {
          await executor.execute('routine');
        } catch {
          threw = true;
        }
        ok('capture executor: a failed ledger write rejects the routine import', threw);
        eq('capture executor: routine acknowledgement never crosses a failed durability barrier',
          events, ['persist']);
      }

      {
        const events = [];
        let release;
        const durable = new Promise((resolve) => { release = resolve; });
        const executor = executorModule.createCaptureExecutor({
          ledger: ledger(durable, events),
          dependencies: {
            collectRoutine: async () => ({
              parsed: [row(1, 'SHOP')], declined: [], newestTs: 1,
              source: 'relay',
              needsSetup: false,
              commit: async () => void events.push('ack'),
            }),
            planRows: () => changedPlan,
          },
        });
        const running = executor.execute('routine');
        await Promise.resolve();
        eq('capture executor: routine acknowledgement waits while durability is pending',
          events, ['persist']);
        release();
        await running;
        eq('capture executor: routine acknowledgement follows durable persistence',
          events, ['persist', 'ack']);
      }

      {
        const events = [];
        const executor = executorModule.createCaptureExecutor({
          ledger: ledger(Promise.resolve(), events),
          dependencies: {
            collectRoutine: async () => ({
              parsed: [row(1, 'SHOP')], declined: [], newestTs: 1,
              source: 'relay',
              needsSetup: false,
              commit: async () => void events.push('ack'),
            }),
          },
        });
        await executor.execute('routine');
        eq('capture executor: a deduplicated relay row flushes the ledger before acknowledgement',
          events, ['parser', 'flush', 'ack']);
      }

      {
        let current = { hydrated: true, lastScanTs: 1 };
        let plannedAt = 0;
        const executor = executorModule.createCaptureExecutor({
          ledger: {
            getState: () => current,
            importBatch: () => ({ ids: [], durable: Promise.resolve() }),
            ensureDurable: async () => {},
            markParserVersion: () => {},
          },
          dependencies: {
            collectRoutine: async () => {
              current = { hydrated: true, lastScanTs: 900 };
              return {
                parsed: [], declined: [], newestTs: 900,
                source: 'sms', needsSetup: false, commit: async () => {},
              };
            },
            planRows: (_rows, stateAtPlan) => {
              plannedAt = stateAtPlan.lastScanTs;
              return emptyPlan;
            },
          },
        });
        await executor.execute('routine');
        eq('capture executor: routine planning re-reads the ledger after inbox collection',
          plannedAt, 900);
      }

      {
        const events = [];
        let current = { hydrated: true, lastScanTs: 1, captureOptOut: false };
        const executor = executorModule.createCaptureExecutor({
          ledger: {
            getState: () => current,
            importBatch: () => {
              events.push('persist');
              return { ids: [], durable: Promise.resolve() };
            },
            stageReviewAlerts: () => {
              events.push('review-stage');
              return { admitted: 1, durable: Promise.resolve() };
            },
            ensureDurable: async () => void events.push('flush'),
            markParserVersion: () => void events.push('parser'),
            setMarket: () => {
              events.push('market');
              return true;
            },
          },
          dependencies: {
            collectRoutine: async () => {
              current = { hydrated: true, lastScanTs: 1, captureOptOut: true };
              return {
                parsed: [row(1, 'SHOP')], declined: [], newestTs: 2,
                reviewCandidates: [{ id: 'must-not-stage' }],
                detectedLaunchMarket: 'SA', source: 'relay', needsSetup: false,
                commit: async () => void events.push('ack'),
              };
            },
            planRows: () => {
              events.push('plan');
              return changedPlan;
            },
          },
        });
        const outcome = await executor.execute('routine');
        eq('capture executor: opting out during collection stages, imports and acknowledges nothing',
          events, []);
        ok('capture executor: an interrupted opt-out reports no imported source',
          outcome.kind === 'up-to-date' && outcome.source === 'none');
      }

      {
        const events = [];
        let releaseReview;
        const reviewDurable = new Promise((resolve) => { releaseReview = resolve; });
        const executor = executorModule.createCaptureExecutor({
          ledger: {
            ...ledger(Promise.resolve(), events),
            stageReviewAlerts: () => {
              events.push('review-stage');
              return { admitted: 1, durable: reviewDurable };
            },
          },
          dependencies: {
            collectRoutine: async () => ({
              parsed: [], declined: [], newestTs: 1,
              reviewCandidates: [{ id: 'structured-review' }],
              source: 'sms', needsSetup: false,
              commit: async () => void events.push('commit'),
            }),
            planRows: () => emptyPlan,
          },
        });
        const running = executor.execute('routine');
        await Promise.resolve();
        eq('capture executor: review-only capture waits behind encrypted staging',
          events, ['review-stage']);
        releaseReview();
        const outcome = await running;
        eq('capture executor: review-only commit follows encrypted staging',
          events, ['review-stage', 'parser', 'commit']);
        ok('capture executor: review-only outcome reports an aggregate count',
          outcome.kind === 'up-to-date' && outcome.reviewAlerts === 1,
          JSON.stringify(outcome));
      }

      {
        const events = [];
        let current = { hydrated: true, lastScanTs: 0, captureOptOut: false };
        let releaseReview;
        const reviewDurable = new Promise((resolve) => { releaseReview = resolve; });
        const executor = executorModule.createCaptureExecutor({
          ledger: {
            getState: () => current,
            importBatch: () => {
              events.push('persist');
              return { ids: [], durable: Promise.resolve() };
            },
            stageReviewAlerts: () => {
              events.push('review-stage');
              return { admitted: 1, durable: reviewDurable };
            },
            ensureDurable: async () => void events.push('flush'),
            markParserVersion: () => void events.push('parser'),
          },
          dependencies: {
            collectRoutine: async () => ({
              parsed: [], declined: [], newestTs: 1,
              reviewCandidates: [{ id: 'already-being-encrypted' }],
              source: 'relay', needsSetup: false,
              commit: async () => void events.push('ack'),
            }),
            planRows: () => emptyPlan,
          },
        });
        const running = executor.execute('routine');
        await Promise.resolve();
        current = { ...current, captureOptOut: true };
        releaseReview();
        const outcome = await running;
        eq('capture executor: opting out during review durability prevents cursor, import and ack',
          events, ['review-stage']);
        ok('capture executor: a durability-boundary opt-out reports no imported source',
          outcome.kind === 'up-to-date' && outcome.source === 'none');
      }

      {
        const events = [];
        const executor = executorModule.createCaptureExecutor({
          ledger: {
            ...ledger(Promise.resolve(), events),
            stageReviewAlerts: () => {
              events.push('review-stage');
              return { admitted: 1, durable: Promise.resolve() };
            },
          },
          dependencies: {
            collectRoutine: async () => ({
              parsed: [], declined: [], newestTs: 900,
              reviewCandidates: [{ id: 'structured-review' }],
              source: 'sms', needsSetup: false,
              commit: async () => void events.push('commit'),
            }),
            planRows: () => reviewOnlyPlan,
          },
        });
        await executor.execute('routine');
        eq('capture executor: review-only SMS cursor is durable before completion',
          events, ['review-stage', 'persist', 'parser', 'commit']);
      }

      {
        const events = [];
        const executor = executorModule.createCaptureExecutor({
          ledger: {
            ...ledger(Promise.resolve(), events),
            stageReviewAlerts: () => {
              events.push('review-stage');
              return {
                admitted: 1,
                durable: Promise.reject(new Error('review durability failed')),
              };
            },
          },
          dependencies: {
            collectRoutine: async () => ({
              parsed: [row(1, 'SHOP')], declined: [], newestTs: 1,
              reviewCandidates: [{ id: 'structured-review' }],
              source: 'sms', needsSetup: false,
              commit: async () => void events.push('commit'),
            }),
            planRows: () => changedPlan,
          },
        });
        let threw = false;
        try {
          await executor.execute('routine');
        } catch {
          threw = true;
        }
        ok('capture executor: failed review durability rejects mixed capture', threw);
        eq('capture executor: a failed review write cannot advance import or commit',
          events, ['review-stage']);
      }

      {
        const events = [];
        const cfg = { baseUrl: 'https://relay.test', syncToken: 's', privateKey: 'k' };
        const queued = {
          parsed: [row(20, 'ADNOC')],
          ids: ['bank-row', 'setup-probe'],
          testIds: ['setup-probe'],
          unreadable: 0, testReceived: 1, shortcutRows: 0, shortcutRowsWithBank: 0,
        };
        const executor = executorModule.createCaptureExecutor({
          ledger: ledger(Promise.resolve(), events),
          dependencies: {
            getRelay: async () => cfg,
            sync: async () => queued,
            planRows: () => changedPlan,
            acknowledge: async (_cfg, ids) => void events.push(`ack:${ids.join(',')}`),
          },
        });
        await executor.execute('supplemental');
        eq('capture executor: supplemental persistence precedes acknowledgement and reserves probes',
          events, ['persist', 'ack:bank-row']);
      }

      {
        const events = [];
        const cfg = {
          baseUrl: 'https://relay.test', syncToken: 's', privateKey: 'k', market: 'AE',
        };
        const marketLedger = {
          ...ledger(Promise.resolve(), events),
          getState: () => ({ ...hydrated, marketId: 'AE' }),
          setMarket: (market) => { events.push(`market:${market}`); return true; },
        };
        const executor = executorModule.createCaptureExecutor({
          ledger: marketLedger,
          dependencies: {
            getRelay: async () => cfg,
            sync: async () => ({
              parsed: [{ ...row(21, 'PANDA'), market: 'SA' }],
              ids: ['sa-row'], testIds: [], unreadable: 0, testReceived: 0,
              shortcutRows: 1, shortcutRowsWithBank: 1,
            }),
            planRows: () => changedPlan,
            acknowledge: async () => void events.push('ack'),
          },
        });
        await executor.execute('supplemental');
        eq('capture executor: a relay row pins its parsed market before ledger persistence',
          events, ['market:SA', 'persist', 'ack']);
      }

      {
        const events = [];
        const executor = executorModule.createCaptureExecutor({
          ledger: {
            ...ledger(Promise.resolve(), events),
            getState: () => ({ ...hydrated, marketId: 'AE' }),
            setMarket: () => false,
          },
          dependencies: {
            getRelay: async () => ({
              baseUrl: 'https://relay.test', syncToken: 's', privateKey: 'k', market: 'AE',
            }),
            sync: async () => ({
              parsed: [{ ...row(22, 'PANDA'), market: 'SA' }],
              ids: ['sa-row'], testIds: [], unreadable: 0, testReceived: 0,
              shortcutRows: 1, shortcutRowsWithBank: 1,
            }),
            planRows: () => changedPlan,
            acknowledge: async () => void events.push('ack'),
          },
        });
        let refused = false;
        try { await executor.execute('supplemental'); } catch { refused = true; }
        ok('capture executor: an opposite-currency ledger refuses before persistence or ack',
          refused && events.length === 0, JSON.stringify(events));
      }

      {
        const events = [];
        const executor = executorModule.createCaptureExecutor({
          ledger: {
            ...ledger(Promise.resolve(), events),
            getState: () => ({ ...hydrated, marketId: 'AE' }),
            setMarket: () => true,
          },
          dependencies: {
            getRelay: async () => ({
              baseUrl: 'https://relay.test', syncToken: 's', privateKey: 'k', market: 'AE',
            }),
            sync: async () => ({
              parsed: [row(23, 'LEGACY'), { ...row(24, 'PANDA'), market: 'SA' }],
              ids: ['legacy-ae', 'new-sa'], testIds: [], unreadable: 0, testReceived: 0,
              shortcutRows: 2, shortcutRowsWithBank: 2,
            }),
            planRows: () => changedPlan,
            acknowledge: async () => void events.push('ack'),
          },
        });
        let refused = false;
        try { await executor.execute('supplemental'); } catch { refused = true; }
        ok('capture executor: mixed legacy and marked currencies refuse before persistence or ack',
          refused && events.length === 0, JSON.stringify(events));
      }

      {
        const events = [];
        const cfg = {
          baseUrl: 'https://relay.test', syncToken: 's', privateKey: 'k', setupState: 'configured',
        };
        const executor = executorModule.createCaptureExecutor({
          ledger: ledger(Promise.resolve(), events),
          dependencies: {
            getRelay: async () => cfg,
            sync: async () => ({
              parsed: [row(22, 'CARREFOUR')], ids: ['bank-row', 'setup-probe'],
              testIds: ['setup-probe'], unreadable: 0, testReceived: 1,
              shortcutRows: 1, shortcutRowsWithBank: 1,
            }),
            planRows: () => changedPlan,
            acknowledge: async (_cfg, ids) => void events.push(`ack:${ids.join(',')}`),
            markVerified: async (active) => {
              events.push('verified');
              return { ...active, setupState: 'verified', verifiedAt: 77 };
            },
          },
        });
        const outcome = await executor.execute('setup-verification');
        eq('capture executor: setup owns its probe and verifies only after durable persistence',
          events, ['persist', 'verified', 'ack:bank-row,setup-probe']);
        ok('capture executor: setup returns only safe proof facts',
          outcome.kind === 'setup-observed' && outcome.isTest === true &&
            outcome.merchant === 'Wafra Capture' && outcome.verifiedAt === 77,
          JSON.stringify(outcome));
      }

      {
        const events = [];
        const cfg = {
          baseUrl: 'https://relay.test', syncToken: 's', privateKey: 'k', setupState: 'configured',
        };
        const executor = executorModule.createCaptureExecutor({
          ledger: ledger(Promise.resolve(), events),
          dependencies: {
            getRelay: async () => cfg,
            sync: async () => ({
              parsed: [{ ...row(22, 'STATEMENT ROW'), captureSource: 'pdf' }],
              ids: ['pdf-row'], testIds: [], unreadable: 0, testReceived: 0,
              shortcutRows: 0, shortcutRowsWithBank: 0,
            }),
            planRows: () => changedPlan,
            acknowledge: async (_cfg, ids) => void events.push(`ack:${ids.join(',')}`),
            markVerified: async (active) => {
              events.push('verified');
              return active;
            },
          },
        });
        const outcome = await executor.execute('setup-verification');
        eq('capture executor: setup safely drains PDF rows without treating them as Shortcut proof',
          events, ['persist', 'ack:pdf-row']);
        ok('capture executor: a PDF-only page keeps setup waiting', outcome.kind === 'setup-waiting');
      }

      {
        const cfg = {
          baseUrl: 'https://relay.test', syncToken: 's', privateKey: 'k', setupState: 'configured',
        };
        const executor = executorModule.createCaptureExecutor({
          ledger: ledger(Promise.resolve(), []),
          dependencies: {
            getRelay: async () => cfg,
            sync: async () => ({
              parsed: [
                { ...row(20, 'OLDER EMAIL'), captureSource: 'email' },
                { ...row(21, 'SHORTCUT MERCHANT'), captureSource: 'shortcut' },
              ],
              ids: ['email-row', 'shortcut-row'], testIds: [], unreadable: 0, testReceived: 0,
              shortcutRows: 1, shortcutRowsWithBank: 1,
            }),
            planRows: () => changedPlan,
            acknowledge: async () => {},
            markVerified: async (active) => ({ ...active, setupState: 'verified', verifiedAt: 88 }),
          },
        });
        const outcome = await executor.execute('setup-verification');
        ok('capture executor: setup proof names the Shortcut row rather than an older shared-queue row',
          outcome.kind === 'setup-observed' && outcome.merchant === 'SHORTCUT MERCHANT' &&
            outcome.isTest === false && outcome.verifiedAt === 88,
          JSON.stringify(outcome));
      }

      {
        const events = [];
        const executor = executorModule.createCaptureExecutor({
          ledger: ledger(Promise.reject(new Error('SQLCipher write failed')), events),
          dependencies: {
            getRelay: async () => ({
              baseUrl: 'https://relay.test', syncToken: 's', privateKey: 'k',
            }),
            sync: async () => ({
              parsed: [row(23, 'NOON')], ids: ['bank-row', 'setup-probe'],
              testIds: ['setup-probe'], unreadable: 0, testReceived: 1,
              shortcutRows: 1, shortcutRowsWithBank: 1,
            }),
            planRows: () => changedPlan,
            acknowledge: async () => void events.push('ack'),
            markVerified: async (active) => {
              events.push('verified');
              return active;
            },
          },
        });
        let threw = false;
        try {
          await executor.execute('setup-verification');
        } catch {
          threw = true;
        }
        ok('capture executor: failed setup persistence rejects verification', threw);
        eq('capture executor: failed setup persistence keeps bank rows and probes on the relay',
          events, ['persist']);
      }

      {
        const events = [];
        const executor = executorModule.createCaptureExecutor({
          ledger: ledger(Promise.resolve(), events),
          dependencies: {
            getRelay: async () => ({
              baseUrl: 'https://relay.test', syncToken: 's', privateKey: 'k',
            }),
            sync: async () => ({
              parsed: [], ids: ['setup-probe'], testIds: ['setup-probe'],
              unreadable: 0, testReceived: 1, shortcutRows: 0, shortcutRowsWithBank: 0,
            }),
            acknowledge: async () => void events.push('ack'),
            markVerified: async () => {
              events.push('verified');
              throw new Error('Keychain unavailable');
            },
          },
        });
        let threw = false;
        try {
          await executor.execute('setup-verification');
        } catch {
          threw = true;
        }
        ok('capture executor: a failed verification write keeps its proof available for retry',
          threw && events.join(',') === 'verified', events.join(','));
      }

      {
        let current = { hydrated: true, lastScanTs: 1 };
        let plannedAt = 0;
        const executor = executorModule.createCaptureExecutor({
          ledger: {
            getState: () => current,
            importBatch: () => ({ ids: [], durable: Promise.resolve() }),
            ensureDurable: async () => {},
            markParserVersion: () => {},
          },
          dependencies: {
            getRelay: async () => ({
              baseUrl: 'https://relay.test', syncToken: 's', privateKey: 'k',
            }),
            sync: async () => {
              current = { hydrated: true, lastScanTs: 900 };
              return {
                parsed: [], ids: [], testIds: [], unreadable: 0, testReceived: 0,
                shortcutRows: 0, shortcutRowsWithBank: 0,
              };
            },
            planRows: (_rows, stateAtPlan) => {
              plannedAt = stateAtPlan.lastScanTs;
              return emptyPlan;
            },
          },
        });
        await executor.execute('supplemental');
        eq('capture executor: supplemental planning re-reads the ledger after network collection',
          plannedAt, 900);
      }


      {
        const events = [];
        const executor = executorModule.createCaptureExecutor({
          ledger: ledger(Promise.reject(new Error('SQLCipher write failed')), events),
          dependencies: {
            getRelay: async () => ({
              baseUrl: 'https://relay.test', syncToken: 's', privateKey: 'k',
            }),
            sync: async () => ({
              parsed: [row(25, 'CAREEM')], ids: ['bank-row'], testIds: [],
              unreadable: 0, testReceived: 0, shortcutRows: 0, shortcutRowsWithBank: 0,
            }),
            planRows: () => changedPlan,
            acknowledge: async () => void events.push('ack'),
          },
        });
        let threw = false;
        try {
          await executor.execute('supplemental');
        } catch {
          threw = true;
        }
        ok('capture executor: a failed supplemental ledger write rejects the drain', threw);
        eq('capture executor: supplemental acknowledgement never crosses a failed durability barrier',
          events, ['persist']);
      }

      {
        const events = [];
        const cfg = {
          baseUrl: 'https://relay.test', syncToken: 's', privateKey: 'k', setupState: 'verified',
        };
        const queued = {
          parsed: [{ ...row(30, 'LULU'), captureSource: 'shortcut' }],
          ids: ['bank-row', 'setup-probe'],
          testIds: ['setup-probe'],
          unreadable: 0, testReceived: 1, shortcutRows: 1, shortcutRowsWithBank: 1,
        };
        const executor = executorModule.createCaptureExecutor({
          background: {
            stage: async (rows) => {
              events.push('stage');
              return rows;
            },
            announce: async () => void events.push('announce'),
            recordAutomationProof: async () => void events.push('proof'),
          },
          dependencies: {
            getBackgroundRelay: async () => cfg,
            sync: async () => queued,
            acknowledge: async (_cfg, ids) => void events.push(`ack:${ids.join(',')}`),
          },
        });
        await executor.execute('background');
        eq('capture executor: background staging and proof precede ack while probes remain reserved',
          events, ['stage', 'announce', 'proof', 'ack:bank-row']);
      }

      {
        const events = [];
        const executor = executorModule.createCaptureExecutor({
          background: {
            stage: async (rows) => {
              events.push('stage');
              return rows;
            },
            announce: async () => {
              events.push('announce');
              throw new Error('notifications unavailable');
            },
            recordAutomationProof: async () => void events.push('proof'),
          },
          dependencies: {
            getBackgroundRelay: async () => ({
              baseUrl: 'https://relay.test', syncToken: 's', privateKey: 'k', setupState: 'verified',
            }),
            sync: async () => ({
              parsed: [row(35, 'ADCB')], ids: ['bank-row'], testIds: [],
              unreadable: 0, testReceived: 0, shortcutRows: 0, shortcutRowsWithBank: 0,
            }),
            acknowledge: async () => void events.push('ack'),
          },
        });
        await executor.execute('background');
        eq('capture executor: a failed notification cannot strand an encrypted row',
          events, ['stage', 'announce', 'ack']);
      }

      {
        const events = [];
        const executor = executorModule.createCaptureExecutor({
          background: {
            stage: async () => {
              events.push('stage');
              throw new Error('encrypted inbox write failed');
            },
            announce: async () => void events.push('announce'),
            recordAutomationProof: async () => void events.push('proof'),
          },
          dependencies: {
            getBackgroundRelay: async () => ({
              baseUrl: 'https://relay.test', syncToken: 's', privateKey: 'k', setupState: 'verified',
            }),
            sync: async () => ({
              parsed: [row(40, 'NOON')], ids: ['bank-row'], testIds: [],
              unreadable: 0, testReceived: 0, shortcutRows: 0, shortcutRowsWithBank: 0,
            }),
            acknowledge: async () => void events.push('ack'),
          },
        });
        let threw = false;
        try {
          await executor.execute('background');
        } catch {
          threw = true;
        }
        ok('capture executor: a failed encrypted staging write rejects the background import', threw);
        eq('capture executor: background acknowledgement never crosses a failed staging barrier',
          events, ['stage']);
      }

      {
        let active = 0;
        let maximumActive = 0;
        let started = 0;
        let releaseFirst;
        const firstGate = new Promise((resolve) => { releaseFirst = resolve; });
        let releaseThird;
        const thirdGate = new Promise((resolve) => { releaseThird = resolve; });
        const storageCalls = [];
        const backgroundModule = execute('src/lib/background-relay.ts', (id) => {
          if (id === 'expo-constants') return { __esModule: true, default: {} };
          if (id === 'expo-notifications') return {};
          if (id === 'expo-task-manager') return { defineTask() {} };
          if (id === 'react-native') return { Platform: { OS: 'web' } };
          if (id === '@/lib/capture-executor') return {
            createCaptureExecutor: () => ({
              execute: async () => {
                started += 1;
                const sequence = started;
                active += 1;
                maximumActive = Math.max(maximumActive, active);
                if (sequence === 1) await firstGate;
                if (sequence === 3) await thirdGate;
                active -= 1;
                return { kind: 'background', received: sequence, fresh: sequence };
              },
            }),
          };
          if (id === '@/lib/charge-alert') return { buildChargeAlert: () => null };
          if (id === '@/lib/i18n') return {
            detectLanguage: () => 'en', getLanguage: () => 'en',
          };
          if (id === '@/lib/notifications') return {
            ensureNotificationHandler() {}, notificationsAllowed: () => false,
          };
          if (id === '@/lib/relay') return {
            getRelayConfig: async () => null,
            recordRelayAutomationProof: async () => {},
            registerRelayPush: async () => {},
            unregisterRelayPush: async () => {},
          };
          if (id === '@/lib/background-relay-storage') return {
            BACKGROUND_RELAY_ERASE_PENDING_KEY: 'erase-pending',
            backgroundRelayStorage: {
              getItem: async () => null,
              setItem: async (key) => void storageCalls.push(`set:${key}`),
              removeItem: async (key) => void storageCalls.push(`remove:${key}`),
            },
          };
          throw new Error(`unexpected background relay dependency ${id}`);
        });
        const first = backgroundModule.syncRelayInBackground();
        const second = backgroundModule.syncRelayInBackground();
        await Promise.resolve();
        ok('background capture: overlapping wakes do not start a second drain',
          started === 1 && maximumActive === 1);
        releaseFirst();
        eq('background capture: queued wakes execute serially after the first finishes',
          await Promise.all([first, second]), [1, 2]);

        const third = backgroundModule.syncRelayInBackground();
        await Promise.resolve();
        const clear = backgroundModule.clearBackgroundRelayRows();
        await Promise.resolve();
        eq('background erase: intent is durable while clear waits behind an existing wake',
          storageCalls, ['set:erase-pending']);
        releaseThird();
        await Promise.all([third, clear]);
        eq('background erase: durable intent brackets queue deletion', storageCalls, [
          'set:erase-pending',
          'remove:wafra/background-relay/v1',
          'remove:erase-pending',
        ]);
      }
    }
  }

  /* ── is the installed Shortcut sending the bank label? ────────────────────
   *
   * The first published Wafra Capture was authored on a Mac, where Apple does
   * not expose the iPhone-only `Message → Sender` property. It sends the
   * message body and nothing else. Six of the nine bank formats in the corpus
   * do not repeat their issuer inside that body, so a user on that snapshot
   * gets rows the planner cannot place — silently, forever, because an iCloud
   * link is a snapshot and a fixed Shortcut is a DIFFERENT link.
   *
   * The check has to be "can this row's bank be named", not "is sender
   * non-empty". docs/ios-shortcut-spec.md warns that the Sender detail needs an
   * explicit Text conversion, and without it a Contact object coerces itself
   * into a perfectly non-empty string that identifies no bank. A presence
   * check calls that healthy, which is worse than not checking.
   */
  {
    // The active pack is module-level state and an earlier section leaves it on
    // Saudi rules. `bankFromSender('ADCB')` is null under those, so without
    // this the whole block silently tests the wrong market and three healthy
    // cases read as broken. The suite's own closing comment says exactly this;
    // it just says it thirty lines further down.
    setActiveMarket('AE');
    const named = (row) => relay.relayRowNamesItsBank(row);

    ok('a row with no sender at all cannot name its bank',
      named({ sender: undefined, bankHint: undefined }) === false);
    ok('an empty sender is not a bank label',
      named({ sender: '', bankHint: undefined }) === false);

    // The failure this exists for: the Shortcut ran without the Text
    // conversion and sent a person, or a serialized object. Non-empty, and
    // worthless.
    ok('a contact name is not a bank label',
      named({ sender: 'Naser Khanjar', bankHint: undefined }) === false);
    // A serialized object that carries no bank name is the hazard. One that
    // happens to contain "ADCB" — because the contact really is named that —
    // does identify ADCB, and calling it healthy is correct rather than lucky.
    ok('an opaque contact object is not a bank label',
      named({ sender: '<WFContact: 0x600002a1c3c0>', bankHint: undefined }) === false);
    ok('but a contact whose name IS the bank still identifies it',
      named({ sender: 'ADCB Alerts', bankHint: undefined }) === true);

    ok('a real bank sender is healthy',
      named({ sender: 'ADCB', bankHint: undefined }) === true);
    ok('so is the other spelling banks use',
      named({ sender: 'EmiratesNBD', bankHint: undefined }) === true);

    // The body fallback: PR #10 taught the parser to read an issuer named
    // immediately before a card noun. A sender-blind Shortcut still works for
    // those messages, which is exactly why the count must be of rows that can
    // name their bank BY EITHER ROUTE and not of rows that carried a sender.
    ok('a body that names its own issuer is healthy without any sender',
      named({ sender: undefined, bankHint: 'Emirates NBD' }) === true);
    ok('an unrecognised bankHint is not a free pass',
      named({ sender: undefined, bankHint: 'Not A Bank Plc' }) === false);

    /* ── and whether saying anything would help ── */

    const BLIND = 'https://www.icloud.com/shortcuts/85bd1e080e5849b591049eccffb9a3a1';
    const FIXED = 'https://www.icloud.com/shortcuts/0000000000000000000000000000abcd';

    // The gate. While the only published Shortcut is the sender-blind one,
    // "reinstall it" fetches the same snapshot — a loop that blames the user
    // for the app's problem.
    ok('no warning while the only published Shortcut is the blind one',
      relay.shortcutCaptureHealth(10, 0, BLIND).warn === false);
    ok('the warning turns itself on once a different link is published',
      relay.shortcutCaptureHealth(10, 0, FIXED).warn === true);
    ok('and stays off when no Shortcut link is configured at all',
      relay.shortcutCaptureHealth(10, 0, null).warn === false);

    // One odd message is not a broken Shortcut.
    ok('two unnamed rows are not yet a pattern',
      relay.shortcutCaptureHealth(2, 0, FIXED).warn === false);

    // One healthy row proves the Shortcut sends the label. That is what clears
    // the warning after an update, with no dismissal to persist anywhere.
    ok('a single healthy row clears the warning',
      relay.shortcutCaptureHealth(10, 1, FIXED).warn === false);
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
