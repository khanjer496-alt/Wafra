'use strict';
// Runs the actual Assistant screen and local ledger engine. Hooks, scheduling,
// store/provider inputs and native visual surfaces are explicit test boundaries;
// this is not a native renderer or physical keyboard/focus validation.
const test = require('node:test');
const assert = require('node:assert/strict');
const path = require('node:path');
const fs = require('node:fs');
const os = require('node:os');
const root = process.env.WAFRA_TEST_ROOT ?? path.resolve(__dirname, '../../..');
const load = require(path.join(root, 'scripts/test/repair/load-typescript.cjs'));
const { createHarness, walk, text } = require(path.join(root, 'scripts/test/repair/reference-harness.cjs'));
const engine = require(path.join(root, 'scripts/test/build/wafra-assistant.js'));
const moneyFormat = require(path.join(root, 'scripts/test/build/format.js'));
const screenPath = path.join(root, 'src/app/assistant.tsx');

function sessionHarness(options = {}) {
  const h = createHarness({ language: 'en', state: { transactions: [], bills: [], cardDues: [], ...options.state } });
  let state = { ...h.state, monthStartDay: 1, ...options.state };
  let generation = options.generation ?? 1;
  let period = options.period ?? { mode: 'month', key: '2026-09' };
  let now = '2026-09-20T12:00:00Z';
  let focused = true;
  let cursor = 0;
  let changed = false;
  let tree;
  let nextFrame = 0;
  let nextInterval = 0;
  const slots = [];
  const pendingEffects = [];
  const frames = new Map();
  const intervals = new Map();
  const nativeListeners = new Set();
  const calls = [];
  const cleanups = [];
  const getStateSnapshot = () => state;
  const getStateGeneration = () => generation;
  class Clock extends Date {
    constructor(...args) { super(...(args.length ? args : [now])); }
    static now() { return Date.parse(now); }
  }
  const sameDeps = (a, b) => !!a && !!b && a.length === b.length && a.every((value, i) => Object.is(value, b[i]));
  function slot(kind) {
    const index = cursor++;
    if (!slots[index]) slots[index] = { kind };
    assert.equal(slots[index].kind, kind, `hook order changed at slot ${index}`);
    return slots[index];
  }
  const react = h.deps.react;
  react.useState = initial => {
    const item = slot('state');
    if (!Object.hasOwn(item, 'value')) {
      item.value = typeof initial === 'function' ? initial() : initial;
      item.set = next => {
        const result = typeof next === 'function' ? next(item.value) : next;
        if (!Object.is(result, item.value)) { item.value = result; changed = true; }
      };
    }
    return [item.value, item.set];
  };
  react.useRef = value => {
    const item = slot('ref');
    if (!item.value) item.value = { current: value };
    return item.value;
  };
  react.useMemo = (calculate, deps) => {
    const item = slot('memo');
    if (!sameDeps(item.deps, deps)) { item.value = calculate(); item.deps = deps; }
    return item.value;
  };
  react.useCallback = (callback, deps) => react.useMemo(() => callback, deps);
  react.useEffect = (effect, deps) => {
    const item = slot('effect');
    if (sameDeps(item.deps, deps)) return;
    item.deps = deps;
    pendingEffects.push(() => {
      item.cleanup?.();
      item.cleanup = effect();
    });
  };
  h.deps['@/lib/store'] = { useStore: () => ({ state, getStateSnapshot, getStateGeneration }) };
  h.deps['@/lib/period-context'] = { usePeriod: () => ({ period }) };
  h.deps['@/lib/period'].periodRange = () => '';
  h.deps['@/components/assistant-findings'] = {
    AssistantFindings: props => h.jsx('Findings', props), AssistantCoverage: props => h.jsx('Coverage', props),
  };
  h.deps['expo-router'].useLocalSearchParams = () => ({ question: options.question });
  h.deps['expo-router'].useFocusEffect = callback => react.useEffect(() => focused ? callback() : undefined, [callback, focused]);
  h.deps['@react-navigation/elements'] = { useHeaderHeight: () => 90 };
  h.deps['@/hooks/use-keyboard-height'] = { useKeyboardHeight: () => 0 };
  h.deps['react-native'].Platform.OS = 'ios';
  h.deps['react-native'].AccessibilityInfo = { announceForAccessibility() {} };
  h.deps['react-native'].Keyboard = { dismiss() {} };
  h.deps['react-native'].useWindowDimensions = () => ({ width: 390, height: 844, fontScale: 1 });
  h.deps['react-native'].AppState = { addEventListener: (_event, callback) => {
    nativeListeners.add(callback);
    return { remove: () => nativeListeners.delete(callback) };
  } };
  // Child visual surfaces retain their actual props/handlers without sharing
  // the screen's hook slots. Their own layout/keyboard tests live separately.
  for (const [module, name, type] of [
    ['@/components/themed-text', 'ThemedText', 'Text'],
    ['@/components/ui/controls', 'Button', 'Button'],
    ['@/components/ui/icon', 'Icon', 'Icon'],
    ['@/components/ui/screen-scaffold', 'ScreenScaffold', 'Scaffold'],
    ['@/components/period-sheet', 'PeriodSheet', 'PeriodSheet'],
    ['@/components/assistant-evidence-sheet', 'AssistantEvidenceSheet', 'EvidenceSheet'],
  ]) h.deps[module] = { [name]: props => h.jsx(type, { ...props, children: props.children ?? props.label }) };
  h.deps['@/lib/wafra-assistant'] = {
    ...engine,
    runWafraAssistant: (...args) => {
      calls.push({ kind: 'ask', state: args[0], question: args[1], now: args[2], previous: args[3], period: args[4] });
      return engine.runWafraAssistant(...args);
    },
    executeAssistantTool: (...args) => {
      calls.push({ kind: 'refresh', state: args[0], request: args[1], now: args[2] });
      return engine.executeAssistantTool(...args);
    },
  };
  const globals = {
    Date: Clock,
    requestAnimationFrame: callback => { const id = ++nextFrame; frames.set(id, callback); return id; },
    cancelAnimationFrame: id => frames.delete(id),
    setInterval: callback => { const id = ++nextInterval; intervals.set(id, callback); return id; },
    clearInterval: id => intervals.delete(id),
  };
  // A mutation baseline is always a temporary source file, never the workspace.
  let sourceFile = screenPath;
  if (options.sourceTransform) {
    const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'wafra-assistant-session-baseline-'));
    sourceFile = path.join(directory, 'assistant.tsx');
    fs.writeFileSync(sourceFile, options.sourceTransform(fs.readFileSync(screenPath, 'utf8')));
    cleanups.push(() => fs.rmSync(directory, { recursive: true, force: true }));
  }
  const Screen = load(sourceFile, h.deps, globals).default;
  function render() {
    moneyFormat.setMonthStartDay(state.monthStartDay ?? 1);
    let iterations = 0;
    do {
      assert.ok(++iterations < 20, 'hook render/effect loop did not settle');
      cursor = 0;
      changed = false;
      tree = Screen();
      while (pendingEffects.length) pendingEffects.shift()();
    } while (changed);
    return tree;
  }
  function flushFrames() {
    const pending = [...frames.entries()];
    frames.clear();
    for (const [, callback] of pending) callback();
    return render();
  }
  const find = predicate => walk(tree).find(predicate);
  const button = label => find(node => node.type === 'Button' && node.props.label === label);
  const turns = () => walk(tree).filter(node => node.props?.testID === 'assistant-turn');
  return {
    render, flushFrames, calls, turns, find, button,
    get tree() { return tree; }, get state() { return state; }, get frameCount() { return frames.size; },
    patchState: patch => { state = { ...state, ...patch }; },
    setGeneration: value => { generation = value; },
    setPeriod: value => { period = value; },
    setNow: value => { now = value; },
    setFocused: value => { focused = value; return render(); },
    tick: () => { for (const callback of intervals.values()) callback(); return render(); },
    appActive: () => { for (const callback of nativeListeners) callback('active'); return render(); },
    submit: question => {
      find(node => node.props?.testID === 'assistant-input').props.onChangeText(question);
      render();
      find(node => node.props?.testID === 'assistant-send').props.onPress();
      return render();
    },
    dispose: () => { for (const item of slots) item.cleanup?.(); for (const cleanup of cleanups) cleanup(); moneyFormat.setMonthStartDay(1); },
  };
}

