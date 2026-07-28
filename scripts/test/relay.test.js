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
  keypairFromSeed,
  open,
  publicKeyFor,
  RELAY_KEY_BYTES,
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

  console.log(`\n${pass} passed, ${fail} failed`);
  process.exit(fail ? 1 : 0);
})();
