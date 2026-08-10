// WHAT THIS FILE IS, AND WHAT IT IS NOT.
//
// Most of what follows reads server/src/index.ts as a STRING and regex-matches
// it. That is a weak instrument and it must not be mistaken for a strong one.
// It passes on a runtime-broken Worker and fails on a rename — wrong in both
// directions. "device-sealed queue retention is implemented at 30 days" passes
// because the SQL literal appears somewhere in the file; a scheduled() that
// threw on its first line would satisfy it just as well.
//
// For a long time these 32 assertions were the LARGER HALF of `npm run
// check:server` (59 assertions total), and the only other three suites in it
// are unit tests of push, imports and the deploy script. No route executed, no
// D1 stub existed, no fetch() or scheduled() was ever called. Reviewing a
// change to the Worker with check:server meant reading grep results.
//
// That is fixed at the gate rather than here: `npm run check:server` now also
// runs scripts/test/worker-gate.sh, which builds the real Worker and drives
// scripts/test/worker.test.js — worker.fetch and worker.scheduled against a D1
// stub over the real schema.sql, ~216 behavioural assertions. Retention,
// scope separation, the sealed queue, the replay receipts and the statement
// import paths are all EXERCISED there. Where an assertion below has a
// behavioural counterpart it is now a belt-and-braces check on the shape of
// the source, not the proof of the behaviour.
//
// The assertions that genuinely cannot be expressed behaviourally, and are the
// reason this file still exists, are the NEGATIVE ones — the properties whose
// violation is the absence of an observable event:
//
//   * no raw-message / body / email-body column exists in the schema, and no
//     `sender` column either. A behavioural test can only prove that the text
//     it happened to send is absent from the database; it cannot prove that no
//     column capable of holding message text exists at all.
//   * imports.ts and ingest-row.ts contain no console.*, no D1, no writeFile,
//     no INSERT — i.e. the parsing modules have no persistence or logging
//     SURFACE. There is no request that makes a console.log observable.
//   * a malformed sender is never serialized or echoed. The behavioural suite
//     checks the response and opened row; this checks every response shape the
//     file can produce.
//   * `raw` leaves the parsed row by SPREAD rather than by allow-list, so a
//     field the parser gains later still reaches the phone. The failure mode
//     is a field that does not exist yet, so nothing can drive it.
//   * schema.sql applies cleanly to a real sqlite3, which is a property of the
//     file and not of any code path.
//
// Nothing here is removed for being redundant: a grep that also holds is free,
// and the pairs are load-bearing in opposite directions.
const fs = require('node:fs');
const path = require('node:path');
const { execFileSync } = require('node:child_process');

const root = path.join(__dirname, '..');
const schema = fs.readFileSync(path.join(root, 'schema.sql'), 'utf8');
const worker = fs.readFileSync(path.join(root, 'src/index.ts'), 'utf8');
const imports = fs.readFileSync(path.join(root, 'src/imports.ts'), 'utf8');
const ingestRow = fs.readFileSync(path.join(root, 'src/ingest-row.ts'), 'utf8');
const feedback = fs.readFileSync(path.join(root, 'src/feedback.ts'), 'utf8');
const ingest = worker.slice(
  worker.indexOf("url.pathname === '/v1/ingest'"),
  worker.indexOf("url.pathname === '/v1/import/capabilities'"));
const deviceListQuery = worker.match(/`SELECT id, role, friendly_name, created_at, last_seen,[\s\S]*?ORDER BY CASE role[\s\S]*?`/)?.[0] ?? '';
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

execFileSync('sqlite3', [':memory:'], { input: `${schema}\nPRAGMA integrity_check;` });
ok('schema applies cleanly to SQLite', true);
ok('there is no raw-message column',
  !/\b(?:raw|body|message_text|email_body)\s+(?:TEXT|BLOB)\b/i.test(schema));
ok('push tokens are ciphertext columns, not plaintext',
  /token_iv\s+TEXT NOT NULL/.test(schema) && /token_ct\s+TEXT NOT NULL/.test(schema) &&
    !/push_token\s+TEXT/i.test(schema));
