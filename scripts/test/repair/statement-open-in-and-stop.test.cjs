'use strict';
// Statement import: base64 PDF passwords, new relay error codes, Excel
// uploads, "Open in Wafra" from the iOS Share Sheet / Files, and the batch
// Stop control. Executes the checked-in source; native and network calls are
// explicit stubs.
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const ts = require('typescript');
const vm = require('node:vm');
const load = require('./load-typescript.cjs');

const root = path.resolve(__dirname, '../../..');
const read = (file) => fs.readFileSync(path.join(root, file), 'utf8');
// Values built inside a vm context have that realm's prototypes.
const plain = (value) => JSON.parse(JSON.stringify(value));
const contract = load(path.join(root, 'src/lib/cloud-import-contract.ts'));
const XLSX = 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet';
const cfg = { baseUrl: 'https://relay.example.invalid', adminToken: 'fixture-token' };
const money = { currency: 'AED', exponent: 2 };

function transport() {
  const requests = [];
  const api = load(path.join(root, 'src/lib/cloud-import.ts'), {
    'expo/fetch': { fetch: async (url, init) => {
      requests.push({ url, ...init });
      const csv = url.endsWith('/csv');
      return { ok: true, status: 202, text: async () => JSON.stringify(csv
        ? { acceptedRows: 1, rejectedRows: 0, totalRows: 1 }
        : { acceptedRows: 1, pages: 1 }) };
    } },
    'expo-file-system': { File: class { constructor() { throw new Error('native filesystem unavailable'); } } },
    '@/lib/cloud-import-contract': contract,
  }, { AbortController });
  return { api, requests };
}

const caps = (overrides = {}) => ({
  email: { enabled: true, accepts: [], maxBytes: 1000 },
  pdf: { enabled: true, accepts: ['application/pdf'], maxBytes: 1000, maxRows: 300, maxPages: 10, parser: 'x', note: '',
    ...overrides.pdf },
  csv: { enabled: true, accepts: ['text/csv', 'text/tab-separated-values'], maxBytes: 1000, maxRows: 400, parser: 'x', note: '',
    ...overrides.csv },
});
const blob = (size = 20) => new Blob(['x'.repeat(size)]);

/* ── PDF password header ─────────────────────────────────────────────── */