const transaction = (amountFils = 6_000) => ({
  id: 'session-record', title: 'Store', amountFils, accountId: 'enbd', category: 'dining',
  type: 'expense', source: 'manual', date: '2026-09-01',
});
const fixture = { hydrated: true, transactions: [transaction()], bills: [], cardDues: [], notSubscriptions: [] };
const driverFixture = { ...fixture, transactions: [
  { ...transaction(6_000), id: 'driver-current', title: 'Cedar', category: 'groceries' },
  { ...transaction(1_000), id: 'driver-earlier', title: 'Cedar', category: 'groceries', date: '2026-08-01' },
  { ...transaction(1_000), id: 'other-current', title: 'Cafe' },
  { ...transaction(2_000), id: 'other-earlier', title: 'Cafe', date: '2026-08-01' },
  { ...transaction(10_000), id: 'driver-rent', title: 'Rent', category: 'rent' },
  { ...transaction(90_000), id: 'other-account', title: 'Cedar', category: 'groceries', accountId: 'adcb' },
] };
function using(options, run) {
  const h = sessionHarness(options);
  try { return run(h); } finally { h.dispose(); }
}

test('finding proof and an older finding exploration retain that finding exact source and scope', () => using({ state: driverFixture }, h => {
  h.render(); h.submit('Why did my spending change from Emirates NBD account excluding rent?');
  const component = h.find(node => node.type === 'Findings');
  assert.ok(component, 'comparison produces actionable findings');
  const finding = component.props.findings.find(item => item.id === 'merchant:cedar');
  assert.ok(finding?.request);
  component.props.onReview(finding.id); h.render();
  const proof = h.find(node => node.type === 'EvidenceSheet');
  assert.deepEqual(JSON.parse(JSON.stringify(proof.props.evidence.map(group => group.transactionIds))), [['driver-current'], ['driver-earlier']]);
  proof.props.onClose(); h.render();
  h.submit('How much income did I receive?');
  component.props.onAsk(finding); h.render();
  const execution = h.calls.at(-1);
  assert.equal(execution.kind, 'refresh');
  assert.deepEqual(execution.request, finding.request, 'an older finding executes its own typed request, never the latest unrelated context');
  assert.deepEqual(Array.from(execution.request.accountIds), ['enbd']);
  assert.deepEqual(Array.from(execution.request.excludedCategories), ['rent']);
}));

