const assert = require('node:assert/strict');
const { Buffer } = require('node:buffer');
const { spawn } = require('node:child_process');
const { createHash, randomBytes } = require('node:crypto');
const { once } = require('node:events');
const { copyFile, mkdtemp, rm, writeFile } = require('node:fs/promises');
const http = require('node:http');
const os = require('node:os');
const path = require('node:path');
const { createInterface } = require('node:readline');
const test = require('node:test');

test('real workerd listener accepts an Android zero-byte POST and rejects nonempty bodies', { timeout: 15_000 }, async (t) => {
  const dir = await mkdtemp(path.join(os.tmpdir(), 'wafra-review-http-'));
  const code = randomBytes(32).toString('base64url');
  const digest = createHash('sha256').update(code).digest('hex');
  let child;
  t.after(async () => {
    if (child && child.exitCode === null && child.signalCode === null) {
      const ended = once(child, 'exit');
      child.kill();
      await ended;
    }
    await rm(dir, { recursive: true, force: true });
  });
  await copyFile(require.resolve('../src/index.js'), path.join(dir, 'access.js'));
  // Only the environment bindings are test doubles. The worker receives the actual
  // incoming Request, as parsed by workerd, without a JS Request reconstruction.
  await writeFile(path.join(dir, 'probe.js'), `import access from './access.js';
    export default { fetch(request) { return access.fetch(request, {
      COMPLIMENTARY_ACCESS_SHA256: '${digest}', ACCESS_RATE_LIMITER: { limit: async () => ({ success: true }) }
    }); } };`);
  await writeFile(path.join(dir, 'config.capnp'), `using Workerd = import "/workerd/workerd.capnp";
    const config :Workerd.Config = (
      services = [(name = "probe", worker = (modules = [(name = "probe.js", esModule = embed "probe.js"),
        (name = "access.js", esModule = embed "access.js")], compatibilityDate = "2025-09-01"))],
      sockets = [(name = "test", address = "127.0.0.1:0", http = (forwardedProtoHeader = "X-Test-Protocol"), service = "probe")]
    );`);
  child = spawn(require.resolve('workerd/bin/workerd'), ['serve', 'config.capnp', '--control-fd', '3'],
    { cwd: dir, stdio: ['ignore', 'ignore', 'pipe', 'pipe'] });
  let startupError = '';
  child.stderr.on('data', chunk => { startupError = (startupError + chunk).slice(-1000); });
  const lines = createInterface({ input: child.stdio[3] });
  const result = await Promise.race([
    once(lines, 'line').then(([line]) => JSON.parse(line)),
    once(child, 'exit').then(() => { throw new Error('workerd startup failed: ' + startupError); }),
  ]);
  assert.equal(result.event, 'listen');
  assert.equal(result.socket, 'test');
  const post = (body, transferHeaders) => new Promise((resolve, reject) => {
    const req = http.request({
      hostname: '127.0.0.1', port: result.port, path: '/v1/access/complimentary', method: 'POST',
      headers: { 'X-Test-Protocol': 'https', authorization: 'Bearer ' + code, ...transferHeaders },
    }, (res) => {
      const chunks = [];
      res.on('data', chunk => chunks.push(chunk));
      res.on('end', () => resolve({ status: res.statusCode, data: JSON.parse(Buffer.concat(chunks).toString()) }));
      res.on('error', reject);
    });
    req.on('error', reject);
    req.end(body);
  });
  assert.deepEqual(await post(null, { 'content-length': '0' }),
    { status: 200, data: { entitlement: 'pro', leaseSeconds: 900 } });
  assert.equal((await post('x', { 'content-length': '1' })).status, 403);
  assert.equal((await post('x', { 'transfer-encoding': 'chunked' })).status, 403);
});
