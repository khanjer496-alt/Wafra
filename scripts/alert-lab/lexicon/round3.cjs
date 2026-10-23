'use strict';
// Round-3 NEGATIVE material, from the final worldwide review of the merged
// parser (parser-tools/review-final-worldwide.md). Most round-3 kinds are
// TRANSFORMS of the base positive (generate.cjs composeTransform), so these
// lists hold only the inserted pieces:
//
//   statusline  a status LINE appended after a completed-looking alert
//   statusword  a CAPITALISED status word glued to the merchant/payee name
//   vishing     a call-back / lookalike-domain line (phone or e-mail sender)
//   threshold   "charged more than X at Y" (template)
//   krlang      a `kr` alert in another Nordic language than the user's
//               country (template; sv/da/nb only)
//   hedge       Nordic hedges, appended to the round-2 kind
//
// `issuers` (card-issuer payees, per market + global) and `ownAccounts`
// (own-account destinations, per language) feed the issuerpay and ownacct
// transforms. Slots in vishing lines: {VPHONE} {LOOK}.
module.exports = {
  lex: {
    en: { neg: {
      statusline: ['PENDING', 'Status: failed', 'Tap to accept this payment', 'Was this you? Reply YES', 'REVERSED'],
      statusword: ['REVERSED', 'NOT COMPLETED', 'PRE-AUTH', 'ON HOLD'],
      vishing: ["Didn't make it? Call {VPHONE}", 'Unrecognized? Call {VPHONE}', 'Contact fraud dept {VPHONE}', "Wasn't you? Reach us at {VPHONE}", 'Verify at {LOOK}', 'Not you? Secure your card: {LOOK}'],
      threshold: ['c|Your {INS} was charged more than {AMT} at {MER}.', 'c|A purchase of more than {AMT} was made at {MER} with your {INS}.', 'c|Transactions above {AMT} at {MER} will trigger this alert.'],
    } },
    ar: { neg: {
      statusline: ['مرفوضة', 'قيد المعالجة', 'لم تتم العملية', 'هل قمت بهذه العملية؟ أرسل نعم'],
      statusword: ['مرفوضة', 'معلقة', 'ملغاة'],
      vishing: ['إذا لم تقم بهذه العملية اتصل فوراً على {VPHONE}', 'للتحقق ادخل على {LOOK}'],
      threshold: ['c|تم خصم أكثر من {AMT} من {INS} لدى {MER}.', 'c|عملية شراء بأكثر من {AMT} لدى {MER}.'],
    } },
    de: { neg: {
      statusline: ['abgelehnt', 'ABGELEHNT', 'wird noch gebucht', 'Status: fehlgeschlagen', 'Waren Sie das? Antworten Sie JA'],
      statusword: ['UNGÜLTIG', 'ERFOLGLOS', 'VORAUTORISIERUNG', 'UNGEDECKT', 'RÜCKGÄNGIG GEMACHT', 'UNTERBROCHEN', 'WIRD GEBUCHT', 'RÜCKGABE', 'WIDERSPRUCH'],
      vishing: ['Unbekannte Zahlung? Rufen Sie uns an {VPHONE}', 'Nicht Sie? Sofort anrufen: {VPHONE}', 'Jetzt verifizieren: {LOOK}'],
      threshold: ['c|Ihre {INS} wurde mit mehr als {AMT} bei {MER} belastet.', 'c|Umsätze über {AMT} bei {MER} lösen diese Benachrichtigung aus.'],
    } },
    fr: { neg: {
      statusline: ['REFUSÉ', 'en attente', 'Opération annulée', "C'était vous ? Répondez OUI", 'Libellé : ÉCHEC'],
      statusword: ['ÉCHEC', 'REFUSÉ', 'EN ATTENTE', 'ANNULÉ'],
      vishing: ["Ce n'est pas vous ? Appelez le {VPHONE}", 'Opposition immédiate : {VPHONE}', 'Vérifiez sur {LOOK}'],
      threshold: ['c|Votre {INS} a été débitée de plus de {AMT} chez {MER}.', 'c|Les paiements de plus de {AMT} chez {MER} déclenchent cette alerte.'],
    } },
    nl: { neg: {
      statusline: ['GEWEIGERD', 'in behandeling', 'mislukt', 'Was jij dit? Antwoord JA'],
      statusword: ['GEWEIGERD', 'IN BEHANDELING', 'STORNO'],
      vishing: ['Niet herkend? Bel direct {VPHONE}', 'Controleer via {LOOK}'],
      threshold: ['c|Er is meer dan {AMT} afgeschreven bij {MER}.', 'c|Betalingen boven {AMT} bij {MER} geven deze melding.'],
    } },
    es: { neg: {
      statusline: ['DENEGADA', 'no realizada', 'FALLIDA', '¿Has sido tú? Responde SI'],
      statusword: ['NO REALIZADA', 'FALLIDA', 'PREAUTORIZACIÓN', 'EN PROCESO'],
      vishing: ['¿No has sido tú? Llama al {VPHONE}', 'Verifica en {LOOK}'],
      threshold: ['c|Se ha cargado más de {AMT} en {MER} con tu {INS}.', 'c|Las compras superiores a {AMT} en {MER} generan este aviso.'],
    } },
    pt: { neg: {
      statusline: ['não efetuada', 'RECUSADA', 'pendente', 'Foi você? Responda SIM'],
      statusword: ['RECUSADA', 'PENDENTE', 'NÃO EFETUADA'],
      vishing: ['Não reconhece? Ligue já {VPHONE}', 'Confirme em {LOOK}'],
      threshold: ['c|Foi debitado mais de {AMT} em {MER} no seu {INS}.', 'c|Compras acima de {AMT} em {MER} geram este alerta.'],
    } },
    it: { neg: {
      statusline: ['FALLITO', 'in corso', 'ANNULLATO', 'Sei stato tu? Rispondi SI'],
      statusword: ['IN CORSO', 'NON ESEGUITO', 'PREAUTORIZZAZIONE'],
      vishing: ['Non sei stato tu? Chiama subito {VPHONE}', 'Verifica su {LOOK}'],
      threshold: ['c|Sulla tua {INS} sono stati addebitati più di {AMT} presso {MER}.', 'c|I pagamenti oltre {AMT} presso {MER} attivano questo avviso.'],
    } },
    pl: { neg: {
      statusline: ['ODRZUCONA', 'anulowana', 'oczekuje', 'Czy to Ty? Odpowiedz TAK'],
      statusword: ['ODRZUCONA', 'W TRAKCIE', 'ANULOWANA'],
      vishing: ['To nie Ty? Zadzwoń natychmiast {VPHONE}', 'Zweryfikuj na {LOOK}'],
      threshold: ['c|Kartą {INS} zapłacono ponad {AMT} w {MER}.', 'c|Transakcje powyżej {AMT} w {MER} wywołują to powiadomienie.'],
    } },
    cs: { neg: {
      statusline: ['čeká na zpracování', 'transakce zrušena', 'Částka bude stržena zítra.', 'Byli jste to vy? Odpovězte ANO'],
      statusword: ['ZAMÍTNUTO', 'ZRUŠENO', 'ČEKÁ'],
      vishing: ['Nebyli jste to vy? Volejte {VPHONE}', 'Ověřte na {LOOK}'],
      threshold: ['c|Z karty {INS} bylo strženo více než {AMT} u {MER}.', 'c|Platby nad {AMT} u {MER} spouštějí toto upozornění.'],
    } },
    sv: { neg: {
      statusline: ['NEKAD', 'avbruten', 'reserverat', 'Svara JA för att godkänna'],
      statusword: ['PÅGÅR', 'NEKAD', 'RESERVERAD'],
      vishing: ['Inte du? Ring oss direkt {VPHONE}', 'Verifiera på {LOOK}'],
      threshold: ['c|Ditt {INS} har debiterats mer än {AMT} hos {MER}.', 'c|Köp över {AMT} hos {MER} ger denna avisering.'],
      krlang: ['Köp {AMT} hos {MER}.', 'Du har betalat {AMT} hos {MER}.', 'Kortköp på {AMT} hos {MER} har dragits.'],
      hedge: ['c|Köp {AMT} hos {MER} kan ha dragits.', 'c|{AMT} kan ha dragits från ditt {INS} hos {MER}.'],
    } },
    da: { neg: {
      statusline: ['annulleret', 'ikke gennemført', 'Reserveret', 'Tryk for at modtage', 'Svar JA for at acceptere'],
      statusword: ['AFVIST', 'RESERVERET', 'ANNULLERET'],
      vishing: ['Ikke dig? Ring straks {VPHONE}', 'Bekræft på {LOOK}'],
      threshold: ['c|Dit {INS} er trukket mere end {AMT} hos {MER}.', 'c|Køb over {AMT} hos {MER} giver denne besked.'],
      krlang: ['Køb på {AMT} hos {MER}.', 'Du har betalt {AMT} hos {MER}.', 'Dit kort er trukket {AMT} hos {MER}.'],
      hedge: ['c|Køb {AMT} hos {MER} kan være trukket.', 'c|{AMT} kan være hævet fra dit {INS} hos {MER}.'],
    } },
    nb: { neg: {
      statusline: ['AVVIST', 'ikke gjennomført', 'reservert', 'Trykk for å motta'],
      statusword: ['AVVIST', 'RESERVERT', 'KANSELLERT'],
      vishing: ['Ikke deg? Ring oss nå {VPHONE}', 'Bekreft på {LOOK}'],
      threshold: ['c|Ditt {INS} er belastet mer enn {AMT} hos {MER}.', 'c|Kjøp over {AMT} hos {MER} gir dette varselet.'],
      krlang: ['Kjøp på {AMT} hos {MER}.', 'Du har betalt {AMT} hos {MER}.', 'Kortet ditt er belastet med {AMT} hos {MER}.'],
      hedge: ['c|Kjøp {AMT} hos {MER} kan ha blitt trukket.', 'c|{AMT} kan ha blitt trukket fra ditt {INS} hos {MER}.'],
    } },
  },
  // Card-issuer payees: paying one of these settles a credit card (a
  // cardPayment), it is not spending.
  issuers: {
    global: ['AMERICAN EXPRESS', 'AMERICAN EXPRESS EUROPE', 'BARCLAYCARD', 'ADVANZIA BANK', 'MASTERCARD ABRECHNUNG', 'VISA CARD PAYMENT'],
    US: ['CAPITAL ONE', 'APPLE CARD', 'GS BANK (APPLE CARD)', 'DISCOVER CARD', 'CITI CARDS', 'AMEX'],
    CA: ['AMEX BANK OF CANADA', 'CAPITAL ONE CANADA', 'RBC VISA'],
    GB: ['BARCLAYCARD', 'MBNA', 'CAPITAL ONE UK', 'AMEX'],
    IE: ['AVANT MONEY', 'BANK OF IRELAND CREDIT CARD'],
    DE: ['DKB VISA', 'HANSEATIC BANK GENIALCARD', 'BARCLAYS BANK IRELAND', 'TF BANK MASTERCARD'],
    AT: ['PAYLIFE', 'CARD COMPLETE'], CH: ['CORNERCARD', 'SWISSCARD AECS', 'VISECA'],
    FR: ['CETELEM CARTE', 'AMERICAN EXPRESS CARTE-FRANCE'], BE: ['BEOBANK MASTERCARD'], NL: ['ICS', 'INTERNATIONAL CARD SERVICES'],
    ES: ['WIZINK BANK', 'CETELEM ESPANA'], PT: ['UNIBANCO', 'CARTAO UNIVERSO'], IT: ['NEXI PAYMENTS', 'AGOS DUCATO CARTA'],
    PL: ['KARTA KREDYTOWA PKO', 'CITI HANDLOWY KARTA'], SE: ['SEB KORT', 'ENTERCARD'], DK: ['ENTERCARD DANMARK', 'FORBRUGSFORENINGEN'],
    NO: ['BANK NORWEGIAN', 'RE:MEMBER'], CZ: ['AIR BANK KREDITNI KARTA'],
    AE: ['ENBD CREDIT CARD', 'ADCB CREDIT CARD PAYMENT'], SA: ['ALRAJHI CREDIT CARD'], QA: ['QNB CREDIT CARD'],
    KW: ['NBK CREDIT CARD'], BH: ['BBK CREDIT CARD'], OM: ['BANK MUSCAT CREDIT CARD'], JO: ['ARAB BANK CREDIT CARD'], EG: ['CIB CREDIT CARD'],
  },
  // Destinations that are the person's own accounts.
  ownAccounts: {
    en: ['MY SAVINGS', 'SAVINGS POT', 'YOUR ISA', 'OWN ACCOUNT TRANSFER'],
    de: ['N26 SPACE', 'TRADE REPUBLIC', 'TAGESGELD', 'EIGENES SPARKONTO'],
    fr: ['LIVRET A', 'LDDS', 'COMPTE EPARGNE'], nl: ['SPAARREKENING', 'BUNQ SAVINGS'], es: ['CUENTA AHORRO', 'HUCHA BBVA'],
    pt: ['CONTA POUPANCA', 'MEALHEIRO'], it: ['CONTO DEPOSITO', 'SALVADANAIO'], pl: ['RACHUNEK OSZCZEDNOSCIOWY', 'MOJE CELE'],
    cs: ['SPORICI UCET', 'VLASTNI UCET'], sv: ['SPARKONTO', 'EGET KONTO'], da: ['OPSPARINGSKONTO', 'EGEN KONTO'],
    nb: ['SPAREKONTO', 'EGEN KONTO'], ar: ['حساب التوفير', 'SAVINGS ACCOUNT'],
  },
};
