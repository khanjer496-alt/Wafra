// Excel workbooks and PDF failure modes, at the module boundary.
//
// Every fixture is built in this process (test/fixtures.cjs): workbooks as
// real ZIPs with stored and deflated entries, PDFs with a real RC4 Standard
// security handler. Nothing here is mocked; the parsers under test are the
// shipping imports.ts and xlsx-records.ts bundled by esbuild.
const {
  extractPdfStatementRows,
  parseStatementCsv,
  parseStatementXlsx,
  pdfOpenFailure,
} = require('../.test-build/imports.cjs');
const {
  isDateFormatCode,
  plainDecimal,
  serialToIsoDate,
  xlsxSheetRecords,
} = require('../.test-build/xlsx-records.cjs');
const { buildZip, buildXlsx, textPdf } = require('./fixtures.cjs');

let passed = 0;
let failed = 0;
function ok(name, condition, detail = '') {
  if (condition) {
    passed += 1;
    console.log(`✓ ${name}`);
  } else {
    failed += 1;
    console.log(`✗ ${name}${detail ? ` · ${detail}` : ''}`);
  }
}

const LIMITS = { maxRecords: 211, maxColumns: 64, maxRecordChars: 8192 };
const withoutRaw = (rows) => rows.map(({ raw, ...row }) => row);
const same = (a, b) => JSON.stringify(a) === JSON.stringify(b);

async function rejects(promise) {
  try {
    await promise;
    return null;
  } catch (error) {
    return error && (error.code ?? error.message);
  }
}

// 2026-07-01 is serial 46204 in the 1900 system and 44742 in the 1904 one.
const JULY_1 = '46204';

