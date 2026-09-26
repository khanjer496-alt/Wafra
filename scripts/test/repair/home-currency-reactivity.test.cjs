'use strict';
const assert = require('node:assert/strict');
const { test } = require('node:test');
const fs = require('node:fs');
const path = require('node:path');
const ts = require('typescript');
const babel = require('@babel/core');
const load = require('./load-typescript.cjs');
const root = path.resolve(__dirname, '../../..');

function harness() {
  const local = (file, deps = {}) => load(path.join(root, `src/lib/${file}.ts`), deps);
  const i18n = local('i18n');
  const markets = local('markets');
  const money = local('ledger-money', { '@/lib/currency-metadata': local('currency-metadata') });
  const format = local('format', { '@/lib/arabic-sms': local('arabic-sms'), '@/lib/i18n': i18n,
    '@/lib/ledger-money': money, '@/lib/markets': markets });
  const caches = new Map();
  let currentFiber = null;
  // Like React, each compiled function (the component and every compiled
  // custom hook it calls) gets its own cache slot, in call order per render.
  let cacheCall = 0;
  const runtime = { c(size) {
    assert.ok(currentFiber, 'compiled memo cache must belong to the rendered component');
    const key = `${currentFiber}#${cacheCall++}`;
    let value = caches.get(key);
    if (!value) { value = Array(size).fill(Symbol.for('react.memo_cache_sentinel')); caches.set(key, value); }
    assert.equal(value.length, size);
    return value;
  } };
  const jsx = (type, props, key) => ({ type, props: props ?? {}, key });
  const contexts = [];
  let providerMemo;
  const theme = { text: 'black', primary: 'green', expense: 'red', textSecondary: 'gray' };
  const deps = {
    react: {
      createContext: value => { const context = { value, Provider: 'ContextProvider' }; contexts.push(context); return context; },
      useContext: context => context.value,
      useMemo: (factory, dependencies) => {
        if (providerMemo && dependencies.every((value, index) => Object.is(value, providerMemo.dependencies[index]))) return providerMemo.value;
        providerMemo = { value: factory(), dependencies }; return providerMemo.value;
      },
      useState: initial => [initial, () => {}],
      useEffect: () => {},
      // PaymentAgenda is React.memo-wrapped; render it as the plain component.
      memo: component => component,
    }, 'react/compiler-runtime': runtime, 'react/jsx-runtime': { jsx, jsxs: jsx },
    'react-native': { Pressable: 'Pressable', View: 'View', TextInput: 'TextInput', StyleSheet: { create: value => value },
      useWindowDimensions: () => ({ width: 390, fontScale: 1 }) },
    '@/components/themed-text': { ThemedText: 'Text' }, '@/components/ui/icon': { Icon: 'Icon' },
    '@/components/wafra-logo': { WafraMark: 'Mark' }, '@/constants/theme': { Fonts: {}, Spacing: { two: 8 },
      DataViz: { light: { neutral: '#E3DED2' }, dark: { neutral: '#3B362E' } } },
    '@/hooks/use-theme': { useTheme: () => theme }, '@/lib/reference-copy': local('reference-copy'),
    '@/hooks/use-language': { useLanguage: () => i18n.getLanguage() },
    '@/hooks/use-large-text-layout': { useLargeTextLayout: () => false },
    '@/hooks/use-color-scheme': { useColorScheme: () => 'light' },
    '@/lib/haptics': { tapped: () => {} },
    '@/components/ui/category-avatar': { CategoryAvatar: 'CategoryAvatar' },
    '@/components/ui/charts': { CategoryDonut: 'CategoryDonut', useRamp: () => [], useCategoricalPalette: () => ['#1F6B52','#B4503C','#A07B2A','#3B7A8C','#7A4E76'] },
    '@/components/ui/bank-avatar': { BankAvatar: 'BankAvatar' },
    '@/components/ui/merchant-avatar': { MerchantAvatar: 'MerchantAvatar' },
    '@/components/ui/progress-bar': { ProgressBar: 'ProgressBar' },
    '@/components/ui/period-pill': { PeriodPill: 'PeriodPill' },
    '@/components/ui/controls': { Button: 'Button' },
    '@/lib/categories': { categoryLabel: category => category },
    '@/lib/reference-presentation': local('reference-presentation'),
    '@/lib/runtime-performance': { measureRuntimeOperation: (_tag, work) => work() },
    '@/lib/format': format, '@/lib/markets': markets, '@/lib/ledger-money': money,
  };
  const denomination = load(path.join(root, 'src/hooks/use-ledger-money.tsx'), deps);
  deps['@/hooks/use-ledger-money'] = denomination;
  const setDenomination = moneySpec => {
    const provider = denomination.LedgerMoneyProvider({ moneySpec, children: null });
    contexts[0].value = provider.props.value;
    return provider.props.value;
  };
  const compile = (relative, requireOptimization = true) => {
    const filename = path.join(root, relative);
    const compiled = babel.transformSync(fs.readFileSync(filename, 'utf8'), { filename, babelrc: false, configFile: false,
      parserOpts: { plugins: ['typescript', 'jsx'] }, plugins: [[require('babel-plugin-react-compiler'), { target: '19' }]] }).code;
    if (requireOptimization) {
      assert.match(compiled, /react\/compiler-runtime/, `${relative}: actual React Compiler optimization is exercised`);
    }
    const module = { exports: {} };
    const output = ts.transpileModule(compiled, { fileName: filename,
      compilerOptions: { jsx: ts.JsxEmit.ReactJSX, module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022, esModuleInterop: true } }).outputText;
    Function('require', 'exports', 'module', output)(name => {
      assert.ok(Object.hasOwn(deps, name), `explicit dependency: ${name}`); return deps[name];
    }, module.exports, module);
    return module.exports;
  };
  // Large-text helpers used by Money: the E2E font scale is inert here; the
  // figure-fitting rule is pure and compiled for real.
  deps['@/lib/e2e-font-scale'] = { E2E_FONT_SCALE: null, scaleTextStyleForE2E: style => style };
  deps['@/lib/large-text-figure'] = compile('src/lib/large-text-figure.ts', false);
  // Bars render at their final size, as Reduce Motion shows them.
  deps['@/components/ui/grow-bar'] = { GrowBar: (p) => ({ type: 'View', props: { style: [p.style, p.axis === 'width' ? { width: `${p.size}%` } : { height: p.size }] } }) };
  deps['@/components/ui/money'] = compile('src/components/ui/money.tsx');
  const { ReferenceHomeSummary } = compile('src/components/reference-home-summary.tsx');
  const renderNode = (node, position) => {
    if (Array.isArray(node)) return node.map((child, index) => renderNode(child, `${position}/${index}`));
    if (!node || typeof node !== 'object') return node;
    if (typeof node.type === 'function') {
      const previous = currentFiber; const previousCall = cacheCall;
      currentFiber = `${position}:${node.type.name}`; cacheCall = 0;
      const output = node.type(node.props); currentFiber = previous; cacheCall = previousCall;
      return renderNode(output, `${position}/child`);
    }
    return { ...node, props: { ...node.props, children: renderNode(node.props.children, `${position}/children`) } };
  };
  const render = props => renderNode(jsx(ReferenceHomeSummary, props), 'root');
  const renderMoney = props => renderNode(jsx(deps['@/components/ui/money'].Money, props), 'money');
  const renderAmountField = props => renderNode(jsx(deps['@/components/ui/money'].AmountField, props), 'amount-field');
  const surfaces = new Map();
  const renderSurface = (name, props) => {
    if (!surfaces.has(name)) {
      const file = name === 'PaymentAgenda' ? 'bills/payment-agenda' : name === 'SpendingOverview' ? 'spending/spending-overview' : 'spending/spending-trends';
      // PaymentAgenda currently contains an intentionally imperative bounded
      // window accumulator that React Compiler leaves alone. It still consumes
      // the same reactive money context, so execute the Babel output directly;
      // the Spending/Trends surfaces continue to prove the compiled memo path.
      surfaces.set(name, compile(`src/components/${file}.tsx`, name !== 'PaymentAgenda')[name]);
    }
    return renderNode(jsx(surfaces.get(name), props), name);
  };
  const noop = () => {};
  const props = { theme: { expense: 'red', income: 'green', text: 'black' }, language: 'en', largeText: false,
    greeting: 'Hello', dateLabel: 'Today', periodLabel: 'September', incomeFils: 0, expenseFils: 828, netFils: -828,
    onPeriod: noop, onAdd: noop, onSettings: noop, onIncome: noop, onSpending: noop };
  // What StoreProvider publishes after applying the device conventions.
  const setMoneyLocale = (input) => {
    money.setDisplayMoneyLocale(input);
    const provider = denomination.MoneyLocaleProvider({ localeKey: JSON.stringify(input), children: null });
    contexts.find(context => context.value === '' || context.isMoneyLocale).value = provider.props.value;
    contexts.find(context => context.value === provider.props.value).isMoneyLocale = true;
  };
  return { render, renderMoney, renderAmountField, renderSurface, setDenomination, setMoneyLocale, props, markets, money, i18n };
}
function nodes(tree, output = []) {
  if (Array.isArray(tree)) tree.forEach(node => nodes(node, output));
  else if (tree && typeof tree === 'object') { output.push(tree); nodes(tree.props.children, output); }
  return output;
}
function strings(tree) {
  if (Array.isArray(tree)) return tree.map(strings).join(' ');
  return tree && typeof tree === 'object' ? strings(tree.props.children) : typeof tree === 'string' ? tree : '';
}

