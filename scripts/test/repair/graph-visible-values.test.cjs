'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const path = require('node:path');
const load = require('./load-typescript.cjs');
const { createHarness, walk, text } = require('./reference-harness.cjs');
const root = path.resolve(__dirname, '../../..');
const byId = (tree, id) => walk(tree).find(node => node.props.testID === id);

for (const language of ['en', 'ar']) for (const largeText of [false, true]) {
  test(`cashflow exposes every month's exact income and spending without selection (${language}, large=${largeText})`, () => {
    const h = createHarness({ language, largeText, width: 800 });
    const months = [{ key: '2026-08', incomeFils: 123456, expenseFils: 34567 }, { key: '2026-09', incomeFils: 432109, expenseFils: 87654 }];
    const tree = h.deps['@/components/spending/spending-trends'].SpendingTrends({
      months, selectedKey: '2026-09', merchants: [], movers: [], weekdays: [], periodLabel: 'September', comparisonLabel: 'August',
      onMonth() {}, onMerchant() {}, onCategory() {},
    });
    for (const month of months) {
      const row = byId(tree, `cashflow-detail-${month.key}`);
      assert.ok(row, 'each month is visible before any press');
      assert.ok(text(row).includes(h.deps['@/lib/format'].monthLabel(month.key)));
      for (const value of [month.incomeFils, month.expenseFils]) {
        assert.ok(text(row).includes(h.deps['@/lib/format'].formatAmount(value)), `exact ${value} shown`);
      }
      assert.ok(text(row).includes(language === 'ar' ? 'د.إ' : 'AED'));
    }
  });
}

function renderWeek({ language = 'en', largeText = false, width = 350, spec = { schemaVersion: 2, currency: 'AED', exponent: 2 }, values }) {
  const h = createHarness({ language, largeText });
  h.deps.react = { ...h.deps.react, useState: () => [width, () => {}] };
  const bars = [];
  h.deps['@/components/ui/grow-bar'] = { GrowBar: props => { bars.push(props); return { type: 'Bar', props }; } };
  const { WeekTiles } = load(path.join(root, 'src/components/ui/band/week-tiles.tsx'), h.deps);
  const days = values.map((fils, i) => ({ key: `2026-09-${20 + i}`, label: `D${i}`, spokenLabel: `Day ${i}`, fils, today: i === 6 }));
  const tree = WeekTiles({ days, moneySpec: spec, palette: h.deps['@/constants/theme'].bandPalette('home', 'dark'), accessibilityLabel: 'Week totals', testID: 'week' });
  return { h, tree, days, bars, spec };
}

for (const language of ['en', 'ar']) for (const largeText of [false, true]) {
  test(`weekly values keep minor-unit precision, zero, dates and large amounts (${language}, large=${largeText})`, () => {
    const { h, tree, days, bars, spec } = renderWeek({ language, largeText, values: [0, 1, 999, 12345, 987654321, 100, 250] });
    assert.ok(text(tree).includes('AED'));
    for (const day of days) {
      const row = byId(tree, `week-value-${day.key}`);
      assert.ok(text(row).includes(h.deps['@/lib/ledger-money'].formatMinorUnits(day.fils, spec)));
      assert.ok(text(row).includes(h.deps['@/lib/format'].shortDate(day.key)));
      assert.ok(text(row).includes(day.spokenLabel));
    }
    assert.ok(bars.every(bar => bar.axis === 'width'));
    assert.equal(bars[0].size, 0, 'zero must not look like positive activity');
    assert.equal(bars[4].size, 100);
    assert.equal(bars[1].size / bars[5].size, .01, 'small values keep their exact proportional scale');
  });
}
for (const spec of [{ schemaVersion: 2, currency: 'JPY', exponent: 0 }, { schemaVersion: 2, currency: 'KWD', exponent: 3 }]) {
  test(`weekly values follow ${spec.currency} denomination in compact columns`, () => {
    const { h, tree, days, bars } = renderWeek({ spec, width: 800, values: [0, 1, 1234, 2, 3, 4, 5] });
    assert.ok(text(tree).includes(spec.currency));
    for (const day of days) assert.ok(text(byId(tree, `week-value-${day.key}`)).includes(h.deps['@/lib/ledger-money'].formatMinorUnits(day.fils, spec)));
    assert.ok(bars.every(bar => bar.axis === 'height'));
    assert.equal(bars[0].size, 0);
    assert.equal(bars[2].size, 70);
  });
}

