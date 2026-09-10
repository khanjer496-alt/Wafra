# Apple App Store compliance package

_Prepared 10 September 2026. Complete against the exact archive selected in App Store Connect._

## App Privacy draft

Wafra does not track users for advertising and the repository contains no ad SDK
or third-party analytics SDK. The privacy answers must still describe the union
of Wafra plus RevenueCat and every optional network feature enabled in the
submitted binary.

Relevant categories to review in App Store Connect include financial information
and purchase history used for app functionality, customer-support content sent
only when the user explicitly submits feedback, and any identifier/purchase data
RevenueCat documents for the shipping SDK version. The main ledger itself is
stored in encrypted app storage on the device and is not a Wafra account/profile.

The current iPhone automatic-capture path is user-configured Apple Message
automation invoking Wafra's local App Intent on the same iPhone. Do not say that
Wafra reads the iPhone Messages inbox. Optional relay-backed email, PDF/CSV and
trusted-device features are separately initiated by the user and are described
in `docs/privacy-policy.md`.

## Export compliance

The binary contains application-level cryptography including X25519,
HKDF-SHA-256, AES-256-GCM and SQLCipher. The previous hard-coded
`ITSAppUsesNonExemptEncryption=false` answer has been removed. The publisher must
complete Apple's export-compliance questions for the exact binary and record the
approved result in `apple-export-compliance.json`; repository automation blocks a
public store-release readiness pass while that decision remains pending.

## App Review notes

Wafra is a personal money organizer, not a bank or payment service. It does not
connect to a bank account or move money. Manual entry works without configuring
automatic capture. Automatic bank-alert support varies by country, bank and exact
message format; unsupported formats are never promised as universal coverage.

For review, provide synthetic/non-financial demonstration data only. Do not give
reviewers a real user's bank message, account credential or reusable bearer token.

## Remaining App Store Connect blockers

- Publisher export-compliance determination.
- Final App Privacy answers checked against RevenueCat's shipping SDK behavior.
- RevenueCat Apple key/products/entitlement and TestFlight purchase/restore proof.
- Public Privacy/Terms/Support URLs and monitored support contact.
- Governing-law/counsel approval of Terms and Privacy Policy.
- Production-signed physical-iPhone verification of local Message automation,
  history import, notifications, deletion and accessibility.

