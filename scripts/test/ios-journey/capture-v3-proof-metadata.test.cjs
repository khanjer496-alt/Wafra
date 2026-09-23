const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { pathToFileURL } = require('node:url');
const test = require('node:test');
const root = path.resolve(__dirname, '../../..');

test('v3 native setup proof is distinct while legacy action remains version one', () => {
  const plugin = fs.readFileSync(path.join(root, 'modules/wafra-live-capture/plugin/index.js'), 'utf8');
  const intent = (name) => plugin.match(new RegExp(`struct ${name}: AppIntent \\{([\\s\\S]*?)\\n\\}\\n\\n@available`))?.[1];
  const v3 = intent('RecordWafraCaptureV3SetupProofIntent');
  assert.ok(v3);
  assert.match(v3, /recordSetupProof\(version: 3, at: Date\(\)\)/);
  assert.doesNotMatch(v3, /@Parameter|\.stage\(|stageNotification|recordFirstCapturedAt/);
  assert.match(v3, /authenticationPolicy: IntentAuthenticationPolicy = \.alwaysAllowed/);
  assert.match(v3, /openAppWhenRun = false/);
  assert.match(v3, /live\.setup_v3\.title/);
  assert.match(intent('RecordWafraCaptureSetupProofIntent'), /recordSetupProof\(version: 1, at: Date\(\)\)/);
});

test('extracted v3 proof metadata requires the distinct no-input background action', async () => {
  const { verifyCaptureV3IntentMetadata } = await import(pathToFileURL(path.join(root, 'scripts/check-ios-capture-v3-metadata.mjs')));
  const fixture = () => ({ actions: { RecordWafraCaptureV3SetupProofIntent: {
    authenticationPolicy: 0, isAuthPolExplicit: true, openAppWhenRun: false,
    supportedModes: 1, outputType: null, outputFlags: 0, parameters: [], title: { key: 'live.setup_v3.title' },
  } } });
  assert.equal(verifyCaptureV3IntentMetadata(fixture()), true);
  assert.throws(() => verifyCaptureV3IntentMetadata({ actions: { RecordWafraCaptureSetupProofIntent: {} } }));
  for (const mutate of [
    a => { a.authenticationPolicy = 2; }, a => { a.isAuthPolExplicit = false; },
    a => { a.openAppWhenRun = true; }, a => { a.supportedModes = 2; },
    a => { a.outputType = { primitive: { wrapper: { typeIdentifier: 0 } } }; },
    a => { a.outputFlags = 1; }, a => { a.parameters = [{ name: 'text' }]; },
    a => { a.title.key = 'live.setup_proof.title'; },
  ]) {
    const metadata = fixture(); mutate(metadata.actions.RecordWafraCaptureV3SetupProofIntent);
    assert.throws(() => verifyCaptureV3IntentMetadata(metadata));
  }
});
