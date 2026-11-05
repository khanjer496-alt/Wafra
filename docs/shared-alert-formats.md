# Shared alert formats

A feature that lets Wafra users who teach the app an unrecognised bank
alert help other users of the same bank. Sending a layout requires an affirmative choice. Local
learning and matching work without it.

## Consent

- A current `shareAlertFormatsV1` value of `true` permits submissions unless
  Private Mode is on. An absent value, including an upgraded legacy
  default-on setting, does not authorize transmission.
- On the first eligible Teach or Review save, an undecided person can select
  **Keep private** or **Share bank wording** after reading what is sent.
  Either choice completes the local save. A saved choice persists until
  changed. An explicit off setting and Private Mode suppress contributions
  and automatic prompts. A person can also opt in explicitly in Teach or Settings.
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
  sharing is still on (`shouldSubmitConfirmedShape`).
  A corrected reading is never shared. Submission is fire-and-forget and silent.
- Review never uploads an unchanged reading solely because the user saved it.
  Outgoing sharing requires the separate, current choice above. Turning sharing
  off or enabling Private Mode also strips saved candidates from pending Review
  items.
- Names are screened out, not guaranteed absent: a merchant must be an exactly
  grounded slot (otherwise no shape is built), words in other scripts are
  refused unless on a short banking-boilerplate allowlist, and a format is only
  used after 3 different people send identical wording. Unpublished wording is
  deleted from the relay within 30 days.

## Sending credential

A phone with the iPhone capture pairing uses it. Any other phone (Android, or an
iPhone without capture set up) pairs once, on its first submission, through the
same `/v1/pair` contract with a fresh keypair, and keeps only `{baseUrl,
deviceId, syncToken}` under its own secure-store key
(`src/lib/shared-alert-format-identity.ts`). That credential is used for nothing
else, never changes capture or sync state, never pairs when sharing is off or in
Private Mode, backs off 24 hours after a failed pairing, and is deleted by
Erase all.
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
