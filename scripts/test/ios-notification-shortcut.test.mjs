import assert from 'node:assert/strict';
import { execFileSync, spawnSync } from 'node:child_process';
import { mkdtemp, readFile, readdir, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { test } from 'node:test';

const builderURL = new URL('../build-ios-notification-shortcut.mjs', import.meta.url);
const nativeAction = 'app.wafra.ios.CaptureWafraNotificationIntent';
const setupText = 'Wafra notification setup check';
const expectedDescriptor = {
  TeamIdentifier: 'UV7YN4GQ66',
  BundleIdentifier: 'app.wafra.ios',
  Name: 'Wafra',
  AppIntentIdentifier: 'CaptureWafraNotificationIntent',
};

async function builder() {
  // Give the initial red run a direct missing-feature assertion rather than an
  // import crash. Other import failures are never swallowed.
  try {
    return await import(builderURL.href);
  } catch (error) {
    if (error.code === 'ERR_MODULE_NOT_FOUND' && error.url === builderURL.href) {
      assert.fail('The notification Shortcut builder is not implemented yet');
    }
    throw error;
  }
}

const params = action => action.WFWorkflowActionParameters;
const kind = action => action.WFWorkflowActionIdentifier;
const actionsOf = (graph, identifier) => graph.WFWorkflowActions.filter(action => kind(action) === identifier);

// Evaluate only our emitted control flow and text bindings over synthetic text.
// This is NOT Apple's runtime, Notification-to-Text conversion, App Intent
// deserialization, permission handling, or evidence of real notification capture.
// The native boundary records arguments only: it does not simulate the ledger.
function evaluate(graph, input, invokeNative = () => undefined) {
  assert.ok(input == null || typeof input === 'string', 'only synthetic text/no-input fixtures are supported');
  const outputs = new Map();
  const stack = [];
  const calls = [];

  const readReference = reference => {
    let value;
    if (reference.Type === 'ExtensionInput') value = input;
    else if (reference.Type === 'ActionOutput') {
      assert.ok(outputs.has(reference.OutputUUID), 'output reference must resolve to an earlier executed action');
      value = outputs.get(reference.OutputUUID);
    } else assert.fail(`unexpected reference type: ${reference.Type}`);
    for (const coercion of reference.Aggrandizements ?? []) {
      assert.deepEqual(coercion, {
        Type: 'WFCoercionVariableAggrandizement',
        CoercionItemClass: 'WFStringContentItem',
      }, 'do not invent notification properties or trusted bank identity');
      assert.equal(typeof value, 'string', 'text conversion is modeled only for synthetic text');
    }
    return value;
  };

  const read = token => {
    if (token.Type === 'Variable' && token.Variable) return read(token.Variable);
    if (token.WFSerializationType === 'WFTextTokenAttachment') return readReference(token.Value);
    assert.equal(token.WFSerializationType, 'WFTextTokenString', 'native String arguments use text-token serialization');
    const { string, attachmentsByRange = {} } = token.Value;
    assert.equal(typeof string, 'string');
    if (!Object.keys(attachmentsByRange).length) return string;
    assert.equal(string, '\ufffc', 'a bound input must not add or remove notification text');
    assert.deepEqual(Object.keys(attachmentsByRange), ['{0, 1}']);
    return readReference(attachmentsByRange['{0, 1}']);
  };

  for (const action of graph.WFWorkflowActions) {
    const p = params(action);
    if (kind(action) === 'is.workflow.actions.conditional') {
      if (p.WFControlFlowMode === 2) {
        assert.equal(stack.pop()?.group, p.GroupingIdentifier, 'conditional blocks must close their own group');
      } else {
        assert.equal(p.WFControlFlowMode, 0);
        assert.equal(p.WFCondition, 101, 'setup is only for missing input');
        const active = stack.every(frame => frame.active);
        const value = active ? read(p.WFInput) : undefined;
        stack.push({ group: p.GroupingIdentifier, active: active && (value == null || value === '') });
      }
      continue;
    }
    if (!stack.every(frame => frame.active)) continue;
    switch (kind(action)) {
      case 'is.workflow.actions.gettext': {
        const text = read(p.WFTextActionText);
        assert.equal(typeof text, 'string');
        outputs.set(p.UUID, text);
        break;
      }
      case nativeAction: {
        assert.deepEqual(Object.keys(p).sort(), ['AppIntentDescriptor', 'UUID', 'text']);
        assert.deepEqual(p.AppIntentDescriptor, expectedDescriptor);
        const text = read(p.text);
        assert.equal(typeof text, 'string');
        calls.push(text);
        invokeNative(text);
        break;
      }
      case 'is.workflow.actions.exit':
        return { calls, stopped: true };
      default:
        assert.fail(`unapproved action is reachable: ${kind(action)}`);
    }
  }
  assert.equal(stack.length, 0);
  return { calls, stopped: false };
}

for (const [label, input] of [['omitted', undefined], ['null', null], ['empty text', '']]) {
  test(`manual ${label} input invokes only the benign setup text, then stops`, async () => {
    const { buildNotificationShortcut } = await builder();
    assert.deepEqual(evaluate(buildNotificationShortcut(), input), { calls: [setupText], stopped: true });
  });
}

for (const [label, input] of [
  ['ordinary alert', 'Card 1234 charged AED 42.50 at TEST SHOP.'],
  ['Unicode and multiline', 'تم الشراء بقيمة ١٢٫٥٠ د.إ\n商店 🧾\r\nBalance: 90.00'],
  ['surrounding whitespace', ' \tCard charged AED 2.00\n '],
  ['whitespace only', ' \t\n'],
  ['setup marker', 'Wafra notification setup check'],
  ['marker within an alert', 'Card charged AED 1 at Wafra notification setup check store'],
]) {
  test(`${label} reaches the native text parameter exactly once and unchanged`, async () => {
    const { buildNotificationShortcut } = await builder();
    assert.deepEqual(evaluate(buildNotificationShortcut(), input), { calls: [input], stopped: true });
  });
}

for (const input of [undefined, 'Card charged AED 42.50']) {
  test(`native failure propagates without retry for ${input === undefined ? 'setup' : 'live text'}`, async () => {
    const { buildNotificationShortcut } = await builder();
    const nativeFailure = new Error('Synthetic native storage failure');
    const attempts = [];
    assert.throws(() => evaluate(buildNotificationShortcut(), input, text => {
      attempts.push(text);
      throw nativeFailure;
    }), error => error === nativeFailure);
    assert.deepEqual(attempts, [input ?? setupText]);
  });
}

test('synthetic evaluation refuses object/list conversion assumptions', async () => {
  const { buildNotificationShortcut } = await builder();
  // Deliberately not Notification fixtures: their real serialized shape and
  // conversion are unknown. Do not make a synthetic success claim for them.
  for (const input of [{ body: 'unknown object shape' }, [], ['first', 'second'], [{}, {}]]) {
    assert.throws(() => evaluate(buildNotificationShortcut(), input), /only synthetic text\/no-input fixtures/);
  }
});

test('live input explicitly converts Shortcut Input to text before the native String parameter', async () => {
  const { buildNotificationShortcut } = await builder();
  const graph = buildNotificationShortcut();
  const textActions = actionsOf(graph, 'is.workflow.actions.gettext');
  assert.equal(textActions.length, 1);
  const text = params(textActions[0]);
  assert.deepEqual(text.WFTextActionText, {
    Value: { string: '\ufffc', attachmentsByRange: { '{0, 1}': {
      Type: 'ExtensionInput',
      Aggrandizements: [{ Type: 'WFCoercionVariableAggrandizement', CoercionItemClass: 'WFStringContentItem' }],
    } } },
    WFSerializationType: 'WFTextTokenString',
  });
  const nativeCalls = actionsOf(graph, nativeAction);
  assert.equal(nativeCalls.length, 2, 'setup and live paths each contain one native invocation');
  assert.deepEqual(params(nativeCalls[1]).text, {
    Value: { string: '\ufffc', attachmentsByRange: { '{0, 1}': {
      Type: 'ActionOutput', OutputUUID: text.UUID, OutputName: text.CustomOutputName,
    } } },
    WFSerializationType: 'WFTextTokenString',
  });
});

test('artifact accepts text without prompts and suppresses native output', async () => {
  const { buildNotificationShortcut, verifyNotificationShortcutGraph } = await builder();
  const graph = buildNotificationShortcut();
  assert.equal(graph.WFWorkflowName, 'Wafra Notifications v1');
  assert.deepEqual(graph.WFWorkflowInputContentItemClasses, ['WFStringContentItem']);
  assert.deepEqual(graph.WFWorkflowImportQuestions, []);
  assert.deepEqual(graph.WFWorkflowOutputContentItemClasses, []);
  assert.equal(graph.WFWorkflowHasShortcutInputVariables, true);
  assert.equal(graph.WFWorkflowHasOutputFallback, false);
  assert.equal(verifyNotificationShortcutGraph(JSON.parse(JSON.stringify(graph))), true);
});

// Every mutation below is an unsafe artifact change, rather than a snapshot of
// the builder itself. The verifier must inspect the whole graph, including
// unreachable actions and extra parameters, before signing or trusting it.
const mutations = [
  ['wrong native bundle', graph => { params(actionsOf(graph, nativeAction)[1]).AppIntentDescriptor.BundleIdentifier = 'app.other'; }],
  ['wrong native team', graph => { params(actionsOf(graph, nativeAction)[1]).AppIntentDescriptor.TeamIdentifier = 'OTHERTEAM'; }],
  ['wrong native app name', graph => { params(actionsOf(graph, nativeAction)[1]).AppIntentDescriptor.Name = 'Other'; }],
  ['wrong native intent descriptor', graph => { params(actionsOf(graph, nativeAction)[1]).AppIntentDescriptor.AppIntentIdentifier = 'StageWafraLiveTextIntent'; }],
  ['wrong native action', graph => { actionsOf(graph, nativeAction)[1].WFWorkflowActionIdentifier = 'app.wafra.ios.StageWafraLiveTextIntent'; }],
  ['wrong native parameter', graph => { const p = params(actionsOf(graph, nativeAction)[1]); p.body = p.text; delete p.text; }],
  ['unbound native input', graph => { params(actionsOf(graph, nativeAction)[1]).text = { Value: { string: 'Shortcut Input' }, WFSerializationType: 'WFTextTokenString' }; }],
  ['unresolved native output', graph => { params(actionsOf(graph, nativeAction)[1]).text.Value.attachmentsByRange['{0, 1}'].OutputUUID = '00000000-0000-4000-8000-000000000000'; }],
  ['literal surrounding live input', graph => { params(actionsOf(graph, nativeAction)[1]).text.Value.string = 'prefix \ufffc'; }],
  ['native input directly from extension', graph => { params(actionsOf(graph, nativeAction)[1]).text.Value.attachmentsByRange['{0, 1}'] = { Type: 'ExtensionInput' }; }],
  ['missing text conversion', graph => { delete params(actionsOf(graph, 'is.workflow.actions.gettext')[0]).WFTextActionText.Value.attachmentsByRange['{0, 1}'].Aggrandizements; }],
  ['invented notification property', graph => { params(actionsOf(graph, 'is.workflow.actions.gettext')[0]).WFTextActionText.Value.attachmentsByRange['{0, 1}'].Aggrandizements.unshift({ Type: 'WFPropertyVariableAggrandizement', PropertyName: 'Body' }); }],
  ['inverted setup branch', graph => { params(graph.WFWorkflowActions[0]).WFCondition = 100; }],
  ['broken setup group', graph => { params(actionsOf(graph, 'is.workflow.actions.conditional')[1]).GroupingIdentifier = 'different-group'; }],
  ['financial setup marker', graph => { params(actionsOf(graph, nativeAction)[0]).text.Value.string = 'Card charged AED 10'; }],
  ['setup falls through to live capture', graph => { graph.WFWorkflowActions.splice(graph.WFWorkflowActions.findIndex(action => kind(action) === 'is.workflow.actions.exit'), 1); }],
  ['duplicate native invocation', graph => { graph.WFWorkflowActions.splice(-1, 0, structuredClone(actionsOf(graph, nativeAction)[1])); }],
  ['duplicate output UUID', graph => { params(actionsOf(graph, 'is.workflow.actions.gettext')[0]).UUID = params(actionsOf(graph, nativeAction)[0]).UUID; }],
  ['returns bank text', graph => { graph.WFWorkflowHasOutputFallback = true; }],
  ['adds import prompt', graph => { graph.WFWorkflowImportQuestions.push({ Text: 'Enter bank text' }); }],
  ['guessed notification automation schema', graph => { graph.WFWorkflowTriggers = [{ Type: 'Notification' }]; }],
  ['hidden credential parameter', graph => { params(actionsOf(graph, nativeAction)[1]).Authorization = 'Bearer synthetic-test-credential'; }],
  ['null plist value', graph => { params(actionsOf(graph, nativeAction)[1]).unused = null; }],
  ['unrecognized parameter', graph => { params(actionsOf(graph, nativeAction)[1]).unused = false; }],
];

for (const forbidden of [
  'com.apple.MobileSMS.MessageEntity',
  'app.wafra.ios.BeginWafraPagedImportIntent',
  'is.workflow.actions.downloadurl',
  'is.workflow.actions.openurl',
  'is.workflow.actions.getcontentsurl',
  'is.workflow.actions.documentpicker.open',
  'is.workflow.actions.appendfile',
  'is.workflow.actions.getclipboard',
  'is.workflow.actions.setclipboard',
  'is.workflow.actions.showresult',
  'is.workflow.actions.notification',
  'is.workflow.actions.log',
  'is.workflow.actions.quicklook',
  'is.workflow.actions.runworkflow',
]) {
  mutations.push([`extra ${forbidden}`, graph => {
    graph.WFWorkflowActions.push({ WFWorkflowActionIdentifier: forbidden, WFWorkflowActionParameters: {} });
  }]);
}

for (const [label, mutate] of mutations) {
  test(`full-graph verifier rejects ${label}`, async () => {
    const { buildNotificationShortcut, verifyNotificationShortcutGraph } = await builder();
    const graph = buildNotificationShortcut();
    mutate(graph);
    assert.throws(() => verifyNotificationShortcutGraph(graph), /Wafra Notifications/);
  });
}

test('full-graph verifier rejects malformed roots and action lists', async () => {
  const { verifyNotificationShortcutGraph } = await builder();
  for (const value of [undefined, null, [], 'shortcut', {}, { WFWorkflowActions: null }, { WFWorkflowActions: [null] }]) {
    assert.throws(() => verifyNotificationShortcutGraph(value), /Wafra Notifications/);
  }
});

test('CLI generates deterministic verified JSON and can be imported without writing files', async () => {
  const { verifyNotificationShortcutGraph } = await builder();
  const directory = await mkdtemp(join(tmpdir(), 'wafra-notification-shortcut-'));
  try {
    execFileSync(process.execPath, ['--input-type=module', '--eval', `await import(${JSON.stringify(builderURL.href)})`], { cwd: directory });
    assert.deepEqual(await readdir(directory), [], 'importing the builder must not execute the CLI');
    const paths = [join(directory, 'first.json'), join(directory, 'second.json')];
    for (const path of paths) {
      const stdout = execFileSync(process.execPath, [fileURLToPath(builderURL), path], { cwd: directory, encoding: 'utf8' });
      assert.equal(stdout.trim(), path);
    }
    const [first, second] = await Promise.all(paths.map(path => readFile(path, 'utf8')));
    assert.equal(first, second, 'repeated builds must be byte-identical for artifact review');
    const parsed = JSON.parse(first);
    assert.equal(verifyNotificationShortcutGraph(parsed), true);
    assert.deepEqual(evaluate(parsed, 'CLI synthetic notification'), { calls: ['CLI synthetic notification'], stopped: true });
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
});

test('CLI reports an unwritable output destination as failure without a success path', async () => {
  await builder();
  const directory = await mkdtemp(join(tmpdir(), 'wafra-notification-shortcut-error-'));
  try {
    const result = spawnSync(process.execPath, [fileURLToPath(builderURL), directory], { encoding: 'utf8' });
    assert.equal(result.status, 1);
    assert.equal(result.stdout, '');
    assert.match(result.stderr, /EISDIR/);
    assert.ok(result.stderr.includes(directory), 'the error identifies the failed output destination');
    assert.deepEqual(await readdir(directory), []);
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
});
