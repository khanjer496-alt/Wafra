# Shared alert formats

A feature that lets Wafra users who teach the app an unrecognised bank
alert help other users of the same bank. It is **on by default** and can be
turned off at any time.

## Consent

- `shareAlertFormats` is absent until the person chooses; absent means on. Only
  an explicit `false` (their choice, or a restored backup's) is off.
- The switch is shown, already on, at the moment of teaching a format on the
  teach screen, and can be turned off there or in Settings.
- Private Mode never sends, whatever the switch says.
- Scope today: taught formats. Sharing from Review confirmations of unrecognised
  alerts needs the alert text at confirmation time, which the Review tray
  deliberately never stores, so it is not wired yet. `shareConfirmedAlertFormat`
  (src/lib/shared-alert-format-share.ts) is the tested hook for when the text is
  available at that moment; the confirmation notice ships with it.

## What is sent

Only a **shape** of the alert: the fixed wording of the message with every
variable part replaced by a slot kind. A shape contains:

- the sender short code (for example a bank name; never a phone number or email),
- the direction (debit or credit) and the currency code,
- literal wording (words only), and slot markers for amount, merchant, date,
  time, card, balance and other numbers, recording only their *format*,
- a boolean for security-advisory boilerplate.

It never contains amounts, card digits, balances, dates, times, account
numbers, links, or the message text itself. The app refuses to build a shape
whose literal wording contains a digit, `@`, or a URL, or a word the learner
flags as a possible name that is not common banking boilerplate. That name
check is a heuristic, so k-anonymity (below) is the backstop, and unpublished
shapes are deleted after 30 days. The relay re-validates every field strictly; unknown fields are rejected.
Shapes larger than 8 KB are rejected. The relay never logs shape content.

The relay stores each vote against a keyed pseudonym (HMAC-SHA256 of the vault
id), not the vault id, and not a device or user identifier.

## Publishing: k = 3 distinct vaults

A shape is published only when at least **3 distinct vaults** submitted an
identical shape (identity = SHA-256 of the canonical, key-sorted JSON). Several
phones paired into one vault count once. A shape containing anything personal is
unique to one user and therefore never reaches the threshold.

Each vault may make at most 20 submissions per day.

## Using published shapes

Phones download the published list (public, cacheable, ETag) at most once per
day, validate every shape locally, and match on-device after the built-in
parsers decline. Matching never sends anything.

## Blocking and weekly review

The owner reviews shapes weekly:

- `GET /v1/admin/formats` lists every shape with its sender, status and
  distinct-vault count (the export used by the owner-run review job).
- `POST /v1/admin/formats/block` with `{"hash": "<shape hash>"}` marks a shape
  `blocked`. A blocked shape is removed from the published list immediately and
  can never be published again, even if more vaults submit it.

Both admin routes require `Authorization: Bearer <FORMATS_ADMIN_TOKEN>` and
answer `404` when the secret is unset or the token is wrong.

## Required Worker secrets (names only)

- `FORMATS_SALT` keys the vault pseudonym HMAC. Production must set it; without
  it a fixed fallback constant is used.
- `FORMATS_ADMIN_TOKEN` authorises the admin routes.

Set them with `wrangler secret put`; see `server/DEPLOY.md`. Never commit values.
