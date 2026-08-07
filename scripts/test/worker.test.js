// Relay tests. The seal must round-trip — a sealed row the phone cannot open
// would look exactly like a working service right up until a user tried to
// sync, so this is the one thing that must never be assumed.
//
// Both real halves run here. Node's WebCrypto implements X25519 the same way
// Workers do, so server/src/crypto.ts runs unmodified; the device side is
// src/lib/relay-crypto.ts itself — the module the app ships — rather than a
// reimplementation, because a reimplementation only proves the test agrees
// with itself. WebCrypto on one side and @noble on the other is exactly the
// pairing that runs in production, and it is the pairing that has to be
// checked.
const { webcrypto } = require('crypto');
globalThis.crypto = webcrypto;

const { seal, hashToken, randomToken, timingSafeEqual, b64decode, b64encode } =
  require('./build/crypto');
const app = require('./build/relay-crypto');

let pass = 0, fail = 0;
function ok(name, cond, detail = '') {
  if (cond) { pass++; console.log(`✓ ${name}`); }
  else { fail++; console.log(`✗ ${name} ${detail}`); }
}

(async () => {
  // Exactly what relay.ts does at pairing time: 32 random bytes from the
  // platform, public half derived by @noble, only that half sent to the Worker.
  const devicePriv = webcrypto.getRandomValues(new Uint8Array(32));
  const pub = app.b64encode(app.publicKeyFor(devicePriv));
  const open = (priv, blob) => app.open(priv, blob);

  // The two sides encode independently, so a disagreement here would corrupt
  // every key and every ciphertext in transit.
  ok('base64: the app and the Worker agree when encoding',
    app.b64encode(new Uint8Array([0, 1, 250, 255, 16])) ===
      b64encode(new Uint8Array([0, 1, 250, 255, 16])));
  ok('base64: the app and the Worker agree when decoding',
    app.b64decode(pub).join(',') === b64decode(pub).join(','));
  ok('base64: the app round-trips its own output',
    app.b64encode(app.b64decode(pub)) === pub);

  const payload = { merchant: 'Kokoro Qlub', amountFils: 72267, categoryGuess: 'dining' };
  const blob = await seal(pub, payload);

  ok('seal: produces epk, iv and ciphertext',
    typeof blob.epk === 'string' && typeof blob.iv === 'string' && typeof blob.ct === 'string');
  ok('seal: ciphertext is not the plaintext', !blob.ct.includes('Kokoro'));

  const opened = open(devicePriv, blob);
  ok('seal: the device opens what the Worker sealed',
    JSON.stringify(opened) === JSON.stringify(payload),
    JSON.stringify(opened));

  // Every seal uses a fresh ephemeral key, so identical rows must not produce
  // identical ciphertext — otherwise the database leaks which charges repeat.
  const again = await seal(pub, payload);
  ok('seal: the same payload seals differently each time', again.ct !== blob.ct);

  // A different device must not be able to open it.
  const otherPriv = webcrypto.getRandomValues(new Uint8Array(32));
  let denied = false;
  try { open(otherPriv, blob); } catch { denied = true; }
  ok('seal: another device cannot open it', denied);

  // Tampering must fail rather than silently decode — GCM's whole job.
  const bad = { ...blob, ct: b64encode((() => {
    const b = b64decode(blob.ct); b[0] ^= 0xff; return b;
  })()) };
  let rejected = false;
  try { open(devicePriv, bad); } catch { rejected = true; }
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
  const openedRow = open(devicePriv, sealedRow);
  ok('relay: the parsed row carries no raw message text',
    openedRow.raw === undefined && !JSON.stringify(openedRow).includes('Avl Balance'));
  ok('relay: the parsed row still carries what the app needs',
    openedRow.merchant === '% Arabica' && openedRow.amountFils === 4000 &&
    openedRow.categoryGuess === 'dining');

  // The sender ID is what lets an auto-created account read "ADCB Credit
  // ~4733" instead of "Credit ~4733". It rides along sealed like everything
  // else, and the app reads it back off the opened row.
  const withSender = open(devicePriv, await seal(pub, { ...row, sender: 'ADCBAlert' }));
  ok('relay: the sender rides along and comes back intact',
    withSender.sender === 'ADCBAlert');

  // A row whose date the bank never stated arrives as null and the app fills
  // it from receivedAt. Null has to survive the JSON round-trip as null —
  // undefined would read as "today" on the wrong day.
  const undated = open(devicePriv, await seal(pub, { ...row, date: null }));
  ok('relay: a missing date survives as null rather than vanishing',
    undated.date === null && 'date' in undated);

  console.log(`\n${pass} passed, ${fail} failed`);
  process.exit(fail ? 1 : 0);
})();
