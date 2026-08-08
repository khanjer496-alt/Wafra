/**
 * Every route the app navigates to must have a file behind it.
 *
 * expo-router resolves a name with no file to "Unmatched Route". There is no
 * compile error and no warning — the string is just a string — so a screen
 * that was renamed or moved leaves working-looking buttons that can only
 * fail, and nobody finds out until a user taps one.
 *
 * This has now happened twice. First a root `bills` screen kept its <Stack>
 * entry after bills.tsx moved into (tabs). Then a budget warning's own "See
 * the breakdown" button pointed at `/budgets`, which has never existed at
 * all — the one button on the one card the app puts in front of you when
 * you overspend.
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

const APP = path.join(__dirname, '../../src/app');
const SRC = path.join(__dirname, '../../src');

/** Every route expo-router will resolve, from the files on disk. */
function routes(dir = APP, prefix = '') {
  const out = new Set();
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) {
      // A (group) directory does not appear in the URL.
      const next = /^\(.*\)$/.test(entry.name) ? prefix : `${prefix}/${entry.name}`;
      for (const r of routes(full, next)) out.add(r);
      continue;
    }
    if (!/\.tsx?$/.test(entry.name)) continue;
    const base = entry.name.replace(/\.tsx?$/, '');
    if (base === '_layout') continue;
    out.add(base === 'index' ? prefix || '/' : `${prefix}/${base}`);
  }
  return out;
}

const available = routes();
ok('the route table was read off disk', available.size >= 8, [...available].join(' '));
ok('the tab routes are there', ['/', '/flow', '/bills', '/wallet'].every((r) => available.has(r)),
  [...available].join(' '));

/** Every file under src/, so nothing is missed by only checking screens. */
function sources(dir = SRC) {
  const out = [];
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) out.push(...sources(full));
    else if (/\.tsx?$/.test(entry.name)) out.push(full);
  }
  return out;
}

{
  // Literal router.push('/x') / router.replace('/x') targets. Template
  // literals are skipped deliberately: their path is not knowable here, and
  // a test that guessed at them would be worse than one that says so.
  const bad = [];
  for (const file of sources()) {
    const text = fs.readFileSync(file, 'utf8');
    const re = /router\.(?:push|replace)\(\s*'([^']+)'/g;
    let m;
    while ((m = re.exec(text))) {
      const route = m[1].split('?')[0];
      if (!available.has(route)) bad.push(`${path.relative(SRC, file)} → ${route}`);
    }
  }
  ok('every route the app pushes to exists', bad.length === 0, bad.join(' | '));
}

