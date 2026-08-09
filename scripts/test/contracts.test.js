/**
 * Definitions that live in two places and must agree.
 *
 * The bug that keeps shipping in this app has one shape: two things that have
 * to match, with nothing checking that they do. A route name and a route
 * file. A healing rule in the store and the same rule in heal.ts. Three
 * capture channels and one fingerprint. Each was in sync when it was written
 * and each drifted silently, because the compiler cannot see across the gap
 * between a string and the thing it names.
 *
 * Every pair below is IN SYNC right now. That is exactly why they belong
 * here: this is the file that notices the day one of them stops being.
 */
const fs = require('fs');
const path = require('path');

let pass = 0;
let fail = 0;
function ok(name, cond, detail) {
  if (cond) {
    pass += 1;
    console.log(`✓ ${name}`);
  } else {
    fail += 1;
    console.log(`✗ ${name}${detail ? ` — ${detail}` : ''}`);
  }
}

const ROOT = path.join(__dirname, '../..');
const read = (p) => fs.readFileSync(path.join(ROOT, p), 'utf8');
/**
 * Source with its comments removed.
 *
 * For the assertions below that mean "this identifier is not USED here". A
 * regex over raw source cannot tell a call from the sentence explaining why
 * there is no call, so an accurate comment turns those assertions red — which
 * has already happened once in this file, and the fix that suggests itself is
 * to delete the comment.
 */
