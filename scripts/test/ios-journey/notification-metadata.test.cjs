'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const path = require('node:path');
const { pathToFileURL } = require('node:url');
const load = () => import(pathToFileURL(path.resolve(__dirname, '../../check-ios-notification-metadata.mjs')));

function fixture() {
  const primitive = (typeIdentifier) => ({ primitive: { wrapper: { typeIdentifier } } });
  return { actions: { CaptureWafraNotificationIntent: {
    authenticationPolicy: 0,
    isAuthPolExplicit: true,
    openAppWhenRun: false,
    supportedModes: 1,
    outputType: primitive(0),
    outputFlags: 0,
    parameters: [{ name: 'text', isOptional: false, valueType: primitive(0),
      title: { key: 'live.notification.text.parameter' } }],
  } } };
}

test('extracted notification metadata requires explicit text and background execution', async () => {
  const { verifyNotificationIntentMetadata } = await load();
  assert.equal(verifyNotificationIntentMetadata(fixture()), true);
  assert.throws(() => verifyNotificationIntentMetadata({ actions: {} }), /Missing/);
  const mutations = [
    ['authentication policy', (a) => { a.authenticationPolicy = 2; }],
    ['implicit authentication', (a) => { a.isAuthPolExplicit = false; }],
    ['foreground launch', (a) => { a.openAppWhenRun = true; }],
    ['wrong execution mode', (a) => { a.supportedModes = 2; }],
    ['optional text', (a) => { a.parameters[0].isOptional = true; }],
    ['wrong input name', (a) => { a.parameters[0].name = 'body'; }],
    ['wrong scalar type', (a) => { a.parameters[0].valueType.primitive.wrapper.typeIdentifier = 8; }],
    ['array text', (a) => { a.parameters[0].valueType.array = { wrapper: {} }; }],
    ['extra input', (a) => { a.parameters.push({ name: 'sender' }); }],
    ['missing input', (a) => { a.parameters = []; }],
    ['missing parameters', (a) => { delete a.parameters; }],
    ['wrong title key', (a) => { a.parameters[0].title.key = 'unlocalized'; }],
    ['wrong status output', (a) => { a.outputType.primitive.wrapper.typeIdentifier = 2; }],
    ['changed output flags', (a) => { a.outputFlags = 1; }],
  ];
  for (const [label, mutate] of mutations) {
    const data = fixture();
    mutate(data.actions.CaptureWafraNotificationIntent);
    assert.throws(() => verifyNotificationIntentMetadata(data), label);
  }
});
