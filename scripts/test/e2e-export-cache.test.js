// The web E2E export switches an EXPO_PUBLIC mode. Metro's default transform
// cache does not distinguish those modes, so the runner must give this export
// its own cache lifetime and tear it down without losing the server teardown.
//
// This drives the real runner. The only stand-ins are its slow/external edges:
// Expo export, the static server, curl, and Playwright. They expose the runner's
// observable process environment and cleanup effects rather than its source.
const assert = require('node:assert/strict');
const childProcess = require('node:child_process');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

const root = path.join(__dirname, '..', '..');
const runner = path.join(root, 'scripts', 'e2e', 'run.sh');
const fixture = fs.mkdtempSync(path.join(os.tmpdir(), 'wafra-e2e-export-test-'));
const bin = path.join(fixture, 'bin');

const writeExecutable = (name, body) => {
  const file = path.join(bin, name);
  fs.writeFileSync(file, `#!/usr/bin/env bash\nset -eu\n${body}\n`);
  fs.chmodSync(file, 0o755);
};

const eventually = (predicate, timeoutMs = 3000) => {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    if (predicate()) return true;
    Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, 10);
  }
  return predicate();
};

try {
  fs.mkdirSync(bin);

  writeExecutable(
    'npx',
    `printf "export-tmp=%s\\n" "$TMPDIR" >> "$WAFRA_E2E_EXPORT_LOG"
mkdir -p "$TMPDIR/metro-cache"
printf fixture > "$TMPDIR/metro-cache/transform"
if [ "$WAFRA_E2E_TEST_MODE" = "export-fails" ]; then exit 41; fi`,
  );
  writeExecutable(
    'node',
    `if [ "$1" = "scripts/e2e/serve.mjs" ]; then
  printf "server-started\\n" >> "$WAFRA_E2E_EXPORT_LOG"
  trap 'printf "server-stopped\\n" >> "$WAFRA_E2E_EXPORT_LOG"; exit 0' TERM
  while :; do command sleep 1; done
fi
if [ "$WAFRA_E2E_TEST_MODE" = "suite-fails" ] && [ "$1" = "scripts/e2e/e2e-smoke.mjs" ]; then exit 42; fi
printf "suite=%s\\n" "$1" >> "$WAFRA_E2E_EXPORT_LOG"`,
  );
  writeExecutable('curl', 'exit 0');

  const exercise = ({ name, mode, status, startsServer }) => {
    const scenario = path.join(fixture, name);
    const inheritedTmp = path.join(scenario, 'inherited-tmp');
    const log = path.join(scenario, 'events.log');
    fs.mkdirSync(inheritedTmp, { recursive: true });

    const result = childProcess.spawnSync('bash', [runner], {
      cwd: root,
      encoding: 'utf8',
      env: {
        ...process.env,
        E2E_DIST: path.join(scenario, 'dist'),
        E2E_PORT: '18126',
        PATH: `${bin}:${process.env.PATH}`,
        TMPDIR: inheritedTmp,
        WAFRA_E2E_EXPORT_LOG: log,
        WAFRA_E2E_TEST_MODE: mode,
      },
    });

    assert.equal(result.status, status, `${name}: ${result.stdout}\n${result.stderr}`);
    const events = fs.readFileSync(log, 'utf8').trim().split('\n');
    const exportTmp = events
      .find((entry) => entry.startsWith('export-tmp='))
      ?.slice('export-tmp='.length);

    assert.ok(exportTmp, `${name}: export environment was not recorded: ${events.join(', ')}`);
    assert.notEqual(exportTmp, inheritedTmp, `${name}: E2E export reused the caller Metro cache`);
    assert.match(exportTmp, /^\/tmp\/wafra-e2e-metro\./, exportTmp);
    assert.equal(fs.existsSync(exportTmp), false, `${name}: export cache survived runner exit: ${exportTmp}`);
    assert.equal(events.includes('server-started'), startsServer, `${name}: unexpected server lifecycle`);
    if (startsServer) {
      assert.ok(
        eventually(() => fs.readFileSync(log, 'utf8').includes('server-stopped')),
        `${name}: server cleanup did not run: ${fs.readFileSync(log, 'utf8')}`,
      );
    }
  };

  exercise({ name: 'success', mode: 'success', status: 0, startsServer: true });
  exercise({ name: 'export-failure', mode: 'export-fails', status: 41, startsServer: false });
  exercise({ name: 'suite-failure', mode: 'suite-fails', status: 42, startsServer: true });

  console.log('✓ E2E export isolates and cleans Metro cache across success and failures');
} finally {
  fs.rmSync(fixture, { recursive: true, force: true });
}
