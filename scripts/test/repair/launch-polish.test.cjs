'use strict';
// Source components with explicit native boundaries. This does not simulate
// a real keyboard or replace the required iOS/Android device checks.
const test = require('node:test');
const assert = require('node:assert/strict');
const path = require('node:path');
const root = process.env.WAFRA_TEST_ROOT ?? path.resolve(__dirname, '../../..');
const load = require(path.join(root, 'scripts/test/repair/load-typescript.cjs'));
const { createHarness, walk, text } = require(path.join(root, 'scripts/test/repair/reference-harness.cjs'));

function scaffoldHarness(language, platform) {
  const h = createHarness({ language });
  h.deps['react-native'].Platform.OS = platform;
  h.deps['react-native'].KeyboardAvoidingView = 'KeyboardAvoidingView';
  h.deps['@/components/themed-view'] = { ThemedView: props => h.jsx('View', props) };
  h.deps['@/components/ui/screen-header'] = { ScreenHeader: props => h.jsx('Header', props) };
  h.deps['@/hooks/use-keyboard-height'] = { useKeyboardHeight: () => 300 };
  h.deps['@/hooks/use-tab-bar-clearance'] = { useTabBarClearance: () => 78 };
  h.local('@/components/ui/screen-scaffold');
  return h;
}

for (const platform of ['ios', 'android']) {
  for (const language of ['en', 'ar']) {
    test(`${platform}/${language}: Assistant passes handled taps to its actual scroller and submits entered text`, () => {
      const h = scaffoldHarness(language, platform);
      h.deps['@react-navigation/elements'] = { useHeaderHeight: () => 90 };
      h.deps['expo-router'].useFocusEffect = () => {};
      h.deps['react-native'].AccessibilityInfo = { announceForAccessibility() {} };
      h.deps['react-native'].Keyboard = { dismiss() {} };
      h.deps['react-native'].useWindowDimensions = () => ({ width: 390, height: 844, fontScale: 1 });
      h.deps['@/lib/period'].periodRange = () => '';
      h.deps['@/components/assistant-evidence-sheet'] = { AssistantEvidenceSheet: props => h.jsx('EvidenceSheet', props) };
      const slots = [];
      let cursor = 0;
      h.deps.react.useState = initial => {
        const index = cursor++;
        if (!(index in slots)) slots[index] = typeof initial === 'function' ? initial() : initial;
        return [slots[index], next => { slots[index] = typeof next === 'function' ? next(slots[index]) : next; }];
      };
      const calls = [];
      h.deps['@/lib/wafra-assistant'] = {
        suggestedAssistantQuestions: () => [], assistantFollowUpQuestions: () => [],
        runWafraAssistant: (_state, question) => {
          calls.push(question);
          return { answer: { tool: 'spending-total', title: 'Answer', body: 'A local answer' }, request: { tool: 'spending-total', period: { mode: 'month', key: '2026-09' } } };
        },
      };
      const Screen = load(path.join(root, 'src/app/assistant.tsx'), h.deps).default;
      const render = () => { cursor = 0; return Screen(); };
      let tree = render();
      const scroller = walk(tree).find(node => node.type === 'ScrollView');
      assert.equal(scroller.props.keyboardShouldPersistTaps, 'handled');
      walk(tree).find(node => node.type === 'TextInput').props.onChangeText('  What did I spend?  ');
      tree = render();
      const ask = walk(tree).find(node => node.props?.testID === 'assistant-send');
      assert.equal(ask.props.disabled, false);
      ask.props.onPress();
      assert.deepEqual(calls, ['What did I spend?']);
      tree = render();
      assert.equal(walk(tree).find(node => node.type === 'TextInput').props.value, '');
      assert.ok(text(tree).includes('A local answer'));
    });

    test(`${platform}/${language}: Home exposes a named Bills action for due and upcoming widgets`, () => {
      const h = createHarness({ language });
      h.deps['react-native'].Platform.OS = platform;
      const project = h.deps['@/lib/dashboard-projection'].projectDashboard;
      h.deps['@/lib/dashboard-projection'].projectDashboard = () => ({ ...project(), upcoming: { items: [
        { id: 'due', title: 'Due bill', kind: 'bill', billId: 'due', amountFils: 10000, daysLeft: 1, urgent: true },
        { id: 'later', title: 'Later bill', kind: 'bill', billId: 'later', amountFils: 20000, daysLeft: 20 },
      ] } });
      const tree = h.render('home');
      for (const id of ['due', 'upcoming']) {
        const widget = walk(tree).find(node => node.props?.testID === `home-widget-${id}`);
        assert.ok(widget, `the ${id} widget is visible`);
        const action = walk(widget).find(node => node.props?.accessibilityRole === 'button');
        assert.equal(action.props.accessibilityLabel, language === 'ar' ? 'عرض كل الدفعات' : 'View all payments');
        action.props.onPress();
      }
      assert.deepEqual(h.events, [['route', '/bills'], ['route', '/bills']]);
    });
  }
}

for (const language of ['en', 'ar']) {
  test(`${language}: feedback parser disclosure points onward and opens its named route`, () => {
    const h = createHarness({ language });
    h.deps['expo-constants'] = { expoConfig: { version: 'test' } };
    h.deps['@/components/workflows/workflow-surfaces'] = { WorkflowHero: props => h.jsx('Hero', props) };
    h.deps['@/components/workflows/workflow-copy'] = { workflowCopy: () => ({}) };
    h.deps['@/components/ui/section-header'] = { SectionHeader: props => h.jsx('SectionHeader', props) };
    h.local('@/components/ui/layout');
    h.deps['@/lib/feedback'] = {
      buildFeedbackPayload: ({ message }) => ({ message }), formatFeedbackPayload: () => '',
      scrubFeedbackMessage: value => value, FEEDBACK_MESSAGE_MAX: 2000,
      FeedbackTransportMissingError: class extends Error {},
      submitFeedback: () => { throw new Error('No network send belongs in this test'); },
    };
    h.deps['@/lib/feedback-transport'] = { FeedbackSendError: class extends Error {} };
    h.deps['@/lib/parser-research-source'] = { isParserResearchBuild: () => true };
    const tree = load(path.join(root, 'src/app/feedback.tsx'), h.deps).default();
    const row = walk(tree).find(node => node.props?.accessibilityLabel === h.deps['@/lib/i18n'].t('feedbackParserTitle'));
    assert.ok(row);
    row.props.onPress();
    assert.deepEqual(h.events, [['route', '/parser-research']]);
    const chevron = walk(row).filter(node => node.type === 'svg').at(-1);
    const shape = walk(chevron).find(node => node.type === 'path');
    assert.equal(shape.props.d, 'M9 5 L16 12 L9 19', 'the shared icon starts from the canonical onward glyph');
    assert.equal(chevron.props.style?.transform?.[0]?.scaleX ?? 1, language === 'ar' ? -1 : 1);
  });
}
