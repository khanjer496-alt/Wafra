-- Wafra iOS relay schema.
--
-- There is no table for messages. That is the design, not an omission: the
-- Worker parses each message in memory and drops the text. What is stored is
-- the parsed row, already sealed to a device's public key, and only until that
-- device collects it.

CREATE TABLE IF NOT EXISTS vaults (
  id         TEXT PRIMARY KEY,
  created_at INTEGER NOT NULL
);

CREATE TABLE IF NOT EXISTS devices (
  id          TEXT PRIMARY KEY,
  -- A vault groups trusted phones for future relay delivery. Each phone keeps
  -- independent credentials and an independent public/private key pair.
  vault_id    TEXT NOT NULL,
  role        TEXT NOT NULL CHECK (role IN ('owner', 'member')),
  friendly_name TEXT,
  -- X25519 public key, base64. The private half never leaves the phone, so the
  -- service cannot read what it stored even under compulsion.
  public_key  TEXT NOT NULL,
  -- Market pack this device is parsed under ('AE', 'SA'). The Worker cannot
  -- infer it: a Saudi user's "SAR 45.00 at PANDA" carries no currency the AE
  -- pack recognises, so under the old hardcoded default it parsed as nothing at
  -- all and the row was dropped. This is the coarse country code the user
  -- already chose in Settings, not a new fact about them.
  market      TEXT NOT NULL DEFAULT 'AE',
  -- SHA-256 of the bearer token. A database leak cannot be replayed as a token.
  -- The Shortcut only receives ingest authority. The app keeps the separate
  -- Sync/ack has its own least-privilege token because it must be available
  -- to a locked-device background wake. Destructive management stays admin.
  ingest_token_hash TEXT NOT NULL UNIQUE,
  -- Forwarded email has its own inject-only credential because SMTP headers
  -- expose the destination address outside the app/relay TLS connection.
  email_token_hash  TEXT UNIQUE,
  sync_token_hash   TEXT NOT NULL UNIQUE,
  admin_token_hash  TEXT NOT NULL UNIQUE,
  created_at  INTEGER NOT NULL,
  last_seen   INTEGER NOT NULL
);

-- Admin-created, one-use, ten-minute invitations. Only the token digest is
-- stored, so a database leak cannot enroll a new phone into a user's vault.
CREATE TABLE IF NOT EXISTS device_invites (
  token_hash TEXT PRIMARY KEY,
  vault_id   TEXT NOT NULL,
  expires_at INTEGER NOT NULL,
  created_at INTEGER NOT NULL
);

CREATE TABLE IF NOT EXISTS queue (
  id         TEXT PRIMARY KEY,
  device_id  TEXT NOT NULL,
  epk        TEXT NOT NULL,  -- ephemeral X25519 public key, base64
  iv         TEXT NOT NULL,  -- AES-GCM nonce, base64
  -- Sealed parsed row, base64. Since the relay gained sender and timestamp
  -- awareness this blob also carries the SMS sender id, the message's own
  -- timestamp and the market pack it was parsed under. All of them are INSIDE
  -- the seal: none is a column, an index or a log line, so the service still
  -- cannot say which banks text this device or when.
  ct         TEXT NOT NULL,
  created_at INTEGER NOT NULL
);

-- Expo push tokens are bearer-like capabilities: knowing one is sufficient to
-- target the device unless enhanced push security is enabled. Store only an
-- AES-GCM ciphertext; PUSH_TOKEN_KEY lives in the Worker secret store. A wake
-- contains only `{kind: "wafra.sync"}` and never transaction data.
CREATE TABLE IF NOT EXISTS push_registrations (
  device_id  TEXT PRIMARY KEY,
  token_iv   TEXT NOT NULL,
  token_ct   TEXT NOT NULL,
  project_id TEXT NOT NULL,
  expires_at INTEGER NOT NULL,
  updated_at INTEGER NOT NULL,
  -- When the last wake was sent, for coalescing. Apple throttles an app past
  -- roughly two or three background pushes an hour and then quietly stops
  -- delivering them, which is invisible from here — so a burst of alerts on a
  -- busy day has to collapse into one knock. Claimed before the send, not
  -- after, so a hung send cannot let a second one start.
  push_sent_at INTEGER NOT NULL DEFAULT 0
);

-- Shortcuts and HTTP stacks may retry a completed request. A keyed HMAC keeps
-- those retries idempotent without keeping a body or a guessable body hash.
-- The key material is the raw ingest token, which is never stored in D1.
CREATE TABLE IF NOT EXISTS ingest_receipts (
  device_id  TEXT NOT NULL,
  replay_key TEXT NOT NULL,
  created_at INTEGER NOT NULL,
  expires_at INTEGER NOT NULL,
  PRIMARY KEY (device_id, replay_key)
);

