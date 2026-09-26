/**
 * Interface contract for the structured-only review tray.
 *
 * The domain suite proves admission and retention. This pins the user-facing
 * boundary: one aggregate doorway, no raw alert rendering, no pretend ledger
 * promotion, accessible dismissal, and exact string-based minor-unit display.
 */
const fs = require('fs');
const path = require('path');

let pass = 0;
let fail = 0;
function ok(name, condition, detail = '') {
  if (condition) {
    pass += 1;
    console.log(`✓ ${name}`);
  } else {
    fail += 1;
    console.log(`✗ ${name}${detail ? ` — ${detail}` : ''}`);
  }
}

const ROOT = path.join(__dirname, '../..');
const read = (file) => fs.readFileSync(path.join(ROOT, file), 'utf8');
const route = read('src/app/review-alerts.tsx');
const home = read('src/screens/journal-home-screen.tsx');
const settings = read('src/app/settings.tsx');
const add = read('src/app/add-transaction.tsx');
const reviewFields = read('src/components/universal-review-fields.tsx');
const store = read('src/lib/store.tsx');
const onboarding = read('src/components/onboarding-gate.tsx');
const copy = read('src/lib/i18n.ts');

ok('review route reads the structured tray directly',
  /state\.reviewTray\.pending/.test(route) && /type ReviewEntry/.test(route) && /isUniversalReviewAlert/.test(route));
ok('review route never reads or renders source-message fields',
  !/\.raw\b|\.sourceKey\b|\.sender\b|\.reasons\b/.test(route));
