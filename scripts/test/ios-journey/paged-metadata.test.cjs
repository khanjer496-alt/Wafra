'use strict';
const test = require('node:test'); const assert = require('node:assert/strict');
const path = require('node:path'); const { pathToFileURL } = require('node:url');
const load = () => import(pathToFileURL(path.resolve(__dirname, '../../check-ios-paging-metadata.mjs')));
function fixture() {
  const primitive = id => ({ primitive: { wrapper: { typeIdentifier: id } } });
  const action = (policy, params) => ({ authenticationPolicy: policy, isAuthPolExplicit: true,
    supportedModes: 1, openAppWhenRun: false,
    availabilityAnnotations: { LNPlatformNameIOS: { introducedVersion: '26.0' } },
    outputType: primitive(0), parameters: Object.entries(params).map(([name, type]) => ({ name, isOptional: false, valueType: primitive(type) })) });
  return { actions: {
    BeginWafraPagedImportIntent: action(2, { oldestGUID: 0, oldestDate: 0, newestGUID: 0, newestDate: 0 }),
    StageWafraPagedImportIntent: action(0, { request: 0, found: 2, frame: 0 }),
    StageWafraPagedColumnsIntent: action(0, { request: 0, found: 2, guids: 0, bodies: 0, senders: 0, dates: 0 }),
    BeginWafraPagedImportV2Intent: action(2, { oldestGUID: 0, oldestDate: 8, newestGUID: 0, newestDate: 8 }),
    StageWafraPagedRowIntent: action(0, { request: 0, guid: 0, body: 0, sender: 0, date: 8 }),
    CommitWafraPagedPageIntent: action(0, { request: 0, found: 2 }),
  } };
}
test('built metadata verifier demands both paged receiver contracts and fails weakened/missing bindings', async () => {
  const { verifyPagedIntentMetadata } = await load();
  assert.equal(verifyPagedIntentMetadata(fixture()), true);
  for (const mutate of [m => { delete m.actions.BeginWafraPagedImportIntent; },
    m => { m.actions.BeginWafraPagedImportIntent.authenticationPolicy = 0; },
    m => { m.actions.StageWafraPagedImportIntent.parameters[1].valueType.primitive.wrapper.typeIdentifier = 0; },
    m => { m.actions.StageWafraPagedImportIntent.parameters[2].isOptional = true; },
    m => { m.actions.StageWafraPagedImportIntent.openAppWhenRun = true; },
    m => { delete m.actions.StageWafraPagedColumnsIntent; },
    m => { m.actions.StageWafraPagedColumnsIntent.parameters[3].valueType.primitive.wrapper.typeIdentifier = 2; },
    // The typed-date graph depends on `Date` parameters; a String date would reintroduce Shortcuts date text.
    m => { m.actions.BeginWafraPagedImportV2Intent.parameters[1].valueType.primitive.wrapper.typeIdentifier = 0; },
    m => { m.actions.StageWafraPagedRowIntent.parameters[4].valueType.primitive.wrapper.typeIdentifier = 0; },
    m => { m.actions.StageWafraPagedRowIntent.authenticationPolicy = 2; },
    m => { delete m.actions.CommitWafraPagedPageIntent; }]) {
    const data = fixture(); mutate(data); assert.throws(() => verifyPagedIntentMetadata(data));
  }
});
