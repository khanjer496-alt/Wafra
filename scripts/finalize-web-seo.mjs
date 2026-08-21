import fs from 'node:fs';
import path from 'node:path';

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
// Non-root app routes keep their scripts and remain available to the web QA
// harness; the acquisition page ships as resilient HTML/CSS with zero JS.
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

const sitemap = `<?xml version="1.0" encoding="UTF-8"?>
<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">
  <url>
    <loc>${siteUrl}/</loc>
    <changefreq>weekly</changefreq>
    <priority>1.0</priority>
  </url>
</urlset>
`;

fs.writeFileSync(path.join(outputDir, 'sitemap.xml'), sitemap);

const robots = fs.readFileSync(robotsPath, 'utf8').trimEnd();
fs.writeFileSync(robotsPath, `${robots}\nSitemap: ${siteUrl}/sitemap.xml\n`);

console.log(`Finalized web SEO files for ${siteUrl}.`);
