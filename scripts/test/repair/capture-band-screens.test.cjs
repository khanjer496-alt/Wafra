'use strict';
// The capture and import screens in design language E: what sits on the band,
// what sits on the sheet, and that every figure is a real one. Actual screen
// source; UI primitives and native services are explicit boundaries.
const test = require('node:test');
const assert = require('node:assert/strict');
const path = require('node:path');
const load = require('./load-typescript.cjs');

const root = path.resolve(__dirname, '../../..');
const build = (name) => require(`../build/${name}.js`);
const themes = load(path.join(root, 'src/constants/theme.ts'), { '@/global.css': {}, 'react-native': { Platform: { select: (x) => x.android } } });
const walk = (n) => !n || typeof n !== 'object' ? [] : Array.isArray(n) ? n.flatMap(walk)
  : [n, ...walk(n.props?.children), ...walk(n.props?.bandContent)];
const byId = (tree, id) => walk(tree).find((node) => node.props?.testID === id);
const text = (node) => Array.isArray(node) ? node.map(text).join(' ')
  : node && typeof node === 'object' ? [text(node.props?.children), node.props?.label ?? '', node.props?.value ?? ''].join(' ')
    : node === null || node === undefined || node === false ? '' : String(node);

const health = load(path.join(root, 'src/lib/ios-capture-health.ts'));
const details = load(path.join(root, 'src/lib/details-copy.ts'));
const copy = load(path.join(root, 'src/lib/capture-band-copy.ts'));
const captureBand = load(path.join(root, 'src/lib/capture-band.ts'), { '@/lib/ios-capture-health': health });
const summary = load(path.join(root, 'src/lib/capture-health-summary.ts'), {
  '@/lib/format': build('format'), '@/lib/ios-capture-health': health,
});

function captureHealth({ platform = 'ios', status = null, largeText = false, state = {} } = {}) {
  const slots = []; let cursor = 0; const routes = []; const effects = [];
  const slot = (create) => slots[cursor++] ?? (slots[cursor - 1] = create());
  const react = {
    useRef: (value) => slot(() => ({ current: value })),
    useState: (value) => { const s = slot(() => ({ value })); return [s.value, (next) => { s.value = next; }]; },
    useCallback: (fn) => fn,
    useMemo: (fn) => fn(),
    useEffect: (fn) => { effects.push(fn); },
  };
  const jsx = (type, props = {}) => typeof type === 'function' ? type(props) : { type, props };
  const boundary = (name) => (props) => ({ type: name, props });
  const band = (id) => themes.BandPalettes.light[id];
  const ledger = { reviewTray: { pending: [] }, transactions: [], accounts: [], monthStartDay: 1, ...state };
  const Screen = load(path.join(root, 'src/app/capture-health.tsx'), {
    react, 'react/jsx-runtime': { jsx, jsxs: jsx, Fragment: 'Fragment' },
    'react-native': { AppState: { addEventListener: () => ({ remove() {} }) }, Platform: { OS: platform },
      StyleSheet: { create: (s) => s, hairlineWidth: 1 }, View: 'View' },
    'expo-router': { useRouter: () => ({ push: (r) => routes.push(r), back() {}, canGoBack: () => true, replace() {} }) },
    '@/components/capture/band-count': { BandCount: boundary('BandCount') },
    '@/components/capture/sheet-link-row': { SheetLinkRow: boundary('SheetLinkRow'), SheetSectionTitle: boundary('SheetSectionTitle') },
    '@/components/themed-text': { ThemedText: boundary('Text') },
    '@/components/ui/band-scaffold': { BandScaffold: boundary('BandScaffold') },
    '@/components/ui/band/e-button': { EButton: boundary('EButton') },
    '@/components/ui/band/glyph-tile': { GlyphTile: boundary('GlyphTile') },
    '@/components/ui/band/stat-tile': { StatTile: boundary('StatTile'), statTileColors: () => ({ fg: 'fg', bg: 'bg', fgSecondary: 'fg2' }) },
    '@/components/ui/bank-avatar': { BankAvatar: boundary('BankAvatar') },
    '@/hooks/use-band': { useBand: band },
    '@/hooks/use-language': { useLanguage: () => 'en' },
    '@/hooks/use-large-text-layout': { useLargeTextLayout: () => largeText },
    '@/lib/capture': { getIosCaptureNativeModule: () => status ? { getCaptureStatus: async () => status } : null,
      subscribeIosCaptureStatusRefresh: () => () => {} },
    '@/lib/capture-band': captureBand,
    '@/lib/capture-band-copy': copy,
    '@/lib/capture-health-summary': summary,
    '@/lib/details-copy': details,
    '@/lib/ios-capture-health': health,
    '@/lib/store': { useStore: () => ({ state: ledger }) },
  }).default;
  let tree;
  const render = () => { cursor = 0; tree = Screen(); };
  render();
  return { routes, band, get tree() { return tree; },
    async settle() { effects.splice(0).forEach((fn) => fn()); for (let i = 0; i < 3; i++) await new Promise((r) => setImmediate(r)); render(); } };
}

