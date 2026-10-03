'use strict';
// Ask Wafra in design language E: the month bars and payment rows on the
// sheet, rendered from source through the repair harness (not a device
// renderer — colour, motion and layout are asserted as the props they set).
const test = require('node:test');
const assert = require('node:assert/strict');
const path = require('node:path');
const root = path.resolve(__dirname, '../../..');
const load = require('./load-typescript.cjs');
const { createHarness, walk, text } = require('./reference-harness.cjs');

const flat = (style) => Object.assign({}, ...[style].flat(Infinity).filter(Boolean));
const AED = { currency: 'AED', exponent: 2 };

function extras({ language = 'en', theme = 'light' } = {}) {
  const h = createHarness({ language, theme });
  // Record what each bar is asked to do: its size and its 50ms stagger.
  h.deps['@/components/ui/grow-bar'] = { GrowBar: (props) => h.jsx('GrowBar', props) };
  const module = load(path.join(root, 'src/components/assistant-answer-extras.tsx'), h.deps);
  const palette = h.deps['@/constants/theme'].BandPalettes[theme].home;
  return { h, module, palette };
}

const series = [
  { month: '2026-07', totalFils: 90_500 },
  { month: '2026-08', totalFils: 78_400 },
  { month: '2026-09', totalFils: 100_400 },
];

test('month bars: the named month in the band tint, the others in the rule tone, values above, 50ms apart', () => {
  const { h, module, palette } = extras();
  const tree = module.AssistantMonthChart({ series, highlight: '2026-09', money: AED, language: 'en', palette });
  const bars = walk(tree).filter((node) => node.type === 'GrowBar');
  assert.equal(bars.length, 3);
  assert.deepEqual(bars.map((bar) => bar.props.delay), [0, 50, 100], 'bars grow from the baseline 50ms apart');
  assert.deepEqual(bars.map((bar) => flat(bar.props.style).backgroundColor), [palette.rule, palette.rule, palette.tint]);
  assert.equal(bars[2].props.axis, 'width');
  assert.equal(bars[2].props.size, 100, 'the largest month fills the chart');
  assert.ok(bars[1].props.size < bars[0].props.size);
  assert.match(text(tree), /905/);
  assert.match(text(tree), /1,004/);
  const columns = walk(tree).filter((node) => node.props?.accessible && /2026/.test(node.props.accessibilityLabel ?? ''));
  assert.equal(columns.length, 3, 'every month is spoken with its amount');
  assert.match(columns[2].props.accessibilityLabel, /^Sept? 2026, AED 1,004$/);
  void h;
});

test('month bars: no emphasis without a named month, and exact values remain visible at large text', () => {
  const { module, palette } = extras();
  const plain = module.AssistantMonthChart({ series, money: AED, language: 'en', palette });
  assert.ok(walk(plain).filter((node) => node.type === 'GrowBar')
    .every((bar) => flat(bar.props.style).backgroundColor === palette.rule));
  const large = module.AssistantMonthChart({ series, highlight: '2026-09', money: AED, language: 'en', palette, largeText: true });
  assert.match(text(large), /1,004/, 'the exact figure remains visible above the bar');
  assert.ok(walk(large).some((node) => /AED 1,004/.test(node.props?.accessibilityLabel ?? '')), 'but is still spoken');
});

test('month bars: nothing is drawn for fewer than two months or no spending', () => {
  const { module, palette } = extras();
  assert.equal(module.AssistantMonthChart({ series: series.slice(0, 1), money: AED, language: 'en', palette }), null);
  assert.equal(module.AssistantMonthChart({ series: series.map((month) => ({ ...month, totalFils: 0 })), money: AED, language: 'en', palette }), null);
});

test('monthBarValue retains minor units, zero and long values', () => {
  const { module } = extras();
  assert.equal(module.monthBarValue(100_400, AED), '1,004');
  assert.equal(module.monthBarValue(0, AED), '0');
  assert.equal(module.monthBarValue(40, AED), '0.40');
  assert.equal(module.monthBarValue(40, { currency: 'KWD', exponent: 3 }), '0.040');
  assert.equal(module.monthBarValue(1_500, { currency: 'KWD', exponent: 3 }), '1.500');
  assert.equal(module.monthBarValue(123_456_700, AED), '1,234,567');
});

test('payment rows take the sheet rule and text tones in dark mode', () => {
  const { module, palette } = extras({ theme: 'dark' });
  const tree = module.AssistantPaymentRows({ payments: [
    { title: 'DEWA', category: 'utilities', kind: 'bill', dateISO: '2026-09-18', daysLeft: 3, amountFils: 32_000 },
    { title: 'Netflix', category: 'entertainment', kind: 'subscription', dateISO: '2026-09-20', daysLeft: 5, amountFils: 4_000 },
  ], money: AED, language: 'en', palette });
  const rows = walk(tree).find((node) => node.props?.testID === 'assistant-payment-rows');
  assert.equal(flat(rows.props.style).borderColor, palette.rule);
  const words = walk(rows).filter((node) => node.type === 'Text');
  assert.ok(words.length >= 6);
  assert.ok(words.every((node) => [palette.text, palette.textSecondary].includes(flat(node.props.style).color)),
    'no light-mode theme colour is left on the dark sheet');
});
