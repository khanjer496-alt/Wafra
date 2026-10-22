// Structured statement files (OFX/QFX, QIF, camt.05x, MT940) read end to end:
// readStructuredStatement → records → the shipping parseStatementRecords.
//
// Every fixture is synthetic: fictional names, amounts and account numbers
// (IBANs are the published documentation examples). Build first, from server/:
//   npx esbuild src/structured-statements.ts --bundle --platform=node --format=cjs --outfile=.test-build/structured-statements.cjs
//   npx esbuild src/imports.ts --bundle --platform=node --format=cjs --outfile=.test-build/imports.cjs
// then: node test/structured-statements.test.cjs
const { readStructuredStatement, structuredStatementKind } = require('../.test-build/structured-statements.cjs');
const { parseStatementRecords } = require('../.test-build/imports.cjs');

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
const same = (a, b) => JSON.stringify(a) === JSON.stringify(b);
const show = (value) => JSON.stringify(value);
const utf8 = (text) => new Uint8Array(Buffer.from(text, 'utf8'));
const failure = (run) => {
  try {
    run();
    return null;
  } catch (error) {
    return error instanceof Error ? error.message : String(error);
  }
};
/** Money direction as the ledger sees it: a card receipt is money in to the card. */
const direction = (row) => row.kind === 'cardPayment' ? (row.cardPaymentSide === 'receipt' ? 'income' : 'expense') : row.type;
const brief = (result) => result.rows.filter((row) => row.kind === 'transaction' || row.kind === 'cardPayment')
  .map((row) => [row.date, row.amountFils, direction(row)]);
const read = (bytes, currency, hint = null) => {
  const statement = readStructuredStatement(bytes);
  const result = parseStatementRecords(statement.records, ',', currency, 5000, hint);
  return { statement, result };
};
let wrongDirection = 0;
/** Exact rows (date, minor units, direction) — and count any wrong direction. */
function expectRows(name, result, expected) {
  const actual = brief(result);
  for (const row of actual) {
    const match = expected.find((want) => want[0] === row[0] && want[1] === row[1]);
    if (match && match[2] !== row[2]) wrongDirection += 1;
    if (!match) wrongDirection += 0; // extra rows are reported by the equality check
  }
  ok(name, same(actual, expected), `got ${show(actual)}`);
}

/* ───────────────────────────── OFX v1 bank (SGML, CHARSET:1252) ───────────────────────────── */

