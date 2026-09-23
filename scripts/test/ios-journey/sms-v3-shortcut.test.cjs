'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const { createHash } = require('node:crypto');
const api = import('../../build-ios-local-capture-shortcut.mjs');

// Execute the generated control/dataflow with language-dependent Apple type
// labels. This is a contract test, not evidence of execution on an iPhone.
function trace(graph, input, language) {
  const labels = { en: ['Text', 'Message'], ar: ['نص', 'رسالة'], fr: ['Texte', 'Message'] }[language];
  const outputs = new Map(); const variables = new Map(); const effects = [];
  const inbox = [
    { Sender: 'BANK', Content: 'Card charged AED 10 at SHOP', GUID: 'source-one', date: '2026-09-23T12:00:00Z' },
    { Sender: '', Content: 'Card refunded AED 5 at SHOP', GUID: 'source-two', date: '2026-09-23T11:00:00Z' },
  ];
  const read = value => {
    if (value == null || typeof value !== 'object') return value;
    if (value.Type === 'Variable' && value.Variable) return read(value.Variable);
    if (value.WFSerializationType === 'WFTextTokenAttachment') return read(value.Value);
    if (value.WFSerializationType === 'WFTextTokenString') {
      assert.equal(value.Value.string, '\ufffc');
      assert.deepEqual(Object.keys(value.Value.attachmentsByRange), ['{0, 1}']);
      return read(value.Value.attachmentsByRange['{0, 1}']);
    }
    let result;
    if (value.Type === 'ExtensionInput') result = input;
    else if (value.Type === 'ActionOutput') {
      assert.ok(outputs.has(value.OutputUUID), `output ${value.OutputUUID} must resolve before use`);
      result = outputs.get(value.OutputUUID);
    } else if (value.Type === 'Variable') result = variables.get(value.VariableName);
    else assert.fail(`Unknown variable ${JSON.stringify(value)}`);
    for (const item of value.Aggrandizements ?? []) {
      if (item.Type === 'WFPropertyVariableAggrandizement') {
        assert.ok(result && typeof result === 'object', 'plain text must never reach Message property extraction');
        result = result[item.PropertyName];
      } else {
        assert.equal(item.Type, 'WFCoercionVariableAggrandizement');
        assert.equal(item.CoercionItemClass, 'WFStringContentItem');
        result = String(result ?? '');
      }
    }
    return result;
  };
  const actions = graph.WFWorkflowActions;
  const closing = start => {
    const group = actions[start].WFWorkflowActionParameters.GroupingIdentifier;
    const end = actions.findIndex((a, i) => i > start && a.WFWorkflowActionParameters.GroupingIdentifier === group && a.WFWorkflowActionParameters.WFControlFlowMode === 2);
    assert.ok(end > start, 'control block must close'); return end;
  };
  const run = (start, end) => {
    for (let i = start; i < end; i++) {
      const a = actions[i], p = a.WFWorkflowActionParameters, id = a.WFWorkflowActionIdentifier;
      if (id === 'is.workflow.actions.conditional') {
        assert.equal(p.WFControlFlowMode, 0);
        const stop = closing(i), value = read(p.WFInput);
        const present = value != null && value !== '';
        const match = p.WFCondition === 100 ? present : p.WFCondition === 101 ? !present : value === read(p.WFConditionalActionString);
        assert.ok([100, 101, 4].includes(p.WFCondition));
        if (match && run(i + 1, stop)) return true;
        i = stop;
      } else if (id === 'is.workflow.actions.repeat.each') {
        assert.equal(p.WFControlFlowMode, 0);
        const stop = closing(i);
        for (const item of read(p.WFInput)) {
          variables.set('Repeat Item', item);
          if (run(i + 1, stop)) return true;
        }
        i = stop;
      } else if (id === 'is.workflow.actions.gettext') outputs.set(p.UUID, read(p.WFTextActionText));
      else if (id === 'is.workflow.actions.getitemtype') {
        const value = read(p.WFInput);
        assert.ok(value != null && value !== '', 'do not request type of absent Shortcut Input');
        outputs.set(p.UUID, typeof value === 'string' ? labels[0] : labels[1]);
      } else if (id === 'com.apple.MobileSMS.MessageEntity') {
        assert.equal(p.WFContentItemLimitNumber, 300);
        effects.push({ action: 'find-messages' }); outputs.set(p.UUID, inbox);
      } else if (id === 'is.workflow.actions.hash') {
        assert.equal(p.WFHashType, 'SHA256');
        outputs.set(p.UUID, createHash('sha256').update(read(p.WFInput)).digest('hex'));
      } else if (id === 'is.workflow.actions.text.changecase') {
        assert.equal(p.WFCaseType, 'lowercase'); outputs.set(p.UUID, read(p.text).toLowerCase());
      } else if (id === 'app.wafra.ios.RecordWafraCaptureSetupProofIntent' ||
        id === 'app.wafra.ios.RecordWafraCaptureV3SetupProofIntent') effects.push({ action: 'setup-proof' });
      else if (id === 'app.wafra.ios.StageWafraLiveTextIntent') effects.push({ action: 'stage-text', body: read(p.body) });
      else if (id === 'app.wafra.ios.StageWafraLiveMessageIntent') effects.push({ action: 'stage-message',
        sender: read(p.sender), body: read(p.body), eventId: read(p.eventId), observedAt: read(p.observedAt) });
      else if (id === 'is.workflow.actions.exit') { effects.push({ action: 'stop' }); return true; }
      else assert.fail(`Unexpected executable action ${id}`);
    }
    return false;
  };
  run(0, actions.length); return effects;
}