(async () => {
  /* ─────────────────────────── cell conversion ─────────────────────────── */

  ok('serial dates convert in the 1900 system, across the phantom 29 Feb 1900',
    serialToIsoDate(1, false) === '1900-01-01' && serialToIsoDate(59, false) === '1900-02-28' &&
      serialToIsoDate(60, false) === null && serialToIsoDate(61, false) === '1900-03-01' &&
      serialToIsoDate(45000, false) === '2023-03-15' && serialToIsoDate(46204, false) === '2026-07-01' &&
      serialToIsoDate(46204.75, false) === '2026-07-01' && serialToIsoDate(0, false) === null);
  ok('serial dates convert in the 1904 system',
    serialToIsoDate(0, true) === '1904-01-01' && serialToIsoDate(44742, true) === '2026-07-01');
  ok('stored numbers keep every digit, with no float and no exponent',
    plainDecimal('1234.5') === '1234.5' && plainDecimal('1234.50') === '1234.50' &&
      plainDecimal('-0.75') === '-0.75' && plainDecimal('1.5E+2') === '150' &&
      plainDecimal('1.23E-2') === '0.0123' && plainDecimal('-4.5e1') === '-45' &&
      plainDecimal('123456789012345.67') === '123456789012345.67' && plainDecimal('+7') === '7' &&
      plainDecimal('0.1000000000000000055511151231257827') === '0.1000000000000000055511151231257827');
  ok('date number formats are told apart from money, time and quoted text',
    isDateFormatCode('dd/mm/yyyy') && isDateFormatCode('[$-409]mmmm d, yyyy') &&
      isDateFormatCode('mmm-yy') && isDateFormatCode('yyyy-mm-dd hh:mm') && isDateFormatCode('mmm') &&
      !isDateFormatCode('h:mm') && !isDateFormatCode('[h]:mm:ss') && !isDateFormatCode('mm:ss') &&
      !isDateFormatCode('#,##0.00 "dmy"') && !isDateFormatCode('[Red]-#,##0.00') &&
      !isDateFormatCode('General') && !isDateFormatCode('0.00E+00') && !isDateFormatCode('#,##0.00\\ "AED"'));

  /* ─────────────────────────── worksheet rows ─────────────────────────── */

  const statementRows = [
    ['Date', 'Description', 'Debit', 'Credit'],
    [{ n: JULY_1, style: 'date' }, 'مطعم البيك', { n: '1234.5', style: 'money' }, null],
    [{ n: '46205', style: 'customDate' }, { inline: ['Salary ', 'July'] }, null, { n: '18500.00', style: 'money' }],
    [{ n: '46206.5', style: 'dateTime' }, { inline: 'Taxi & Co <ride>' }, { n: '1.5E+1' }, null],
    [{ n: '46207', style: 'date' }, 'Refund', { n: '-20.25' }, null],
  ];
  for (const method of [0, 8]) {
    const records = await xlsxSheetRecords(buildXlsx(statementRows, { method }), LIMITS);
    ok(`workbook rows read the same from ${method === 0 ? 'stored' : 'deflated'} entries`, same(records, [
      ['Date', 'Description', 'Debit', 'Credit'],
      ['2026-07-01', 'مطعم البيك', '1234.5', ''],
      ['2026-07-02', 'Salary July', '', '18500.00'],
      ['2026-07-03', 'Taxi & Co <ride>', '15', ''],
      ['2026-07-04', 'Refund', '-20.25', ''],
    ]), JSON.stringify(records));
  }
  const mixed = await xlsxSheetRecords(buildXlsx(statementRows, { method: (_, index) => index % 2 ? 0 : 8 }), LIMITS);
  ok('a workbook mixing stored and deflated entries reads the same', mixed[1][1] === 'مطعم البيك' && mixed.length === 5);

  const sparse = await xlsxSheetRecords(buildXlsx([
    { r: 3, cells: ['Date', null, 'Description', 'Debit', 'Credit'] },
    { r: 7, cells: [{ n: JULY_1, style: 'date' }, null, 'Shop', null, { n: '5' }] },
    { r: 8, cells: [] },
    { r: 9, cells: [null, null, null, null, null, null, { s: '  note  ' }] },
  ]), LIMITS);
  ok('cell references place sparse cells; empty rows vanish; every row is the sheet width', same(sparse, [
    ['Date', '', 'Description', 'Debit', 'Credit', '', ''],
    ['2026-07-01', '', 'Shop', '', '5', '', ''],
    ['', '', '', '', '', '', 'note'],
  ]), JSON.stringify(sparse));

  const kinds = await xlsxSheetRecords(buildXlsx([
    [{ b: true }, { b: false }, { n: '46204', style: 'time' }, { n: '46204', style: 'quotedMoney' }, { n: '46204', style: 'general' }],
  ], { date1904: false }), LIMITS);
  ok('booleans print as TRUE/FALSE; time, money and general styles keep the stored number',
    same(kinds, [['TRUE', 'FALSE', '46204', '46204', '46204']]), JSON.stringify(kinds));
  const in1904 = await xlsxSheetRecords(buildXlsx([[{ n: '44742', style: 'date' }]], { date1904: true }), LIMITS);
  ok('a 1904-system workbook dates from 1904', in1904[0][0] === '2026-07-01', JSON.stringify(in1904));
  const hidden = await xlsxSheetRecords(buildXlsx([['visible sheet']], { hiddenFirst: true }), LIMITS);
  ok('the first VISIBLE worksheet is read, not a hidden one or a later tab', hidden[0][0] === 'visible sheet');

  /* ─────────────────────── same rows as the CSV ─────────────────────── */

  const csvText = [
    'Date,Description,Debit,Credit',
    '2026-07-01,مطعم البيك,1234.5,',
    '2026-07-02,Salary July,,18500.00',
    '2026-07-03,Taxi & Co <ride>,15,',
    '2026-07-04,Refund,-20.25,',
  ].join('\n');
  for (const currency of ['AED', 'USD']) {
    const fromCsv = parseStatementCsv(csvText, currency, 200, null);
    const fromXlsx = await parseStatementXlsx(buildXlsx(statementRows), currency, 200, null);
    ok(`${currency}: an .xlsx statement parses to exactly the rows of its CSV export`,
      same(withoutRaw(fromXlsx.rows), withoutRaw(fromCsv.rows)) && fromXlsx.totalRows === fromCsv.totalRows &&
        fromXlsx.rejectedRows === fromCsv.rejectedRows && fromXlsx.rows.length === 3 && fromXlsx.rejectedRows === 1,
      JSON.stringify({ xlsx: withoutRaw(fromXlsx.rows), csv: withoutRaw(fromCsv.rows), rejected: fromXlsx.rejectedRows }));
    ok(`${currency}: money arrives in exact minor units with direction from the columns`,
      fromXlsx.rows[0].amountFils === 123450 && fromXlsx.rows[0].type === 'expense' &&
        fromXlsx.rows[1].amountFils === 1850000 && fromXlsx.rows[1].type === 'income' &&
        fromXlsx.rows[0].merchant === 'مطعم البيك' && fromXlsx.rows[0].date === '2026-07-01');
  }
  const signed = await parseStatementXlsx(buildXlsx([
    ['Date', 'Description', 'Amount'],
    [{ n: JULY_1, style: 'date' }, 'Coffee', { n: '-12.75' }],
    [{ n: '46205', style: 'date' }, 'Refund', { n: '4.5' }],
  ]), 'AED', 200, null);
  ok('a signed Amount column keeps negative amounts as debits',
    signed.rows.length === 2 && signed.rows[0].type === 'expense' && signed.rows[0].amountFils === 1275 &&
      signed.rows[1].type === 'income' && signed.rows[1].amountFils === 450, JSON.stringify(withoutRaw(signed.rows)));
  ok('an Excel text date keeps the CSV date rules (05/07 is ambiguous with no country)',
    (await parseStatementXlsx(buildXlsx([
      ['Date', 'Description', 'Debit', 'Credit'], ['05/07/2026', 'Shop', { n: '5' }, null],
    ]), 'USD', 200, null)).ambiguousDateRows === 1);
  ok('the same refusals as CSV: no explicit direction is unsupported_statement_format',
    await rejects(parseStatementXlsx(buildXlsx([['Date', 'Description'], [{ n: JULY_1, style: 'date' }, 'x']]), 'AED'))
      === 'unsupported_statement_format');
  const tooMany = buildXlsx([['Date', 'Description', 'Debit', 'Credit'],
    ...Array.from({ length: 201 }, (_, i) => [{ n: String(46000 + i), style: 'date' }, `Row ${i}`, { n: '1' }, null])]);
  ok('more data rows than the ceiling is too_many_rows', await rejects(parseStatementXlsx(tooMany, 'AED', 200)) === 'too_many_rows');
  ok('a sheet wider than any statement header is unsupported_statement_format',
    await rejects(parseStatementXlsx(buildXlsx([{ r: 1, cells: [...Array(70).fill(null), 'far'] }]), 'AED'))
      === 'unsupported_statement_format');

  /* ─────────────────────────── refusals ─────────────────────────── */

  const refuse = async (name, bytes) => {
    const code = await rejects(parseStatementXlsx(bytes, 'AED'));
    ok(`refused as invalid_xlsx: ${name}`, code === 'invalid_xlsx', String(code));
  };
  await refuse('not a ZIP at all', new Uint8Array(Buffer.from('Date,Description\n1,2')));
  await refuse('an encrypted Office file (CFB container)',
    new Uint8Array(Buffer.concat([Buffer.from('d0cf11e0a1b11ae1', 'hex'), Buffer.alloc(600)])));
  await refuse('a ZIP with no workbook', buildZip([{ name: 'hello.txt', data: 'hi' }]));
  await refuse('a truncated ZIP', buildXlsx(statementRows).slice(0, 400));
  await refuse('a traditionally encrypted entry', buildZip([{ name: 'xl/workbook.xml', data: '<x/>', flags: 1 }]));
  await refuse('a ZIP64 entry', buildZip([{ name: 'xl/workbook.xml', data: '<x/>', zip64: true }]));
  await refuse('an unsupported compression method',
    (() => {
      const bytes = buildZip([{ name: 'xl/workbook.xml', data: '<x/>', method: 0 }]);
      const buffer = Buffer.from(bytes);
      // Patch both headers' method field to 12 (bzip2).
      buffer.writeUInt16LE(12, 8);
      const central = buffer.indexOf(Buffer.from([0x50, 0x4b, 0x01, 0x02]));
      buffer.writeUInt16LE(12, central + 10);
      return new Uint8Array(buffer);
    })());
  await refuse('a declared size beyond the 20 MB inflate budget (zip bomb)',
    buildXlsx(statementRows, { extraEntries: [{ name: 'xl/media/bomb.bin', data: Buffer.alloc(21 * 1024 * 1024) }] }));
  // No _rels/.rels, so the conventional xl/workbook.xml is read — and it
  // inflates far past the 1 KB its directory entry declares.
  await refuse('an entry that inflates past its declared size (lying zip bomb)', buildZip([
    { name: 'xl/workbook.xml', data: Buffer.alloc(5 * 1024 * 1024, 0x20), declaredSize: 1024 },
  ]));
  await refuse('more than 2,000 entries',
    buildZip(Array.from({ length: 2001 }, (_, i) => ({ name: `f${i}.txt`, data: '', method: 0 }))));
  await refuse('a CRC mismatch (corrupted entry)', (() => {
    const buffer = Buffer.from(buildXlsx(statementRows, { method: 0 }));
    const at = buffer.indexOf(Buffer.from('mm/yyyy'));
    buffer[at] = 0x4e;
    return new Uint8Array(buffer);
  })());
  await refuse('a DOCTYPE with an entity (billion laughs)', buildZip([
    { name: 'xl/workbook.xml', data: '<?xml version="1.0"?><!DOCTYPE lolz [<!ENTITY lol "lol">]><workbook><sheets/></workbook>' },
    { name: 'xl/_rels/workbook.xml.rels', data: '<Relationships/>' },
  ]));
  await refuse('an undefined entity reference', buildZip([
    { name: 'xl/workbook.xml', data: '<workbook><sheets><sheet name="&nbsp;" r:id="rId1"/></sheets></workbook>' },
    { name: 'xl/_rels/workbook.xml.rels', data: '<Relationships/>' },
  ]));
  await refuse('a shared-string index past the table', buildZip([
    { name: 'xl/workbook.xml', data: '<workbook xmlns:r="r"><sheets><sheet name="S" sheetId="1" r:id="rId1"/></sheets></workbook>' },
    { name: 'xl/_rels/workbook.xml.rels', data: '<Relationships><Relationship Id="rId1" Type="x/worksheet" Target="s.xml"/><Relationship Id="rId2" Type="x/sharedStrings" Target="ss.xml"/></Relationships>' },
    { name: 'xl/ss.xml', data: '<sst><si><t>only</t></si></sst>' },
    { name: 'xl/s.xml', data: '<worksheet><sheetData><row r="1"><c r="A1" t="s"><v>5</v></c></row></sheetData></worksheet>' },
  ]));
  await refuse('a cell reference outside its row', buildZip([
    { name: 'xl/workbook.xml', data: '<workbook xmlns:r="r"><sheets><sheet name="S" sheetId="1" r:id="rId1"/></sheets></workbook>' },
    { name: 'xl/_rels/workbook.xml.rels', data: '<Relationships><Relationship Id="rId1" Type="x/worksheet" Target="s.xml"/></Relationships>' },
    { name: 'xl/s.xml', data: '<worksheet><sheetData><row r="1"><c r="A2"><v>5</v></c></row></sheetData></worksheet>' },
  ]));
  await refuse('trailing bytes after the end-of-directory record',
    buildZip([{ name: 'a.txt', data: 'x' }], { trailing: Buffer.from('junk') }));

  // Without a _rels/.rels the conventional workbook path is used, and a
  // prefixed SpreadsheetML (x:) sheet reads like the default namespace.
  const minimal = buildZip([
    { name: 'xl/workbook.xml', data: '<x:workbook xmlns:x="m" xmlns:r="r"><x:sheets><x:sheet name="S" sheetId="1" r:id="rId1"/></x:sheets></x:workbook>' },
    { name: 'xl/_rels/workbook.xml.rels', data: '<Relationships><Relationship Id="rId1" Type="x/worksheet" Target="worksheets/s.xml"/></Relationships>' },
    { name: 'xl/worksheets/s.xml', data: '<x:worksheet xmlns:x="m"><x:sheetData><x:row r="1"><x:c r="B1" t="inlineStr"><x:is><x:t>&#1605;&#x631;&amp;</x:t></x:is></x:c><x:c r="C1"><x:v>2</x:v></x:c></x:row></x:sheetData></x:worksheet>' },
  ], {});
  const minimalRows = await xlsxSheetRecords(minimal, LIMITS);
  ok('a minimal prefixed workbook with character references reads correctly',
    same(minimalRows, [['', 'مر&', '2']]), JSON.stringify(minimalRows));

  /* ──────────────────── memory bounds (constrained heap) ──────────────────── */

  // Each hostile workbook is read in a child process with a 96 MB heap: an
  // unbounded string build crashes it (non-zero exit) instead of passing.
  const { spawnSync } = require('node:child_process');
  const probe = require('node:path').join(__dirname, 'xlsx-memory-probe.cjs');
  for (const kind of [
    'entities-4m', 'entity-attribute-4m', 'digits-19m', 'empty-shared-strings-4m', 'entity-shared-strings',
    'entities-in-budget', 'attribute-in-budget', 'empty-shared-strings-in-budget', 'shared-string-count',
    'shared-string-chars', 'rich-runs', 'long-cell', 'many-attributes', 'empty-rows',
  ]) {
    const run = spawnSync(process.execPath, ['--max-old-space-size=96', probe, kind], { encoding: 'utf8', timeout: 60_000 });
    ok(`bounded under a 96 MB heap, refused as invalid_xlsx: ${kind}`,
      run.status === 0 && run.stdout.trim() === 'invalid_xlsx',
      JSON.stringify({ status: run.status, signal: run.signal, out: run.stdout.trim(), err: run.stderr.slice(-200) }));
  }
  const unreadMedia = await xlsxSheetRecords(buildXlsx([['kept']], {
    extraEntries: [{ name: 'xl/media/large.bin', data: Buffer.alloc(6 * 1024 * 1024) }],
  }), LIMITS);
  ok('a large entry the reader never opens does not count against the inflate budget', unreadMedia[0][0] === 'kept');

  /* ──────────────────────────── PDF failures ──────────────────────────── */

  const statementLine = ['2026-01-03 SALIK TOLL GATE 4.00 DR'];
  const open = async (bytes, password) => {
    try {
      return { result: await extractPdfStatementRows(bytes, 'AED', password) };
    } catch (error) {
      return { error };
    }
  };
  const plain = await open(textPdf(statementLine));
  ok('a text PDF reports its text layer', plain.result?.textLayer === true && plain.result.rows.length === 1);
  const blank = await open(textPdf([]));
  ok('a PDF with no text on any page opens and reports no text layer (a scan)',
    blank.result?.textLayer === false && blank.result.rows.length === 0);

  const good = textPdf(statementLine);
  const truncated = await open(good.slice(0, Math.floor(good.length / 2)));
  ok('a truncated PDF is pdf_damaged', pdfOpenFailure(truncated.error) === 'pdf_damaged',
    JSON.stringify({ name: truncated.error?.name, details: truncated.error?.details }));
  const garbage = await open(new Uint8Array(Buffer.from(`%PDF-1.4\n${'garbage '.repeat(100)}`)));
  ok('a PDF header over garbage is pdf_damaged', pdfOpenFailure(garbage.error) === 'pdf_damaged');
  const corrupt = Buffer.from(textPdf(statementLine));
  corrupt.fill(0x7f, 200, 260);
  const corrupted = await open(new Uint8Array(corrupt));
  ok('an object cut off mid-dictionary is pdf_damaged', pdfOpenFailure(corrupted.error) === 'pdf_damaged',
    JSON.stringify({ name: corrupted.error?.name, details: corrupted.error?.details }));
  const certificate = await open(textPdf(statementLine, {
    encrypt: '<< /Filter /Adobe.PubSec /V 4 /R 4 /SubFilter /adbe.pkcs7.s5 >>',
  }));
  ok('a certificate-encrypted PDF is pdf_encryption_unsupported',
    pdfOpenFailure(certificate.error) === 'pdf_encryption_unsupported');
  const version3 = await open(textPdf(statementLine, {
    encrypt: '<< /Filter /Standard /V 3 /R 3 /O <00> /U <00> /P -4 >>',
  }));
  ok('an unimplemented Standard algorithm version is pdf_encryption_unsupported',
    pdfOpenFailure(version3.error) === 'pdf_encryption_unsupported');
  ok('anything pdf.js does not name precisely is left to the generic code',
    pdfOpenFailure(new Error('boom')) === null && pdfOpenFailure({ name: 'UnknownErrorException', details: 'TypeError: x' }) === null &&
      pdfOpenFailure(null) === null);

  /* ─────────────────────────── PDF passwords ─────────────────────────── */

  const locked = () => textPdf(statementLine, { userPassword: Buffer.from('secret') });
  const noPassword = await open(locked());
  const wrongPassword = await open(locked(), 'nope');
  const rightPassword = await open(locked(), 'secret');
  ok('an RC4-encrypted PDF asks for, refuses, then accepts its password',
    noPassword.error?.name === 'PasswordException' && noPassword.error.code === 1 &&
      wrongPassword.error?.code === 2 && rightPassword.result?.rows.length === 1);
  const arabic = 'كلمة سر';
  const arabicLocked = () => textPdf(statementLine, { userPassword: Buffer.from(arabic, 'utf8') });
  const arabicOpened = await open(arabicLocked(), arabic);
  ok('an Arabic password opens a revision-2 PDF that stores it as UTF-8 bytes',
    arabicOpened.result?.rows.length === 1, String(arabicOpened.error?.message));
  const arabicWrong = await open(arabicLocked(), 'كلمة خطأ');
  ok('a wrong Arabic password is still incorrect after the UTF-8 retry', arabicWrong.error?.code === 2);
  const latinLocked = textPdf(statementLine, { userPassword: Buffer.from('café', 'latin1') });
  ok('a Latin-1 password opens a PDF that stores it as single bytes',
    (await open(latinLocked, 'café')).result?.rows.length === 1);
  const spaced = textPdf(statementLine, { userPassword: Buffer.from('  pass word  ') });
  ok('leading and trailing spaces are part of the password',
    (await open(spaced, '  pass word  ')).result?.rows.length === 1 &&
      (await open(textPdf(statementLine, { userPassword: Buffer.from('  pass word  ') }), 'pass word')).error?.code === 2);

  console.log(`\n${passed} passed, ${failed} failed`);
  if (failed > 0) process.exit(1);
})().catch((error) => {
  console.error(error);
  process.exit(1);
});