const ofxV1 = Buffer.concat([
  Buffer.from([
    'OFXHEADER:100', 'DATA:OFXSGML', 'VERSION:102', 'SECURITY:NONE', 'ENCODING:USASCII', 'CHARSET:1252',
    'COMPRESSION:NONE', 'OLDFILEUID:NONE', 'NEWFILEUID:NONE', '',
    '<OFX>', '<SIGNONMSGSRSV1><SONRS><STATUS><CODE>0<SEVERITY>INFO</STATUS><DTSERVER>20260201120000<LANGUAGE>ENG</SONRS></SIGNONMSGSRSV1>',
    '<BANKMSGSRSV1><STMTTRNRS><TRNUID>1<STATUS><CODE>0<SEVERITY>INFO</STATUS>',
    '<STMTRS><CURDEF>USD',
    '<BANKACCTFROM><BANKID>000000001<ACCTID>000123456789<ACCTTYPE>CHECKING</BANKACCTFROM>',
    '<BANKTRANLIST><DTSTART>20260101<DTEND>20260131',
    '<STMTTRN><TRNTYPE>POS<DTPOSTED>20260105120000.000[-5:EST]<TRNAMT>-45.20<FITID>FIT0001<NAME>',
  ].join('\r\n')),
  Buffer.from('CAF\xc9 CENTRAL', 'latin1'),
  Buffer.from([
    '<MEMO>Card purchase</STMTTRN>',
    '<STMTTRN><TRNTYPE>DIRECTDEP<DTPOSTED>20260115<TRNAMT>2500.00<FITID>FIT0002<NAME>ACME PAYROLL</STMTTRN>',
    '<STMTTRN><TRNTYPE>FEE<DTPOSTED>20260120<TRNAMT>-12,00<FITID>FIT0003<NAME>MONTHLY FEE</STMTTRN>',
    // A DEBIT signed as money in contradicts itself: never emitted.
    '<STMTTRN><TRNTYPE>DEBIT<DTPOSTED>20260121<TRNAMT>99.00<FITID>FIT0004<NAME>ODD ROW</STMTTRN>',
    '<STMTTRN><TRNTYPE>XFER<DTPOSTED>20260125<DTUSER>20260124<TRNAMT>-300<FITID>FIT0005<NAME>TRANSFER TO SAVINGS</STMTTRN>',
    '</BANKTRANLIST>',
    '<LEDGERBAL><BALAMT>1234.56<DTASOF>20260131</LEDGERBAL>',
    '</STMTRS></STMTTRNRS></BANKMSGSRSV1></OFX>', '',
  ].join('\r\n')),
]);
{
  ok('OFX v1 is sniffed from its content', structuredStatementKind(new Uint8Array(ofxV1)) === 'ofx');
  const { statement, result } = read(new Uint8Array(ofxV1), 'USD');
  ok('OFX v1: format, variant, currency, account', statement.format === 'ofx' && statement.variant === 'ofx-sgml' &&
    statement.currency === 'USD' && same(statement.account, { kind: 'account', identifier: '••••6789' }), show(statement.account));
  ok('OFX v1: explicit Debit/Credit layout, contradictory row skipped', statement.layout === 'explicit' && statement.skippedEntries === 1);
  ok('OFX v1: closing balance in minor units', same(statement.closingBalance, { amountMinor: 123456, date: '2026-01-31' }));
  expectRows('OFX v1 bank: every row date/amount/direction', result, [
    ['2026-01-05', 4520, 'expense'],
    ['2026-01-15', 250000, 'income'],
    ['2026-01-20', 1200, 'expense'],
    ['2026-01-24', 30000, 'expense'],
  ]);
  const card = result.rows.map((row) => row.card);
  ok('OFX v1 bank: rows attributed to the stated account tail', card.every((value) => same(value, { last4: '6789', kind: 'account' })), show(card));
  ok('OFX v1: Windows-1252 payee decoded', /CAFÉ CENTRAL/.test(result.rows[0].raw), result.rows[0].raw);
  ok('OFX v1: FITID carried as the reference', result.rows[0].reference === 'FIT0001', result.rows[0].reference);
}

/* ───────────────────────────── OFX v2 credit card (XML) ───────────────────────────── */