test('compiled Home and Money refresh currency on restore even when the monetary values are identical', () => {
  const h = harness();
  h.markets.setLedgerCurrency('AED', 2);
  const initial = h.render({ ...h.props, moneySpec: h.money.ledgerMoneySpec('AED') });
  assert.match(strings(initial), /AED/);
  h.markets.setLedgerCurrency('USD', 2);
  const restored = h.render({ ...h.props, moneySpec: h.money.ledgerMoneySpec('USD') });
  assert.doesNotMatch(strings(restored), /AED/);
  assert.match(strings(restored), /USD/);
  for (const id of ['home-spending-total', 'home-income-summary', 'home-net-summary']) {
    assert.match(nodes(restored).find(node => node.props.testID === id).props.accessibilityLabel, /USD/);
  }
  assert.match(strings(restored), /8\.28/);
});

test('compiled Home respects explicit stored exponent, changed amounts and language without changing minor units', () => {
  const h = harness();
  h.markets.setLedgerCurrency('AED', 2);
  h.render({ ...h.props, moneySpec: h.money.ledgerMoneySpec('AED') });
  // Leave the ambient setting stale deliberately: explicit props are the source.
  for (const [currency, expenseFils, expected, language] of [
    ['USD', 12550, '125.50', 'en'], ['KWD', 828, '0.828', 'ar'], ['JPY', 828, '828', 'en'],
  ]) {
    h.i18n.setLanguage(language);
    const result = h.render({ ...h.props, expenseFils, netFils: -expenseFils, language, moneySpec: h.money.ledgerMoneySpec(currency) });
    const label = nodes(result).find(node => node.props.testID === 'home-net-summary').props.accessibilityLabel;
    assert.ok(label.includes(`${currency} −${expected}`), label);
    assert.match(strings(result), new RegExp(currency));
    assert.doesNotMatch(strings(result), /AED/);
    if (language === 'ar') assert.match(label, /[\u0600-\u06ff]/);
  }
});

