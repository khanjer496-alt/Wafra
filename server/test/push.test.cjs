const { webcrypto } = require('node:crypto');
globalThis.crypto = webcrypto;

const {
  PUSH_REGISTRATION_TTL_SECONDS,
  decryptPushToken,
  encryptPushToken,
  isExpoProjectId,
  isExpoPushToken,
  sendWakePush,
  wakePayload,
} = require('../.test-build/push.js');

let passed = 0;
let failed = 0;
function ok(name, condition, detail = '') {
  if (condition) {
    passed += 1;
    console.log(`✓ ${name}`);
  } else {
    failed += 1;
    console.log(`✗ ${name}${detail ? ` · ${detail}` : ''}`);
  }
}

(async () => {
  const key = Buffer.from(crypto.getRandomValues(new Uint8Array(32))).toString('base64');
  const token = 'ExponentPushToken[abcdefghijklmnopqrstuvwxyz]';
  const encrypted = await encryptPushToken(key, token);
  ok('push token is encrypted at rest', !encrypted.ct.includes('ExponentPushToken'));
  ok('encrypted push token decrypts with the Worker secret',
    (await decryptPushToken(key, encrypted)) === token);

  let wrongKeyRejected = false;
  try {
    const wrong = Buffer.from(crypto.getRandomValues(new Uint8Array(32))).toString('base64');
    await decryptPushToken(wrong, encrypted);
  } catch {
    wrongKeyRejected = true;
  }
  ok('wrong at-rest key cannot decrypt a push token', wrongKeyRejected);

  ok('Expo token validator accepts SDK token shapes',
    isExpoPushToken(token) && isExpoPushToken('ExpoPushToken[abc_DEF-0123456789]'));
  ok('Expo token validator rejects arbitrary destinations',
    !isExpoPushToken('https://attacker.test/') && !isExpoPushToken('ExponentPushToken[x]'));
  ok('project id validator accepts UUIDs only',
    isExpoProjectId('01234567-89ab-cdef-0123-456789abcdef') && !isExpoProjectId('wafra'));

  const payload = wakePayload(token);
  const serialized = JSON.stringify(payload);
  ok('wake is headless and collapsed',
    payload._contentAvailable === true && payload.collapseId === 'wafra-relay-sync');
  ok('wake has a short expiry', payload.ttl === 300 && payload.priority === 'normal');
  ok('push registration survives more than one unopened month',
    PUSH_REGISTRATION_TTL_SECONDS >= 90 * 24 * 60 * 60);
  ok('wake carries only the sync protocol marker',
    JSON.stringify(payload.data) === JSON.stringify({ kind: 'wafra.sync', v: 1 }));
  ok('wake leaks no financial or queue fields',
    !/(merchant|amount|transaction|queue|ciphertext|deviceId)/i.test(serialized), serialized);
  ok('wake has no visible notification content',
    !('title' in payload) && !('body' in payload) && !('sound' in payload) && !('badge' in payload));

  let sent;
  const result = await sendWakePush(token, 'expo-access-secret', async (url, init) => {
    sent = { url, init };
    return new Response(JSON.stringify({ data: { status: 'ok', id: 'ticket-1' } }), {
      status: 200,
      headers: { 'content-type': 'application/json' },
    });
  });
  ok('push uses Expo HTTPS endpoint', sent.url === 'https://exp.host/--/api/v2/push/send');
  ok('enhanced push access token is sent',
    sent.init.headers.authorization === 'Bearer expo-access-secret');
  ok('successful Expo ticket is accepted', result.accepted && !result.unregistered);

  const dead = await sendWakePush(token, undefined, async () =>
    new Response(JSON.stringify({
      data: { status: 'error', details: { error: 'DeviceNotRegistered' } },
    }), { status: 200, headers: { 'content-type': 'application/json' } }));
  ok('unregistered Expo destination is recognized for deletion', dead.unregistered);

  console.log(`\n${passed} passed, ${failed} failed`);
  process.exit(failed ? 1 : 0);
})();