const ofxCard = (transactions, acct = '4000001234561111') => utf8([
  '<?xml version="1.0" encoding="UTF-8" standalone="no"?>',
  '<?OFX OFXHEADER="200" VERSION="220" SECURITY="NONE" OLDFILEUID="NONE" NEWFILEUID="NONE"?>',
  '<OFX>',
  '  <CREDITCARDMSGSRSV1><CCSTMTTRNRS><TRNUID>1</TRNUID><STATUS><CODE>0</CODE><SEVERITY>INFO</SEVERITY></STATUS>',
  '    <CCSTMTRS><CURDEF>GBP</CURDEF>',
  `      <CCACCTFROM><ACCTID>${acct}</ACCTID></CCACCTFROM>`,
  '      <BANKTRANLIST><DTSTART>20260201</DTSTART><DTEND>20260228</DTEND>',
  ...transactions.map(([type, date, amount, name, fitid]) =>
    `        <STMTTRN><TRNTYPE>${type}</TRNTYPE><DTPOSTED>${date}</DTPOSTED><TRNAMT>${amount}</TRNAMT><FITID>${fitid}</FITID><NAME>${name}</NAME><MEMO></MEMO></STMTTRN>`),
  '      </BANKTRANLIST>',
  '      <LEDGERBAL><BALAMT>-149.99</BALAMT><DTASOF>20260228</DTASOF></LEDGERBAL>',
  '    </CCSTMTRS>',
  '  </CCSTMTTRNRS></CREDITCARDMSGSRSV1>',
  '</OFX>',
].join('\n'));
{
  const bytes = ofxCard([
    ['DEBIT', '20260203', '-54.99', 'GROCERY MART &amp; DELI', 'CC0001'],
    ['DEBIT', '20260207', '-120.00', 'SKYWAYS AIRLINE', 'CC0002'],
    ['CREDIT', '20260210', '300.00', 'PAYMENT RECEIVED - THANK YOU', 'CC0003'],
    ['CREDIT', '20260212', '25.00', 'REFUND GROCERY MART', 'CC0004'],
  ]);
  const { statement, result } = read(bytes, 'GBP');
  ok('OFX v2 card: credit account, masked tail only', statement.variant === 'ofx-xml' &&
    same(statement.account, { kind: 'credit', identifier: '••••1111' }), show(statement.account));
  ok('OFX v2 card: no full card number anywhere in the records', !JSON.stringify(statement).includes('4000001234561111'));
  ok('OFX v2 card: spec-consistent file stays explicit', statement.layout === 'explicit');
  ok('OFX v2 card: closing balance signed as stated', same(statement.closingBalance, { amountMinor: -14999, date: '2026-02-28' }));
  expectRows('OFX v2 card: charges, payment, refund directions', result, [
    ['2026-02-03', 5499, 'expense'],
    ['2026-02-07', 12000, 'expense'],
    ['2026-02-10', 30000, 'income'],
    ['2026-02-12', 2500, 'income'],
  ]);
  const payment = result.rows.find((row) => row.date === '2026-02-10');
  ok('OFX v2 card: payment becomes the card receipt leg', payment.kind === 'cardPayment' && payment.cardPaymentSide === 'receipt' &&
    same(payment.card, { last4: '1111', kind: 'credit' }), show(payment));
  const charge = result.rows.find((row) => row.date === '2026-02-03');
  ok('OFX v2 card: charges attributed to the credit card', same(charge.card, { last4: '1111', kind: 'credit' }) && /GROCERY MART & DELI/i.test(charge.raw), show(charge.card));
}
{
  // An issuer that signs charges positive (DEBIT +) contradicts the spec:
  // the rows go to the reader's card-sign inference instead.
  const bytes = ofxCard([
    ['DEBIT', '20260203', '54.99', 'GROCERY MART', 'CC0101'],
    ['DEBIT', '20260207', '120.00', 'SKYWAYS AIRLINE', 'CC0102'],
    ['CREDIT', '20260210', '-300.00', 'PAYMENT RECEIVED - THANK YOU', 'CC0103'],
  ]);
  const { statement, result } = read(bytes, 'GBP');
  ok('OFX inverted card: signed layout', statement.layout === 'signed');
  expectRows('OFX inverted card: inferred directions are right', result, [
    ['2026-02-03', 5499, 'expense'],
    ['2026-02-07', 12000, 'expense'],
    ['2026-02-10', 30000, 'income'],
  ]);
  ok('OFX inverted card: still attributed to the credit card', result.rows.every((row) => same(row.card, { last4: '1111', kind: 'credit' })) &&
    result.rows.find((row) => row.date === '2026-02-10').kind === 'cardPayment', show(result.rows.map((row) => [row.kind, row.card])));
}
{
  // Inverted and no payment wording to infer from: refused, not guessed.
  const bytes = ofxCard([
    ['DEBIT', '20260203', '54.99', 'GROCERY MART', 'CC0201'],
    ['CREDIT', '20260207', '-20.00', 'SKYWAYS AIRLINE', 'CC0202'],
  ]);
  const { statement, result } = read(bytes, 'GBP');
  ok('OFX undecidable card: no rows, counted as ambiguous card signs', statement.layout === 'signed' &&
    result.rows.length === 0 && result.ambiguousCardSignRows === 2, show(result));
}

/* ───────────────────────────── QIF ───────────────────────────── */

