'use strict';
const assert = require('node:assert/strict');
const test = require('node:test');
const load = require('./load-ts.cjs').createLoader();
const { inspectUniversalBankEvent } = load('@/lib/universal-parser');
const { inspectMarketAlert } = load('@/lib/alert-semantics');
const { routeAlertMarket } = load('@/lib/alert-market-detection');
const { createLaunchAlertSession } = load('@/lib/launch-alert-parser');
const { setActiveCountry } = load('@/lib/country');
const { setActiveMarket, setLedgerCurrency } = load('@/lib/markets');

// Continental European bank-alert wording. Every body is synthetic, with
// fictional names, amounts, tails and dates; none is a consented real alert.
// The universal reader consults every language pack when an alert is not
// routed, so these suites check each pack alone AND the combined reading.
const LANGUAGE_PACKS = ['US', 'GB', 'FR', 'DE', 'ES', 'IT', 'NL', 'IN', 'QA', 'KW', 'BH', 'OM', 'EG', 'JO',
  'PT', 'PL', 'SE', 'DK', 'NO', 'CZ'];
const observedAt = Date.parse('2026-10-12T12:00:00Z');

/** One pack's reading, and the status every pack together would allow. */
const packStatus = (body, market) => inspectMarketAlert(body, market).status;
const combinedStatuses = (body) => LANGUAGE_PACKS.map((market) => packStatus(body, market));
// The same precedence universal-parser.ts applies across language packs.
const combinedStatus = (body) => {
  const statuses = combinedStatuses(body);
  return ['failed', 'future', 'informational', 'posted'].find((status) => statuses.includes(status)) ?? 'unknown';
};

// Completed movements, one per new phrase. `market` is the pack whose words
// carry it; `direction` and `family` are that pack's reading.
const POSITIVES = [
  ['DE', 'Neue Buchung auf deinem Girokonto: Lastschrift -14,99 € STREAMDIENST AB', 'debit', 'purchase'],
  ['DE', 'Ihr Konto wurde mit 27,15 EUR belastet.', 'debit', null],
  ['DE', 'Sie haben 18,20 € an KAFFEEHAUS MITTE gezahlt.', 'debit', null],
  ['DE', 'Sie haben eine Zahlung über 40,00 € von JONAS BEISPIEL erhalten.', 'credit', null],
  ['DE', 'Zahlungseingang auf Ihrem Konto: +1.820,00 EUR von BEISPIEL GMBH', 'credit', 'transfer'],
  ['FR', 'Prélèvement de 24,99 EUR TELECOM EXEMPLE effectué le 02/10/2026 sur votre compte ***7712.', 'debit', null],
  ['FR', 'Frais de tenue de compte de 2,90 EUR prélevés le 01/10/2026.', 'debit', 'fee'],
  ['FR', 'Votre compte 4471 a ete debite de 62,00 EUR le 06/10/2026 chez LIBRAIRIE CENTRALE', 'debit', null],
  ['FR', 'Nous vous confirmons la réalisation de votre virement de 300,00 EUR vers CLAIRE EXEMPLE.', 'debit', 'transfer'],
  ['ES', 'Has realizado una compra de 9,90 € en LIBRERIA LUNA con tu tarjeta ·2210.', 'debit', 'purchase'],
  ['ES', 'Has pagado 7,30 € en CAFETERIA LUNA.', 'debit', 'purchase'],
  ['ES', 'Has recibido un Bizum de 30,00 € de MARTA EJEMPLO.', 'credit', 'transfer'],
  ['ES', 'Reembolso de EUR 21,00 acreditado a su tarjeta 6612 de TIENDA MAR el 01/10/2026', 'credit', 'refund'],
  ['IT', 'Hai pagato 12,00 EUR con la carta *8831 presso PANIFICIO ROSSI.', 'debit', 'purchase'],
  ['NL', 'Er is € 1.900,00 bijgeschreven op je rekening van VOORBEELD BV.', 'credit', 'transfer'],
  ['PT', 'Você enviou 15,00 EUR para RITA EXEMPLO em 03/10/2026.', 'debit', 'transfer'],
  ['PT', 'JOAO EXEMPLO te enviou 30,00 EUR por MB WAY.', 'credit', 'transfer'],
  ['PL', 'Płatność BLIK na kwotę 54,00 zł w SKLEP PRZYKLAD została zrealizowana.', 'debit', 'purchase'],
  ['PL', 'Platnosc karta *7731 kwota 23,10 PLN PIEKARNIA', 'debit', 'purchase'],
  ['PL', 'Otrzymano 80,00 zł.', 'credit', null],
  ['SE', 'Du har fått 200 kr från LINNEA EXEMPEL.', 'credit', null],
  ['SE', 'Kortköp 312,00 kr hos BOKHANDELN, kort 4410', 'debit', 'purchase'],
  ['DK', 'Du har betalt 64,00 kr. til BAGERIET', 'debit', 'purchase'],
  ['DK', 'Freja Eksempel har sendt dig 300,00 kr.', 'credit', 'transfer'],
  ['NO', 'Du betalte 89 kr til KAFE EKSEMPEL.', 'debit', 'purchase'],
  ['CZ', 'Platba kartou 249,00 Kč / PEKARNA PRAHA / karta *5512', 'debit', 'purchase'],
  ['CZ', 'Příchozí platba 12 000,00 CZK na účet ***4410 od PRIKLAD S.R.O.', 'credit', 'transfer'],
];

for (const [market, body, direction, family] of POSITIVES) test(`${market} completed wording posts in its pack: ${body.slice(0, 48)}`, () => {
  const reading = inspectMarketAlert(body, market);
  assert.equal(reading.status, 'posted', JSON.stringify(reading.reasons));
  assert.equal(reading.direction, direction);
  if (family) assert.equal(reading.family, family);
  // No other language may veto it: failed/future/informational in any pack
  // would keep it off the ledger for every person.
  for (const status of combinedStatuses(body)) assert.ok(status === 'posted' || status === 'unknown', status);
});

// Paired non-posting controls: the same wording declined, held, scheduled,
// conditional, questioned, negated, as a code, an offer and a request. Each
// must stay off the ledger in its own pack AND in the combined reading.
const NEGATIVES = {
  DE: [
    'Kartenzahlung über 27,15 EUR bei BUCHLADEN NORD abgelehnt.',
    'Kartenzahlung über 27,15 EUR bei BUCHLADEN NORD vorgemerkt.',
    'Reservierung über 150,00 EUR bei AUTOVERMIETUNG auf Ihrer Debitkarte ***9876.',
    'Die Lastschrift über 14,99 € wird am 05.11.2026 abgebucht.',
    'Wenn Sie eine Kartenzahlung über 50,00 EUR tätigen, erhalten Sie Punkte.',
    'Haben Sie eine Kartenzahlung über 27,15 EUR bei BUCHLADEN NORD getätigt?',
    'Die Zahlung über 18,20 € wurde nicht ausgeführt.',
    'Ihre smsTAN für die Überweisung über 250,00 EUR lautet: 482913.',
    'Sparen Sie 5,00 EUR bei Ihrer nächsten Kartenzahlung über 30,00 EUR.',
    'JONAS BEISPIEL möchte 15,00 € von dir erhalten.',
    'Sie erhalten in Kürze eine Gutschrift über 40,00 €.',
  ],
  FR: [
    'Paiement par carte de 19,80 EUR chez EPICERIE DU PORT refusé.',
    'Paiement par carte de 19,80 EUR chez EPICERIE DU PORT en attente.',
    'Un prélèvement de 24,99 EUR sera prélevé le 05/11/2026.',
    'Si vous effectuez un paiement par carte de 50,00 EUR, vous gagnez des points.',
    'Avez-vous effectué un paiement par carte de 19,80 EUR chez EPICERIE DU PORT ?',
    'Le prélèvement de 24,99 EUR non effectué faute de provision.',
    'Code de confirmation pour le paiement par carte de 19,80 EUR : 448120.',
    'Profitez de 10 % de remise sur votre prochain paiement par carte de 30,00 EUR.',
    'CLAIRE EXEMPLE vous demande 12,00 € pour le cinéma.',
  ],
  ES: [
    'Compra de 18,45 EUR en FRUTERIA SOL rechazada.',
    'Compra de 18,45 EUR en FRUTERIA SOL pendiente de confirmación.',
    'Se cargará una compra de 18,45 EUR el 05/11/2026.',
    'Si usted realiza una compra de 50,00 EUR, obtendrá puntos.',
    '¿Has realizado una compra de 9,90 € en LIBRERIA LUNA?',
    'La compra de 18,45 EUR no se ha podido completar.',
    'El codigo para confirmar la compra de 18,45 EUR es 448120. No lo compartas.',
    'Obtén un 10% de descuento en tu próxima compra de 30,00 EUR.',
    'LAURA EJEMPLO te ha solicitado un Bizum de 12,00 €.',
  ],
  IT: [
    'Hai pagato 12,00 EUR: operazione rifiutata.',
    'Pagamento di 12,00 EUR in attesa di conferma.',
    'Ti ricordiamo che sarà addebitata la rata di 120,00 EUR.',
    'Se hai pagato 12,00 EUR presso PANIFICIO ROSSI, ignora questo messaggio.',
    'Pagamento di 12,00 EUR non eseguito.',
    'Ottieni uno sconto sul prossimo acquisto di 30,00 EUR.',
    'MARCO ESEMPIO ti ha chiesto 10,00 EUR.',
  ],
  NL: [
    'Betaling met bankkaart van EUR 31,40 bij BAKKERIJ DE HOEK geweigerd.',
    'Betaling met bankkaart van EUR 31,40 bij BAKKERIJ DE HOEK in behandeling.',
    'Uw domiciliëring van EUR 85,00 wordt op 05/11/2026 uitgevoerd.',
    'Als u een betaling met kaart van EUR 50,00 doet, krijgt u punten.',
    'Herken je de betaling met bankkaart van EUR 31,40 bij BAKKERIJ DE HOEK?',
    'Betaling met kaart van EUR 31,40 niet gelukt.',
    'Ontvang 10% korting op je volgende betaling met kaart van EUR 30,00.',
    'SANNE VOORBEELD heeft een betaalverzoek van € 12,00 ontvangen.',
  ],
  PT: [
    'Compra de 11,20 EUR em MERCEARIA AZUL recusada.',
    'Compra de 11,20 EUR em MERCEARIA AZUL pendente.',
    'Será debitado o valor de 11,20 EUR em 05/11/2026.',
    'Caso não reconheça a compra de 11,20 EUR, contacte-nos.',
    'Foi você que enviou 15,00 EUR para RITA EXEMPLO?',
    'O pagamento de 15,00 EUR não foi efetuado.',
    'Código de confirmação para a compra de 11,20 EUR: 448120. Não partilhe.',
    'Ganhe 10% de desconto na próxima compra de 30,00 EUR.',
    'RITA EXEMPLO pediu 12,00 EUR por MB WAY.',
  ],
  PL: [
    'Płatność BLIK na kwotę 54,00 zł została odrzucona.',
    'Płatność kartą 23,10 PLN oczekująca na rozliczenie.',
    'Płatność 23,10 PLN zostanie zrealizowana jutro.',
    'Jeśli płatność 54,00 zł została zrealizowana, zignoruj wiadomość.',
    'Czy potwierdzasz płatność BLIK na kwotę 54,00 zł w SKLEP PRZYKLAD?',
    'Płatność kartą 23,10 PLN nie została zrealizowana.',
    'Operacja przelew 500,00 PLN. Hasło: 73916284',
    'Rabat 10% na następny zakup za 30,00 PLN.',
    'Prośba o przelew 12,00 PLN od ANNA PRZYKLAD.',
  ],
  SE: [
    'Kortköp 312,00 kr hos BOKHANDELN nekades.',
    'Kortköp 312,00 kr hos BOKHANDELN är reserverat.',
    'Beloppet 312,00 kr kommer att dras i morgon.',
    'Om du har betalat 312,00 kr, bortse från meddelandet.',
    'Var det du som har betalat 312,00 kr hos BOKHANDELN?',
    'Betalningen på 350,00 kr till LINNEA EXEMPEL kunde inte genomföras.',
    'Din engångskod för köp på 312,00 kr är 448120.',
    'Rabatt 10% på nästa köp över 300,00 kr.',
    'LINNEA EXEMPEL vill ha 150 kr för middagen.',
  ],
  DK: [
    'Betalingen på 64,00 kr. til BAGERIET blev afvist.',
    'Betalingen på 64,00 kr. til BAGERIET er reserveret.',
    'Beløbet 64,00 kr. vil blive hævet i morgen.',
    'Hvis du har betalt 64,00 kr., så se bort fra beskeden.',
    'Var det dig, der har betalt 64,00 kr. til BAGERIET?',
    'Betalingen på 64,00 kr. blev ikke gennemført.',
    'Din engangskode til betaling på 64,00 kr. er 448120.',
    'Få 10% rabat på næste køb over 300,00 kr.',
    'Freja Eksempel beder om 150,00 kr.',
  ],
  NO: [
    'Betalingen på 89 kr til KAFE EKSEMPEL ble avvist.',
    'Betalingen på 89 kr til KAFE EKSEMPEL er reservert.',
    'Beløpet 89 kr vil bli trukket i morgen.',
    'Hvis du betalte 89 kr, se bort fra meldingen.',
    'Var det deg som betalte 89 kr til KAFE EKSEMPEL?',
    'Betalingen på 89 kr ble ikke gjennomført.',
    'Engangskode for betaling på 89 kr: 448120.',
    'Få 10% rabatt på neste kjøp over 300 kr.',
    'Ola Eksempel ber om 150 kr.',
  ],
  CZ: [
    'Platba kartou 249,00 Kč byla zamítnuta.',
    'Platba kartou 249,00 Kč čeká na zúčtování.',
    'Částka 249,00 Kč bude stržena zítra.',
    'Pokud platba kartou 249,00 Kč proběhla, zprávu ignorujte.',
    'Platba kartou 249,00 Kč nebyla provedena.',
    'Ověřovací kód pro platbu kartou 249,00 Kč: 448120.',
    'Sleva 10 % na příští nákup za 300,00 Kč.',
    'Žádost o platbu 150,00 Kč od JANA PRIKLAD.',
  ],
};

const MARKET_MONEY = { DE: ['DE', 'EUR'], FR: ['FR', 'EUR'], ES: ['ES', 'EUR'], IT: ['IT', 'EUR'], NL: ['NL', 'EUR'],
  PT: ['PT', 'EUR'], PL: ['PL', 'PLN'], SE: ['SE', 'SEK'], DK: ['DK', 'DKK'], NO: ['NO', 'NOK'], CZ: ['CZ', 'CZK'] };
function session(country, currency) {
  setActiveMarket('ZZ'); setActiveCountry(country); setLedgerCurrency(currency, 2);
  return createLaunchAlertSession({ overrides: {}, pinnedCurrency: currency, activeMarket: 'ZZ',
    bestEffort: { enabled: true, country }, fxLookup: () => null, regionHint: country });
}
const seam = (body, sender, country, currency) => {
  const reader = session(country, currency);
  return reader.parseUnproven(body, sender, reader.inspect(body, sender), observedAt);
};

for (const [market, bodies] of Object.entries(NEGATIVES)) {
  for (const body of bodies) test(`${market} non-posting control stays off the ledger: ${body.slice(0, 48)}`, () => {
    assert.notEqual(packStatus(body, market), 'posted');
    assert.notEqual(combinedStatus(body), 'posted');
    // The full Android seam, from a bank-like sender and with no sender.
    const [country, currency] = MARKET_MONEY[market];
    for (const sender of ['BANK', '']) assert.equal(seam(body, sender, country, currency), null, sender);
  });
}

// A card-payment heading before the merchant ("Compra de X en SHOP") is NOT
// completion wording: the merchant extractor can swallow a trailing status
// and mask it. These declined shapes must never post through the seam.
for (const [country, sender, body] of [
  ['ES', 'CaixaBank', 'Tu compra de 18,45 EUR en FRUTERIA SOL ha sido denegada.'],
  ['ES', 'CaixaBank', 'Compra de 18,45 EUR en FRUTERIA SOL no realizada.'],
  ['FR', 'BNPPARIBAS', 'Votre paiement par carte de 19,80 EUR chez EPICERIE DU PORT a été rejeté.'],
  ['FR', 'BNPPARIBAS', 'Paiement par carte de 19,80 EUR chez EPICERIE DU PORT non abouti.'],
  ['DE', 'Deutsche Bank', 'Kartenzahlung über 27,15 EUR bei BUCHLADEN NORD nicht ausgeführt.'],
  ['DE', 'Deutsche Bank', 'Kartenzahlung über 27,15 EUR bei BUCHLADEN NORD vorgemerkt.'],
  ['NL', 'Rabobank', 'Betaling met bankkaart van EUR 31,40 bij BAKKERIJ DE HOEK afgewezen.'],
  ['PT', 'CaixaBank', 'A compra de 11,20 EUR em MERCEARIA AZUL não foi autorizada.'],
]) test(`${country} trailing status after the merchant never posts: ${body.slice(0, 48)}`, () => {
  for (const s of [sender, '']) assert.equal(seam(body, s, country, 'EUR'), null, s);
  assert.notEqual(inspectUniversalBankEvent(body, { dateOrder: 'DMY' }).status, 'posted');
});

// A word that reads both ways never decides direction alone: the payee's
// receipt of the reader's payment is not money in, and a peer sending to the
// reader is not money out.
for (const [market, body, never] of [
  ['DE', 'LISA BEISPIEL hat deine Überweisung über 50,00 € erhalten.', 'credit'],
  ['DE', 'JONAS BEISPIEL hat dir 20,00 € gesendet.', 'debit'],
  ['FR', 'Nous avons bien reçu votre paiement de 45,00 EUR.', 'credit'],
  ['ES', 'Hemos recibido tu pago de 45,00 EUR.', 'credit'],
  ['IT', 'Abbiamo ricevuto il tuo pagamento di 45,00 EUR.', 'credit'],
  ['NL', 'We hebben je betaling van € 45,00 ontvangen.', 'credit'],
  ['PT', 'RITA EXEMPLO recebeu o seu pagamento de 15,00 EUR.', 'credit'],
  ['PL', 'Otrzymano Twoją płatność 45,00 zł.', 'credit'],
  ['SE', 'ERIK EXEMPEL har skickat 150 kr till dig.', 'debit'],
  ['SE', 'Vi har fått din betalning på 150 kr.', 'credit'],
  ['DK', 'Mette Eksempel har betalt dig 200,00 kr.', 'debit'],
  ['DK', 'Vi har modtaget din betaling på 200,00 kr.', 'credit'],
  ['NO', 'Vi har mottatt din betaling på 89 kr.', 'credit'],
]) test(`${market} two-sided wording is never read as ${never}: ${body.slice(0, 48)}`, () => {
  assert.notEqual(inspectMarketAlert(body, market).direction, never);
  const event = inspectUniversalBankEvent(body, { dateOrder: 'DMY' });
  assert.ok(event.status !== 'posted' || event.direction !== never, JSON.stringify(event.issues));
});

test('new language words never change an English or Arabic reading', () => {
  for (const [body, direction] of [
    ['You spent EUR 12.40 at CORNER CAFE with card ending 4410.', 'debit'],
    ['EUR 1,820.00 has been credited to your account ending 5521. Ref: SALARY', 'credit'],
    ['تم خصم 45.00 درهم من حسابك لدى متجر النور', 'debit'],
    // English place and brand names that are words in a European language.
    ['You spent USD 25.00 at NIAGARA FALLS GIFTS with card ending 4410.', 'debit'],
    ['You spent EUR 40.00 at NESTE EXPRESS with card ending 4410.', 'debit'],
    ['You spent MAD 120.00 at CAFE RABAT CENTRE with card ending 4410.', 'debit'],
    ['You spent USD 80.00 at HOTEL RESERVATION DESK with card ending 4410.', 'debit'],
  ]) {
    const event = inspectUniversalBankEvent(body, { dateOrder: 'DMY' });
    assert.equal(event.status, 'posted', body);
    assert.equal(event.direction, direction, body);
  }
});

test('Norwegian/Danish "nok" (enough) is a word, not Norwegian krone evidence', () => {
  const word = routeAlertMarket({ source: 'Har du nok penger på kontoen? Saldo 500 kr' });
  assert.ok(!word.candidates.some((candidate) => candidate.market === 'NO'));
  const code = routeAlertMarket({ source: 'Du betalte NOK 129 til KAFE EKSEMPEL' });
  assert.ok(code.candidates.some((candidate) => candidate.market === 'NO' && candidate.evidence.includes('currency')));
});

test('European DMY dates are never read month-first', () => {
  for (const [body, date] of [
    ['Kartenzahlung über 27,15 EUR bei BUCHLADEN NORD am 03.10.2026.', '2026-10-03'],
    ['Paiement par carte de 19,80 EUR chez EPICERIE DU PORT le 04/10/2026.', '2026-10-04'],
    ['Compra de 18,45 EUR en FRUTERIA SOL el 03/10/2026.', '2026-10-03'],
    ['Kontowecker: Neuer Umsatz\nBetrag: -45,67 EUR\nBuchungstag: 02.10.2026', '2026-10-02'],
    ['Virement instantané de 300,00 EUR du 01/10/2026 vers CLAIRE EXEMPLE.', '2026-10-01'],
  ]) {
    const event = inspectUniversalBankEvent(body, { dateOrder: 'DMY' });
    assert.equal(event.transactionDate.value, date, body);
  }
});