-- A fixed-window counter limits authenticated Shortcut traffic without storing
-- IP addresses, message hashes, sender IDs or any other user-derived value.
CREATE TABLE IF NOT EXISTS ingest_limits (
  device_id    TEXT PRIMARY KEY,
  window_start INTEGER NOT NULL,
  request_count INTEGER NOT NULL
);

-- Global Worker-side pairing backstop. Production also applies an edge rule,
-- but the endpoint is never unbounded when that rule is misconfigured.
CREATE TABLE IF NOT EXISTS pair_limits (
  id            TEXT PRIMARY KEY,
  window_start  INTEGER NOT NULL,
  request_count INTEGER NOT NULL
);

-- In-app feedback, and the one place this service stores prose.
--
-- READ THIS BEFORE ADDING A COLUMN. Everything above is built on "the message
-- text is parsed and dropped", and nothing here weakens that: a bank alert
-- still never lands in a column. What lands here is what a user TYPED into a
-- feedback screen and pressed send on, plus a diagnostic their client redacted
-- before it left the phone. That is a different category of data from a message
-- their bank pushed at them while they were asleep, and refusing to keep it
-- would not protect anyone — it would only mean nobody can report a parser bug.
--
-- What it costs instead:
--   * its own table, never `queue`, and NOT sealed to a device — a maintainer
--     and an agent have to read it, so it does not pretend to be private;
--   * a SHORT ceiling. `expires_at` is fourteen days out, half the queue's
--     thirty, and the cron sweep in src/index.ts enforces it whether or not
--     anything was ever done with the item;
--   * bounded size, refused rather than truncated (see src/feedback.ts);
--   * no IP address, no device id, no token — an anonymous row.
CREATE TABLE IF NOT EXISTS feedback (
  id          TEXT PRIMARY KEY,
  created_at  INTEGER NOT NULL,
  -- Written at insert, not derived at read, so shortening the constant later
  -- cannot retroactively extend the life of a row already on disk.
  expires_at  INTEGER NOT NULL,
  app_version TEXT NOT NULL,
  platform    TEXT NOT NULL CHECK (platform IN ('ios', 'android', 'web')),
  locale      TEXT,
  -- The user's own words, scrubbed of control characters and bounded.
  text        TEXT NOT NULL,
  -- Serialized JSON, redacted client-side. Bounded at the wire.
  diagnostic  TEXT,
  -- 'pending' | 'sent' | 'failed' | 'skipped_unconfigured' |
  -- 'skipped_budget' | 'skipped_no_consent'.
  -- An operator has to be able to tell "no agent ran because GitHub is not
  -- wired up" from "no agent ran because the hourly budget was spent" without
  -- a log line quoting the payload.
  dispatch_status TEXT,
  dispatched_at   INTEGER
);

-- The feedback endpoint is reachable without a paired device, because the users
-- most likely to hit a parser bug are on ANDROID and never touch this relay at
-- all. That makes it the one write path with no bearer token in front of it, so
-- it gets the same shape of backstop /v1/pair has: a global fixed window that
-- stores no IP address, no hash of one, and nothing else user-derived.
--
-- The `feedback` counter bounds writes (how much a flood can put in the
-- database). Third-party agent dispatch is disabled unless a future app and
-- Worker contract add explicit consent, so no dispatch budget is spent today.
CREATE TABLE IF NOT EXISTS feedback_limits (
  id            TEXT PRIMARY KEY,
  window_start  INTEGER NOT NULL,
  request_count INTEGER NOT NULL
);

-- Upgrading a database created before these columns existed. SQLite has no
-- ADD COLUMN IF NOT EXISTS and re-running this file has to stay safe, so they
-- are commented rather than executed: the error from a second run would be the
-- expected outcome, and a migration whose expected outcome is an error is one
-- nobody can tell apart from a broken one. Run the matching commands in
-- server/README.md once, by hand, against a database that predates them.
-- ALTER TABLE devices ADD COLUMN market TEXT NOT NULL DEFAULT 'AE';
-- ALTER TABLE push_registrations ADD COLUMN push_sent_at INTEGER NOT NULL DEFAULT 0;

CREATE INDEX IF NOT EXISTS queue_by_device ON queue (device_id, created_at);
CREATE INDEX IF NOT EXISTS devices_by_ingest_token ON devices (ingest_token_hash);
CREATE INDEX IF NOT EXISTS devices_by_sync_token ON devices (sync_token_hash);
CREATE INDEX IF NOT EXISTS devices_by_admin_token ON devices (admin_token_hash);
CREATE INDEX IF NOT EXISTS devices_by_email_token ON devices (email_token_hash);
CREATE INDEX IF NOT EXISTS devices_by_vault ON devices (vault_id);
CREATE INDEX IF NOT EXISTS invites_by_expiry ON device_invites (expires_at);
CREATE INDEX IF NOT EXISTS push_by_expiry ON push_registrations (expires_at);
CREATE INDEX IF NOT EXISTS receipts_by_expiry ON ingest_receipts (expires_at);
CREATE INDEX IF NOT EXISTS feedback_by_expiry ON feedback (expires_at);
