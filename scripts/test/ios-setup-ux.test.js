const fs = require('node:fs');
const path = require('node:path');
const ts = require('typescript');

let pass = 0;
let fail = 0;

const ok = (name, condition, detail = '') => {
  if (condition) {
    pass += 1;
    console.log(`✓ ${name}`);
    return;
  }
  fail += 1;
  console.log(`✗ ${name}${detail ? `\n    ${detail}` : ''}`);
};
const eq = (name, actual, expected) => ok(
  name,
  JSON.stringify(actual) === JSON.stringify(expected),
  `${JSON.stringify(actual)} != ${JSON.stringify(expected)}`,
);

const ROOT = path.join(__dirname, '../..');
const read = (relative) => fs.readFileSync(path.join(ROOT, relative), 'utf8');
const execute = (relative) => {
  const filename = path.join(ROOT, relative);
  const output = ts.transpileModule(read(relative), {
    compilerOptions: {
      module: ts.ModuleKind.CommonJS,
      target: ts.ScriptTarget.ES2022,
      esModuleInterop: true,
    },
    fileName: filename,
  }).outputText;
  const loaded = { exports: {} };
  Function('require', 'module', 'exports', '__filename', '__dirname', output)(
    () => ({}),
    loaded,
    loaded.exports,
    filename,
    path.dirname(filename),
  );
  return loaded.exports;
};

const screen = read('src/app/ios-setup.tsx');
const controller = read('src/lib/ios-capture-setup.ts');
const protocol = read('src/lib/ios-local-capture-protocol.ts');
const controls = read('src/components/ui/controls.tsx');
const copy = execute('src/lib/i18n.ts');
const translated = (key, lang) => copy.t(key, lang);

const stepList = screen.match(
  /const STEPS:[\s\S]*?=\s*\[([\s\S]*?)\]\s*as const;/,
)?.[1] ?? '';
const stepKeys = [...stepList.matchAll(/'(iosLocalStep\w+)'/g)]
  .map((match) => match[1]);
eq('iOS local setup: progress has exactly two stages',
  stepKeys, ['iosLocalStepShortcut', 'iosLocalStepAutomation']);
eq('iOS local setup: stage names are localized',
  stepKeys.map((key) => [translated(key, 'en'), translated(key, 'ar')]), [
    ['Add Shortcut', 'إضافة الاختصار'],
    ['Message automation', 'أتمتة الرسائل'],
  ]);

const choiceKeys = [
  'iosLocalChoiceMessage',
  'iosLocalChoiceAnySender',
  'iosLocalChoiceContainsEmpty',
  'iosLocalChoiceImmediate',
  'iosLocalChoiceRunShortcut',
  'iosLocalChoiceCompleteMessage',
];
eq('iOS local setup: English shows every exact Apple choice',
  choiceKeys.map((key) => translated(key, 'en')), [
    'Message',
    'Any Sender',
    'Message Contains: leave empty',
    'Run Immediately',
    'Run Shortcut → Wafra Local Capture',
    'Input → complete Received Message',
  ]);
eq('iOS local setup: Arabic shows every exact Apple choice',
  choiceKeys.map((key) => translated(key, 'ar')), [
    'رسالة',
    'أي مرسل',
    '«تحتوي الرسالة»: اتركه فارغاً',
    '«تشغيل فوراً»',
    'تشغيل اختصار ← Wafra Local Capture',
    'الإدخال ← «الرسالة المستلمة» كاملة',
  ]);