// The actual Android seam for shapes whose money ownership already resolves.
const SEAM = [
  { country: 'ES', currency: 'EUR', sender: 'BBVA', minor: 990, type: 'expense',
    body: 'Has realizado una compra de 9,90 € en LIBRERIA LUNA con tu tarjeta ·2210.' },
  { country: 'FR', currency: 'EUR', sender: 'BNPPARIBAS', minor: 30000, type: 'expense',
    body: 'BNP Paribas : nous vous confirmons la réalisation de votre virement de 300,00 EUR vers CLAIRE EXEMPLE.' },
  { country: 'DE', currency: 'EUR', sender: 'Deutsche Bank', minor: 1499, type: 'expense',
    body: 'Deutsche Bank: Lastschrift über 14,99 EUR wurde Ihrem Konto belastet.' },
];
for (const row of SEAM) test(`${row.country} Android seam posts the completed alert once: ${row.body.slice(0, 40)}`, () => {
  const parsed = seam(row.body, row.sender, row.country, row.currency);
  assert.ok(parsed, 'completed European alert reaches the marked best-effort posting');
  assert.equal(parsed.amountFils, row.minor);
  assert.equal(parsed.currency, row.currency);
  assert.equal(parsed.type, row.type);
  assert.ok(parsed.bestEffort);
});
for (const row of SEAM) test(`${row.country} Android seam refuses the declined twin: ${row.body.slice(0, 40)}`, () => {
  const declined = row.body.replace(/\.$/u, '') + ({ ES: ' Operación denegada.', FR: ' Opération refusée.', DE: ' Zahlung fehlgeschlagen.' })[row.country];
  assert.equal(seam(declined, row.sender, row.country, row.currency), null);
});

test('Iraq and Lebanon are registry markets: IQD/LBP are their evidence, USD is never Lebanese', () => {
  const iq = routeAlertMarket({ source: 'Purchase of IQD 25,000 at BAGHDAD MARKET' });
  assert.ok(iq.candidates.some((candidate) => candidate.market === 'IQ' && candidate.evidence.includes('currency')));
  const usd = routeAlertMarket({ source: 'Purchase of USD 25.00 at BEIRUT MARKET' });
  assert.ok(!usd.candidates.some((candidate) => candidate.market === 'LB'));
});

// Review round 2: shapes that booked unsafe money. Each must stay off the
// ledger through the real seam, from a bank-like sender and with no sender
// (iPhone History), and must not read as the wrong direction.
const NEVER_POST = [
  // Portuguese third person: the money came IN (or nothing moved).
  ['BR', 'BRL', 'JOAO SILVA enviou um Pix de R$ 50,00 para você.', 'debit'],
  ['BR', 'BRL', 'JOAO SILVA te enviou R$ 50,00 por Pix.', 'debit'],
  ['BR', 'BRL', 'Maria enviou uma transferência de R$ 120,00 para sua conta.', 'debit'],
  ['PT', 'EUR', 'ANA enviou-lhe um pagamento de 20,00 EUR por MB WAY.', 'debit'],
  ['PT', 'EUR', 'JOAO pagou-lhe 20,00 EUR por MB WAY.', 'debit'],
  // "recebeu" in a question, a charge request or a bill.
  ['BR', 'BRL', 'Você recebeu uma cobrança Pix de R$ 50,00 de JOAO?', 'credit'],
  ['PT', 'EUR', 'Recebeu uma transferência de 20,00 EUR de ANA?', 'credit'],
  ['PT', 'EUR', 'Recebeu a fatura EDP para pagamento: 45,00 EUR.', 'credit'],
  // French "could not be carried out".
  ['FR', 'EUR', "Votre virement de 500,00 EUR vers PAUL MARTIN n'a pu être effectué.", 'debit'],
  ['FR', 'EUR', "Votre virement de 500,00 EUR vers PAUL MARTIN n'a pas pu être exécuté.", 'debit'],
  ['FR', 'EUR', 'Votre reçu de paiement : 25,00 EUR chez AMAZON', 'credit'],
  // German: not yet arrived, an instruction received, a transfer being sent.
  ['DE', 'EUR', 'Ihre erwartete Überweisung über 500,00 EUR ist noch nicht eingegangen.', 'credit'],
  ['DE', 'EUR', 'Wir haben Ihren Auftrag erhalten: Überweisung über 500,00 EUR an LISA MÜLLER.', 'credit'],
  ['DE', 'EUR', 'Deine Überweisung über 50,00 EUR an LISA wird gesendet.', 'debit'],
  ['NL', 'EUR', 'De overboeking van € 500,00 is nog niet ontvangen.', 'credit'],
  // Nordic and Czech negation, future and bills.
  ['DK', 'DKK', 'Betaling på 299,00 DKK for køb hos ZALANDO er ikke hævet.', 'debit'],
  ['DK', 'DKK', 'Betaling på 299,00 DKK for køb hos ZALANDO bliver hævet i morgen.', 'debit'],
  ['NO', 'NOK', 'Betaling på 450,00 NOK for kjøp hos REMA 1000 ble ikke trukket.', 'debit'],
  ['CZ', 'CZK', 'Platba kartou 249,00 CZK neproběhla.', 'debit'],
  ['CZ', 'CZK', 'Platba kartou 249,00 CZK nebyla provedena.', 'debit'],
  ['DK', 'DKK', 'Du har modtaget en ny regning fra Ørsted til betaling: 450,00 DKK', 'credit'],
  ['PL', 'PLN', 'Otrzymałeś fakturę na kwote 120,00 PLN', 'credit'],
  ['PL', 'PLN', 'Planowane obciążenie 120,00 PLN za NETFLIX.', 'debit'],
  // The payee's receipt of the reader's payment is not money in.
  ['NO', 'NOK', 'Ola Nordmann har mottatt betaling på 200,00 NOK fra deg.', 'credit'],
  ['SE', 'SEK', 'Erik har fått 200,00 SEK från dig.', 'credit'],
  ['DK', 'DKK', 'Mette har modtaget 200,00 DKK fra dig.', 'credit'],
  // A pack-term clause that ends in a question never posts.
  ['FR', 'EUR', 'Paiement par carte de 19,80 EUR chez EPICERIE DU PORT?', 'debit'],
  ['DK', 'DKK', 'Var det dig, der har betalt 64,00 DKK til BAGERIET?', 'debit'],
  ['ES', 'EUR', 'Has pagado 9,90 € en LIBRERIA LUNA?', 'debit'],
];
for (const [country, currency, body, wrong] of NEVER_POST) test(`${country} review-round control never books: ${body.slice(0, 52)}`, () => {
  for (const sender of ['BANK', '']) assert.equal(seam(body, sender, country, currency), null, sender);
  const event = inspectUniversalBankEvent(body, { dateOrder: 'DMY' });
  assert.ok(event.status !== 'posted' || event.direction !== wrong, `${event.status} ${event.direction}`);
});

// Personal chat in the European languages: a first-person-singular payer.
// Banks write in the second person, which must still read as an alert.
for (const [country, currency, body] of [
  ['BE', 'EUR', 'Ik heb € 400,00 betaald bij COLRUYT voor het eten, stuur je jouw deel?'],
  ['NL', 'EUR', 'Ik heb 40.00 EUR betaald bij ALBERT HEIJN.'],
  ['DE', 'EUR', 'Ich habe 40,00 EUR bei REWE bezahlt, schick mir deinen Anteil.'],
  ['FR', 'EUR', "J'ai payé 40,00 EUR chez CARREFOUR, tu me rembourses ?"],
  ['ES', 'EUR', 'He pagado 40,00 EUR en MERCADONA, me pasas tu parte?'],
  ['IT', 'EUR', 'Ho pagato 40,00 EUR da ESSELUNGA, mi mandi la tua parte?'],
  ['PT', 'EUR', 'Paguei 40,00 EUR no PINGO DOCE, mandas-me a tua parte?'],
  ['PL', 'PLN', 'Zapłaciłem 40,00 PLN w BIEDRONKA, oddasz mi połowę?'],
  ['DK', 'DKK', 'Jeg har betalt 400,00 DKK i NETTO, send mig din del.'],
  ['NO', 'NOK', 'Jeg betalte 400,00 NOK på KIWI, vippser du meg?'],
  ['SE', 'SEK', 'Jag har betalat 400,00 SEK på ICA, swisha mig din del.'],
  ['CZ', 'CZK', 'Zaplatil jsem 400,00 CZK v ALBERT, pošli mi svůj díl.'],
]) test(`${country} first-person chat never books: ${body.slice(0, 48)}`, () => {
  for (const sender of ['+00 600 000 000', '']) assert.equal(seam(body, sender, country, currency), null, sender);
  const event = inspectUniversalBankEvent(body, { dateOrder: 'DMY' });
  assert.notEqual(event.status, 'posted');
  assert.ok(event.issues.includes('personal-message-not-posting'));
});
for (const body of [
  'Du har betalt 64,00 DKK til BAGERIET',
  'Du hast 12,40 € bei REWE Markt GmbH bezahlt.',
  'Zapłaciłeś 40,00 PLN w SKLEP PRZYKLAD.',
  'Vous avez payé 40,00 EUR chez CARREFOUR.',
  'Du har betalat 312,00 SEK hos BOKHANDELN.',
  'Has pagado 7,30 € en CAFETERIA LUNA.',
]) test(`second-person bank wording is not chat: ${body.slice(0, 48)}`, () => {
  assert.ok(!inspectUniversalBankEvent(body, { dateOrder: 'DMY' }).issues.includes('personal-message-not-posting'));
});

// The precompiled pack alternations keep single-term boundaries: whole words,
// any whitespace between a phrase's words, any case.
test('pack phrases match whole words across whitespace and case only', () => {
  assert.equal(packStatus('Zahlung über 20,00 EUR gezahlt, FALLS \t SIE nicht zustimmen', 'DE'), 'future');
  assert.notEqual(packStatus('Purchase of EUR 20,00 at NIAGARAFALLS SIE SHOP', 'DE'), 'future');
  assert.equal(packStatus('Platba kartou 249,00 CZK byla ZAMÍTNUTA', 'CZ'), 'failed');
  assert.notEqual(packStatus('Platba kartou 249,00 CZK u ZAMÍTNUTAXY', 'CZ'), 'failed');
});

// Round 3: European notification headings and field layouts, through the
// real Android seam from a bank-like sender and with no sender.
const LEDGER = { DE: 'EUR', AT: 'EUR', FR: 'EUR', BE: 'EUR', NL: 'EUR', ES: 'EUR', PT: 'EUR', IT: 'EUR',
  CH: 'CHF', PL: 'PLN', SE: 'SEK', DK: 'DKK', NO: 'NOK', CZ: 'CZK' };
const HEADINGS = [
  ['DE', 'Kartenzahlung\nBetrag: 27,15 EUR\nHändler: BUCHLADEN NORD', 2715, 'expense'],
  ['DE', 'Einkauf 58,40 EUR - BUCHLADEN NORD - 03.10.2026 18:14', 5840, 'expense'],
  ['DE', 'Bargeldabhebung über 60,00 EUR am Geldautomaten HBF NORD mit Ihrer Debitkarte ...4410 am 02.10.2026.', 6000, 'expense'],
  // A footer hotline is the bank's own only from a registered header (round 4).
  ['DE', 'Sie haben 18,20 € an KAFFEEHAUS MITTE gezahlt. Unbekannte Zahlung? Sperr-Notruf 030 1234567', 1820, 'expense', 'Sparkasse'],
  ['FR', 'Paiement par carte\nMontant: 19,80 EUR\nCommerçant: EPICERIE DU PORT', 1980, 'expense'],
  ['FR', 'Achat 46,27 EUR - EPICERIE DU PORT - carte ****9302', 4627, 'expense'],
  ['ES', 'Compra: 18,45 EUR en FRUTERIA SOL', 1845, 'expense'],
  ['ES', 'Retirada de efectivo de 60,00 EUR en cajero con su tarjeta ****9031 el 02/10/2026.', 6000, 'expense'],
  ['IT', 'Pagamento di 12,00 EUR presso PANIFICIO ROSSI il 03/10/2026.', 1200, 'expense'],
  ['NL', 'Pinbetaling 31,40 EUR - BAKKERIJ DE HOEK - betaalpas eindigend op 4410', 3140, 'expense'],
  ['NL', 'Bijschrijving\nBedrag: € 445,39\nRekening: ****7630\nAfzender: TULP HANDEL BV', 44539, 'income', 'Rabobank'],
  ['PL', 'Transakcja kartą\nKwota: 23,10 PLN\nSprzedawca: PIEKARNIA', 2310, 'expense'],
  ['SE', 'Köp med kort\nButik: BOKHANDELN\nSumma: 121,00 SEK', 12100, 'expense'],
  ['DK', 'Køb på 508,63 kr. hos BAGERIET.', 50863, 'expense'],
  ['NO', 'Kortkjøp\nBeløp: 315,03 NOK\nButikk: KAFE NORD', 31503, 'expense'],
  ['CZ', 'Výběr hotovosti 1 600,00 CZK', 160000, 'expense'],
];
for (const [country, body, minor, type, sender = 'BANK'] of HEADINGS) test(`${country} heading posts the completed movement: ${body.replace(/\n/g, ' / ').slice(0, 48)}`, () => {
  // Money in from an unregistered sender waits in Review by policy; a
  // registered bank header carries it.
  const parsed = seam(body, sender, country, LEDGER[country]);
  assert.ok(parsed, 'heading alert reaches marked best-effort posting');
  assert.equal(parsed.amountFils, minor);
  assert.equal(parsed.type, type);
  assert.ok(parsed.bestEffort);
});

// Each heading's non-posting twins, and the shapes the alert lab found unsafe.
const ROUND3_NEVER = [
  // Status after the heading's merchant, or on a field line of its own.
  ['DE', 'Kartenzahlung über 27,15 EUR bei BUCHLADEN NORD nicht ausgeführt.'],
  ['DE', 'Kartenzahlung\nBetrag: 27,15 EUR\nHändler: BUCHLADEN NORD\nStatus: abgelehnt'],
  ['DE', 'Kartenzahlung\nBetrag: 27,15 EUR\nHändler: BUCHLADEN NORD\nStatus: vorgemerkt'],
  ['FR', 'Paiement par carte\nMontant: 19,80 EUR\nCommerçant: EPICERIE DU PORT\nStatut : refusé'],
  ['ES', 'Compra: 18,45 EUR en FRUTERIA SOL denegada.'],
  ['ES', 'Tu compra de 18,45 EUR en FRUTERIA SOL ha sido denegada.'],
  ['IT', 'Pagamento di 12,00 EUR presso PANIFICIO ROSSI rifiutato.'],
  ['NL', 'Pinbetaling 31,40 EUR - BAKKERIJ DE HOEK geweigerd'],
  ['PL', 'Transakcja kartą\nKwota: 23,10 PLN\nSprzedawca: PIEKARNIA\nStatus: odrzucona'],
  ['SE', 'Köp på 101,37 kr hos SL BILJETT godkänt; bokföring kan ta 2 dagar.'],
  ['DK', 'Køb på 508,63 kr. hos DSB godkendt; bogføring kan tage 2 dage.'],
  ['CZ', 'Výběr hotovosti 1 600,00 CZK byl zamítnut.'],
  // Authorised holds, limits, nothing charged, hedges, examples.
  ['DE', 'Kartenzahlung über 126,27 EUR bei MCDONALDS 0412 genehmigt, vorbehaltlich der endgültigen Abrechnung.'],
  ['IT', 'Pagamento di 73,03 EUR presso H&M autorizzato; la contabilizzazione può richiedere 2 giorni.'],
  ['ES', 'Compra de 53,73 EUR en SPOTIFY P2A4C1 autorizada; puede tardar 2 días en reflejarse.'],
  ['ES', 'Retirada de 100,00 EUR: límite diario alcanzado.'],
  ['FR', 'Retrait de 100,00 EUR : plafond journalier atteint.'],
  ['DE', 'Es wurden keine 76,96 EUR von Ihrem Konto abgebucht.'],
  ['DE', 'Eventuell wurden 68,58 EUR bei REWE SAGT DANKE mit Ihrer Girocard ***7612 belastet.'],
  ['NO', 'Det kan ha blitt trukket kr 161,15 hos RUTER.'],
  ['DE', 'Muster-Benachrichtigung: Sie haben 48,67 EUR bei DM DROGERIE MARKT bezahlt.'],
  ['NL', 'Bijvoorbeeld: je hebt € 100,00 betaald bij BRUXELLES CENTRAL.'],
  // A transfer that came back, money still to claim, a card-bill payment.
  ['NL', 'Je overboeking van 114,08 EUR naar SANNE DE VRIES is teruggestort.'],
  ['FR', 'MARIE DUBOIS vous a envoyé 119,81 €; créez votre compte pour le recevoir.'],
  ['PT', 'ANA SILVA enviou-lhe EUR 106,04; ative o MB WAY para receber.'],
  ['NO', 'OLA NORDMANN har sendt deg kr 793,00. Vil du ta imot?'],
  ['NO', 'SpareBank 1: Du har betalt NOK 10.895,60 til SpareBank 1 kredittkortet ditt.'],
  ['IT', 'Hai pagato € 200,00 alla tua carta di credito UniCredit.'],
  // A question glued after a comma is still a question.
  ['DE', 'Ihre Debitkarte ...1038 wurde mit 21,31 EUR bei APPLE.COM/BILL belastet, waren Sie das nicht?'],
];
for (const [country, body] of ROUND3_NEVER) test(`${country} round-3 control never books: ${body.replace(/\n/g, ' / ').slice(0, 52)}`, () => {
  for (const sender of ['BANK', '']) assert.equal(seam(body, sender, country, LEDGER[country]), null, sender);
});

// A merchant named like a status word is still the merchant: "Refund Shop"
// after the Nordic "hos" is masked, so a purchase is never read as income.
for (const [country, body] of [
  ['SE', 'Onlineköp 1 676,52 SEK hos Refund Shop'],
  ['NO', 'Du betalte 1 126,96 kr hos Refund Shop'],
]) test(`${country} a status-like merchant name never turns a purchase into income: ${body}`, () => {
  for (const sender of ['BANK', '']) {
    const parsed = seam(body, sender, country, LEDGER[country]);
    assert.ok(!parsed || parsed.type === 'expense', JSON.stringify(parsed && parsed.type));
  }
});

test('Millennium bcp is a Portuguese bank, never Peru\'s BCP', () => {
  const route = routeAlertMarket({ source: 'Millennium bcp: Compra de 25,40 EUR no cartao ****1234 em PINGO DOCE.', sender: 'Millennium' });
  assert.ok(!route.candidates.some((candidate) => candidate.market === 'PE'));
});

