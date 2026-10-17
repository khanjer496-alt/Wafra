# iPhone tester setup

The tester build includes automatic device-local Pro and the corrected signed
Wafra Capture v3 Shortcut. Pro does not remove the iPhone's permission steps.

1. Open the new TestFlight build, then Settings → Capture sources.
2. Open How it works and choose **Reinstall Shortcut**. Share/open the bundled
   file in Shortcuts and choose **Replace** for an existing Wafra Capture v3.
   Updating Wafra alone does not update an installed Shortcut.
3. Return to Wafra and run the connection test. This checks the local handoff;
   it does not insert a transaction or prove that an automation has fired.
4. Follow the Message automation instructions. Leave Sender unselected and put
   one space in Message Contains. Choose Run Immediately, select Wafra Capture
   v3, and use Done/Notify When Run only if those controls appear. Edit an
   existing Wafra automation instead of adding a duplicate.
5. Test with a new incoming bank alert and verify its transaction, card due or
   Review result. Check capture details if it does not appear.

Message setup and past-message History import are separate. The app includes
real iOS 26.1 Simulator recordings of Message automation and History install/start
with English or Arabic captions. Populated History import and live incoming SMS
still need physical-phone verification. Statements remain the faster history
import option.

Apple Pay setup is offered on iOS 17+ (when Wallet Transaction automations
arrived) for banks that send no SMS. On iOS 17–26 the owner creates a personal
Transaction automation that runs the bundled Wafra Apple Pay v1 Shortcut; on
iOS 27 the guide adds the trigger inside the Shortcut, with its recording. The
first captured purchase from each Wallet card goes to Review; confirming it on
an account links that card (by Wallet's "Card or Pass" name, kept on the
iPhone only) and its later purchases post on their own. A purchase without a
card name, from an unlinked card, in another currency, on a deleted or hidden
account, while the Review lane is full, or that may already be in the ledger
(same amount within ten minutes, or within three days unless the shop names
clearly differ) still goes to Review. A card name confirmed on two different
accounts is treated as ambiguous (Wallet names are not unique) and always
asks until it is forgotten. A bank text for an Apple Pay purchase already in
the ledger goes to Review as a possible duplicate under the same window.
Links can be forgotten on the Apple Pay setup screen.

Release note: native builds from this change write the card name into the
queued Apple Pay record. An over-the-air JS bundle older than this change
rejects those records, which then wait in the native queue and expire after
30 days. The fingerprint runtime policy (app.json) already keeps bundles
built for older native code off this runtime; do not republish or roll back
an older JS bundle onto it by hand.
Review-and-confirm was verified with a real tap on an iPhone 15 (iOS 26.6.2);
automatic posting of a linked card is not yet device-verified. The simulator's strict History file-protection failure was not bypassed
and does not qualify History behavior on an iPhone.
