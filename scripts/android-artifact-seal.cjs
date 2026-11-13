#!/usr/bin/env node
'use strict';
// Seals Android build outputs before they leave the runner, and opens them on
// the release Mac.
//
// The repository is public, so every Actions artifact can be downloaded by any
// signed-in GitHub user. build-apk.yml therefore uploads only:
//   - <label>.enc: the APK or AAB encrypted (CMS EnvelopedData, AES-256-CBC) to
//     the public certificate in .github/android-artifact-recipient.pem;
//   - verification.json: source commit, run number (= versionCode), the
//     plaintext and sealed SHA-256 of each file, and the compiled build flags.
// The matching private key never enters the repository, CI or chat; it stays
// on the release Mac (chmod 600). `open` decrypts and refuses any file whose
// SHA-256 differs from verification.json.
//
//   node scripts/android-artifact-seal.cjs seal --recipient <cert.pem> --out <dir> \
//     [--meta key=value ...] <label>=<file> [...]
//   node scripts/android-artifact-seal.cjs open --key <key.pem> --in <dir> --out <dir>
const crypto = require('node:crypto');
const { spawnSync } = require('node:child_process');
const fs = require('node:fs');
const path = require('node:path');
const flags = require('./android-build-flags.cjs');

const LABEL = /^[a-z0-9][a-z0-9-]*$/;

function sha256(file) {
  return crypto.createHash('sha256').update(fs.readFileSync(file)).digest('hex');
}

function openssl(args) {
  const out = spawnSync('openssl', args, { encoding: 'utf8' });
  if (out.status !== 0) throw new Error(`openssl ${args[0]} ${args[1]} failed: ${(out.stderr || '').trim()}`);
}

function parse(argv) {
  const options = { meta: {}, inputs: [] };
  for (let i = 0; i < argv.length; i += 1) {
    const arg = argv[i];
    if (arg === '--recipient' || arg === '--out' || arg === '--key' || arg === '--in') {
      options[arg.slice(2)] = argv[++i];
    } else if (arg === '--meta') {
      const [key, ...rest] = String(argv[++i]).split('=');
      options.meta[key] = rest.join('=');
    } else {
      options.inputs.push(arg);
    }
  }
  return options;
}

function seal({ recipient, out, meta, inputs }) {
  if (!recipient || !out || inputs.length === 0) throw new Error('seal needs --recipient, --out and <label>=<file>');
  fs.mkdirSync(out, { recursive: true });
  const files = inputs.map((input) => {
    const [label, file] = input.split('=');
    if (!LABEL.test(label || '') || !file) throw new Error(`bad input "${input}"; use <label>=<file>`);
    const sealed = path.join(out, `${label}.enc`);
    openssl(['cms', '-encrypt', '-binary', '-aes-256-cbc', '-outform', 'DER',
      '-in', file, '-out', sealed, recipient]);
    return {
      label,
      source: path.basename(file),
      bytes: fs.statSync(file).size,
      sha256: sha256(file),
      sealed: path.basename(sealed),
      sealedSha256: sha256(sealed),
      buildFlags: flags.report(flags.readBundle(file)),
    };
  });
  const verification = { schema: 'wafra-android-sealed-v1', ...meta, files };
  fs.writeFileSync(path.join(out, 'verification.json'), JSON.stringify(verification, null, 2) + '\n');
  return verification;
}

function open({ key, in: input, out }) {
  if (!key || !input || !out) throw new Error('open needs --key, --in and --out');
  const verification = JSON.parse(fs.readFileSync(path.join(input, 'verification.json'), 'utf8'));
  if (verification.schema !== 'wafra-android-sealed-v1') throw new Error('unknown verification.json schema');
  fs.mkdirSync(out, { recursive: true });
  return verification.files.map((entry) => {
    const sealed = path.join(input, entry.sealed);
    if (sha256(sealed) !== entry.sealedSha256) throw new Error(`${entry.sealed}: sealed SHA-256 mismatch`);
    const plain = path.join(out, entry.source);
    openssl(['cms', '-decrypt', '-binary', '-inform', 'DER', '-in', sealed, '-inkey', key, '-out', plain]);
    const actual = sha256(plain);
    if (actual !== entry.sha256) {
      fs.rmSync(plain, { force: true });
      throw new Error(`${entry.source}: SHA-256 ${actual} does not match verification.json ${entry.sha256}`);
    }
    return { file: plain, sha256: actual, bytes: entry.bytes, buildFlags: entry.buildFlags };
  });
}

if (require.main === module) {
  try {
    const [command, ...rest] = process.argv.slice(2);
    const options = parse(rest);
    const result = command === 'seal' ? seal(options) : command === 'open' ? open(options) : null;
    if (!result) throw new Error('usage: android-artifact-seal.cjs seal|open ...');
    console.log(JSON.stringify(result, null, 2));
  } catch (error) {
    console.error(`::error::${error.message}`);
    process.exitCode = 1;
  }
}

module.exports = { seal, open, parse };
