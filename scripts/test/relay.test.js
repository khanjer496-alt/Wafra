// The device half of the relay. worker.test.js proves the seal round-trips
// against a reimplementation of the app side written in WebCrypto; this file
// proves it against the code the app ACTUALLY ships — @noble under Hermes,
// where crypto.subtle does not exist.
//
// That distinction is the whole point of the file. If the Worker's HKDF and
// noble's HKDF disagreed by one byte of salt, every endpoint would still answer
// correctly, every sync would return items, and not one transaction would ever
// appear on an iPhone. There is no error path that surfaces it, so it is
// asserted here instead.
const { webcrypto } = require('crypto');
globalThis.crypto = webcrypto;

const { seal, b64encode: workerB64encode, b64decode: workerB64decode } = require('./build/crypto');
const {
  b64decode,
  b64encode,
  isRelayPayload,
  keypairFromSeed,
  makeRowClock,
  open,
  openPage,
  parseRelayInstant,
  payloadTimestampMs,
  publicKeyFor,
  RELAY_KEY_BYTES,
  RELAY_QUEUE_TTL_MS,
  rowFirstSeenMs,
} = require('./build/relay-crypto');

let pass = 0, fail = 0;
function ok(name, cond, detail = '') {
  if (cond) { pass++; console.log(`✓ ${name}`); }
  else { fail++; console.log(`✗ ${name} ${detail}`); }
}

/** Flip one bit in a base64 field, the way a corrupted row would arrive. */
function tamper(b64) {
  const bytes = b64decode(b64);
  bytes[0] ^= 0xff;
  return b64encode(bytes);
}

function threw(fn) {
  try { fn(); return false; } catch { return true; }
}

