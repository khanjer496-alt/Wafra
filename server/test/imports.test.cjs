const {
  decodeCsv,
  extractPdfStatementRows,
  htmlToText,
  normalizeEmailContent,
  parseRawEmail,
  parseStatementCsv,
  parseStatementLines,
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

/**
 * A single page at PDF's maximum box holding many full-width lines. pdf.js only
 * extracts glyphs that land inside the page box, so tinyPdf's letter-size page
 * can never carry enough text to trip the extraction budget; this one can.
 */
function wideTextPdf(lines) {
  const escape = (line) => line.replace(/([()\\])/g, '\\$1');
  const stream = `BT /F1 12 Tf 50 14300 Td ${
    lines.map((line, i) => `${i ? '0 -20 Td ' : ''}(${escape(line)}) Tj `).join('')
  }ET`;
  const objects = [
    '<< /Type /Catalog /Pages 2 0 R >>',
    '<< /Type /Pages /Kids [3 0 R] /Count 1 >>',
    '<< /Type /Page /Parent 2 0 R /MediaBox [0 0 14400 14400] /Resources << /Font << /F1 4 0 R >> >> /Contents 5 0 R >>',
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

/** Actual multipage PDFs exercise extraction order and page text coverage. */
function pagedPdf(pages) {
  const objects = ['', '', '<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>'];
  const kids = [];
  for (const lines of pages) {
    const pageId = objects.length + 1;
    const streamId = pageId + 1;
    kids.push(`${pageId} 0 R`);
    const stream = `BT /F1 12 Tf 50 750 Td ${lines.map((line, index) =>
      `${index ? '0 -20 Td ' : ''}(${line.replace(/([()\\])/g, '\\$1')}) Tj`).join(' ')} ET`;
    objects.push(`<< /Type /Page /Parent 2 0 R /MediaBox [0 0 612 792] /Resources << /Font << /F1 3 0 R >> >> /Contents ${streamId} 0 R >>`);
    objects.push(`<< /Length ${Buffer.byteLength(stream)} >>\nstream\n${stream}\nendstream`);
  }
  objects[0] = '<< /Type /Catalog /Pages 2 0 R >>';
  objects[1] = `<< /Type /Pages /Kids [${kids.join(' ')}] /Count ${kids.length} >>`;
  let pdf = '%PDF-1.4\n';
  const offsets = [0];
  objects.forEach((object, index) => {
    offsets.push(Buffer.byteLength(pdf));
    pdf += `${index + 1} 0 obj\n${object}\nendobj\n`;
  });
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
  ok('CSV rows use the same merchant categories as bank alerts',
    splitCsv.rows[0].categoryGuess === 'groceries' &&
      splitCsv.rows[0].categoryDeliberate === true &&
      splitCsv.rows[1].categoryGuess === 'salary' &&
      splitCsv.rows[1].categoryDeliberate === true,
    JSON.stringify(splitCsv.rows.map((row) => ({
      merchant: row.merchant,
      category: row.categoryGuess,
      deliberate: row.categoryDeliberate,
    }))));
  ok('CSV preserves legitimate repeated rows and rejects invalid-date and wrong-market rows',
    splitCsv.totalRows === 5 && splitCsv.rejectedRows === 2 &&
      splitCsv.rows[1].merchant === 'Salary' && splitCsv.rows[2].merchant === 'Salary');

  const globalCsv = [
    ['USD', '24.90', 2490],
    ['EUR', '12.34', 1234],
    ['JPY', '2400', 2400],
    ['KWD', '12.345', 12345],
  ];
  for (const [currency, amount, minor] of globalCsv) {
    const parsedGlobal = parseStatementCsv([
      'Date,Description,Debit,Credit,Currency',
      // 13/07: these assert minor units, not dates — an ambiguous date is
      // refused outside day-first ledgers (see the date-order tests below).
      `13/07/2026,GLOBAL SHOP,${amount},,${currency}`,
    ].join('\n'), currency);
    ok(`global CSV keeps ${currency} in its exact ISO minor units`,
      parsedGlobal.rows.length === 1 && parsedGlobal.rejectedRows === 0 &&
        parsedGlobal.rows[0].currency === currency && parsedGlobal.rows[0].amountFils === minor,
      JSON.stringify(parsedGlobal));
  }
  const badJpyPrecision = parseStatementCsv([
    'Date,Description,Debit,Credit,Currency',
    '13/07/2026,GLOBAL SHOP,24.50,,JPY',
  ].join('\n'), 'JPY');
  const badKwdPrecision = parseStatementCsv([
    'Date,Description,Debit,Credit,Currency',
    '13/07/2026,GLOBAL SHOP,12.3456,,KWD',
  ].join('\n'), 'KWD');
  ok('global CSV rejects fractional precision that the ledger currency cannot represent',
    badJpyPrecision.rows.length === 0 && badJpyPrecision.rejectedRows === 1 &&
      badKwdPrecision.rows.length === 0 && badKwdPrecision.rejectedRows === 1);

  const identifiedCsv = parseStatementCsv([
    'Date,Description,Debit,Credit,Currency,Card Number,Account Number',
    '01/07/2026,Carrefour,40.00,,AED,XXXX XXXX XXXX 4821,',
    '02/07/2026,Salary,,18500.00,AED,,AE070331234567890123456',
  ].join('\n'), 'AED');
  ok('CSV statement identity carries card/account tails into the shared account resolver',
    identifiedCsv.rows[0]?.card?.last4 === '4821' && identifiedCsv.rows[0]?.card?.kind === 'unknown' &&
      identifiedCsv.rows[1]?.card?.last4 === '3456' && identifiedCsv.rows[1]?.card?.kind === 'account',
    JSON.stringify(identifiedCsv.rows.map((row) => row.card)));


  const genericTransferCsv = parseStatementCsv([
    'Date,Description,Debit,Credit,Currency,Account Number,Transaction Reference',
    '08/07/2026,"Transfer to account XXXX2222",1000.00,,AED,XXXX1111,TRX-A1B2C3D4',
  ].join('\n'), 'AED');
  ok('generic CSV statements retain masked source/counterparty identity for transfers',
    genericTransferCsv.rows.length === 1 &&
      genericTransferCsv.rows[0].card?.last4 === '1111' &&
      genericTransferCsv.rows[0].card?.kind === 'account' &&
      genericTransferCsv.rows[0].transferHint === true &&
      genericTransferCsv.rows[0].merchant === 'Outgoing transfer' &&
      genericTransferCsv.rows[0].transferEvidence?.statement === true &&
      genericTransferCsv.rows[0].transferEvidence?.counterparty?.last4 === '2222' &&
      genericTransferCsv.rows[0].transferEvidence?.reference === 'TRX-A1B2C3D4',
    JSON.stringify(genericTransferCsv.rows));

  const ambiguousSourceCsv = parseStatementCsv([
    'Date,Description,Debit,Credit,Account Number',
    '08/07/2026,"Transfer to account XXXX2222",1000.00,,XXXX1111',
    '09/07/2026,"Transfer to account XXXX3333",500.00,,XXXX9999',
  ].join('\n'), 'AED');
  ok('a varying account column cannot become source authority for transfer reconciliation',
    ambiguousSourceCsv.rows.length === 2 &&
      ambiguousSourceCsv.rows.every((row) => row.transferEvidence?.attribution === 'fallback'));

  const transferFeeCsv = parseStatementCsv([
    'Date,Description,Debit,Credit,Account Number',
    '10/07/2026,Bank transfer fee,25.00,,XXXX1111',
  ].join('\n'), 'AED');
  ok('transfer fees remain spending rows rather than transfer candidates',
    transferFeeCsv.rows.length === 1 && transferFeeCsv.rows[0].transferHint === false &&
      transferFeeCsv.rows[0].transferEvidence === undefined &&
      transferFeeCsv.rows[0].merchant !== 'Outgoing transfer');

  const atmCsvAe = parseStatementCsv([
    'Date,Description,Debit,Credit,Currency',
    '04/07/2026,ATM CASH WITHDRAWAL 1234,500.00,,AED',
    '04/07/2026,ATMOSPHERE CAFE,25.00,,AED',
    '04/07/2026,ATM CASH WITHDRAWAL FEE,2.00,,AED',
  ].join('\n'), 'AED');
  const atmCsvSa = parseStatementCsv([
    'Date,Description,Debit,Credit,Currency',
    '04/07/2026,ATM withdrawal 5678,750.00,,SAR',
  ].join('\n'), 'SAR');
  ok('UAE and Saudi CSV cash withdrawals use their own category',
    atmCsvAe.rows[0]?.merchant === 'ATM withdrawal' &&
      atmCsvAe.rows[0]?.categoryGuess === 'cash-withdrawal' &&
      atmCsvAe.rows[0]?.categoryDeliberate === true &&
      atmCsvSa.rows[0]?.merchant === 'ATM withdrawal' &&
      atmCsvSa.rows[0]?.categoryGuess === 'cash-withdrawal');
  ok('statement ATM matching does not consume merchant names or withdrawal fees',
    atmCsvAe.rows[1]?.merchant === 'ATMOSPHERE CAFE' &&
      atmCsvAe.rows[1]?.categoryGuess !== 'cash-withdrawal' &&
      atmCsvAe.rows[2]?.merchant === 'ATM CASH WITHDRAWAL FEE' &&
      atmCsvAe.rows[2]?.categoryGuess !== 'cash-withdrawal');

  const directedTsv = parseStatementCsv([
    'Posting Date\tDetails\tAmount\tDr Cr',
    '2026-07-03\tTaxi\t52.5\tDR',
    '2026-07-04\tRefund\t12\tCR',
  ].join('\n'), 'AED');
  ok('TSV amount plus direction columns are supported',
    directedTsv.rows.length === 2 && directedTsv.rows[0].amountFils === 5250 &&
      directedTsv.rows[1].type === 'income');
  ok('statement refunds are intentionally non-spending income',
    directedTsv.rows[1].categoryGuess === 'other' &&
      directedTsv.rows[1].categoryDeliberate === true);

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

  // Formerly `invalid_csv`: a portal export in Windows-1252 is a real
  // statement, so undecodable UTF-8 now falls back to that single-byte table.
  // What must never happen is replacement-decoding — no U+FFFD, ever.
  const latinFallback = decodeCsv(Uint8Array.from([0xc3, 0x28]));
  ok('invalid UTF-8 is windows-1252 decoded instead of replacement-decoded',
    latinFallback === '\u00c3(' && !latinFallback.includes('\ufffd'), JSON.stringify(latinFallback));
  const cp1252Csv = parseStatementCsv(decodeCsv(Uint8Array.from([
    ...Buffer.from('Date,Description,Debit,Credit\n01/07/2026,Caf'), 0xe9, ...Buffer.from(' Nero,12.00,'),
  ])), 'AED');
  ok('a windows-1252 export keeps its accented merchant text',
    cp1252Csv.rows.length === 1 && cp1252Csv.rows[0].merchant === 'Caf\u00e9 Nero',
    JSON.stringify(cp1252Csv.rows.map((row) => row.merchant)));
  const utf16Csv = parseStatementCsv(decodeCsv(Uint8Array.from([
    0xff, 0xfe, ...Buffer.from('Date,Description,Debit,Credit\n01/07/2026,Carrefour,40.00,', 'utf16le'),
  ])), 'AED');
  ok('a UTF-16LE export with a BOM decodes and parses',
    utf16Csv.rows.length === 1 && utf16Csv.rows[0].amountFils === 4000);
  const utf16BeCsv = parseStatementCsv(decodeCsv(Uint8Array.from([
    0xfe, 0xff, ...Buffer.from('Date,Description,Debit,Credit\n01/07/2026,Carrefour,40.00,', 'utf16le')
      .swap16(),
  ])), 'AED');
  ok('a UTF-16BE export with a BOM decodes and parses',
    utf16BeCsv.rows.length === 1 && utf16BeCsv.rows[0].merchant === 'Carrefour');
  const utf8BomText = decodeCsv(Uint8Array.from([
    0xef, 0xbb, 0xbf, ...Buffer.from('Date,Description,Debit,Credit\n01/07/2026,Carrefour,40.00,'),
  ]));
  ok('a UTF-8 BOM is stripped before the header is read',
    !utf8BomText.startsWith('\ufeff') && parseStatementCsv(utf8BomText, 'AED').rows.length === 1);
  let binaryCsv = '';
  try {
    decodeCsv(Uint8Array.from([0x44, 0x00, 0x61, 0x00, 0x74, 0x00, 0x65, 0x00]));
  } catch (error) {
    binaryCsv = error instanceof Error ? error.message : '';
  }
  ok('BOM-less UTF-16 (or any NUL-bearing bytes) is refused rather than read as Latin text',
    binaryCsv === 'invalid_csv');
  const bidiCsv = parseStatementCsv(decodeCsv(Uint8Array.from([
    ...Buffer.from('Date,Description,Debit,Credit\n01/07/2026,Safe'), 0xe2, 0x80, 0xae, ...Buffer.from('evil,10.00,'),
  ])), 'AED');
  ok('the bidi/control-character rejection survives the decoder change',
    bidiCsv.rows.length === 0 && bidiCsv.rejectedRows === 1);

  const rows = parseStatementText([
    '01/07/2026 CARREFOUR MARKET AED 40.00 DR',
    '02/07/2026 SALARY CREDIT 18,500.00',
    '03/07/2026 AMBIGUOUS VISUAL COLUMN 22.00',
    '32/07/2026 IMPOSSIBLE AED 9.00 DR',
    '01/07/2026 CARREFOUR MARKET AED 40.00 DR',
  ].join('\n'), 'AED');
  ok('explicit debit and credit statement rows are structured',
    rows.length === 3 && rows[0].type === 'expense' && rows[1].type === 'income',
    JSON.stringify(rows));
  ok('statement amounts become integer fils',
    rows[0].amountFils === 4000 && rows[1].amountFils === 1850000);
  ok('ambiguous columns and impossible dates are rejected without dropping repeated purchases',
    rows.length === 3 && rows[0].merchant === rows[2].merchant);
  const identifiedText = parseStatementText(
    '01/07/2026 CARREFOUR MARKET AED 40.00 DR',
    'AED',
    { card: { last4: '4821', kind: 'credit' }, bankHint: 'HSBC' },
  );
  ok('text statement rows preserve document-level bank and instrument identity',
    identifiedText[0]?.card?.last4 === '4821' && identifiedText[0]?.card?.kind === 'credit' &&
      identifiedText[0]?.bankHint === 'HSBC');

  const genericPdfRows = parseStatementText([
    'Statement for Account Number: XXXX1111',
    '08/07/2026 Transfer to account XXXX2222 Ref TRX-A1B2C3D4 AED 1,000.00 DR',
  ].join('\n'), 'AED');
  ok('text/PDF statements use a unique header account as generic transfer evidence',
    genericPdfRows.length === 1 && genericPdfRows[0].card?.last4 === '1111' &&
      genericPdfRows[0].transferEvidence?.statement === true &&
      genericPdfRows[0].transferEvidence?.counterparty?.last4 === '2222' &&
      genericPdfRows[0].transferHint === true,
    JSON.stringify(genericPdfRows));
  const ownPdfRows = parseStatementText([
    'Account No: ****1111',
    '08/07/2026 Internal transfer to account ****2222 AED 250.00 DR',
  ].join('\n'), 'AED');
  ok('explicit own/internal transfer wording is bank-agnostic and excludes consumption semantics',
    ownPdfRows.length === 1 && ownPdfRows[0].merchant === 'Own account transfer' &&
      ownPdfRows[0].categoryGuess === 'other' && ownPdfRows[0].categoryDeliberate === true &&
      ownPdfRows[0].transferEvidence?.explicitOwn === true);
  const saRows = parseStatementText([
    '01/07/2026 PANDA SAR 45.00 DR',
    '02/07/2026 WRONG MARKET AED 10.00 DR',
  ].join('\n'), 'SAR');
  ok('Saudi statement rows retain SAR and reject explicit AED rows',
    saRows.length === 1 && saRows[0].currency === 'SAR' && saRows[0].amountFils === 4500 &&
      saRows[0].categoryGuess === 'groceries' && saRows[0].categoryDeliberate === true);
  const jpyRows = parseStatementText('13/07/2026 TOKYO STORE JPY 2400 DR', 'JPY');
  const kwdRows = parseStatementText('13/07/2026 KUWAIT STORE KWD 12.345 DR', 'KWD');
  ok('global text/PDF rows honor zero- and three-decimal ledger currencies',
    jpyRows.length === 1 && jpyRows[0].currency === 'JPY' && jpyRows[0].amountFils === 2400 &&
      kwdRows.length === 1 && kwdRows[0].currency === 'KWD' && kwdRows[0].amountFils === 12345,
    JSON.stringify({ jpyRows, kwdRows }));
  const currencyWordMerchant = parseStatementText('01/07/2026 SAR TRADING 45.00 DR', 'AED');
  ok('a currency word inside the merchant is not mistaken for an amount currency',
    currencyWordMerchant.length === 1 && currencyWordMerchant[0].currency === 'AED');

  const pdf = await extractPdfStatementRows(
    tinyPdf('01/07/2026 CARREFOUR MARKET AED 40.00 DR'), 'AED',
  );
  ok('real PDF bytes are text-extracted', pdf.pages === 1);
  ok('text PDF row becomes a structured transaction',
    pdf.rows.length === 1 && pdf.rows[0].merchant === 'CARREFOUR MARKET' &&
      pdf.rows[0].amountFils === 4000 && pdf.rows[0].categoryGuess === 'groceries' &&
      pdf.rows[0].categoryDeliberate === true,
    JSON.stringify(pdf.rows));
  ok('PDF parser raw exists only at the in-memory boundary', pdf.rows[0].raw.includes('CARREFOUR'));

  const atmPdfAe = await extractPdfStatementRows(
    tinyPdf('04/07/2026 ATM CASH WITHDRAWAL 1234 AED 500.00 DR'),
    'AED',
  );
  const atmPdfSa = await extractPdfStatementRows(
    tinyPdf('04/07/2026 CASH WITHDRAWAL AT AL RAJHI ATM SAR 750.00 DR'),
    'SAR',
  );
  ok('UAE and Saudi PDF cash withdrawals use their own category',
    atmPdfAe.rows[0]?.merchant === 'ATM withdrawal' &&
      atmPdfAe.rows[0]?.categoryGuess === 'cash-withdrawal' &&
      atmPdfSa.rows[0]?.merchant === 'ATM withdrawal' &&
      atmPdfSa.rows[0]?.categoryGuess === 'cash-withdrawal');

  // ── CSV header detection: preamble, blank and duplicate header cells ──
  const preambleCsv = parseStatementCsv([
    'Account Statement',
    'Account Number:,XXXX1234',
    'Period:,01/07/2026 - 31/07/2026',
    '',
    'Date,Description,,Debit,Credit,Description',
    '01/07/2026,Carrefour,ignored,40.00,,dup',
    '02/07/2026,Salary,ignored,,18500.00,dup',
  ].join('\n'), 'AED');
  ok('CSV header is found below a bank preamble; blank cells are ignored and the first duplicate wins',
    preambleCsv.rows.length === 2 && preambleCsv.totalRows === 2 && preambleCsv.rejectedRows === 0 &&
      preambleCsv.rows[0].merchant === 'Carrefour' && preambleCsv.rows[1].type === 'income',
    JSON.stringify(preambleCsv));
  const strayDelimiterCsv = parseStatementCsv([
    'Customer; Name; City',
    'Date,Description,Debit,Credit',
    '01/07/2026,Carrefour,40.00,',
    '02/07/2026,"Ref; a; b; c; d",12.00,',
  ].join('\n'), 'AED');
  ok('a semicolon-rich preamble or description does not outvote the comma table',
    strayDelimiterCsv.rows.length === 2 && strayDelimiterCsv.rows[1].merchant === 'Ref; a; b; c; d',
    JSON.stringify(strayDelimiterCsv.rows.map((row) => row.merchant)));
  let noHeaderCsv = '';
  try {
    parseStatementCsv([
      'Account Statement,x,y',
      'Notes,x,y',
      '01/07/2026,Carrefour,40.00',
    ].join('\n'), 'AED');
  } catch (error) {
    noHeaderCsv = error instanceof Error ? error.message : '';
  }
  ok('a file with no recognizable header row is still unsupported, not guessed',
    noHeaderCsv === 'unsupported_statement_format');
  let deepPreambleCsv = '';
  try {
    parseStatementCsv([
      ...Array.from({ length: 11 }, (_, index) => `Preamble line ${index},x,y`),
      'Date,Description,Debit,Credit',
      '01/07/2026,Carrefour,40.00,',
    ].join('\n'), 'AED');
  } catch (error) {
    deepPreambleCsv = error instanceof Error ? error.message : '';
  }
  ok('the header search stops after the leading records', deepPreambleCsv === 'unsupported_statement_format');
  let preambleLimitCsv = '';
  try {
    parseStatementCsv([
      'Account Statement',
      'Date,Description,Debit,Credit',
      ...Array.from({ length: 201 }, (_, index) => `01/07/2026,Row ${index},1.00,`),
    ].join('\n'), 'AED');
  } catch (error) {
    preambleLimitCsv = error instanceof Error ? error.message : '';
  }
  ok('the row limit counts data rows below the header, preamble excluded', preambleLimitCsv === 'too_many_rows');

  // ── A channel `Type` column no longer defeats signed amounts ──
  const channelTypeCsv = parseStatementCsv([
    'Date,Description,Amount,Type',
    '01/07/2026,Carrefour,-40.00,POS',
    '02/07/2026,ATM Cash,-500.00,ATM',
    '03/07/2026,Salary,+18500.00,TRF',
    '04/07/2026,Unsigned,20.00,POS',
    '05/07/2026,Refund,12.00,CR',
    '06/07/2026,Contradiction,-12.00,CR',
  ].join('\n'), 'AED');
  ok('signed amounts carry direction when the Type column names a channel, not a direction',
    channelTypeCsv.rows.length === 4 && channelTypeCsv.rejectedRows === 2 &&
      channelTypeCsv.rows[0].type === 'expense' && channelTypeCsv.rows[0].amountFils === 4000 &&
      channelTypeCsv.rows[1].type === 'expense' && channelTypeCsv.rows[1].amountFils === 50000 &&
      channelTypeCsv.rows[2].type === 'income' && channelTypeCsv.rows[2].amountFils === 1850000 &&
      channelTypeCsv.rows[3].type === 'income' && channelTypeCsv.rows[3].amountFils === 1200,
    JSON.stringify(channelTypeCsv.rows.map((row) => [row.merchant, row.type, row.amountFils])));
  ok('an unsigned amount with a channel-only Type stays rejected, and a sign that contradicts the label is not trusted',
    !channelTypeCsv.rows.some((row) => row.merchant === 'Unsigned' || row.merchant === 'Contradiction'));

  // ── Date order is inferred per file ──
  const monthFirstCsv = parseStatementCsv([
    'Date,Description,Debit,Credit',
    '07/01/2026,Early,10.00,',
    '07/25/2026,Late,11.00,',
  ].join('\n'), 'AED');
  ok('a file with a second field above 12 reads as MM/DD',
    monthFirstCsv.rows.length === 2 && monthFirstCsv.rows[0].date === '2026-07-01' &&
      monthFirstCsv.rows[1].date === '2026-07-25', JSON.stringify(monthFirstCsv.rows.map((row) => row.date)));
  const dayFirstCsv = parseStatementCsv([
    'Date,Description,Debit,Credit',
    '25/07/2026,Late,11.00,',
    '07/01/2026,Early,10.00,',
  ].join('\n'), 'AED');
  ok('a file with a first field above 12 reads as DD/MM',
    dayFirstCsv.rows.length === 2 && dayFirstCsv.rows[0].date === '2026-07-25' &&
      dayFirstCsv.rows[1].date === '2026-01-07');
  const ambiguousCsv = parseStatementCsv([
    'Date,Description,Debit,Credit',
    '07/01/2026,Ambiguous,10.00,',
  ].join('\n'), 'AED');
  ok('an ambiguous file keeps the UAE/KSA DD/MM default', ambiguousCsv.rows[0]?.date === '2026-01-07');
  const contradictoryCsv = parseStatementCsv([
    'Date,Description,Debit,Credit',
    '25/07/2026,Day first,11.00,',
    '07/25/2026,Month first,10.00,',
  ].join('\n'), 'AED');
  ok('contradictory date conventions retain only individually unambiguous dates',
    contradictoryCsv.rows.length === 2 && contradictoryCsv.rows.every(row => row.date === '2026-07-25') &&
      contradictoryCsv.rejectedRows === 0);
  const namedMonthCsv = parseStatementCsv([
    'Date,Description,Debit,Credit',
    '03-Apr-2026,Dashed,10.00,',
    '3 Apr 2026,Spaced,11.00,',
    '3 April 2026,Long,12.00,',
    '2026-04-03,ISO,13.00,',
    '03-Foo-2026,Nonsense,14.00,',
  ].join('\n'), 'AED');
  ok('DD-MMM-YYYY, DD MMM YYYY, and ISO dates all resolve; an unknown month name is rejected',
    namedMonthCsv.rows.length === 4 && namedMonthCsv.rejectedRows === 1 &&
      namedMonthCsv.rows.every((row) => row.date === '2026-04-03'),
    JSON.stringify(namedMonthCsv.rows.map((row) => row.date)));

  // ── PDF rows: debit/credit columns and signed amounts ──
  const columnRows = parseStatementLines([
    'Statement of Account',
    'Date Description Debit Credit Balance',
    '01/07/2026 CARREFOUR MARKET 40.00 - 9,960.00',
    '02/07/2026 SALARY JULY - 18,500.00 28,460.00',
    '03/07/2026 DEWA BILL 350.00 0.00 28,110.00',
    '04/07/2026 REFUND NOON 0.00 25.50 28,135.50',
    '05/07/2026 BOTH POPULATED 10.00 20.00 28,145.50',
    '06/07/2026 LONE AMOUNT 22.00',
    '07/07/2026 TWO POSITIVES 22.00 28,167.50',
    '08/07/2026 CHEQUE 000123 - 500.00',
    '09/07/2026 NO BALANCE 15.00 -',
    '10/07/2026 to 31/07/2026 closing period',
  ].join('\n'), 'AED');
  ok('debit/credit column rows with an empty-cell placeholder are read, with balance or without',
    columnRows.rows.length === 6 &&
      columnRows.rows[0].type === 'expense' && columnRows.rows[0].amountFils === 4000 &&
      columnRows.rows[0].merchant === 'CARREFOUR MARKET' &&
      columnRows.rows[1].type === 'income' && columnRows.rows[1].amountFils === 1850000 &&
      columnRows.rows[2].type === 'expense' && columnRows.rows[2].amountFils === 35000 &&
      columnRows.rows[3].type === 'income' && columnRows.rows[3].amountFils === 2550 &&
      columnRows.rows[4].type === 'income' && columnRows.rows[4].amountFils === 50000 &&
      columnRows.rows[4].merchant === 'CHEQUE 000123' &&
      columnRows.rows[5].type === 'expense' && columnRows.rows[5].amountFils === 1500,
    JSON.stringify(columnRows.rows.map((row) => [row.merchant, row.type, row.amountFils])));
  ok('both columns populated, a lone amount, and two positives are skipped and counted',
    columnRows.rejectedRows === 3, String(columnRows.rejectedRows));
  const signedRows = parseStatementLines([
    '01/07/2026 CARREFOUR MARKET -40.00',
    '02/07/2026 SALARY JULY +18,500.00 28,460.00',
    '03/07/2026 DEWA BILL 350.00- 28,110.00',
    '04/07/2026 NOON (25.50) 28,084.50',
    '05/07/2026 AED PREFIX AED -12.00',
    '06/07/2026 SIGN ON BALANCE ONLY 22.00 -1,000.00',
    '07/07/2026 WRONG MARKET SAR -9.00',
  ].join('\n'), 'AED');
  ok('leading, trailing, and parenthesised signs give direction, with or without a balance',
    signedRows.rows.length === 5 &&
      signedRows.rows[0].type === 'expense' && signedRows.rows[0].amountFils === 4000 &&
      signedRows.rows[1].type === 'income' && signedRows.rows[1].amountFils === 1850000 &&
      signedRows.rows[2].type === 'expense' && signedRows.rows[2].amountFils === 35000 &&
      signedRows.rows[3].type === 'expense' && signedRows.rows[3].amountFils === 2550 &&
      signedRows.rows[4].type === 'expense' && signedRows.rows[4].amountFils === 1200 &&
      signedRows.rows[4].merchant === 'AED PREFIX',
    JSON.stringify(signedRows.rows.map((row) => [row.merchant, row.type, row.amountFils])));
  ok('a sign only on the balance, or another market\'s currency, is skipped and counted',
    signedRows.rejectedRows === 2 && !signedRows.rows.some((row) => /BALANCE ONLY|WRONG MARKET/.test(row.merchant)));
  const creditFirstRows = parseStatementLines([
    'Date Details Credit Debit Balance',
    '01/07/2026 CARREFOUR MARKET - 40.00 9,960.00',
  ].join('\n'), 'AED');
  ok('a Credit | Debit header flips the column reading',
    creditFirstRows.rows.length === 1 && creditFirstRows.rows[0].type === 'expense');
  const proseRows = parseStatementLines([
    'Credit card statement date 31/07/2026 — direct debit is set up for this card',
    'Transaction date Details Debit Credit Balance',
    '01/07/2026 CARREFOUR MARKET 40.00 - 9,960.00',
  ].join('\n'), 'AED');
  ok('preamble prose about credit cards and direct debits does not flip the column order',
    proseRows.rows.length === 1 && proseRows.rows[0].type === 'expense');
  const balanceLabelled = parseStatementLines([
    '01/07/2026 CARREFOUR MARKET 40.00 1,234.00 CR',
    '02/07/2026 REF 000123 40.00 CR',
    '03/07/2026 AMAZON AE USD 45.00 165.30 DR',
  ].join('\n'), 'AED');
  ok('a DR/CR label after two money figures is a running balance, not a credit, and is counted',
    balanceLabelled.rows.length === 2 && balanceLabelled.rows[0].merchant === 'REF 000123' &&
      balanceLabelled.rows[0].amountFils === 4000 && balanceLabelled.rejectedRows === 1,
    JSON.stringify(balanceLabelled));
  ok('a foreign-currency amount inside the description is not mistaken for a running balance',
    /amazon/i.test(balanceLabelled.rows[1].merchant) && balanceLabelled.rows[1].type === 'expense' &&
      balanceLabelled.rows[1].amountFils === 16530,
    JSON.stringify(balanceLabelled.rows[1]));
  // A running balance proves which figure is the amount and which way it went,
  // for the many statements that mark an empty cell with nothing at all. The
  // flattening at the top of parseStatementLines removes the spacing, so these
  // rows reach the reader as two bare figures and used to be rejected whole.
  const balanceChain = parseStatementLines([
    'Statement of Account',
    'Date Description Debit Credit Balance',
    '01/07/2026 OPENING ROW 100.00 9,900.00',
    '02/07/2026 CARREFOUR MARKET 40.00 9,860.00',
    '03/07/2026 SALARY JULY 18,500.00 28,360.00',
    '04/07/2026 DEWA BILL 350.00 28,010.00',
    '05/07/2026 NOON REFUND 25.50 28,035.50',
    '06/07/2026 TALABAT 60.50 27,975.00',
  ].join('\n'), 'AED');
  ok('a reconciling balance column reads rows that carry no placeholder at all',
    balanceChain.rows.length === 5 &&
      balanceChain.rows[0].merchant === 'CARREFOUR MARKET' && balanceChain.rows[0].type === 'expense' &&
      balanceChain.rows[0].amountFils === 4000 &&
      balanceChain.rows[1].type === 'income' && balanceChain.rows[1].amountFils === 1850000 &&
      balanceChain.rows[2].type === 'expense' && balanceChain.rows[2].amountFils === 35000 &&
      balanceChain.rows[3].type === 'income' && balanceChain.rows[3].amountFils === 2550 &&
      balanceChain.rows[4].type === 'expense' && balanceChain.rows[4].amountFils === 6050,
    JSON.stringify(balanceChain.rows.map((row) => [row.merchant, row.type, row.amountFils])));
  ok('the first row is not guessed: nothing precedes it to say which way the balance moved',
    balanceChain.rejectedRows === 1, String(balanceChain.rejectedRows));
  // The whole safeguard: the column is only readable because it reconciles.
  const balancesDisagree = parseStatementLines([
    'Date Description Debit Credit Balance',
    '01/07/2026 FIRST ROW 100.00 9,900.00',
    '02/07/2026 CARREFOUR MARKET 40.00 7,111.00',
    '03/07/2026 SALARY JULY 18,500.00 2,020.00',
    '04/07/2026 DEWA BILL 350.00 5,555.00',
    '05/07/2026 NOON REFUND 25.50 1,234.00',
    '06/07/2026 TALABAT 60.50 9,999.00',
  ].join('\n'), 'AED');
  ok('figures that do not reconcile are still refused rather than guessed at',
    balancesDisagree.rows.length === 0 && balancesDisagree.rejectedRows === 6,
    JSON.stringify(balancesDisagree));
  // An overdraft, and every credit card that states what is owed.
  const overdraft = parseStatementLines([
    'Date Description Debit Credit Balance',
    '01/07/2026 FIRST ROW 100.00 150.00',
    '02/07/2026 CARREFOUR MARKET 200.00 -50.00',
    '03/07/2026 DEWA BILL 350.00 -400.00',
    '04/07/2026 SALARY JULY 1,000.00 600.00',
    '05/07/2026 TALABAT 60.50 539.50',
    '06/07/2026 NOON 39.50 500.00',
  ].join('\n'), 'AED');
  ok('a balance that goes negative keeps reading instead of stopping at the red',
    overdraft.rows.length === 5 &&
      overdraft.rows[0].type === 'expense' && overdraft.rows[0].amountFils === 20000 &&
      overdraft.rows[1].type === 'expense' && overdraft.rows[1].amountFils === 35000 &&
      overdraft.rows[2].type === 'income' && overdraft.rows[2].amountFils === 100000,
    JSON.stringify(overdraft.rows.map((row) => [row.merchant, row.type, row.amountFils])));
  // The label names the balance; the charge is the figure before it.
  const labelledChain = parseStatementLines([
    'Date Description Debit Credit Balance',
    '01/07/2026 FIRST ROW 100.00 9,900.00 DR',
    '02/07/2026 CARREFOUR MARKET 40.00 9,860.00 DR',
    '03/07/2026 SALARY JULY 18,500.00 28,360.00 CR',
    '04/07/2026 DEWA BILL 350.00 28,010.00 DR',
    '05/07/2026 SPINNEYS JLT 120.00 27,890.00 DR',
    '06/07/2026 NOON REFUND 25.50 27,915.50 CR',
  ].join('\n'), 'AED');
  ok('a DR/CR label after two figures labels the balance, and the charge is still read',
    labelledChain.rows.length === 6 && labelledChain.rejectedRows === 0 &&
      labelledChain.rows[1].merchant === 'CARREFOUR MARKET' &&
      labelledChain.rows[1].type === 'expense' && labelledChain.rows[1].amountFils === 4000 &&
      labelledChain.rows[2].type === 'income' && labelledChain.rows[2].amountFils === 1850000 &&
      // `SPINNEYS JLT` and `FIRST ROW` end in three capitals; under the old
      // `[A-Z]{3}` guard both imported the running balance as the amount.
      labelledChain.rows[4].merchant === 'SPINNEYS JLT' && labelledChain.rows[4].amountFils === 12000 &&
      labelledChain.rows[0].merchant === 'FIRST ROW' && labelledChain.rows[0].amountFils === 10000 &&
      labelledChain.rows[5].type === 'income' && labelledChain.rows[5].amountFils === 2550,
    JSON.stringify(labelledChain.rows.map((row) => [row.merchant, row.type, row.amountFils])));
  // A company suffix is not a currency, and a real code still is.
  const suffixes = parseStatementLines([
    'Date Description Debit Credit Balance',
    '01/07/2026 FIRST ROW 100.00 9,900.00',
    '02/07/2026 GULF TRADING FZ LLC 40.00 9,860.00',
    '03/07/2026 SOME SUPPLIER FZE 60.00 9,800.00',
    '04/07/2026 ANOTHER ONE LTD 30.00 9,770.00',
    '05/07/2026 SPINNEYS JLT 25.00 9,745.00',
    '06/07/2026 CARREFOUR MARKET 45.00 9,700.00',
    '07/07/2026 AMAZON AE USD 45.00 9,655.00',
    '08/07/2026 TALABAT ORDER 55.00 9,600.00',
  ].join('\n'), 'AED');
  ok('descriptions ending LLC, FZE or LTD are read, and a real currency code is still skipped',
    suffixes.rows.some((row) => row.merchant === 'GULF TRADING FZ LLC' && row.amountFils === 4000) &&
      suffixes.rows.some((row) => row.merchant === 'SOME SUPPLIER FZE' && row.amountFils === 6000) &&
      suffixes.rows.some((row) => row.merchant === 'ANOTHER ONE LTD' && row.amountFils === 3000) &&
      !suffixes.rows.some((row) => /AMAZON/.test(row.merchant)),
    JSON.stringify(suffixes.rows.map((row) => [row.merchant, row.type, row.amountFils])));
  const proseOrder = parseStatementLines([
    'Credits are listed before debits for each transaction date in this statement',
    '01/07/2026 CARREFOUR MARKET 40.00 - 9,960.00',
  ].join('\n'), 'AED');
  ok('sentence-length prose naming credits, debits and date does not become the column header',
    proseOrder.rows.length === 1 && proseOrder.rows[0].type === 'expense',
    JSON.stringify(proseOrder.rows));
  const shortHeaderless = parseStatementLines([
    'Date Credit Debit',
    '01/07/2026 CARREFOUR MARKET 40.00 - 9,960.00',
  ].join('\n'), 'AED');
  ok('a three-word line without a fourth column name is not trusted to flip the order',
    shortHeaderless.rows.length === 1 && shortHeaderless.rows[0].type === 'expense');

  // Real HSBC UAE credit-card PDF shape (sanitized). The table is not a
  // Debit/Credit table: ordinary purchases have no direction label, credits
  // carry CR, and the PDF exposes both Original Amount and Total Amount. The
  // posting date is a second leading date and descriptions can wrap before the
  // two amount cells. This used to reject every purchase as "two positives"
  // and polluted the merchant on the few CR rows that happened to parse.
  const cardTotalAmountTable = parseStatementLines([
    'HSBC Live+ Credit Card Statement',
    'Statement Period: From 11 August 26 to 10 September 26',
    'Minimum Payment Due AED 120.44',
    'Number Card Credit',
    '4111-2222-3333-4821',
    'Details of your transactions this month',
    'Transaction Date Posting Date Transaction Details Original Amount VAT Total Amount (AED)',
    '10-Aug-26 11-Aug-26 CASHBACK 13.92 CR 13.92CR',
    '09-Aug-26 11-Aug-26 NFC - (G-PAY)- ASTER PHARMACY 177 BR',
    'DUBAI AE',
    '25.00 25.00',
    '09-Aug-26 11-Aug-26 Talabat DUBAI AE 33.99 33.99',
    '23-Aug-26 24-Aug-26 Amazon.ae Dubai AE 44.99 CR 44.99CR',
    '30-Aug-26 31-Aug-26 Amazon Grocery Dubai AE 15.57 15.57',
  ].join('\n'), 'AED');
  ok('card total-amount tables read unlabelled purchases and CR exceptions without guessing an account statement',
    cardTotalAmountTable.rows.length === 5 && cardTotalAmountTable.rejectedRows === 0 &&
      cardTotalAmountTable.rows[0].merchant === 'CASHBACK' &&
      cardTotalAmountTable.rows[0].type === 'income' && cardTotalAmountTable.rows[0].amountFils === 1392 &&
      cardTotalAmountTable.rows[0].card?.last4 === '4821' && cardTotalAmountTable.rows[0].card?.kind === 'credit' &&
      cardTotalAmountTable.rows[0].bankHint === 'HSBC' &&
      /ASTER PHARMACY 177 BR/.test(cardTotalAmountTable.rows[1].merchant) &&
      cardTotalAmountTable.rows[1].type === 'expense' && cardTotalAmountTable.rows[1].amountFils === 2500 &&
      /Talabat/i.test(cardTotalAmountTable.rows[2].merchant) &&
      cardTotalAmountTable.rows[2].type === 'expense' && cardTotalAmountTable.rows[2].amountFils === 3399 &&
      cardTotalAmountTable.rows[3].merchant === 'Amazon' &&
      cardTotalAmountTable.rows[3].type === 'income' && cardTotalAmountTable.rows[3].amountFils === 4499 &&
      /Amazon Grocery/i.test(cardTotalAmountTable.rows[4].merchant) &&
      cardTotalAmountTable.rows.every((row) => !/^\d{1,2}-[A-Za-z]{3}-\d{2}\b/.test(row.merchant)),
    JSON.stringify(cardTotalAmountTable));

  const bilingualCardIdentity = parseStatementLines([
    'HSBC Live+ Credit Card Statement',
    'Statement Period: From 01 August 26 to 31 August 26',
    'Minimum Payment Due AED 50.00',
    'Credit Card Number رقم البطاقة الائتمانية 4111-2222-3333-9876',
    'Transaction Date Posting Date Transaction Details Original Amount VAT Total Amount (AED)',
    '01-Aug-26 02-Aug-26 SHOP DUBAI AE 10.00 10.00',
  ].join('\n'), 'AED');
  ok('bilingual card labels retain only terminal card identity',
    bilingualCardIdentity.rows.length === 1 &&
      bilingualCardIdentity.rows[0].card?.last4 === '9876' &&
      bilingualCardIdentity.rows[0].card?.kind === 'credit',
    JSON.stringify(bilingualCardIdentity.rows[0]?.card));

  // PDF.js is allowed to return an entire visual page as one text line. This
  // mirrors the real HSBC extraction shape where rows are separated by hyphens
  // rather than EOLs, and where "TransactionDate" can be emitted without a
  // space between the two header words.
  const packedCardTable = parseStatementLines([
    'Credit Card Statement Minimum Payment Due AED 50.00',
    'TransactionDate PostingDate TransactionDetails Original Amount VAT Total Amount (AED)',
    '01-Aug-26 02-Aug-26 MERCHANT ONE DUBAI AE 10.00 10.00 -' +
      '03-Aug-26 04-Aug-26 REFUND SHOP DUBAI AE 7.25 CR 7.25CR -' +
      '05-Aug-26 06-Aug-26 MERCHANT TWO DUBAI AE 100.00 5.00 105.00 -' +
      '07-Aug-26 08-Aug-26 FOREIGN SHOP USD 12.00 44.10',
  ].join('\n'), 'AED');
  ok('packed card-table extraction is split into rows before amount parsing',
    packedCardTable.rows.length === 4 && packedCardTable.rejectedRows === 0 &&
      packedCardTable.rows[0].type === 'expense' && packedCardTable.rows[0].amountFils === 1000 &&
      packedCardTable.rows[1].type === 'income' && packedCardTable.rows[1].amountFils === 725 &&
      packedCardTable.rows[2].type === 'expense' && packedCardTable.rows[2].amountFils === 10500 &&
      // The acquirer's city/country tail is peeled from the title, as SMS does.
      packedCardTable.rows[2].merchant === 'MERCHANT TWO' &&
      packedCardTable.rows[3].type === 'expense' && packedCardTable.rows[3].amountFils === 4410 &&
      /FOREIGN SHOP/.test(packedCardTable.rows[3].merchant),
    JSON.stringify(packedCardTable));

  const packedWrappedCardTable = parseStatementLines([
    'Credit Card Statement Minimum Payment Due AED 50.00',
    'TransactionDate PostingDate TransactionDetails Original Amount VAT Total Amount (AED)',
    '01-Aug-26 02-Aug-26 ENOC SITE - 6519 DUBAI AE 653.48 DR',
    '653.48 DR -03-Aug-26 04-Aug-26 SECOND SHOP DUBAI AE 25.00 25.00 -' +
      '05-Aug-26 06-Aug-26 THIRD SHOP DUBAI AE',
    '30.00 30.00 -07-Aug-26 08-Aug-26 FOURTH SHOP DUBAI AE 40.00 40.00',
  ].join('\n'), 'AED');
  ok('wrapped amount cells inside a packed page keep the row separator out of the amount tail',
    packedWrappedCardTable.rows.length === 4 && packedWrappedCardTable.rejectedRows === 0 &&
      packedWrappedCardTable.rows.map((row) => row.amountFils).join(',') === '65348,2500,3000,4000',
    JSON.stringify(packedWrappedCardTable));

  const postingDateLineBreak = parseStatementLines([
    'Credit Card Statement Minimum Payment Due AED 50.00',
    'TransactionDate PostingDate TransactionDetails Original Amount VAT Total Amount (AED)',
    '01-Aug-26 02-Aug-26 FIRST SHOP DUBAI AE 10.00 10.00 -03-Aug-26 04-Aug-26',
    'SECOND SHOP DUBAI AE 20.00 20.00 -05-Aug-26 06-Aug-26 THIRD SHOP DUBAI AE 30.00 30.00',
  ].join('\n'), 'AED');
  ok('a row whose description wraps immediately after Posting Date is retained',
    postingDateLineBreak.rows.length === 3 && postingDateLineBreak.rejectedRows === 0 &&
      postingDateLineBreak.rows.map((row) => row.amountFils).join(',') === '1000,2000,3000',
    JSON.stringify(postingDateLineBreak));

  const merchantDateLineBreak = parseStatementLines([
    'Credit Card Statement Minimum Payment Due AED 50.00',
    'TransactionDate PostingDate TransactionDetails Original Amount VAT Total Amount (AED)',
    '07-Aug-26 08-Aug-26 HOTEL STAY 10-Aug-26',
    '11-Aug-26 DUBAI AE 2,471.40 2,471.40',
  ].join('\n'), 'AED');
  ok('an unmarked two-date merchant continuation fails closed instead of moving money to the embedded date',
    merchantDateLineBreak.rows.length === 0 && merchantDateLineBreak.rejectedRows === 1,
    JSON.stringify(merchantDateLineBreak));

  const vatTotalLineBreak = parseStatementLines([
    'Credit Card Statement Minimum Payment Due AED 50.00',
    'TransactionDate PostingDate TransactionDetails Original Amount VAT Total Amount (AED)',
    '12-Aug-26 13-Aug-26 STORE 2026 LLC DUBAI AE 1,979.92 42.86',
    '2,022.78',
  ].join('\n'), 'AED');
  ok('a Total Amount wrapped after populated VAT reconciles before the row is accepted',
    vatTotalLineBreak.rows.length === 1 && vatTotalLineBreak.rejectedRows === 0 &&
      vatTotalLineBreak.rows[0].amountFils === 202278 &&
      vatTotalLineBreak.rows[0].merchant === 'STORE 2026 LLC',
    JSON.stringify(vatTotalLineBreak));

  const datesInsideMerchant = parseStatementLines([
    'Credit Card Statement Minimum Payment Due AED 50.00',
    'TransactionDate PostingDate TransactionDetails Original Amount VAT Total Amount (AED)',
    '01-Aug-26 02-Aug-26 HOTEL STAY 10-Aug-26 11-Aug-26 DUBAI AE 20.00 20.00 -' +
      '03-Aug-26 04-Aug-26 NEXT SHOP DUBAI AE 30.00 30.00',
  ].join('\n'), 'AED');
  ok('two unmarked dates inside merchant text fail closed while the next proven row survives',
    datesInsideMerchant.rows.length === 1 && datesInsideMerchant.rejectedRows === 1 &&
      datesInsideMerchant.rows[0].date === '2026-08-03' &&
      datesInsideMerchant.rows[0].amountFils === 3000 &&
      !datesInsideMerchant.rows.some((row) => row.date === '2026-08-10'),
    JSON.stringify(datesInsideMerchant));

  const cardTableWithTrailers = parseStatementLines([
    'Credit Card Statement Minimum Payment Due AED 50.00',
    'TransactionDate PostingDate TransactionDetails Original Amount VAT Total Amount (AED)',
    '01-Aug-26 02-Aug-26 PAYMENT 101.75 CR 101.75 CR - 4111 2222 3333 4444 CARDHOLDER NAME -' +
      '03-Aug-26 04-Aug-26 SHOP DUBAI AE 25.00 25.00 - Get rewards with your card',
  ].join('\n'), 'AED');
  ok('visual card subheaders and page footers after completed rows are ignored',
    cardTableWithTrailers.rows.length === 2 && cardTableWithTrailers.rejectedRows === 0 &&
      cardTableWithTrailers.rows[0].type === 'income' && cardTableWithTrailers.rows[0].amountFils === 10175 &&
      cardTableWithTrailers.rows[1].type === 'expense' && cardTableWithTrailers.rows[1].amountFils === 2500 &&
      !cardTableWithTrailers.rows.some((row) => /CARDHOLDER|rewards/i.test(row.merchant)),
    JSON.stringify(cardTableWithTrailers));

  const conflictingCardDirection = parseStatementLines([
    'Credit Card Statement Minimum Payment Due AED 50.00',
    'Transaction Date Posting Date Transaction Details Original Amount VAT Total Amount',
    '01-Aug-26 02-Aug-26 CONFLICT 10.00 CR 10.00 DR',
  ].join('\n'), 'AED');
  ok('conflicting CR/DR evidence in a card table is rejected rather than guessed',
    conflictingCardDirection.rows.length === 0 && conflictingCardDirection.rejectedRows === 1,
    JSON.stringify(conflictingCardDirection));

  const accountLookalike = parseStatementLines([
    'Statement of Account',
    'TransactionDate PostingDate TransactionDetails Original Amount VAT Total Amount',
    '01-Aug-26 02-Aug-26 AMBIGUOUS 10.00 10.00',
  ].join('\n'), 'AED');
  ok('the card convention never turns a lookalike account table into spending',
    accountLookalike.rows.length === 0 && accountLookalike.rejectedRows === 1,
    JSON.stringify(accountLookalike));

  const manyCardRows = Array.from({ length: 70 }, (_, index) => {
    const day = String((index % 28) + 1).padStart(2, '0');
    const next = String(((index + 1) % 28) + 1).padStart(2, '0');
    const amount = (10 + index / 100).toFixed(2);
    return `${day}-Aug-26 ${next}-Aug-26 TEST MERCHANT ${index} DUBAI AE ${amount} ${amount}`;
  });
  const manyCardTable = parseStatementLines([
    'Credit Card Statement Minimum Payment Due AED 50.00',
    'TransactionDate PostingDate TransactionDetails Original Amount VAT Total Amount (AED)',
    manyCardRows.join(' -'),
  ].join('\n'), 'AED');
  ok('a packed 70-row card statement does not lose, merge, or duplicate rows',
    manyCardTable.rows.length === 70 && manyCardTable.rejectedRows === 0 &&
      new Set(manyCardTable.rows.map((row) => `${row.date}|${row.merchant}|${row.amountFils}`)).size === 70,
    JSON.stringify({ rows: manyCardTable.rows.length, rejected: manyCardTable.rejectedRows }));

  const jpyCardTable = parseStatementLines([
    'Credit Card Statement Minimum Payment Due JPY 500',
    'TransactionDate PostingDate TransactionDetails Original Amount VAT Total Amount (JPY)',
    '01-Aug-26 02-Aug-26 TOKYO STORE JP 1,250 1,250',
    '03-Aug-26 04-Aug-26 REFUND JP 500 CR 500CR',
  ].join('\n'), 'JPY');
  const kwdCardTable = parseStatementLines([
    'Credit Card Statement Minimum Payment Due KWD 5.000',
    'TransactionDate PostingDate TransactionDetails Original Amount VAT Total Amount (KWD)',
    '01-Aug-26 02-Aug-26 KUWAIT STORE KW 12.345 0.617 12.962',
  ].join('\n'), 'KWD');
  ok('card Total Amount tables honor zero- and three-decimal ledger currencies',
    jpyCardTable.rows.length === 2 && jpyCardTable.rejectedRows === 0 &&
      jpyCardTable.rows[0].amountFils === 1250 && jpyCardTable.rows[1].amountFils === 500 &&
      jpyCardTable.rows[1].type === 'income' &&
      kwdCardTable.rows.length === 1 && kwdCardTable.rejectedRows === 0 &&
      kwdCardTable.rows[0].amountFils === 12962,
    JSON.stringify({ jpy: jpyCardTable, kwd: kwdCardTable }));
  const summaryLines = parseStatementLines([
    '01/07/2026 Opening Balance 10,000.00',
    '01/07/2026 Balance B/F 1,000.00 CR',
    '01/07/2026 CARREFOUR MARKET 40.00 - 9,960.00',
    '02/07/2026 TOTAL ENERGIES FUEL 120.00 - 9,840.00',
    '31/07/2026 Closing Balance 9,960.00',
    '31/07/2026 Total 40.00 0.00',
  ].join('\n'), 'AED');
  ok('opening/closing balance, brought-forward and total lines are neither filed nor counted as rejected',
    summaryLines.rows.length === 2 && summaryLines.rejectedRows === 0 &&
      summaryLines.rows.every((row) => row.type === 'expense') &&
      summaryLines.rows.some((row) => row.amountFils === 12000),
    JSON.stringify(summaryLines));
  const drCrFirst = parseStatementLines('01/07/2026 CARREFOUR MARKET 40.00 DR', 'AED');
  ok('the explicit DR/CR branch still wins and counts nothing',
    drCrFirst.rows.length === 1 && drCrFirst.rows[0].type === 'expense' && drCrFirst.rejectedRows === 0);
  const namedDateRows = parseStatementLines([
    '03-Apr-2026 CARREFOUR MARKET AED 40.00 DR',
    '3 Apr 2026 SALARY - 18,500.00 20,000.00',
    '04/15/2026 MONTH FIRST FILE -10.00',
  ].join('\n'), 'AED');
  ok('PDF rows accept DD-MMM-YYYY and DD MMM YYYY dates and infer MM/DD per file',
    namedDateRows.rows.length === 3 && namedDateRows.rows[0].date === '2026-04-03' &&
      namedDateRows.rows[1].date === '2026-04-03' && namedDateRows.rows[2].date === '2026-04-15',
    JSON.stringify(namedDateRows.rows.map((row) => row.date)));
  ok('parseStatementText keeps returning the row array for callers that never counted',
    parseStatementText('01/07/2026 CARREFOUR MARKET -40.00', 'AED').length === 1);

  const partialPdf = await extractPdfStatementRows(tinyPdf('01/07/2026 CARREFOUR MARKET 40.00 DR'), 'AED');
  ok('a fully read PDF reports zero rejected rows',
    partialPdf.rejectedRows === 0 && partialPdf.totalRows === partialPdf.rows.length &&
    partialPdf.completeRowAccounting === true);
  const rejectedPdf = parseStatementLines([
    '01/07/2026 CARREFOUR MARKET 40.00 DR',
    '02/07/2026 AMBIGUOUS VISUAL COLUMN 22.00',
    '32/07/2026 IMPOSSIBLE AED 9.00 DR',
  ].join('\n'), 'AED');
  ok('PDF text reports date-led money lines it could not read as rejected',
    rejectedPdf.rows.length === 1 && rejectedPdf.rejectedRows === 2 &&
    rejectedPdf.totalRows === 3 && rejectedPdf.completeRowAccounting === true);

  let tooLong = '';
  try {
    await extractPdfStatementRows(wideTextPdf(
      Array.from({ length: 80 }, (_, index) => `01/07/2026 ROW ${index} ${'LONG '.repeat(380)}40.00 DR`),
    ), 'AED');
  } catch (error) {
    tooLong = error instanceof Error ? error.message : '';
  }
  ok('an oversized text PDF is a distinct limit error, not a scanned-PDF error', tooLong === 'pdf_too_long');

  // ── Card statements: bare signs are not a direction on their own ──
  // An account statement prints money OUT with a minus. Card statements do the
  // opposite as often as not: charges are plain and a payment or refund is the
  // one carrying the minus. Reading "PAYMENT RECEIVED -500.00" on a card
  // statement with the account convention filed the user's card payment as a
  // 500 charge.
  const cardHeader = [
    'Credit Card Statement',
    'Statement Date 31/07/2026',
    'Minimum Payment Due AED 50.00',
    'Credit Limit AED 20,000.00',
  ];
  const cardUnlabelled = parseStatementLines([
    ...cardHeader,
    '01/07/2026 NOON.COM DUBAI 68.93',
    '05/07/2026 PAYMENT RECEIVED THANK YOU -500.00',
    '06/07/2026 AMAZON REFUND (25.00)',
  ].join('\n'), 'AED');
  ok('a card statement without a sign legend refuses minus/parenthesised rows instead of filing them as charges',
    cardUnlabelled.rows.length === 1 && cardUnlabelled.rows[0].type === 'expense' &&
      cardUnlabelled.rows[0].amountFils === 6893 &&
      !cardUnlabelled.rows.some((row) => /PAYMENT|REFUND/.test(row.merchant)) &&
      cardUnlabelled.rejectedRows === 2 && cardUnlabelled.ambiguousCardSignRows === 2,
    JSON.stringify(cardUnlabelled));
  const cardMinusCredit = parseStatementLines([
    ...cardHeader,
    'A minus sign (-) denotes a credit to your card account.',
    '01/07/2026 NOON.COM DUBAI 68.93',
    '05/07/2026 PAYMENT RECEIVED THANK YOU -500.00',
    '06/07/2026 AMAZON REFUND (25.00)',
  ].join('\n'), 'AED');
  ok('a card statement that states minus means credit reads payments and refunds as credits',
    cardMinusCredit.rows.length === 3 && cardMinusCredit.rejectedRows === 0 &&
      cardMinusCredit.rows[1].type === 'income' && cardMinusCredit.rows[1].amountFils === 50000 &&
      cardMinusCredit.rows[2].type === 'income' && cardMinusCredit.rows[2].amountFils === 2500 &&
      cardMinusCredit.rows[0].type === 'expense',
    JSON.stringify(cardMinusCredit.rows.map((row) => [row.merchant, row.type, row.amountFils])));
  const cardExplicitCr = parseStatementLines([
    ...cardHeader,
    '05/07/2026 PAYMENT RECEIVED THANK YOU 500.00 CR',
    '06/07/2026 CARREFOUR 40.00 DR',
  ].join('\n'), 'AED');
  ok('explicit CR/DR labels still decide card statement rows',
    cardExplicitCr.rows.length === 2 && cardExplicitCr.rows[0].type === 'income' &&
      cardExplicitCr.rows[1].type === 'expense');
  const cardOnlySigned = parseStatementLines([
    ...cardHeader,
    '05/07/2026 PAYMENT RECEIVED -500.00',
    '06/07/2026 CARREFOUR 40.00-',
  ].join('\n'), 'AED');
  ok('a card statement whose every row is a bare signed figure reports the sign refusal',
    cardOnlySigned.rows.length === 0 && cardOnlySigned.ambiguousCardSignRows === 2);
  const accountStillSigned = parseStatementLines([
    'Statement of Account',
    '05/07/2026 CARREFOUR -40.00',
    '06/07/2026 SALARY +1,000.00',
  ].join('\n'), 'AED');
  ok('account statements keep the minus-is-debit reading',
    accountStillSigned.rows.length === 2 && accountStillSigned.rows[0].type === 'expense' &&
      accountStillSigned.rows[1].type === 'income' && accountStillSigned.ambiguousCardSignRows === 0);
  // A card statement's running figure is what is OWED: it rises on a charge.
  // The account-statement balance chain reads a rise as money in.
  const cardBalanceChain = parseStatementLines([
    ...cardHeader,
    'Date Description Amount Balance',
    '01/07/2026 FIRST ROW 100.00 100.00',
    '02/07/2026 CARREFOUR MARKET 40.00 140.00',
    '03/07/2026 DEWA BILL 350.00 490.00',
    '04/07/2026 TALABAT 60.50 550.50',
    '05/07/2026 NOON 39.50 590.00',
    '06/07/2026 SPINNEYS 10.00 600.00',
  ].join('\n'), 'AED');
  ok('a card statement running balance is never read with the account-statement direction',
    !cardBalanceChain.rows.some((row) => row.type === 'income'),
    JSON.stringify(cardBalanceChain.rows.map((row) => [row.merchant, row.type, row.amountFils])));

  const cardCsvSigned = parseStatementCsv([
    'Credit Card Statement',
    'Card Number,XXXX-XXXX-XXXX-4821',
    'Date,Description,Amount',
    '01/07/2026,NOON.COM,68.93',
    '05/07/2026,CARREFOUR,-40.00',
  ].join('\n'), 'AED');
  ok('a card CSV with one signed amount column, no legend and no telling rows is refused, not read as account signs',
    cardCsvSigned.rows.length === 0 && cardCsvSigned.ambiguousCardSignRows === 2,
    JSON.stringify(cardCsvSigned));
  // The same file whose only minus row is the card payment proves its own
  // convention: payments negative, charges plain (Amex-style).
  const cardCsvInferred = parseStatementCsv([
    'Credit Card Statement',
    'Card Number,XXXX-XXXX-XXXX-4821',
    'Date,Description,Amount',
    '01/07/2026,NOON.COM,68.93',
    '05/07/2026,PAYMENT RECEIVED,-500.00',
  ].join('\n'), 'AED');
  ok('a card CSV whose minus rows are all payments reads charges plain and payments negative',
    cardCsvInferred.rows.length === 2 && cardCsvInferred.ambiguousCardSignRows === 0 &&
      cardCsvInferred.rows[0].type === 'expense' && cardCsvInferred.rows[0].amountFils === 6893 &&
      cardCsvInferred.rows[1].kind === 'cardPayment' && cardCsvInferred.rows[1].card?.last4 === '4821',
    JSON.stringify(cardCsvInferred));
  const cardCsvLegend = parseStatementCsv([
    'Credit Card Statement',
    'Negative amounts indicate payments and credits',
    'Date,Description,Amount',
    '01/07/2026,NOON.COM,68.93',
    '05/07/2026,PAYMENT RECEIVED,-500.00',
  ].join('\n'), 'AED');
  ok('a card CSV that states negative means credit reads charges positive and payments negative',
    cardCsvLegend.rows.length === 2 && cardCsvLegend.rows[0].type === 'expense' &&
      cardCsvLegend.rows[1].type === 'income' && cardCsvLegend.rows[1].amountFils === 50000,
    JSON.stringify(cardCsvLegend.rows.map((row) => [row.merchant, row.type])));
  const cardCsvChargesNegative = parseStatementCsv([
    'Credit Card Statement',
    'Charges are shown as negative amounts',
    'Date,Description,Amount',
    '01/07/2026,NOON.COM,-68.93',
    '05/07/2026,PAYMENT RECEIVED,500.00',
  ].join('\n'), 'AED');
  ok('a card CSV that states charges are negative reads the account-style convention',
    cardCsvChargesNegative.rows.length === 2 && cardCsvChargesNegative.rows[0].type === 'expense' &&
      cardCsvChargesNegative.rows[1].type === 'income',
    JSON.stringify(cardCsvChargesNegative));
  const cardCsvDirected = parseStatementCsv([
    'Credit Card Statement',
    'Date,Description,Amount,Dr Cr',
    '01/07/2026,NOON.COM,68.93,DR',
    '05/07/2026,PAYMENT RECEIVED,500.00,CR',
  ].join('\n'), 'AED');
  ok('a card CSV with an explicit direction column is unaffected',
    cardCsvDirected.rows.length === 2 && cardCsvDirected.rows[1].type === 'income');

  // ── Numeric dates that could be either day or month ──
  // 01/07/2026 is 1 July in Dubai and January 7 in New York. With no row in
  // the file above 12 to settle it, only a ledger whose market reads day-first
  // (the launch-tested AED and SAR) may assume it; anything else refuses.
  const usdAmbiguous = parseStatementCsv([
    'Date,Description,Debit,Credit',
    '01/07/2026,GLOBAL SHOP,24.90,',
    '02/07/2026,OTHER SHOP,10.00,',
  ].join('\n'), 'USD');
  ok('a non-day-first ledger refuses a CSV whose every numeric date is ambiguous',
    usdAmbiguous.rows.length === 0 && usdAmbiguous.rejectedRows === 2 &&
      usdAmbiguous.ambiguousDateRows === 2, JSON.stringify(usdAmbiguous));
  const usdSettled = parseStatementCsv([
    'Date,Description,Debit,Credit',
    '01/07/2026,GLOBAL SHOP,24.90,',
    '01/13/2026,OTHER SHOP,10.00,',
  ].join('\n'), 'USD');
  ok('one row above 12 settles the order for the whole file',
    usdSettled.rows.length === 2 && usdSettled.rows[0].date === '2026-01-07' &&
      usdSettled.ambiguousDateRows === 0, JSON.stringify(usdSettled.rows.map((row) => row.date)));
  const aedAmbiguous = parseStatementCsv([
    'Date,Description,Debit,Credit',
    '01/07/2026,CARREFOUR,24.90,',
  ].join('\n'), 'AED');
  ok('the launch-tested AED ledger keeps its day-first reading',
    aedAmbiguous.rows.length === 1 && aedAmbiguous.rows[0].date === '2026-07-01');
  const usdIso = parseStatementCsv([
    'Date,Description,Debit,Credit',
    '2026-07-01,GLOBAL SHOP,24.90,',
    '05/05/2026,SAME BOTH WAYS,1.00,',
  ].join('\n'), 'USD');
  ok('ISO dates and day-equals-month dates are never ambiguous',
    usdIso.rows.length === 2 && usdIso.ambiguousDateRows === 0);
  const usdPdfAmbiguous = parseStatementLines([
    '01/07/2026 GLOBAL SHOP 24.90 DR',
    '02/07/2026 OTHER SHOP 10.00 DR',
  ].join('\n'), 'USD');
  ok('PDF rows with only ambiguous dates are refused and counted, not guessed',
    usdPdfAmbiguous.rows.length === 0 && usdPdfAmbiguous.rejectedRows === 2 &&
      usdPdfAmbiguous.ambiguousDateRows === 2, JSON.stringify(usdPdfAmbiguous));
  const sarPdfAmbiguous = parseStatementLines('01/07/2026 PANDA 24.90 DR', 'SAR');
  ok('the launch-tested SAR ledger keeps its day-first reading in PDFs',
    sarPdfAmbiguous.rows.length === 1 && sarPdfAmbiguous.rows[0].date === '2026-07-01');

  // ── Card settlements on statements are transfers, never spend or income ──
  // The same payment appears on BOTH statements: once leaving the current
  // account and once arriving on the card. Read as an ordinary expense and an
  // ordinary credit, one settlement became spending AND income.
  const accountSettlement = parseStatementLines([
    'Statement of Account',
    'Account Number: XXXXXXXX1234',
    '05/07/2026 CREDIT CARD PAYMENT 4111XXXXXXXX4821 1,500.00 DR',
    '06/07/2026 CC PAYMENT 700.00 DR',
    '07/07/2026 CARD PAYMENT TO TESCO STORES 40.00 DR',
    '08/07/2026 CREDIT CARD PAYMENT LATE FEE 100.00 DR',
  ].join('\n'), 'AED');
  const [toCard, unlabelledSettlement, posPurchase, lateFee] = accountSettlement.rows;
  ok('an account-statement payment to a named card is a non-spending transfer on the paying account',
    toCard?.kind === 'transaction' && toCard.type === 'expense' && toCard.transferHint === true &&
      toCard.card?.last4 === '1234' && toCard.categoryGuess === 'other' && toCard.categoryDeliberate === true,
    JSON.stringify(toCard));
  ok('an account-statement card payment without card digits stays on the account as a non-spending transfer',
    unlabelledSettlement?.kind === 'transaction' && unlabelledSettlement.type === 'expense' &&
      unlabelledSettlement.transferHint === true && unlabelledSettlement.categoryGuess === 'other' &&
      unlabelledSettlement.card?.last4 === '1234',
    JSON.stringify(unlabelledSettlement));
  ok('a card PURCHASE described as "card payment to" a shop, and a card fee, stay ordinary spending',
    posPurchase?.transferHint === false && posPurchase.kind === 'transaction' &&
      lateFee?.transferHint === false && lateFee.kind === 'transaction',
    JSON.stringify([posPurchase, lateFee]));
  const cardSettlement = parseStatementLines([
    'Credit Card Statement',
    'Credit Card Number 4111 XXXX XXXX 4821',
    'Minimum Payment Due AED 50.00',
    '05/07/2026 PAYMENT RECEIVED - THANK YOU 1,500.00 CR',
    '06/07/2026 AMAZON REFUND 25.00 CR',
    '07/07/2026 CARREFOUR 40.00 DR',
  ].join('\n'), 'AED');
  const [received, refund, purchase] = cardSettlement.rows;
  ok('a card-statement payment credit becomes the card\'s settlement receipt leg, not income',
    received?.kind === 'cardPayment' && received.type === 'expense' && received.transferHint === true &&
      received.card?.last4 === '4821' && received.card?.kind === 'credit' &&
      received.cardPaymentSide === 'receipt' && received.categoryGuess === 'other',
    JSON.stringify(received));
  ok('a card refund and a card purchase keep their ordinary meaning',
    refund?.kind === 'transaction' && refund.type === 'income' && refund.transferHint === false &&
      purchase?.kind === 'transaction' && purchase.type === 'expense',
    JSON.stringify([refund, purchase]));
  const anonymousCard = parseStatementLines([
    'Credit Card Statement',
    'Minimum Payment Due AED 50.00',
    '05/07/2026 PAYMENT RECEIVED THANK YOU 900.00 CR',
  ].join('\n'), 'AED');
  ok('a card payment on a card statement with no card digits is still a non-income transfer',
    anonymousCard.rows[0]?.kind === 'transaction' && anonymousCard.rows[0].type === 'income' &&
      anonymousCard.rows[0].transferHint === true && anonymousCard.rows[0].categoryGuess === 'other',
    JSON.stringify(anonymousCard.rows[0]));
  const csvSettlement = parseStatementCsv([
    'Date,Description,Debit,Credit',
    '05/07/2026,CREDIT CARD PAYMENT,1500.00,',
  ].join('\n'), 'AED');
  ok('a CSV account-statement card payment is a non-spending transfer too',
    csvSettlement.rows[0]?.transferHint === true && csvSettlement.rows[0].categoryGuess === 'other',
    JSON.stringify(csvSettlement.rows[0]));

  // ── Review follow-ups: one weak marker is not a card statement ──
  const creditLimitAccount = parseStatementLines([
    'Statement of Account',
    'Account Number: XXXXXXXX1234',
    'Available Credit Limit AED 5,000.00',
    'Date Description Debit Credit Balance',
    '01/07/2026 OPENING 100.00 - 9,900.00',
    '02/07/2026 SALARY PAYMENT JULY - 18,500.00 28,400.00',
    '03/07/2026 IPP PAYMENT FROM AHMED - 250.00 28,650.00',
  ].join('\n'), 'AED');
  ok('an account statement mentioning a credit limit keeps salary and incoming payments as income',
    creditLimitAccount.rows.length === 3 &&
      creditLimitAccount.rows.filter((row) => row.type === 'income').every((row) =>
        row.kind === 'transaction' && row.transferHint === false && row.merchant !== 'Card payment'),
    JSON.stringify(creditLimitAccount.rows.map((row) => [row.merchant, row.type, row.transferHint])));
  const creditLimitSigned = parseStatementLines([
    'Statement of Account',
    'Account Number: XXXXXXXX1234',
    'Available Credit Limit AED 5,000.00',
    '05/07/2026 CARREFOUR -40.00',
  ].join('\n'), 'AED');
  ok('an account-labelled statement with one card-ish marker keeps the account sign convention',
    creditLimitSigned.rows.length === 1 && creditLimitSigned.rows[0].type === 'expense' &&
      creditLimitSigned.ambiguousCardSignRows === 0, JSON.stringify(creditLimitSigned));
  const walletRefund = parseStatementLines([
    ...cardHeader,
    'Credit Card Number 4111 XXXX XXXX 4821',
    '05/07/2026 AMAZON PAYMENTS AE 120.00 CR',
  ].join('\n'), 'AED');
  ok('a merchant credit from a payments company on a card statement is not a card settlement',
    walletRefund.rows[0]?.kind === 'transaction' && walletRefund.rows[0].transferHint === false,
    JSON.stringify(walletRefund.rows[0]));
  const balanceProse = parseStatementLines([
    ...cardHeader,
    'A negative amount indicates a credit balance on your account.',
    '05/07/2026 NOON -68.93',
  ].join('\n'), 'AED');
  ok('legend wording about the BALANCE is not a sign legend for rows',
    balanceProse.rows.length === 0 && balanceProse.ambiguousCardSignRows === 1, JSON.stringify(balanceProse));
  const accountLeg = parseStatementLines([
    'Statement of Account',
    'Account Number: XXXXXXXX1234',
    '05/07/2026 CREDIT CARD PAYMENT 4111XXXXXXXX4821 1,500.00 DR',
  ].join('\n'), 'AED');
  ok('an account-side card settlement stays on the paying account as a non-spending transfer',
    accountLeg.rows[0]?.kind === 'transaction' && accountLeg.rows[0].type === 'expense' &&
      accountLeg.rows[0].transferHint === true && accountLeg.rows[0].card?.last4 === '1234',
    JSON.stringify(accountLeg.rows[0]));

  // ── Country date order, sent by the app (x-wafra-date-order) ──
  // The file's own evidence always wins; the country settles only what the
  // file leaves open, and an unknown country still refuses.
  const ambiguousRows = ['Date,Description,Debit,Credit', '01/07/2026,GLOBAL SHOP,24.90,', '02/07/2026,OTHER SHOP,10.00,'].join('\n');
  const usMonthFirst = parseStatementCsv(ambiguousRows, 'USD', 200, 'month-first');
  ok('a month-first country reads an ambiguous USD CSV month-first',
    usMonthFirst.rows.length === 2 && usMonthFirst.rows[0].date === '2026-01-07' &&
      usMonthFirst.rows[1].date === '2026-02-07' && usMonthFirst.ambiguousDateRows === 0,
    JSON.stringify(usMonthFirst.rows.map((row) => row.date)));
  const eurDayFirst = parseStatementCsv(ambiguousRows, 'EUR', 200, 'day-first');
  ok('a day-first country reads the same file day-first in any currency',
    eurDayFirst.rows.length === 2 && eurDayFirst.rows[0].date === '2026-07-01',
    JSON.stringify(eurDayFirst.rows.map((row) => row.date)));
  const unknownCountry = parseStatementCsv(ambiguousRows, 'USD', 200, null);
  ok('an unknown country still refuses ambiguous dates and counts them',
    unknownCountry.rows.length === 0 && unknownCountry.ambiguousDateRows === 2);
  const aedUnknownCountry = parseStatementCsv(ambiguousRows, 'AED', 200, null);
  ok('an explicit unknown country is not overridden by an AED ledger',
    aedUnknownCountry.rows.length === 0 && aedUnknownCountry.ambiguousDateRows === 2);
  const evidenceBeatsCountry = parseStatementCsv([
    'Date,Description,Debit,Credit', '01/07/2026,GLOBAL SHOP,24.90,', '01/13/2026,OTHER SHOP,10.00,',
  ].join('\n'), 'USD', 200, 'day-first');
  ok('a row above 12 still settles the order against the country',
    evidenceBeatsCountry.rows.length === 2 && evidenceBeatsCountry.rows[0].date === '2026-01-07',
    JSON.stringify(evidenceBeatsCountry.rows.map((row) => row.date)));
  const aedCsvText = ['Date,Description,Debit,Credit', '01/07/2026,CARREFOUR,24.90,'].join('\n');
  const aedExplicitDayFirst = parseStatementCsv(aedCsvText, 'AED', 200, 'day-first');
  ok('the UAE country hint reads exactly as the launch AED default did',
    aedExplicitDayFirst.rows[0]?.date === '2026-07-01' &&
      JSON.stringify(aedExplicitDayFirst) === JSON.stringify(parseStatementCsv(aedCsvText, 'AED')));
  const usPdf = parseStatementLines(['01/07/2026 GLOBAL SHOP 24.90 DR', '02/07/2026 OTHER SHOP 10.00 DR'].join('\n'), 'USD', { card: null }, 'month-first');
  ok('PDF rows follow the month-first country too',
    usPdf.rows.length === 2 && usPdf.rows[0].date === '2026-01-07' && usPdf.ambiguousDateRows === 0,
    JSON.stringify(usPdf));
  const sarPdfHinted = parseStatementLines('01/07/2026 PANDA 24.90 DR', 'SAR', { card: null }, 'day-first');
  ok('the Saudi country hint keeps the launch day-first PDF reading',
    sarPdfHinted.rows[0]?.date === '2026-07-01');
  const dottedDates = parseStatementLines(['03.04.2026 REWE MARKT 12.50 DR', '04.04.2026 GEHALT 100.00 CR'].join('\n'), 'EUR', { card: null }, 'day-first');
  ok('dotted numeric dates read under the country order',
    dottedDates.rows.length === 2 && dottedDates.rows[0].date === '2026-04-03' && dottedDates.rejectedRows === 0,
    JSON.stringify(dottedDates));

  // ── Decimal-comma amounts ──
  const commaCsv = parseStatementCsv([
    'Date;Description;Amount',
    '03.04.2026;BÄCKEREI SCHMIDT;-1.234,56',
    '04.04.2026;GEHALT;+2.500,00',
    '05.04.2026;KIOSK;-3,5',
  ].join('\n'), 'EUR', 200, 'day-first');
  ok('decimal-comma CSV amounts are exact',
    commaCsv.rows.length === 3 && commaCsv.rows[0].amountFils === 123456 && commaCsv.rows[0].type === 'expense' &&
      commaCsv.rows[1].amountFils === 250000 && commaCsv.rows[1].type === 'income' &&
      commaCsv.rows[2].amountFils === 350 && commaCsv.rows[0].date === '2026-04-03',
    JSON.stringify(commaCsv.rows.map((row) => [row.date, row.amountFils, row.type])));
  const spaceCsv = parseStatementCsv([
    'Date;Description;Debit;Credit',
    '03/04/2026;LOYER;1 234,56;',
    '04/04/2026;SALAIRE;;2 500,00',
    '05/04/2026;BOULANGERIE;12,40;',
  ].join('\n'), 'EUR', 200, 'day-first');
  ok('space and narrow-no-break-space grouping read in a decimal-comma CSV',
    spaceCsv.rows.length === 3 && spaceCsv.rows[0].amountFils === 123456 &&
      spaceCsv.rows[1].amountFils === 250000 && spaceCsv.rows[2].amountFils === 1240,
    JSON.stringify(spaceCsv.rows.map((row) => row.amountFils)));
  const swissCsv = parseStatementCsv([
    'Date,Description,Debit,Credit',
    "03.04.2026,MIGROS,1'234.56,",
    '04.04.2026,COOP,12.40,',
  ].join('\n'), 'CHF', 200, 'day-first');
  ok('apostrophe grouping reads in a decimal-point CSV',
    swissCsv.rows.length === 2 && swissCsv.rows[0].amountFils === 123456,
    JSON.stringify(swissCsv.rows.map((row) => row.amountFils)));
  const mixedCsv = parseStatementCsv([
    'Date;Description;Debit;Credit',
    '03/04/2026;ONE;1.234,56;',
    '04/04/2026;TWO;12.50;',
  ].join('\n'), 'EUR', 200, 'day-first');
  ok('a file with both decimal marks is not guessed: comma figures are refused',
    mixedCsv.rows.length === 1 && mixedCsv.rows[0].amountFils === 1250 && mixedCsv.rejectedRows === 1,
    JSON.stringify(mixedCsv));
  const onlyAmbiguousCsv = parseStatementCsv([
    'Date,Description,Debit,Credit',
    '03/04/2026,ONE,"1,234",',
  ].join('\n'), 'KWD', 200, 'day-first');
  ok('1,234 alone proves no decimal comma: a KWD file keeps the point reading',
    onlyAmbiguousCsv.rows[0]?.amountFils === 1234000, JSON.stringify(onlyAmbiguousCsv.rows));
  const aedPointUnchanged = parseStatementCsv([
    'Date,Description,Debit,Credit',
    '01/07/2026,CARREFOUR,"1,234.50",',
    '02/07/2026,LULU,12.00,',
  ].join('\n'), 'AED');
  ok('an AED decimal-point CSV reads exactly as before',
    aedPointUnchanged.rows.length === 2 && aedPointUnchanged.rows[0].amountFils === 123450);

  const commaPdf = parseStatementLines([
    'Kontoauszug',
    '03.04.2026 BOULANGERIE PAUL 12,50 DR',
    '04.04.2026 LOYER AVRIL 1.234,56 DR',
    '05.04.2026 SALAIRE 2.500,00 CR',
  ].join('\n'), 'EUR', { card: null }, 'day-first');
  ok('decimal-comma PDF rows are exact',
    commaPdf.rows.length === 3 && commaPdf.rows[0].amountFils === 1250 &&
      commaPdf.rows[1].amountFils === 123456 && commaPdf.rows[2].amountFils === 250000 &&
      commaPdf.rows[2].type === 'income' && commaPdf.rejectedRows === 0,
    JSON.stringify(commaPdf));
  const nbspPdf = parseStatementLines('03/04/2026 LOYER 1 234,56 DR', 'EUR', { card: null }, 'day-first');
  ok('a no-break-space thousands mark reads in a decimal-comma PDF',
    nbspPdf.rows[0]?.amountFils === 123456, JSON.stringify(nbspPdf.rows));
  const spacedPdf = parseStatementLines([
    '03/04/2026 RUE 12 345,00 DR',
    '04/04/2026 BOULANGERIE 12,50 DR',
  ].join('\n'), 'EUR', { card: null }, 'day-first');
  ok('a plain-space group in flattened text is never half-read; its rows are refused and counted',
    spacedPdf.rows.length === 0 && spacedPdf.rejectedRows === 2, JSON.stringify(spacedPdf));
  const commaBalancePdf = parseStatementLines([
    'Date Description Debit Credit Balance',
    '01/04/2026 OPENING BALANCE 1.000,00',
    '02/04/2026 SHOP ONE 10,00 990,00',
    '03/04/2026 SHOP TWO 20,00 970,00',
    '04/04/2026 REFUND 5,00 975,00',
    '05/04/2026 SHOP THREE 25,00 950,00',
    '06/04/2026 SHOP FOUR 50,00 900,00',
  ].join('\n'), 'EUR', { card: null }, 'day-first');
  ok('a decimal-comma running balance still proves each row direction',
    // SHOP ONE steps from the opening balance, which seeds the chain.
    commaBalancePdf.rows.length === 5 && commaBalancePdf.rows[2].merchant === 'REFUND' &&
      commaBalancePdf.rows[2].type === 'income' && commaBalancePdf.rows[2].amountFils === 500 &&
      commaBalancePdf.rows[0].amountFils === 1000 && commaBalancePdf.rows[0].type === 'expense' &&
      commaBalancePdf.rows[1].amountFils === 2000 && commaBalancePdf.rows[1].type === 'expense',
    JSON.stringify(commaBalancePdf.rows.map((row) => [row.merchant, row.amountFils, row.type])));
  const aedPdfUnchanged = parseStatementLines([
    '01/07/2026 CARREFOUR 1,234.50 DR',
    '02/07/2026 SALARY 10,000.00 CR',
  ].join('\n'), 'AED');
  ok('an AED decimal-point PDF reads exactly as before',
    aedPdfUnchanged.rows.length === 2 && aedPdfUnchanged.rows[0].amountFils === 123450 &&
      aedPdfUnchanged.rows[1].amountFils === 1000000 && aedPdfUnchanged.rows[0].date === '2026-07-01');

  // ── Localized month names ──
  const monthCases = [
    ['3 März 2026 REWE 12,50 DR', '2026-03-03'],
    ['03. Dezember 2026 EDEKA 12,50 DR', '2026-12-03'],
    ['1er mars 2026 CARREFOUR 12,50 DR', '2026-03-01'],
    ['3 févr. 2026 FNAC 12,50 DR', '2026-02-03'],
    ['3 août 2026 MONOPRIX 12,50 DR', '2026-08-03'],
    ['3 de marzo de 2026 MERCADONA 12,50 DR', '2026-03-03'],
    ['15 dic 2026 ZARA 12,50 DR', '2026-12-15'],
    ['3 de março de 2026 PINGO DOCE 12,50 DR', '2026-03-03'],
    ['3 out 2026 CONTINENTE 12,50 DR', '2026-10-03'],
    ['3 ottobre 2026 ESSELUNGA 12,50 DR', '2026-10-03'],
    ['3 maart 2026 ALBERT HEIJN 12,50 DR', '2026-03-03'],
    ['3 EKİM 2026 MIGROS 12,50 DR', '2026-10-03'],
    ['3 Ağustos 2026 BIM 12,50 DR', '2026-08-03'],
    ['3 Agustus 2026 INDOMARET 12,50 DR', '2026-08-03'],
    ['3 مارس 2026 كارفور 12,50 DR', '2026-03-03'],
    ['3 تشرين الأول 2026 SPINNEYS 12,50 DR', '2026-10-03'],
    ['3 September 2026 TESCO 12,50 DR', '2026-09-03'],
    ['03-Sept-2026 TESCO 12,50 DR', '2026-09-03'],
  ];
  for (const [line, date] of monthCases) {
    const parsed = parseStatementLines(line, 'EUR', { card: null }, null);
    ok(`named month date reads without a country: ${line.split(' ').slice(0, 3).join(' ')}`,
      parsed.rows.length === 1 && parsed.rows[0].date === date && parsed.rows[0].amountFils === 1250,
      JSON.stringify(parsed));
  }
  const monthFirstEnglish = parseStatementLines('Apr 3, 2026 AMAZON 12.50 DR', 'USD', { card: null }, null);
  ok('an English month-first date reads without a country',
    monthFirstEnglish.rows[0]?.date === '2026-04-03', JSON.stringify(monthFirstEnglish));
  const namedCsv = parseStatementCsv([
    'Date;Description;Amount',
    '3 de marzo de 2026;MERCADONA;-12,50',
    '4 mars 2026;CARREFOUR;-7,00',
  ].join('\n'), 'EUR', 200, null);
  ok('named months read in CSV date cells',
    namedCsv.rows.length === 2 && namedCsv.rows[0].date === '2026-03-03' && namedCsv.rows[1].date === '2026-03-04',
    JSON.stringify(namedCsv.rows.map((row) => row.date)));


  // Accuracy audit: malformed evidence is never an empty cell or a guessed value.
  const auditCsv = (rows, header = 'Date,Description,Debit,Credit') =>
    parseStatementCsv([header, ...rows].join('\n'), 'AED');
  for (const bad of ['garbage', 'USD 5.00', '-5.00', '1.2345']) {
    const result = auditCsv([`2026-09-01,SHOP,10.00,${bad}`]);
    ok(`invalid opposite CSV money cell refuses whole row: ${bad}`, result.rows.length === 0 && result.rejectedRows === 1);
  }
  const summaryCsv = auditCsv([
    '2026-09-01,Opening balance,,1000.00',
    '2026-09-01,SHOP,10.00,',
    '2026-09-02,Closing balance,,990.00',
    '2026-09-02,Total debits,10.00,',
    '2026-09-02,TOTAL ENERGIES FUEL,50.00,',
  ]);
  ok('CSV account summaries never create income or duplicate expenses', summaryCsv.rows.length === 2 && summaryCsv.totalRows === 2 && summaryCsv.rejectedRows === 0);
  const mixedDateAudit = auditCsv([
    '25/09/2026,DAY FIRST,10.00,', '09/26/2026,MONTH FIRST,10.00,', '03/04/2026,AMBIGUOUS,10.00,',
  ]);
  ok('contradictory date evidence never silently chooses a country for ambiguous rows',
    mixedDateAudit.rows.length === 2 && mixedDateAudit.ambiguousDateRows === 1 && mixedDateAudit.rejectedRows === 1);
  for (const money of ['+-10.00', '-+10.00', '(+10.00)', 'AED -+10.00']) {
    const result = auditCsv([`2026-09-01,SHOP,${money}`], 'Date,Description,Amount');
    ok(`contradictory CSV signs are rejected: ${money}`, result.rows.length === 0 && result.rejectedRows === 1);
  }
  const foreignJoined = parseStatementLines('2026-09-01 SHOP USD10.00 DR', 'AED');
  ok('attached foreign currency in PDF is never converted to ledger currency', foreignJoined.rows.length === 0 && foreignJoined.rejectedRows === 1);
  const localJoined = parseStatementLines('2026-09-01 SHOP AED10.00 DR', 'AED');
  ok('attached matching currency remains exact', localJoined.rows[0]?.amountFils === 1000);
  let multiRejected = false;
  try { parseStatementLines('Account Number XXXX1234\n2026-09-01 SHOP 10.00 DR\nAccount Number XXXX5678\n2026-09-02 SHOP 20.00 DR', 'AED'); }
  catch (error) { multiRejected = error.message === 'multiple_statement_accounts'; }
  ok('multi-account PDF refuses instead of assigning all sections to the first account', multiRejected);
  const repeatedAccount = parseStatementLines('Account Number XXXX1234\n2026-09-01 SHOP 10.00 DR\nAccount Number XXXX1234\n2026-09-02 SHOP 20.00 DR', 'AED');
  ok('repeated same-account page headers remain supported', repeatedAccount.rows.length === 2 && repeatedAccount.rows.every(row => row.card?.last4 === '1234'));
  const longAudit = parseStatementLines(`2026-09-01 ${'A'.repeat(410)} 10.00 DR\n2026-09-02 SHOP 5.00 DR`, 'AED');
  ok('overlong transaction lines are counted as rejected instead of complete coverage', longAudit.rows.length === 1 && longAudit.totalRows === 2 && longAudit.rejectedRows === 1);
  const arabicAudit = parseStatementLines('٢٠٢٦-٠٩-٠١ SHOP ١٠٫٠٠ DR', 'AED');
  ok('Arabic digits on PDF dates and amounts are normalized before row recognition', arabicAudit.rows[0]?.date === '2026-09-01' && arabicAudit.rows[0]?.amountFils === 1000);


  let multiPageError = '';
  try { await extractPdfStatementRows(pagedPdf([
    ['Account Number XXXX1234', '2026-09-01 SHOP 10.00 DR'],
    ['Account Number XXXX5678', '2026-09-02 SHOP 20.00 DR'],
  ]), 'AED'); } catch (error) { multiPageError = error.message; }
  ok('actual multipage PDF refuses mixed source accounts', multiPageError === 'multiple_statement_accounts');
  const repeatedPages = await extractPdfStatementRows(pagedPdf([
    ['Account Number XXXX1234', '2026-09-01 SHOP 10.00 DR'],
    ['Account Number XXXX1234', '2026-09-02 SHOP 20.00 DR'],
  ]), 'AED');
  ok('actual multipage PDF preserves repeated same-account pages', repeatedPages.pages === 2 && repeatedPages.rows.length === 2 && repeatedPages.completeRowAccounting === true);
  const blankPage = await extractPdfStatementRows(pagedPdf([
    ['2026-09-01 SHOP 10.00 DR'], [],
  ]), 'AED');
  ok('a page with no extractable text cannot prove complete PDF coverage', blankPage.rows.length === 1 && blankPage.completeRowAccounting === false);
  const unsupportedDateRow = parseStatementLines('01/09 SHOP 10.00 DR\n2026-09-02 SHOP 20.00 DR', 'AED');
  ok('unsupported yearless transaction date is counted rather than silently covered', unsupportedDateRow.rows.length === 1 && unsupportedDateRow.rejectedRows === 1);
  let duplicateColumnsError = '';
  try { auditCsv(['2026-09-01,SHOP,10.00,500.00,'], 'Date,Description,Debit,Debit,Credit'); }
  catch (error) { duplicateColumnsError = error.message; }
  ok('duplicate financial columns cannot silently choose one amount', duplicateColumnsError === 'unsupported_statement_format');
  let changedColumnsError = '';
  try { auditCsv(['2026-09-01,SHOP,10.00,', 'Date,Description,Credit,Debit', '2026-09-02,SHOP,20.00,']); }
  catch (error) { changedColumnsError = error.message; }
  ok('changed CSV column order cannot invert later sections', changedColumnsError === 'unsupported_statement_format');
  const sameHeader = auditCsv(['2026-09-01,SHOP,10.00,', 'Date,Description,Debit,Credit', '2026-09-02,SHOP,20.00,']);
  ok('repeated identical CSV page headings are not missing transactions', sameHeader.rows.length === 2 && sameHeader.rejectedRows === 0 && sameHeader.totalRows === 2);


  const creditBalances = parseStatementLines([
    'Date Description Debit Credit Balance',
    ...Array.from({length: 6}, (_,index) => `2026-09-0${index+1} SHOP 10.00 ${100-index*10}.00 CR`),
  ].join('\n'), 'AED');
  ok('credit balance suffix never turns balance-decreasing purchases into income',
    creditBalances.rows.length === 5 && creditBalances.rows.every(row => row.type === 'expense' && row.amountFils === 1000) && creditBalances.rejectedRows === 1);
  const debitBalances = parseStatementLines([
    'Date Description Debit Credit Balance',
    ...Array.from({length: 6}, (_,index) => `2026-09-0${index+1} SHOP 10.00 ${100-index*10}.00 DR`),
  ].join('\n'), 'AED');
  ok('ambiguous debit balance versus transaction labels are refused', debitBalances.rows.length === 0 && debitBalances.rejectedRows === 6);


  const changedPdfColumns = parseStatementLines([
    'Date Description Debit Credit Balance', '2026-09-01 SHOP 10.00 - 990.00',
    'Date Description Credit Debit Balance', '2026-09-02 SALARY 20.00 - 1010.00',
    '2026-09-03 SHOP 5.00 DR',
  ].join('\n'), 'AED');
  ok('mixed PDF column layouts cannot invert later sections', changedPdfColumns.rows.length === 1 && changedPdfColumns.rows[0].amountFils === 500 && changedPdfColumns.rejectedRows === 2);
  const integerRejected = parseStatementLines('2026-09-01 SHOP 100', 'JPY');
  ok('unresolved integer-money rows in zero-decimal statements are counted', integerRejected.rows.length === 0 && integerRejected.rejectedRows === 1);


  for (const kind of ['CSV', 'PDF']) {
    let currencyError = '';
    try {
      if (kind === 'CSV') parseStatementCsv('Account currency:,USD\nDate,Description,Debit,Credit\n2026-09-01,SHOP,10.00,', 'AED');
      else parseStatementLines('Statement currency: USD\n2026-09-01 SHOP 10.00 DR', 'AED');
    } catch (error) { currencyError = error.message; }
    ok(`explicit ${kind} metadata currency cannot be relabelled to ledger currency`, currencyError === 'statement_currency_mismatch');
  }
  const metadataCurrencyMatches = parseStatementCsv('Account currency:,AED\nDate,Description,Debit,Credit\n2026-09-01,SHOP,10.00,', 'AED');
  ok('matching metadata currency remains importable', metadataCurrencyMatches.rows[0]?.amountFils === 1000);
  const shortAccountPages = 'Account: XXXX1234\n2026-09-01 SHOP 10.00 DR\nAccount: XXXX5678\n2026-09-02 SHOP 20.00 DR';
  let shortAccountError = '';
  try { parseStatementLines(shortAccountPages, 'AED'); } catch (error) { shortAccountError = error.message; }
  ok('short labelled multi-account sections cannot inherit first account', shortAccountError === 'multiple_statement_accounts');


  for (const label of ['Currency:USD', 'Account currency=USD', 'Statement currency-USD', 'Currency USD']) {
    let metadataError = '';
    try { parseStatementLines(`${label}\n2026-09-01 SHOP 10.00 DR`, 'AED'); }
    catch (error) { metadataError = error.message; }
    ok(`compact metadata currency rejects mismatched denomination: ${label}`, metadataError === 'statement_currency_mismatch');
  }


  for (const status of ['Pending','Declined','Cancelled','Unknown','']) {
    const result=auditCsv([`2026-09-01,CAFE,25.00,,${status}`],'Date,Description,Debit,Credit,Status');
    ok(`explicit non-posted CSV status cannot create ledger money: ${status || 'blank'}`,result.rows.length===0 && result.rejectedRows===1);
  }
  const postedStatuses=auditCsv(['Posted','Completed','Cleared','Settled'].map(status=>`2026-09-01,CAFE,25.00,,${status}`),'Date,Description,Debit,Credit,Transaction Status');
  ok('explicit completed CSV statuses remain importable',postedStatuses.rows.length===4 && postedStatuses.rejectedRows===0);
  const pendingMerchant=auditCsv(['2026-09-01,Pending Cafe,25.00,']);
  ok('merchant names never stand in for posting status',pendingMerchant.rows.length===1);
  for (const amount of ['USD10.00','USD 10.00']) {
    const result=parseStatementLines(`Date Description Amount Balance\n2026-09-01 SHOP ${amount} 100.00 DR`,'AED');
    ok(`explicit balance column is not a local posted amount after ${amount}`,result.rows.length===0 && result.rejectedRows===1);
  }


  /* ── Statement-import audit (2026-10): one regression per confirmed defect ── */
  const enbdCard = [
    'Emirates NBD',
    'Credit Card Statement',
    'Card Number: 4567 XXXX XXXX 1234',
    'Statement Date: 25/09/2026',
    'Payment Due Date: 20/10/2026',
    'Total Amount Due: AED 3,456.78',
    'Minimum Amount Due: AED 172.84',
    'Credit Limit: AED 30,000.00',
    'Transaction Date Description Amount (AED)',
    '27/08/2026 CARREFOUR MOE DUBAI ARE 245.50',
    '05/09/2026 NOON.COM DUBAI ARE 189.00',
    '10/09/2026 SPOTIFY STOCKHOLM USD 20.00 73.60',
  ].join('\n');
  const enbdParsed = parseStatementLines(enbdCard, 'AED');
  const enbdTx = enbdParsed.rows.filter((row) => row.kind === 'transaction');

  // 1: statement descriptors are titled like SMS merchants.
  ok('audit 1: trailing city/country/host noise is peeled from statement merchant titles',
    enbdTx[0]?.merchant === 'CARREFOUR MOE' && enbdTx[1]?.merchant === 'NOON' &&
      enbdTx[0]?.categoryGuess === 'groceries' && enbdTx[1]?.categoryGuess === 'shopping',
    JSON.stringify(enbdTx.map((row) => [row.merchant, row.categoryGuess])));
  const saudiTitle = parseStatementLines([
    'Credit Card Statement', 'Card Number: 4321 XXXX XXXX 1234', 'Minimum Amount Due: SAR 100.00',
    '01/09/2026 PANDA RIYADH SAU 101.00', '02/09/2026 DUBAI 5.00',
  ].join('\n'), 'SAR');
  ok('audit 1: Saudi city tails peel, and a name that is only a city is kept',
    saudiTitle.rows[0]?.merchant === 'PANDA' && saudiTitle.rows[1]?.merchant === 'DUBAI',
    JSON.stringify(saudiTitle.rows.map((row) => row.merchant)));

  // 3: CSV preamble identity.
  const preambleCard = parseStatementCsv([
    'Emirates NBD Credit Card Statement',
    'Card Number,4567XXXXXXXX1234',
    'Statement Date,25/09/2026',
    'Transaction Date,Description,Debit,Credit',
    '27/08/2026,CARREFOUR MOE DUBAI,245.50,',
  ].join('\n'), 'AED');
  ok('audit 3: a CSV card number printed above the table identifies every row as that credit card',
    preambleCard.rows[0]?.card?.last4 === '1234' && preambleCard.rows[0]?.card?.kind === 'credit' &&
      preambleCard.rows[0]?.bankHint === 'Emirates NBD',
    JSON.stringify(preambleCard.rows[0]));
  const preambleAccount = parseStatementCsv([
    'كشف حساب',
    'رقم الحساب,XXXXXXXX4455',
    'التاريخ,البيان,مدين,دائن,الرصيد',
    '2026-09-02,شراء JARIR BOOKSTORE,125.50,,"15,874.50"',
  ].join('\n'), 'SAR');
  ok('audit 3: an Arabic account-number preamble identifies the account',
    preambleAccount.rows[0]?.card?.last4 === '4455' && preambleAccount.rows[0]?.card?.kind === 'account',
    JSON.stringify(preambleAccount.rows[0]?.card));
  const twoPreambleAccounts = parseStatementCsv([
    'Account Number,XXXX1001', 'Account Number,XXXX2002',
    'Date,Description,Debit,Credit', '2026-09-02,SHOP,10.00,',
  ].join('\n'), 'AED');
  ok('audit 3: two different preamble accounts identify nothing',
    twoPreambleAccounts.rows[0]?.card === null, JSON.stringify(twoPreambleAccounts.rows[0]?.card));

  // 4: IBANs.
  const ibanBody = '\nDate Description Debit Credit Balance\n03/09/2026 PANDA RIYADH 245.00 0.00 14,755.00';
  for (const [head, last4] of [
    ['Account Number: SA0380000000608010167519', '7519'],
    ['IBAN: SA03 8000 0000 6080 1016 7519', '7519'],
    ['IBAN: AE07 0331 2345 6789 0123 456', '3456'],
    ['IBAN: SA03 8000 0000 6080 1016 7519 SAR', '7519'],
  ]) {
    const result = parseStatementLines(head + ibanBody, 'SAR');
    ok(`audit 4: an IBAN identifies the account: ${head}`,
      result.rows[0]?.card?.last4 === last4 && result.rows[0]?.card?.kind === 'account',
      JSON.stringify(result.rows[0]?.card));
  }

  // 5: a statement body is a statement, not one alert (route: worker.test.js).
  const { looksLikeStatementBody } = require('../.test-build/imports.cjs');
  ok('audit 5: a forwarded card statement body is recognised as a statement',
    looksLikeStatementBody(normalizeEmailContent(enbdCard, null)));
  ok('audit 5: a single bank alert is not',
    !looksLikeStatementBody('Purchase of AED 245.50 with Credit Card ending 1234 at CARREFOUR on 27/08/2026. Avl Cr. Limit AED 27,754.50') &&
      !looksLikeStatementBody('Your Credit Card ending 1234 statement: Total amount due AED 3,456.78. Minimum amount due AED 172.84. Payment due date 20/10/2026.'));

  // 6: card-side payment wording on a proven card statement.
  const cardHead = 'Credit Card Statement\nCard Number: 4567 XXXX XXXX 1234\nStatement Date: 25/09/2026\nMinimum Amount Due: AED 100.00\n';
  for (const wording of ['ONLINE PAYMENT', 'CREDIT CARD PAYMENT', 'CC PAYMENT', 'MOBILE BANKING PAYMENT',
    'IB PAYMENT FROM A/C XXX1001', 'CASH DEPOSIT CDM', 'CAPITAL ONE MOBILE PYMT', 'CHASE AUTOPAY']) {
    const row = parseStatementLines(`${cardHead}22/09/2026 ${wording} 500.00 CR`, 'AED').rows[0];
    ok(`audit 6: "${wording}" on a card statement is the card's settlement, not income`,
      row?.kind === 'cardPayment' && row.cardPaymentSide === 'receipt' && row.card?.kind === 'credit', JSON.stringify(row));
  }
  for (const wording of ['REFUND AMAZON.AE', 'CASHBACK', 'REVERSAL LATE PAYMENT FEE']) {
    const row = parseStatementLines(`${cardHead}22/09/2026 ${wording} 500.00 CR`, 'AED').rows[0];
    ok(`audit 6: "${wording}" stays a credit, not a settlement`, row?.kind === 'transaction' && row.type === 'income');
  }
  const cardColumnCsv = parseStatementCsv([
    'Generated on 26/09/2026',
    'Transaction Date,Card Number,Description,Debit,Credit',
    '27/08/2026,4567XXXXXXXX1234,CARREFOUR MOE DUBAI,245.50,',
    '22/09/2026,4567XXXXXXXX1234,PAYMENT RECEIVED - THANK YOU,,500.00',
  ].join('\n'), 'AED');
  ok('audit 6: a plain Card Number column plus a payment-received row is a credit card statement',
    cardColumnCsv.rows[0]?.card?.kind === 'credit' && cardColumnCsv.rows[1]?.kind === 'cardPayment',
    JSON.stringify(cardColumnCsv.rows));

  // 7: salary over a transfer rail is income.
  for (const wording of ['SALARY TRANSFER ACME', 'WPS SALARY TRANSFER', 'INWARD TRANSFER SALARY SEP']) {
    const row = parseStatementLines(
      `Account Statement\nAccount Number: 12345678901001\nDate Description Debit Credit Balance\n01/09/2026 ${wording} - 15,000.00 25,000.00`,
      'AED').rows[0];
    ok(`audit 7: "${wording}" is salary income`,
      row?.type === 'income' && row.categoryGuess === 'salary' && row.transferHint === false, JSON.stringify(row));
  }
  const ownTransfer = parseStatementLines(
    'Date Description Debit Credit Balance\n01/09/2026 FUNDS TRANSFER FROM 1002 - 500.00 25,000.00', 'AED').rows[0];
  ok('audit 7: an ordinary incoming transfer stays a transfer', ownTransfer?.transferHint === true);
  for (const wording of ['OWN ACCOUNT TRANSFER SALARY SEP', 'TRANSFER FROM SALARY ACCOUNT 1002']) {
    const row = parseStatementLines(
      `Date Description Debit Credit Balance\n01/09/2026 ${wording} - 500.00 25,000.00`, 'AED').rows[0];
    ok(`audit 7: "${wording}" is a move between own accounts, not salary`, row?.transferHint === true, JSON.stringify(row));
  }
  const longRemittance = 'INWARD REMITTANCE REF FT26251ABCD1234 FROM ACME GENERAL TRADING LLC DUBAI UNITED ARAB EMIRATES ' +
    'BENEFICIARY JOHN SMITH PURPOSE SALARY SEPTEMBER 2026 VIA ENBD ACCOUNT XXXX5566 OK';
  const longTitle = parseStatementCsv(`Date,Description,Debit,Credit\n01/09/2026,${longRemittance},,"15,000.00"`, 'AED');
  ok('audit 7: a long salary narration keeps its money with a title the relay accepts',
    longTitle.rows[0]?.categoryGuess === 'salary' && longTitle.rows[0].merchant.length <= 160 &&
      longTitle.rows[0].merchant === longTitle.rows[0].merchant.trim(),
    JSON.stringify(longTitle.rows[0]));

  // 8: US/UK sign conventions and account-side card bills.
  const amex = parseStatementCsv([
    'Date,Description,Amount',
    '09/02/2026,WHOLE FOODS MARKET,84.12',
    '09/10/2026,AUTOPAY PAYMENT - THANK YOU,-1200.00',
    '09/12/2026,AMAZON MARKETPLACE REFUND,-25.99',
  ].join('\n'), 'USD', 200, 'month-first');
  ok('audit 8: an Amex-style export reads plain charges and negative credits',
    amex.rows.length === 3 && amex.rows[0].type === 'expense' && amex.rows[1].transferHint === true &&
      amex.rows[2].type === 'income' && amex.ambiguousCardSignRows === 0,
    JSON.stringify(amex.rows.map((row) => [row.merchant, row.type, row.transferHint])));
  const chaseCard = parseStatementCsv([
    'Transaction Date,Post Date,Description,Category,Type,Amount,Memo',
    '09/02/2026,09/03/2026,WHOLEFDS MKT 10234,Groceries,Sale,-84.12,',
    '09/10/2026,09/10/2026,Payment Thank You-Mobile,,Payment,1200.00,',
    '09/12/2026,09/13/2026,AMAZON MKTPL*AB12C,Shopping,Return,25.99,',
    '09/15/2026,09/16/2026,LATE FEE,Fees & Adjustments,Fee,-39.00,',
  ].join('\n'), 'USD', 200, 'month-first');
  ok('audit 8/14: a Chase-style card export reads negative charges and its Payment/Return types as credits',
    chaseCard.rows.length === 4 && chaseCard.rows[0].type === 'expense' && chaseCard.rows[1].transferHint === true &&
      chaseCard.rows[2].type === 'income' && chaseCard.rows[3].type === 'expense',
    JSON.stringify(chaseCard.rows.map((row) => [row.merchant, row.type, row.transferHint])));
  const genericBank = parseStatementCsv([
    'Date,Description,Amount',
    '2026-09-02,ACME LTD SALARY,2500.00',
    '2026-09-03,TESCO STORES 3021,-23.40',
    '2026-09-04,BARCLAYCARD PAYMENT,-300.00',
  ].join('\n'), 'GBP', 200, 'day-first');
  ok('audit 8: a generic bank export accepts credits without a plus and files the card bill as a settlement',
    genericBank.rows.length === 3 && genericBank.rows[0].type === 'income' && genericBank.rows[0].categoryGuess === 'salary' &&
      genericBank.rows[1].type === 'expense' && genericBank.rows[1].transferHint === false &&
      genericBank.rows[2].transferHint === true && genericBank.rows[2].merchant === 'Card payment',
    JSON.stringify(genericBank.rows.map((row) => [row.merchant, row.type, row.transferHint])));
  const unproven = parseStatementCsv([
    'Date,Description,Amount', '2026-09-02,ACME LTD,2500.00', '2026-09-03,TESCO STORES 3021,-23.40',
  ].join('\n'), 'GBP', 200, 'day-first');
  ok('audit 8: a plain figure with no income or balance proof is still refused',
    unproven.rows.length === 1 && unproven.rejectedRows === 1, JSON.stringify(unproven.rows));
  for (const wording of ['CHASE CREDIT CRD AUTOPAY', 'BARCLAYCARD PAYMENT', 'SADAD CREDIT CARD 1234']) {
    const row = parseStatementLines(
      `Account Statement\nAccount Number: 12345678901001\n02/09/2026 ${wording} 2,000.00 DR`, 'AED').rows[0];
    ok(`audit 8: "${wording}" on an account statement is a card-settlement debit leg`,
      row?.type === 'expense' && row.transferHint === true && row.merchant === 'Card payment', JSON.stringify(row));
  }

  const amexMerchant = parseStatementLines(
    'Account Statement\nAccount Number: 12345678901001\n02/09/2026 AMEX TRAVEL 2,000.00 DR', 'AED').rows[0];
  ok('audit 8: a merchant that merely starts with an issuer name stays spending',
    amexMerchant?.transferHint === false && amexMerchant.merchant === 'AMEX TRAVEL', JSON.stringify(amexMerchant));

  // 9: transaction date + posting date.
  const twoDates = parseStatementLines([
    'Credit Card Statement', 'Card Number 5432 10XX XXXX 9876', 'Minimum Payment Due AED 250.00',
    'Transaction Date Posting Date Description Amount (AED)',
    '03/09/2026 04/09/2026 CARREFOUR CITY CENTRE DEIRA 230.75',
    '14/09/2026 15/09/2026 REFUND TALABAT 64.00 CR',
  ].join('\n'), 'AED');
  ok('audit 9: the first of two dates is the transaction date and the posting date leaves the merchant',
    twoDates.rows[0]?.date === '2026-09-03' && twoDates.rows[0]?.merchant === 'CARREFOUR CITY CENTRE DEIRA' &&
      twoDates.rows[1]?.date === '2026-09-14' && twoDates.rows[1]?.type === 'income' &&
      !/\d{2}\/\d{2}/.test(twoDates.rows[1]?.merchant),
    JSON.stringify(twoDates.rows.map((row) => [row.date, row.merchant])));

  // 10: the statement's own due.
  const due = enbdParsed.rows.find((row) => row.kind === 'cardStatement');
  ok('audit 10: a card statement with total, minimum and due date emits one cardStatement row',
    enbdParsed.rows.filter((row) => row.kind === 'cardStatement').length === 1 &&
      due.amountFils === 345678 && due.minDueFils === 17284 && due.date === '2026-10-20' && due.dueDay === 20 &&
      due.card?.last4 === '1234' && due.card?.kind === 'credit' && due.statementDate === '2026-09-25' &&
      due.type === 'expense' && due.transferHint === false && due.categoryGuess === 'other',
    JSON.stringify(due));
  const noMinimum = parseStatementLines(enbdCard.replace(/Minimum Amount Due:.*\n/, ''), 'AED');
  ok('audit 10: no stated minimum, no due row', !noMinimum.rows.some((row) => row.kind === 'cardStatement'));
  const accountNoDue = parseStatementLines(
    'Account Statement\nAccount Number: 12345678901001\nPayment Due Date: 20/10/2026\nTotal Amount Due: AED 100.00\nMinimum Amount Due: AED 10.00\n01/09/2026 SHOP 10.00 DR', 'AED');
  ok('audit 10: an account statement never emits a card due', !accountNoDue.rows.some((row) => row.kind === 'cardStatement'));
  const csvDue = parseStatementCsv([
    'Credit Card Statement', 'Card Number,4567XXXXXXXX1234', 'Statement Date,25/09/2026',
    'Payment Due Date,20/10/2026', 'Total Amount Due,"3,456.78"', 'Minimum Amount Due,172.84',
    'Transaction Date,Description,Debit,Credit', '27/08/2026,CARREFOUR,245.50,',
  ].join('\n'), 'AED');
  const csvDueRow = csvDue.rows.find((row) => row.kind === 'cardStatement');
  ok('audit 10: a CSV preamble summary emits the same cardStatement row',
    csvDueRow?.amountFils === 345678 && csvDueRow?.minDueFils === 17284 && csvDueRow?.date === '2026-10-20' &&
      csvDue.totalRows === csvDue.rows.length + csvDue.rejectedRows,
    JSON.stringify(csvDueRow));

  const fullStatement = parseStatementLines(enbdCard.split('\n').slice(0, 9).join('\n') + '\n' +
    Array.from({ length: 200 }, (_, index) => `01/09/2026 SHOP ${index} 1.00`).join('\n'), 'AED');
  ok('audit 10: a statement already at the 200-row ceiling keeps its rows and skips the due row',
    fullStatement.rows.length === 200 && fullStatement.totalRows === 200 &&
      !fullStatement.rows.some((row) => row.kind === 'cardStatement'));

  // 11: blank debit/credit cells after an opening balance.
  const blankCells = parseStatementLines([
    'Account Statement', 'Account Number: 12345678901001',
    'Date Description Debit Credit Balance',
    '01/09/2026 Opening Balance 10,000.00',
    '01/09/2026 SALARY ACME TRADING LLC 15,000.00 25,000.00',
    '02/09/2026 CARREFOUR 2,000.00 23,000.00',
    '03/09/2026 ATM WITHDRAWAL 500.00 22,500.00',
    '05/09/2026 LULU HYPERMARKET 312.40 22,187.60',
    '08/09/2026 DEWA BILL PAYMENT 450.00 21,737.60',
  ].join('\n'), 'AED');
  ok('audit 11: the first row after Opening Balance steps from it and is not lost',
    blankCells.rows.length === 5 && blankCells.rejectedRows === 0 &&
      blankCells.rows[0].type === 'income' && blankCells.rows[0].amountFils === 1500000,
    JSON.stringify(blankCells.rows.map((row) => [row.merchant, row.type, row.amountFils])));

  // 14: credit kind, banks, FX, symbols, Barclays memo.
  const noPayment = parseStatementLines(
    'Credit Card Statement\nCard Number: 4567 XXXX XXXX 1234\nCredit Limit: AED 30,000.00\n05/09/2026 NOON 189.00', 'AED');
  ok('audit 14: a proven credit card statement without a payment row is still a credit card',
    noPayment.rows[0]?.card?.kind === 'credit', JSON.stringify(noPayment.rows[0]?.card));
  for (const [letterhead, bank] of [['ADCB', 'ADCB'], ['Abu Dhabi Islamic Bank', 'ADIB'], ['Dubai Islamic Bank', 'DIB'],
    ['Al Rajhi Bank', 'Al Rajhi'], ['Liv. by Emirates NBD', 'Liv'], ['Capital One', 'Capital One'], ['Nationwide', 'Nationwide']]) {
    const row = parseStatementLines(`${letterhead}\nAccount Statement\n01/09/2026 SHOP 10.00 DR`, 'AED').rows[0];
    ok(`audit 14: bank letterhead "${letterhead}" names ${bank}`, row?.bankHint === bank, row?.bankHint);
  }
  const rowNamesBank = parseStatementLines('Account Statement\n01/09/2026 ADCB ATM MARINA 10.00 DR', 'AED').rows[0];
  ok('audit 14: a bank named only inside a row is not the statement bank', rowNamesBank?.bankHint === undefined);
  const spotify = enbdTx[2];
  ok('audit 14: a foreign card row keeps the local amount and carries the original as bank FX',
    spotify?.amountFils === 7360 && spotify.originalCurrency === 'USD' && spotify.originalMinorUnits === 2000 &&
      spotify.originalExponent === 2 && spotify.originalAmountMinor === 2000 && spotify.fxSource === 'bank' &&
      Math.abs(spotify.fxRate - 3.68) < 1e-9 && !/USD/.test(spotify.merchant),
    JSON.stringify(spotify));
  const pounds = parseStatementCsv([
    'Date,Transaction type,Description,Paid out,Paid in,Balance',
    '02 Sep 2026,Visa purchase,TESCO STORES 3021,£23.40,,"£1,211.16"',
    '05 Sep 2026,Bank credit,ACME LTD SALARY,,"£2,500.00","£3,711.16"',
  ].join('\n'), 'GBP', 200, 'day-first');
  ok('audit 14: £-prefixed amounts read in a GBP ledger',
    pounds.rows.length === 2 && pounds.rows[0].amountFils === 2340 && pounds.rows[1].type === 'income',
    JSON.stringify(pounds));
  const wrongSymbol = parseStatementCsv('Date,Description,Debit,Credit\n2026-09-02,SHOP,£23.40,', 'AED');
  ok('audit 14: a £ amount never reads into an AED ledger', wrongSymbol.rows.length === 0 && wrongSymbol.rejectedRows === 1);
  const barclays = parseStatementCsv([
    'Number,Date,Account,Amount,Subcategory,Memo',
    ',02/09/2026,20-00-00 12345678,-23.40,PAYMENT,TESCO STORES 3021',
    ',05/09/2026,20-00-00 12345678,2500.00,DIRECTDEP,ACME LTD SALARY',
  ].join('\n'), 'GBP', 200, 'day-first');
  ok('audit 14: a Barclays export uses its Memo column as the description',
    barclays.rows.length === 2 && barclays.rows[0].merchant === 'TESCO STORES 3021' && barclays.rows[1].type === 'income',
    JSON.stringify(barclays.rows));


  /* ── Independent review of the audit fixes: one regression per finding ── */
  const accountAutopay = parseStatementCsv([
    'Account Number,XXXXXX4455',
    'Date,Description,Amount',
    '09/01/2026,VERIZON WIRELESS AUTOPAY,-85.00',
    '09/03/2026,GEICO AUTOPAY,-120.00',
    '09/15/2026,ACME CORP DIR DEP PPD,2500.00',
  ].join('\n'), 'USD', 200, 'month-first');
  ok('review 1: an account-labelled export with AUTOPAY bills is never re-read as a card export',
    accountAutopay.rows.length === 3 &&
      accountAutopay.rows[0].type === 'expense' && accountAutopay.rows[0].transferHint === false &&
      accountAutopay.rows[1].type === 'expense' && accountAutopay.rows[2].type === 'income',
    JSON.stringify(accountAutopay.rows.map((row) => [row.merchant, row.type, row.transferHint])));
  const accountThankYou = parseStatementCsv([
    'Account Number,XXXXXX9911',
    'Date,Description,Amount',
    '02/09/2026,TESCO STORES 3021,-23.40',
    '05/09/2026,PAYMENT RECEIVED - THANK YOU JOHN SMITH,250.00',
  ].join('\n'), 'GBP', 200, 'day-first');
  ok('review 1: a "payment received" credit on an account export stays money in, not a card settlement',
    !accountThankYou.rows.some((row) => row.kind === 'cardPayment' || row.transferHint),
    JSON.stringify(accountThankYou.rows));
  const cardColumnAutopay = parseStatementCsv([
    'Date,Description,Card Number,Amount',
    '01/09/2026,CARREFOUR,XXXX1234,-120.00',
    '02/09/2026,DU AUTOPAY,XXXX1234,-200.00',
  ].join('\n'), 'AED');
  ok('review 2: a bill AUTOPAY row does not turn a card-column export into a refused card statement',
    cardColumnAutopay.rows.length === 2 && cardColumnAutopay.ambiguousCardSignRows === 0 &&
      cardColumnAutopay.rows.every((row) => row.type === 'expense'),
    JSON.stringify(cardColumnAutopay));
  let cardWithIbanError = '';
  let cardWithIban = null;
  try {
    cardWithIban = parseStatementLines([
      'Credit Card Statement', 'Card Number: 4567 XXXX XXXX 1234', 'Credit Limit 10,000.00',
      'Account Number: AE070331234567890123456', '05/09/2026 CARREFOUR 120.00',
    ].join('\n'), 'AED');
  } catch (error) { cardWithIbanError = error.message; }
  ok('review 3: a card statement that also prints an IBAN is one card, not multiple accounts',
    cardWithIbanError === '' && cardWithIban?.rows[0]?.card?.last4 === '1234', cardWithIbanError);
  const priorBalance = parseStatementLines([
    'Credit Card Statement', 'Card Number: 4567 XXXX XXXX 1234',
    'Previous Statement Balance AED 3,000.00', 'Statement Balance AED 1,200.00',
    'Minimum Payment Due AED 60.00', 'Payment Due Date 20/10/2026',
    '05/09/2026 CARREFOUR 120.00',
  ].join('\n'), 'AED').rows.find((row) => row.kind === 'cardStatement');
  ok('review 4: the previous statement balance is never the amount due',
    priorBalance?.amountFils === 120000, JSON.stringify(priorBalance));
  const creditBalance = parseStatementLines([
    'Credit Card Statement', 'Card Number: 4567 XXXX XXXX 1234',
    'New Balance -380.00', 'Minimum Payment Due 0.00', 'Payment Due Date 20/10/2026',
    '05/09/2026 REFUND SHOP 500.00 CR',
  ].join('\n'), 'AED');
  ok('review 4: a minus-signed new balance is a credit balance and emits no due',
    !creditBalance.rows.some((row) => row.kind === 'cardStatement'), JSON.stringify(creditBalance.rows));
  const monzoChase = parseStatementLines(
    'Monzo Bank Ltd\nMr Chase Thompson\n12 Chase Side\nAccount Statement\n2026-09-01 SHOP 10.00 DR', 'GBP').rows[0];
  ok('review 5: the earliest bank-shaped name wins and a person or street called Chase is not a bank',
    monzoChase?.bankHint === 'Monzo', monzoChase?.bankHint);
  const chaseBank = parseStatementLines('JPMorgan Chase Bank, N.A.\nAccount Statement\n2026-09-01 SHOP 10.00 DR', 'USD').rows[0];
  ok('review 5: "JPMorgan Chase" is still Chase', chaseBank?.bankHint === 'Chase', chaseBank?.bankHint);
  const arabicRowCard = parseStatementLines(
    'كشف حساب\nرقم الحساب: 1234567890\n05/09/2026 شراء رقم البطاقة 4321 كارفور 120.00 DR', 'SAR').rows[0];
  ok('review 6: a card number printed inside a transaction row never becomes the statement identity',
    arabicRowCard?.card?.last4 === '7890' && arabicRowCard?.card?.kind === 'account',
    JSON.stringify(arabicRowCard?.card));
  const topUp = parseStatementLines([
    'Credit Card Statement', 'Card Number: 4321 XXXX XXXX 1234', 'Minimum Amount Due: SAR 100.00',
    '05/09/2026 STC PAY TOP 100 120.00',
  ].join('\n'), 'SAR').rows[0];
  ok('review 8: a three-letter word before a bare integer is not a foreign original',
    topUp?.amountFils === 12000 && topUp.originalCurrency === undefined && /TOP 100/.test(topUp.merchant),
    JSON.stringify(topUp));
  const yen = parseStatementLines([
    'Credit Card Statement', 'Card Number: 4567 XXXX XXXX 1234', 'Minimum Amount Due: AED 100.00',
    '05/09/2026 UNIQLO TOKYO JPY 2000 49.80',
  ].join('\n'), 'AED').rows[0];
  ok('review 8: a zero-decimal original (JPY 2000) is still carried',
    yen?.amountFils === 4980 && yen.originalCurrency === 'JPY' && yen.originalMinorUnits === 2000 && yen.originalExponent === 0,
    JSON.stringify(yen));

  console.log(`\n${passed} passed, ${failed} failed`);
  process.exit(failed ? 1 : 0);
})();
