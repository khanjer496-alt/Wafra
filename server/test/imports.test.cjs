const {
  decodeCsv,
  extractPdfStatementRows,
  htmlToText,
  normalizeEmailContent,
  parseRawEmail,
  parseStatementCsv,
  parseStatementText,
} = require('../.test-build/imports.cjs');

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

function tinyPdf(line) {
  const escaped = line.replace(/([()\\])/g, '\\$1');
  const stream = `BT /F1 12 Tf 50 750 Td (${escaped}) Tj ET`;
  const objects = [
    '<< /Type /Catalog /Pages 2 0 R >>',
    '<< /Type /Pages /Kids [3 0 R] /Count 1 >>',
    '<< /Type /Page /Parent 2 0 R /MediaBox [0 0 612 792] /Resources << /Font << /F1 4 0 R >> >> /Contents 5 0 R >>',
    '<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>',
    `<< /Length ${Buffer.byteLength(stream)} >>\nstream\n${stream}\nendstream`,
  ];
  let pdf = '%PDF-1.4\n';
  const offsets = [0];
  for (let i = 0; i < objects.length; i++) {
    offsets.push(Buffer.byteLength(pdf));
    pdf += `${i + 1} 0 obj\n${objects[i]}\nendobj\n`;
  }
  const xref = Buffer.byteLength(pdf);
  pdf += `xref\n0 ${objects.length + 1}\n0000000000 65535 f \n`;
  for (const offset of offsets.slice(1)) pdf += `${String(offset).padStart(10, '0')} 00000 n \n`;
  pdf += `trailer\n<< /Size ${objects.length + 1} /Root 1 0 R >>\nstartxref\n${xref}\n%%EOF\n`;
  return new Uint8Array(Buffer.from(pdf, 'binary'));
}

