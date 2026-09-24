-- One-time D1 migration: the ledger currency and numeric date order a
-- forwarded statement email is parsed under.
--
-- A forwarded email reaches the Worker with no app request around it, so the
-- phone records these two facts when it mints the forwarding address. Both
-- are coarse settings the user already chose (ledger currency, country date
-- order), never message content. NULL — every device paired before this
-- migration, and any address minted by an older build — keeps the launch
-- behaviour: AED or SAR from the device market pack, read day-first.
--
-- Additive and nullable. SQLite has no ADD COLUMN IF NOT EXISTS; apply once.
ALTER TABLE devices ADD COLUMN email_statement_currency TEXT
  CHECK (email_statement_currency IS NULL OR length(email_statement_currency) = 3);
ALTER TABLE devices ADD COLUMN email_statement_date_order TEXT
  CHECK (email_statement_date_order IS NULL OR
         email_statement_date_order IN ('day-first', 'month-first', 'unknown'));
