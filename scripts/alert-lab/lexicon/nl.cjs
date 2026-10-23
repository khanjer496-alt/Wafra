'use strict';
// Dutch phrasings (NL/BE). See en.cjs for slots.
module.exports = {
  id: 'nl',
  months: ['jan', 'feb', 'mrt', 'apr', 'mei', 'jun', 'jul', 'aug', 'sep', 'okt', 'nov', 'dec'],
  at24: 'om',
  sentence: {
    purchase: [
      'Betaling van {AMT} bij {MER}[ met je {INS}][ op {DATE}].',
      'Je hebt {AMT} betaald bij {MER}[ op {DATE}].',
      'Er is {AMT} afgeschreven voor een betaling bij {MER}[ met uw {INS}][ op {DATE}].',
      'Pinbetaling {AMT} bij {MER}[ op {DATE}][ ({INS})].',
    ],
    cnp: [
      'Online betaling van {AMT} bij {MER}[ met je {INS}][ op {DATE}].',
      'Je hebt online {AMT} betaald aan {MER}[ op {DATE}].',
      'Uw {INS} is gebruikt voor een internetaankoop van {AMT} bij {MER}[ op {DATE}].',
    ],
    atm: [
      'Geldopname van {AMT}[ bij {MER}][ met je {INS}][ op {DATE}].',
      'Je hebt {AMT} opgenomen bij een geldautomaat[ op {DATE}].',
      'Er is {AMT} contant opgenomen met uw {INS}[ op {DATE}].',
    ],
    refund: [
      'Terugbetaling van {AMT} van {MER} bijgeschreven[ op je {INS}][ op {DATE}].',
      '{MER} heeft {AMT} teruggestort[ op {DATE}].',
      'Je hebt {AMT} terugbetaald gekregen van {MER}[ op {DATE}].',
    ],
    fee: [
      'Er zijn kosten van {AMT} afgeschreven van uw {INS}[ op {DATE}].',
      'Maandelijkse kosten betaalpakket: {AMT}[ op {DATE}].',
      'Je betaalt {AMT} aan transactiekosten[ op {DATE}].',
    ],
    incoming: [
      'Je hebt {AMT} ontvangen van {CP}[ op {DATE}].',
      'Bijschrijving van {AMT} van {CP} op uw {INS}[ op {DATE}].',
      '{CP} heeft je {AMT} gestuurd[ op {DATE}].',
    ],
    outgoing: [
      'Je hebt {AMT} overgemaakt naar {CP}[ op {DATE}].',
      'Uw overboeking van {AMT} naar {CP} is uitgevoerd[ op {DATE}].',
      'Er is {AMT} overgeschreven van uw {INS} naar {CP}[ op {DATE}].',
    ],
    bill: [
      'Incasso van {AMT} door {MER} afgeschreven van uw {INS}[ op {DATE}].',
      '{MER} heeft {AMT} geïncasseerd[ op {DATE}].',
      'Je rekening van {MER} van {AMT} is betaald[ op {DATE}].',
    ],
  },
  headline: {
    purchase: ['Betaling: {AMT} bij {MER}[ · {DATE}]', 'Pinbetaling {AMT} - {MER}[ - {INS}]'],
    cnp: ['Online betaling: {AMT} bij {MER}[ · {DATE}]'],
    atm: ['Geldopname: {AMT}[ · {MER}][ · {DATE}]'],
    refund: ['Terugbetaling: {AMT} van {MER}[ · {DATE}]'],
    fee: ['Kosten: {AMT}[ · {DATE}]'],
    incoming: ['Ontvangen: {AMT} van {CP}[ · {DATE}]', 'Bijschrijving {AMT} - {CP}'],
    outgoing: ['Overgemaakt: {AMT} naar {CP}[ · {DATE}]'],
    bill: ['Incasso: {AMT} - {MER}[ · {DATE}]'],
  },
  push: {
    purchase: ['{EMO} Je betaalde {AMT} bij {MER}', '{EMO} {AMT} bij {MER}'],
    cnp: ['{EMO} Online {AMT} betaald aan {MER}'],
    atm: ['{EMO} Je hebt {AMT} opgenomen'],
    refund: ['{EMO} {MER} heeft {AMT} teruggestort'],
    fee: ['{EMO} {AMT} kosten afgeschreven'],
    incoming: ['{EMO} {CP} stuurde je {AMT}', '{EMO} Je hebt {AMT} ontvangen van {CP}'],
    outgoing: ['{EMO} Je hebt {AMT} gestuurd naar {CP}'],
    bill: ['{EMO} Incasso {MER} {AMT} betaald'],
  },
  fields: {
    title: {
      purchase: ['Betaalpas transactie', 'Betaling'], cnp: ['Online betaling'], atm: ['Geldopname'], refund: ['Terugbetaling'],
      fee: ['Kosten'], incoming: ['Bijschrijving', 'Geld ontvangen'], outgoing: ['Overboeking'], bill: ['Incasso'],
    },
    amount: ['Bedrag'], merchant: ['Bij', 'Winkel'], place: ['Locatie'], payer: ['Van', 'Afzender'], payee: ['Naar', 'Begunstigde'], card: ['Pas', 'Rekening'], date: ['Datum'],
  },
  ins: {
    card: ['pas ***{L4}', 'betaalpas eindigend op {L4}', 'creditcard xxxx{L4}'],
    account: ['rekening ***{L4}', 'betaalrekening eindigend op {L4}', 'rekening NL..{L4}'],
  },
  trailer: {
    balance: ['Beschikbaar saldo: {BAL}.', 'Nieuw saldo {BAL}'],
    limit: ['Beschikbare limiet: {BAL}'],
    fraud: ['Niet herkend? Bel {PHONE}.'],
    threshold: ['Je ontvangt dit bericht omdat het bedrag hoger is dan {THR}.'],
    optout: ['Afmelden? Stuur STOP.'],
    link: ['Bekijk details: https://{DOMAIN}/meldingen'],
  },
  neg: {
    declined: ['c|Je betaling van {AMT} bij {MER} is geweigerd.', 'x|Je overboeking van {AMT} naar {CP} is mislukt.'],
    pending: ['c|Er is {AMT} gereserveerd voor {MER} op je {INS}.', 'c|Je betaling van {AMT} bij {MER} is nog in behandeling.'],
    future: ['x|Op {DUE} wordt {AMT} geïncasseerd door {MER}.', 'x|Je geplande overboeking van {AMT} naar {CP} wordt uitgevoerd op {DUE}.'],
    conditional: ["c|Als je meer dan {AMT} betaalt bij {MER}, sturen we je een melding.", "c|Mocht {MER} {AMT} afschrijven zonder toestemming, dan kun je dit binnen 8 weken terugboeken."],
    question: ['c|Heb je {AMT} betaald bij {MER}? Antwoord JA of NEE.', 'x|Wil je {AMT} overmaken naar {CP}? Bevestig in de app.'],
    negation: ['x|De incasso van {AMT} door {MER} is niet betaald.', 'c|{AMT} is niet afgeschreven; de betaling bij {MER} is geannuleerd.'],
    otp: ['c|Je verificatiecode voor de betaling van {AMT} bij {MER} is {OTP}. Deel deze nooit.', 'x|Code {OTP} om {AMT} over te maken naar {CP}.'],
    promo: ['c|Krijg 5% cashback bij aankopen vanaf {AMT} bij {MER}!', 'a|Leen tot {AMT} tegen een lage rente. Vraag nu aan.'],
    request: ['x|{CP} vraagt je om {AMT} te betalen via een Tikkie.', 'x|Betaalverzoek van {CP}: {AMT}.'],
    statement: ['a|Je creditcardoverzicht staat klaar: saldo {AMT}, minimaal te betalen {MIN} vóór {DUE}.'],
    balance: ['a|Het saldo van uw {INS} is {AMT}.', 'a|Je huidige saldo is {AMT}.'],
    chat: ['a|Ik heb {AMT} betaald bij {MER} voor het eten, stuur je jouw deel?', 'a|Kun je me {AMT} sturen voor de huur?'],
    scam: ['c|Er is {AMT} afgeschreven bij {MER} met je {INS}. Niet jij? Controleer via {URL}', 'a|Je pas verloopt. Vraag een nieuwe aan en betaal {AMT} via {URL}'],
  },
};
