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
 *
 * Two things about wrangler 4.x that this script has to work around, both
 * verified against the CLI in `server/node_modules` rather than assumed:
 *
 * 1. `wrangler d1 create` has no `--json` flag and wrangler's argument parser
 *    is strict, so passing one fails with `Unknown arguments: json` before the
 *    database is ever created. The uuid is read out of the config snippet the
 *    command prints instead.
 * 2. `wrangler d1 info <name>` resolves the name against `wrangler.toml`
 *    first, and any non-empty `database_id` there counts as a hit. With the
 *    placeholder still in the file it therefore asks the API about a database
 *    literally called `REPLACE_WITH_D1_DATABASE_ID` and errors — which is
 *    exactly the state this script exists to fix. `wrangler d1 list` does not
 *    consult the config, so the "already created on another machine" lookup
 *    goes through that.
 */
import { execFileSync } from 'node:child_process';
import { existsSync, readFileSync, writeFileSync } from 'node:fs';
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

/** Exit with a sentence. A stack trace here tells an operator nothing. */
function fail(lines) {
  console.error(['', ...(Array.isArray(lines) ? lines : [lines]), ''].join('\n'));
  process.exit(1);
}

function readToml() {
  return readFileSync(TOML, 'utf8');
}

/** The configured id, or null when it is absent or still the placeholder. */
function currentId(toml = readToml()) {
  const m = toml.match(/^\s*database_id\s*=\s*"([^"]*)"/m);
  const id = m?.[1] ?? '';
  return UUID_RE.test(id) ? id : null;
}

/**
 * Run wrangler. `capture` keeps stderr for inspection instead of letting it
 * through to the terminal — used for the probes, whose failure is a normal
 * outcome we classify rather than something to shout about.
 */
function wrangler(args, { capture = false } = {}) {
  return execFileSync('npx', ['--no-install', 'wrangler', ...args], {
    cwd: SERVER_DIR,
    encoding: 'utf8',
    stdio: ['ignore', 'pipe', capture ? 'pipe' : 'inherit'],
  });
}

/** Never throws: `{ ok, stdout, stderr }`. */
function tryWrangler(args) {
  try {
    return { ok: true, stdout: wrangler(args, { capture: true }), stderr: '' };
  } catch (err) {
    return {
      ok: false,
      stdout: typeof err?.stdout === 'string' ? err.stdout : '',
      stderr: typeof err?.stderr === 'string' ? err.stderr : String(err?.message ?? err),
    };
  }
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
  fail([
    `wrangler.toml still has no D1 database_id (looking for a uuid, found "${PLACEHOLDER}"-shaped text).`,
    '',
    'Run one of:',
    '  npm run setup                 # creates or finds the "wafra" database and writes the id',
    '  wrangler d1 create wafra      # then paste the printed uuid into wrangler.toml',
    '',
    'server/DEPLOY.md has the whole ordered sequence.',
  ]);
}

/**
 * `npx --no-install` fails with a shell-level error when the dependency is
 * missing, which used to surface as "no existing database, creating one"
 * followed by a stack trace. Say the actual thing instead.
 */
function requireWrangler() {
  if (existsSync(join(SERVER_DIR, 'node_modules', '.bin', 'wrangler'))) return;
  fail([
    'wrangler is not installed in server/.',
    '',
    'Run:  npm --prefix server ci',
  ]);
}

/**
 * A logged-out wrangler is the single most likely reason for this script to
 * fail, and every command below reports it differently. Ask once, up front.
 *
 * `wrangler whoami --json` prints `{"loggedIn": false}` and exits non-zero when
 * there are no credentials, so the flag is read out of the text rather than
 * from the exit code.
 */
