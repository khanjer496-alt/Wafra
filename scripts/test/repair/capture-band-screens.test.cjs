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
    if (status?.lastHandledAt) assert.ok(handled, 'a quiet queue still shows when it last ran');
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