test('a queued finding action cannot read or announce a replacement or changed ledger', () => {
  for (const change of ['generation', 'records', 'day']) using({ state: driverFixture }, h => {
    h.render(); h.submit('Why did my spending change from Emirates NBD account excluding rent?');
    const component = h.find(node => node.type === 'Findings');
    assert.ok(component);
    const finding = component.props.findings.find(item => item.request);
    const callCount = h.calls.length;
    if (change === 'generation') { h.patchState({ transactions: [transaction(400_000)] }); h.setGeneration(2); }
    if (change === 'records') h.patchState({ transactions: [transaction(400_000)] });
    if (change === 'day') h.setNow('2026-09-21T12:00:00Z');
    // Invoke the callback before React has rendered the changed store or date.
    component.props.onAsk(finding);
    assert.equal(h.calls.length, callCount, 'stale finding callback must not execute: ' + change);
  });
});

test('queued send and refresh actions cannot cross ledger replacement', () => {
  for (const action of ['send', 'refresh']) using({ state: fixture }, h => {
    h.render(); h.submit('How much did I spend?');
    let press;
    if (action === 'send') {
      h.find(node => node.props?.testID === 'assistant-input').props.onChangeText('How much income did I receive?');
      h.render();
      press = h.find(node => node.props?.testID === 'assistant-send').props.onPress;
    } else {
      h.patchState({ transactions: [transaction(7_000)] }); h.render();
      press = h.button('Refresh answer').props.onPress;
    }
    const count = h.calls.length;
    h.patchState({ transactions: [transaction(900_000)] }); h.setGeneration(2);
    press();
    assert.equal(h.calls.length, count, 'obsolete action must not read replacement ledger: ' + action);
  });
});

