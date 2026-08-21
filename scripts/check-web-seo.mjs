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
  // Report the invalid value through the production URL check below.
}
const failures = [];
const checks = [];

const check = (label, pass, detail = '') => {
  checks.push({ label, pass, detail });
  if (!pass) failures.push(label);
};

const read = (relativePath) => fs.readFileSync(path.join(outputDir, relativePath), 'utf8');
const findHtmlFiles = (directory, prefix = '') => fs.readdirSync(directory, { withFileTypes: true }).flatMap((entry) => {
  const relativePath = path.join(prefix, entry.name);
  return entry.isDirectory()
    ? findHtmlFiles(path.join(directory, entry.name), relativePath)
    : entry.name.endsWith('.html') ? [relativePath] : [];
});
const index = read('index.html');
const llms = read('llms.txt');
const title = index.match(/<title[^>]*>(.*?)<\/title>/s)?.[1] ?? '';
const description = index.match(/<meta[^>]+name="description"[^>]+content="([^"]+)"/i)?.[1] ?? '';

check('descriptive title', title.length >= 30 && title.length <= 65, `${title.length} characters`);
check('meta description', description.length >= 120 && description.length <= 160, `${description.length} characters`);
check('single H1', (index.match(/<h1(?:\s|>)/g) ?? []).length === 1);
check('indexable public page', /name="robots" content="index, follow/.test(index));
check('Open Graph metadata', /property="og:title"/.test(index) && /property="og:description"/.test(index));
check('Twitter card metadata', /name="twitter:card" content="summary_large_image"/.test(index));
check('SoftwareApplication schema', /"@type":"SoftwareApplication"/.test(index));
check('FAQPage schema', /"@type":"FAQPage"/.test(index));
check('semantic FAQ content', (index.match(/<details>/g) ?? []).length === 3);
const scriptTags = index.match(/<script\b[^>]*>[\s\S]*?<\/script>/g) ?? [];
check(
  'zero-JavaScript public page',
  scriptTags.length === 2 &&
  scriptTags.every((tag) => /<script\s+type="application\/ld\+json">/.test(tag)),
);
const imageCount = (index.match(/<img\b/g) ?? []).length;
const accessibleImageCount = (index.match(/<img\b[^>]*\balt="[^"]+"/g) ?? []).length;
check('two static product images with alt text', imageCount === 2 && accessibleImageCount === 2);
check('static product image URLs', index.includes('src="/wafra-app-home.png"') && index.includes('src="/wafra-app-bills.png"'));
check(
  'public beta download links',
  index.includes('https://testflight.apple.com/join/jbwzCgZ6') &&
    index.includes('https://github.com/khanjer496-alt/Wafra/releases/download/android-test-9ea4cd8/Wafra-android-9ea4cd8.apk'),
);
check(
  'worldwide audience positioning',
  /use Wafra anywhere/i.test(index) && /manual tracking works anywhere/i.test(llms),
);
check(
  'no UAE or Saudi audience targeting',
  !/\b(?:UAE|Saudi)\b/i.test(`${title}\n${description}\n${index}\n${llms}`),
);
check('LLM discovery file', fs.existsSync(path.join(outputDir, 'llms.txt')));
check('crawler rules', fs.existsSync(path.join(outputDir, 'robots.txt')));
check('social card', fs.existsSync(path.join(outputDir, 'wafra-social.png')));
check('home product image', fs.existsSync(path.join(outputDir, 'wafra-app-home.png')));
check('bills product image', fs.existsSync(path.join(outputDir, 'wafra-app-bills.png')));

const privatePages = findHtmlFiles(outputDir).filter((file) => file !== 'index.html');
check(
  'every non-root HTML route is noindex',
  privatePages.length > 0 &&
  privatePages.every((file) => /name="robots" content="noindex, nofollow, noarchive"/.test(read(file))),
);
check(
  'non-root app routes retain JavaScript',
  privatePages.every((file) => /<script\b[^>]*\bsrc=/.test(read(file))),
);

check('production site URL configured', Boolean(siteUrl));
if (siteUrl) {
  check('canonical URL', index.includes(`rel="canonical" href="${siteUrl}"`));
  check('absolute social image', index.includes(`content="${siteUrl}/wafra-social.png"`));
  check('production sitemap', fs.existsSync(path.join(outputDir, 'sitemap.xml')));
  check('sitemap declared in robots', read('robots.txt').includes(`Sitemap: ${siteUrl}/sitemap.xml`));
}

for (const result of checks) {
  console.log(`${result.pass ? 'PASS' : 'FAIL'}  ${result.label}${result.detail ? ` (${result.detail})` : ''}`);
}

if (failures.length) process.exit(1);
