import fs from 'node:fs';
import path from 'node:path';
import { writePublicPages } from './public-web-pages.mjs';
import { DOWNLOAD_DESTINATIONS } from '../src/marketing/site-events.mjs';

const outputDir = path.resolve(process.argv[2] ?? 'dist');
const rawSiteUrl = process.env.EXPO_PUBLIC_WAFRA_SITE_URL;
let siteUrl = '';

try {
  const parsed = new URL(rawSiteUrl ?? '');
  const isOriginOnly = parsed.pathname === '/' && !parsed.search && !parsed.hash;
  const hostname = parsed.hostname.toLowerCase();
  const isPlaceholder =
    hostname === 'localhost' ||
    hostname === '0.0.0.0' ||
    hostname === '[::1]' ||
    hostname === 'example.com' ||
    hostname === 'example.org' ||
    hostname === 'example.net' ||
    hostname.endsWith('.localhost') ||
    hostname.endsWith('.example') ||
    hostname.endsWith('.example.com') ||
    hostname.endsWith('.example.org') ||
    hostname.endsWith('.example.net') ||
    hostname.endsWith('.invalid') ||
    hostname.endsWith('.test');
  if (
    parsed.protocol === 'https:' &&
    !parsed.username &&
    !parsed.password &&
    isOriginOnly &&
    !isPlaceholder
  ) {
    siteUrl = parsed.origin;
  }
} catch {
  // The single validation error below is more useful than URL's variants.
}

if (!siteUrl) {
  console.error('EXPO_PUBLIC_WAFRA_SITE_URL must be Wafra\'s deployed HTTPS origin, not a placeholder.');
  process.exit(1);
}

const indexPath = path.join(outputDir, 'index.html');
const robotsPath = path.join(outputDir, 'robots.txt');
if (!fs.existsSync(indexPath) || !fs.existsSync(robotsPath)) {
  console.error(`No static Expo export found at ${outputDir}.`);
  process.exit(1);
}

// Expo Router exports route-group aliases even though groups are not part of
// the public URL. Remove the duplicate static HTML so it cannot be indexed at
// a literal `/(tabs)/…` path by a static host. This is deliberately after the
// export checks above so an unrelated directory can never be modified.
fs.rmSync(path.join(outputDir, '(tabs)'), { recursive: true, force: true });

// The public page has no client-side behavior: anchor navigation and FAQ
// disclosure are native HTML. Expo still injects its router/runtime scripts
// into every static route, so remove those references from the root document.
// The acquisition page ships as resilient HTML/CSS with zero JS.
const indexHtml = fs.readFileSync(indexPath, 'utf8');
const staticIndexHtml = indexHtml
  .replace(
    /<script\b[^>]*\bsrc="\/_expo\/static\/js\/web\/[^"]+\.js"[^>]*><\/script>/g,
    '',
  )
  .replace(
    '<script type="module">globalThis.__EXPO_ROUTER_HYDRATE__=true;</script>',
    '',
  );
fs.writeFileSync(indexPath, staticIndexHtml);

writePublicPages(outputDir, siteUrl);

// The website is not a web version of Wafra. Expo still exports every app
// screen with its JavaScript, and on the web those screens would keep a ledger
// in unencrypted browser storage. `noindex` only hides them from search, so
// remove them from the production output: unknown URLs then get the static
// 404 page. The seeded browser-test build (EXPO_PUBLIC_WAFRA_E2E_DEMO=1) is
// exported separately and never runs this finalizer.
const publicHtml = new Set(['index.html', '404.html', ...['privacy', 'terms', 'support']
  .map((route) => path.join(route, 'index.html'))]);
const removeAppRoutes = (directory, prefix = '') => {
  for (const entry of fs.readdirSync(directory, { withFileTypes: true })) {
    const relativePath = path.join(prefix, entry.name);
    const absolutePath = path.join(directory, entry.name);
    if (entry.isDirectory()) {
      removeAppRoutes(absolutePath, relativePath);
      if (!fs.readdirSync(absolutePath).length) fs.rmdirSync(absolutePath);
    } else if (entry.name.endsWith('.html') && !publicHtml.has(relativePath)) {
      fs.rmSync(absolutePath);
    }
  }
};
removeAppRoutes(outputDir);
fs.rmSync(path.join(outputDir, '_expo', 'static', 'js'), { recursive: true, force: true });
// Metro copies the app's bundled images and setup videos to assets/. Drop them
// too unless a remaining public page or stylesheet still points there.
const cssDir = path.join(outputDir, '_expo', 'static', 'css');
const publicSources = [
  ...[...publicHtml].map((file) => path.join(outputDir, file)),
  ...(fs.existsSync(cssDir) ? fs.readdirSync(cssDir).map((file) => path.join(cssDir, file)) : []),
].filter((file) => fs.existsSync(file));
if (!publicSources.some((file) => fs.readFileSync(file, 'utf8').includes('/assets/'))) {
  fs.rmSync(path.join(outputDir, 'assets'), { recursive: true, force: true });
}

// Download buttons link to first-party /get/<platform> paths. The Pages
// Functions in functions/get count the click and redirect; Cloudflare skips
// _redirects for Function routes, so these lines only take effect when the
// output is served without Functions and keep the buttons working there.
const redirects = Object.entries(DOWNLOAD_DESTINATIONS)
  .map(([platform, destination]) => `/get/${platform} ${destination} 302`)
  .join('\n');
fs.writeFileSync(path.join(outputDir, '_redirects'), `${redirects}\n`);

const sitemap = `<?xml version="1.0" encoding="UTF-8"?>
<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">
  <url>
    <loc>${siteUrl}/</loc>
    <changefreq>weekly</changefreq>
    <priority>1.0</priority>
  </url>
  <url><loc>${siteUrl}/privacy/</loc><changefreq>monthly</changefreq><priority>0.5</priority></url>
  <url><loc>${siteUrl}/terms/</loc><changefreq>monthly</changefreq><priority>0.5</priority></url>
  <url><loc>${siteUrl}/support/</loc><changefreq>monthly</changefreq><priority>0.6</priority></url>
</urlset>
`;

fs.writeFileSync(path.join(outputDir, 'sitemap.xml'), sitemap);

const robots = fs.readFileSync(robotsPath, 'utf8').replace(/^Sitemap:.*\r?\n?/gmi, '').trimEnd();
fs.writeFileSync(robotsPath, `${robots}\nSitemap: ${siteUrl}/sitemap.xml\n`);

console.log(`Finalized web SEO and public pages for ${siteUrl}.`);