function coldHydrationScenario(sourceTransform) {
  return using({ sourceTransform, generation: 0, question: 'How much did I spend?',
    state: { ...fixture, hydrated: false, transactions: [] }, period: { mode: 'month', key: '2026-09' } }, h => {
    h.render();
    assert.equal(h.calls.length, 0, 'a cold screen must not read an unhydrated ledger');
    h.patchState({ ...fixture, monthStartDay: 25 });
    h.setGeneration(1);
    h.render();
    assert.equal(h.calls.length, 0, 'hydration waits for the reporting period to settle');
    h.setPeriod({ mode: 'month', key: '2026-08' });
    h.render();
    h.flushFrames();
    assert.equal(h.calls.length, 1, 'the route question executes exactly once after hydration');
    assert.equal(h.calls[0].period.key, '2026-08');
    assert.equal(h.turns().length, 1);
    assert.match(text(h.tree), /60/);
    h.flushFrames();
    assert.equal(h.calls.length, 1, 'extra frames cannot replay the route question');
  });
}

test('cold route waits for hydration and the salary-day reporting period, then asks exactly once', () => coldHydrationScenario());

test('equal-value period objects retain the conversation and its open evidence', () => using({ state: fixture }, h => {
  h.render();
  h.submit('How much did I spend?');
  h.button('View transactions').props.onPress();
  h.render();
  assert.ok(h.find(node => node.type === 'EvidenceSheet'));
  h.setPeriod({ mode: 'month', key: '2026-09' });
  h.render();
  assert.equal(h.turns().length, 1);
  assert.ok(h.find(node => node.type === 'EvidenceSheet'));
  assert.equal(h.calls.length, 1);
}));

test('replacement of a loaded ledger clears turns and evidence without replaying the route question', () => using({ state: fixture, question: 'How much did I spend?' }, h => {
  h.render(); h.flushFrames();
  h.button('View transactions').props.onPress(); h.render();
  assert.ok(h.find(node => node.type === 'EvidenceSheet'));
  h.patchState({ transactions: [] }); h.setGeneration(2); h.render(); h.flushFrames();
  assert.equal(h.turns().length, 0);
  assert.equal(h.find(node => node.type === 'EvidenceSheet'), undefined);
  assert.equal(h.calls.length, 1);
  h.patchState({ transactions: [transaction(90_000)] }); h.render(); h.flushFrames();
  assert.equal(h.calls.length, 1, 'a restored ledger must not replay an old route request');
}));

function eraseBeforeCleanupScenario(sourceTransform) {
  return using({ sourceTransform, state: fixture, question: 'How much did I spend?' }, h => {
    h.render();
    assert.equal(h.frameCount, 1);
    h.patchState({ transactions: [] }); h.setGeneration(2);
    // No render/cleanup has happened yet. Native scheduling can deliver the
    // old frame between the synchronous erase and React's cleanup pass.
    h.flushFrames();
    assert.equal(h.calls.length, 0, 'an old route frame must check its captured generation before reading a new ledger');
    assert.equal(h.turns().length, 0);
    h.flushFrames();
    assert.equal(h.calls.length, 0);
  });
}
test('a queued route frame cannot cross a ledger erase before React cleanup', () => eraseBeforeCleanupScenario());

function refreshDateScenario(sourceTransform) {
  return using({ sourceTransform, state: fixture }, h => {
    h.render(); h.submit('How much do I spend per day?');
    assert.equal(h.calls[0].now.toISOString(), '2026-09-20T12:00:00.000Z');
    h.setFocused(false); h.setNow('2026-09-21T12:00:00Z'); h.setFocused(true);
    assert.ok(h.button('Refresh answer'), 'returning after midnight marks an answer stale');
    assert.equal(h.button('View transactions'), undefined, 'a stale answer cannot expose an apparently current ledger proof');
    h.button('Refresh answer').props.onPress(); h.render();
    assert.equal(h.calls[1].kind, 'refresh');
    assert.equal(h.calls[1].now.toISOString(), '2026-09-21T12:00:00.000Z', 'refresh must use the current date rather than answeredAt');
    assert.equal(h.button('Refresh answer'), undefined, 'refresh advances answeredAt and removes staleness');
    assert.match(text(h.tree), /21 days/);
    h.setNow('2026-09-22T12:00:00Z'); h.tick();
    assert.ok(h.button('Refresh answer'), 'minute refresh catches a later day while the screen stays focused');
  });
}
test('focus/date rollover marks old answers stale and refresh uses the current date', () => refreshDateScenario());