test('utf8Base64 is standard base64 of the UTF-8 bytes, in Hermes-safe code', () => {
  const samples = ['', 'a', 'ab', 'abc', 'abcd', '  pass word  ', 'كلمة السر', ' سر123 ', '密码', 'pa😀ss', 'éè',
    'x'.repeat(257), 'lone\ud800surrogate', 'trail\udc00'];
  for (const value of samples) {
    assert.equal(contract.utf8Base64(value), Buffer.from(new TextEncoder().encode(value)).toString('base64'), JSON.stringify(value));
  }
  const source = read('src/lib/cloud-import-contract.ts');
  assert.doesNotMatch(source, /Buffer\.from|\bbtoa\(|new TextEncoder\(/, 'no Node/browser-only encoder in shipping code');
});

test('a relay advertising b64 gets the password base64-encoded exactly as typed, spaces and Arabic kept', async () => {
  const { api, requests } = transport();
  const password = '  كلمة السر 2026 ';
  const advertised = contract.parseImportCapabilities(caps({ pdf: { passwordEncoding: ['b64'] } }));
  assert.deepEqual(plain(advertised.pdf.passwordEncoding), ['b64']);
  await api.uploadPdfStatement(cfg, { uri: 'blob:x', name: 'locked.pdf', file: blob() }, advertised, money, password);
  const headers = requests[0].headers;
  assert.equal(headers['x-wafra-pdf-password-b64'], Buffer.from(password, 'utf8').toString('base64'));
  assert.equal(Buffer.from(headers['x-wafra-pdf-password-b64'], 'base64').toString('utf8'), password);
  assert.equal('x-wafra-pdf-password' in headers, false, 'the raw secret is not sent twice');
});

test('a relay that does not advertise b64 keeps the legacy header; no password sends neither', async () => {
  const { api, requests } = transport();
  const legacy = contract.parseImportCapabilities(caps());
  assert.equal('passwordEncoding' in legacy.pdf, false);
  await api.uploadPdfStatement(cfg, { uri: 'blob:x', name: 'locked.pdf', file: blob() }, legacy, money, ' secret ');
  assert.equal(requests[0].headers['x-wafra-pdf-password'], ' secret ');
  assert.equal('x-wafra-pdf-password-b64' in requests[0].headers, false);
  const other = contract.parseImportCapabilities(caps({ pdf: { passwordEncoding: ['hex'] } }));
  await api.uploadPdfStatement(cfg, { uri: 'blob:x', name: 'locked.pdf', file: blob() }, other, money, 'p');
  assert.equal(requests[1].headers['x-wafra-pdf-password'], 'p');
  await api.uploadPdfStatement(cfg, { uri: 'blob:x', name: 'open.pdf', file: blob() }, legacy, money);
  assert.equal(Object.keys(requests[2].headers).some((key) => key.startsWith('x-wafra-pdf-password')), false);
});

test('a malformed passwordEncoding reads as legacy without refusing the capability document', () => {
  for (const passwordEncoding of ['b64', [1], { b64: true }, null]) {
    const parsed = contract.parseImportCapabilities(caps({ pdf: { passwordEncoding } }));
    assert.ok(parsed, `document with passwordEncoding=${JSON.stringify(passwordEncoding)} still parses`);
    assert.equal(parsed.pdf.passwordEncoding, undefined);
    assert.deepEqual(plain(contract.pdfPasswordHeaders('pw', parsed)), { 'x-wafra-pdf-password': 'pw' });
  }
});

test('with b64 advertised, an unusable password is refused on the phone before the file is sent', async () => {
  const { api, requests } = transport();
  const advertised = contract.parseImportCapabilities(caps({ pdf: { passwordEncoding: ['b64'], maxPasswordBytes: 256 } }));
  assert.equal(advertised.pdf.maxPasswordBytes, 256);
  const pdf = { uri: 'blob:x', name: 'locked.pdf', file: blob() };
  for (const password of ['tab\there', 'line\nbreak', 'nul\u0000', 'ك'.repeat(129)]) {
    await assert.rejects(api.uploadPdfStatement(cfg, pdf, advertised, money, password),
      (error) => error instanceof contract.CloudImportError && error.code === 'pdf_password_invalid', JSON.stringify(password));
  }
  assert.equal(requests.length, 0, 'nothing uploaded for a password the relay would refuse');
  // Exactly 256 UTF-8 bytes (128 Arabic letters) and surrounding spaces are fine.
  await api.uploadPdfStatement(cfg, pdf, advertised, money, 'ك'.repeat(128));
  await api.uploadPdfStatement(cfg, pdf, advertised, money, '  spaced  ');
  assert.equal(requests.length, 2);
  // A legacy relay answers for itself: no local rule is applied.
  await api.uploadPdfStatement(cfg, pdf, contract.parseImportCapabilities(caps()), money, 'tab\there');
  assert.equal(requests[2].headers['x-wafra-pdf-password'], 'tab\there');
});

/* ── Error codes ─────────────────────────────────────────────────────── */

test('new relay error codes reach the client as themselves', () => {
  for (const code of ['pdf_password_invalid', 'pdf_damaged', 'pdf_encryption_unsupported', 'invalid_xlsx', 'unreadable_pdf']) {
    assert.equal(contract.pdfImportError(422, { error: code }).code, code);
  }
  assert.equal(contract.pdfImportError(422, { error: 'something_new' }).code, 'unexpected');
  // A relay that reads structured statements names a file it cannot read.
  assert.equal(contract.pdfImportError(415, { error: 'unsupported_file_type' }).code, 'unsupported_file_type');
});

function supplementCopy() {
  const names = load(path.join(root, 'src/lib/country-names.ts'));
  const country = load(path.join(root, 'src/lib/country.ts'), { '@/lib/country-names': names });
  return load(path.join(root, 'src/lib/supplement-copy.ts'), { '@/lib/country': country }).SUPPLEMENT_COPY;
}

function errorTextFor(copy) {
  const source = read('src/components/supplement-imports.tsx');
  const body = source.slice(source.indexOf('  const errorText = useCallback('), source.indexOf('  const loadCapabilities ='));
  const interpolate = source.slice(source.indexOf('function interpolate('), source.indexOf('/** A fixed visual state'));
  const context = { useCallback: (f) => f, copy, RelayError: class extends Error {}, CloudImportError: contract.CloudImportError };
  vm.runInNewContext(ts.transpileModule(`${interpolate}\n${body}\nglobalThis.errorText = errorText;`, {
    compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.CommonJS },
  }).outputText, context);
  return context.errorText;
}

test('each new error has its own English and Arabic sentence on the statement screen', () => {
  const copy = supplementCopy();
  for (const language of ['en', 'ar']) {
    const words = copy[language];
    const errorText = errorTextFor(words);
    const say = (code, maxRows) => errorText(new contract.CloudImportError(code, 422), maxRows);
    assert.equal(say('pdf_password_invalid'), words.errPasswordInvalid);
    assert.equal(say('pdf_damaged'), words.errPdfDamaged);
    assert.equal(say('pdf_encryption_unsupported'), words.errPdfEncryption);
    assert.equal(say('invalid_xlsx'), words.errXlsx);
    assert.equal(say('unsupported_file_type'), words.errFileType);
    assert.equal(say('unreadable_pdf'), words.errUnreadable, 'scans keep their own copy');
    assert.equal(say('pdf_password_incorrect'), words.passwordWrong);
    // The row cap comes from the relay's capabilities, never a fixed number.
    assert.match(say('too_many_rows', 450), /450/);
    assert.equal(say('too_many_rows'), words.errLarge);
    assert.equal(say('too_large', 450), words.errLarge);
    const distinct = new Set(['errPasswordInvalid', 'errPdfDamaged', 'errPdfEncryption', 'errXlsx', 'errFileType', 'errUnreadable']
      .map((key) => words[key]));
    assert.equal(distinct.size, 6);
  }
  assert.match(copy.en.errPdfDamaged, /download it again/i);
  assert.match(copy.en.errPdfEncryption, /unprotected copy[\s\S]*CSV or Excel/);
  assert.match(copy.en.errXlsx, /CSV[\s\S]*\.xlsx/);
  assert.doesNotMatch(Object.values(copy.en).join('\n'), /\b200 rows\b/);
});

/* ── Excel (.xlsx) uploads ───────────────────────────────────────────── */

test('an .xlsx statement goes to the CSV endpoint as a workbook only when the relay advertises it', async () => {
  const withXlsx = caps({ csv: { accepts: ['text/csv', 'text/tab-separated-values', XLSX] } });
  const { api, requests } = transport();
  await api.uploadCsvStatement(cfg, { uri: 'blob:x', name: 'Statement Sep.XLSX', file: blob() }, withXlsx, money);
  assert.equal(requests[0].url, `${cfg.baseUrl}/v1/import/csv`);
  assert.equal(requests[0].headers['content-type'], XLSX);
  // A mislabelled workbook is still sent as a workbook, and text never as one.
  await api.uploadCsvStatement(cfg, { uri: 'blob:x', name: 'book.xlsx', mimeType: 'text/csv', file: blob() }, withXlsx, money);
  assert.equal(requests[1].headers['content-type'], XLSX);
  await api.uploadCsvStatement(cfg, { uri: 'blob:x', name: 'plain.csv', mimeType: XLSX, file: blob() }, withXlsx, money);
  assert.equal(requests[2].headers['content-type'], 'text/csv');
  await api.uploadCsvStatement(cfg, { uri: 'blob:x', name: 'noext', mimeType: XLSX, file: blob() }, withXlsx, money);
  assert.equal(requests[3].headers['content-type'], XLSX);
  await api.uploadCsvStatement(cfg, { uri: 'blob:x', name: 'tabs.tsv', file: blob() }, withXlsx, money);
  assert.equal(requests[4].headers['content-type'], 'text/tab-separated-values');
  // The CSV size limit applies to workbooks too.
  await assert.rejects(api.uploadCsvStatement(cfg, { uri: 'blob:x', name: 'big.xlsx', file: blob(1001) }, withXlsx, money),
    (error) => error.code === 'too_large');
  assert.equal(requests.length, 5);
});

test('a per-type size ceiling lets a workbook exceed the text limit; malformed maps fall back to maxBytes', async () => {
  const byType = { 'text/csv': 1000, 'text/tab-separated-values': 1000, [XLSX]: 2000 };
  const withXlsx = contract.parseImportCapabilities(caps({ csv: { accepts: ['text/csv', 'text/tab-separated-values', XLSX],
    maxBytesByType: byType } }));
  assert.deepEqual(plain(withXlsx.csv.maxBytesByType), byType);
  const { api, requests } = transport();
  await api.uploadCsvStatement(cfg, { uri: 'blob:x', name: 'big.xlsx', file: blob(1500) }, withXlsx, money);
  assert.equal(requests.length, 1, 'a 1.5x workbook is within its own ceiling');
  await assert.rejects(api.uploadCsvStatement(cfg, { uri: 'blob:x', name: 'big.csv', file: blob(1500) }, withXlsx, money),
    (error) => error.code === 'too_large');
  await assert.rejects(api.uploadCsvStatement(cfg, { uri: 'blob:x', name: 'huge.xlsx', file: blob(2001) }, withXlsx, money),
    (error) => error.code === 'too_large');
  for (const maxBytesByType of [{ [XLSX]: -1 }, { [XLSX]: '2000' }, [2000], 'big', {}]) {
    const parsed = contract.parseImportCapabilities(caps({ csv: { accepts: ['text/csv', XLSX], maxBytesByType } }));
    assert.ok(parsed);
    assert.equal(parsed.csv.maxBytesByType, undefined, JSON.stringify(maxBytesByType));
    assert.equal(contract.csvMaxBytes(parsed, XLSX), 1000);
  }
  assert.equal(requests.length, 1);
});

test('an older relay without Excel refuses .xlsx locally with a specific reason and sends nothing', async () => {
  const { api, requests } = transport();
  await assert.rejects(api.uploadCsvStatement(cfg, { uri: 'blob:x', name: 'statement.xlsx', file: blob() }, caps(), money),
    (error) => error instanceof contract.CloudImportError && error.code === 'unsupported_file_type');
  assert.equal(requests.length, 0);
});

test('the screen routes .xlsx to the CSV upload, names Excel only when advertised, and cleans .xlsx copies', () => {
  const screen = read('src/components/supplement-imports.tsx');
  const transportSource = read('src/lib/cloud-import.ts');
  assert.match(screen, /const csv = !\/\\\.pdf\$\/i\.test\(asset\.name\) && \(\/\\\.\(\?:csv\|tsv\|xlsx\|ofx\|qfx\|qif\|xml\|sta\|mt940\|940\)\$\/i\.test\(asset\.name\)/);
  assert.match(screen, /const excel = !!capabilities\?\.csv\.enabled && capabilities\.csv\.accepts\.includes\(XLSX_CONTENT_TYPE\)/);
  assert.match(screen, /const formats = excel \? copy\.formatsExcel : copy\.formats;/);
  assert.match(screen, /tables: excel \? copy\.tableFormatsExcel : copy\.tableFormats/);
  assert.match(screen, /type: \[\.\.\.capabilities\.pdf\.accepts, \.\.\.capabilities\.csv\.accepts\]/,
    'the picker offers exactly what the relay advertises');
  assert.match(transportSource, /const STATEMENT_COPY = \/\\\.\(\?:pdf\|csv\|tsv\|xlsx\|ofx\|qfx\|qif\|xml\|sta\|mt940\|940\)\$\/i;/);
  assert.match(transportSource, /new Directory\(Paths\.document, 'Inbox'\)/);
  const copy = supplementCopy();
  assert.equal(copy.en.formats, 'PDF, CSV or TSV');
  assert.match(copy.en.formatsExcel, /Excel/);
  assert.match(copy.ar.formatsExcel, /Excel/);
  for (const language of ['en', 'ar']) {
    assert.match(copy[language].statementBody, /\{formats\}/);
    assert.match(copy[language].statementLimits, /\{tables\}/);
  }
});

/* ── "Open in Wafra" ─────────────────────────────────────────────────── */

const CONTAINER = '/var/mobile/Containers/Data/Application/0A1B2C3D-0000-4000-8000-000000000001';
// expo-file-system spells the documents directory /var/…; iOS hands over /private/var/….
const DOCUMENTS = `file://${CONTAINER}/Documents/`;
const INBOX = `file:///private${CONTAINER}/Documents/Inbox`;

function nativeIntent(os = 'ios', documents = DOCUMENTS) {
  const incoming = load(path.join(root, 'src/lib/incoming-statement-file.ts'));
  const intent = load(path.join(root, 'src/app/+native-intent.tsx'), {
    'react-native': { Platform: { OS: os } },
    'expo-file-system': { Paths: { get document() {
      if (documents instanceof Error) throw documents;
      return { uri: documents };
    } } },
    '@/lib/incoming-statement-file': incoming,
  });
  return { incoming, redirect: (url, initial = true) => intent.redirectSystemPath({ path: url, initial }) };
}

test('a statement handed over by iOS opens the import screen with a one-time token, never the path', () => {
  const { incoming, redirect } = nativeIntent();
  for (const [file, name] of [['statement.pdf', 'statement.pdf'], ['Card%20Sep%202026.CSV', 'Card Sep 2026.CSV'],
    ['tabs.tsv', 'tabs.tsv'], ['%D9%83%D8%B4%D9%81.xlsx', 'كشف.xlsx']]) {
    const url = `${INBOX}/${file}`;
    const route = redirect(url);
    const match = /^\/statement-import\?incomingStatement=([a-z0-9]+)$/.exec(route);
    assert.ok(match, `${file} → ${route}`);
    assert.doesNotMatch(route, /file|Inbox|private/, 'the file location is not a route parameter');
    assert.equal(incoming.pendingIncomingStatementUri(), url);
    assert.equal(incoming.takeIncomingStatement('forged'), null);
    assert.deepEqual({ ...incoming.takeIncomingStatement(match[1]) }, { uri: url, name });
    assert.equal(incoming.takeIncomingStatement(match[1]), null, 'a token is claimed once');
    assert.equal(incoming.pendingIncomingStatementUri(), null);
  }
  // Warm opens go through the same rule.
  assert.match(redirect(`${INBOX}/later.pdf`, false), /^\/statement-import\?incomingStatement=/);
});

test('the Inbox is matched against the real documents directory in all its spellings', () => {
  const name = 'statement.pdf';
  for (const documents of [DOCUMENTS, DOCUMENTS.slice(0, -1), `file:${CONTAINER}/Documents/`, `file:///private${CONTAINER}/Documents`]) {
    const { incoming } = nativeIntent();
    for (const url of [`${INBOX}/${name}`, `file://${CONTAINER}/Documents/Inbox/${name}`]) {
      assert.deepEqual(plain(incoming.parseIncomingStatementUrl(url, documents)), { uri: url, name }, `${documents} ${url}`);
    }
  }
  const { incoming } = nativeIntent();
  const outside = [
    `file://${CONTAINER}/Documents/${name}`, `file://${CONTAINER}/Documents/Inbox/sub/${name}`,
    `file://${CONTAINER}/Library/Caches/Inbox/${name}`, `file://${CONTAINER}/tmp/Inbox/${name}`,
    `file:///var/mobile/Containers/Data/Application/FFFFFFFF-0000-4000-8000-000000000002/Documents/Inbox/${name}`,
    `file://${CONTAINER}/Documents/inbox/${name}`, `file:///private/private${CONTAINER}/Documents/Inbox/${name}`,
  ];
  for (const url of outside) assert.equal(incoming.parseIncomingStatementUrl(url, DOCUMENTS), null, url);
  for (const documents of [null, undefined, '', 'file:///', 'https://x/Documents/', 'file://host/Documents/']) {
    assert.equal(incoming.parseIncomingStatementUrl(`${INBOX}/${name}`, documents), null, String(documents));
  }
  // An unreadable documents directory fails closed, without crashing the launch.
  const broken = nativeIntent('ios', new Error('no native module'));
  assert.equal(broken.redirect(`${INBOX}/${name}`), null);
});

test('iOS 26 copies of files shared from Files / iCloud Drive (tmp/<bundle id>-Inbox) open the import screen too', () => {
  // Verified on an iPhone 15 (iOS 26.6.2): a Files share opens Wafra with
  // <container>/tmp/app.wafra.ios-Inbox/<name>, not Documents/Inbox.
  const TMP_INBOX = `file:///private${CONTAINER}/tmp/app.wafra.ios-Inbox`;
  const { incoming, redirect } = nativeIntent();
  for (const [file, name] of [['fab-files-test.pdf', 'fab-files-test.pdf'], ['test-statement.ofx', 'test-statement.ofx'],
    ['Card%20Sep.csv', 'Card Sep.csv']]) {
    const url = `${TMP_INBOX}/${file}`;
    assert.deepEqual(plain(incoming.parseIncomingStatementUrl(url, DOCUMENTS)), { uri: url, name }, url);
    const route = redirect(url, false);
    assert.match(route, /^\/statement-import\?incomingStatement=[a-z0-9]+$/, url);
    assert.doesNotMatch(route, /file|Inbox|private|tmp/);
  }
  assert.deepEqual(plain(incoming.parseIncomingStatementUrl(`file://${CONTAINER}/tmp/app.wafra.ios-Inbox/s.pdf`, DOCUMENTS)),
    { uri: `file://${CONTAINER}/tmp/app.wafra.ios-Inbox/s.pdf`, name: 's.pdf' });
  const rejected = [
    `file://${CONTAINER}/tmp/s.pdf`, `file://${CONTAINER}/tmp/Inbox/s.pdf`, `file://${CONTAINER}/tmp/-Inbox/s.pdf`,
    `file://${CONTAINER}/tmp/app.wafra.ios-Inbox/sub/s.pdf`, `file://${CONTAINER}/tmp/app.wafra.ios-Outbox/s.pdf`,
    `file://${CONTAINER}/tmp/app.wafra.ios-Inbox/s.docx`, `file://${CONTAINER}/tmp/app.wafra.ios-Inbox/.pdf`,
    `file://${CONTAINER}/tmp/app.wafra.ios-Inbox/../s.pdf`, `file://${CONTAINER}/tmp/a%2F..%2F-Inbox/s.pdf`,
    `file://${CONTAINER}/Library/app.wafra.ios-Inbox/s.pdf`, `file://${CONTAINER}/Documents/tmp/app.wafra.ios-Inbox/s.pdf`,
    'file:///var/mobile/Containers/Data/Application/FFFFFFFF-0000-4000-8000-000000000002/tmp/app.wafra.ios-Inbox/s.pdf',
    'file:///private/var/mobile/Library/Mobile%20Documents/com~apple~CloudDocs/Downloads/s.pdf',
  ];
  for (const url of rejected) assert.equal(incoming.parseIncomingStatementUrl(url, DOCUMENTS), null, url);
  // The container is only derived from a Documents directory.
  assert.equal(incoming.parseIncomingStatementUrl(`${TMP_INBOX}/s.pdf`, `file://${CONTAINER}/Library/`), null);
});

test('other links pass through untouched and unusable file URLs are dropped', () => {
  const { incoming, redirect } = nativeIntent();
  for (const link of ['https://wafra.app/statement.pdf', 'http://example.com/a.csv', 'wafra://statement-import?incomingStatement=x',
    '/statement-import', 'wafra://transactions']) {
    assert.equal(redirect(link), link, link);
  }
  const rejected = [
    `${INBOX}/statement.docx`, `${INBOX}/statement`, `${INBOX}/.pdf`, `${INBOX}/statement.pdf.exe`,
    `${INBOX}/../../Library/statement.pdf`, `${INBOX}/%2e%2e/statement.pdf`, `${INBOX}/a%2F..%2Fstatement.pdf`,
    `${INBOX}/a%5Cstatement.pdf`, `${INBOX}//statement.pdf`, `${INBOX}/./statement.pdf`, `${INBOX}/statement.pdf?x=1`,
    `${INBOX}/statement.pdf#frag`, `${INBOX}/bad%ZZ.pdf`, `${INBOX}/nul%00.pdf`, `${INBOX}/line%0A.pdf`,
    'file://evil.example/Inbox/statement.pdf', 'file:/Inbox/statement.pdf', 'FILE:///Inbox/statement.pdf',
    'file:///statement.pdf', `${INBOX}/${'a'.repeat(300)}.pdf`, `file:///${'a/'.repeat(1100)}x.pdf`,
  ];
  for (const url of rejected) {
    assert.equal(incoming.parseIncomingStatementUrl(url, DOCUMENTS), null, url);
    assert.equal(redirect(url), null, url);
  }
  assert.equal(incoming.pendingIncomingStatementUri(), null, 'nothing rejected is remembered');
  for (const value of [null, undefined, 42, {}]) assert.equal(incoming.parseIncomingStatementUrl(value, DOCUMENTS), null);
});

test('a second file handed over before the first is claimed supersedes it, and the old copy is queued for deletion', () => {
  const { incoming, redirect } = nativeIntent();
  const first = /incomingStatement=(\w+)/.exec(redirect(`${INBOX}/first.pdf`))[1];
  const second = /incomingStatement=(\w+)/.exec(redirect(`${INBOX}/second.pdf`))[1];
  assert.equal(incoming.takeIncomingStatement(first), null);
  assert.deepEqual(plain(incoming.takeSupersededIncomingStatements()), [`${INBOX}/first.pdf`]);
  assert.deepEqual(plain(incoming.takeSupersededIncomingStatements()), [], 'handed out once');
  assert.equal(incoming.takeIncomingStatement(second).name, 'second.pdf');
});

test('Android registers no document types, so its links pass through even for file URLs', () => {
  const { redirect } = nativeIntent('android');
  assert.equal(redirect(`${INBOX}/statement.pdf`), `${INBOX}/statement.pdf`);
});

test('app.json registers PDF, CSV, TSV, Excel, OFX, QIF and MT940 as an alternate viewer and asks iOS for an Inbox copy', () => {
  const app = JSON.parse(read('app.json'));
  const info = app.expo.ios.infoPlist;
  const types = info.CFBundleDocumentTypes;
  assert.ok(Array.isArray(types));
  assert.deepEqual(types.flatMap((type) => type.LSItemContentTypes).sort(), [
    'app.wafra.ios.mt940', 'app.wafra.ios.ofx', 'app.wafra.ios.qif',
    'com.adobe.pdf', 'org.openxmlformats.spreadsheetml.sheet', 'public.comma-separated-values-text',
    'public.tab-separated-values-text',
  ]);
  // Wafra's own identifiers are declared as imported types so iOS can map
  // the picker's MIME types and the file extensions to them. Generic XML is
  // deliberately not registered.
  const imported = info.UTImportedTypeDeclarations;
  assert.deepEqual(imported.map((type) => type.UTTypeIdentifier).sort(),
    ['app.wafra.ios.mt940', 'app.wafra.ios.ofx', 'app.wafra.ios.qif']);
  for (const type of imported) {
    assert.deepEqual(type.UTTypeConformsTo, ['public.data', 'public.text']);
    assert.ok(type.UTTypeTagSpecification['public.filename-extension'].length > 0);
  }
  assert.ok(!types.some((type) => type.LSItemContentTypes.includes('public.xml')));
  for (const type of types) {
    assert.equal(type.CFBundleTypeRole, 'Viewer');
    assert.equal(type.LSHandlerRank, 'Alternate', 'Wafra never claims to be the default app for these files');
    assert.equal(typeof type.CFBundleTypeName, 'string');
  }
  assert.equal(info.LSSupportsOpeningDocumentsInPlace, false);
  const incoming = load(path.join(root, 'src/lib/incoming-statement-file.ts'));
  assert.deepEqual(plain(incoming.INCOMING_STATEMENT_EXTENSIONS),
    ['pdf', 'csv', 'tsv', 'xlsx', 'ofx', 'qfx', 'qif', 'sta', 'mt940', '940']);
  // Existing keys are kept.
  assert.deepEqual(info.LSApplicationQueriesSchemes, ['shortcuts']);
  assert.equal(info.ITSAppUsesNonExemptEncryption, false);
});

test('the statement screen passes the token on iOS only; the importer owns the App Lock checks', () => {
  const screen = read('src/app/statement-import.tsx');
  assert.match(screen, /const incomingStatement = Platform\.OS === 'ios' && typeof params\.incomingStatement === 'string'\s*\? params\.incomingStatement : undefined;/);
  assert.match(screen, /incomingStatement=\{incomingStatement\}/);
  assert.match(screen, /asks before anything[\s\S]{0,40}is sent/);
  const importer = read('src/components/supplement-imports.tsx');
  assert.match(importer, /const privacyGateCleared = usePrivacyGateCleared\(\);/);
  assert.match(importer, /const appActive = useAppActive\(\);/);
  assert.match(importer, /const unlockedAndActive = \(\) => privacyGateRef\.current && AppState\.currentState === 'active';/);
  // The onboarding handoff token is untouched.
  assert.match(read('src/lib/ios-statement-handoff.ts'), /let activeToken: string \| null = null;/);
});

/**
 * The handed-over flow from source: the card's effect (as run()), Import,
 * Cancel and the import after Import, with native/network boundaries stubbed.
 */
function incomingHarness(overrides = {}) {
  const source = read('src/components/supplement-imports.tsx');
  const handlersStart = source.indexOf('  /** Delete a handed-over copy Wafra will not import');
  const effectStart = source.indexOf('  useEffect(() => {\n    // Copies a newer handed-over file');
  const effectEnd = source.indexOf('  }, [appActive, busy, incomingRetry,', effectStart);
  assert.ok(handlersStart > 0 && effectStart > handlersStart && effectEnd > effectStart,
    'the handed-over statement code is where the test expects it');
  const handlers = source.slice(handlersStart, effectStart);
  const effect = source.slice(effectStart + '  useEffect(() => {'.length, effectEnd);
  const incoming = load(path.join(root, 'src/lib/incoming-statement-file.ts'));
  const events = [];
  const context = {
    preview: undefined, incomingStatement: undefined, incomingPrompt: null,
    incomingRef: { current: null }, inFlightPickerUris: new Set(), statementBatches: { running: 0, copies: new Set() },
    state: { hydrated: true, onboarded: true, privateMode: false, ledgerMoney: money },
    snapshot: null,
    appActive: true, privacyGateCleared: true, privacyGateRef: { current: true }, AppState: { currentState: 'active' },
    loadingConfig: false, busy: null, pendingPdfs: [], queuedRetryInFlightRef: { current: false }, aliveRef: { current: true },
    takeIncomingStatement: incoming.takeIncomingStatement,
    takeSupersededIncomingStatements: incoming.takeSupersededIncomingStatements,
    discardStatementCopy: (uri) => events.push(['discard', uri]),
    setCurrencySheetVisible: (value) => events.push(['currency', value]),
    setIncomingRetry: () => events.push(['retry']), setTimeout: (callback) => { callback(); return 1; }, clearTimeout: () => {},
    ensureConnection: async () => { events.push(['connect']); return context.connection; },
    connection: { cfg: {}, capabilities: {} },
    pickAndUpload: async (_cfg, _caps, asset) => { events.push(['upload', asset]); return context.taken; },
    taken: true,
    ...overrides,
  };
  context.getStateSnapshot = () => context.snapshot ?? context.state;
  context.setIncomingPrompt = (value) => {
    context.incomingPrompt = typeof value === 'function' ? value(context.incomingPrompt) : value;
  };
  vm.runInNewContext(ts.transpileModule(`${handlers}
globalThis.run = () => {${effect}};
globalThis.confirm = confirmIncoming; globalThis.cancel = cancelIncoming;`, {
    compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.CommonJS },
  }).outputText, context);
  const hand = (name) => {
    const url = `${INBOX}/${name}`;
    context.incomingStatement = /incomingStatement=(\w+)/.exec(incoming.incomingStatementRedirect(url, DOCUMENTS))[1];
    return url;
  };
  const settle = () => new Promise((resolve) => setImmediate(resolve));
  return { context, events, incoming, hand, settle };
}

test('a handed-over statement is asked about, never uploaded, until the person taps Import', async () => {
  const h = incomingHarness();
  h.context.incomingStatement = 'forged';
  h.context.run();
  assert.equal(h.context.incomingPrompt, null, 'a token the redirect never issued does nothing');
  const url = h.hand('statement.pdf');
  h.context.run();
  assert.deepEqual(plain(h.context.incomingPrompt), { uri: url, name: 'statement.pdf' }, 'the card asks');
  assert.ok(h.context.inFlightPickerUris.has(url), 'the claimed copy is spared by cache cleanup');
  h.context.run();
  assert.deepEqual(h.events, [], 'drawing the card neither pairs nor uploads');
  h.context.confirm();
  await h.settle();
  assert.deepEqual(plain(h.events), [['connect'], ['upload', { uri: url, name: 'statement.pdf' }]]);
  assert.equal(h.context.incomingPrompt, null);
  assert.equal(h.context.incomingRef.current, null);
  assert.equal(h.context.inFlightPickerUris.size, 0);
  h.context.run();
  h.context.confirm();
  await h.settle();
  assert.equal(h.events.filter((event) => event[0] === 'upload').length, 1, 'imported exactly once');
});

test('the card waits for the foreground, App Lock, setup, and every import here or elsewhere', () => {
  const h = incomingHarness();
  const url = h.hand('statement.csv');
  const hidden = (setup, why) => {
    setup();
    h.context.run();
    assert.equal(h.context.incomingPrompt, null, why);
  };
  hidden(() => { h.context.state = { ...h.context.state, hydrated: false }; }, 'not before the ledger has loaded');
  hidden(() => { h.context.state = { ...h.context.state, hydrated: true, onboarded: false }; }, 'not behind first-run setup');
  h.context.state = { ...h.context.state, onboarded: true };
  hidden(() => { h.context.appActive = false; }, 'not while iOS is still bringing the app forward');
  h.context.appActive = true;
  hidden(() => { h.context.privacyGateCleared = false; }, 'not behind App Lock');
  h.context.privacyGateCleared = true;
  hidden(() => { h.context.busy = 'statement'; }, 'not during this screen’s own import');
  h.context.busy = null;
  hidden(() => { h.context.pendingPdfs = [{}]; }, 'not while a password is being asked');
  h.context.pendingPdfs = [];
  hidden(() => { h.context.statementBatches.running = 1; }, 'not while another importer’s batch runs');
  assert.ok(h.events.some((event) => event[0] === 'retry'), 'checks again until the other batch finishes');
  h.context.statementBatches.running = 0;
  h.context.run();
  assert.equal(h.context.incomingPrompt.uri, url);
  assert.equal(h.events.filter((event) => event[0] === 'discard').length, 0, 'waiting never deletes the copy');
});

test('Import re-checks App Lock at the tap and again before the upload', async () => {
  const h = incomingHarness();
  const url = h.hand('locked.pdf');
  h.context.run();
  // Locked between drawing the card and the tap (the ref is the live answer).
  h.context.privacyGateRef.current = false;
  h.context.confirm();
  h.context.privacyGateRef.current = true;
  h.context.AppState.currentState = 'inactive';
  h.context.confirm();
  await h.settle();
  assert.deepEqual(h.events, [], 'no pairing or upload while locked or not active');
  h.context.AppState.currentState = 'active';
  // Locked while connecting: nothing is sent, and the card comes back after unlock.
  h.context.ensureConnection = async () => {
    h.events.push(['connect']);
    h.context.privacyGateRef.current = false;
    return h.context.connection;
  };
  h.context.confirm();
  await h.settle();
  assert.deepEqual(plain(h.events), [['connect'], ['retry']]);
  assert.equal(h.context.incomingRef.current.asset.uri, url, 'kept for after unlock');
  assert.ok(h.context.inFlightPickerUris.has(url));
});

test('Import asks for a ledger currency first and keeps the card', () => {
  const h = incomingHarness({ snapshot: { hydrated: true, onboarded: true, privateMode: false, ledgerMoney: null } });
  h.hand('statement.pdf');
  h.context.run();
  h.context.confirm();
  assert.deepEqual(h.events, [['currency', true]]);
  assert.ok(h.context.incomingPrompt && h.context.incomingRef.current);
});

test('Cancel, local-only mode, an unreachable service and an early upload exit all delete the Inbox copy', async () => {
  const cancel = incomingHarness();
  const cancelled = cancel.hand('cancel.pdf');
  cancel.context.run();
  cancel.context.cancel();
  assert.deepEqual(cancel.events, [['discard', cancelled]]);
  assert.equal(cancel.context.incomingPrompt, null);
  assert.equal(cancel.context.inFlightPickerUris.size, 0);

  const local = incomingHarness({ state: { hydrated: true, onboarded: true, privateMode: true, ledgerMoney: money } });
  const kept = local.hand('private.csv');
  local.context.run();
  assert.deepEqual(local.events, [['discard', kept]]);
  assert.equal(local.context.incomingRef.current, null);

  const offline = incomingHarness({ connection: null });
  const unsent = offline.hand('offline.pdf');
  offline.context.run();
  offline.context.confirm();
  await offline.settle();
  assert.deepEqual(plain(offline.events), [['connect'], ['discard', unsent]]);

  const early = incomingHarness({ taken: false });
  const dropped = early.hand('early.pdf');
  early.context.run();
  early.context.confirm();
  await early.settle();
  assert.deepEqual(plain(early.events.map((event) => event[0])), ['connect', 'upload', 'discard']);
  assert.equal(early.events.at(-1)[1], dropped);
  assert.equal(early.context.inFlightPickerUris.size, 0);
});

test('a second handed-over file replaces the pending one and deletes its copy', () => {
  const h = incomingHarness();
  const first = h.hand('first.pdf');
  h.context.run();
  const second = h.hand('second.pdf');
  h.context.run();
  assert.deepEqual(h.events, [['discard', first]]);
  assert.equal(h.context.incomingPrompt.uri, second);
  assert.deepEqual(plain([...h.context.inFlightPickerUris]), [second]);
  // Replaced before the screen claimed it: deleted on the next pass.
  const third = h.hand('third.pdf');
  h.hand('fourth.pdf');
  h.context.run();
  assert.ok(h.events.some((event) => event[0] === 'discard' && event[1] === third));
});

test('the confirmation card names the file, repeats the server notice, and stacks Import/Cancel at large text', () => {
  const screen = read('src/components/supplement-imports.tsx');
  const card = screen.slice(screen.indexOf('{incomingPrompt && ('), screen.indexOf('{reading && (', screen.indexOf('{incomingPrompt && (')));
  assert.match(card, /testID="statement-incoming"/);
  assert.match(card, /accessibilityRole="header"[\s\S]{0,120}interpolate\(copy\.incomingTitle, \{ name: incomingPrompt\.name \}\)/);
  assert.match(card, /copy\.uploadDisclosure/);
  assert.match(card, /<View style=\{\[styles\.actions, largeText && styles\.actionsStacked\]\}>/);
  assert.match(card, /testID="statement-incoming-cancel"[\s\S]*onPress=\{cancelIncoming\}/);
  assert.match(card, /testID="statement-incoming-import"[\s\S]*onPress=\{confirmIncoming\}/);
  const copy = supplementCopy();
  for (const key of ['incomingTitle', 'incomingImport', 'incomingCancel']) assert.ok(copy.en[key] && copy.ar[key], key);
  assert.match(copy.en.incomingTitle, /\{name\}/);
  assert.match(copy.ar.incomingTitle, /\{name\}/);
});

/* ── Shared copies across importer instances ─────────────────────────── */

test('every copy of a running batch is shared with other importer instances until the batch ends', () => {
  const screen = read('src/components/supplement-imports.tsx');
  assert.match(screen, /const statementBatches = \{ running: 0, copies: new Set<string>\(\) \};/);
  assert.match(screen, /const keep = new Set\(\[\.\.\.inFlightPickerUris, \.\.\.statementBatches\.copies, \.\.\.awaitingPasswordCopies\]\);/);
  assert.match(screen, /clearStatementPickerCache\(copiesInUse\(\)\);/);
});

test('a locked PDF waiting for its password is spared by another importer instance', () => {
  const screen = read('src/components/supplement-imports.tsx');
  assert.match(screen, /const awaitingPasswordCopies = new Set<string>\(\);/);
  // Tracked as the queue changes, and released when this screen deletes them.
  assert.match(screen, /for \(const pending of pendingPdfsRef\.current\) awaitingPasswordCopies\.delete\(pending\.asset\.uri\);\n\s*for \(const pending of pendingPdfs\) awaitingPasswordCopies\.add\(pending\.asset\.uri\);/);
  assert.match(screen, /for \(const pending of pendingPdfsRef\.current\) \{\n\s*awaitingPasswordCopies\.delete\(pending\.asset\.uri\);/);
});

/* ── Feature header ──────────────────────────────────────────────────── */

test('capabilities and both statement uploads say which features this build understands', async () => {
  const { api, requests } = transport();
  const advertised = contract.parseImportCapabilities(caps({ csv: { accepts: ['text/csv', XLSX] } }));
  await api.uploadPdfStatement(cfg, { uri: 'blob:x', name: 'a.pdf', file: blob() }, advertised, money);
  await api.uploadCsvStatement(cfg, { uri: 'blob:x', name: 'a.xlsx', file: blob() }, advertised, money);
  await api.getImportCapabilities(cfg).catch(() => {});
  assert.deepEqual(requests.map((request) => [request.method, request.url.replace(cfg.baseUrl, '')]),
    [['POST', '/v1/import/pdf'], ['POST', '/v1/import/csv'], ['GET', '/v1/import/capabilities']]);
  for (const request of requests) {
    assert.equal(request.headers['x-wafra-import-features'], 'xlsx,pdf-error-detail,structured,statement-checks');
  }
});

test('a structured statement goes to the CSV endpoint under its own type, only when the relay lists it', async () => {
  const types = { ofx: 'application/x-ofx', qfx: 'application/vnd.intu.qfx', qif: 'application/qif',
    xml: 'application/xml', sta: 'application/x-mt940', mt940: 'application/x-mt940', 940: 'application/x-mt940' };
  const listed = contract.parseImportCapabilities(caps({ csv: { accepts: ['text/csv', XLSX, ...new Set(Object.values(types))] } }));
  for (const [extension, type] of Object.entries(types)) {
    const { api, requests } = transport();
    // The picker's octet-stream label never decides a structured file's type.
    await api.uploadCsvStatement(cfg, { uri: 'blob:x', name: `statement.${extension}`, mimeType: 'application/octet-stream', file: blob() }, listed, money);
    assert.equal(requests[0].headers['content-type'], type, extension);
    assert.equal(requests[0].url.replace(cfg.baseUrl, ''), '/v1/import/csv');
  }
  const older = contract.parseImportCapabilities(caps({ csv: { accepts: ['text/csv', XLSX] } }));
  const { api, requests } = transport();
  await assert.rejects(api.uploadCsvStatement(cfg, { uri: 'blob:x', name: 'statement.ofx', file: blob() }, older, money),
    (error) => error.code === 'unsupported_file_type');
  assert.equal(requests.length, 0, 'nothing is uploaded to a relay that cannot read it');
});

test('the relay\'s structured-file error codes reach a specific message', () => {
  assert.equal(contract.pdfImportError(400, { error: 'invalid_statement_file' }).code, 'invalid_statement_file');
  assert.equal(contract.pdfImportError(415, { error: 'unsupported_file_type' }).code, 'unsupported_file_type');
  const copy = supplementCopy();
  assert.ok(copy.en.errStatementFile && copy.ar.errStatementFile);
  const screen = read('src/components/supplement-imports.tsx');
  assert.match(screen, /value\.code === 'invalid_statement_file'\) return copy\.errStatementFile/);
});

test('a .pdf is uploaded as a PDF even when the picker calls it octet-stream', () => {
  const screen = read('src/components/supplement-imports.tsx');
  const { CSV_ROUTE_FILE } = transport().api;
  // The screen's routing list is the transport's.
  assert.ok(screen.includes(`const csv = !/\\.pdf$/i.test(asset.name) && (${CSV_ROUTE_FILE.toString()}.test(asset.name)`));
  for (const name of ['a.csv', 'b.TSV', 'c.xlsx', 'd.ofx', 'e.qfx', 'f.qif', 'g.xml', 'h.sta', 'i.mt940', 'j.940']) assert.ok(CSV_ROUTE_FILE.test(name), name);
  for (const name of ['a.pdf', 'b.xls', 'c.txt', 'd.ofx.pdf']) assert.ok(!CSV_ROUTE_FILE.test(name), name);
});

/* ── Stop a running batch ────────────────────────────────────────────── */

function batchHarness({ delays = [], onUpload, upload } = {}) {
  const source = read('src/components/supplement-imports.tsx');
  const helpers = source.slice(source.indexOf('const sleep = '), source.indexOf('/** How long to back off'));
  const body = source.slice(source.indexOf('  const pickAndUpload ='), source.indexOf('  /** One tap:'));
  const noop = () => {};
  const files = [];
  const results = { uploads: [], finishes: [], status: [], fileResults: null, pacing: [], sending: [], failed: 0, shared: [] };
  const assets = ['a.csv', 'b.csv', 'c.csv'].map((name) => ({ uri: `file:///cache/DocumentPicker/${name}`, name, mimeType: 'text/csv' }));
  const accepted = { acceptedRows: 2, rejectedRows: 0, totalRows: 2, cardSignRowsSkipped: 0, alreadyProcessed: false, coverage: null };
  const context = {
    setTimeout, clearTimeout, Date,
    useCallback: (f) => f, pendingPdfs: [], state: { ledgerMoney: money }, dateOrder: null,
    getStateSnapshot: () => ({ hydrated: true, privateMode: false, ledgerMoney: money, transactions: [] }),
    getStateGeneration: () => 1, aliveRef: { current: true }, queuedRetryContextRef: { current: null },
    setCurrencySheetVisible: noop, setError: noop, setStatus: (value) => results.status.push(value), setSummary: noop,
    setFileResults: (value) => { results.fileResults = value; }, setFilesOpen: noop, setBusy: noop, setLiveFiles: noop,
    setProgress: noop, setPendingPdfs: noop, setPdfPassword: noop, setStopping: noop,
    setPacing: (value) => results.pacing.push(value), setSending: (value) => results.sending.push(value),
    stopRequestedRef: { current: false }, stopWakeRef: { current: null }, busy: 'statement',
    statementBatches: { running: 0, copies: new Set() },
    DocumentPicker: { getDocumentAsync: async () => ({ canceled: false, assets }) },
    Platform: { OS: 'ios' },
    File: class { constructor(uri) { this.uri = uri; this.exists = true; files.push(this); } delete() { this.deleted = true; } },
    inFlightPickerUris: new Set(),
    nextUploadDelay: (starts) => delays[starts.length] ?? 0,
    uploadCsvStatement: async (_cfg, asset) => {
      results.uploads.push(asset.name);
      results.shared.push([context.statementBatches.running, [...context.statementBatches.copies]]);
      await onUpload?.(context, asset);
      return upload ? upload(asset) : accepted;
    },
    uploadPdfStatement: async () => { throw new Error('wrong type'); },
    finishQueuedImport: async (...args) => { results.finishes.push(args); },
    recoverQueuedRows: async () => ({ progressStored: true, imported: 0 }),
    newStatementRange: () => null, fileImportedDetail: () => 'read', countPhrase: () => '',
    CloudImportError: contract.CloudImportError, interpolate: (s) => s, errorText: () => 'error',
    failed: () => { results.failed += 1; },
    RATE_LIMIT_RETRY_MS: 61_000,
    copy: { fileFailed: 'failed', fileLocked: 'locked', fileNotTried: 'not sent', batchStopped: 'stopped',
      waitingForLimit: 'waiting', uploadingProgress: 'reading' },
  };
  vm.runInNewContext(ts.transpileModule(`${helpers}\n${body}\nglobalThis.pick = pickAndUpload; globalThis.stop = stopBatch;`, {
    compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.CommonJS },
  }).outputText, context);
  const capabilities = { pdf: { accepts: ['application/pdf'], maxRows: 300 }, csv: { accepts: ['text/csv'], maxRows: 400 } };
  return { context, results, files, run: (incoming) => context.pick(cfg, capabilities, incoming) };
}