const code = (s) => s.replace(/\/\*[\s\S]*?\*\//g, '').replace(/^[ \t]*\/\/.*$/gm, '');
const quoted = (s) => [...s.matchAll(/'([^']+)'/g)].map((m) => m[1]);

/* ── Icons: a name in the type, a shape on the screen ─────────────────── */
//
// Icons render through `{name === 'x' && <Path .../>}`. A name in the union
// with no branch is not an error — it draws an empty 24x24 box. A category
// with a missing glyph would just look like a gap in the list.
{
  const src = read('src/components/ui/icon.tsx');
  const declared = quoted(src.match(/export type IconName =([\s\S]*?);/)[1]);
  const drawn = new Set([...src.matchAll(/name === '([^']+)'/g)].map((m) => m[1]));
  const undrawn = declared.filter((n) => !drawn.has(n));
  const undeclared = [...drawn].filter((n) => !declared.includes(n));
  ok('every icon name has a shape', undrawn.length === 0, undrawn.join(' | '));
  ok('every icon shape has a name', undeclared.length === 0, undeclared.join(' | '));
}

/* ── Categories: the type, the table, and the glyph each one asks for ── */
{
  const declared = quoted(read('src/lib/types.ts').match(/export type CategoryId =([\s\S]*?);/)[1]);
  const table = read('src/lib/categories.ts');
  const rows = [...table.matchAll(/\{ id: '([^']+)'[^}]*icon: '([^']+)'/g)];
  const listed = rows.map((r) => r[1]);
  const missing = declared.filter((c) => !listed.includes(c));
  const extra = listed.filter((c) => !declared.includes(c));
  ok('every category has a label and an icon', missing.length === 0, missing.join(' | '));
  ok('every category row is a real category', extra.length === 0, extra.join(' | '));

  const iconSrc = read('src/components/ui/icon.tsx');
  const icons = new Set(quoted(iconSrc.match(/export type IconName =([\s\S]*?);/)[1]));
  const noGlyph = rows.filter((r) => !icons.has(r[2])).map((r) => `${r[0].slice(0, 20)}→${r[2]}`);
  ok('every category icon exists', noGlyph.length === 0, noGlyph.join(' | '));
}

/* ── Translations: both languages, and nothing looked up that is absent ─ */
{
  const i18n = read('src/lib/i18n.ts');
  const entries = [...i18n.matchAll(/^ {2}([a-zA-Z0-9_]+): \{([\s\S]*?)\},?$/gm)];
  ok('the string table was read', entries.length > 50, `${entries.length}`);

  const noAr = entries.filter((e) => !/\bar:/.test(e[2])).map((e) => e[1]);
  const noEn = entries.filter((e) => !/\ben:/.test(e[2])).map((e) => e[1]);
  ok('every string has Arabic', noAr.length === 0, noAr.slice(0, 5).join(' | '));
  ok('every string has English', noEn.length === 0, noEn.slice(0, 5).join(' | '));

  // t('x') resolves at runtime — a typo is a blank label, not a build error.
  //
  // tf() is checked by the same rule and for the same reason. It was left out
  // of the first version of this scan, which meant the sentences carrying a
  // NUMBER — the ones assembled from fragments, the exact case tf() exists to
  // fix — were the only ones a typo could slip through.
  const defined = new Set(entries.map((e) => e[1]));
  const used = new Set();
  for (const file of sources('src')) {
    const src = fs.readFileSync(file, 'utf8');
    for (const m of src.matchAll(/\bt\('([a-zA-Z0-9_]+)'/g)) used.add(m[1]);
    for (const m of src.matchAll(/\btf\('([a-zA-Z0-9_]+)'/g)) used.add(m[1]);
  }
  const missing = [...used].filter((k) => !defined.has(k));
  ok('every string the app asks for exists', missing.length === 0, missing.join(' | '));
}

/* ── The Kotlin banner's strings ──────────────────────────────────────── */
//
// These cannot come from the app's own table: the code that needs them runs
// in a broadcast receiver with no JavaScript engine. So they are a second
// string table, kept in step by hand — which is precisely the situation this
// file exists for. A missing key is a build failure on Android and a missing
// Arabic key is an English banner for an Arabic user.
{
  const names = (p) => [...read(p).matchAll(/name="([^"]+)"/g)].map((m) => m[1]);
  const base = 'modules/sms-reader/android/src/main/res';
  const en = names(`${base}/values/strings.xml`);
  const ar = names(`${base}/values-ar/strings.xml`);
  ok('the banner has strings', en.length > 0);
  ok('every banner string is translated', en.every((k) => ar.includes(k)),
    en.filter((k) => !ar.includes(k)).join(' | '));
  ok('no orphan Arabic banner string', ar.every((k) => en.includes(k)),
    ar.filter((k) => !en.includes(k)).join(' | '));

  const kt = read('modules/sms-reader/android/src/main/java/expo/modules/smsreader/InstantAlert.kt');
  const used = [...new Set([...kt.matchAll(/R\.string\.([a-z_]+)/g)].map((m) => m[1]))];
  const missing = used.filter((k) => !en.includes(k));
  ok('every string the banner asks for is defined', missing.length === 0, missing.join(' | '));
}

/* ── The native modules: what Kotlin exposes vs what TypeScript expects ─ */
//
// requireOptionalNativeModule returns undefined rather than throwing, and the
// interface is a promise TypeScript takes on trust. A renamed Kotlin function
// is a silently missing feature, not a crash — which is how the SMS capture
// buffer could have quietly stopped draining with nothing to show for it.
{
  for (const [dir, moduleName] of [['sms-reader', 'SmsReader'], ['notification-reader', 'NotificationReader']]) {
    const kt = ktSources(`modules/${dir}/android/src/main/java`);
    const declaredName = kt.match(/Name\("([^"]+)"\)/)?.[1];
    const exposed = new Set([...kt.matchAll(/(?:Async)?Function\("([a-zA-Z]+)"/g)].map((m) => m[1]));
    const ts = read(`modules/${dir}/index.ts`);
    const jsName = ts.match(/requireOptionalNativeModule<[^>]+>\('([^']+)'\)/)?.[1];
    const expects = [...ts.matchAll(/^ {2}([a-zA-Z]+)\??\(/gm)].map((m) => m[1]);
    const absent = expects.filter((f) => !exposed.has(f));
    ok(`${dir}: the module name matches`, declaredName === moduleName && jsName === moduleName,
      `kotlin=${declaredName} js=${jsName}`);
    ok(`${dir}: every function TypeScript calls exists in Kotlin`, absent.length === 0, absent.join(' | '));
  }
}

/* ── One definition of spending ───────────────────────────────────────── */
//
// This was written at least four ways across six files, and one of them left
// out the type check entirely. They agreed by luck. Now they agree because
// there is only one of them, and this is what says so.
{
  const offenders = [];
  for (const file of sources('src')) {
    const rel = path.relative(ROOT, file);
    if (rel.includes('lib/ledger.ts') || rel.includes('lib/heal.ts')) continue;
    // The importer builds rows rather than totalling them, and the card
    // sheets deliberately look for the inbound leg of a transfer.
    if (rel.includes('auto-import.ts') || rel.includes('lib/cards.ts')) continue;
    const text = fs.readFileSync(file, 'utf8');
    for (const m of text.matchAll(/type !== 'expense' \|\| \w+\.isTransfer/g)) {
      offenders.push(`${rel}: ${m[0]}`);
    }
  }
  ok('nothing re-defines spending by hand', offenders.length === 0, offenders.join(' | '));

  const ledger = read('src/lib/ledger.ts');
  for (const fn of ['isSpending', 'isIncome', 'liveAccountIds', 'isInboundTransfer']) {
    ok(`ledger exports ${fn}`, ledger.includes(`export function ${fn}`));
  }

  // Running totals of money are the other half of the same rule.
  //
  // Two of them added income by hand — net worth over time, and net worth on
  // a date — and both skipped only the FLAGGED side of a transfer. The bank
  // words the arriving side like ordinary income, so it carries no flag, and
  // moving your own money between your own accounts raised your net worth by
  // the amount you moved. Any new running total has to consult
  // internalTransferIds too, or it will make the same money out of nothing.
  const totalling = [];
  for (const file of sources('src')) {
    const rel = path.relative(ROOT, file);
    if (rel.includes('lib/ledger.ts')) continue;
    // An account BALANCE is the one place both legs genuinely belong: money
    // really did leave one account and arrive in the other.
    if (rel.includes('lib/balances.ts')) continue;
    const text = fs.readFileSync(file, 'utf8');
    // Two shapes, because only the first was being looked for and the
    // Transactions screen used the second — so its header, its day headings
    // and its "transfers not counted" line all added up an own-account move
    // as income while a test said every total was safe.
    const shapes = [
      /[+-]?=\s*\w+\.type === 'income' \?/g,
      /\w+\.type === 'expense' \? -\w+\.amountFils : \w+\.amountFils/g,
    ];
    for (const m of shapes.flatMap((re) => [...text.matchAll(re)])) {
      const near = text.slice(Math.max(0, text.indexOf(m[0]) - 600), text.indexOf(m[0]));
      if (!/internalTransferIds|internal\.has/.test(near)) totalling.push(`${rel}: ${m[0].trim()}`);
    }
  }
  ok('every running money total knows about internal transfers',
    totalling.length === 0, totalling.join(' | '));
}

function sources(dir) {
  const out = [];
  for (const entry of fs.readdirSync(path.join(ROOT, dir), { withFileTypes: true })) {
    const full = path.join(ROOT, dir, entry.name);
    if (entry.isDirectory()) out.push(...sources(path.join(dir, entry.name)));
    else if (/\.tsx?$/.test(entry.name)) out.push(full);
  }
  return out;
}

function ktSources(dir) {
  let text = '';
  for (const entry of fs.readdirSync(path.join(ROOT, dir), { withFileTypes: true })) {
    if (entry.isDirectory()) text += ktSources(path.join(dir, entry.name));
    else if (entry.name.endsWith('.kt')) text += fs.readFileSync(path.join(ROOT, dir, entry.name), 'utf8');
  }
  return text;
}


/* ── the paywall ──────────────────────────────────────────────────────
 *
 * The screen that sells the product, so its mistakes are the expensive kind.
 * All three of these were live: a sentence assembled from English fragments
 * that stayed English in Arabic, a discount claim that disagreed with the
 * prices beside it, and a single long-press on the icon that granted Pro for
 * free — on the paywall itself. */
{
  const pro = fs.readFileSync(path.join(ROOT, 'src/app/pro.tsx'), 'utf8');

  ok('the paywall gives away no free unlock',
    !/onLongPress/.test(pro) && !/setPro\(next\)/.test(pro));

  // Seven taps on the Settings version row stays — deliberate, unreachable
  // by accident, and the only unlock the code documents.
  const settings = fs.readFileSync(path.join(ROOT, 'src/app/settings.tsx'), 'utf8');
  ok('the deliberate founder unlock still exists', /tapCount\.current >= 7/.test(settings));

  // No English sentence built inline: every user-visible string goes through
  // t() or tf(), so Arabic gets Arabic.
  const inlineSentence = /[`'"][A-Z][a-z]+ [a-z]+ [a-z]+ [a-z]+[^`'"]*[`'"]/g;
  const suspects = (pro.match(inlineSentence) || []).filter(
    (m) => !/accessibilityLabel|Alert\.alert|^['"`]Wafra/.test(m),
  );
  ok('the paywall builds no English sentence inline', suspects.length === 0, suspects.slice(0, 3));

  const { PRO_PRICES, yearlySavingMonths } = require('./build/purchases');
  const months = yearlySavingMonths();
  const saved = PRO_PRICES.monthly.fils * 12 - PRO_PRICES.yearly.fils;
  ok('the yearly saving is derived from the prices, not written down',
    months === Math.floor(saved / PRO_PRICES.monthly.fils) && months > 0,
    { months, saved });
  ok('no hard-coded month count survives in the copy',
    !/\d+ months free/.test(fs.readFileSync(path.join(ROOT, 'src/lib/i18n.ts'), 'utf8')));
}


/* ── every user-visible sentence is translated ────────────────────────
 *
 * The app auto-switches to Arabic on Arabic devices and flips to RTL, and
 * Settings was still answering in English — while several of the strings it
 * hardcoded already HAD translations sitting two lines apart in i18n.ts,
 * unused. This counts English sentences written straight into a screen. */
{
  const stray = [];
  for (const file of sources('src/app').concat(sources('src/components'))) {
    const rel = path.relative(ROOT, file);
    const text = fs.readFileSync(file, 'utf8');
    let inComment = false;
    for (const line of text.split('\n')) {
      // Prose inside a block comment is prose ABOUT the code, not copy. Only
      // the opening line starts with a slash, so the state has to be tracked.
      if (/\/\*/.test(line)) inComment = true;
      const wasComment = inComment;
      if (/\*\//.test(line)) inComment = false;
      if (wasComment) continue;
      // Comments, imports, styles and accessibility labels are not copy.
      if (/^\s*(\/\/|\*|import|export type)/.test(line)) continue;
      if (/accessibilityLabel|testID|placeholder=\{`|fontFamily|require\(/.test(line)) continue;
      // Three or more words starting with a capital, in a quoted literal...
      const quoted = line.match(/['"`][A-Z][a-z]+(?: [a-z]+){2,}[^'"`]*['"`]/);
      if (quoted && !/\bt\(|\btf\(/.test(line)) stray.push(`${rel}: ${quoted[0].slice(0, 52)}`);
      // ...and the same thing written straight into JSX as a text child,
      // which is how the onboarding copy escaped the first version of this
      // check — the screen a new user reads before any other.
      const child = line.match(/^\s{6,}[A-Z][a-z]+(?: [a-z,]+){3,}[.,]?\s*$/);
      if (child && !/\bt\(|\btf\(|^\s*[/*]/.test(line)) {
        stray.push(`${rel}: ${line.trim().slice(0, 52)}`);
      }
    }
  }
  ok('no screen writes an English sentence of its own', stray.length === 0,
    stray.slice(0, 6));
}


/* ── no translated string is frozen at import time ────────────────────
 *
 * t() reads a module-level `lang` that is set during hydrate. A t() call
 * evaluated while the file is being IMPORTED therefore runs before the
 * language is known, keeps the default forever, and never re-renders — the
 * onboarding bullet points were a module-level array doing exactly this, so
 * an Arabic phone was greeted in English on the first screen a user sees. */
{
  const frozen = [];
  for (const file of sources('src')) {
    const rel = path.relative(ROOT, file);
    if (rel.includes('lib/i18n.ts')) continue;
    let depth = 0;
    let inComment = false;
    for (const line of fs.readFileSync(file, 'utf8').split('\n')) {
      if (/\/\*/.test(line)) inComment = true;
      const wasComment = inComment;
      if (/\*\//.test(line)) inComment = false;
      const code = line.replace(/\/\/.*$/, '');
      if (!wasComment && depth === 0 && /\bt\(|\btf\(/.test(code)) {
        frozen.push(`${rel}: ${line.trim().slice(0, 46)}`);
      }
      depth += (code.match(/[{([]/g) || []).length - (code.match(/[})\]]/g) || []).length;
      if (depth < 0) depth = 0;
    }
  }
  ok('no translated string is evaluated at import time', frozen.length === 0,
    frozen.slice(0, 4));
}


/* ── billing ──────────────────────────────────────────────────────────
 *
 * Nothing here can exercise the store SDK, so these check the things that
 * are wrong in the SOURCE rather than at runtime — which is where the
 * expensive mistakes in a billing file live. */
{
  const src = read('src/lib/purchases.ts');
  const sdk = read('src/lib/billing.ts');
  const home = read('src/hooks/use-auto-import.ts');

  // The entitlement id is a string shared with a dashboard nobody can grep.
  ok('the entitlement id is named once and exported',
    /export const ENTITLEMENT_ID = 'pro'/.test(src) &&
      (src.match(/'pro'/g) || []).length === 1);

  // Entitlement has to be asked for at launch. Without it `pro` is a local
  // boolean that survives a lapsed subscription, a refund and a cancellation.
  ok('entitlement is re-checked on launch', /refreshEntitlement\(\)/.test(home));

  // ...and the answer has three states, not two. Treating "could not reach
  // the store" as "has not paid" locks a paying customer out of their own
  // ledger the first time they open the app on a plane.
  ok('a null entitlement leaves the cached flag alone',
    /entitled !== null/.test(home));
  ok('refreshEntitlement can return null', /Promise<boolean \| null>/.test(sdk));

  // A secret key in the client is a real incident. Only the public SDK key
  // belongs in app.json, and only ever empty in the repository.
  const appJson = JSON.parse(read('app.json'));
  const extra = appJson.expo.extra || {};
  for (const k of ['revenueCatAndroidKey', 'revenueCatIosKey']) {
    ok(`${k} ships empty`, extra[k] === '');
  }
  ok('no secret RevenueCat key is committed',
    !/sk_[A-Za-z0-9]{10}/.test(read('app.json') + src + sdk));

  // Billing must be impossible rather than broken when unconfigured, or the
  // paywall opens a flow that cannot complete.
  ok('billing is unavailable without a key', /apiKey\(\) !== null/.test(sdk));
  ok('billing is unavailable on web', /Platform\.OS !== 'web'/.test(sdk));

  // The prices and the SKUs are what Play Console has to match.
  const { PRO_SKUS, PRO_PRICES } = require('./build/purchases');
  ok('both plans have a product id and a price',
    Object.keys(PRO_SKUS).every((k) => PRO_SKUS[k] && PRO_PRICES[k]?.fils > 0),
    { PRO_SKUS, PRO_PRICES });
  ok('the setup doc names the same product ids',
    Object.values(PRO_SKUS).every((sku) => read('docs/billing.md').includes(sku)));
}

/* ── private ledger persistence ───────────────────────────────────────
 *
 * A finance app can look private while quietly storing its whole ledger in
 * plaintext. These source/config contracts keep the native persistence path,
 * migration order and native build configuration aligned. Runtime encryption
 * is verified again in native build QA with PRAGMA cipher_version. */
{
  const config = JSON.parse(read('app.json')).expo;
  const sqlite = config.plugins.find(
    (plugin) => Array.isArray(plugin) && plugin[0] === 'expo-sqlite',
  );
  ok('native SQLite is built with SQLCipher', sqlite?.[1]?.useSQLCipher === true);
  ok('Android does not cloud-backup the encrypted database', config.android?.allowBackup === false);

  const storage = read('src/lib/state-storage.native.ts');
  const store = read('src/lib/store.tsx');
  ok('the database key is generated on-device and kept device-only',
    /getRandomBytesAsync\(32\)/.test(storage) &&
      /WHEN_UNLOCKED_THIS_DEVICE_ONLY/.test(storage));
  ok('SQLCipher receives its key before the ledger table is touched',
    storage.indexOf('PRAGMA key') < storage.indexOf('CREATE TABLE'));
  ok('the active store persists through the encrypted adapter',
    /stateStorage\.multiSet/.test(store) &&
      /stateStorage\.multiGet/.test(store) &&
      !/AsyncStorage\./.test(store));
  ok('plaintext legacy data is removed only after encrypted migration succeeds',
    storage.indexOf('await encryptedStorage.multiSet(present)') <
      storage.indexOf('await AsyncStorage.multiRemove(keys)'));
}

/* ── Private Mode is a data path, not a label ───────────────────────── */
{
  const types = read('src/lib/types.ts');
  const store = read('src/lib/store.tsx');
  const capture = read('src/lib/capture.ts');
  const settings = read('src/app/settings.tsx');
  const copy = read('src/lib/i18n.ts');

  ok('Private Mode is persisted as part of app state', /privateMode: boolean/.test(types));
  ok('Private Mode strips retained and newly imported raw text',
    /transactions: action\.enabled[\s\S]*raw: _discard/.test(store) &&
      /const base = authoritativeState\.current[\s\S]*raw: base\.privateMode \? undefined : t\.raw/.test(store));
  ok('Private Mode stops the iOS relay but leaves Android capture first',
    capture.indexOf('if (isSmsScanningAvailable())') <
      capture.indexOf('if (state.privateMode) return EMPTY') &&
      capture.indexOf('if (state.privateMode) return EMPTY') <
      capture.indexOf('if (isRelayPlatform())'));
  ok('enabling Private Mode disconnects an existing iOS relay first',
    settings.indexOf('await unpairDevice(relay)') <
      settings.indexOf('setPrivateMode(true)'));
  ok('privacy copy names both platform paths and raw-body retention',
    /Android alerts are parsed on-device/.test(copy) &&
      /Shortcut sends selected bank alerts/.test(copy) &&
      /deletes the raw text immediately/.test(copy));
}

/* ── relay acknowledgement follows encrypted durability ─────────────── */
{
  const store = read('src/lib/store.tsx');
  const home = read('src/hooks/use-auto-import.ts');
  const setup = read('src/app/ios-setup.tsx');
  const homeDurableAt = home.indexOf('await receipt.durable');
  const setupDurableAt = setup.indexOf('await durable');
  ok('an import exposes an encrypted-write durability promise',
    /interface ImportReceipt[\s\S]*durable: Promise<void>/.test(store) &&
      /const next = dispatch\(action\)/.test(store) &&
      /persist\(next\)/.test(store));
  ok('routine relay sync waits for SQLCipher before commit',
    homeDurableAt > home.indexOf('importBatch(plan.batch)') &&
      home.indexOf('await commit()', homeDurableAt) > homeDurableAt);
  ok('setup test waits for SQLCipher before acknowledging',
    setupDurableAt > setup.indexOf('importBatch(plan.batch).durable') &&
      setup.indexOf('await ackRelay(active, ids)', setupDurableAt) > setupDurableAt);
}

/* ── iOS relay wakes the app without carrying financial data ───────── */
{
  const config = JSON.parse(read('app.json')).expo;
  const notifications = config.plugins.find(
    (plugin) => Array.isArray(plugin) && plugin[0] === 'expo-notifications',
  );
  const background = read('src/lib/background-relay.ts');
  const relay = read('src/lib/relay.ts');
  const home = read('src/hooks/use-auto-import.ts');
  const onboarding = read('src/components/onboarding-gate.tsx');
  const layout = read('src/app/_layout.tsx');
  const worker = read('server/src/push.ts');
  const wake = worker.match(/function wakePayload[\s\S]*?return \{([\s\S]*?)\n  \};/)?.[1] || '';

  ok('iOS build enables background remote notifications',
    notifications?.[1]?.enableBackgroundRemoteNotifications === true);
  ok('the notification task is defined at module scope and loaded early',
    /TaskManager\.defineTask/.test(background) &&
      /import '@\/lib\/background-relay'/.test(layout));
  ok('the wake contains no financial or visible notification fields',
    /kind: 'wafra\.sync'/.test(wake) &&
      /_contentAvailable: true/.test(wake) &&
      !/\btitle:|\bbody:|merchant|amountFils/.test(wake));
  ok('Android notification permission is never requested on cold launch',
    !/requestNotificationPermission/.test(home) &&
      !/requestNotificationPermission/.test(onboarding));
  ok('headless sync writes SQLCipher before relay acknowledgement',
    background.indexOf('await appendDurable(parsed)') <
      background.indexOf('await ackRelay(cfg, acknowledge)'));
  ok('background sync reserves setup proof markers for the foreground verifier',
    /const reserved = new Set\(testIds\)/.test(background) &&
      /ids\.filter\(\(id\) => !reserved\.has\(id\)\)/.test(background));
  ok('only a parsed Shortcut headless delivery records automation proof',
    background.indexOf('await appendDurable(parsed)') <
      background.indexOf('await recordRelayAutomationProof()') &&
      /parsed\.some\(\(row\) => row\.captureSource === 'shortcut'\)/.test(background));
  ok('email and PDF headless delivery cannot impersonate the Message automation',
    /captureSource === 'shortcut'/.test(background) &&
      !/captureSource === 'email'[^}]*recordRelayAutomationProof/s.test(background) &&
      !/captureSource === 'pdf'[^}]*recordRelayAutomationProof/s.test(background));
  ok('a synthetic relay probe cannot make Home claim automation is active',
    /AUTOMATION_PROOF_KEY/.test(relay) &&
      /cfg\?\.setupState === 'verified' && automationProof/.test(home) &&
      /\? 'active'[\s\S]*\? 'pipe-ready'/.test(home));
  ok('locked background credentials use the sync-only bearer',
    /BackgroundRelayConfig = Pick<[\s\S]*'syncToken'[\s\S]*>;/.test(read('src/lib/relay.ts')) &&
      !/BackgroundRelayConfig = Pick<[\s\S]*'adminToken'[\s\S]*>;/.test(read('src/lib/relay.ts')));
  ok('the durable local inbox is cleared only by the UI import commit',
    /commit: async \(\) => \{[\s\S]*clearStagedRows\(staged\.snapshot\)/.test(
      read('src/lib/capture.ts')));
}

/* ── a revoked device is told, not shown a status that is false ──────── */
//
// The vault owner removes this phone from another device. Nothing tells this
// phone: the relay deletes the row that authenticates it and the only symptom
// is a 401 on the next /v1/sync. relay.ts threw a non-retryable error for it
// and NOTHING consumed that error, so the Keychain kept a 'verified' config
// and its automation-proof marker, Home went on printing "Shortcut connected ·
// syncing silently" over a pipe that answered 401 to everything, and there was
// no route back to pairing from inside the app. Each assertion below is one
// link in that chain.
{
  const relay = read('src/lib/relay.ts');
  const hook = read('src/hooks/use-auto-import.ts');
  const capture = read('src/lib/capture.ts');
  const home = read('src/app/(tabs)/index.tsx');

  ok('a 401 from sync records the refusal rather than only throwing',
    /res\.status === 401/.test(relay) && /markRelayRevoked\(cfg\.syncToken\)/.test(relay));
  // Stamped, not erased. A 401 is also what a captive portal or an
  // authenticating proxy answers, and the X25519 private key is the only thing
  // that can open a row still sealed in the queue while the admin token is the
  // only thing that can delete this device server-side. Neither survives being
  // destroyed on a guess.
  ok('the refusal is a marker, never a deletion of the keys it would need back',
    !/res\.status === 401[\s\S]{0,600}deleteRelayCredentials\(\)/.test(relay) &&
      /revokedAt: at/.test(relay));
  // Both keychain items, or the headless wake goes on re-authenticating
  // against a device the relay has already deleted, on every push, forever.
  ok('a stamped credential reads as "no pairing" on both keychain surfaces',
    (relay.match(/if \(revokedAt\(cfg\) !== null\) return null;/g) || []).length === 2);
  ok('the capture surface has a state for it, ahead of the automation proof',
    /\| 'revoked'/.test(hook) &&
      /revokedAt\s*\?\s*'revoked'/.test(hook) &&
      hook.indexOf("? 'revoked'") < hook.indexOf("? 'active'"));
  ok('and Home renders that state instead of falling through to "off"',
    /status === 'revoked'/.test(home) && /captureIosRevoked/.test(home));
  // A revocation discovered by the scan itself is the same outcome one tick
  // later, and it must not surface as an exception on an interactive refresh.
  // Every other sync failure still has to propagate: swallowing an offline
  // sync into "you are not set up" walks a working user into the wizard.
  ok('a revocation found mid-scan degrades to needs-setup rather than throwing',
    /isRelayRevokedError\(error\)/.test(capture) && /throw error;/.test(capture));
}

/* ── only the setup screen may acknowledge a setup probe ─────────────── */
//
// syncRelay() reports a probe's queue id in BOTH `ids` and `testIds`. It does
// have to be acknowledged eventually — but only by /ios-setup, which is the
// screen polling for it. Any other collector that acks the whole `ids` array
// eats the proof, and because Home mounts useAutoImport(true) UNDERNEATH the
// setup flow, that is not an unlucky interleaving, it is the ordinary one: the
// user leaves Wafra to run the Shortcut, comes back, the AppState 'active'
// scan fires, and step 3 times out on a phone that is configured correctly.
// The "Try again" it offers resends a byte-identical probe, which the relay's
// replay receipt suppresses AND whose expiry every retry refreshes, so the
// remedy extends the outage.
//
// background-relay.ts got this right on its own; capture.ts and
// supplement-imports.tsx did not, and neither failed any test. This is the
// assertion that stops the fourth collector from repeating it.
{
  const collectors = [
    ['src/lib/background-relay.ts', 'the headless push wake'],
    ['src/lib/capture.ts', 'the foreground Home and pull-to-refresh scan'],
    ['src/components/supplement-imports.tsx', 'the PDF and forwarded-email sync'],
  ];
  for (const [file, what] of collectors) {
    const src = read(file);
    ok(`${what} reserves setup probe ids rather than acking them`,
      /new Set\((?:queued\.)?testIds\)/.test(src) &&
        /(?:queued\.)?ids\.filter\(\(id\) => !reserved\.has\(id\)\)/.test(src) &&
        /ackRelay\([^,)]+, acknowledge\)/.test(src) &&
        !/ackRelay\([^,)]+, (?:queued\.)?ids\)/.test(src),
      file);
  }
  const setup = read('src/app/ios-setup.tsx');
  ok('the setup screen is still the one place that does acknowledge a probe',
    /ackRelay\(active, ids\)/.test(setup) && /testReceived/.test(setup));
}

/* ── the staging queue is cleared by snapshot, never by key ──────────── */
//
// The queue has two writers that do not take turns. A foreground import reads
// the staged rows, puts a review screen in front of the user, and commits
// minutes later; a push wake in that gap appends rows AND acknowledges them to
// the relay, so the server no longer holds them. An unconditional delete of
// the key at commit time then loses those rows from both sides at once — the
// only shape of bug in this pipe that costs a transaction outright instead of
// costing a re-sync.
{
  const capture = read('src/lib/capture.ts');
  const background = read('src/lib/background-relay.ts');
  const storage = read('src/lib/background-relay-storage.ts');
  const native = read('src/lib/background-relay-storage.native.ts');
  const queueKey = (src) => src.match(/'wafra\/[\w/.-]+'/)?.[0];

  ok('the reader and the writer name the same staging key',
    queueKey(capture) !== undefined && queueKey(capture) === queueKey(background),
    `${queueKey(capture)} vs ${queueKey(background)}`);
  ok('the snapshot is read before the rows are parsed, never after',
    capture.indexOf('backgroundRelayStorage.getItem(') <
      capture.indexOf('await readBackgroundRelayRows()'));
  // The prose below still names clearBackgroundRelayRows to say why it must
  // not be used here, so this checks the import and the call, not the word.
  ok('the import commit clears only the snapshot it read',
    /removeItemIfUnchanged\(STAGED_ROWS_KEY, snapshot\)/.test(capture) &&
      !/import \{[^}]*\bclearBackgroundRelayRows\b/.test(capture) &&
      !/\bclearBackgroundRelayRows\(/.test(capture));
  ok('both storage backends implement the conditional delete',
    /removeItemIfUnchanged\(key: string, expected: string \| null\)/.test(storage) &&
      /removeItemIfUnchanged\(key: string, expected: string \| null\)/.test(native));
  ok('the shipping backend compares and deletes in one statement',
    /DELETE FROM \$\{TABLE\} WHERE key = \? AND value = \?/.test(native));
  ok('an empty read owns nothing and deletes nothing',
    /if \(expected === null\) return false;/.test(storage) &&
      /if \(expected === null\) return false;/.test(native));
}

/* iOS Message automation forwards sender identity. */
{
  const setup = read('src/app/ios-setup.tsx');
  const copy = read('src/lib/i18n.ts');
  const actionAt = setup.indexOf("t('iosAutomationAction')");
  const inputAt = setup.indexOf("t('iosAutomationInput')");

  ok('iOS setup explicitly passes the received Message object after choosing Wafra Capture',
    actionAt !== -1 && inputAt > actionAt &&
      /pass Received Message—not Content/.test(copy));
  ok('the installed Shortcut copy keeps its plain-text manual test compatible',
    /plain text for its manual test/.test(copy));
  ok('iOS setup discloses sender retention while raw Content is discarded',
    /discards raw Message Content after parsing/.test(copy) &&
      /when the Shortcut supplies it, the bank Sender label/.test(copy) &&
      /used to identify its card or account/.test(copy));
  ok('iOS setup treats Message-object forwarding as a spec until physical Sender proof',
    /setup instructions—not proof that Apple exposes Sender/.test(copy) &&
      /first real alert must file under the right bank/.test(copy) &&
      /bank attribution is unavailable and automatic capture is not parity-ready/.test(copy) &&
      /manual test cannot prove[\s\S]*that Sender is exposed/.test(copy) &&
      !/one automation per bank|fixed sender label/.test(copy));
  ok('the Message-object and sender-retention instructions have first-class Arabic copy',
    /مرّر «الرسالة المستلمة»/.test(copy) &&
      /تعليمات إعداد وليست دليلاً/.test(copy) &&
      /لن يتوفر تحديد البنك/.test(copy) &&
      /لن يكون الالتقاط التلقائي جاهزاً للتكافؤ/.test(copy) &&
      /محتوى الرسالة الخام/.test(copy) &&
      /اسم مرسل البنك/.test(copy));
}

/* ── Android inbox scans stay off the interaction critical path ─────── */
{
  const scan = read('src/lib/auto-import.ts');
  const home = read('src/hooks/use-auto-import.ts');
  const slice = Number(scan.match(/const PARSE_SLICE_SIZE = (\d+)/)?.[1]);

  ok('SMS parsing yields frequently enough for responsive input',
    slice > 0 && slice <= 32 && /await yieldToUi\(\)/.test(scan),
    `slice=${slice}`);
  ok('concurrent capture requests join one scan',
    /const existing = importInFlight;[\s\S]*if \(!existing\) return startAutoImport\(interactive\)/.test(home) &&
      /importInFlight = \{ promise: operation, interactive \}/.test(home));
  // ...and the thing they join is MODULE-level, not a component ref. Four tabs
  // now mount this hook; a per-component ref would have given each screen its
  // own "one" scan, which is four inbox reads racing four import plans built
  // from the same stale ledger — the duplicate-charge bug the join prevents.
  ok('the in-flight scan is shared across screens, not per component',
    /^let importInFlight: \{/m.test(home) && !/importInFlight = React\.useRef/.test(home));
  // A silent scan cannot deliver a permission prompt, a paywall/setup
  // redirect, or the up-to-date toast — every one of those is gated on
  // `interactive`, which that scan ran with false. An explicit action that
  // joins one instead of starting its own used to inherit that silent
  // outcome and go unanswered. It must run its own follow-up once the shared
  // scan settles, without re-entering as a second concurrent scan.
  ok('an interactive request joining a silent scan still gets its own follow-up',
    /if \(!interactive \|\| existing\.interactive\) return existing\.promise\.then\(\(\) => undefined\);/.test(home) &&
      /outcome === 'imported' \? undefined : startAutoImport\(true\)\.then\(\(\) => undefined\)/.test(home));
}

/* ── every tab that shows captured money can go and refresh it ──────── */
//
// A user paid AED 5,645 off a FAB card, opened Bills — the screen whose entire
// job is "is this card settled?" — and it still said AED 5,645 owing. The scan
// lived inside Home, so nothing on Bills, Wallet or Flow could ask the inbox
// for the payment SMS. The screen that raises the question has to be able to
// answer it.
{
  const hook = read('src/hooks/use-auto-import.ts');
  ok('the pull-to-refresh helper exists and scans interactively',
    /export function usePullToRefresh/.test(hook) && /runAutoImport\(true\)/.test(hook));
  // `.finally` is not error handling. This helper had a finally and no catch,
  // so any scan that threw — a dead network, a relay 5xx, a revoked device —
  // was an unhandled promise rejection whose only visible effect was the
  // spinner disappearing. The one gesture in the app that asks a question out
  // loud answered it with silence. The catch has to come first, too: a
  // rejection is not handled by the finally that runs after it.
  const refresh = hook.slice(hook.indexOf('export function usePullToRefresh'));
  ok('a failed pull-to-refresh tells the user instead of rejecting into nothing',
    /runAutoImport\(true\)\s*\.catch\(/.test(refresh) &&
      refresh.indexOf('.catch(') < refresh.indexOf('.finally(') &&
      /toast\.show\(t\('captureRefreshFailed'\)\)/.test(refresh));
  for (const tab of ['bills', 'wallet', 'flow']) {
    const src = read(`src/app/(tabs)/${tab}.tsx`);
    ok(`${tab} can pull to refresh`,
      /usePullToRefresh\(\)/.test(src) &&
        /<RefreshControl refreshing=\{refreshing\} onRefresh=\{onRefresh\}/.test(src));
  }
  // Home keeps the mount + foreground watch; the others deliberately do not,
  // so a tab switch does not fire a native permission query for a card that
  // tab never renders.
  const home = read('src/app/(tabs)/index.tsx');
  ok('Home is the screen that watches the foreground', /useAutoImport\(true\)/.test(home));
}

/* ── an erased ledger rebuilds itself from the inbox ─────────────────── */
//
// "Erase everything", then nothing. Home sat empty for the rest of the
// session and no amount of leaving and returning to the app changed it. Three
// separate things had to be true for the app to be that stuck, and each one
// is a line below:
//
//   1. the reducer resets the watermark to 0, which is what makes a scan
//      re-read the whole inbox rather than only what arrived since;
//   2. the watch effect re-runs when that watermark moves, because Home is a
//      tab — it never unmounts while the user is in Settings, so a wipe
//      changed neither of the two deps the effect used to have;
//   3. that re-run ignores the 30s freshness throttle, which an erase does
//      not reset and which is the last thing standing between a blank ledger
//      and the messages that would refill it.
//
// The fourth line is the one that would have made the other three look fixed
// while the app stayed empty: the resume listener has to read the CURRENT
// scan, not the one it closed over when it subscribed. That closure holds
// `state`, so a listener registered before the erase deduped every message
// against a ledger that no longer existed and reported "up to date".
{
  const hook = read('src/hooks/use-auto-import.ts');
  const store = read('src/lib/store.tsx');
  const empty = store.match(/const EMPTY_STATE: AppState = \{([\s\S]*?)\n\};/)?.[1] || '';
  const clear = store.match(/case 'clearAll':([\s\S]*?)(?=\n    (?:case |default:))/)?.[1] || '';

  ok('erasing resets the scan watermark to nothing',
    /lastScanTs: 0,/.test(empty) &&
      /\.\.\.EMPTY_STATE,/.test(clear) &&
      !/lastScanTs/.test(clear));
  // The other half of the same contract, in capture.ts: a zero watermark is
  // what turns the next scan into a full-history re-read.
  ok('a zero watermark reads the whole inbox, not just what is new',
    /state\.lastScanTs <= 0 \? 0 : state\.lastScanTs \+ 1/.test(read('src/lib/capture.ts')));
  ok('the foreground watch re-runs when the ledger is wiped',
    /\}, \[state\.hydrated, state\.lastScanTs, watchForeground\]\);/.test(hook));
  ok('the rebuild scan is not refused by the freshness throttle',
    /const scan = \(force = false\) => \{/.test(hook) &&
      /if \(!force && Date\.now\(\) - lastScanAt < RESCAN_AFTER_MS\) return;/.test(hook) &&
      /\n    scan\(state\.lastScanTs <= 0\);/.test(hook));
  // Silent, not interactive. An interactive scan on an iPhone whose relay the
  // erase just unpaired pushes /ios-setup — a setup wizard thrown at a user
  // who has just erased everything and is being shown the Shortcut cleanup
  // prompt at the same moment.
  ok('the rebuild scan asks for nothing and redirects nowhere',
    /void latestScan\.current\(false\)/.test(hook));
  ok('the resume listener scans the current ledger, not the one it subscribed with',
    !/void runAutoImport\(false\)/.test(code(hook)) &&
      hook.indexOf('latestScan.current = runAutoImport') <
        hook.indexOf('const scan = (force = false)'));

  // Everything the erase claims to delete, in the two places it actually
  // lives. The ledger is one encrypted database; the rows a headless push
  // wake has already parsed are in a SECOND one, with its own key, that
  // `stateStorage.destroy` has never heard of. The iOS confirmation says
  // "this iPhone's relay queue will be permanently deleted" — so it has to be.
  const settings = read('src/app/settings.tsx');
  const staged = read('src/lib/background-relay-storage.native.ts');
  const ledger = read('src/lib/state-storage.native.ts');
  const nameOf = (src) => src.match(/const DATABASE_NAME = '([^']+)'/)?.[1];
  ok('the staged relay inbox is a different database from the ledger',
    !!nameOf(staged) && nameOf(staged) !== nameOf(ledger));
  ok('erasing empties the staged relay inbox too',
    /clearBackgroundRelayRows/.test(settings) &&
      settings.indexOf('await clearAll()') < settings.indexOf('clearBackgroundRelayRows()'));
}

/* ── the budget editor answers the same question as the budget bar ──── */
//
// Flow's budget row excludes hidden accounts and both halves of a move
// between the user's own accounts. The sheet that EDITS that same limit read
// the raw ledger, so one AED 200,000 sweep between two of the user's own
// accounts showed "0 spent" on Flow and "limit exceeded" in the editor for
// that limit — and the three-month average it offered was built from the same
// inflated months. Both screens have to pass the same two sets.
{
  const sheet = read('src/components/limit-sheet.tsx');
  // Whitespace-free, so reformatting the argument list does not read as the
  // exclusions having been dropped.
  const flat = sheet.replace(/\s/g, '').replace(/,\)/g, ')');
  const calls = flat.split('spentInMonthForCategory(').length - 1;

  ok('the budget editor derives the live-account and internal-transfer sets',
    /liveAccountIds\(state\.accounts\)/.test(sheet) &&
      /internalTransferIds\(state\.transactions, liveAccounts\)/.test(sheet));
  ok('every spend figure in the budget editor applies both exclusions',
    calls === 2 &&
      flat.includes('spentInMonthForCategory(state.transactions,key,picked,liveAccounts,internal)') &&
      flat.includes(
        'spentInMonthForCategory(state.transactions,shiftMonthKey(key,-i),picked,liveAccounts,internal)',
      ),
    `${calls} call sites`);
  ok('the merchant breakdown adds up to the total printed above it',
    /isSpending\(t, liveAccounts, internal\)/.test(sheet));
}

/* ── one card's obligation is decided in one place ──────────────────── */
//
// The detail sheet held its own copy of the "newest statement only", "scope by
// card not by account row" and "credit payments through duePaidFils" rules,
// and got each of them wrong at least once — invisibly, because no suite here
// can load a .tsx. The rules belong beside openDues, under test.
{
  const sheet = read('src/components/card-detail-sheet.tsx');
  ok('the card detail sheet reads its figures from cards.ts',
    /cardStatementView\(state, account\.id\)/.test(sheet));
  ok('the card detail sheet keeps no statement rules of its own',
    !/state\.cardDues/.test(sheet) && !/duePaidFils/.test(sheet),
    sheet.match(/state\.cardDues|duePaidFils/g));
}

/* ── Bills uses the payment allocation behind its outstanding figure ── */
//
// Imported SMS card payments are transactions; they intentionally leave the
// due's raw `paidFils` at zero. openDues/dueWithStatus allocates those rows and
// returns the remainder. The single-card focal used that remainder for
// "Outstanding", but raw paidFils for both the progress bar and "paid of
// total", so the three figures contradicted one another on the same card.
{
  const cards = require('./build/cards');
  const account = {
    id: 'sms-card', name: 'FAB Credit Card', kind: 'card', cardType: 'credit',
    openingFils: 0, color: '#fff',
  };
  const due = {
    id: 'sms-due', accountId: account.id, totalDueFils: 100000,
    minDueFils: 5000, dueDate: '2026-08-20', paidFils: 0,
  };
  const state = {
    accounts: [account],
    cardDues: [due],
    transactions: [{
      id: 'sms-payment', type: 'income', isTransfer: true,
      accountId: account.id, amountFils: 40000, date: '2026-08-05',
      category: 'other', title: 'Credit card payment received', source: 'sms',
    }],
  };
  const allocated = cards.dueWithStatus(state, due, new Date(2026, 7, 10));
  const allocatedPaidFils = due.totalDueFils - allocated.remainingFils;
  ok('an SMS card payment supplies the paid and outstanding focal figures',
    due.paidFils === 0 && allocatedPaidFils === 40000 && allocated.remainingFils === 60000,
    `raw=${due.paidFils} paid=${allocatedPaidFils} outstanding=${allocated.remainingFils}`);

  /**
   * Anchored on the focal figures themselves, not on the block they used to
   * be computed in.
   *
   * The first version of this scan sliced bills.tsx between `dues.length ===
   * 1` and `dues.length > 1` and searched inside. When the per-render scan
   * was hoisted into a `focalDue` memo — a fix for a different defect, and a
   * correct one — the opening marker disappeared, the slice came back as the
   * empty string, and every regex below failed against nothing. A contract
   * that breaks when the code it protects is merely MOVED reports refactors
   * as regressions and says nothing about the thing it exists to defend.
   *
   * So: the whole file, and the property. `paidFils` must be derived from the
   * allocated remainder, the bar must be that same figure over the total, the
   * "paid of total" line must print that same figure, and raw `due.paidFils`
   * — which records manual edits only — must not appear on this screen at
   * all. Where those four live is the screen's business.
   */
  const bills = read('src/app/(tabs)/bills.tsx');
  // Comments stripped before the last check: the line that documents WHY the
  // raw field is unused says its name, and a scan that cannot tell prose from
  // code would force that explanation to be deleted to stay green.
  const billsCode = bills.replace(/\/\*[\s\S]*?\*\//g, '').replace(/\/\/[^\n]*/g, '');
  ok('the Bills focal derives progress and paid-of-total from the allocated remainder',
    /const paidFils = Math\.max\(0, item\.due\.totalDueFils - item\.remainingFils\)/.test(billsCode) &&
      /Math\.min\(1, paidFils \/ Math\.max\(1, item\.due\.totalDueFils\)\)/.test(billsCode) &&
      /paid: formatAED\(paidFils, \{ decimals: false \}\)/.test(billsCode) &&
      !/\bdue\.paidFils\b/.test(billsCode),
    billsCode.match(/\bdue\.paidFils\b/g));
}

/* ── the same rule, written the other way round ─────────────────────── */
//
// The scan above looks for `type !== 'expense' || t.isTransfer` — the shape
// the hand-rolled definitions happened to be written in on the day it was
// written. categoryTrend used the POSITIVE form of the same thing,
// `type === 'expense' && !t.isTransfer`, and was therefore invisible to it for
// as long as it existed. A rule spelled by hand is the defect; which way round
// the author typed it is not.
//
// Scoped to src/lib, where a match is always a money rollup. Screens filter
// row LISTS with this shape for display, which is a different question.
{
  const offenders = [];
  for (const file of sources('src/lib')) {
    const rel = path.relative(ROOT, file);
    if (rel.includes('lib/ledger.ts')) continue;
    const text = fs.readFileSync(file, 'utf8');
    for (const m of text.matchAll(/type === 'expense' && !\w+\.isTransfer/g)) {
      offenders.push(`${rel}: ${m[0]}`);
    }
  }
  ok('no library rollup spells spending out in the positive form either',
    offenders.length === 0, offenders.join(' | '));

  // Every rollup in analytics.ts takes both sets and hands both to isSpending.
  // netWorthSeries is exempt: it derives its own from the state it is given.
  const an = read('src/lib/analytics.ts');
  const calls = an.match(/isSpending\([^)]*\)/g) ?? [];
  ok('every analytics rollup applies both exclusions',
    calls.length === 4 && calls.every((c) => c === 'isSpending(t, live, internal)'),
    calls.join(' | '));

  // The one insight that names a single row rather than a total. It sits on
  // the same card as figures derived from summarizeMonth, so it has to be
  // drawn from the same rows they are.
  const insights = read('src/lib/insights.ts');
  ok('the biggest-purchase insight is chosen from countable spending',
    /isSpending\(t, liveAccounts, internalTransfers\)/.test(insights));
}

/* ── per-account spend agrees about what spending is ────────────────── */
//
// Cards and Wallet both print "this month" under an account. Both read the
// raw ledger, so a legacy own-account sweep — a structural title, no transfer
// flag, because it predates the flag — was reported as that account having
// spent AED 19,000 in a month Home showed 3,000 for.
//
// They deliberately do NOT apply the live-account set. These are per-account
// figures on an account's own row, and Cards shows hidden cards on purpose;
// filtering by account there would print "AED 0" beside a card that plainly
// spent money. Nothing sums either map, so no total can disagree with Home.
for (const rel of ['src/app/cards.tsx', 'src/app/(tabs)/wallet.tsx']) {
  const screen = read(rel);
  ok(`${rel} derives the internal-transfer set`,
    /internalTransferIds\(state\.transactions, liveAccounts\)/.test(screen));
  ok(`${rel} excludes own-account moves from per-account spend`,
    /isSpending\(\w+, undefined, internal\)/.test(screen),
    screen.match(/isSpending\([^)]*\)/g));
}

/* ── subscriptions and the expense export learn the same two exclusions ── */
//
// detectSubscriptions and reportExpenses/buildExpenseReportHtml both totalled
// every title's own history without ever consulting internalTransferIds or
// the live-account set. A legacy own-account sweep — a structural title, no
// transfer flag, because it predates the flag — repeats on a stable monthly
// cadence exactly like a subscription, so it surfaced in Bills as a recurring
// commitment and printed on the PDF handed to someone else as reimbursable
// spend. Unlike the per-account figures above, these are app-level totals, so
// they DO apply the live-account set too.
{
  const subs = read('src/lib/subscriptions.ts');
  ok('detectSubscriptions applies the live-account and internal-transfer exclusions',
    /isSpending\(t, liveAccounts, internalTransfers\)/.test(subs));

  const report = read('src/lib/reimbursement-report.ts');
  ok('reportExpenses applies the same two exclusions',
    /isSpending\(tx, liveAccounts, internalTransfers\)/.test(report));
  ok('buildExpenseReportHtml derives the live-account and internal-transfer sets from its own inputs',
    /liveAccountIds\(accounts\)/.test(report) &&
      /internalTransferIds\(options\.transactions, liveAccounts\)/.test(report));

  // Every call site that builds subscriptions or the export from a full
  // AppState has to derive both sets and thread them through, or the merchant
  // it drops is the one on this list, not the one under test above.
  for (const [rel, callNeedle] of [
    ['src/app/settings.tsx', 'reportExpenses(expenses,from,to,liveAccounts,internal)'],
    ["src/app/(tabs)/bills.tsx", 'detectSubscriptions(state.transactions,state.notSubscriptions,now,liveAccounts,internal)'],
    ['src/lib/leaving-soon.ts', 'detectSubscriptions(state.transactions,state.notSubscriptions,today,liveAccounts,internal)'],
    // The planning half of the reminder set moved out of notifications.ts into
    // reminders.ts, which imports no native module and is therefore the only
    // half a test can reach. notifications.ts no longer detects anything — it
    // schedules what it is handed — so the contract follows the code. Pointing
    // it at the old file would have passed by finding nothing to object to.
    ['src/lib/reminders.ts', 'detectSubscriptions(state.transactions,state.notSubscriptions,now,liveAccounts,internal,)'],
  ]) {
    const text = read(rel);
    const flat = text.replace(/\s/g, '');
    ok(`${rel} derives the live-account and internal-transfer sets`,
      /liveAccountIds\(state\.accounts\)/.test(text) &&
        /internalTransferIds\(state\.transactions, ?liveAccounts\)/.test(text));
    ok(`${rel} threads both sets into its subscription/export call`,
      flat.includes(callNeedle), rel);
  }

  const insights = read('src/lib/insights.ts');
  ok('the subscription-load insight applies the live-account and internal-transfer exclusions',
    /detectSubscriptions\(transactions, notSubscriptions, today, liveAccounts, internalTransfers\)/.test(insights));
}

// ---------------------------------------------------------------------------
// The reporting period and the month start day.
//
// currentMonthPeriod() reads a module global that only receives its real value
// during hydration, which is AFTER PeriodProvider first renders. A provider
// that answers "which month is it" once and never again therefore opens on the
// wrong month for every user whose month does not start on the 1st, and shows
// them zeros over a full ledger.
const periodCtx = read('src/lib/period-context.tsx');
ok('PeriodProvider re-answers which month it is once the start day is known',
  /useEffect\(/.test(periodCtx) && /state\.monthStartDay/.test(periodCtx),
  'without this it keeps the month it guessed before settings loaded');
ok('a period the user picked is not overwritten by that recompute',
  /chosenByUser/.test(periodCtx),
  'resyncing unconditionally would yank them out of the month they opened');

// ---------------------------------------------------------------------------
// Direction and meaning are two questions; one flag cannot answer both.
//
// A transfer is kept out of income because of what it COUNTS as. That is not
// licence to state the wrong direction: "Inward remittance −265" was printed
// for money that had just landed. The sign follows the type; the colour is
// what separates earned from merely moved.
const txRow = read('src/components/transaction-row.tsx');
ok('the sign follows the direction of the money, not whether it counts as income',
  /\{arrived \? '\+' : '−'\}/.test(txRow),
  'an arriving transfer was rendered with a minus');
ok('green is still reserved for money actually earned',
  /color: isIncome \? theme\.income : theme\.text/.test(txRow),
  'painting transfer arrivals green made the list read as income landing twice');
ok('the spoken label agrees with the sign on screen',
  /\$\{arrived \? t\('plusWord'/.test(txRow),
  'a screen reader saying "minus" over a plus is worse than either alone');

// ---------------------------------------------------------------------------
// A merchant rule's blast radius is defined once, and the printed count is it.
//
// The classic shape of this file's bug, in its purest form: the reducer matched
// the bare override key and rewrote every row carrying it, while the screen
// offering the tap counted through a filter that drops rows on purpose. Five
// rows titled TALABAT printed "2 entries" and moved 5 — reverting a hand-filed
// `dining` decision and stamping an expense category onto an income refund,
// which puts that row off-list in the entry sheet's own chips.
//
// uncategorised.test.js proves the predicate's behaviour. What cannot be
// proved there is that the two React modules still ROUTE through it: store.tsx
// and entry-detail-sheet.tsx are not compiled by this suite.
{
  const store = read('src/lib/store.tsx');
  const sheet = read('src/components/entry-detail-sheet.tsx');
  const uncat = read('src/lib/uncategorised.ts');
  const branch = store.match(/case 'setMerchantOverride': \{[\s\S]*?\n    \}/)[0];

  ok('the blast radius is one exported predicate, not three key matches',
    /export function overrideAppliesTo\(t: Transaction, key: string\): boolean/.test(uncat));
  ok('the store applies a merchant rule through that predicate',
    /overrideAppliesTo\(t, key\)/.test(branch) &&
      !/t\.title\.trim\(\)\.toLowerCase\(\) === key/.test(branch),
    'a bare key match here moves rows nothing counted');
  ok('a bulk merchant rule does not forge a hand edit',
    !/userEdited/.test(code(branch)),
    'userEdited is immutable, and a default must not masquerade as an answer');
  ok('the entry sheet counts the same rows the store will move',
    /overrideAppliesTo\(t, key\)/.test(sheet),
    'the "also update N entries" prompt is the only warning before the rewrite');

  // THE DIRECTION RULE ON THE PATH THAT WRITES. `overrideAppliesTo` is
  // expense-only, so an income category reaches no row through it — and the
  // reducer applied `action.category` to every row the predicate named without
  // ever asking whether the category could be there in the first place.
  // Correcting a credit to Salary and tapping "yes, update all" therefore
  // stamped `salary` onto every EXPENSE row carrying that merchant: exactly the
  // crossing `overrideFitsDirection` was written to stop, on the one path that
  // rewrites the ledger rather than reading it. Neither module is compiled by
  // any suite, so this is the only place it can be asserted.
  ok('a merchant rule is not applied across the direction it was chosen under',
    /overrideFitsDirection\(action\.category, 'expense'\)/.test(branch),
    'an income category cannot decide an expense row, and applyToExisting only moves expense rows');
  ok('the entry sheet asks that same question before printing a count',
    /overrideFitsDirection\(category, 'expense'\)/.test(sheet),
    'a prompt offering "also update 5 entries" over a rule that moves none of them');
  ok('the count on the categorise list is the override predicate, not candidacy',
    /if \(!overrideAppliesTo\(t, key\)\) continue;/.test(uncat) &&
      /if \(t\.userEdited\) return false;/.test(uncat));
}

// ---------------------------------------------------------------------------
// titleEdited: a hand-typed shop name is not a parser success.
//
// parserCoverage() measures how often the parser NAMED a merchant correctly.
// `userEdited` cannot answer that — it is also set by correcting an amount or
// a date — so the narrow signal has to be written where the edit happens.
{
  const types = read('src/lib/types.ts');
  const store = read('src/lib/store.tsx');
  const branch = store.match(/case 'editTransaction': \{[\s\S]*?\n    \}/)[0];
  const override = store.match(/case 'setMerchantOverride': \{[\s\S]*?\n    \}/)[0];

  ok('titleEdited is an optional, additive field on Transaction',
    /titleEdited\?: boolean;/.test(types),
    'existing rows must read as absent, which is correct for them');
  ok('an edit sets titleEdited only when the title actually changed',
    /const renamed = action\.patch\.title !== undefined && action\.patch\.title !== t\.title;/
      .test(branch),
    'editing an amount, a date or an account is not a renaming');
  ok('titleEdited stays true once set',
    /renamed \|\| t\.titleEdited/.test(branch));
  ok('a bulk merchant rule never claims the title was retyped',
    !/titleEdited/.test(code(override)),
    'that path does not touch titles');
}

/* ── a drill-down adds up to the figure that was tapped ───────────────
 *
 * Every route into src/app/transactions.tsx comes from a NUMBER on another
 * screen: Home's In/Out, a Flow category row, a Stats merchant row. The
 * contract is that the header on the screen you land on equals the figure you
 * touched to get there. Four separate ways it did not:
 *
 *   Home computes Out from live accounts; this screen's total did not, so
 *   archiving a card made 12,000 open as −16,000.
 *   Flow's slices come from allocationsOf; this screen read t.category, so a
 *   split charge was counted whole or dropped entirely.
 *   Stats' merchant rows are period-scoped; this screen opened all-time.
 *   Flow's slices are spending-only; this screen netted refunds off.
 */
{
  const tx = code(read('src/app/transactions.tsx'));

  ok('the transactions total asks ledger.ts what counts',
    /countsInTotals\(t, liveAccounts, internal\)/.test(tx) &&
      !/!t\.isTransfer && !internal\.has/.test(tx),
    'the local spelling had no live-account check, so a hidden card kept spending');

  ok('the category filter matches every part of a split row',
    /touchesCategories\(t, filters\.categories\)/.test(tx) &&
      !/filters\.categories\.has\(/.test(tx),
    'reading t.category hides the smaller half of a split from its own list');

  ok('the total counts only the filtered categories of a split row',
    /amountInCategories\(t, filters\.categories\)/.test(tx),
    'otherwise a 400-groceries/100-dining charge adds 500 to a groceries total');

  ok('"Last 3 months" is bounded at both ends',
    /k < threeKey \|\| k > currentKey/.test(tx),
    'a bill dated next month was listed and totalled under it');

  ok('a merchant drill-down opens in the period the figure was read in',
    /datePreset: source === 'sms' \? 'all' : 'selected'/.test(tx),
    'topMerchants is period-scoped; the drill-down was all-time');

  ok('a category or merchant drill-down is scoped to spending',
    /deepCategories\.length > 0 \|\| merchantParam\s*\n?\s*\? 'expense'/.test(tx),
    'both rows are built from isSpending, so a refund must not net off the header');

  ok('the SMS restriction is state rather than a route param',
    /useState\(source === 'sms'\)/.test(tx) &&
      /smsOnly && t\.source !== 'sms'/.test(tx) &&
      !/source === 'sms' && t\.source/.test(tx),
    'a route param cannot be cleared by "Clear all filters"');
  ok('"Clear all filters" clears the SMS restriction and counts it',
    /setSmsOnly\(false\)/.test(tx) && /\(smsOnly \? 1 : 0\)/.test(tx));

  ok('"Oldest first" sorts by date rather than reversing store order',
    !/\.reverse\(\)/.test(tx),
    'sortTxs orders by date alone, so reversing gave reverse IMPORT order within a day');

  ok('the custom range is usable where there is no native picker',
    /Platform\.OS === 'web' \?/.test(tx) && /picking !== null && Platform\.OS !== 'web'/.test(tx),
    'datetimepicker has no web build; it warns and renders null');
}

/* ── splits are read by their parts, everywhere ───────────────────────── */
{
  const { amountInCategories, touchesCategories } = require('./build/splits');
  const carrefour = {
    id: 'a',
    amountFils: 50000,
    type: 'expense',
    category: 'dining',
    splits: [
      { category: 'groceries', amountFils: 10000 },
      { category: 'dining', amountFils: 40000 },
    ],
  };
  const plain = { id: 'b', amountFils: 20000, type: 'expense', category: 'groceries' };

  ok('a split row belongs to every category it touches',
    touchesCategories(carrefour, new Set(['groceries'])) &&
      touchesCategories(carrefour, new Set(['dining'])) &&
      !touchesCategories(carrefour, new Set(['transport'])));
  ok('a split row contributes only its own part to a category total',
    amountInCategories(carrefour, new Set(['groceries'])) === 10000 &&
      amountInCategories(carrefour, new Set(['dining'])) === 40000);
  ok('a pooled slice sums exactly the parts it stands for',
    amountInCategories(carrefour, new Set(['groceries', 'dining'])) === 50000);
  ok('an unsplit row still counts whole, under its own category',
    amountInCategories(plain, new Set(['groceries'])) === 20000 &&
      amountInCategories(plain, new Set(['dining'])) === 0);
}

/* ── the trial clock cannot run backwards or overrun ──────────────────
 *
 * `trialStartTs` is a device clock reading, so it can land in the future — a
 * fast clock at first launch, a restored backup, a deliberate change. The
 * subtraction was unbounded above, and the paywall offered "your first 3 days
 * — 8 days left". */
{
  const { trialDaysLeft, TRIAL_DAYS, isProActive } = require('./build/purchases');
  const DAY = 86400000;
  const now = Date.UTC(2026, 5, 1);

  ok('a trial that has just started is the full length',
    trialDaysLeft({ trialStartTs: now }, now) === TRIAL_DAYS);
  ok('a trial that has run out is over',
    trialDaysLeft({ trialStartTs: now - 4 * DAY }, now) === 0 &&
      isProActive({ pro: false, trialStartTs: now - 4 * DAY }, now) === false);
  ok('a trial start in the future grants no more than the trial has',
    trialDaysLeft({ trialStartTs: now + 5 * DAY }, now) === TRIAL_DAYS,
    `got ${trialDaysLeft({ trialStartTs: now + 5 * DAY }, now)}`);

  const offsets = [];
  for (let d = -400; d <= 400; d += 7) offsets.push(d);
  const out = offsets.map((d) => trialDaysLeft({ trialStartTs: now + d * DAY }, now));
  ok('no clock reading produces a day count outside 0…TRIAL_DAYS',
    out.every((v) => Number.isInteger(v) && v >= 0 && v <= TRIAL_DAYS),
    out.filter((v) => v < 0 || v > TRIAL_DAYS).join(' | '));
}

/* ── a store that cannot be reached is not a customer who never paid ─── */
{
  const sdk = read('src/lib/billing.ts');
  const pro = read('src/app/pro.tsx');

  ok('restorePro has three answers, not two',
    /export async function restorePro\(\): Promise<boolean \| null>/.test(sdk),
    'false meant both "never bought it" and "could not ask"');
  ok('the paywall tells a subscriber to retry rather than that nothing exists',
    /restored === null/.test(code(pro)) && /restoreFailed/.test(pro),
    'a reinstall on bad connectivity read as "No purchase found"');

  ok('a purchase reports why it did not happen',
    /export type PurchaseOutcome = 'granted' \| 'cancelled' \| 'failed'/.test(sdk));
  ok('backing out of the store sheet is told apart from a broken store',
    /userCancelled/.test(code(sdk)),
    'an unactivated SKU made "Get Pro" silently inert, forever');
  ok('the paywall reports a failed purchase and stays silent on a cancelled one',
    /outcome === 'failed'/.test(code(pro)) && !/outcome === 'cancelled'/.test(code(pro)));
}

/* ── a workflow that GitHub cannot load fails silently ──────────────────────
 *
 * `feedback-agent.yml` answers `repository_dispatch`, and it referenced the
 * bare `inputs` context — a named value GitHub only recognises for
 * `workflow_dispatch` and `workflow_call`. Expressions are validated when the
 * file is LOADED, not when a job runs, so the whole workflow was rejected: it
 * never registered, `repository_dispatch` matched nothing, and the only
 * outward sign was a zero-second failed run with no jobs appearing on pushes
 * to a workflow that does not trigger on push.
 *
 * Meanwhile the relay reported `dispatched: true` and was right to — GitHub
 * accepted the dispatch. There was simply no workflow behind it. Nothing in
 * this repository could have caught that, which is what this is for.
 *
 * `github.event.inputs.<name>` is the form that works under every trigger,
 * because it reads the event payload rather than a context that may not
 * exist. It is null for a repository_dispatch run, which is exactly what the
 * `||` fallbacks want.
 */
{
  const dir = path.join(__dirname, '../../.github/workflows');
  const files = fs.existsSync(dir) ? fs.readdirSync(dir).filter((f) => /\.ya?ml$/.test(f)) : [];
  ok('the workflow directory is readable', files.length > 0, dir);

  const offenders = [];
  for (const file of files) {
    const text = fs.readFileSync(path.join(dir, file), 'utf8');
    // WHICH triggers this workflow declares, read off the `on:` block rather
    // than guessed from the whole file — "push:" appears in prose in several
    // of these, and a comment must not decide whether a workflow is valid.
    const onBlock = (() => {
      const lines = text.split('\n');
      const at = lines.findIndex((l) => /^on:\s*$/.test(l));
      if (at < 0) return '';
      const out = [];
      for (let i = at + 1; i < lines.length; i += 1) {
        if (/^\S/.test(lines[i])) break;
        out.push(lines[i]);
      }
      return out.join('\n');
    })();
    const triggers = (onBlock.match(/^ {2}([a-z_]+):/gm) ?? []).map((m) => m.trim().slice(0, -1));
    // `inputs` is a recognised named value ONLY for these two. A workflow that
    // declares nothing else may use it and is correct; one that declares
    // anything else alongside cannot, and GitHub rejects the whole file.
    const inputsAreValid =
      triggers.length > 0 && triggers.every((t) => t === 'workflow_dispatch' || t === 'workflow_call');
    if (inputsAreValid) continue;
    // Inside ${{ }} only; `inputs.foo` in a comment or a shell line is prose.
    for (const expr of text.match(/\$\{\{[^}]*\}\}/g) ?? []) {
      if (/(^|[^.\w])inputs\s*\./.test(expr)) offenders.push(`${file}: ${expr.trim()}`);
    }
  }
  ok(`no workflow reads the bare inputs context (${files.length} files)`,
    offenders.length === 0,
    offenders.slice(0, 3).join(' | '));
}

console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
