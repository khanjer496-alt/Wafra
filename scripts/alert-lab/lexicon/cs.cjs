'use strict';
// Czech phrasings (CZ). See en.cjs for slots.
module.exports = {
  id: 'cs',
  months: ['led', 'úno', 'bře', 'dub', 'kvě', 'čvn', 'čvc', 'srp', 'zář', 'říj', 'lis', 'pro'],
  sentence: {
    purchase: ['Platba kartou {INS} ve výši {AMT} u {MER}[ dne {DATE}].', 'Zaplatili jste {AMT} u {MER}[ dne {DATE}].', 'Z vaší karty {INS} byla stržena částka {AMT}, obchodník {MER}[, {DATE}].'],
    cnp: ['Platba na internetu {AMT} u {MER}[ kartou {INS}][ dne {DATE}].', 'Zaplatili jste online {AMT} u {MER}[ dne {DATE}].', 'Internetová platba kartou {INS}: {AMT}, {MER}[, {DATE}].'],
    atm: ['Výběr z bankomatu {AMT}[ {MER}][ kartou {INS}][ dne {DATE}].', 'Vybrali jste {AMT} z bankomatu[ dne {DATE}].', 'Výběr hotovosti ve výši {AMT}[ kartou {INS}][, {DATE}].'],
    refund: ['Vrácení platby {AMT} od {MER} bylo připsáno na váš účet[ dne {DATE}].', '{MER} vám vrátil {AMT}[ dne {DATE}].', 'Připsána refundace {AMT} od {MER}[, {DATE}].'],
    fee: ['Poplatek za vedení účtu {AMT} byl stržen[ dne {DATE}].', 'Z účtu {INS} byl stržen poplatek {AMT}[ dne {DATE}].', 'Účtovali jsme poplatek {AMT}[, {DATE}].'],
    incoming: ['Na váš účet {INS} přišla platba {AMT} od {CP}[ dne {DATE}].', 'Obdrželi jste {AMT} od {CP}[ dne {DATE}].', 'Příchozí platba {AMT} od {CP}[, {DATE}].'],
    outgoing: ['Odeslali jste {AMT} na účet {CP}[ dne {DATE}].', 'Vaše platba {AMT} pro {CP} byla provedena[ dne {DATE}].', 'Odchozí platba z účtu {INS}: {AMT} pro {CP}[, {DATE}].'],
    bill: ['Inkaso {AMT} pro {MER} bylo provedeno[ dne {DATE}].', 'Zaplatili jste fakturu {MER} ve výši {AMT}[ dne {DATE}].', 'Trvalý příkaz provedeno: {AMT} pro {MER}[, {DATE}].'],
  },
  headline: {
    purchase: ['Platba kartou: {AMT} u {MER}[ · {DATE}]'], cnp: ['Online platba: {AMT} u {MER}[ · {DATE}]'], atm: ['Výběr z bankomatu: {AMT}[ · {DATE}]'], refund: ['Vrácení: {AMT} od {MER}'],
    fee: ['Poplatek: {AMT}[ · {DATE}]'], incoming: ['Příchozí platba: {AMT} od {CP}[ · {DATE}]'], outgoing: ['Odchozí platba: {AMT} pro {CP}[ · {DATE}]'], bill: ['Inkaso: {AMT} - {MER}'],
  },
  push: {
    purchase: ['{EMO} Zaplatili jste {AMT} u {MER}'], cnp: ['{EMO} Online platba {AMT} u {MER}'], atm: ['{EMO} Vybrali jste {AMT}'], refund: ['{EMO} {MER} vám vrátil {AMT}'],
    fee: ['{EMO} Poplatek {AMT}'], incoming: ['{EMO} {CP} vám poslal {AMT}', '{EMO} Přišlo {AMT} od {CP}'], outgoing: ['{EMO} Poslali jste {AMT} pro {CP}'], bill: ['{EMO} Inkaso {MER} {AMT} zaplaceno'],
  },
  fields: {
    title: { purchase: ['Platba kartou'], cnp: ['Internetová platba'], atm: ['Výběr z bankomatu'], refund: ['Vrácení platby'], fee: ['Poplatek'], incoming: ['Příchozí platba'], outgoing: ['Odchozí platba'], bill: ['Inkaso'] },
    amount: ['Částka'], merchant: ['Obchodník', 'Místo'], place: ['Bankomat'], payer: ['Od', 'Plátce'], payee: ['Pro', 'Příjemce'], card: ['Karta', 'Účet'], date: ['Datum'],
  },
  ins: { card: ['*{L4}', '**{L4}', 'xxxx{L4}'], account: ['*{L4}', '...{L4}'] },
  trailer: {
    balance: ['Disponibilní zůstatek: {BAL}.', 'Zůstatek {BAL}'], limit: ['Dostupný limit: {BAL}'], fraud: ['Nebyli jste to vy? Volejte {PHONE}.'],
    threshold: ['Tuto zprávu dostáváte, protože částka přesahuje {THR}.'], optout: ['Odhlášení: pošlete STOP.'], link: ['Detail: https://{DOMAIN}/upozorneni'],
  },
  neg: {
    declined: ['c|Platba {AMT} u {MER} byla zamítnuta.', 'x|Platba {AMT} pro {CP} nebyla provedena.'],
    pending: ['c|Blokace {AMT} u {MER} na kartě {INS}.', 'c|Platba {AMT} u {MER} čeká na zaúčtování.'],
    future: ['x|Inkaso {AMT} pro {MER} bude provedeno {DUE}.', 'x|Plánovaná platba {AMT} pro {CP} bude odeslána {DUE}.'],
    conditional: ["c|Pokud zaplatíte více než {AMT} u {MER}, pošleme vám upozornění.", "c|Pokud {MER} strhne {AMT} bez vašeho souhlasu, můžete ji reklamovat do 60 dnů."],
    question: ['c|Provedli jste platbu {AMT} u {MER}? Odpovězte ANO nebo NE.', 'x|Chcete odeslat {AMT} pro {CP}? Potvrďte v aplikaci.'],
    negation: ['x|Faktura {MER} ve výši {AMT} nebyla zaplacena.', 'c|{AMT} nebylo strženo; platba u {MER} byla zrušena.'],
    otp: ['c|Kód pro platbu {AMT} u {MER} je {OTP}. Nikomu ho nesdělujte.', 'x|Kód {OTP} pro potvrzení platby {AMT} pro {CP}.'],
    promo: ['c|Získejte 5 % zpět při nákupu nad {AMT} u {MER}!', 'a|Půjčka až {AMT}. Požádejte ještě dnes.'],
    request: ['x|{CP} vás žádá o platbu {AMT}.', 'x|Žádost o platbu od {CP}: {AMT}.'],
    statement: ['a|Výpis z kreditní karty: dlužná částka {AMT}, minimální splátka {MIN} do {DUE}.'],
    balance: ['a|Zůstatek na účtu {INS}: {AMT}.', 'a|Váš zůstatek je {AMT}.'],
    chat: ['a|Zaplatil jsem {AMT} v {MER} za večeři, pošleš mi svou část?', 'a|Můžeš mi poslat {AMT} na nájem?'],
    scam: ['c|Z karty {INS} bylo strženo {AMT} u {MER}. Nebyli jste to vy? Ověřte: {URL}', 'a|Vaše zásilka čeká. Doplaťte {AMT}: {URL}'],
  },
};
