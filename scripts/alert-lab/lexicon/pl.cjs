'use strict';
// Polish phrasings (PL). See en.cjs for slots.
module.exports = {
  id: 'pl',
  months: ['sty', 'lut', 'mar', 'kwi', 'maj', 'cze', 'lip', 'sie', 'wrz', 'paź', 'lis', 'gru'],
  sentence: {
    purchase: [
      'Transakcja kartą {INS} na kwotę {AMT} w {MER}[ dnia {DATE}].',
      'Zapłacono {AMT} w {MER}[ kartą {INS}][ {DATE}].',
      'Płatność kartą: {AMT}, {MER}[, {DATE}].',
    ],
    cnp: [
      'Płatność internetowa na kwotę {AMT} w {MER}[ kartą {INS}][ dnia {DATE}].',
      'Zapłaciłeś online {AMT} w {MER}[ {DATE}].',
      'Transakcja internetowa {AMT} u {MER} została zrealizowana[ {DATE}].',
    ],
    atm: [
      'Wypłata z bankomatu {AMT}[ {MER}][ kartą {INS}][ dnia {DATE}].',
      'Wypłaciłeś {AMT} z bankomatu[ {DATE}].',
      'Wypłata gotówki na kwotę {AMT}[ kartą {INS}][ {DATE}].',
    ],
    refund: [
      'Zwrot {AMT} od {MER} zaksięgowany na koncie[ {DATE}].',
      '{MER} zwrócił Ci {AMT}[ {DATE}].',
      'Otrzymałeś zwrot transakcji {AMT} z {MER}[ dnia {DATE}].',
    ],
    fee: [
      'Pobrano opłatę za prowadzenie konta {AMT}[ {DATE}].',
      'Prowizja {AMT} została pobrana z rachunku {INS}[ dnia {DATE}].',
      'Obciążenie z tytułu opłaty: {AMT}[ {DATE}].',
    ],
    incoming: [
      'Otrzymałeś przelew {AMT} od {CP}[ {DATE}].',
      'Wpływ na rachunek {INS}: {AMT} od {CP}[ dnia {DATE}].',
      '{CP} przesłał Ci {AMT} przez BLIK[ {DATE}].',
    ],
    outgoing: [
      'Wysłałeś przelew {AMT} do {CP}[ {DATE}].',
      'Przelew na kwotę {AMT} do {CP} został zrealizowany[ dnia {DATE}].',
      'Przelew BLIK na telefon: {AMT} do {CP}[ {DATE}].',
    ],
    bill: [
      'Polecenie zapłaty {AMT} na rzecz {MER} zostało zrealizowane[ {DATE}].',
      'Zapłacono rachunek {MER} na kwotę {AMT}[ dnia {DATE}].',
      '{MER} pobrał {AMT} z rachunku {INS}[ {DATE}].',
    ],
  },
  headline: {
    purchase: ['Płatność kartą: {AMT} {MER}[ · {DATE}]'], cnp: ['Zakup online: {AMT} {MER}[ · {DATE}]'], atm: ['Wypłata z bankomatu: {AMT}[ · {DATE}]'],
    refund: ['Zwrot: {AMT} od {MER}'], fee: ['Opłata: {AMT}[ · {DATE}]'], incoming: ['Wpływ: {AMT} od {CP}[ · {DATE}]'],
    outgoing: ['Przelew wychodzący: {AMT} do {CP}[ · {DATE}]'], bill: ['Polecenie zapłaty: {AMT} - {MER}'],
  },
  push: {
    purchase: ['{EMO} Zapłaciłeś {AMT} w {MER}'], cnp: ['{EMO} Zakup online {AMT} w {MER}'], atm: ['{EMO} Wypłaciłeś {AMT}'], refund: ['{EMO} Zwrot {AMT} od {MER}'],
    fee: ['{EMO} Opłata {AMT}'], incoming: ['{EMO} {CP} wysłał Ci {AMT}', '{EMO} Otrzymałeś {AMT} od {CP}'], outgoing: ['{EMO} Wysłałeś {AMT} do {CP}'], bill: ['{EMO} Zapłacono {AMT} dla {MER}'],
  },
  fields: {
    title: { purchase: ['Transakcja kartą'], cnp: ['Transakcja internetowa'], atm: ['Wypłata z bankomatu'], refund: ['Zwrot'], fee: ['Opłata'], incoming: ['Wpływ na rachunek'], outgoing: ['Przelew wychodzący'], bill: ['Polecenie zapłaty'] },
    amount: ['Kwota'], merchant: ['Miejsce', 'Sprzedawca'], place: ['Bankomat'], payer: ['Od', 'Nadawca'], payee: ['Do', 'Odbiorca'], card: ['Karta', 'Rachunek'], date: ['Data'],
  },
  ins: {
    card: ['*{L4}', '**** {L4}', 'xx{L4}', 'nr ...{L4}'],
    account: ['*{L4}', '...{L4}', 'nr ****{L4}'],
  },
  trailer: {
    balance: ['Dostępne środki: {BAL}.', 'Saldo: {BAL}'],
    limit: ['Dostępny limit: {BAL}'],
    fraud: ['To nie Ty? Zadzwoń {PHONE}.'],
    threshold: ['Otrzymujesz to powiadomienie, ponieważ kwota przekracza {THR}.'],
    optout: ['Aby zrezygnować, wyślij STOP.'],
    link: ['Szczegóły: https://{DOMAIN}/powiadomienia'],
  },
  neg: {
    declined: ['c|Transakcja {AMT} w {MER} została odrzucona.', 'x|Przelew {AMT} do {CP} nie został zrealizowany.'],
    pending: ['c|Blokada środków {AMT} w {MER} na karcie {INS}.', 'c|Transakcja {AMT} w {MER} oczekuje na rozliczenie.'],
    future: ['x|Polecenie zapłaty {AMT} dla {MER} zostanie zrealizowane {DUE}.', 'x|Zaplanowany przelew {AMT} do {CP} zostanie wykonany {DUE}.'],
    conditional: ["c|Jeśli zapłacisz więcej niż {AMT} w {MER}, wyślemy Ci powiadomienie.", "c|Jeśli {MER} pobierze {AMT} bez Twojej zgody, możesz złożyć reklamację w ciągu 60 dni."],
    question: ['c|Czy dokonałeś transakcji {AMT} w {MER}? Odpowiedz TAK lub NIE.', 'x|Czy zlecasz przelew {AMT} do {CP}? Potwierdź w aplikacji.'],
    negation: ['x|Rachunek {MER} na kwotę {AMT} nie został opłacony.', 'c|{AMT} nie zostało pobrane; transakcja w {MER} została anulowana.'],
    otp: ['c|Kod {OTP} do transakcji {AMT} w {MER}. Nie podawaj go nikomu.', 'x|Kod SMS {OTP} do przelewu {AMT} do {CP}.'],
    promo: ['c|Zyskaj 5% zwrotu przy zakupach od {AMT} w {MER}!', 'a|Pożyczka do {AMT} bez zaświadczeń. Złóż wniosek.'],
    request: ['x|{CP} prosi Cię o przelew {AMT} przez BLIK.', 'x|Prośba o płatność od {CP}: {AMT}.'],
    statement: ['a|Zestawienie karty: zadłużenie {AMT}, minimalna spłata {MIN} do {DUE}.'],
    balance: ['a|Saldo rachunku {INS}: {AMT}.', 'a|Twoje saldo wynosi {AMT}.'],
    chat: ['a|Zapłaciłem {AMT} w {MER} za kolację, oddasz mi połowę?', 'a|Możesz mi przelać {AMT} na czynsz?'],
    scam: ['c|Obciążenie {AMT} w {MER} kartą {INS}. To nie Ty? Sprawdź: {URL}', 'a|Dopłać {AMT} do przesyłki: {URL}'],
  },
};