{
  const bytes = utf8([
    '!Type:Bank',
    'D01/15/2026', 'T-1,234.56', 'PSUPERMARKET 22', 'MWeekly shop', 'N1001', '^',
    "D1/20'26", 'T2,500.00', 'PEMPLOYER PAYROLL', '^',
    'D01/05/2026', 'U-20.00', 'T-20.00', 'PCITY PARKING', '^',
    '',
  ].join('\r\n'));
  ok('QIF is sniffed from its content', structuredStatementKind(bytes) === 'qif');
  const { statement, result } = read(bytes, 'USD', null);
  ok('QIF bank: account kind, no invented identifier, dates as written', same(statement.account, { kind: 'account' }) &&
    statement.records[1][0] === '01/15/2026' && statement.records[2][0] === '1/20/2026', show(statement.records));
  ok('QIF bank: US order is settled by the file itself', statement.dateOrderAmbiguous === false);
  expectRows('QIF bank (US dates): every row', result, [
    ['2026-01-15', 123456, 'expense'],
    ['2026-01-20', 250000, 'income'],
    ['2026-01-05', 2000, 'expense'],
  ]);
}
{
  const bytes = utf8(['!Type:Bank', 'D01/05/2026', 'T-10.00', 'PSHOP A', '^', 'D02/03/2026', 'T-11.00', 'PSHOP B', '^'].join('\n'));
  const statement = readStructuredStatement(bytes);
  ok('QIF: swappable dates are reported ambiguous', statement.dateOrderAmbiguous === true);
  const unknown = parseStatementRecords(statement.records, ',', 'USD', 5000, null);
  ok('QIF ambiguous dates: no hint → refused, not guessed', unknown.rows.length === 0 && unknown.ambiguousDateRows === 2, show(unknown));
  const dayFirst = parseStatementRecords(statement.records, ',', 'USD', 5000, 'day-first');
  expectRows('QIF ambiguous dates: day-first hint decides', dayFirst, [['2026-05-01', 1000, 'expense'], ['2026-03-02', 1100, 'expense']]);
}
{
  // Quicken's card convention: charges negative, payments positive.
  const bytes = utf8([
    '!Type:CCard',
    'D02/03/2026', 'T-54.99', 'PGROCERY MART', '^',
    'D02/17/2026', 'T-120.00', 'PSKYWAYS AIRLINE', '^',
    'D02/20/2026', 'T300.00', 'PPAYMENT - THANK YOU', '^',
  ].join('\n'));
  const { statement, result } = read(bytes, 'USD');
  ok('QIF CCard: signed layout, credit kind', statement.layout === 'signed' && same(statement.account, { kind: 'credit' }));
  expectRows('QIF CCard (charges negative): inferred directions', result, [
    ['2026-02-03', 5499, 'expense'],
    ['2026-02-17', 12000, 'expense'],
    ['2026-02-20', 30000, 'income'],
  ]);
}
{
  // The opposite issuer convention (charges positive) in the same header.
  const bytes = utf8([
    '!Type:CCard',
    'D02/03/2026', 'T54.99', 'PGROCERY MART', '^',
    'D02/17/2026', 'T120.00', 'PSKYWAYS AIRLINE', '^',
    'D02/20/2026', 'T-300.00', 'PPAYMENT RECEIVED - THANK YOU', '^',
  ].join('\n'));
  const { result } = read(bytes, 'USD');
  expectRows('QIF CCard (charges positive): inferred directions', result, [
    ['2026-02-03', 5499, 'expense'],
    ['2026-02-17', 12000, 'expense'],
    ['2026-02-20', 30000, 'income'],
  ]);
}
{
  const bytes = utf8(['!Type:CCard', 'D02/03/2026', 'T54.99', 'PGROCERY MART', '^', 'D02/17/2026', 'T-12.00', 'PSKYWAYS AIRLINE', '^'].join('\n'));
  const { result } = read(bytes, 'USD');
  ok('QIF CCard without evidence: refused as ambiguous card signs', result.rows.length === 0 && result.ambiguousCardSignRows === 2, show(result));
}
{
  // Decimal comma QIF, and a "1.234" that proves nothing in a file that
  // says nothing: skipped, never read as 1234 or 1.234.
  const comma = readStructuredStatement(utf8(['!Type:Bank', 'D2026-03-01', 'T-1.234,50', 'PMIETE', '^', 'D2026-03-02', 'T12,5', 'PZINSEN', '^'].join('\n')));
  expectRows('QIF decimal comma: grouped and plain figures', parseStatementRecords(comma.records, ',', 'EUR', 5000, null), [
    ['2026-03-01', 123450, 'expense'],
    ['2026-03-02', 1250, 'income'],
  ]);
  const unknown = readStructuredStatement(utf8(['!Type:Bank', 'D2026-03-01', 'T-1.234', 'PMIETE', '^'].join('\n')));
  ok('QIF: a figure that proves no decimal mark is skipped', unknown.records.length === 1 && unknown.skippedEntries === 1, show(unknown));
  ok('QIF: investment-only file is unsupported', failure(() => readStructuredStatement(utf8('!Type:Invst\nD01/05/2026\nNBuy\n^\n'))) === 'unsupported_statement_format');
}

