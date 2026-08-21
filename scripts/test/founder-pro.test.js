const fs = require('node:fs');
const path = require('node:path');

const {
  EMPTY_FOUNDER_TAP_SEQUENCE,
  FOUNDER_TAP_WINDOW_MS,
  recordFounderTap,
} = require('./build/founder-pro.js');

let pass = 0;
let fail = 0;
const ok = (name, condition, detail = '') => {
  if (condition) {
    pass += 1;
    console.log(`✓ ${name}`);
  } else {
    fail += 1;
    console.log(`✗ ${name}${detail ? ` — ${detail}` : ''}`);
  }
};

let sequence = EMPTY_FOUNDER_TAP_SEQUENCE;
for (let tap = 0; tap < 4; tap += 1) {
  const result = recordFounderTap(sequence, 1_000 + tap * 300);
  sequence = result.next;
  ok(`tap ${tap + 1} does not unlock`, result.unlocked === false);
}
const fifth = recordFounderTap(sequence, 2_200);
ok('the fifth consecutive tap unlocks and resets the sequence',
  fifth.unlocked === true && fifth.next.count === 0 && fifth.next.lastTapMs === 0);

const first = recordFounderTap(EMPTY_FOUNDER_TAP_SEQUENCE, 10_000);
const expired = recordFounderTap(first.next, 10_000 + FOUNDER_TAP_WINDOW_MS + 1);
ok('a slow tap restarts the sequence',
  expired.unlocked === false && expired.next.count === 1);
ok('a clock moving backwards restarts the sequence',
  recordFounderTap({ count: 4, lastTapMs: 20_000 }, 19_999).next.count === 1);

const root = path.join(__dirname, '../..');
const read = (relative) => fs.readFileSync(path.join(root, relative), 'utf8');
const eas = JSON.parse(read('eas.json'));
const settings = read('src/app/settings.tsx');
const store = read('src/lib/store.tsx');
const purchases = read('src/lib/purchases.ts');

ok('founder unlock is enabled in both distributed test profiles and closed in production',
  eas.build['capture-beta'].env.EXPO_PUBLIC_WAFRA_FOUNDER_UNLOCK === '1' &&
    eas.build['corpus-preview'].env.EXPO_PUBLIC_WAFRA_FOUNDER_UNLOCK === '1' &&
    eas.build.production.env.EXPO_PUBLIC_WAFRA_FOUNDER_UNLOCK === '0');
ok('only the Wafra logo in an enabled native test build advances the gesture',
  /Platform\.OS !== 'web' && isFounderUnlockBuild\(\)/.test(settings) &&
    /<Pressable[\s\S]{0,260}onFounderLogoTap\(\)[\s\S]{0,180}<WafraMark/.test(settings));
ok('Settings grants the dedicated founder entitlement instead of forging store Pro',
  /await unlockFounderPro\(\)/.test(settings) && !/setPro\(/.test(settings));
ok('the founder grant is durable, excluded from backups, and preserved by ledger erase',
  /case 'unlockFounderPro':[\s\S]{0,100}founderPro: true/.test(store) &&
    /founderPro: _founderPro/.test(store) &&
    /founderPro: state\.founderPro/.test(store) &&
    /case 'clearAll':[\s\S]{0,500}founderPro: state\.founderPro/.test(store));
ok('RevenueCat status cannot revoke founder access',
  /state\.pro \|\| state\.founderPro === true \|\|/.test(purchases));

console.log(`\nfounder-pro: ${pass} passed, ${fail} failed`);
if (fail) process.exit(1);