const receipt = (over = {}) => ({ enabled: true, entitled: true, pending: 2, dropped: 0, corrupt: false,
  setupProofVersion: 1, firstCapturedAt: 1, lastReceivedAt: null, lastHandledAt: null, ...over });

test('Capture status: green band, status and the handled time as the figure, real counters in band tiles', async () => {
  const handledAt = Date.now() - 60_000;
  const tx = (over) => ({ id: Math.random().toString(36), type: 'expense', amountFils: 100, category: 'other', accountId: 'a',
    title: 'Shop', date: new Date().toISOString().slice(0, 10), source: 'sms', ...over });
  const h = captureHealth({ status: receipt({ lastHandledAt: handledAt }), state: {
    reviewTray: { pending: [{ id: 'r', expiresAt: Date.now() + 1e6 }, { id: 'old', expiresAt: 1 }] },
    accounts: [{ id: 'a', bankName: 'First Bank', kind: 'bank' }],
    transactions: [tx({}), tx({ source: 'manual' }), tx({ captureSource: 'pdf' })],
  } });
  await h.settle();
  const scaffold = h.tree;
  assert.equal(scaffold.type, 'BandScaffold');
  assert.equal(scaffold.props.band, 'flow', 'the green capture band');
  assert.equal(scaffold.props.nav.title, 'Automatic capture');
  const band = scaffold.props.bandContent;
  const status = byId(band, 'capture-health-status');
  assert.match(status.props.accessibilityLabel, /^Working\. Last message handled, (Today|Yesterday) \d\d:\d\d$/);
  const figure = walk(byId(band, 'capture-health-last-handled')).find((node) => node.type === 'BandCount');
  assert.equal(figure.props.size, 'hero');
  assert.match(figure.props.value, /^\d\d:\d\d$/);
  const value = (id) => walk(byId(band, id)).find((node) => node.type === 'BandCount').props.value;
  assert.equal(value('capture-health-queue'), '2', 'the native queue count');
  assert.equal(value('capture-health-review'), '1', 'only live review items');
  assert.equal(value('capture-health-added'), '1', 'alerts only; manual and statement rows are not captures');
  byId(band, 'capture-health-review').props.onPress();
  assert.deepEqual(h.routes, ['/review-alerts']);
  // Sheet: detected banks with logo tiles and no switch, then the two links.
  const sheet = scaffold.props.children;
  const banks = byId(sheet, 'capture-health-banks');
  assert.ok(walk(banks).some((node) => node.type === 'BankAvatar' && node.props.account.id === 'a'));
  assert.equal(walk(banks).some((node) => /Switch/.test(String(node.type))), false);
  assert.match(text(banks), /no per-bank switch/);
  byId(sheet, 'capture-health-apple-pay').props.onPress();
  byId(sheet, 'capture-health-statements').props.onPress();
  assert.deepEqual(h.routes.slice(1), ['/ios-apple-pay-setup', '/statement-import']);
});

