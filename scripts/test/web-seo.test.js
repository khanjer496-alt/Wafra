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
  'download buttons use the counted first-party paths and keep a same-origin referrer',
  ['href={DOWNLOAD_PATHS.iphone}', 'href={DOWNLOAD_PATHS.android}'].every((href) => landing.includes(href)) &&
    content.includes("iphone: '/get/iphone'") && content.includes("android: '/get/android'") &&
    !/testflight\.apple\.com|releases\/download/.test(`${landing}\n${content}`) &&
    !landing.includes('rel="noreferrer"'),
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
  fs.mkdirSync(path.join(output, 'card'));
  fs.writeFileSync(path.join(output, 'card', '[id].html'), runtime);
  fs.mkdirSync(path.join(output, '_expo', 'static', 'js', 'web'), { recursive: true });
  fs.writeFileSync(path.join(output, '_expo', 'static', 'js', 'web', 'entry-fixture.js'), 'app();');
  fs.writeFileSync(path.join(output, '_expo', '.routes.json'), '{"redirects":[]}');
  fs.mkdirSync(path.join(output, '_expo', 'static', 'css'), { recursive: true });
  fs.writeFileSync(path.join(output, '_expo', 'static', 'css', 'home.css'), 'h1{color:green}');
  fs.mkdirSync(path.join(output, 'assets', 'merchants'), { recursive: true });
  fs.writeFileSync(path.join(output, 'assets', 'merchants', 'logo.png'), 'png');
  fs.writeFileSync(path.join(output, 'wafra-history-import.shortcut'), 'shortcut');
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
  ok('root runtime and duplicate route-group HTML are removed',
    !read('index.html').includes(runtime) && !fs.existsSync(path.join(output, '(tabs)')));
  ok('app screens, app JavaScript and unreferenced app assets are not published',
    !fs.existsSync(path.join(output, 'settings.html')) && !fs.existsSync(path.join(output, 'card')) &&
    !fs.existsSync(path.join(output, '_expo', 'static', 'js')) && !fs.existsSync(path.join(output, '_expo', '.routes.json')) &&
    !fs.existsSync(path.join(output, 'assets')));
  ok('public pages, stylesheets and hosted files survive app-route removal',
    ['index.html', '404.html', 'privacy/index.html', 'terms/index.html', 'support/index.html',
      '_expo/static/css/home.css', 'wafra-history-import.shortcut', 'robots.txt']
      .every((file) => fs.existsSync(path.join(output, file))));
  ok('static-host fallback redirects send each download path to its destination',
    read('_redirects') === '/get/iphone https://testflight.apple.com/join/jbwzCgZ6 302\n' +
      '/get/android https://github.com/khanjer496-alt/Wafra/releases/download/ledger-light-135-ios-54/Wafra-Ledger-Light-135.apk 302\n');
  const sitemap = read('sitemap.xml');
  ok('sitemap contains the public documents and excludes 404 and private routes',
    routes.every((route) => sitemap.includes(`<loc>https://wafra-seo-fixture.dev/${route}/</loc>`)) &&
    !/404|settings/.test(sitemap));
  ok('repeated finalization keeps exactly one sitemap declaration',
    finalize().status === 0 && (read('robots.txt').match(/^Sitemap:/gm) || []).length === 1);

  fs.mkdirSync(path.join(output, 'assets'));
  fs.writeFileSync(path.join(output, 'assets', 'kept.png'), 'png');
  fs.writeFileSync(path.join(output, '_expo', 'static', 'css', 'home.css'), 'a{background:url(/assets/kept.png)}');
  ok('an assets directory a public stylesheet still uses is kept',
    finalize().status === 0 && fs.existsSync(path.join(output, 'assets', 'kept.png')));

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

