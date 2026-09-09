'use strict';
const assert = require('node:assert/strict');
const { test } = require('node:test');
const { createHash } = require('node:crypto');
const path = require('node:path');
const load = require('./load-typescript.cjs');
const root = path.resolve(__dirname, '../../..');

// Execute the shipping normalization and hashing policy; stub only boundaries
// not exercised by this identity-only suite. Existing scanner integration tests
// separately exercise the full import path with the same production exports.
const sourceIdentity = load(path.join(root, 'src/lib/capture-source-identity.ts'));
const dedupe = load(path.join(root, 'src/lib/dedupe.ts'), { '@/lib/capture-source-identity': sourceIdentity });
const sha256 = (data) => createHash('sha256').update(data, 'utf8').digest('hex');
const key = 'a5'.repeat(32);
const source = 'Purchase AED 42.50 on card 1234 at Test Store';
const sender = 'SYNTHETIC-BANK';
const at = 1788696000000;
const identityDomain = 'wafra.alert-review-identity.v1';
const templateDomain = 'wafra.alert-review-template.v1';
// Template implementation is stubbed identically in the old/reference and new
// paths; separate existing unparsed-launch-alert tests own its grammar.
const normalize = (text) => text.replace(/\d+/g, '#').toLowerCase();

function harness(fail = () => false) {
  const calls = [];
  const api = load(path.join(root, 'src/lib/auto-import.ts'), {
    '@/lib/capture-trace': load(path.join(root, 'src/lib/capture-trace.ts')),
    'react-native': { Platform: { OS: 'android' } },
    'expo-crypto': { CryptoDigestAlgorithm: { SHA256: 'sha256' }, digestStringAsync: async (_, data) => {
      calls.push(data); if (fail(data)) throw new Error('native digest failed'); return sha256(data);
    } },
    'expo-secure-store': {},
    '../../modules/notification-reader': { __esModule: true, default: null },
    '../../modules/sms-reader': { __esModule: true, default: null },
    '@/lib/alert-review-tray': {}, '@/lib/format': {}, '@/lib/dedupe': dedupe,
    '@/lib/sms-parser': {}, '@/lib/launch-alert-parser': {},
    '@/lib/unparsed-launch-alert': { normalizeUnparsedLaunchTemplate: normalize },
    '@/lib/trusted-bank-notification-packages': {}, '@/lib/import-plan': {},
  });
  return { ...api, calls };
}
function reference(body, address, ts, channel, databaseKey) {
  const material = [channel, String(ts), dedupe.bodyPrint(address.normalize('NFKC')),
    dedupe.bodyPrint(body.normalize('NFKC'))].join('\0');
  const digest = sha256(`${sha256(`${identityDomain}\0${databaseKey}`)}\0${material}`);
  const templateDigest = sha256([sha256(`${templateDomain}\0${databaseKey}`),
    dedupe.bodyPrint(address.normalize('NFKC')), normalize(body)].join('\0'));
  return { sourceKey: `arc1_${digest}`, id: `ari1_${digest}`, templateKey: `art1_${templateDigest}` };
}
const plain = (value) => JSON.parse(JSON.stringify(value));

test('1000 review identities are unchanged with 2002 digest calls instead of 4000', async () => {
  const h = harness(); const identify = h.createReviewIdentitySession(key);
  for (let i = 0; i < 1000; i += 1) {
    const body = `${source} reference ${i}`;
    assert.deepEqual(plain(await identify(body, sender, at + i, 'inbox')),
      reference(body, sender, at + i, 'inbox', key));
  }
  assert.equal(h.calls.length, 2002);
  assert.equal(h.calls.filter((input) => input === `${identityDomain}\0${key}`).length, 1);
  assert.equal(h.calls.filter((input) => input === `${templateDomain}\0${key}`).length, 1);
});
test('legacy single-message callers retain identical IDs and four digests', async () => {
  const h = harness();
  assert.deepEqual(plain(await h.reviewCaptureIdentity(source, sender, at, 'inbox', key)),
    reference(source, sender, at, 'inbox', key));
  assert.equal(h.calls.length, 4);
});
test('separate scans never reuse a previous scan key derivation', async () => {
  const h = harness();
  for (let i = 0; i < 2; i += 1) await h.createReviewIdentitySession(key)(source, sender, at, 'inbox');
  assert.equal(h.calls.length, 8);
});
test('different database keys remain cryptographically separate', async () => {
  const h = harness();
  const a = await h.createReviewIdentitySession(key)(source, sender, at, 'inbox');
  const b = await h.createReviewIdentitySession('b6'.repeat(32))(source, sender, at, 'inbox');
  assert.notEqual(a.id, b.id); assert.notEqual(a.templateKey, b.templateKey);
  assert.equal(h.calls.length, 8);
});
test('concurrent calls share only two in-flight derivations', async () => {
  const h = harness(); const identify = h.createReviewIdentitySession(key);
  const results = await Promise.all(Array.from({ length: 20 }, (_, i) => identify(source, sender, at + i, 'inbox')));
  assert.equal(new Set(results.map((r) => r.id)).size, 20);
  assert.equal(h.calls.length, 42);
});
test('failed key derivation is evicted and an explicit retry succeeds', async () => {
  let first = true;
  const h = harness((input) => { if (first && input.startsWith(identityDomain)) { first = false; return true; } return false; });
  const identify = h.createReviewIdentitySession(key);
  await assert.rejects(identify(source, sender, at, 'inbox'), /native digest failed/);
  assert.deepEqual(plain(await identify(source, sender, at, 'inbox')), reference(source, sender, at, 'inbox', key));
});
test('invalid keys perform no hashing and return no identity', async () => {
  const h = harness();
  for (const invalid of ['', 'a5', 'z'.repeat(64)]) {
    assert.equal(await h.createReviewIdentitySession(invalid)(source, sender, at, 'inbox'), null);
  }
  assert.equal(h.calls.length, 0);
});
test('Unicode, channel, sender and timestamp identity semantics stay unchanged', async () => {
  const h = harness(); const identify = h.createReviewIdentitySession(key);
  for (const channel of ['inbox', 'delivery', 'push']) {
    for (const body of [source, 'شراء AED ١٢.٥٠ بطاقة ١٢٣٤', 'ＡＥＤ ４２.５０', source + '\n']) {
      assert.deepEqual(plain(await identify(body, ' بنك Ａ ', at, channel)),
        reference(body, ' بنك Ａ ', at, channel, key));
    }
  }
});