test('Capture status: no receipt means no figure, and Working is never claimed', async () => {
  for (const status of [null, receipt(), receipt({ lastHandledAt: Date.now() - 80 * 3600_000 }), receipt({ enabled: false })]) {
    const h = captureHealth({ status });
    await h.settle();
    const band = h.tree.props.bandContent;
    assert.doesNotMatch(byId(band, 'capture-health-status').props.accessibilityLabel, /^Working/);
    const handled = byId(band, 'capture-health-last-handled');
    if (status?.lastHandledAt) {
      assert.ok(handled, 'a quiet queue still shows when it last ran');
      assert.match(byId(band, 'capture-health-status').props.accessibilityLabel, /^No recent activity\. .*Nothing has been handled for a while/,
        'the quiet explanation is spoken too');
    }
    else assert.equal(handled, undefined);
    if (!status) assert.equal(walk(byId(band, 'capture-health-queue')).find((n) => n.type === 'BandCount').props.value, '—');
  }
});

test('Capture status: Android shows no iPhone-only links and stacks tiles at large text', async () => {
  const h = captureHealth({ platform: 'android', largeText: true });
  await h.settle();
  const sheet = h.tree.props.children;
  assert.equal(byId(sheet, 'capture-health-apple-pay'), undefined);
  assert.equal(byId(sheet, 'capture-health-setup'), undefined);
  assert.ok(byId(sheet, 'capture-health-statements'));
  const tiles = byId(h.tree.props.bandContent, 'capture-health-counters');
  assert.ok([tiles.props.style].flat().some((s) => s && s.flexDirection === 'column'));
});

/* ── Statement import ─────────────────────────────────────────────────── */

function statements({ language = 'en', privateMode = false, params = {}, preview, ledgerMoney = { schemaVersion: 2, currency: 'AED', exponent: 2 } } = {}) {
  const { createWorkflowHarness } = require('../workflows/workflow-harness.cjs');
  const h = createWorkflowHarness({ platform: 'ios', language, params, state: { privateMode,
    ledgerMoney, country: 'AE' } });
  const deps = h.deps;
  deps.react.useEffect = () => {};
  deps['expo-file-system'] = { File: class {} };
  deps['expo-haptics'] = {};
  deps['@/lib/capture-executor'] = { createCaptureExecutor: () => ({}) };
  deps['@/lib/cloud-import'] = { getImportCapabilities: async () => ({}), clearStatementPickerCache: () => {} };
  deps['@/lib/cloud-import-contract'] = { CloudImportError: class extends Error {} };
  deps['expo-router'].useLocalSearchParams = () => params;
  h.local('@/lib/supplement-copy', 'src/lib/supplement-copy.ts');
  h.local('@/lib/statement-coverage', 'src/lib/statement-coverage.ts');
  h.local('@/lib/statement-batch', 'src/lib/statement-batch.ts');
  const supplement = load(path.join(root, 'src/components/supplement-imports.tsx'), deps);
  deps['@/components/supplement-imports'] = supplement;
  const copy = deps['@/lib/supplement-copy'].SUPPLEMENT_COPY[language];
  if (preview) return { copy, tree: supplement.SupplementImports({ preview, frame: (parts) => ({ type: 'Frame', props: parts }) }) };
  const tree = load(path.join(root, 'src/app/statement-import.tsx'), deps).default();
  return { h, copy, tree };
}
const idOrder = (tree, ids) => { const all = walk(tree).map((n) => n.props?.testID); return ids.map((id) => all.indexOf(id)); };