test('Stop during an upload lets that file finish, sends no more, files accepted rows and frees every copy', async () => {
  const h = batchHarness({ onUpload: async (context, asset) => { if (asset.name === 'a.csv') context.stop(); } });
  assert.equal(await h.run(), true);
  assert.deepEqual(h.results.uploads, ['a.csv'], 'the request in flight completes; the next files are never sent');
  assert.deepEqual(plain(h.results.fileResults.map((r) => [r.name, r.ok, r.detail])),
    [['a.csv', true, 'read'], ['b.csv', false, 'not sent'], ['c.csv', false, 'not sent']]);
  assert.equal(h.results.finishes.length, 1, 'rows already accepted are still filed');
  assert.equal(h.results.finishes[0][0], 1);
  assert.equal(h.results.finishes[0][1], 2);
  assert.ok(h.files.length === 3 && h.files.every((file) => file.deleted), 'picker cache copies are released');
  assert.equal(h.context.inFlightPickerUris.size, 0);
  assert.equal(h.context.stopRequestedRef.current, false, 'the next batch starts fresh');
  // Every copy of the batch, sent or not, was shared while it ran; none after.
  assert.deepEqual(plain(h.results.shared[0]), [1, assets3()]);
  assert.equal(h.context.statementBatches.running, 0);
  assert.equal(h.context.statementBatches.copies.size, 0);
  // Stop disappears once sending is over: filing always completes.
  assert.equal(h.results.sending[0], true);
  assert.equal(h.results.sending.at(-1), false);
});

