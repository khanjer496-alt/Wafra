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

/* ── SMS delivery privacy: no second raw-message archive ─────────────── */
{
  const receiver = code(read(
    'modules/sms-reader/android/src/main/java/expo/modules/smsreader/SmsDeliveryReceiver.kt',
  ));
  const nativeModule = code(read(
    'modules/sms-reader/android/src/main/java/expo/modules/smsreader/SmsReaderModule.kt',
  ));
  const scanner = code(read('src/lib/auto-import.ts'));
  const settings = code(read('src/app/settings.tsx'));
  ok('SMS delivery never writes a second raw-message buffer',
    !receiver.includes('putString(') && !receiver.includes('JSONObject(') &&
      receiver.includes('SensitiveMessageFilter.shouldReject(body)') &&
      receiver.includes('InstantAlert.post(context, address, body)'));
  ok('upgrades and erase synchronously purge the retired plaintext SMS buffer',
    nativeModule.includes('OnCreate {') &&
      nativeModule.includes('AsyncFunction("clearCaptured")') &&
      nativeModule.includes('.edit().clear().commit()') &&
      nativeModule.includes('InstantAlert.clear(context)') &&
      read('modules/sms-reader/android/src/main/java/expo/modules/smsreader/InstantAlert.kt')
        .includes('cancelAll()'));
  ok('incoming SMS permission is requested only for the optional instant banner',
    /requestSmsPermission\(\)[\s\S]*PermissionsAndroid\.request\(PermissionsAndroid\.PERMISSIONS\.READ_SMS\)/
      .test(scanner) &&
      /requestSmsDeliveryPermission\(\)[\s\S]*PermissionsAndroid\.PERMISSIONS\.RECEIVE_SMS/
        .test(scanner) &&
      /toggleInstantAlerts[\s\S]*requestSmsDeliveryPermission\(\)/.test(settings));
  ok('restricted SMS access is an error, never a successful empty inbox',
    nativeModule.includes('checkSelfPermission(Manifest.permission.READ_SMS)') &&
      nativeModule.includes('SMS inbox query returned no cursor') &&
      nativeModule.includes('catch (error: SecurityException)') &&
      !/catch \([^)]*SecurityException[^)]*\) \{\s*\}/.test(nativeModule));
}