test('Statement import: sand band with the title, the true privacy line above the choose control; the rest on the sheet', () => {
  const { tree, copy } = statements();
  assert.equal(tree.type, 'BandScaffold');
  assert.equal(tree.props.band, 'settings');
  const band = tree.props.bandContent;
  assert.match(text(band), /Add bank statements/);
  const [privacy, choose] = idOrder(band, ['statement-privacy', 'statement-choose']);
  assert.ok(privacy >= 0 && choose > privacy, 'the upload disclosure is read before the control');
  assert.match(text(byId(band, 'statement-privacy')), /Wafra’s import service\. The file is read, then deleted\./);
  assert.doesNotMatch(text(tree), /read on this phone/i);
  const control = byId(band, 'statement-choose');
  assert.equal(control.props.accessibilityRole, 'button');
  assert.equal(control.props.accessibilityLabel, copy.chooseFile);
  const sheet = tree.props.children;
  assert.ok(byId(sheet, 'statement-download-hint'));
  assert.match(text(byId(sheet, 'statement-date-note')), /Detect from file[\s\S]*choose the order printed by your bank/);
  assert.doesNotMatch(text(byId(sheet, 'statement-date-note')), /04\/09 is 4 September/);
  assert.equal(byId(band, 'statement-date-note'), undefined);
  // Without a ledger currency the control is off, and the band says why first.
  const noCurrency = statements({ ledgerMoney: null });
  const [prompt, off] = idOrder(noCurrency.tree.props.bandContent, ['statement-currency-prompt', 'statement-choose']);
  assert.ok(prompt >= 0 && off > prompt);
  assert.equal(byId(noCurrency.tree.props.bandContent, 'statement-choose').props.disabled, true);
  const onboarding = statements({ params: { fromOnboarding: '1' } });
  assert.match(text(onboarding.tree.props.bandContent), /Bring in your past spending/);
  assert.ok(walk(onboarding.tree.props.children).some((n) => n.props?.accessibilityLabel === onboarding.copy.later));
  // From setup, the way back says where it goes, as before the band.
  const toSetup = walk(onboarding.tree.props.nav.leading).find((n) => n.props?.testID === 'statement-import-back-to-setup');
  assert.equal(toSetup.props.accessibilityLabel, 'Back to setup');
  assert.equal(toSetup.props.accessibilityRole, 'button');
  assert.match(text(toSetup), /Back to setup/);
  assert.equal(onboarding.tree.props.nav.back, undefined, 'one back control, not two');
  toSetup.props.onPress();
  assert.equal(typeof tree.props.nav.back, 'function', 'from Settings it is the plain back');
});

test('Statement import: file rows carry a doc tile and a status in the status colour; private mode hides the control', () => {
  const band = themes.BandPalettes.light.settings;
  const { tree } = statements({ preview: { files: [
    { name: 'Statement Jul 2026.pdf', ok: true, detail: '96 rows read' },
    { name: 'Card Sep 2026.csv', ok: false, detail: 'Could not read this file' },
  ] } });
  const sheet = tree.props.sheet;
  const results = byId(sheet, 'statement-file-results');
  const failed = walk(results).find((n) => n.props?.accessibilityLabel?.includes('Card Sep 2026.csv'));
  assert.ok(failed, 'a failed file is always listed');
  assert.ok(byId(failed, 'statement-file-tile'), 'the document tile');
  const status = walk(failed).find((n) => n.type === 'Text' && text(n).includes('Could not read'));
  assert.ok(status);
  assert.ok(JSON.stringify(status.props.style).includes(band.statusOver), 'a failure reads in the status colour');
  const locked = statements({ privateMode: true });
  assert.equal(byId(locked.tree.props.bandContent, 'statement-choose'), undefined);
  assert.ok(byId(locked.tree.props.children, 'statement-private'));
});

/* ── Past bank texts (Android read) ───────────────────────────────────── */