/* ───────────────────────────── camt.053 ───────────────────────────── */

const camt = (version, entries, extra = '') => utf8(`<?xml version="1.0" encoding="UTF-8"?>
<Document xmlns="urn:iso:std:iso:20022:tech:xsd:camt.053.001.${version}" xmlns:xsi="http://www.w3.org/2001/XMLSchema-instance">
  <BkToCstmrStmt>
    <GrpHdr><MsgId>MSG-0001</MsgId><CreDtTm>2026-02-01T08:00:00</CreDtTm></GrpHdr>
    <Stmt>
      <Id>STMT-0001</Id>
      <Acct><Id><IBAN>DE89370400440532013000</IBAN></Id><Ccy>EUR</Ccy></Acct>
      <Bal><Tp><CdOrPrtry><Cd>OPBD</Cd></CdOrPrtry></Tp><Amt Ccy="EUR">100.00</Amt><CdtDbtInd>CRDT</CdtDbtInd><Dt><Dt>2026-01-01</Dt></Dt></Bal>
      <Bal><Tp><CdOrPrtry><Cd>CLBD</Cd></CdOrPrtry></Tp><Amt Ccy="EUR">1907.50</Amt><CdtDbtInd>CRDT</CdtDbtInd><Dt><Dt>2026-01-31</Dt></Dt></Bal>
      ${entries}
      ${extra}
    </Stmt>
  </BkToCstmrStmt>
</Document>`);
const ntry = ({ amount, ccy = 'EUR', ind, booked, rvsl = false, status = '<Sts>BOOK</Sts>', party = '', ustrd = '', ref = '', amtDtls = '' }) => `
      <Ntry>
        <Amt Ccy="${ccy}">${amount}</Amt><CdtDbtInd>${ind}</CdtDbtInd>${rvsl ? '<RvslInd>true</RvslInd>' : ''}${status}
        <BookgDt><Dt>${booked}</Dt></BookgDt><ValDt><Dt>${booked}</Dt></ValDt>
        ${ref ? `<AcctSvcrRef>${ref}</AcctSvcrRef>` : ''}
        <NtryDtls><TxDtls>${amtDtls}<RltdPties>${party}</RltdPties><RmtInf><Ustrd>${ustrd}</Ustrd></RmtInf></TxDtls></NtryDtls>
      </Ntry>`;
{
  const bytes = camt('02', [
    ntry({ amount: '45.00', ind: 'DBIT', booked: '2026-01-05', party: '<Cdtr><Nm>Stadtwerke Musterstadt</Nm></Cdtr>', ustrd: 'Abschlag Strom Januar', ref: 'BANKREF-0001' }),
    ntry({ amount: '2000.00', ind: 'CRDT', booked: '2026-01-15', party: '<Dbtr><Nm>Muster GmbH</Nm></Dbtr>', ustrd: 'Gehalt Januar' }),
    // The reversal of the 5 January debit: CRDT, so money back in.
    ntry({ amount: '45.00', ind: 'CRDT', rvsl: true, booked: '2026-01-07', party: '<Cdtr><Nm>Stadtwerke Musterstadt</Nm></Cdtr>', ustrd: 'Ruecklastschrift' }),
    // A card purchase in dollars, booked in euros.
    ntry({ amount: '92.50', ind: 'DBIT', booked: '2026-01-20', party: '<Cdtr><Nm>US Shop Inc</Nm></Cdtr>', ustrd: 'Online order',
      amtDtls: '<AmtDtls><InstdAmt><Amt Ccy="USD">100.00</Amt></InstdAmt><TxAmt><Amt Ccy="EUR">92.50</Amt><CcyXchg><SrcCcy>USD</SrcCcy><TrgtCcy>EUR</TrgtCcy><XchgRate>0.925</XchgRate></CcyXchg></TxAmt></AmtDtls>' }),
    ntry({ amount: '15.00', ind: 'DBIT', booked: '2026-01-31', status: '<Sts>PDNG</Sts>', ustrd: 'Pending' }),
  ].join(''));
  ok('camt.053 is sniffed from its content', structuredStatementKind(bytes) === 'camt053');
  const { statement, result } = read(bytes, 'EUR');
  ok('camt.053: account, currency, variant', statement.variant === 'camt.053' && statement.currency === 'EUR' &&
    same(statement.account, { kind: 'account', identifier: '••••3000' }), show(statement.account));
  ok('camt.053: closing balance CLBD', same(statement.closingBalance, { amountMinor: 190750, date: '2026-01-31' }));
  ok('camt.053: pending entry skipped', statement.skippedEntries === 1);
  expectRows('camt.053 with reversal and FX entry: every row', result, [
    ['2026-01-05', 4500, 'expense'],
    ['2026-01-15', 200000, 'income'],
    ['2026-01-07', 4500, 'income'],
    ['2026-01-20', 9250, 'expense'],
  ]);
  ok('camt.053: rows attributed to the IBAN tail', result.rows.every((row) => same(row.card, { last4: '3000', kind: 'account' })));
  ok('camt.053: counterparty and remittance in the description', /Stadtwerke Musterstadt/.test(result.rows[0].raw) && /Abschlag Strom/.test(result.rows[0].raw));
  ok('camt.053: reversal is labelled', /Reversal/.test(result.rows[2].raw));
  const usd = parseStatementRecords(statement.records, ',', 'USD', 5000, null);
  ok('camt.053: a EUR file is never read into a USD ledger', usd.rows.length === 0, show(brief(usd)));
}
{
  // camt.053.001.08: Sts/Cd and Pty-wrapped party names.
  const bytes = camt('08', ntry({
    amount: '12.34', ind: 'DBIT', booked: '2026-01-09', status: '<Sts><Cd>BOOK</Cd></Sts>',
    party: '<Cdtr><Pty><Nm>Baeckerei Beispiel</Nm></Pty></Cdtr>', ustrd: 'Kartenzahlung',
  }));
  const { result } = read(bytes, 'EUR');
  expectRows('camt.053.001.08: status code and party wrapper', result, [['2026-01-09', 1234, 'expense']]);
  ok('camt.053.001.08: party name read', /Baeckerei Beispiel/.test(result.rows[0].raw));
}
{
  const camt054 = utf8(`<?xml version="1.0"?><Document xmlns="urn:iso:std:iso:20022:tech:xsd:camt.054.001.02"><BkToCstmrDbtCdtNtfctn><GrpHdr><MsgId>N1</MsgId></GrpHdr><Ntfctn><Id>N1</Id><Acct><Id><Othr><Id>0000987654</Id></Othr></Id><Ccy>CHF</Ccy></Acct>${ntry({ amount: '80.00', ccy: 'CHF', ind: 'CRDT', booked: '2026-01-11', party: '<Dbtr><Nm>Beispiel AG</Nm></Dbtr>' })}</Ntfctn></BkToCstmrDbtCdtNtfctn></Document>`);
  const { statement, result } = read(camt054, 'CHF');
  ok('camt.054 notification: Othr account id', statement.variant === 'camt.054' && same(statement.account, { kind: 'account', identifier: '••••7654' }));
  expectRows('camt.054 notification: row', result, [['2026-01-11', 8000, 'income']]);
  ok('camt: DOCTYPE refused', failure(() => readStructuredStatement(utf8('<?xml version="1.0"?><!DOCTYPE x [<!ENTITY a "b">]><Document xmlns="urn:iso:std:iso:20022:tech:xsd:camt.053.001.02"><BkToCstmrStmt/></Document>'))) === 'invalid_statement_file');
  ok('camt: unclosed element refused', failure(() => readStructuredStatement(utf8('<?xml version="1.0"?><Document xmlns="urn:iso:std:iso:20022:tech:xsd:camt.053.001.02"><BkToCstmrStmt><Stmt></BkToCstmrStmt></Document>'))) === 'invalid_statement_file');
  ok('camt: entry without CdtDbtInd skipped, never guessed', readStructuredStatement(camt('02', ntry({ amount: '5.00', ind: 'XXXX', booked: '2026-01-02' }))).skippedEntries === 1);
}

