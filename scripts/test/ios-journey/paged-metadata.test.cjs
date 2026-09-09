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
  } };
}
test('built metadata verifier demands both paged receiver contracts and fails weakened/missing bindings', async () => {
  const { verifyPagedIntentMetadata } = await load();
  assert.equal(verifyPagedIntentMetadata(fixture()), true);
  for (const mutate of [m => { delete m.actions.BeginWafraPagedImportIntent; },
    m => { m.actions.BeginWafraPagedImportIntent.authenticationPolicy = 0; },
    m => { m.actions.StageWafraPagedImportIntent.parameters[1].valueType.primitive.wrapper.typeIdentifier = 0; },
    m => { m.actions.StageWafraPagedImportIntent.parameters[2].isOptional = true; },
    m => { m.actions.StageWafraPagedImportIntent.openAppWhenRun = true; }]) {
    const data = fixture(); mutate(data); assert.throws(() => verifyPagedIntentMetadata(data));
  }
});
