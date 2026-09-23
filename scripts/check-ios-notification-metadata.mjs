import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { pathToFileURL } from 'node:url';

/** Check Xcode's extracted binding, not just the Swift source declaration. */
export function verifyNotificationIntentMetadata(metadata) {
  const name = 'CaptureWafraNotificationIntent';
  const action = metadata?.actions?.[name];
  assert.ok(action && typeof action === 'object', `Missing ${name}`);
  assert.equal(action.authenticationPolicy, 0, `${name} must be alwaysAllowed`);
  assert.equal(action.isAuthPolExplicit, true, `${name} authentication must be explicit`);
  assert.equal(action.openAppWhenRun, false, `${name} must not open the app`);
  assert.equal(action.supportedModes, 1, `${name} must support background execution`);
  assert.equal(action.outputType?.primitive?.wrapper?.typeIdentifier, 0, `${name} must return a String status`);
  assert.equal(action.outputFlags, 0, `${name} output flags changed`);
  assert.ok(Array.isArray(action.parameters), `${name} must expose parameters`);
  assert.equal(action.parameters.length, 1, `${name} must expose exactly one text input`);
  const [parameter] = action.parameters;
  assert.equal(parameter.name, 'text', `${name} text binding changed`);
  assert.equal(parameter.isOptional, false, `${name} text must be required`);
  assert.equal(parameter.valueType?.primitive?.wrapper?.typeIdentifier, 0, `${name} text must be a String`);
  assert.equal(parameter.valueType?.array, undefined, `${name} text must be a scalar`);
  assert.equal(parameter.title?.key, 'live.notification.text.parameter', `${name} text title changed`);
  return true;
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  if (process.argv.length !== 3) {
    console.error('usage: node scripts/check-ios-notification-metadata.mjs <extract.actionsdata>');
    process.exitCode = 2;
  } else {
    try {
      verifyNotificationIntentMetadata(JSON.parse(readFileSync(process.argv[2], 'utf8')));
      console.log('Built notification intent metadata: required String input, authentication and background execution passed.');
    } catch (error) {
      console.error(`Notification intent metadata failed: ${error.message}`);
      process.exitCode = 1;
    }
  }
}
