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
const eq = (name, actual, expected) =>
  ok(
    name,
    JSON.stringify(actual) === JSON.stringify(expected),
    `${JSON.stringify(actual)} != ${JSON.stringify(expected)}`,
  );
const deferred = () => {
  let resolve;
  let reject;
  const promise = new Promise((yes, no) => {
    resolve = yes;
    reject = no;
  });
  return { promise, resolve, reject };
};

const ROOT = path.join(__dirname, '../..');
const read = (relative) => fs.readFileSync(path.join(ROOT, relative), 'utf8');
const execute = (relative, dependencies = {}) => {
  const filename = path.join(ROOT, relative);
  const output = ts.transpileModule(read(relative), {
    compilerOptions: {
      module: ts.ModuleKind.CommonJS,
      target: ts.ScriptTarget.ES2022,
      esModuleInterop: true,
      jsx: ts.JsxEmit.ReactJSX,
    },
    fileName: filename,
  }).outputText;
  const loaded = { exports: {} };
  Function(
    'require',
    'module',
    'exports',
    '__filename',
    '__dirname',
    output,
  )(
    (request) => dependencies[request] ?? {},
    loaded,
    loaded.exports,
    filename,
    path.dirname(filename),
  );
  return loaded.exports;
};

const screen = read('src/app/ios-setup.tsx');
const settingsScreen = read('src/app/settings.tsx');
const storageRecovery = read('src/components/storage-recovery.tsx');
const controller = read('src/lib/ios-capture-setup.ts');
const protocol = read('src/lib/ios-local-capture-protocol.ts');
const controls = read('src/components/ui/controls.tsx');
const checklistRowPath = path.join(
  ROOT,
  'src/components/ios-message-setup/checklist-row.tsx',
);
const detailsSheetPath = path.join(
  ROOT,
  'src/components/ios-message-setup/details-sheet.tsx',
);
const checklistRow = fs.existsSync(checklistRowPath)
  ? read('src/components/ios-message-setup/checklist-row.tsx')
  : '';
const detailsSheet = fs.existsSync(detailsSheetPath)
  ? read('src/components/ios-message-setup/details-sheet.tsx')
  : '';
const copy = execute('src/lib/i18n.ts');
const translated = (key, lang) => {
  try {
    return copy.t(key, lang);
  } catch {
    return undefined;
  }
};

ok('iOS message setup: checklist row and details sheet are separate components',
  checklistRow.length > 0 && detailsSheet.length > 0);
eq('iOS message setup: one checklist contains exactly the Future and Past rows',
  [
    (screen.match(/testID="ios-message-setup-checklist"/g) || []).length,
    (screen.match(/<ChecklistRow/g) || []).length,
  ], [1, 2]);
ok('iOS message setup: both required sections are named plainly and only the active row expands',
  screen.indexOf("title={t('iosMessageFutureTitle')}") >= 0 &&
    screen.indexOf("title={t('iosMessageFutureTitle')}") <
      screen.indexOf("title={t('iosMessagePastTitle')}") &&
    /expanded=\{progress\.activeSection === 'future'\}/.test(screen) &&
    /expanded=\{progress\.activeSection === 'history'\}/.test(screen) &&
    translated('iosMessageFutureTitle', 'en') === 'Future alerts' &&
    translated('iosMessagePastTitle', 'en') === 'Past alerts');
