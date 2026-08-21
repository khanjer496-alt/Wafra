// The deploy path is the one piece of this repo that cannot be exercised in
// CI: it needs a Cloudflare account. That is exactly why it is worth pinning
// what CAN be checked, because the last two failures here were both silent —
// `scripts/d1.mjs` passed `--json` to a wrangler command that has no such flag
// (wrangler's parser is strict, so setup died before creating anything), and it
// looked an existing database up with `d1 info`, which resolves the name
// against wrangler.toml and therefore asked the API about a database literally
// called REPLACE_WITH_D1_DATABASE_ID.
//
// None of these assertions prove a deploy works. They prove the two specific
// ways it was already broken cannot come back unnoticed.
const fs = require('node:fs');
const path = require('node:path');
const { spawnSync } = require('node:child_process');

const root = path.join(__dirname, '..');
const d1 = fs.readFileSync(path.join(root, 'scripts/d1.mjs'), 'utf8');
const pkg = JSON.parse(fs.readFileSync(path.join(root, 'package.json'), 'utf8'));
const toml = fs.readFileSync(path.join(root, 'wrangler.toml'), 'utf8');

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

// The guard itself, run for real. Whichever state wrangler.toml is in, the
// exit code and the id have to agree: 1 while the placeholder is there, 0 once
// a uuid is written. A guard that passes in both states is not a guard.
const configuredId = toml.match(/^\s*database_id\s*=\s*"([^"]*)"/m)?.[1] ?? '';
const isRealId =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(configuredId);
const check = spawnSync(process.execPath, [path.join(root, 'scripts/d1.mjs'), 'check'], {
  encoding: 'utf8',
});
ok(
  `the predeploy guard ${isRealId ? 'passes with a real database_id' : 'refuses a placeholder database_id'}`,
  check.status === (isRealId ? 0 : 1),
  `exit ${check.status}`,
);
if (!isRealId) {
  ok(
    'and says what to run instead of printing a stack trace',
    /npm run setup/.test(check.stderr) && !/at .*d1\.mjs:\d+/.test(check.stderr),
  );
}

// npm runs `predeploy` before `deploy` and aborts the whole thing when it
// fails. That is the only reason `wrangler deploy` cannot run unconfigured.
ok('deploy is gated by a predeploy that runs the guard', /d1\.mjs check/.test(pkg.scripts.predeploy));
ok('migrate is gated by the same guard', /d1\.mjs check/.test(pkg.scripts.migrate));

// `wrangler d1 create` accepts no --json (checked against wrangler 4.116.0's
// own command definition) and wrangler rejects unknown arguments outright, so
// passing one fails before the database exists.
ok(
  'the database is created without a --json flag wrangler does not accept',
  /'d1',\s*'create',\s*DB_NAME\s*\]/.test(d1) && !/'create'[^\]]*--json/.test(d1),
);

// `d1 info <name>` reads wrangler.toml first and any non-empty database_id
// counts as a hit, so it cannot find an existing database while the
// placeholder is still in the file. `d1 list` does not consult the config.
ok(
  'an existing database is looked up with d1 list, not d1 info',
  /'d1',\s*'list',\s*'--json'/.test(d1) && !/'d1',\s*'info'/.test(d1),
);

// A remote --file execute prompts "ok to proceed?" unless --yes is given, and
// this script runs wrangler with stdin closed.
ok('the schema is applied non-interactively', /'--yes'/.test(d1) && /'--remote'/.test(d1));

// Every failure an operator can actually cause — no install, no login — has to
// end in a sentence. This is what the raw stack traces used to be.
ok('a missing wrangler install is named as such', /npm --prefix server ci/.test(d1));
ok('a logged-out wrangler is named as such', /wrangler login/.test(d1));

// The written id is read back, because a regex that silently matched nothing
// is how the placeholder survived a "successful" setup in the first place.
ok('the written database_id is verified by reading it back', /currentId\(\) !== id/.test(d1));

// csv-parse touches Buffer at module load. Cloudflare enables Node
// compatibility automatically only from 2026-08-04; an older date must opt in
// explicitly or the API rejects the Worker before deployment.
const compatibilityDate = toml.match(/^\s*compatibility_date\s*=\s*"([^"]*)"/m)?.[1] ?? '';
ok(
  'the Worker runtime provides Buffer for statement parser dependencies',
  compatibilityDate >= '2026-08-04' ||
    /^\s*compatibility_flags\s*=\s*\[[^\]]*"nodejs_compat"[^\]]*\]/m.test(toml),
);

ok('the deploy runbook exists', fs.existsSync(path.join(root, 'DEPLOY.md')));

console.log(`\n${passed} passed, ${failed} failed`);
process.exit(failed ? 1 : 0);