test('denomination context stays stable for same-value state snapshots and preserves explicit overrides', () => {
  const h = harness();
  const first = h.setDenomination(h.money.ledgerMoneySpec('USD'));
  assert.equal(h.setDenomination(h.money.ledgerMoneySpec('USD')), first, 'unrelated store revisions do not invalidate every Money');
  assert.notEqual(h.setDenomination(h.money.ledgerMoneySpec('KWD')), first);
  assert.match(strings(h.renderMoney({ fils: 828, moneySpec: h.money.ledgerMoneySpec('EUR') })), /EUR 8.28/);
  h.setDenomination(null);
  h.markets.setLedgerCurrency('AED', 2);
  assert.equal(h.renderMoney({ fils: 828 }).props.accessibilityLabel, 'AED 8.28', 'standalone callers keep the legacy fallback');
});

test('compiled implicit Money and amount prefixes follow context with identical values and stale ambient currency', () => {
  const h = harness(); h.markets.setLedgerCurrency('AED', 2);
  const props = { fils: 828 }; const input = { label: 'Amount', value: '8.28', onChangeText() {} };
  for (const [currency, expected, language] of [['AED', '8.28', 'en'], ['USD', '8.28', 'en'], ['KWD', '0.828', 'ar'], ['JPY', '828', 'en']]) {
    h.i18n.setLanguage(language); h.setDenomination(h.money.ledgerMoneySpec(currency));
    const tree = h.renderMoney(props);
    assert.equal(tree.props.accessibilityLabel, `${currency} ${expected}`);
    assert.equal(strings(tree), `${currency} ${expected}`);
    const fieldTree = h.renderAmountField(input);
    assert.match(strings(fieldTree), new RegExp(currency));
    assert.equal(nodes(fieldTree).find(node => node.type === 'TextInput').props.value, '8.28');
    assert.equal(props.fils, 828, 'rendering never converts the stored minor units');
  }
});