function requireLogin() {
  const res = tryWrangler(['whoami', '--json']);
  const text = `${res.stdout}\n${res.stderr}`;
  if (!/"loggedIn"\s*:\s*true/.test(text)) {
    fail([
      'wrangler is not logged in to a Cloudflare account.',
      '',
      'Run:  npx wrangler login          # opens a browser',
      '  or:  export CLOUDFLARE_API_TOKEN=...   # for a headless machine',
    ]);
  }
  // Multiple accounts and no account_id is a deploy-time failure, and it is
  // much cheaper to hear about it now than after the database exists.
  try {
    const accounts = JSON.parse(res.stdout.slice(res.stdout.indexOf('{')))?.accounts;
    const configured =
      process.env.CLOUDFLARE_ACCOUNT_ID || /^\s*account_id\s*=/m.test(readToml());
    if (Array.isArray(accounts) && accounts.length > 1 && !configured) {
      console.warn(
        [
          `d1: this login can see ${accounts.length} Cloudflare accounts and wrangler.toml has no account_id.`,
          '    Set CLOUDFLARE_ACCOUNT_ID (or account_id in wrangler.toml) or wrangler will ask, or refuse when it cannot ask.',
        ].join('\n'),
      );
    }
  } catch {
    // The warning is a courtesy; never let parsing it be the thing that fails.
  }
}

/** The uuid of an existing "wafra" database, or null. */
function findExisting() {
  const res = tryWrangler(['d1', 'list', '--json']);
  if (!res.ok) {
    fail([
      'could not list D1 databases, so setup cannot tell whether "wafra" already exists.',
      'Refusing to create one blindly — a second database with the same name is worse than stopping here.',
      '',
      'wrangler said:',
      res.stderr.trim() || '(no output)',
    ]);
  }
  try {
    const rows = JSON.parse(res.stdout.slice(res.stdout.indexOf('[')));
    const match = rows.find((row) => row?.name === DB_NAME);
    const id = match?.uuid ?? match?.database_id ?? null;
    return typeof id === 'string' && UUID_RE.test(id) ? id : null;
  } catch {
    fail([
      'could not parse `wrangler d1 list --json` output.',
      'Create the database by hand and paste the uuid into wrangler.toml — server/DEPLOY.md has the commands.',
    ]);
    return null;
  }
}

function createDatabase() {
  // No `--json` here: `d1 create` does not accept it and wrangler's parser is
  // strict, so passing it fails before anything is created. The command prints
  // a config snippet containing `database_id = "<uuid>"`; that is what is read.
  const res = tryWrangler(['d1', 'create', DB_NAME]);
  const id = res.ok ? idFrom(res.stdout) : null;
  if (!id) {
    fail([
      `could not create the "${DB_NAME}" D1 database.`,
      '',
      'wrangler said:',
      (res.stderr || res.stdout).trim() || '(no output)',
    ]);
  }
  return id;
}

function writeId(id) {
  const toml = readToml();
  const next = toml.replace(/^(\s*database_id\s*=\s*)"[^"]*"/m, `$1"${id}"`);
  if (next === toml) {
    fail([
      `the database now exists with id ${id}, but there is no database_id line in wrangler.toml to write it into.`,
      'Add one under [[d1_databases]] by hand and re-run — the database is already created, so this will not create a second.',
    ]);
  }
  writeFileSync(TOML, next);
  // Read it back: a write that silently did not take is the failure mode this
  // whole script exists to remove, so it does not get to happen quietly.
  if (currentId() !== id) {
    fail([`wrote database_id = "${id}" into wrangler.toml but reading it back did not return it.`]);
  }
  console.log(`d1: wrote database_id = "${id}" into wrangler.toml`);
}

function applySchema() {
  // `--yes` answers wrangler's "this may take some time, ok to proceed?"
  // prompt, which would otherwise hang a non-interactive run.
  const res = tryWrangler(['d1', 'execute', DB_NAME, '--remote', `--file=${SCHEMA}`, '--yes']);
  if (!res.ok) {
    fail([
      'the database exists and its id is written, but applying schema.sql failed.',
      'Nothing is half-created: re-running `npm run setup` will reuse the same database and only retry the schema.',
      '',
      'wrangler said:',
      (res.stderr || res.stdout).trim() || '(no output)',
    ]);
  }
  console.log('d1: schema applied');
}

function setup() {
  requireWrangler();
  requireLogin();
  const existing = currentId();
  if (existing) {
    console.log(`d1: database_id already set (${existing}) — leaving it alone`);
  } else {
    writeId(findExisting() ?? createDatabase());
  }
  applySchema();
}

const mode = process.argv[2];
if (mode === 'check') check();
else if (mode === 'setup') setup();
else {
  console.error('usage: node scripts/d1.mjs <setup|check>');
  process.exit(1);
}
