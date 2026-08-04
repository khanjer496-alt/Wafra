-- Wafra iOS relay schema.
--
-- There is no table for messages. That is the design, not an omission: the
-- Worker parses each message in memory and drops the text. What is stored is
-- the parsed row, already sealed to a device's public key, and only until that
-- device collects it.

CREATE TABLE IF NOT EXISTS devices (
  id          TEXT PRIMARY KEY,
  -- X25519 public key, base64. The private half never leaves the phone, so the
  -- service cannot read what it stored even under compulsion.
  public_key  TEXT NOT NULL,
  -- SHA-256 of the bearer token. A database leak cannot be replayed as a token.
  token_hash  TEXT NOT NULL UNIQUE,
  -- Market pack id the device parses under ('AE', 'SA'). The Worker cannot
  -- infer this: an SA user's "SAR 45.00 at PANDA" carries no currency the AE
  -- pack recognises, so it parsed as nothing at all under the old hardcoded
  -- default. This is a coarse country code the user already chose in Settings,
  -- not a new fact about them.
  market      TEXT NOT NULL DEFAULT 'AE',
  -- Expo push token, or NULL. This is the ONE field in this schema that is a
  -- stable identifier for a phone, and it is here for one reason: without a
  -- wake, a queued row waits until the user next opens the app, which defeats
  -- the promise the product is built on. It is optional — a device that never
  -- registers one still syncs on foreground and on the background task, just
  -- later. What it costs is stated plainly in README.md: Apple and Expo learn
  -- THAT a row arrived and when, never what it says. The push itself carries
  -- an empty payload.
  push_token  TEXT,
  -- 'expo' today. The column exists so a future direct-APNs sender can be told
  -- apart from an Expo one rather than guessed at from the token's shape.
  push_platform TEXT,
  -- When the last wake was sent, for coalescing. Apple throttles apps that
  -- exceed roughly two or three background pushes an hour, and a busy shopping
  -- day on a family card would sail past that — after which the OS quietly
  -- stops delivering them at all.
  push_sent_at INTEGER NOT NULL DEFAULT 0,
  created_at  INTEGER NOT NULL,
  last_seen   INTEGER NOT NULL
);

-- Migrations for databases created before these columns existed. SQLite has no
-- ADD COLUMN IF NOT EXISTS, and re-running this file must stay safe, so the
-- error from a second run is the expected outcome — see server/README.md.
-- ALTER TABLE devices ADD COLUMN market TEXT NOT NULL DEFAULT 'AE';
-- ALTER TABLE devices ADD COLUMN push_token TEXT;
-- ALTER TABLE devices ADD COLUMN push_platform TEXT;
-- ALTER TABLE devices ADD COLUMN push_sent_at INTEGER NOT NULL DEFAULT 0;

CREATE TABLE IF NOT EXISTS queue (
  id         TEXT PRIMARY KEY,
  device_id  TEXT NOT NULL,
  epk        TEXT NOT NULL,  -- ephemeral X25519 public key, base64
  iv         TEXT NOT NULL,  -- AES-GCM nonce, base64
  -- Sealed parsed row, base64. Since the relay gained sender and timestamp
  -- awareness this blob also carries the SMS sender id, the message timestamp
  -- and a SHA-256 digest of the message text (the phone's dedupe key). All
  -- three are INSIDE the seal: none of them is a column, an index or a log
  -- line, so the service still cannot say who texted this device or when.
  ct         TEXT NOT NULL,
  created_at INTEGER NOT NULL
);

CREATE INDEX IF NOT EXISTS queue_by_device ON queue (device_id, created_at);
CREATE INDEX IF NOT EXISTS devices_by_token ON devices (token_hash);
