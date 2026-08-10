# Wafra product design review

This is a design proposal, not an implemented redesign. Keep it in a separate
change set so the launch-tested parser, encrypted ledger, billing, and native
history bridge are reviewable without a visual rewrite mixed into them.

## Design direction

Keep Wafra's strongest existing idea: a dark, calm “ledger and light” visual
language with exact numbers, restrained colour, and no banking-dashboard
clutter. The redesign should feel authored, not generated: fewer explanatory
cards, stronger hierarchy, real platform controls, and motion only when it
explains a state change.

Use the same information architecture on both platforms while allowing native
chrome to differ:

- iOS: native Expo Router tabs and stack headers, SF Symbols, system sheets,
  subtle Liquid Glass only in navigation and overlays, and standard back
  gestures.
- Android: Material-native navigation, controls, ripple/press feedback, and
  Android system sheets. Do not imitate iOS glass.
- Both: 44pt/48dp minimum targets, Dynamic Type/font scaling, visible focus,
  logical screen-reader order, Reduce Motion support, and no action that exists
  only on long press.

## Navigation

Keep four top-level destinations: Home, Flow, Bills, Wallet. Move Settings to a
header action. Keep transaction entry as a clear contextual action on Home and
Transactions, not as a decorative centre tab.

The current custom tab bar should eventually migrate to native tabs, but only
in its own tested redesign branch. That change affects safe areas, deep links,
screen persistence, screenshots, and accessibility, so it should not be folded
into parser launch work.

## Screen-by-screen proposal

### Onboarding

Reduce onboarding to three decisions:

1. What Wafra does: private spending, bills, recurring charges, and goals.
2. Choose the supported ledger market/currency. Until arbitrary ledger
   currencies ship, show UAE/AED and Saudi/SAR honestly and do not imply a
   worldwide ledger.
3. Choose a start path: sample ledger, manual entry, or supported import.

Move budget targets and detailed goals until after the first useful Home
screen. On iOS, describe Shortcuts as optional user-configured automation; on
Android, ask for SMS permission only when the user chooses automatic import.
Never auto-advance a setup step based on an unverified assumption.

### Home

Lead with one focal answer: “safe to spend” or “left this period.” Put income,
spending, and upcoming commitments immediately below as three compact facts.
Keep recent activity secondary. Replace status paragraphs with a single quiet
import-status row that opens setup details.

### Flow

Start with the period comparison, then one readable chart, then category
drivers. Avoid multiple cards repeating the same total. Every chart needs an
accessible text summary and selection state. Category-limit editing belongs in
a sheet with native controls.

### Bills

Use two native segments: Upcoming and Recurring. The add button needs a spoken
label and full touch target. A bill row should have one primary tap target;
secondary actions belong in a swipe action, overflow menu, or detail sheet—not
nested pressables. Show amount, due date, source account/card, and state in that
order.

### Wallet

Make account/card rows open on tap. Long press may add a shortcut menu but
cannot be the only route. Show card statement balance and due date before
decorative metadata. Collapse/expand controls need explicit accessibility
state and actions.

### Transactions

Keep search/filter/sort in the native header or a compact filter sheet. Show
active filters as removable chips and always expose “clear all.” The add action
must remain reachable with large text and one-handed use.

### Import and iPhone setup

Separate three concepts visually: live capture, past-message import, and
manual paste/PDF. Use one progress screen and one review screen; do not mix
installation instructions into the transaction review. Explain exactly what
leaves the phone for each method. A history import remains review-only until a
real iPhone proves Find Messages, sender/date fields, App Intent discovery,
lock/reboot behaviour, large histories, and cleanup.

### Pro

Show the current RevenueCat Offering with storefront-localized prices, one
selected plan, and one purchase action. Keep restore, manage/cancel, Privacy,
and Terms visible and accessible. Never substitute a ledger currency for a
store price. Announce purchase/restore outcomes to VoiceOver and TalkBack.

### Settings

Group by Money, Imports, Privacy, Data, and Support. Put destructive actions in
their own final section. Show configuration state as concise values rather than
instructional paragraphs. Privacy and Terms must remain reachable for both free
and subscribed users.

## Implementation sequence after approval

1. Accessibility-only fixes with no visual change.
2. Onboarding and import information architecture.
3. Native headers, sheets, and tab migration.
4. Home/Flow/Bills/Wallet hierarchy and interaction refinement.
5. Light mode, large text, VoiceOver/TalkBack, Reduce Motion, and contrast QA.
6. Native Release screenshot flow for English, then Arabic.

Each stage should be a separate commit and simulator/device review. Preserve the
existing visual identity; the goal is less UI, better hierarchy, and more native
behaviour—not a generic card dashboard.
