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

// ── Statement coverage: never claim "no gaps" for a source it cannot name ──
{
  const { summarizeCoverage, isIdentifiedCoverageSource } = require('./build/statement-coverage');
  const today = new Date(Date.UTC(2026, 8, 24));
  const entry = (sourceKey, label, startDate, endDate) => ({
    id: `${sourceKey}:${startDate}`, sourceKey, label, startDate, endDate, importedAt: 1, format: 'pdf',
  });
  const summary = summarizeCoverage([
    entry('card:credit:4821', 'Card •4821', '2025-09-01', '2026-08-31'),
    entry('bank-statements', 'Bank statements', '2025-09-01', '2026-02-28'),
    entry('bank-statements', 'Bank statements', '2026-03-01', '2026-08-31'),
    entry('bank:hsbc', 'HSBC', '2026-01-01', '2026-08-31'),
    entry('account:account:1234', 'Account •1234', '2026-06-01', '2026-06-30'),
  ], 'en', today);
  const byKey = new Map(summary.map((item) => [item.sourceKey, item]));
  ok('coverage: only a masked account or card is an identified source',
    isIdentifiedCoverageSource('card:credit:4821') && isIdentifiedCoverageSource('account:account:1234') &&
      !isIdentifiedCoverageSource('bank-statements') && !isIdentifiedCoverageSource('bank:hsbc'));
  ok('coverage: an identified card with every month is complete',
    byKey.get('card:credit:4821')?.identified === true && byKey.get('card:credit:4821')?.missing.length === 0);
  ok('coverage: an identified account reports its missing months',
    byKey.get('account:account:1234')?.identified === true && byKey.get('account:account:1234').missing.length > 0);
  ok('coverage: unidentified statements are never presented as complete or gap-checked',
    byKey.get('bank-statements')?.identified === false && byKey.get('bank-statements').missing.length === 0 &&
      byKey.get('bank:hsbc')?.identified === false,
    JSON.stringify(summary));
}

// ── Multi-file statement batches: pacing and counted copy ──
{
  const { nextUploadDelay, UPLOAD_WINDOW_MS, UPLOADS_PER_WINDOW, countPhrase } = require('./build/statement-batch');
  const now = 1_000_000;
  ok('pacing: a fresh batch starts immediately', nextUploadDelay([], now) === 0);
  const burst = Array.from({ length: UPLOADS_PER_WINDOW }, (_, index) => now - 10_000 + index);
  ok('pacing: a full window waits until its oldest start has aged out, with margin',
    nextUploadDelay(burst, now) > 50_000 && nextUploadDelay(burst, now) <= UPLOAD_WINDOW_MS);
  ok('pacing: starts older than the window no longer count',
    nextUploadDelay(burst.map((t) => t - UPLOAD_WINDOW_MS), now) === 0);
  ok('pacing: stays under the relay limit of six uploads a minute per format', UPLOADS_PER_WINDOW <= 5);
  const en = { one: '{n} statement', other: '{n} statements' };
  const ar = { zero: 'لا كشوف', one: 'كشف واحد', two: 'كشفان', few: '{n} كشوف', many: '{n} كشفاً', other: '{n} كشف' };
  ok('plural copy: English says 1 statement and 2 statements',
    countPhrase('en', en, 1) === '1 statement' && countPhrase('en', en, 2) === '2 statements');
  ok('plural copy: Arabic uses the dual and the 3–10 / 11–99 forms',
    countPhrase('ar', ar, 1) === 'كشف واحد' && countPhrase('ar', ar, 2) === 'كشفان' &&
      countPhrase('ar', ar, 3) === '3 كشوف' && countPhrase('ar', ar, 11) === '11 كشفاً' &&
      countPhrase('ar', ar, 100) === '100 كشف' && countPhrase('ar', ar, 103) === '103 كشوف');
}
ok('statement responses: a re-upload the relay already processed says so, older relays default to false',
  parsePdfImportAccepted({ acceptedRows: 2, pages: 1, alreadyProcessed: true })?.alreadyProcessed === true &&
  parsePdfImportAccepted({ acceptedRows: 2, pages: 1 })?.alreadyProcessed === false &&
  parsePdfImportAccepted({ acceptedRows: 2, pages: 1, alreadyProcessed: 'yes' }) === null &&
  parseCsvImportAccepted({ acceptedRows: 2, rejectedRows: 0, totalRows: 2, alreadyProcessed: true })?.alreadyProcessed === true);

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
    // "Choose file" connects on first use, so capabilities are loaded by the
    // tap itself; the ledger currency is still required before the picker.
    /disabled=\{loadingConfig \|\| busy !== null \|\| pendingPdfs\.length > 0 \|\| !state\.ledgerMoney\}/.test(surface) &&
    /const chooseFile = async \(\) => \{[\s\S]{0,160}if \(!state\.ledgerMoney\) \{\s*setCurrencySheetVisible\(true\);\s*return;/.test(surface));
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
  surface.indexOf('await syncQueued()', surface.indexOf('const finishQueuedImport')),
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

ok('one failed file no longer aborts the batch: every file gets its own result and the loop never rethrows',
  uploadLoop.length > 0 && !/throw e;/.test(uploadLoop) && /fileResults\.push\(/.test(uploadLoop) &&
    /copy\.fileFailed/.test(surface) && /copy\.fileImported/.test(surface));
ok('uploads are paced under the relay rate limit, with a visible waiting state, and one rate-limit retry',
  /nextUploadDelay\(/.test(uploadLoop) && /copy\.waitingForLimit/.test(surface) &&
    /rate_limited/.test(uploadLoop));
ok('coverage and the queued-row drain still run for the files that succeeded',
  /await rememberCoverage\(coverage\);[\s\S]{0,400}finishQueuedImport\(/.test(surface));
ok('the statement screen says files go to Wafra\'s server, above the Choose button, in both languages',
  /copy\.uploadDisclosure/.test(surface) &&
    surface.indexOf('copy.uploadDisclosure') < surface.indexOf('copy.chooseStatements') &&
    (copySource.match(/uploadDisclosure:/g) || []).length === 2);
ok('leftover statement picker copies are cleared when the screen opens and closes',
  /clearStatementPickerCache\(/.test(surface) && /export function clearStatementPickerCache/.test(transport));
console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