const siteEvents = spawnSync(process.execPath, ['--input-type=module', '-e', `
  import { downloadResponse, recordSiteEvent, DOWNLOAD_DESTINATIONS } from
    ${JSON.stringify(require('url').pathToFileURL(path.join(root, 'src/marketing/site-events.mjs')).href)};
  const points = [];
  const env = { SITE_EVENTS: { writeDataPoint: (point) => points.push(point) } };
  const browser = 'Mozilla/5.0 (iPhone; CPU iPhone OS 18_0 like Mac OS X) Safari/604.1';
  const request = (url, headers = {}, method = 'GET') => Object.assign(
    new Request(url, { method, headers: { 'user-agent': browser, 'cf-connecting-ip': '203.0.113.9', ...headers } }),
    { cf: { country: 'AE', city: 'Dubai' } });
  recordSiteEvent(env, request('https://wafra.dev/?utm_source=Instagram%20Bio&email=a@b.c',
    { referer: 'https://www.instagram.com/p/secret-post?igsh=abc' }), 'view', 'home');
  recordSiteEvent(env, request('https://wafra.dev/', { 'user-agent': 'Googlebot/2.1' }), 'view', 'home');
  recordSiteEvent(env, request('https://wafra.dev/', { 'sec-purpose': 'prefetch' }), 'view', 'home');
  recordSiteEvent(env, request('https://wafra.dev/', {}, 'HEAD'), 'view', 'home');
  const click = downloadResponse(env, request('https://wafra.dev/get/android',
    { referer: 'https://wafra.dev/?utm_source=newsletter' }), 'android');
  const unknown = downloadResponse(env, request('https://wafra.dev/get/windows'), 'windows');
  const inherited = downloadResponse(env, request('https://wafra.dev/get/toString'), 'toString');
  let unbound = 'not run';
  try { unbound = downloadResponse({}, request('https://wafra.dev/get/iphone'), 'iphone').status; } catch (error) { unbound = String(error); }
  const broken = downloadResponse({ SITE_EVENTS: { writeDataPoint() { throw new Error('quota'); } } },
    request('https://wafra.dev/get/iphone'), 'iphone');
  process.stdout.write(JSON.stringify({
    points, unbound, unknown, inherited, brokenStatus: broken.status,
    click: { status: click.status, location: click.headers.get('location'), referrer: click.headers.get('referrer-policy'),
      cache: click.headers.get('cache-control') },
    android: DOWNLOAD_DESTINATIONS.android,
  }));
`], { cwd: root, encoding: 'utf8' });
let events = {};
try { events = JSON.parse(siteEvents.stdout); } catch { events = {}; }
ok('site events run', siteEvents.status === 0, siteEvents.stderr);
ok('a landing view records only coarse labels: campaign, referring site and country',
  JSON.stringify(events.points?.[0]) === JSON.stringify({
    indexes: ['view'], blobs: ['view', 'home', 'ae', 'instagram.com', 'instagrambio', 'browser'], doubles: [1],
  }));
ok('automated clients are labelled, and prefetches and HEAD requests are not counted',
  events.points?.length === 3 && events.points[1].blobs[5] === 'automated');
ok('a download click carries the landing campaign and redirects without leaking it',
  JSON.stringify(events.points?.[2]?.blobs) === JSON.stringify(['download', 'android', 'ae', '', 'newsletter', 'browser']) &&
    events.click?.status === 302 && events.click.location === events.android &&
    events.click.referrer === 'no-referrer' && events.click.cache === 'no-store');
ok('no IP address, city, user agent, email or referrer path is written',
  !/203\.0\.113|dubai|mozilla|iphone os|googlebot|a@b|secret-post|igsh/i.test(JSON.stringify(events.points ?? [])));
ok('unknown and inherited platform names fall through to the 404 page',
  events.unknown === null && events.inherited === null);
ok('a missing or failing analytics binding never breaks the download',
  events.unbound === 302 && events.brokenStatus === 302);
ok('Pages Functions route the home page and download paths through site events',
  fs.readFileSync(path.join(root, 'functions/index.js'), 'utf8').includes("recordSiteEvent(context.env, context.request, 'view', 'home')") &&
    fs.readFileSync(path.join(root, 'functions/get/[platform].js'), 'utf8').includes('downloadResponse(env, request, params.platform)'));

const funnel = spawnSync(process.execPath, ['--input-type=module', '-e', `
  import { summarizeFunnel, renderFunnel, funnelQuery } from
    ${JSON.stringify(require('url').pathToFileURL(path.join(root, 'scripts/site-funnel.mjs')).href)};
  const summary = summarizeFunnel([
    { event: 'view', target: 'home', country: 'ae', referrer: 'instagram.com', campaign: 'bio', client: 'browser', hits: '40' },
    { event: 'view', target: 'home', country: 'sa', referrer: '', campaign: '', client: 'browser', hits: 60 },
    { event: 'view', target: 'home', country: 'us', referrer: '', campaign: '', client: 'automated', hits: 500 },
    { event: 'download', target: 'iphone', country: 'ae', referrer: '', campaign: 'bio', client: 'browser', hits: 8 },
    { event: 'download', target: 'android', country: 'sa', referrer: '', campaign: '', client: 'browser', hits: 2 },
  ]);
  process.stdout.write(JSON.stringify({ text: renderFunnel(summary, 30, 17), query: funnelQuery(7) }));
`], { cwd: root, encoding: 'utf8' });
let report = {};
try { report = JSON.parse(funnel.stdout); } catch { report = {}; }
ok('the funnel report excludes automated clients and computes click-through from views',
  funnel.status === 0 && /Landing views\s+100\n/.test(report.text) && /Download clicks\s+10 {2}\(10\.0% of views\)/.test(report.text) &&
    /iPhone\/TestFlight\s+8\n/.test(report.text) && /500 automated requests excluded/.test(report.text) &&
    report.text.includes('Top sources (campaign tag, views + clicks): (none) 62, bio 48') &&
    report.text.includes('Top countries (views): SA 60, AE 40') && report.text.includes('(all time, any source): 17'),
  funnel.stderr || report.text);
ok('the funnel query reads the site events dataset for the requested window',
  /FROM wafra_site_events\nWHERE timestamp > NOW\(\) - INTERVAL '7' DAY/.test(report.query ?? ''));

console.log(`\nweb-seo: ${pass} passed, ${fail} failed`);
if (fail) process.exit(1);
