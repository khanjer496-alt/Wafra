// Relay tests. The seal must round-trip — a sealed row the phone cannot open
// would look exactly like a working service right up until a user tried to
// sync, so this is the one thing that must never be assumed.
//
// Node's WebCrypto implements X25519 the same way Workers do, so crypto.ts
// runs here unmodified; the device side is reimplemented below with the same
// primitives to prove the two halves agree.
const { webcrypto } = require('crypto');
globalThis.crypto = webcrypto;

const fs = require('fs');
const path = require('path');
const ts = require('typescript');

const { seal, hashToken, keyedFingerprint, randomToken, timingSafeEqual, b64decode, b64encode } =
  require('./build/crypto');

const repoRoot = path.join(__dirname, '..', '..');

/**
 * Load a server module that run.sh does not transpile into build/.
 *
 * The ingest validators are Worker source with no Worker dependencies, and the
 * point of testing them is to test the code that ships rather than a copy of
 * its rules written into a test file.
 */
function loadServerModule(relativePath) {
  const filename = path.join(repoRoot, relativePath);
  const output = ts.transpileModule(fs.readFileSync(filename, 'utf8'), {
    compilerOptions: {
      module: ts.ModuleKind.CommonJS,
      target: ts.ScriptTarget.ES2022,
    },
    fileName: filename,
  }).outputText;
  const loaded = { exports: {} };
  Function('require', 'module', 'exports', '__filename', '__dirname', output)(
    require, loaded, loaded.exports, filename, path.dirname(filename),
  );
  return loaded.exports;
}

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
  ok('replay: same token and event are stable',
    (await keyedFingerprint(t, 'event:one')) === (await keyedFingerprint(t, 'event:one')));
  ok('replay: another token cannot correlate the same event',
    (await keyedFingerprint(t, 'event:one')) !== (await keyedFingerprint(randomToken(), 'event:one')));
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

  // ── What has to survive the raw discard ──
  //
  // Two facts about a message used to be recoverable only by re-reading its
  // text: which leg of a card settlement it is, and which bank sent it.
  // Android re-reads both, because Android still has the message. The relay
  // does not — it parses, drops the text, and seals what is left — so on iOS
  // either fact is simply gone unless it crosses as a structured field. The
  // cost is not cosmetic: two legs of one payment settle a statement twice,
  // and a card ending 3749 at one bank is indistinguishable from a card
  // ending 3749 at another.
  const { relaySender, MAX_RELAY_SENDER_LENGTH } =
    loadServerModule('server/src/ingest-row.ts');

  const settlement = parseSms(
    'Payment of AED 4,061.69 received towards your Credit Card ending 8575. Thank you.');
  ok('relay: the parser decides the settlement leg before the text is dropped',
    settlement.kind === 'cardPayment' && settlement.cardPaymentSide === 'receipt',
    JSON.stringify(settlement && { k: settlement.kind, s: settlement.cardPaymentSide }));

  // Exactly what the ingest handler seals: raw destructured away, the
  // validated sender attached, the relay's own receipt time.
  const { raw: _settlementText, ...settlementRow } = settlement;
  const sender = relaySender('  ADCB   Alerts ');
  const shortcutRow = {
    ...settlementRow,
    captureSource: 'shortcut',
    ...(sender ? { sender } : {}),
    receivedAt: new Date().toISOString(),
  };
  const openedShortcut = await open(device.privateKey, await seal(pub, shortcutRow));
  ok('relay: a Shortcut row carries the settlement leg and the bank, not the message',
    openedShortcut.cardPaymentSide === 'receipt' &&
      openedShortcut.sender === 'ADCB Alerts' &&
      openedShortcut.raw === undefined &&
      !JSON.stringify(openedShortcut).includes('Thank you'),
    JSON.stringify(openedShortcut));

  // The debit leg is the other half of the same payment, and it must not read
  // as the same side once the wording is gone.
  const debitLeg = parseSms(
    'AED 4,061.69 has been deducted from your account 095XXX11XXX01 towards payment of your Credit Card ending 8575.');
  const { raw: _debitText, ...debitRow } = debitLeg;
  const openedDebit = await open(device.privateKey, await seal(pub, debitRow));
  ok('relay: the opposite leg of one payment stays distinguishable without its text',
    openedDebit.cardPaymentSide === 'debit' && openedShortcut.cardPaymentSide === 'receipt',
    JSON.stringify([openedDebit.cardPaymentSide, openedShortcut.cardPaymentSide]));

  // ── What may be called a sender ──
  //
  // The refusals are spelled by codepoint rather than pasted in: every one of
  // them is invisible on the page, and a test whose input cannot be read is a
  // test nobody can check.
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

  // ── The ingest handler's side of the bargain ──
  const workerSource = fs.readFileSync(path.join(repoRoot, 'server/src/index.ts'), 'utf8');
  const ingest = workerSource.slice(
    workerSource.indexOf("url.pathname === '/v1/ingest'"),
    workerSource.indexOf("url.pathname === '/v1/import/capabilities'"));
  ok('ingest: the sender is validated before anything is done with it',
    /const sender = relaySender\(body\?\.sender\);/.test(ingest) &&
      /if \(sender === undefined\) return json\(\{ error: 'bad_sender' \}, 400\);/.test(ingest));
  ok('ingest: a refused sender is not echoed back to the caller',
    !/json\(\{[^}]*\bsender\b[^}]*\}, 4\d\d\)/.test(ingest));
  ok('ingest: the sender reaches the sealed row and is never bound as plaintext or logged',
    /\.\.\.\(!isTest && sender \? \{ sender \} : \{\}\),/.test(ingest) &&
      !/\.bind\([^)]*\bsender\b/.test(ingest) && !/console\./.test(ingest));
  ok('ingest: the setup probe stays a probe, with no bank label attached',
    /!isTest && sender/.test(ingest));
  // The text itself is still parsed and dropped; sender did not open a second
  // door for it. Nothing in the handler binds `text` to a statement either.
  ok('ingest: the message text is still discarded before anything is sealed',
    /const \{ raw: _discard, \.\.\.structured \} = parsed!/.test(ingest) &&
      !/\.bind\([^)]*\btext\b/.test(ingest));

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

  // The relay row the phone actually has to read, opened by the code that
  // ships rather than by this file's stand-in.
  const shortcutByClient = client.openSealed(
    kp.privateKey, await seal(kp.publicKey, shortcutRow));
  ok('client: the shipping client reads back the bank and the settlement leg',
    shortcutByClient.sender === 'ADCB Alerts' &&
      shortcutByClient.cardPaymentSide === 'receipt' &&
      shortcutByClient.raw === undefined,
    JSON.stringify(shortcutByClient));

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
