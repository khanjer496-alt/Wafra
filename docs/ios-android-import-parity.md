# iOS history and Android ledger parity

The acceptance target is equivalent financial results after import when both
platforms receive equivalent supported message evidence. The working iPhone
history Shortcut remains the extraction mechanism. No user-specific account,
amount, timestamp, or message text is special-cased.

## Reproduced gaps and changes

The completed Shortcut uses `ios-history-import.ts` and `historical-import.ts`.
The separate `local-message-record.ts` path handles live capture. Tests now drive
the actual completed-history loader, including multiple native chunks, through
the shared import planner and ledger reducer, alongside Android `scanInbox`.

- Original receive time now reaches the parser from both history and live
  capture, allowing the bounded receipt-date correction described in
  [receipt-date-context-validation.md](receipt-date-context-validation.md).
- Historical messages retain bounded transfer endpoints and issuer-scoped
  masked-account evidence before the source body is discarded. Previously a
  masked bank account could disappear from Wallet together with its quoted
  balance, and reciprocal transfers could lose their links.
- Bank identity is resolved in the parsed currency's regional pack. Import
  planning uses the same proven money system without changing the user's device
  preference. A Saudi import no longer loses issuer identity because the initial
  parser preference was UAE, or vice versa.
- A currency token is not evidence that a foreign issuer is a supported
  regional bank, including when it quotes AED. History import and Android
  inbox/notification capture may auto-add an unverified format under the
  default best-effort setting (`src/lib/best-effort-autopost.ts`) when
  the policy proves a completed movement in the pinned ledger currency; the row
  is marked "Auto-added — check". iOS live capture deliberately stays
  review-only for unverified formats. The policy's unverified-sender rule
  applies to a sender that is a 7+ digit phone number, an e-mail address or a
  generic word, and to a BLANK sender (an iOS History record, since Find
  Messages exposes none, or pasted text): such a credit without the user's
  own card or account tail waits in Review on both platforms (including the
  few banks that send from a full number, such as US toll-free alerts), and
  is never auto-added. A blank-sender record that matched an exact certified
  bank template, or that names the own tail, is decided by the other
  guardrails. A blank-sender record may keep a link only when it states a
  completed movement on the own account or card tail and the link carries
  no call to action (UCO's "Report Dispute <link>").
- Live declines preserve valid Apple message identities, so an unrelated posting
  sharing the same received second cannot be removed by timestamp matching.
- An admitted date-only repair runs before account discovery and snapshots. It
  cannot create unused accounts or assign new balances as a side effect.

The source-free boundary remains intact. Reimport uses original source identity;
equal amounts or nearby dates do not establish duplicate money or transfer
ownership. User edits remain protected. No personal diagnostics were copied
into source or test fixtures.

## Evidence and limits

Final validation on 2026-09-19:

- Fresh test compilation, app/server typechecks and diff checks passed.
- All 18 relevant compiled regression suites passed, including parser/bank
  corpora, monetary invariants, import planning, accounting, history, Android
  review capture and cloud imports.
- 215 focused transfer, date, source-identity, parity and iPhone paging tests
  passed. This includes 12 end-to-end platform comparison scenarios.
- Independent review passed 29 focused tests against the final build and found
  no remaining blocking issues after the account/snapshot side-effect fix.
- Nine existing import-index/checkpoint performance guards passed. An earlier
  concurrent run failed two timing assertions; the isolated final invariant run
  passed unchanged thresholds. No phone speed improvement is claimed from this.
- Targeted lint passed with no errors and three existing import-plan warnings.

The executable parity scenarios compare accounts, category and direction,
statements/payment roles, quoted snapshots, transfer evidence and validated
reciprocal links, review facts, currency, and idempotent reimport. Comparisons
remove only transport-specific identities and signatures, after validating the
signatures independently. Separate guards cover source collisions, user edits,
mixed/pinned currencies, market-context restoration and privacy stripping.

This work does not claim every bank or language can automatically post. The
existing regional grammars and worldwide review capabilities still define
coverage. Android bank-app notifications have different trust evidence from SMS
and are not the comparison used here. Senderless Gulf history retains its
existing grammar allowance because the Shortcut can lack sender metadata; no
bank identity is invented from that absence.

The existing Review tray retains at most 50 pending candidates; a large worldwide
history import is therefore not evidence that every uncertain message is still
actionable in the tray. That existing product limit is not changed here.

These are source-level checks using native transport stubs. Installed-build
behavior, physical Shortcut replay, performance on an iPhone, and repair of the
user's saved dataset still require an updated iPhone build and device validation.
The Android 317 artifact is unchanged. These checks were completed before the
follow-up iOS release; build and distribution evidence must identify its exact
source revision separately.


## Live capture boundary — 14 October 2026

The guided iOS Message trigger is independent of country and ledger currency.
It uses one space, so only messages containing a space match; it is not proof
of every language or format. Per-currency triggers were withdrawn because they
would miss foreign-currency alerts. Source checks retain foreign-currency Review
facts and true three-decimal JOD units without changing the ledger preference.

The iOS native queue refuses recognized credentials before storage, using the
Android SMS credential policy with grouped/Unicode codes and localized labels.
Explicit first-person conversation cannot produce a native preview or enter the
local parser's AI/private-format enrichment. Unfamiliar financial messages keep
their existing parser or Review route. These guards do not prove complete bank
classification or worldwide automatic posting.

Android can run the parser in a bounded background JS task. The approved iOS
integration now evaluates the shared parser in isolated JavaScriptCore for a
guarded source-currency notification or Review caption after queueing input.
It does not post ledger rows: the full ledger pipeline still runs when Wafra
drains the queue while active or on resume. Apple controls the
Shortcuts automation banner; filtering after delivery cannot prevent that
system trigger notification. Run Immediately and Notify When Run off where
offered remain user settings. Quiet pre-iOS-27 execution has not been verified
on an affected physical phone. See the [current candidate evidence](test-evidence/2026-10-12-parser-launch-candidate.md).


The integration preserves nullable country/parser-pack/ledger preferences,
exact receipt bytes and current consent/entitlement/alert gates. Host and
simulator checks are recorded in the [integration evidence](test-evidence/2026-10-14-ios-native-parser-integration.md); signed app and physical iPhone execution remain separate gates.
