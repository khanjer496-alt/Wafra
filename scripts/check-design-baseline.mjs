#!/usr/bin/env node
/** Build-time provenance guard. Runs without dependencies before either native
 * build. Functional tests still own behaviour; this prevents a different theme
 * or launcher identity from being shipped accidentally on a release branch. */
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { resolve } from 'node:path';
const root = fileURLToPath(new URL('../', import.meta.url));
const read = p => readFileSync(resolve(root, p), 'utf8');
const baseline = JSON.parse(read('config/design-baseline.json'));
assert.equal(baseline.id, 'ledger-and-light');
const theme = read('src/constants/theme.ts');
for (const value of ['#F4F1EA', '#14120F', '#16130F', '#F2EFE8', '#1F6B52', '#A3402D', '#E0836B']) {
  assert.ok(theme.includes(value), `Approved palette value missing: ${value}`);
}
assert.doesNotMatch(theme, /#032521|#062D28|IBMPlex/);
const config = JSON.parse(read('app.json')).expo;
const fonts = config.plugins.find(p => Array.isArray(p) && p[0] === 'expo-font')?.[1]?.fonts;
assert.ok(Array.isArray(fonts), 'Native font registration missing');
for (const family of ['Geist-Regular','Geist-Medium','Geist-SemiBold','GeistMono-Regular','GeistMono-Medium','GeistMono-SemiBold','NotoKufiArabic-Regular','NotoKufiArabic-Bold']) {
  assert.ok(fonts.includes(`./assets/fonts/${family}.ttf`), `Native font missing: ${family}`);
  assert.ok(read('src/components/app-root-layout.tsx').includes(`'${family}'`), `Runtime font missing: ${family}`);
}
assert.ok(!fonts.some(f => f.includes('IBM')), 'Wrong font family');
const mark = read('src/components/wafra-logo.tsx');
assert.deepEqual([...mark.matchAll(/\bd="([^"]+)"/g)].map(m => m[1]),
  ['M8 15 L15.5 33 L23 19 L30.5 33 L40 11.5', 'M34 11.5 H40 V17.5']);
for (const [path, expected] of Object.entries(baseline.assets)) {
  assert.equal(createHash('sha256').update(readFileSync(resolve(root,path))).digest('hex'), expected,
    `Launcher/splash is not the reviewed W-arrow asset: ${path}`);
}
const tabs = read('src/components/tab-bar.tsx');
assert.doesNotMatch(tabs, /withSpring|useSharedValue|entering=/);
assert.match(tabs, /useLanguage/);
assert.match(read('src/components/reference-home-summary.tsx'), /testID="home-spending-total"/);
assert.match(read('src/components/spending/spending-overview.tsx'), /spendingShare/);
assert.match(read('src/components/bills/payment-agenda.tsx'), /groupPaymentKinds/);
console.log(`Approved design: ${baseline.id}; original W-arrow assets, native/runtime fonts and newer tab content verified.`);
