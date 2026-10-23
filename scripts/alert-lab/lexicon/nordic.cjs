'use strict';
// Swedish (sv), Danish (da) and Norwegian Bokmål (nb) phrasings. See en.cjs
// for slots. Each language is its own pack; they only share this file.
const sv = {
  id: 'sv',
  months: ['jan', 'feb', 'mars', 'apr', 'maj', 'juni', 'juli', 'aug', 'sep', 'okt', 'nov', 'dec'],
  sentence: {
    purchase: ['Köp {AMT} hos {MER}[ med ditt {INS}][ {DATE}].', 'Du har betalat {AMT} hos {MER}[ {DATE}].', 'Kortköp på {AMT} hos {MER} har dragits från ditt {INS}[ {DATE}].'],
    cnp: ['Internetköp {AMT} hos {MER}[ med ditt {INS}][ {DATE}].', 'Du har handlat online för {AMT} hos {MER}[ {DATE}].', 'Ditt {INS} har använts för ett onlineköp på {AMT} hos {MER}[ {DATE}].'],
    atm: ['Uttag {AMT} i bankomat[ {MER}][ med ditt {INS}][ {DATE}].', 'Du har tagit ut {AMT} i kontanter[ {DATE}].', 'Kontantuttag på {AMT} har gjorts med ditt {INS}[ {DATE}].'],
    refund: ['Återbetalning {AMT} från {MER} har satts in[ på ditt {INS}][ {DATE}].', '{MER} har återbetalat {AMT} till dig[ {DATE}].', 'Du har fått en retur på {AMT} från {MER}[ {DATE}].'],
    fee: ['Månadsavgift {AMT} har dragits från ditt {INS}[ {DATE}].', 'En avgift på {AMT} har debiterats[ {DATE}].', 'Vi har tagit ut en avgift på {AMT}[ {DATE}].'],
    incoming: ['Du har fått {AMT} från {CP}[ {DATE}].', 'Insättning {AMT} från {CP} på ditt {INS}[ {DATE}].', '{CP} har swishat {AMT} till dig[ {DATE}].'],
    outgoing: ['Du har skickat {AMT} till {CP}[ {DATE}].', 'Din överföring på {AMT} till {CP} är genomförd[ {DATE}].', 'Swish-betalning {AMT} till {CP} genomförd[ {DATE}].'],
    bill: ['Autogiro {AMT} till {MER} har dragits från ditt {INS}[ {DATE}].', 'Din räkning till {MER} på {AMT} är betald[ {DATE}].', '{MER} har dragit {AMT} via autogiro[ {DATE}].'],
  },
  headline: {
    purchase: ['Kortköp: {AMT} hos {MER}[ · {DATE}]'], cnp: ['Onlineköp: {AMT} hos {MER}[ · {DATE}]'], atm: ['Uttag: {AMT}[ · {DATE}]'], refund: ['Återbetalning: {AMT} från {MER}'],
    fee: ['Avgift: {AMT}[ · {DATE}]'], incoming: ['Insättning: {AMT} från {CP}[ · {DATE}]'], outgoing: ['Överföring: {AMT} till {CP}[ · {DATE}]'], bill: ['Autogiro: {AMT} - {MER}'],
  },
  push: {
    purchase: ['{EMO} Du betalade {AMT} hos {MER}'], cnp: ['{EMO} Onlineköp {AMT} hos {MER}'], atm: ['{EMO} Du tog ut {AMT}'], refund: ['{EMO} {MER} återbetalade {AMT}'],
    fee: ['{EMO} Avgift {AMT}'], incoming: ['{EMO} {CP} swishade dig {AMT}', '{EMO} Du fick {AMT} från {CP}'], outgoing: ['{EMO} Du swishade {AMT} till {CP}'], bill: ['{EMO} Autogiro {MER} {AMT} betald'],
  },
  fields: {
    title: { purchase: ['Kortköp'], cnp: ['Internetköp'], atm: ['Uttag'], refund: ['Återbetalning'], fee: ['Avgift'], incoming: ['Insättning'], outgoing: ['Överföring'], bill: ['Autogiro'] },
    amount: ['Belopp'], merchant: ['Butik', 'Hos'], place: ['Plats'], payer: ['Från', 'Avsändare'], payee: ['Till', 'Mottagare'], card: ['Kort', 'Konto'], date: ['Datum'],
  },
  ins: { card: ['kort ****{L4}', 'kort som slutar på {L4}', 'Visa-kort *{L4}'], account: ['konto ****{L4}', 'konto som slutar på {L4}'] },
  trailer: {
    balance: ['Disponibelt belopp: {BAL}.', 'Saldo {BAL}'], limit: ['Tillgänglig kredit: {BAL}'], fraud: ['Inte du? Ring {PHONE}.'],
    threshold: ['Du får detta meddelande eftersom beloppet överstiger {THR}.'], optout: ['Avsluta: svara STOPP.'], link: ['Detaljer: https://{DOMAIN}/notiser'],
  },
  neg: {
    declined: ['c|Ditt köp på {AMT} hos {MER} har nekats.', 'x|Din överföring på {AMT} till {CP} misslyckades.'],
    pending: ['c|Reservation på {AMT} hos {MER} på ditt {INS}.', 'c|Köpet på {AMT} hos {MER} är reserverat och inte bokfört än.'],
    future: ['x|Autogiro {AMT} till {MER} dras den {DUE}.', 'x|Din schemalagda överföring på {AMT} till {CP} genomförs den {DUE}.'],
    conditional: ["c|Om du betalar mer än {AMT} hos {MER} skickar vi en avisering.", "c|Om {MER} drar {AMT} utan ditt medgivande kan du bestrida det inom 60 dagar."],
    question: ['c|Har du handlat för {AMT} hos {MER}? Svara JA eller NEJ.', 'x|Vill du skicka {AMT} till {CP}? Bekräfta i appen.'],
    negation: ['x|Räkningen till {MER} på {AMT} har inte betalats.', 'c|{AMT} har inte dragits; köpet hos {MER} avbröts.'],
    otp: ['c|Din kod för köpet på {AMT} hos {MER} är {OTP}. Dela den aldrig.', 'x|Kod {OTP} för att godkänna överföring på {AMT} till {CP}.'],
    promo: ['c|Få 5 % återbäring på köp över {AMT} hos {MER}!', 'a|Låna upp till {AMT}. Ansök nu.'],
    request: ['x|{CP} har skickat en Swish-förfrågan på {AMT}.', 'x|Betalningsförfrågan från {CP}: {AMT}.'],
    statement: ['a|Din kortfaktura är klar: totalt {AMT}, lägsta belopp {MIN} senast {DUE}.'],
    balance: ['a|Saldo på ditt {INS}: {AMT}.', 'a|Ditt saldo är {AMT}.'],
    chat: ['a|Jag betalade {AMT} på {MER} för middagen, swisha din del?', 'a|Kan du swisha {AMT} till hyran?'],
    scam: ['c|Ditt {INS} har debiterats {AMT} hos {MER}. Inte du? Verifiera: {URL}', 'a|Ditt paket väntar. Betala {AMT} i tull: {URL}'],
  },
};