ok('review route asks only for unresolved facts before promotion, never silent import',
  /pathname:\s*['"]\/add-transaction['"][\s\S]*reviewId/.test(route) &&
    /promoteReviewAlert/.test(add) && /reviewAlertOwnAccounts/.test(add) &&
    /reviewMoneyChoices/.test(add) && /observedReviewDate/.test(add) &&
    !/postedConfirmed/.test(add) && !/genericConfirmPosted/.test(reviewFields) &&
    /type:\s*['"]promoteReviewAlert['"]/.test(store) &&
    /dismissReviewAlert\(item\.id, ['"]dismissed['"]\)/.test(route));
ok('review candidates infer safe defaults and still expose genuinely ambiguous accounts',
  /rememberedReview\?\.accountId \?\? matchedAccount\?\.id \?\? ''/.test(add) &&
    /suggestUniversalCategory/.test(add) && /!categorySuggestion\.needsReview/.test(add) && /categorySupportsType\(reviewCategory, reviewType\)/.test(add) && /matchingAccounts\.length === 1/.test(add) &&
    /reviewTemplateRuleFor/.test(add) &&
    /: 'other' : 'groceries'/.test(add) &&
    /!reviewItem \|\| !matchedAccount \|\| event\?\.instrument\.evidence === 'ambiguous'/.test(add) &&
    /reviewAlertChooseAccount/.test(add) &&
    /!reviewItem \? <View[\s\S]{0,200}categoryRef/.test(add));
ok('a review-only cash event defaults to the cash-withdrawal category',
  /reviewFamily === 'cash-withdrawal'[\s\S]{0,80}\? 'cash-withdrawal'/.test(add));
ok('review amounts stay exact instead of crossing floating point',
  /minorUnits\.padStart/.test(route) &&
    !/Number\(minorUnits\)|parseFloat\(minorUnits\)|parseInt\(minorUnits\)/.test(route));
ok('review list follows native safe-area and scalable-list conventions',
  /<ScreenScaffold[\s\S]*scroll=\{false\}[\s\S]*virtualized[\s\S]*headerMode="native"/.test(route) &&
    /useScreenContentInsets\(\{ hasFooter: false \}\)/.test(route) &&
    /<FlatList/.test(route) && /keyExtractor=/.test(route) &&
    /contentContainerStyle=\{\[listInsets\.contentContainerStyle,/.test(route) &&
    /contentInset=\{listInsets\.contentInset\}/.test(route) &&
    /scrollIndicatorInsets=\{listInsets\.scrollIndicatorInsets\}/.test(route) &&
    /contentInsetAdjustmentBehavior="automatic"/.test(route));
ok('dismissal is an accessible 44-point confirmed action',
  /accessibilityRole="button"/.test(route) &&
    /accessibilityLabel=/.test(route) &&
    /accessibilityHint=/.test(route) &&
    Number(route.match(/dismissButton:\s*\{[\s\S]*?minHeight:\s*(\d+)/)?.[1]) >= 44 &&
    /<ConfirmSheet[\s\S]*destructive/.test(route));
ok('structured-only privacy is visible on the route',
  /t\('reviewAlertsPrivacy'\)/.test(route) &&
    /The bank-alert text is not stored/.test(copy));

const captureAt = home.indexOf('testID="journal-import-controls"');
ok('Home keeps parser exceptions out of the primary money experience',
  captureAt >= 0 &&
    !/reviewCount/.test(home) &&
    !/router\.push\('\/review-alerts'\)/.test(home));
ok('review remains an exception workflow rather than a Home status concept',
  !/state\.reviewTray\.pending/.test(home) &&
    /state\.reviewTray\.pending/.test(settings));
ok('Settings exposes pending reviews without promoting an empty destination',
  /state\.reviewTray\.pending/.test(settings) &&
    /reviewAlertsSettingsCount/.test(settings) &&
    /reviewAlertCount > 0 && linkRow\(/.test(settings) &&
    /router\.push\('\/review-alerts'\)/.test(settings));
ok('review copy is localized in both supported UI languages',
  /reviewAlertsTitle:\s*\{\s*en:[^\n]+ar:/.test(copy) &&
    /reviewAlertDismissQuestion:\s*\{\s*en:[^\n]+ar:/.test(copy));
ok('capacity, expiry and currency-skip notices are localized and counted, never silent',
  ['reviewAlertsFullWaiting', 'reviewAlertsExpiredCount', 'reviewAlertsCurrencySkipped', 'reviewAlertExpiresIn']
    .every((key) => new RegExp(`${key}:\\s*\\{\\s*en: '[^'\\n]*\\{count\\}[^'\\n]*', ar: '[^'\\n]*\\{count\\}[^'\\n]*'`).test(copy)) &&
    /reviewCaptureBacklog\.subscribe/.test(route) && /reviewTrayCapacity\(state\.reviewTray, now\)/.test(route) &&
    /recentlyExpiredReviewCount\(state\.reviewTray, now\)/.test(route) &&
    /reviewExpiresInDays\(item, Date\.now\(\)\)/.test(route) &&
    /accessibilityLiveRegion="polite"/.test(route));

// Design language E: "I'll add by hand" sits beside every automatic source on
// the first-payment step, and says there is no message access.
ok('SMS access is visibly optional and the no-access path is explicit',
  /<SourceRow palette=\{stepBand\} icon="plus" title=\{words\.addByHand\} body=\{words\.addByHandBody\}[\s\S]{0,160}runSetupAction\(continueManually\)/.test(onboarding) &&
    /addByHandBody: 'No message access\./.test(read('src/lib/onboarding-e-copy.ts')) &&
    /continueManually/.test(onboarding) &&
    /onboardManualChoiceBody:[\s\S]{0,180}No SMS access/.test(copy) &&
    /onboardManualChoiceIosBody:[\s\S]{0,180}No Messages access/.test(copy) &&
    /setCaptureOptOut\(true\)/.test(onboarding));
ok('privacy copy explains filtering without alarming security-code language',
  /Android SMS alerts are processed on this phone/.test(copy) &&
    /short-lived encrypted queue/.test(copy) &&
    /never uploads SMS content/.test(copy) &&
    /cannot sign in to a bank/.test(copy) &&
    /encrypted relay parses them, discards raw text immediately/.test(copy) &&
    /privacySecurityExact/.test(settings));

console.log(`\n${pass} passed, ${fail} failed`);
if (fail) process.exit(1);
