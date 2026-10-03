import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { pathToFileURL } from 'node:url';

export function verifyCaptureV3IntentMetadata(metadata) {
  const name = 'RecordWafraCaptureV3SetupProofIntent';
  const action = metadata?.actions?.[name];
  assert.ok(action && typeof action === 'object', `Missing ${name}`);
  assert.equal(action.authenticationPolicy, 0, `${name} must be alwaysAllowed`);
  assert.equal(action.isAuthPolExplicit, true, `${name} authentication must be explicit`);
  assert.equal(action.openAppWhenRun, false, `${name} must not open Wafra`);
  assert.equal(action.supportedModes, 1, `${name} must support background execution`);
  assert.ok(action.outputType == null, `${name} must not expose a source value`);
  assert.equal(action.outputFlags, 0, `${name} output flags changed`);
  assert.deepEqual(action.parameters ?? [], [], `${name} must have no parameters`);
  assert.equal(action.title?.key, 'live.setup_v3.title', `${name} localized title changed`);
  verifyCaptureV3StageMetadata(metadata);
  return true;
}

// Capture v3 omits Message fields Apple does not expose (GUID and date on the
// iOS 26.1 automation input). Those bindings only work if
// the built stage action declares every parameter optional; a required one
// makes Shortcuts stop and ask for a value inside a background automation.
export function verifyCaptureV3StageMetadata(metadata) {
  const name = 'StageWafraLiveMessageIntent';
  const action = metadata?.actions?.[name];
  assert.ok(action && typeof action === 'object', `Missing ${name}`);
  assert.equal(action.authenticationPolicy, 0, `${name} must be alwaysAllowed`);
  assert.equal(action.openAppWhenRun, false, `${name} must not open Wafra`);
  assert.equal(action.supportedModes, 1, `${name} must support background execution`);
  const parameters = (action.parameters ?? []).map((parameter) => ({
    name: parameter.name,
    typeIdentifier: parameter.valueType?.primitive?.wrapper?.typeIdentifier,
    isOptional: parameter.isOptional,
    titleKey: parameter.title?.key,
  }));
  assert.deepEqual(parameters, [
    { name: 'sender', typeIdentifier: 0, isOptional: true, titleKey: 'live.stage.sender.parameter' },
    { name: 'body', typeIdentifier: 0, isOptional: true, titleKey: 'live.stage.message.parameter' },
    { name: 'eventId', typeIdentifier: 0, isOptional: true, titleKey: 'live.stage.event_id.parameter' },
    { name: 'observedAt', typeIdentifier: 8, isOptional: true, titleKey: 'live.stage.observed_at.parameter' },
  ], `${name} parameters must be the four optional Message fields`);
  return true;
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  if (process.argv.length !== 3) {
    console.error('usage: node scripts/check-ios-capture-v3-metadata.mjs <extract.actionsdata>');
    process.exitCode = 2;
  } else {
    try {
      verifyCaptureV3IntentMetadata(JSON.parse(readFileSync(process.argv[2], 'utf8')));
      console.log('Built capture v3 metadata: distinct setup binding and four optional background stage parameters passed.');
    } catch (error) {
      console.error(`Capture v3 setup intent metadata failed: ${error.message}`);
      process.exitCode = 1;
    }
  }
}
