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
const home = read('src/app/(tabs)/index.tsx');
const settings = read('src/app/settings.tsx');
const add = read('src/app/add-transaction.tsx');
const store = read('src/lib/store.tsx');
const onboarding = read('src/components/onboarding-gate.tsx');
const copy = read('src/lib/i18n.ts');

ok('review route reads the structured tray directly',
  /state\.reviewTray\.pending/.test(route) && /type \{ ReviewAlert \}/.test(route));
ok('review route never reads or renders source-message fields',
  !/\.raw\b|\.sourceKey\b|\.sender\b|\.reasons\b/.test(route));
ok('review route offers explicit correction before promotion, never silent import',
  /pathname:\s*['"]\/add-transaction['"][\s\S]*reviewId/.test(route) &&
    /promoteReviewAlert/.test(add) && /reviewAlertOwnAccounts/.test(add) &&
    /reviewAlertDateA11y/.test(add) &&
    /type:\s*['"]promoteReviewAlert['"]/.test(store) &&
    /dismissReviewAlert\(item\.id, ['"]dismissed['"]\)/.test(route));
ok('review candidates require explicit choices unless a prior local correction supplies them',
  /rememberedReview\?\.accountId \?\? matchedAccount\?\.id \?\? ''/.test(add) &&
    /rememberedReview \? rememberedReview\.category as CategoryId : reviewItem \? reviewCategory/.test(add) &&
    /reviewTemplateRuleFor/.test(add) &&
    /!!category/.test(add) &&
    /reviewAlertChooseAccount/.test(add) &&
    /reviewAlertChooseCategory/.test(add));
ok('a review-only cash event defaults to the cash-withdrawal category',
  /family === 'cash-withdrawal'[\s\S]{0,80}\? 'cash-withdrawal'/.test(add));
ok('review amounts stay exact instead of crossing floating point',
  /minorUnits\.padStart/.test(route) &&
    !/Number\(minorUnits\)|parseFloat\(minorUnits\)|parseInt\(minorUnits\)/.test(route));
ok('review list follows native safe-area and scalable-list conventions',
  /<SafeAreaView[^>]*edges=\{\['top', 'bottom'\]\}/.test(route) &&
    /<FlatList/.test(route) && /keyExtractor=/.test(route) && /<ScreenHeader/.test(route));
ok('dismissal is an accessible 44-point confirmed action',
  /accessibilityRole="button"/.test(route) &&
    /accessibilityLabel=/.test(route) &&
    /accessibilityHint=/.test(route) &&
    /minHeight:\s*44/.test(route) &&
    /<ConfirmSheet[\s\S]*destructive/.test(route));
ok('structured-only privacy is visible on the route',
  /t\('reviewAlertsPrivacy'\)/.test(route) &&
    /The bank-alert text is not stored/.test(copy));

const captureAt = home.indexOf('<AutomaticCapture');
const reviewAt = home.indexOf('<ReviewAlertsPrompt');
ok('Home shows one aggregate review prompt below capture',
  /state\.reviewTray\.pending/.test(home) &&
    /reviewAlertsHomeCount/.test(home) &&
    captureAt >= 0 && reviewAt > captureAt &&
    /router\.push\('\/review-alerts'\)/.test(home));
ok('Home hides the prompt when there is nothing to review',
  /if \(count === 0\) return null/.test(home));
ok('Settings keeps a durable review-tray entry including the empty state',
  /state\.reviewTray\.pending/.test(settings) &&
    /reviewAlertsSettingsCount/.test(settings) &&
    /reviewAlertsNone/.test(settings) &&
    /router\.push\('\/review-alerts'\)/.test(settings));
ok('review copy is localized in both supported UI languages',
  /reviewAlertsTitle:\s*\{\s*en:[^\n]+ar:/.test(copy) &&
    /reviewAlertDismissQuestion:\s*\{\s*en:[^\n]+ar:/.test(copy));

ok('SMS access is visibly optional and the no-access path is explicit',
  /<StartOption automatic=\{false\}/.test(onboarding) &&
    /onboardManualChoice/.test(onboarding) &&
    /continueManually/.test(onboarding) &&
    /Maximum privacy · no SMS access/.test(copy) &&
    /Maximum privacy · no Messages access/.test(copy) &&
    /choose maximum privacy for no SMS access/i.test(copy));
ok('privacy copy explains filtering without alarming security-code language',
  /Android SMS alerts are processed on this phone/.test(copy) &&
    /short-lived encrypted queue/.test(copy) &&
    /never uploads SMS content/.test(copy) &&
    /cannot sign in to a bank/.test(copy) &&
    /encrypted relay parses them, discards raw text immediately/.test(copy) &&
    /privacySecurityExact/.test(settings));

console.log(`\n${pass} passed, ${fail} failed`);
if (fail) process.exit(1);