/* ───────────────────────────── MT940 ───────────────────────────── */

const mt940German = [
  ':20:STARTUMSE',
  ':25:37040044/0532013000',
  ':28C:00001/001',
  ':60F:C260101EUR1000,00',
  ':61:2601050105DR45,00NDDTNONREF//BANKREF1',
  ':86:105?00LASTSCHRIFT?100599?20EREF+ABC123?21SVWZ+Strom Januar 2026?32Stadtwerke Muster?33stadt',
  ':61:2601060106CR2500,00NTRFNONREF',
  ':86:166?00GUTSCHRIFT?20SVWZ+Gehalt Januar?32Muster GmbH',
  ':61:2601070107RD45,00NRTINONREF',
  ':86:109?00RUECKLASTSCHRIFT?20SVWZ+Storno Strom?32Stadtwerke Muster',
  ':61:2601080108RC10,00NTRFNONREF',
  ':86:159?00RUECKUEBERWEISUNG?20SVWZ+Rueckbuchung?32Beispiel KG',
  ':61:2601090109D12,5NMSCKARTE-0001',
  ':86:Bäckerei Beispiel Kartenzahlung',
  ':62F:C260109EUR3522,50',
  '-',
].join('\r\n');
{
  const bytes = utf8(`﻿${mt940German}`);
  ok('MT940 (UTF-8 BOM) is sniffed from its content', structuredStatementKind(bytes) === 'mt940');
  const { statement, result } = read(bytes, 'EUR');
  ok('MT940: account from BLZ/Konto, currency, closing', same(statement.account, { kind: 'account', identifier: '••••3000' }) &&
    statement.currency === 'EUR' && same(statement.closingBalance, { amountMinor: 352250, date: '2026-01-09' }), show(statement));
  expectRows('MT940 German with ?-subfields and RC/RD marks: every row', result, [
    ['2026-01-05', 4500, 'expense'],
    ['2026-01-06', 250000, 'income'],
    ['2026-01-07', 4500, 'income'],
    ['2026-01-08', 1000, 'expense'],
    ['2026-01-09', 1250, 'expense'],
  ]);
  ok('MT940: name and SVWZ purpose as description', /Stadtwerke Musterstadt Strom Januar 2026/.test(result.rows[0].raw), result.rows[0].raw);
  ok('MT940: free-text :86: kept', /Bäckerei Beispiel/.test(result.rows[4].raw));
  ok('MT940: rows attributed to the account tail', result.rows.every((row) => same(row.card, { last4: '3000', kind: 'account' })));
}
{
  // Two statements, two accounts (IBANs), and a booking date across New Year.
  const text = [
    ':20:STMT1', ':25:GB33BUKB20201555555555', ':28C:1/1', ':60F:C251231GBP500,00',
    ':61:2512310102D20,00NTRFREF-0001', ':86:COFFEE HOUSE', ':62F:C260102GBP480,00', '-',
    ':20:STMT2', ':25:GB94BARC10201530093459', ':28C:1/1', ':60F:C260101GBP100,00',
    ':61:260103C50,00NTRFREF-0002', ':86:SALARY ACME LTD', ':62F:C260103GBP150,00', '-',
  ].join('\n');
  const { statement, result } = read(utf8(text), 'GBP');
  ok('MT940 multi-account: no single account, no closing balance', statement.account === null && statement.closingBalance === null);
  expectRows('MT940 multi-statement: rows (booking date year rolls over)', result, [
    ['2026-01-02', 2000, 'expense'],
    ['2026-01-03', 5000, 'income'],
  ]);
  ok('MT940 multi-account: each row keeps its own account tail', same(result.rows.map((row) => row.card), [
    { last4: '5555', kind: 'account' }, { last4: '3459', kind: 'account' },
  ]), show(result.rows.map((row) => row.card)));
}
{
  const wrapped = `{1:F01TESTDEFFAXXX0000000000}{2:O9400000260110TESTDEFFAXXX00000000002601100000N}{4:\r\n${mt940German.replace(/\r\n-$/, '')}\r\n-}`;
  const { result } = read(utf8(wrapped), 'EUR');
  ok('MT940 in SWIFT blocks: same rows', brief(result).length === 5);
  ok('MT940: malformed opening balance refused', failure(() => readStructuredStatement(utf8(':20:X\n:25:123456789\n:60F:C2601EUR1,00\n:61:260105C1,00NTRFX\n'))) === 'invalid_statement_file');
  const bad = readStructuredStatement(utf8(':20:X\n:25:123456789\n:60F:C260101EUR1,00\n:61:260105X1,00NTRFX\n:62F:C260105EUR1,00\n'));
  ok('MT940: an unreadable :61: is skipped, never guessed', bad.records.length === 1 && bad.skippedEntries === 1);
}

