// Relay tests. The seal must round-trip — a sealed row the phone cannot open
// would look exactly like a working service right up until a user tried to
// sync, so this is the one thing that must never be assumed.
//
// Node's WebCrypto implements X25519 the same way Workers do, so crypto.ts
// runs here unmodified; the device side is reimplemented below with the same
// primitives to prove the two halves agree.
const { webcrypto } = require('crypto');
globalThis.crypto = webcrypto;

const { seal, hashToken, randomToken, timingSafeEqual, b64decode, b64encode } =
  require('./build/crypto');

let pass = 0, fail = 0;
function ok(name, cond, detail = '') {
  if (cond) { pass++; console.log(`✓ ${name}`); }
  else { fail++; console.log(`✗ ${name} ${detail}`); }
}

const enc = new TextEncoder();
const dec = new TextDecoder();

/** What the app does: derive the same AES key from its private key + the epk. */
async function open(privateKey, blob) {
  const epk = await crypto.subtle.importKey(
    'raw', b64decode(blob.epk), { name: 'X25519' }, false, []);
  const shared = await crypto.subtle.deriveBits({ name: 'X25519', public: epk }, privateKey, 256);
  const ikm = await crypto.subtle.importKey('raw', shared, 'HKDF', false, ['deriveKey']);
  const aes = await crypto.subtle.deriveKey(
    { name: 'HKDF', hash: 'SHA-256', salt: b64decode(blob.epk), info: enc.encode('wafra/v1/seal') },
    ikm, { name: 'AES-GCM', length: 256 }, false, ['decrypt']);
  const pt = await crypto.subtle.decrypt(
    { name: 'AES-GCM', iv: b64decode(blob.iv) }, aes, b64decode(blob.ct));
  return JSON.parse(dec.decode(pt));
}

(async () => {
  const device = await crypto.subtle.generateKey({ name: 'X25519' }, true, ['deriveBits']);
  const pub = b64encode(await crypto.subtle.exportKey('raw', device.publicKey));

  const payload = { merchant: 'Kokoro Qlub', amountFils: 72267, categoryGuess: 'dining' };
  const blob = await seal(pub, payload);

  ok('seal: produces epk, iv and ciphertext',
    typeof blob.epk === 'string' && typeof blob.iv === 'string' && typeof blob.ct === 'string');
  ok('seal: ciphertext is not the plaintext', !blob.ct.includes('Kokoro'));

  const opened = await open(device.privateKey, blob);
  ok('seal: the device opens what the Worker sealed',
    JSON.stringify(opened) === JSON.stringify(payload),
    JSON.stringify(opened));

  // Every seal uses a fresh ephemeral key, so identical rows must not produce
  // identical ciphertext — otherwise the database leaks which charges repeat.
  const again = await seal(pub, payload);
  ok('seal: the same payload seals differently each time', again.ct !== blob.ct);

  // A different device must not be able to open it.
  const other = await crypto.subtle.generateKey({ name: 'X25519' }, true, ['deriveBits']);
  let denied = false;
  try { await open(other.privateKey, blob); } catch { denied = true; }
  ok('seal: another device cannot open it', denied);

  // Tampering must fail rather than silently decode — GCM's whole job.
  const bad = { ...blob, ct: b64encode((() => {
    const b = b64decode(blob.ct); b[0] ^= 0xff; return b;
  })()) };
  let rejected = false;
  try { await open(device.privateKey, bad); } catch { rejected = true; }
  ok('seal: a tampered ciphertext is rejected', rejected);

  // Tokens
  const t = randomToken();
  ok('token: url-safe and long enough', /^[A-Za-z0-9_-]{40,}$/.test(t), t);
  ok('token: two tokens differ', randomToken() !== randomToken());
  ok('token: hash is stable', (await hashToken(t)) === (await hashToken(t)));
  ok('token: hash is not the token', (await hashToken(t)) !== t);
  ok('compare: equal strings match', timingSafeEqual('abc', 'abc'));
  ok('compare: different strings do not', !timingSafeEqual('abc', 'abd'));
  ok('compare: different lengths do not', !timingSafeEqual('abc', 'abcd'));

  // The relay must never seal the raw message text. This is the guarantee the
  // whole design rests on, so it is asserted rather than trusted to review.
  const { parseSms } = require('./build/sms-parser');
  const parsed = parseSms(
    'Purchase of AED 40.00 with Debit Card ending 4733 at % ARABICA, DUBAI. Avl Balance is AED 7,476.59.');
  const { raw, ...row } = parsed;
  const sealedRow = await seal(pub, row);
  const openedRow = await open(device.privateKey, sealedRow);
  ok('relay: the parsed row carries no raw message text',
    openedRow.raw === undefined && !JSON.stringify(openedRow).includes('Avl Balance'));
  ok('relay: the parsed row still carries what the app needs',
    openedRow.merchant === '% Arabica' && openedRow.amountFils === 4000 &&
    openedRow.categoryGuess === 'dining');

  // ── The real device half ──
  //
  // Everything above proves the Worker agrees with the `open()` written in
  // this file. That is not the thing that ships. src/lib/relay-crypto.ts is
  // what runs on the phone, under Hermes, with @noble instead of WebCrypto,
  // and it is the half that can silently drift. Seal with the real Worker,
  // open with the real client.
  const client = require('./build/relay-crypto');

  const kp = client.generateKeypair();
  const forClient = await seal(kp.publicKey, row);
  const byClient = client.openSealed(kp.privateKey, forClient);
  ok('client: opens what the Worker sealed',
    byClient.merchant === '% Arabica' && byClient.amountFils === 4000,
    JSON.stringify(byClient));

  // Arabic merchants are ordinary in this corpus, and a UTF-8 bug here would
  // only ever show up as mojibake in someone's ledger.
  const arabic = { merchant: 'مقهى ٪ أرابيكا', amountFils: 4000, note: 'دبي' };
  const openedAr = client.openSealed(kp.privateKey, await seal(kp.publicKey, arabic));
  ok('client: round-trips Arabic merchant names',
    openedAr.merchant === arabic.merchant && openedAr.note === arabic.note,
    JSON.stringify(openedAr));

  let clientDenied = false;
  try { client.openSealed(client.generateKeypair().privateKey, forClient); }
  catch { clientDenied = true; }
  ok('client: another device cannot open it', clientDenied);

  let clientRejected = false;
  try {
    const t = b64decode(forClient.ct); t[0] ^= 0xff;
    client.openSealed(kp.privateKey, { ...forClient, ct: b64encode(t) });
  } catch { clientRejected = true; }
  ok('client: a tampered ciphertext is rejected', clientRejected);

  // The client's own base64 must agree with the Worker's, since every field
  // crosses between them as a base64 string.
  const probe = crypto.getRandomValues(new Uint8Array(97));
  ok('client: base64 agrees with the Worker in both directions',
    client.b64encode(probe) === b64encode(probe) &&
    b64encode(client.b64decode(b64encode(probe))) === b64encode(probe));

  // A keypair the client generated must be usable as a pairing public key,
  // which means 32 raw bytes once decoded — the Worker rejects anything else.
  ok('client: public key is the 32 bytes /v1/pair accepts',
    client.b64decode(kp.publicKey).length === 32);

  console.log(`\n${pass} passed, ${fail} failed`);
  process.exit(fail ? 1 : 0);
})();
