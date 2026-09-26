'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const { createWorkflowHarness, walk, text } = require('../workflows/workflow-harness.cjs');

for (const platform of ['ios', 'android']) for (const language of ['en', 'ar']) {
  test(`${platform}/${language}: privacy is built in, with no Private Mode toggle`, () => {
    const h = createWorkflowHarness({ platform, language, state: { privateMode: false } });
    const tree = h.renderScreen('settings');
    const t = h.deps['@/lib/i18n'].t;
    const toggles = walk(tree).filter(node => node.props?.accessibilityRole === 'switch');
    assert.ok(!toggles.some(node => node.props.accessibilityLabel === t('privateMode')));
    assert.ok(walk(tree).some(node => node.props?.onPress && node.props.accessibilityLabel?.startsWith(t('messagesPrivacy'))));
    assert.deepEqual(h.events, [], 'reading Settings never changes saved privacy choices');
  });
  test(`${platform}/${language}: capture recovery has an actual scroll target`, () => {
    const h = createWorkflowHarness({ platform, language, params: { section: 'imports' } });
    const tree = h.renderScreen('settings');
    // Design language E: the Capture group sits inside the sheet, under the
    // band, so the target is the band's measured end plus the group's offset.
    const scaffold = walk(tree).find(node => node.type === 'BandScaffold');
    const band = walk(tree).find(node => node.props?.testID === 'settings-band-body');
    const target = walk(tree).find(node => node.props?.testID === 'settings-imports');
    assert.ok(scaffold.props.scrollRef, 'the source screen can scroll its real scaffold');
    assert.equal(typeof band?.props?.onLayout, 'function');
    assert.equal(typeof target?.props?.onLayout, 'function');
    assert.equal(typeof scaffold.props.scrollProps.onContentSizeChange, 'function');
    assert.deepEqual(h.events, [], 'opening recovery must not change capture');
    const offsets = [];
    scaffold.props.scrollRef.current = { scrollTo: value => offsets.push(value) };
    target.props.onLayout({ nativeEvent: { layout: { y: 16 } } });
    assert.equal(offsets.length, 0, 'wait until the band has been measured');
    band.props.onLayout({ nativeEvent: { layout: { y: 60, height: 200 } } });
    assert.equal(offsets.length, 0, 'wait until content is large enough to reach the target');
    scaffold.props.scrollProps.onContentSizeChange(390, 1800);
    assert.equal(offsets.length, 1);
    const expected = h.deps['@/lib/settings-layout'].settingsSectionScrollY(260, 16);
    assert.equal(offsets[0].y, expected);
    assert.ok(offsets[0].y > 260, 'lands below the band, at the sheet');
    scaffold.props.scrollProps.onContentSizeChange(390, 1850);
    assert.equal(offsets.length, 1, 'later layout changes must not pull users back');
  });
}

test('legacy local-only preference remains until an explicit confirmation', async () => {
  const h = createWorkflowHarness({ params: { section: 'privacy' }, state: { privateMode: true } });
  const tree = h.renderScreen('settings');
  const t = h.deps['@/lib/i18n'].t;
  assert.ok(text(tree).includes(t('privacyLegacyTitle')));
  assert.deepEqual(h.events, []);
  const button = walk(tree).find(node => node.props?.onPress && node.props.accessibilityLabel === t('privacyLegacyReview'));
  assert.ok(button);
  button.props.onPress();
  assert.ok(!h.events.some(event => event[0] === 'setPrivateMode'));
  const confirmation = h.events.find(event => event[0] === 'state' && event[2]?.onConfirm)?.[2];
  assert.ok(confirmation);
  assert.equal(confirmation.body, t('privacyResumeBody'));
  confirmation.onConfirm();
  await Promise.resolve();
  assert.deepEqual(h.events.filter(event => event[0] === 'setPrivateMode'), [['setPrivateMode', false]]);
  assert.ok(!h.events.some(event => event[0] === 'unpairDevice'), 'resuming does not change existing relay enrollment');
});