/** Wait (up to 5 s of real time, in 5 ms steps) for a condition the code under test sets. */
async function until(condition) {
  const deadline = Date.now() + 5_000;
  while (!condition() && Date.now() < deadline) await new Promise((resolve) => setTimeout(resolve, 5));
}

function assets3() {
  return ['a.csv', 'b.csv', 'c.csv'].map((name) => `file:///cache/DocumentPicker/${name}`);
}

test('Stop during a pacing wait ends the wait at once and marks the rest not sent', async () => {
  const h = batchHarness({ delays: [0, 60_000, 60_000] });
  const running = h.run();
  // Let the first upload finish and the second file's pacing wait begin.
  await until(() => h.results.pacing.includes(true));
  assert.equal(h.results.pacing.at(-1), true, 'the pacing wait is running');
  const stoppedAt = Date.now();
  h.context.stop();
  await running;
  assert.ok(Date.now() - stoppedAt < 1_000, 'a 60 second wait is cancelled immediately');
  assert.deepEqual(h.results.uploads, ['a.csv']);
  assert.deepEqual(plain(h.results.fileResults.map((r) => r.detail)), ['read', 'not sent', 'not sent']);
  assert.equal(h.results.pacing.at(-1), false);
  assert.equal(h.results.finishes.length, 1);
});

