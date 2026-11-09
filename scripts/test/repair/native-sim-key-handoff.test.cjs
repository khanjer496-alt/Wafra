const test = require('node:test');
const assert = require('node:assert/strict');
const crypto = require('node:crypto');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { spawnSync } = require('node:child_process');
const YAML = require('yaml');
const { createHandoff, openHandoff, writePrivateToken, readPrivateToken } = require('../../../.github/native-sim/session-key.cjs');

// In-memory example keys only. No live GitHub run, token or network operation.
const pair = crypto.generateKeyPairSync('rsa', { modulusLength: 3072,
  publicKeyEncoding: { type: 'spki', format: 'pem' }, privateKeyEncoding: { type: 'pkcs8', format: 'pem' } });
const encoded = Buffer.from(pair.publicKey).toString('base64');
const context = { session: 'example-session', runId: '123456', runAttempt: '1', sourceSha: 'a'.repeat(40) };
const root = path.resolve(__dirname, '../../..');

test('only the intended recipient can recover a context-bound random access key', () => {
  const result = createHandoff(encoded, context);
  assert.match(result.token, /^[A-Za-z0-9_-]{43}$/);
  assert.ok(!JSON.stringify(result.envelope).includes(result.token), 'artifact must contain ciphertext only');
  assert.ok(openHandoff(result.envelope, pair.privateKey, context) === result.token, 'decrypted example token matches');
  assert.throws(() => openHandoff(result.envelope, pair.publicKey, context), /private key/);
  assert.ok(createHandoff(encoded, context).token !== result.token, 'each handoff has fresh randomness');
});

test('private PEMs, weak/other key types and malformed encodings are rejected', () => {
  const weak = crypto.generateKeyPairSync('rsa', { modulusLength: 2048,
    publicKeyEncoding: { type: 'spki', format: 'pem' } });
  const other = crypto.generateKeyPairSync('ed25519', { publicKeyEncoding: { type: 'spki', format: 'pem' } });
  for (const input of [Buffer.from(pair.privateKey).toString('base64'),
    Buffer.from(weak.publicKey).toString('base64'), Buffer.from(other.publicKey).toString('base64'),
    'not base64', 'A'.repeat(9000)]) {
    assert.throws(() => createHandoff(input, context));
  }
});

test('another session, run, attempt or source SHA cannot consume the artifact', () => {
  const result = createHandoff(encoded, context);
  for (const patch of [{ session: 'other' }, { runId: '999' }, { runAttempt: '2' }, { sourceSha: 'b'.repeat(40) }]) {
    assert.throws(() => openHandoff(result.envelope, pair.privateKey, { ...context, ...patch }), /context/);
  }
  for (const patch of [{ session: '../bad' }, { runId: 123 }, { runAttempt: '0' }, { sourceSha: 'bad' }]) {
    assert.throws(() => createHandoff(encoded, { ...context, ...patch }), /context/);
  }
});

test('algorithm, recipient and ciphertext tampering fail closed', () => {
  const result = createHandoff(encoded, context);
  assert.throws(() => openHandoff({ ...result.envelope, algorithm: 'RSA-PKCS1' }, pair.privateKey, context));
  assert.throws(() => openHandoff({ ...result.envelope, recipientFingerprint: 'bad' }, pair.privateKey, context));
  assert.throws(() => openHandoff({ ...result.envelope, ciphertext: 'AAAA' }, pair.privateKey, context));
  const bytes = Buffer.from(result.envelope.ciphertext, 'base64'); bytes[bytes.length - 1] ^= 1;
  assert.throws(() => openHandoff({ ...result.envelope, ciphertext: bytes.toString('base64') }, pair.privateKey, context), /decryption/);
});

test('local handoff uses a private new file and refuses replacement or public directories', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'wafra-handoff-example-'));
  try {
    fs.chmodSync(dir, 0o700);
    const file = path.join(dir, 'access.key'); const { token } = createHandoff(encoded, context);
    writePrivateToken(file, token);
    assert.equal(fs.statSync(file).mode & 0o777, 0o600);
    assert.ok(readPrivateToken(file) === token, 'example token retained without display');
    assert.throws(() => writePrivateToken(file, token), /EEXIST/);
    fs.chmodSync(dir, 0o755);
    assert.throws(() => writePrivateToken(path.join(dir, 'public.key'), token), /owner-only/);
    assert.equal(fs.existsSync(path.join(dir, 'public.key')), false);
  } finally { fs.rmSync(dir, { recursive: true, force: true }); }
});

