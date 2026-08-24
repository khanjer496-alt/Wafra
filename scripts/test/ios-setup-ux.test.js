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

const execute = (relative, requireModule = () => ({})) => {
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
    requireModule,
    loaded,
    loaded.exports,
    filename,
    path.dirname(filename),
  );
  return loaded.exports;
};

const screen = read('src/app/ios-setup.tsx');
const settings = read('src/app/settings.tsx');
const autoImportSource = read('src/hooks/use-auto-import.ts');
const controls = read('src/components/ui/controls.tsx');
const copy = execute('src/lib/i18n.ts');

const translated = (key, lang) => {
  try {
    return copy.t(key, lang);
  } catch {
    return undefined;
  }
};

// A progress label is a promise about what happens next. This exact order
// catches the old Automation → Test flow returning while the body copy claims
// the safe probe happens first.
const stepList = screen.match(
  /const STEPS:[\s\S]*?=\s*\[([\s\S]*?)\]\s*as const;/,
)?.[1] ?? '';
const stepKeys = [...stepList.matchAll(/'(iosStep\w+)'/g)].map((match) => match[1]);
eq(
  'iOS setup: the visible sequence is Connect → Add Shortcut → Safe test → Automation',
  stepKeys,
  ['iosStepConnect', 'iosStepShortcut', 'iosStepTest', 'iosStepAutomation'],
);

eq('iOS setup: the Shortcut step names the artifact plainly in English',
  translated('iosStepShortcut', 'en'), 'Add Wafra Capture');
eq('iOS setup: the Shortcut step names the artifact plainly in Arabic',
  translated('iosStepShortcut', 'ar'), 'أضف «Wafra Capture»');
eq('iOS setup: the safe-test step is explicit in both languages',
  [translated('iosStepTest', 'en'), translated('iosStepTest', 'ar')],
  ['Safe test', 'اختبار آمن']);
eq('iOS setup: the safe test prepares both languages for Apple’s one-time network prompt',
  [translated('iosTestBody', 'en'), translated('iosTestBody', 'ar')],
  [
    'Wafra Capture sends a harmless probe through the private pipe. The first time, tap Allow when Apple asks for network access. It does not add a transaction.',
    'يرسل «Wafra Capture» اختباراً آمناً عبر المسار الخاص. في المرة الأولى، اضغط «سماح» عندما تطلب Apple الوصول إلى الشبكة. ولا يضيف أي عملية.',
  ]);
eq('iOS setup: the last step is a Message automation in both languages',
  [translated('iosStepAutomation', 'en'), translated('iosStepAutomation', 'ar')],
  ['Message automation', 'أتمتة الرسائل']);

