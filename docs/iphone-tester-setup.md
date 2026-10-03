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

Apple Pay setup is offered only on eligible iOS 27+ devices with native support.
It currently has written instructions; no iOS 27 recording or device proof is
claimed. The simulator's strict History file-protection failure was not bypassed
and does not qualify History behavior on an iPhone.
