const {
  extractPdfStatementRows,
  htmlToText,
  normalizeEmailContent,
  parseRawEmail,
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

  const rows = parseStatementText([
    '01/07/2026 CARREFOUR MARKET AED 40.00 DR',
    '02/07/2026 SALARY CREDIT 18,500.00',
    '03/07/2026 AMBIGUOUS VISUAL COLUMN 22.00',
    '32/07/2026 IMPOSSIBLE AED 9.00 DR',
    '01/07/2026 CARREFOUR MARKET AED 40.00 DR',
  ].join('\n'));
  ok('explicit debit and credit statement rows are structured',
    rows.length === 2 && rows[0].type === 'expense' && rows[1].type === 'income',
    JSON.stringify(rows));
  ok('statement amounts become integer fils',
    rows[0].amountFils === 4000 && rows[1].amountFils === 1850000);
  ok('ambiguous columns, impossible dates and duplicate rows are rejected', rows.length === 2);

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