ok('device-sealed queue retention is implemented at 30 days',
  /DELETE FROM queue WHERE created_at < unixepoch\(\) - 2592000/.test(worker));
ok('device deletion also removes its push registration',
  /DELETE FROM push_registrations WHERE device_id = \?1/.test(worker));
ok('authenticated deletion retries retain only an expiring token digest',
  /CREATE TABLE IF NOT EXISTS admin_deletion_receipts/.test(schema) &&
    /PRIMARY KEY \(token_hash, route\)/.test(schema) &&
    /DELETE FROM admin_deletion_receipts WHERE expires_at <= unixepoch\(\)/.test(worker));
ok('retained queue rows get scheduled wake retries',
  /SELECT DISTINCT q\.device_id AS id[\s\S]*JOIN push_registrations/.test(worker) &&
    /pending \?\? \[\][\s\S]*wakeDevice\(env, row\.id\)/.test(worker));
ok('server drops parser raw before sealing',
  /const \{ raw: _discard, \.\.\.structured \} = parsed!/.test(worker));
ok('Shortcut rows are explicitly distinguished from email and PDF imports',
  /captureSource: 'shortcut'/.test(worker) &&
    /captureSource: 'email'/.test(worker) &&
    /captureSource: 'pdf'/.test(worker));
ok('replay receipts are keyed digests rather than bodies',
  /CREATE TABLE IF NOT EXISTS ingest_receipts/.test(schema) &&
    /keyedFingerprint\(device\.requestSecret, replayMaterial\)/.test(worker));
