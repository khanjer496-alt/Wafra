# Wafra SEO/GEO audit

_Audited: 16 August 2026_

This audit covers Wafra's public web acquisition surface. It does not describe
App Store or Google Play search optimization, and it does not claim that the
non-root app screens are useful or safe to index.

## Executive summary

The repository already used Expo Router static output, but the exported home
page had an empty title and rendered only `Loading your ledger` into its HTML.
There was no crawlable product page, description, canonical strategy,
structured data, crawler policy, social preview, XML sitemap, or LLM-facing
product summary.

The implementation now gives normal web builds a public, statically rendered
landing page while preserving Wafra's existing seeded web build for browser
tests. Non-root app routes are explicitly `noindex`; `robots.txt` permits
crawlers to read that directive. These routes remain publicly reachable when
deployed—`noindex` is crawler guidance, not access control. The production
finalizer removes Expo's duplicate `/(tabs)/…` route-group HTML artifacts.

## Before and after

| Area | Before | Now |
| --- | --- | --- |
| Static HTML | Loading state only | Complete product, privacy and FAQ copy |
| Title and description | Empty / missing | Unique, length-checked metadata |
| Heading structure | No public H1 | One H1 with H2/H3 hierarchy |
| Canonical URL | Missing | Required from the production HTTPS origin |
| Social metadata | Missing | Open Graph, X/Twitter and a 1200×630 preview |
| Structured data | Missing | `SoftwareApplication` and visible `FAQPage` graphs |
| Image accessibility | Not applicable | Descriptive alt text on both product previews |
| Crawler control | Every exported app route indexable | Public root indexable; every other exported HTML route `noindex` (not access-controlled) |
| XML sitemap | Missing | Generated with the real deployment origin |
| GEO / LLM context | Missing | Factual `llms.txt`, including limitations |
| Repeatable QA | None | Static-export audit with production-origin checks |

## Product-claim guardrails

The public copy intentionally preserves Wafra's launch constraints:

- no bank login;
- manual entry remains available;
- Android supported alerts are processed on-device after optional access;
- iPhone has no direct SMS-inbox access and optional capture uses a
  user-configured Shortcut;
- manual budgeting and expense tracking are positioned for users worldwide;
- bank-alert coverage varies by bank, country and message format;
- Wafra is not a bank and does not provide financial advice.

The page does not publish the draft privacy policy or terms. Those documents
still contain external launch blockers such as the legal entity, jurisdiction,
processing location and support address.

## Build and verify

Use the final owned HTTPS origin. Do not use a preview URL or placeholder in a
production artifact.

```sh
EXPO_PUBLIC_WAFRA_SITE_URL="$WAFRA_SITE_ORIGIN" npm run web:export
EXPO_PUBLIC_WAFRA_SITE_URL="$WAFRA_SITE_ORIGIN" npm run check:web-seo
```

`web:export` clears Metro's transform cache because Wafra's seeded browser-test
build uses a different public environment value. Without the clear, alternating
between the two modes can reuse a transform from the wrong surface.

The SEO check verifies:

- title and description lengths;
- one H1 and semantic FAQ markup;
- public indexability and non-root-route `noindex`;
- Open Graph and X/Twitter metadata;
- both JSON-LD graphs;
- image alt text;
- `robots.txt`, `llms.txt`, the social card and XML sitemap;
- canonical, social-image and sitemap URLs against the configured origin.

## Performance boundary

The public page requires no client-side behavior. Its anchors and FAQ controls
are native HTML, so the production finalizer removes Expo's runtime scripts
from `index.html`. The deployed root therefore ships zero JavaScript while the
non-root app routes retain their asynchronously split bundles for Wafra's web
QA harness. Production images and CSS remain measurable assets; set budgets for
them and measure field Core Web Vitals on the owned origin.

## Remaining external work

These items cannot be completed honestly from repository code alone:

1. Choose and configure Wafra's owned public HTTPS domain, then set
   `EXPO_PUBLIC_WAFRA_SITE_URL` in the production web build.
2. Deploy the generated static export and submit its `/sitemap.xml` in Google
   Search Console and Bing Webmaster Tools.
3. Complete and legally review the privacy policy and terms, host them on that
   domain, and only then add public legal links.
4. Replace informational availability copy with verified App Store and Google
   Play links when both listings are live.
5. Establish field Core Web Vitals monitoring after the production domain has
   real traffic. A local score is not field evidence.

Until those are complete, the repository has a strong technical and content
foundation, but it should not be described as a deployed “10/10” SEO result.
