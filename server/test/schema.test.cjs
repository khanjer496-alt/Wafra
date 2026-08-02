const fs = require('node:fs');
const path = require('node:path');
const { execFileSync } = require('node:child_process');

const root = path.join(__dirname, '..');
const schema = fs.readFileSync(path.join(root, 'schema.sql'), 'utf8');
const worker = fs.readFileSync(path.join(root, 'src/index.ts'), 'utf8');
const imports = fs.readFileSync(path.join(root, 'src/imports.ts'), 'utf8');
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

console.log(`\n${passed} passed, ${failed} failed`);
process.exit(failed ? 1 : 0);