const shortcutStep = screen.match(
  /\{step === 1 && paired && \([\s\S]*?\n\s*\)\}\n\n\s*\{step === 2/,
)?.[0] ?? '';
ok('iOS setup: the add-Shortcut step contains no premature automation choices',
  !/iosAutomation|iosSenderCaveat|iosRunFor/.test(shortcutStep));

// Opening an install URL is only a handoff. A rejected handoff on this mounted
// attempt blocks confirmation, but a clean remount must remain recoverable for
// a user who really installed the Shortcut before iOS reclaimed Wafra.
ok(
  'iOS setup: current handoff failures block confirmation without a remount-only dead end',
  !/installHandoffSucceeded/.test(screen) &&
    /const shortcutAdvanceBlocked\s*=\s*[\s\S]{0,180}failure === 'shortcut-install'[\s\S]{0,160}failure === 'shortcuts-missing'/.test(screen) &&
    /label=\{t\('iosInstalledIt'\)\}[\s\S]{0,220}disabled=\{shortcutAdvanceBlocked\}/.test(screen),
);

ok('iOS setup: consumes each typed Shortcut callback through the controller',
  /shortcutResult\?: string/.test(screen) &&
    /result !== 'success'[\s\S]{0,180}result !== 'cancel'[\s\S]{0,180}result !== 'error'/.test(screen) &&
    /consumedShortcutCallback/.test(screen) &&
    /send\(\{ type: 'shortcut-callback', result \}\)/.test(screen));
ok('iOS setup: preserves onboarding context in Shortcut callback URLs',
  /createIosCaptureSetup\(\{[\s\S]{0,500}fromOnboarding:\s*params\.fromOnboarding === '1'/.test(screen));
ok('iOS setup: waits for controller load before consuming a cold Shortcut callback',
  /useEffect\(\(\) => \{[\s\S]{0,120}if \(setup\.loading\) return;[\s\S]{0,700}shortcut-callback/.test(screen) &&
    /\[[^\]]*setup\.loading[^\]]*\]/.test(screen));

eq('iOS setup: missing Apple Shortcuts has specific English recovery',
  [translated('iosShortcutsMissing', 'en'), translated('iosShortcutsMissingRecovery', 'en')],
  [
    'Apple Shortcuts is not installed.',
    'Install Shortcuts from the App Store, return to Wafra, and try this step again.',
  ]);
eq('iOS setup: missing Apple Shortcuts has specific Arabic recovery',
  [translated('iosShortcutsMissing', 'ar'), translated('iosShortcutsMissingRecovery', 'ar')],
  [
    'تطبيق «الاختصارات» من Apple غير مثبّت.',
    'ثبّت «الاختصارات» من App Store، ثم عد إلى وفرة وأعد محاولة هذه الخطوة.',
  ]);

eq('iOS setup: install confirmation stays short enough for Dynamic Type',
  [translated('iosInstalledIt', 'en'), translated('iosInstalledIt', 'ar')],
  ['I added Wafra Capture', 'أضفت «Wafra Capture»']);
ok('iOS setup: install confirmation is disabled while setup data is being persisted',
  /const shortcutAdvanceBlocked\s*=\s*[\s\S]{0,180}preparing/.test(screen) &&
    /label=\{t\('iosInstalledIt'\)\}[\s\S]{0,220}disabled=\{shortcutAdvanceBlocked\}/.test(screen));
ok('iOS setup: VoiceOver explicitly announces meaningful asynchronous outcomes',
  /AccessibilityInfo/.test(screen) &&
    /AccessibilityInfo\.announceForAccessibility\(announcements\.join/.test(screen) &&
    /failure[\s\S]{0,1000}captured[\s\S]{0,1000}timedOut[\s\S]{0,1000}automationActive[\s\S]{0,1000}automationPrepared[\s\S]{0,1000}listening/.test(screen));
ok('iOS setup: VoiceOver announces each new step and a successful copy',
  /const announcements: string\[\] = \[\]/.test(screen) &&
    /step !== previous\.step[\s\S]{0,240}announcements\.push\([\s\S]{0,160}iosStepProgress/.test(screen) &&
    /automationActive && !previous\.automationActive[\s\S]{0,180}announcements\.push/.test(screen) &&
    /copied && copied !== previous\.copied[\s\S]{0,120}iosCopied/.test(screen) &&
    /announceForAccessibility\(announcements\.join/.test(screen));
ok('iOS setup: sentence-length actions wrap instead of clipping at large Dynamic Type',
    /label=\{t\('iosContinueManual'\)\}[\s\S]{0,180}wrapLabel/.test(screen) &&
    /label=\{t\('iosSkipForNow'\)\}[\s\S]{0,180}wrapLabel/.test(screen) &&
    /label=\{shortcutAvailable \? t\('iosOpenShortcut'\)[\s\S]{0,220}wrapLabel/.test(screen) &&
    /label=\{t\('iosContinueToAutomation'\)\}[\s\S]{0,180}wrapLabel/.test(screen) &&
    /label=\{t\('iosAutomationReadyTest'\)\}[\s\S]{0,220}wrapLabel/.test(screen) &&
    /wrapLabel = false[\s\S]{0,1600}numberOfLines=\{wrapLabel \? undefined : 1\}/.test(controls));
ok('iOS setup: credential and install actions are disabled during disconnect',
  /onPress=\{disconnecting \|\| preparing \? undefined : \(\) => void copy\('setup'\)\}/.test(screen) &&
    /label=\{shortcutAvailable \? t\('iosOpenShortcut'\)[\s\S]{0,260}disabled=\{disconnecting \|\| preparing\}/.test(screen) &&
    /const shortcutAdvanceBlocked\s*=\s*[\s\S]{0,180}disconnecting/.test(screen));
eq('iOS setup: disconnect progress is named correctly in both languages',
  [translated('iosDisconnecting', 'en'), translated('iosDisconnecting', 'ar')],
  ['Disconnecting…', 'جارٍ الفصل…']);
ok('iOS setup: disconnect never reads as a new connection',
  /label=\{disconnecting \? t\('iosDisconnecting'\) : t\('iosDisconnect'\)\}/.test(screen));

// The safe test proves only the pipe. It must lead forward to Apple's manual
// automation step, never to Done or an "on" claim.
const safeTestStep = screen.match(
  /\{step === 2 && \([\s\S]*?\n\s*\)\}\n\n\s*\{step === 3/,
)?.[0] ?? '';
ok('iOS setup: safe-test success continues to Message automation',
  /captured \|\| captureOn/.test(safeTestStep) &&
    /send\(\{ type: 'continue-to-automation' \}\)/.test(screen) &&
    /iosContinueToAutomation/.test(safeTestStep));
ok('iOS setup: safe-test success does not finish setup',
  !/captured[\s\S]{0,180}<Button[^>]+iosDone/.test(safeTestStep) &&
    !/captureOn[\s\S]{0,180}<Button[^>]+iosDone/.test(safeTestStep));

// The controller deliberately exposes three truths. Only the strongest one,
// backed by getRelayAutomationProof(deviceId), may select automatic-capture
// success copy; user attestation and the synthetic probe remain weaker.
ok('iOS setup: automatic success copy is gated by automationActive',
  /automationActive\s*\?\s*t\('iosAlreadyWorkingTitle'\)/.test(screen) &&
    /automationActive\s*\?\s*t\('iosAlreadyWorkingBody'\)/.test(screen) &&
    !/captureOn\s*\?\s*t\('iosAlreadyWorkingTitle'\)/.test(screen));
ok('iOS setup: prepared-but-unproven automation has an honest waiting state',
  /automationPrepared[\s\S]{0,160}iosAutomationWaitingTitle/.test(screen) &&
    /automationPrepared[\s\S]{0,160}iosAutomationWaitingBody/.test(screen));
eq('iOS setup: safe-pipe copy does not claim automatic capture is working',
  translated('iosTestCaught', 'en'),
  'The Shortcut, relay, and encrypted sync are verified. Automatic capture is not verified yet; create the Message automation next.');
eq('iOS setup: safe-pipe detail puts automation creation before the real-alert proof',
  translated('iosTestLimit', 'en'),
  'The Shortcut and private sync work. Create the Message automation next. The first supported bank alert is the final check: it should appear under the correct bank or card.');
eq('iOS setup: prepared copy names the only honest remaining proof',
  translated('iosAutomationWaitingBody', 'en'),
  'Wafra cannot create or inspect Apple’s automation. The next supported bank alert will prove that its Message trigger ran. Until then, automatic capture is not verified.');

// Exercise the real status decision independently of React. Mutating the
// verified/no-proof branch to active must fail this table.
const autoImport = execute('src/hooks/use-auto-import.ts', () => ({}));
ok('capture status: the iOS evidence resolver is exported',
  typeof autoImport.resolveIosCaptureSurfaceState === 'function');
if (typeof autoImport.resolveIosCaptureSurfaceState === 'function') {
  const resolve = autoImport.resolveIosCaptureSurfaceState;
  eq('capture status: a safe-pipe proof is not active automation', resolve({
    hasConfig: true,
    setupState: 'verified',
    automationProofCurrent: false,
    revokedAt: null,
  }), 'pipe-ready');
  eq('capture status: a real Shortcut row proves active automation', resolve({
    hasConfig: true,
    setupState: 'verified',
    automationProofCurrent: true,
    revokedAt: null,
  }), 'active');
  eq('capture status: revocation outranks stale automation proof', resolve({
    hasConfig: false,
    setupState: null,
    automationProofCurrent: true,
    revokedAt: 1_800_000_000_001,
  }), 'revoked');
}

ok('Home status: validates proof freshness instead of accepting any old marker',
  /isRelayAutomationProofCurrent\(cfg, automationProof\)/.test(autoImportSource) &&
    !/cfg\?\.setupState === 'verified' && automationProof\b/.test(autoImportSource));
ok('Home status: refreshes on foreground even when inbox scanning is throttled',
  /RNAppState\.addEventListener\('change',[\s\S]{0,260}next === 'active'[\s\S]{0,180}refreshCaptureStatus/.test(autoImportSource));

ok('Settings: reads the device-bound automation proof beside relay config',
  /getRelayAutomationProof/.test(settings) &&
    /getRelayAutomationProof\(cfg\?\.deviceId \?\? null\)/.test(settings));
ok('Settings: pipe verified and automation proven have different status facts',
  /settingStatusAutomationVerified/.test(settings) &&
    /settingStatusPipeVerified/.test(settings) &&
    /relayAutomationProof/.test(settings));
ok('Settings: the capture row distinguishes the same two iOS states',
  /iosAutomationVerified[\s\S]{0,180}captureIosOn/.test(settings) &&
    /captureIosPipeReady/.test(settings));
ok('Settings: validates proof against the current device setup generation',
  /isRelayAutomationProofCurrent\([\s\S]{0,80}relay \?\? null,[\s\S]{0,80}relayAutomationProof \?\? null[\s\S]{0,20}\)/.test(settings));
ok('Settings: refreshes relay truth when Wafra becomes active again',
  /RNAppState\.addEventListener\('change',[\s\S]{0,260}next === 'active'[\s\S]{0,180}refreshRelayStatus/.test(settings));

ok('iOS setup: missing Shortcuts does not also offer a generic Shortcut reinstall',
  /recovery === 'shortcut'\s*&&\s*failure !== 'shortcuts-missing'/.test(safeTestStep));

eq('status copy: Home and Settings name pipe proof without claiming automation',
  [translated('captureIosPipeReady', 'en'), translated('settingStatusPipeVerified', 'en')],
  [
    'Private pipe verified · Message automation not proven yet',
    'Pipe verified',
  ]);
eq('status copy: Home and Settings name proof from a real automation row',
  [translated('captureIosOn', 'en'), translated('settingStatusAutomationVerified', 'en')],
  [
    'Message automation verified by a bank alert',
    'Automation verified',
  ]);

console.log(`\nios-setup-ux: ${pass} passed, ${fail} failed`);
if (fail) process.exit(1);