// Independent review, round 3: European heading shapes that must never book
// (status after the shop or on its own line, holds, limits, notices, offers,
// summaries, own-card payments, examples, chat, money to the reader), plus
// English and Latin-American alerts the European headings must not touch.
const ROUND3_REVIEW_NEVER = [
  ["US", "USD", "Commission earned: $50.00"],
  ["DE", "EUR", "Gesendet von LUKAS: 20,00 EUR an dich"],
  ["DK", "DKK", "Penge sendt fra FREJA til dig: 300 kr."],
  ["ES", "EUR", "Bizum enviado por MARTA: te ha enviado 30,00 EUR"],
  ["IT", "EUR", "Bonifico in uscita da MARCO verso di te: 300,00 EUR"],
  ["PT", "EUR", "MB WAY enviado por RITA: 15,00 EUR para si"],
  ["FR", "EUR", "Virement émis par CLAIRE EXEMPLE de 300,00 EUR à votre attention"],
  ["SE", "SEK", "Överföring\nBelopp: 500 kr\nFrån: LINNEA EXEMPEL"],
  ["SE", "SEK", "Överföring mottagen av LINNEA: 500 kr"],
  ["ES", "EUR", "Comisión\nImporte: 5,00 EUR\nDevuelta"],
  ["IT", "EUR", "Commissione di 2,00 EUR stornata"],
  ["IT", "EUR", "Commissione\nImporto: 2,00 EUR\nRimborsata"],
  ["FR", "EUR", "Frais\nMontant: 2,90 EUR\nRemboursés"],
  ["PL", "PLN", "Opłata\nKwota: 10,00 PLN\nZwrócona"],
  ["SE", "SEK", "Avgift\nBelopp: 25 kr\nÅterbetald"],
  ["DK", "DKK", "Gebyr\nBeløb: 25 kr.\nTilbageført"],
  ["CZ", "CZK", "Poplatek\nČástka: 50 Kč\nVrácen"],
  ["DE", "EUR", "Bargeldabhebung\nVerfügbarer Betrag: 1.234,00 EUR"],
  ["DE", "EUR", "Bargeldabhebung: Ihr Tageslimit beträgt 1.000,00 EUR."],
  ["DE", "EUR", "Kartenzahlung über 27,15 EUR bei BUCHLADEN NORD wurde nicht autorisiert"],
  ["DE", "EUR", "Kartenzahlung über 27,15 EUR bei BUCHLADEN NORD nicht erfolgt"],
  ["DE", "EUR", "Kartenzahlung über 27,15 EUR bei BUCHLADEN NORD gesperrt"],
  ["DE", "EUR", "Kartenzahlung über 27,15 EUR bei BUCHLADEN NORD zurückgebucht"],
  ["DE", "EUR", "Lastschrift 14,99 EUR STREAMDIENST zurückgegeben"],
  ["DE", "EUR", "Lastschrift 14,99 EUR STREAMDIENST mangels Deckung nicht eingelöst"],
  ["FR", "EUR", "Paiement par carte de 19,80 EUR chez EPICERIE DU PORT non effectué."],
  ["FR", "EUR", "Paiement par carte de 19,80 EUR chez EPICERIE DU PORT bloqué."],
  ["ES", "EUR", "Compra online de 30,72 EUR en RENFE fallida."],
  ["ES", "EUR", "Compra online de 30,72 EUR en RENFE no completada."],
  ["IT", "EUR", "Pagamento con carta di 12,00 EUR presso PANIFICIO ROSSI fallito"],
  ["IT", "EUR", "Pagamento con carta di 12,00 EUR presso PANIFICIO ROSSI bloccato"],
  ["PT", "EUR", "Pagamento de 15,00 EUR em CAFE LISBOA não concluído"],
  ["NL", "EUR", "Pinbetaling van 12,00 EUR bij BAKKER BART niet voltooid"],
  ["PL", "PLN", "Transakcja kartą 54,00 PLN w SKLEP zablokowana"],
  ["PL", "PLN", "Transakcja kartą 54,00 PLN w SKLEP nie powiodła się"],
  ["DE", "EUR", "Kartenzahlung\nBetrag: 27,15 EUR\nHändler: BUCHLADEN NORD\nDie Zahlung wurde nicht autorisiert."],
  ["DE", "EUR", "Kartenzahlung\nBetrag: 27,15 EUR\nHändler: BUCHLADEN NORD\nDeckung nicht ausreichend"],
  ["DK", "DKK", "Køb med kort\nBeløb: 508,63 kr.\nForretning: DSB\nManglende dækning"],
  ["PT", "EUR", "Levantamento\nMontante: 60,00 EUR\nFalhado"],
  ["SE", "SEK", "Köp 245,00 kr hos ICA misslyckades"],
  ["SE", "SEK", "Köp 245,00 kr hos ICA spärrat"],
  ["SE", "SEK", "Köp 245,00 kr hos ICA under behandling"],
  ["NO", "NOK", "Kjøp 89 kr hos KAFE EKSEMPEL blokkert"],
  ["NO", "NOK", "Kjøp 89 kr hos KAFE EKSEMPEL venter"],
  ["NO", "NOK", "Kjøp 89 kr hos KAFE kansellert"],
  ["DK", "DKK", "Køb 508,63 kr. hos DSB blokeret"],
  ["DK", "DKK", "Køb 508,63 kr. hos DSB kan ikke gennemføres"],
  ["SE", "SEK", "Köp 245,00 kr hos ICA kunde inte genomföras"],
  ["NO", "NOK", "Kjøp 89 kr hos KAFE EKSEMPEL kunne ikke gjennomføres"],
  ["DE", "EUR", "Kartenzahlung 27,15 EUR bei BUCHLADEN NORD (Vormerkung)"],
  ["DE", "EUR", "Kartenzahlung 27,15 EUR bei BUCHLADEN NORD - noch nicht gebucht"],
  ["DE", "EUR", "Kartenzahlung 27,15 EUR bei BUCHLADEN NORD vorläufig"],
  ["DE", "EUR", "Kartenzahlung 27,15 EUR bei BUCHLADEN NORD autorisiert, Buchung folgt."],
  ["DE", "EUR", "Kartenzahlung 27,15 EUR bei BUCHLADEN NORD in Prüfung."],
  ["DE", "EUR", "Kartenzahlung\nBetrag: 27,15 EUR\nHändler: BUCHLADEN NORD\nFreigabe erforderlich"],
  ["FR", "EUR", "Paiement par carte 19,80 EUR chez EPICERIE - autorisation"],
  ["FR", "EUR", "Paiement par carte\nMontant: 19,80 EUR\nCommerçant: EPICERIE\nÀ valider dans votre application"],
  ["IT", "EUR", "Pagamento di 12,00 EUR presso PANIFICIO ROSSI in elaborazione"],
  ["IT", "EUR", "Acquisto online di 12,00 EUR su SHOP da confermare"],
  ["SE", "SEK", "Köp 245,00 kr hos ICA - preliminär"],
  ["SE", "SEK", "Köp 245,00 kr hos ICA väntar på godkännande"],
  ["DK", "DKK", "Køb 508,63 kr. hos DSB - foreløbig"],
  ["NO", "NOK", "Kjøp 89 kr hos KAFE EKSEMPEL - foreløpig"],
  ["DE", "EUR", "Kartenzahlung\nBetrag: 27,15 EUR\nTAN: 448120"],
  ["ES", "EUR", "Compra online\nImporte: 30,72 EUR\nComercio: RENFE\nCódigo: 448120"],
  ["IT", "EUR", "Acquisto\nImporto: 12,00 EUR\nAutorizza con codice 448120"],
  ["DE", "EUR", "Kartenzahlung 27,15 EUR bei BUCHLADEN NORD. Die Buchung erfolgt in 2 Tagen."],
  ["DE", "EUR", "Lastschrift 14,99 EUR STREAMDIENST - Vorankündigung"],
  ["DE", "EUR", "Entgelt für Kontoführung ab 01.01.2027: 4,90 EUR monatlich."],
  ["FR", "EUR", "Frais : votre offre passe à 2,90 EUR par mois."],
  ["NL", "EUR", "Overboeking van 300,00 EUR ingepland voor 05-11-2026"],
  ["NL", "EUR", "Incasso van 14,99 EUR STREAM gestorneerd"],
  ["NL", "EUR", "Kosten van 2,00 EUR vanaf januari"],
  ["CZ", "CZK", "Odeslaná platba 500 Kč naplánována na 05.11.2026"],
  ["DE", "EUR", "Erinnerung: Lastschrift 14,99 EUR STREAMDIENST"],
  ["DE", "EUR", "Hinweis: Kartenzahlung 27,15 EUR bei BUCHLADEN NORD"],
  ["IT", "EUR", "Promemoria: Pagamento di 12,00 EUR presso ROSSI"],
  ["FR", "EUR", "Paiement par carte de 19,80 EUR chez EPICERIE DU PORT. Est-ce bien vous ?"],
  ["ES", "EUR", "Compra de 18,45 EUR en FRUTERIA SOL. ¿Has sido tú?"],
  ["IT", "EUR", "Pagamento di 12,00 EUR presso PANIFICIO ROSSI. Sei stato tu?"],
  ["PT", "EUR", "Compra de 11,20 EUR em MERCEARIA AZUL. Foi você?"],
  ["SE", "SEK", "Köp 245,00 kr hos ICA. Var det du?"],
  ["DE", "EUR", "Kartenzahlung 27,15 EUR bei BUCHLADEN NORD. Wurde die Zahlung ausgeführt? Unbekannte Zahlung? Sperr-Notruf 116116"],
  ["DE", "EUR", "Kartenzahlung\nBetrag: 27,15 EUR\nUnbekannte Zahlung? Wurden Sie belastet?"],
  ["DE", "EUR", "Kartenzahlung 27,15 EUR bei BUCHLADEN NORD. Nicht von Ihnen? Dann wurde nichts belastet."],
  ["FR", "EUR", "Paiement par carte de 19,80 EUR chez EPICERIE à confirmer Ce n'est pas vous? Appelez"],
  ["DE", "EUR", "Bargeldabhebung kostenlos ab 50,00 EUR an allen Automaten."],
  ["DE", "EUR", "Aktion: Einkauf 50,00 EUR = 500 Punkte"],
  ["FR", "EUR", "Retrait gratuit dès 20,00 EUR dans nos agences"],
  ["FR", "EUR", "Achat\nMontant: 49,00 EUR\nOffre valable jusqu'au 31/12"],
  ["ES", "EUR", "Retirada gratis a partir de 20,00 EUR"],
  ["DE", "EUR", "Ihre Abrechnung: Kartenzahlung gesamt 523,00 EUR"],
  ["DE", "EUR", "Monatsübersicht: Einkauf 523,00 EUR im Oktober"],
  ["DE", "EUR", "Lastschrift: Ausgleich Kreditkarte 523,00 EUR"],
  ["DE", "EUR", "Lastschrift\nBetrag: 523,00 EUR\nEmpfänger: Kreditkartenabrechnung"],
  ["FR", "EUR", "Virement émis\nMontant: 523,00 EUR\nBénéficiaire: Carte de crédit"],
  ["DE", "EUR", "So sieht eine Benachrichtigung aus: Kartenzahlung 27,15 EUR bei BUCHLADEN NORD"],
  ["DE", "EUR", "Einkauf 20 € REWE, Hälfte bitte zurück"],
  ["FR", "EUR", "Achat 40 € au resto, rembourse-moi la moitié"],
  ["ES", "EUR", "Compra de 40 € en el bar, devuélveme la mitad"],
  ["SE", "SEK", "Köp 400 kr hos ICA, swisha halva"],
  ["US", "USD", "Frais\nAmount: $2.90"],
  ["US", "USD", "Retirada\nAmount: $20.00"],
  ["US", "USD", "Opname 20.00 USD"],
  ["GB", "GBP", "Kosten\nAmount: £20.00"],
  ["AR", "ARS", "Comisión de mantenimiento 500 ARS desde marzo"],
  ["BR", "BRL", "Comissão cobrada R$ 5,00 a partir de janeiro"]
];
for (const [country, currency, body] of ROUND3_REVIEW_NEVER) test(`review: never books (${country}): ${body.replace(/\n/g, ' / ').slice(0, 56)}`, () => {
  for (const sender of ['BANK', '']) assert.equal(seam(body, sender, country, currency), null, sender);
});