ok('queue insert and replay receipt are one D1 batch',
  /const results = await env\.DB\.batch\(\[/.test(worker));
ok('joined devices have independent credentials in one vault',
  /CREATE TABLE IF NOT EXISTS vaults/.test(schema) &&
    /CREATE TABLE IF NOT EXISTS device_invites/.test(schema) &&
    /INSERT INTO devices[\s\S]*SELECT \?1, vault_id, 'member'/.test(worker));
ok('relay rows are sealed independently for every vault device',
  /targets\.map\(async \(target\)[\s\S]*seal\(target\.public_key, row\)/.test(worker));
ok('forwarded email uses a separate hashed inject-only credential',
  /email_token_hash\s+TEXT UNIQUE/.test(schema) &&
    /scope: 'ingest' \| 'email' \| 'sync' \| 'admin'/.test(worker));
ok('background sync has a separate least-privilege credential',
  /sync_token_hash\s+TEXT NOT NULL UNIQUE/.test(schema) &&
    /url\.pathname === '\/v1\/sync'[\s\S]{0,180}authenticate\(req, env, 'sync'\)/.test(worker) &&
    /url\.pathname === '\/v1\/ack'[\s\S]{0,180}authenticate\(req, env, 'sync'\)/.test(worker));
ok('setup probe is reserved for the foreground verifier',
  /if \(!isTest && insertedTargets\.length > 0\) ctx\.waitUntil/.test(worker));
ok('email and PDF rows cross the same raw-discard boundary',
  /\.\.\.withoutRaw\(parsedRows\[index\]\), captureSource: 'email'/.test(worker) &&
    /\.\.\.withoutRaw\(extracted\.rows\[index\]\)/.test(worker));
ok('PDF endpoint never returns extracted rows or text',
  /return json\(\{ acceptedRows: extracted\.rows\.length, pages: extracted\.pages \}, 202\)/.test(worker));
ok('import module has no persistence or logging surface',
  !/(console\.|D1|R2|writeFile|put\(|INSERT INTO)/.test(imports));
ok('email HTTP ingestion requires the email-only bearer scope',
  /url\.pathname === '\/v1\/email\/ingest'[\s\S]{0,180}authenticate\(req, env, 'email'\)/.test(worker));
ok('PDF upload and capability discovery require admin scope',
  /url\.pathname === '\/v1\/import\/pdf'[\s\S]{0,180}authenticate\(req, env, 'admin'\)/.test(worker) &&
    /url\.pathname === '\/v1\/import\/capabilities'[\s\S]{0,180}authenticate\(req, env, 'admin'\)/.test(worker));
ok('direct PDF upload enforces media type, byte cap and PDF magic',
  /content-type[\s\S]{0,180}application\/pdf/.test(worker) &&
    /readBytes\(req, MAX_PDF_BYTES\)/.test(worker) && /!== '%PDF-'/.test(worker));
ok('email forwarding tokens are opt-in, rotatable and revocable',
  /url\.pathname === '\/v1\/email-token'/.test(worker) &&
    /UPDATE devices SET email_token_hash = \?1 WHERE id = \?2/.test(worker) &&
    /UPDATE devices SET email_token_hash = NULL WHERE id = \?1/.test(worker) &&
    !/await hashToken\(emailToken\)[\s\S]{0,120}adminToken/.test(worker.slice(0, worker.indexOf("url.pathname === '/v1/email-token'"))));
ok('vault devices can be listed, named and revoked without exposing credentials',
  /url\.pathname === '\/v1\/devices'/.test(worker) &&
    /deviceRoute && req\.method === 'PATCH'/.test(worker) &&
    /deviceRoute && req\.method === 'DELETE'/.test(worker) &&
    deviceListQuery.length > 0 && !/public_key/.test(deviceListQuery) &&
    /email_token_hash IS NOT NULL AS email_enabled/.test(deviceListQuery));
ok('the last owner requires explicit vault deletion',
  /return json\(\{ error: 'last_owner' \}, 409\)/.test(worker) &&
    /url\.pathname === '\/v1\/vault'/.test(worker));

// ── The bank label the Shortcut may send (see docs/ios-shortcut-spec.md) ──
//
// iOS had no bank identity at all until this field existed, so a card ending
// 3749 at one bank and a card ending 3749 at another were the same card as far
// as the import planner could tell. What makes the field safe rather than a
// second way in for message text is that it is validated, small, and sealed —
// it is not stored, not logged, and not echoed.
ok('the Shortcut sender is validated by one module, not inline in the route',
  /import \{ relaySender \} from '\.\/ingest-row';/.test(worker) &&
    /export function relaySender\(value: unknown\): string \| null \| undefined/.test(ingestRow));
ok('a malformed sender is dropped before the row is built, not the transaction',
  /const validatedSender = relaySender\(body\?\.sender\);/.test(ingest) &&
    /const sender = validatedSender === undefined \? null : validatedSender;/.test(ingest) &&
    !/bad_sender/.test(ingest));
ok('sender stays optional, so older Shortcut payloads still ingest',
  /sender\?: unknown/.test(worker) && /if \(value === undefined \|\| value === null\) return null;/.test(ingestRow));
ok('the sender is bounded and never truncated into the row',
  /export const MAX_RELAY_SENDER_LENGTH = \d{1,3};/.test(ingestRow) &&
    /if \(\[\.\.\.normalized\]\.length > MAX_RELAY_SENDER_LENGTH\) return undefined;/.test(ingestRow));
ok('the sender reaches the sealed row and nothing else',
  /\.\.\.\(!isTest && sender \? \{ sender \} : \{\}\),/.test(ingest) &&
    !/\.bind\([^)]*\bsender\b/.test(worker) &&
    !/\bsender\w*\s+(?:TEXT|BLOB|INTEGER)\b/i.test(schema));
ok('a malformed sender is not echoed back to the caller',
  !/json\(\{[^}]*\bsender\b[^}]*\}, 4\d\d\)/.test(worker));
ok('the sender module has no persistence or logging surface',
  !/(console\.|D1|R2|writeFile|put\(|INSERT INTO)/.test(ingestRow));

// ── Feedback, and the one place this service stores prose ──
//
// Everything about how the endpoint BEHAVES is exercised in
// scripts/test/worker.test.js against a real database. What is left for this
// file is the same category of thing as the assertions above: properties whose
// violation is the ABSENCE of an observable event, which no request can drive.
ok('feedback lives in its own table and never in the sealed queue',
  /CREATE TABLE IF NOT EXISTS feedback \(/.test(schema) &&
    !/INSERT INTO queue[\s\S]{0,400}feedback/i.test(worker));
// Column definitions only — the `--` prose around them says "no IP address"
// and would match its own prohibition.
const feedbackColumns = schema
  .slice(schema.indexOf('CREATE TABLE IF NOT EXISTS feedback ('))
  .split(/^\);$/m)[0]
  .replace(/--[^\n]*/g, '');
ok('the feedback table records no address, device or credential',
  feedbackColumns.length > 0 &&
    !/\b(?:ip|ip_address|device_id|token_hash|user_agent|fingerprint)\b/i.test(feedbackColumns));
ok('the feedback retention ceiling is shorter than the queue\'s, and written at insert',
  /export const FEEDBACK_RETENTION_SECONDS = 14 \* 24 \* 60 \* 60;/.test(feedback) &&
    /VALUES \(\?1, unixepoch\(\), unixepoch\(\) \+ \?2,/.test(worker) &&
    /DELETE FROM feedback WHERE expires_at <= unixepoch\(\)/.test(worker));
// A client_payload is readable by anyone with access to the repository's
// Actions data and is kept in the run record. The feedback is not — which is
// the entire reason a separate authenticated read route exists.
ok('the repository_dispatch carries the feedback id and nothing else',
  /client_payload: \{ feedbackId \},/.test(worker) &&
    !/client_payload:[\s\S]{0,200}\b(?:text|diagnostic|appVersion|locale)\b/.test(worker));
ok('a no-consent report is stored for humans without starting an agent',
  /const dispatchStatus = 'skipped_no_consent';/.test(worker) &&
    /return json\(\{ id, dispatched: false \}, 202\)/.test(worker) &&
    /body\.aiReviewConsent !== false/.test(feedback));
ok('the repository name is validated before it is interpolated into an API path',
  /githubRepository\(env\.GITHUB_REPOSITORY\)/.test(worker) &&
    /export function githubRepository/.test(feedback) &&
    !/repos\/\$\{env\.GITHUB_REPOSITORY/.test(worker));
ok('the agent read scope is a hashed bearer compared in constant time',
  /hashToken\(env\.FEEDBACK_READ_TOKEN\)/.test(worker) &&
    /timingSafeEqual\(presentedHash, expectedHash\)/.test(worker) &&
    /feedback_read_not_configured/.test(worker));
ok('over-long feedback is refused rather than truncated into the column',
  /return \{ error: 'text_too_long', status: 400 \}/.test(feedback) &&
    /return \{ error: 'diagnostic_too_large', status: 413 \}/.test(feedback) &&
    !/\.slice\(0, MAX_FEEDBACK/.test(feedback) && !/\.substring\(/.test(feedback));
ok('the feedback module has no persistence or logging surface',
  !/(console\.|D1|R2|writeFile|put\(|INSERT INTO)/.test(feedback));
// The Worker's observability sampling is on. Nothing in the request path may
// write a payload to it — not a bank message, and not a bug report either.
ok('no route logs anything at all',
  !/console\./.test(worker));

// The parser decides which leg of a card settlement a message is, because the
// relay drops the wording the app used to re-read. Nothing here needs to know
// the field by name — but it does need to keep passing fields it does not
// recognise through the raw discard, which is what a spread guarantees and an
// allow-list would have quietly broken.
ok('structured parser fields cross the raw discard by spread, not by allow-list',
  /const \{ raw: _discard, \.\.\.structured \} = parsed;/.test(worker) &&
    /return structured;/.test(worker) &&
    /const \{ raw: _discard, \.\.\.structured \} = parsed!;/.test(ingest));

console.log(`\n${passed} passed, ${failed} failed`);
process.exit(failed ? 1 : 0);
