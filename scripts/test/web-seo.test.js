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
  'product previews disclose sample data and prioritize the home image',
  landing.includes('App previews · sample data') && landing.includes('fetchPriority="high"'),
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
} finally {
  fs.rmSync(output, { recursive: true, force: true });
}

console.log(`\nweb-seo: ${pass} passed, ${fail} failed`);
if (fail) process.exit(1);
