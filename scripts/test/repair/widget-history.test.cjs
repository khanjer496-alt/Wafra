const test = require('node:test');
const assert = require('node:assert/strict');
const path = require('node:path');
const load = require('./load-typescript.cjs');
const root = path.resolve(__dirname, '../../..');
const preview = load(path.join(root, 'src/lib/widget-preview.ts'));
const { widgetsCopy } = load(path.join(root, 'src/lib/widgets-copy.ts'));
const jsx = (type, props) => ({ type, props });
const { WidgetHistory } = load(path.join(root, 'src/components/widgets/widget-history.tsx'), {
  react: {}, 'react/jsx-runtime': { jsx, jsxs: jsx },
  'react-native': { View: 'View', StyleSheet: { create: x => x } },
  '@/components/themed-text': { ThemedText: 'Text' },
  '@/lib/format': require('../build/format.js'),
  '@/lib/widget-preview': preview,
});
const walk = node => !node || typeof node !== 'object' ? [] : Array.isArray(node) ? node.flatMap(walk) : [node, ...walk(node.props?.children)];
const text = node => typeof node === 'string' ? node : Array.isArray(node) ? node.map(text).join(' ') : node && typeof node === 'object' ? text(node.props?.children) : '';
const sample = { version: 1, generatedAt: 0, language: 'en', todayISO: '2026-09-26', currency: 'KWD', exponent: 3,
  amountsSensitive: true, hidden: false, todayMinor: 12345, todayCount: 1,
  last7Minor: [0, 1001, null, 6000, 3000, 1200, 12345], leftInBudgetsMinor: null, perDayMinor: null, budgetsOver: 0, bills: [] };
const palette = { text: '#000', textSecondary: '#333', rule: '#eee', tint: '#555' };

test('widget history shows every exact daily amount and date with currency without interaction', () => {
  const tree = WidgetHistory({ snapshot: sample, palette, words: widgetsCopy('en') });
  const visible = text(tree);
  for (const value of ['KWD 0.000', 'KWD 1.001', 'KWD 6.000', 'KWD 3.000', 'KWD 1.200', 'KWD 12.345', '20 Sep', 'Today']) {
    assert.ok(visible.includes(value), value);
  }
  const bars = walk(tree).filter(n => n.props?.testID?.startsWith('widgets-week-bar-'));
  assert.equal(bars.length, 7);
  assert.equal(bars[0].props.style[1].width, '0%');
  assert.equal(bars[2].props.style[1].width, '0%', 'unknown is not an invented amount');
  assert.equal(bars[6].props.style[1].width, '100%');
});

test('private or absent snapshots render no daily money or bars', () => {
  assert.equal(WidgetHistory({ snapshot: null, palette, words: widgetsCopy('en') }), null);
  assert.equal(WidgetHistory({ snapshot: { ...sample, hidden: true }, palette, words: widgetsCopy('en') }), null);
});

test('Arabic uses the same exact money with localized visible dates and title', () => {
  const tree = WidgetHistory({ snapshot: sample, palette, words: widgetsCopy('ar') });
  assert.match(text(tree), /اليوم/);
  assert.match(text(tree), /سبتمبر/);
  assert.match(text(tree), /KWD 12\.345/);
});