(async () => {
  // ── Base64 must agree with the Worker's, which is btoa/atob ──
  //
  // Hermes has neither, so the app's is written out by hand. Two encoders that
  // disagree on padding or on the last group would corrupt keys, not text.
  const alphabetSample = Uint8Array.from({ length: 256 }, (_, i) => i);
  for (const len of [0, 1, 2, 3, 4, 5, 31, 32, 33, 256]) {
    const bytes = alphabetSample.slice(0, len);
    const mine = b64encode(bytes);
    if (mine !== workerB64encode(bytes)) {
      ok(`base64: encodes ${len} bytes the same as the Worker`, false, mine);
      break;
    }
    const back = b64decode(mine);
    if (back.length !== len || !bytes.every((b, i) => back[i] === b)) {
      ok(`base64: round-trips ${len} bytes`, false, mine);
      break;
    }
    if (len === 256) ok('base64: encodes and decodes exactly as the Worker does', true);
  }
  ok('base64: decodes what the Worker encoded',
    b64decode(workerB64encode(Uint8Array.from([0, 127, 128, 255]))).join() === '0,127,128,255');
  ok('base64: the Worker decodes what we encode',
    workerB64decode(b64encode(Uint8Array.from([0, 127, 128, 255]))).join() === '0,127,128,255');
  // A value that has been through a URL comes back url-safe.
  ok('base64: accepts url-safe input', b64decode('_-8').join() === b64decode('/+8').join());
  ok('base64: rejects characters that are not base64', threw(() => b64decode('not base64!')));

  // ── Keys ──
  const seed = new Uint8Array(RELAY_KEY_BYTES).fill(7);
  const fixed = keypairFromSeed(seed);
  ok('keys: a seed yields a 32-byte private and public key',
    b64decode(fixed.privateKey).length === 32 && b64decode(fixed.publicKey).length === 32);
  ok('keys: the same seed yields the same pair',
    keypairFromSeed(seed).publicKey === fixed.publicKey);
  ok('keys: a different seed yields a different pair',
    keypairFromSeed(new Uint8Array(RELAY_KEY_BYTES).fill(8)).publicKey !== fixed.publicKey);
  ok('keys: the public half can be recovered from the private one',
    publicKeyFor(fixed.privateKey) === fixed.publicKey);
  // A short seed silently clamped to a valid-looking key is worse than a throw:
  // it pairs, syncs, and never opens a row.
  ok('keys: a wrong-length seed is refused',
    threw(() => keypairFromSeed(new Uint8Array(16))));

  const device = keypairFromSeed(webcrypto.getRandomValues(new Uint8Array(RELAY_KEY_BYTES)));

  // ── The test this file exists for ──
  const payload = {
    kind: 'transaction',
    type: 'expense',
    amountFils: 72267,
    merchant: 'Kokoro Qlub',
    date: '2026-07-18',
    dueDay: null,
    minDueFils: null,
    card: { last4: '4733', kind: 'credit' },
    transferHint: false,
    snapshotFils: 747659,
    snapshotKind: 'balance',
    categoryGuess: 'dining',
    receivedAt: '2026-07-18T09:14:02.000Z',
  };
  const blob = await seal(device.publicKey, payload);
  let opened = null;
  try { opened = open(device.privateKey, blob); } catch (e) { opened = { error: String(e) }; }
  ok('seal: @noble opens what the Worker sealed with WebCrypto',
    JSON.stringify(opened) === JSON.stringify(payload), JSON.stringify(opened));

  // Every field of the row, unchanged — a payload that opens but loses its
  // nulls or rounds its fils is the same silent failure one step later.
  ok('seal: the payload survives the round trip unchanged',
    opened && opened.amountFils === 72267 && opened.minDueFils === null &&
    opened.card.last4 === '4733' && opened.transferHint === false &&
    opened.receivedAt === payload.receivedAt);

  // Merchant names come back from UAE banks in Arabic often enough that a
  // fromCharCode shortcut in the decoder would corrupt real transactions.
  const arabic = { ...payload, merchant: 'مطعم الإمارات — Ø' };
  const arabicOpened = open(device.privateKey, await seal(device.publicKey, arabic));
  ok('seal: non-ASCII merchant names survive', arabicOpened.merchant === arabic.merchant);

  // ── Rejection ──
  const other = keypairFromSeed(new Uint8Array(RELAY_KEY_BYTES).fill(3));
  ok('seal: another device cannot open it', threw(() => open(other.privateKey, blob)));
  ok('seal: a tampered ciphertext is rejected',
    threw(() => open(device.privateKey, { ...blob, ct: tamper(blob.ct) })));
  ok('seal: a tampered nonce is rejected',
    threw(() => open(device.privateKey, { ...blob, iv: tamper(blob.iv) })));
  ok('seal: a tampered ephemeral key is rejected',
    threw(() => open(device.privateKey, { ...blob, epk: tamper(blob.epk) })));
  ok('seal: a truncated ciphertext is rejected',
    threw(() => open(device.privateKey, { ...blob, ct: blob.ct.slice(0, 12) })));

  // ── One bad row must not cost the batch ──
  //
  // This is the loop in relay-client.syncRelay. A single unopenable item is
  // dropped and acked; the rest of the sync proceeds.
  const batch = [
    { id: 'a', ...(await seal(device.publicKey, { ...payload, merchant: 'One' })) },
    { id: 'b', ...(() => { const s = { ...blob }; s.ct = tamper(s.ct); return s; })() },
    { id: 'c', ...(await seal(device.publicKey, { ...payload, merchant: 'Three' })) },
  ];
  const rows = [];
  let corrupt = 0;
  for (const item of batch) {
    try { rows.push(open(device.privateKey, item)); } catch { corrupt++; }
  }
  ok('batch: a corrupt item does not poison the rest',
    rows.length === 2 && corrupt === 1 && rows[0].merchant === 'One' && rows[1].merchant === 'Three');

  // ── The whole wire path, parser included ──
  //
  // Same module the Worker imports: parse, drop the text, seal, open on the
  // device. What comes out is what buildImportPlan is handed.
  const { parseSms } = require('./build/sms-parser');
  const parsed = parseSms(
    'Purchase of AED 40.00 with Debit Card ending 4733 at % ARABICA, DUBAI. Avl Balance is AED 7,476.59.');
  const { raw, ...row } = parsed;
  const wire = open(device.privateKey,
    await seal(device.publicKey, { ...row, receivedAt: '2026-07-18T09:14:02.000Z' }));
  ok('wire: a parsed row arrives with what the importer needs',
    wire.merchant === '% Arabica' && wire.amountFils === 4000 &&
    wire.categoryGuess === 'dining' && wire.card.last4 === '4733');
  ok('wire: no raw message text survives the relay',
    wire.raw === undefined && !JSON.stringify(wire).includes('Avl Balance'));

  // ── Acking is destructive: only two of the three outcomes may be acked ──
  //
  // The relay holds the ONLY copy of a parsed transaction, and an ack deletes
  // it. A row that fails to decrypt can never be read by anything, so acking it
  // costs nothing. A row that decrypts into a shape this build does not know is
  // a Worker that was deployed ahead of this app binary — acking that one
  // destroys a real transaction that a later app version could have read.
  const newKind = { ...payload, kind: 'cashback', merchant: 'Newer Worker' };
  const queue = [
    { id: 'good', ...(await seal(device.publicKey, { ...payload, merchant: 'Kept' })) },
    { id: 'sealed', ...(() => { const s = { ...blob }; s.ct = tamper(s.ct); return s; })() },
    { id: 'future', ...(await seal(device.publicKey, newKind)) },
  ];
  const page = openPage(device.privateKey, queue, 200);
  ok('page: an undecryptable row is counted, acked and dropped',
    page.sealedCount === 1 && page.ackIds.includes('sealed'));
  ok('page: a row this build does not understand is NOT acked',
    page.unsupportedCount === 1 && !page.ackIds.includes('future'),
    JSON.stringify(page.ackIds));
  ok('page: understood rows are handed over and acked',
    page.rows.length === 1 && page.rows[0].id === 'good' &&
    page.rows[0].payload.merchant === 'Kept' && page.ackIds.includes('good'));
  // The point of not acking: the bytes are intact, so the app version that
  // learns the new kind still finds it on the relay and can read it.
  const stillThere = open(device.privateKey, queue[2]);
  ok('page: the row left on the relay is intact and readable by a newer build',
    stillThere.kind === 'cashback' && stillThere.amountFils === payload.amountFils);
  // No id means no way to ack it; it must not be counted as collected either.
  const idless = openPage(device.privateKey,
    [{ ...(await seal(device.publicKey, payload)) }, { id: 42, ...blob }], 200);
  ok('page: a row with no usable id is skipped entirely',
    idless.rows.length === 0 && idless.ackIds.length === 0);
  ok('page: the page limit is the Worker page size, not the array length',
    openPage(device.privateKey, [
      { id: 'a', ...blob }, { id: 'b', ...blob }, { id: 'c', ...blob },
    ], 2).ackIds.length === 2);
  // A Worker that starts sending `sender` must not make every row unopenable on
  // a device that predates the field, and vice versa.
  ok('page: sender is optional in both directions',
    isRelayPayload({ ...payload, sender: 'ENBD' }) && isRelayPayload(payload));

  // ── The fingerprint must not move between redeliveries ──
  //
  // A lost ack is explicitly treated as harmless: the row comes back and the
  // importer drops it on `smsKey`, which is `s<smsTs>-<amountFils>`. That only
  // holds if smsTs is derived from something invariant. Date.parse of an
  // unvalidated receivedAt is not: it yields NaN for anything it does not
  // recognise, and the old fallback was Date.now(), which is different every
  // time — the same purchase, imported twice.
  const smsKey = (ms) => `s${ms}-${payload.amountFils}`;
  // Two days after every fixture below, so no timezone the suite might run in
  // can push a local-time fixture into the "clock skew" window and change what
  // is being asserted.
  const nowMs = Date.UTC(2026, 6, 30, 10, 0, 0);
  ok('ts: a sealed ISO receivedAt is used as-is',
    payloadTimestampMs(payload, nowMs) === Date.parse('2026-07-18T09:14:02.000Z'));
  // What Shortcuts' "Current Date" actually renders in en-GB and en-US. These
  // are unambiguous, so the real instant is recovered rather than guessed at.
  ok('ts: the Shortcuts en-GB long form parses to the instant it names',
    parseRelayInstant('28 Jul 2026 at 09:14', nowMs) === new Date(2026, 6, 28, 9, 14).getTime());
  ok('ts: the Shortcuts en-US long form parses, pm included',
    parseRelayInstant('Jul 28, 2026 at 9:14 PM', nowMs) === new Date(2026, 6, 28, 21, 14).getTime());
  // Ambiguous by construction: 03/07/26 is two different months depending on
  // who wrote it, and guessing wrong dates the transaction to the wrong one.
  ok('ts: an ambiguous numeric date is refused rather than guessed',
    parseRelayInstant('03/07/26 05:53', nowMs) === null);
  ok('ts: garbage is refused', parseRelayInstant('sometime last tuesday', nowMs) === null &&
    parseRelayInstant('', nowMs) === null && parseRelayInstant(undefined, nowMs) === null);
  // Out of range rather than clamped: clamping to "now" is the moving target.
  ok('ts: a timestamp beyond clock skew is refused',
    parseRelayInstant('2031-01-01T00:00:00Z', nowMs) === null &&
    parseRelayInstant('1999-05-05T00:00:00Z', nowMs) === null);
  ok('ts: the sealed parse does not depend on the host engine\'s Date.parse',
    parseRelayInstant('2026-07-18T09:14:02+04:00', nowMs) ===
      Date.parse('2026-07-18T09:14:02+04:00'));

  // Fallback 1: the message's own date. Sealed, so still invariant.
  const dated = { ...payload, receivedAt: '28 Jul 2026 at 09:14 GST', date: '2026-07-18' };
  ok('ts: an unparseable receivedAt falls back to the sealed message date',
    payloadTimestampMs(dated, nowMs) === new Date(2026, 6, 18, 12).getTime());
  // A statement reminder's date is in the FUTURE. Taking it would push
  // lastScanTs past today and blind the Android inbox scan from then on.
  ok('ts: a future due date is not accepted as a receive time',
    payloadTimestampMs({ ...payload, receivedAt: 'nope', date: '2026-12-01' }, nowMs) === null);

  // Fallback 2: first sighting, keyed by the queue id — the one thing that is
  // genuinely invariant for a queue row. This is the redelivery test.
  const undated = { ...payload, receivedAt: '28 Jul 2026 at 09:14 GST', date: null };
  ok('ts: an undated row has no timestamp of its own',
    payloadTimestampMs(undated, nowMs) === null);
  let clock = makeRowClock(null, nowMs);
  const first = rowFirstSeenMs(clock, 'queue-row-1', nowMs);
  ok('clock: a first sighting is recorded and flagged for persisting',
    first === nowMs && clock.dirty === true);
  // The ack was lost; the same queue row comes back on the next sync, in a new
  // process, at a different wall-clock time.
  const persisted = JSON.parse(JSON.stringify(clock.seen));
  clock = makeRowClock(persisted, nowMs + 90_000);
  const second = rowFirstSeenMs(clock, 'queue-row-1', nowMs + 90_000);
  ok('clock: redelivery of the same queue row keeps the same fingerprint',
    second === first && smsKey(second) === smsKey(first) && clock.dirty === false,
    `${first} vs ${second}`);
  ok('clock: a different queue row gets a different sighting',
    rowFirstSeenMs(clock, 'queue-row-2', nowMs + 90_000) === nowMs + 90_000);
  // Past the relay's own TTL the row has been swept and can never come back,
  // so the entry is dead weight in a keychain value with a size limit.
  ok('clock: entries older than the relay TTL are dropped',
    Object.keys(makeRowClock(persisted, nowMs + RELAY_QUEUE_TTL_MS + 1000).seen).length === 0);
  // A clock that jumped backwards would otherwise pin entries there forever.
  ok('clock: entries from the future are dropped',
    Object.keys(makeRowClock({ ffff0000: nowMs + 60_000 }, nowMs).seen).length === 0);
  ok('clock: a corrupt record reads as empty rather than throwing',
    Object.keys(makeRowClock('not an object', nowMs).seen).length === 0 &&
    Object.keys(makeRowClock({ a: 'later' }, nowMs).seen).length === 0);
  // Bounded: iOS refuses large keychain values, and a refused write is a write
  // that never becomes durable.
  const capped = makeRowClock(null, nowMs);
  for (let i = 0; i < 200; i++) rowFirstSeenMs(capped, `row-${i}`, nowMs + i);
  const capKeys = Object.keys(capped.seen);
  ok('clock: the record stays bounded and evicts the oldest first',
    capKeys.length <= 48 && JSON.stringify(capped.seen).length < 1500 &&
    capKeys.every((k) => capped.seen[k] > nowMs + 100),
    String(capKeys.length));

  console.log(`\n${pass} passed, ${fail} failed`);
  process.exit(fail ? 1 : 0);
})();
