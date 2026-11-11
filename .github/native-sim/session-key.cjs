'use strict';

const { Buffer } = require('node:buffer');
const crypto = require('node:crypto');
const fs = require('node:fs');
const path = require('node:path');

const ALGORITHM = 'RSA-OAEP-SHA256';
const SESSION = /^[A-Za-z0-9][A-Za-z0-9_-]{0,47}$/;
const DIGITS = /^[1-9][0-9]{0,19}$/;
const SHA = /^[a-f0-9]{40}$/;
const TOKEN = /^[A-Za-z0-9_-]{43}$/;

function contextOf(value) {
  if (!value || ['session', 'runId', 'runAttempt', 'sourceSha'].some(key => typeof value[key] !== 'string') || !SESSION.test(value.session) || !DIGITS.test(value.runId) ||
      !DIGITS.test(value.runAttempt) || !SHA.test(value.sourceSha)) {
    throw new Error('Invalid session handoff context');
  }
  return { session: value.session, runId: value.runId, runAttempt: value.runAttempt, sourceSha: value.sourceSha };
}

function decode64(value, maxLength) {
  if (typeof value !== 'string' || value.length > maxLength || value.length % 4 ||
      !/^[A-Za-z0-9+/]+={0,2}$/.test(value)) throw new Error('Invalid handoff encoding');
  const result = Buffer.from(value, 'base64');
  if (result.toString('base64') !== value) throw new Error('Invalid handoff encoding');
  return result;
}

function checkRsa(key) {
  const bits = key.asymmetricKeyDetails?.modulusLength;
  if (key.asymmetricKeyType !== 'rsa' || !bits || bits < 3072 || bits > 4096) {
    throw new Error('Recipient must use an RSA public key of 3072 to 4096 bits');
  }
  return key;
}

function fingerprint(key) {
  return crypto.createHash('sha256').update(key.export({ type: 'spki', format: 'der' })).digest('hex');
}

function recipient(encoded) {
  const pem = decode64(encoded, 8192).toString('utf8');
  // createPublicKey also accepts private PEMs: reject those explicitly.
  if (!/^-----BEGIN PUBLIC KEY-----\r?\n[A-Za-z0-9+/=\r\n]+-----END PUBLIC KEY-----\s*$/.test(pem)) {
    throw new Error('Input must contain only a base64-encoded SPKI public PEM');
  }
  try { return checkRsa(crypto.createPublicKey(pem)); }
  catch { throw new Error('Recipient public key is invalid or too weak'); }
}

function createHandoff(encodedPublicKey, context) {
  const publicKey = recipient(encodedPublicKey);
  const bound = contextOf(context);
  const token = crypto.randomBytes(32).toString('base64url');
  const plaintext = Buffer.from(JSON.stringify({ v: 1, ...bound, token }));
  const ciphertext = crypto.publicEncrypt({ key: publicKey, oaepHash: 'sha256',
    padding: crypto.constants.RSA_PKCS1_OAEP_PADDING }, plaintext);
  return { token, envelope: { v: 1, algorithm: ALGORITHM,
    recipientFingerprint: fingerprint(publicKey), ciphertext: ciphertext.toString('base64') } };
}

function openHandoff(envelope, privatePem, expectedContext) {
  const expected = contextOf(expectedContext);
  if (!envelope || envelope.v !== 1 || envelope.algorithm !== ALGORITHM) throw new Error('Unsupported handoff');
  let privateKey;
  try { privateKey = checkRsa(crypto.createPrivateKey(privatePem)); }
  catch { throw new Error('Invalid recipient private key'); }
  if (envelope.recipientFingerprint !== fingerprint(crypto.createPublicKey(privateKey))) {
    throw new Error('Handoff recipient mismatch');
  }
  const ciphertext = decode64(envelope.ciphertext, 1024);
  if (ciphertext.length !== privateKey.asymmetricKeyDetails.modulusLength / 8) throw new Error('Invalid ciphertext size');
  let payload;
  try {
    payload = JSON.parse(crypto.privateDecrypt({ key: privateKey, oaepHash: 'sha256',
      padding: crypto.constants.RSA_PKCS1_OAEP_PADDING }, ciphertext).toString('utf8'));
  } catch { throw new Error('Handoff decryption failed'); }
  if (!payload || payload.v !== 1 || typeof payload.token !== 'string' || !TOKEN.test(payload.token) ||
      Object.keys(payload).sort().join(',') !== 'runAttempt,runId,session,sourceSha,token,v' ||
      Object.entries(expected).some(([key, value]) => payload[key] !== value)) {
    throw new Error('Handoff context mismatch');
  }
  return payload.token;
}

