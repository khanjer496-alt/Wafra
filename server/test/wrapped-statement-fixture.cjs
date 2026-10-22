// A synthetic two-page account statement in the layout of a Gulf bank's PDF
// export (Date | Value Date | Description | Debit | Credit | Balance), with
// the shapes that broke the flattened-text reader:
//   - a first row with no opening balance before it;
//   - direct-debit rows whose description wraps onto two or three lines while
//     the figures sit on the first line, so extraction emits them AFTER the
//     wrapped text ("UADDS Cr" / reference / "1,234.56 5,615.44");
//   - a reference continuation that looks like money ("00012345678.00");
//   - an overdrawn (negative) running balance.
// Every name, number and amount here is invented.
'use strict';

const HEADER_Y = { 1: 600, 2: 614 };
const COLUMNS = { date: 40, value: 98, description: 154, debitRight: 415, creditRight: 494, balanceRight: 573 };
// Helvetica 9pt digit width is 5.004pt; '.', ',' are 2.502pt; '-' 2.997pt.
function textWidth(text) {
  let width = 0;
  for (const ch of text) width += /[0-9]/.test(ch) ? 5.004 : /[.,]/.test(ch) ? 2.502 : ch === '-' ? 2.997 : 5;
  return width;
}
const rightAligned = (right, text) => Math.round((right - textWidth(text)) * 10) / 10;

/**
 * Rows: [date, valueDate, descriptionLines[], debit, credit, balance]. The
 * truth each row stands for is in WRAPPED_STATEMENT_EXPECTED.
 */
const PAGE_ROWS = {
  1: [
    ['02-Jul-2026', '02-Jul-2026', ['Utility Payment-11112222-MBL'], '150.00', '', '4,850.00'],
    ['03-Jul-2026', '03-Jul-2026', ['Inward IPP Payment-'], '', '2,000.00', '6,850.00'],
    ['28-Jul-2026', '28-Jul-2026', ['UADDS Cr', 'Trf-501PY-90000000000000000000000000000001'], '1,234.56', '', '5,615.44'],
    ['01-Aug-2026', '31-Jul-2026', ['Inward IPP Payment-'], '', '300.00', '5,915.44'],
    ['05-Aug-2026', '05-Aug-2026', ['Transfer-MOB'], '415.44', '', '5,500.00'],
  ],
  2: [
    ['29-Aug-2026', '29-Aug-2026', ['UADDS Cr', 'Trf-501PY-90000000000000000000000000000002'], '6,000.00', '', '-500.00'],
    ['29-Aug-2026', '29-Aug-2026', ['UADDS Charge Dr-Insufficient Funds'], '', '6,000.00', '5,500.00'],
    ['29-Aug-2026', '29-Aug-2026', ['VAT Charges-VAT Charges'], '1.25', '', '5,498.75'],
    ['29-Aug-2026', '29-Aug-2026', ['UADDS Dr Trf-DDS501 NO PAY CHARGE', '00012345678.00'], '25.00', '', '5,473.75'],
    ['31-Aug-2026', '31-Aug-2026', ['UADDS Cr', 'Trf-501PY-90000000000000000000000000000002'], '6,000.00', '', '-526.25'],
    ['31-Aug-2026', '31-Aug-2026', ['Transfer-MOB-INTERNAL FT'], '', '2,500.00', '1,973.75'],
    ['08-Sep-2026', '08-Sep-2026', ['IPP Charges-AC-9876543210120044'], '0.49', '', '1,973.26'],
    ['08-Sep-2026', '08-Sep-2026', ['IPP Transfer-MOB-LOCAL FT'], '280.00', '', '1,693.26'],
  ],
};

const WRAPPED_STATEMENT_EXPECTED = [
  ['2026-07-02', 'expense', 15000],
  ['2026-07-03', 'income', 200000],
  ['2026-07-28', 'expense', 123456],
  ['2026-08-01', 'income', 30000],
  ['2026-08-05', 'expense', 41544],
  ['2026-08-29', 'expense', 600000],
  ['2026-08-29', 'income', 600000],
  ['2026-08-29', 'expense', 125],
  ['2026-08-29', 'expense', 2500],
  ['2026-08-31', 'expense', 600000],
  ['2026-08-31', 'income', 250000],
  ['2026-09-08', 'expense', 49],
  ['2026-09-08', 'expense', 28000],
];
/** The statement's closing running balance (last row), in fils. */
const WRAPPED_STATEMENT_CLOSING = 169326;

function pagePreamble(page) {
  const top = 760;
  return [
    'TEST CUSTOMER NAME',
    'PO Box 00000 Example Tower',
    'Currency: AED',
    'Account number: 9876543210120044',
    'Account statement: 01-Jul-2026 to 09-Sep-2026',
    `Sheet No: ${page}`,
    'This is a system generated document and does not require any signature.',
  ].map((text, i) => ({ x: 40, y: top - i * 14, text }));
}

function pageCells(page) {
  const headerY = HEADER_Y[page];
  const cells = [...pagePreamble(page),
    { x: 51.4, y: headerY, text: 'Date' },
    { x: 97.7, y: headerY, text: 'Value Date' },
    { x: 220, y: headerY, text: 'Description' },
    { x: 370.3, y: headerY, text: 'Debit' },
    { x: 447.8, y: headerY, text: 'Credit' },
    { x: 522.7, y: headerY, text: 'Balance' },
  ];
  let y = headerY - 26;
  for (const [date, value, description, debit, credit, balance] of PAGE_ROWS[page]) {
    cells.push({ x: COLUMNS.date, y, text: date }, { x: COLUMNS.value, y, text: value });
    description.forEach((text, i) => cells.push({ x: COLUMNS.description, y: y - i * 12, text }));
    if (debit) cells.push({ x: rightAligned(COLUMNS.debitRight, debit), y, text: debit });
    if (credit) cells.push({ x: rightAligned(COLUMNS.creditRight, credit), y, text: credit });
    cells.push({ x: rightAligned(COLUMNS.balanceRight, balance), y, text: balance });
    y -= 18 + (description.length - 1) * 12;
  }
  return cells;
}

/** The pages for fixtures.cellPdf. */
function wrappedStatementPages() {
  return [pageCells(1), pageCells(2)];
}

/**
 * The same statement as flattened text, the way pdf.js emits it: figures
 * after the wrapped description lines. `trailingMinus` prints an overdrawn
 * balance as `500.00-` (another export's spelling) instead of `-500.00`.
 */
function wrappedStatementText({ trailingMinus = false } = {}) {
  const lines = [];
  for (const page of [1, 2]) {
    lines.push(...pagePreamble(page).map((cell) => cell.text));
    lines.push('Date Value Date Description Debit Credit Balance');
    for (const [date, value, description, debit, credit, balance] of PAGE_ROWS[page]) {
      const shownBalance = trailingMinus && balance.startsWith('-') ? `${balance.slice(1)}-` : balance;
      const figures = [debit || credit, shownBalance].join(' ');
      if (description.length === 1) {
        lines.push(`${date} ${value} ${description[0]} ${figures}`);
      } else {
        lines.push(`${date} ${value} ${description[0]}`, ...description.slice(1), figures);
      }
    }
  }
  return lines.join('\n');
}

module.exports = {
  wrappedStatementPages,
  wrappedStatementText,
  WRAPPED_STATEMENT_EXPECTED,
  WRAPPED_STATEMENT_CLOSING,
};