test('runner and decrypt CLIs expose no plaintext except the registered mask and private key file', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'wafra-cli-handoff-example-'));
  try {
    fs.chmodSync(dir, 0o700);
    const envFile = path.join(dir, 'env'); fs.writeFileSync(envFile, '', { mode: 0o600 });
    const encrypted = path.join(dir, 'handoff.json');
    const result = spawnSync(process.execPath, [path.join(root, '.github/native-sim/session-key.cjs'), encrypted], {
      encoding: 'utf8', env: { ...process.env, GITHUB_ENV: envFile, RUNNER_TEMP: dir, RECIPIENT_PUBLIC_KEY: encoded,
        NATIVE_SIM_SESSION: context.session, GITHUB_RUN_ID: context.runId,
        GITHUB_RUN_ATTEMPT: context.runAttempt, GITHUB_SHA: context.sourceSha },
    });
    assert.ok(result.status === 0, 'runner fixture completes');
    const keyPath = fs.readFileSync(envFile, 'utf8').trim().split('=')[1];
    const token = readPrivateToken(keyPath);
    assert.ok(!fs.readFileSync(envFile, 'utf8').includes(token), 'broad job env contains only the path');
    assert.ok(result.stdout.startsWith(`::add-mask::${token}\n`), 'mask is registered first');
    assert.ok(!fs.readFileSync(encrypted, 'utf8').includes(token), 'no plaintext in artifact');
    const privateFile = path.join(dir, 'private.pem'); fs.writeFileSync(privateFile, pair.privateKey, { mode: 0o600 });
    const output = path.join(dir, 'session.key');
    const args = [path.join(root, '.github/native-sim/decrypt-session-key.cjs'), privateFile, encrypted,
      output, context.session, context.runId, context.runAttempt, context.sourceSha];
    const decrypted = spawnSync(process.execPath, args, { encoding: 'utf8' });
    assert.ok(decrypted.status === 0, 'local decryption completes');
    assert.ok(!decrypted.stdout.includes(token) && !decrypted.stderr.includes(token), 'local CLI never displays the token');
    assert.ok(fs.readFileSync(output, 'utf8') === token, 'decrypted example matches');
    assert.equal(fs.statSync(output).mode & 0o777, 0o600);
    const blocked = path.join(dir, 'debug.json');
    const debug = spawnSync(process.execPath, [path.join(root, '.github/native-sim/session-key.cjs'), blocked], {
      encoding: 'utf8', env: { ...process.env, RUNNER_DEBUG: '1', GITHUB_ENV: envFile, RUNNER_TEMP: dir,
        RECIPIENT_PUBLIC_KEY: encoded, NATIVE_SIM_SESSION: context.session, GITHUB_RUN_ID: context.runId,
        GITHUB_RUN_ATTEMPT: context.runAttempt, GITHUB_SHA: context.sourceSha },
    });
    assert.notEqual(debug.status, 0);
    assert.equal(fs.existsSync(blocked), false, 'debug mode fails before key creation');
    assert.ok(!debug.stdout.includes('::add-mask::'), 'no secret generated under debug');
    fs.chmodSync(privateFile, 0o644);
    const refused = spawnSync(process.execPath, [...args.slice(0, 3), path.join(dir, 'refused.key'), ...args.slice(4)], { encoding: 'utf8' });
    assert.notEqual(refused.status, 0);
    assert.equal(fs.existsSync(path.join(dir, 'refused.key')), false);
  } finally { fs.rmSync(dir, { recursive: true, force: true }); }
});

test('workflow publishes only a recipient public key and an encrypted key artifact', () => {
  const source = fs.readFileSync(path.join(root, '.github/workflows/native-sim.yml'), 'utf8');
  const workflow = YAML.parse(source);
  assert.equal(Object.hasOwn(workflow.on.workflow_dispatch.inputs, 'gate_token'), false);
  assert.equal(workflow.on.workflow_dispatch.inputs.recipient_public_key.required, true);
  assert.doesNotMatch(source, /inputs\.gate_token|\?k=\$|url=\$URL/);
  assert.doesNotMatch(source, /--daemon-auth-token "\$NATIVE_SIM_GATE_TOKEN"/);
  const steps = workflow.jobs.stream.steps;
  const generate = steps.findIndex(s => s.name === 'Generate private session access key');
  const handoff = steps.findIndex(s => s.name === 'Preserve encrypted session-key handoff');
  const gate = steps.findIndex(s => s.name === 'Start auth gate');
  assert.ok(generate >= 0 && handoff > generate && gate > handoff);
  assert.equal(steps[handoff].with['retention-days'], 1);
  assert.equal(steps[handoff].with['if-no-files-found'], 'error');
  assert.equal(steps[handoff].with.path, '${{ runner.temp }}/native-sim-session-key.enc.json');
  assert.ok(steps.find(s => s.name === 'Open tunnel and publish URL').run.includes('echo "url=$TUNNEL"'));
});