ok('iOS message setup: checklist rows retain 44pt targets without clipping text',
  Number(checklistRow.match(/header:\s*\{\s*minHeight:\s*(\d+)/)?.[1]) >= 44 &&
    !/numberOfLines/.test(checklistRow) &&
    /accessibilityState=\{\{ expanded \}\}/.test(checklistRow) &&
    /accessibilityValue=\{\{ text: t\(statusKey\) \}\}/.test(checklistRow));
eq('iOS message setup: every checklist status has localized VoiceOver copy', [
  translated('iosMessageStatusNotStarted', 'en'),
  translated('iosMessageStatusInProgress', 'en'),
  translated('iosMessageStatusComplete', 'en'),
  translated('iosMessageStatusSkipped', 'en'),
], ['Not started', 'In progress', 'Complete', 'Not finished']);
eq('iOS message setup: compact navigation title and page heading stay distinct', [
  translated('iosSetupTitle', 'en'),
  translated('iosMessageSetupHeading', 'en'),
], ['Bank alerts', 'Bank messages']);

const futureGuideKeys = [
  'iosMessageGuideMessage',
  'iosMessageGuideSender',
  'iosMessageGuideImmediate',
  'iosMessageGuideRunShortcut',
];
eq('iOS message setup: Future guide has the four exact sender-scoped choices',
  futureGuideKeys.map((key) => translated(key, 'en')), [
    'Message',
    'Choose bank senders',
    'Run Immediately',
    'Run Wafra Local Capture · full Received Message',
  ]);
ok('iOS message setup: obsolete universal-trigger instructions are absent',
  !/Any Sender|iosLocalChoiceAnySender|iosLocalChoiceContainsEmpty/.test(
    [screen, detailsSheet, read('src/lib/i18n.ts')].join('\n'),
  ));

eq('iOS message setup: Future actions use the exact staged labels', [
  translated('iosLocalInstallShortcut', 'en'),
  translated('iosLocalAlreadyAdded', 'en'),
  translated('iosLocalOpenAutomation', 'en'),
  translated('iosLocalAutomationAdded', 'en'),
], [
  'Add Shortcut',
  'I added it',
  'Open Shortcuts',
  'I set it up',
]);
eq('iOS message setup: harmless proof remains honest about the real trigger',
  translated('iosLocalWaitingTitle', 'en'),
  'Waiting for first alert');
ok('iOS message setup: completion copy never calls the automation verified',
  !/verified|trigger worked|automation worked/i.test(
    [translated('iosLocalWaitingTitle', 'en'), translated('iosLocalWaitingBody', 'en')].join(' '),
  ));
ok('iOS message setup: Help explains unavailable bank senders',
  /iosMessageSenderUnavailable/.test(detailsSheet) &&
    translated('iosMessageSenderUnavailable', 'en')?.includes(
      'Apple cannot automate this sender.',
    ));

eq('iOS message setup: Past row keeps only the compact inline disclosures', [
  translated('iosMessagePastDetail', 'en'),
  translated('iosMessagePastTiming', 'en'),
], [
  'Checks retained Messages on this iPhone.',
  'Large histories: 20–25 min',
]);
eq('iOS message setup: History actions use the install, confirm, and start labels', [
  translated('historyAddAction', 'en'),
  translated('historyAddedAction', 'en'),
  translated('historyStartAction', 'en'),
], [
  'Add history Shortcut',
  'Continue after adding',
  'Import history',
]);
ok('iOS message setup: History uses the existing iOS 26 setup and handoff APIs',
  /iosSupportsMessageHistory\(Platform\.Version\)/.test(screen) &&
    /historyShortcutInstallUrl\(\)/.test(screen) &&
    /confirmIosHistoryShortcutInstalled/.test(screen) &&
    /beginIosHistoryHandoff/.test(screen) &&
    /historyShortcutRunUrl\(\)/.test(screen));

ok('iOS message setup: persisted source-free progress restores the expanded row after remount',
  /loadIosMessageSetupProgress\(\)/.test(screen) &&
    /setProgress\(restored\)/.test(screen) &&
    /progress\.activeSection/.test(screen));
const refreshSetupAt = screen.indexOf('const refreshSetup = useCallback');
ok('iOS message setup: native History recovery cannot hide restored checklist progress',
  screen.indexOf('setProgress(restored)', refreshSetupAt) <
    screen.indexOf('const reconciliation = await iosHistorySetupStorageCoordinator', refreshSetupAt));
ok('iOS message setup: supported History reconciles before any destructive plain load',
  /if \(historySupported\)[\s\S]{0,500}reconcileIosHistorySetup/.test(screen) &&
    /else[\s\S]{0,300}loadIosHistorySetup\(\)/.test(screen));
const flowSource = (name, nextName) => screen.slice(
  screen.indexOf(`const ${name} = useCallback`),
  screen.indexOf(`const ${nextName} = useCallback`),
);
const futureInstallFlow = flowSource('installFutureShortcut', 'confirmFutureShortcut');
const automationFlow = flowSource('openAutomation', 'confirmAutomation');
const historyInstallFlow = flowSource('openHistoryInstall', 'openHistoryRun');
const historyRunFlow = flowSource('openHistoryRun', 'resetStoppedHistory');
ok('iOS message setup: every Shortcuts handoff persists progress before opening',
  futureInstallFlow.indexOf("type: 'future-status-changed'") >= 0 &&
    futureInstallFlow.indexOf("type: 'future-status-changed'") <
      futureInstallFlow.indexOf("type: 'install-shortcut'") &&
    automationFlow.indexOf("type: 'future-status-changed'") >= 0 &&
    automationFlow.indexOf("type: 'future-status-changed'") <
      automationFlow.indexOf("type: 'open-automation'") &&
    historyInstallFlow.indexOf("type: 'history-status-changed'") >= 0 &&
    historyInstallFlow.indexOf("type: 'history-status-changed'") <
      historyInstallFlow.indexOf('Linking.openURL(historyInstallUrl)') &&
    historyRunFlow.indexOf("type: 'history-status-changed'") >= 0 &&
    historyRunFlow.indexOf("type: 'history-status-changed'") <
      historyRunFlow.indexOf('beginIosHistoryHandoff') &&
    historyRunFlow.indexOf('beginIosHistoryHandoff') <
      historyRunFlow.indexOf('Linking.openURL(newHandoff ? historyShortcutRunUrl()'));

ok('iOS message setup: onboarding lifecycle is explicit and Settings never starts it',
  /if \(fromOnboarding\)[\s\S]{0,180}type: 'onboarding-started'/.test(screen) &&
    /completeIosMessageOnboardingAttempt\(\{[\s\S]{0,500}type: 'onboarding-finished'[\s\S]{0,300}type: 'onboarding-started'[\s\S]{0,180}setOnboarded/.test(
      screen,
    ));
ok('iOS message setup: durable onboarding failure restores History return and blocks exit',
  /retryRequired: finishRetryRequired/.test(screen) &&
    /outcome === 'retry-required'[\s\S]{0,180}setFinishRetryRequired\(true\)/.test(screen) &&
    /gestureEnabled: !fromOnboarding && !busy && !finishRetryRequired/.test(screen) &&
    /if \(busy \|\| finishRetryRequired\) return/.test(screen));
ok('iOS message setup: guided back clears its return marker and cannot bypass cleanup by swiping',
  /const leave = useCallback\(async \(\) => \{[\s\S]{0,420}if \(fromOnboarding\)[\s\S]{0,180}type: 'onboarding-return-cleared'/.test(
    screen,
  ) &&
    /gestureEnabled: !fromOnboarding && !busy && !finishRetryRequired/.test(screen));
ok('iOS message setup: only the guarded Finish action can complete onboarding',
  !/setOnboarded\(\)/.test(screen) &&
    /completeIosMessageOnboardingAttempt\(\{[\s\S]{0,500}\n\s+setOnboarded,/.test(screen) &&
    /const finish = useCallback/.test(screen) &&
    !/finishLater|skipIncomplete/.test(screen) &&
    !/openHistory[\s\S]{0,500}setOnboarded/.test(screen));

ok('iOS message setup: long privacy, retention, migration, and coverage copy lives in Learn more',
  /<DetailsSheet/.test(screen) &&
    /iosLocalPrivacyBody/.test(detailsSheet) &&
    /iosLocalMigrationBody/.test(detailsSheet) &&
    /iosMessageHelpCoverage/.test(detailsSheet) &&
    /privacyExpanded/.test(detailsSheet) &&
    /historyImportPrivacy/.test(detailsSheet) &&
    !/iosLocalPrivacyBody|iosLocalMigrationBody|historyLocalProcessing|historyImportPrivacy/.test(
      screen,
    ));

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

ok('iOS message setup: sentence-length actions wrap',
  (screen.match(/<Button\b[\s\S]*?\/>/g) || []).every((button) => /wrapLabel/.test(button)) &&
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
ok('iOS message setup: sender-scoped guide preserves statement and payment coverage',
  /iosMessageGuideNoFilter/.test(read('src/components/ios-message-setup/automation-guide.tsx')) &&
    translated('iosMessageGuideNoFilter', 'en').includes('Message Contains') &&
    translated('iosMessageGuideNoFilter', 'en').includes('leave empty') &&
    translated('iosMessageGuideNoFilter', 'ar').includes('فارغاً'));
ok('iOS local setup: readiness and failures are announced to VoiceOver',
  /previousReadiness\.current !== setup\.readiness/.test(screen) &&
    /AccessibilityInfo\.announceForAccessibility\(futureReadyLabel\)/.test(screen) &&
    /AccessibilityInfo\.announceForAccessibility\(failureCopy\(setup\.failure\)\)/.test(screen));
ok('iOS local setup: no unguarded entrance animation can hide the instructions',
  !/FadeIn|entering=/.test(screen));

ok('iOS local setup: callbacks and foreground transitions refresh native and saved status',
  /send\(\{ type: 'shortcut-callback', result \}\)/.test(screen) &&
    /RNAppState\.addEventListener\('change'/.test(screen) &&
    /next !== 'active'[\s\S]{0,300}refreshSetup/.test(screen));
ok('iOS local setup: explicit automation confirmation is the only visible enable path',
  /send\(\{ type: 'automation-added' \}\)/.test(screen) &&
    !/setIosCaptureEnabled\(true\)/.test(screen));

eq('iOS local setup: first qualifying alert has a local-only success state',
  translated('iosLocalFirstAlertCaptured', 'en'),
  'First alert received');
ok('iOS message setup: a real first alert replaces the waiting-only status',
  /setup\.readiness === 'first-alert-captured'[\s\S]{0,180}iosLocalFirstAlertCaptured/.test(
    screen,
  ));
eq('iOS local setup: milestone copy covers every durable qualifying outcome',
  translated('iosLocalFirstAlertBody', 'en'),
  'Wafra durably processed the first qualifying alert on this iPhone. It may have been filed, reviewed, reconciled, or recognized as an existing entry.');
eq(
  'iOS local setup: privacy copy states queue retention and no upload precisely',
  translated('iosLocalPrivacyBody', 'en'),
  'Apple does not give Wafra access to your Messages inbox. A personal automation can pass new Messages from a bank sender you select to Wafra’s protected queue on this iPhone. Wafra checks the complete Content and Sender locally, keeps only supported structured financial results, and uploads no Message data. After a durable local result, Wafra deletes the raw Message. If processing cannot finish, raw Content and Sender stay protected for up to 30 days and are removed on the next capture or queue check.',
);
eq('iOS local setup: migration copy discloses the old upload until retirement',
  translated('iosLocalMigrationBody', 'en'),
  'If you still have the old “Wafra Capture” automation, it can continue uploading the bank alerts you selected until you delete it or Wafra confirms retirement after the first local bank alert.');
ok(
  'iOS local setup: Arabic privacy copy includes local processing, 30 days, and migration',
  /الآيفون/.test(translated('iosLocalPrivacyBody', 'ar')) &&
    /مرسل بنك تختاره/.test(translated('iosLocalPrivacyBody', 'ar')) &&
    /بعد حفظ نتيجة محلية بشكل دائم/.test(
      translated('iosLocalPrivacyBody', 'ar'),
    ) &&
    /٣٠ يوماً/.test(translated('iosLocalPrivacyBody', 'ar')) &&
    /لا يرفع/.test(translated('iosLocalPrivacyBody', 'ar')) &&
    /Wafra Capture/.test(translated('iosLocalMigrationBody', 'ar')) &&
    /رفع/.test(translated('iosLocalMigrationBody', 'ar')),
);

ok('iOS local setup: protocol is independent of the retired relay URL helper',
  !/DEFAULT_SHORTCUT_URL|@\/lib\/relay/.test(protocol) &&
    /EXPO_PUBLIC_WAFRA_SHORTCUT_URL/.test(protocol) &&
    /03d2ab22a33f4fef9d503142575a70fb/.test(protocol));

async function historyCardTests() {
  const setupPath = path.join(ROOT, 'src/lib/ios-history-setup.ts');
  ok(
    'iOS history: setup state lives outside the screen',
    fs.existsSync(setupPath),
  );
  if (!fs.existsSync(setupPath)) return;

  const values = new Map();
  const removals = [];
  const storage = {
    async getItem(key) {
      return values.get(key) ?? null;
    },
    async setItem(key, value) {
      values.set(key, value);
    },
    async removeItem(key) {
      removals.push(key);
      values.delete(key);
    },
  };
  const setup = execute('src/lib/ios-history-setup.ts', {
    '@react-native-async-storage/async-storage': storage,
  });

  eq(
    'iOS history: the supported platform boundary starts at iOS 26.0',
    ['25.9', 26, '26.0', '26.1', 27].map(setup.iosSupportsMessageHistory),
    [false, true, true, true, true],
  );
  eq(
    'iOS history: the run URL returns cancel and error to a source-free Wafra route',
    setup.historyShortcutRunUrl(),
    'shortcuts://x-callback-url/run-shortcut?name=Wafra%20History%20Import&x-cancel=wafra%3A%2F%2Fimport-sms&x-error=wafra%3A%2F%2Fimport-sms',
  );
  if (typeof setup.normalizeIosHistoryShortcutUrl !== 'function') {
    ok(
      'iOS history: runtime accepts only an exact non-retired iCloud Shortcut URL',
      false,
      'normalizeIosHistoryShortcutUrl is missing',
    );
  } else {
    eq(
      'iOS history: runtime accepts only an exact non-retired iCloud Shortcut URL',
      [
        setup.normalizeIosHistoryShortcutUrl(
          'https://www.icloud.com/shortcuts/2869584D40ED454691CF3F916CBEE158',
        ),
        setup.normalizeIosHistoryShortcutUrl(
          'https://www.icloud.com/shortcuts/cc85a21db99a4e4698c1a498de670199',
        ),
        setup.normalizeIosHistoryShortcutUrl(
          'https://www.icloud.com/shortcuts/2869584d40ed454691cf3f916cbee158?x=1',
        ),
        setup.normalizeIosHistoryShortcutUrl(
          ' https://www.icloud.com/shortcuts/2869584d40ed454691cf3f916cbee158',
        ),
      ],
      [
        'https://www.icloud.com/shortcuts/2869584d40ed454691cf3f916cbee158',
        null,
        null,
        null,
      ],
    );
  }

  const base = {
    platform: 'ios',
    version: '26.0',
    installUrl: 'https://www.icloud.com/shortcuts/history',
    installed: true,
    handoffStartedAt: 1_000,
  };
  eq(
    'iOS history: a handoff remains running one millisecond before expiry',
    setup.resolveIosHistoryCardState({
      ...base,
      now: 1_000 + 60 * 60_000 - 1,
    }),
    'running',
  );
  eq(
    'iOS history: the exact completed-session one-hour boundary returns to ready',
    setup.resolveIosHistoryCardState({
      ...base,
      now: 1_000 + 60 * 60_000,
    }),
    'ready',
  );
  eq(
    'iOS history: absent published configuration is visible as unavailable',
    setup.resolveIosHistoryCardState({
      ...base,
      installUrl: undefined,
      now: 1_000,
    }),
    'install-unavailable',
  );
  eq(
    'iOS history: old iOS and valid completed links have explicit states',
    [
      setup.resolveIosHistoryCardState({
        ...base,
        version: '25.9',
        now: 1_000,
      }),
      setup.resolveIosHistoryCardState({
        ...base,
        historySessionId: 'history_session_0001',
        now: 1_000,
      }),
    ],
    ['unsupported', 'review'],
  );

  await setup.confirmIosHistoryShortcutInstalled(storage);
  await setup.beginIosHistoryHandoff(9_000, storage);
  eq(
    'iOS history: persistence contains only the Boolean marker and source-free timestamp',
    [...values.entries()].sort(),
    [
      [setup.IOS_HISTORY_HANDOFF_MARKER, '9000'],
      [setup.IOS_HISTORY_INSTALL_MARKER, 'true'],
    ].sort(),
  );
  await setup.clearIosHistoryHandoff(storage);
  ok(
    'iOS history: cancel/reset removes the handoff timestamp immediately',
    !values.has(setup.IOS_HISTORY_HANDOFF_MARKER) &&
      removals.includes(setup.IOS_HISTORY_HANDOFF_MARKER),
  );

  if (
    typeof setup.beginIosHistoryHandoffForOrigin !== 'function' ||
    typeof setup.loadIosHistoryReturnOrigin !== 'function'
  ) {
    ok(
      'iOS history: a handoff persists only a closed source-free return origin',
      false,
      'origin-aware handoff helpers are missing',
    );
  } else {
    await setup.beginIosHistoryHandoffForOrigin('wallet', 9_250, storage);
    eq(
      'iOS history: a handoff persists only a closed source-free return origin',
      [
        values.get(setup.IOS_HISTORY_HANDOFF_MARKER),
        values.get(setup.IOS_HISTORY_RETURN_ORIGIN_MARKER),
        await setup.loadIosHistoryReturnOrigin(storage),
      ],
      ['9250', 'wallet', 'wallet'],
    );
    values.set(setup.IOS_HISTORY_RETURN_ORIGIN_MARKER, 'settings/../unsafe');
    eq(
      'iOS history: an invalid stored origin is removed and falls back safely',
      [
        await setup.loadIosHistoryReturnOrigin(storage),
        values.has(setup.IOS_HISTORY_RETURN_ORIGIN_MARKER),
      ],
      [null, false],
    );

    const atomicValues = new Map();
    const atomicEvents = [];
    let originWriteRejected = false;
    try {
      await setup.beginIosHistoryHandoffForOrigin('settings', 9_300, {
        async getItem(key) {
          return atomicValues.get(key) ?? null;
        },
        async setItem(key, value) {
          atomicEvents.push(`set:${key}:${value}`);
          if (key === setup.IOS_HISTORY_RETURN_ORIGIN_MARKER) {
            throw new Error('origin write failed');
          }
          atomicValues.set(key, value);
        },
        async removeItem(key) {
          atomicEvents.push(`remove:${key}`);
          atomicValues.delete(key);
        },
      });
    } catch {
      originWriteRejected = true;
    }
    eq(
      'iOS history: origin persistence failure rolls back the active handoff before Shortcuts',
      [
        originWriteRejected,
        atomicValues.has(setup.IOS_HISTORY_HANDOFF_MARKER),
        atomicEvents,
      ],
      [
        true,
        false,
        [
          `set:${setup.IOS_HISTORY_HANDOFF_MARKER}:9300`,
          `set:${setup.IOS_HISTORY_RETURN_ORIGIN_MARKER}:settings`,
          `remove:${setup.IOS_HISTORY_HANDOFF_MARKER}`,
        ],
      ],
    );

    await setup.beginIosHistoryHandoffForOrigin('wallet', 9_400, storage);
    eq(
      'iOS history: terminal origin consumption is one-time and leaves no route marker',
      [
        await setup.consumeIosHistoryReturnOrigin(storage),
        await setup.consumeIosHistoryReturnOrigin(storage),
        values.has(setup.IOS_HISTORY_RETURN_ORIGIN_MARKER),
      ],
      ['wallet', null, false],
    );
  }

  await setup.beginIosHistoryHandoff(9_500, storage);
  if (setup.IOS_HISTORY_RETURN_ORIGIN_MARKER) {
    values.set(setup.IOS_HISTORY_RETURN_ORIGIN_MARKER, 'pro');
  }
  await setup.resetIosHistorySetup(storage);
  ok(
    'iOS history: reinstall reset clears every nonsensitive setup marker',
    !values.has(setup.IOS_HISTORY_HANDOFF_MARKER) &&
      !values.has(setup.IOS_HISTORY_INSTALL_MARKER) &&
      !values.has(setup.IOS_HISTORY_RETURN_ORIGIN_MARKER),
  );
  await setup.confirmIosHistoryShortcutInstalled(storage);

  await setup.beginIosHistoryHandoff(10_000, storage);
  const beforeExpiry = await setup.loadIosHistorySetup(
    10_000 + 60 * 60_000 - 1,
    storage,
  );
  const atExpiry = await setup.loadIosHistorySetup(
    10_000 + 60 * 60_000,
    storage,
  );
  eq(
    'iOS history: load observes the same strict handoff boundary',
    [
      beforeExpiry.handoffStartedAt,
      beforeExpiry.expired,
      atExpiry.handoffStartedAt,
      atExpiry.expired,
    ],
    [10_000, false, null, true],
  );

  const recoverHandoff = setup.recoverIosHistoryHandoff;
  if (typeof recoverHandoff !== 'function') {
    ok(
      'iOS history: a pending source-free handoff can recover its completed native session',
      false,
      'recoverIosHistoryHandoff is missing',
    );
  } else {
    const requestedAfter = [];
    const native = {
      async recoverCompletedSession(startedAfterMs) {
        requestedAfter.push(startedAfterMs);
        return {
          sessionId: 'history_session_0002',
          chunkIndices: [0],
          found: 1,
          attempted: 1,
          accepted: 1,
          skipped: 0,
        };
      },
    };
    eq(
      'iOS history: absent handoff state performs no native recovery lookup',
      [await recoverHandoff(null, native), requestedAfter],
      [null, []],
    );
    eq(
      'iOS history: a pending source-free handoff can recover its completed native session',
      [await recoverHandoff(12_345, native), requestedAfter],
      ['history_session_0002', [12_345]],
    );
    eq(
      'iOS history: a malformed recovered session never enters the review route',
      await recoverHandoff(12_346, {
        async recoverCompletedSession() {
          return {
            sessionId: '../private-source',
            chunkIndices: [0],
            found: 1,
            attempted: 1,
            accepted: 1,
            skipped: 0,
          };
        },
      }),
      null,
    );
  }

  const reconcileSetup = setup.reconcileIosHistorySetup;
  if (typeof reconcileSetup !== 'function') {
    ok(
      'iOS history: native proof is required before a deep link clears a newer handoff',
      false,
      'reconcileIosHistorySetup is missing',
    );
    ok(
      'iOS history: expiry performs one final native recovery before marker removal',
      false,
      'reconcileIosHistorySetup is missing',
    );
  } else {
    await setup.beginIosHistoryHandoffForOrigin('wallet', 30_000, storage);
    const proofEvents = [];
    const recoveryNative = {
      async recoverCompletedSession(startedAfterMs) {
        proofEvents.push(`recover:${startedAfterMs}`);
        return {
          sessionId: 'history_session_newer',
          chunkIndices: [0],
          found: 1,
          attempted: 1,
          accepted: 1,
          skipped: 0,
        };
      },
    };
    const staleLink = await reconcileSetup({
      historySessionId: 'history_session_stale',
      native: recoveryNative,
      now: 30_001,
      storage,
    });
    eq(
      'iOS history: native proof is required before a deep link clears a newer handoff',
      [
        staleLink.recoveredSessionId,
        staleLink.snapshot.handoffStartedAt,
        values.get(setup.IOS_HISTORY_HANDOFF_MARKER),
      ],
      [null, 30_000, '30000'],
    );
    const matchingLink = await reconcileSetup({
      historySessionId: 'history_session_newer',
      native: recoveryNative,
      now: 30_002,
      storage,
    });
    eq(
      'iOS history: matching native proof clears the active handoff marker',
      [
        matchingLink.recoveredSessionId,
        matchingLink.snapshot.handoffStartedAt,
        values.has(setup.IOS_HISTORY_HANDOFF_MARKER),
        await setup.loadIosHistoryReturnOrigin(storage),
      ],
      [null, null, false, 'wallet'],
    );

    await setup.beginIosHistoryHandoffForOrigin('settings', 40_000, storage);
    const expiredRecovery = await reconcileSetup({
      native: recoveryNative,
      now: 40_000 + 60 * 60_000,
      storage,
    });
    eq(
      'iOS history: expiry performs one final native recovery before marker removal',
      [
        expiredRecovery.recoveredSessionId,
        expiredRecovery.snapshot.handoffStartedAt,
        expiredRecovery.snapshot.expired,
        values.has(setup.IOS_HISTORY_HANDOFF_MARKER),
        await setup.loadIosHistoryReturnOrigin(storage),
        proofEvents.at(-1),
      ],
      ['history_session_newer', null, true, true, 'settings', 'recover:40000'],
    );
    const recoveredRoute = await reconcileSetup({
      historySessionId: expiredRecovery.recoveredSessionId,
      native: recoveryNative,
      now: 40_000 + 60 * 60_000 + 1,
      storage,
    });
    eq(
      'iOS history: the recovered route clears the expired marker only after matching proof',
      [
        recoveredRoute.recoveredSessionId,
        recoveredRoute.snapshot.handoffStartedAt,
        values.has(setup.IOS_HISTORY_HANDOFF_MARKER),
        await setup.loadIosHistoryReturnOrigin(storage),
      ],
      [null, null, false, 'settings'],
    );

    await setup.beginIosHistoryHandoffForOrigin('import', 45_000, storage);
    const expiredWithoutSession = await reconcileSetup({
      native: {
        async recoverCompletedSession() {
          return null;
        },
      },
      now: 45_000 + 60 * 60_000,
      storage,
    });
    eq(
      'iOS history: an expired handoff with no completed session returns to ready',
      [
        expiredWithoutSession.recoveredSessionId,
        expiredWithoutSession.snapshot.handoffStartedAt,
        expiredWithoutSession.snapshot.expired,
        values.has(setup.IOS_HISTORY_HANDOFF_MARKER),
        values.has(setup.IOS_HISTORY_RETURN_ORIGIN_MARKER),
      ],
      [null, null, true, false, false],
    );

    await setup.beginIosHistoryHandoff(50_000, storage);
    let expiryFailed = false;
    try {
      await reconcileSetup({
        native: {
          async recoverCompletedSession() {
            throw new Error('private native detail');
          },
        },
        now: 50_000 + 60 * 60_000,
        storage,
      });
    } catch {
      expiryFailed = true;
    }
    eq(
      'iOS history: a failed final recovery lookup preserves the source-free marker for retry',
      [expiryFailed, values.get(setup.IOS_HISTORY_HANDOFF_MARKER)],
      [true, '50000'],
    );
    await setup.clearIosHistoryHandoff(storage);
  }

  const importScreen = read('src/app/import-sms.tsx');
  const historyDetailsPath = path.join(
    ROOT,
    'src/components/ios-message-setup/history-details-sheet.tsx',
  );
  const historyDetails = fs.existsSync(historyDetailsPath)
    ? read('src/components/ios-message-setup/history-details-sheet.tsx')
    : '';
  const successRoute = setup.iosHistorySuccessRoute;
  if (typeof successRoute !== 'function') {
    ok(
      'iOS history: the completion route follows source-free onboarding and origin state',
      false,
      'iosHistorySuccessRoute is missing',
    );
  } else {
    const routeProgress = {
      version: 1,
      activeSection: 'history',
      futureShortcutConfirmed: false,
      futureAutomationConfirmed: false,
      futureStatus: 'not-started',
      historyShortcutConfirmed: true,
      historyStatus: 'in-progress',
      returnToOnboarding: false,
    };
    eq(
      'iOS history: completion returns to its closed source-free origin with Home fallback',
      [
        successRoute(routeProgress, 'home'),
        successRoute(routeProgress, 'onboarding'),
        successRoute(routeProgress, 'ios-setup'),
        successRoute(routeProgress, 'wallet'),
        successRoute(routeProgress, 'settings'),
        successRoute(routeProgress, 'import'),
        successRoute(routeProgress, null),
        successRoute({ ...routeProgress, returnToOnboarding: true }, null),
        successRoute({ ...routeProgress, returnToOnboarding: true }, 'onboarding'),
        successRoute({ ...routeProgress, returnToOnboarding: true }, 'wallet'),
      ],
      [
        '/',
        '/',
        '/ios-setup',
        '/wallet',
        '/settings',
        '/import-sms',
        '/',
        '/ios-setup?fromOnboarding=1',
        '/ios-setup?fromOnboarding=1',
        '/wallet',
      ],
    );
  }
  ok(
    'iOS history: setup and standalone callers persist a closed return origin before Shortcuts',
    /const historyReturnOrigin = fromOnboarding \? 'onboarding' : 'ios-setup'/.test(screen) &&
      /beginIosHistoryHandoffForOrigin\(historyReturnOrigin, startedAt\)/.test(screen) &&
      /if \(newHandoff\)[\s\S]{0,180}beginIosHistoryHandoffForOrigin/.test(screen) &&
      /if \(newHandoff\)[\s\S]{0,220}beginIosHistoryHandoffForOrigin\('import', startedAt\)/.test(
        importScreen,
      ) &&
      /catch \(error\)[\s\S]{0,180}clearIosHistoryHandoff\(\)[\s\S]{0,120}clearIosHistoryReturnOrigin\(\)/.test(
        screen,
      ) &&
      /catch \(error\)[\s\S]{0,240}clearIosHistoryHandoff\(\)[\s\S]{0,120}clearIosHistoryReturnOrigin\(\)/.test(
        importScreen,
      ),
  );
  ok(
    'iOS history: successful review resolves then clears origin before status and navigation',
    /clearIosHistoryHandoff\(\)[\s\S]{0,300}history-status-changed[\s\S]{0,300}consumeIosHistoryReturnOrigin\(\)[\s\S]{0,220}iosHistorySuccessRoute\(setupProgress, returnOrigin\)/.test(
      importScreen,
    ),
  );
  eq('iOS history: normal install, running, and review copy stays compact', [
    translated('historyReadyCompact', 'en'),
    translated('historyRunningCompact', 'en'),
    translated('historyReviewCompact', 'en'),
  ], [
    'Choose Always Allow when Apple asks',
    'Shortcuts is still working. Keep the iPhone unlocked',
    'Nothing is saved until you confirm',
  ]);
  ok(
    'iOS history: coverage, timing, live-progress, retention, and cleanup detail live behind Learn more',
    historyDetails.length > 0 &&
      /<BottomSheet/.test(historyDetails) &&
      /historyLocalProcessing/.test(historyDetails) &&
      /historyFirstRunGuidance/.test(historyDetails) &&
      /historyNoLiveProgressDetails/.test(historyDetails) &&
      /historyImportPrivacy/.test(historyDetails) &&
      /<HistoryDetailsSheet/.test(importScreen) &&
      /historyLearnMore/.test(importScreen) &&
      !/historyLocalProcessing|historyFirstRunGuidance|historyContinueBody|historyImportPrivacy/.test(
        importScreen,
      ),
  );
  eq('iOS history: source counts use two compact localized rows', [
    translated('historySourceCountsRead', 'en'),
    translated('historySourceCountsFiled', 'en'),
  ], [
    '{understood} understood · {unread} unread or non-financial',
    '{alreadyFiled} already filed · {notAlreadyFiled} not previously filed',
  ]);
  ok(
    'iOS history: source counts render as two rows instead of one paragraph',
    (importScreen.match(/testID="ios-history-source-count-row"/g) || []).length === 2 &&
      /historySourceCountsRead/.test(importScreen) &&
      /historySourceCountsFiled/.test(importScreen) &&
      !/tf\('historySourceCounts'/.test(importScreen),
  );
  eq(
    'iOS history: the import screen renders exactly one durable history card',
    (importScreen.match(/testID="ios-history-card"/g) || []).length,
    1,
  );
  const historyLoadIndex = importScreen.indexOf(
    'const result = await loadIosHistorySession',
  );
  const historyReviewDurabilityIndex = importScreen.indexOf(
    'await persistIosHistoryReviewCandidates(result.reviewCandidates, stageReviewAlerts)',
  );
  const historyPlanIndex = importScreen.indexOf(
    'const nextPlan = withoutExistingBillReminders',
  );
  ok(
    'iOS history: source-free reviews become durable before planning or source cleanup',
    historyLoadIndex >= 0 &&
      historyReviewDurabilityIndex > historyLoadIndex &&
      historyPlanIndex > historyReviewDurabilityIndex,
    `${historyLoadIndex},${historyReviewDurabilityIndex},${historyPlanIndex}`,
  );
  const leaveScreenBody = importScreen.slice(
    importScreen.indexOf('const leaveScreen = async'),
    importScreen.indexOf('const leaveProtectedSessionForExpiry'),
  );
  const cancelHandoffBody = importScreen.slice(
    importScreen.indexOf('const cancelHistoryHandoff = async'),
    importScreen.indexOf('const historyCardPrimaryAction'),
  );
  const applyPlanBody = importScreen.slice(
    importScreen.indexOf('const applyPlan = async'),
    importScreen.indexOf('const retrySecureSave = async'),
  );
  const retrySecureSaveBody = importScreen.slice(
    importScreen.indexOf('const retrySecureSave = async'),
    importScreen.indexOf("if (auto === '1'"),
  );
  const protectedLeaveBody = importScreen.slice(
    importScreen.indexOf('const leaveProtectedSessionForExpiry'),
    importScreen.indexOf('const applyPlan = async'),
  );
  const finishHistoryBody = importScreen.slice(
    importScreen.indexOf('const finishHistoryReview = useCallback'),
    importScreen.indexOf('const leaveScreen = async'),
  );
  ok(
    'iOS history: successful File, no-op File, and Cancel use the saved completion route',
    /result === 'complete'[\s\S]*?finishHistoryReview\('complete'\)/.test(applyPlanBody) &&
      /finalizeResult === 'complete'[\s\S]*?finishHistoryReview\('complete'\)/.test(importScreen) &&
      /result === 'complete'[\s\S]*?finishHistoryReview\('skipped'\)/.test(leaveScreenBody),
  );
  ok(
    'iOS history: a source-free Shortcuts cancel recovers and discards native source before returning',
    /cancelIosHistoryHandoff/.test(cancelHandoffBody) &&
      cancelHandoffBody.indexOf('recoverIosHistoryHandoff') >= 0 &&
      cancelHandoffBody.indexOf('recoverIosHistoryHandoff') <
        cancelHandoffBody.indexOf('discardIosHistorySession') &&
      cancelHandoffBody.indexOf('discardIosHistorySession') <
        cancelHandoffBody.indexOf("finishHistoryReview('skipped')"),
  );
  ok(
    'iOS history: every successful outcome clears the handoff marker before status and routing',
    finishHistoryBody.indexOf('clearIosHistoryHandoff') >= 0 &&
      finishHistoryBody.indexOf('clearIosHistoryHandoff') <
        finishHistoryBody.indexOf('dispatchIosMessageSetup') &&
      finishHistoryBody.indexOf('dispatchIosMessageSetup') <
        finishHistoryBody.indexOf('router.replace'),
  );
  ok(
    'iOS history: the two source-count rows are not duplicated in notice paragraphs',
    !/historyImportReviewSourceCounts|historyImportNoNewSourceCounts|historyImportNoneFoundBody/.test(
      importScreen,
    ),
  );
  ok(
    'iOS history: leaving a protected source may return to setup without marking History complete',
    /returnToHistoryOrigin\(\)/.test(protectedLeaveBody) &&
      !/finishHistoryReview|history-status-changed/.test(protectedLeaveBody),
  );
  ok(
    'iOS history: successful deep-link saves finish through the saved source-free origin',
    /historyOperationController\.finalize[\s\S]*?result === 'complete'[\s\S]*?finishHistoryReview\('complete'\)/.test(
      applyPlanBody,
    ) &&
      /historyOperationController\.finalize[\s\S]*?result === 'complete'[\s\S]*?finishHistoryReview\('complete'\)/.test(
        retrySecureSaveBody,
      ),
  );
  ok(
    'iOS history: a busy finalizer releases both visible applying latches',
    [applyPlanBody, retrySecureSaveBody].every((body) =>
      /if \(result === 'busy'\) \{\s*setApplying\(false\);\s*return;\s*\}/.test(body)),
  );
  ok(
    'iOS history: a successful deep-link cancel finishes through the saved source-free origin',
    /historyOperationController\.discard\(discardHistorySession\)[\s\S]*?result === 'complete'[\s\S]*?finishHistoryReview\('skipped'\)/.test(
      leaveScreenBody,
    ),
  );
  ok(
    'iOS history: mount and foreground refresh recover a missed success handoff',
    /void refreshHistorySetup\(\)[\s\S]*?RNAppState\.addEventListener\('change'[\s\S]*?void refreshHistorySetup\(\)/.test(
      importScreen,
    ) &&
      /reconcileIosHistorySetup\(\{[\s\S]*?historySessionId:\s*history,[\s\S]*?native/.test(importScreen) &&
      /router\.replace\(\{\s*pathname: '\/import-sms',\s*params: \{ history: recoveredSessionId \}/.test(
        importScreen,
      ),
  );
  ok(
    'iOS history: the one-hour timer uses the same final recovery-aware refresh',
    /setTimeout\(\(\) => \{\s*void refreshHistorySetup\(\)/.test(importScreen),
  );
  ok(
    'iOS history: a cold-open cleanup failure can always leave through its source-free origin',
    /returnToHistoryOrigin\(\)/.test(protectedLeaveBody) &&
      !/router\.back\(\)/.test(protectedLeaveBody),
  );

  const finalize = setup.finalizeIosHistorySession;
  if (typeof finalize !== 'function') {
    ok(
      'iOS history: no-op finalization awaits durability before discard',
      false,
      'finalizeIosHistorySession is missing',
    );
    ok(
      'iOS history: a durability failure never discards staged source',
      false,
      'finalizeIosHistorySession is missing',
    );
    ok(
      'iOS history: a discard failure has a distinct retryable outcome',
      false,
      'finalizeIosHistorySession is missing',
    );
  } else {
    const durable = deferred();
    const events = [];
    const operation = finalize({
      save: async () => {
        events.push('ensure');
        await durable.promise;
        events.push('durable');
      },
      discard: async () => {
        events.push('discard');
      },
    });
    await Promise.resolve();
    eq(
      'iOS history: no-op finalization does not discard ahead of durability',
      events,
      ['ensure'],
    );
    durable.resolve();
    eq(
      'iOS history: no-op finalization awaits durability before discard',
      [await operation, events],
      ['complete', ['ensure', 'durable', 'discard']],
    );

    const receipt = deferred();
    const mainEvents = [];
    const mainFinalize = finalize({
      save: async () => {
        mainEvents.push('importBatch');
        await receipt.promise;
        mainEvents.push('receipt.durable');
      },
      discard: async () => {
        mainEvents.push('discard');
      },
    });
    await Promise.resolve();
    eq(
      'iOS history: main finalization does not discard ahead of the import receipt',
      mainEvents,
      ['importBatch'],
    );
    receipt.resolve();
    eq(
      'iOS history: main finalization awaits the import receipt before discard',
      [await mainFinalize, mainEvents],
      ['complete', ['importBatch', 'receipt.durable', 'discard']],
    );

    let saveFailureDiscards = 0;
    const saveFailure = await finalize({
      save: async () => {
        throw new Error('raw body must not escape');
      },
      discard: async () => {
        saveFailureDiscards += 1;
      },
    });
    eq(
      'iOS history: a durability failure never discards staged source',
      [saveFailure, saveFailureDiscards],
      ['save-failed', 0],
    );

    const cleanupFailure = await finalize({
      save: async () => {},
      discard: async () => {
        throw new Error('sender must not escape');
      },
    });
    eq(
      'iOS history: a discard failure has a distinct retryable outcome',
      cleanupFailure,
      'cleanup-failed',
    );
  }

  const cancelHandoff = setup.cancelIosHistoryHandoff;
  if (typeof cancelHandoff !== 'function') {
    ok(
      'iOS history: source-free cancel deletes recovered native source before its marker',
      false,
      'cancelIosHistoryHandoff is missing',
    );
    ok(
      'iOS history: failed source-free cancel cleanup preserves the recovery marker',
      false,
      'cancelIosHistoryHandoff is missing',
    );
  } else {
    const events = [];
    await cancelHandoff({
      recover: async () => {
        events.push('recover');
        return 'history_session_cancelled';
      },
      discard: async (sessionId) => {
        events.push(`discard:${sessionId}`);
      },
      clearHandoff: async () => {
        events.push('clear');
      },
    });
    eq(
      'iOS history: source-free cancel deletes recovered native source before its marker',
      events,
      ['recover', 'discard:history_session_cancelled', 'clear'],
    );

    let markerClears = 0;
    let cleanupRejected = false;
    try {
      await cancelHandoff({
        recover: async () => 'history_session_protected',
        discard: async () => {
          throw new Error('protected source remains');
        },
        clearHandoff: async () => {
          markerClears += 1;
        },
      });
    } catch {
      cleanupRejected = true;
    }
    eq(
      'iOS history: failed source-free cancel cleanup preserves the recovery marker',
      [cleanupRejected, markerClears],
      [true, 0],
    );
  }

  const makeOperationController = setup.createIosHistoryOperationController;
  if (typeof makeOperationController !== 'function') {
    ok(
      'iOS history: pending no-op durability blocks competing back cleanup',
      false,
      'createIosHistoryOperationController is missing',
    );
    ok(
      'iOS history: save failure releases the operation lock without discard',
      false,
      'createIosHistoryOperationController is missing',
    );
    ok(
      'iOS history: cancel cleanup failure state survives retries',
      false,
      'createIosHistoryOperationController is missing',
    );
  } else {
    const controller = makeOperationController();
    const durable = deferred();
    let discards = 0;
    const finalizing = controller.finalize({
      save: () => durable.promise,
      discard: async () => {
        discards += 1;
      },
    });
    await Promise.resolve();
    const competingCleanup = await controller.discard(async () => {
      discards += 1;
    });
    eq(
      'iOS history: pending no-op durability blocks competing back cleanup',
      [competingCleanup, discards],
      ['busy', 0],
    );
    durable.resolve();
    eq(
      'iOS history: finalization discards exactly once after durability',
      [await finalizing, discards],
      ['complete', 1],
    );

    const failedSave = await controller.finalize({
      save: async () => {
        throw new Error('disk');
      },
      discard: async () => {
        discards += 1;
      },
    });
    const retry = await controller.finalize({
      save: async () => {},
      discard: async () => {
        discards += 1;
      },
    });
    eq(
      'iOS history: save failure releases the operation lock without discard',
      [failedSave, retry, discards],
      ['save-failed', 'complete', 2],
    );

    const cleanupState = setup.iosHistoryCleanupStateAfterFailure;
    if (typeof cleanupState !== 'function') {
      ok(
        'iOS history: cancel cleanup failure state survives retries',
        false,
        'iosHistoryCleanupStateAfterFailure is missing',
      );
    } else {
      const cancelController = makeOperationController();
      let attempts = 0;
      let stateName = 'idle';
      for (let attempt = 0; attempt < 2; attempt += 1) {
        const result = await cancelController.discard(async () => {
          attempts += 1;
          throw new Error('delete');
        });
        if (result === 'cleanup-failed') stateName = cleanupState(stateName);
      }
      const completed = await cancelController.discard(async () => {
        attempts += 1;
      });
      eq(
        'iOS history: cancel cleanup failure state survives retries',
        [stateName, completed, attempts],
        ['cancel-cleanup-failed', 'complete', 3],
      );
    }
  }

  const sourceCounts = setup.iosHistorySourceCounts;
  if (typeof sourceCounts !== 'function') {
    ok(
      'iOS history: mixed source counts separate already-filed from unread',
      false,
      'iosHistorySourceCounts is missing',
    );
    ok(
      'iOS history: one source message counts once despite multiple plan artifacts',
      false,
      'iosHistorySourceCounts is missing',
    );
    ok(
      'iOS history: a nonempty plan reports new understood sources as not previously filed',
      false,
      'iosHistorySourceCounts is missing',
    );
    ok(
      'iOS history: ten exact existing keys report already filed only',
      false,
      'iosHistorySourceCounts is missing',
    );
    ok(
      'iOS history: a zero plan keeps no-key understood sources factual',
      false,
      'iosHistorySourceCounts is missing',
    );
  } else {
    const mixedSummary = {
      found: 6,
      attempted: 6,
      accepted: 5,
      skipped: 1,
      parsed: 4,
      declined: 0,
      ignored: 1,
      duplicates: 0,
    };
    eq(
      'iOS history: mixed source counts separate already-filed from unread',
      sourceCounts(mixedSummary, ['a', 'b', 'c', 'd'], ['ha', 'hb']),
      { understood: 4, unread: 2, alreadyFiled: 2, notAlreadyFiled: 2 },
    );
    eq(
      'iOS history: one source message counts once despite multiple plan artifacts',
      sourceCounts(
        {
          ...mixedSummary,
          found: 1,
          attempted: 1,
          accepted: 1,
          skipped: 0,
          parsed: 1,
          ignored: 0,
        },
        ['one-source', 'one-source', 'one-source'],
        ['hone-source'],
      ),
      { understood: 1, unread: 0, alreadyFiled: 1, notAlreadyFiled: 0 },
    );
    const tenIds = Array.from({ length: 10 }, (_, index) => `source-${index}`);
    const tenSummary = {
      ...mixedSummary,
      found: 10,
      attempted: 10,
      accepted: 10,
      skipped: 0,
      parsed: 10,
      ignored: 0,
    };
    const nonemptyPlanSourceIds = [
      ...tenIds,
      'source-0',
      'source-0',
      'source-4',
    ];
    eq(
      'iOS history: a nonempty plan reports new understood sources as not previously filed',
      sourceCounts(tenSummary, nonemptyPlanSourceIds, []),
      { understood: 10, unread: 0, alreadyFiled: 0, notAlreadyFiled: 10 },
    );
    eq(
      'iOS history: ten exact existing keys report already filed only',
      sourceCounts(
        tenSummary,
        tenIds,
        tenIds.map((id) => `h${id}`),
      ),
      { understood: 10, unread: 0, alreadyFiled: 10, notAlreadyFiled: 0 },
    );
    eq(
      'iOS history: a zero plan keeps no-key understood sources factual',
      sourceCounts(tenSummary, tenIds, []),
      { understood: 10, unread: 0, alreadyFiled: 0, notAlreadyFiled: 10 },
    );
  }

  const eraseHistory = setup.eraseIosHistoryData;
  if (typeof eraseHistory !== 'function') {
    ok(
      'iOS history: destructive erase awaits native history before marker cleanup',
      false,
      'eraseIosHistoryData is missing',
    );
    ok(
      'iOS history: native erase failure preserves setup markers for retry',
      false,
      'eraseIosHistoryData is missing',
    );
  } else {
    const events = [];
    await eraseHistory({
      eraseNative: async () => {
        events.push('native');
      },
      clearSetup: async () => {
        events.push('markers');
      },
    });
    eq(
      'iOS history: destructive erase awaits native history before marker cleanup',
      events,
      ['native', 'markers'],
    );
    let markerClears = 0;
    let eraseRejected = false;
    try {
      await eraseHistory({
        eraseNative: async () => {
          throw new Error('native erase failed');
        },
        clearSetup: async () => {
          markerClears += 1;
        },
      });
    } catch {
      eraseRejected = true;
    }
    eq(
      'iOS history: native erase failure preserves setup markers for retry',
      [eraseRejected, markerClears],
      [true, 0],
    );
  }

  const makePostEraseCleanup = setup.createIosHistoryPostEraseCleanup;
  if (typeof makePostEraseCleanup !== 'function') {
    ok(
      'iOS history: clearAll treats native history erase failure as retryable cleanup',
      false,
      'createIosHistoryPostEraseCleanup is missing',
    );
  } else {
    let failHistoryErase = true;
    let committed = false;
    let recoveryState = null;
    let retryCleanup = null;
    const events = [];
    const cleanup = makePostEraseCleanup({
      eraseCapture: async () => {
        events.push('capture');
      },
      eraseHistory: async () => {
        events.push('history');
        if (failHistoryErase) throw new Error('history erase');
      },
      clearMessageSetup: async () => {
        events.push('message-setup');
      },
      clearBackground: async () => {
        events.push('background');
      },
    });
    const clearAll = async (afterErase) => {
      try {
        await afterErase();
        committed = true;
        recoveryState = 'complete';
      } catch (error) {
        retryCleanup = afterErase;
        recoveryState = 'erased-cleanup';
        const wrapped = new Error('cleanup');
        wrapped.stage = 'cleanup';
        wrapped.cause = error;
        throw wrapped;
      }
    };
    let stage = null;
    try {
      await clearAll(cleanup);
    } catch (error) {
      stage = error.stage;
    }
    eq(
      'iOS history: clearAll treats native history erase failure as retryable cleanup',
      [stage, committed, recoveryState, events],
      ['cleanup', false, 'erased-cleanup', ['capture', 'history']],
    );
    failHistoryErase = false;
    await retryCleanup();
    committed = true;
    recoveryState = 'complete';
    eq(
      'iOS history: erased-cleanup retry reaches complete only after history erase',
      [committed, recoveryState, events],
      [
        true,
        'complete',
        ['capture', 'history', 'capture', 'history', 'message-setup', 'background'],
      ],
    );
  }

  ok(
    'iOS history: both destructive app erase paths clear the combined setup progress',
    /clearMessageSetup: clearIosMessageSetupProgress/.test(settingsScreen) &&
      /clearMessageSetup: clearIosMessageSetupProgress/.test(storageRecovery),
  );

  const makeGuard = setup.createIosHistoryActionGuard;
  const performAction = setup.performIosHistoryAction;
  if (typeof makeGuard !== 'function' || typeof performAction !== 'function') {
    ok(
      'iOS history: synchronous action guard admits one concurrent setup action',
      false,
      'action guard is missing',
    );
    ok(
      'iOS history: action guard releases after a rejected marker operation',
      false,
      'action guard is missing',
    );
  } else {
    const guard = makeGuard();
    const held = deferred();
    let calls = 0;
    const first = performAction(guard, async () => {
      calls += 1;
      await held.promise;
    });
    const second = performAction(guard, async () => {
      calls += 1;
    });
    await Promise.resolve();
    eq(
      'iOS history: synchronous action guard admits one concurrent setup action',
      [calls, await second],
      [1, 'busy'],
    );
    held.resolve();
    eq(
      'iOS history: admitted setup action completes normally',
      await first,
      'complete',
    );
    const failed = await performAction(guard, async () => {
      calls += 1;
      throw new Error('private marker failure');
    });
    const afterFailure = await performAction(guard, async () => {
      calls += 1;
    });
    eq(
      'iOS history: action guard releases after a rejected marker operation',
      [failed, afterFailure, calls],
      ['failed', 'complete', 3],
    );

    if (
      typeof setup.createIosHistorySnapshotGate === 'function' &&
      typeof setup.createIosHistorySetupStorageCoordinator === 'function'
    ) {
      const actionGate = setup.createIosHistoryActionGuard();
      const snapshotGate = setup.createIosHistorySnapshotGate();
      const actionHeld = deferred();
      const snapshotHeld = deferred();
      const applied = [];
      const guardedAction = performAction(
        actionGate,
        () => actionHeld.promise,
        () => snapshotGate.invalidate(),
      );
      await Promise.resolve();
      const actionSnapshots = setup.createIosHistorySetupStorageCoordinator();
      const duringAction = actionSnapshots.runLatest(
        snapshotGate,
        () => snapshotHeld.promise,
        (value) => applied.push(value),
      );
      actionHeld.resolve();
      await guardedAction;
      snapshotHeld.resolve('captured-during-action');
      eq(
        'iOS history: action completion rejects a snapshot captured during its write',
        [await duringAction, applied],
        [false, []],
      );
    }
  }

  const makeSnapshotGate = setup.createIosHistorySnapshotGate;
  const makeStorageCoordinator = setup.createIosHistorySetupStorageCoordinator;
  if (
    typeof makeSnapshotGate !== 'function' ||
    typeof makeStorageCoordinator !== 'function'
  ) {
    ok(
      'iOS history: a newer refresh rejects an older deferred snapshot',
      false,
      'snapshot generation fence is missing',
    );
    ok(
      'iOS history: cancel invalidates an in-flight refresh snapshot',
      false,
      'snapshot generation fence is missing',
    );
    ok(
      'iOS history: unmount rejects a late timer snapshot',
      false,
      'snapshot generation fence is missing',
    );
  } else {
    const gate = makeSnapshotGate();
    const snapshots = makeStorageCoordinator();
    const first = deferred();
    const second = deferred();
    const applied = [];
    const older = snapshots.runLatest(
      gate,
      () => first.promise,
      (value) => applied.push(value),
    );
    const newer = snapshots.runLatest(
      gate,
      () => second.promise,
      (value) => applied.push(value),
    );
    first.resolve('old');
    const olderApplied = await older;
    second.resolve('new');
    const newerApplied = await newer;
    eq(
      'iOS history: a newer refresh rejects an older deferred snapshot',
      [newerApplied, olderApplied, applied],
      [true, false, ['new']],
    );

    const cancelled = deferred();
    const cancelledApply = snapshots.runLatest(
      gate,
      () => cancelled.promise,
      (value) => applied.push(value),
    );
    gate.invalidate();
    cancelled.resolve('cancelled-old');
    eq(
      'iOS history: cancel invalidates an in-flight refresh snapshot',
      [await cancelledApply, applied],
      [false, ['new']],
    );

    const late = deferred();
    const lateApply = snapshots.runLatest(
      gate,
      () => late.promise,
      (value) => applied.push(value),
    );
    gate.close();
    late.resolve('after-unmount');
    eq(
      'iOS history: unmount rejects a late timer snapshot',
      [await lateApply, applied],
      [false, ['new']],
    );
  }

  if (
    typeof makeStorageCoordinator !== 'function' ||
    typeof makeSnapshotGate !== 'function'
  ) {
    ok(
      'iOS history: invalidated queued refresh performs no storage operation',
      false,
      'setup storage coordinator is missing',
    );
    ok(
      'iOS history: closed queued refresh performs no storage operation',
      false,
      'setup storage coordinator is missing',
    );
    ok(
      'iOS history: in-flight old-marker removal finishes before new handoff write',
      false,
      'setup storage coordinator is missing',
    );
  } else {
    const coordinator = makeStorageCoordinator();
    const blocker = deferred();
    const holding = coordinator.run(() => blocker.promise);
    const staleGate = makeSnapshotGate();
    let storageOperations = 0;
    const stale = coordinator.runLatest(
      staleGate,
      async () => {
        storageOperations += 1;
        return 'stale';
      },
      () => {
        storageOperations += 100;
      },
    );
    staleGate.invalidate();
    blocker.resolve();
    await holding;
    eq(
      'iOS history: invalidated queued refresh performs no storage operation',
      [await stale, storageOperations],
      [false, 0],
    );

    const blocker2 = deferred();
    const holding2 = coordinator.run(() => blocker2.promise);
    const closedGate = makeSnapshotGate();
    const closed = coordinator.runLatest(
      closedGate,
      async () => {
        storageOperations += 1;
        return 'closed';
      },
      () => {
        storageOperations += 100;
      },
    );
    closedGate.close();
    blocker2.resolve();
    await holding2;
    eq(
      'iOS history: closed queued refresh performs no storage operation',
      [await closed, storageOperations],
      [false, 0],
    );

    const oldMarker = new Map([[setup.IOS_HISTORY_HANDOFF_MARKER, '1000']]);
    const removeEntered = deferred();
    const allowRemove = deferred();
    const storageEvents = [];
    const slowStorage = {
      async getItem(key) {
        storageEvents.push(`get:${key}`);
        return oldMarker.get(key) ?? null;
      },
      async setItem(key, value) {
        storageEvents.push(`set:${value}`);
        oldMarker.set(key, value);
      },
      async removeItem(key) {
        storageEvents.push('remove:start');
        removeEntered.resolve();
        await allowRemove.promise;
        oldMarker.delete(key);
        storageEvents.push('remove:done');
      },
    };
    const serial = makeStorageCoordinator();
    const inFlightGate = makeSnapshotGate();
    const refresh = serial.runLatest(
      inFlightGate,
      async () => {
        await setup.clearIosHistoryHandoffForDeepLink(
          'history_session_0001',
          'history_session_0001',
          slowStorage,
        );
        return setup.loadIosHistorySetup(1_001, slowStorage);
      },
      () => {
        storageEvents.push('apply');
      },
    );
    await removeEntered.promise;
    inFlightGate.invalidate();
    const startNew = serial.run(() =>
      setup.beginIosHistoryHandoff(2_000, slowStorage),
    );
    allowRemove.resolve();
    const refreshApplied = await refresh;
    await startNew;
    eq(
      'iOS history: in-flight old-marker removal finishes before new handoff write',
      [
        refreshApplied,
        oldMarker.get(setup.IOS_HISTORY_HANDOFF_MARKER),
        storageEvents,
      ],
      [
        false,
        '2000',
        [
          'remove:start',
          'remove:done',
          `get:${setup.IOS_HISTORY_INSTALL_MARKER}`,
          `get:${setup.IOS_HISTORY_HANDOFF_MARKER}`,
          'set:2000',
        ],
      ],
    );
  }

  const clearForDeepLink = setup.clearIosHistoryHandoffForDeepLink;
  if (typeof clearForDeepLink !== 'function') {
    ok(
      'iOS history: only matching native proof clears pending handoff state',
      false,
      'clearIosHistoryHandoffForDeepLink is missing',
    );
  } else {
    await setup.beginIosHistoryHandoff(20_000, storage);
    const invalidCleared = await clearForDeepLink(
      '../bad',
      'history_session_0001',
      storage,
    );
    const afterInvalid = values.get(setup.IOS_HISTORY_HANDOFF_MARKER);
    const staleCleared = await clearForDeepLink(
      'history_session_stale',
      'history_session_0001',
      storage,
    );
    const afterStale = values.get(setup.IOS_HISTORY_HANDOFF_MARKER);
    const matchingCleared = await clearForDeepLink(
      'history_session_0001',
      'history_session_0001',
      storage,
    );
    eq(
      'iOS history: only matching native proof clears pending handoff state',
      [
        invalidCleared,
        afterInvalid,
        staleCleared,
        afterStale,
        matchingCleared,
        values.has(setup.IOS_HISTORY_HANDOFF_MARKER),
      ],
      [false, '20000', false, '20000', true, false],
    );
  }

  const disposition = setup.iosHistoryLoadFailureDisposition;
  if (typeof disposition !== 'function') {
    ok(
      'iOS history: tombstoned load failures differ from cleanup failures',
      false,
      'iosHistoryLoadFailureDisposition is missing',
    );
  } else {
    eq(
      'iOS history: retryable load failures differ from tombstones and cleanup failures',
      [
        disposition({ code: 'native-failure', message: 'private body' }),
        disposition({ code: 'cancelled', message: 'private body' }),
        disposition({ code: 'record-mismatch', message: 'private body' }),
        disposition({ code: 'cleanup-failed', message: 'private sender' }),
        disposition(new Error('module unavailable with private content')),
      ],
      [
        'source-retained',
        'source-retained',
        'source-discarded',
        'cleanup-failed',
        'source-retained',
      ],
    );
  }

  for (const key of [
    'historyLast30Days',
    'historyThisYear',
    'historyChooseDates',
    'historyChooseYear',
    'historyAddAction',
    'historyStartAction',
    'historyContinueAction',
    'historyReviewAction',
    'historyRequiresIos26',
    'historyLocalProcessing',
    'historyFirstRunGuidance',
    'historyProgressPrivacy',
    'historySourceCounts',
    'historyImportNoNewSourceCounts',
    'historyImportReviewSourceCounts',
    'historyTryAgain',
    'historyReinstallAction',
    'historyInstallUnavailable',
    'historySourceDiscarded',
    'historySourceCleanupFailed',
    'historyCancelCleanupFailed',
    'historySetupStateFailed',
    'historyReadyCompact',
    'historyRunningCompact',
    'historyReviewCompact',
    'historyNoSupportedCompact',
    'historyNoNewCompact',
    'historyLearnMore',
    'historyDetailsTitle',
    'historyNoLiveProgressDetails',
    'historySourceCountsRead',
    'historySourceCountsFiled',
  ]) {
    let english = '';
    let arabic = '';
    try {
      english = translated(key, 'en');
      arabic = translated(key, 'ar');
    } catch {
      // Missing copy is an assertion failure below, not a test harness error.
    }
    ok(
      `iOS history: ${key} has complete English and Arabic copy`,
      /[\u0600-\u06ff]/.test(arabic) && english.length > 0,
    );
  }
  ok(
    'iOS history: active progress stays compact while staging detail remains in Learn more',
    /history\s*\?\s*t\('historyRunningCompact'\)\s*:\s*t\('importProgressPrivacy'\)/.test(
      importScreen,
    ) &&
      /historyImportPrivacy/.test(historyDetails) &&
      /temporary protected staging/.test(
        translated('historyProgressPrivacy', 'en'),
      ),
  );
  ok(
    'iOS history: Help names permission and timing without a test-run story',
    /historyFirstRunGuidance/.test(historyDetails) &&
      !/historyFirstRunGuidance/.test(importScreen) &&
      /Always Allow/.test(translated('historyFirstRunGuidance', 'en')) &&
      !/physical iPhone test|2,374/i.test(translated('historyFirstRunGuidance', 'en')) &&
      /20.?25 minutes/.test(translated('historyFirstRunGuidance', 'en')) &&
      /can take/i.test(translated('historyFirstRunGuidance', 'en')) &&
      /السماح دائماً/.test(translated('historyFirstRunGuidance', 'ar')) &&
      /٢٠.?٢٥ دقيقة/.test(translated('historyFirstRunGuidance', 'ar')),
  );
  ok('iOS history: pending handoff directs users to Shortcuts without a made-up percentage',
    /Continue in Shortcuts/.test(translated('historyContinueBody', 'en')) &&
    /تابع في الاختصارات/.test(translated('historyContinueBody', 'ar')) &&
    !/[0-9٠-٩]+\s*[%٪]/.test(translated('historyContinueBody', 'en') + translated('historyContinueBody', 'ar')));
  ok('iOS history: English guidance preserves coverage, permission and unlocked-phone requirements',
    /fewer than 3,000 messages and confirmed coverage/.test(translated('historyLocalProcessing', 'en')) &&
    /Keep Shortcuts open and iPhone unlocked/.test(translated('historyFirstRunGuidance', 'en')));
  ok('iOS history: Arabic guidance preserves coverage, permission and unlocked-phone requirements',
    /أقل من ٣٠٠٠ رسالة وتغطية مؤكدة/.test(translated('historyLocalProcessing', 'ar')) &&
    /الاختصارات مفتوحاً والآيفون دون قفل/.test(translated('historyFirstRunGuidance', 'ar')));
  eq(
    'iOS history: English source counts name every category separately',
    copy.tf(
      'historySourceCounts',
      {
        understood: 5,
        alreadyFiled: 2,
        notAlreadyFiled: 3,
        unread: 1,
      },
      'en',
    ),
    '5 understood · 2 already filed · 3 understood, not previously filed · 1 unread or non-financial',
  );
  eq(
    'iOS history: Arabic source counts name not-previously-filed separately',
    copy.tf(
      'historySourceCounts',
      {
        understood: 5,
        alreadyFiled: 2,
        notAlreadyFiled: 3,
        unread: 1,
      },
      'ar',
    ),
    'فُهمت 5 · سُجّلت سابقاً 2 · فُهمت 3 ولم تُسجّل سابقاً · تعذّرت قراءة 1 أو لم تكن مالية',
  );
  eq(
    'iOS history: mixed review copy does not promise a planner disposition',
    copy.tf(
      'historyImportReviewSourceCounts',
      {
        understood: 5,
        alreadyFiled: 2,
        notAlreadyFiled: 3,
        unread: 1,
      },
      'en',
    ),
    '5 understood · 2 already filed · 3 understood, not previously filed · 1 unread or non-financial',
  );
  eq(
    'iOS history: zero-plan copy may name the established no-new-entry disposition',
    copy.tf(
      'historyImportNoNewSourceCounts',
      {
        read: 10,
        alreadyFiled: 0,
        notAlreadyFiled: 10,
        unread: 0,
      },
      'en',
    ),
    '10 messages checked · 0 already filed · 10 understood but needed no new entry · 0 unread or non-financial',
  );
  eq(
    'iOS history: Arabic zero-plan copy names the established no-new-entry disposition',
    copy.tf(
      'historyImportNoNewSourceCounts',
      {
        read: 10,
        alreadyFiled: 0,
        notAlreadyFiled: 10,
        unread: 0,
      },
      'ar',
    ),
    'فُحصت 10 رسالة · سُجّلت سابقاً 0 · فُهمت 10 ولم تحتج إلى قيد جديد · تعذّرت قراءة 0 أو لم تكن مالية',
  );
  let cancelCleanupEnglish = '';
  let cancelCleanupArabic = '';
  try {
    cancelCleanupEnglish = translated('historyCancelCleanupFailed', 'en');
    cancelCleanupArabic = translated('historyCancelCleanupFailed', 'ar');
  } catch {
    // Missing copy is an assertion failure below, not a test harness error.
  }
  ok(
    'iOS history: pre-save cancellation cleanup copy never claims a save',
    cancelCleanupEnglish.length > 0 &&
      !/saved|ledger is saved/i.test(cancelCleanupEnglish) &&
      /[\u0600-\u06ff]/.test(cancelCleanupArabic),
  );
  ok(
    'iOS history: cleanup copy describes opportunistic one-hour expiry honestly',
    /eligible after one hour/i.test(
      translated('historySourceCleanupFailed', 'en'),
    ) &&
      /next time Wafra checks history/i.test(
        translated('historySourceCleanupFailed', 'en'),
      ) &&
      /eligible after one hour/i.test(cancelCleanupEnglish) &&
      /next time Wafra checks history/i.test(cancelCleanupEnglish),
  );
}

async function messageOnboardingProgressTests() {
  const progressPath = path.join(ROOT, 'src/lib/ios-message-onboarding.ts');
  ok(
    'iOS message onboarding: source-free progress is kept outside the screen',
    fs.existsSync(progressPath),
  );
  if (!fs.existsSync(progressPath)) return;

  const values = new Map();
  const storage = {
    async getItem(key) {
      return values.get(key) ?? null;
    },
    async setItem(key, value) {
      values.set(key, value);
    },
    async removeItem(key) {
      values.delete(key);
    },
  };
  const progress = execute('src/lib/ios-message-onboarding.ts', {
    '@react-native-async-storage/async-storage': storage,
    './ios-history-setup': execute('src/lib/ios-history-setup.ts', {
      '@react-native-async-storage/async-storage': storage,
    }),
  });

  const defaults = {
    version: 1,
    activeSection: 'future',
    futureShortcutConfirmed: false,
    futureAutomationConfirmed: false,
    futureStatus: 'not-started',
    historyShortcutConfirmed: false,
    historyStatus: 'not-started',
    returnToOnboarding: false,
  };
  eq(
    'iOS message onboarding: an empty store starts from strict source-free defaults',
    await progress.loadIosMessageSetupProgress(storage),
    defaults,
  );
  const mutableEmptySnapshot = await progress.loadIosMessageSetupProgress(storage);
  mutableEmptySnapshot.activeSection = 'history';
  mutableEmptySnapshot.futureStatus = 'complete';
  eq(
    'iOS message onboarding: mutating an empty snapshot cannot poison later defaults',
    await progress.loadIosMessageSetupProgress(storage),
    defaults,
  );

  values.set(progress.IOS_MESSAGE_SETUP_PROGRESS_KEY, JSON.stringify({
    ...defaults,
    sender: 'Bank Sender',
  }));
  eq(
    'iOS message onboarding: stored source-bearing keys are rejected instead of restored',
    await progress.loadIosMessageSetupProgress(storage),
    defaults,
  );

  values.set(progress.IOS_MESSAGE_SETUP_PROGRESS_KEY, JSON.stringify({
    ...defaults,
    futureStatus: 'ready',
  }));
  eq(
    'iOS message onboarding: values outside the exact progress schema are rejected',
    await progress.loadIosMessageSetupProgress(storage),
    defaults,
  );

  await progress.dispatchIosMessageSetup({ type: 'future-shortcut-confirmed' }, storage);
  const restored = await progress.loadIosMessageSetupProgress(storage);
  eq(
    'iOS message onboarding: restart restores only the confirmed progress state',
    restored,
    {
      ...defaults,
      futureShortcutConfirmed: true,
      futureStatus: 'in-progress',
    },
  );
  ok(
    'iOS message onboarding: persisted progress never includes message source fields',
    !/(sender|body|bank|account|transaction|session)/i.test(
      values.get(progress.IOS_MESSAGE_SETUP_PROGRESS_KEY),
    ),
  );

  eq(
    'iOS message onboarding: entering the checklist explicitly enables onboarding return',
    progress.reduceIosMessageSetup(defaults, { type: 'onboarding-started' }),
    { ...defaults, returnToOnboarding: true },
  );
  eq(
    'iOS message onboarding: finishing onboarding clears return before later history work completes',
    progress.reduceIosMessageSetup(
      { ...defaults, returnToOnboarding: true },
      { type: 'onboarding-finished' },
    ),
    defaults,
  );
  eq(
    'iOS message onboarding: abandoning guided setup clears only its return marker',
    progress.reduceIosMessageSetup(
      {
        ...defaults,
        futureShortcutConfirmed: true,
        futureStatus: 'in-progress',
        returnToOnboarding: true,
      },
      { type: 'onboarding-return-cleared' },
    ),
    {
      ...defaults,
      futureShortcutConfirmed: true,
      futureStatus: 'in-progress',
    },
  );

  await progress.clearIosMessageSetupProgress(storage);
  const first = deferred();
  const events = [];
  const serialStorage = {
    async getItem(key) {
      events.push(`get:${key}`);
      return values.get(key) ?? null;
    },
    async setItem(key, value) {
      events.push(`set:${key}`);
      if (events.filter((event) => event.startsWith('set:')).length === 1) {
        await first.promise;
      }
      values.set(key, value);
    },
    async removeItem(key) {
      events.push(`remove:${key}`);
      values.delete(key);
    },
  };
  const firstUpdate = progress.dispatchIosMessageSetup(
    { type: 'future-shortcut-confirmed' },
    serialStorage,
  );
  const secondUpdate = progress.dispatchIosMessageSetup(
    { type: 'future-automation-confirmed' },
    serialStorage,
  );
  await Promise.resolve();
  eq(
    'iOS message onboarding: concurrent updates wait for the active storage write',
    events.filter((event) => event.startsWith('get:')).length,
    1,
  );
  first.resolve();
  await Promise.all([firstUpdate, secondUpdate]);
  eq(
    'iOS message onboarding: serialized updates retain both confirmations',
    await progress.loadIosMessageSetupProgress(serialStorage),
    {
      ...defaults,
      futureShortcutConfirmed: true,
      futureAutomationConfirmed: true,
      futureStatus: 'in-progress',
    },
  );

  values.clear();
  const staleReadEntered = deferred();
  const allowStaleRead = deferred();
  let progressReads = 0;
  let progressWritesBeforeStaleReadResolves = 0;
  let staleLoadRemovedWrittenProgress = false;
  let staleReadResolved = false;
  const loadRaceStorage = {
    async getItem(key) {
      if (key !== progress.IOS_MESSAGE_SETUP_PROGRESS_KEY) return null;
      progressReads += 1;
      if (progressReads === 1) {
        staleReadEntered.resolve();
        await allowStaleRead.promise;
        return '{malformed';
      }
      return values.get(key) ?? null;
    },
    async setItem(key, value) {
      if (!staleReadResolved) progressWritesBeforeStaleReadResolves += 1;
      values.set(key, value);
    },
    async removeItem(key) {
      staleLoadRemovedWrittenProgress ||= values.has(key);
      values.delete(key);
    },
  };
  const staleLoad = progress.loadIosMessageSetupProgress(loadRaceStorage);
  await staleReadEntered.promise;
  const racingUpdate = progress.dispatchIosMessageSetup(
    { type: 'future-shortcut-confirmed' },
    loadRaceStorage,
  );
  await new Promise((resolve) => setImmediate(resolve));
  eq(
    'iOS message onboarding: a public load holds concurrent dispatch reads and writes in the same queue',
    progressWritesBeforeStaleReadResolves,
    0,
  );
  staleReadResolved = true;
  allowStaleRead.resolve();
  await Promise.all([staleLoad, racingUpdate]);
  eq(
    'iOS message onboarding: a queued stale load cannot erase a concurrent valid dispatch',
    [
      staleLoadRemovedWrittenProgress,
      JSON.parse(values.get(progress.IOS_MESSAGE_SETUP_PROGRESS_KEY)),
    ],
    [
      false,
      {
        ...defaults,
        futureShortcutConfirmed: true,
        futureStatus: 'in-progress',
      },
    ],
  );

  values.clear();
  values.set('wafra/ios-history-shortcut-installed/v1', 'true');
  eq(
    'iOS message onboarding: the existing history install confirmation is reconciled without native status',
    await progress.loadIosMessageSetupProgress(storage),
    {
      ...defaults,
      historyShortcutConfirmed: true,
      historyStatus: 'in-progress',
    },
  );
}

async function main() {
  await messageOnboardingProgressTests();
  await historyCardTests();
  await require('./ios-setup-recovery.helpers.js')({ execute, ok, eq, translated });
  console.log(`\nios-setup-ux: ${pass} passed, ${fail} failed`);
  if (fail) process.exit(1);
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