test('retained Spending, Trends and Bills keep visible and accessible money in the current denomination', () => {
  const h = harness(); h.markets.setLedgerCurrency('AED', 2); const noop = () => {};
  const surfaces = {
    SpendingOverview: { periodLabel: 'September', totalFils: 828,
      rows: [{ category: 'groceries', spentFils: 828, limitFils: 1000, remainingFils: 172, ratio: 0.828 }],
      monthScoped: true, filter: 'all', onFilter: noop, onPeriod: noop, onCategory: noop, onNewLimit: noop },
    SpendingTrends: { months: [{ key: '2026-09', incomeFils: 1000, expenseFils: 828 }], selectedKey: '2026-09',
      merchants: [{ title: 'Synthetic shop', totalFils: 828, count: 1, category: 'groceries' }],
      movers: [], weekdays: [], periodLabel: 'September', comparisonLabel: null, onMonth: noop, onMerchant: noop, onCategory: noop },
    PaymentAgenda: { items: [{ id: 'synthetic-bill', title: 'Synthetic bill', category: 'utilities', kind: 'bill',
      amountFils: 828, dateISO: '2026-09-09', daysLeft: 1, estimated: false, paid: false }], includePaid: false, onOpen: noop },
  };
  for (const [currency, expected, language] of [['AED', '8.28', 'en'], ['USD', '8.28', 'en'], ['KWD', '0.828', 'ar'], ['JPY', '828', 'en']]) {
    h.i18n.setLanguage(language); h.setDenomination(h.money.ledgerMoneySpec(currency));
    for (const [name, props] of Object.entries(surfaces)) {
      const before = JSON.stringify(props); const tree = h.renderSurface(name, props);
      assert.ok(strings(tree).includes(`${currency} ${expected}`), `${name}: visible ${currency}`);
      const labels = nodes(tree).filter(node => node.type === 'Pressable').map(node => node.props.accessibilityLabel ?? '');
      assert.ok(labels.some(label => label.includes(`${currency} ${expected}`)), `${name}: accessible ${currency}`);
      if (currency !== 'AED') assert.ok(!labels.some(label => label.includes('AED')), `${name}: no stale accessible currency`);
      assert.equal(JSON.stringify(props), before);
    }
  }
});

test('the application provides denomination inside the existing reactive store boundary without a currency navigation remount', () => {
  const source = fs.readFileSync(path.join(root, 'src/components/app-root-layout.tsx'), 'utf8');
  assert.match(source, /const moneySpec = state\.ledgerMoney \?\? ledgerMoneySpec\(marketCurrencyCode\(state\.marketId\)\)/);
  assert.match(source, /<LedgerMoneyProvider moneySpec=\{moneySpec\}>[\s\S]*?\{children\}[\s\S]*?<\/LedgerMoneyProvider>/);
  assert.match(source, /key=\{language\}/);
});

test('compiled Money re-formats identical props when the device number conventions change', () => {
  const h = harness(); h.markets.setLedgerCurrency('EUR', 2); h.i18n.setLanguage('en');
  h.setDenomination(h.money.ledgerMoneySpec('EUR'));
  const props = { fils: 123456 };
  try {
    h.setMoneyLocale({ locale: 'en-US', decimalSeparator: '.', groupSeparator: ',' });
    assert.match(strings(h.renderMoney(props)), /1,234\.56/);
    // Same element props, same compiled memo cache: only the published key changed.
    h.setMoneyLocale({ locale: 'de-DE', decimalSeparator: ',', groupSeparator: '.' });
    const german = h.renderMoney(props);
    assert.match(strings(german), /1\.234,56/, 'a memoized figure must not keep the previous device format');
    assert.match(german.props.accessibilityLabel, /1\.234,56/);
  } finally {
    h.money.setDisplayMoneyLocale(null);
  }
});
