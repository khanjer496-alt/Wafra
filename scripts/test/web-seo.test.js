const fs = require('fs');
const os = require('os');
const path = require('path');
const { spawnSync } = require('child_process');

let pass = 0;
let fail = 0;

function ok(name, condition, detail = '') {
  if (condition) {
    pass++;
    console.log(`✓ ${name}`);
    return;
  }
  fail++;
  console.error(`✗ ${name}${detail ? ` — ${detail}` : ''}`);
}

const root = path.join(__dirname, '../..');
const finalizer = path.join(root, 'scripts/finalize-web-seo.mjs');
const output = fs.mkdtempSync(path.join(os.tmpdir(), 'wafra-web-seo-'));
const landing = fs.readFileSync(path.join(root, 'src/marketing/home.web.tsx'), 'utf8');
const content = fs.readFileSync(path.join(root, 'src/marketing/content.ts'), 'utf8');
const css = fs.readFileSync(path.join(root, 'src/marketing/home.module.css'), 'utf8');
const mark = fs.readFileSync(path.join(root, 'src/marketing/wafra-mark.web.tsx'), 'utf8');

ok(
  'the landing uses the original Claude Ledger & Light palette and typography',
  ['#F4F1EA', '#14120F', '#1F6B52', 'GeistMono', 'NotoKufiArabic'].every((token) => css.includes(token)) &&
    /font-family: Geist/.test(css) && !/#2855D9|#F6F8FC|#FAFAF7|#072E28|#106B50/i.test(`${css}\n${landing}`),
);
ok(
  'the previous headline, supporting line and three feature stories are preserved',
  landing.includes('Know your spending.<br />Plan what comes next.') &&
    landing.includes('Spending, budgets and bills in one private ledger. No bank login needed.') &&
    ['See what you spent', 'See what is coming', 'Catch drift early'].every((text) => content.includes(text)) &&
    !landing.includes('A little clarity.'),
);
ok(
  'the website, favicon and social card use the original two-stroke W-arrow',
  ['M8 15 L15.5 33 L23 19 L30.5 33 L40 11.5', 'M34 11.5 H40 V17.5'].every((d) =>
    [mark, fs.readFileSync(path.join(root, 'public/wafra-icon.svg'), 'utf8'),
      fs.readFileSync(path.join(root, 'public/wafra-social.svg'), 'utf8')].every((svg) => svg.includes(d))) &&
    !landing.includes("@/components/wafra-logo"),
);
ok(
  'the hero capture illustration discloses sample data and bank-format dependence',
  landing.includes('Illustration · sample data · automatic capture depends on your bank’s alert format') &&
    /role="img"\s+aria-label="Illustration with sample data/.test(landing),
);
ok(
  'the capture, categories and subscriptions demos exist and stay honest about scope',
  ['id="how-it-works"', 'id="categories"', 'id="subscriptions"'].every((id) => landing.includes(id)) &&
    content.includes('Only from a bank sender you selected in Apple Shortcuts.') &&
    content.includes('There is no network step.') &&
    landing.includes('transfers between your own accounts stay out of spending') &&
    !/every bank|any bank|all banks/i.test(`${landing}\n${content}`),
);
ok(
  'demo motion is CSS-only and has a reduced-motion rest state',
  /@media \(prefers-reduced-motion: no-preference\)/.test(css) && !/<script(?! type="application\/ld\+json")/.test(landing),
);
ok(
  'the app tour shows the redesigned Home, category percentages and separate bill sections',
  landing.includes('id="inside-wafra"') && landing.includes('/wafra-app-spending.png') &&
    landing.includes('/wafra-app-bills-light.png') &&
    landing.includes('category’s share of total spending') &&
    landing.includes('Subscriptions and utilities in separate sections') &&
    !landing.includes('showing recorded balances'),
);

