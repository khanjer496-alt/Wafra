const {
  parseEmailForwardingCredential,
  parseImportCapabilities,
  parseCsvImportAccepted,
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
  csv: {
    enabled: true,
    accepts: ['text/csv', 'text/tab-separated-values'],
    maxBytes: 1048576,
    maxRows: 200,
    parser: 'named-columns-explicit-direction-v1',
    note: 'Explicit direction required.',
  },
};

const parsed = parseImportCapabilities(capabilities);
ok('capabilities: exact service document is accepted',
  parsed?.pdf.maxBytes === 5242880 && parsed?.pdf.maxPages === 100 &&
    parsed?.csv.maxBytes === 1048576);
ok('capabilities: missing limits are rejected instead of guessed',
  parseImportCapabilities({ ...capabilities, pdf: { enabled: true } }) === null);
const oldRelayCapabilities = { email: capabilities.email, pdf: capabilities.pdf };
ok('capabilities: an older relay keeps PDF/email working with CSV disabled',
  parseImportCapabilities(oldRelayCapabilities)?.csv.enabled === false &&
    parseImportCapabilities(oldRelayCapabilities)?.pdf.enabled === true);
ok('pdf response: only positive row/page counts are accepted',
  parsePdfImportAccepted({ acceptedRows: 8, pages: 2 })?.acceptedRows === 8 &&
  parsePdfImportAccepted({ acceptedRows: 0, pages: 2 }) === null);
ok('csv response: accepted and explicitly rejected rows must reconcile to total',
  parseCsvImportAccepted({ acceptedRows: 8, rejectedRows: 2, totalRows: 10 })?.rejectedRows === 2 &&
  parseCsvImportAccepted({ acceptedRows: 8, rejectedRows: 1, totalRows: 10 }) === null);
ok('pdf response: unsupported format remains a distinct user-facing error',
  pdfImportError(422, { error: 'unsupported_statement_format' }).code ===
    'unsupported_statement_format');
ok('pdf response: skipped rows are read when sent, default to zero from an older relay, and are refused when malformed',
  parsePdfImportAccepted({ acceptedRows: 8, pages: 2, rejectedRows: 3 })?.rejectedRows === 3 &&
  parsePdfImportAccepted({ acceptedRows: 8, pages: 2 })?.rejectedRows === 0 &&
  parsePdfImportAccepted({ acceptedRows: 8, pages: 2, rejectedRows: -1 }) === null &&
  parsePdfImportAccepted({ acceptedRows: 8, pages: 2, rejectedRows: '3' }) === null);
ok('pdf response: accepted + rejected rows must reconcile and incomplete coverage is never persisted',
  parsePdfImportAccepted({ acceptedRows: 8, rejectedRows: 2, totalRows: 10, pages: 2, coverage: {
    sourceKey: 'account-1', label: 'Account', startDate: '2026-01-01', endDate: '2026-01-31',
  } })?.coverage === null &&
  parsePdfImportAccepted({ acceptedRows: 8, rejectedRows: 2, totalRows: 9, pages: 2 }) === null &&
  parsePdfImportAccepted({ acceptedRows: 8, rejectedRows: 2, pages: 2 })?.totalRows === 10);
ok('statement responses: card rows refused for an unexplained sign are a bounded count, zero from an older relay',
  parsePdfImportAccepted({ acceptedRows: 8, pages: 2, rejectedRows: 2, cardSignRowsSkipped: 2 })?.cardSignRowsSkipped === 2 &&
  parsePdfImportAccepted({ acceptedRows: 8, pages: 2 })?.cardSignRowsSkipped === 0 &&
  parsePdfImportAccepted({ acceptedRows: 8, pages: 2, rejectedRows: 1, cardSignRowsSkipped: 2 }) === null &&
  parseCsvImportAccepted({ acceptedRows: 8, rejectedRows: 2, totalRows: 10, cardSignRowsSkipped: 1 })?.cardSignRowsSkipped === 1 &&
  parseCsvImportAccepted({ acceptedRows: 8, rejectedRows: 2, totalRows: 10, cardSignRowsSkipped: -1 }) === null);
ok('statement responses: an unexplained card sign convention is its own refusal',
  pdfImportError(422, { error: 'ambiguous_card_signs' }).code === 'ambiguous_card_signs');
ok('statement responses: dates that read either way are their own refusal',
  pdfImportError(422, { error: 'ambiguous_dates' }).code === 'ambiguous_dates');
ok('pdf response: an oversized text PDF is its own error, not the scanned-PDF one',
  pdfImportError(413, { error: 'pdf_too_long' }).code === 'pdf_too_long');
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
const relay = fs.readFileSync(path.join(root, 'src/lib/relay.ts'), 'utf8');
ok('SDK 55 upload uses File + expo/fetch, never the throwing legacy upload API',
  /from 'expo-file-system'/.test(transport) &&
  /from 'expo\/fetch'/.test(transport) &&
  /body: file/.test(transport) &&
  !/expo-file-system\/legacy|uploadAsync|new FormData/i.test(transport));
