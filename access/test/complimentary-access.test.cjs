const assert = require('node:assert/strict');
const { createHash, randomBytes } = require('node:crypto');
const { test, before } = require('node:test');
let worker; before(async () => { worker = (await import('../src/index.js')).default; });

const path = '/v1/access/complimentary';
const url = 'https://wafra-access.example' + path;
const token = () => randomBytes(32).toString('base64url');
const digest = value => createHash('sha256').update(value, 'utf8').digest('hex');
const limiter = { limit: async () => ({ success: true }) };
const env = code => ({ COMPLIMENTARY_ACCESS_SHA256: digest(code), ACCESS_RATE_LIMITER: limiter });
const request = (code, changes = {}) => new Request(changes.url ?? url, {
  method: changes.method ?? 'POST',
  headers: changes.headers ?? { authorization: 'Bearer ' + code },
  body: changes.body,
});
const expectDenial = async (req, bindings) => {
  const response = await worker.fetch(req, bindings);
  assert.equal(response.status, 403);
  assert.equal(response.headers.get('cache-control'), 'no-store');
  assert.deepEqual(await response.json(), { error: 'access_denied' });
};

test('only the active grant issues a no-store 15-minute Pro lease without any device or D1 binding', async () => {
  const code = token();
  const response = await worker.fetch(request(code), {
    ...env(code), ACCESS_RATE_LIMITER: { limit: async ({ key }) => {
      assert.equal(key, path + ':authorized');
      return { success: true };
    } },
  });
  assert.equal(response.status, 200);
  assert.equal(response.headers.get('cache-control'), 'no-store');
  assert.deepEqual(await response.json(), { entitlement: 'pro', leaseSeconds: 900 });
  await expectDenial(request(code), env(token())); // Rotation stops new leases with the former credential.
});

test('disabled, malformed or unavailable configuration fails closed, including an unavailable/throttled limiter', async () => {
  const code = token();
  for (const config of [
    {}, { ACCESS_RATE_LIMITER: limiter }, { COMPLIMENTARY_ACCESS_SHA256: digest(code) },
    { ...env(code), COMPLIMENTARY_ACCESS_SHA256: code },
    { ...env(code), COMPLIMENTARY_ACCESS_SHA256: digest(code).toUpperCase() },
    { ...env(code), COMPLIMENTARY_ACCESS_SHA256: digest(code) + '\n' },
    { ...env(code), ACCESS_RATE_LIMITER: { limit: async () => ({ success: false }) } },
    { ...env(code), ACCESS_RATE_LIMITER: { limit: async () => ({}) } },
    { ...env(code), ACCESS_RATE_LIMITER: { limit: async () => { throw Error('unavailable'); } } },
  ]) await expectDenial(request(code), config);
});

test('accepts the bearer only in the authorization header of an exact POST, never in body or query', async () => {
  const code = token();
  const bindings = env(code);
  for (const input of [
    request(code, { method: 'GET' }), request(code, { headers: {} }),
    request(code, { headers: { authorization: code } }),
    request(code, { headers: { authorization: 'Bearer ' + code + '=' } }),
    request(code, { url: url + '?code=' + code, headers: {} }),
    request(code, { url: url + '?extra=1' }),
    request(code, { body: code, headers: {} }), request(code, { body: '{}' }),
  ]) await expectDenial(input, bindings);
  const unrelated = await worker.fetch(request(code, { url: url + '/extra' }), bindings);
  assert.equal(unrelated.status, 404);
});

test('a saturated invalid-attempt bucket cannot consume the valid credential quota', async () => {
  const code = token(), keys = [];
  const config = { ...env(code), ACCESS_RATE_LIMITER: { limit: async ({ key }) => {
    keys.push(key); return { success: key.endsWith(':authorized') };
  } } };
  await expectDenial(request(token()),config);
  assert.equal((await worker.fetch(request(code),config)).status,200);
  assert.deepEqual(keys,[path + ':anonymous',path + ':authorized']);
});

test('body inspection does not trust an empty length header, buffer long streams, or wait indefinitely', async () => {
  const code = token();
  const send = (body, extra) => worker.fetch(new Request(url, {
    method: 'POST', headers: { authorization: 'Bearer ' + code, ...extra }, body, duplex: 'half',
  }), env(code));
  let cancelled = false;
  const live = new ReadableStream({
    start(controller) { controller.enqueue(new Uint8Array([7])); },
    cancel() { cancelled = true; },
  });
  assert.equal((await send(live, {'content-length':'0'})).status, 403);
  assert.equal(cancelled, true);
  let timedOut = false;
  const stalled = new ReadableStream({ cancel() { timedOut = true; } });
  assert.equal((await send(stalled)).status, 403);
  assert.equal(timedOut, true);
});