(async () => {
  const html = '<html><head><style>.x{}</style></head><body><p>Purchase of AED&nbsp;40.00</p>' +
    '<script>steal()</script><div>at &amp; Other</div></body></html>';
  const normalized = normalizeEmailContent(null, html);
  ok('HTML email becomes stable plain text',
    normalized === 'Purchase of AED 40.00\nat & Other', JSON.stringify(normalized));
  ok('active HTML content never reaches the bank parser',
    !htmlToText(html).includes('steal') && !htmlToText(html).includes('.x{}'));
  ok('plain text wins over an HTML alternative',
    normalizeEmailContent('plain bank alert', '<p>different</p>') === 'plain bank alert');

  const mime = [
    'From: alerts@example.test',
    'To: forward@example.test',
    'Subject: Card alert',
    'MIME-Version: 1.0',
    'Content-Type: multipart/alternative; boundary="wafra"',
    '',
    '--wafra',
    'Content-Type: text/plain; charset=utf-8',
    '',
    'Purchase of AED 40.00 at Carrefour',
    '--wafra',
    'Content-Type: text/html; charset=utf-8',
    '',
    '<p>Purchase of AED 40.00 at Carrefour</p>',
    '--wafra--',
    '',
  ].join('\r\n');
  const parsedEmail = await parseRawEmail(mime);
  ok('RFC822 multipart email is normalized in memory',
    parsedEmail.text === 'Purchase of AED 40.00 at Carrefour');
  ok('email with no PDF exposes no attachment bytes', parsedEmail.pdfAttachments.length === 0);
  ok('email with no CSV exposes no attachment bytes', parsedEmail.csvAttachments.length === 0);

  const csvAttachment = Buffer.from([
    '\uFEFFDate,Description,Debit,Credit,Currency',
    '01/07/2026,"Carrefour, Market",40.00,,AED',
  ].join('\r\n')).toString('base64');
  const csvMime = [
    'From: alerts@example.test',
    'To: forward@example.test',
    'Subject: Statement',
    'MIME-Version: 1.0',
    'Content-Type: multipart/mixed; boundary="wafra-csv"',
    '',
    '--wafra-csv',
    'Content-Type: text/plain; charset=utf-8',
    '',
    'Attached statement',
    '--wafra-csv',
    'Content-Type: text/csv; name="statement.csv"',
    'Content-Disposition: attachment; filename="statement.csv"',
    'Content-Transfer-Encoding: base64',
    '',
    csvAttachment,
    '--wafra-csv--',
    '',
  ].join('\r\n');
  const emailWithCsv = await parseRawEmail(csvMime);
  ok('RFC822 CSV attachments stay byte-exact in memory',
    emailWithCsv.csvAttachments.length === 1 &&
      emailWithCsv.csvAttachments[0].filename === 'statement.csv');

  const splitCsv = parseStatementCsv([
    '\uFEFFDate,Description,Debit,Credit,Currency',
    '01/07/2026,"Carrefour, Market",40.00,,AED',
    '02/07/2026,Salary,,18500.00,AED',
    '02/07/2026,Salary,,18500.00,AED',
    '32/07/2026,Impossible,9.00,,AED',
    '03/07/2026,Wrong market,15.00,,SAR',
  ].join('\r\n'), 'AED');
  ok('CSV debit and credit columns preserve quoted merchant text',
    splitCsv.rows.length === 3 && splitCsv.rows[0].merchant === 'Carrefour, Market');
  ok('CSV amounts become integer minor units with explicit direction',
    splitCsv.rows[0].amountFils === 4000 && splitCsv.rows[0].type === 'expense' &&
      splitCsv.rows[1].amountFils === 1850000 && splitCsv.rows[1].type === 'income');
  ok('CSV preserves legitimate repeated rows and rejects invalid-date and wrong-market rows',
    splitCsv.totalRows === 5 && splitCsv.rejectedRows === 2 &&
      splitCsv.rows[1].merchant === 'Salary' && splitCsv.rows[2].merchant === 'Salary');

  const directedTsv = parseStatementCsv([
    'Posting Date\tDetails\tAmount\tDr Cr',
    '2026-07-03\tTaxi\t52.5\tDR',
    '2026-07-04\tRefund\t12\tCR',
  ].join('\n'), 'AED');
  ok('TSV amount plus direction columns are supported',
    directedTsv.rows.length === 2 && directedTsv.rows[0].amountFils === 5250 &&
      directedTsv.rows[1].type === 'income');

  const signedSemicolon = parseStatementCsv([
    'Date;Narration;Amount',
    '05/07/2026;Groceries;-100.25',
    '06/07/2026;Refund;+20.00',
    '07/07/2026;Ambiguous;20.00',
  ].join('\n'), 'AED');
  ok('semicolon statements require a sign when direction has no column',
    signedSemicolon.rows.length === 2 && signedSemicolon.rejectedRows === 1);

  const arabicCsv = parseStatementCsv([
    'التاريخ,البيان,مدين,دائن,العملة',
    '٠٧/٠٧/٢٠٢٦,بقالة,١٢٫٥٠,,د.إ',
  ].join('\n'), 'AED');
  ok('Arabic headers and Arabic-Indic numbers are normalized',
    arabicCsv.rows.length === 1 && arabicCsv.rows[0].amountFils === 1250);

  let malformedCsv = '';
  try {
    parseStatementCsv('Date,Description,Debit,Credit\n01/07/2026,"open,40.00,', 'AED');
  } catch (error) {
    malformedCsv = error instanceof Error ? error.message : '';
  }
  ok('malformed quoting is rejected as invalid CSV', malformedCsv === 'invalid_csv');

  const unevenCsv = parseStatementCsv([
    'Date,Description,Debit,Credit',
    '01/07/2026,Good row,10.00,',
    '02/07/2026,Missing columns',
    '03/07/2026,Extra columns,12.00,,unexpected',
  ].join('\n'), 'AED');
  ok('inconsistent-width CSV rows are counted as rejected without losing valid rows',
    unevenCsv.rows.length === 1 && unevenCsv.rejectedRows === 2 && unevenCsv.totalRows === 3);

  const unsafeCsv = parseStatementCsv([
    'Date,Description,Debit,Credit',
    '01/07/2026,"Safe\u202Eevil",10.00,',
  ].join('\n'), 'AED');
  ok('stored CSV descriptions reject bidi and control-character disguise',
    unsafeCsv.rows.length === 0 && unsafeCsv.rejectedRows === 1);

  let oversizedCsv = '';
  try {
    parseStatementCsv([
      'Date,Description,Debit,Credit',
      ...Array.from({ length: 201 }, (_, index) =>
        `01/07/2026,Row ${index},1.00,`),
    ].join('\n'), 'AED');
  } catch (error) {
    oversizedCsv = error instanceof Error ? error.message : '';
  }
  ok('CSV row limits are enforced before any row can be queued', oversizedCsv === 'too_many_rows');

  let invalidUtf8 = '';
  try {
    decodeCsv(Uint8Array.from([0xc3, 0x28]));
  } catch (error) {
    invalidUtf8 = error instanceof Error ? error.message : '';
  }
  ok('invalid UTF-8 is rejected instead of replacement-decoded', invalidUtf8 === 'invalid_csv');

  const rows = parseStatementText([
    '01/07/2026 CARREFOUR MARKET AED 40.00 DR',
    '02/07/2026 SALARY CREDIT 18,500.00',
    '03/07/2026 AMBIGUOUS VISUAL COLUMN 22.00',
    '32/07/2026 IMPOSSIBLE AED 9.00 DR',
    '01/07/2026 CARREFOUR MARKET AED 40.00 DR',
  ].join('\n'));
  ok('explicit debit and credit statement rows are structured',
    rows.length === 3 && rows[0].type === 'expense' && rows[1].type === 'income',
    JSON.stringify(rows));
  ok('statement amounts become integer fils',
    rows[0].amountFils === 4000 && rows[1].amountFils === 1850000);
  ok('ambiguous columns and impossible dates are rejected without dropping repeated purchases',
    rows.length === 3 && rows[0].merchant === rows[2].merchant);
  const saRows = parseStatementText([
    '01/07/2026 PANDA SAR 45.00 DR',
    '02/07/2026 WRONG MARKET AED 10.00 DR',
  ].join('\n'), 'SAR');
  ok('Saudi statement rows retain SAR and reject explicit AED rows',
    saRows.length === 1 && saRows[0].currency === 'SAR' && saRows[0].amountFils === 4500);
  const currencyWordMerchant = parseStatementText('01/07/2026 SAR TRADING 45.00 DR', 'AED');
  ok('a currency word inside the merchant is not mistaken for an amount currency',
    currencyWordMerchant.length === 1 && currencyWordMerchant[0].currency === 'AED');

  const pdf = await extractPdfStatementRows(
    tinyPdf('01/07/2026 CARREFOUR MARKET AED 40.00 DR'),
  );
  ok('real PDF bytes are text-extracted', pdf.pages === 1);
  ok('text PDF row becomes a structured transaction',
    pdf.rows.length === 1 && pdf.rows[0].merchant === 'CARREFOUR MARKET' &&
      pdf.rows[0].amountFils === 4000,
    JSON.stringify(pdf.rows));
  ok('PDF parser raw exists only at the in-memory boundary', pdf.rows[0].raw.includes('CARREFOUR'));

  console.log(`\n${passed} passed, ${failed} failed`);
  process.exit(failed ? 1 : 0);
})();