/* ── Bank-app notifications: encrypted queue and durable acknowledgement ─ */
{
  const store = code(read(
    'modules/notification-reader/android/src/main/java/expo/modules/notificationreader/NotificationCaptureStore.kt',
  ));
  const service = code(read(
    'modules/notification-reader/android/src/main/java/expo/modules/notificationreader/BankNotificationListenerService.kt',
  ));
  const nativeModule = code(read(
    'modules/notification-reader/android/src/main/java/expo/modules/notificationreader/NotificationReaderModule.kt',
  ));
  const nativePackages = read(
    'modules/notification-reader/android/src/main/java/expo/modules/notificationreader/TrustedBankNotificationPackages.kt',
  );
  const jsPackages = read('src/lib/trusted-bank-notification-packages.ts');
  const scanner = code(read('src/lib/auto-import.ts'));
  ok('notification bodies are sealed with AndroidKeyStore AES-GCM before persistence',
    store.includes('AndroidKeyStore') && store.includes('AES/GCM/NoPadding') &&
      store.includes('.put("ct"') && !service.includes('getSharedPreferences('));
  ok('notification candidates are bounded and expire from the encrypted queue',
    store.includes('MAX_ROWS = 500') && store.includes('RETENTION_MS = 7L * 24 * 60 * 60 * 1000') &&
      service.includes('MAX_TITLE_CHARS = 512') && service.includes('MAX_TEXT_CHARS = 4096'));
  const kotlinPackageIds = [...nativePackages.matchAll(/"([A-Za-z0-9_.]+)" to "[A-Z]{2}"/g)]
    .map((match) => match[1]).sort();
  const jsPackageIds = [...jsPackages.matchAll(/'([A-Za-z0-9_.]+)': '[A-Z]{2}'/g)]
    .map((match) => match[1]).sort();
  ok('notification parsing is restricted to curated Play-installed bank packages',
    kotlinPackageIds.length >= 10 && JSON.stringify(kotlinPackageIds) === JSON.stringify(jsPackageIds) &&
      nativePackages.includes('installingPackageName') && nativePackages.includes('com.android.vending') &&
      service.includes('TrustedBankNotificationPackages.isTrusted(this, sbn.packageName)') &&
      scanner.includes('trustedBankNotificationMarket(n.pkg)'));
  ok('bank-app capture stays unavailable until package-specific templates are benchmarked',
    nativePackages.includes('const val CAPTURE_ENABLED = false') &&
      nativeModule.includes('Function("isAvailable")'));
  ok('notification erase prevents old shade rows from being swept back in',
    store.includes('CLEARED_THROUGH') && store.includes('.putLong(CLEARED_THROUGH, clearedThrough)') &&
      store.includes('if (ts <= prefs.getLong(CLEARED_THROUGH, 0L)) return'));
  ok('a transient KeyStore failure never compacts the ciphertext queue',
    store.indexOf('val secretKey = key()') < store.indexOf('for (index in 0 until envelopes.length())') &&
      store.includes('catch (_: AEADBadTagException)') &&
      !/private fun decrypt[\s\S]*?catch \(_: Exception\)/.test(store));
  ok('the old plaintext notification preference is erased instead of migrated',
    store.includes('LEGACY_PREFS') && store.includes('legacy.edit().clear().commit()') &&
      store.includes('Legacy notification queue could not be erased') &&
      nativeModule.includes('OnCreate {') &&
      nativeModule.includes('NotificationCaptureStore.purgeLegacyPlaintext(context)'));
  ok('notification capture exposes separate read, acknowledge and erase operations',
    nativeModule.includes('AsyncFunction("getCaptured")') &&
      nativeModule.includes('AsyncFunction("ackCaptured")') &&
      nativeModule.includes('AsyncFunction("clearCaptured")'));
  ok('notification rows are acknowledged only through the scan commit boundary',
    scanner.includes('commit: notificationIds.size > 0') &&
      scanner.includes('notificationReader.ackCaptured([...notificationIds])'));
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
 * prices beside it, and hidden gestures that granted Pro for free. */
{
  const pro = fs.readFileSync(path.join(ROOT, 'src/app/pro.tsx'), 'utf8');

  ok('the paywall gives away no free unlock',
    !/onLongPress/.test(pro) && !/setPro\(next\)/.test(pro));

  const settings = fs.readFileSync(path.join(ROOT, 'src/app/settings.tsx'), 'utf8');
  ok('Settings contains no hidden entitlement bypass',
    !/\bsetPro\b/.test(settings) &&
      !/tapCount\.current >= 7/.test(settings) &&
      !/onVersionTap/.test(settings));

  const storeMetadata = JSON.parse(
    fs.readFileSync(path.join(ROOT, 'docs/store-metadata.json'), 'utf8'),
  );
  const googleBenefits = Object.values(storeMetadata.googlePlay.subscriptionLocalizations)
    .flatMap((product) => Object.values(product))
    .flatMap((localization) => localization.benefits);
  const subscriptionCopy = [
    ...Object.values(storeMetadata.apple.subscriptionLocalizations)
      .flatMap((product) => Object.values(product))
      .map((localization) => localization.description),
    ...Object.values(storeMetadata.googlePlay.subscriptionLocalizations)
      .flatMap((product) => Object.values(product))
      .flatMap((localization) => [localization.description, ...localization.benefits]),
  ].join('\n');
  const releaseGuide = fs.readFileSync(path.join(ROOT, 'docs/play-release.md'), 'utf8');
  const listingCopy = [
    ...Object.values(storeMetadata.apple.locales).map((locale) => locale.description),
    ...Object.values(storeMetadata.googlePlay.listings).map((listing) => listing.fullDescription),
  ].join('\n');
  ok('free recovery and salary-day months are not sold as Pro benefits',
    !/feat(?:Backup|SalaryMonths)/.test(pro) &&
      googleBenefits.length > 0 &&
      googleBenefits.every((benefit) =>
        benefit === 'Automatic capture' || benefit === 'الالتقاط التلقائي') &&
      !/backup|salary-day|نسخ احتياطي|الراتب/i.test(subscriptionCopy) &&
      /backup\/restore remain free/.test(listingCopy) &&
      /backup\/restore keep working without Pro/.test(releaseGuide));

  ok('the paywall renders the storefront price instead of ledger Money',
    /storePrices\?\.\[[a-zA-Z]+\]\?\.priceString/.test(pro) &&
      /loadStorePrices/.test(pro) &&
      !/<Money[^>]*PRO_PRICES/.test(pro));
  ok('native pricing never falls back to an unlabeled USD reference',
    /Platform\.OS === 'web'[\s\S]{0,100}PRO_REFERENCE_PRICE_STRINGS/.test(pro) &&
      /if \(!storePrices\?\.\[plan\]\)/.test(pro) &&
      /billingAvailable && !storePrices\?\.\[plan\]/.test(pro));
  ok('a failed catalog load can be retried without reopening the paywall',
    /priceStatus === 'failed'/.test(pro) &&
      /setPriceRequest\(\(request\) => request \+ 1\)/.test(pro));
  ok('the paywall discloses renewal and reaches store subscription management',
    /subscriptionRenewalTerms/.test(pro) &&
      /subscriptionManagementUrl/.test(pro) &&
      /manageSubscription/.test(pro));

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

  const store = fs.readFileSync(path.join(ROOT, 'src/lib/store.tsx'), 'utf8');
  ok('an editable ledger backup cannot grant Pro or restart the trial',
    /pro: _pro,[\s\S]{0,120}trialStartTs: _trial/.test(store) &&
      /pro: state\.pro,[\s\S]{0,120}trialStartTs: state\.trialStartTs/.test(store));
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
  const layout = read('src/app/_layout.tsx');

  // The entitlement id is a string shared with a dashboard nobody can grep.
  ok('the entitlement id is named once and exported',
    /export const ENTITLEMENT_ID = 'pro'/.test(src) &&
      (src.match(/'pro'/g) || []).length === 1);

  // Entitlement has to be asked for at launch. Without it `pro` is a local
  // boolean that survives a lapsed subscription, a refund and a cancellation.
  ok('entitlement is re-checked on launch',
    /observeEntitlement/.test(layout) && /refreshEntitlement\(\)/.test(layout));

  // ...and the answer has three states, not two. Treating "could not reach
  // the store" as "has not paid" locks a paying customer out of their own
  // ledger the first time they open the app on a plane.
  ok('a null entitlement leaves the cached flag alone',
    /snapshot\) apply\(snapshot\)/.test(layout));
  ok('refreshEntitlement can return null',
    /Promise<EntitlementSnapshot \| null>/.test(sdk));

  // A secret key in the client is a real incident. RevenueCat's platform
  // public SDK keys may be committed because native builds need them baked
  // into Expo config; local development may deliberately leave them empty.
  const appJson = JSON.parse(read('app.json'));
  const extra = appJson.expo.extra || {};
  ok('the Android RevenueCat key is empty or a Google public SDK key',
    extra.revenueCatAndroidKey === '' || /^goog_[A-Za-z0-9]+$/.test(extra.revenueCatAndroidKey));
  ok('the iOS RevenueCat key is empty or an Apple public SDK key',
    extra.revenueCatIosKey === '' || /^appl_[A-Za-z0-9]+$/.test(extra.revenueCatIosKey));
  ok('no secret RevenueCat key is committed',
    !/sk_[A-Za-z0-9]{10}/.test(read('app.json') + src + sdk));
  const releaseCheck = read('scripts/lib/release-readiness.mjs');
  ok('the release gate rejects prefix-only RevenueCat placeholders',
    /\^goog_\[A-Za-z0-9\]\+\$/.test(releaseCheck) &&
      /\^appl_\[A-Za-z0-9\]\+\$/.test(releaseCheck));

  // Billing must be impossible rather than broken when unconfigured, or the
  // paywall opens a flow that cannot complete.
  ok('billing is unavailable without a key', /apiKey\(\) !== null/.test(sdk));
  ok('billing is unavailable on web', /Platform\.OS !== 'web'/.test(sdk));

  // Product ids are store configuration; native prices come back localized.
  const { PRO_SKUS, PRO_REFERENCE_PRICE_STRINGS } = require('./build/purchases');
  ok('both plans have a product id and an explicit USD preview reference',
    Object.keys(PRO_SKUS).every(
      (k) => PRO_SKUS[k] && /^US\$/.test(PRO_REFERENCE_PRICE_STRINGS[k]),
    ),
    { PRO_SKUS, PRO_REFERENCE_PRICE_STRINGS });
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

  const collectedData = config.ios?.privacyManifests?.NSPrivacyCollectedDataTypes ?? [];
  const collectedTypes = new Set(collectedData.map((entry) => entry.NSPrivacyCollectedDataType));
  const expectedCollectedTypes = [
    'NSPrivacyCollectedDataTypeOtherFinancialInfo',
    'NSPrivacyCollectedDataTypePurchaseHistory',
    'NSPrivacyCollectedDataTypeDeviceID',
    'NSPrivacyCollectedDataTypeCustomerSupport',
    'NSPrivacyCollectedDataTypeOtherUserContent',
  ];
  ok('the iOS config declares the data retained by Wafra services',
    expectedCollectedTypes.every((type) => collectedTypes.has(type)) &&
      collectedData.every((entry) =>
        typeof entry.NSPrivacyCollectedDataTypeLinked === 'boolean' &&
        entry.NSPrivacyCollectedDataTypeTracking === false &&
        entry.NSPrivacyCollectedDataTypePurposes?.includes(
          'NSPrivacyCollectedDataTypePurposeAppFunctionality',
        )));
  const purchaseHistory = collectedData.find((entry) =>
    entry.NSPrivacyCollectedDataType === 'NSPrivacyCollectedDataTypePurchaseHistory');
  ok('RevenueCat purchase history declares both entitlement and dashboard use',
    purchaseHistory?.NSPrivacyCollectedDataTypePurposes?.includes(
      'NSPrivacyCollectedDataTypePurposeAnalytics',
    ));

  const storage = read('src/lib/state-storage.native.ts');
  const store = read('src/lib/store.tsx');
  const persistence = read('src/lib/ledger-persistence.ts');
  ok('the database key is generated on-device and kept device-only',
    /getRandomBytesAsync\(32\)/.test(storage) &&
      /WHEN_UNLOCKED_THIS_DEVICE_ONLY/.test(storage));
  ok('SQLCipher receives its key before the ledger table is touched',
    storage.indexOf('PRAGMA key') < storage.indexOf('CREATE TABLE'));
  ok('the active store persists through the encrypted adapter',
    /storage: stateStorage/.test(store) &&
      /storage\.multiSet/.test(persistence) &&
      /storage\.multiGet/.test(persistence) &&
      !/AsyncStorage\./.test(store));
  ok('plaintext legacy data is removed only after encrypted migration succeeds',
    storage.indexOf('await encryptedStorage.multiSet(present)') <
      storage.indexOf('await AsyncStorage.multiRemove(keys)'));
}

