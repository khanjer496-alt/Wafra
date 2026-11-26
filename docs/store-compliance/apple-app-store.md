# Apple App Store compliance package

_Prepared 10 September 2026. Complete against the exact archive selected in App Store Connect._

## App Privacy draft

The draft tracking answer requires verification of SDK and dashboard data uses.
Superwall collects identifiers, purchase information and product events. The
privacy answers must describe Wafra plus Superwall and every optional network
feature enabled in the submitted binary; absence of an ATT prompt alone does
not prove absence of tracking.

Relevant categories to review in App Store Connect include financial information
and purchase history used for app functionality, customer-support content sent
only when the user explicitly submits feedback, and any identifier/purchase data
Superwall documents for the shipping SDK version. The main ledger itself is
stored in encrypted app storage on the device and is not a Wafra account/profile.

QA-008 update: online merchant and bank logos are off by default on both iOS and
Android, including older saved states without an explicit logo preference.
Settings → Online merchant logos explains that opting in shares cleaned names
with Brandfetch, which also sees requested domains and the network address.
Private Mode overrides that choice. Turning the switch off revokes queued
lookups and removes remote image sources; requests already sent cannot be recalled.
App Privacy must still disclose the union of enabled optional collection:
Purchase History remains in the draft because of Superwall, and Brandfetch
merchant lookups are an additional source only after opt-in. Do not remove a
data category merely because this optional feature starts off. Retention,
linkage and dashboard integration evidence remain release gates.

QA-009 update: App Lock enables a native iOS inactive-window cover and Android
secure-window protection for the recent-apps preview. Hide widget amounts with
App Lock starts on, omitting monetary values from the shared widget summary
while App Lock is enabled, even after unlocking the app. Names, dates and counts
can remain visible. Native candidate QA must verify recents, Face ID/passcode
return, cold start, Home Screen widgets and preference changes; source tests
do not prove the operating system has refreshed an existing widget image.

The current iPhone automatic-capture path is user-configured Apple Message
automation invoking Wafra's local App Intent on the same iPhone. Do not say that
Wafra reads the iPhone Messages inbox. Optional relay-backed email, PDF/CSV and
trusted-device features are separately initiated by the user and are described
in `docs/privacy-policy.md`.

## Export compliance

The binary contains application-level cryptography including X25519,
HKDF-SHA-256, AES-256-GCM and SQLCipher. Build 155 has a retained
[application-specific exempt-use assessment](apple-export-assessment-155.md),
recorded in `apple-export-compliance.json` and matched by
`ITSAppUsesNonExemptEncryption=false` in the app configuration. This is not a
no-encryption or OS-only declaration. Reassess it when the cryptographic scope
changes; repository automation still rejects missing or inconsistent decisions.

## App Review notes

Wafra is a personal money organizer, not a bank or payment service. It does not
connect to a bank account or move money. Manual entry works without configuring
automatic capture. Automatic bank-alert support varies by country, bank and exact
message format; unsupported formats are never promised as universal coverage.

For review, provide synthetic/non-financial demonstration data only. Do not give
reviewers a real user's bank message, account credential or reusable bearer token.

## Remaining App Store Connect blockers

- Publisher export-compliance determination.
- Final App Privacy answers checked against Superwall's shipping SDK behavior.
- Superwall iOS public key, products, `pro` entitlement, `pro_upgrade` campaign
  and TestFlight purchase/restore proof.
- Public Privacy/Terms/Support URLs and monitored support contact.
- Governing-law/counsel approval of Terms and Privacy Policy.
- Production-signed physical-iPhone verification of local Message automation,
  history import, notifications, deletion and accessibility.
