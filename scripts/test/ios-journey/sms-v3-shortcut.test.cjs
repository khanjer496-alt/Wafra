'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const { createHash } = require('node:crypto');
const api = import('../../build-ios-local-capture-shortcut.mjs');

const NOW = Date.parse('2026-09-23T12:05:00Z');
const RECORD_TTL_MS = 30 * 24 * 60 * 60 * 1000;
// Field sets Apple exposes on iOS 26.1 (docs/ios-shortcut-spec.md and
// docs/test-evidence/ios-sender-field-2026-09-20.md). The automation Message
// input has Content and Sender only; Find Messages rows have Body, GUID and date.
const OBSERVED_INBOX = [
  { Body: 'Card charged AED 10 at SHOP', GUID: 'source-one', date: '2026-09-23T12:00:00Z' },
  { Body: 'Card refunded AED 5 at SHOP', GUID: 'source-two', date: '2026-09-23T11:00:00Z' },
];
const sha = value => createHash('sha256').update(value).digest('hex');
const LIVE_OBSERVED = { Sender: 'BANK', Content: 'Card charged AED 10 at SHOP', Name: 'BANK', Recipients: [] };

// Minimal model of the native stageAutomationMessage contract, so a trace fails
// exactly where a Shortcuts run would stop. The Swift store tests prove the
// real implementation; this model only decides "throws" versus "continues".
function nativeStage({ sender, body, eventId, observedAt }) {
  if (body == null || String(body).trim() === '') return 'ignored';
  if (observedAt && NOW - Date.parse(observedAt) > RECORD_TTL_MS) return 'ignored';
  const date = observedAt == null || observedAt === '' ? null : observedAt;
  const hash = eventId && eventId !== sha('') && date != null;
  return {
    id: hash ? eventId : 'fresh-uuid',
    sender: sender == null || String(sender).trim() === '' ? 'Wafra Automation' : sender,
    observedAt: date ?? 'receipt-time',
  };
}

// The published v2 intent contract: every field was required and strict.
function strictStage({ sender, body, eventId, observedAt }) {
  if (!sender || !body || !eventId || eventId === sha('') || !observedAt) {
    throw new Error('stage intent refused the Message');
  }
  return 'accepted';
}

// Execute the generated control/dataflow with language-dependent Apple type
// labels. This is a contract test, not evidence of execution on an iPhone.
function trace(graph, input, language, { inbox = OBSERVED_INBOX, stage = null } = {}) {
  const labels = { en: ['Text', 'Message'], ar: ['نص', 'رسالة'], fr: ['Texte', 'Message'] }[language];
  const outputs = new Map(); const variables = new Map(); const effects = [];
  const read = value => {
    if (value == null || typeof value !== 'object') return value;
    if (value.Type === 'Variable' && value.Variable) return read(value.Variable);
    if (value.WFSerializationType === 'WFTextTokenAttachment') return read(value.Value);
    if (value.WFSerializationType === 'WFTextTokenString') {
      assert.equal(value.Value.string, '￼');
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
        outputs.set(p.UUID, sha(read(p.WFInput)));
      } else if (id === 'is.workflow.actions.text.changecase') {
        assert.equal(p.WFCaseType, 'lowercase'); outputs.set(p.UUID, read(p.text).toLowerCase());
      } else if (id === 'app.wafra.ios.RecordWafraCaptureSetupProofIntent' ||
        id === 'app.wafra.ios.RecordWafraCaptureV3SetupProofIntent') effects.push({ action: 'setup-proof' });
      else if (id === 'app.wafra.ios.StageWafraLiveTextIntent') effects.push({ action: 'stage-text', body: read(p.body) });
      else if (id === 'app.wafra.ios.StageWafraLiveMessageIntent') {
        const call = { action: 'stage-message' };
        for (const key of ['sender', 'body', 'eventId', 'observedAt']) if (key in p) call[key] = read(p[key]);
        if (stage) call.result = stage(call);
        effects.push(call);
      } else if (id === 'is.workflow.actions.exit') { effects.push({ action: 'stop' }); return true; }
      else assert.fail(`Unexpected executable action ${id}`);
    }
    return false;
  };
  run(0, actions.length); return effects;
}

const stages = effects => effects.filter(effect => effect.action === 'stage-message');