// Second independent review, round 3: capitalised or inflected statuses after
// the merchant, notice lines taken for a bank name, qualifiers inside field
// values and footers, fee reversals, own-card payments, direction tricks and
// the clause reader's new vocabulary. None may book.
const ROUND3_REVIEW2_NEVER = [
  ["DE", "EUR", "Kartenzahlung 27,15 EUR bei REWE ABGELEHNT"],
  ["DE", "EUR", "Kartenzahlung 27,15 EUR bei REWE Ablehnung"],
  ["DE", "EUR", "Kartenzahlung 27,15 EUR bei REWE Storno"],
  ["DE", "EUR", "Kartenzahlung 27,15 EUR bei REWE STORNO"],
  ["DE", "EUR", "Kartenzahlung 27,15 EUR bei REWE Autorisierung"],
  ["DE", "EUR", "Kartenzahlung 27,15 EUR bei REWE Rückbuchung"],
  ["DE", "EUR", "Kartenzahlung 27,15 EUR bei REWE Nicht Gebucht"],
  ["DE", "EUR", "Kartenzahlung 27,15 EUR bei REWE Morgen"],
  ["DE", "EUR", "Kartenzahlung 27,15 EUR bei REWE Abgebrochen"],
  ["DE", "EUR", "Kartenzahlung 27,15 EUR bei REWE Widerrufen"],
  ["DE", "EUR", "Kartenzahlung 27,15 EUR bei REWE Verweigert"],
  ["DE", "EUR", "Kartenzahlung 27,15 EUR bei REWE Fehler"],
  ["DE", "EUR", "Kartenzahlung 27,15 EUR bei REWE Betrugsverdacht"],
  ["DE", "EUR", "Kartenzahlung 27,15 EUR bei REWE Deckung Fehlt"],
  ["DE", "EUR", "Kartenzahlung 27,15 EUR bei REWE Beispiel"],
  ["DE", "EUR", "Kartenzahlung 27,15 EUR bei REWE Test"],
  ["DE", "EUR", "Kartenzahlung 27,15 EUR bei REWE Vorschau"],
  ["DE", "EUR", "Kartenzahlung 27,15 EUR bei REWE Versuch"],
  ["DE", "EUR", "Kartenzahlung 27,15 EUR bei REWE Abgelehnte Transaktion"],
  ["DE", "EUR", "Kartenzahlung 27,15 EUR bei REWE - Ausstehende Zahlung"],
  ["DE", "EUR", "Kartenzahlung 27,15 EUR bei REWE - Vorgemerkte Zahlung"],
  ["DE", "EUR", "Kartenzahlung 27,15 EUR bei REWE - Stornierte Zahlung"],
  ["DE", "EUR", "Kartenzahlung 27,15 EUR bei REWE - Fehlgeschlagene Zahlung"],
  ["DE", "EUR", "Kartenzahlung 27,15 EUR bei REWE - Reservierter Betrag"],
  ["DE", "EUR", "Einkauf 58,40 EUR - BUCHLADEN NORD - ABGEBROCHEN"],
  ["DE", "EUR", "Einkauf 58,40 EUR - BUCHLADEN NORD - Noch Offen"],
  ["DE", "EUR", "Einkauf 58,40 EUR - BUCHLADEN NORD - Nur Autorisiert"],
  ["DE", "EUR", "Einkauf 58,40 EUR - BUCHLADEN NORD - GUTSCHRIFT"],
  ["DE", "EUR", "Einkauf 58,40 EUR - Ihr Monatsumsatz"],
  ["DE", "EUR", "Kartenumsatz September 1.234,56 EUR"],
  ["DE", "EUR", "Kartenumsatz Gesamt 1.234,56 EUR"],
  ["DE", "EUR", "Kartenzahlung 27,15 EUR (3 Umsätze)"],
  ["DE", "EUR", "Kartenzahlung +27,15 EUR bei AMAZON"],
  ["DE", "EUR", "Einkauf +58,40 EUR - AMAZON EU"],
  ["DE", "EUR", "Gutschrift -27,15 EUR bei AMAZON"],
  ["DE", "EUR", "Gutschrift Bis Zu 50,00 EUR"],
  ["DE", "EUR", "Erstattung Bis Zu 50,00 EUR Cashback"],
  ["DE", "EUR", "Gutschrift 5,00 EUR Cashback Aktion"],
  ["DE", "EUR", "Erstattung 30,00 EUR an LUKAS"],
  ["DE", "EUR", "Gutschrift 30,00 EUR an LUKAS MEIER"],
  ["DE", "EUR", "Gesendet Von LUKAS: 20,00 EUR"],
  ["DE", "EUR", "Gesendet 20,00 EUR Von LUKAS MEIER"],
  ["DE", "EUR", "Testnachricht\nKartenzahlung\nBetrag: 27,15 EUR\nHändler: REWE"],
  ["DE", "EUR", "Morgen\nLastschrift\nBetrag: 49,99 EUR\nHändler: VODAFONE"],
  ["DE", "EUR", "Geplante Zahlung\nLastschrift\nBetrag: 49,99 EUR"],
  ["DE", "EUR", "Abgelehnte Zahlung\nKartenzahlung\nBetrag: 27,15 EUR"],
  ["DE", "EUR", "Ausstehende Buchung\nKartenzahlung\nBetrag: 27,15 EUR"],
  ["DE", "EUR", "Sicherheitswarnung\nKartenzahlung\nBetrag: 27,15 EUR"],
  ["DE", "EUR", "Simulation: Kartenzahlung 27,15 EUR bei REWE"],
  ["DE", "EUR", "Test: Kartenzahlung 27,15 EUR bei REWE"],
  ["DE", "EUR", "Vorschau: Lastschrift 49,99 EUR VODAFONE"],
  ["DE", "EUR", "Gewinnspiel: Gutschrift 50,00 EUR"],
  ["DE", "EUR", "Demnächst: Lastschrift 49,99 EUR"],
  ["DE", "EUR", "Frage: Kartenzahlung 27,15 EUR bei REWE"],
  ["DE", "EUR", "Lastschrift\nBetrag: 49,99 EUR\nVerwendungszweck: Rücklastschrift mangels Deckung"],
  ["DE", "EUR", "Lastschrift\nBetrag: 49,99 EUR\nVerwendungszweck: Abbuchung erfolgt am 01.11.2026"],
  ["DE", "EUR", "Lastschrift\nBetrag: 49,99 EUR\nDatum: 01.11.2026"],
  ["DE", "EUR", "Lastschrift 49,99 EUR am 01.11.2026"],
  ["DE", "EUR", "Lastschrift\nBetrag: 49,99 EUR\nDatum: morgen"],
  ["DE", "EUR", "Kartenzahlung\nBetrag: 27,15 EUR\nHändler: REWE (Rückbuchung)"],
  ["DE", "EUR", "Kartenzahlung\nBetrag: 27,15 EUR\nHändler: REWE (Autorisierung)"],
  ["DE", "EUR", "Kartenzahlung\nBetrag: 27,15 EUR\nKonto: nicht gedeckt"],
  ["DE", "EUR", "Kartenzahlung\nBetrag: 27,15 EUR\nBuchung: Offen"],
  ["DE", "EUR", "Kartenzahlung\nBetrag: 27,15 EUR\nBuchung: erst nach Lieferung"],
  ["DE", "EUR", "Kartenzahlung\nBetrag: 27,15 EUR\nDetails: nur Autorisierung, keine Buchung"],
  ["DE", "EUR", "Kartenzahlung\nBetrag: 27,15 EUR\nUnbekannte Zahlung? Dies ist nur eine Autorisierung"],
  ["DE", "EUR", "Kartenzahlung\nBetrag: 27,15 EUR\nMehr Info: Belastung erst bei Versand"],
  ["DE", "EUR", "Kartenzahlung\nBetrag: 27,15 EUR\nBetrag: 270,15 EUR"],
  ["DE", "EUR", "Kartenzahlung 27,15 EUR bei REWE | Kartenzahlung 12,00 EUR bei DM"],
  ["DE", "EUR", "Entgelt\nBetrag: 5,00 EUR\nVerwendungszweck: Erstattung Entgelt September"],
  ["DE", "EUR", "Entgelt 5,00 EUR - ERSTATTET"],
  ["DE", "EUR", "Entgelt 5,00 EUR - RÜCKERSTATTUNG"],
  ["DE", "EUR", "Überweisung ausgeführt\nBetrag: 500,00 EUR\nAn: Eigenes Tagesgeldkonto"],
  ["DE", "EUR", "Überweisung ausgeführt\nBetrag: 500,00 EUR\nVerwendungszweck: Ausgleich Visa Kartenabrechnung"],
  ["DE", "EUR", "Lastschrift\nBetrag: 450,00 EUR\nVerwendungszweck: Kartenabrechnung Oktober Mastercard"],
  ["DE", "EUR", "Kartenzahlung 100,00 USD bei AMAZON\nBetrag: 92,10 EUR"],
  ["AT", "EUR", "Kartenzahlung 27,15 EUR bei BILLA Storno"],
  ["AT", "EUR", "Bargeldabhebung 200,00 EUR Am Geldautomaten Nicht Erfolgt"],
  ["AT", "EUR", "Bargeldabhebung 200,00 EUR Am Geldautomaten Abgebrochen"],
  ["CH", "CHF", "Kartenzahlung CHF 27.15 bei COOP Storniert Heute"],
  ["CH", "CHF", "Kartenzahlung CHF 27.15 bei COOP Abgewiesen"],
  ["CH", "EUR", "Kartenzahlung CHF 27.15 bei COOP"],
  ["CH", "CHF", "Einkauf CHF 58.40 - MANOR - Reservation"],
  ["FR", "EUR", "Achat 20,00 EUR chez FNAC REFUSÉ"],
  ["FR", "EUR", "Achat 20,00 EUR Chez FNAC Non Débité"],
  ["FR", "EUR", "Achat 20,00 EUR Chez FNAC Demain"],
  ["FR", "EUR", "Achat 20,00 EUR chez FNAC - ANNULATION"],
  ["FR", "EUR", "Achat 20,00 EUR chez FNAC - Opération Refusée"],
  ["FR", "EUR", "Achat 20,00 EUR chez FNAC - Paiement Différé"],
  ["FR", "EUR", "Achat 20,00 EUR chez FNAC - Pré-autorisation"],
  ["FR", "EUR", "Achat\nMontant : 20,00 EUR\nLe : demain"],
  ["FR", "EUR", "Achat\nMontant : 20,00 EUR\nLibellé : paiement différé fin de mois"],
  ["FR", "EUR", "Frais\nMontant : 2,90 EUR\nLibellé : remboursement frais"],
  ["FR", "EUR", "Frais 2,90 EUR - REMBOURSEMENT"],
  ["FR", "EUR", "Commission 2,00 EUR - REMBOURSÉE"],
  ["FR", "EUR", "Remboursement Prêt 450,00 EUR"],
  ["FR", "EUR", "Remboursement de 450,00 EUR - ECHEANCE PRET IMMOBILIER"],
  ["FR", "EUR", "Remboursement 30,00 EUR à CLAIRE MARTIN"],
  ["FR", "EUR", "Virement reçu par CLAIRE MARTIN : 300,00 EUR"],
  ["FR", "EUR", "Simulation : Achat 20,00 EUR chez FNAC"],
  ["FR", "EUR", "Prévision : Retrait 50,00 EUR"],
  ["FR", "EUR", "Virement émis\nMontant : 500,00 EUR\nBénéficiaire : AMEX CARTE GOLD"],
  ["FR", "EUR", "Paiement par carte de 20,00 EUR chez FNAC Le Plus Tôt Possible"],
  ["BE", "EUR", "Achat 20,00 EUR chez DELHAIZE Annulé Par Le Commerçant"],
  ["BE", "EUR", "Betaling 12,50 EUR bij COLRUYT Teruggedraaid"],
  ["BE", "EUR", "Betaling 12,50 EUR bij COLRUYT - STORNO"],
  ["NL", "EUR", "Betaling Ontvangen 20,00 EUR Van JAN DE VRIES"],
  ["NL", "EUR", "Pinbetaling 12,50 EUR Bij AH Geannuleerd"],
  ["NL", "EUR", "Pinbetaling 12,50 EUR Bij AH Teruggeboekt"],
  ["NL", "EUR", "Pinbetaling 12,50 EUR Bij AH Geblokkeerd"],
  ["NL", "EUR", "Incasso 49,99 EUR - STORNO"],
  ["NL", "EUR", "Incasso 49,99 EUR Aangekondigd"],
  ["NL", "EUR", "Incasso 49,99 EUR op 01-11-2026"],
  ["NL", "EUR", "Kosten 2,50 EUR - TERUGBETAALD"],
  ["NL", "EUR", "Kosten\nBedrag: 2,50 EUR\nOmschrijving: terugbetaling kosten"],
  ["NL", "EUR", "Terugbetaling Lening 200,00 EUR"],
  ["NL", "EUR", "Overboeking\nBedrag: 300,00 EUR\nOmschrijving: aflossing ICS Visa"],
  ["NL", "EUR", "Overboeking 300,00 EUR naar Spaarrekening"],
  ["NL", "EUR", "Ontvangen 20,00 EUR - Betaalverzoek"],
  ["NL", "EUR", "Ontvangen 20,00 EUR Van Tikkie Verzoek"],
  ["NL", "EUR", "Test\nPinbetaling\nBedrag: 12,50 EUR"],
  ["ES", "EUR", "Compra de 18,45 EUR En ZARA Devuelta"],
  ["ES", "EUR", "Compra de 18,45 EUR En ZARA Mañana"],
  ["ES", "EUR", "Compra de 18,45 EUR En ZARA Sin Fondos"],
  ["ES", "EUR", "Compra de 18,45 EUR en ZARA - RETENIDA"],
  ["ES", "EUR", "Compra de 18,45 EUR en ZARA - PREAUTORIZACIÓN"],
  ["ES", "EUR", "Comisión\nImporte: 5,00 EUR\nConcepto: devolución comisión"],
  ["ES", "EUR", "Comisión 5,00 EUR - DEVUELTA"],
  ["ES", "EUR", "Devolución Bizum 30,00 EUR a MARTA"],
  ["ES", "EUR", "Transferencia enviada\nImporte: 300,00 EUR\nConcepto: pago tarjeta VISA"],
  ["ES", "EUR", "Compra:\nImporte: 18,45 EUR\nComercio: ZARA\nFecha: mañana"],
  ["ES", "EUR", "Simulación: Compra de 18,45 EUR en ZARA"],
  ["ES", "EUR", "Sorteo: Bizum recibido 50,00 EUR"],
  ["PT", "EUR", "Compra de 15,00 EUR em CONTINENTE Recusada"],
  ["PT", "EUR", "Compra de 15,00 EUR Em CONTINENTE Cativada"],
  ["PT", "EUR", "Compra de 15,00 EUR - CONTINENTE - CATIVO"],
  ["PT", "EUR", "Comissão 2,00 EUR - DEVOLVIDA"],
  ["PT", "EUR", "MB WAY enviado de RITA SILVA 15,00 EUR"],
  ["PT", "EUR", "Levantamento 50,00 EUR Amanhã"],
  ["PT", "EUR", "Compra:\nMontante: 15,00 EUR\nComerciante: CONTINENTE\nData: amanhã"],
  ["IT", "EUR", "Pagamento 30,00 EUR presso ESSELUNGA Negato"],
  ["IT", "EUR", "Pagamento 30,00 EUR Presso ESSELUNGA Domani"],
  ["IT", "EUR", "Pagamento 30,00 EUR presso ESSELUNGA - SOSPESO"],
  ["IT", "EUR", "Commissione 2,00 EUR - RIMBORSATA"],
  ["IT", "EUR", "Commissione\nImporto: 2,00 EUR\nCausale: rimborso commissione"],
  ["IT", "EUR", "Rimborso Finanziamento 200,00 EUR"],
  ["IT", "EUR", "Rimborso 30,00 EUR a MARCO ROSSI"],
  ["IT", "EUR", "Storno 30,00 EUR - ESSELUNGA"],
  ["IT", "EUR", "Bonifico Ricevuto Dal Beneficiario MARCO ROSSI 300,00 EUR"],
  ["IT", "EUR", "Bonifico in uscita\nImporto: 500,00 EUR\nCausale: saldo carta Nexi"],
  ["IT", "EUR", "Acquisto 30,00 EUR Presso AMAZON In Attesa Di Conferma"],
  ["PL", "PLN", "Transakcja kartą 50,00 PLN w BIEDRONKA Zablokowana"],
  ["PL", "PLN", "Transakcja kartą 50,00 PLN W BIEDRONKA Wstrzymana"],
  ["PL", "PLN", "Transakcja kartą 50,00 PLN W BIEDRONKA W Toku"],
  ["PL", "PLN", "Opłata 10,00 PLN - ZWROT"],
  ["PL", "PLN", "Opłata\nKwota: 10,00 PLN\nTytuł: zwrot opłaty"],
  ["PL", "PLN", "Zwrot 50,00 PLN do JAN KOWALSKI"],
  ["PL", "PLN", "Przelew wychodzący\nKwota: 500,00 PLN\nTytuł: spłata karty Visa"],
  ["PL", "PLN", "Symulacja: Transakcja kartą 50,00 PLN w BIEDRONKA"],
  ["SE", "SEK", "Köp 245,00 kr hos ICA Nekat"],
  ["SE", "SEK", "Köp 245,00 kr hos ICA - SPÄRRAT"],
  ["SE", "SEK", "Köp 245,00 kr hos ICA - RESERVATION"],
  ["SE", "SEK", "Köp 245,00 kr hos ICA Imorgon"],
  ["SE", "SEK", "Avgift 25 kr - ÅTERBETALNING"],
  ["SE", "SEK", "Avgift\nBelopp: 25 kr\nMeddelande: återbetalning avgift"],
  ["SE", "SEK", "Överföring 5 000 kr till Sparkonto"],
  ["SE", "SEK", "Överföring 5 000 kr till Kortkonto Mastercard"],
  ["SE", "SEK", "Överföring 500 kr Från LINNEA"],
  ["SE", "SEK", "Uttag 500 kr - Ej Genomfört"],
  ["DK", "DKK", "Køb 245,00 kr. hos NETTO Afvist"],
  ["DK", "DKK", "Køb 245,00 kr. hos NETTO - RESERVERET"],
  ["DK", "DKK", "Køb 245,00 kr. hos NETTO I Morgen"],
  ["DK", "DKK", "Gebyr 25 kr. - TILBAGEFØRT"],
  ["DK", "DKK", "Gebyr\nBeløb: 25 kr.\nTekst: tilbagebetaling gebyr"],
  ["DK", "DKK", "Tilbagebetaling Lån 2.000 kr."],
  ["DK", "DKK", "Penge sendt 3.000 kr. til Mastercard"],
  ["DK", "DKK", "Penge sendt 300 kr. Fra FREJA"],
  ["DK", "DKK", "Køb\nBeløb: 245,00 kr.\nBogført: i morgen"],
  ["NO", "NOK", "Kjøp 245,00 kr hos REMA Avvist"],
  ["NO", "NOK", "Kjøp 245,00 kr hos REMA - RESERVERT"],
  ["NO", "NOK", "Gebyr 50 kr - REFUSJON"],
  ["NO", "NOK", "Refusjon 50 kr Til OLA NORDMANN"],
  ["NO", "NOK", "Kjøp\nBeløp: 245,00 kr\nBokført: i morgen"],
  ["NO", "NOK", "Penger mottatt 793,00 kr Fra OLA - Vil Du Ta Imot"],
  ["CZ", "CZK", "Nákup 500 Kč v ALBERT Zamítnuto"],
  ["CZ", "CZK", "Nákup 500 Kč - ALBERT - BLOKACE"],
  ["CZ", "CZK", "Poplatek 50 Kč - VRÁCENO"],
  ["CZ", "CZK", "Poplatek\nČástka: 50 Kč\nZpráva: vrácení poplatku"],
  ["CZ", "CZK", "Odeslaná platba 5 000 Kč pro Kreditní Kartu"],
  ["CZ", "CZK", "Nákup 500 Kč Zítra"],
  ["US", "USD", "Commission Earned 50,00 EUR"],
  ["US", "EUR", "Commission Payout 50,00 EUR"],
  ["GB", "EUR", "Commission 50,00 EUR - REFERRAL BONUS"],
  ["MX", "EUR", "Compra de 18,45 EUR En OXXO Rechazada Por Fondos"],
  ["IE", "EUR", "Retrait 50,00 EUR - ATM Declined"],
  ["DE", "EUR", "KARTENZAHLUNG 27,15 EUR BEI REWE NICHT GEBUCHT"],
  ["DE", "EUR", "KARTENZAHLUNG 27,15 EUR BEI REWE STORNO"],
  ["DE", "EUR", "Neuer Umsatz 27,15 EUR - Kaution Vorgehalten"],
  ["DE", "EUR", "Kartenumsatz 150,00 EUR - Mietwagen Kaution"],
  ["DE", "EUR", "Kartenzahlung 27,15 EUR - Bitte Prüfen"],
  ["DE", "EUR", "Kartenzahlung 27,15 EUR - Waren Sie Das"],
  ["DE", "EUR", "Kartenzahlung 27,15 EUR - Nicht Sie"],
  ["DE", "EUR", "Bargeldabhebung 200,00 EUR - Limit Täglich"],
  ["DE", "EUR", "Bargeldabhebung Maximal 200,00 EUR"],
  ["DE", "EUR", "Bargeldabhebung Ab 200,00 EUR Kostenlos"],
  ["DE", "EUR", "Gutschrift 20,00 EUR Für LUKAS"],
  ["DE", "EUR", "Gutschrift\nBetrag: 20,00 EUR\nVerwendungszweck: an LUKAS weitergeleitet"],
  ["DE", "EUR", "Kartenzahlung\nBetrag: 27,15 EUR\nOrt: wird morgen belastet"],
  ["DE", "EUR", "Kartenzahlung\nBetrag: 27,15 EUR\nKarte: ersetzt, Zahlung nicht verbucht"],
  ["DE", "EUR", "Haben Sie 50,00 EUR an LUKAS überwiesen"],
  ["DE", "EUR", "Sollten 50,00 EUR abgebucht worden sein, melden Sie sich"],
  ["DE", "EUR", "Falls 50,00 EUR abgehoben wurden, rufen Sie uns an"],
  ["DE", "EUR", "Kein Geld erhalten: 50,00 EUR von LUKAS fehlen"],
  ["DE", "EUR", "50,00 EUR wurden nie überwiesen"],
  ["DE", "EUR", "Ob 50,00 EUR eingegangen sind, sehen Sie morgen"],
  ["DE", "EUR", "Bitte 20,00 EUR an LUKAS überweisen"],
  ["DE", "EUR", "Statt 20,00 EUR wurden 0,00 EUR abgebucht"],
  ["DE", "EUR", "Wir haben 20,00 EUR nicht erstattet"],
  ["DE", "EUR", "Dein Freund hat 20,00 EUR gezahlt, sobald du bestätigst"],
  ["DE", "EUR", "Zahlung erfolgreich? 20,00 EUR an VODAFONE"],
  ["DE", "EUR", "LUKAS hat 20,00 EUR von dir erhalten"],
  ["DE", "EUR", "Ihre Überweisung über 20,00 EUR ist bei LUKAS eingegangen"],
  ["DE", "EUR", "Erstattung über 30,00 EUR beantragt bei AMAZON"],
  ["DE", "EUR", "Erstattung über 30,00 EUR bei AMAZON angefordert"],
  ["FR", "EUR", "Avez-vous payé 20,00 EUR chez FNAC"],
  ["FR", "EUR", "Si vous avez payé 20,00 EUR chez FNAC, contactez-nous"],
  ["FR", "EUR", "Vous n'avez jamais reçu 20,00 EUR de CLAIRE"],
  ["FR", "EUR", "Aucun virement de 20,00 EUR n'a été reçu"],
  ["FR", "EUR", "CLAIRE a reçu votre virement de 20,00 EUR"],
  ["FR", "EUR", "Peut-être débité de 20,00 EUR chez FNAC"],
  ["FR", "EUR", "Remboursement de 20,00 EUR demandé à FNAC"],
  ["ES", "EUR", "¿Has pagado 20,00 EUR en ZARA"],
  ["ES", "EUR", "Si pagaste 20,00 EUR en ZARA, ignora este mensaje"],
  ["ES", "EUR", "Nunca se cobraron 20,00 EUR en ZARA"],
  ["ES", "EUR", "Quizás se cobraron 20,00 EUR en ZARA"],
  ["ES", "EUR", "MARTA ha recibido tu Bizum de 30,00 EUR"],
  ["ES", "EUR", "Devolución de 20,00 EUR solicitada a ZARA"],
  ["IT", "EUR", "Hai pagato 20,00 EUR presso ESSELUNGA? Se no chiamaci"],
  ["IT", "EUR", "Mai addebitati 20,00 EUR presso ESSELUNGA"],
  ["IT", "EUR", "MARCO ha ricevuto il tuo bonifico di 300,00 EUR"],
  ["IT", "EUR", "Rimborso di 20,00 EUR richiesto a AMAZON"],
  ["NL", "EUR", "Heb je 20,00 EUR betaald bij AH"],
  ["NL", "EUR", "Er is geen 20,00 EUR afgeschreven"],
  ["NL", "EUR", "Mogelijk is 20,00 EUR afgeschreven bij AH"],
  ["NL", "EUR", "JAN heeft jouw 20,00 EUR ontvangen"],
  ["NL", "EUR", "Terugbetaling van 20,00 EUR aangevraagd bij BOL"],
  ["PT", "EUR", "Se pagou 15,00 EUR no CONTINENTE, ignore"],
  ["PT", "EUR", "Nunca foram debitados 15,00 EUR"],
  ["PT", "EUR", "RITA recebeu o seu MB WAY de 15,00 EUR"],
  ["PL", "PLN", "Czy zapłaciłeś 50,00 PLN w BIEDRONKA"],
  ["PL", "PLN", "Jeśli zapłaciłeś 50,00 PLN w BIEDRONKA, zignoruj"],
  ["PL", "PLN", "Nie otrzymano 50,00 PLN od JANA"],
  ["PL", "PLN", "Być może pobrano 50,00 PLN"],
  ["PL", "PLN", "JAN otrzymał Twój przelew 50,00 PLN"],
  ["SE", "SEK", "Om du betalat 245 kr hos ICA, ignorera"],
  ["SE", "SEK", "Aldrig dragits 245 kr hos ICA"],
  ["SE", "SEK", "ERIK har fått din överföring på 245 kr"],
  ["SE", "SEK", "Kanske dragits 245 kr hos ICA"],
  ["DK", "DKK", "Hvis du har betalt 245 kr. hos NETTO, så ignorer"],
  ["DK", "DKK", "Har du betalt 245 kr. hos NETTO"],
  ["DK", "DKK", "Der er ikke hævet 245 kr. hos NETTO"],
  ["DK", "DKK", "Måske er der hævet 245 kr. hos NETTO"],
  ["DK", "DKK", "FREJA har modtaget dine 300 kr."],
  ["NO", "NOK", "Hvis du har betalt 245 kr hos REMA, ignorer"],
  ["NO", "NOK", "Kanskje trukket 245 kr hos REMA"],
  ["NO", "NOK", "OLA har mottatt dine 300 kr"],
  ["NO", "NOK", "Det er ikke trukket 245 kr hos REMA"],
  ["CZ", "CZK", "Pokud jste zaplatili 500 Kč v ALBERT, ignorujte"],
  ["CZ", "CZK", "Nezaplatili jste 500 Kč v ALBERT"],
  ["CZ", "CZK", "Zaplatili jste 500 Kč v ALBERT? Volejte"],
  ["CZ", "CZK", "Možná stržena částka 500 Kč"],
  ["CZ", "CZK", "Platba 500 Kč nebyla připsána"],
  ["CZ", "CZK", "JAN obdržel vaši platbu 500 Kč"]
];
for (const [country, currency, body] of ROUND3_REVIEW2_NEVER) test(`review 2: never books (${country}): ${body.replace(/\n/g, ' / ').slice(0, 56)}`, () => {
  for (const sender of ['BANK', '']) assert.equal(seam(body, sender, country, currency), null, sender);
});
test('a grouped European figure still books under a heading (Kartenzahlung EUR 1,234.56 bei MEDIAMARKT)', () => {
  const parsed = seam('Kartenzahlung EUR 1,234.56 bei MEDIAMARKT', 'BANK', 'DE', 'EUR');
  assert.ok(parsed && parsed.amountFils === 123456 && parsed.type === 'expense');
});

// Round 4 (final worldwide review): a status, hedge, claim prompt or
// question ANYWHERE in the message withdraws the posting in every pack
// language, in any case and on its own line; card bills, own-account moves,
// contradicting signs, call-back numbers from personal senders and a krone
// whose language contradicts the reader's country never book. Synthetic,
// fictional bodies throughout.
const ROUND4_BASES = [
  ['CZ', 'George', 'Platba kartou 459,00 Kč u ALBERT', 'expense', ['zamítnuto', 'odmítnuto', 'neúspěšné', 'čeká na zpracování', 'transakce zrušena', 'neprovedeno', 'declined']],
  ['DK', 'MobilePay', 'Mette Hansen har sendt dig 1.250,00 kr.', 'income', ['afvist', 'tryk for at modtage', 'annulleret', 'reserveret', 'ikke gennemført', 'declined']],
  ['DK', 'Danske', 'Køb 450,00 kr. hos NETTO', 'expense', ['afvist', 'annulleret', 'reserveret', 'ikke gennemført', 'declined']],
  ['SE', 'Swish', 'Du har fått 450,00 kr från ANNA SVENSSON', 'income', ['nekad', 'avbruten', 'reserverat', 'godkänn i appen för att ta emot', 'pågår', 'declined']],
  ['SE', 'Swedbank', 'Köp 450,00 kr hos ICA', 'expense', ['nekad', 'avbruten', 'reserverat', 'pågår', 'kan ha dragits', 'declined']],
  ['NO', 'Vipps', 'Du har mottatt 450,00 kr fra OLA NORDMANN', null, ['avvist', 'reservert', 'kansellert', 'declined']],
  ['NO', 'DNB', 'Kjøp 450,00 kr hos REMA 1000', 'expense', ['avvist', 'reservert', 'kansellert', 'kan ha blitt trukket', 'declined']],
  ['PL', 'PKO', 'Płatność kartą 45,00 PLN w BIEDRONKA', null, ['odrzucona', 'anulowana', 'oczekuje', 'blokada', 'declined']],
  ['PL', 'PKO', 'Otrzymałeś przelew 450,00 PLN od JAN KOWALSKI', 'income', ['odrzucona', 'anulowana', 'oczekuje', 'blokada', 'declined']],
  ['PT', 'CGD', 'Compra de 45,00 EUR em CONTINENTE', null, ['recusada', 'cancelada', 'pendente', 'não efetuada', 'declined']],
  ['PT', 'CGD', 'Recebeu uma transferência de 450,00 EUR de JOÃO SILVA', 'income', ['recusada', 'cancelada', 'pendente', 'não efetuada', 'declined']],
  ['ES', 'BBVA', 'Compra de 45,00 EUR en MERCADONA', 'expense', ['denegada', 'anulada', 'pendiente', 'no realizada', 'fallida', 'preautorización', 'en proceso', 'en trámite', 'no procesada', 'errónea', 'incorrecta', 'declined']],
  ['ES', 'BBVA', 'Has recibido una transferencia de 450,00 EUR de JUAN PEREZ', 'income', ['denegada', 'anulada', 'pendiente', 'no realizada', 'fallida', 'declined']],
  ['IT', 'Intesa', 'Pagamento di 45,00 EUR presso ESSELUNGA', 'expense', ['rifiutato', 'annullato', 'in attesa', 'non riuscito', 'fallito', 'in corso', 'declined']],
  ['IT', 'Intesa', 'Hai ricevuto un bonifico di 450,00 EUR da MARIO ROSSI', 'income', ['rifiutato', 'annullato', 'in attesa', 'non riuscito', 'fallito', 'declined']],
  ['NL', 'ING', 'Betaling van 45,00 EUR bij ALBERT HEIJN', null, ['geweigerd', 'geannuleerd', 'in behandeling', 'mislukt', 'declined']],
  ['NL', 'ING', 'Je hebt 450,00 EUR ontvangen van JAN JANSEN', 'income', ['geweigerd', 'geannuleerd', 'in behandeling', 'mislukt', 'declined']],
  ['FR', 'BNP', 'Paiement de 45,00 EUR chez CARREFOUR', null, ['refusé', 'annulé', 'en attente', 'échec', 'échoué', 'declined']],
  ['FR', 'BNP', 'Virement reçu de 450,00 EUR de JEAN DUPONT', 'income', ['refusé', 'annulé', 'en attente', 'échec', 'échoué', 'retourné', 'rejeté par la banque', 'declined']],
  ['DE', 'Sparkasse', 'Kartenzahlung 45,00 EUR bei REWE', 'expense', ['abgelehnt', 'storniert', 'vorgemerkt', 'fehlgeschlagen', 'ungültig', 'erfolglos', 'vorautorisierung', 'ungedeckt', 'rückgängig gemacht', 'unterbrochen', 'wird gebucht', 'declined']],
  ['DE', 'Sparkasse', 'Gutschrift 450,00 EUR von MAX MUSTERMANN', null, ['abgelehnt', 'storniert', 'vorgemerkt', 'fehlgeschlagen', 'ungültig', 'erfolglos', 'rückläufer', 'declined']],
];
// A null type marks a base that already waits in Review; its twins still may not book.
const capitalise = (word) => word.charAt(0).toLocaleUpperCase('de-DE') + word.slice(1);
for (const [country, sender, base, type, statuses] of ROUND4_BASES) {
  if (type) test(`${country} round-4 base still books from its sender: ${base}`, () => {
    const parsed = seam(base, sender, country, LEDGER[country]);
    assert.ok(parsed, 'the completed base alert books');
    assert.equal(parsed.type, type);
  });
  for (const status of statuses) test(`${country} round-4 status anywhere never books: ${base.slice(0, 30)} … ${status}`, () => {
    for (const form of [status, status.toLocaleUpperCase('de-DE'), capitalise(status)]) {
      for (const glue of ['\n', '. ', ' ']) {
        const body = `${base}${glue}${form}`;
        for (const s of [sender, '']) assert.equal(seam(body, s, country, LEDGER[country]), null, `${s}: ${JSON.stringify(body)}`);
      }
    }
  });
}