test('Stop before any file is accepted says the batch stopped', async () => {
  const h = batchHarness({ delays: [60_000] });
  const running = h.run();
  await until(() => h.results.pacing.includes(true));
  h.context.stop();
  await running;
  assert.deepEqual(h.results.uploads, []);
  assert.equal(h.results.finishes.length, 0);
  assert.equal(h.results.status.at(-1), 'stopped');
  assert.equal(h.results.failed, 0);
});

test('Stop after the only tried file failed reports the failure, not "Stopped"', async () => {
  const h = batchHarness({
    onUpload: async (context) => { context.stop(); },
    upload: () => { throw new contract.CloudImportError('pdf_damaged', 422); },
  });
  await h.run();
  assert.deepEqual(plain(h.results.fileResults.map((r) => r.detail)), ['failed', 'not sent', 'not sent']);
  assert.equal(h.results.failed, 1);
  assert.notEqual(h.results.status.at(-1), 'stopped');
});

test('a handed-over file is the whole batch; a batch that cannot start says so to its caller', async () => {
  const h = batchHarness();
  const incoming = { uri: `${INBOX}/one.csv`, name: 'one.csv' };
  assert.equal(await h.run(incoming), true);
  assert.deepEqual(h.results.uploads, ['one.csv']);
  assert.ok(h.files.length === 1 && h.files[0].deleted, 'the Inbox copy is deleted after the upload');
  h.context.getStateSnapshot = () => ({ hydrated: true, privateMode: true, ledgerMoney: money, transactions: [] });
  assert.equal(await h.run(incoming), false, 'returned before taking the file: the caller deletes it');
});