function writePrivateToken(output, token) {
  if (typeof token !== 'string' || !TOKEN.test(token)) throw new Error('Invalid session token');
  const parent = path.dirname(path.resolve(output));
  const stat = fs.lstatSync(parent);
  if (!stat.isDirectory() || stat.isSymbolicLink() || (stat.mode & 0o077) ||
      stat.uid !== process.getuid()) throw new Error('Output directory must be owner-only and owned by this user');
  const fd = fs.openSync(output, fs.constants.O_WRONLY | fs.constants.O_CREAT |
    fs.constants.O_EXCL | fs.constants.O_NOFOLLOW, 0o600);
  try { fs.writeFileSync(fd, token); } finally { fs.closeSync(fd); }
}

function readPrivateToken(file) {
  const fd = fs.openSync(file, fs.constants.O_RDONLY | fs.constants.O_NOFOLLOW);
  try {
    const stat = fs.fstatSync(fd);
    if (!stat.isFile() || (stat.mode & 0o077) || stat.uid !== process.getuid() || stat.size !== 43) {
      throw new Error('Session key must be an owner-only regular file');
    }
    const token = fs.readFileSync(fd, 'utf8');
    if (!TOKEN.test(token)) throw new Error('Invalid session key file');
    return token;
  } finally { fs.closeSync(fd); }
}

module.exports = { createHandoff, openHandoff, writePrivateToken, readPrivateToken };

if (require.main === module) {
  try {
    process.umask(0o077);
    if (!process.env.GITHUB_ENV || !process.env.RUNNER_TEMP) throw new Error('This command runs only inside GitHub Actions');
    if (['RUNNER_DEBUG', 'ACTIONS_STEP_DEBUG', 'ACTIONS_RUNNER_DEBUG'].some(name => /^(1|true)$/i.test(process.env[name] || ''))) {
      throw new Error('Refusing to create a session key while runner debug logging is enabled');
    }
    const { token, envelope } = createHandoff(process.env.RECIPIENT_PUBLIC_KEY, {
      session: process.env.NATIVE_SIM_SESSION, runId: process.env.GITHUB_RUN_ID,
      runAttempt: process.env.GITHUB_RUN_ATTEMPT, sourceSha: process.env.GITHUB_SHA,
    });
    // Register before use. Only ciphertext goes to the artifact. The broad job
    // environment contains a file path, never the value (including build/cache steps).
    process.stdout.write(`::add-mask::${token}\n`);
    fs.writeFileSync(process.argv[2], JSON.stringify(envelope, null, 2) + '\n', { mode: 0o600, flag: 'wx' });
    const directory = path.join(process.env.RUNNER_TEMP, 'native-sim-private');
    fs.mkdirSync(directory, { mode: 0o700 });
    const tokenFile = path.join(directory, 'access.key');
    writePrivateToken(tokenFile, token);
    fs.chmodSync(process.env.GITHUB_ENV, 0o600);
    fs.appendFileSync(process.env.GITHUB_ENV, `NATIVE_SIM_GATE_TOKEN_FILE=${tokenFile}\n`);
    console.log('Encrypted session-key handoff prepared');
  } catch (error) {
    console.error(error.message);
    process.exitCode = 1;
  }
}