// Explicit review inputs: [country, currency, senders, body].
const ROUND4_NEVER = [
  ['CZ', 'CZK', ['George'], 'Platba kartou 459,00 Kč u ALBERT. Částka bude stržena zítra.'],
  ['CZ', 'CZK', ['George'], 'Platba kartou 459,00 Kč u ALBERT. Byli jste to vy? Odpovězte ANO'],
  ['CZ', 'CZK', ['George'], 'Platba kartou 459,00 Kč\nZAMÍTNUTO\nkarta *1234, 03.10.2026'],
  ['CZ', 'CZK', ['George'], 'Platba kartou 459,00 Kč\nNEPROVEDENO\nkarta *1234, 03.10.2026'],
  ['CZ', 'CZK', ['CSOB'], 'Platba kartou 184,50 CZK u ALBERT ODMÍTNUTO'],
  ['DK', 'DKK', ['MobilePay'], 'Mette Hansen har sendt dig 1.250,00 kr.\nBesked: Tryk for at modtage pengene'],
  ['DK', 'DKK', ['MobilePay'], 'Mette Hansen har sendt dig 1.250,00 kr.\nBesked: Husleje oktober. Svar JA for at acceptere'],
  ['ES', 'EUR', ['BBVA'], 'Compra de 18,45 EUR con su tarjeta ...1234 en SHOP el 03/10/2026 NO REALIZADA'],
  ['ES', 'EUR', ['BBVA'], 'Compra de 18,45 EUR con su tarjeta ...1234 en SHOP el 03/10/2026 PREAUTORIZACIÓN'],
  ['ES', 'EUR', ['BBVA'], 'Compra de 18,45 EUR con su tarjeta ...1234 en SHOP el 03/10/2026 EN PROCESO'],
  ['IT', 'EUR', ['Intesa'], 'Pagamento carta 18,45 EUR presso SHOP IN CORSO'],
  ['SE', 'SEK', ['Swedbank'], 'Köp 184,50 SEK hos ICA PÅGÅR'],
  ['SE', 'SEK', ['Swedbank'], 'Köp 450,00 kr hos ICA kan ha dragits'],
  ['NO', 'NOK', ['DNB'], 'Kjøp 450,00 kr hos REMA 1000 kan ha blitt trukket'],
  ['DE', 'EUR', ['Sparkasse'], 'Kartenzahlung 27,15 EUR bei REWE UNGEDECKT'],
  ['DE', 'EUR', ['Sparkasse'], 'Kartenzahlung 27,15 EUR bei REWE WIRD GEBUCHT'],
  ['DE', 'EUR', ['Sparkasse'], 'Lastschrift 45,67 EUR an VODAFONE GMBH RÜCKGABE'],
  ['DE', 'EUR', ['Sparkasse'], 'Lastschrift 45,67 EUR an VODAFONE GMBH WIDERSPRUCH'],
  ['DE', 'EUR', ['Commerzbank'], 'Commerzbank: Zahlungseingang auf Ihrem Konto ***5678: +2.450,00 EUR von MUSTERFIRMA GMBH\nVerwendungszweck: RÜCKLÄUFER\nBuchung: 30.09.2026'],
  ['FR', 'EUR', ['BoursoBank'], 'Virement émis : 1 500,00 € à M. DUPONT JEAN\nLibellé : ÉCHEC'],
  ['FR', 'EUR', ['BoursoBank'], 'Virement reçu : 1 500,00 € de M. DUPONT JEAN\nLibellé : RETOURNÉ'],
  ['FR', 'EUR', ['BoursoBank'], 'Virement reçu : 1 500,00 € de M. DUPONT JEAN\nLibellé : REJETÉ PAR LA BANQUE'],
  ['CA', 'CAD', ['RBC'], 'RBC\nVotre virement permanent de 25,85 $ à Lucas Martin sera exécuté le 03/11/2026. Solde disponible: 1 879,51 $.'],
  ['CA', 'CAD', ['Scotiabank'], 'Scotiabank: Votre virement permanent de 578,42 $ à SOCIETE EXEMPLE SAS sera exécuté le 08/11/2026.\nCe n\'est pas vous? Appelez le 1-888-555-0142.'],
  // Card bills are settlements, never spending.
  ['DE', 'EUR', ['Sparkasse'], 'Lastschrift 450,00 EUR an AMERICAN EXPRESS EUROPE'],
  ['DE', 'EUR', ['Sparkasse'], 'Lastschrift 450,00 EUR an ADVANZIA BANK'],
  ['DE', 'EUR', ['Sparkasse'], 'Lastschrift 450,00 EUR an DKB VISA'],
  ['DE', 'EUR', ['Sparkasse'], 'Lastschrift 450,00 EUR an HANSEATIC BANK GENIALCARD'],
  ['DE', 'EUR', ['Sparkasse'], 'Lastschrift 450,00 EUR an BARCLAYS BANK IRELAND'],
  ['DE', 'EUR', ['Sparkasse'], 'Lastschrift 450,00 EUR an BARCLAYCARD'],
  ['DE', 'EUR', ['Sparkasse'], 'Kartenzahlung 450,00 EUR bei MASTERCARD ABRECHNUNG'],
  ['NL', 'EUR', ['ING'], 'Incasso 450,00 EUR ICS'],
  ['US', 'USD', ['BofA'], 'Your $250.00 payment to APPLE CARD was sent.'],
  ['US', 'USD', ['BofA'], 'Your $250.00 payment to GS BANK (APPLE CARD) was sent.'],
  ['US', 'USD', ['Chase'], 'You paid CAPITAL ONE $250.00 from checking ending 1234.'],
  ['US', 'USD', ['Chase'], 'You paid AMEX $250.00.'],
  ['US', 'USD', ['Venmo'], 'You paid Discover Card $250.00'],
  ['US', 'USD', ['Chase'], 'You paid Chase Sapphire $250.00 on Oct 10.'],
  ['US', 'USD', ['Chase'], 'Payment of $250.00 at AMEX on 10/10'],
  // Own-account moves are transfers between the reader's own accounts.
  ['FR', 'EUR', ['BNP'], 'Virement émis : 1 500,00 € à LIVRET A'],
  ['FR', 'EUR', ['BNP'], 'Virement émis : 1 500,00 € à M. DUPONT JEAN LIVRET A'],
  ['DE', 'EUR', ['N26'], 'Gutschrift 450,00 EUR von N26 SPACE'],
  ['DE', 'EUR', ['Sparkasse'], 'Zahlungseingang 450,00 EUR von TRADE REPUBLIC'],
  ['DE', 'EUR', ['Sparkasse'], 'Gutschrift 45,67 EUR von SPARKASSE TAGESGELD'],
  ['GB', 'GBP', ['Monzo'], '£250.00 sent to MY SAVINGS'],
  ['GB', 'GBP', ['Monzo'], '£250.00 sent to JOHN SMITH (your other account)'],
  ['US', 'USD', ['Venmo'], 'You paid My Savings $25.00'],
  ['US', 'USD', ['BofA'], '$500.00 was deposited into your savings account ending 4321 from your checking account ending 1234.'],
  // A sign that contradicts the direction.
  ['US', 'USD', ['Chase'], 'Deposit of -$500.00 posted to your account ending 1234'],
  ['DE', 'EUR', ['Sparkasse'], 'Kartenzahlung 27,15 EUR+ bei REWE'],
  ['DE', 'EUR', ['Sparkasse'], 'Kartenzahlung 27,15 EUR H bei REWE'],
  ['DE', 'EUR', ['Sparkasse'], 'Gutschrift\nBetrag: 27,15 EUR S'],
  // English withdrawals of the posting.
  ['US', 'USD', ['24273'], 'Alert: Your card ending 1234 was charged more than $100.00 at TARGET.'],
  ['US', 'USD', ['Chase'], 'Your $100.00 limit transaction alert: a purchase was more than the limit.'],
  ['US', 'USD', ['Venmo'], 'You paid Sarah Lee $25.00 - unclaimed'],
  ['US', 'USD', ['Venmo'], 'You paid Sarah Lee $25.00 for rent. Sarah Lee has not accepted it yet.'],
  ['US', 'USD', ['Venmo'], 'You paid Sarah Lee $25.00 for dinner. This payment will be reviewed.'],
  ['US', 'USD', ['Venmo'], 'Tip: You paid Sarah Lee $25.00 is how your friends see payments.'],
  // A krone whose alert language contradicts the reader's country.
  ['DK', 'DKK', ['Swish'], 'Du har fått 450,00 kr från ANNA SVENSSON'],
  ['DK', 'DKK', ['Swedbank'], 'Köp 450,00 kr hos ICA'],
  ['NO', 'NOK', ['Swedbank'], 'Köp 450,00 kr hos ICA'],
  ['NO', 'NOK', ['MobilePay'], 'Mette Hansen har sendt dig 1.250,00 kr.'],
  ['SE', 'SEK', ['Danske'], 'Køb 450,00 kr. hos NETTO'],
  // Links from any sender at a lookalike host.
  ['DE', 'EUR', ['Sparkasse'], 'Kartenzahlung 27,15 EUR bei REWE\nhttps://spk-sicher.example/x'],
];
for (const [country, currency, senders, body] of ROUND4_NEVER) test(`round 4: never books (${country}): ${body.replace(/\n/g, ' / ').slice(0, 60)}`, () => {
  for (const s of [...senders, '']) {
    const parsed = seam(body, s, country, currency);
    assert.ok(parsed === null || parsed.cardPaymentSide, `${s}: ${parsed && `${parsed.type} ${parsed.amountFils}`}`);
  }
});

// Call-back numbers and scheme-less links from a phone or e-mail sender:
// the language does not matter, the shape is vishing.
const PERSONAL_SENDERS = ['+15551234567', 'alerts@secure-mail.com'];
for (const [country, currency, body] of [
  ['US', 'USD', 'Chase: A purchase of $899.00 at APPLE STORE was approved on card ending 1234. Didn\'t make it? Call 1-800-555-0199.'],
  ['US', 'USD', 'Chase: A purchase of $899.00 at APPLE STORE was approved on card ending 1234. Unrecognized? Call 1-800-555-0199.'],
  ['US', 'USD', 'Chase: A purchase of $899.00 at APPLE STORE was approved on card ending 1234. Call 1-800-555-0199 to cancel.'],
  ['US', 'USD', 'Chase: A purchase of $899.00 at APPLE STORE was approved on card ending 1234. Contact fraud dept 18005550199.'],
  ['US', 'USD', 'Your card ending 1234 was charged $899.00 at BEST BUY. Wasn\'t you? Reach us at 800.555.0199'],
  ['US', 'USD', 'Chase: purchase of $899.00 at APPLE STORE was approved. Call 1-800-555-0199 if you have questions.'],
  ['US', 'USD', 'Your card ending 1234 was charged $899.00 at APPLE STORE. Verify at chase-secure.com'],
  ['US', 'USD', 'Your card ending 1234 was charged $899.00 at APPLE STORE. Verify at chase.verify-id.co'],
  ['US', 'USD', 'Your card ending 1234 was charged $899.00 at APPLE STORE. Cancel: chase-help.net?id=88'],
  ['US', 'USD', 'Your card ending 1234 was charged $899.00 at APPLE STORE. Cancel at secure-chase.app'],
  ['DE', 'EUR', 'Kartenzahlung 27,15 EUR bei REWE\nUnbekannte Zahlung? Rufen Sie uns an +49 30 1234567'],
  ['DE', 'EUR', 'Kartenzahlung 899,00 EUR bei MEDIAMARKT\nUnbekannte Zahlung? Rufen Sie uns an 030 1234567'],
  ['CZ', 'CZK', 'Platba kartou 8 990,00 Kč u ALZA\nNebyli jste to vy? Volejte 800 123 456'],
]) test(`round 4: a personal sender with a call-back number or lookalike link never books: ${body.replace(/\n/g, ' / ').slice(0, 56)}`, () => {
  for (const s of PERSONAL_SENDERS) assert.equal(seam(body, s, country, currency), null, s);
});

// The paired completed alerts still book.
for (const [country, currency, sender, body, type, minor] of [
  ['DE', 'EUR', 'Sparkasse', 'Zahlungseingang 450,00 EUR von MAX MUSTERMANN', 'income', 45000],
  ['DE', 'EUR', 'Sparkasse', 'Kartenzahlung\nBetrag: 27,15 EUR S\nHändler: REWE', 'expense', 2715],
  ['DE', 'EUR', 'Sparkasse', 'Kartenzahlung 27,15 EUR bei REWE. Unbekannte Zahlung? Sperr-Notruf 116 116', 'expense', 2715],
  ['DE', 'EUR', 'Sparkasse', 'Kartenzahlung 27,15 EUR bei REWE\nUnbekannte Zahlung? Rufen Sie uns an 030 1234567', 'expense', 2715],
  ['DE', 'EUR', 'Sparkasse', 'Lastschrift 45,67 EUR an VODAFONE GMBH', 'expense', 4567],
  ['FR', 'EUR', 'BoursoBank', 'Virement émis : 1 500,00 € à M. DUPONT JEAN\nLibellé : LOYER', 'expense', 150000],
  ['ES', 'EUR', 'BBVA', 'Compra de 18,45 EUR con su tarjeta ...1234 en SHOP el 03/10/2026', 'expense', 1845],
  ['IT', 'EUR', 'Intesa', 'Pagamento carta 18,45 EUR presso SHOP', 'expense', 1845],
  ['SE', 'SEK', 'Swedbank', 'Köp 184,50 SEK hos ICA', 'expense', 18450],
  ['SE', 'SEK', 'Swedbank', 'Köp 450,00 kr hos ICA', 'expense', 45000],
  ['DK', 'DKK', 'Danske', 'Køb 450,00 kr. hos NETTO', 'expense', 45000],
  ['NO', 'NOK', 'DNB', 'Kjøp 450,00 kr hos REMA 1000', 'expense', 45000],
  ['US', 'USD', 'Venmo', 'You paid JOHN SMITH $45.00 for pizza', 'expense', 4500],
  ['US', 'USD', 'Chase', 'You paid JOHN SMITH $45.00 via Zelle.', 'expense', 4500],
  ['US', 'USD', '+15551234567', 'Chase: A purchase of $899.00 at APPLE STORE was approved on card ending 1234.', 'expense', 89900],
  ['US', 'USD', 'Chase', 'Your card ending 1234 was charged $899.00 at APPLE STORE. Questions? Visit chase.com', 'expense', 89900],
  ['CA', 'CAD', 'RBC', 'RBC: A purchase of $45.00 was made at TIM HORTONS with your card ending 1234.', 'expense', 4500],
  ['GB', 'GBP', 'Monzo', '£45.00 sent to JOHN SMITH', 'expense', 4500],
]) test(`round 4: the completed twin still books (${country}): ${body.replace(/\n/g, ' / ').slice(0, 56)}`, () => {
  const parsed = seam(body, sender, country, currency);
  assert.ok(parsed, 'books');
  assert.equal(parsed.type, type);
  assert.equal(parsed.amountFils, minor);
});

// Round 4, alert-lab round-3 shapes: card bills spelled with a card word,
// own accounts in every language, a sign after "kr.", a Danish alert under
// a Norwegian reader, dotted call-back numbers and Arabic thresholds.
for (const [country, currency, senders, body] of [
  ['US', 'USD', ['Chase'], '5.26 USD was spent at VISA CARD PAYMENT on your Visa Debit ••4258 on Sep 24, 2026.'],
  ['IE', 'EUR', ['AIB'], 'You made an online purchase of €174.91 at BANK OF IRELAND CREDIT CARD with your Visa Debit ••7524 on 22/09/26.'],
  ['AT', 'EUR', ['Erste Bank'], 'Erste Bank: Sie haben online 161,35 € bei CARD COMPLETE bezahlt am 08.10.2026.'],
  ['CH', 'CHF', ['UBS'], '158.00 CHF online bei SWISSCARD AECS bezahlt'],
  ['CZ', 'CZK', ['AirBank'], 'Online platba 1 566,93 CZK u AIR BANK KREDITNI KARTA'],
  ['IT', 'EUR', ['IntesaSP'], 'Acquisto online: € 39,90 su AGOS DUCATO CARTA · 03/10/2026'],
  ['IT', 'EUR', ['IntesaSP'], 'Acquisto online di 92,05 EUR su MASTERCARD ABRECHNUNG. Saldo disponibile: 1.779,22 EUR.'],
  ['DK', 'DKK', ['Danske Bank'], 'Danske Bank: Du har betalt 248,00 DKK hos FORBRUGSFORENINGEN.'],
  ['PT', 'EUR', ['Novo Banco'], 'Novo Banco: MB WAY: enviou 2 048,00€ para CARTAO UNIVERSO em 20/09/2026 às 11:06.'],
  ['SE', 'SEK', ['Handelsbanken'], 'Autogiro 3 685,17 kr till EGET KONTO har dragits från ditt konto ****9147 28 sep.'],
  ['CZ', 'CZK', ['CSOB'], 'Zaplatili jste fakturu SPORICI UCET ve výši 1 644,19 Kč dne 11.10.2026.'],
  ['DK', 'DKK', ['Nordea'], 'Nordea: Vi har opkrævet et gebyr på 4,00 kr.+ den 01.10.2026.'],
  ['NO', 'NOK', ['Nordea'], 'Nordea: Dit kort er trukket 400,00 kr hos RUTER.'],
  ['QA', 'QAR', ['CBQ'], 'تم خصم أكثر من 2,000.00 ر.ق من بطاقتك المنتهية بـ 2948 لدى TRANSFER LOUNGE.'],
]) test(`round 4 (lab): never books (${country}): ${body.slice(0, 60)}`, () => {
  for (const s of [...senders, '']) {
    const parsed = seam(body, s, country, currency);
    assert.ok(parsed === null || parsed.cardPaymentSide, `${s}: ${parsed && `${parsed.type} ${parsed.amountFils}`}`);
  }
});
for (const [country, currency, sender, body] of [
  ['PL', 'PLN', '+48 512 345 678', 'mBank: Wysłałeś przelew 888,89 PLN do Anna Kowalska.\nTo nie Ty? Zadzwoń natychmiast 800.302.302'],
  ['CZ', 'CZK', 'alerts@bank-mail.example', 'Výběr hotovosti 6 000,00 Kč\nNebyli jste to vy? Volejte 800.207.207'],
  ['DK', 'DKK', '+45 20 12 34 56', 'Gebyr trukket 62,39 DKK\nIkke dig? Ring straks 70.12.34.56'],
]) test(`round 4 (lab): a dotted call-back number from a personal sender never books: ${body.slice(0, 50)}`, () => {
  assert.equal(seam(body, sender, country, currency), null);
});
// The card the reader paid WITH is not a payee, and a bank subdomain is no lookalike.
for (const [country, currency, sender, body, minor] of [
  ['DE', 'EUR', 'Sparkasse', 'Kartenzahlung 45,00 EUR bei REWE mit Ihrer DKB VISA', 4500],
  ['US', 'USD', 'Chase', 'You spent $45.00 at TARGET with your Capital One card ending 1234.', 4500],
  ['US', 'USD', 'Chase', 'Your card ending 1234 was charged $45.00 at TARGET. Sign in at secure.chase.com', 4500],
  ['NO', 'NOK', 'DNB', 'Du betalte 89,00 kr til KAFE NORD. Beløp trukket fra kortet ditt.', 8900],
]) test(`round 4 (lab): the completed twin still books: ${body.slice(0, 56)}`, () => {
  const parsed = seam(body, sender, country, currency);
  assert.ok(parsed, 'books');
  assert.equal(parsed.type, 'expense');
  assert.equal(parsed.amountFils, minor);
});

