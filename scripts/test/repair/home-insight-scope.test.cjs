'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const { createHarness, walk, text } = require('./reference-harness.cjs');
const period = { mode: 'month', key: '2026-09' };
const insight = { id: 'pace', title: 'Spending rose', body: 'September spending rose.', icon: 'chart',
  tone: 'neutral', href: '/flow', scope: `en:${JSON.stringify(period)}` };
const card = tree => walk(tree).find(node => node.props?.testID === 'home-widget-insight');
test('Home insight keeps its computed period and working destination', () => {
  const h = createHarness({ period, states: { 8: insight } });
  const c = card(h.render('home'));
  assert.ok(c);
  assert.match(text(c), /Sep/);
  assert.equal(c.props.accessibilityRole, 'button');
  c.props.onPress();
  assert.deepEqual(h.events.at(-1), ['route', '/flow']);
});
test('changing period or language never relabels a deferred old insight', () => {
  for (const changes of [{period:{mode:'month',key:'2026-08'}}, {language:'ar'}]) {
    assert.equal(card(createHarness({period,states:{8:insight},...changes}).render('home')),undefined);
  }
});
test('an insight without a destination is readable text, not a dead action', () => {
  const c = card(createHarness({period,states:{8:{...insight,href:undefined}}}).render('home'));
  assert.equal(c.props.accessibilityRole,'text');
  assert.equal(c.props.disabled,true);
});
