const {
  parseEmailForwardingCredential,
  parseImportCapabilities,
  parsePdfImportAccepted,
  pdfImportError,
} = require('./build/cloud-import-contract');

const fs = require('fs');
const path = require('path');

let pass = 0;
let fail = 0;
function ok(name, condition) {
  if (condition) {
    pass += 1;
    console.log(`✓ ${name}`);
  } else {
    fail += 1;
    console.log(`✗ ${name}`);
  }
}

const capabilities = {
  email: {
    enabled: true,
    accepts: ['text/plain', 'text/html', 'message/rfc822'],
    maxBytes: 131072,
  },
  pdf: {
    enabled: true,
    accepts: ['application/pdf'],
    maxBytes: 5242880,
    maxRows: 200,
    maxPages: 100,
    parser: 'text-explicit-direction-v1',
    note: 'Scans and ambiguous visual debit/credit columns are rejected, not guessed.',
  },
};

const parsed = parseImportCapabilities(capabilities);
ok('capabilities: exact service document is accepted',
  parsed?.pdf.maxBytes === 5242880 && parsed?.pdf.maxPages === 100);
ok('capabilities: missing limits are rejected instead of guessed',
  parseImportCapabilities({ ...capabilities, pdf: { enabled: true } }) === null);
ok('pdf response: only positive row/page counts are accepted',
  parsePdfImportAccepted({ acceptedRows: 8, pages: 2 })?.acceptedRows === 8 &&
  parsePdfImportAccepted({ acceptedRows: 0, pages: 2 }) === null);
ok('pdf response: unsupported format remains a distinct user-facing error',
  pdfImportError(422, { error: 'unsupported_statement_format' }).code ===
    'unsupported_statement_format');
ok('email token: private address response is validated',
  parseEmailForwardingCredential({
    emailToken: 't'.repeat(43),
    forwardingAddress: `${'t'.repeat(43)}@forward.wafra.test`,
  })?.emailToken.length === 43);
ok('email token: response injection is rejected',
  parseEmailForwardingCredential({
    emailToken: 't'.repeat(43),
    forwardingAddress: 'token@example.com\nBcc: attacker@example.com',
  }) === null);

const root = path.resolve(__dirname, '../..');
const transport = fs.readFileSync(path.join(root, 'src/lib/cloud-import.ts'), 'utf8');
const surface = fs.readFileSync(path.join(root, 'src/components/supplement-imports.tsx'), 'utf8');
const captureExecutor = fs.readFileSync(path.join(root, 'src/lib/capture-executor.ts'), 'utf8');
ok('SDK 55 upload uses File + expo/fetch, never the throwing legacy upload API',
  /from 'expo-file-system'/.test(transport) &&
  /from 'expo\/fetch'/.test(transport) &&
  /body: file/.test(transport) &&
  !/expo-file-system\/legacy|uploadAsync|new FormData/i.test(transport));
ok('picker cache copy is immediately readable and deleted after the attempt',
  /copyToCacheDirectory: true/.test(surface) &&
  /pickedFile\.delete\(\)/.test(surface));
ok('forwarding credential is compare-and-cleared on timeout and screen exit',
  /const current = await Clipboard\.getStringAsync\(\)/.test(surface) &&
  /if \(current === address\) await Clipboard\.setStringAsync\(''\)/.test(surface) &&
  /if \(address\) void clearCopiedAddress\(address\)/.test(surface) &&
  /if \(disposed\.current\)[\s\S]{0,120}?clearCopiedAddress\(address\)/.test(surface));
ok('queued imports persist to SQLCipher before relay acknowledgement',
  /execute\('supplemental'\)/.test(surface) &&
  captureExecutor.indexOf('await receipt.durable') <
    captureExecutor.indexOf('await dependencies.acknowledge(cfg, acknowledge)'));
// This screen drains the same queue the iOS setup verifier is polling, and a
// PDF upload or an email check is reachable while /ios-setup is still on its
// test step. syncRelay() reports a setup probe's id in `ids` AND in `testIds`;
// acking the whole array consumed the proof, the setup screen timed out, and
// the retry it offered was byte-identical, so the relay's replay receipt
// refused it and pushed its own expiry out. Only /ios-setup may ack a probe.
ok('a supplemental sync leaves the iOS setup probe for the screen waiting on it',
  /execute\('supplemental'\)/.test(surface) &&
  /const reserved = new Set\(queued\.testIds\)/.test(captureExecutor) &&
  /queued\.ids\.filter\(\(id\) => !reserved\.has\(id\)\)/.test(captureExecutor) &&
  !/acknowledge\(cfg, queued\.ids\)/.test(
    captureExecutor.slice(
      captureExecutor.indexOf('const executeSupplemental'),
      captureExecutor.indexOf('const executeBackground'),
    ),
  ));
ok('email forwarding has separate create and revoke actions',
  /method: 'POST'/.test(transport) && /method: 'DELETE'/.test(transport) &&
  /\/v1\/email-token/.test(transport));

console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