// Round 4, second independent review: English wording with a European status
// line, issuer payees after "Ihre" or before a card tail, thresholds written
// "or more" / ">", bracketed and spaced signs, Soll/Haben words, Venmo
// wording, a capitalised Swedish alert under NO and savings providers.
for (const [country, currency, sender, body] of [
  ["DE", "EUR", "Revolut", "You spent €27.15 at REWE\nNICHT GEBUCHT"],
  ["DE", "EUR", "Revolut", "You spent €27.15 at REWE\nwird gebucht"],
  ["CZ", "CZK", "George", "Platba kartou 459,00 Kč u ALBERT\nAutorizace"],
  ["DE", "EUR", "Revolut", "You received €450.00 from MAX MUSTERMANN\nIN SOSPESO"],
  ["DE", "EUR", "Sparkasse", "Lastschrift 450,00 EUR an AMERICAN EXPRESS ****1234"],
  ["DE", "EUR", "Sparkasse", "Lastschrift 450,00 EUR an Ihre Barclaycard"],
  ["DE", "EUR", "Sparkasse", "Lastschrift 450,00 EUR an BARCLAYS"],
  ["DE", "EUR", "Sparkasse", "Lastschrift 450,00 EUR an LANDESBANK BERLIN"],
  ["DE", "EUR", "Sparkasse", "Lastschrift 450,00 EUR an DEUTSCHE KREDITBANK"],
  ["DE", "EUR", "Sparkasse", "Lastschrift 450,00 EUR an SANTANDER CONSUMER BANK"],
  ["NL", "EUR", "ING", "Incasso 450,00 EUR ABN AMRO Creditcards"],
  ["US", "USD", "Chase", "You paid CITI $250.00"],
  ["US", "USD", "Chase", "You paid WELLS FARGO CARD SERVICES $250.00"],
  ["US", "USD", "Chase", "You paid BARCLAYS US $250.00"],
  ["US", "USD", "Chase", "Your card ending 1234 was charged $100.00 or more at TARGET."],
  ["US", "USD", "Chase", "A purchase of $100.00 or more was made at TARGET with card ending 1234"],
  ["US", "USD", "Chase", "Your card ending 1234 was charged greater than or equal to $100.00 at TARGET."],
  ["US", "USD", "Chase", "Your card ending 1234 was charged > $100.00 at TARGET."],
  ["US", "USD", "Chase", "Your card ending 1234 was charged >$100 at TARGET."],
  ["US", "USD", "Chase", "Your card ending 1234 was charged $100.00 (above your alert amount) at TARGET."],
  ["US", "USD", "Chase", "Your card ending 1234 was charged &gt; $100.00 at TARGET."],
  ["US", "USD", "Chase", "Deposit of ($500.00) posted to your account ending 1234"],
  ["US", "USD", "Chase", "Deposit of - $500.00 posted to your account ending 1234"],
  ["DE", "EUR", "Sparkasse", "Kartenzahlung 27,15 EUR + bei REWE"],
  ["DE", "EUR", "Sparkasse", "Kartenzahlung 27,15 EUR Haben bei REWE"],
  ["DE", "EUR", "Sparkasse", "Kartenzahlung\nBetrag: H 27,15 EUR\nHändler: REWE"],
  ["US", "USD", "Venmo", "You paid Sarah Lee $25.00. Sarah hasn't accepted it yet."],
  ["US", "USD", "Venmo", "You paid Sarah Lee $25.00. Hasnt been accepted"],
  ["US", "USD", "Venmo", "You paid Sarah Lee $25.00 — not claimed"],
  ["US", "USD", "Venmo", "You paid Sarah Lee $25.00. This payment is being reviewed."],
  ["US", "USD", "Venmo", "You paid Sarah Lee $25.00. Sarah doesn't have a Venmo account yet."],
  ["US", "USD", "Venmo", "Pro tip - You paid Sarah Lee $25.00"],
  ["US", "USD", "Venmo", "Sarah Lee paid you $25.00. Accept now"],
  ["NO", "NOK", "Swedbank", "KÖP 450,00 kr hos ICA"],
  ["GB", "GBP", "Monzo", "£250.00 sent to ISA"],
  ["GB", "GBP", "Monzo", "You sent £250.00 to CHIP"],
  ["US", "USD", "Chase", "You sent $500.00 to ALLY BANK"],
  ["US", "USD", "Chase", "You transferred $500.00 to account ending 4321"],
]) test(`round 4 (review 2): never books (${country}): ${body.replace(/\n/g, " / ").slice(0, 56)}`, () => {
  for (const s of [sender, ""]) {
    const parsed = seam(body, s, country, currency);
    assert.ok(parsed === null || parsed.cardPaymentSide, `${s}: ${parsed && `${parsed.type} ${parsed.amountFils}`}`);
  }
});
// Their completed twins: Dutch "pas" is a card, a savings advert is no
// transfer, an issuer brand header is the sender, a refund may be negative.
for (const [country, currency, sender, body, type, minor] of [
  ["NL", "EUR", "ING", "U heeft met uw pas 45,00 EUR betaald bij JUMBO", "expense", 4500],
  ["US", "USD", "Chase", "You spent $27.15 at TARGET. Earn more with your Savings account.", "expense", 2715],
  ["US", "USD", "Chase", "Chase Sapphire Preferred Visa: You made a $3.44 transaction with CHARGEPOINT on Feb 17, 2026.", "expense", 344],
  ["DE", "EUR", "Sparkasse", "Kartenzahlung 27,15 EUR bei HOME DEPOT", "expense", 2715],
  ["DE", "EUR", "Sparkasse", "Kartenzahlung 27,15 EUR bei KANN BAR", "expense", 2715],
]) test(`round 4 (review 2): the completed twin still books: ${body.slice(0, 56)}`, () => {
  const parsed = seam(body, sender, country, currency);
  assert.ok(parsed, "books");
  assert.equal(parsed.type, type);
  assert.equal(parsed.amountFils, minor);
});

// Round 4, alert-lab round-3 rerun: an issuer or own account as the subject
// that collected the money, in a merchant field, after "sur" or a bill noun,
// and refunds written with a trailing minus.
for (const [country, currency, sender, body] of [
  ['CA', 'CAD', 'RBC', 'RBC: VISA CARD PAYMENT a prélevé 242,65 $ sur votre compte courant se terminant par 6005 le 29/09/2026 18:07.'],
  ['DE', 'EUR', 'C24', 'Online-Umsatz\nHändler: MASTERCARD ABRECHNUNG\nDatum: 24.09.2026\nKonto: ****1400\nBetrag: 25,00€'],
  ['FR', 'EUR', 'SG-Info', 'Société Générale: Vous avez effectué un achat en ligne de 186,92 € sur AMERICAN EXPRESS CARTE-FRANCE le 04/10/2026.'],
  ['FR', 'EUR', 'BNPParibas', 'BNP Paribas: COMPTE EPARGNE a prélevé 75,14 € sur votre compte courant se terminant par 7577 le 27/09/2026.'],
  ['BE', 'EUR', 'Belfius', 'Votre facture COMPTE EPARGNE de 400,23 EUR a été payée.'],
  ['ES', 'EUR', 'CaixaBank', 'CaixaBank: Recibo pagado: 282,86€ - HUCHA BBVA · 21/09/2026 a las 12:07'],
  ['NO', 'NOK', 'SpareBank1', 'SpareBank 1: Regning betalt kr 3 213,85 - EGEN KONTO'],
  ['BE', 'EUR', 'Payconiq', 'UBER *TRIP vous a remboursé 169,00 €- Solde disponible: 5.197,55 €.'],
  ['NL', 'EUR', 'ING', 'Terugbetaling van 208,61 EUR- van JUMBO bijgeschreven op 30 sep.'],
  // A refund with a leading minus is not decided by its sign either.
  ['US', 'USD', 'Google', '-$123.45 was refunded to Amex ••1234'],
  ['SE', 'SEK', 'SEB', 'SEB\nDu har betalt 303,02 kr hos COOP KONSUM.'],
]) test(`round 4 (lab rerun): never books (${country}): ${body.replace(/\n/g, ' / ').slice(0, 56)}`, () => {
  for (const s of [sender, '']) {
    const parsed = seam(body, s, country, currency);
    assert.ok(parsed === null || parsed.cardPaymentSide, `${s}: ${parsed && `${parsed.type} ${parsed.amountFils}`}`);
  }
});

// Round 4, third review: Czech "ne" as an answer, an all-capitals hedge,
// unaccented future forms, more card issuers; and their completed twins.
for (const [country, currency, body] of [
  ['CZ', 'CZK', 'Platba kartou 459,00 Kč u ALBERT\nProvedeno: ne'],
  ['CZ', 'CZK', 'Platba kartou 459,00 Kč u ALBERT\nÚspěšná: NE'],
  ['CZ', 'CZK', 'Platba kartou 459,00 Kč u ALBERT ne'],
  ['DE', 'EUR', 'KARTENZAHLUNG 27,15 EUR BEI REWE. BELASTUNG KANN ERFOLGEN'],
  ['IT', 'EUR', 'PAGAMENTO DI 45,00 EUR PRESSO ESSELUNGA VERRA ADDEBITATO'],
  ['DE', 'EUR', 'Lastschrift 450,00 EUR an LBB'],
  ['DE', 'EUR', 'Lastschrift 450,00 EUR an CONSORS FINANZ'],
  ['US', 'USD', 'You paid CAP ONE $250.00'],
  ['US', 'USD', 'You paid SYNCB $250.00'],
]) test(`round 4 (review 3): never books (${country}): ${body.replace(/\n/g, ' / ').slice(0, 56)}`, () => {
  for (const s of ['Bank', '']) {
    const parsed = seam(body, s, country, currency);
    assert.ok(parsed === null || parsed.cardPaymentSide, `${s}: ${parsed && `${parsed.type} ${parsed.amountFils}`}`);
  }
});
for (const [country, currency, sender, body, type, minor] of [
  ['US', 'USD', 'Chase', 'You spent $45.00 at CITI TRENDS', 'expense', 4500],
  ['DE', 'EUR', 'Sparkasse', 'Kartenzahlung 27,15 EUR bei H&M Berlin', 'expense', 2715],
  ['ES', 'EUR', 'CaixaBank', 'Has recibido un Bizum de 30,00 € de Sara García.', 'income', 3000],
  ['GB', 'GBP', 'Monzo', '£50.00 sent to LISA SMITH', 'expense', 5000],
]) test(`round 4 (review 3): the completed twin still books: ${body.slice(0, 56)}`, () => {
  const parsed = seam(body, sender, country, currency);
  assert.ok(parsed, 'books');
  assert.equal(parsed.type, type);
  assert.equal(parsed.amountFils, minor);
});

// Round 4, final lab rerun: an issuer heading before its amount, a merchant
// label without a colon, an Arabic "at", and Haben before a semicolon.
for (const [country, currency, sender, body] of [
  ['DK', 'DKK', 'Danske', '🧾 MASTERCARD ABRECHNUNG 753,53 DKK betalt'],
  ['NO', 'NOK', 'Vipps', '🧾 RE:MEMBER 3 932,00 kr betalt'],
  ['CZ', 'CZK', 'CSAS', 'Z vaší karty xxxx6695 byla stržena částka 3 780,48 Kč, obchodník VISA CARD PAYMENT, 01.10.2026.'],
  ['KW', 'KWD', 'WAMD', 'شراء: 5.334 KWD لدى VISA CARD PAYMENT · 06/10/2026 10:17'],
  ['EG', 'EGP', 'CIB', 'شراء بمبلغ EGP 6,751.78 من MASTERCARD ABRECHNUNG'],
  ['DE', 'EUR', 'RheintalBank', 'Rheintal Bank\nLastschrift; Betrag: 290,43€ H; An: ADOBE'],
]) test(`round 4 (final lab): never books (${country}): ${body.replace(/\n/g, ' / ').slice(0, 56)}`, () => {
  for (const s of [sender, '']) {
    const parsed = seam(body, s, country, currency);
    assert.ok(parsed === null || parsed.cardPaymentSide, `${s}: ${parsed && `${parsed.type} ${parsed.amountFils}`}`);
  }
});

// Round 4, holdout shapes: an approval still required, an own account or
// issuer as the subject that collected the money, a refund word inside a
// title-case shop name, and a short hotline from a personal sender.
for (const [country, currency, sender, body] of [
  ['US', 'USD', 'Capital One', 'Capital One\nA charge of $30.15 at WALMART SUPERCENTER requires approval.'],
  ['DE', 'EUR', 'Rheintal Bank', 'Rheintal Bank\nEIGENES SPARKONTO hat 175,24 € per Lastschrift abgebucht.'],
  ['CH', 'CHF', 'UBS', 'UBS\nBARCLAYCARD hat CHF 43.38 per Lastschrift abgebucht am 25. Sep. 2026.'],
  ['NL', 'EUR', 'Rabobank', 'Incasso van € 374,24 door AMERICAN EXPRESS EUROPE afgeschreven van uw betaalrekening eindigend op 5005.'],
  ['IE', 'EUR', 'N26', 'Paid EUR 112.68 at BARCLAYCARD Available balance: EUR 2,801.96.'],
  ['ES', 'EUR', 'CaixaBank', 'Has enviado EUR 1.101,27 a WIZINK BANK. Saldo EUR 2.483,84'],
  ['BH', 'BHD', 'NBB', 'NBB: You paid ADVANZIA BANK BHD 699.623 on 2026-10-09 11:12.'],
  ['OM', 'OMR', 'BankMuscat', 'Bank Muscat: You paid MY SAVINGS 706.000 RO.'],
  ['CZ', 'CZK', 'CSAS', 'Nákup kartou CZK 2655,59 - Refund Shop'],
]) test(`round 4 (holdout): never books (${country}): ${body.replace(/\n/g, ' / ').slice(0, 56)}`, () => {
  for (const s of [sender, '']) {
    const parsed = seam(body, s, country, currency);
    assert.ok(parsed === null || parsed.cardPaymentSide, `${s}: ${parsed && `${parsed.type} ${parsed.amountFils}`}`);
  }
});
test('round 4 (holdout): a short hotline after a call verb from a personal sender waits in Review', () => {
  const body = 'تمت عملية شراء بمبلغ 520.00 جم لدى JUMIA EG باستخدام البطاقة XXXX4848.\nإذا لم تقم بهذه العملية اتصل فوراً على 19623';
  assert.equal(seam(body, '01098765432', 'EG', 'EGP'), null);
});
test('round 4 (holdout): a negated status ending the sentence never books', () => {
  const body = 'Se ha realizado un cargo de EUR 1.806,22 en EL CORTE INGLES NO REALIZADA.';
  for (const s of ['Revolut', '']) assert.equal(seam(body, s, 'ES', 'EUR'), null, s);
});

// Template drift: a completed European alert that differs a little from its
// template still books — a reference number, a leading date, a bank
// signature, a dash for a colon, a typing slip in the balance footer, an
// all-capitals SMS, a trailing emoji, a title-case merchant and synonyms.
for (const [country, currency, sender, body, minor] of [
  ['DE', 'EUR', 'ING', 'ING: Einkauf 141,26 € - REWE SAGT DANKE - 08.10.2026 08:44 Referenz: 587316', 14126],
  ['PL', 'PLN', 'PKO', 'Transakcja kartą; Kwota: 297,82 zł; Sprzedawca: BIEDRONKA; Data operacji: 27.09.2026\nID transakcji 531158', 29782],
  ['DE', 'EUR', 'DeutscheBank', '27.09.2026 08:44: Einkauf 63,33€ - ALDI SUED', 6333],
  ['BE', 'EUR', 'Belfius', 'Achat 62,46 € - SNCB NMBS - carte ****2964 - Belfius', 6246],
  ['DE', 'EUR', 'ING', 'ING – Einkauf 141,26 € - REWE SAGT DANKE - 08.10.2026 08:44', 14126],
  ['SE', 'SEK', 'SEB', 'Onlineköp\nDatum – 10 okt\nSumma – SEK 1 924,91\nKonto – XXXX7032\nButik – SL BILJETT', 192491],
  ['DK', 'DKK', 'Danske', 'Danske Bank: Refusion | Forretning: FOETEX | Bogført: 25.09.2026 | Beløb: +1.211,41 DKK\nDisponibel sadlo: 33.652,55 DKK.', 121141],
  ['NO', 'NOK', 'DNB', 'KORTKJØP: KR 20 213,00 HOS STORE 24/7 · 25.09.2026', 2021300],
  ['DE', 'EUR', 'Sparkasse', 'ES WURDEN 156,06 EUR BEI AIRBNB * HM4KQ2 MIT IHRER GIROCARD ***6842 BEZAHLT. NEUER SALDO 3.903,53 EUR', 15606],
  ['NL', 'EUR', 'ING', 'ING: Automatische incasso\nBedrag: 71,18 EUR\nBegunstigde: AMAZON PRIME\nDatum: 06-10-2026 om 14:15 🔔', 7118],
  ['DE', 'EUR', 'RheintalBank', 'Rheintal Bank: Einkauf 18,25€ - Rossmann - 06.10.2026 10:27', 1825],
  ['DK', 'DKK', 'JyskeBank', 'Jyske Bank: Du har handlet for 830,70 DKK hos ADOBE.', 83070],
]) test(`drift: the completed alert still books: ${body.replace(/\n/g, ' / ').slice(0, 56)}`, () => {
  const parsed = seam(body, sender, country, currency);
  assert.ok(parsed, 'books');
  assert.equal(parsed.amountFils, minor);
});
// …and the same tolerance never hides a status.
for (const [country, currency, body] of [
  ['DE', 'EUR', 'Kartenzahlung 45,00 EUR bei REWE - Storniert'],
  ['DE', 'EUR', 'Kartenzahlung 45,00 EUR bei REWE\nReferenz: ABGELEHNT'],
  ['DE', 'EUR', 'ING – Einkauf 141,26 € - REWE SAGT DANKE\nStatus – abgelehnt'],
  ['DK', 'DKK', 'Danske Bank: Køb | Forretning: FOETEX | Beløb: 1.211,41 DKK\nDisponibel sadlo: 33.652,55 DKK. Afvist'],
  ['NO', 'NOK', 'KORTKJØP: KR 20 213,00 HOS STORE 24/7 · 25.09.2026 AVVIST'],
  ['PL', 'PLN', 'Transakcja kartą; Kwota: 297,82 zł; Sprzedawca: BIEDRONKA\nID transakcji 531158 odrzucona'],
]) test(`drift: a status still withdraws the drifted alert: ${body.replace(/\n/g, ' / ').slice(0, 56)}`, () => {
  for (const s of ['BANK', '']) assert.equal(seam(body, s, country, currency), null, s);
});

// Third review of the drift tolerance: what it blanks never hides a status.
for (const [country, currency, body] of [
  ['DE', 'EUR', 'Kartenzahlung 27,15 EUR bei REWE ↩️'],
  ['DE', 'EUR', 'Kartenzahlung 27,15 EUR bei REWE ❌'],
  ['DE', 'EUR', 'Kartenzahlung 27,15 EUR bei REWE - Retoure'],
  ['DE', 'EUR', 'Kartenzahlung 27,15 EUR bei REWE - Entwurf'],
  ['ES', 'EUR', 'Compra de 45,00 EUR en MERCADONA - Aviso'],
  ['CZ', 'CZK', 'Platba kartou 459,00 Kč u ALBERT - Upomínka'],
  ['DE', 'EUR', 'Termin – Lastschrift 45,67 EUR an VODAFONE GMBH'],
  ['NL', 'EUR', 'Aankondiging – Incasso 45,67 EUR VODAFONE'],
  ['DE', 'EUR', '01.11.2026 Lastschrift 45,67 EUR an VODAFONE GMBH'],
  ['DE', 'EUR', '15. Nov Lastschrift 45,67 EUR an VODAFONE GMBH'],
  ['PL', 'PLN', 'Transakcja internetowa 45,00 PLN w ALLEGRO. Kod: 123456'],
  ['DE', 'EUR', 'Kartenzahlung 27,15 EUR bei REWE\nRef: STORNO-4711'],
  ['DE', 'EUR', 'Kartenzahlung 27,15 EUR bei REWE\nReferenz: RUECK-2026'],
]) test(`drift review: never books (${country}): ${body.replace(/\n/g, ' / ').slice(0, 56)}`, () => {
  for (const s of ['Sparkasse', '']) assert.equal(seam(body, s, country, currency), null, s);
});
for (const [country, currency, body] of [
  ['DE', 'EUR', 'Sparkasse Termin – Lastschrift 45,67 EUR an VODAFONE GMBH'],
  ['PL', 'PLN', 'Transakcja internetowa 45,00 PLN w ALLEGRO. Kod 12 34 56'],
  ['ES', 'EUR', 'Compra de 45,00 EUR en AMAZON. Clave: 123456'],
  ['CZ', 'CZK', 'Platba kartou 459,00 Kč u ALBERT - Připomínka'],
  ['DE', 'EUR', 'Lastschrift 45,67 EUR an VODAFONE GMBH, Fälligkeit 01.11.2026'],
  ['DE', 'EUR', 'Kartenzahlung 27,15 EUR bei REWE ❎'],
]) test(`drift review 4: never books (${country}): ${body.slice(0, 56)}`, () => {
  for (const s of ['Sparkasse', '']) assert.equal(seam(body, s, country, currency), null, s);
});
test('drift review 4: a card network in the card field is still the card paid with', () => {
  const parsed = seam('Kartenzahlung\nBetrag: 27,15 EUR\nKarte: VISA ****1234\nHändler: REWE', 'Sparkasse', 'DE', 'EUR');
  assert.ok(parsed && parsed.amountFils === 2715);
});