for (const language of ['en', 'ar']) for (const largeText of [false, true]) {
  test(`year recap shows every exact month value and waits for explicit navigation (${language}, large=${largeText})`, () => {
    const h = createHarness({ language, largeText });
    let stateCall = 0;
    const stateChanges = [];
    const timedAdvances = [];
    h.deps.react = { ...h.deps.react,
      useState: () => { const slot = stateCall++; return [slot === 0 ? 2 : 1, value => stateChanges.push([slot, value])]; },
      useEffect: fn => { fn(); },
    };
    h.deps['react-native-reanimated'] = { ...h.deps['react-native-reanimated'],
      FadeInLeft: { duration() { return this; } }, FadeInRight: { duration() { return this; } },
      cancelAnimation() {}, runOnJS: fn => fn,
      withTiming: (value, _options, callback) => { if (callback) timedAdvances.push(callback); return value; },
    };
    h.deps['@/hooks/use-reduced-motion'] = { useReducedMotion: () => false };
    h.deps['expo-status-bar'] = { StatusBar: 'StatusBar' };
    h.deps['@/components/ui/band/e-button'] = { EButton: 'EButton' };
    h.deps['@/components/ui/band/band-figure'] = { BandFigure: 'BandFigure' };
    h.deps['@/components/ui/band/stat-tile'] = { StatTile: 'StatTile' };
    h.deps['@/components/ui/band-scaffold'] = { BAND_GUTTER: 20, BandIconButton: 'BandIconButton' };
    h.deps['@/components/ui/your-pattern'] = { YourPattern: 'YourPattern' };
    h.deps['@/lib/recap-copy'] = load(path.join(root, 'src/lib/recap-copy.ts'), h.deps);
    h.deps['@/lib/recap'] = { RECAP_TIME_BUCKETS: ['morning', 'afternoon', 'evening', 'night'] };
    const bars = [];
    h.deps['@/components/ui/grow-bar'] = { GrowBar: props => { bars.push(props); return { type: 'Bar', props }; } };
    const { RecapStory } = load(path.join(root, 'src/components/recap/recap-story.tsx'), h.deps);
    const monthlySeries = Array.from({ length: 12 }, (_, i) => ({ key: `2025-${String(i + 1).padStart(2, '0')}`, label: h.deps['@/lib/format'].monthLabel(`2025-${String(i + 1).padStart(2, '0')}`), spendFils: i * 12345 }));
    const spec = { schemaVersion: 2, currency: 'KWD', exponent: 3 };
    const tree = RecapStory({ snapshot: {
      descriptor: { id: 'year:2025', kind: 'year', year: 2025, label: '2025' }, monthlySeries,
      topMerchants: [], topCategories: [], mostUsedAccount: null, spendingCount: 12, largestPurchase: null,
    }, moneySpec: spec, onClose() {} });
    assert.ok(byId(tree, 'recap-year-scroll'));
    for (const month of monthlySeries) {
      const row = byId(tree, `recap-year-month-${month.key}`);
      assert.ok(text(row).includes(month.label));
      assert.ok(text(row).includes(`KWD ${h.deps['@/lib/ledger-money'].formatMinorUnits(month.spendFils, spec)}`));
    }
    assert.ok(bars.every(bar => bar.axis === 'width'));
    assert.equal(bars[0].size, 0);
    assert.equal(bars.at(-1).size, 100);
    assert.equal(timedAdvances.length, 0, 'reading must not advance automatically');
    const next = byId(tree, 'recap-year-next');
    assert.equal(next.props.label, h.deps['@/lib/i18n'].t('continueWord'));
    next.props.onPress();
    const nextUpdate = stateChanges.filter(([slot]) => slot === 0).at(-1)[1];
    assert.equal(nextUpdate(2), 3, 'Continue opens the final scene');
    const back = walk(tree).find(node => node.props.action?.testID === 'recap-year-previous');
    back.props.action.onPress();
    const backUpdate = stateChanges.filter(([slot]) => slot === 0).at(-1)[1];
    assert.equal(backUpdate(2), 1, 'Back still returns to the preceding scene');
  });
}