ok('iOS local setup: all exact choices are rendered in the guide',
  [...(screen.match(
    /const AUTOMATION_CHOICES:[\s\S]*?=\s*\[([\s\S]*?)\]\s*as const;/,
  )?.[1] ?? '').matchAll(/'(iosLocalChoice\w+)'/g)]
    .map((match) => match[1]).join('|') === choiceKeys.join('|') &&
    /AUTOMATION_CHOICES\.map\([\s\S]{0,1400}\{t\(key\)\}/.test(screen));

const forbiddenScreenPatterns = [
  /expo-clipboard|Clipboard/,
  /background-relay|pairDevice|unpairDevice|relayUrl|ingestUrl|tokenPreview/,
  /requestSilentCapturePermission|push-permission|push-registration/,
  /shortcutSetupCode|setup code|setup JSON/i,
  /getActiveMarket|bank conversations|Contacts/,
  /Disconnect this iPhone|safe server test|private pipe test/i,
];
ok('iOS local setup: obsolete relay and sender-picker work is absent',
  forbiddenScreenPatterns.every((pattern) => !pattern.test(screen)),
  forbiddenScreenPatterns.filter((pattern) => pattern.test(screen)).map(String).join(', '));
ok('iOS local setup: controller has only local native and Linking dependencies',
  !/relay|clipboard|notification|background|CaptureExecutor|ledger|leavePrivateMode/i.test(controller) &&
    /getNativeModule/.test(controller) &&
    /getCaptureStatus/.test(controller) &&
    /setCaptureEnabled/.test(controller));

ok('iOS local setup: install CTA is gated by support, module health, and published URL',
  /supported\s*&&\s*shortcutAvailable\s*&&\s*failure !== 'load'/.test(screen) &&
    /label=\{t\('iosLocalInstallShortcut'\)\}/.test(screen));
ok('iOS local setup: unavailable and unsupported states keep honest fallback copy',
  /iosLocalUnsupported/.test(screen) &&
    /iosLocalShortcutUnavailable/.test(screen) &&
    /failure === 'load' && !manualExitFailed && !manualExiting[\s\S]{0,240}iosLocalUpdateRequired/.test(screen));
ok('iOS local setup: manual-disable failure stays visible without duplicating shortcut load copy',
  /const error = manualExitFailed\s*\? t\('iosLocalManualExitFailed'\)/.test(screen) &&
    /failure === 'load' && stage === 'shortcut'/.test(screen) &&
    /failure === 'load' && !manualExitFailed && !manualExiting/.test(screen));

ok('iOS local setup: one privacy-safe annotated automation guide is rendered',
  (screen.match(/accessibilityLabel=\{automationGuideLabel\(\)\}/g) || []).length === 1 &&
    (screen.match(/styles\.automationGuide/g) || []).length >= 1);
ok('iOS local setup: the guide accessibility label speaks every exact choice',
  /function automationGuideLabel\(\): string \{[\s\S]{0,300}AUTOMATION_CHOICES\.map\(\(key\) => t\(key\)\)/.test(screen));
eq('iOS local setup: the guide has a localized non-sensitive accessibility label',
  [translated('iosLocalAutomationGuideLabel', 'en'),
    translated('iosLocalAutomationGuideLabel', 'ar')], [
    'Illustrated guide to the six Message automation choices. No message content is shown.',
    'دليل مصوّر لخيارات أتمتة الرسائل الستة. لا يظهر أي محتوى للرسائل.',
  ]);

ok('iOS local setup: manual tracking and history import are outside both stage branches',
  /label=\{t\('iosLocalManualTracking'\)\}[\s\S]{0,400}label=\{t\('iosLocalImportPast'\)\}/.test(screen) &&
    screen.indexOf("label={t('iosLocalManualTracking')}") >
      screen.lastIndexOf("stage === 'automation'") &&
    /router\.(push|replace)\('\/import-sms'\)/.test(screen) &&
    /router\.(push|replace)\('\/add-transaction'\)/.test(screen));
ok('iOS local setup: past-alert import does not opt out or disable live capture',
  /const importPastAlerts = useCallback\(\(\) => \{[\s\S]{0,180}router\.push\('\/import-sms'\);[\s\S]{0,180}\},/.test(screen) &&
    !/const importPastAlerts[\s\S]{0,360}(?:manual-only|setCaptureOptOut)/.test(screen));
const manualFlowAt = screen.indexOf('const continueManually = useCallback');
const manualDisableAt = screen.indexOf("await send({ type: 'manual-only' })", manualFlowAt);
const manualOptOutAt = screen.indexOf('await setCaptureOptOut(true)', manualDisableAt);
const manualRouteAt = screen.indexOf("router.replace('/?onboarding=complete')", manualOptOutAt);
ok('iOS local setup: manual-only waits for native disable and durable opt-out before routing',
  manualFlowAt !== -1 && manualDisableAt > manualFlowAt &&
    manualOptOutAt > manualDisableAt && manualRouteAt > manualOptOutAt);
ok('iOS local setup: repeated manual taps join the complete disable-opt-out-route operation',
  /manualExitInFlight = useRef<Promise<void> \| null>\(null\)/.test(screen) &&
    /if \(manualExitInFlight\.current\) return manualExitInFlight\.current/.test(screen) &&
    /manualExitInFlight\.current = operation\.finally/.test(screen));
ok('iOS local setup: manual-exit busy state spans opt-out persistence and routing',
  /setManualExiting\(true\)[\s\S]{0,240}const operation/.test(screen) &&
    /operation\.finally\([\s\S]{0,180}setManualExiting\(false\)/.test(screen) &&
    /const actionsBlocked = opening \|\| manualExiting/.test(screen));
ok('iOS local setup: manual exit blocks every competing action and header navigation',
  (screen.match(/if \(manualExitInFlight\.current\) return;/g) || []).length >= 7 &&
    (screen.match(/disabled=\{actionsBlocked\}/g) || []).length >= 8 &&
    /pointerEvents=\{manualExiting \? 'none' : 'auto'\}/.test(screen));
ok('iOS local setup: manual exit blocks back-swipe and an unmounted handler cannot reroute',
  /<Stack\.Screen options=\{\{ gestureEnabled: !manualExiting \}\}/.test(screen) &&
    /screenActive\.current = false/.test(screen) &&
    /if \(!screenActive\.current\) return;[\s\S]{0,180}router\.(push|replace)/.test(screen));
ok('iOS local setup: durable opt-out failure is explicitly announced to VoiceOver',
  /await setCaptureOptOut\(true\)[\s\S]{0,180}catch \{[\s\S]{0,180}AccessibilityInfo\.announceForAccessibility\(t\('iosLocalManualExitFailed'\)\)/.test(screen));

ok('iOS local setup: every sentence-length action wraps',
  [
    'iosLocalInstallShortcut',
    'iosLocalAlreadyAdded',
    'iosLocalOpenAutomation',
    'iosLocalAutomationAdded',
    'iosLocalManualTracking',
    'iosLocalImportPast',
  ].every((key) =>
    new RegExp(`label=\\{t\\('${key}'\\)\\}[\\s\\S]{0,180}wrapLabel`).test(screen)) &&
    /wrapLabel = false[\s\S]{0,1600}numberOfLines=\{wrapLabel \? undefined : 1\}/.test(controls));
ok('iOS local setup: shared actions retain the 48pt minimum target',
  /minHeight:\s*48/.test(controls));
ok('iOS local setup: the whole screen scrolls and respects both safe edges',
  /<SafeAreaView[\s\S]{0,120}edges=\{\['top', 'bottom'\]\}/.test(screen) &&
    /<ScrollView[\s\S]{0,180}contentInsetAdjustmentBehavior="automatic"/.test(screen));
ok('iOS local setup: large Dynamic Type changes layout instead of clipping',
  /useLargeTextLayout/.test(screen) &&
    /const largeText = useLargeTextLayout\(\)/.test(screen) &&
    /largeText \? styles\.[A-Za-z]+ : undefined/.test(screen));
ok('iOS local setup: progress exposes numeric accessibility value',
  /accessibilityRole="progressbar"/.test(screen) &&
    /accessibilityValue=\{\{\s*min:\s*1,\s*max:\s*STEPS\.length,\s*now:\s*stepIndex \+ 1/.test(screen));
ok('iOS local setup: meaningful status changes are announced to VoiceOver',
  /AccessibilityInfo\.announceForAccessibility/.test(screen) &&
    /readiness !== previous\.readiness/.test(screen) &&
    /failure !== previous\.failure/.test(screen));
ok('iOS local setup: no unguarded entrance animation can hide the instructions',
  !/FadeIn|entering=/.test(screen));

ok('iOS local setup: callbacks and foreground transitions only refresh native status',
  /send\(\{ type: 'shortcut-callback', result \}\)/.test(screen) &&
    /RNAppState\.addEventListener\('change'/.test(screen) &&
    /next === 'active'[\s\S]{0,120}send\(\{ type: 'refresh-status' \}\)/.test(screen));
ok('iOS local setup: explicit automation confirmation is the only visible enable path',
  /send\(\{ type: 'automation-added' \}\)/.test(screen) &&
    !/setIosCaptureEnabled\(true\)/.test(screen));

eq('iOS local setup: synthetic proof never claims the automation trigger was verified',
  [translated('iosLocalWaitingTitle', 'en'), translated('iosLocalWaitingBody', 'en')], [
    'Ready — waiting for the first bank alert',
    'The Shortcut test worked. Only a real future bank alert can prove Apple’s Message automation ran.',
  ]);
eq('iOS local setup: first qualifying alert has a local-only success state',
  translated('iosLocalFirstAlertCaptured', 'en'),
  'First bank alert captured locally');
eq('iOS local setup: milestone copy covers every durable qualifying outcome',
  translated('iosLocalFirstAlertBody', 'en'),
  'Wafra durably processed the first qualifying alert on this iPhone. It may have been filed, reviewed, reconciled, or recognized as an existing entry.');
eq('iOS local setup: privacy copy states queue retention and no upload precisely',
  translated('iosLocalPrivacyBody', 'en'),
  'Apple does not give Wafra general access to your Messages inbox; only the personal automation can pass a newly arriving Message. Wafra filters and parses bank-alert candidates on this iPhone. During local parsing, Wafra uses the complete Message Content and, when the Shortcut supplies it, the bank Sender label; that label is used to identify its card or account. After successful local processing, Wafra discards raw Message Content after parsing, along with the Sender label, and keeps only structured transaction fields. If processing cannot finish, accepted raw text and sender stay in the protected encrypted queue; they expire after 30 days and are removed the next time capture runs or Wafra checks the queue. The new local capture path does not upload them.');
eq('iOS local setup: migration copy discloses the old upload until retirement',
  translated('iosLocalMigrationBody', 'en'),
  'If you still have the old “Wafra Capture” automation, it can continue uploading the bank alerts you selected until you delete it or Wafra confirms retirement after the first local bank alert.');
ok('iOS local setup: Arabic privacy copy includes local processing, 30 days, and migration',
  /الآيفون/.test(translated('iosLocalPrivacyBody', 'ar')) &&
    /وصولاً عاماً/.test(translated('iosLocalPrivacyBody', 'ar')) &&
    /بعد نجاح المعالجة المحلية/.test(translated('iosLocalPrivacyBody', 'ar')) &&
    /٣٠ يوماً/.test(translated('iosLocalPrivacyBody', 'ar')) &&
    /لا يرفع/.test(translated('iosLocalPrivacyBody', 'ar')) &&
    /Wafra Capture/.test(translated('iosLocalMigrationBody', 'ar')) &&
    /رفع/.test(translated('iosLocalMigrationBody', 'ar')));

ok('iOS local setup: protocol is independent of the retired relay URL helper',
  !/DEFAULT_SHORTCUT_URL|@\/lib\/relay/.test(protocol) &&
    /EXPO_PUBLIC_WAFRA_SHORTCUT_URL/.test(protocol) &&
    /03d2ab22a33f4fef9d503142575a70fb/.test(protocol));

console.log(`\nios-setup-ux: ${pass} passed, ${fail} failed`);
if (fail) process.exit(1);
