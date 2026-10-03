const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const ROOT = path.resolve(__dirname, '../..');
const read = (file) => fs.readFileSync(path.join(ROOT, file), 'utf8');

const settings = read('src/app/settings.tsx');
const i18n = read('src/lib/i18n.ts');
const autoImport = read('src/hooks/use-auto-import.ts');
const bridge = read('modules/notification-reader/index.ts');
const nativeModule = read(
  'modules/notification-reader/android/src/main/java/expo/modules/notificationreader/NotificationReaderModule.kt',
);

// Global positioning: Settings must not make Wafra look limited to the two
// legacy launch parser packs. Routing stays internal and source-driven.
assert.doesNotMatch(settings, /t\('parserPack'\)|marketChoices|setMarket\(/);

// Imports are the first task section after Pro, and statement import is the
// first import action rather than being buried among backup/export controls.
// Design language E: groups are headed by SettingsGroupTitle on the sheet.
const imports = settings.indexOf("<SettingsGroupTitle title={t('settingsImportsHeader')} palette={band} />");
const statement = settings.indexOf("t('statementImportTitle')", imports);
const notifications = settings.indexOf("<SettingsGroupTitle title={t('settingsNotificationsHeader')} palette={band} />");
assert.ok(imports > 0 && statement > imports && statement < notifications);
assert.equal(settings.indexOf("t('statementImportTitle')", statement + 1), -1);

// Appearance is one compact row and opens a three-choice sheet. The old
// always-expanded segmented block and its explanatory paragraph are gone.
assert.match(settings, /settingsPreferencesHeader/);
assert.match(settings, /setPreferenceSheet\('appearance'\)/);
assert.match(settings, /visible=\{preferenceSheet === 'appearance'\}/);
assert.doesNotMatch(settings, /SegmentedControl/);
assert.match(i18n, /themeSystemDetail: \{ en: 'System · follows phone'/);
assert.match(i18n, /settingsPreferencesHeader: \{ en: 'Appearance'/);

// Raw capture internals and a manual repair button do not belong in normal
// Settings. Support diagnostics remain available separately when needed.
assert.doesNotMatch(settings, /notifDiagnosticsTitle|notifDiagnosticsRefresh|getDiagnostics\(/);

// Android notification capture repairs a killed listener automatically on an
// eligible foreground. This is intentionally a rebind-only no-op while the
// listener is healthy, so it does not reintroduce a full shade scan on resume.
assert.match(bridge, /ensureListenerConnected\?\(\): Promise<boolean>/);
assert.match(nativeModule, /AsyncFunction\("ensureListenerConnected"\)/);
assert.match(nativeModule, /if \(!BankNotificationListenerService\.isConnected\(\)\)/);
assert.match(nativeModule, /BankNotificationListenerService\.sweepOrRequestRebind\(context\)/);
const heal = autoImport.indexOf('ensureListenerConnected');
const drain = autoImport.indexOf('await runAndroidNotificationDrain();', heal);
assert.ok(heal > 0 && drain > heal);

console.log('settings priority UX contract: ok');
