# One-page iPhone message onboarding

**Status:** Approved direction; implementation pending.

## Goal

Make first-run iPhone setup short, resumable and honest:

- every normal-text step fits the iPhone 16 Pro's 402×874-point portrait screen;
- past-alert import and future-alert setup appear in one checklist;
- leaving for Apple Shortcuts returns to the same saved step;
- no paragraph walls appear in the task flow;
- Wafra never claims Apple permissions it does not have.

## Platform facts

- Wafra cannot read the iPhone Messages inbox directly.
- Wafra and an installed Shortcut cannot create an Apple personal automation.
- On the physical iOS 26.6.1 phone, `Any Sender` with an empty
  `Message Contains` field did not enable **Next**.
- Apple's documented Message trigger requires an explicitly added sender or an
  explicitly added phrase.
- A phrase is not a worldwide bank-alert filter. Future automatic capture is
  therefore scoped to bank senders the user explicitly selects.
- The proven history Shortcut remains user-started and supports fewer than
  3,000 retained Messages; it is not direct or unlimited inbox access.

## First-run flow

The existing Welcome → Goals → Starting plan screens remain. Their supporting
copy is limited to two lines at normal text size.

The final choice screen becomes:

### Keep Wafra up to date

- **Use bank alerts**
  - `Import past alerts and connect selected banks for future alerts.`
- **Start manually**
  - `No Messages access. Connect later anytime.`
- Footer: `Processed on this iPhone. Nothing uploaded.`
- A **Learn more** sheet owns full privacy, retention, legacy-migration and
  platform-limit copy.

Choosing **Use bank alerts** opens one compact **Set up bank alerts** screen.

## Set up bank alerts screen

Show two collapsed checklist rows and expand only the active row:

1. **Future alerts — recommended**
2. **Past alerts — optional**

The header shows `0 of 2`, `1 of 2`, or `2 of 2`. A persistent **Finish later**
action is available. The normal layout does not scroll.

### Future alerts

The app makes this as easy as Apple's public interface permits:

1. **Add Wafra Local Capture** opens the exact published Shortcut.
2. On return, **Continue after adding** advances without claiming Wafra
   inspected the user's Shortcuts library.
3. **Create Apple automation** first shows a compact four-line guide, then opens
   Shortcuts:
   - Message
   - select the user's bank sender or bank contact
   - Run Immediately
   - Run Shortcut → Wafra Local Capture, input Received Message
4. **I finished in Shortcuts** enables local admission and runs the harmless
   no-input setup proof.

The success state says `Shortcut ready · waiting for a real bank alert`. Only a
real future alert from a selected sender can mark automatic capture verified.
The app must never use `Any Sender`, an empty trigger, a space, currency phrase
or other partial filter as a universal claim.

If Apple's picker cannot represent a bank sender, show `This sender cannot be
automated on this iPhone` and keep History and manual entry available. Do not
instruct users to fabricate a contact unless a physical test proves that the
contact triggers the bank conversation correctly.

### Past alerts

1. **Add Wafra History Import** opens the exact published Shortcut.
2. **Continue after adding** records only the user's confirmation.
3. **Check retained Messages** starts the existing history Shortcut.
4. On return, the existing local review/save flow remains authoritative.

Inline copy is limited to:

- `Checks retained Messages on this iPhone.`
- `Large histories can take 20–25 minutes.`

Coverage bounds, Always Allow guidance, temporary-source retention and cleanup
move to **Learn more** and remain available before the run.

## Persistence and return behavior

Add one source-free setup progress record with only enum/boolean state:

- future Shortcut confirmation;
- Apple automation self-confirmation;
- harmless setup proof/readiness;
- history Shortcut confirmation;
- active checklist row;
- skipped/completed state.

No Message content, sender, bank, account or transaction is stored in this
record. Existing native capture proof and history handoff markers remain the
authoritative operational state.

On mount and foreground:

- refresh native capture readiness;
- reconcile history handoff recovery;
- reopen the saved checklist row;
- never restart Welcome or silently mark setup complete.

Opening optional History from onboarding must not call `setOnboarded()` before
the user explicitly finishes or skips the checklist.

## Layout and copy limits

At 402×874 points with default Dynamic Type:

- safe areas and the home indicator remain unobstructed;
- one title, one two-line subtitle, two checklist rows, one primary action and
  one secondary action fit without scrolling;
- touch targets are at least 44 points;
- card body copy is at most two lines;
- no inline privacy block exceeds one line plus **Learn more**;
- status counts wrap into two compact rows instead of one long sentence.

For Accessibility/Dynamic Type or a shorter display, the same content uses a
scroll container. No text is clipped to satisfy the default no-scroll target.

## Error states

Keep errors short and actionable:

- `Shortcut did not open. Try again.`
- `Setup is not finished. Return to Shortcuts.`
- `This bank sender cannot be automated on this iPhone.`
- `History is still protected. Retry cleanup.`

Detailed explanations remain behind **Learn more**. A failure never marks a
checklist item complete.

## Implementation surface

- `src/components/onboarding-gate.tsx`
- `src/app/ios-setup.tsx`
- `src/app/import-sms.tsx`
- `src/lib/ios-capture-setup.ts`
- a focused source-free setup-progress module
- `src/lib/i18n.ts`
- onboarding, iOS setup, capture and history UX tests
- public TestFlight description/What to Test copy

Keep the two published Shortcut artifacts unchanged. Combining them would not
remove Apple's automation step and would invalidate current exact-graph and
physical history evidence.

## Verification

- TDD red/green tests for persistence, route return and copy budgets.
- Static layout assertions plus screenshots at 402×874 in light/dark modes.
- Dynamic Type and VoiceOver checks retain scroll/accessibility fallbacks.
- Fresh uninstall/reinstall walkthrough on the physical iPhone.
- One selected-bank Message automation must reach Wafra from a real future bank
  alert before automatic capture is called verified.
- Ship as a new TestFlight build; do not treat build 45's public availability as
  proof of the corrected onboarding.
