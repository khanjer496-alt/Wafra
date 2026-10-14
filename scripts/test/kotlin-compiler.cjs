'use strict';
// Test-only compiler provisioning. Never installs globally or changes app dependencies.
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const crypto = require('node:crypto');
const { execFileSync } = require('node:child_process');

const VERSION = '2.1.20';
const BYTES = 86919262;
const SHA256 = 'a118197b0de55ffab2bc8d5cd03a5e39033cfb53383d6931bc761dec0784891a';
const URL = `https://github.com/JetBrains/kotlin/releases/download/v${VERSION}/kotlin-compiler-${VERSION}.zip`;
// Critical executable/runtime files, derived from the checksum-verified official ZIP.
const FILE_HASHES = {
  'kotlinc/bin/kotlinc': '64d62a197fbec5f32f77c6724cce33ead4034b2ec3f873c056cde19fe00f324e',
  'kotlinc/lib/kotlin-preloader.jar': '443c949ab1f2490235f8667fc954783e942f215167447f9a7f2e51db89ecd831',
  'kotlinc/lib/kotlin-compiler.jar': '9c160024fb84cfaae2ebe40e2b2358b29497e8153f62a1ba61e253d3aab5e86b',
  'kotlinc/lib/kotlin-stdlib.jar': '1bcc74e8ce84e2c25eaafde10f1248349cce3062b6e36978cbeec610db1e930a',
  'kotlinc/lib/kotlin-reflect.jar': '419778f2b7a826bad6ee2ca1e4bdebe639ab306d2904fa3ef2a308ecfaab3811',
  'kotlinc/lib/kotlin-script-runtime.jar': 'ae4397fbb3aa2a1ada09290e753bba99a4114548977c3115526b9958f4cb1a04',
  'kotlinc/lib/kotlinx-coroutines-core-jvm.jar': '9860906a1937490bf5f3b06d2f0e10ef451e65b95b269f22daf68a3d1f5065c5',
  'kotlinc/lib/annotations-13.0.jar': 'ace2a10dc8e2d5fd34925ecac03e4988b2c0f851650c94b8cef49ba1bd111478',
};
const digest = bytes => crypto.createHash('sha256').update(bytes).digest('hex');
const compilerEnv = () => ({ ...process.env, JAVA_OPTS: '-Xmx384m -XX:ActiveProcessorCount=2' });
const assertRunnable = compiler => {
  try { execFileSync(compiler, ['-version'], { env: compilerEnv(), stdio: 'pipe', timeout: 15000 }); }
  catch { throw Error('Kotlin compiler cannot run. Provide a working JDK and KOTLINC; native checks cannot be skipped.'); }
  return compiler;
};
function cachedCompiler(dir) {
  if (!fs.existsSync(dir)) return null;
  if (fs.lstatSync(dir).isSymbolicLink()) throw Error('Kotlin test cache must not be a symlink');
  for (const [name, expected] of Object.entries(FILE_HASHES)) {
    const file = path.join(dir, name);
    if (!fs.existsSync(file) || !fs.lstatSync(file).isFile() || digest(fs.readFileSync(file)) !== expected) {
      throw Error(`Pinned Kotlin test cache failed integrity check: ${name}`);
    }
  }
  return assertRunnable(path.join(dir, 'kotlinc/bin/kotlinc'));
}
async function ensureKotlinc() {
  if (process.env.KOTLINC) return assertRunnable(process.env.KOTLINC);
  const dir = path.join(os.tmpdir(), `wafra-test-kotlin-${VERSION}-${SHA256.slice(0, 16)}`);
  const cached = cachedCompiler(dir);
  if (cached) return cached;
  const lock = `${dir}.lock`;
  try { fs.mkdirSync(lock, { mode: 0o700 }); }
  catch (error) {
    if (error.code !== 'EEXIST') throw error;
    const deadline = Date.now() + 65000;
    while (Date.now() < deadline && fs.existsSync(lock)) await new Promise(resolve => setTimeout(resolve, 250));
    const ready = cachedCompiler(dir);
    if (ready) return ready;
    throw Error('Pinned Kotlin test compiler setup did not complete; retry after the other test run finishes.');
  }
  const staging = fs.mkdtempSync(path.join(os.tmpdir(), 'wafra-kotlin-download-'));
  try {
    const ready = cachedCompiler(dir);
    if (ready) return ready;
    console.error(`Preparing task-local Kotlin ${VERSION} from its checksum-pinned official archive`);
    const response = await fetch(URL, { signal: AbortSignal.timeout(60000) });
    if (!response.ok) throw Error(`Official Kotlin download failed (${response.status}); provide KOTLINC to run native tests offline.`);
    const chunks = []; let size = 0;
    for await (const chunk of response.body) {
      size += chunk.length;
      if (size > BYTES) throw Error('Official Kotlin archive exceeded its pinned size');
      chunks.push(Buffer.from(chunk));
    }
    const bytes = Buffer.concat(chunks);
    if (size !== BYTES || digest(bytes) !== SHA256) throw Error('Official Kotlin archive size/SHA-256 mismatch');
    const archive = path.join(staging, 'compiler.zip');
    fs.writeFileSync(archive, bytes, { mode: 0o600 });
    const members = execFileSync('unzip', ['-Z1', archive], { encoding: 'utf8', maxBuffer: 1000000 }).trim().split('\n');
    if (members.some(name => !name.startsWith('kotlinc/') || name.includes('\\') || name.split('/').includes('..'))) {
      throw Error('Unexpected path in checksum-verified Kotlin archive');
    }
    execFileSync('unzip', ['-q', archive, '-d', staging], { stdio: 'pipe', timeout: 30000 });
    fs.chmodSync(path.join(staging, 'kotlinc/bin/kotlinc'), 0o700);
    cachedCompiler(staging);
    fs.writeFileSync(path.join(staging, 'receipt.safe.json'), JSON.stringify({ version: VERSION, url: URL,
      checksumUrl: URL + '.sha256', bytes: BYTES, sha256: SHA256, fileHashes: FILE_HASHES,
      noGlobalOrAppDependencyInstall: true }, null, 2), { mode: 0o600 });
    fs.renameSync(staging, dir);
    return cachedCompiler(dir);
  } finally {
    if (fs.existsSync(staging)) fs.rmSync(staging, { recursive: true, force: true });
    fs.rmdirSync(lock);
  }
}
module.exports = { ensureKotlinc, compilerEnv };
if (require.main === module) ensureKotlinc().then(compiler => console.log(compiler)).catch(error => {
  console.error(error.message); process.exitCode = 1;
});
