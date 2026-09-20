const {
  decodeCsv,
  extractPdfStatementRows,
  htmlToText,
  normalizeEmailContent,
  parseRawEmail,
  parseStatementCsv,
  parseStatementLines,
  parseStatementText,
  statementLayoutFingerprint,
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
      `01/07/2026,GLOBAL SHOP,${amount},,${currency}`,
    ].join('\n'), currency);
    ok(`global CSV keeps ${currency} in its exact ISO minor units`,
      parsedGlobal.rows.length === 1 && parsedGlobal.rejectedRows === 0 &&
        parsedGlobal.rows[0].currency === currency && parsedGlobal.rows[0].amountFils === minor,
      JSON.stringify(parsedGlobal));
  }
  const badJpyPrecision = parseStatementCsv([
    'Date,Description,Debit,Credit,Currency',
    '01/07/2026,GLOBAL SHOP,24.50,,JPY',
  ].join('\n'), 'JPY');
  const badKwdPrecision = parseStatementCsv([
    'Date,Description,Debit,Credit,Currency',
    '01/07/2026,GLOBAL SHOP,12.3456,,KWD',
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
  ].join('\n'));
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
  ].join('\n'));
  ok('text/PDF statements use a unique header account as generic transfer evidence',
    genericPdfRows.length === 1 && genericPdfRows[0].card?.last4 === '1111' &&
      genericPdfRows[0].transferEvidence?.statement === true &&
      genericPdfRows[0].transferEvidence?.counterparty?.last4 === '2222' &&
      genericPdfRows[0].transferHint === true,
    JSON.stringify(genericPdfRows));
  const ownPdfRows = parseStatementText([
    'Account No: ****1111',
    '08/07/2026 Internal transfer to account ****2222 AED 250.00 DR',
  ].join('\n'));
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
  const jpyRows = parseStatementText('01/07/2026 TOKYO STORE JPY 2400 DR', 'JPY');
  const kwdRows = parseStatementText('01/07/2026 KUWAIT STORE KWD 12.345 DR', 'KWD');
  ok('global text/PDF rows honor zero- and three-decimal ledger currencies',
    jpyRows.length === 1 && jpyRows[0].currency === 'JPY' && jpyRows[0].amountFils === 2400 &&
      kwdRows.length === 1 && kwdRows[0].currency === 'KWD' && kwdRows[0].amountFils === 12345,
    JSON.stringify({ jpyRows, kwdRows }));
  const currencyWordMerchant = parseStatementText('01/07/2026 SAR TRADING 45.00 DR', 'AED');
  ok('a currency word inside the merchant is not mistaken for an amount currency',
    currencyWordMerchant.length === 1 && currencyWordMerchant[0].currency === 'AED');

  const pdf = await extractPdfStatementRows(
    tinyPdf('01/07/2026 CARREFOUR MARKET AED 40.00 DR'),
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
  ok('contradictory evidence keeps DD/MM and rejects the row that cannot be read that way',
    contradictoryCsv.rows.length === 1 && contradictoryCsv.rows[0].date === '2026-07-25' &&
      contradictoryCsv.rejectedRows === 1);
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

  // ── The UAE card table: original / VAT / total, two dates, wrapped rows ──
  //
  // Reported against an HSBC UAE card statement that imported nothing at all.
  // Its table is `Transaction Date | Posting Date | Transaction Details |
  // Original Amount | (+) VAT | Total Amount (AED)`, and four things about it
  // defeated the reader at once: a second date at the head of every
  // description, two trailing figures that are one charge rather than a
  // debit/credit pair, a CR printed hard against its own figure, and rows the
  // PDF wrapped over three lines. 70 transactions, 0 read.
  //
  // Invented merchants and figures throughout; only the LAYOUT is the bank's.
  const cardTable = [
    'HSBC Credit Card Statement',
    'Statement Date 10-Sept-26',
    'Credit Limit 50,000.00',
    'Minimum Amount Due 500.00',
    'Transaction Date',
    'Posting Date',
    'Transaction Details',
    'Original Amount',
    '(+) VAT',
    'Total Amount',
    '(AED)',
    'Opening Balance 1,500.00',
    '10-Aug-26 11-Aug-26 CASHBACK 21.40 CR 21.40CR',
    '-',
    '26-Aug-26 26-Aug-26 PAYMENT RECEIVED THANK YOU 9,200.00 CR 9,200.00CR',
    '-',
    '09-Aug-26 11-Aug-26 COFFEE HOUSE DUBAI AE 41.25 41.25',
    '-',
    '09-Aug-26 11-Aug-26 NFC - (G-PAY)-GREEN VALLEY GROCERY',
    'DUBAI AE',
    '88.50 88.50',
    '-',
    '03-Sept-26 03-Sept-26 BOOKSHOP LLC DUBAI AE 1,776.00 1,776.00',
    '-',
  ].join('\n');
  const cardRows = parseStatementLines(cardTable, 'AED');
  ok('an original/VAT/total card table reads every row, and counts none rejected',
    cardRows.rows.length === 5 && cardRows.rejectedRows === 0 && cardRows.totalRows === 5,
    JSON.stringify([cardRows.rows.length, cardRows.rejectedRows, cardRows.totalRows]));
  ok('the ledger figure is the TOTAL column, not the original amount beside it',
    cardRows.rows.every((row) => row.amountFils > 0) &&
      cardRows.rows.map((row) => row.amountFils).join(',') === '2140,920000,4125,8850,177600',
    JSON.stringify(cardRows.rows.map((row) => row.amountFils)));
  ok('a CR glued to its figure is a credit; an unmarked card row is a purchase',
    cardRows.rows.map((row) => row.type).join(',') === 'income,income,expense,expense,expense',
    JSON.stringify(cardRows.rows.map((row) => row.type)));
  ok('the posting date is a column, so it never lands in the merchant',
    cardRows.rows.every((row) => !/\d{2}-[A-Za-z]{3,4}-\d{2}/.test(row.merchant)) &&
      cardRows.rows[0].merchant === 'CASHBACK' && cardRows.rows[2].merchant === 'COFFEE HOUSE DUBAI AE',
    JSON.stringify(cardRows.rows.map((row) => row.merchant)));
  ok('a row the PDF wrapped over three lines is one transaction, description intact',
    cardRows.rows[3].merchant === 'NFC - (G-PAY)-GREEN VALLEY GROCERY DUBAI AE' &&
      cardRows.rows[3].amountFils === 8850 && cardRows.rows[3].type === 'expense',
    JSON.stringify([cardRows.rows[3].merchant, cardRows.rows[3].amountFils]));
  ok('the dates are the transaction dates, and DD-MMMM-YY resolves',
    cardRows.rows[0].date === '2026-08-10' && cardRows.rows[4].date === '2026-09-03',
    JSON.stringify(cardRows.rows.map((row) => row.date)));

  // The layout is proven by its HEADER, and nothing else. Without those column
  // names the same rows are two ambiguous figures, which this parser refuses to
  // read a direction into rather than guess between debit and credit.
  const noHeader = parseStatementLines([
    'Statement of Account',
    '09-Aug-26 11-Aug-26 COFFEE HOUSE DUBAI AE 41.25 41.25',
  ].join('\n'), 'AED');
  ok('without the original/total header the ambiguous pair is still refused',
    noHeader.rows.length === 0 && noHeader.rejectedRows === 1,
    JSON.stringify([noHeader.rows.length, noHeader.rejectedRows]));
  // The small print names the same words in prose. Reading those as a header
  // would switch this layout on for every statement carrying the usual terms.
  const proseOnly = parseStatementLines([
    'Statement of Account',
    'Total Amount Payable on this Statement date - Amount that needs to be paid',
    'Interest is applied if the total amount of Minimum Payment Due is not settled',
    '09-Aug-26 11-Aug-26 COFFEE HOUSE DUBAI AE 41.25 41.25',
  ].join('\n'), 'AED');
  ok('those column names in prose are not a table header',
    proseOnly.rows.length === 0 && proseOnly.rejectedRows === 1,
    JSON.stringify([proseOnly.rows.length, proseOnly.rejectedRows]));
  // ── The same table under other banks' column names ──
  //
  // "Original/Total" is HSBC's wording for a pairing several issuers print:
  // what the card was charged beside what it settled to in the ledger's
  // currency. Keyed to the header, so the names have to be the ones banks use.
  const cardHead = [
    'Credit Card Statement', 'Credit Limit 50,000.00', 'Minimum Amount Due 500.00',
    'Transaction Date', 'Posting Date', 'Description',
  ];
  const aliasRow = '09-Aug-26 11-Aug-26 COFFEE HOUSE DUBAI AE 41.25 41.25';
  for (const [charged, settled] of [
    ['Transaction Amount', 'Billing Amount'],
    ['Original Amount', 'Amount in AED'],
    ['Foreign Currency Amount', 'Settlement Amount'],
  ]) {
    const aliased = parseStatementLines([...cardHead, charged, settled, aliasRow].join('\n'), 'AED');
    ok(`the same table reads under ${charged} / ${settled}`,
      aliased.rows.length === 1 && aliased.rows[0].amountFils === 4125 &&
        aliased.rows[0].type === 'expense' && aliased.rows[0].merchant === 'COFFEE HOUSE DUBAI AE',
      JSON.stringify(aliased.rows.map((row) => [row.merchant, row.amountFils])));
  }

  // ── Which column is last decides whether the row can be read at all ──
  //
  // The charge is the LAST figure only while the settlement column is the
  // rightmost of the two. Reversed, the last figure is the foreign one, and
  // reading it would file GBP 10.00 as AED 10.00 — money wrong, and silently.
  // So the reversed header is refused rather than read off a position.
  const foreignRow = '09-Aug-26 11-Aug-26 FOREIGN SHOP LONDON GB 10.00 47.50';
  const settlementLast = parseStatementLines(
    [...cardHead, 'Transaction Amount', 'Billing Amount', foreignRow].join('\n'), 'AED');
  ok('with the settlement column last, the AED figure is the charge',
    settlementLast.rows.length === 1 && settlementLast.rows[0].amountFils === 4750,
    JSON.stringify(settlementLast.rows.map((row) => row.amountFils)));
  const settlementFirst = parseStatementLines(
    [...cardHead, 'Billing Amount', 'Transaction Amount', foreignRow].join('\n'), 'AED');
  ok('with the settlement column first, the row is refused rather than misread',
    settlementFirst.rows.length === 0 && settlementFirst.rejectedRows === 1,
    JSON.stringify([settlementFirst.rows.length, settlementFirst.rejectedRows]));
  // The settlement name follows the ledger's own currency, not a Gulf default.
  const sarStatement = parseStatementLines(
    [...cardHead, 'Transaction Amount', 'Amount in SAR',
      '09-Aug-26 11-Aug-26 RIYADH STORE SA 41.25 41.25'].join('\n'), 'SAR');
  ok('the settlement column name follows the ledger currency',
    sarStatement.rows.length === 1 && sarStatement.rows[0].amountFils === 4125,
    JSON.stringify(sarStatement.rows.map((row) => row.amountFils)));

  // ── The rows have to ADD UP to what the statement says about itself ──
  //
  // Recognising a layout and reading it correctly are not the same thing, and
  // nothing here could previously tell them apart: a reading that took the
  // wrong figure, or every direction the wrong way round, produced a full set
  // of plausible transactions and no complaint. The statement states its own
  // opening and closing balance, so the arithmetic between them is a proof.
  const cardLedger = (closing) => [
    'Credit Card Statement', 'Credit Limit 50,000.00', 'Minimum Amount Due 500.00',
    'Transaction Date', 'Posting Date', 'Transaction Details',
    'Original Amount', '(+) VAT', 'Total Amount', '(AED)',
    'Opening Balance 1,000.00',
    '09-Aug-26 11-Aug-26 SHOP ONE DUBAI AE 100.00 100.00',
    '10-Aug-26 11-Aug-26 SHOP TWO DUBAI AE 50.00 50.00',
    '11-Aug-26 12-Aug-26 REFUND 30.00 CR 30.00CR',
    'Total Outstanding', closing,
  ].join('\n');
  // 1,000.00 + 100.00 + 50.00 − 30.00 = 1,120.00 owed.
  const proven = parseStatementLines(cardLedger('AED 1,120.00'), 'AED');
  ok('a card statement whose rows reach its stated closing balance is proven',
    proven.rows.length === 3 && proven.reconciliation.verdict === 'proven' &&
      proven.reconciliation.openingMinor === 100000 && proven.reconciliation.closingMinor === 112000,
    JSON.stringify(proven.reconciliation));
  const contradicted = parseStatementLines(cardLedger('AED 9,999.00'), 'AED');
  ok('one that does not is contradicted, with the gap stated',
    contradicted.reconciliation.verdict === 'contradicted' &&
      contradicted.reconciliation.differenceMinor === -887900,
    JSON.stringify(contradicted.reconciliation));
  // An account balance runs the other way: a purchase LOWERS it. Getting that
  // backwards misses by twice the traffic rather than closing, so the sign
  // convention is itself under test here.
  const account = parseStatementLines([
    'Statement of Account', 'Date Description Debit Credit Balance',
    'Opening Balance 5,000.00',
    '01/07/2026 GROCERY 100.00 - 4,900.00',
    '02/07/2026 REFUND - 250.00 5,150.00',
    'Closing Balance 5,150.00',
  ].join('\n'), 'AED');
  ok('an account statement reconciles on the opposite sign convention',
    account.rows.length === 2 && account.reconciliation.verdict === 'proven',
    JSON.stringify(account.reconciliation));
  // Proof is only ever added, never used to cast doubt on what it cannot check.
  const noAnchors = parseStatementLines([
    'Statement of Account', 'Date Description Debit Credit Balance',
    '01/07/2026 GROCERY 100.00 - 4,900.00',
  ].join('\n'), 'AED');
  ok('a statement stating no balances is unknown, not contradicted',
    noAnchors.rows.length === 1 && noAnchors.reconciliation.verdict === 'unknown',
    JSON.stringify(noAnchors.reconciliation));
  // A partial read is missing transactions by definition, so it cannot close.
  // Calling that a contradiction would report every partial import as wrong.
  const partial = parseStatementLines([
    'Statement of Account', 'Date Description Debit Credit Balance',
    'Opening Balance 5,000.00',
    '01/07/2026 GROCERY 100.00 - 4,900.00',
    '02/07/2026 BOTH POPULATED 10.00 20.00',
    'Closing Balance 4,900.00',
  ].join('\n'), 'AED');
  ok('a read with rejected rows is unknown rather than contradicted',
    partial.rejectedRows === 1 && partial.reconciliation.verdict === 'unknown',
    JSON.stringify([partial.rejectedRows, partial.reconciliation]));
  // The label has to be a label. "Total Outstanding" heads the summary box of a
  // real statement AND appears five times in its small print; anchoring to a
  // sentence would contradict a parse that was right.
  const prosePitfall = parseStatementLines([
    'Credit Card Statement', 'Credit Limit 50,000.00', 'Minimum Amount Due 500.00',
    'Transaction Date', 'Posting Date', 'Transaction Details',
    'Original Amount', '(+) VAT', 'Total Amount', '(AED)',
    'Opening Balance 1,000.00',
    '09-Aug-26 11-Aug-26 SHOP ONE DUBAI AE 100.00 100.00',
    'Total Outstanding', 'AED 1,100.00',
    '11. Overlimit Amount is the amount by which the Total Outstanding on Statement Date exceeds 50,000.00',
  ].join('\n'), 'AED');
  ok('a balance label inside a sentence is not an anchor',
    prosePitfall.reconciliation.verdict === 'proven',
    JSON.stringify(prosePitfall.reconciliation));

  // ── Four ways reconciliation could accuse a correct parse ──
  //
  // Found by review, not by a statement. Every one of these reports
  // `contradicted` against a reading that was right, which is worse than not
  // checking: it is documented as only ever ADDING proof.
  const owedLedger = (closingLines) => [
    'Credit Card Statement', 'Credit Limit 50,000.00', 'Minimum Amount Due 500.00',
    'Transaction Date', 'Posting Date', 'Description', 'Transaction Amount', 'Billing Amount',
    'Opening Balance 1,000.00',
    '09-Aug-26 11-Aug-26 SHOP DUBAI AE 100.00 100.00',
    ...closingLines,
  ].join('\n');
  // `1,100.00 DR` ends in a direction, so the line read as no figure at all and
  // the lookahead ran on to take the minimum payment underneath as the closing
  // balance — off by the whole statement.
  const trailingMarker = parseStatementLines(
    owedLedger(['Total Outstanding 1,100.00 DR', 'Minimum Payment', '50.00']), 'AED');
  ok('a balance with a trailing DR is read, not skipped for the figure below it',
    trailingMarker.reconciliation.verdict === 'proven' &&
      trailingMarker.reconciliation.closingMinor === 110000,
    JSON.stringify(trailingMarker.reconciliation));
  // An overpaid card is in CREDIT: it owes minus two hundred, not plus. Read as
  // positive it missed by twice the balance.
  const overpaid = parseStatementLines([
    'Credit Card Statement', 'Credit Limit 50,000.00', 'Minimum Amount Due 500.00',
    'Transaction Date', 'Posting Date', 'Description', 'Transaction Amount', 'Billing Amount',
    'Opening Balance 1,000.00',
    '09-Aug-26 11-Aug-26 REFUND 1,200.00 CR 1,200.00CR',
    'Total Outstanding', '200.00CR',
  ].join('\n'), 'AED');
  ok('an overpaid card reads its CR balance as money it does not owe',
    overpaid.reconciliation.verdict === 'proven' &&
      overpaid.reconciliation.closingMinor === -20000,
    JSON.stringify(overpaid.reconciliation));
  // A summary box stacks labels then values, so a lookahead that stopped only
  // at its OWN label walked into the other balance and read opening as closing.
  const stackedBox = parseStatementLines(
    owedLedger(['Total Outstanding', '1,100.00']), 'AED');
  ok('a stacked summary box does not read the opening balance as the closing one',
    stackedBox.reconciliation.verdict === 'proven' &&
      stackedBox.reconciliation.openingMinor === 100000 &&
      stackedBox.reconciliation.closingMinor === 110000,
    JSON.stringify(stackedBox.reconciliation));
  // Both labels, THEN both values. A lookahead stopping only at its own label
  // walked from "Total Outstanding" straight onto the opening figure, so
  // closing equalled opening and the statement was contradicted by exactly its
  // own traffic. Pairing labels to values across a block like this is guesswork
  // either way, so the honest answer is to decline it.
  const bothLabelsFirst = parseStatementLines([
    'Credit Card Statement', 'Credit Limit 50,000.00', 'Minimum Amount Due 500.00',
    'Transaction Date', 'Posting Date', 'Description', 'Transaction Amount', 'Billing Amount',
    'Opening Balance', 'Total Outstanding', '1,000.00', '1,100.00',
    '09-Aug-26 11-Aug-26 SHOP DUBAI AE 100.00 100.00',
  ].join('\n'), 'AED');
  ok('labels stacked above their values are declined, not contradicted',
    bothLabelsFirst.reconciliation.verdict === 'unknown',
    JSON.stringify(bothLabelsFirst.reconciliation));
  // A row wrapped past the join limit is invisible — never read, never
  // rejected. The sum is missing a transaction, so it cannot close, and saying
  // `contradicted` would accuse a parse that did nothing wrong.
  const wrappedTooFar = parseStatementLines([
    'Credit Card Statement', 'Credit Limit 50,000.00', 'Minimum Amount Due 500.00',
    'Transaction Date', 'Posting Date', 'Description', 'Transaction Amount', 'Billing Amount',
    'Opening Balance 1,000.00',
    '09-Aug-26 11-Aug-26 VERY LONG MERCHANT NAME',
    'CONTINUED LINE ONE', 'CONTINUED LINE TWO',
    '100.00 100.00',
    'Total Outstanding', '1,100.00',
  ].join('\n'), 'AED');
  ok('a row lost to wrapping makes the verdict unknown, never contradicted',
    wrappedTooFar.reconciliation.verdict === 'unknown',
    JSON.stringify([wrappedTooFar.rows.length, wrappedTooFar.rejectedRows, wrappedTooFar.reconciliation]));

  // ── A failing statement can be diagnosed without handling anyone's money ──
  //
  // A file that reads zero rows tells the user nothing actionable and tells
  // nobody upstream which layout defeated it. The fingerprint carries the SHAPE
  // so a fixture can be written from it — and carries nothing else. This case
  // is built to break that promise: a name, an employer, a city, an account
  // number, merchant names and real-looking amounts, all in the places a
  // statement really puts them.
  const privacyProbe = [
    'Northbank Gulf Limited',
    'Credit Card Statement',
    'MS SAMPLE CARDHOLDER',
    'EXAMPLE TRADING FZ LLC',
    'DUBAI',
    'UNITED ARAB EMIRATES',
    'Credit Card Number',
    '4000 0000 0000 0002',
    'Credit Limit 50,000.00',
    'Minimum Amount Due 500.00',
    'Transaction Date', 'Posting Date', 'Transaction Details',
    'Original Amount', '(+) VAT', 'Total Amount', '(AED)',
    'Opening Balance 1,500.00',
    '09-Aug-26 11-Aug-26 NFC - (X-PAY)-EXAMPLE PHARMACY 123 BR',
    'DUBAI AE',
    '88.50 88.50',
    '10-Aug-26 11-Aug-26 REBATE 21.40 CR 21.40CR',
    'Total Outstanding AED 1,567.10',
  ].join('\n');
  const print = statementLayoutFingerprint(privacyProbe, 'AED');
  const serialized = JSON.stringify(print);
  const mustNotLeak = [
    'SAMPLE', 'CARDHOLDER', 'EXAMPLE', 'TRADING', 'PHARMACY', 'REBATE', 'X-PAY',
    '4000', '0000', '0002', '1,500.00', '1500.00', '1,567.10',
    '88.50', '21.40', '50,000', '500.00',
  ];
  const leaked = mustNotLeak.filter((needle) => serialized.toUpperCase().includes(needle.toUpperCase()));
  ok('a fingerprint carries no name, employer, account number, merchant or amount',
    leaked.length === 0, `leaked ${JSON.stringify(leaked)} in ${serialized}`);
  // Nothing that could be a value survives as digits either.
  ok('a fingerprint carries no digits at all outside its counts',
    print.headers.every((header) => !/\d/.test(header)) &&
      print.shapes.every((entry) => !/\d/.test(entry.shape)),
    JSON.stringify([print.headers, print.shapes]));
  // ...and the address block is counted rather than named.
  ok('header-shaped lines that do not name a column are counted, not reported',
    print.otherHeaderLines >= 3 &&
      print.headers.every((header) => !/sample|cardholder|example|dubai|emirates/i.test(header)),
    JSON.stringify([print.headers, print.otherHeaderLines]));

  // The probe above missed a whole class: a name that CONTAINS a column word.
  // `GULF PAYMENTS SERVICES LLC` carries "payments", is four words, and went
  // into the report verbatim. A column label ends in its noun; a trading name
  // ends in what it is.
  const tradingNames = statementLayoutFingerprint([
    'Credit Card Statement',
    'GULF PAYMENTS SERVICES LLC',
    'NORTHBANK SETTLEMENTS PJSC',
    'EXAMPLE BALANCE ADVISORS LTD',
    'Transaction Date', 'Original Amount', 'Total Amount',
  ].join('\n'), 'AED');
  ok('a trading name containing a column word is still not a column label',
    tradingNames.headers.every((header) => !/gulf|northbank|advisors|llc|pjsc|ltd/i.test(header)) &&
      tradingNames.headers.includes('original amount') &&
      tradingNames.headers.includes('total amount'),
    JSON.stringify(tradingNames.headers));

  // What it DOES carry is enough to rebuild the table from.
  ok('a fingerprint names the column vocabulary the table used',
    print.headers.includes('original amount') && print.headers.includes('total amount'),
    JSON.stringify(print.headers));
  // Two shapes, for two rows: the three-line wrapped one rejoined into a single
  // row ending in its pair of figures, and the credit with its glued marker.
  // The posting date is already gone from both — that is the shape saying the
  // dual-date column was understood, not that the statement lacked one.
  ok('a fingerprint reports the row shapes, wrapped rows already rejoined',
    print.shapes.length === 2 &&
      print.shapes.some((entry) => /^DATE .*MONEY MONEY$/.test(entry.shape)) &&
      print.shapes.some((entry) => entry.shape === 'DATE WORD MONEY DIR MONEY'),
    JSON.stringify(print.shapes));
  ok('a fingerprint reports what the parser proved about the layout',
    print.cardStatement === true && print.originalTotalColumns === true &&
      print.dateLedLines === 2 && print.moneyLines === 2,
    JSON.stringify(print));
  // ── Three ways the money could still come out wrong ──
  //
  // Found by reviewing this change adversarially rather than by a failing
  // statement, and each one reaches the ledger rather than merely refusing.
  //
  // An empty VAT cell used to end the tail walk, and a refusal fell through to
  // parseColumnTail, which takes the LEFTMOST figure — the FOREIGN one. So the
  // header-order guard protected only the rows this branch happened to accept,
  // and `10.00 - 47.50` filed GBP 10.00 as AED 10.00.
  const vatEmpty = parseStatementLines(
    [...cardHead, 'Transaction Amount', '(+) VAT', 'Billing Amount',
      '09-Aug-26 11-Aug-26 FOREIGN SHOP LONDON GB 10.00 - 47.50'].join('\n'), 'AED');
  ok('an empty VAT cell still reads the settlement figure, not the foreign one',
    vatEmpty.rows.length === 1 && vatEmpty.rows[0].amountFils === 4750,
    JSON.stringify(vatEmpty.rows.map((row) => row.amountFils)));
  const vatPresent = parseStatementLines(
    [...cardHead, 'Transaction Amount', '(+) VAT', 'Billing Amount',
      '09-Aug-26 11-Aug-26 FOREIGN SHOP LONDON GB 10.00 2.25 47.50'].join('\n'), 'AED');
  ok('...and a stated VAT reads the same figure',
    vatPresent.rows.length === 1 && vatPresent.rows[0].amountFils === 4750,
    JSON.stringify(vatPresent.rows.map((row) => row.amountFils)));

  // A trailing CR does not make a reference number into money. This ran before
  // the decimal-point guard and read AED 123,456.00 of income out of a cheque
  // reference — invented outright, and not even counted as rejected.
  const referenceNumber = parseStatementLines('01/07/2026 CHEQUE DEPOSIT REF 123456CR', 'AED');
  ok('a glued CR on a bare reference number is not money',
    referenceNumber.rows.length === 0 && referenceNumber.rejectedRows === 1,
    JSON.stringify([referenceNumber.rows, referenceNumber.rejectedRows]));

  // A refusal in this layout is final, so a row whose reading was never
  // ambiguous must be answered rather than dropped: one figure has no second
  // column to pick wrongly, and losing it would be the cost of the guard.
  const loneFigure = parseStatementLines(
    [...cardHead, 'Transaction Amount', 'Billing Amount',
      '09-Aug-26 11-Aug-26 SINGLE FIGURE SHOP DUBAI AE 68.93'].join('\n'), 'AED');
  ok('a single-figure row on this layout is still read as a charge',
    loneFigure.rows.length === 1 && loneFigure.rows[0].amountFils === 6893 &&
      loneFigure.rows[0].type === 'expense',
    JSON.stringify(loneFigure.rows.map((row) => [row.merchant, row.amountFils])));

  // A statement PERIOD is date-led and carries no money, exactly like the first
  // line of a wrapped row. Joining it onto the figure beneath filed a
  // transaction against a merchant called "to 09-Sept-26".
  const periodLine = parseStatementLines([
    'Credit Card Statement', 'Credit Limit 50,000.00', 'Minimum Amount Due 500.00',
    'Date Description Amount',
    '10-Aug-26 to 09-Sept-26',
    '1,567.10',
  ].join('\n'), 'AED');
  ok('a statement period is never joined onto the figure beneath it',
    periodLine.rows.length === 0,
    JSON.stringify(periodLine.rows.map((row) => [row.merchant, row.amountFils])));

  // A run ends on a line of nothing but figures. A summary line carries money
  // too, and joining a date-led line onto one would put a figure nobody spent
  // on the ledger under a merchant assembled from two unrelated rows.
  const notWrapped = parseStatementLines([
    'Statement of Account',
    'Date Description Debit Credit Balance',
    '01/07/2026 CARREFOUR MARKET 40.00 - 9,960.00',
    '10/07/2026 to 31/07/2026 closing period',
    'Total 1,234.00',
    'Balance c/f 9,960.00',
  ].join('\n'), 'AED');
  ok('a date-led line is never joined onto a summary line that merely has money',
    notWrapped.rows.length === 1 && notWrapped.rows[0].merchant === 'CARREFOUR MARKET' &&
      notWrapped.rows.every((row) => row.amountFils !== 123400),
    JSON.stringify(notWrapped.rows.map((row) => [row.merchant, row.amountFils])));
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
    parseStatementText('01/07/2026 CARREFOUR MARKET -40.00').length === 1);

  const partialPdf = await extractPdfStatementRows(tinyPdf('01/07/2026 CARREFOUR MARKET 40.00 DR'));
  ok('a fully read PDF reports zero rejected rows',
    partialPdf.rejectedRows === 0 && partialPdf.totalRows === partialPdf.rows.length &&
    partialPdf.completeRowAccounting === true);
  const rejectedPdf = parseStatementLines([
    '01/07/2026 CARREFOUR MARKET 40.00 DR',
    '02/07/2026 AMBIGUOUS VISUAL COLUMN 22.00',
    '32/07/2026 IMPOSSIBLE AED 9.00 DR',
  ].join('\n'));
  ok('PDF text reports date-led money lines it could not read as rejected',
    rejectedPdf.rows.length === 1 && rejectedPdf.rejectedRows === 2 &&
    rejectedPdf.totalRows === 3 && rejectedPdf.completeRowAccounting === true);

  let tooLong = '';
  try {
    await extractPdfStatementRows(wideTextPdf(
      Array.from({ length: 80 }, (_, index) => `01/07/2026 ROW ${index} ${'LONG '.repeat(380)}40.00 DR`),
    ));
  } catch (error) {
    tooLong = error instanceof Error ? error.message : '';
  }
  ok('an oversized text PDF is a distinct limit error, not a scanned-PDF error', tooLong === 'pdf_too_long');

  console.log(`\n${passed} passed, ${failed} failed`);
  process.exit(failed ? 1 : 0);
})();
