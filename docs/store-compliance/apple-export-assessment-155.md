# Build 155 encryption declaration

Assessment date: 19 September 2026. Scope: Wafra 1.0.0 (155), source
`fe8064f182bdc9829fd2c1bb9a4f0dc8fd748173`, IPA SHA-256
`0d30c5e9aa0a6374f9d47ec7c07cc9ce59805fd5109da3ce674b09c0b81548d6`.

The publisher requested public TestFlight release and then instructed the
assistant to resolve the export-compliance block. The determination below is an
authorized, product-specific self-assessment based on the shipped source and
official guidance. It is not a CCATS classification, ANSSI certificate, or claim
that a lawyer or regulator approved this build.

## Determination

Record `ITSAppUsesNonExemptEncryption=false`: encryption is present, but its use
is confined to Wafra's application-specific financial functions. This does **not**
mean no encryption, OS-only encryption, or TLS-only encryption.

## Technical facts

- `state-storage.native.ts` uses SQLCipher for Wafra's own financial ledger and
  application state; `background-relay-storage.native.ts` stages its financial
  imports. This is not a user-facing general database or encrypted file vault.
- `relay-crypto.ts` implements standard X25519, HKDF-SHA256 and AES-256-GCM through
  the Noble libraries. The relay opens structured financial rows that are
  validated before import. It does not provide general user-to-user messaging.
- Native history hashes/authenticates source identities using CryptoKit.
  Device keys are generated internally and protected by the Keychain.
- There is no user-facing arbitrary-text/file encryptor, cipher selection,
  cryptographic key import/export, or general-purpose cryptographic API.
- Backup/export is Wafra financial JSON/CSV/PDF; restore requires the Wafra
  financial-state schema. It is not a general encrypted-backup product.
- Standard third-party cryptography is acknowledged. The determination does
  not rely on pretending those libraries are Apple operating-system services.

## Basis and application

1. [Apple's declaration guidance](https://developer.apple.com/documentation/security/complying-with-encryption-export-regulations)
   permits `NO` for exempt encryption, including relevant linked libraries.
   Apple distinguishes that from non-exempt encryption requiring documentation.
2. [BIS application-specific guidance](https://www.bis.gov/learn-support/encryption-controls/5a002-a.1-a.5)
   distinguishes general security, communications and computing products from
   apps whose cryptography supports a specific primary function. Wafra's
   financial organization, imports and ledger are the primary function. Applying
   that distinction to the technical facts above supports exempt-use treatment;
   the finance category label alone would not establish it.
3. [Apple's export-compliance overview](https://developer.apple.com/help/app-store-connect/manage-app-information/overview-of-export-compliance/)
   recognizes French banking/medical exemptions. The underlying
   [French decree, Annex 1 category 3](https://www.legifrance.gouv.fr/codes/section_lc/JORFTEXT000000646995/LEGISCTA000006090175/)
   addresses consumer equipment limited to banking or financial operations where
   cryptographic capability is inaccessible to the user. Wafra's restricted
   financial use and lack of user-accessible cryptographic functions support that
   application-specific exemption. This is an interpretation of product scope,
   not a claim that Wafra is a licensed bank.

The application call sites and package declarations were reviewed independently.
This is not an exhaustive reverse-engineering audit of every third-party binary.
General-purpose crypto/storage/communications features, new non-standard
algorithms, materially different SDK behavior, or changed legal requirements
require reassessment. No general waiver of other publisher export/reporting
obligations is asserted.

## Release implementation

The App Store Connect declaration can be applied to the already-processed build
155 without modifying or rebuilding its signed IPA. The matching Info.plist
setting in `app.json` prevents this unanswered declaration from recurring in
future builds with the same assessed cryptographic scope. Public Beta membership
and external testing state must still be verified separately.

For build `535b777e-b463-4ef5-92f3-ff6a734880d3`, the App Store Connect field was
updated and read back as `false`. The build was assigned to the existing public
Beta group and submitted for beta review. Subsequent reads showed internal and
external `IN_BETA_TESTING`, explicit membership of that group, and the enabled
public link `https://testflight.apple.com/join/jbwzCgZ6`. This verifies TestFlight
availability, not a regulator-issued export classification or physical-device QA.