/* ── Private Mode is a data path, not a label ───────────────────────── */
{
  const types = read('src/lib/types.ts');
  const store = read('src/lib/store.tsx');
  const ledgerImport = read('src/lib/ledger-import.ts');
  const capture = read('src/lib/capture.ts');
  const settings = read('src/app/settings.tsx');
  const copy = read('src/lib/i18n.ts');

  ok('Private Mode is persisted as part of app state', /privateMode: boolean/.test(types));
  ok('Private Mode strips retained and newly imported raw text',
    /transactions: action\.enabled[\s\S]*raw: _discard/.test(store) &&
      /raw: state\.privateMode \? undefined : transaction\.raw/.test(ledgerImport) &&
      /materializeImportBatch\(input, base, makeId\)/.test(store));
  ok('capture opt-out is durable and stops every source before it can read messages',
    /captureOptOut: boolean/.test(types) &&
      capture.indexOf('if (state.captureOptOut') <
        capture.indexOf('if (isSmsScanningAvailable())') &&
      capture.indexOf('if (state.captureOptOut') <
        capture.indexOf("if (isRelayPlatform())"));
  ok('erasing data preserves capture opt-out while automatic enable clears it explicitly',
    /captureOptOut: state\.captureOptOut/.test(store) &&
      /setCaptureOptOut\(false\)/.test(settings));
  ok('Private Mode blocks the non-local relay without disabling local Android parsing',
    /state\.privateMode && isRelayPlatform\(\)/.test(capture));
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
  const executor = read('src/lib/capture-executor.ts');
  const routineDurableAt = executor.indexOf('await receipt.durable');
  const setupSlice = executor.slice(
    executor.indexOf('const executeSetupVerification'),
    executor.indexOf("return {\n    execute:"),
  );
  const setupDurableAt = setupSlice.indexOf("await activeLedger.importBatch(plan.batch).durable");
  ok('an import exposes an encrypted-write durability promise',
    /interface ImportReceipt[\s\S]*durable: Promise<void>/.test(store) &&
      /const next = dispatch\(action\)/.test(store) &&
      /persist\(next\)/.test(store));
  ok('routine relay sync waits for SQLCipher before commit',
    routineDurableAt > executor.indexOf('importBatch(collected.plan.batch)') &&
      executor.indexOf('await collected.commit()', routineDurableAt) > routineDurableAt);
  ok('setup test waits for SQLCipher before acknowledging',
    setupDurableAt >= 0 &&
      setupSlice.indexOf('await dependencies.acknowledge(cfg, queued.ids)', setupDurableAt) >
        setupDurableAt);
}