ok(
  'the landing page teaches iPhone capture only from selected bank senders',
  /iPhone[\s\S]{0,500}bank senders (?:the user )?selects[\s\S]{0,500}locally/.test(landing) &&
    !/Any Sender/.test(landing),
);
ok(
  'the visible and structured FAQ agree on local selected-bank-sender capture',
  (content.match(/bank senders (?:the user )?selects/g) || []).length >= 2 &&
    (content.match(/locally on (?:this |the )?iPhone/g) || []).length >= 2 &&
    !/Any Sender/.test(content),
);
ok(
  'the landing privacy list names capture opt-out as manual-only instead of Private Mode',
  /<strong>Manual-only<\/strong>[\s\S]{0,220}Leave automatic Message capture off/.test(landing) &&
    !/<strong>Private mode<\/strong>[\s\S]{0,220}Leave message access off/.test(landing),
);
ok(
  'the landing links to dedicated privacy, terms and support pages',
  ['/privacy/', '/terms/', '/support/'].every((route) => landing.includes(`href="${route}"`)),
);

try {
  const placeholder = spawnSync(process.execPath, [finalizer, output], {
    cwd: root,
    encoding: 'utf8',
    env: {
      ...process.env,
      EXPO_PUBLIC_WAFRA_SITE_URL: 'https://your-owned-domain.example',
    },
  });
  ok(
    'the production finalizer rejects a reserved placeholder origin',
    placeholder.status === 1 && /not a placeholder/i.test(placeholder.stderr),
    `${placeholder.status}: ${placeholder.stderr.trim()}`,
  );

  const fixtureOrigin = spawnSync(process.execPath, [finalizer, output], {
    cwd: root,
    encoding: 'utf8',
    env: {
      ...process.env,
      // Test-only valid origin. Nothing is deployed or requested from it.
      EXPO_PUBLIC_WAFRA_SITE_URL: 'https://wafra-seo-fixture.dev',
    },
  });
  ok(
    'a non-placeholder HTTPS origin reaches the export validation boundary',
    fixtureOrigin.status === 1 && /No static Expo export found/i.test(fixtureOrigin.stderr),
    `${fixtureOrigin.status}: ${fixtureOrigin.stderr.trim()}`,
  );

  const runtime = '<script src="/_expo/static/js/web/entry-fixture.js" defer></script>';
  fs.writeFileSync(path.join(output, 'index.html'), `<html><body><h1>Wafra</h1>${runtime}</body></html>`);
  fs.writeFileSync(path.join(output, 'robots.txt'), 'User-agent: *\nAllow: /\n');
  fs.writeFileSync(path.join(output, 'settings.html'), `<meta name="robots" content="noindex, nofollow, noarchive">${runtime}`);
  fs.mkdirSync(path.join(output, '(tabs)'));
  fs.writeFileSync(path.join(output, '(tabs)', 'index.html'), 'duplicate');
  const finalize = () => spawnSync(process.execPath, [finalizer, output], {
    // Source documents must resolve relative to the script, not the caller.
    cwd: os.tmpdir(), encoding: 'utf8',
    env: { ...process.env, EXPO_PUBLIC_WAFRA_SITE_URL: 'https://wafra-seo-fixture.dev' },
  });
  const finalized = finalize();
  ok('a valid export finalizes successfully from another working directory', finalized.status === 0, finalized.stderr);
  const read = (file) => fs.existsSync(path.join(output, file)) ? fs.readFileSync(path.join(output, file), 'utf8') : '';
  const routes = ['privacy', 'terms', 'support'];
  for (const route of routes) {
    const html = read(`${route}/index.html`);
    ok(`${route} has a static accessible document and canonical URL`,
      html.includes('<html lang="en">') && (html.match(/<h1(?:\s|>)/g) || []).length === 1 &&
      html.includes(`<link rel="canonical" href="https://wafra-seo-fixture.dev/${route}/">`) &&
      !/<script\b/i.test(html) && routes.every((target) => html.includes(`href="/${target}/"`)));
  }
  const privacy = read('privacy/index.html');
  const terms = read('terms/index.html');
  const support = read('support/index.html');
  ok('wrapped Markdown bullets remain complete list items',
    /<li><strong>Android:<\/strong> bank SMS and optional bank-app notifications are parsed on the device\. They are not sent to Wafra(?:&#39;|')s relay\.<\/li>/.test(privacy));
  ok('numbered capture instructions remain one five-step ordered list',
    /<ol>(?:<li>[\s\S]*?<\/li>){5}<\/ol>/.test(privacy) &&
    /<li>The user chooses <strong>Message<\/strong>[\s\S]*?trigger\.<\/li>/.test(privacy));
  ok('dates, code and source document links render as HTML',
    /<em>Last updated:/.test(privacy) && privacy.includes('<code>READ_SMS</code>') &&
    terms.includes('<a href="/privacy/">Privacy Policy</a>'));
  ok('legal drafts and unresolved governing law remain visible',
    privacy.includes('Launch draft.') && terms.includes('Launch draft') &&
    terms.includes('[[GOVERNING LAW — PUBLISHER/COUNSEL TO CONFIRM]]'));
  ok('terms accurately describe local iPhone capture',
    terms.includes('No Message content is uploaded by this local capture path.') &&
    !terms.includes('the relay transiently receives the selected alert'));
  ok('support uses the existing contact and valid deletion and billing anchors',
    support.includes('mailto:support@nasidaapps.com') &&
    support.includes('/privacy/#your-choices-and-deletion') && privacy.includes('id="your-choices-and-deletion"') &&
    support.includes('/terms/#wafra-pro-trial-and-billing') && terms.includes('id="wafra-pro-trial-and-billing"'));
  const notFound = read('404.html');
  ok('404 has its own noindex document with a home recovery link',
    notFound.includes('That page is not here.') && notFound.includes('noindex, nofollow, noarchive') &&
    notFound.includes('href="/"') && !/<script\b/i.test(notFound));
  ok('only root runtime and duplicate route-group HTML are removed',
    !read('index.html').includes(runtime) && read('settings.html').includes(runtime) &&
    !fs.existsSync(path.join(output, '(tabs)')));
  const sitemap = read('sitemap.xml');
  ok('sitemap contains the public documents and excludes 404 and private routes',
    routes.every((route) => sitemap.includes(`<loc>https://wafra-seo-fixture.dev/${route}/</loc>`)) &&
    !/404|settings/.test(sitemap));
  ok('repeated finalization keeps exactly one sitemap declaration',
    finalize().status === 0 && (read('robots.txt').match(/^Sitemap:/gm) || []).length === 1);

  const renderMarkdown = spawnSync(process.execPath, ['--input-type=module', '-e', `
    import { markdownToHtml } from ${JSON.stringify(require('url').pathToFileURL(path.join(root, 'scripts/public-web-pages.mjs')).href)};
    process.stdout.write(markdownToHtml(process.argv[1]));
  `, '<script>alert("raw")</script>\n\n[Unsafe](javascript:alert)\n\n[Contact](mailto:help@wafra.dev?subject="hello")\n\n**Code: `READ_SMS`**'], {
    cwd: root, encoding: 'utf8',
  });
  ok('Markdown escapes raw HTML and link attributes and never enables unsafe schemes',
    renderMarkdown.status === 0 && renderMarkdown.stdout.includes('&lt;script&gt;') &&
    !renderMarkdown.stdout.includes('href="javascript:') &&
    renderMarkdown.stdout.includes('subject=&quot;hello&quot;') &&
    renderMarkdown.stdout.includes('<strong>Code: <code>READ_SMS</code></strong>'));
} finally {
  fs.rmSync(output, { recursive: true, force: true });
}

console.log(`\nweb-seo: ${pass} passed, ${fail} failed`);
if (fail) process.exit(1);