test('native app activation catches midnight and ledger edits invalidate open evidence until refreshed', () => using({ state: fixture }, h => {
  h.render(); h.submit('How much did I spend?');
  h.button('View transactions').props.onPress(); h.render();
  assert.equal(h.find(node => node.type === 'EvidenceSheet').props.stale, false);
  h.patchState({ transactions: [transaction(9_000)] }); h.render();
  const staleSheet = h.find(node => node.type === 'EvidenceSheet');
  assert.equal(staleSheet.props.stale, true);
  assert.equal(staleSheet.props.evidence[0].totalFils, 6_000, 'an old answer remains an old answer until explicitly refreshed');
  assert.equal(staleSheet.props.state, h.state, 'the evidence boundary receives the latest ledger and a stale flag');
  staleSheet.props.onRefresh(); h.render();
  assert.equal(h.calls.at(-1).state, h.state);
  assert.equal(h.find(node => node.type === 'EvidenceSheet'), undefined);
  assert.equal(h.button('Refresh answer'), undefined, 'refresh saves the new ledger input references');
  h.button('View transactions').props.onPress(); h.render();
  assert.equal(h.find(node => node.type === 'EvidenceSheet').props.evidence[0].totalFils, 9_000);
  h.setNow('2026-09-21T01:00:00Z'); h.appActive();
  assert.equal(h.find(node => node.type === 'EvidenceSheet').props.stale, true);
  assert.ok(h.button('Refresh answer'));
}));

// Small isolated mutation checks show these tests fail for the exact reviewed
// regressions. They never rewrite or load an older checkout over current source.
function replaceOnce(source, before, after) {
  assert.ok(source.includes(before), 'mutation baseline must match the reviewed source statement');
  return source.replace(before, after);
}
test('regression proof: a cold-hydration route marked handled too early is caught', () => {
  assert.throws(() => coldHydrationScenario(source => replaceOnce(source,
    'if (hadHydratedLedger.current) routeQuestionHandled.current =', 'routeQuestionHandled.current =')),
  /route question executes exactly once/);
});
test('regression proof: removing both queued-frame and request generation checks is caught', () => {
  assert.throws(() => eraseBeforeCleanupScenario(source => replaceOnce(replaceOnce(source,
    'if (getStateGeneration() !== generation) return;', '/* prior frame omitted the generation guard */'),
  ' || generation !== getStateGeneration()', '')),
  /old route frame must check/);
});
test('regression proof: refreshing at the original answer date is caught', () => {
  assert.throws(() => refreshDateScenario(source => replaceOnce(source,
    'executeAssistantTool(snapshot, turn.request, now)', 'executeAssistantTool(snapshot, turn.request, turn.answeredAt)')),
  /refresh must use the current date/);
});

test('period picker cancel preserves context; explicit current-month apply resets an old question even when the shared period is unchanged', () => using({ state: fixture }, h => {
  h.render(); h.submit('How much did I spend last month?');
  const openPicker = () => {
    h.find(node => node.props?.accessibilityLabel?.startsWith('Change reporting period:')).props.onPress();
    h.render();
    return h.find(node => node.type === 'PeriodSheet');
  };
  const firstPicker = openPicker();
  assert.equal(firstPicker.props.visible, true);
  assert.equal(firstPicker.props.selectedPeriod.key, '2026-08', 'picker reflects the current conversation period');
  firstPicker.props.onClose(); h.render();
  assert.equal(h.turns().length, 1, 'canceling the picker leaves the answer and context intact');
  const nextPicker = openPicker();
  const currentMonth = { mode: 'month', key: '2026-09' };
  h.setPeriod(currentMonth); // The real sheet applies this to PeriodProvider.
  nextPicker.props.onApply(currentMonth);
  nextPicker.props.onClose();
  h.render();
  assert.equal(h.turns().length, 0, 'an explicit apply resets even when the provider value is already this month');
  h.submit('How much did I spend?');
  assert.equal(h.calls.at(-1).period.key, '2026-09');
  assert.equal(h.calls.at(-1).previous, undefined, 'the discarded August request must not override the selection');
  h.button('View transactions').props.onPress(); h.render();
  assert.equal(h.find(node => node.type === 'EvidenceSheet').props.evidence[0].totalFils, 6_000);
}));