/* ── iOS relay wakes the app without carrying financial data ───────── */
{
  const config = JSON.parse(read('app.json')).expo;
  const notifications = config.plugins.find(
    (plugin) => Array.isArray(plugin) && plugin[0] === 'expo-notifications',
  );
  const background = read('src/lib/background-relay.ts');
  const executor = read('src/lib/capture-executor.ts');
  const capture = read('src/lib/capture.ts');
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
    executor.indexOf('await background.stage(queued.parsed)') <
      executor.indexOf(
        'await dependencies.acknowledge(cfg, acknowledge)',
        executor.indexOf('const executeBackground'),
      ));
  ok('background sync reserves setup proof markers for the foreground verifier',
    /const reserved = new Set\(queued\.testIds\)/.test(executor) &&
      /queued\.ids\.filter\(\(id\) => !reserved\.has\(id\)\)/.test(executor));
  ok('only a parsed Shortcut headless delivery records automation proof',
    executor.indexOf('await background.stage(queued.parsed)') <
      executor.indexOf('await background.recordAutomationProof(cfg)') &&
      /queued\.parsed\.some\(\(row\) => row\.captureSource === 'shortcut'\)/.test(executor));
  ok('email and PDF headless delivery cannot impersonate the Message automation',
    /captureSource === 'shortcut'/.test(executor) &&
      !/executeSupplemental[\s\S]*recordAutomationProof/.test(
        executor.slice(executor.indexOf('const executeSupplemental'), executor.indexOf('const executeBackground')),
      ));
  ok('a synthetic relay probe cannot make Home claim automation is active',
    /AUTOMATION_PROOF_KEY/.test(relay) &&
      /getRelayAutomationProof\(cfg\?\.deviceId \?\? null\)/.test(home) &&
      /cfg\?\.setupState === 'verified' && automationProof/.test(home) &&
      /\? 'active'[\s\S]*\? 'pipe-ready'/.test(home));
  ok('locked background credentials use the sync-only bearer',
    /BackgroundRelayConfig = Pick<[\s\S]*'syncToken'[\s\S]*>;/.test(read('src/lib/relay.ts')) &&
      !/BackgroundRelayConfig = Pick<[\s\S]*'adminToken'[\s\S]*>;/.test(read('src/lib/relay.ts')));
  ok('the durable local inbox is cleared only by the UI import commit',
    /commit: async \(\) => \{[\s\S]*clearStagedRows\(staged\.snapshot\)/.test(
      read('src/lib/capture.ts')));
  ok('erase intent survives restart and prevents staged rows re-entering the ledger',
    /BACKGROUND_RELAY_ERASE_PENDING_KEY/.test(background) &&
      /getItem\(BACKGROUND_RELAY_ERASE_PENDING_KEY\)/.test(capture) &&
      /return \{ rows: \[\], snapshot: null \}/.test(capture));
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
    /revokedAt\(cfg\) !== null && !includeRevoked/.test(relay) &&
      /return decodeStoredRelayConfig\(raw\);/.test(relay) &&
      /if \(revokedAt\(cfg\) !== null\) return null;/.test(relay));
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
// eats the proof, and because the tabs shell mounts useAutoImport(true) UNDERNEATH
// the setup flow, that is not an unlucky interleaving, it is the ordinary one: the
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
  const executor = read('src/lib/capture-executor.ts');
  const capture = read('src/lib/capture.ts');
  const background = read('src/lib/background-relay.ts');
  const supplemental = read('src/components/supplement-imports.tsx');
  ok('non-setup executor intents reserve setup probe ids',
    /new Set\(queued\.testIds\)/.test(executor) &&
      /queued\.ids\.filter\(\(id\) => !reserved\.has\(id\)\)/.test(executor));
  ok('the foreground collector still reserves setup probe ids internally',
    /new Set\(testIds\)/.test(capture) &&
      /ids\.filter\(\(id\) => !reserved\.has\(id\)\)/.test(capture));
  ok('background and supplemental adapters no longer receive queue ids',
    !/\backRelay\b/.test(background) && !/\backRelay\b/.test(supplemental) &&
      /execute\('background'\)/.test(background) && /execute\('supplemental'\)/.test(supplemental));
  ok('supplemental connect cannot replace an unread existing Shortcut identity',
    /useState\(true\)/.test(supplemental) &&
      /if \(loadingConfig \|\| busy !== null\) return/.test(supplemental) &&
      supplemental.indexOf('const existing = await getRelayConfig()') <
        supplemental.indexOf('const connected = await pairDevice(DEFAULT_RELAY_URL)'));
  const setupSlice = executor.slice(executor.indexOf('const executeSetupVerification'));
  ok('the setup intent is still the one place that acknowledges probe ids',
    /acknowledge\(cfg, queued\.ids\)/.test(setupSlice) && /testReceived/.test(setupSlice));
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
  const setupWorkflow = read('src/lib/ios-capture-setup.ts');
  const copy = read('src/lib/i18n.ts');
  const shortcutSpec = read('docs/ios-shortcut-spec.md');
  const releaseCheck = read('scripts/lib/release-readiness.mjs');
  const testflight = read('.github/workflows/ios-testflight.yml');
  const actionAt = setup.indexOf("t('iosAutomationAction')");
  const inputAt = setup.indexOf("t('iosAutomationInput')");

  ok('iOS setup explicitly passes the received Message object after choosing Wafra Capture',
    actionAt !== -1 && inputAt > actionAt &&
      /Input: Received Message \(not only Content\)/.test(copy));
  ok('the installed Shortcut copy keeps its plain-text manual test compatible',
    /Accept \*\*Messages\*\* and \*\*Text\*\*/.test(shortcutSpec) &&
      /manual setup test/.test(shortcutSpec));
  ok('iOS setup discloses sender retention while raw Content is discarded',
    /discards raw Message Content after parsing/.test(copy) &&
      /when the Shortcut supplies it, the bank Sender label/.test(copy) &&
      /used to identify its card or account/.test(copy));
  ok('technical sender limits appear after success instead of blocking setup comprehension',
    setup.indexOf('(captured || captureOn)') < setup.indexOf("t('iosTestLimit')") &&
      /first real bank alert is the final check/.test(copy) &&
      /correct bank or card/.test(copy));
  ok('returning from the install page cannot falsely confirm Shortcut setup',
    !/AppState\.addEventListener/.test(setup) &&
      /Shortcut is ready — clear code & continue/.test(copy));
  ok('clearing the copied setup credential does not trigger an iOS paste read prompt',
    /sensitiveCopyPending/.test(setupWorkflow) &&
      /writeClipboard\(''\)/.test(setupWorkflow) &&
      !/Clipboard\.getStringAsync/.test(setupWorkflow));
  ok('the Message-object and setup instructions have first-class Arabic copy',
    /الإدخال: «الرسالة المستلمة»/.test(copy) &&
      /الاختصار جاهز — امسح الرمز وتابع/.test(copy) &&
      /محتوى الرسالة الخام/.test(copy) &&
      /اسم مرسل البنك/.test(copy));
  ok('the next production build rejects the exact broken public Shortcut snapshot',
    /85bd1e080e5849b591049eccffb9a3a1/.test(releaseCheck) &&
      /broken-capture-shortcut/.test(releaseCheck) &&
      /scripts\/check-release-config\.mjs/.test(testflight));
  ok('the replacement Shortcut contract prohibits file-backed configuration',
    /no Get File, Save File, Move File or Folder/.test(shortcutSpec) &&
      /setup import question/.test(shortcutSpec));
  ok('historical import stays hidden until its tested public Shortcut is configured',
    /supportsHistoricalShortcut\(\) && HISTORY_SHORTCUT_INSTALL_URL && !history/.test(
      read('src/app/import-sms.tsx')));
}