ok('CSV and TSV use a distinct authenticated statement endpoint',
  /uploadCsvStatement/.test(transport) && /\/v1\/import\/csv/.test(transport) &&
    /text\/tab-separated-values/.test(transport));
ok('statement uploads send the authoritative ledger currency and exponent, never infer money from country',
  /x-wafra-ledger-currency/.test(transport) &&
    /x-wafra-ledger-exponent/.test(transport) &&
    /ledgerMoney\.currency/.test(transport) && /ledgerMoney\.exponent/.test(transport));
ok('statement import requires an explicit ledger currency before picking files',
  /LedgerCurrencySheet/.test(surface) &&
    /!state\.ledgerMoney/.test(surface) &&
    /disabled=\{!capabilities \|\| busy !== null \|\| pendingPdfs\.length > 0 \|\| !state\.ledgerMoney\}/.test(surface));
ok('picker cache copy is immediately readable and deleted after the attempt',
  /copyToCacheDirectory: true/.test(surface) &&
  /file\.delete\(\)/.test(surface));
ok('statement screen no longer exposes forwarded-email setup',
  !/createEmailForwardingAddress|revokeEmailForwardingAddress|forwardingAddress|Create private address/.test(surface));
ok('protected PDF retry keeps the picker copy only until password retry or cancel',
  /pdf_password_required/.test(surface) && /secureTextEntry/.test(surface) &&
    /retryProtectedPdf/.test(surface) && /pendingPdf\.file\.delete\(\)/.test(surface));
// Coverage is persisted once the whole batch has uploaded. Awaiting a full
// ledger persist inside the per-file loop was the "laggy import" report.
const uploadLoop = surface.slice(
  surface.indexOf('for (let index = 0; index < picked.assets.length'),
  surface.indexOf('await rememberCoverage(coverage)'),
);
ok('statement coverage is recorded after the upload loop, not per file',
  uploadLoop.length > 0 && !/rememberCoverage\(/.test(uploadLoop) &&
  !/recordStatementCoverage\(/.test(uploadLoop));
ok('password-protected PDFs are all deferred and the rest of the batch still uploads',
  /protectedPdfs\.push\(\{ asset, file \}\);[\s\S]{0,40}continue;/.test(uploadLoop) &&
    !/return;/.test(uploadLoop));
ok('multiple protected PDFs are queued for sequential passwords instead of being skipped',
  /const protectedPdfs: PendingProtectedPdf\[\] = \[\]/.test(surface) &&
    /setPendingPdfs\(protectedPdfs\)/.test(surface) &&
    /pendingPdfs\.length > 1/.test(surface) &&
    !/skippedProtected|passwordSkipped/.test(surface));
ok('a failed post-upload sync is reported, not folded into the pending status',
  /copy\.syncFailed/.test(surface) && /syncFailureReason/.test(surface));
ok('statement upload and relay queue drain use the same Expo native fetch transport',
  /from 'expo\/fetch'/.test(transport) && /from 'expo\/fetch'/.test(relay) &&
    /return await expoFetch\(url/.test(relay));
ok('queued statement rows retry without requiring another upload',
  /queuedRetryNeededRef/.test(surface) &&
    /AppState\.addEventListener\('change'/.test(surface) &&
    /setTimeout\(\(\) => \{ void retryQueued\(\); \}, 1_500\)/.test(surface));
ok('multi-file statement imports drain full 200-row relay pages without one giant JS turn',
  /for \(let page = 0; page < 50; page \+= 1\)/.test(surface) &&
    /outcome\.moreQueued !== true/.test(surface) &&
    /await new Promise<void>\(\(resolve\) => setTimeout\(resolve, 0\)\)/.test(surface));
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

// A successful upload leaves the rows safe on the relay and then files them on
// the phone, which on a large ledger takes a visible moment. That moment used
// to be narrated with acceptedPending -- "could not sync to this phone yet. Try
// again in a moment." -- so a working import read as a failure the user was
// being asked to retry, right up until it replaced itself with the success
// line. Progress and failure must not share copy.
const copySource = fs.readFileSync(path.join(root, 'src/lib/supplement-copy.ts'), 'utf8');
const filingStatus = surface.slice(
  surface.indexOf('const finishQueuedImport'),
  surface.indexOf('const imported = await syncQueued()'),
);
ok('the in-flight filing status does not reuse the failure copy',
  /copy\.acceptedFiling/.test(filingStatus) && !/copy\.acceptedPending/.test(filingStatus),
  'acceptedPending tells the user to retry; nothing has failed while the rows are still being filed');

ok('acceptedPending is still what a real sync failure reports',
  /setStatus\(interpolate\(copy\.acceptedPending/.test(
    surface.slice(surface.indexOf('} catch (e) {', surface.indexOf('const finishQueuedImport')))),
  'the failure branch must keep the wording that asks the user to try again');

ok('both languages define the filing progress line',
  (copySource.match(/acceptedFiling:/g) || []).length === 2,
  'a missing Arabic string would fall through to an undefined status');

console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