const da = {
  id: 'da',
  months: ['jan.', 'feb.', 'mar.', 'apr.', 'maj', 'jun.', 'jul.', 'aug.', 'sep.', 'okt.', 'nov.', 'dec.'],
  sentence: {
    purchase: ['Køb på {AMT} hos {MER}[ med dit {INS}][ den {DATE}].', 'Du har betalt {AMT} hos {MER}[ den {DATE}].', 'Dit {INS} er blevet trukket {AMT} hos {MER}[ den {DATE}].'],
    cnp: ['Onlinekøb på {AMT} hos {MER}[ med dit {INS}][ den {DATE}].', 'Du har handlet online for {AMT} hos {MER}[ den {DATE}].', 'Nethandel: {AMT} hos {MER} er trukket[ den {DATE}].'],
    atm: ['Hævning på {AMT} i pengeautomat[ {MER}][ med dit {INS}][ den {DATE}].', 'Du har hævet {AMT} kontant[ den {DATE}].', 'Kontanthævning {AMT} med dit {INS}[ den {DATE}].'],
    refund: ['Tilbagebetaling på {AMT} fra {MER} er indsat[ på dit {INS}][ den {DATE}].', '{MER} har refunderet {AMT} til dig[ den {DATE}].', 'Du har modtaget en refusion på {AMT} fra {MER}[ den {DATE}].'],
    fee: ['Gebyr på {AMT} er trukket fra dit {INS}[ den {DATE}].', 'Vi har opkrævet et gebyr på {AMT}[ den {DATE}].', 'Månedligt kontogebyr {AMT} er hævet[ den {DATE}].'],
    incoming: ['Du har modtaget {AMT} fra {CP}[ den {DATE}].', 'Indbetaling {AMT} fra {CP} på dit {INS}[ den {DATE}].', '{CP} har sendt dig {AMT} via MobilePay[ den {DATE}].'],
    outgoing: ['Du har sendt {AMT} til {CP}[ den {DATE}].', 'Din overførsel på {AMT} til {CP} er gennemført[ den {DATE}].', 'MobilePay: {AMT} sendt til {CP}[ den {DATE}].'],
    bill: ['Betalingsservice: {AMT} til {MER} er trukket fra dit {INS}[ den {DATE}].', 'Din regning fra {MER} på {AMT} er betalt[ den {DATE}].', '{MER} har trukket {AMT} via Betalingsservice[ den {DATE}].'],
  },
  headline: {
    purchase: ['Kortkøb: {AMT} hos {MER}[ · {DATE}]'], cnp: ['Onlinekøb: {AMT} hos {MER}[ · {DATE}]'], atm: ['Hævning: {AMT}[ · {DATE}]'], refund: ['Tilbagebetaling: {AMT} fra {MER}'],
    fee: ['Gebyr: {AMT}[ · {DATE}]'], incoming: ['Indbetaling: {AMT} fra {CP}[ · {DATE}]'], outgoing: ['Overførsel: {AMT} til {CP}[ · {DATE}]'], bill: ['Betalingsservice: {AMT} - {MER}'],
  },
  push: {
    purchase: ['{EMO} Du betalte {AMT} hos {MER}'], cnp: ['{EMO} Onlinekøb {AMT} hos {MER}'], atm: ['{EMO} Du hævede {AMT}'], refund: ['{EMO} {MER} refunderede {AMT}'],
    fee: ['{EMO} Gebyr {AMT}'], incoming: ['{EMO} {CP} sendte dig {AMT}', '{EMO} Du modtog {AMT} fra {CP}'], outgoing: ['{EMO} Du sendte {AMT} til {CP}'], bill: ['{EMO} {MER} {AMT} betalt'],
  },
  fields: {
    title: { purchase: ['Kortkøb'], cnp: ['Nethandel'], atm: ['Hævning'], refund: ['Tilbagebetaling'], fee: ['Gebyr'], incoming: ['Indbetaling'], outgoing: ['Overførsel'], bill: ['Betalingsservice'] },
    amount: ['Beløb'], merchant: ['Forretning', 'Hos'], place: ['Sted'], payer: ['Fra', 'Afsender'], payee: ['Til', 'Modtager'], card: ['Kort', 'Konto'], date: ['Dato'],
  },
  ins: { card: ['kort ****{L4}', 'Visa/Dankort *{L4}', 'kort der slutter på {L4}'], account: ['konto ****{L4}', 'konto der slutter på {L4}'] },
  trailer: {
    balance: ['Disponibel saldo: {BAL}.', 'Saldo {BAL}'], limit: ['Disponibel kredit: {BAL}'], fraud: ['Ikke dig? Ring {PHONE}.'],
    threshold: ['Du modtager denne besked, fordi beløbet overstiger {THR}.'], optout: ['Afmeld: send STOP.'], link: ['Detaljer: https://{DOMAIN}/beskeder'],
  },
  neg: {
    declined: ['c|Dit køb på {AMT} hos {MER} er afvist.', 'x|Din overførsel på {AMT} til {CP} mislykkedes.'],
    pending: ['c|Reservation på {AMT} hos {MER} på dit {INS}.', 'c|Købet på {AMT} hos {MER} er reserveret og ikke bogført endnu.'],
    future: ['x|Betalingsservice trækker {AMT} til {MER} den {DUE}.', 'x|Din planlagte overførsel på {AMT} til {CP} gennemføres den {DUE}.'],
    conditional: ["c|Hvis du betaler mere end {AMT} hos {MER}, sender vi dig en besked.", "c|Hvis {MER} trækker {AMT} uden dit samtykke, kan du gøre indsigelse inden for 60 dage."],
    question: ['c|Har du handlet for {AMT} hos {MER}? Svar JA eller NEJ.', 'x|Vil du sende {AMT} til {CP}? Bekræft i appen.'],
    negation: ['x|Regningen fra {MER} på {AMT} er ikke betalt.', 'c|{AMT} er ikke trukket; købet hos {MER} blev annulleret.'],
    otp: ['c|Din kode til købet på {AMT} hos {MER} er {OTP}. Del den aldrig.', 'x|Kode {OTP} til at godkende overførsel på {AMT} til {CP}.'],
    promo: ['c|Få 5 % cashback på køb over {AMT} hos {MER}!', 'a|Lån op til {AMT}. Ansøg nu.'],
    request: ['x|{CP} har anmodet om {AMT} via MobilePay.', 'x|Betalingsanmodning fra {CP}: {AMT}.'],
    statement: ['a|Din kortopgørelse er klar: i alt {AMT}, minimum {MIN} senest {DUE}.'],
    balance: ['a|Saldo på dit {INS}: {AMT}.', 'a|Din saldo er {AMT}.'],
    chat: ['a|Jeg betalte {AMT} på {MER} for maden, sender du din del?', 'a|Kan du MobilePay mig {AMT} til husleje?'],
    scam: ['c|Dit {INS} er trukket {AMT} hos {MER}. Ikke dig? Bekræft: {URL}', 'a|Din pakke venter. Betal {AMT} i told: {URL}'],
  },
};

