import { readFileSync } from 'node:fs';
import assert from 'node:assert/strict';

export function verifyPagedIntentMetadata(metadata) {
  const specs = {
    BeginWafraPagedImportIntent: { policy: 2, params: { oldestGUID: 0, oldestDate: 0, newestGUID: 0, newestDate: 0 } },
    StageWafraPagedImportIntent: { policy: 0, params: { request: 0, found: 2, frame: 0 } },
  };
  for (const [name, spec] of Object.entries(specs)) {
    const action = metadata?.actions?.[name]; assert.ok(action, 'Missing '+name);
    assert.equal(action.authenticationPolicy, spec.policy, name);
    assert.equal(action.isAuthPolExplicit, true, name);
    assert.equal(action.supportedModes, 1, name);
    assert.equal(action.openAppWhenRun, false, name);
    assert.equal(action.availabilityAnnotations?.LNPlatformNameIOS?.introducedVersion, '26.0', name);
    assert.equal(action.outputType?.primitive?.wrapper?.typeIdentifier, 0, name);
    assert.deepEqual(Object.fromEntries(action.parameters.map(param => [param.name, param.valueType?.primitive?.wrapper?.typeIdentifier])), spec.params, name);
    assert.ok(action.parameters.every(param => param.isOptional === false), name);
  }
  return true;
}
if (process.argv[1]?.endsWith('/check-ios-paging-metadata.mjs') && process.argv[2]) {
  verifyPagedIntentMetadata(JSON.parse(readFileSync(process.argv[2], 'utf8')));
  console.log('Built paged-history intent metadata: names, scalar types, authentication and availability passed.');
}
