'use strict';
// Improve accuracy on the sand band (design language E): the plain title with
// the count of formats the list holds, the coverage counts as band stat tiles
// (counts with their own denominators, never a percentage), and every sheet
// action and privacy line kept.
const test = require('node:test');
const assert = require('node:assert/strict');
const path = require('node:path');
const load = require('./load-typescript.cjs');

const root = path.resolve(__dirname, '../../..');
const build = (name) => require(path.join(__dirname, '../build', `${name}.js`));
const theme = load(path.join(root, 'src/constants/theme.ts'), { '@/global.css': {}, 'react-native': { Platform: { select: (x) => x.ios ?? x.default } } });
const details = load(path.join(root, 'src/lib/details-copy.ts'));
const copyApi = load(path.join(root, 'src/lib/accuracy-band-copy.ts'), { '@/lib/details-copy': details });
const i18n = build('i18n');
const ARABIC = /[؀-ۿ]/;

const walk = (node) => !node || typeof node !== 'object' ? [] : Array.isArray(node) ? node.flatMap(walk) : [node, ...walk(node.props?.children)];
const strings = (node) => !node ? [] : typeof node === 'string' || typeof node === 'number' ? [String(node)] : typeof node !== 'object' ? []
  : Array.isArray(node) ? node.flatMap(strings) : strings(node.props?.children);

function render({ transactions, capture = false, relay = false, language = 'en', largeText = false }) {
  const events = [];
  const react = {
    useMemo: (fn) => fn(),
    useState: (value) => [typeof value === 'function' ? value() : value, () => {}],
  };
  const jsx = (type, props) => typeof type === 'function' ? type(props ?? {}) : ({ type, props: props ?? {} });
  const runtime = { jsx, jsxs: jsx, Fragment: 'Fragment' };
  const state = { language, transactions, merchantOverrides: {}, privateMode: false, accounts: [], cardDues: [] };
  const screen = load(path.join(root, 'src/app/accuracy.tsx'), {
    react, 'react/jsx-runtime': runtime,
    'react-native': { Share: { share: async () => {} }, StyleSheet: { create: (x) => x, hairlineWidth: 1 }, View: 'View' },
    'expo-router': { useRouter: () => ({ push: (to) => events.push(['push', to]), back: () => events.push(['back']) }) },
    '@/components/capture/band-count': { BandCount: 'Count' },
    '@/components/capture/sheet-link-row': { SheetSectionTitle: (p) => jsx('SectionTitle', p) },
    '@/components/entry-detail-sheet': { EntryDetailSheet: 'EntrySheet' },
    '@/components/settings-band/band-title': { BandTitle: (p) => jsx('BandTitle', p) },
    '@/components/themed-text': { ThemedText: 'Text' },
    '@/components/ui/band-scaffold': { BandScaffold: (p) => jsx('Scaffold', { ...p, children: [p.bandContent, p.children] }) },
    '@/components/ui/band/e-button': { EButton: 'Button' },
    '@/components/ui/band/stat-tile': { StatTile: (p) => jsx('StatTile', p), statTileColors: () => ({ fg: '#000', bg: '#fff', fgSecondary: '#333' }) },
    '@/components/ui/icon': { Icon: 'Icon' },
    '@/components/ui/money': { Money: 'Money' },
    '@/constants/theme': theme,
    '@/hooks/use-band': { useBand: (id) => theme.BandPalettes.light[id] },
    '@/hooks/use-large-text-layout': { useLargeTextLayout: () => largeText },
    '@/lib/accuracy': build('accuracy'),
    '@/lib/accuracy-band-copy': copyApi,
    '@/lib/capture': { isCaptureAvailable: () => capture },
    '@/lib/share-text': { shareText: async () => {} },
    '@/lib/categories': build('categories'),
    '@/lib/details-copy': details,
    '@/lib/relay': { isRelayPlatform: () => relay },
    '@/lib/store': { useStore: () => ({ state }) },
    '@/lib/i18n': i18n,
  }).default;
  const tree = screen();
  return { tree, events, find: (id) => walk(tree).find((n) => n.props?.testID === id), all: () => walk(tree) };
}

const row = (id, title, category, raw, extra = {}) => ({ id, title, category, raw, amountFils: 1000, date: '2026-09-20',
  accountId: 'bank', type: 'expense', source: 'sms', ...extra });

