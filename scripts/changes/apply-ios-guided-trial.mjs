import { readFileSync, writeFileSync } from 'node:fs';
import { createHash } from 'node:crypto';

// One-use transport for small edits to large existing files. Exact Git blob
// hashes prevent overwriting concurrent work. CI commits the resulting normal
// source files after checks, then removes this script and its bootstrap job.
const expected = {
  'src/app/ios-setup.tsx': '8e4ef0610d70804067ee22de3a8f280bdcdcaa18',
  'src/lib/ios-message-onboarding.ts': '4f49f7e19b8cd2aec2ef4223df58bd3e28c3f401',
  'src/lib/ios-capture-setup.ts': '1cf9bd1d4e9e38caac0bc93c998a644f636de904',
  'scripts/test/ios-setup-ux.test.js': 'ceb7f83265b5619d9529c32e3e1a477503d85529',
  'scripts/test/ios-setup-recovery.helpers.js': 'f17bf32f0b0c48d95efb136ebf59208b29ddd2f5',
};
const files = new Map();
for (const [path, hash] of Object.entries(expected)) {
  const data = readFileSync(path);
  const actual = createHash('sha1').update(`blob ${data.length}\0`).update(data).digest('hex');
  if (actual !== hash) throw new Error(`Base changed; refusing to overwrite ${path}`);
  files.set(path, data.toString('utf8'));
}
const one = (text, before, after) => {
  if (text.split(before).length !== 2) throw new Error(`Expected one edit anchor: ${before.slice(0, 50)}`);
  return text.replace(before, after);
};
let s = files.get('src/app/ios-setup.tsx');
s = one(s, 'React, { useCallback, useEffect, useRef, useState }', 'React, { useCallback, useEffect, useMemo, useRef, useState }');
s = one(s, "import { useStore } from '@/lib/store';", "import { useStore } from '@/lib/store';\nimport { useLanguage } from '@/hooks/use-language';\nimport { IosSetupJourney } from '@/components/ios-message-setup/setup-journey';\nimport { detectedSetupBanks, futureSetupConfigured, iosSetupJourneyCopy } from '@/lib/ios-setup-journey';");
s = one(s, "  activeSection: 'future',", "  activeSection: 'history',");
s = one(s, '  const { ensureDurable, setOnboarded, setCaptureOptOut } = useStore();', '  const { state, ensureDurable, setOnboarded, setCaptureOptOut } = useStore();\n  const language = useLanguage();\n  const journeyCopy = iosSetupJourneyCopy(language);\n  const detectedBanks = useMemo(() => detectedSetupBanks(state.accounts, state.transactions),\n    [state.accounts, state.transactions]);');
s = one(s, "  const setupComplete = progressLoaded && !setup.loading &&\n    setup.readiness !== 'not-added' && progress.historyStatus === 'complete';", "  const futureConfigured = futureSetupConfigured(setup.readiness, progress.futureAutomationConfirmed);\n  const setupComplete = progressLoaded && !setup.loading &&\n    futureConfigured && progress.historyStatus === 'complete';");
s = one(s, "    const status = setup.readiness !== 'not-added'\n      ? 'complete'", "    const status = futureConfigured\n      ? 'complete'");
s = one(s, '  }, [progress.futureStatus, progressLoaded, setup.loading, setup.readiness, updateProgress]);', '  }, [futureConfigured, progress.futureStatus, progressLoaded, setup.loading, updateProgress]);');
s = one(s, "  const futureStatus = !setup.loading && setup.readiness === 'not-added' && progress.futureStatus === 'complete'", "  const futureStatus = !setup.loading && !futureConfigured && progress.futureStatus === 'complete'");
const start = s.indexOf('              <ChecklistRow\n                step={1}');
const mid = s.indexOf('              <ChecklistRow\n                step={2}', start);
const end = s.indexOf('              </ChecklistRow>', mid) + '              </ChecklistRow>'.length;
if (start < 0 || mid <= start || end <= mid) throw new Error('Checklist source changed');
let future = s.slice(start, mid).trimEnd();
let past = s.slice(mid, end);
future = one(future, 'step={1}', 'step={2}');
past = one(past, 'step={2}', 'step={1}');
future = one(future, "detail={setup.readiness === 'not-added' ? undefined : futureReadyLabel}", "detail={setup.readiness === 'first-alert-captured' ? futureReadyLabel\n                  : futureConfigured ? journeyCopy.waiting : undefined}");
future = one(future, '<AutomationGuide />', '<AutomationGuide />\n                    <ThemedText type="meta" themeColor="textSecondary">{journeyCopy.senderHelp}</ThemedText>');
past = one(past, '                    {!historyRunning && (', '                    <ThemedText type="meta" themeColor="textSecondary">{journeyCopy.historyRequest}</ThemedText>\n                    {historyRunning && <Button label={journeyCopy.configureWhileImporting} variant="ghost"\n                      onPress={() => selectSection(\'future\')} disabled={busy} wrapLabel />}\n                    {!historyRunning && (');
s = s.slice(0, start) + past + '\n' + future + s.slice(end);
s = one(s, '            <View testID="ios-message-setup-checklist" style={styles.checklist}>\n', '            <View testID="ios-message-setup-checklist" style={styles.checklist}>\n              <IosSetupJourney\n                language={language}\n                historyStatus={progress.historyStatus}\n                futureReadiness={setup.readiness}\n                automationConfirmed={progress.futureAutomationConfirmed}\n                detectedBanks={detectedBanks}\n              />\n');
files.set('src/app/ios-setup.tsx', s);
files.set('src/lib/ios-message-onboarding.ts', one(files.get('src/lib/ios-message-onboarding.ts'), "  activeSection: 'future',", "  activeSection: 'history',"));
files.set('src/lib/ios-capture-setup.ts', one(files.get('src/lib/ios-capture-setup.ts'), "  if (readiness !== 'not-added') return 'ready';", "  // Running the no-input Shortcut proves the local action, not the personal\n  // Message automation. Keep its instructions until the user confirms them.\n  if (readiness !== 'not-added') {\n    return progress.futureAutomationConfirmed ? 'ready' : 'create-automation';\n  }"));
s = files.get('scripts/test/ios-setup-ux.test.js');
s = one(s, 'screen.indexOf("title={t(\'iosMessageFutureTitle\')}") <\n      screen.indexOf("title={t(\'iosMessagePastTitle\')}")', 'screen.indexOf("title={t(\'iosMessagePastTitle\')}") <\n      screen.indexOf("title={t(\'iosMessageFutureTitle\')}")');
s = one(s, "    activeSection: 'future',", "    activeSection: 'history',");
s = one(s, "mutableEmptySnapshot.activeSection = 'history';", "mutableEmptySnapshot.activeSection = 'future';");
files.set('scripts/test/ios-setup-ux.test.js', s);
s = files.get('scripts/test/ios-setup-recovery.helpers.js');
s = one(s, '    const defaults = {', '    // These recovery scenarios deliberately restore the Future section. New\n    // installations use History first, covered in the journey regression suite.\n    react.useMemo = (factory, deps) => react.useCallback(factory, deps)();\n    const defaults = {');
s = one(s, '    const store = {', "    const store = {\n      state: { accounts: [], transactions: [], language: 'en' },");
s = one(s, "      '@/hooks/use-theme': { useTheme: () => ({}) },", "      '@/hooks/use-theme': { useTheme: () => ({}) },\n      '@/hooks/use-language': { useLanguage: () => 'en' },\n      '@/components/ios-message-setup/setup-journey': { IosSetupJourney: 'IosSetupJourney' },\n      '@/lib/ios-setup-journey': execute('src/lib/ios-setup-journey.ts'),");
s = s.replaceAll("disabled.all().find((node) => node.type === 'ChecklistRow').props.status", "disabled.all().find((node) => node.type === 'ChecklistRow' && node.props.title === translated('iosMessageFutureTitle', 'en')).props.status");
s = one(s, '  const ready = await makeScreen();', "  const proofOnly = await makeScreen({ progress: { historyStatus: 'complete' } });\n  proofOnly.nativeStatus.enabled = true;\n  proofOnly.nativeStatus.setupProofVersion = 1;\n  await proofOnly.foreground();\n  eq('iOS setup: local proof cannot bypass user automation confirmation',\n    [!!proofOnly.button('iosMessageContinue'), proofOnly.saved().futureStatus, proofOnly.onboarded()],\n    [false, 'not-started', false]);\n  ok('iOS setup: local proof keeps the automation confirmation action reachable',\n    !!proofOnly.button('iosLocalAutomationAdded'));\n\n  const ready = await makeScreen({ progress: { futureAutomationConfirmed: true } });");
s = one(s, "const bothReady = await makeScreen({ progress: { historyStatus: 'complete' } });", "const bothReady = await makeScreen({ progress: { historyStatus: 'complete', futureAutomationConfirmed: true } });");
files.set('scripts/test/ios-setup-recovery.helpers.js', s);
for (const [path, contents] of files) writeFileSync(path, contents);
console.log('Applied exact-source edits:', [...files.keys()].join(', '));