// Round 5: ONE status lexicon (src/lib/alert-status-lexicon.ts) for every
// reader. Its forms are generated from stems and inflection classes; this
// pins a sample of the generated forms per language and concept, and that
// every one of them withdraws a posting wherever it stands.
const { STATUS_FORMS, findStatusWords } = load('@/lib/alert-status-lexicon');
test('the status lexicon generates inflections, accent-free and negated forms for every language', () => {
  const forms = new Set(STATUS_FORMS.map((form) => `${form.language}:${form.form}`));
  for (const expected of [
    'de:abgelehnte', 'de:storniert', 'de:nicht ausgeführt', 'de:vorabautorisierung', 'de:rueckgabe', 'de:geplatzt',
    'fr:refusée', 'fr:refusees', 'fr:non effectué', 'fr:suspendu', 'fr:expiré', 'fr:provisoire',
    'es:denegadas', 'es:no realizada', 'es:caducada', 'es:suspendida', 'es:retención',
    'it:rifiutati', 'it:non eseguito', 'it:trattenuto', 'it:scaduto',
    'nl:afgekeurd', 'nl:niet uitgevoerd', 'nl:voorlopig', 'nl:gereserveerd',
    'pt:recusadas', 'pt:não efetuada', 'pt:cativo', 'pt:retido', 'pt:em análise', 'pt:estornado',
    'pl:odrzucona', 'pl:niezrealizowana', 'pl:nie zrealizowana', 'pl:wstrzymana', 'pl:nieautoryzowana',
    'sv:nekades', 'sv:avslag', 'sv:inte genomförd', 'sv:preliminär',
    'da:afvist', 'da:ikke gennemført', 'da:foreløbig', 'da:tilbageført',
    'nb:avslått', 'nb:ikke gjennomført', 'nb:foreløpig', 'nb:tilbakeført',
    'cs:zamítnuta', 'cs:neprovedeno', 'cs:nepovolena', 'cs:vráceno', 'cs:předautorizace',
    'en:declined', 'en:not completed', 'en:pre-authorized', 'ar:مرفوضة', 'ar:لن يتم',
  ]) assert.ok(forms.has(expected), expected);
  // Case-insensitive and word-boundary safe.
  assert.ok(findStatusWords('ZAHLUNG GEPLATZT').length);
  assert.ok(findStatusWords('Kartenzahlung bei REWE VORABAUTORISIERUNG').length);
  assert.equal(findStatusWords('Kartenzahlung 27,15 EUR bei REWE').length, 0);
  assert.equal(findStatusWords('You spent USD 80.00 at HOTEL RESERVATION DESK').length, 0);
});
for (const [country, currency, sender, base] of [
  ['DE', 'EUR', 'Sparkasse', 'Kartenzahlung 27,15 EUR bei REWE'],
  ['FR', 'EUR', 'BoursoBank', 'Virement reçu : 1 500,00 € de M. DUPONT JEAN'],
  ['ES', 'EUR', 'BBVA', 'Has recibido una transferencia de 450,00 EUR de JUAN PEREZ'],
  ['IT', 'EUR', 'Intesa', 'Hai ricevuto un bonifico di 450,00 EUR da MARIO ROSSI'],
  ['NL', 'EUR', 'Rabobank', 'Je hebt 450,00 EUR ontvangen van JAN JANSEN'],
  ['PT', 'EUR', 'CGD', 'Recebeu uma transferência de 450,00 EUR de JOÃO SILVA'],
  ['PL', 'PLN', 'mBank', 'Otrzymałeś przelew 450,00 PLN od JAN KOWALSKI'],
  ['SE', 'SEK', 'Swedbank', 'Köp 450,00 kr hos ICA'],
  ['DK', 'DKK', 'Danske', 'Køb 450,00 kr. hos NETTO'],
  ['NO', 'NOK', 'DNB', 'Kjøp 450,00 kr hos REMA 1000'],
  ['CZ', 'CZK', 'George', 'Platba kartou 459,00 Kč u ALBERT'],
]) test(`round 5: every generated status of its language withdraws ${country}: ${base.slice(0, 40)}`, () => {
  const language = { DE: 'de', FR: 'fr', ES: 'es', IT: 'it', NL: 'nl', PT: 'pt', PL: 'pl', SE: 'sv', DK: 'da', NO: 'nb', CZ: 'cs' }[country];
  const sample = STATUS_FORMS.filter((form) => form.language === language && !form.compoundOnly && form.concept !== 'example')
    .filter((_, index) => index % 7 === 0);
  for (const form of sample) for (const glue of ['\n', '. ']) {
    for (const spelled of [form.form, form.form.toLocaleUpperCase('de-DE')]) {
      const body = `${base}${glue}${spelled}`;
      const parsed = seam(body, sender, country, currency);
      assert.equal(parsed, null, JSON.stringify(body));
    }
  }
});

// Footer blanking never hides a status in its own sentence or the next one.
for (const [country, currency, sender, body] of [
  ['SE', 'SEK', 'Swedbank', 'Du har fått 450,00 kr från ANNA SVENSSON\nDu behöver inte göra något, köpet har nekats.'],
  ['NL', 'EUR', 'Rabobank', 'Je hebt 450,00 EUR ontvangen van JAN JANSEN\nPincode onjuist, nooit uitgevoerd.'],
  ['DK', 'DKK', 'Danske', 'Mette Hansen har sendt dig 1.250,00 kr.\nForkert pinkode, aldrig gennemført.'],
  ['SE', 'SEK', 'Swedbank', 'Köp 450,00 kr hos ICA. Not you? Köpet nekades'],
  ['CZ', 'CZK', 'George', 'PLATBA KARTOU 459,00 KČ U ALBERT\nNEMUSÍTE NIC DĚLAT, PLATBA BYLA ZAMÍTNUTA.'],
  // Signs, markers, card bills, thresholds and P2P wording (N5–N7, both-builds items).
  ['US', 'USD', 'Chase', 'Deposit of –$500.00 posted to your account ending 1234'],
  ['DE', 'EUR', 'Sparkasse', 'Kartenzahlung\nBetrag: 27,15 EUR (H)\nHändler: REWE'],
  ['DE', 'EUR', 'Sparkasse', 'Kartenzahlung\nBetrag: 27,15 EUR Cr\nHändler: REWE'],
  ['US', 'USD', 'Chase', 'You paid CHASE CREDIT CRD AUTOPAY $250.00'],
  ['US', 'USD', 'Chase', 'You paid WELLS FARGO CARD $250.00'],
  ['US', 'USD', 'Chase', 'Your card ending 1234 was charged upwards of $100.00 at TARGET'],
  ['US', 'USD', 'Venmo', 'You paid Sarah Lee $25.00. Waiting for Sarah to sign up'],
  ['US', 'USD', 'Chase', 'Chase: You made a $45.00 transaction with AMAZON. Confirm at CHASE-SECURE.COM'],
  ['US', 'USD', 'Chase', 'Your card ending 1234 was charged -$45.00 at AMAZON'],
  ['US', 'USD', 'Chase', 'Purchase of ($45.00) at AMAZON with card ending 1234'],
  ['DE', 'EUR', 'Sparkasse', 'Du hast 27,15 € bei REWE bezahlt\nZahlung erneut versuchen'],
  ['ES', 'EUR', 'BBVA', 'Compra de 45,00 EUR en MERCADONA. Vuelve a intentarlo.'],
  // Ambiguous decimal-comma figures (D).
  ['DK', 'DKK', 'MobilePay', 'Mette Hansen har sendt dig 1,250 kr.'],
  ['DE', 'EUR', 'Sparkasse', 'Kartenzahlung 1,450 EUR bei REWE'],
  ['CZ', 'CZK', 'George', 'Platba kartou 1,459 Kč u ALBERT'],
  // Example labels between connectors.
  ['SE', 'SEK', 'Handelsbanken', 'Handelsbanken - Exempel - kortköp 1 127,00 kr hos SYSTEMBOLAGET.'],
  ['CZ', 'CZK', 'CSOB', 'ČSOB – Příklad – platba kartou 8 000,00 Kč u ALBERT HM.'],
  ['CA', 'CAD', 'TD', 'TD - Example - A charge of $2,127.00 at CANADIAN TIRE #45 was approved.'],
]) test(`round 5: never books (${country}): ${body.replace(/\n/g, ' / ').slice(0, 56)}`, () => {
  for (const s of [sender, '']) {
    const parsed = seam(body, s, country, currency);
    assert.ok(parsed === null || parsed.cardPaymentSide, `${s}: ${parsed && `${parsed.type} ${parsed.amountFils}`}`);
  }
});
// A call-back footer in any language from a blank sender (iPhone History) waits in Review.
for (const [country, currency, body] of [
  ['NL', 'EUR', 'Pinbetaling 18,45 EUR bij ALBERT HEIJN\nNiet herkend? Bel ons op 020 123 4567'],
  ['CZ', 'CZK', 'Platba kartou 459,00 Kč u ALBERT\nNebyli jste to vy? Zavolejte 800 123 456'],
  ['DE', 'EUR', 'Kartenzahlung 27,15 EUR bei REWE\nUnbekannte Zahlung? Rufen Sie uns an +49 30 1234567'],
]) test(`round 5: a blank-sender call-back footer waits in Review: ${body.replace(/\n/g, ' / ').slice(0, 50)}`, () => {
  assert.equal(seam(body, '', country, currency), null);
});
// Paired positives.
for (const [country, currency, sender, body, minor] of [
  ['DE', 'EUR', 'Sparkasse', 'Kartenzahlung 27,15 EUR bei REWE. Unbekannte Zahlung? Sperr-Notruf 116 116', 2715],
  ['DE', 'EUR', 'Sparkasse', 'Kartenzahlung\nBetrag: 27,15 EUR S\nHändler: REWE', 2715],
  ['US', 'USD', 'Chase', 'You spent $45.00 at TARGET with your card ending 1234. Reward points will be added to your account.', 4500],
  ['SG', 'SGD', 'DBS', 'DBS: A transaction of SGD 18.50 was made with your DBS/POSB card ending 1234 on 02 Oct 2026 at GRAB*FOOD. If unauthorised, call 1800 111 1111.', 1850],
  ['DK', 'DKK', 'Danske', 'Køb 1.250,00 kr. hos NETTO', 125000],
  ['IE', 'EUR', 'AIB', 'You spent €1,450.00 at TESCO with your card ending 1234.', 145000],
]) test(`round 5: the completed twin still books: ${body.slice(0, 56)}`, () => {
  const parsed = seam(body, sender, country, currency);
  assert.ok(parsed, 'books');
  assert.equal(parsed.amountFils, minor);
});

// Round 5, review iteration: the lexicon reads a status however it is
// written — glued into a token, behind a digit, with an invisible character,
// a no-break space or an underscore, negated across auxiliaries, as a
// "Status:" label value, in a negated past ("godkändes inte") — and the
// footer blanking never crosses a line.
test('the lexicon reads glued, negated-across-auxiliary and labelled statuses', () => {
  for (const text of [
    'ZAHLUNGABGELEHNT', '#Zahlungabgelehnt', '*1234DECLINED', 'Kartenzahlung bei REWE *1234BEARBEITUNGLÄUFT',
    'PAIEMENTENECHEC', 'Paiement en echec', 'Errorenelpago', 'Attesaconferma', 'Köpetväntarpågodkännande',
    "PAYMENTCOULDN'TBECOMPLETED", '*1234ONHOLD', 'Holdplaced', 'Retrylater', 'Topuptocomplete', 'Prévule20/10',
    'Not yet posted', "n'a pas été effectuée", 'no ha sido realizada', 'non è stato eseguito', 'nie została zrealizowana',
    'ikke blevet gennemført', "couldn't be completed", 'Köpet godkändes inte',
    'Status: Bearbeitung', 'Estado: en revisión', '*1234STATUS:ONHOLD', 'E​CHEC', 'Status: Bearbeitung',
    'Txn declnd', 'Transaction denied', 'NSF', 'Not charged', 'z powodu odmowy', 'zakończona niepowodzeniem',
    'z důvodu nedostatečného zůstatku', 'Upomínky', 'Kansellering', 'Annullering', 'Reserverat belopp',
    '1.250,00 kr.\n(Reservation)', '#Reservation 🙁', 'Vardetdu?SvaraJAellerNEJ', 'Køb *1234HOSNETTOERMULIGVISTRUKKET',
  ]) assert.ok(findStatusWords(text).length, JSON.stringify(text));
  // …and not inside the ordinary words or names that contain one.
  for (const text of [
    'You spent at SPENDING MART', 'Kartenzahlung bei OFFENBACH APOTHEKE', 'Morgenstern Apotheke', 'carta ricaricabile',
    'HOTEL RESERVATION DESK', 'SAMPLE MART', 'AMZN*SAMPLE STORE', 'Danske Bank: Refusion | Forretning: FOETEX',
    'Status: Gebucht', 'Estado: Aprobada', 'Reward points will be added', 'Sign up for paperless statements',
    'Var det du? Svara JA', 'You paid Sarah Lee $25.00', 'independiente', 'aplicativos',
  ]) assert.equal(findStatusWords(text).length, 0, JSON.stringify(text));
});
test('a letters-only run longer than any word is read as unreadable, in linear time', () => {
  const long = 'Vorabautorisierungsrückbuchungsstornierung'.repeat(200);
  const started = Date.now();
  assert.ok(findStatusWords(long).some((match) => match.concept === 'unreadable'));
  assert.ok(Date.now() - started < 250);
});
for (const [country, currency, sender, body] of [
  // Glued, digit-glued and invisible-character statuses.
  ['DE', 'EUR', 'Sparkasse', 'Kartenzahlung 27,15 EUR bei REWE. ZAHLUNGABGELEHNT'],
  ['DE', 'EUR', 'Sparkasse', 'Kartenzahlung 27,15 EUR bei REWE *1234ABBUCHUNGERFOLGTMORGEN'],
  ['FR', 'EUR', 'BoursoBank', 'Paiement par carte : 27,15 € chez CARREFOUR. E​CHEC'],
  ['US', 'USD', 'Chase', 'Payment of $56.20 at TESCO on 10/10. R​eply YES if this was you.'],
  ['ES', 'EUR', 'BBVA', 'Compra de 45,00 EUR en MERCADONA *1234ERRORENELPAGO'],
  ['SE', 'SEK', 'Swedbank', 'Köp 450,00 kr hos ICA. #Köpetväntarpågodkännande'],
  ['CZ', 'CZK', 'George', 'Platba kartou 459,00 Kč u ALBERT\nPlatba_ceka_na_zpracovani'],
  ['GB', 'GBP', 'Monzo', 'You spent £27.15 at TESCO *1234TOPUPTOCOMPLETE'],
  ['US', 'USD', 'Chase', 'Chase: $45.00 debit card purchase at TARGET *1234STATUS:ONHOLD'],
  // A status line BEFORE the movement line (the footer strip stops at the line end).
  ['SE', 'SEK', 'Swedbank', 'Köpet godkändes inte\nDu har fått 450,00 kr från ANNA SVENSSON'],
  // Status label values, no-break spaces and underscores.
  ['DE', 'EUR', 'Sparkasse', 'Kartenzahlung 27,15 EUR bei REWE. Status: Bearbeitung'],
  ['DE', 'EUR', 'Sparkasse', 'Kartenzahlung\nBetrag: 27,15 EUR (H)\nHändler: REWE'],
  ['GB', 'GBP', '+447700900123', 'You spent £45.00 at TESCO\nNot_you?_Phone_0800_123_4567'],
  ['US', 'USD', 'Chase', 'Your card ending 1234 was charged $899.00 at APPLE STORE. Verify_at_chase-secure.com'],
  // English wording in a European currency reads the English lexicon too.
  ['IE', 'EUR', 'AIB', 'Card purchase of EUR 27.15 at TESCO on your card ending 1234\nExpired'],
  ['IE', 'EUR', 'AIB', 'You received EUR 250.00 from JOHN MURPHY - Not yet posted'],
  // Case drift: issuer codes, Soll/Haben, own-account abbreviations, thresholds, Nordic language.
  ['NL', 'EUR', 'ING', 'Incasso 450,00 Eur Ics'],
  ['NL', 'EUR', 'ING', 'Incasso 450,00 EUR ICS\t*8373'],
  ['US', 'USD', 'Chase', 'YOU PAID BARCLAYS US $250.00'],
  ['US', 'USD', 'Chase', 'you paid discover card $250.00'],
  ['US', 'USD', 'BofA', 'YOUR $250.00 PAYMENT TO APPLE CARD WAS SENT. - Sparkasse'],
  ['DE', 'EUR', 'Sparkasse', 'Kartenzahlung-BETRAG: 27,15 EUR HABEN\nHÄNDLER: REWE'],
  ['DE', 'EUR', 'Sparkasse', 'gutschrift\nbetrag: 27,15 eur s'],
  ['US', 'USD', 'Chase', 'Deposit  of  -  $500.00  posted  to  your  account  ending  1234'],
  ['GB', 'GBP', 'Monzo', '£250.00 sent to isa'],
  ['FR', 'EUR', 'BoursoBank', 'Virement Émis : 500,00 € À Ldds'],
  ['FR', 'EUR', 'BoursoBank', 'Virement émis : 1 500,00 € à M/DUPONT JEAN LIVRET A'],
  ['FR', 'EUR', 'BoursoBank', 'Virement émis : 1 500,00 € à M. #DUPONTJEANLIVRETA'],
  ['FR', 'EUR', 'BoursoBank', 'PAIEMENT PAR CARTE SUPÉRIEUR À 100,00 € CHEZ CARREFOUR'],
  ['IT', 'EUR', 'Intesa', 'Pagamento Di Oltre 100,00 Eur Presso Esselunga'],
  ['SE', 'SEK', 'Swedbank', 'KÖP ÖVER 1 000,00 KR HOS ICA'],
  ['DK', 'DKK', 'Danske', 'DU HAR FÅTT 450,00 KR FRÅN ANNA SVENSSON'],
  // Disguised and look-alike links.
  ['DE', 'EUR', '+4915112345678', 'Kartenzahlung 27,15 EUR bei REWE [INFO: SPARKASSE.INFO]'],
  ['DE', 'EUR', 'Sparkasse', 'Kartenzahlung 27,15 EUR bei REWE [INFO: HXXPS://SPK.DE/X]'],
  ['DE', 'EUR', 'Sparkasse', 'Kartenzahlung 27,15 EUR bei REWE *1234DETAILS:SPARKASSE[.]DE/X'],
  ['DE', 'EUR', 'Sparkasse', 'Kartenzahlung 27,15 EUR bei REWE-INFO: SPÄRKASSE.DE/X'],
  ['DE', 'EUR', 'Sparkasse', 'Kartenzahlung 27,15 EUR bei REWE *1234ERSTATTUNG'],
  // Lab round 5 holdout shapes.
  ['SE', 'SEK', 'SEB', 'Du har betalat 500,00 kr till dtit SEB kreditkort.'],
  ['SE', 'SEK', 'Swedbank', 'Swedbank: Du har handlet for 8 732,95 kr hos COOP KONSUM. Saldo 91 017,23 SEK'],
  ['CZ', 'CZK', 'George', 'ZAPLATILI JSTE 73 150,94 KČ U AMERICAN EXPRESS.'],
  ['CZ', 'CZK', 'George', 'Zaplatili Jste 73 150,94 Kč U American Express.'],
  ['CZ', 'CZK', 'AirBank', 'Platba Kartou: 1 649,18 Kč U Air Bank Kreditni Karta · 11.10.2026 18:15'],
  ['NO', 'NOK', 'DNB', 'SPAREKONTO HAR TRUKKET 2 040,00 KR VIA EFAKTURA 2026-09-29. SALDO 36 696,75 KR'],
  ['IT', 'EUR', 'Poste', 'Poste: Hai Ricevuto Una Nuova Bolletta Storno Bar Di 52,33 €, Scadenza 08/11.'],
  ['PT', 'EUR', 'CGD', 'Saldo 11.656,80 €\nEXEMPLO LDA enviou 1.560,22 € por MB WAY para si.'],
  ['US', 'USD', 'RBC', 'RBC Royal Bank: You made a purchase of $45.00 at TIM HORTONS. - Sparkasse'],
]) test(`round 5 (iteration): never books (${country}): ${body.replace(/\n/g, ' / ').slice(0, 56)}`, () => {
  for (const s of [sender, '']) {
    const parsed = seam(body, s, country, currency);
    assert.ok(parsed === null || parsed.cardPaymentSide, `${s}: ${parsed && `${parsed.type} ${parsed.amountFils}`}`);
  }
});
// Paired positives: the same shapes, completed, still book.
for (const [country, currency, sender, body, minor] of [
  ['DE', 'EUR', 'Sparkasse', 'Kartenzahlung 27,15 EUR bei REWE', 2715],
  ['DE', 'EUR', 'Sparkasse', 'Sie haben 27,15 € bei REWE bezahlt', 2715],
  ['DE', 'EUR', 'Sparkasse', 'Kartenzahlung 27,15 EUR bei REWE mit VISA *1234', 2715],
  ['DE', 'EUR', 'Sparkasse', 'Kartenzahlung 27,15 EUR bei WWW.AMAZON.DE', 2715],
  ['US', 'USD', 'Chase', 'You spent $45.00 at CITI TRENDS', 4500],
  ['GB', 'GBP', 'Monzo', 'you spent £45.00 at tesco', 4500],
  ['GB', 'GBP', 'Monzo', 'You spent £45.00 at Tesco with your Visa card', 4500],
  ['GB', 'GBP', 'Monzo', 'You spent £45.00 at AMAZON.CO.UK', 4500],
  ['FR', 'EUR', 'BoursoBank', 'Virement émis : 1 500,00 € à M. DUPONT JEAN', 150000],
  ['DK', 'DKK', 'Danske', 'Danske Bank: Refusion | Forretning: FOETEX | Bogført: 25.09.2026 | Beløb: +1.211,41 DKK\nDisponibel sadlo: 33.652,55 DKK.', 121141],
  ['SE', 'SEK', 'Swedbank', 'Du har fått 450,00 kr från ANNA SVENSSON', 45000],
  ['CZ', 'CZK', 'George', 'ZAPLATILI JSTE 1 250,00 KČ U ALBERT.', 125000],
  ['CZ', 'CZK', 'George', 'Platba Kartou: 1 649,18 Kč U Albert · 11.10.2026 18:15', 164918],
  ['PT', 'EUR', 'CGD', 'MB WAY: enviou 20,00 EUR para ANA SILVA.', 2000],
  ['SE', 'SEK', 'Swedbank', 'KÖP 450,00 KR HOS ICA', 45000],
]) test(`round 5 (iteration): the completed twin still books: ${body.replace(/\n/g, ' / ').slice(0, 56)}`, () => {
  const parsed = seam(body, sender, country, currency);
  assert.ok(parsed, 'books');
  assert.equal(parsed.amountFils, minor);
});