const nb = {
  id: 'nb',
  months: ['jan.', 'feb.', 'mars', 'apr.', 'mai', 'juni', 'juli', 'aug.', 'sep.', 'okt.', 'nov.', 'des.'],
  sentence: {
    purchase: ['Kjøp på {AMT} hos {MER}[ med ditt {INS}][ {DATE}].', 'Du har betalt {AMT} hos {MER}[ {DATE}].', 'Ditt {INS} er belastet med {AMT} hos {MER}[ {DATE}].'],
    cnp: ['Nettkjøp på {AMT} hos {MER}[ med ditt {INS}][ {DATE}].', 'Du har handlet på nett for {AMT} hos {MER}[ {DATE}].', 'Ditt {INS} er brukt til et nettkjøp på {AMT} hos {MER}[ {DATE}].'],
    atm: ['Uttak av {AMT} i minibank[ {MER}][ med ditt {INS}][ {DATE}].', 'Du har tatt ut {AMT} i kontanter[ {DATE}].', 'Kontantuttak {AMT} med ditt {INS}[ {DATE}].'],
    refund: ['Tilbakebetaling på {AMT} fra {MER} er satt inn[ på ditt {INS}][ {DATE}].', '{MER} har refundert {AMT} til deg[ {DATE}].', 'Du har mottatt en refusjon på {AMT} fra {MER}[ {DATE}].'],
    fee: ['Gebyr på {AMT} er trukket fra ditt {INS}[ {DATE}].', 'Vi har belastet et gebyr på {AMT}[ {DATE}].', 'Månedlig kontogebyr {AMT} er trukket[ {DATE}].'],
    incoming: ['Du har mottatt {AMT} fra {CP}[ {DATE}].', 'Innbetaling {AMT} fra {CP} til ditt {INS}[ {DATE}].', '{CP} har vippset deg {AMT}[ {DATE}].'],
    outgoing: ['Du har sendt {AMT} til {CP}[ {DATE}].', 'Overføringen din på {AMT} til {CP} er gjennomført[ {DATE}].', 'Vipps: {AMT} sendt til {CP}[ {DATE}].'],
    bill: ['AvtaleGiro: {AMT} til {MER} er trukket fra ditt {INS}[ {DATE}].', 'Regningen fra {MER} på {AMT} er betalt[ {DATE}].', '{MER} har trukket {AMT} via eFaktura[ {DATE}].'],
  },
  headline: {
    purchase: ['Kortkjøp: {AMT} hos {MER}[ · {DATE}]'], cnp: ['Nettkjøp: {AMT} hos {MER}[ · {DATE}]'], atm: ['Uttak: {AMT}[ · {DATE}]'], refund: ['Tilbakebetaling: {AMT} fra {MER}'],
    fee: ['Gebyr: {AMT}[ · {DATE}]'], incoming: ['Innbetaling: {AMT} fra {CP}[ · {DATE}]'], outgoing: ['Overføring: {AMT} til {CP}[ · {DATE}]'], bill: ['AvtaleGiro: {AMT} - {MER}'],
  },
  push: {
    purchase: ['{EMO} Du betalte {AMT} hos {MER}'], cnp: ['{EMO} Nettkjøp {AMT} hos {MER}'], atm: ['{EMO} Du tok ut {AMT}'], refund: ['{EMO} {MER} refunderte {AMT}'],
    fee: ['{EMO} Gebyr {AMT}'], incoming: ['{EMO} {CP} vippset deg {AMT}', '{EMO} Du mottok {AMT} fra {CP}'], outgoing: ['{EMO} Du vippset {AMT} til {CP}'], bill: ['{EMO} {MER} {AMT} betalt'],
  },
  fields: {
    title: { purchase: ['Kortkjøp'], cnp: ['Nettkjøp'], atm: ['Uttak'], refund: ['Tilbakebetaling'], fee: ['Gebyr'], incoming: ['Innbetaling'], outgoing: ['Overføring'], bill: ['AvtaleGiro'] },
    amount: ['Beløp'], merchant: ['Butikk', 'Hos'], place: ['Sted'], payer: ['Fra', 'Avsender'], payee: ['Til', 'Mottaker'], card: ['Kort', 'Konto'], date: ['Dato'],
  },
  ins: { card: ['kort ****{L4}', 'Visa-kort *{L4}', 'kort som slutter på {L4}'], account: ['konto ****{L4}', 'konto som slutter på {L4}'] },
  trailer: {
    balance: ['Disponibelt: {BAL}.', 'Saldo {BAL}'], limit: ['Tilgjengelig kreditt: {BAL}'], fraud: ['Ikke deg? Ring {PHONE}.'],
    threshold: ['Du får denne meldingen fordi beløpet er over {THR}.'], optout: ['Avslutt: send STOPP.'], link: ['Detaljer: https://{DOMAIN}/varsler'],
  },
  neg: {
    declined: ['c|Kjøpet ditt på {AMT} hos {MER} ble avvist.', 'x|Overføringen din på {AMT} til {CP} feilet.'],
    pending: ['c|Reservasjon på {AMT} hos {MER} på ditt {INS}.', 'c|Kjøpet på {AMT} hos {MER} er reservert og ikke bokført ennå.'],
    future: ['x|AvtaleGiro trekker {AMT} til {MER} den {DUE}.', 'x|Den planlagte overføringen din på {AMT} til {CP} gjennomføres {DUE}.'],
    conditional: ["c|Hvis du betaler mer enn {AMT} hos {MER}, sender vi deg et varsel.", "c|Hvis {MER} trekker {AMT} uten ditt samtykke, kan du klage innen 60 dager."],
    question: ['c|Har du handlet for {AMT} hos {MER}? Svar JA eller NEI.', 'x|Vil du sende {AMT} til {CP}? Bekreft i appen.'],
    negation: ['x|Regningen fra {MER} på {AMT} er ikke betalt.', 'c|{AMT} er ikke trukket; kjøpet hos {MER} ble kansellert.'],
    otp: ['c|Koden din for kjøpet på {AMT} hos {MER} er {OTP}. Ikke del den.', 'x|Kode {OTP} for å godkjenne overføring på {AMT} til {CP}.'],
    promo: ['c|Få 5 % bonus på kjøp over {AMT} hos {MER}!', 'a|Lån opptil {AMT}. Søk nå.'],
    request: ['x|{CP} har bedt om {AMT} via Vipps.', 'x|Betalingsforespørsel fra {CP}: {AMT}.'],
    statement: ['a|Kortfakturaen din er klar: totalt {AMT}, minstebeløp {MIN} innen {DUE}.'],
    balance: ['a|Saldo på ditt {INS}: {AMT}.', 'a|Saldoen din er {AMT}.'],
    chat: ['a|Jeg betalte {AMT} på {MER} for middagen, vippser du din del?', 'a|Kan du vippse meg {AMT} til husleia?'],
    scam: ['c|Ditt {INS} er belastet {AMT} hos {MER}. Ikke deg? Bekreft: {URL}', 'a|Pakken din venter. Betal {AMT} i toll: {URL}'],
  },
};

module.exports = { sv, da, nb };
