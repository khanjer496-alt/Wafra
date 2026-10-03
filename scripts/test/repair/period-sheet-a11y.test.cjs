'use strict';
// Shipping PeriodSheet and SectionHeader with inert native/UI boundaries and
// the real i18n table. Checks spoken labels and direction-aware figure
// alignment; not a device rendering.
const test = require('node:test');
const assert = require('node:assert/strict');
const path = require('node:path');
const load = require('./load-typescript.cjs');
const root = path.resolve(__dirname, '../../..');

const walk = (node, out = []) => {
  if (Array.isArray(node)) { for (const child of node) walk(child, out); return out; }
  if (!node || typeof node !== 'object') return out;
  out.push(node); walk(node.props?.children, out); return out;
};
const flatten = style => Object.assign({}, ...[style].flat(Infinity).filter(Boolean));

function modules(language) {
  const i18n = load(path.join(root, 'src/lib/i18n.ts'));
  i18n.setLanguage(language);
  const jsx = (type, props = {}) => typeof type === 'function' ? type(props) : { type, props };
  const boundary = name => props => ({ type: name, props });
  const base = {
    react: { useMemo: f => f(), useState: initial => [typeof initial === 'function' ? initial() : initial, () => {}] },
    'react/jsx-runtime': { jsx, jsxs: jsx, Fragment: 'Fragment' },
    'react-native': { Pressable: 'Pressable', View: 'View', Platform: { OS: 'ios' }, StyleSheet: { create: s => s } },
    '@/components/themed-text': { ThemedText: boundary('Text') },
    '@/constants/theme': { Spacing: { one: 4, two: 8, three: 12, four: 16, five: 24 } },
    '@/lib/i18n': i18n,
  };
  return { i18n, base, boundary };
}

for (const [language, previous, next] of [['en', 'Previous year, 2025', 'Next year, 2027'], ['ar', 'السنة السابقة، 2025', 'السنة التالية، 2027']]) {
  test(`${language}: year buttons announce direction and year, not a bare number`, () => {
    const { base, boundary } = modules(language);
    const { PeriodSheet } = load(path.join(root, 'src/components/period-sheet.tsx'), {
      ...base,
      '@/components/ui/bottom-sheet': { BottomSheet: props => ({ type: 'Sheet', props }) },
      '@/components/ui/controls': { Button: boundary('Button'), Chip: boundary('Chip') },
      '@/components/ui/icon': { Icon: boundary('Icon') },
      '@/components/ui/text-field': { TextField: boundary('TextField') },
      '@/hooks/use-large-text-layout': { useLargeTextLayout: () => true },
      '@/hooks/use-theme': { useTheme: () => ({ textSecondary: 'gray', backgroundSelected: 'sel', primary: 'green' }) },
      '@/lib/format': { monthKey: () => '2026-09', monthLabel: key => key, shiftMonthKey: key => key, toISODate: () => '2026-09-15' },
      '@/lib/period-context': { usePeriod: () => ({ period: { mode: 'month', key: '2026-09' }, setPeriod() {} }) },
    }, { Date: class extends Date { constructor(...args) { super(...(args.length ? args : ['2026-09-15T12:00:00Z'])); } } });
    const tree = PeriodSheet({ visible: true, onClose() {} });
    // The sheet starts on the current year; the grid header holds both buttons.
    const labels = walk(tree).filter(node => node.type === 'Pressable').map(node => node.props.accessibilityLabel);
    assert.ok(labels.includes(previous), labels.join(' | '));
    assert.ok(labels.includes(next), labels.join(' | '));
  });

  test(`${language}: section header figures align to the end of the reading direction`, () => {
    const { base } = modules(language);
    const { SectionHeader } = load(path.join(root, 'src/components/ui/section-header.tsx'), {
      ...base, '@/lib/haptics': { tapped() {} },
    });
    const value = walk(SectionHeader({ title: 'Spending', value: 'AED 12.00' })).find(node => node.props?.tabular);
    assert.equal(flatten(value.props.style).textAlign, language === 'ar' ? 'left' : 'right');
  });
}
