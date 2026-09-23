// The simulator seed builder and the sms.db seeder are simulator-only test
// tooling, but a wrong seed silently weakens what a probe run can prove:
// duplicate GUIDs would be dropped by Messages, and two rows in one second
// would defeat the paged graph's one-second overlap rule.
const test = require('node:test');
const assert = require('node:assert/strict');
const { execFileSync } = require('node:child_process');
const path = require('node:path');
const fs = require('node:fs');
const os = require('node:os');

const root = path.resolve(__dirname, '..', '..');
const builder = path.join(root, 'scripts/ios-sim/build-seed-messages.mjs');

const build = (...args) => JSON.parse(execFileSync('node', [builder, ...args], { encoding: 'utf8' }));

test('seed rows come from the public corpus with unique GUIDs and distinct seconds', () => {
  const seed = build('--now', '2026-09-22T12:00:00Z', '--days', '80');
  assert.ok(seed.rows.length >= 300, `expected the full corpus, got ${seed.rows.length}`);
  const guids = new Set(seed.rows.map((r) => r.guid));
  const dates = new Set(seed.rows.map((r) => r.date));
  assert.equal(guids.size, seed.rows.length);
  assert.equal(dates.size, seed.rows.length);
  for (const row of seed.rows) {
    assert.match(row.guid, /^[0-9A-F]{8}-[0-9A-F]{4}-4[0-9A-F]{3}-8[0-9A-F]{3}-[0-9A-F]{12}$/);
    assert.ok(row.sender && !/\s/.test(row.sender), `sender label for ${row.source}`);
    assert.ok(row.body.trim().length > 0);
    assert.match(row.date, /\.000Z$/, 'whole seconds only');
  }
  const newest = Date.parse(seed.rows[0].date);
  const oldest = Date.parse(seed.rows.at(-1).date);
  assert.ok(newest < Date.parse('2026-09-22T12:00:00Z'));
  assert.ok(oldest > Date.parse('2026-09-22T12:00:00Z') - 80 * 86_400_000);
  for (let i = 1; i < seed.rows.length; i += 1) assert.ok(Date.parse(seed.rows[i].date) < Date.parse(seed.rows[i - 1].date), 'newest first');
});

test('the same corpus and clock produce the same seed', () => {
  const a = build('--now', '2026-09-22T12:00:00Z');
  const b = build('--now', '2026-09-22T12:00:00Z');
  assert.deepEqual(a.rows, b.rows);
});

test('UAE fixtures land in the conversation of the bank that sent them', () => {
  const seed = build('--now', '2026-09-22T12:00:00Z');
  const bySource = Object.fromEntries(seed.rows.map((r) => [r.source, r.sender]));
  assert.equal(bySource['enbd-credit-card-purchase'], 'EmiratesNBD');
  assert.equal(bySource['adcb-salik-card-credit'], 'ADCB');
});

test('the seeder writes every row into a Messages-shaped store and reports what it skipped', (t) => {
  let sqlite;
  try {
    sqlite = execFileSync('python3', ['-c', 'import sqlite3; print(sqlite3.sqlite_version)'], { encoding: 'utf8' }).trim();
  } catch {
    t.skip('python3 with sqlite3 is not available');
    return;
  }
  assert.ok(sqlite);
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'wafra-sim-seed-'));
  const db = path.join(dir, 'sms.db');
  const rows = path.join(dir, 'rows.json');
  fs.writeFileSync(rows, JSON.stringify(build('--now', '2026-09-22T12:00:00Z')));
  execFileSync('python3', ['-c', `
import sqlite3
c = sqlite3.connect(${JSON.stringify(db)})
c.executescript("""
CREATE TABLE handle (ROWID INTEGER PRIMARY KEY AUTOINCREMENT, id TEXT NOT NULL, country TEXT, service TEXT NOT NULL, uncanonicalized_id TEXT, person_centric_id TEXT, UNIQUE(id, service));
CREATE TABLE chat (ROWID INTEGER PRIMARY KEY AUTOINCREMENT, guid TEXT UNIQUE NOT NULL, style INTEGER, state INTEGER, chat_identifier TEXT, service_name TEXT, group_id TEXT, newer_not_null_column INTEGER NOT NULL);
CREATE TABLE chat_handle_join (chat_id INTEGER, handle_id INTEGER, UNIQUE(chat_id, handle_id));
CREATE TABLE message (ROWID INTEGER PRIMARY KEY AUTOINCREMENT, guid TEXT UNIQUE NOT NULL, text TEXT, attributedBody BLOB, handle_id INTEGER DEFAULT 0, service TEXT, date INTEGER, is_from_me INTEGER DEFAULT 0, is_read INTEGER DEFAULT 0, item_type INTEGER DEFAULT 0);
CREATE TABLE chat_message_join (chat_id INTEGER, message_id INTEGER, message_date INTEGER DEFAULT 0, PRIMARY KEY (chat_id, message_id));
CREATE TRIGGER add_to_chat AFTER INSERT ON chat BEGIN UPDATE chat SET guid = verify_chat(guid_for_chat(NEW.chat_identifier, NEW.service_name, NEW.style)) WHERE ROWID = NEW.ROWID; END;
CREATE TRIGGER del_msg AFTER DELETE ON message BEGIN SELECT after_delete_message_plugin(OLD.ROWID); END;
CREATE TRIGGER mic AFTER INSERT ON message WHEN is_mic_enabled() = 1 BEGIN SELECT some_unknown_hook(NEW.ROWID); END;
""")
c.commit()
`]);
  const report = JSON.parse(execFileSync('python3', [path.join(root, 'scripts/ios-sim/seed-sms-db.py'), db, rows], { encoding: 'utf8' }));
  assert.ok(report.messages >= 300);
  assert.equal(report.message_rows_after - report.message_rows_before, report.messages);
  assert.deepEqual(report.defaulted, { chat: ['newer_not_null_column'] });
  assert.deepEqual(report.stubbed_functions, ['after_delete_message_plugin', 'some_unknown_hook'], 'trigger hooks are stubbed from the schema, not a fixed list');
  assert.ok(report.dropped.message.includes('needs_relay'), 'unknown columns are skipped, not invented');
  const check = execFileSync('python3', ['-c', `
import sqlite3
c = sqlite3.connect(${JSON.stringify(db)})
print(c.execute("select count(*) from message where attributedBody is null or text is null or handle_id = 0").fetchone()[0])
print(c.execute("select count(*) from chat_message_join j join chat c on c.ROWID = j.chat_id join message m on m.ROWID = j.message_id join handle h on h.ROWID = m.handle_id where c.chat_identifier != h.id").fetchone()[0])
print(c.execute("select substr(attributedBody, 1, 13) from message limit 1").fetchone()[0].decode('latin1'))
`], { encoding: 'utf8' }).trim().split('\n');
  assert.equal(check[0], '0', 'every row has a body, an attributed body and a handle');
  assert.equal(check[1], '0', 'every row is joined to its sender\'s conversation');
  assert.equal(check[2], '\u0004\u000bstreamtyped');
  // A re-run against the same store is a no-op: the GUIDs are already there,
  // and no conversation is created twice for a sender it already knows.
  const again = JSON.parse(execFileSync('python3', [path.join(root, 'scripts/ios-sim/seed-sms-db.py'), db, rows], { encoding: 'utf8' }));
  assert.equal(again.handles, 0);
  assert.equal(again.chats, 0);
  assert.equal(again.messages, 0);
  assert.equal(again.skipped_existing, report.messages);
});
