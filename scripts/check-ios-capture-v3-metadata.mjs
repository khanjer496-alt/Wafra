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
  return true;
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  if (process.argv.length !== 3) {
    console.error('usage: node scripts/check-ios-capture-v3-metadata.mjs <extract.actionsdata>');
    process.exitCode = 2;
  } else {
    try {
      verifyCaptureV3IntentMetadata(JSON.parse(readFileSync(process.argv[2], 'utf8')));
      console.log('Built capture v3 setup intent metadata: distinct binding, zero parameters and background policy passed.');
    } catch (error) {
      console.error(`Capture v3 setup intent metadata failed: ${error.message}`);
      process.exitCode = 1;
    }
  }
}
