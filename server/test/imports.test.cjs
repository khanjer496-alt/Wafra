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
      packedCardTable.rows[2].merchant === 'MERCHANT TWO DUBAI AE' &&
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
      vatTotalLineBreak.rows[0].merchant === 'STORE 2026 LLC DUBAI AE',
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
