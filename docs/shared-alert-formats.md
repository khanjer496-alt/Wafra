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
- Scope: taught formats, and Review confirmations of alerts no proven parser
  recognised (not UAE/Saudi launch alerts, never in Private Mode).
- For Review items, the value-free shape is built when the item is created,
  while the alert text is still in memory (`buildCandidateShareShape`, called
  where an unrecognised alert becomes a generic Review item). Only
  `shareShape`, `shareHash` and `shareBasis` are stored on the item; the text is
  never stored. `shareBasis` (amount, currency, direction) stays on the phone,
  is never uploaded, and is re-validated on load (invalid candidates are dropped).
  Nothing is built when sharing is off or Private Mode is on at creation.
- At confirmation the shape is submitted only if the person confirmed the
  reading unchanged (same amount, currency and direction as `shareBasis`),
  sharing is still on, and a relay pairing exists (`shouldSubmitConfirmedShape`).
  A corrected reading is never shared. Submission is fire-and-forget and silent.
- The Review confirm screen shows one line with a "Turn off" control while
  sharing is on for that item.
- Not covered yet: pasted text without a sender, and Review items created by the
  private-format or on-device AI prefill paths, build no candidate.

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
