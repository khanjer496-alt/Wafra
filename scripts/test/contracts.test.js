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
  const home = read('src/app/(tabs)/index.tsx');

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
  const home = read('src/app/(tabs)/index.tsx');
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
  const home = read('src/app/(tabs)/index.tsx');
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
    /commit: async \(\) => \{[\s\S]*clearBackgroundRelayRows/.test(read('src/lib/capture.ts')));
}

/* ── Android inbox scans stay off the interaction critical path ─────── */
{
  const scan = read('src/lib/auto-import.ts');
  const home = read('src/app/(tabs)/index.tsx');
  const slice = Number(scan.match(/const PARSE_SLICE_SIZE = (\d+)/)?.[1]);

  ok('SMS parsing yields frequently enough for responsive input',
    slice > 0 && slice <= 32 && /await yieldToUi\(\)/.test(scan),
    `slice=${slice}`);
  ok('concurrent Home capture requests join one scan',
    /const existing = importInFlight\.current;[\s\S]*if \(!existing\) return startAutoImport\(interactive\)/.test(home) &&
      /importInFlight\.current = \{ promise: operation, interactive \}/.test(home));
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
    ['src/lib/notifications.ts', 'detectSubscriptions(state.transactions,state.notSubscriptions,now,liveAccounts,internal,)'],
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

console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