/* ───────────────────────────── encodings ───────────────────────────── */

{
  const qif = '!Type:Bank\r\nD2026-04-01\r\nT-9.99\r\nPCAFÉ ÜBER\r\n^\r\n';
  const le = Buffer.concat([Buffer.from([0xff, 0xfe]), Buffer.from(qif, 'utf16le')]);
  const { result } = read(new Uint8Array(le), 'EUR');
  expectRows('UTF-16LE (BOM) QIF', result, [['2026-04-01', 999, 'expense']]);
  ok('UTF-16LE: text intact', /CAFÉ ÜBER/.test(result.rows[0].raw));
  const be = Buffer.from(qif, 'utf16le').swap16();
  ok('UTF-16BE without BOM: sniffed and read', structuredStatementKind(new Uint8Array(be)) === 'qif' &&
    brief(read(new Uint8Array(be), 'EUR').result).length === 1);
  const cp1252 = Buffer.from(qif.replace('CAFÉ ÜBER', 'CAF\xc9 \xdcBER'), 'latin1');
  ok('Windows-1252 QIF (not valid UTF-8) falls back cleanly', /CAFÉ ÜBER/.test(read(new Uint8Array(cp1252), 'EUR').result.rows[0].raw));
}

/* ───────────────────────────── refusals and limits ───────────────────────────── */

