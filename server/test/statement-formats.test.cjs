// Real bank export LAYOUTS, read by the shipping CSV/XLSX/PDF statement code.
//
// Every fixture copies a published export layout — the exact header text,
// delimiter, preamble shape, date spelling and sign convention recorded in the
// statement-format research (bank help pages, open-source importer fixtures)
// — with fictional values. No row here comes from a real person's statement.
// Each layout names its source family in the test title.
const {
  decodeCsv,
  parseStatementCsv: rawCsv,
  parseStatementLines,
  parseStatementXlsx: rawXlsx,
} = require('../.test-build/imports.cjs');
const { buildXlsx } = require('./fixtures.cjs');

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

const csv = (rows, delimiter = ',') => rows.map((row) => row.map((cell) => {
  const text = String(cell);
  return text.includes(delimiter) || /["\r\n]/.test(text) ? `"${text.replace(/"/g, '""')}"` : text;
}).join(delimiter)).join('\r\n');
const brief = (result) => result.rows.map((row) => [row.date, row.amountFils, row.type]);
const same = (a, b) => JSON.stringify(a) === JSON.stringify(b);
const failure = (run) => {
  try {
    run();
    return null;
  } catch (error) {
    return error instanceof Error ? error.message : String(error);
  }
};
// Positive layouts report a refusal as an empty result so every check runs;
// the refusal tests below call the raw readers through failure().
const refused = (error) => ({ rows: [], rejectedRows: -1, error: error instanceof Error ? error.message : String(error) });
const parseStatementCsv = (...args) => {
  try { return rawCsv(...args); } catch (error) { return refused(error); }
};
const parseStatementXlsx = async (...args) => {
  try { return await rawXlsx(...args); } catch (error) { return refused(error); }
};
const latin1 = (text) => new Uint8Array(Buffer.from(text, 'latin1'));

(async () => {
  /* ─────────────── German exports: semicolons, decimal comma, preamble ─────────────── */

  // Sparkasse "CSV-CAMT": own account column first, signed Betrag, no balance.
  const sparkasse = parseStatementCsv(decodeCsv(latin1(csv([
    ['Auftragskonto', 'Buchungstag', 'Valutadatum', 'Buchungstext', 'Verwendungszweck', 'Beguenstigter/Zahlungspflichtiger', 'Kontonummer/IBAN', 'BIC (SWIFT-Code)', 'Betrag', 'Waehrung', 'Info'],
    ['DE00123456780000000001', '05.09.26', '08.09.26', 'FOLGELASTSCHRIFT', 'Online-Shop Bestellung', 'Online-Shop GmbH', 'DE00123456780000000011', 'TESTDEFFXXX', '-99,80', 'EUR', 'Umsatz gebucht'],
    ['DE00123456780000000001', '04.09.26', '04.09.26', 'GUTSCHR. UEBERWEISUNG', 'Gehalt September', 'Arbeitgeber GmbH', 'DE00123456780000000012', 'TESTDEFFXXX', '2450,00', 'EUR', 'Umsatz gebucht'],
    ['DE00123456780000000001', '03.09.26', '03.09.26', 'KARTENZAHLUNG', 'Bäckerei Müller', 'Bäckerei Müller', '', '', '-3,40', 'EUR', 'Umsatz gebucht'],
  ], ';'))), 'EUR', 200, 'day-first');
  ok('Sparkasse CSV-CAMT: German headers, decimal comma, a plain figure on an account export is a credit',
    same(brief(sparkasse), [['2026-09-05', 9980, 'expense'], ['2026-09-04', 245000, 'income'], ['2026-09-03', 340, 'expense']]) &&
      sparkasse.rows[0].merchant === 'Online-Shop GmbH' && sparkasse.rejectedRows === 0,
    JSON.stringify(brief(sparkasse)));
  ok('Sparkasse: the own-account column identifies the statement account, not the counterparty IBAN',
    sparkasse.rows.length === 3 && sparkasse.rows.every((row) => row.card?.last4 === '0001' && row.card?.kind === 'account'),
    JSON.stringify(sparkasse.rows.map((row) => row.card)));

  // ING Germany: 14 preamble lines, Saldo before Betrag, Währung twice.
  const ingPreamble = [
    ['Umsatzanzeige'], ['Datei erstellt am: 01.10.2026 10:00'], [''], ['IBAN', 'DE00 1234 5678 0000 0000 01'],
    ['Kontoname', 'Girokonto'], ['Bank', 'ING'], ['Kunde', 'Erika Beispiel'], ['Zeitraum', '01.09.2026 - 30.09.2026'],
    ['Saldo', '1.234,56', 'EUR'], [''], ['Sortierung', 'Datum absteigend'], [''],
    ['In der CSV-Datei finden Sie alle bereits gebuchten Umsätze.'], [''],
  ];
  const ingRows = [
    ['Buchung', 'Valuta', 'Auftraggeber/Empfänger', 'Buchungstext', 'Verwendungszweck', 'Saldo', 'Währung', 'Betrag', 'Währung'],
    ['30.09.2026', '30.09.2026', 'Stadtwerke Beispiel', 'Lastschrift', 'Abschlag Strom 09/2026', '1.234,56', 'EUR', '-71,00', 'EUR'],
    ['29.09.2026', '29.09.2026', 'Arbeitgeber GmbH', 'Gehalt/Rente', 'Gehalt September', '1.305,56', 'EUR', '2.450,00', 'EUR'],
  ];
  const ingDe = parseStatementCsv(decodeCsv(latin1(csv([...ingPreamble, ...ingRows], ';'))), 'EUR', 200, 'day-first');
  ok('ING Germany: the header is found below a 14-line preamble and two agreeing Währung columns are one currency',
    same(brief(ingDe), [['2026-09-30', 7100, 'expense'], ['2026-09-29', 245000, 'income']]),
    JSON.stringify(brief(ingDe)));
  const ingDisagree = failure(() => rawCsv(csv([...ingPreamble, ingRows[0],
    ['30.09.2026', '30.09.2026', 'Shop', 'Lastschrift', 'x', '1.234,56', 'EUR', '-71,00', 'USD']], ';'), 'EUR', 200, 'day-first'));
  const ingDisagreeRows = ingDisagree ? null : parseStatementCsv(csv([...ingPreamble, ingRows[0],
    ['30.09.2026', '30.09.2026', 'Shop', 'Lastschrift', 'x', '1.234,56', 'EUR', '-71,00', 'USD']], ';'), 'EUR', 200, 'day-first');
  ok('two currency columns that disagree on a row refuse that row rather than pick one',
    ingDisagreeRows !== null && ingDisagreeRows.rows.length === 0 && ingDisagreeRows.rejectedRows === 1,
    String(ingDisagree ?? JSON.stringify(ingDisagreeRows)));

  // Postbank / Deutsche Bank: Soll and Haben columns, the Soll figure printed negative.
  const postbank = parseStatementCsv(csv([
    ['Konto', 'Girokonto'], ['Zeitraum', '01.09.2026 - 30.09.2026'],
    ['Buchungstag', 'Wert', 'Umsatzart', 'Begünstigter / Auftraggeber', 'Verwendungszweck', 'IBAN / Kontonummer', 'BIC', 'Betrag', 'Soll', 'Haben', 'Währung'],
    ['2.9.2026', '2.9.2026', 'SEPA Lastschrift', 'Versicherung AG', 'Beitrag', 'DE00123456780000000021', '', '-74,8', '-74,8', '', 'EUR'],
    ['3.9.2026', '3.9.2026', 'Kartenzahlung', 'Apotheke', 'Einkauf', 'DE00123456780000000023', '', '-23,38', '-23,38', '', 'EUR'],
    ['4.9.2026', '4.9.2026', 'Kartenzahlung', 'Bäckerei', 'Einkauf', 'DE00123456780000000024', '', '-4,10', '-4,10', '', 'EUR'],
    ['15.9.2026', '15.9.2026', 'Gutschrift', 'Arbeitgeber GmbH', 'Gehalt', 'DE00123456780000000022', '', '2.100,00', '', '2.100,00', 'EUR'],
  ], ';'), 'EUR', 200, 'day-first');
  ok('Postbank: Soll/Haben columns read, and a minus on every Soll figure only repeats what the column says',
    same(brief(postbank), [['2026-09-02', 7480, 'expense'], ['2026-09-03', 2338, 'expense'], ['2026-09-04', 410, 'expense'], ['2026-09-15', 210000, 'income']]),
    JSON.stringify(brief(postbank)));

  const loneNegativeDebit = parseStatementCsv(csv([
    ['Buchungstag', 'Verwendungszweck', 'Soll', 'Haben'],
    ['01.09.2026', 'Einkauf', '12,00', ''],
    ['02.09.2026', 'Storno Einkauf', '-12,00', ''],
  ], ';'), 'EUR', 200, 'day-first');
  ok('a minus on only some Soll rows is a reversal written as a negative debit, and is refused',
    same(brief(loneNegativeDebit), [['2026-09-01', 1200, 'expense']]) && loneNegativeDebit.rejectedRows === 1,
    JSON.stringify(brief(loneNegativeDebit)));

  // DKB card (2023+): Betrag (€) with the symbol inside each cell.
  const dkbCard = parseStatementCsv(csv([
    ['Karte', 'Visa Kreditkarte', '4930 •••• •••• 1234'], [''], ['Saldo:', '-120,00 €'], ['Datum:', '01.10.2026'], [''],
    ['Belegdatum', 'Wertstellung', 'Status', 'Beschreibung', 'Umsatztyp', 'Betrag (€)', 'Fremdwährungsbetrag'],
    ['15.09.26', '15.09.26', 'Gebucht', 'SUPERMARKT Filiale Muenchen', 'Im Geschäft', '-10,80 €', ''],
    ['20.09.26', '20.09.26', 'Gebucht', 'Ausgleich Kreditkarte', 'Gutschrift', '136,52 €', ''],
    ['21.09.26', '21.09.26', 'Vorgemerkt', 'ONLINE SHOP', 'Im Internet', '-5,00 €', ''],
  ], ';'), 'EUR', 200, 'day-first');
  ok('DKB card: a header naming € and cells ending in € read as euros; a pending (Vorgemerkt) row is not posted',
    dkbCard.rows.some((row) => row.date === '2026-09-15' && row.amountFils === 1080) &&
      !dkbCard.rows.some((row) => row.amountFils === 500) && dkbCard.rejectedRows >= 1,
    JSON.stringify({ rows: brief(dkbCard), rejected: dkbCard.rejectedRows }));

  /* ─────────────── Dutch exports ─────────────── */

  // ING Netherlands: YYYYMMDD dates, Af/Bij direction column, Bedrag (EUR).
  const ingNl = parseStatementCsv(csv([
    ['Datum', 'Naam / Omschrijving', 'Rekening', 'Tegenrekening', 'Code', 'Af Bij', 'Bedrag (EUR)', 'Mutatiesoort', 'Mededelingen', 'Saldo na mutatie', 'Tag'],
    ['20260913', 'Kosten OranjePakket', 'NL00INGB0000000001', '', 'DV', 'Af', '2,35', 'Diversen', 'Kosten', '256,31', ''],
    ['20260915', 'Werkgever BV', 'NL00INGB0000000001', 'NL00ABNA0000000006', 'OV', 'Bij', '2450,00', 'Overschrijving', 'Salaris', '2706,31', ''],
  ], ';'), 'EUR', 200, 'day-first');
  ok('ING Netherlands: compact YYYYMMDD dates and an Af/Bij direction column',
    same(brief(ingNl), [['2026-09-13', 235, 'expense'], ['2026-09-15', 245000, 'income']]) && ingNl.rows[1].merchant === 'Werkgever BV',
    JSON.stringify(brief(ingNl)));
  const ingNlEn = parseStatementCsv(csv([
    ['Date', 'Name / Description', 'Account', 'Counterparty', 'Code', 'Debit/credit', 'Amount (EUR)', 'Transaction type', 'Notifications', 'Resulting balance', 'Tag'],
    ['20260926', 'Webshop BV', 'NL00INGB0000000001', 'DE00123456780000000007', 'ID', 'Debit', '45,14', 'iDEAL', 'Order 123', '1,46', ''],
    ['20260927', 'Werkgever BV', 'NL00INGB0000000001', 'NL00ABNA0000000006', 'OV', 'Credit', '100,00', 'Transfer', 'Salary', '101,46', ''],
  ], ';'), 'EUR', 200, 'day-first');
  ok('ING Netherlands (English UI): Name / Description and Amount (EUR)',
    same(brief(ingNlEn), [['2026-09-26', 4514, 'expense'], ['2026-09-27', 10000, 'income']]),
    JSON.stringify(brief(ingNlEn)));

  // Rabobank: ISO-8859-1, explicit + and - on every amount.
  const rabo = parseStatementCsv(decodeCsv(latin1(csv([
    ['IBAN/BBAN', 'Munt', 'BIC', 'Volgnr', 'Datum', 'Rentedatum', 'Bedrag', 'Saldo na trn', 'Tegenrekening IBAN/BBAN', 'Naam tegenpartij', 'Naam initiërende partij', 'Omschrijving-1'],
    ['NL00RABO0000000001', 'EUR', 'RABONL2U', '000000000000001001', '2026-09-01', '2026-09-01', '+442,98', '+3436,04', 'NL00RABO0000000009', 'Werkgever BV', '', 'Salaris september'],
    ['NL00RABO0000000001', 'EUR', 'RABONL2U', '000000000000001002', '2026-09-01', '2026-09-01', '-30,00', '+3406,04', 'NL00RABO0000000010', 'Sportclub', '', 'Contributie'],
  ]))), 'EUR', 200, 'day-first');
  ok('Rabobank: Datum, Bedrag with explicit signs, Munt as the currency and the counterparty as the title',
    same(brief(rabo), [['2026-09-01', 44298, 'income'], ['2026-09-01', 3000, 'expense']]) && rabo.rows[1].merchant === 'Sportclub',
    JSON.stringify(rabo.rows.map((row) => [row.merchant, row.amountFils, row.type])));

  /* ─────────────── French, Spanish, Portuguese, Italian, Turkish, Indonesian ─────────────── */

  const sg = parseStatementCsv(decodeCsv(latin1(csv([
    ['="0001234567890"', 'Compte courant'], ['Solde au 30/09/2026', '1 234,56 EUR'],
    ["Date de l'opération", 'Libellé', "Détail de l'écriture", "Montant de l'opération", 'Devise'],
    ['01/09/2026', 'CARTE X1234 30/08 SUPERMARCHE', 'CARTE X1234 30/08 SUPERMARCHE PARIS', '-45,20', 'EUR'],
    ['02/09/2026', 'VIR RECU 0000000001', 'VIR RECU DE: EMPLOYEUR SAS MOTIF: SALAIRE', '2100,00', 'EUR'],
  ], ';'))), 'EUR', 200, 'day-first');
  ok('Société Générale: French headers; a received transfer (VIR RECU … SALAIRE) is the only plain figure',
    same(brief(sg), [['2026-09-01', 4520, 'expense'], ['2026-09-02', 210000, 'income']]),
    JSON.stringify(brief(sg)));
  const ca = parseStatementCsv(decodeCsv(latin1(csv([
    ['Téléchargement du 01/10/2026'], ['Compte de Dépôt'], ['Solde au 30/09/2026 1 234,56 €'],
    ['Date', 'Libellé', 'Débit euros', 'Crédit euros', ''],
    ['01/09/2026', 'PAIEMENT PAR CARTE\nX1234 SUPERMARCHE LYON 30/08', '45,20', '', ''],
    ['02/09/2026', 'VIREMENT EN VOTRE FAVEUR\nEMPLOYEUR SAS', '', '2 100,00', ''],
  ], ';'))), 'EUR', 200, 'day-first');
  ok('Crédit Agricole: Débit euros / Crédit euros columns with space-grouped decimal commas',
    same(brief(ca), [['2026-09-01', 4520, 'expense'], ['2026-09-02', 210000, 'income']]),
    JSON.stringify(brief(ca)));
  const euroInDollarLedger = failure(() => rawCsv(csv([
    ['Date', 'Libellé', 'Débit euros', 'Crédit euros'],
    ['01/09/2026', 'SUPERMARCHE', '45,20', ''],
  ], ';'), 'USD', 200, 'day-first'));
  ok('a column header that names another currency than the ledger refuses the file',
    euroInDollarLedger === 'statement_currency_mismatch', String(euroInDollarLedger));

  const bbva = await parseStatementXlsx(buildXlsx([
    ['Últimos movimientos'], ['Cuenta', 'ES00 0182 0000 0000 0000 0001'], ['Desde', '01/09/2026'], [],
    ['', 'F.Valor', 'Fecha', 'Concepto', 'Movimiento', 'Importe', 'Divisa', 'Disponible', 'Divisa', 'Observaciones'],
    ['', '01/09/2026', '01/09/2026', 'Pago con tarjeta', 'MERCADONA MADRID', { n: '-34.56' }, 'EUR', { n: '1200.44' }, 'EUR', ''],
    ['', '02/09/2026', '02/09/2026', 'Transferencia recibida', 'NOMINA EMPRESA SL', { n: '1850' }, 'EUR', { n: '3050.44' }, 'EUR', 'Nómina septiembre'],
  ]), 'EUR', 200, 'day-first');
  ok('BBVA .xlsx: Fecha before F.Valor, Importe, two Divisa columns and a Disponible balance',
    same(brief(bbva), [['2026-09-01', 3456, 'expense'], ['2026-09-02', 185000, 'income']]),
    JSON.stringify(brief(bbva)));

  const nubank = parseStatementCsv(csv([
    ['Data', 'Valor', 'Identificador', 'Descrição'],
    ['01/09/2026', '-89.90', '00000000-0000-4000-8000-000000000001', 'Compra no débito - MERCADO EXEMPLO'],
    ['02/09/2026', '3500.00', '00000000-0000-4000-8000-000000000002', 'Transferência recebida pelo Pix - EMPRESA EXEMPLO'],
  ]), 'BRL', 200, 'day-first');
  ok('Nubank account: Portuguese headers; a received Pix transfer is the plain figure',
    same(brief(nubank), [['2026-09-01', 8990, 'expense'], ['2026-09-02', 350000, 'income']]),
    JSON.stringify(brief(nubank)));

  const intesa = await parseStatementXlsx(buildXlsx([
    ['Lista movimenti'], ['Conto', '1000/00012345'], [],
    ['Data', 'Operazione', 'Dettagli', 'Conto o carta', 'Contabilizzazione', 'Categoria', 'Valuta', 'Importo'],
    ['30/09/2026', 'Pagamento tramite POS', 'SUPERMERCATO TORINO', 'Conto 1000/00012345', 'CONTABILIZZATO', 'Spesa alimentare', 'EUR', { n: '-45.2' }],
    ['27/09/2026', 'Stipendio o pensione', 'ACCREDITO STIPENDIO SETTEMBRE', 'Conto 1000/00012345', 'CONTABILIZZATO', 'Stipendio', 'EUR', { n: '1850' }],
    ['28/09/2026', 'Pagamento tramite POS', 'BAR CENTRALE', 'Conto 1000/00012345', 'NON CONTABILIZZATO', 'Bar', 'EUR', { n: '-3.5' }],
  ]), 'EUR', 200, 'day-first');
  ok('Intesa Sanpaolo .xlsx: Italian headers, and only CONTABILIZZATO rows are posted',
    same(brief(intesa), [['2026-09-30', 4520, 'expense'], ['2026-09-27', 185000, 'income']]) && intesa.rejectedRows === 1,
    JSON.stringify({ rows: brief(intesa), rejected: intesa.rejectedRows }));

  const bancoposta = parseStatementCsv(csv([
    ['Data', 'Valuta', 'Addebiti', 'Accrediti', 'Descrizione operazioni'],
    ['31/08/26', '', '', '26.851,95', 'SALDO INIZIALE'],
    ['03/09/26', '03/09/26', '2,90', '', 'IMPOSTA DI BOLLO'],
    ['23/09/26', '23/09/26', '', '1.250,00', 'BONIFICO A VOSTRO FAVORE'],
    ['30/09/26', '', '', '28.099,05', 'SALDO FINALE'],
  ], ';'), 'EUR', 200, 'day-first');
  ok('BancoPosta: Addebiti/Accrediti, and SALDO INIZIALE/FINALE are balances, not income',
    same(brief(bancoposta), [['2026-09-03', 290, 'expense'], ['2026-09-23', 125000, 'income']]),
    JSON.stringify(brief(bancoposta)));

  const turkish = parseStatementCsv(csv([
    ['Tarih', 'Açıklama', 'Borç', 'Alacak', 'Bakiye'],
    ['05.09.2026', 'MARKET ALISVERISI ISTANBUL', '1.250,50', '', '8.749,50'],
    ['06.09.2026', 'MAAS ODEMESI ORNEK AS', '', '25.000,00', '33.749,50'],
  ], ';'), 'TRY', 200, 'day-first');
  ok('Turkish Borç/Alacak columns',
    same(brief(turkish), [['2026-09-05', 125050, 'expense'], ['2026-09-06', 2500000, 'income']]),
    JSON.stringify(brief(turkish)));
  const indonesian = parseStatementCsv(csv([
    ['Tanggal', 'Keterangan', 'Debet', 'Kredit', 'Saldo'],
    ['05/09/2026', 'BELANJA TOKO CONTOH', '125.000,00', '', '875.000,00'],
    ['06/09/2026', 'GAJI PT CONTOH', '', '5.000.000,00', '5.875.000,00'],
  ], ';'), 'IDR', 200, 'day-first');
  ok('Indonesian Debet/Kredit columns',
    same(brief(indonesian), [['2026-09-05', 12500000, 'expense'], ['2026-09-06', 500000000, 'income']]),
    JSON.stringify(brief(indonesian)));

  /* ─────────────── English-language bank variants ─────────────── */

  const starling = parseStatementCsv(csv([
    ['Date', 'Counter Party', 'Reference', 'Type', 'Amount (GBP)', 'Balance (GBP)', 'Spending Category', 'Notes'],
    ['01/09/2026', 'Opening Balance', '', '', '0.00', '1250.00', '', ''],
    ['02/09/2026', 'Tesco', 'TESCO STORES', 'CONTACTLESS', '-12.40', '1237.60', 'GROCERIES', ''],
    ['03/09/2026', 'Acme Ltd', 'SALARY', 'FASTER PAYMENT', '1500.00', '2737.60', 'INCOME', ''],
  ]), 'GBP', 200, 'day-first');
  ok('Starling: Counter Party, Amount (GBP) and Balance (GBP)',
    same(brief(starling), [['2026-09-02', 1240, 'expense'], ['2026-09-03', 150000, 'income']]) && starling.rows[0].merchant === 'Tesco',
    JSON.stringify(brief(starling)));
  const gbpInAed = failure(() => rawCsv(csv([
    ['Date', 'Counter Party', 'Amount (GBP)'], ['02/09/2026', 'Tesco', '-12.40'],
  ]), 'AED'));
  ok('Amount (GBP) in an AED ledger is a currency mismatch, never AED', gbpInAed === 'statement_currency_mismatch', String(gbpInAed));

  const revolut = parseStatementCsv(csv([
    ['Type', 'Product', 'Started Date', 'Completed Date', 'Description', 'Amount', 'Fee', 'Currency', 'State', 'Balance'],
    ['CARD_PAYMENT', 'Current', '2026-09-01 10:00:00', '2026-09-02 09:00:00', 'Tesco', '-12.34', '0.00', 'GBP', 'COMPLETED', '987.66'],
    ['TOPUP', 'Current', '2026-09-03 08:00:00', '2026-09-03 08:00:05', 'Top-up by *1234', '500.00', '0.00', 'GBP', 'COMPLETED', '1487.66'],
    ['CARD_PAYMENT', 'Current', '2026-09-04 12:00:00', '', 'Pret', '-4.50', '0.00', 'GBP', 'PENDING', ''],
  ]), 'GBP', 200, 'day-first');
  ok('Revolut: Completed Date with a time, State column (PENDING is not posted), balance-proven credits',
    same(brief(revolut), [['2026-09-02', 1234, 'expense'], ['2026-09-03', 50000, 'income']]) && revolut.rejectedRows === 1,
    JSON.stringify({ rows: brief(revolut), rejected: revolut.rejectedRows }));

  const natwest = parseStatementCsv(['', 'Date, Type, Description, Value, Balance, Account Name, Account Number',
    "01/09/2026,POS,'4321 01SEP26 TESCO STORES 3297 LONDON GB,-12.34,1000.00,'MR J EXAMPLE,'600000-87654321",
    "02/09/2026,BAC,'ACME LTD SALARY,1500.00,2500.00,'MR J EXAMPLE,'600000-87654321",
  ].join('\n'), 'GBP', 200, 'day-first');
  ok('NatWest: a blank first line, space-led header names and a Value column',
    same(brief(natwest), [['2026-09-01', 1234, 'expense'], ['2026-09-02', 150000, 'income']]),
    JSON.stringify({ rows: brief(natwest), rejected: natwest.rejectedRows }));

  const ynab = parseStatementCsv(csv([
    ['Date', 'Payee', 'Memo', 'Outflow', 'Inflow'],
    ['09/01/2026', 'Corner Grocer', 'weekly shop', '84.20', ''],
    ['09/02/2026', 'Employer', 'pay', '', '2500.00'],
  ]), 'USD', 200, 'month-first');
  ok('YNAB import format: Payee, Outflow, Inflow',
    same(brief(ynab), [['2026-09-01', 8420, 'expense'], ['2026-09-02', 250000, 'income']]) && ynab.rows[0].merchant === 'Corner Grocer',
    JSON.stringify(brief(ynab)));

  const discover = parseStatementCsv(csv([
    ['Trans. Date', 'Post Date', 'Description', 'Amount', 'Category'],
    ['09/01/2026', '09/02/2026', 'EXAMPLE MARKET #123', '42.50', 'Supermarkets'],
    ['09/05/2026', '09/05/2026', 'INTERNET PAYMENT - THANK YOU', '-500.00', 'Payments and Credits'],
  ]), 'USD', 200, 'month-first');
  ok('Discover card: Trans. Date, charges plain and the payment negative',
    discover.rows.some((row) => row.date === '2026-09-01' && row.amountFils === 4250 && row.type === 'expense') &&
      !discover.rows.some((row) => row.amountFils === 50000 && row.type === 'expense' && row.kind === 'transaction'),
    JSON.stringify(discover.rows.map((row) => [row.date, row.amountFils, row.type, row.kind])));

  // Discover and Apple Card print charges plain and payments/returns negative,
  // often with no "thank you" wording. With nothing else in the file, that
  // shape fits an account export just as well, so the bare signs are refused.
  const discoverDirectPay = parseStatementCsv(csv([
    ['Trans. Date', 'Post Date', 'Description', 'Amount', 'Category'],
    ['09/01/2026', '09/02/2026', 'EXAMPLE MARKET #123', '42.50', 'Supermarkets'],
    ['09/03/2026', '09/03/2026', 'EXAMPLE RESTAURANT', '28.75', 'Restaurants'],
    ['09/05/2026', '09/05/2026', 'DIRECTPAY FULL BALANCE', '-350.00', 'Payments and Credits'],
  ]), 'USD', 200, 'month-first');
  ok('Discover: a negative DIRECTPAY payment beside plain charges is never filed as spending',
    discoverDirectPay.rows.length === 0 && discoverDirectPay.ambiguousCardSignRows >= 1,
    JSON.stringify({ rows: brief(discoverDirectPay), ambiguous: discoverDirectPay.ambiguousCardSignRows }));
  const appleCard = parseStatementCsv(csv([
    ['Transaction Date', 'Clearing Date', 'Description', 'Merchant', 'Category', 'Type', 'Amount (USD)', 'Purchased By'],
    ['09/13/2026', '09/14/2026', 'SQ *EXAMPLE POKE', 'Example Poke', 'Restaurants', 'Purchase', '22.79', 'Jane Example'],
    ['09/02/2026', '09/03/2026', 'EXAMPLE COFFEE (RETURN)', 'Example Coffee (return)', 'Credit', 'Credit', '-5.50', 'Jane Example'],
    ['08/31/2026', '08/31/2026', 'ACH DEPOSIT INTERNET TRANSFER', 'Ach Deposit', 'Payment', 'Payment', '-1496.16', 'Jane Example'],
  ]), 'USD', 200, 'month-first');
  ok('Apple Card: the payment is never spending; only the row its Type labels Credit is read',
    !appleCard.rows.some((row) => row.type === 'expense' && row.kind === 'transaction' && row.amountFils === 149616) &&
      appleCard.rows.some((row) => row.amountFils === 550 && row.type === 'income'),
    JSON.stringify(appleCard.rows.map((row) => [row.date, row.amountFils, row.type, row.kind])));
  const tescoRefundOnly = parseStatementCsv(csv([
    ['Date', 'Description', 'Amount'], ['2026-09-02', 'ACME LTD', '2500.00'], ['2026-09-03', 'TESCO STORES 3021', '-23.40'],
  ]), 'GBP', 200, 'day-first');
  ok('an ordinary negative purchase still proves an account export',
    same(brief(tescoRefundOnly), [['2026-09-03', 2340, 'expense']]), JSON.stringify(brief(tescoRefundOnly)));

  const amexDetail = parseStatementCsv(csv([
    ['Date', 'Description', 'Card Member', 'Account #', 'Amount'],
    ['09/07/26', 'EXAMPLESOFT*SUBS', 'JANE EXAMPLE', '-54321', '22.99'],
    ['09/08/26', 'EXAMPLE STORE REFUND', 'JANE EXAMPLE', '-54321', '-50.00'],
  ]), 'USD', 200, 'month-first');
  ok('American Express detail export: a Card Member column makes it a card file, so a bare minus is never read as spending',
    !amexDetail.rows.some((row) => row.amountFils === 5000 && row.type === 'expense'),
    JSON.stringify(brief(amexDetail)));

  const citi = parseStatementCsv(csv([
    ['Status', 'Date', 'Description', 'Debit', 'Credit'],
    ['Cleared', '09/28/2026', 'EXAMPLE WHSE #0144', '145.59', ''],
    ['Cleared', '09/28/2026', 'REFUND EXAMPLE SHOP', '', '-10.00'],
  ]), 'USD', 200, 'month-first');
  ok('a minus in the Credit column contradicts it: that row is refused, not guessed',
    citi.rows.length === 1 && citi.rows[0].amountFils === 14559 && citi.rejectedRows === 1,
    JSON.stringify({ rows: brief(citi), rejected: citi.rejectedRows }));

  const barclays = parseStatementCsv(csv([
    ['Number', 'Date', 'Account', 'Amount', 'Subcategory', 'Memo'],
    ['', '02/09/2026', '20-00-00 12345678', '-150', 'Contactless Card Purchase', 'EXAMPLE CAFE \tLONDON\t'],
    ['', '03/09/2026', '20-00-00 12345678', '2089.7', 'DIRECTDEP', 'EXAMPLE LTD        SALARY             BGC'],
  ]), 'GBP', 200, 'day-first');
  ok('Barclays: a tab inside the Memo is whitespace, not a control character',
    barclays.rows.some((row) => row.amountFils === 15000 && row.type === 'expense' && row.merchant === 'EXAMPLE CAFE LONDON'),
    JSON.stringify(barclays.rows.map((row) => [row.merchant, row.amountFils, row.type])));

  /* ─────────────── UAE, Saudi and Indian layouts ─────────────── */

  // ADCB account e-statement: quoted, a time in Posting Date, a trailing comma on data rows.
  const adcb = parseStatementCsv([
    '"Account Number: 10000000000001 AED",',
    '"Statement Period: From 01/09/2026 To 30/09/2026",',
    '"Opening Balance: 5,000.00 AED",',
    '"Posting Date","Value Date","Reference No","Description","Debit Amount","Credit Amount","Balance"',
    '"02/09/2026 09:15:00","02/09/2026","100001","SALARY","0.00","15000.00","20000.00",',
    '"03/09/2026 10:30:22","03/09/2026","100002","MBTRF TRF OUT TO Sample Payee","1250","0.00","18750",',
    '"05/09/2026 14:05:11","05/09/2026","100003","PUR 05/09 FRESH MART Abu Dhabi 6953","120.5","0.00","18629.5",',
  ].join('\r\n'), 'AED');
  ok('ADCB account CSV: a posting time after the date and a trailing empty field are read',
    same(brief(adcb), [['2026-09-02', 1500000, 'income'], ['2026-09-03', 125000, 'expense'], ['2026-09-05', 12050, 'expense']]),
    JSON.stringify({ rows: brief(adcb), rejected: adcb.rejectedRows }));
  const extraCell = parseStatementCsv([
    'Date,Description,Debit,Credit', '01/09/2026,SHOP,10.00,,surprise',
  ].join('\n'), 'AED');
  ok('an extra cell that is NOT empty still rejects the row', extraCell.rows.length === 0 && extraCell.rejectedRows === 1);

  const adcbCard = parseStatementCsv(csv([
    ['Transaction Date', 'Description', 'Cr/Dr', 'Amount in AED'],
    ['Primary Card Number: 4546XXXXXXXX1234', ' Card Holder Name: SAMPLE HOLDER'],
    ['18/09/2026', 'LULU HYPERMARKET- WTC ABU DHABI ARE', 'DR', '150.00'],
    ['17/09/2026', 'PAYMENT RECEIVED, THANK YOU', 'CR', '1200.00'],
  ]), 'AED');
  ok('ADCB card CSV: a Cr/Dr column and Amount in AED',
    adcbCard.rows.some((row) => row.date === '2026-09-18' && row.amountFils === 15000 && row.type === 'expense') &&
      adcbCard.rows.some((row) => row.date === '2026-09-17' && row.amountFils === 120000),
    JSON.stringify(adcbCard.rows.map((row) => [row.date, row.amountFils, row.type, row.kind])));
  const adcbCardInSar = failure(() => rawCsv(csv([
    ['Transaction Date', 'Description', 'Cr/Dr', 'Amount in AED'], ['18/09/2026', 'LULU', 'DR', '150.00'],
  ]), 'SAR'));
  ok('Amount in AED is refused for a SAR ledger', adcbCardInSar === 'statement_currency_mismatch', String(adcbCardInSar));

  // Mashreq .xlsx: Credit before Debit, + on credits and - on debits, 10 metadata rows.
  const mashreq = await parseStatementXlsx(buildXlsx([
    ['Account Holder Name', 'SAMPLE HOLDER'], ['Account Number', '019012345678'], ['Account Type', 'Current Account'],
    ['Account Currency', 'AED'], ['Statement Period', '01 Jan 2026 - 31 Jan 2026'], ['Opening Balance', '5,000.00'],
    ['Closing Balance', '19,880.41'], ['Total Credits', '15,000.41'], ['Total Debits', '120.00'], ['Branch', 'Dubai'], [],
    ['Date', 'Value Date', 'Reference Number', 'Description', 'Credit', 'Debit', 'Balance'],
    ['09 Jan 2026', '09 Jan 2026', 'FT26009ABCDE', 'SALARY ACME TRADING LLC', '+15,000.00', '', '20,000.00'],
    ['10 Jan 2026', '10 Jan 2026', 'POS26010XYZ', 'CARREFOUR MOE DUBAI', '', '-120.00', '19,880.00'],
    ['11 Jan 2026', '11 Jan 2026', 'INT26011', 'PROFIT CREDIT', '+0.41', '', '19,880.41'],
    ['12 Jan 2026', '12 Jan 2026', 'POS26012XYZ', 'TALABAT DUBAI', '', '-45.50', '19,834.91'],
    ['13 Jan 2026', '13 Jan 2026', 'FT26013ABCDE', 'TRANSFER FROM SAVINGS', '+500.00', '', '20,334.91'],
    ['14 Jan 2026', '14 Jan 2026', 'POS26014XYZ', 'ENOC DUBAI', '', '-80.00', '20,254.91'],
  ]), 'AED');
  ok('Mashreq .xlsx: eleven metadata rows, then Credit before Debit with + and - on every figure',
    same(brief(mashreq), [['2026-01-09', 1500000, 'income'], ['2026-01-10', 12000, 'expense'], ['2026-01-11', 41, 'income'],
      ['2026-01-12', 4550, 'expense'], ['2026-01-13', 50000, 'income'], ['2026-01-14', 8000, 'expense']]),
    JSON.stringify({ rows: brief(mashreq), rejected: mashreq.rejectedRows }));
  const flippedSign = parseStatementCsv([
    'Date,Description,Credit,Debit', '09/01/2026,ODD,,+120.00', '10/01/2026,ODDER,-5.00,',
  ].join('\n'), 'AED');
  ok('a + in the Debit column or a - in the Credit column is a contradiction and is refused',
    flippedSign.rows.length === 0 && flippedSign.rejectedRows === 2, JSON.stringify(brief(flippedSign)));

  const hdfc = parseStatementCsv(csv([
    ['HDFC BANK Ltd.'], ['Account No :', 'XXXXXXXXXX6789'], ['Statement From :', '01/09/26', 'To :', '30/09/26'], [],
    ['Date', 'Narration', 'Chq./Ref.No.', 'Value Dt', 'Withdrawal Amt.', 'Deposit Amt.', 'Closing Balance'],
    ['********', '********', '********', '********', '********', '********', '********'],
    ['01/09/26', 'UPI-SAMPLE STORE-SAMPLESTORE@OKAXIS', '0000123456789012', '01/09/26', '450.00', '', '24,550.00'],
    ['02/09/26', 'NEFT CR-CITI0000004-SAMPLE CORP-SALARY', 'CITIN26600012345', '02/09/26', '', '1,85,000.00', '2,09,550.00'],
  ]), 'INR', 200, 'day-first');
  ok('HDFC: Withdrawal Amt. / Deposit Amt., and Indian lakh grouping (1,85,000.00) in an INR ledger',
    same(brief(hdfc), [['2026-09-01', 45000, 'expense'], ['2026-09-02', 18500000, 'income']]),
    JSON.stringify({ rows: brief(hdfc), rejected: hdfc.rejectedRows }));
  const lakhOutsideIndia = parseStatementCsv([
    'Date,Description,Debit,Credit', '01/09/2026,SHOP,"1,85,000.00",',
  ].join('\n'), 'AED');
  ok('lakh grouping is refused outside rupee ledgers', lakhOutsideIndia.rows.length === 0 && lakhOutsideIndia.rejectedRows === 1);

  const icici = parseStatementCsv(csv([
    ['Detailed Statement'],
    ['S No.', 'Value Date', 'Transaction Date', 'Cheque Number', 'Transaction Remarks', 'Withdrawal Amount (INR )', 'Deposit Amount (INR )', 'Balance (INR )'],
    ['1', '01/09/2026', '01/09/2026', '', 'B/F', '0.00', '0.00', '25000.00'],
    ['2', '02/09/2026', '02/09/2026', '', 'UPI/600000000001/SAMPLE STORE/sample@okicici/Payment', '450.00', '0.00', '24550.00'],
    ['3', '03/09/2026', '03/09/2026', '', 'NEFT-SAMPLE CORP-SALARY', '0.00', '85000.00', '109550.00'],
  ]), 'INR', 200, 'day-first');
  ok('ICICI: Transaction Remarks and Withdrawal/Deposit Amount (INR )',
    same(brief(icici), [['2026-09-02', 45000, 'expense'], ['2026-09-03', 8500000, 'income']]),
    JSON.stringify(brief(icici)));
  const axis = parseStatementCsv(csv([
    ['Tran Date', 'CHQNO', 'PARTICULARS', 'DR', 'CR', 'BAL', 'SOL'],
    ['02-09-2026', '', 'UPI/P2M/600000000001/SAMPLE STORE/UPI/AXIS BANK', '124.90', '', '29124.83', '3693'],
    ['03-09-2026', '', 'NEFT/000000000001/SAMPLE CORP/HDFC BANK/SALARY', '', '50567.00', '79691.83', '248'],
  ]), 'INR', 200, 'day-first');
  ok('Axis: Tran Date and DR/CR columns',
    same(brief(axis), [['2026-09-02', 12490, 'expense'], ['2026-09-03', 5056700, 'income']]),
    JSON.stringify(brief(axis)));

  /* ─────────────── dates ─────────────── */

  const yearFirst = parseStatementCsv(csv([
    ['Date', 'Amount', 'Balance', 'Description'],
    ['2026/09/01', '-249.99', '5750.01', 'POS PURCHASE GROCER'],
    ['2026/09/02', '1000.00', '6750.01', 'SALARY'],
  ]), 'ZAR', 200, 'day-first');
  ok('year-first dates with slashes (2026/09/01) read in any country',
    same(brief(yearFirst), [['2026-09-01', 24999, 'expense'], ['2026-09-02', 100000, 'income']]),
    JSON.stringify(brief(yearFirst)));
  const badCompact = parseStatementCsv(csv([
    ['Datum', 'Omschrijving', 'Af Bij', 'Bedrag'], ['20261332', 'X', 'Af', '1,00'], ['12345678', 'Y', 'Af', '1,00'],
  ]), 'EUR', 200, 'day-first');
  ok('an eight-digit cell that is not a real YYYYMMDD date is refused', badCompact.rows.length === 0 && badCompact.rejectedRows === 2);

  /* ─────────────── PDF safety (flattened text) ─────────────── */

  // ENBD account PDF: debits printed with a minus, the balance labelled Cr.
  const enbdPdf = parseStatementLines([
    'STATEMENT OF ACCOUNT FOR THE PERIOD OF 01 Jan 2026 to 31 Jan 2026',
    'Date Description Debits Credits Balance',
    '24 Jan 2026 CC NO.-4000********0000 RMA REF NO.- -1250.00 3341.06 Cr',
    '26 Jan 2026 POS-PURCHASE CARD NO. 4000********1234 -45.00 3296.06 Cr',
  ].join('\n'), 'AED');
  ok('ENBD PDF: a signed amount before a Cr-labelled balance never imports the balance as a credit',
    !enbdPdf.rows.some((row) => row.type === 'income' && (row.amountFils === 334106 || row.amountFils === 329606)),
    JSON.stringify(brief(enbdPdf)));
  // RAKBANK card PDF: `amount CR - balance`.
  const rakPdf = parseStatementLines([
    'Your Credit Card Statement',
    '16/08/2026 CARREFOUR MOE DUBAI AED 125.50 - 1,125.50',
    '20/08/2026 PAYMENT RECEIVED - THANK YOU AED 1,000.00 CR - 125.50',
  ].join('\n'), 'AED');
  ok('RAKBANK PDF: a CR label inside the description means the columns were misread; the row is refused',
    !rakPdf.rows.some((row) => row.date === '2026-08-20' && row.amountFils === 12550),
    JSON.stringify(brief(rakPdf)));

  // Bank AlJazira account PDF: continuation lines under a row carry the paid
  // card's reference and a Hijri date; they are not a second account.
  const aljazira = parseStatementLines([
    'Account No.: 012345678001',
    'Statement Date: 25/07/26 - 24/08/26',
    'Date Description Value Date Withdrawal (Dr) Deposit (Cr) Balance',
    '26/07/26 Incoming Local Transfer 26/07/26 - 8,430.24 12,774.01',
    'From SAMPLE BANK',
    '02/08/26 Credit Card Payment 02/08/26 2,210.78 - 10,563.23',
    'Card 123456789',
    'Through Bank Aljazira',
    '03/08/26 POS Purchase 03/08/26 64.50 - 10,498.73',
  ].join('\n'), 'SAR');
  ok('Bank AlJazira PDF: a short card reference under a payment row is not a second statement account',
    aljazira.rows.length === 3 && aljazira.rows[0].type === 'income' && aljazira.rows[2].amountFils === 6450,
    JSON.stringify(brief(aljazira)));
  ok('a second labelled account number in a flattened statement still refuses the file',
    failure(() => parseStatementLines(['Account No.: 012345678001', 'Account No.: 012345679999',
      '26/07/26 Incoming 26/07/26 - 8,430.24 12,774.01'].join('\n'), 'SAR')) === 'multiple_statement_accounts');

  // Emirates Islamic-style headerless table printing Credit before Debit: the
  // Debit-first default would invert every row, and the balance proves it.
  const swappedColumns = parseStatementLines([
    'Account Statement',
    '04-01-2026 OPENING ROW 0.00 100.00 5,000.00',
    '05-01-2026 SALARY TRANSFER ACME TRADING 15,000.00 0.00 20,000.00',
    '06-01-2026 POS PURCHASE SAMPLE MART DUBAI 0.00 125.50 19,874.50',
    '07-01-2026 SERVICE CHARGES 0.00 26.25 19,848.25',
  ].join('\n'), 'AED');
  ok('a headerless debit/credit/balance table whose balances disprove the column order is refused whole, not inverted',
    swappedColumns.rows.length === 0 && swappedColumns.rejectedRows === 4,
    JSON.stringify({ rows: brief(swappedColumns), rejected: swappedColumns.rejectedRows }));
  const agreeingColumns = parseStatementLines([
    'Account Statement',
    '04-01-2026 OPENING ROW 100.00 0.00 5,000.00',
    '05-01-2026 SALARY TRANSFER ACME TRADING 0.00 15,000.00 20,000.00',
    '06-01-2026 POS PURCHASE SAMPLE MART DUBAI 125.50 0.00 19,874.50',
  ].join('\n'), 'AED');
  ok('the same table in Debit-first order, whose balances agree, still reads every row',
    same(brief(agreeingColumns), [['2026-01-04', 10000, 'expense'], ['2026-01-05', 1500000, 'income'], ['2026-01-06', 12550, 'expense']]),
    JSON.stringify(brief(agreeingColumns)));

  // A newest-first table can step its balance "the wrong way" by coincidence
  // (two equal purchases in a row). Without a header that is indistinguishable
  // from a swapped Debit/Credit order, so the assumed order is refused whole;
  // a header that names the order is trusted and the table reads as before.
  const newestFirstRows = [
    '07-01-2026 SHOP C 50.00 0.00 900.00',
    '06-01-2026 SHOP B 50.00 0.00 950.00',
    '05-01-2026 SALARY 0.00 1,000.00 1,000.00',
  ];
  const newestFirstHeaderless = parseStatementLines(['Account Statement', ...newestFirstRows].join('\n'), 'AED');
  const newestFirstHeader = parseStatementLines(['Date Description Debit Credit Balance', ...newestFirstRows].join('\n'), 'AED');
  ok('newest-first: headerless, a coincidental step refuses the assumed order; with a header every row reads',
    newestFirstHeaderless.rows.length === 0 &&
      same(newestFirstHeader.rows.map((row) => [row.merchant, row.type]), [['SHOP C', 'expense'], ['SHOP B', 'expense'], ['SALARY', 'income']]),
    JSON.stringify({ headerless: brief(newestFirstHeaderless), header: brief(newestFirstHeader) }));

  const mashreqOneSalary = await parseStatementXlsx(buildXlsx([
    ['Date', 'Value Date', 'Reference Number', 'Description', 'Credit', 'Debit', 'Balance'],
    ['09 Jan 2026', '09 Jan 2026', 'FT1', 'SALARY ACME TRADING LLC', '+15,000.00', '', '20,000.00'],
    ['10 Jan 2026', '10 Jan 2026', 'POS1', 'CARREFOUR MOE DUBAI', '', '-120.00', '19,880.00'],
    ['12 Jan 2026', '12 Jan 2026', 'POS2', 'TALABAT DUBAI', '', '-45.50', '19,834.50'],
    ['14 Jan 2026', '14 Jan 2026', 'POS3', 'ENOC DUBAI', '', '-80.00', '19,754.50'],
  ]), 'AED');
  ok('Mashreq: a month with one + salary credit reads it, once the - debits prove the signed layout',
    mashreqOneSalary.rows.length === 4 && mashreqOneSalary.rows[0].type === 'income' && mashreqOneSalary.rows[0].amountFils === 1500000,
    JSON.stringify(brief(mashreqOneSalary)));

  const mashreqReturn = parseStatementCsv(csv([
    ['Date', 'Description', 'Credit', 'Debit'],
    ['01/09/2026', 'SALARY', '+100.00', ''], ['02/09/2026', 'TRANSFER IN', '+50.00', ''],
    ['03/09/2026', 'PROFIT', '+1.00', ''], ['04/09/2026', 'CARREFOUR RETURN', '', '-20.00'],
  ]), 'AED');
  ok('re-review: a lone negative debit worded as a return is not read through the mirrored sign rule',
    !mashreqReturn.rows.some((row) => row.amountFils === 2000), JSON.stringify(brief(mashreqReturn)));

  /* ─────────────── independent-review regressions ─────────────── */

  const cardWithAccountColumn = parseStatementCsv(csv([
    ['Transaction Date', 'Description', 'Amount', 'Account Number'],
    ['21/09/2026', 'AMAZON MKTPLACE', '45.00', 'XXXX1234'],
    ['22/09/2026', 'SHELL OIL', '60.00', 'XXXX1234'],
    ['23/09/2026', 'INTERNET PAYMENT - THANK YOU', '-300.00', 'XXXX1234'],
    ['24/09/2026', 'NOON.COM', '-25.00', 'XXXX1234'],
  ]), 'AED');
  ok('review 1: an English Account Number column never proves plain card charges are income',
    !cardWithAccountColumn.rows.some((row) => row.type === 'income' && (row.amountFils === 4500 || row.amountFils === 6000)),
    JSON.stringify(brief(cardWithAccountColumn)));
  const lonelyStorno = parseStatementCsv(csv([
    ['Buchungstag', 'Verwendungszweck', 'Soll', 'Haben'],
    ['21.09.2026', 'Gehalt', '', '2.000,00'],
    ['22.09.2026', 'Storno Lastschrift', '-49,99', ''],
  ], ';'), 'EUR', 200, 'day-first');
  const reversalAmongDebits = parseStatementCsv(csv([
    ['Date', 'Description', 'Debit', 'Credit'],
    ['01/09/2026', 'CARREFOUR', '-10.00', ''], ['02/09/2026', 'LULU', '-20.00', ''],
    ['03/09/2026', 'REVERSAL CARREFOUR', '-10.00', ''], ['04/09/2026', 'SALARY', '', '100.00'],
  ]), 'AED');
  ok('review 2: a debit column of only a storno, or one with a reversal among its negatives, is not a sign convention',
    !lonelyStorno.rows.some((row) => row.amountFils === 4999) &&
      !reversalAmongDebits.rows.some((row) => row.type === 'expense'),
    JSON.stringify({ storno: brief(lonelyStorno), reversal: brief(reversalAmongDebits) }));
  const salaryCredit = parseStatementLines([
    'Date Description Debit Credit Balance',
    '20/09/2026 OPENING ROW 10.00 - 5,000.00',
    '21/09/2026 SALARY CREDIT - 15,000.00 20,000.00',
  ].join('\n'), 'AED');
  ok('review 3: a description ending in CREDIT is still read under a Debit/Credit header',
    salaryCredit.rows.some((row) => row.amountFils === 1500000 && row.type === 'income'),
    JSON.stringify(brief(salaryCredit)));
  const poundColumns = parseStatementCsv(csv([
    ['Date', 'Transactions', 'Location', 'Paid out (£)', 'Paid in (£)', 'Balance (£)'],
    ['01/09/2026', 'EXAMPLE CO', 'LONDON', '1.23', '', '98.77'],
    ['02/09/2026', 'SALARY', '', '', '100.00', '198.77'],
  ]), 'GBP', 200, 'day-first');
  ok('review 4: Paid out (£) / Paid in (£) read in a GBP ledger',
    same(brief(poundColumns), [['2026-09-01', 123, 'expense'], ['2026-09-02', 10000, 'income']]), JSON.stringify(brief(poundColumns)));
  ok('review 5: a $ or ₹ money header is refused for a ledger that symbol cannot name',
    failure(() => rawCsv('Date,Description,Debit ($),Credit ($)\n01/09/2026,SHOP,10.00,', 'EUR')) === 'statement_currency_mismatch' &&
      failure(() => rawCsv('Date,Description,Amount (₹)\n01/09/2026,SHOP,-10.00', 'AED')) === 'statement_currency_mismatch' &&
      parseStatementCsv('Date,Description,Debit ($),Credit ($)\n01/09/2026,SHOP,10.00,', 'USD', 200, 'month-first').rows.length === 1);
  const twoRowSwap = parseStatementLines([
    '21/09/2026 SALARY ACME 15,000.00 - 20,000.00',
    '22/09/2026 CARREFOUR HYPER - 40.00 19,960.00',
  ].join('\n'), 'AED');
  ok('review 6: one disproving balance step refuses every row read through the assumed column order',
    twoRowSwap.rows.length === 0 && twoRowSwap.rejectedRows === 2, JSON.stringify(brief(twoRowSwap)));
  const signAgainstLabel = parseStatementLines([
    '01/09/2026 ALPHA 100.00 1,000.00 CR', '02/09/2026 BRAVO 50.00 950.00 DR', '03/09/2026 CHARLIE 20.00 930.00 DR',
    '04/09/2026 DELTA 70.00 1,000.00 CR', '05/09/2026 ECHO 10.00 990.00 DR', '06/09/2026 HOLE ROW',
    '07/09/2026 MYSTERY -1250.00 9,000.00 CR',
  ].join('\n'), 'AED');
  ok('review 7: a minus that contradicts its CR label is refused, not filed as income',
    !signAgainstLabel.rows.some((row) => row.amountFils === 125000 && row.type === 'income'),
    JSON.stringify(brief(signAgainstLabel)));
  const typeAgainstDrCr = parseStatementCsv(csv([
    ['Date', 'Description', 'Type', 'Dr/Cr', 'Amount'],
    ['01/09/2026', 'ODD', 'CR', 'DR', '10.00'], ['02/09/2026', 'SHOP', 'POS', 'DR', '20.00'],
  ]), 'AED');
  ok('review 8: a Type cell naming the other direction than Dr/Cr refuses the row',
    same(brief(typeAgainstDrCr), [['2026-09-02', 2000, 'expense']]), JSON.stringify(brief(typeAgainstDrCr)));
  const usState = parseStatementCsv(csv([
    ['Date', 'Description', 'Amount', 'City', 'State'],
    ['09/01/2026', 'SHOP', '-10.00', 'Austin', 'TX'], ['09/02/2026', 'SALARY DIRECT DEP', '100.00', 'Austin', 'TX'],
  ]), 'USD', 200, 'month-first');
  const valueAndAmount = parseStatementCsv(csv([
    ['Date', 'Value', 'Description', 'Amount'], ['09/01/2026', '09/01/2026', 'SHOP', '-10.00'],
  ]), 'USD', 200, 'month-first');
  ok('review 9: a US-state State column is not a status, and Value beside Amount is not a second amount',
    usState.rows.length === 2 && same(brief(valueAndAmount), [['2026-09-01', 1000, 'expense']]),
    JSON.stringify({ state: brief(usState), value: brief(valueAndAmount) }));

  console.log(`\n${passed} passed, ${failed} failed`);
  process.exit(failed ? 1 : 0);
})();