test('the Stop control is a labelled 44pt+ button that stacks at large text, in both languages', () => {
  const screen = read('src/components/supplement-imports.tsx');
  const control = screen.slice(screen.indexOf('{showStop && ('), screen.indexOf('{reading && liveFiles.length > 1 && ('));
  assert.match(control, /<View style=\{\[styles\.actions, largeText && styles\.actionsStacked\]\}>/);
  assert.match(control, /<EButton[\s\S]*testID="statement-stop"/);
  assert.match(control, /label=\{stopping \? copy\.stoppingBatch : copy\.stopBatch\}/);
  assert.match(control, /accessibilityHint=\{copy\.stopBatchHint\}/);
  assert.match(control, /onPress=\{stopBatch\}/);
  assert.match(control, /reserveLabels=\{\[copy\.stopBatch, copy\.stoppingBatch\]\}/);
  assert.match(screen, /const showStop = reading && sending && \(liveFiles\.length > 1 \|\| pacing\);/);
  // EButton is 56pt (compact 48pt): above the 44pt target.
  assert.match(read('src/components/ui/band/e-button.tsx'), /The plain E button: 56pt tall/);
  const copy = supplementCopy();
  for (const key of ['stopBatch', 'stoppingBatch', 'stopBatchHint', 'batchStopped']) {
    assert.ok(copy.en[key] && copy.ar[key], key);
    assert.notEqual(copy.en[key], copy.ar[key]);
  }
});