ok('CSV is not a structured statement', readStructuredStatement(utf8('Date,Description,Amount\n2026-01-01,Shop,-1.00\n')) === null);
ok('PDF is not a structured statement', structuredStatementKind(utf8('%PDF-1.7\n...')) === null);
ok('Empty bytes are not a structured statement', structuredStatementKind(new Uint8Array(0)) === null);
ok('OFX header without <OFX> body refused', failure(() => readStructuredStatement(utf8('OFXHEADER:100\nDATA:OFXSGML\n\nnothing here'))) === 'invalid_statement_file');
ok('OFX with no statement refused', failure(() => readStructuredStatement(utf8('OFXHEADER:100\n\n<OFX><SIGNONMSGSRSV1></SIGNONMSGSRSV1></OFX>'))) === 'invalid_statement_file');
ok('OFX compressed body refused', failure(() => readStructuredStatement(utf8('OFXHEADER:100\nCOMPRESSION:ZIP\n\n<OFX></OFX>'))) === 'invalid_statement_file');
ok('QIF data before any header refused', failure(() => readStructuredStatement(utf8('!Option:AutoSwitch\nD01/01/2026\nT1\n^\n'))) === 'invalid_statement_file');
{
  const many = ['!Type:Bank', ...Array.from({ length: 5001 }, (_, i) => `D2026-01-01\nT-1.00\nPSHOP ${i}\n^`)].join('\n');
  ok('More than 5,000 entries: too_many_rows', failure(() => readStructuredStatement(utf8(many))) === 'too_many_rows');
  const big = `!Type:Bank\nD2026-01-01\nT-1.00\nP${'x'.repeat(2 * 1024 * 1024)}\n^\n`;
  ok('More than 2 MB of text: too_large', failure(() => readStructuredStatement(utf8(big))) === 'too_large');
}
{
  // A long narrative is trimmed to the reader's 180-character title limit, not refused.
  const long = readStructuredStatement(utf8(`!Type:Bank\nD2026-01-01\nT-1.00\nP${'Long payee '.repeat(40)}\n^\n`));
  ok('Long descriptions are trimmed to 180 characters', [...long.records[1][1]].length <= 180 &&
    brief(parseStatementRecords(long.records, ',', 'USD', 5000, null)).length === 1);
}

ok('HARD BAR: zero wrong-direction rows across every fixture', wrongDirection === 0, `${wrongDirection} wrong`);
console.log(`\n${passed} passed, ${failed} failed`);
if (failed > 0) process.exitCode = 1;
