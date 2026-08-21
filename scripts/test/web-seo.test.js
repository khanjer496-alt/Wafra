const fs = require('fs');
const os = require('os');
const path = require('path');
const { spawnSync } = require('child_process');

let pass = 0;
let fail = 0;

function ok(name, condition, detail = '') {
  if (condition) {
    pass++;
    console.log(`✓ ${name}`);
    return;
  }
  fail++;
  console.error(`✗ ${name}${detail ? ` — ${detail}` : ''}`);
}

const root = path.join(__dirname, '../..');
const finalizer = path.join(root, 'scripts/finalize-web-seo.mjs');
const output = fs.mkdtempSync(path.join(os.tmpdir(), 'wafra-web-seo-'));

try {
  const placeholder = spawnSync(process.execPath, [finalizer, output], {
    cwd: root,
    encoding: 'utf8',
    env: {
      ...process.env,
      EXPO_PUBLIC_WAFRA_SITE_URL: 'https://your-owned-domain.example',
    },
  });
  ok(
    'the production finalizer rejects a reserved placeholder origin',
    placeholder.status === 1 && /not a placeholder/i.test(placeholder.stderr),
    `${placeholder.status}: ${placeholder.stderr.trim()}`,
  );

  const fixtureOrigin = spawnSync(process.execPath, [finalizer, output], {
    cwd: root,
    encoding: 'utf8',
    env: {
      ...process.env,
      // Test-only valid origin. Nothing is deployed or requested from it.
      EXPO_PUBLIC_WAFRA_SITE_URL: 'https://wafra-seo-fixture.dev',
    },
  });
  ok(
    'a non-placeholder HTTPS origin reaches the export validation boundary',
    fixtureOrigin.status === 1 && /No static Expo export found/i.test(fixtureOrigin.stderr),
    `${fixtureOrigin.status}: ${fixtureOrigin.stderr.trim()}`,
  );
} finally {
  fs.rmSync(output, { recursive: true, force: true });
}

console.log(`\nweb-seo: ${pass} passed, ${fail} failed`);
if (fail) process.exit(1);
