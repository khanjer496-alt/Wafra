#!/usr/bin/env node
/**
 * One command to stand the relay up: find-or-create the D1 database, write its
 * id into wrangler.toml, and apply the schema.
 *
 * It exists because the manual version — create the database, copy a uuid out
 * of the output, paste it into a config file, remember the --remote flag on
 * the migration — is four steps where three of them fail silently if you get
 * them wrong. A Worker deployed against the placeholder id returns 500 on
 * every request and says nothing about why.
 *
 * Idempotent: safe to re-run, and re-running is the intended way to point a
 * fresh clone at an existing database.
 */
import { execFileSync } from 'node:child_process';
import { readFileSync, writeFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const TOML = resolve(ROOT, 'wrangler.toml');
const DB_NAME = 'wafra';

function wrangler(args, { capture = true } = {}) {
  return execFileSync('npx', ['wrangler', ...args], {
    cwd: ROOT,
    encoding: 'utf8',
    stdio: capture ? ['inherit', 'pipe', 'pipe'] : 'inherit',
  });
}

/** Wrangler prints progress alongside JSON, so take the last balanced array. */
function parseJsonArray(output) {
  const start = output.indexOf('[');
  const end = output.lastIndexOf(']');
  if (start === -1 || end === -1) return null;
  try {
    return JSON.parse(output.slice(start, end + 1));
  } catch {
    return null;
  }
}

function findDatabase() {
  let out;
  try {
    out = wrangler(['d1', 'list', '--json']);
  } catch (err) {
    const text = `${err.stdout ?? ''}${err.stderr ?? ''}`;
    if (/more than one account/i.test(text)) {
      console.error(
        '\nYour Cloudflare login can see more than one account, so wrangler will not guess.\n' +
          'Pick one and re-run:\n\n' +
          '  export CLOUDFLARE_ACCOUNT_ID=<id from https://dash.cloudflare.com>\n' +
          '  npm run setup\n',
      );
      process.exit(1);
    }
    if (/not logged in|authentication|credentials/i.test(text)) {
      console.error('\nNot logged in. Run:\n\n  npx wrangler login\n');
      process.exit(1);
    }
    throw err;
  }
  const list = parseJsonArray(out) ?? [];
  return list.find((d) => d.name === DB_NAME) ?? null;
}

console.log(`Looking for the "${DB_NAME}" D1 database…`);
let db = findDatabase();

if (db) {
  console.log(`Found it (${db.uuid}).`);
} else {
  console.log('Not there yet — creating it.');
  wrangler(['d1', 'create', DB_NAME], { capture: false });
  db = findDatabase();
  if (!db) {
    console.error(`\nCreated "${DB_NAME}" but could not read its id back. Re-run this script.`);
    process.exit(1);
  }
  console.log(`Created (${db.uuid}).`);
}

const toml = readFileSync(TOML, 'utf8');
const next = toml.replace(/^database_id = ".*"$/m, `database_id = "${db.uuid}"`);
if (next === toml && !toml.includes(db.uuid)) {
  console.error('\nCould not find a database_id line in wrangler.toml to update.');
  process.exit(1);
}
if (next !== toml) {
  writeFileSync(TOML, next);
  console.log('Wrote the id into wrangler.toml.');
}

// --remote is the whole point: without it the schema lands in a local
// simulator file and the deployed Worker still has no tables.
console.log('Applying schema.sql to the remote database…');
wrangler(['d1', 'execute', DB_NAME, '--remote', '--file=./schema.sql', '-y'], { capture: false });

console.log(
  '\nDone. Next:\n\n' +
    '  npm run deploy\n\n' +
    'Then put the URL it prints into eas.json as EXPO_PUBLIC_WAFRA_RELAY_URL\n' +
    '(replacing REPLACE-ME in all three build profiles), and check it with:\n\n' +
    '  curl https://<the-url>/v1/health\n',
);
