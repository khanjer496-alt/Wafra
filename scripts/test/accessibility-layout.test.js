const fs = require('fs');
const path = require('path');

let pass = 0;
let fail = 0;
const ok = (name, condition) => {
  if (condition) { pass += 1; console.log(`✓ ${name}`); }
  else { fail += 1; console.log(`✗ ${name}`); }
};
const source = (relative) => fs.readFileSync(path.join(__dirname, '../..', relative), 'utf8');

const home = source('src/screens/ledger-home-screen.tsx');
const flow = source('src/app/(tabs)/flow.tsx');
const bills = source('src/app/(tabs)/bills.tsx');
const wallet = source('src/app/(tabs)/wallet.tsx');
const settings = source('src/app/settings.tsx');
const tabBar = source('src/components/tab-bar.tsx');
const billsSegments = source('src/components/bills/bills-segment-control.tsx');
const walletOverview = source('src/components/wallet/balance-overview.tsx');
const settingsFacts = source('src/components/settings/status-facts.tsx');
const navigationE2e = source('scripts/e2e/e2e-navigation.mjs');
const themeTokens = source('src/constants/theme.ts');
const themeHook = source('src/hooks/use-theme.ts');

const hex = (value) => {
  const match = value.match(/^#([0-9a-f]{6})$/i);
  return match ? [0, 2, 4].map((offset) => parseInt(match[1].slice(offset, offset + 2), 16) / 255) : null;
};
const luminance = (value) => {
  const rgb = hex(value);
  if (!rgb) return NaN;
  const linear = rgb.map((channel) => channel <= 0.04045
    ? channel / 12.92
    : ((channel + 0.055) / 1.055) ** 2.4);
  return 0.2126 * linear[0] + 0.7152 * linear[1] + 0.0722 * linear[2];
};
const contrast = (a, b) => {
  const left = luminance(a);
  const right = luminance(b);
  return (Math.max(left, right) + 0.05) / (Math.min(left, right) + 0.05);
};
const tokenValues = (name) => [...themeTokens.matchAll(new RegExp(`${name}: '(#[0-9A-F]{6})'`, 'g'))]
  .map((match) => match[1]);

for (const [name, code] of Object.entries({ Home: home, Flow: flow, Bills: bills, Wallet: wallet, Settings: settings })) {
  ok(`${name} switches layout at accessibility text sizes`,
    /useLargeTextLayout/.test(code) && /largeText/.test(code));
}

ok('Home stacks its hero breakdown for large text', /largeText && styles\.splitLarge/.test(home));
ok('Flow stacks the summary rail for large text', /largeText && styles\.summaryRailLarge/.test(flow));
ok('Bills reflows its header and segments for large text',
  /largeText && styles\.headerLarge/.test(bills) && /largeText && styles\.segmentLarge/.test(billsSegments));
ok('Wallet collapses overview facts to a vertical list',
  /largeText && styles\.snapshotGridLarge/.test(walletOverview));
ok('Settings replaces status tiles with full-width rows',
  /largeText && styles\.gridLarge/.test(settingsFacts));
ok('Bills uses the shared accessible sheet contract',
  /<BottomSheet/.test(bills) && !/<Modal/.test(bills) && /accessibilityLabel=\{t\('reminderName/.test(bills));
ok('Wallet uses shared sheets and selected choice semantics',
  /<BottomSheet/.test(wallet) && !/<Modal/.test(wallet) &&
    /accessibilityRole="radio"/.test(wallet) && /accessibilityState=\{\{ selected:/.test(wallet));
ok('the primary tab bar exposes tab-list and explicit web selected semantics',
  /role="tablist"/.test(tabBar) && /aria-selected=\{focused\}/.test(tabBar) &&
    /maxFontSizeMultiplier=\{1\.3\}/.test(tabBar));
ok('navigation E2E activates animated tabs through a hit-tested point',
  /const tapTab[\s\S]{0,800}tapKey\(page, name/.test(navigationE2e) &&
    !/const tapTab[\s\S]{0,300}getByRole\('tab',[\s\S]{0,120}\.click/.test(navigationE2e));
ok('navigation E2E waits for the tab selected state instead of animation stability',
  /const tapTab[\s\S]{0,1200}aria-selected/.test(navigationE2e) &&
    /const tapTab[\s\S]{0,1800}elementFromPoint/.test(navigationE2e));
const controlBorders = tokenValues('controlBorder');
const elementBackgrounds = tokenValues('backgroundElement');
ok('light and dark control borders meet the 3:1 non-text contrast floor',
  controlBorders.length === 2 && elementBackgrounds.length === 2 &&
    controlBorders.every((color, index) => contrast(color, elementBackgrounds[index]) >= 3));
ok('the theme responds to native and web increased-contrast preferences',
  /useIncreasedContrast/.test(themeHook) && /controlBorderHigh/.test(themeHook));
ok('selected tabs and representative interactive boundaries use the control contrast token',
  /borderColor: theme\.controlBorder/.test(billsSegments) &&
    (walletOverview.match(/borderColor: theme\.controlBorder/g) ?? []).length >= 3 &&
    /transferChoice[\s\S]{0,100}theme\.controlBorder/.test(source('src/app/add-transaction.tsx')));

console.log(`\naccessibility-layout: ${pass} passed, ${fail} failed`);
if (fail) process.exit(1);
