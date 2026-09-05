# Bold interactive landing · approved

The user rejected the live restrained two-phone landing. This candidate replaces
that composition with a full-width blue opening and an interactive SMS-to-record
explanation. The user approved the deployed interactive preview with “Okay approved”. Production publication is authorized; the release task owns deployment.

Changed source: `src/marketing/home.web.tsx`, `home.module.css` only. Existing
fonts, brand artwork, links, source app, native work and public image files remain
unchanged. Source hashes accompany this report.

## Local output and proof

Finalized export: `/tmp/wafra-bold-preview-web`, local port8173. Built from the
isolated `/tmp/wafra-ui-polish-runtime` snapshot with the actual production origin,
then processed with `finalize-web-seo.mjs`.

- `desktop-1440.png`: final desktop composition,1440×900.
- `mobile-390.png`: complete purchase example on390×844. Record title577.9px;
  amount610.9px, so the result is visible on the first screen.
- `mobile-320-payment.png`: payment example on320×740. Record title603.4px.
- `desktop-first.png` is an earlier composition checkpoint, superseded by the
  final desktop image.

Actual browser checks: no horizontal overflow at320/390/1440px; all four local
Plex fonts load; exactly two JSON-LD scripts and no executable JavaScript.
Native radio labels switch Purchase/Statement/Card payment, only the selected
panel appears in the accessibility tree, and ArrowRight switches from Statement
to Card payment. Reduced-motion CSS disables all animation and transitions.
Viewport overrides were reset after testing. No physical iPhone activity.

## Financial examples

The three synthetic messages were independently executed through the current
shipping `createLaunchAlertSession` with AE/AED context, derived from parser.test.js
purchase/statement/payment fixtures. A separate review checked the rendered data.

- Purchase: Corner Cafe, AED89.50, Dining, credit card4242,5Sep2026.
- Statement: totalAED3,240; minimumAED162; due5Oct2026; card4242. This is a
  statement obligation, not an expense. No payment allocation is inferred.
- Card payment: receiptAED250 towardcard4242. Shown as a card repayment, never
  ordinary spending, earnings, or a claim that a statement is settled.

These illustrate recognition, not a real ledger write, verified sender, universal
automatic coverage, or money movement. Sample labels and platform limitations
remain visible. No personal messages or merchant artwork are used.

## Review and checks

Focused ESLint and all5web-SEO unit checks pass. CSS Modules compile without
warnings, class mapping is complete, and diff checks pass. Independent financial/
markup review found no defects. The final source retains three native FAQs and
static font loading.

The existing full SEO checker has exactly two intentional layout-assumption
failures: it expects two product images and a Bills-image URL. This candidate uses
one real Home screenshot as secondary proof. All other checks pass. The release
owner should update those assertions only when adopting the new layout; they are
not product requirements.

Visual research: official Monzo and Wise pages informed the larger typography and
product-first presentation. No photos, logos, ratings, awards or financial claims
were copied. Cash App was readable through search but blocked in-browser, so it
was not treated as visual proof.

https://monzo.com/ · https://wise.com/

## Handoff

The release task owns Cloudflare preview deployment (`landing-bold-preview`) and
preview-only noindex headers. Production adoption is now approved. Publish a new APK URL only after the corresponding artifact verification exists. The current
beta destinations remain in this candidate.
# Publication approval

The user approved this direction after viewing the public Cloudflare preview. The release session may publish the approved design to the existing production site. Preview-only noindex headers belong to the separate preview deployment copy and must not be copied into production.