// Render the shipping band fragments of the 2,200-line import screen with
// explicit inputs; the read, the plan and the native count are outside.
function importBand(name, input) {
  const fs = require('node:fs');
  const ts = require('typescript');
  const vm = require('node:vm');
  const source = fs.readFileSync(path.join(root, 'src/app/import-sms.tsx'), 'utf8');
  const ast = ts.createSourceFile('import-sms.tsx', source, ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX);
  let initializer;
  (function find(node) {
    if (ts.isVariableDeclaration(node) && node.name.getText(ast) === name) initializer = node.initializer;
    ts.forEachChild(node, find);
  })(ast);
  assert.ok(initializer, `${name} exists`);
  const program = ts.transpileModule(`(${initializer.getText(ast)})`, {
    compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.CommonJS, jsx: ts.JsxEmit.ReactJSX },
  }).outputText;
  const jsx = (type, props = {}) => ({ type: typeof type === 'function' ? type.name || 'Component' : type, props });
  const stub = (label) => Object.defineProperty(function () {}, 'name', { value: label });
  const flow = themes.BandPalettes.light.flow;
  const scanCopy = load(path.join(root, 'src/lib/motion-android-copy.ts'), { '@/lib/i18n': { getLanguage: () => 'en' } }).motionAndroidCopy('en');
  return vm.runInNewContext(program, {
    exports: {}, require: (id) => { assert.equal(id, 'react/jsx-runtime'); return { jsx, jsxs: jsx, Fragment: 'Fragment' }; },
    styles: new Proxy({}, { get: (_t, key) => ({ key }) }), View: 'View',
    ThemedText: stub('ThemedText'), ScanRing: stub('ScanRing'), ScanPanel: stub('ScanPanel'), PulseDot: stub('PulseDot'),
    StatTile: stub('StatTile'), BandCount: stub('BandCount'), EButton: stub('EButton'),
    band: flow, bandTile: { fg: flow.onBand }, mintTile: { fg: flow.onAccent }, scanCopy,
    t: (key) => key, tf: (key, values) => `${key}:${JSON.stringify(values)}`,
    formatCount: (value) => value.toLocaleString('en-US'), reducedMotion: false, largeText: false,
    history: undefined, showManual: false, runScan() {}, setShowManual() {}, isSmsScanningAvailable: () => true,
    ...input,
  });
}

test('Past bank texts: the ring only when the native count answered, and real counters in band tiles', () => {
  const progress = { scanned: 1904, found: 212 };
  const scanDetail = { promotionsSkipped: 388, recentFound: [] };
  const counted = importBand('scanBand', { scanPercent: 72, inboxTotal: 2600, progress, scanDetail });
  const ring = walk(counted).find((n) => n.type === 'ScanRing');
  assert.equal(ring.props.percent, '72%');
  assert.equal(ring.props.fraction, 0.72);
  assert.equal(walk(counted).some((n) => n.type === 'ScanPanel'), false);
  const bar = byId(counted, 'import-scan-progress');
  assert.equal(bar.props.accessibilityRole, 'progressbar');
  assert.deepEqual({ ...bar.props.accessibilityValue }, { min: 0, max: 100, now: 72 });
  const tile = (id) => byId(counted, `import-scan-${id}`);
  assert.equal(tile('checked').props.tone, 'band');
  assert.equal(tile('found').props.tone, 'accent', 'found is the one mint figure');
  assert.equal(tile('promos').props.tone, 'band');
  assert.equal(walk(tile('found')).find((n) => n.type === 'BandCount').props.value, '212');
  assert.equal(walk(tile('checked')).find((n) => n.type === 'BandCount').props.value, '1,904');
  assert.match(tile('promos').props.accessibilityLabel, /388/);

  // No native count: the indeterminate panel, never a percent.
  const uncounted = importBand('scanBand', { scanPercent: null, inboxTotal: null, progress, scanDetail });
  assert.ok(walk(uncounted).some((n) => n.type === 'ScanPanel'));
  assert.equal(walk(uncounted).some((n) => n.type === 'ScanRing'), false);
  assert.equal(byId(uncounted, 'import-scan-progress').props.accessibilityValue, undefined);
  // A paste or an iPhone history review keeps its plain counts and no tiles.
  const plain = importBand('scanBand', { scanPercent: null, inboxTotal: null, progress, scanDetail: null });
  assert.equal(byId(plain, 'import-scan-stats'), undefined);
  // Large text stacks the tiles.
  const large = importBand('scanBand', { scanPercent: 72, inboxTotal: 2600, progress, scanDetail, largeText: true });
  assert.ok(JSON.stringify(byId(large, 'import-scan-stats').props.style).includes('bandTilesStacked'));
});

test('Past bank texts: the band leads with the true line and the read; paste-only phones say pasting is free', () => {
  const android = importBand('introBand', {});
  assert.match(text(android), /scanBankAlertsPrivacy/);
  assert.ok(byId(android, 'import-find-alerts'));
  assert.ok(byId(android, 'import-paste-toggle'));
  const iphone = importBand('introBand', { isSmsScanningAvailable: () => false });
  assert.match(text(iphone), /pasteHint[\s\S]*featPasteFreeText/);
  assert.equal(byId(iphone, 'import-find-alerts'), undefined);
});
