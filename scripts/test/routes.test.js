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

  /**
   * And a pack it cannot apply says so on the row.
   *
   * `setActiveMarket` refuses a pack denominated differently from money the
   * ledger already holds, because switching would RELABEL every stored figure
   * rather than convert it — the same 125,050 fils printing "AED 1,250.50"
   * and then "SAR 1,250.50" — and there is no rate offline that could convert
   * a ledger of hand-entered amounts and statement balances. The refusal is
   * right; a refusal the user cannot see is not. `setMarket` changing nothing
   * is exactly as informative as the alert that never opened, so the picker
   * has to ask `canSelectMarket` BEFORE the tap and put the reason on the row.
   */
  ok('a country pack the ledger will not accept is refused visibly, not silently',
    /canSelectMarket\(/.test(settings) &&
      /disabled: !allowed/.test(settings) &&
      /tf\('marketPinned'/.test(settings));

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

/**
 * A button that commits something may not depend on an alert to do it.
 *
 * Same defect as the region pickers above, one screen further on. On
 * react-native-web `Alert.alert` is `static alert() {}` — an empty method, no
 * dialog, no warning, no throw. An alert-driven CHOOSER opens nothing, which
 * is bad; an alert-driven CONFIRMATION is worse, because the work itself sits
 * in `onPress` of a button that is never drawn. "Mark paid", "Pay", "Delete"
 * and "Remove" were all in that state: the store call was unreachable code in
 * the web export and the tap did nothing at all, in silence.
 *
 * What is pinned here is the property, not the fix. The previous version of
 * this file asserted that `Alert.alert` was PRESENT and therefore locked the
 * bug in; asserting the opposite — that no alert survives anywhere — would be
 * the same mistake mirrored, because an alert that only REPORTS costs a
 * message, not an action. So: find every alert call, and check that no
 * committing action is inside one. A screen may keep an alert; it may not put
 * the commit in it.
 *
 * Two scanning rules, both learned the hard way:
 *  • comments are stripped first, or the comment explaining why an alert is
 *    not used here fails the scan for alerts;
 *  • nothing is sliced between markers. Each check is anchored on the thing
 *    itself — the call, the element — so moving code around cannot fake a
 *    pass or invent a failure.
 */
{
  const read = (rel) => fs.readFileSync(path.join(SRC, rel), 'utf8');
  const code = (text) => text.replace(/\/\*[\s\S]*?\*\//g, '').replace(/\/\/[^\n]*/g, '');

  /** The argument list of every `Alert.alert(...)`, balanced across nesting. */
  function alertCalls(text) {
    const out = [];
    const re = /\bAlert\.alert\s*\(/g;
    let m;
    while ((m = re.exec(text))) {
      let depth = 1;
      let i = re.lastIndex;
      let quote = null;
      for (; i < text.length && depth > 0; i += 1) {
        const c = text[i];
        if (quote) {
          if (c === '\\') i += 1;
          else if (c === quote) quote = null;
          continue;
        }
        if (c === "'" || c === '"' || c === '`') quote = c;
        else if (c === '(') depth += 1;
        else if (c === ')') depth -= 1;
      }
      out.push(text.slice(re.lastIndex, i - 1));
    }
    return out;
  }

  // Everything on these three screens that changes stored state or money.
  const COMMITS = [
    'markBillPaid',
    'payCardDue',
    'deleteBill',
    'setNotSubscription',
    'addBill',
    'purchasePro',
    'restorePro',
    'setPro',
  ];

  const screens = {
    'app/(tabs)/bills.tsx': ['markBillPaid', 'payCardDue', 'deleteBill', 'setNotSubscription'],
    'components/card-payment-sheet.tsx': ['payCardDue'],
    'app/pro.tsx': ['purchasePro', 'restorePro'],
  };

  for (const [rel, expected] of Object.entries(screens)) {
    const src = code(read(rel));
    const inAlerts = [];
    for (const args of alertCalls(src)) {
      for (const id of COMMITS) {
        if (new RegExp(`\\b${id}\\s*\\(`).test(args)) inAlerts.push(`${rel}: ${id}`);
      }
    }
    ok(`${rel} commits nothing from inside an alert`, inAlerts.length === 0, inAlerts.join(' | '));

    // And the scan is not vacuously green because the action was renamed away
    // from under it: each screen still performs the work it is checked for.
    const missing = expected.filter((id) => !new RegExp(`\\b${id}\\s*\\(`).test(src));
    ok(`${rel} still performs its committing actions (${expected.length})`,
      missing.length === 0, missing.join(' | '));
  }

  {
    const bills = code(read('app/(tabs)/bills.tsx'));
    // Each commit hangs off a confirmation the screen draws itself, and the
    // one sheet that renders them is handed that same callback.
    const wired = [
      /onConfirm: \(\) =>\s*markBillPaid\(/,
      /onConfirm: \(\) =>\s*payCardDue\(/,
      /onConfirm: \(\) =>\s*deleteBill\(/,
      /onConfirm: \(\) =>\s*setNotSubscription\(/,
    ].filter((re) => re.test(bills));
    ok(`every Bills commit hangs off a confirmation (${wired.length} of 4)`, wired.length === 4);
    ok('Bills draws the confirmation it gates on',
      /<ConfirmSheet[\s\S]{0,600}onConfirm=\{confirmation\.onConfirm\}/.test(bills));

    // The wording is the part of this that was never broken. Pin the keys so a
    // later rewrite of the mechanism cannot quietly take the copy with it.
    const keys = [
      'markBillPaidTitle', 'billRecordsExpense', 'payAccountTitle', 'payAccountBody',
      'deleteReminderTitle', 'deleteReminderBody', 'notASubscriptionQ', 'removeSubscriptionBody',
    ];
    const lost = keys.filter((k) => !bills.includes(`'${k}'`));
    ok(`Bills still says what it always said (${keys.length} strings)`, lost.length === 0,
      lost.join(' | '));
  }

  {
    const sheet = code(read('components/card-payment-sheet.tsx'));
    ok('the card sheet files its payment from a drawn confirmation',
      /const filePayment = \(\) => \{[\s\S]{0,500}payCardDue\(/.test(sheet) &&
        /<ConfirmSheet[\s\S]{0,600}onConfirm=\{filePayment\}/.test(sheet));

    // The two notices that only report were not left silent either: they are
    // drawn in the sheet, where an alert would have shown nothing on web.
    ok('the reminder answers are shown in the sheet rather than announced',
      /setNotice\(\{ title: t\('notifsAreOff'\)/.test(sheet) &&
        /title: t\('reminderSet'\)/.test(sheet) &&
        /\{notice && \(/.test(sheet));

    const keys = ['markStatementPaid', 'fileCardPaymentBody', 'notifsForCardDue', 'cardReminderBody'];
    const lost = keys.filter((k) => !sheet.includes(`'${k}'`));
    ok(`the card sheet still says what it always said (${keys.length} strings)`,
      lost.length === 0, lost.join(' | '));
  }

  {
    const pro = code(read('app/pro.tsx'));
    // The paywall's five answers report, they do not ask — so they are drawn
    // inline rather than in a sheet. What matters is that a tap on the two
    // buttons that sell the app can never again produce nothing.
    const outcomes = [
      "title: t('playOnlyTitle')",
      "title: t('nothingToRestore')",
      "title: t('purchaseFailed')",
      "title: t('restoreFailed')",
      "title: t('noPurchaseFound')",
    ].filter((s) => pro.includes(s));
    ok(`every paywall outcome reaches the screen (${outcomes.length} of 5)`, outcomes.length === 5);
    ok('the paywall renders the answer it just produced', /\{notice && \(/.test(pro));
  }

  {
    // The sheet itself is drawn, like ChoiceSheet, and offers the shape
    // ChoiceSheet does not: confirm or cancel, with a destructive variant.
    const confirm = code(read('components/ui/confirm-sheet.tsx'));
    ok('the confirmation sheet is drawn, not delegated',
      /<BottomSheet/.test(confirm) && !/\bAlert\b/.test(confirm));
    ok('the confirmation sheet offers a way out and a destructive variant',
      /cancelLabel \?\? t\('cancel'/.test(confirm) &&
        /variant=\{destructive \? 'danger' : 'filled'\}/.test(confirm));
  }
}

console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