test('the band carries the plain title with the count of formats, and the coverage as tiles', () => {
  const transactions = [
    row('a', 'Card purchase', 'other', 'Purchase of AED 10.00 at XYZ 123', { parseConfidence: 'low' }),
    row('b', 'Carrefour', 'groceries', 'AED 12.00 spent at CARREFOUR'),
  ];
  const s = render({ transactions });
  const scaffold = s.all().find((n) => n.type === 'Scaffold');
  assert.equal(scaffold.props.band, 'settings', 'sand band');
  assert.equal(scaffold.props.nav.back, true);
  const title = s.find('accuracy-title');
  assert.equal(title.props.title, 'Improve accuracy');
  const listed = build('accuracy').unreadFormats(transactions, (c) => c);
  assert.equal(title.props.body, copyApi.accuracyBandCopy('en').toCheck(listed.length), 'the count is the list below');
  const coverage = build('accuracy').parserCoverage({ transactions, merchantOverrides: {} });
  const tiles = s.all().filter((n) => n.type === 'StatTile');
  assert.ok(tiles.length >= 1);
  const read = s.find('accuracy-tile-read');
  assert.equal(read.props.label, 'Messages read');
  assert.equal(walk(read).find((n) => n.type === 'Count').props.value, coverage.imported.toLocaleString('en-US'));
  assert.ok(coverage.imported > 0);
  for (const tile of tiles) assert.ok(!/%/.test(JSON.stringify(tile.props)), 'counts, never a percentage');
});

test('where the message text is never kept there is no count to claim, only the coverage and the reason', () => {
  const transactions = [row('b', 'Carrefour', 'groceries', undefined)];
  const s = render({ transactions, capture: true, relay: true });
  assert.equal(s.find('accuracy-title').props.body, null);
  assert.equal(s.find('accuracy-clean'), undefined, 'no green verdict without the text to check against');
  assert.ok(strings(s.find('accuracy-actions')).join(' ').includes(i18n.t('formatsNotKeptIosLocal')));
  assert.ok(s.find('accuracy-share-cards'), 'the card diagnostic stays offered');
});

test('every sheet action is kept and still goes where it went', () => {
  const transactions = [
    row('a', 'Card purchase', 'other', 'Purchase of AED 10.00 at XYZ 123', { parseConfidence: 'low' }),
    row('c', 'Mystery Shop', 'other', 'AED 5.00 spent at MYSTERY SHOP', { parseConfidence: 'low' }),
  ];
  const s = render({ transactions });
  const sort = s.find('accuracy-sort-shops');
  assert.ok(sort, 'a named shop with no category offers Sort shops');
  sort.props.onPress();
  assert.deepEqual(s.events, [['push', '/categorise']]);
  assert.ok(s.find('accuracy-coverage'));
  assert.ok(s.find('accuracy-share-cards'));
});

test('coverage tiles stack at large text', () => {
  const s = render({ transactions: [row('b', 'Carrefour', 'groceries', 'AED 12.00 spent at CARREFOUR')], largeText: true });
  const tiles = s.find('accuracy-coverage-tiles');
  assert.equal(tiles.props.style[1].flexDirection, 'column');
});

test('English and Arabic band copy carry the same keys, and Arabic counts agree with their nouns', () => {
  const { en, ar } = copyApi.accuracyBandCopyTables;
  assert.deepEqual(Object.keys(ar).sort(), Object.keys(en).sort());
  for (const key of Object.keys(en)) {
    assert.equal(typeof ar[key], typeof en[key], key);
    if (typeof en[key] === 'function') assert.equal(ar[key].length, en[key].length, `${key} arity`);
    const sample = (value) => typeof value === 'function' ? value.length === 3 ? value('X', 3, 5) : value(3) : value;
    assert.ok(!ARABIC.test(sample(en[key])), `${key} en`);
    assert.ok(ARABIC.test(sample(ar[key])), `${key} ar`);
  }
  assert.equal(en.toCheck(1), '1 message format to check');
  assert.equal(en.toCheck(4), '4 message formats to check');
  assert.equal(ar.toCheck(1), 'صيغة رسالة واحدة للمراجعة');
  assert.equal(ar.toCheck(2), 'صيغتا رسالة للمراجعة');
  assert.equal(ar.toCheck(3), '3 صيغ رسائل للمراجعة');
  assert.equal(ar.toCheck(11), '11 صيغة رسالة للمراجعة');
  assert.equal(en.of(505), 'of 505');
  assert.equal(ar.of(1200), 'من 1,200');
});
