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
  const defined = new Set(entries.map((e) => e[1]));
  const used = new Set();
  for (const file of sources('src')) {
    for (const m of fs.readFileSync(file, 'utf8').matchAll(/\bt\('([a-zA-Z0-9_]+)'\)/g)) used.add(m[1]);
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
    for (const m of text.matchAll(/[+-]?=\s*\w+\.type === 'income' \?/g)) {
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

console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
