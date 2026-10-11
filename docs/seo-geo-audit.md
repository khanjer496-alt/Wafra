# Wafra SEO/GEO audit

_Audited: 16 August 2026 · updated 8 October 2026_

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
tests. Wafra is not offered as a web app: the production finalizer removes
every exported app screen, the app JavaScript and the app's bundled assets, so
those URLs return the static 404 page. Before October 2026 these screens were
deployed with `noindex` only, which hid them from search but still let anyone
open them and keep a ledger in unencrypted browser storage.

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
| Crawler control | Every exported app route indexable | Only the landing, privacy, terms and support pages are published; app screens are not deployed |
| XML sitemap | Missing | Generated with the real deployment origin |
| GEO / LLM context | Missing | Factual `llms.txt`, including limitations |
| Repeatable QA | None | Static-export audit with production-origin checks |
| Measurement | None | Server-side, cookie-free view and download counts |

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

The finalizer publishes the privacy policy, terms and support page from
`docs/`, and the store listings link to them. Both legal documents are still
marked **Launch draft**, and the terms still contain a governing-law
placeholder; counsel must finish them before a store launch.

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
- public indexability, the static 404 page, and that no app screen or app
  JavaScript is published;
- the `/get/iphone` download link and its `_redirects` fallback, and that
  no Android or GitHub download is published;
- Open Graph and X/Twitter metadata;
- both JSON-LD graphs;
- image alt text;
- `robots.txt`, `llms.txt`, the social card and XML sitemap;
- canonical, social-image and sitemap URLs against the configured origin.

## Performance boundary

The public page requires no client-side behavior. Its anchors and FAQ controls
are native HTML, so the production finalizer removes Expo's runtime scripts
from `index.html` and deletes the app bundles. The deployed site therefore
ships zero JavaScript. Wafra's browser tests use a separate seeded export
(`EXPO_PUBLIC_WAFRA_E2E_DEMO=1`, see `scripts/e2e/run.sh`) and never deploy it.
Production images and CSS remain measurable assets; set budgets for them and
measure field Core Web Vitals on the production origin.

## Measuring visits and downloads

The site cannot use a JavaScript analytics tag without breaking its zero-JS and
no-third-party-analytics promises, so it counts on the server instead:

- The download button links to first-party `/get/iphone`. There is no
  Android download while the source repository is private; `/get/android`
  returns the 404 page.
- `functions/index.js` and `functions/get/[platform].js` are Cloudflare Pages
  Functions. They write one data point per landing view or download click to
  the Workers Analytics Engine dataset `wafra_site_events`, then serve the
  static page or redirect to TestFlight or the APK
  (`src/marketing/site-events.mjs` holds both destinations).
- Each data point holds only the event, target, Cloudflare country, referring
  hostname, campaign tag (`utm_source` or `ref`) and a browser/automated label.
  No IP address, user agent, cookie or full URL is stored. The privacy policy's
  **Website** section discloses this.
- Without the binding, nothing is recorded and the site still works. If the
  output is ever served without Functions, `_redirects` keeps the download
  buttons working (Cloudflare ignores `_redirects` for Function routes).

**Deploying.** Run the **Deploy website** GitHub Actions workflow
(`.github/workflows/deploy-site.yml`, manual only) from `main`. It uses the
repository's `CLOUDFLARE_API_TOKEN` and `CLOUDFLARE_ACCOUNT_ID` secrets, which
need **Cloudflare Pages: Edit**. It builds and checks the site, then runs
`scripts/pages-site-config.mjs`. That script finds the Pages project serving
the site, adds the `SITE_EVENTS` → `wafra_site_events` binding, and sets
**Fail open**. It re-sends existing production settings and stops if any are
secrets or would be lost. The workflow then deploys with Functions and checks
the live URLs.

To do the same by hand: in the dashboard (Workers & Pages → the project →
Settings → Bindings → Add → Analytics engine), add variable `SITE_EVENTS` with
dataset `wafra_site_events` for Production, and set Settings → Runtime → Fail
open / closed to **Fail open**.

Deploy **from the repository root**. Wrangler compiles Functions from
`./functions` in the current directory; the older instructions that ran
`wrangler pages deploy ../dist` from `server/` would upload the static site
without Functions, so nothing would be counted (downloads would still work via
`_redirects`). Resolve the exact project name with
`server/node_modules/.bin/wrangler pages project list` rather than guessing it
from the hostname:

```sh
EXPO_PUBLIC_WAFRA_SITE_URL="$WAFRA_SITE_ORIGIN" npm run web:export
EXPO_PUBLIC_WAFRA_SITE_URL="$WAFRA_SITE_ORIGIN" npm run check:web-seo
server/node_modules/.bin/wrangler pages deploy dist --project-name "$WAFRA_PAGES_PROJECT"
```

Wrangler should report "Compiled Worker successfully" and upload Functions
with the deployment.

Read the funnel with an API token that has **Account Analytics: Read**:

```sh
CLOUDFLARE_ACCOUNT_ID=… CLOUDFLARE_API_TOKEN=… node scripts/site-funnel.mjs 30
```

It reports browser landing views, iPhone and Android download clicks,
click-through, top campaign tags, referring sites and countries, plus the APK's
all-time GitHub download count. TestFlight installs come from App Store Connect.
Tag outbound links (for example `?utm_source=instagram`) to see which channels
bring visitors. The Workers Free plan includes 100,000 Analytics Engine data
points a day, and data is kept for three months.

To check the Functions locally, serve a finalized export with
`server/node_modules/.bin/wrangler pages dev <export> --compatibility-date 2026-08-01`
(the pinned runtime rejects today's default date) and run
`scripts/e2e/e2e-marketing.mjs` with `EXPECT_REDIRECTS=1`.

**Shared request allowance.** Pages Functions requests count toward the
account's Workers request allowance (100,000 a day on Workers Free), which the
relay and the account's other Workers also use. Every landing view and
download click is one request. The deploy workflow sets the project to **Fail
open** (Settings → Runtime) so the static site and `_redirects` downloads keep
working if the allowance runs out. Watch Workers usage once traffic grows. If the landing page ever
needs that headroom, delete `functions/index.js` to count only download
clicks, or move to Workers Paid.

## Remaining external work

The site is live at `https://wafra-app-azg.pages.dev`, which the store
metadata and `app.json` already use for the privacy, terms and support URLs.
These items cannot be completed honestly from repository code alone:

1. Run the **Deploy website** workflow from `main`. It binds `SITE_EVENTS`,
   sets Fail open, deploys, and checks that `/get/iphone` is served by the
   counting Function.
2. Submit `/sitemap.xml` in Google Search Console and Bing Webmaster Tools.
3. Decide whether to move to a custom domain. A `pages.dev` address works, but
   a domain Wafra owns can be kept if hosting changes. If it changes, update
   `EXPO_PUBLIC_WAFRA_SITE_URL`, `app.json`, `docs/store-metadata.json` and the
   hosted Shortcut URL checks together, and redirect the old address.
4. Have counsel finish the launch-draft privacy policy and terms, including
   the governing-law placeholder, before a store launch.
5. Point `DOWNLOAD_DESTINATIONS` at the App Store and Google Play listings when
   they are live. Use campaign links there (App Store `pt`/`ct`, Play
   `referrer`) so store dashboards attribute installs to the website.
6. Establish field Core Web Vitals monitoring after the site has real traffic.
   A local score is not field evidence.

Until those are complete, the repository has a strong technical and content
foundation, but it should not be described as a deployed “10/10” SEO result.
