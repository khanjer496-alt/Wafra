// Statement parser checks added 12 October 2026:
//   1. a marked amount beside a marked running balance (`120.00 DR 4,880.00 CR`)
//   2. reconciliation against the stated balances, and the layout fingerprint
//   3. yearless row dates filled only from the statement's own period
//   4. more opening-balance labels for the balance chain
//   5. information pages after the last transaction page, and the foreign
//      original inside an "Amount in AED" card table
//   6. a card export's Type=Payment row filed as the card settlement
// Every figure, name and number below is fictional.
const {
  extractPdfStatementRows,
  parseStatementCsv,
  parseStatementLines,
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

/** An actual multipage text PDF, one line per text item, ASCII only. */
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

const signedNet = (rows) => rows.reduce((sum, row) => sum + (row.type === 'income' ? row.amountFils : -row.amountFils), 0);
const brief = (rows) => JSON.stringify(rows.map((row) => [row.date, row.kind, row.type, row.amountFils, row.merchant]));
const refusal = (run) => { try { run(); return 'accepted'; } catch (error) { return error.message; } };

(async () => {
  /* ── 1. A marked amount beside a marked running balance ─────────────── */
  //
  // ROW_END_DIRECTION read the LAST figure and its label, which on these rows
  // is the balance: every row imported its balance, a CR balance as income.
  const sixRows = [
    'Statement of Account', 'Account Number 1012345678901', 'Opening Balance 5,000.00 CR',
    'Date Description Amount Balance',
    '01/09/2026 CARREFOUR DUBAI 120.00 DR 4,880.00 CR',
    '03/09/2026 SALARY ACME LLC 8,000.00 CR 12,880.00 CR',
    '05/09/2026 DEWA BILL 450.00 DR 12,430.00 CR',
    '07/09/2026 NOON.COM 230.50 DR 12,199.50 CR',
    '09/09/2026 ENOC FUEL 95.00 DR 12,104.50 CR',
    '11/09/2026 TRANSFER FROM SAVINGS 1,000.00 CR 13,104.50 CR',
    'Closing Balance 13,104.50 CR',
  ];
  const six = parseStatementLines(sixRows.join('\n'), 'AED', { card: null }, 'day-first');
  ok('a marked amount beside a marked balance imports the amount, not the balance',
    six.rows.length === 6 && six.rejectedRows === 0 &&
      six.rows.map((row) => `${row.type[0]}${row.amountFils}`).join(' ') === 'e12000 i800000 e45000 e23050 e9500 i100000' &&
      signedNet(six.rows) === 810450,
    brief(six.rows));
  ok('…and the merchant carries neither figure nor label',
    six.rows.every((row) => !/\d+\.\d{2}|\b(?:DR|CR)\b/.test(row.merchant)), brief(six.rows));
  ok('…and the rows reconcile with the stated opening and closing balances',
    six.reconciliation.verdict === 'proven' && six.reconciliation.openingMinor === 500000 &&
      six.reconciliation.closingMinor === 1310450,
    JSON.stringify(six.reconciliation));
  const sixPdf = await extractPdfStatementRows(pagedPdf([sixRows]), 'AED', undefined, 'day-first');
  ok('the same six rows through a real PDF import the amounts and reconcile',
    sixPdf.rows.length === 6 && sixPdf.rejectedRows === 0 && signedNet(sixPdf.rows) === 810450 &&
      sixPdf.reconciliation.verdict === 'proven' && sixPdf.layout === null,
    JSON.stringify([brief(sixPdf.rows), sixPdf.reconciliation]));

  const threeRows = [
    'Statement of Account', 'Account Number 1012345678901', 'Opening Balance 5,000.00 CR',
    'Date Description Amount Balance',
    '01/09/2026 CARREFOUR DUBAI 120.00 DR 4,880.00 CR',
    '03/09/2026 SALARY ACME LLC 8,000.00 CR 12,880.00 CR',
    '05/09/2026 DEWA BILL 450.00 DR 12,430.00 CR',
    'Closing Balance 12,430.00 CR',
  ];
  const three = parseStatementLines(threeRows.join('\n'), 'AED', { card: null }, 'day-first');
  ok('a three-row statement in that shape reads all three amounts',
    three.rows.length === 3 && three.rejectedRows === 0 && signedNet(three.rows) === 743000 &&
      three.reconciliation.verdict === 'proven',
    brief(three.rows));
  const lower = parseStatementLines(threeRows.join('\n').replace(/ DR\b/g, ' Dr').replace(/ CR\b/g, ' Cr'),
    'AED', { card: null }, 'day-first');
  ok('lower-case Dr/Cr labels read the same way',
    lower.rows.length === 3 && lower.rejectedRows === 0 && signedNet(lower.rows) === 743000 &&
      lower.rows[0].type === 'expense' && lower.rows[1].type === 'income',
    brief(lower.rows));

  const noOpening = parseStatementLines(threeRows.filter((line) => !/^Opening/.test(line)).join('\n'),
    'AED', { card: null }, 'day-first');
  ok('with no opening balance the first row is refused, never filed as its balance',
    noOpening.rows.length === 2 && noOpening.rejectedRows === 1 &&
      noOpening.rows.every((row) => row.amountFils !== 488000) && noOpening.rows[0].amountFils === 800000,
    brief(noOpening.rows));
  const broken = parseStatementLines(threeRows.map((line) => line.replace('12,880.00 CR', '12,990.00 CR')).join('\n'),
    'AED', { card: null }, 'day-first');
  ok('a row whose balance does not step by its amount is refused, and so is the next one',
    broken.rows.length === 1 && broken.rejectedRows === 2 && broken.rows[0].amountFils === 12000,
    brief(broken.rows));
  const overdrawn = parseStatementLines([
    'Statement of Account', 'Opening Balance 100.00 CR',
    '01/09/2026 RENT 300.00 DR 200.00 DR', '02/09/2026 SALARY 1,000.00 CR 800.00 CR',
  ].join('\n'), 'AED', { card: null }, 'day-first');
  ok('a DR balance is an overdraft, and the chain crosses zero',
    overdrawn.rows.length === 2 && overdrawn.rows[0].type === 'expense' && overdrawn.rows[0].amountFils === 30000 &&
      overdrawn.rows[1].type === 'income' && overdrawn.rows[1].amountFils === 100000,
    brief(overdrawn.rows));
  const foreignInner = parseStatementLines([
    'Statement of Account', 'Opening Balance 5,000.00 CR', '01/09/2026 ATM LONDON GBP 100.00 DR 4,500.00 CR',
  ].join('\n'), 'AED', { card: null }, 'day-first');
  ok('a foreign amount beside the balance is refused, never filed as the balance',
    foreignInner.rows.length === 0 && foreignInner.rejectedRows === 1, brief(foreignInner.rows));
  const ledgerCode = parseStatementLines([
    'Statement of Account', 'Opening Balance 5,000.00 CR', '01/09/2026 SHOP AED 120.00 DR AED 4,880.00 CR',
  ].join('\n'), 'AED', { card: null }, 'day-first');
  ok('the ledger currency code beside either figure is read and left out of the merchant',
    ledgerCode.rows.length === 1 && ledgerCode.rows[0].amountFils === 12000 && ledgerCode.rows[0].merchant === 'SHOP',
    brief(ledgerCode.rows));
  const sameFigure = parseStatementLines([
    'Credit Card Statement', 'Card Number XXXXXXXXXXXX4821', 'Minimum Payment Due 50.00',
    '01/09/2026 REFUND SHOP 101.75 CR 101.75 CR', '02/09/2026 SHOP TWO 40.00 DR 40.00 DR',
  ].join('\n'), 'AED', { card: null }, 'day-first');
  ok('the same figure under the same label twice is that one amount either way',
    sameFigure.rows.filter((row) => row.kind === 'transaction').length === 2 && sameFigure.rejectedRows === 0 &&
      sameFigure.rows[0].type === 'income' && sameFigure.rows[0].amountFils === 10175 &&
      sameFigure.rows[1].type === 'expense' && sameFigure.rows[1].amountFils === 4000,
    brief(sameFigure.rows));
  const singleLabel = parseStatementLines('Statement of Account\n01/09/2026 CARREFOUR 120.00 DR\n02/09/2026 SALARY 900.00 CR',
    'AED', { card: null }, 'day-first');
  ok('rows with one labelled figure read exactly as before',
    singleLabel.rows.length === 2 && singleLabel.rows[0].amountFils === 12000 && singleLabel.rows[1].type === 'income',
    brief(singleLabel.rows));

  /* ── 2. Reconciliation against the stated balances (ported from PR #94) ── */
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
  const proven = parseStatementLines(cardLedger('AED 1,120.00'), 'AED');
  ok('a card statement whose rows reach its stated closing balance is proven',
    proven.rows.length === 3 && proven.reconciliation.verdict === 'proven' &&
      proven.reconciliation.openingMinor === 100000 && proven.reconciliation.closingMinor === 112000,
    JSON.stringify([proven.rows.length, proven.reconciliation]));
  const contradicted = parseStatementLines(cardLedger('AED 9,999.00'), 'AED');
  ok('one that does not is contradicted, with the gap stated',
    contradicted.reconciliation.verdict === 'contradicted' && contradicted.reconciliation.differenceMinor === -887900,
    JSON.stringify(contradicted.reconciliation));
  const accountProof = parseStatementLines([
    'Statement of Account', 'Date Description Debit Credit Balance', 'Opening Balance 5,000.00',
    '01/07/2026 GROCERY 100.00 - 4,900.00', '02/07/2026 REFUND - 250.00 5,150.00', 'Closing Balance 5,150.00',
  ].join('\n'), 'AED');
  ok('an account statement reconciles on the opposite sign convention',
    accountProof.rows.length === 2 && accountProof.reconciliation.verdict === 'proven',
    JSON.stringify([accountProof.rows.length, accountProof.reconciliation]));
  // A multi-page statement states a running balance at every page break.
  // Page one's carried-forward figure is not the statement's closing balance.
  const pageBreaks = parseStatementLines([
    'Statement of Account', 'Date Description Debit Credit Balance', 'Balance brought forward 5,000.00',
    '01/07/2026 GROCERY 100.00 - 4,900.00', 'Balance carried forward 4,900.00',
    'Balance brought forward 4,900.00', '02/07/2026 REFUND - 250.00 5,150.00', 'Balance carried forward 5,150.00',
  ].join('\n'), 'AED');
  ok('per-page brought/carried-forward balances that disagree are no anchor, never a contradiction',
    pageBreaks.rows.length === 2 && pageBreaks.reconciliation.verdict === 'unknown',
    JSON.stringify([brief(pageBreaks.rows), pageBreaks.reconciliation]));
  const repeated = parseStatementLines([
    'Statement of Account', 'Opening Balance 5,000.00', 'Closing Balance 5,150.00', 'Date Description Debit Credit Balance',
    'Opening Balance 5,000.00', '01/07/2026 GROCERY 100.00 - 4,900.00', '02/07/2026 REFUND - 250.00 5,150.00',
    'Closing Balance 5,150.00',
  ].join('\n'), 'AED');
  ok('the same balance printed twice is still one anchor', repeated.reconciliation.verdict === 'proven',
    JSON.stringify(repeated.reconciliation));
  const usAccount = parseStatementLines([
    'CHECKING SUMMARY', 'Beginning Balance 1,000.00', 'Date Description Amount Balance',
    '09/01/2026 STARBUCKS -5.75 994.25', '09/15/2026 ACME PAYROLL +2,000.00 2,994.25', 'Ending Balance 2,994.25',
  ].join('\n'), 'USD', { card: null }, 'month-first');
  ok('Beginning and Ending Balance are anchors too',
    usAccount.rows.length === 2 && usAccount.reconciliation.verdict === 'proven',
    JSON.stringify([brief(usAccount.rows), usAccount.reconciliation]));
  const noAnchors = parseStatementLines([
    'Statement of Account', 'Date Description Debit Credit Balance', '01/07/2026 GROCERY 100.00 - 4,900.00',
  ].join('\n'), 'AED');
  ok('a statement stating no balances is unknown, not contradicted',
    noAnchors.rows.length === 1 && noAnchors.reconciliation.verdict === 'unknown', JSON.stringify(noAnchors.reconciliation));
  const partial = parseStatementLines([
    'Statement of Account', 'Date Description Debit Credit Balance', 'Opening Balance 5,000.00',
    '01/07/2026 GROCERY 100.00 - 4,900.00', '02/07/2026 BOTH POPULATED 10.00 20.00', 'Closing Balance 4,900.00',
  ].join('\n'), 'AED');
  ok('a read with rejected rows is unknown rather than contradicted',
    partial.rejectedRows === 1 && partial.reconciliation.verdict === 'unknown', JSON.stringify(partial.reconciliation));
  const prosePitfall = parseStatementLines([
    'Credit Card Statement', 'Credit Limit 50,000.00', 'Minimum Amount Due 500.00',
    'Transaction Date', 'Posting Date', 'Transaction Details', 'Original Amount', '(+) VAT', 'Total Amount', '(AED)',
    '11. Overlimit Amount is the amount by which the Total Outstanding on Statement Date exceeds 50,000.00',
    'Opening Balance 1,000.00', '09-Aug-26 11-Aug-26 SHOP ONE DUBAI AE 100.00 100.00', 'Total Outstanding', 'AED 1,100.00',
  ].join('\n'), 'AED');
  ok('a balance label inside a sentence is never an anchor',
    prosePitfall.reconciliation.verdict === 'proven' && prosePitfall.reconciliation.closingMinor === 110000,
    JSON.stringify(prosePitfall.reconciliation));
  const owedLedger = (closingLines) => [
    'Credit Card Statement', 'Credit Limit 50,000.00', 'Minimum Amount Due 500.00',
    'Transaction Date', 'Posting Date', 'Transaction Details', 'Original Amount', '(+) VAT', 'Total Amount', '(AED)',
    'Opening Balance 1,000.00', '09-Aug-26 11-Aug-26 SHOP DUBAI AE 100.00 100.00', ...closingLines,
  ].join('\n');
  const trailingMarker = parseStatementLines(owedLedger(['Total Outstanding 1,100.00 DR', 'Minimum Payment', '50.00']), 'AED');
  ok('a balance with a trailing DR is read, not skipped for the figure below it',
    trailingMarker.reconciliation.verdict === 'proven' && trailingMarker.reconciliation.closingMinor === 110000,
    JSON.stringify(trailingMarker.reconciliation));
  const overpaid = parseStatementLines([
    'Credit Card Statement', 'Credit Limit 50,000.00', 'Minimum Amount Due 500.00',
    'Transaction Date', 'Posting Date', 'Transaction Details', 'Original Amount', '(+) VAT', 'Total Amount', '(AED)',
    'Opening Balance 1,000.00', '09-Aug-26 11-Aug-26 REFUND 1,200.00 CR 1,200.00CR', 'Total Outstanding', '200.00CR',
  ].join('\n'), 'AED');
  ok('an overpaid card reads its CR balance as money it does not owe',
    overpaid.reconciliation.verdict === 'proven' && overpaid.reconciliation.closingMinor === -20000,
    JSON.stringify(overpaid.reconciliation));
  const stackedBox = parseStatementLines(owedLedger(['Total Outstanding', '1,100.00']), 'AED');
  ok('a stacked summary box does not read the opening balance as the closing one',
    stackedBox.reconciliation.verdict === 'proven' && stackedBox.reconciliation.openingMinor === 100000,
    JSON.stringify(stackedBox.reconciliation));
  const labelsFirst = parseStatementLines([
    'Credit Card Statement', 'Credit Limit 50,000.00', 'Minimum Amount Due 500.00',
    'Transaction Date', 'Posting Date', 'Transaction Details', 'Original Amount', '(+) VAT', 'Total Amount', '(AED)',
    'Opening Balance', 'Total Outstanding', '1,000.00', '1,100.00', '09-Aug-26 11-Aug-26 SHOP DUBAI AE 100.00 100.00',
  ].join('\n'), 'AED');
  ok('labels stacked above their values are declined, not contradicted',
    labelsFirst.reconciliation.verdict === 'unknown', JSON.stringify(labelsFirst.reconciliation));
  const wrapped = parseStatementLines([
    'Statement of Account', 'Date Description Debit Credit Balance', 'Opening Balance 5,000.00',
    '01/07/2026 GROCERY 100.00 - 4,900.00', '02/07/2026 VERY LONG PAYEE NAME THAT WRAPPED', '250.00 - 4,650.00',
    'Closing Balance 4,900.00',
  ].join('\n'), 'AED');
  ok('a row lost to wrapping makes the verdict unknown, never proven',
    wrapped.rows.length === 1 && wrapped.reconciliation.verdict === 'unknown', JSON.stringify(wrapped.reconciliation));
  const fromZero = parseStatementLines([
    'Credit Card Statement', 'Credit Limit 50,000.00', 'Minimum Amount Due 0.00',
    'Transaction Date', 'Posting Date', 'Transaction Details', 'Original Amount', '(+) VAT', 'Total Amount', '(AED)',
    'Opening Balance 0.00', '09-Aug-26 11-Aug-26 SHOP ONE DUBAI AE 100.00 100.00', 'Total Outstanding', '100.00',
  ].join('\n'), 'AED');
  ok('a statement opening at zero reconciles instead of reading as unstated',
    fromZero.reconciliation.verdict === 'proven' && fromZero.reconciliation.openingMinor === 0,
    JSON.stringify(fromZero.reconciliation));
  const dashed = parseStatementLines([
    'Statement of Account', 'Date Description Debit Credit Balance', 'Opening Balance -',
    '01/07/2026 GROCERY 100.00 - 4,900.00', 'Closing Balance 4,900.00',
  ].join('\n'), 'AED');
  ok('an empty-cell dash is not a zero balance', dashed.reconciliation.verdict === 'unknown', JSON.stringify(dashed.reconciliation));
  const datedSummary = parseStatementLines([
    'Statement of Account', 'Date Description Debit Credit Balance', 'Opening Balance 5,000.00',
    '01/07/2026 NEW BALANCE 100.00 - 4,900.00', 'Closing Balance 4,900.00',
  ].join('\n'), 'AED');
  ok('a date-led summary row makes the verdict unknown, never contradicted',
    datedSummary.reconciliation.verdict === 'unknown', JSON.stringify(datedSummary.reconciliation));
  // Kinds that are not a movement of their own ledger type: a payment
  // received onto the card is filed as the expense leg of a transfer, yet it
  // LOWERS what is owed; the statement's due row is not a movement at all.
  const paidCard = parseStatementLines([
    'Credit Card Statement', 'Card Number XXXXXXXXXXXX4821', 'Payment Due Date 30/09/2026',
    'Minimum Payment Due 30.00', 'Previous Balance 1,000.00', 'New Balance 600.00',
    'Date Description Amount',
    '01/09/2026 SHOP ONE DUBAI 100.00 DR', '05/09/2026 PAYMENT RECEIVED THANK YOU 500.00 CR',
  ].join('\n'), 'AED', { card: null }, 'day-first');
  ok('a card payment and the due row are summed by what they do to the balance',
    paidCard.rows.some((row) => row.kind === 'cardPayment' && row.type === 'expense') &&
      paidCard.rows.some((row) => row.kind === 'cardStatement') &&
      paidCard.reconciliation.verdict === 'proven' && paidCard.reconciliation.closingMinor === 60000,
    JSON.stringify([brief(paidCard.rows), paidCard.reconciliation]));
  const nothingRead = parseStatementLines('Statement of Account\nOpening Balance 1,000.00\nClosing Balance 900.00', 'AED');
  ok('a statement with no rows read is never called contradicted',
    nothingRead.rows.length === 0 && nothingRead.reconciliation.verdict === 'unknown', JSON.stringify(nothingRead.reconciliation));

  // The layout fingerprint carries the SHAPE of a file that read nothing, and
  // nothing out of it.
  const privacyProbe = [
    'Northbank Gulf Limited', 'Credit Card Statement', 'MS SAMPLE CARDHOLDER', 'EXAMPLE TRADING FZ LLC', 'DUBAI',
    'UNITED ARAB EMIRATES', 'Credit Card Number', '4000 0000 0000 0002', 'Credit Limit 50,000.00',
    'Minimum Amount Due 500.00', 'Transaction Date', 'Posting Date', 'Transaction Details', 'Original Amount',
    '(+) VAT', 'Total Amount', '(AED)', 'Opening Balance 1,500.00',
    '09-Aug-26 11-Aug-26 NFC - (X-PAY)-EXAMPLE PHARMACY 123 BR', 'DUBAI AE', '88.50 88.50',
    '10-Aug-26 11-Aug-26 REBATE 21.40 CR 21.40CR', 'Total Outstanding AED 1,567.10',
  ].join('\n');
  const print = statementLayoutFingerprint(privacyProbe, 'AED');
  const serialized = JSON.stringify(print);
  const leaked = ['SAMPLE', 'CARDHOLDER', 'EXAMPLE', 'TRADING', 'PHARMACY', 'REBATE', 'X-PAY', '4000', '0002',
    '1,500.00', '1500.00', '1,567.10', '88.50', '21.40', '50,000', '500.00']
    .filter((needle) => serialized.toUpperCase().includes(needle.toUpperCase()));
  ok('a fingerprint carries no name, employer, account number, merchant or amount',
    leaked.length === 0, `leaked ${JSON.stringify(leaked)} in ${serialized}`);
  ok('a fingerprint carries no digits outside its counts',
    print.headers.every((header) => !/\d/.test(header)) && print.shapes.every((entry) => !/\d/.test(entry.shape)),
    JSON.stringify([print.headers, print.shapes]));
  ok('a fingerprint names the known column labels and counts the rest',
    print.headers.includes('original amount') && print.headers.includes('total amount') && print.otherHeaderLines >= 3,
    JSON.stringify([print.headers, print.otherHeaderLines]));
  ok('a fingerprint reports the row shapes, wrapped rows already rejoined',
    print.shapes.length === 2 && print.shapes.every((entry) => entry.shape.startsWith('DATE DATE ')) &&
      print.shapes.some((entry) => /MONEY MONEY$/.test(entry.shape)) &&
      print.shapes.some((entry) => /MONEY\+DIR$/.test(entry.shape)) &&
      print.cardStatement === true && print.cardTotalAmountTable === true && print.dateLedLines === 2,
    JSON.stringify(print.shapes));
  const leakedNames = ['ALICE CREDIT', 'MOHAMMED TOTAL', 'ACME PAYMENTS', 'GULF PAYMENTS SERVICES LLC']
    .filter((probe) => statementLayoutFingerprint(['Credit Card Statement', probe, 'Transaction Date', 'Original Amount']
      .join('\n'), 'AED').headers.includes(probe.toLowerCase()));
  ok('a name or company ending in a column noun is never reported as a header',
    leakedNames.length === 0, JSON.stringify(leakedNames));
  const unread = await extractPdfStatementRows(pagedPdf([['MS SAMPLE CARDHOLDER', 'Opening Balance 1,500.00',
    'Date Description Amount', '01/07/2026 SHOP 12.00 15.00']]), 'AED');
  ok('a PDF that read nothing carries its layout, with no contents in it',
    unread.rows.length === 0 && unread.layout !== null && unread.layout.shapes[0]?.shape === 'DATE WORD MONEY MONEY' &&
      !/SAMPLE|CARDHOLDER|1,500|SHOP|12\.00/.test(JSON.stringify(unread.layout)),
    JSON.stringify(unread.layout));

  /* ── 3. Yearless row dates, from the statement period only ──────────── */
  const usChecking = (period, rows, hint = null) => parseStatementLines([
    'CHECKING SUMMARY', 'Account Number: 000000123456789', period, 'Date Description Amount',
    ...rows,
  ].join('\n'), 'USD', { card: null }, hint);
  const chase = usChecking('September 01, 2026 through September 30, 2026', [
    '09/01 STARBUCKS STORE 12345 5.75 DR', '09/15 ACME CORP PAYROLL 3,200.00 CR', '09/28 COMCAST 89.99 DR',
  ]);
  ok('US 09/01 rows take their year from "September 01, 2026 through September 30, 2026"',
    chase.rows.length === 3 && chase.rejectedRows === 0 &&
      chase.rows.map((row) => row.date).join(',') === '2026-09-01,2026-09-15,2026-09-28',
    brief(chase.rows));
  const uk = parseStatementLines([
    'Your account statement', '1 September 2026 - 30 September 2026', 'Date Description Paid out Paid in',
    '1 Sep TESCO STORES 3021 12.00 DR', '12 Sep ACME LTD SALARY 2,450.00 CR', '30 Sep THAMES WATER 31.40 DR',
  ].join('\n'), 'GBP', { card: null }, null);
  ok('UK "1 Sep" rows take their year from "1 September 2026 - 30 September 2026"',
    uk.rows.length === 3 && uk.rejectedRows === 0 && uk.yearlessDateRows === 0 &&
      uk.rows.map((row) => row.date).join(',') === '2026-09-01,2026-09-12,2026-09-30',
    brief(uk.rows));
  const ukShortStart = parseStatementLines([
    'Statement', '1 Sep - 30 Sep 2026', '1 Sep TESCO 12.00 DR', 'Sep 3 BOOTS 4.50 DR',
  ].join('\n'), 'GBP', { card: null }, null);
  ok('a period whose start omits its year, and Sep 3 rows, are read',
    ukShortStart.rows.map((row) => row.date).join(',') === '2026-09-01,2026-09-03' && ukShortStart.rejectedRows === 0,
    brief(ukShortStart.rows));
  const usCard = usChecking('Opening/Closing Date 08/28/26 - 09/27/26', [
    '08/30 SHELL OIL 57444 48.20 DR', '09/02 AMAZON.COM 42.18 DR',
  ]);
  ok('"Opening/Closing Date 08/28/26 - 09/27/26" spans two months',
    usCard.rows.map((row) => row.date).join(',') === '2026-08-30,2026-09-02', brief(usCard.rows));
  const wrap = usChecking('Statement period: December 15, 2026 through January 14, 2027', [
    '12/20 GIFT SHOP 80.00 DR', '01/05 GROCER 20.00 DR',
  ]);
  ok('a December-to-January period gives each row its own year',
    wrap.rows.map((row) => row.date).join(',') === '2026-12-20,2027-01-05', brief(wrap.rows));
  const posted = usChecking('September 01, 2026 through September 30, 2026', ['09/01 09/02 STARBUCKS 5.75 DR', '09/14 09/15 SHOP 1.00 DR']);
  ok('a posting date after the transaction date is filled and dropped the same way',
    posted.rows.map((row) => `${row.date} ${row.merchant}`).join(',') === '2026-09-01 STARBUCKS,2026-09-14 SHOP',
    brief(posted.rows));
  const outside = usChecking('September 01, 2026 through September 30, 2026', ['08/31 EARLY 5.00 DR', '09/14 SHOP 1.00 DR']);
  ok('a row outside the period is refused and counted, never given a nearby year',
    outside.rows.length === 1 && outside.rejectedRows === 1 && outside.yearlessDateRows === 1, brief(outside.rows));
  const noPeriod = parseStatementLines('CHECKING SUMMARY\n09/01 STARBUCKS 5.75 DR\n09/14 SHOP 1.00 DR', 'USD', { card: null }, 'month-first');
  ok('with no statement period every yearless row is refused as dates without a year',
    noPeriod.rows.length === 0 && noPeriod.rejectedRows === 2 && noPeriod.yearlessDateRows === 2 &&
      noPeriod.ambiguousDateRows === 0, brief(noPeriod.rows));
  const noPeriodUk = parseStatementLines('Statement\n1 Sep TESCO 12.00 DR', 'GBP', { card: null }, null);
  ok('a named yearless row is counted too, not silently dropped',
    noPeriodUk.rows.length === 0 && noPeriodUk.rejectedRows === 1 && noPeriodUk.yearlessDateRows === 1);
  const twoPeriods = usChecking('September 01, 2026 through September 30, 2026', [
    'Statement period: October 01, 2026 through October 31, 2026', '09/14 SHOP 1.00 DR',
  ]);
  ok('two different periods settle no year', twoPeriods.rows.length === 0 && twoPeriods.yearlessDateRows === 1);
  const tooLong = usChecking('January 01, 2026 through March 31, 2027', ['09/14 SHOP 1.00 DR']);
  ok('a period longer than twelve months settles no year', tooLong.rows.length === 0 && tooLong.yearlessDateRows === 1);
  const ambiguous = usChecking('September 01, 2026 through September 30, 2026', ['09/01 SHOP 1.00 DR', '09/05 CAFE 2.00 DR']);
  ok('with a period but no day/month evidence the rows are ambiguous dates, not missing years',
    ambiguous.rows.length === 0 && ambiguous.ambiguousDateRows === 2 && ambiguous.yearlessDateRows === 0);
  const chosen = usChecking('September 01, 2026 through September 30, 2026', ['09/01 SHOP 1.00 DR', '09/05 CAFE 2.00 DR'], 'month-first');
  ok('…and the chosen order settles them', chosen.rows.map((row) => row.date).join(',') === '2026-09-01,2026-09-05');
  const dayFirstPeriod = parseStatementLines([
    'Statement of Account', 'Statement Period: 01/09/2026 to 30/09/2026', '01/09 SHOP 1.00 DR', '15/09 CAFE 2.00 DR',
  ].join('\n'), 'AED', { card: null }, null);
  ok('a day-first period and day-first rows read day-first',
    dayFirstPeriod.rows.map((row) => row.date).join(',') === '2026-09-01,2026-09-15', brief(dayFirstPeriod.rows));
  const periodLineOnly = parseStatementLines('Statement\n1 Sep - 30 Sep 2026\n2026-09-02 SHOP 1.00 DR', 'GBP', { card: null }, null);
  ok('the period line itself is never a row', periodLineOnly.rows.length === 1 && periodLineOnly.rejectedRows === 0);
  const yearlessPdf = await extractPdfStatementRows(pagedPdf([['CHECKING SUMMARY', '09/01 STARBUCKS 5.75 DR']]), 'USD', undefined, 'month-first');
  ok('a PDF of yearless rows with no period reports them as dates without a year',
    yearlessPdf.rows.length === 0 && yearlessPdf.yearlessDateRows === 1, JSON.stringify(yearlessPdf.yearlessDateRows));
  // A card statement whose number is labelled "Account Number" (US issuers)
  // and whose payment carries a bare minus: the year is now filled, so the
  // sign convention must refuse that minus rather than read it as spending.
  const usCardSigns = parseStatementLines([
    'ACCOUNT ACTIVITY', 'Account Number: XXXX XXXX XXXX 4321', 'Opening/Closing Date 08/28/26 - 09/27/26',
    'New Balance $91.13 Minimum Payment Due $25.00 Payment Due Date 10/24/26',
    '09/01 STARBUCKS STORE 12345 SEATTLE WA 5.75', '09/10 Payment Thank You-Mobile -500.00',
  ].join('\n'), 'USD', { card: null }, null);
  ok('a minus on a statement with a minimum payment due is never read as spending',
    usCardSigns.rows.length === 0 && usCardSigns.ambiguousCardSignRows === 1, brief(usCardSigns.rows));

  /* ── 4. Opening-balance labels for the balance chain ────────────────── */
  const splitTable = (opening) => [
    'Statement of Account', 'Date Description Money out Money in Balance', opening,
    '01/09/2026 SHOP ONE 100.00 4,900.00', '02/09/2026 SHOP TWO 50.00 4,850.00',
    '03/09/2026 SALARY 2,000.00 6,850.00', '04/09/2026 SHOP THREE 25.00 6,825.00', '05/09/2026 SHOP FOUR 10.00 6,815.00',
  ].join('\n');
  for (const label of ['Start balance', 'Balance brought forward', 'Balance B/F', 'B/F', 'Previous balance',
    'Beginning balance', 'Opening Bal', 'Opening Bal.', 'Opening Balance', 'الرصيد الافتتاحي', 'الرصيد السابق']) {
    const result = parseStatementLines(splitTable(`${label} 5,000.00`), 'AED', { card: null }, 'day-first');
    ok(`"${label}" anchors the first row of a split debit/credit table`,
      result.rows.length === 5 && result.rejectedRows === 0 && result.rows[0].type === 'expense' &&
        result.rows[0].amountFils === 10000 && result.rows[2].type === 'income',
      brief(result.rows));
  }
  const unlabelled = parseStatementLines(splitTable('Some other line 5,000.00'), 'AED', { card: null }, 'day-first');
  ok('without an opening label that first row is still refused rather than guessed',
    unlabelled.rows.length === 4 && unlabelled.rejectedRows === 1);
  const dated = parseStatementLines(splitTable('31/08/2026 Start balance 5,000.00'), 'AED', { card: null }, 'day-first');
  ok('a dated "Start balance" line is a balance, not a transaction', dated.rows.length === 5 && dated.rejectedRows === 0);
  const zero = parseStatementLines(splitTable('Opening Balance 0.00').replace(/4,900\.00/, '-100.00')
    .replace('4,850.00', '-150.00').replace('6,850.00', '1,850.00').replace('6,825.00', '1,825.00')
    .replace('6,815.00', '1,815.00'), 'AED', { card: null }, 'day-first');
  ok('an opening balance of exactly zero is a balance to step from',
    zero.rows.length === 5 && zero.rejectedRows === 0 && zero.rows[0].type === 'expense', brief(zero.rows));
  const csvStart = parseStatementCsv('Date,Description,Debit,Credit\n2026-09-01,Start balance,,1000.00\n2026-09-02,SHOP,10.00,', 'GBP');
  ok('a CSV "Start balance" row is a summary, not income', csvStart.rows.length === 1 && csvStart.rows[0].type === 'expense');

  /* ── 5. Information pages and the Amount in AED foreign original ─────── */
  // Ported from commit 6ef365a5 (fix/ios-parity-eand-home-20261003). An ADCB
  // card statement prints the bank's own collection account and IBAN on a
  // how-to-pay page after the transactions.
  const adcbHeader = [
    'Credit Card Statement كشف الحساب', 'Card Number XXXXXXXXXXXX2280 رقم البطاقة',
    'Statement Date 05/08/26 تاريخ كشف الحساب', 'Payment Due Date 30/08/26 تاريخ استحقاق الدفع',
    'Minimum Payment Due 189.16 الحد الأدنى للدفعة المستحقة',
    'Total Amount Due (to avoid any Finance Charges) 3,783.14 إجمالي المبلغ المستحق',
    'Total Outstanding 3,783.14 إجمالي المبلغ القائم', 'Total Credit Limit 16,100.00 إجمالي حد الائتمان',
    'Available Credit Limit 9,103.75 حد الائتمان المتاح', 'Available Cash Limit 9,104.00 حد السحب النقدي المتاح',
    'Previous Balance 0.00 الرصيد السابق', 'Payments received/ other Credits (-) 0.00 الدفعات المستلمة',
    'New purchases/cash/ debits (+) 3,783.14 المشتريات الجديدة', 'Fees and Finance Charges (+) 0.00 الرسوم',
    'Total Outstanding 3,783.14', 'CARDHOLDER NAME', 'P.O. BOX 36728', 'ABU DHABI',
  ];
  const adcbTable = 'Transaction Date Transaction Description Amount in AED تاريخ المعاملة الوصف المبلغ بالدرهم';
  const adcbPage1 = [
    ...adcbHeader, adcbTable, 'PREVIOUS BALANCE OUTSTANDING 0.00', 'Card No : XXXXXXXXXXXX2280 - CARDHOLDER NAME',
    '26/07/2026 DING MIDDLE EAST DUBAI ARE 27.99', '27/07/2026 E& DIGITAL APP ABU DHABI ARE 30.00',
    '27/07/2026 EMIRATES.CO 2213836991 DUBAI ARE 1410.00',
    '01/08/2026 www*MobileRecharge.com ATLANTA USA 10.14 USD 38.79', '[1 USD=AED 3.82544]',
    'Abu Dhabi Commercial Bank PJSC is licensed and regulated by the Central Bank of the United Arab Emirates.',
    'Page 1 of 3', 'adcb.com',
  ];
  const adcbPage2 = [
    'Card Number XXXXXXXXXXXX2280 رقم البطاقة', adcbTable,
    '02/08/2026 CARREFOUR ABU DHABI ARE 1962.41', '04/08/2026 E& DIGITAL APP ABU DHABI ARE 313.95',
    '05/08/2026 NEW BALANCE OUTSTANDING 3783.14', 'Page 2 of 3', 'adcb.com',
  ];
  const adcbPage3 = [
    'How to pay your credit card', 'Pay from another bank account to Account Number 12345678901234',
    'Account Number 12345678901234', 'IBAN: AE07 0030 0123 4567 8901 234',
    'Account No. 998877665544 TouchPoints rewards', 'Account Number XXXXXXXXXXXX2280', 'Card Number XXXXXXXXXXXX2280',
    'Page 3 of 3', 'adcb.com',
  ];
  const adcbParse = (pages) => parseStatementLines(pages.map((page) => page.join('\n')).join('\n'), 'AED',
    { card: null }, 'day-first', null, pages.map((page) => page.join('\n')));
  const purchases = (result) => result.rows.filter((row) => row.kind === 'transaction');
  const purchaseTotal = (result) => purchases(result).reduce((sum, row) => sum + row.amountFils, 0);
  const adcb = adcbParse([adcbPage1, adcbPage2, adcbPage3]);
  ok('a card statement with a payment, IBAN and rewards page imports every row to its one card',
    purchases(adcb).length === 6 && adcb.rejectedRows === 0 && purchaseTotal(adcb) === 378314 &&
      adcb.rows.every((row) => row.type === 'expense' && row.card?.last4 === '2280'),
    brief(adcb.rows));
  ok('…keeping the statement due row the card statement prints',
    adcb.rows.filter((row) => row.kind === 'cardStatement').length === 1 &&
      adcb.rows.find((row) => row.kind === 'cardStatement')?.amountFils === 378314 &&
      adcb.rows.find((row) => row.kind === 'cardStatement')?.date === '2026-08-30');
  const foreignRow = adcb.rows.find((row) => row.date === '2026-08-01');
  ok('a foreign original inside an Amount in AED row files only the AED charge, with the original as FX',
    foreignRow?.amountFils === 3879 && !/10\.14|USD|38\.79/.test(foreignRow?.merchant ?? '') &&
      foreignRow?.originalCurrency === 'USD' && foreignRow?.originalMinorUnits === 1014 && foreignRow?.fxSource === 'bank',
    JSON.stringify(foreignRow));
  ok('the same card under its header and its section is one card, without the information page',
    purchases(adcbParse([adcbPage1, adcbPage2])).length === 6);
  const asciiPage = (page) => page.map((line) => line.replace(/[^\x20-\x7e]+/g, '').trim()).filter(Boolean);
  const adcbPdf = await extractPdfStatementRows(pagedPdf([asciiPage(adcbPage1), asciiPage(adcbPage2), adcbPage3]),
    'AED', undefined, 'day-first');
  ok('an actual three-page card PDF with a payment-instructions page imports instead of refusing',
    adcbPdf.pages === 3 && purchases(adcbPdf).length === 6 && adcbPdf.rejectedRows === 0 &&
      adcbPdf.completeRowAccounting === true && purchaseTotal(adcbPdf) === 378314 &&
      adcbPdf.rows.every((row) => row.card?.last4 === '2280'),
    brief(adcbPdf.rows));
  // Its rows do add up (0.00 + 3,783.14), but the table prints a DATED
  // "NEW BALANCE OUTSTANDING" line, which could as well be a transaction, so
  // the check declines rather than proves; it never contradicts a right read.
  ok('…and the check stays unknown beside its dated new-balance line',
    adcbPdf.reconciliation.verdict === 'unknown', JSON.stringify(adcbPdf.reconciliation));

  // Each of these keeps the refusal: a second account's rows could be filed
  // to the card, or there is no page boundary to tell an information page by.
  ok('still refuses: without page evidence another labelled account in the text',
    refusal(() => parseStatementLines([...adcbPage1, ...adcbPage2, ...adcbPage3].join('\n'), 'AED', { card: null }, 'day-first'))
      === 'multiple_statement_accounts');
  ok('still refuses: an account number on a page that holds transactions, with rows under it',
    refusal(() => adcbParse([adcbPage1, [...adcbPage2.slice(0, -2), 'Account Number 12345678901234',
      '06/08/2026 TRANSFER RECEIVED 2,000.00 CR', ...adcbPage2.slice(-2)]])) === 'multiple_statement_accounts');
  // Printed after the last row it heads no rows, so none can be filed to the
  // card under it: imported, as `main` imported it (review, 23 October).
  const afterLastRow = adcbParse([adcbPage1, [...adcbPage2, 'Account Number 12345678901234']]);
  ok('an account number after the last row of a page holding transactions heads no rows: imported to the card',
    purchases(afterLastRow).length === 6 && afterLastRow.rejectedRows === 0 &&
      afterLastRow.rows.every((row) => row.card?.last4 === '2280'),
    brief(afterLastRow.rows));
  ok('still refuses: a bank account section with its own rows on a single-card statement',
    refusal(() => adcbParse([adcbPage1, [...adcbPage2.slice(0, -2), 'Account Number XXXXXXXX9031',
      '06/08/2026 SALARY TRANSFER 9,000.00 CR', ...adcbPage2.slice(-2)]])) === 'multiple_statement_accounts');
  const sameLast4 = adcbParse([[...adcbPage1, 'Account Number XXXXXXXXXXXX2280'], adcbPage2]);
  ok('the card\'s own last four under an account label is the same instrument',
    purchases(sameLast4).length === 6 && sameLast4.rows.every((row) => row.card?.last4 === '2280'));
  const cardTable = 'TransactionDate PostingDate TransactionDetails Original Amount VAT Total Amount (AED)';
  const firstCardPage = ['Credit Card Statement', 'Statement Date 05/08/26', 'Card Number XXXXXXXXXXXX2280',
    'Minimum Payment Due 189.16', cardTable, '01-Aug-26 02-Aug-26 SHOP ONE DUBAI AE 10.00 10.00'];
  for (const [name, lastPage] of Object.entries({
    'dash-led wrapped rows': ['Card Number XXXXXXXXXXXX7731', 'Minimum Payment Due 52.00', cardTable,
      '- 03-Aug-26 04-Aug-26 SHOP TWO LONG NAME DUBAI AE', '20.00 20.00'],
    'a row packed onto the label with its amount wrapped': [
      'Card Number XXXXXXXXXXXX7731 -03-Aug-26 04-Aug-26 SHOP TWO LONG NAME DUBAI AE', '20.00 20.00'],
    'yearless row dates': ['Account Number XXXX2222', '03 Sep SALARY 20.00 CR'],
    'yearless month-first row dates': ['Account Number XXXX2222', 'Sep 3 SALARY 20.00 CR'],
  })) {
    const pages = [firstCardPage, lastPage];
    ok(`still refuses: a last page holding another account's rows (${name})`,
      refusal(() => parseStatementLines(pages.flat().join('\n'), 'AED', { card: null }, 'day-first', null,
        pages.map((page) => page.join('\n')))) === 'multiple_statement_accounts');
  }
  const offerPage = adcbParse([adcbPage1, ['Balance transfer offer', 'Credit Card Number XXXXXXXXXXXX9999', 'Terms apply']]);
  ok('a card number on an information page never becomes the statement identity',
    purchases(offerPage).length === 4 && offerPage.rows.every((row) => row.card?.last4 === '2280'),
    JSON.stringify(offerPage.rows.map((row) => row.card)));
  const datedInstructions = adcbParse([adcbPage1, adcbPage2,
    ['Payment Due Date 30/08/26', 'Statement period from 06/07/26 to 05/08/26', ...adcbPage3]]);
  ok('an instructions page that only prints labelled metadata dates still names no section',
    purchases(datedInstructions).length === 6 && datedInstructions.rows.every((row) => row.card?.last4 === '2280'));
  const twoTables = parseStatementLines(['Credit Card Statement', 'Card Number XXXXXXXXXXXX2280', 'Minimum Payment Due 189.16',
    'Transaction Date Transaction Description Amount in AED', '26/07/2026 SHOP ONE ARE 27.99',
    'Instalment Plans', 'Date Description Original Currency Amount (AED)', '01/08/2026 AMAZON 38.79 USD 10.14',
  ].join('\n'), 'AED', { card: null }, 'day-first');
  ok('the foreign-original reading holds only under the table header that allows it',
    purchases(twoTables).length === 1 && purchases(twoTables)[0].amountFils === 2799 && twoTables.rejectedRows === 1,
    brief(twoTables.rows));
  const foreignCase = (header, row) => parseStatementLines([...adcbHeader, header, row].join('\n'), 'AED', { card: null }, 'day-first');
  const foreignRefused = [
    ['Date Description Amount', '01/08/2026 www*MobileRecharge.com ATLANTA USA 10.14 USD 38.79'],
    [adcbTable, '01/08/2026 SHOP ATLANTA USA 10.14 USD 38.79 120.00'],
    ['Transaction Date Description Amount (AED) Original Currency Amount', '01/08/2026 AMAZON US SEATTLE 38.79 USD 10.14'],
    [adcbTable, '01/08/2026 STORE 2026 USD 38.79'],
  ].map(([header, row]) => foreignCase(header, row));
  ok('a foreign figure is never dropped unless the only amount column is the ledger one and the original is exact',
    foreignRefused.every((result) => result.rows.length === 0 && result.rejectedRows === 1),
    JSON.stringify(foreignRefused.map((result) => brief(result.rows))));
  const foreignYen = foreignCase(adcbTable, '01/08/2026 TOKYO SHOP JPN 1,500 JPY 38.79');
  ok('a zero-decimal foreign original is recognised by its own minor unit',
    purchases(foreignYen).length === 1 && purchases(foreignYen)[0].amountFils === 3879 &&
      !/JPY|1,500/.test(purchases(foreignYen)[0].merchant) && purchases(foreignYen)[0].originalMinorUnits === 1500,
    brief(foreignYen.rows));

  /* ── 6. A card export's Type=Payment row is the card settlement ─────── */
  const chaseCsv = (rows, extraHeader = '') => parseStatementCsv([
    `Transaction Date,Post Date,Description,Category,Type,Amount,Memo${extraHeader}`, ...rows,
  ].join('\n'), 'USD', 200, 'month-first');
  // The sign convention is the export's own (one "Payment Thank You" row
  // proves Chase's minus-debit layout); the second payment's description
  // names no payment at all.
  const plainWording = chaseCsv([
    '09/02/2026,09/03/2026,WHOLEFDS MKT 10234,Groceries,Sale,-84.12,',
    '09/05/2026,09/05/2026,Payment Thank You-Mobile,,Payment,300.00,',
    '09/10/2026,09/10/2026,ACH PMT 0910 WEB,,Payment,1200.00,',
    '09/12/2026,09/13/2026,AMAZON MKTPL*AB12C,Shopping,Return,25.99,',
  ]);
  const payment = plainWording.rows.find((row) => row.date === '2026-09-10');
  ok('a card export Payment row is a settlement even when its description names no payment',
    payment?.transferHint === true && payment.merchant === 'Card payment' && payment.categoryGuess === 'other' &&
      plainWording.rows.find((row) => row.date === '2026-09-12')?.transferHint === false,
    brief(plainWording.rows));
  const withCard = parseStatementCsv([
    'Transaction Date,Card No.,Description,Type,Amount',
    '09/02/2026,XXXX1234,WHOLEFDS MKT 10234,Sale,-84.12',
    '09/05/2026,XXXX1234,Payment Thank You-Mobile,Payment,300.00',
    '09/10/2026,XXXX1234,ACH PMT 0910 WEB,Payment,1200.00',
  ].join('\n'), 'USD', 200, 'month-first');
  const cardPayment = withCard.rows.find((row) => row.date === '2026-09-10');
  ok('…and the card payment kind when the export names its card',
    cardPayment?.kind === 'cardPayment' && cardPayment.card?.last4 === '1234' && cardPayment.card?.kind === 'credit' &&
      cardPayment.cardPaymentSide === 'receipt' && cardPayment.transferHint === true,
    brief(withCard.rows));
  const feeTyped = chaseCsv([
    '09/02/2026,09/03/2026,WHOLEFDS MKT 10234,Groceries,Sale,-84.12,',
    '09/10/2026,09/10/2026,Payment Thank You-Mobile,,Payment,1200.00,',
    '09/11/2026,09/11/2026,INTEREST CHARGE REVERSAL,,Payment,5.00,',
  ]);
  ok('a fee or interest wording keeps its own meaning whatever the Type cell says',
    feeTyped.rows.find((row) => row.date === '2026-09-11')?.transferHint === false, brief(feeTyped.rows));
  const bankTyped = parseStatementCsv([
    'Date,Description,Type,Amount,Balance',
    '2026-09-02,ACME LTD,Payment,2500.00,3000.00', '2026-09-03,TESCO STORES 3021,Purchase,-23.40,2976.60',
  ].join('\n'), 'GBP', 200, 'day-first');
  ok('on a bank account export a Payment type is not a card settlement',
    bankTyped.rows.find((row) => row.date === '2026-09-02')?.transferHint === false, brief(bankTyped.rows));

  /* ── 7. Ported onto main (22 October 2026): its wrapped rows, separators ── */
  // main rejoins a description wrapped onto the lines below it. A period line
  // leads with a date and carries words, and a yearless row the period did
  // not date has no date prefix, so main glued the two into one row dated the
  // period's first day ("through September 30, 2026 … EARLY").
  for (const hint of ['month-first', null]) {
    const glued = usChecking('September 01, 2026 through September 30, 2026', ['08/31 EARLY 5.00 DR', '09/14 SHOP 1.00 DR'], hint);
    ok(`a period line is never joined to a yearless row it did not date (hint ${hint})`,
      glued.rows.length === 1 && glued.rows[0].date === '2026-09-14' && glued.rejectedRows === 1 &&
        !glued.rows.some((row) => /through|EARLY/.test(row.merchant)),
      brief(glued.rows));
  }
  const periodNotUnaccounted = parseStatementLines([
    'CHECKING SUMMARY', 'September 01, 2026 through September 30, 2026', 'Beginning Balance 1,000.00',
    'Date Description Amount Balance', '09/01 STARBUCKS -5.75 994.25', '09/15 ACME PAYROLL +2,000.00 2,994.25',
    'Ending Balance 2,994.25',
  ].join('\n'), 'USD', { card: null }, 'month-first');
  ok('a date-led period line is not a lost row: the yearless statement still reconciles',
    periodNotUnaccounted.rows.length === 2 && periodNotUnaccounted.reconciliation.verdict === 'proven',
    JSON.stringify([brief(periodNotUnaccounted.rows), periodNotUnaccounted.reconciliation]));
  // main also dated dashed and dotted pairs; a dotted pair needs words.
  const dashed2 = usChecking('September 01, 2026 through September 30, 2026', ['09-02 SHOP ONE 4.00 DR', '09.03 SHOP TWO 5.00 DR'], 'month-first');
  ok('dashed and dotted yearless rows with words take the period year, as on main',
    dashed2.rows.map((row) => row.date).join(',') === '2026-09-02,2026-09-03' && dashed2.rejectedRows === 0,
    brief(dashed2.rows));
  const figuresOnly = parseStatementLines([
    'Statement of Account', 'Statement Period: 01/09/2026 to 30/09/2026', 'Date Description Debit Credit Balance',
    '02/09/2026 GROCERY 20.00 980.00', '5.09 1,977.18',
  ].join('\n'), 'AED', { card: null }, 'day-first');
  ok('a dotted pair of bare figures is neither dated nor counted as a row',
    figuresOnly.totalRows === 1 && !figuresOnly.rows.some((row) => row.date === '2026-09-05'), brief(figuresOnly.rows));
  const zeroDay = parseStatementLines('Statement\nStatement Period: 01/09/2026 to 30/09/2026\n00/09 SHOP 1.00 DR', 'AED', { card: null }, 'day-first');
  ok('no date has a zero day: such a line is neither dated nor counted as a yearless row',
    zeroDay.rows.length === 0 && zeroDay.yearlessDateRows === 0, JSON.stringify([zeroDay.rejectedRows, zeroDay.yearlessDateRows]));
  const hijriPeriod = parseStatementLines([
    'كشف حساب', 'Statement Period: 01/03/1448 - 30/03/1448', '05/03 SHOP 1.00 DR',
  ].join('\n'), 'SAR', { card: null }, 'day-first');
  ok('a Hijri period dates no yearless row: its day and month are not Gregorian',
    hijriPeriod.rows.length === 0 && hijriPeriod.rejectedRows === 1 && hijriPeriod.yearlessDateRows === 1, brief(hijriPeriod.rows));
  const embedded = parseStatementLines([
    'CHECKING SUMMARY', 'Statement period 09/01/2026 - 09/30/2026 Page 1 of 2', '09/14 SHOP 1.00 DR',
  ].join('\n'), 'USD', { card: null }, 'month-first');
  ok('a range inside a longer line is not a statement period: the row is refused, not dated',
    embedded.rows.length === 0 && embedded.yearlessDateRows === 1, brief(embedded.rows));
  // main sends a fully read account statement's closing balance as the
  // account's balance on its last row; the marked chain proves that balance.
  const marked = parseStatementLines(sixRows.join('\n'), 'AED', { card: null }, 'day-first');
  ok('the marked chain\'s proven closing balance is the last row\'s snapshot, and only that row\'s',
    marked.rows.at(-1).snapshotFils === 1310450 && marked.rows.at(-1).snapshotKind === 'balance' &&
      marked.rows.slice(0, -1).every((row) => row.snapshotFils === null),
    JSON.stringify(marked.rows.map((row) => row.snapshotFils)));
  const sameTwice = parseStatementLines([
    'Statement of Account', '01/09/2026 SHOP ONE 40.00 DR 40.00 DR', '02/09/2026 REFUND SHOP 101.75 CR 101.75 CR',
  ].join('\n'), 'AED', { card: null }, 'day-first');
  ok('the same figure twice is never sent as a balance snapshot',
    sameTwice.rows.length === 2 && sameTwice.rows.every((row) => row.snapshotFils === null),
    JSON.stringify(sameTwice.rows.map((row) => [row.amountFils, row.snapshotFils])));
  // A file whose rows carry full dates is read as before: a yearless-led line
  // in it is a wrapped description's continuation, never a row to date.
  const fullDated = (continuation) => parseStatementLines([
    'Statement of Account', 'Statement Period: 01/09/2026 to 30/09/2026', 'Date Description Debit Credit Balance',
    'Opening Balance 1,000.00', '01/09/2026 GROCERY 20.00 980.00', '02/09/2026 FUEL 30.00 950.00',
    '03/09/2026 NETFLIX SUBSCRIPTION', continuation, '04/09/2026 SALARY 500.00 1,440.01', '05/09/2026 CAFE 10.00 1,430.01',
    'Closing Balance 1,430.01',
  ].join('\n'), 'GBP', { card: null }, 'day-first');
  for (const continuation of ['01 Sep - 30 Sep 9.99 940.01', '12/09 004512 9.99 940.01']) {
    const read = fullDated(continuation);
    ok(`in a full-dated statement "${continuation}" is the wrapped row's continuation, not a yearless row`,
      read.rows.length === 5 && read.rejectedRows === 0 && read.yearlessDateRows === 0 &&
        read.rows[2].date === '2026-09-03' && read.rows[2].type === 'expense' && read.rows[2].amountFils === 999 &&
        !read.rows.some((row) => row.date === '2026-09-12') && read.reconciliation.verdict === 'proven',
      JSON.stringify([brief(read.rows), read.reconciliation]));
  }

  /* ── 8. Review of the port (23 October 2026) ────────────────────────── */
  // A check that can only refuse never refuses what `main` reads right:
  // where it cannot be certain its verdict is `unknown` and the rows import
  // exactly as `main` reads them. A reader never imports a wrong amount: in
  // doubt the row is refused and counted.
  const movementsOf = (result) => result.rows.filter((row) => row.kind === 'transaction' || row.kind === 'cardPayment')
    .map((row) => `${row.kind}:${row.type}:${row.amountFils}`).join(' ');
  const accountHead = ['Statement of Account', 'Account Number 1012345678901'];
  const accountRows = ['Date Description Amount', '02/09/2026 CARREFOUR DUBAI 1,200.00 DR', '05/09/2026 SALARY ACME 300.00 CR'];
  const readsLikeMain = (result) => result.rejectedRows === 0 &&
    movementsOf(result) === 'transaction:expense:120000 transaction:income:30000';
  const verdictOf = (result) => JSON.stringify([brief(result.rows), result.rejectedRows, result.reconciliation]);
  const cardHead = ['Credit Card Statement', 'Card Number 4111 XXXX XXXX 1234', 'Minimum Payment Due 100.00',
    'Payment Due Date 25/10/2026'];

  // 8.1 A line naming both balances anchors neither, and a value is taken
  // only from a line holding exactly one figure.
  for (const [name, summary, currency] of [
    ['Opening Balance Debits Credits Closing Balance over its four values',
      ['Opening Balance Debits Credits Closing Balance', '10,000.00 1,200.00 300.00 9,100.00'], 'AED'],
    ['Opening Balance Closing Balance over its two values', ['Opening Balance Closing Balance', '5,000.00 4,100.00'], 'AED'],
    ['الرصيد الافتتاحي الرصيد الختامي over its two values', ['الرصيد الافتتاحي الرصيد الختامي', '5,000.00 4,100.00'], 'AED'],
    ['Opening Bal 5,000.00 Closing Bal 4,100.00 on one line', ['Opening Bal 5,000.00 Closing Bal 4,100.00'], 'AED'],
    ['SAR-coded values under both labels', ['Opening Balance Closing Balance', 'SAR 5,000.00 SAR 4,100.00'], 'SAR'],
  ]) {
    const read = parseStatementLines([...accountHead, ...summary, ...accountRows].join('\n'), currency, { card: null }, 'day-first');
    ok(`two balance labels on one line anchor neither, and the rows import as on main: ${name}`,
      readsLikeMain(read) && read.reconciliation.verdict === 'unknown', verdictOf(read));
  }
  const cardColumns = parseStatementLines([...cardHead,
    'Previous Balance Payments Purchases New Balance', '1,000.00 500.00 200.00 700.00',
    'Transaction Date Description Amount', '02/09/2026 CARREFOUR DUBAI 200.00',
    '05/09/2026 PAYMENT RECEIVED THANK YOU 500.00 CR',
  ].join('\n'), 'AED', { card: null }, 'day-first');
  ok('a card summary "Previous Balance Payments Purchases New Balance" anchors neither balance',
    movementsOf(cardColumns) === 'transaction:expense:20000 cardPayment:expense:50000' &&
      cardColumns.reconciliation.verdict === 'unknown', verdictOf(cardColumns));
  for (const [name, summary] of [
    ['four labels over four values', ['Opening Balance Debits Credits Closing Balance', '10,000.00 1,200.00 300.00 9,100.00']],
    ['two labels over two values', ['Opening Balance Closing Balance', '5,000.00 4,100.00']],
  ]) {
    const read = await extractPdfStatementRows(pagedPdf([[...accountHead, ...summary, ...accountRows]]), 'AED', undefined, 'day-first');
    ok(`an actual PDF whose summary names both balances on one line imports, never contradicted: ${name}`,
      readsLikeMain(read) && read.reconciliation.verdict === 'unknown', verdictOf(read));
  }
  const stackedColumn = parseStatementLines([...cardHead,
    'Previous Balance', 'Payments', 'Purchases', 'New Balance', '1,000.00', '500.00', '200.00', '700.00',
    'Transaction Date Description Amount', 'Previous Balance 1,000.00', '02/09/2026 CARREFOUR DUBAI 200.00',
    '05/09/2026 PAYMENT RECEIVED THANK YOU 500.00 CR',
  ].join('\n'), 'AED', { card: null }, 'day-first');
  ok('labels stacked over a column of values pair none of them by position',
    movementsOf(stackedColumn) === 'transaction:expense:20000 cardPayment:expense:50000' &&
      stackedColumn.reconciliation.verdict === 'unknown', verdictOf(stackedColumn));
  const otherLabelBetween = parseStatementLines([...accountHead, 'Opening Balance 5,000.00',
    'Closing Balance', 'Available Balance', '3,000.00', ...accountRows].join('\n'), 'AED', { card: null }, 'day-first');
  ok('a value under another label is not this label\'s',
    readsLikeMain(otherLabelBetween) && otherLabelBetween.reconciliation.verdict === 'unknown', verdictOf(otherLabelBetween));
  const currentBalance = parseStatementLines([...accountHead, 'Current Balance 3,000.00', 'Opening Balance 5,000.00',
    ...accountRows].join('\n'), 'AED', { card: null }, 'day-first');
  ok('a header "Current Balance" (the balance on the day printed) is no closing anchor',
    readsLikeMain(currentBalance) && currentBalance.reconciliation.verdict === 'unknown', verdictOf(currentBalance));
  const bilingualBox = parseStatementLines(['Credit Card Statement', 'Credit Limit 50,000.00', 'Minimum Amount Due 500.00',
    'Opening Balance 1,000.00', 'Date Description Amount', '09/08/2026 SHOP ONE DUBAI AE 100.00',
    'Total Outstanding', 'إجمالي المبلغ القائم', '(', 'AED 1,100.00',
  ].join('\n'), 'AED', { card: null }, 'day-first');
  ok('a stacked bilingual box (label, Arabic twin, bracket, value) still proves',
    bilingualBox.reconciliation.verdict === 'proven' && bilingualBox.reconciliation.closingMinor === 110000,
    verdictOf(bilingualBox));

  // 8.2 The arithmetic follows the parser's own card decision, and is
  // `unknown` where the statement's wording says both.
  const creditCardLabelOnly = parseStatementLines(['Northbank', 'Credit Card Number 4111 XXXX XXXX 1234',
    'Payment Due Date 25/10/2026', 'Total Amount Due 700.00', 'Previous Balance 1,000.00', 'Date Description Amount',
    '02/09/2026 CARREFOUR DUBAI 200.00 DR', '05/09/2026 PAYMENT RECEIVED THANK YOU 500.00 CR', 'New Balance 700.00',
  ].join('\n'), 'AED', { card: null }, 'day-first');
  ok('a card proven only by its "Credit Card Number" is checked as the card its rows were read as',
    movementsOf(creditCardLabelOnly) === 'transaction:expense:20000 cardPayment:expense:50000' &&
      creditCardLabelOnly.reconciliation.verdict === 'proven' && creditCardLabelOnly.reconciliation.openingMinor === 100000 &&
      creditCardLabelOnly.reconciliation.closingMinor === 70000, verdictOf(creditCardLabelOnly));
  const balances = ['Opening Balance 5,000.00', ...accountRows, 'Closing Balance 4,100.00'];
  const debitCardAccount = await extractPdfStatementRows(pagedPdf([[...accountHead,
    'Debit Card Number XXXX XXXX XXXX 5521', 'Statement Date 30/09/2026', ...balances]]), 'AED', undefined, 'day-first');
  ok('an account statement naming its debit card beside a statement date is never checked as a card',
    readsLikeMain(debitCardAccount) && debitCardAccount.reconciliation.verdict === 'unknown', verdictOf(debitCardAccount));
  const overdraftLines = [...accountHead, 'Statement Period 01/09/2026 to 30/09/2026', 'Overdraft Credit Limit 10,000.00', ...balances];
  const overdraft = parseStatementLines(overdraftLines.join('\n'), 'AED', { card: null }, 'day-first');
  const overdraftPdf = await extractPdfStatementRows(pagedPdf([overdraftLines]), 'AED', undefined, 'day-first');
  ok('an account with an overdraft credit limit and a statement period is never checked as a card (text and PDF)',
    readsLikeMain(overdraft) && overdraft.reconciliation.verdict === 'unknown' &&
      readsLikeMain(overdraftPdf) && overdraftPdf.reconciliation.verdict === 'unknown',
    `${verdictOf(overdraft)} ${verdictOf(overdraftPdf)}`);
  const oneMarker = parseStatementLines(['Northbank', 'Credit Limit 50,000.00', 'Previous Balance 1,000.00',
    'Date Description Amount', '02/09/2026 CARREFOUR DUBAI 200.00 DR', '05/09/2026 REFUND NOON 500.00 CR', 'New Balance 700.00',
  ].join('\n'), 'AED', { card: null }, 'day-first');
  ok('a statement read as an account that carries a card marker is unknown, not checked as an account',
    oneMarker.rows.length === 2 && oneMarker.reconciliation.verdict === 'unknown', verdictOf(oneMarker));
  for (const head of [['Statement of Account', 'MR SAMPLE'], accountHead]) {
    const paidCard = parseStatementLines([...head, 'Opening Balance 5,000.00', 'Date Description Amount',
      '02/09/2026 PAYMENT TO CREDIT CARD NUMBER 4111 XXXX XXXX 1234 1,200.00 DR', '05/09/2026 SALARY ACME 300.00 CR',
      'Closing Balance 4,100.00'].join('\n'), 'AED', { card: null }, 'day-first');
    ok(`a credit card number named only inside a row never makes the check treat an account as a card (${head[1]})`,
      paidCard.rows.length === 2 && paidCard.rejectedRows === 0 && paidCard.reconciliation.verdict !== 'contradicted',
      verdictOf(paidCard));
  }

  // 8.3 On a card, a balance whose only direction is a sign is no anchor,
  // unless the statement's own legend says what a minus balance means.
  const overpaidClose = parseStatementLines([...cardHead.slice(0, 2), 'Minimum Payment Due 0.00', 'Payment Due Date 25/10/2026',
    'Previous Balance 100.00', 'New Balance -50.00', 'Transaction Date Description Amount',
    '05/09/2026 PAYMENT RECEIVED THANK YOU 150.00 CR',
  ].join('\n'), 'AED', { card: null }, 'day-first');
  ok('an overpaid card printing "New Balance -50.00" is unknown, never read as 50.00 owed',
    movementsOf(overpaidClose) === 'cardPayment:expense:15000' && overpaidClose.reconciliation.verdict === 'unknown',
    verdictOf(overpaidClose));
  const overpaidOpen = parseStatementLines([...cardHead.slice(0, 2), 'Minimum Payment Due 10.00', 'Payment Due Date 25/10/2026',
    'Previous Balance -50.00', 'New Balance 150.00', 'Transaction Date Description Amount', '05/09/2026 CARREFOUR DUBAI 200.00 DR',
  ].join('\n'), 'AED', { card: null }, 'day-first');
  ok('a card opening at "Previous Balance -50.00" is unknown, never read as 50.00 owed',
    movementsOf(overpaidOpen) === 'transaction:expense:20000' && overpaidOpen.reconciliation.verdict === 'unknown',
    verdictOf(overpaidOpen));
  const overpaidPdf = await extractPdfStatementRows(pagedPdf([['Credit Card Statement', 'Card Number XXXX XXXX XXXX 1234',
    'Minimum Payment Due 0.00', 'Payment Due Date 10/25/2026', 'Previous Balance 100.00', 'New Balance -50.00',
    'Date Description Amount', '09/05/2026 PAYMENT THANK YOU 150.00 CR']]), 'USD', undefined, 'month-first');
  ok('…and through an actual PDF',
    movementsOf(overpaidPdf) === 'cardPayment:expense:15000' && overpaidPdf.reconciliation.verdict === 'unknown',
    verdictOf(overpaidPdf));
  const usOverpaid = (legend) => extractPdfStatementRows(pagedPdf([['ACCOUNT SUMMARY',
    'Account Number: XXXX XXXX XXXX 4321', 'Statement Date 09/27/2026', 'Previous Balance $100.00', 'New Balance -$50.00',
    'Minimum Payment Due $0.00', 'Credit Limit $5,000.00', ...legend, 'Date Description Amount',
    '09/05/2026 STARBUCKS STORE 12345 5.00', '09/10/2026 Payment Thank You-Mobile -155.00']]), 'USD', undefined, 'month-first');
  const withLegend = await usOverpaid(['Payments and credits are shown as negative.',
    'A negative New Balance indicates a credit balance.']);
  ok('a card whose legend says a negative balance is a credit balance reads -$50.00 as 50.00 in credit, and proves',
    withLegend.rows.length === 2 && withLegend.reconciliation.verdict === 'proven' &&
      withLegend.reconciliation.openingMinor === 10000 && withLegend.reconciliation.closingMinor === -5000,
    verdictOf(withLegend));
  const rowLegendOnly = await usOverpaid(['Payments and credits are shown as negative.']);
  ok('a legend for the rows alone says nothing about the balance: unknown',
    rowLegendOnly.rows.length === 2 && rowLegendOnly.reconciliation.verdict === 'unknown', verdictOf(rowLegendOnly));
  const overdrawnOpening = parseStatementLines([...accountHead, 'Opening Balance -100.00', 'Date Description Amount',
    '05/09/2026 SALARY ACME 300.00 CR', 'Closing Balance 200.00'].join('\n'), 'AED', { card: null }, 'day-first');
  ok('an account\'s minus balance is an overdraft, and proves',
    overdrawnOpening.reconciliation.verdict === 'proven' && overdrawnOpening.reconciliation.openingMinor === -10000,
    verdictOf(overdrawnOpening));

  // 8.4 A single card account with the card ACCOUNT's number in its header
  // (ADCB style): imported, as `main` imported it, in any file type.
  const cardAccountPage = [
    'Credit Card Statement', 'Card Number XXXXXXXXXXXX2280', 'Account Number 0101234567890',
    'Statement Date 05/08/26', 'Payment Due Date 30/08/26', 'Minimum Payment Due 189.16', 'Total Outstanding 1,440.00',
    'Transaction Date Transaction Description Amount in AED',
    'Card No : XXXXXXXXXXXX2280 - CARDHOLDER NAME',
    '26/07/2026 DING MIDDLE EAST DUBAI ARE 30.00',
    '27/07/2026 EMIRATES.CO 2213836991 DUBAI ARE 1410.00',
  ];
  const onCard = (result, count) => purchases(result).length === count && result.rejectedRows === 0 &&
    result.rows.every((row) => row.card?.last4 === '2280');
  const headerAccountText = parseStatementLines(cardAccountPage.join('\n'), 'AED', { card: null }, 'day-first');
  const headerAccountPdf = await extractPdfStatementRows(pagedPdf([cardAccountPage]), 'AED', undefined, 'day-first');
  ok('a single card with its card account\'s number in the header imports to the card (text and single-page PDF)',
    onCard(headerAccountText, 2) && onCard(headerAccountPdf, 2) &&
      headerAccountText.rows.some((row) => row.kind === 'cardStatement' && row.amountFils === 144000),
    `${brief(headerAccountText.rows)} ${brief(headerAccountPdf.rows)}`);
  const noSection = parseStatementLines(cardAccountPage.filter((line) => !line.startsWith('Card No')).join('\n'),
    'AED', { card: null }, 'day-first');
  ok('…and without a cardholder section line above the rows', onCard(noSection, 2), brief(noSection.rows));
  const repeatedHeader = parseStatementLines([...cardAccountPage, 'Page 1 of 2',
    'Card Number XXXXXXXXXXXX2280', 'Account Number 0101234567890', 'Transaction Date Transaction Description Amount in AED',
    '28/07/2026 CARREFOUR ABU DHABI ARE 50.00', 'Page 2 of 2'].join('\n'), 'AED', { card: null }, 'day-first');
  ok('…and with that header repeated over a later page of rows', onCard(repeatedHeader, 3), brief(repeatedHeader.rows));
  ok('still refuses: an account number heading rows of its own among a single card\'s rows (no page evidence)',
    refusal(() => parseStatementLines([...cardAccountPage.filter((line) => !line.startsWith('Account Number')),
      'Account Number 12345678901234', '29/07/2026 SALARY TRANSFER 9,000.00 CR'].join('\n'), 'AED', { card: null }, 'day-first'))
      === 'multiple_statement_accounts');
  ok('still refuses: an account section printed right under a cardholder section line',
    refusal(() => parseStatementLines([...cardAccountPage.filter((line) => !line.startsWith('Account Number')),
      'Card No : XXXXXXXXXXXX2280 - SUPPLEMENTARY NAME', 'Account Number 12345678901234',
      '29/07/2026 SALARY TRANSFER 9,000.00 CR'].join('\n'), 'AED', { card: null }, 'day-first')) === 'multiple_statement_accounts');
  ok('still refuses: the header\'s own account number heading rows of its own later',
    refusal(() => parseStatementLines([...cardAccountPage, 'Account Number 0101234567890',
      '29/07/2026 SALARY TRANSFER 9,000.00 CR'].join('\n'), 'AED', { card: null }, 'day-first')) === 'multiple_statement_accounts');

  // 8.5 A card table's two marked figures are its original and charged
  // amounts; it prints no running balance. Read at the charge, as on main.
  const fxCard = (extra) => parseStatementLines(['Credit Card Statement', 'Card Number XXXXXXXXXXXX4821',
    'Minimum Payment Due 50.00', 'Payment Due Date 25/10/2026', ...extra].join('\n'), 'AED', { card: null }, 'day-first');
  const fxNoBalances = fxCard(['Transaction Date Description Original Amount Amount',
    '01/09/2026 SHOP ONE 40.00 DR 40.00 DR', '02/09/2026 SPOTIFY STOCKHOLM 20.00 DR 73.60 DR',
    '03/09/2026 HOTEL PARIS 100.00 DR 395.10 DR', '04/09/2026 GYM DUBAI 100.00 DR 105.00 DR',
    '05/09/2026 REFUND SHOP 101.75 CR 101.75 CR']);
  ok('a two-marked-column card table files every FX and VAT row at its charge, none refused',
    movementsOf(fxNoBalances) === 'transaction:expense:4000 transaction:expense:7360 transaction:expense:39510 ' +
      'transaction:expense:10500 transaction:income:10175' && fxNoBalances.rejectedRows === 0, verdictOf(fxNoBalances));
  const coincidence = ['01/09/2026 SHOP ONE 53.60 DR 53.60 DR', '02/09/2026 SPOTIFY STOCKHOLM 20.00 DR 73.60 DR'];
  const fxWithBalances = fxCard(['Previous Balance 0.00', ...coincidence, 'Total Outstanding 127.20']);
  ok('a charge equal to the running total of the rows before it is still filed at the charge, and proves',
    movementsOf(fxWithBalances) === 'transaction:expense:5360 transaction:expense:7360' &&
      fxWithBalances.reconciliation.verdict === 'proven', verdictOf(fxWithBalances));
  const fxBare = fxCard(coincidence);
  ok('…and with no stated balance to catch it, never at its original figure',
    movementsOf(fxBare) === 'transaction:expense:5360 transaction:expense:7360', verdictOf(fxBare));
  const accountCoincidence = parseStatementLines([...accountHead, 'Opening Balance 0.00', ...coincidence].join('\n'),
    'AED', { card: null }, 'day-first');
  ok('on an account the same figure twice seeds no step, even from a stated zero: the next row is refused, never 20.00',
    accountCoincidence.rows.length === 1 && accountCoincidence.rows[0].amountFils === 5360 &&
      accountCoincidence.rejectedRows === 1, verdictOf(accountCoincidence));
  const accountOriginalColumns = parseStatementLines([...accountHead, 'Opening Balance 0.00',
    'Date Description Original Amount Amount', ...coincidence].join('\n'), 'AED', { card: null }, 'day-first');
  ok('under a header naming an original amount column the two figures are two amounts, read at the charge',
    movementsOf(accountOriginalColumns) === 'transaction:expense:5360 transaction:expense:7360' &&
      accountOriginalColumns.rejectedRows === 0, verdictOf(accountOriginalColumns));
  const cardRunningBalance = fxCard(['Previous Balance 1,000.00 DR', '01/09/2026 AMAZON 50.00 DR 1,050.00 DR',
    '05/09/2026 PAYMENT RECEIVED THANK YOU 500.00 CR 550.00 DR', 'New Balance 550.00 DR']);
  ok('a card printing a marked owed balance beside each amount is read as main reads it, and its own balances refuse that read',
    cardRunningBalance.reconciliation.verdict === 'contradicted', verdictOf(cardRunningBalance));

  console.log(`\n${passed} passed, ${failed} failed`);
  process.exit(failed ? 1 : 0);
})().catch((error) => {
  console.error(error);
  process.exit(1);
});