/* ── Android inbox scans stay off the interaction critical path ─────── */
{
  const scan = read('src/lib/auto-import.ts');
  const home = read('src/hooks/use-auto-import.ts');
  const budget = Number(scan.match(/const PARSE_TIME_BUDGET_MS = (\d+)/)?.[1]);
  const maxSlice = Number(scan.match(/const MAX_PARSE_SLICE_SIZE = (\d+)/)?.[1]);

  ok('SMS parsing yields by elapsed time with a bounded fast-device ceiling',
    budget >= 4 && budget <= 12 && maxSlice > 32 && maxSlice <= 96 &&
      /Date\.now\(\) - state\.startedAt < PARSE_TIME_BUDGET_MS/.test(scan) &&
      // Inbox parsing, its proven-duplicate fast path, the retired delivery
      // buffer and trusted bank notifications each keep the same UI yield.
      (scan.match(/await yieldToUi\(\)/g) ?? []).length === 4,
    `budget=${budget}, maxSlice=${maxSlice}`);
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
      /toast\.show\(t\('captureRefreshFailed'\),\s*\{\s*tone:\s*'error'\s*\}\)/.test(refresh));
  ok('permission denial does not mark the inbox fresh and offers Android settings',
    hook.indexOf("return 'no-permission'") < hook.indexOf('lastScanAt = Date.now()') &&
      /toast\.show\(t\('smsAccessOff'\)[\s\S]*openSmsPermissionSettings/.test(hook));
  for (const tab of ['bills', 'wallet', 'flow']) {
    const src = read(`src/app/(tabs)/${tab}.tsx`);
    ok(`${tab} can pull to refresh`,
      /usePullToRefresh\(\)/.test(src) &&
        /<RefreshControl refreshing=\{refreshing\} onRefresh=\{onRefresh\}/.test(src));
  }
  // The tabs shell keeps the mount + foreground watch regardless of which tab
  // Android restores after an update. Home separately owns the visible status
  // query, so a tab switch does not start another parser migration.
  const home = read('src/app/(tabs)/index.tsx');
  const tabsLayout = read('src/app/(tabs)/_layout.tsx');
  ok('the tabs shell owns parser migrations independent of the active tab',
    /function CaptureOwner/.test(tabsLayout) &&
      /useAutoImport\(true, false\)/.test(tabsLayout) &&
      /<CaptureOwner \/>/.test(tabsLayout));
  ok('Home observes status without registering a second foreground scan',
    /useAutoImport\(false, true\)/.test(home));
  ok('a hidden shell access failure reaches Home capture status',
    /React\.useSyncExternalStore\(\s*subscribeSmsAccess/.test(hook) &&
      /setSharedSmsAccessUnavailable\(true\)/.test(hook) &&
      /captureState: sharedAccessUnavailable \? 'off' : captureState/.test(hook));
  ok('Home refresh surfaces a native inbox failure',
    /await runAutoImport\(true\);[\s\S]*?catch \{[\s\S]*?captureRefreshFailed/.test(home));
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
    /if \(!state\.hydrated \|\| !state\.onboarded\) return;/.test(hook) &&
      /state\.lastScanTs <= 0 \|\| captureJustEnabled/.test(hook));
  ok('the rebuild scan is not refused by the freshness throttle',
    /const scan = \(force = false\) => \{/.test(hook) &&
      /if \(!force && Date\.now\(\) - lastScanAt < RESCAN_AFTER_MS\) return;/.test(hook) &&
      /if \(!state\.captureOptOut\) scan\(state\.lastScanTs <= 0 \|\| captureJustEnabled\);/.test(hook));
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
    /\? clearBackgroundRelayRows/.test(settings) &&
      /SmsReader\.clearCaptured\(\)/.test(settings) &&
      /notificationReader\.clearCaptured\(\)/.test(settings) &&
      /await clearAll\(cleanupCaptureQueue\)/.test(settings));
}

{
  const settings = read('src/app/settings.tsx');
  const recovery = code(read('src/components/storage-recovery.tsx'));
  const store = read('src/lib/store.tsx');
  const copy = read('src/lib/i18n.ts');
  ok('every erase keeps capture cleanup inside the blocked ledger transaction',
    /await clearAll\(cleanupCaptureQueue\)/.test(settings) &&
      /SmsReader\.clearCaptured\(\)/.test(settings) &&
      /notificationReader\.clearCaptured\(\)/.test(settings) &&
      /cfg = await getRelayConfigStrict\(\)/.test(settings) &&
      /eraseLocalInitializeFailedTitle/.test(settings) &&
      /recoveryState === 'erased-initialize'/.test(recovery) &&
      /storageRecoveryInitializeBody/.test(recovery) &&
      /!erased/.test(recovery) &&
      /Your data was erased/.test(copy) &&
      /isRelayPlatform\(\) \? await getRelayConfigStrict\(\) : null/.test(recovery) &&
      /if \(relay\) await unpairDevice\(relay\)/.test(recovery) &&
      /clearAll\(cleanupCaptureQueue\)/.test(recovery) &&
      /SmsReader\.clearCaptured\(\)/.test(recovery) &&
      /notificationReader\.clearCaptured\(\)/.test(recovery) &&
      store.indexOf('await afterErase()') <
        store.lastIndexOf("dispatch({ type: 'hydrate', state: persistedBlank })"));
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
  //
  // The exact count is deliberate and is meant to be edited. `every` alone
  // cannot see a call that was DELETED — remove the exclusions from a rollup
  // and the remaining calls are all still well-formed — so the number is what
  // catches a removal. The cost is that adding a rollup fails this line until
  // someone comes here, which is the point: the person adding it is exactly
  // who should be asked whether their new total counts transfers.
  //
  // 5 since periodComparison, which powers the "vs last month" line on Home.
  const an = read('src/lib/analytics.ts');
  const calls = an.match(/isSpending\([^)]*\)/g) ?? [];
  ok('every analytics rollup applies both exclusions',
    calls.length === 5 && calls.every((c) => c === 'isSpending(t, live, internal)'),
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
  const strings = read('src/lib/i18n.ts');

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
  ok('an unconfirmed entitlement never guarantees that the store charged nothing',
    !/Nothing has been charged/.test(strings) && !/لم يتم خصم أي مبلغ/.test(strings));
  ok('the paywall exposes one live announcement path instead of announcing twice',
    !/announceForAccessibility/.test(pro) && /accessibilityLiveRegion="polite"/.test(pro));
}

/* ── a background mode Apple will reject the binary for ─────────────────────
 *
 * App Store Connect refused build 1.0.0 (6) with error 90771: declaring
 * `processing` in UIBackgroundModes obliges the app to list
 * `BGTaskSchedulerPermittedIdentifiers`, and it did not.
 *
 * The honest fix was to remove the mode, not invent an identifier. `processing`
 * was added speculatively — the commit that added it called it "the
 * precondition for the relay's sync-back leg reaching the device" — but nothing
 * in this app ever calls BGTaskScheduler. The relay's wake is
 * `Notifications.registerTaskAsync`, which is a REMOTE NOTIFICATION task and
 * needs `remote-notification` alone. There is no BGTask to permit.
 *
 * Nothing local could have caught it: typecheck, lint, 3,296 assertions and a
 * web export never touch Info.plist, and the Android APK never reads
 * UIBackgroundModes. The first signal was an upload rejected 40 minutes after
 * a build finished.
 *
 * So the invariant is the pair, in both directions: `processing` obliges the
 * identifier list, and a background mode must correspond to something the app
 * actually does.
 */
{
  const app = JSON.parse(fs.readFileSync(path.join(__dirname, '../../app.json'), 'utf8'));
  const info = app.expo?.ios?.infoPlist ?? {};
  const modes = info.UIBackgroundModes ?? [];
  const ids = info.BGTaskSchedulerPermittedIdentifiers ?? [];

  ok('`processing` is declared only with the identifiers Apple demands for it',
    !modes.includes('processing') || (Array.isArray(ids) && ids.length > 0),
    'App Store Connect error 90771 — either list BGTaskSchedulerPermittedIdentifiers ' +
      'or drop the mode');

  // The other direction: identifiers listed for a mode that is not declared are
  // dead config that reads as though a scheduler is running.
  ok('no BGTaskScheduler identifiers without the mode that uses them',
    ids.length === 0 || modes.includes('processing'));

  // And a mode nothing uses is a capability claimed for nothing. This is the
  // one the rejection was really about.
  const src = fs.readFileSync(
    path.join(__dirname, '../../src/lib/background-relay.ts'),
    'utf8',
  );
  ok('the declared background mode matches how the app actually wakes',
    modes.includes('remote-notification') && /registerTaskAsync/.test(src),
    'the relay wake is a remote-notification task; that is the mode it needs');
}

/* ── the one line without which neither platform can be built ───────────────
 *
 * `expo.extra.eas.projectId` is the UUID tying this checkout to a project on
 * EAS servers. EAS CLI reads it from the app config and no environment
 * variable substitutes for it, so without it `eas build --non-interactive`
 * cannot resolve what it is building.
 *
 * It was added by "Link the app to an EAS project so it can be built", and it
 * has never been on main: it lives on `integration/combine-prs` and was lost
 * in the merge that rebuilt app.json. `ios-testflight.yml` therefore could
 * never have worked from main, and the first run to get past its EXPO_TOKEN
 * check died fourteen seconds later on this instead.
 *
 * Nothing in `npm test` covered it. `scripts/check-release-config.mjs` does,
 * but that is `npm run release:check` — a command someone has to remember, at
 * release time, which is months after the line goes missing. This is the same
 * shape as the Info.plist rejection: a config value no test read, whose
 * absence only ever surfaced from a build service.
 *
 * Its reach is wider than iOS. `EXPO_PROJECT_ID` in server/wrangler.toml is
 * the relay's copy of this same UUID, and the Worker refuses push
 * registration without it — so a missing projectId also means silent
 * no-op push on both platforms.
 */
{
  const app = JSON.parse(
    fs.readFileSync(path.join(__dirname, '../../app.json'), 'utf8'),
  ).expo ?? {};
  const projectId = app.extra?.eas?.projectId ?? '';
  ok('app.json links the app to an EAS project',
    /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(projectId),
    `expo.extra.eas.projectId is ${projectId ? `"${projectId}"` : 'missing'}`);
  // The bundle identifier is the other half a build cannot start without, and
  // unlike the UUID it can never be changed after the first submission.
  ok('app.json declares the iOS bundle identifier',
    app.ios?.bundleIdentifier === 'app.wafra.ios',
    `expo.ios.bundleIdentifier is ${app.ios?.bundleIdentifier ?? 'missing'}`);

  /**
   * And the relay's copy of the same UUID is the same UUID.
   *
   * Expo's push service scopes a token to a project. The app registers under
   * `expo.extra.eas.projectId`; the Worker addresses wakes using
   * `EXPO_PROJECT_ID` from server/wrangler.toml. Two different values means
   * every wake is sent to a project the device is not registered under —
   * accepted by the API, delivered to nobody.
   *
   * There is no error to see. Capture keeps working on foreground and
   * background sync, so the only symptom is alerts arriving later than they
   * should, on a schedule nobody chose. Nothing on either side can notice,
   * because neither file can see the other; a test is the only place the two
   * are ever compared.
   */
  const wrangler = fs.readFileSync(
    path.join(__dirname, '../../server/wrangler.toml'),
    'utf8',
  );
  // The [vars] assignment, not the prose above it — the comment block there
  // spells out a placeholder UUID, and a scan that could not tell them apart
  // would pass on the documentation rather than the configuration.
  const relayId = wrangler
    .split('\n')
    .filter((line) => !/^\s*#/.test(line))
    .map((line) => line.match(/^\s*EXPO_PROJECT_ID\s*=\s*"([^"]+)"/)?.[1])
    .find(Boolean) ?? '';
  ok('the relay is pointed at the same EAS project as the app',
    relayId === projectId,
    `wrangler.toml has ${relayId || '(unset — the Worker registers no push tokens)'}, app.json has ${projectId}`);
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
  /**
   * And `runner` before the steps that own it.
   *
   * The same failure a second time, from a different context. `WORK: ${{
   * runner.temp }}/feedback` in a job-level `env:` block is not a runtime
   * error — `runner` exists only inside a step, so GitHub refused the whole
   * file and the workflow never registered. The dispatch was accepted and
   * matched nothing, exactly as before, and a schema validator passes it
   * happily because the shape is fine and only the context is wrong.
   *
   * Checked positionally: a `runner.` expression must come after the `steps:`
   * that introduces the scope it lives in. That under-reports in a file whose
   * SECOND job declares env after the first job's steps — it would be missed —
   * and it is still worth having, because the shape it does catch is the one
   * that has now cost two deploys.
   */
  const earlyRunner = [];
  for (const file of files) {
    const lines = fs.readFileSync(path.join(dir, file), 'utf8').split('\n');
    let stepsAt = -1;
    lines.forEach((raw, n) => {
      // Comments stripped first — a whole-line one, and a trailing one. The
      // comment on the very line this check exists to protect NAMES the thing
      // it forbids, and a scan that cannot tell prose from code would force
      // that explanation to be deleted to stay green. The SQLCipher step-order
      // check in db.test.js was broken the same way, by the same author, an
      // hour earlier.
      const line = /^\s*#/.test(raw) ? '' : raw.replace(/\s+#.*$/, '');
      if (stepsAt < 0 && /^\s{4}steps:\s*$/.test(line)) stepsAt = n;
      if (!/\$\{\{[^}]*(^|[^.\w])runner\s*\./.test(line)) return;
      if (stepsAt < 0 || n < stepsAt) earlyRunner.push(`${file}:${n + 1}`);
    });
  }
  /**
   * And an `env:` value that only LOOKS like a variable.
   *
   * `WORK: ${RUNNER_TEMP}/feedback` in a job-level `env:` block is a literal
   * string — GitHub passes env values through verbatim and no shell ever sees
   * them. `$WORK` therefore expanded to the characters `${RUNNER_TEMP}/feedback`,
   * a RELATIVE path, and the feedback report was written inside the git
   * workspace instead of the runner's temp directory. A `git add -A` two steps
   * later would have committed a user's bank SMS into a public pull request.
   *
   * Nothing failed. The directory was created, the file was written, the run
   * reached the agent. Only the location was wrong, and the only place it was
   * visible was one line of an env dump in the log.
   *
   * `${{ ... }}` is a GitHub expression and is fine; `${NAME}` and `$NAME` are
   * shell syntax and belong in a `run:` block, or in `$GITHUB_ENV` written by
   * one.
   */
  const literalEnv = [];
  for (const file of files) {
    const lines = fs.readFileSync(path.join(dir, file), 'utf8').split('\n');
    let inEnv = false;
    let envIndent = 0;
    lines.forEach((raw, n) => {
      const line = /^\s*#/.test(raw) ? '' : raw.replace(/\s+#.*$/, '');
      const opens = line.match(/^(\s*)env:\s*$/);
      if (opens) { inEnv = true; envIndent = opens[1].length; return; }
      if (inEnv && line.trim() && (line.length - line.trimStart().length) <= envIndent) inEnv = false;
      if (!inEnv) return;
      // `${{ }}` first, so a GitHub expression is never mistaken for a shell one.
      const withoutExpressions = line.replace(/\$\{\{[^}]*\}\}/g, '');
      if (/\$\{?[A-Za-z_][A-Za-z0-9_]*\}?/.test(withoutExpressions)) {
        literalEnv.push(`${file}:${n + 1} ${line.trim()}`);
      }
    });
  }
  ok('no env: value expects a shell to expand it',
    literalEnv.length === 0,
    literalEnv.slice(0, 3).join(' | '));

  ok('no workflow reads the runner context outside a step',
    earlyRunner.length === 0,
    earlyRunner.slice(0, 3).join(' | '));

  ok(`no workflow reads the bare inputs context (${files.length} files)`,
    offenders.length === 0,
    offenders.slice(0, 3).join(' | '));
}

/* ── uncertain inspectors can reach review, never automatic import ─────── */
{
  const shipping = [...sources('src'), ...sources('server/src')];
  const alertConsumers = shipping
    .filter((file) => !file.endsWith(`${path.sep}alert-draft.ts`) &&
      !file.endsWith(`${path.sep}alert-market-pack-types.ts`) &&
      !file.endsWith(`${path.sep}alert-semantics.ts`))
    .filter((file) => /(?:from\s+|require\(\s*|import\(\s*)['"][^'"]*alert-draft['"]/.test(
      fs.readFileSync(file, 'utf8'),
    ));
  const metadataConsumers = shipping
    .filter((file) => !file.endsWith(`${path.sep}alert-draft.ts`) &&
      !file.endsWith(`${path.sep}currency-metadata.ts`) &&
      !file.endsWith(`${path.sep}ledger-money.ts`) &&
      !file.endsWith(`${path.sep}alert-market-pack-types.ts`) &&
      !file.endsWith(`${path.sep}alert-rollout.ts`))
    .filter((file) => /(?:from\s+|require\(\s*|import\(\s*)['"][^'"]*currency-metadata['"]/.test(
      fs.readFileSync(file, 'utf8'),
    ));
  const marketReviewConsumers = shipping
    .filter((file) => !file.endsWith(`${path.sep}alert-semantics.ts`) &&
      !file.endsWith(`${path.sep}alert-market-packs.ts`) &&
      !file.endsWith(`${path.sep}alert-market-packs.us-eu.ts`) &&
      !file.endsWith(`${path.sep}alert-market-packs.india-me.ts`) &&
      !file.endsWith(`${path.sep}alert-market-detection.ts`) &&
      !file.endsWith(`${path.sep}alert-rollout.ts`))
    .filter((file) => /(?:from\s+|require\(\s*|import\(\s*)['"][^'"]*(?:alert-semantics|alert-market-packs|alert-rollout)['"]/.test(
      fs.readFileSync(file, 'utf8'),
    ));
  const launchFallback = read('src/lib/unparsed-launch-alert.ts');
  const aiSuggestion = read('src/lib/alert-ai-suggestion.ts');
  const capture = read('src/lib/auto-import.ts');
  ok('only the sanitized Gulf fallback consumes alert drafts in shipping capture',
    alertConsumers.length === 1 &&
      alertConsumers[0].endsWith(`${path.sep}unparsed-launch-alert.ts`),
    alertConsumers.join(' | '));
  ok('the Gulf fallback can reach only the explicit encrypted review path',
    !/(?:from\s+|require\(\s*|import\(\s*)['"][^'"]*(?:store|import-plan|ledger-import)['"]/.test(
      launchFallback,
    ) &&
      /prepareLaunchReviewAlert/.test(capture) &&
      /reviewCandidates\.push\(\{ \.\.\.reviewPrepared, \.\.\.identity \}\)/.test(capture),
    'an uncertain alert must never become parsed or mutate the ledger directly');
  ok('ISO draft metadata reaches shipping code only through the isolated inspector',
    metadataConsumers.length === 0, metadataConsumers.join(' | '));
  ok('first-wave market review logic has no shipping importer',
    marketReviewConsumers.length === 0, marketReviewConsumers.join(' | '));
  ok('optional alert AI can suggest labels but has no network or ledger write capability',
    !/(?:fetch\s*\(|https?:|XMLHttpRequest|WebSocket|(?:from\s+|require\(\s*|import\(\s*)['"][^'"]*(?:store|import-plan|ledger-import))/.test(
      aiSuggestion,
    ) && /FORBIDDEN_OUTPUT_KEYS/.test(aiSuggestion) && /constrainAlertAiProposal/.test(aiSuggestion),
    'AI suggestions must remain local, optional, and outside the money/import boundary');
}

/* ── a manual workflow run cannot bypass third-party-AI consent ─────────── */
{
  const root = path.join(__dirname, '../..');
  const workflow = fs.readFileSync(
    path.join(root, '.github/workflows/feedback-agent.yml'),
    'utf8',
  );
  const prompt = fs.readFileSync(
    path.join(root, '.github/scripts/feedback-prompt.mjs'),
    'utf8',
  );
  ok('the workflow checks explicit AI consent after fetching the report',
    /Verify explicit third-party AI consent/.test(workflow) &&
    /item\.aiReviewConsent !== true/.test(workflow) &&
    /diagnostic\?\.delivery\?\.thirdPartyAi === true/.test(workflow));
  ok('the prompt builder independently refuses reports without AI consent',
    /item\.aiReviewConsent !== true/.test(prompt) &&
    /diagnostic\?\.delivery\?\.thirdPartyAi !== true/.test(prompt) &&
    /process\.exit\(1\)/.test(prompt));
}

/* ── what the prompt demands, the flags must permit ─────────────────────────
 *
 * feedback-agent.yml hands the agent a prompt that requires it to run
 * `npm test` and to write `$RUNNER_TEMP/feedback/SUMMARY.md`. The flags it ran
 * under granted neither: `--permission-mode acceptEdits` allows unprompted
 * file edits inside the checkout and nothing more — no shell, and nothing
 * outside the workspace — and `--print` means there is no human to approve
 * either one, so both were refused mid-turn.
 *
 * Nothing about that looked like a misconfiguration. The agent found a real
 * defect, added a real failing test, wrote a real fix, and the red-then-green
 * gate went green on all of it. The run then died at the summary gate, seven
 * minutes and two full suite runs later, and the only account of why was one
 * sentence of the agent's own prose in the log.
 *
 * These two files are edited independently — one is YAML, one is a template
 * string — and the coupling between them is invisible in either. So it is
 * asserted: read what the prompt asks for out of the prompt, and require the
 * workflow to grant exactly that.
 */
{
  const root = path.join(__dirname, '../..');
  const wfPath = '.github/workflows/feedback-agent.yml';
  const promptPath = '.github/scripts/feedback-prompt.mjs';
  const prompt = fs.readFileSync(path.join(root, promptPath), 'utf8');
  // Whole-line comments dropped before anything is matched. The comment block
  // above this check, and the one in the workflow, both NAME the flags at
  // issue; a scan that cannot tell prose from code would force the
  // explanations to be deleted to stay green. Third time this file has had to
  // learn that.
  const wf = fs.readFileSync(path.join(root, wfPath), 'utf8')
    .split('\n')
    .map((line) => (/^\s*#/.test(line) ? '' : line))
    .join('\n');

  // Anchored on the invocation itself, not on the flags appearing anywhere in
  // the file, so a flag mentioned in prose cannot satisfy it.
  const invocation = (wf.match(/^\s*claude \$CLAUDE_ARGS\b.*$/m) ?? [''])[0];
  const args = (wf.match(/^\s*CLAUDE_ARGS:\s*'([^']*)'/m) ?? [null, ''])[1];
  ok('the agent is actually invoked', invocation.length > 0 && args.length > 0, wfPath);

  // The prompt names the summary as a path under the work directory it is
  // given. A path outside the checkout needs --add-dir; the CLI refuses to
  // write there otherwise, and refuses quietly enough that the first sign is
  // a missing file two steps later.
  const writesOutsideCheckout = /\$\{workDir\}\/SUMMARY\.md/.test(prompt);
  ok('the prompt asks for a summary outside the checkout', writesOutsideCheckout, promptPath);
  ok('the agent is given access to the directory the prompt tells it to write into',
    !writesOutsideCheckout || /--add-dir\s+"\$WORK"/.test(invocation),
    `${wfPath}: claude ... --add-dir "$WORK"`);

  // Same shape for the shell. `acceptEdits` is not a superset of Bash.
  const bypass = /--permission-mode\s+bypassPermissions|--dangerously-skip-permissions/.test(args);
  // Variadic, so the list runs from the flag to the next one. Commas are split
  // as well as spaces: the CLI accepts both spellings, and a guard that
  // understood only one would fail a correct file.
  const allowed = [];
  for (const token of ((args.match(/--allowed-tools\s+(.*)$/) ?? [null, ''])[1]).split(/[\s,]+/)) {
    if (!token) continue;
    if (token.startsWith('--')) break;
    allowed.push(token);
  }
  const needsShell = /npm test/.test(prompt);
  ok('the prompt requires the agent to run the suite', needsShell, promptPath);
  ok('the agent is permitted the shell the prompt requires',
    !needsShell || bypass || allowed.includes('Bash'),
    `${wfPath}: CLAUDE_ARGS = ${args}`);
  // Write is separately gated from Edit, and SUMMARY.md is a new file.
  ok('the agent is permitted to create files, not only edit them',
    bypass || (allowed.includes('Write') && allowed.includes('Edit')),
    `${wfPath}: CLAUDE_ARGS = ${args}`);

  /**
   * And the agent's own prose stays off the public log.
   *
   * Rule 1 at the top of that workflow is that the user's words do not leave
   * the runner, and the file broke it: the agent's stdout was `| tee`'d, so
   * every sentence it wrote after reading a bank alert went straight into an
   * Actions log that is as public as the repository. The verbatim gate cannot
   * help — it guards the pull request body and the diff, both of which come
   * later. Redirect, never tee.
   */
  ok('the agent output is captured, not published',
    />\s*"\$WORK\/agent\.log"/.test(invocation) && !/\btee\b/.test(invocation),
    `${wfPath}: ${invocation.trim()}`);

  /**
   * And a refused pull request does not take the summary down with it.
   *
   * `gh pr create` is the last call of the run. On a repository with "Allow
   * GitHub Actions to create and approve pull requests" turned off it answers
   * `not permitted`, and under `set -e` that ended the step — after the agent
   * turn, two full suite runs and the verbatim gate had all passed, and with
   * the branch already on the remote. Everything of value survived except the
   * one thing that only existed in $RUNNER_TEMP: the body.
   *
   * It is safe to print at that point and only at that point, because the
   * verbatim gate two steps earlier has already cleared it.
   */
  ok('a refused pull request still publishes the body it would have used',
    /cat "\$WORK\/pr-body\.md"/.test(wf) && /compare\/\$\{branch\}/.test(wf),
    `${wfPath}: the gh failure path must survive to write the summary`);
}

console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
