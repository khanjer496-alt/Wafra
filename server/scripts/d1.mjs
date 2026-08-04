#!/usr/bin/env node
/**
 * Makes the relay deployable.
 *
 * `wrangler.toml` cannot take a D1 id from an environment variable — a
 * `[[d1_databases]]` binding is resolved at build time and there is no
 * substitution syntax — so the id has to be written into the file. For a long
 * time that line read `REPLACE_WITH_D1_DATABASE_ID`, which meant `wrangler
 * deploy` on a fresh clone failed with a Cloudflare API error about an unknown
 * database rather than anything an operator could act on.
 *
 *   node scripts/d1.mjs setup   create-or-find the database, write the id, apply the schema
 *   node scripts/d1.mjs check   fail loudly if the id is still a placeholder (runs before deploy)
 *
 * `setup` is idempotent: run it on a machine that already has the database and
 * it finds the existing one instead of creating a second.
 */
import { execFileSync } from 'node:child_process';
import { readFileSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const SERVER_DIR = join(dirname(fileURLToPath(import.meta.url)), '..');
const TOML = join(SERVER_DIR, 'wrangler.toml');
const SCHEMA = join(SERVER_DIR, 'schema.sql');
const DB_NAME = 'wafra';
/** The literal that means "nobody has run setup yet". */
const PLACEHOLDER = 'REPLACE_WITH_D1_DATABASE_ID';
/**
 * A D1 database id, validated down to the version and variant nibbles.
 *
 * The `[1-5]` and `[89ab]` groups are the strict part, folded in from the
 * `check-deploy-config.mjs` this script replaced. They are what stops a
 * plausible-looking hand-typed or truncated-and-repadded string from passing
 * as configuration and turning into a Cloudflare API error at deploy time,
 * which is the one moment nobody wants to be debugging a regex.
 */
const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
/** The same shape unanchored, for scanning it out of chatty wrangler output. */
const UUID_SCAN_RE = /[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}/i;

function readToml() {
  return readFileSync(TOML, 'utf8');
}

/** The configured id, or null when it is absent or still the placeholder. */
function currentId(toml = readToml()) {
  const m = toml.match(/^\s*database_id\s*=\s*"([^"]*)"/m);
  const id = m?.[1] ?? '';
  return UUID_RE.test(id) ? id : null;
}

function wrangler(args) {
  return execFileSync('npx', ['--no-install', 'wrangler', ...args], {
    cwd: SERVER_DIR,
    encoding: 'utf8',
    stdio: ['ignore', 'pipe', 'inherit'],
  });
}

/**
 * Wrangler's --json output is not always the only thing on stdout (login
 * notices, update banners), so the uuid is pulled out by shape rather than by
 * trusting the whole stream to parse.
 */
function idFrom(output) {
  try {
    const parsed = JSON.parse(output);
    const found = parsed?.uuid ?? parsed?.d1?.uuid ?? parsed?.database_id;
    if (typeof found === 'string' && UUID_RE.test(found)) return found;
  } catch {
    // Fall through to the scan below.
  }
  const scan = output.match(UUID_SCAN_RE);
  return scan?.[0] ?? null;
}

function check() {
  const id = currentId();
  if (id) {
    console.log(`d1: database_id is set (${id})`);
    return;
  }
  console.error(
    [
      '',
      `wrangler.toml still has no D1 database_id (looking for a uuid, found "${PLACEHOLDER}"-shaped text).`,
      '',
      'Run one of:',
      '  npm run setup                 # creates or finds the "wafra" database and writes the id',
      '  wrangler d1 create wafra      # then paste the printed uuid into wrangler.toml',
      '',
    ].join('\n'),
  );
  process.exit(1);
}

function setup() {
  const existing = currentId();
  if (existing) {
    console.log(`d1: database_id already set (${existing}) — leaving it alone`);
  } else {
    let id = null;
    try {
      // Already created on a previous machine or by a teammate.
      id = idFrom(wrangler(['d1', 'info', DB_NAME, '--json']));
    } catch {
      console.log(`d1: no existing "${DB_NAME}" database, creating one`);
    }
    if (!id) id = idFrom(wrangler(['d1', 'create', DB_NAME, '--json']));
    if (!id) {
      console.error('d1: could not determine the database id from wrangler output');
      process.exit(1);
    }
    const toml = readToml();
    const next = toml.replace(/^(\s*database_id\s*=\s*)"[^"]*"/m, `$1"${id}"`);
    if (next === toml) {
      console.error('d1: no database_id line found in wrangler.toml to write into');
      process.exit(1);
    }
    writeFileSync(TOML, next);
    console.log(`d1: wrote database_id = "${id}" into wrangler.toml`);
  }
  wrangler(['d1', 'execute', DB_NAME, '--remote', `--file=${SCHEMA}`, '--yes']);
  console.log('d1: schema applied');
}

const mode = process.argv[2];
if (mode === 'check') check();
else if (mode === 'setup') setup();
else {
  console.error('usage: node scripts/d1.mjs <setup|check>');
  process.exit(1);
}