test('v3 fixes both language-dependent branches while published v2 stays byte-identical', async () => {
  const a = await api;
  const v2 = a.buildLocalCaptureShortcut();
  assert.equal(createHash('sha256').update(JSON.stringify(v2)).digest('hex'), 'aba5266fdc8382f5b832eab77bab25c23a67cc8353210003cb4f289b4e862f55');
  assert.throws(() => trace(v2, a.IOS_LOCAL_CAPTURE_SETUP_CHECK_MARKER, 'ar'), /plain text must never reach/);
  assert.throws(() => trace(v2, 'Card charged AED 10 at SHOP', 'fr'), /plain text must never reach/);
  const candidate = a.buildLocalCaptureV3Shortcut();
  assert.equal(candidate.WFWorkflowName, 'Wafra Capture v3');
  assert.equal(candidate.WFWorkflowActions.length, 36);
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
  test(`${language}: plain text keeps the English v2 dataflow`, async () => {
    const a = await api, v2 = a.buildLocalCaptureShortcut(), v3 = a.buildLocalCaptureV3Shortcut();
    for (const input of ['Card charged AED 10 at SHOP', `${a.IOS_LOCAL_CAPTURE_SETUP_CHECK_MARKER} `]) {
      assert.deepEqual(trace(v3, input, language), trace(v2, input, 'en'));
    }
  });
  test(`${language}: a Message with GUID and date keeps SHA-256(GUID) and its own date`, async () => {
    const a = await api;
    const input = { ...LIVE_OBSERVED, GUID: 'event-one', date: '2026-09-23T12:00:00Z' };
    assert.deepEqual(trace(a.buildLocalCaptureV3Shortcut(), input, language), [
      { action: 'stage-message', sender: 'BANK', body: 'Card charged AED 10 at SHOP',
        eventId: sha('event-one'), observedAt: '2026-09-23T12:00:00Z' },
      { action: 'stop' },
    ]);
  });
}

test('GUID absent (the observed iOS 26.1 Message input): stages Sender and Content without an identity', async () => {
  const a = await api, v2 = a.buildLocalCaptureShortcut(), v3 = a.buildLocalCaptureV3Shortcut();
  const effects = trace(v3, LIVE_OBSERVED, 'en', { stage: nativeStage });
  assert.deepEqual(effects, [
    { action: 'stage-message', sender: 'BANK', body: 'Card charged AED 10 at SHOP',
      result: { id: 'fresh-uuid', sender: 'BANK', observedAt: 'receipt-time' } },
    { action: 'stop' },
  ]);
  // The published v2 graph sends SHA-256('') and an empty date and is refused.
  assert.throws(() => trace(v2, LIVE_OBSERVED, 'en', { stage: strictStage }), /refused/);
  // An empty GUID string is the same as none.
  assert.deepEqual(stages(trace(v3, { ...LIVE_OBSERVED, GUID: '', date: '2026-09-23T12:00:00Z' }, 'en')),
    [{ action: 'stage-message', sender: 'BANK', body: 'Card charged AED 10 at SHOP' }]);
});

test('date absent with a GUID present: never pairs the hash with a guessed date', async () => {
  const a = await api;
  for (const date of [undefined, '']) {
    const effects = trace(a.buildLocalCaptureV3Shortcut(), { ...LIVE_OBSERVED, GUID: 'event-one', date }, 'en',
      { stage: nativeStage });
    assert.deepEqual(effects, [
      { action: 'stage-message', sender: 'BANK', body: 'Card charged AED 10 at SHOP',
        result: { id: 'fresh-uuid', sender: 'BANK', observedAt: 'receipt-time' } },
      { action: 'stop' },
    ]);
  }
});

test('empty Content is skipped without staging or failing the run', async () => {
  const a = await api, v3 = a.buildLocalCaptureV3Shortcut();
  for (const Content of [undefined, '']) {
    assert.deepEqual(trace(v3, { Sender: 'BANK', Content, GUID: 'event-one', date: '2026-09-23T12:00:00Z' }, 'en'),
      [{ action: 'stop' }]);
    assert.deepEqual(trace(v3, { Sender: 'BANK', Content }, 'en'), [{ action: 'stop' }]);
  }
});

test('a no-input v3 run records only its setup proof and never reads Messages', async () => {
  const a = await api, v3 = a.buildLocalCaptureV3Shortcut();
  for (const input of [null, undefined, '']) {
    assert.deepEqual(trace(v3, input, 'en', { stage: nativeStage }), [{ action: 'setup-proof' }, { action: 'stop' }]);
  }
  const serialized = JSON.stringify(v3);
  assert.doesNotMatch(serialized, /com\.apple\.MobileSMS\.MessageEntity|repeat\.each|"Repeat Item"/);
  assert.equal(v3.WFWorkflowActions.filter(x => x.WFWorkflowActionIdentifier.endsWith('StageWafraLiveMessageIntent')).length, 2);
});

test('published v2 against the new optional intent contract', async () => {
  const a = await api, v2 = a.buildLocalCaptureShortcut();
  // Complete, current input: identical staging to the old strict contract.
  const complete = { ...LIVE_OBSERVED, GUID: 'event-one', date: '2026-09-23T12:00:00Z' };
  assert.deepEqual(stages(trace(v2, complete, 'en', { stage: strictStage })).map(x => x.result), ['accepted']);
  assert.deepEqual(stages(trace(v2, complete, 'en', { stage: nativeStage })).map(x => x.result), [
    { id: sha('event-one'), sender: 'BANK', observedAt: '2026-09-23T12:00:00Z' },
  ]);
  // Observed iOS 26.1 input: v2 binds SHA-256('') and no date value. The old
  // contract refused it; the new binary stages one UUID row at receipt time.
  assert.throws(() => trace(v2, LIVE_OBSERVED, 'en', { stage: strictStage }), /refused/);
  const live = stages(trace(v2, LIVE_OBSERVED, 'en', { stage: nativeStage }));
  assert.deepEqual(live.map(x => [x.eventId, x.observedAt, x.result]), [
    [sha(''), undefined, { id: 'fresh-uuid', sender: 'BANK', observedAt: 'receipt-time' }],
  ]);
  // v2's no-input lane (which the app no longer opens) reads Content/Sender
  // that Find Messages rows lack: every row is ignored and the run completes.
  const recovery = trace(v2, null, 'en', { stage: nativeStage });
  assert.throws(() => trace(v2, null, 'en', { stage: strictStage }), /refused/);
  assert.equal(stages(recovery).length, OBSERVED_INBOX.length);
  assert.ok(stages(recovery).every(x => x.result === 'ignored'));
  assert.deepEqual(recovery.at(-1), { action: 'stop' });
});

test('v3 changes only type references, versioned proof, the no-input lane and the Message lane', async () => {
  const a = await api, v2 = a.buildLocalCaptureShortcut(), v3 = a.buildLocalCaptureV3Shortcut();
  const original = structuredClone(v3.WFWorkflowActions.slice(2));
  let checks = 0;
  for (let i = 0; i < original.length; i++) {
    if (original[i].WFWorkflowActionIdentifier === 'app.wafra.ios.RecordWafraCaptureV3SetupProofIntent') {
      original[i].WFWorkflowActionIdentifier = 'app.wafra.ios.RecordWafraCaptureSetupProofIntent';
      original[i].WFWorkflowActionParameters.AppIntentDescriptor.AppIntentIdentifier = 'RecordWafraCaptureSetupProofIntent';
    }
    const p = original[i].WFWorkflowActionParameters;
    if (p.WFConditionalActionString?.WFSerializationType === 'WFTextTokenString') {
      assert.equal(p.WFConditionalActionString.Value.attachmentsByRange['{0, 1}'].OutputUUID,
        v3.WFWorkflowActions[1].WFWorkflowActionParameters.UUID);
      p.WFConditionalActionString = 'Text'; checks++;
    }
  }
  assert.equal(checks, 2);
  // Remove v2's Find Messages loop and replace its Message lane by v3's, then compare exactly.
  const v2Actions = structuredClone(v2.WFWorkflowActions);
  const at = uuid => v2Actions.findIndex(action => action.WFWorkflowActionParameters.UUID === uuid);
  const findStart = at('A8C4A13F-48E0-4B90-A8EE-65016E9C6E89');
  const loopEnd = v2Actions.findIndex((action, i) => i > findStart &&
    action.WFWorkflowActionParameters.GroupingIdentifier === '056DB282-A0ED-4DA6-A2A1-E4CB49A7305D' &&
    action.WFWorkflowActionParameters.WFControlFlowMode === 2);
  v2Actions.splice(findStart, loopEnd - findStart + 1);
  const v2LiveStart = at('1233D840-DCE7-4FFD-9415-20736825C74F');
  const isV3 = action => /^C17E0000-0000-4000-8000-0000000003\d\d$/.test(
    action.WFWorkflowActionParameters.UUID ?? action.WFWorkflowActionParameters.GroupingIdentifier ?? '');
  const liveStart = original.findIndex(isV3);
  assert.deepEqual(original.slice(0, liveStart), v2Actions.slice(0, v2LiveStart));
  assert.ok(original.slice(liveStart).every(action =>
    isV3(action) || action.WFWorkflowActionIdentifier === 'is.workflow.actions.exit'));
  assert.equal(original.at(-1).WFWorkflowActionIdentifier, 'is.workflow.actions.exit');

  const stageActions = v3.WFWorkflowActions.filter(x => x.WFWorkflowActionIdentifier.endsWith('StageWafraLiveMessageIntent'));
  assert.deepEqual(stageActions.map(x => Object.keys(x.WFWorkflowActionParameters).sort()), [
    ['AppIntentDescriptor', 'UUID', 'body', 'eventId', 'observedAt', 'sender'],
    ['AppIntentDescriptor', 'UUID', 'body', 'sender'],
  ]);
  const ids = v3.WFWorkflowActions.map(x => x.WFWorkflowActionParameters.UUID).filter(Boolean);
  assert.equal(new Set(ids).size, ids.length);
  assert.doesNotMatch(JSON.stringify(v3), /https?:|downloadurl|clipboard|savefile|sendmessage|sendemail/);
  const tampered = structuredClone(v3);
  tampered.WFWorkflowActions.find(x => x.WFWorkflowActionIdentifier.endsWith('StageWafraLiveTextIntent')).WFWorkflowActionParameters.body = 'wrong';
  assert.throws(() => a.verifyLocalCaptureV3ShortcutGraph(tampered));
});