// Round 5, independent review: payment requests, card bills to store and bank
// cards, unclaimed P2P money, Czech and English statuses the lexicon lacked,
// stopped or disputed payments in capitals, label values, capital and
// disguised links, every minus dash, "&gt;=", own accounts elsewhere, another
// krone's code, money paid INTO the account or BY someone else.
for (const [country, currency, sender, body] of [
  ['NL', 'EUR', 'ING', 'JAN heeft je een Tikkie van 25,00 EUR gestuurd.'],
  ['NL', 'EUR', 'ING', 'Je hebt een Tikkie van 25,00 EUR ontvangen van JAN.'],
  ['ES', 'EUR', 'BBVA', 'Has recibido una petición de Bizum de 25,00 EUR de ANA.'],
  ['US', 'USD', 'Chase', 'You paid $250.00 to Credit One Bank'],
  ['US', 'USD', 'Chase', 'You paid $250.00 to BOFA CRD PMT'],
  ['US', 'USD', 'Chase', 'You paid $250.00 to Amazon Store Card'],
  ['US', 'USD', 'Chase', 'You paid $250.00 to US Bank Card'],
  ['US', 'USD', 'Chase', 'You sent $25.00 to Sarah Lee with Zelle. Sarah has 14 days to enroll.'],
  ['US', 'USD', 'Chase', 'You sent $25.00 to Sarah Lee. The money will be sent when Sarah enrolls.'],
  ['DK', 'DKK', 'Danske', 'ANNA har sendt dig 250,00 kr. via MobilePay. Tilmeld dig for at få pengene.'],
  ['NO', 'NOK', 'DNB', 'ANNA har sendt deg 250,00 kr med Vipps. Registrer deg for å få pengene.'],
  ['GB', 'GBP', 'Monzo', 'Anna sent you £25.00. Sign up to Monzo to get it.'],
  ['CZ', 'CZK', 'George', 'Platba kartou 459,00 Kč u ALBERT. Platba se nepodařila.'],
  ['CZ', 'CZK', 'George', 'Platba kartou 459,00 Kč u ALBERT. Platba nezaúčtována.'],
  ['CZ', 'CZK', 'George', 'Platba kartou 459,00 Kč u ALBERT. Platba pozdržena.'],
  ['US', 'USD', 'Chase', 'Purchase of $45.00 at TARGET with card ending 1234. Unpaid.'],
  ['US', 'USD', 'Chase', 'Your card purchase of $45.00 at TARGET could not complete.'],
  ['US', 'USD', 'Chase', 'Purchase of $45.00 at TARGET with card ending 1234. Hold.'],
  ['SE', 'SEK', 'Swedbank', 'KÖP 450,00 KR HOS ICA STOPPAT'],
  ['DE', 'EUR', 'Sparkasse', 'KARTENZAHLUNG 27,15 EUR BEI REWE. GESTOPPT'],
  ['FR', 'EUR', 'BoursoBank', 'Paiement par carte : 27,15 € chez CARREFOUR. EN LITIGE'],
  ['DK', 'DKK', 'Danske', 'Køb 450,00 kr. hos NETTO. FEJL'],
  ['DE', 'EUR', 'Sparkasse', 'Kartenzahlung 27,15 EUR bei REWE. Status in Klärung.'],
  ['IT', 'EUR', 'Intesa', 'Pagamento di 45,00 EUR presso ESSELUNGA. Esito: KO'],
  ['US', 'USD', '+15551234567', 'You spent $45.00 at TARGET. Details at HTTPS://BIT.LY/3XYZAB'],
  ['US', 'USD', 'Chase', 'You spent $45.00 at TARGET. Details: secure_chase.com/x'],
  ['US', 'USD', '+15551234567', 'You spent $45.00 at TARGET. Details: chase-alerts。com/x'],
  ['US', 'USD', 'Chase', 'Deposit of ‑$500.00 posted to your account ending 1234'],
  ['US', 'USD', 'Chase', 'Deposit of －$500.00 posted to your account ending 1234'],
  ['DE', 'EUR', 'Sparkasse', 'Kartenzahlung bei REWE 27,15 EUR, H'],
  ['DE', 'EUR', 'Sparkasse', 'Kartenzahlung bei REWE 27,15 EUR [H]'],
  ['US', 'USD', 'Chase', 'Purchase &gt;= $100.00 at TARGET with card ending 1234.'],
  ['GB', 'GBP', 'Monzo', '£500.00 sent to your Chase UK account'],
  ['SE', 'SEK', 'Swedbank', 'Kortköp 450,00 kr hos NETTO. Valuta DKK'],
  ['NL', 'EUR', 'ING', 'Je Tikkie van 25,00 EUR is betaald door JAN.'],
  ['GB', 'GBP', 'Monzo', 'Your salary of £2,000.00 has been paid to your account'],
  ['PT', 'EUR', 'CGD', 'Saldo EUR 4.615,11\nANA SILVA ENVIOU EUR 20,00 POR MB WAY PARA SI.'],
]) test(`round 5 (review): never books (${country}): ${body.replace(/\n/g, ' / ').slice(0, 56)}`, () => {
  for (const s of [sender, '']) {
    const parsed = seam(body, s, country, currency);
    assert.ok(parsed === null || parsed.cardPaymentSide, `${s}: ${parsed && `${parsed.type} ${parsed.amountFils}`}`);
  }
});
// Paired positives: refunds, merchants that only look like a status, label
// values that say done, card words that name the card paid with.
for (const [country, currency, sender, body, minor] of [
  ['FR', 'EUR', 'Boursorama', '💸 Sncf Internet vous a remboursé 191,93€\nSolde disponible: 13539,94€.', 19193],
  ['IT', 'EUR', 'UniCredit', 'UniCredit\nCONAD ti ha rimborsato 198,69 EUR.', 19869],
  ['SE', 'SEK', 'Swedbank', 'PRESSBYRAN har återbetalat 1 550,43 kr till dig 3 okt.', 155043],
  ['DE', 'EUR', 'Commerzbank', 'Commerzbank: EDEKA CENTER hat Ihnen 105,96 EUR erstattet.', 10596],
  ['PT', 'EUR', 'CGD', 'Devolução de 203,76 € de CONTINENTE creditada no seu cartão terminado em 5425.', 20376],
  ['PL', 'PLN', 'mBank', "mBank: Zwrot 229,67 zł od MCDONALD'S 0412 zaksięgowany na koncie.", 22967],
  ['ES', 'EUR', 'Santander', 'GLOVO te ha devuelto 84,49 €.', 8449],
  ['US', 'USD', 'Chase', 'You spent $5.00 at MENCHIES FROZEN YOGURT', 500],
  ['US', 'USD', 'Chase', 'You spent $5.00 at ERROR 404 ARCADE', 500],
  ['GB', 'GBP', 'Monzo', 'You spent £5.00 at STORNOWAY CO-OP', 500],
  ['PL', 'PLN', 'Revolut', 'You sent 65,23 PLN to P4 Sp. z o. o.. It will arrive tomorrow', 6523],
  ['FR', 'EUR', 'BoursoBank', 'Paiement par carte : 27,15 € chez CARREFOUR. Statut : Payé', 2715],
  ['US', 'USD', 'Chase', 'Purchase of $45.00 at TARGET using a credit card ending 1234', 4500],
  ['GB', 'GBP', 'Monzo', 'You paid £45.00 by card at TESCO', 4500],
  ['US', 'USD', 'Chase', 'You spent $45.00 at TARGET. Visit chase.com/alerts to manage alerts.', 4500],
]) test(`round 5 (review): the completed twin still books: ${body.replace(/\n/g, ' / ').slice(0, 56)}`, () => {
  const parsed = seam(body, sender, country, currency);
  assert.ok(parsed, 'books');
  assert.equal(parsed.amountFils, minor);
});

// Round 5, second review pass.
for (const [country, currency, sender, body] of [
  ['GB', 'GBP', 'Monzo', 'Anna sent you £500.00. It will arrive tomorrow.'],
  ['US', 'USD', 'Chase', 'JOHN SMITH sent you $500.00. Arrives tomorrow.'],
  ['US', 'USD', 'Chase', 'Sarah Lee sent you $25.00. Enroll with Zelle to receive.'],
  ['FR', 'EUR', 'BoursoBank', 'ANNA vous a envoyé 25,00 €. Créez un compte pour les récupérer.'],
  ['PL', 'PLN', 'mBank', 'ANNA przesłała Ci 25,00 PLN. Załóż konto, by je odebrać.'],
  ['GB', 'GBP', 'Monzo', 'Anna sent you £25.00. Join Monzo to collect.'],
  ['US', 'USD', 'Chase', 'You paid $250.00 to Target RedCard'],
  ['US', 'USD', 'Chase', 'You paid $250.00 to MISSION LANE'],
  ['US', 'USD', 'Chase', 'You paid $250.00 to TD BANK CC PMT'],
  ['GB', 'GBP', 'Monzo', 'You paid £250.00 to Vanquis'],
  ['SE', 'SEK', 'Swedbank', 'Du har betalat 2.500,00 kr till Resurs Bank'],
  ['US', 'USD', 'Chase', 'You spent $45.00 at TARGET. ERROR'],
  ['US', 'USD', 'Chase', 'PURCHASE OF $45.00 AT TARGET WITH CARD ENDING 1234. TRANSACTION ERROR'],
  ['US', 'USD', 'Chase', 'You spent $45.00 at TARGET.\nNICHT GEBUCHT'],
  ['US', 'USD', 'Chase', 'YOU MADE A $45.00 TRANSACTION WITH YOUR CARD ENDING 1234 AT TARGET\nPROVISIONAL'],
  ['IT', 'EUR', 'Intesa', 'Pagamento carta di 18,45 EUR presso ESSELUNGA. KO'],
  ['CZ', 'CZK', 'George', 'Platba kartou 459,00 Kč u ALBERT. Platba se nepovedla.'],
  ['DE', 'EUR', 'Sparkasse', 'Kartenzahlung 27,15 EUR bei REWE. Störung.'],
  ['GB', 'GBP', 'Monzo', 'You spent £27.15 at TESCO hold'],
  ['GB', 'GBP', 'Monzo', 'You spent £27.15 at TESCO not honored'],
  ['ES', 'EUR', 'BBVA', 'Has recibido una transferencia de 450,00 EUR de JUAN PEREZ (devolución)'],
  ['PL', 'PLN', 'mBank', 'Otrzymałeś przelew 450,00 PLN od JAN KOWALSKI | zwrot'],
  ['US', 'USD', 'Chase', 'Your card ending 1234 was charged $899.00 at APPLE STORE. Cancel:_chase-help.net?id=88'],
]) test(`round 5 (review 2): never books (${country}): ${body.replace(/\n/g, ' / ').slice(0, 56)}`, () => {
  for (const s of [sender, '']) {
    const parsed = seam(body, s, country, currency);
    assert.ok(parsed === null || parsed.cardPaymentSide, `${s}: ${parsed && `${parsed.type} ${parsed.amountFils}`}`);
  }
});
for (const [country, currency, sender, body, minor] of [
  ['US', 'USD', 'Chase', 'A charge of $45.00 at TARGET was charged to your credit card ending 1234.', 4500],
  ['US', 'USD', 'CapitalOne', 'A purchase of $45.00 at TARGET was made to your credit card.', 4500],
  ['US', 'USD', 'Chase', 'You paid $45.00 to JOHN SMITH with your card', 4500],
  ['DK', 'DKK', 'Danske', 'Køb 450,00 kr. hos NETTO', 45000],
]) test(`round 5 (review 2): the completed twin still books: ${body.slice(0, 56)}`, () => {
  const parsed = seam(body, sender, country, currency);
  assert.ok(parsed, 'books');
  assert.equal(parsed.amountFils, minor);
});

// Round 5, third review pass.
for (const [country, currency, sender, body] of [
  ['US', 'USD', 'Chase', 'You paid $250.00 to Ollo Card'],
  ['US', 'USD', 'Chase', 'You paid $250.00 to Kohls Charge'],
  ['GB', 'GBP', 'Monzo', 'You paid £250.00 to Tesco Bank'],
  ['DE', 'EUR', 'Sparkasse', '250,00 EUR wurden auf Ihre Kreditkarte überwiesen.'],
  ['DE', 'EUR', 'N26', 'Du hast 250,00 € an Santander Kreditkarte überwiesen'],
  ['US', 'USD', 'Chase', '$250.00 was charged to your checking account for your Citi card payment.'],
  ['US', 'USD', 'Chase', 'JOHN SMITH sent you $500.00. Funds available on Monday.'],
  ['US', 'USD', 'Chase', 'JOHN SMITH sent you $500.00. Expect it within 1-3 days.'],
  ['US', 'USD', 'Chase', 'JOHN SMITH sent you $500.00. Delivery by Friday.'],
  ['GB', 'GBP', 'Monzo', 'Anna sent you £500.00. It will arrive in a few hours.'],
  ['US', 'USD', 'Popular', 'Purchase of $45.00 at WALMART DENEGADA'],
  ['US', 'USD', 'Chase', 'You spent $45.00 at TARGET STORNO'],
  ['IT', 'EUR', 'Intesa', 'Pagamento carta di 18,45 EUR presso ESSELUNGA KO'],
  ['DE', 'EUR', 'Sparkasse', 'KARTENZAHLUNG 27,15 EUR BEI REWE. UNTER VORBEHALT'],
  ['FR', 'EUR', 'BNP', 'PAIEMENT PAR CARTE : 27,15 € CHEZ CARREFOUR. RETENUE'],
  ['PL', 'PLN', 'mBank', 'TRANSAKCJA KARTĄ NA KWOTĘ 45,00 PLN W BIEDRONKA. NIEPRZYJĘTA'],
]) test(`round 5 (review 3): never books (${country}): ${body.slice(0, 56)}`, () => {
  for (const s of [sender, '']) {
    const parsed = seam(body, s, country, currency);
    assert.ok(parsed === null || parsed.cardPaymentSide, `${s}: ${parsed && `${parsed.type} ${parsed.amountFils}`}`);
  }
});
for (const [country, currency, sender, body, minor] of [
  ['US', 'USD', 'Chase', 'You sent $500.00 to JOHN SMITH at Bank of America', 50000],
  ['GB', 'GBP', 'Monzo', 'You sent £50.00 to Anna Smith at Barclays Bank', 5000],
  ['US', 'USD', 'Chase', 'You spent $5.00 at ERROR 404 ARCADE', 500],
  ['US', 'USD', 'Chase', 'You spent $5.00 at KO SUSHI', 500],
  ['DE', 'EUR', 'Sparkasse', 'KARTENZAHLUNG 27,15 EUR BEI REWE. IHRE SPARKASSE', 2715],
  ['SE', 'SEK', 'Swedbank', 'KÖP 450,00 KR HOS ICA. TACK', 45000],
]) test(`round 5 (review 3): the completed twin still books: ${body.slice(0, 56)}`, () => {
  const parsed = seam(body, sender, country, currency);
  assert.ok(parsed, 'books');
  assert.equal(parsed.amountFils, minor);
});

// Status residue (alert-status-lexicon.ts transactionStatusWords): a status
// word withdraws a posting only when it describes THIS movement. Inside a
// capitalised name ("at DECLINED CAFE"), in a conditional clause ("If your
// payment was declined, …", "Wenn Ihre Kartenzahlung abgelehnt wird, …",
// "إذا تم رفض …") or in a longer sentence about something else ("Your balance
// has not been updated yet", "Learn more about scheduled transfers") it does
// not. Each positive has paired controls with the same words that DO describe
// the movement.
for (const body of [
  'Card purchase USD 12.50 at DECLINED CAFE on 2026-09-05.',
  'Refund received USD 12.50 from PAYMENT REQUEST APPROVED SHOP.',
  'Chase Bank alert: Your card ending 4421 was charged USD 24.86 at NORTH STAR MARKET. A fee of USD 5.00 has not been charged.',
  'Card purchase USD 12.50 at LOCAL CAFE on 2026-09-05. If your payment was declined, contact support.',
  'Card purchase USD 12.50 at LOCAL CAFE on 2026-09-05. Should a payment fail, call us.',
  'Card purchase USD 12.50 at LOCAL CAFE on 2026-09-05. Wenn Ihre Kartenzahlung abgelehnt wird, kontaktieren Sie uns.',
  'Card purchase USD 12.50 at LOCAL CAFE on 2026-09-05. Your planned deposit has not been credited yet.',
  'Card purchase USD 12.50 at LOCAL CAFE on 2026-09-05. Learn more about scheduled transfers and recurring payments in our app.',
  'Paiement effectué EUR 12,50 chez PAYMENT REQUEST ACCEPTED CAFE.',
  'Card purchase posted: AED 84.60 at Cedar Lantern Books. إذا تم رفض السحب النقدي اتصل بالمصرف.',
]) test(`status residue: a status outside this movement leaves it posted: ${body.slice(0, 60)}`, () => {
  assert.equal(inspectUniversalBankEvent(body, {}).status, 'posted');
});
for (const body of [
  // The status ends the name run, follows it on its own line, or opens a sentence of its own.
  'Card purchase USD 12.50 at LOCAL CAFE DECLINED',
  'Card purchase USD 12.50 at LOCAL CAFE DECLINED BY ISSUER',
  'Card purchase USD 12.50 at LOCAL CAFE DECLINED on 2026-09-05.',
  'Card purchase USD 12.50 at LOCAL CAFE INSUFFICIENT FUNDS',
  'You spent $45.00 at TARGET\nDECLINED',
  'Card purchase USD 12.50 at DECLINED CAFE on 2026-09-05. Payment declined.',
  'Card purchase USD 12.50 at DECLINED CAFE on 2026-09-05.\nDECLINED',
  'You sent $25.00 to Sarah Lee. The money will be sent when Sarah enrolls.',
  'Card purchase USD 12.50 at LOCAL CAFE on 2026-09-05. This purchase has not been completed yet.',
  'Card purchase USD 12.50 at LOCAL CAFE. Insufficient funds.',
  // A conditional only up to its comma: what follows is the movement's status.
  'Card purchase USD 12.50 at LOCAL CAFE. If you made this purchase, it was declined.',
  'Paiement effectué EUR 12,50 chez LOCAL CAFE. Si vous avez des questions, votre paiement a été refusé.',
  // A sentence that names this movement, or no other money object.
  'Card purchase USD 12.50 at LOCAL CAFE. The merchant has not yet completed this transaction.',
  'Card purchase USD 12.50 at LOCAL CAFE on 2026-09-05. Your payment is scheduled.',
  'Card purchase USD 12.50 at LOCAL CAFE on 2026-09-05. Not yet posted.',
  'Card purchase USD 12.50 at LOCAL CAFE on 2026-09-05. Try again later.',
  // A conditional clause that carries the money may be the movement itself.
  'If your payment of USD 12.50 at LOCAL CAFE was declined, contact support.',
  'Card purchase USD 12.50 at LOCAL CAFE. TRANSACTION DECLINED CALL 8001234567',
  'Card purchase USD 12.50 at LOCAL CAFE DECLINED CALL 8001234567',
  'Deposit of USD 500.00 posted to your account. Your recent deposit was returned.',
  // An all-capitals message has no name run to tell apart.
  'CARD PURCHASE USD 12.50 AT LOCAL CAFE DECLINED CARD',
  // Spanish "Se ha …" is no Italian or Portuguese "se" (if).
  'Se ha rechazado tu pago de 12,50 EUR en ZARA.',
  'Card purchase posted: AED 84.60 at Cedar Lantern Books. تم رفض العملية',
  'Kartenzahlung 27,15 EUR bei REWE ABGELEHNT',
  'Kartenzahlung 27,15 EUR bei ABGELEHNT REWE',
]) test(`status residue: a status of this movement still withdraws it: ${body.slice(0, 60)}`, () => {
  assert.notEqual(inspectUniversalBankEvent(body, {}).status, 'posted');
});

// Residue, words that only look like statuses: a product ("… towards Ooredoo
// TOPUP"), an e-mail host ("pay.me@example.com"), a German refund credit's own
// label ("Gutschrift … Rückerstattung"), a merchant LINE under the amount, and
// a "Bank Card" with its mask (the card paid with). Each has a paired control.
for (const [body, context] of [
  ['Your a/c no XX0014 has been debited for an amount of OMR 3.500 as payment towards Ooredoo TOPUP', {}],
  ['You have sent $80.00 to MIA ROSS (PayID mia.r@example.com) via Osko on 18/09/2026.', { country: 'AU' }],
  ['Neue Buchung auf deinem Girokonto: Gutschrift +14,50 € BUCHLADEN NORD GMBH Rückerstattung Bestellnr. 55-1234', {}],
  ['Platba kartou 212,00 Kč\nKNIHKUPECTVÍ U MOSTU BRNO\nkarta *4321, 03.10.2026', {}],
]) test(`status residue: a look-alike word leaves the movement posted: ${body.slice(0, 60)}`, () => {
  assert.equal(inspectUniversalBankEvent(body, context).status, 'posted');
});
test('status residue: a masked "Bank Card" after "From" is the card paid with, not a card bill', () => {
  const event = inspectUniversalBankEvent('Spent Rs.450 From ACME Bank Card x4321 At CITY BOOKS On 2026-09-08', { country: 'IN' });
  assert.equal(event.family, 'purchase');
  assert.equal(inspectUniversalBankEvent('You paid Rs.450 to ACME Bank Card', { country: 'IN' }).family, 'card-payment');
});
for (const [body, context] of [
  ['You spent €27.15 at REWE. Top up to complete the payment.', {}],
  ['Card purchase USD 12.50 at LOCAL CAFE. Please top up your account.', {}],
  ['Card purchase USD 12.50 at LOCAL CAFE. Example: this is how an alert looks.', {}],
  ['Kartenzahlung 14,50 EUR bei BUCHLADEN NORD. Rückerstattung', {}],
  ['Platba kartou 212,00 Kč u KNIHKUPECTVÍ. ZAMÍTNUTO', {}],
]) test(`status residue: the paired control still withdraws it: ${body.slice(0, 60)}`, () => {
  assert.notEqual(inspectUniversalBankEvent(body, context).status, 'posted');
});