test('v3 fixes both language-dependent branches while published v2 stays byte-identical', async () => {
  const a = await api;
  const v2 = a.buildLocalCaptureShortcut();
  assert.equal(createHash('sha256').update(JSON.stringify(v2)).digest('hex'), 'aba5266fdc8382f5b832eab77bab25c23a67cc8353210003cb4f289b4e862f55');
  assert.throws(() => trace(v2, a.IOS_LOCAL_CAPTURE_SETUP_CHECK_MARKER, 'ar'), /plain text must never reach/);
  assert.throws(() => trace(v2, 'Card charged AED 10 at SHOP', 'fr'), /plain text must never reach/);
  const candidate = a.buildLocalCaptureV3Shortcut();
  assert.equal(candidate.WFWorkflowName, 'Wafra Capture v3');
  assert.equal(candidate.WFWorkflowActions.length, 37);
  assert.equal(a.verifyLocalCaptureV3ShortcutGraph(candidate), true);
  assert.throws(() => a.verifyLocalCaptureShortcutGraph(candidate));
  assert.throws(() => a.verifyLocalCaptureV3ShortcutGraph(v2));
});

test('every v3 proof action uses its distinct versioned native intent', async () => {
  const a = await api;
  const proofs = a.buildLocalCaptureV3Shortcut().WFWorkflowActions.filter(action =>
    action.WFWorkflowActionIdentifier.includes('SetupProofIntent'));
  assert.equal(proofs.length, 2, 'both explicit preflight and no-input catch-up record version 3 proof');
  for (const action of proofs) {
    assert.equal(action.WFWorkflowActionIdentifier, 'app.wafra.ios.RecordWafraCaptureV3SetupProofIntent');
    assert.deepEqual(action.WFWorkflowActionParameters.AppIntentDescriptor, {
      TeamIdentifier: 'UV7YN4GQ66', BundleIdentifier: 'app.wafra.ios', Name: 'Wafra',
      AppIntentIdentifier: 'RecordWafraCaptureV3SetupProofIntent',
    });
    assert.deepEqual(Object.keys(action.WFWorkflowActionParameters).sort(), ['AppIntentDescriptor', 'UUID']);
  }
});

for (const language of ['en', 'ar', 'fr']) {
  test(`${language}: setup marker reaches only native proof and stop`, async () => {
    const a = await api;
    assert.deepEqual(trace(a.buildLocalCaptureV3Shortcut(), a.IOS_LOCAL_CAPTURE_SETUP_CHECK_MARKER, language),
      [{ action: 'setup-proof' }, { action: 'stop' }]);
  });
  test(`${language}: text, Message and no-input routes preserve the English v2 dataflow`, async () => {
    const a = await api, v2 = a.buildLocalCaptureShortcut(), v3 = a.buildLocalCaptureV3Shortcut();
    for (const input of [null, undefined, '', 'Card charged AED 10 at SHOP', `${a.IOS_LOCAL_CAPTURE_SETUP_CHECK_MARKER} `,
      { Sender: 'BANK', Content: 'Card charged AED 10 at SHOP', GUID: 'event-one', date: '2026-09-23T12:00:00Z' },
      { Sender: 'BANK', Content: a.IOS_LOCAL_CAPTURE_SETUP_CHECK_MARKER, GUID: 'event-marker', date: '2026-09-23T12:00:00Z' }]) {
      assert.deepEqual(trace(v3, input, language), trace(v2, input, 'en'));
    }
  });
}

test('candidate changes only type references and versioned proof while retaining capture validation and privacy', async () => {
  const a = await api, v2 = a.buildLocalCaptureShortcut(), v3 = a.buildLocalCaptureV3Shortcut();
  const original = structuredClone(v3.WFWorkflowActions.slice(2));
  let checks = 0;
  for (let i = 0; i < original.length; i++) {
    if (original[i].WFWorkflowActionIdentifier === 'app.wafra.ios.RecordWafraCaptureV3SetupProofIntent') {
      original[i].WFWorkflowActionIdentifier = 'app.wafra.ios.RecordWafraCaptureSetupProofIntent';
      original[i].WFWorkflowActionParameters.AppIntentDescriptor.AppIntentIdentifier = 'RecordWafraCaptureSetupProofIntent';
    }
    if (v2.WFWorkflowActions[i].WFWorkflowActionParameters.WFConditionalActionString === 'Text') {
      const p = original[i].WFWorkflowActionParameters;
      assert.equal(p.WFConditionalActionString.WFSerializationType, 'WFTextTokenString');
      assert.equal(p.WFConditionalActionString.Value.attachmentsByRange['{0, 1}'].OutputUUID,
        v3.WFWorkflowActions[1].WFWorkflowActionParameters.UUID);
      p.WFConditionalActionString = 'Text'; checks++;
    }
  }
  assert.equal(checks, 2); assert.deepEqual(original, v2.WFWorkflowActions);
  const ids = v3.WFWorkflowActions.map(x => x.WFWorkflowActionParameters.UUID).filter(Boolean);
  assert.equal(new Set(ids).size, ids.length);
  assert.doesNotMatch(JSON.stringify(v3), /https?:|downloadurl|clipboard|savefile|sendmessage|sendemail/);
  const tampered = structuredClone(v3);
  tampered.WFWorkflowActions.find(x => x.WFWorkflowActionIdentifier.endsWith('StageWafraLiveTextIntent')).WFWorkflowActionParameters.body = 'wrong';
  assert.throws(() => a.verifyLocalCaptureV3ShortcutGraph(tampered));
});