{
  // The insight destinations are declared as a list precisely so this can
  // check them — they are reached through a variable, so the scan above
  // cannot see them.
  const text = fs.readFileSync(path.join(SRC, 'lib/insights.ts'), 'utf8');
  const decl = text.match(/INSIGHT_DESTINATIONS = \[([^\]]*)\]/);
  ok('the insight destinations are declared in one place', !!decl);
  const declared = decl ? [...decl[1].matchAll(/'([^']+)'/g)].map((m) => m[1]) : [];
  const bad = declared.filter((r) => !available.has(r));
  ok('every insight destination exists', declared.length > 0 && bad.length === 0, bad.join(' | '));

  // Every href goes through `dest()`, whose first argument is a plain literal.
  // That is the whole reason the helper exists: a template literal assembled
  // at the call site would carry a real route AND be invisible here, which is
  // how "/budgets" survived for months.
  const used = [...text.matchAll(/\bdest\(\s*'([^']+)'/g)].map((m) => m[1]);
  ok('every insight destination is built from a declared route', used.length > 0
    && used.every((r) => declared.includes(r)), used.filter((r) => !declared.includes(r)).join(' | '));

  // Every insight the builder can produce must carry one. An insight without
  // an href still draws no chevron, but the "See the breakdown" button on Home
  // is unconditional and falls back to '/flow'.
  const pushed = (text.match(/insights\.push\(\{/g) ?? []).length;
  const withHref = (text.match(/href: dest\(/g) ?? []).length;
  ok(`every insight the builder pushes carries a destination (${withHref} of ${pushed})`,
    pushed > 0 && withHref === pushed);

  /**
   * And none of them may be '/flow'.
   *
   * "Worth knowing" is rendered ON Flow, so `router.push('/flow')` from a card
   * there is a no-op: the row keeps its chevron and does nothing, forever.
   * That is the state the app was left in after the /stats and /budgets fix —
   * the dead route became a dead tap, which no route table can catch.
   */
  ok('no insight sends you to the screen the insight list is drawn on',
    !used.includes('/flow'), used.filter((r) => r === '/flow').join(' | '));
}

/**
 * Settings: what a control PROMISES has to be what it does.
 *
 * A chevron is this app's "a screen opens here" affordance, and Settings had
 * three rows wearing one while doing something else. Country cycled the market
 * pack on a single tap — the same stored 125050 fils printing "AED 1,250.50"
 * before it and "SAR 1,250.50" after, nothing converted, no confirmation.
 * Language did the same to the whole UI and mirrored the layout, so a mis-tap
 * left the escape route unreadable. And "Erase all data" sat one hairline
 * below "Sort your shops" wearing the same chevron, separated only by colour.
 *
 * None of that is reachable from a unit test — it is layout, and the failure
 * is a user's thumb. What IS reachable is the shape of the file, so this
 * checks the shape: that the mutating cycles are gone, that the destructive
 * action is a button standing alone at the end, and that a row which leads to
 * the paywall says so before it is tapped rather than after.
 */
{
  const settings = fs.readFileSync(path.join(SRC, 'app/settings.tsx'), 'utf8');
  const at = (needle) => settings.indexOf(needle);

  ok('neither region row mutates the setting on tap',
    !/cycleMarket|cycleLanguage/.test(settings) &&
      /<ChoiceSheet[\s\S]{0,400}title=\{t\('country'\)\}/.test(settings) &&
      /<ChoiceSheet[\s\S]{0,400}title=\{t\('language'\)\}/.test(settings));

  /**
   * And the picker may not be an alert.
   *
   * The first fix for the cycles used `Alert.alert` with one button per
   * option, which looked right and was inert where it mattered:
   * react-native-web's Alert is `static alert() {}` — an empty method, no
   * warning, no error — so in the web export both rows opened nothing at all.
   * That is strictly worse than the cycle it replaced, and it shipped green
   * because the unit test above pinned the alert as the fix. Android also
   * draws at most three alert buttons, which two country packs plus Cancel
   * already exhausts. Pin the sheet, not the alert.
   */
  ok('the region pickers are drawn, not delegated to Alert',
    !/const chooseMarket|const chooseLanguage|const chooseExpenseReportPeriod/.test(settings));

  // Every pack in MARKETS has to be offered, or the picker is a cycle with
  // extra steps: naming one country and cycling to "the other" is the same
  // silent mutation in a sheet.
  ok('the country picker offers every pack rather than the next one',
    /MARKETS\.map\(/.test(settings) && !/MARKETS\[\(i \+ 1\)/.test(settings));

  ok('both languages are named in the language picker',
    /LANGUAGE_NAMES = \{ en: 'English', ar: '[^']+' \}/.test(settings) &&
      /\(\['en', 'ar'\] as const\)\.map\(/.test(settings));

  // The row now answers "which language am I in", which the old subtitle
  // ("English · العربية is available instantly") never did.
  ok('the language row shows the language that is on',
    /linkRow\(t\('language'\), LANGUAGE_NAMES\[language\]/.test(settings));

  ok('erase is a destructive button, not a chevron row',
    !/linkRow\(t\('eraseAll'\)/.test(settings) &&
      /<Button\s+label=\{t\('eraseAll'\)\}\s+variant="danger"/.test(settings));

  // Alone at the end: nothing routine may sit against it. "Sort your shops"
  // was its immediate neighbour.
  ok('erase stands after everything else on the screen',
    at("t('eraseAll')") > at("t('settingsTagline')") &&
      at("t('eraseAll')") > at("t('sortShops')"));

  // Every gated() call site carries the lock, or a free user learns which
  // rows are paid by being thrown at the paywall.
  {
    const gatedCalls = (settings.match(/\bgated\([a-zA-Z]/g) ?? []).length;
    const marked = (settings.match(/pro: true/g) ?? []).length;
    ok(`every paywalled row is marked as one (${marked} of ${gatedCalls})`,
      gatedCalls > 0 && marked === gatedCalls);
  }

  // The nightly digest and the per-charge banner are notification settings,
  // not privacy ones, and they are what people come here to switch off.
  ok('the notification switches are out of the Privacy group and above it',
    at("t('dailySummarySetting')") < at("t('privacyHeader')"));

  // Android's row and iPhone's row are mutually exclusive, so a user never
  // sees both — which is exactly why they must not have had two names.
  ok('the per-charge alert has one label on both platforms',
    !/chargeAlertsSetting/.test(settings) &&
      (settings.match(/t\('alertEveryCharge'\)/g) ?? []).length === 2);

  // pro.tsx documents the unlock as "seven taps on the version row in
  // Settings, which nobody reaches by accident". It had drifted onto the
  // brand mark, announced to VoiceOver as a button.
  ok('the founder unlock is on the version row, not the logo',
    /tapCount\.current >= 7/.test(settings) &&
      /<Pressable onPress=\{onVersionTap\}[\s\S]{0,120}Wafra \{version\}/.test(settings) &&
      !/<Pressable[^>]*>\s*<WafraMark/.test(settings));

  // A toggle row whose label and sub-line are dead text, beside link rows that
  // are tappable edge to edge, is a target the user has to find twice. The
  // handler belongs on the text and not on the Row: Row's own onPress makes it
  // one accessibilityRole="button" Pressable, which is an accessibility
  // element by default and would swallow the switch's on/off state.
  ok('a toggle row is tappable across its whole width, without eating the switch',
    /<Pressable\s+accessible=\{false\}[\s\S]{0,160}onChange\(!value\)/.test(settings) &&
      !/<Row last=\{last\} onPress=/.test(settings));

  // Android never revokes a permission on request, so the switch can only
  // snap back. Naming the path without opening it is a dead end.
  ok('the SMS revoke alert can open the system settings it names',
    /t\('smsRevokeHint'\)[\s\S]{0,200}Linking\.openSettings\(\)/.test(settings));

  // The salary-day grid was removed from Settings AND onboarding at the
  // owner's request (961684b). Its styles outlived it and kept this file
  // describing a screen it no longer was.
  ok('no styles survive for the removed money-month grid',
    !/monthHead|dayGrid|dayCell|dayChoice/.test(settings));
}

console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
