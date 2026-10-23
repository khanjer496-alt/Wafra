'use strict';
// Second (and later) items for groups that would otherwise hold a single
// phrasing. A single-item group cannot be split into DEV and HOLDOUT, so each
// group here gets at least one more independent wording. Merged into the
// language packs by generate.cjs (lists are concatenated).
module.exports = {
  ar: {
    push: { cnp: ['{EMO} شراء أونلاين {AMT} - {MER}'], refund: ['{EMO} {MER} أعاد لك {AMT}'], fee: ['{EMO} رسوم {AMT} على حسابك'], outgoing: ['{EMO} تم تحويل {AMT} إلى {CP}'], bill: ['{EMO} تم سداد {AMT} لـ {MER}'] },
    trailer: { threshold: ['تنبيه: المبلغ أعلى من حد التنبيه {THR}.'], link: ['لمزيد من التفاصيل: {DOMAIN}/alerts'] },
  },
  de: {
    push: { cnp: ['{EMO} {AMT} online bei {MER} bezahlt'], atm: ['{EMO} Bargeld abgehoben: {AMT}'], refund: ['{EMO} Erstattung von {MER}: {AMT}'], fee: ['{EMO} Wir haben dir {AMT} Gebühr berechnet.'], outgoing: ['{EMO} {AMT} an {CP} überwiesen'], bill: ['{EMO} {MER} hat {AMT} abgebucht'] },
    trailer: { limit: ['Verfügbarer Verfügungsrahmen: {BAL}.'], threshold: ['Benachrichtigung ab {THR} aktiviert.'], link: ['Mehr in der App: {DOMAIN}/umsatz'] },
  },
  fr: {
    push: { cnp: ['{EMO} {AMT} payés en ligne chez {MER}'], atm: ['{EMO} Vous avez retiré {AMT}'], refund: ['{EMO} Remboursement de {MER} : {AMT}'], fee: ['{EMO} Nous avons prélevé {AMT} de frais'], outgoing: ['{EMO} {AMT} envoyés à {CP}'], bill: ['{EMO} {MER} a prélevé {AMT}'] },
    trailer: { limit: ['Plafond de paiement restant : {BAL}.'], threshold: ['Alerte activée pour les opérations de plus de {THR}.'], link: ['Plus d\'infos : {DOMAIN}/operations'] },
    neg: { statement: ['a|Relevé disponible : montant dû {AMT}, paiement minimum {MIN}, échéance le {DUE}.'] },
  },
  nl: {
    headline: { cnp: ['Internetaankoop {AMT} - {MER}'], atm: ['Opname {AMT}[ - {INS}]'], refund: ['Retour {AMT} - {MER}'], fee: ['Kosten afgeschreven {AMT}'], outgoing: ['Overboeking {AMT} - {CP}'], bill: ['Automatische incasso {AMT} - {MER}'] },
    push: { cnp: ['{EMO} {AMT} online betaald bij {MER}'], atm: ['{EMO} Geldopname {AMT}'], refund: ['{EMO} Terugbetaling van {MER}: {AMT}'], fee: ['{EMO} Je betaalde {AMT} kosten'], outgoing: ['{EMO} {AMT} overgemaakt naar {CP}'], bill: ['{EMO} {MER} schreef {AMT} af'] },
    fields: { title: { cnp: ['Internetaankoop'], atm: ['Opname'], refund: ['Retour'], fee: ['Kosten afgeschreven'], outgoing: ['Geld overgemaakt'], bill: ['Automatische incasso'] }, amount: ['Transactiebedrag'], place: ['Geldautomaat'], date: ['Op'] },
    trailer: { limit: ['Beschikbare bestedingsruimte: {BAL}.'], fraud: ['Ken je deze betaling niet? Bel ons op {PHONE}.'], threshold: ['Melding ingesteld voor bedragen boven {THR}.'], optout: ['Meldingen uitzetten kan in de app.'], link: ['Meer info: {DOMAIN}/transacties'] },
    neg: { statement: ['a|Je creditcardafschrift: openstaand {AMT}, minimum {MIN}, uiterlijk {DUE}.'] },
  },
  es: {
    headline: { cnp: ['Pago por internet {AMT} - {MER}'], atm: ['Reintegro {AMT}[ - {INS}]'], refund: ['Abono por devolución {AMT} - {MER}'], fee: ['Comisión cobrada {AMT}'], outgoing: ['Bizum enviado {AMT} - {CP}'], bill: ['Cargo de recibo {AMT} - {MER}'] },
    push: { cnp: ['{EMO} {AMT} pagados online en {MER}'], atm: ['{EMO} Retirada de {AMT} en cajero'], refund: ['{EMO} Devolución de {MER}: {AMT}'], fee: ['{EMO} Te hemos cobrado {AMT} de comisión'], outgoing: ['{EMO} {AMT} enviados a {CP}'], bill: ['{EMO} {MER} te ha cobrado {AMT}'] },
    fields: { title: { cnp: ['Pago por internet'], atm: ['Reintegro en cajero'], refund: ['Abono por devolución'], fee: ['Cargo por comisión'], outgoing: ['Bizum enviado'], bill: ['Cargo de recibo'] }, place: ['Ubicación'], date: ['Fecha operación'] },
    trailer: { limit: ['Límite disponible: {BAL}.'], fraud: ['Si no reconoces esta operación, llama al {PHONE}.'], threshold: ['Aviso configurado para importes superiores a {THR}.'], optout: ['Gestiona tus avisos en la app.'], link: ['Consulta el detalle: {DOMAIN}/movimientos'] },
    neg: { statement: ['a|Liquidación de tarjeta: importe pendiente {AMT}, mínimo {MIN}, vence el {DUE}.'] },
  },
  pt: {
    headline: { cnp: ['Pagamento online {AMT} - {MER}'], atm: ['Levantamento Multibanco {AMT}'], refund: ['Reembolso {AMT} - {MER}'], fee: ['Comissão cobrada {AMT}'], incoming: ['Recebeu {AMT} - {CP}'], outgoing: ['MB WAY enviado {AMT} - {CP}'], bill: ['Pagamento de serviços {AMT} - {MER}'] },
    push: { cnp: ['{EMO} {AMT} pagos online em {MER}'], atm: ['{EMO} Levantamento de {AMT}'], refund: ['{EMO} Reembolso de {MER}: {AMT}'], fee: ['{EMO} Cobrámos {AMT} de comissão'], outgoing: ['{EMO} {AMT} enviados para {CP}'], bill: ['{EMO} {MER} debitou {AMT}'] },
    fields: { title: { purchase: ['Pagamento com cartão'], cnp: ['Pagamento online'], atm: ['Levantamento Multibanco'], refund: ['Reembolso'], fee: ['Comissão cobrada'], incoming: ['Crédito na conta'], outgoing: ['Débito na conta'], bill: ['Pagamento de serviços'] }, place: ['Caixa'], date: ['Data do movimento'] },
    trailer: { limit: ['Limite disponível: {BAL}.'], fraud: ['Se não reconhece este movimento, ligue {PHONE}.'], threshold: ['Alerta para movimentos acima de {THR}.'], optout: ['Pode desativar alertas na app.'], link: ['Mais informação: {DOMAIN}/movimentos'] },
    neg: { statement: ['a|Extrato do cartão: saldo em dívida {AMT}, mínimo {MIN}, data limite {DUE}.'] },
  },
  it: {
    headline: { cnp: ['Pagamento online {AMT} - {MER}'], atm: ['Prelievo bancomat {AMT}'], refund: ['Storno {AMT} - {MER}'], fee: ['Commissione addebitata {AMT}'], incoming: ['Accredito {AMT} - {CP}'], outgoing: ['Bonifico eseguito {AMT} - {CP}'], bill: ['Bolletta pagata {AMT} - {MER}'] },
    push: { cnp: ['{EMO} {AMT} pagati online su {MER}'], atm: ['{EMO} Prelievo di {AMT}'], refund: ['{EMO} Rimborso da {MER}: {AMT}'], fee: ['{EMO} Ti abbiamo addebitato {AMT} di commissione'], outgoing: ['{EMO} {AMT} inviati a {CP}'], bill: ['{EMO} {MER} ha addebitato {AMT}'] },
    fields: { title: { purchase: ['Acquisto con carta'], cnp: ['Pagamento online'], atm: ['Prelievo bancomat'], refund: ['Storno'], fee: ['Commissione addebitata'], incoming: ['Accredito'], outgoing: ['Bonifico eseguito'], bill: ['Bolletta pagata'] }, amount: ['Importo operazione'], place: ['ATM'], date: ['Data operazione'] },
    trailer: { limit: ['Plafond residuo: {BAL}.'], fraud: ['Se non riconosci l\'operazione chiama il {PHONE}.'], threshold: ['Avviso attivo per importi oltre {THR}.'], optout: ['Gestisci gli avvisi nell\'app.'], link: ['Maggiori informazioni: {DOMAIN}/movimenti'] },
    neg: { statement: ['a|Estratto conto: saldo dovuto {AMT}, minimo {MIN} entro il {DUE}.'] },
  },
  pl: {
    headline: { purchase: ['Zakup kartą {AMT} - {MER}'], cnp: ['Płatność w internecie {AMT} - {MER}'], atm: ['Wypłata gotówki {AMT}'], refund: ['Zwrot środków {AMT} - {MER}'], fee: ['Pobrano opłatę {AMT}'], incoming: ['Przelew przychodzący {AMT} - {CP}'], outgoing: ['Przelew wysłany {AMT} - {CP}'], bill: ['Zapłacono rachunek {AMT} - {MER}'] },
    push: { purchase: ['{EMO} {AMT} w {MER}'], cnp: ['{EMO} {AMT} zapłacone online w {MER}'], atm: ['{EMO} Wypłata gotówki {AMT}'], refund: ['{EMO} {MER} zwrócił {AMT}'], fee: ['{EMO} Pobraliśmy opłatę {AMT}'], outgoing: ['{EMO} Przelew {AMT} do {CP} wysłany'], bill: ['{EMO} Rachunek {MER} {AMT} opłacony'] },
    fields: { title: { purchase: ['Zakup kartą'], cnp: ['Płatność w internecie'], atm: ['Wypłata gotówki'], refund: ['Zwrot środków'], fee: ['Pobrano opłatę'], incoming: ['Przelew przychodzący'], outgoing: ['Przelew wysłany'], bill: ['Zapłacono rachunek'] }, amount: ['Kwota transakcji'], place: ['Lokalizacja'], date: ['Data operacji'] },
    trailer: { limit: ['Wolne środki na karcie: {BAL}.'], fraud: ['Nie rozpoznajesz transakcji? Zadzwoń {PHONE}.'], threshold: ['Powiadomienie dla kwot powyżej {THR}.'], optout: ['Powiadomienia zmienisz w aplikacji.'], link: ['Więcej: {DOMAIN}/historia'] },
    neg: { statement: ['a|Wyciąg z karty: do spłaty {AMT}, minimum {MIN}, termin {DUE}.'] },
  },
  cs: {
    headline: { purchase: ['Nákup kartou {AMT} - {MER}'], cnp: ['Nákup na internetu {AMT} - {MER}'], atm: ['Výběr hotovosti {AMT}'], refund: ['Refundace {AMT} - {MER}'], fee: ['Stržen poplatek {AMT}'], incoming: ['Připsána platba {AMT} - {CP}'], outgoing: ['Odeslaná platba {AMT} - {CP}'], bill: ['Zaplaceno inkaso {AMT} - {MER}'] },
    push: { purchase: ['{EMO} {AMT} u {MER}'], cnp: ['{EMO} {AMT} zaplaceno online u {MER}'], atm: ['{EMO} Výběr hotovosti {AMT}'], refund: ['{EMO} Refundace od {MER}: {AMT}'], fee: ['{EMO} Strhli jsme poplatek {AMT}'], outgoing: ['{EMO} Platba {AMT} pro {CP} odeslána'], bill: ['{EMO} {MER} strhl {AMT}'] },
    fields: { title: { purchase: ['Nákup kartou'], cnp: ['Nákup na internetu'], atm: ['Výběr hotovosti'], refund: ['Refundace'], fee: ['Stržen poplatek'], incoming: ['Připsána platba'], outgoing: ['Odeslaná platba'], bill: ['Zaplaceno inkaso'] }, amount: ['Částka transakce'], place: ['Místo výběru'], date: ['Datum transakce'] },
    trailer: { limit: ['Volný limit karty: {BAL}.'], fraud: ['Neznáte tuto platbu? Volejte {PHONE}.'], threshold: ['Upozornění pro částky nad {THR}.'], optout: ['Upozornění upravíte v aplikaci.'], link: ['Více: {DOMAIN}/pohyby'] },
    neg: { statement: ['a|Výpis karty: k úhradě {AMT}, minimum {MIN}, splatnost {DUE}.'] },
  },
  sv: {
    headline: { purchase: ['Köp {AMT} - {MER}'], cnp: ['Internetköp {AMT} - {MER}'], atm: ['Kontantuttag {AMT}'], refund: ['Retur {AMT} - {MER}'], fee: ['Avgift dragen {AMT}'], incoming: ['Pengar in {AMT} - {CP}'], outgoing: ['Swish skickad {AMT} - {CP}'], bill: ['Räkning betald {AMT} - {MER}'] },
    push: { purchase: ['{EMO} {AMT} hos {MER}'], cnp: ['{EMO} {AMT} betalat online hos {MER}'], atm: ['{EMO} Kontantuttag {AMT}'], refund: ['{EMO} Retur från {MER}: {AMT}'], fee: ['{EMO} Vi drog en avgift på {AMT}'], outgoing: ['{EMO} {AMT} skickat till {CP}'], bill: ['{EMO} {MER} drog {AMT}'] },
    fields: { title: { purchase: ['Köp med kort'], cnp: ['Onlineköp'], atm: ['Kontantuttag'], refund: ['Retur'], fee: ['Avgift dragen'], incoming: ['Pengar in'], outgoing: ['Pengar ut'], bill: ['Räkning betald'] }, amount: ['Summa'], place: ['Bankomat'], date: ['Transaktionsdatum'] },
    trailer: { limit: ['Kvar att handla för: {BAL}.'], fraud: ['Känner du inte igen köpet? Ring {PHONE}.'], threshold: ['Avisering för belopp över {THR}.'], optout: ['Ändra aviseringar i appen.'], link: ['Mer info: {DOMAIN}/kontohandelser'] },
    neg: { statement: ['a|Kortfaktura: att betala {AMT}, minsta belopp {MIN}, förfaller {DUE}.'] },
  },
  da: {
    headline: { purchase: ['Køb {AMT} - {MER}'], cnp: ['Nethandel {AMT} - {MER}'], atm: ['Kontanthævning {AMT}'], refund: ['Refusion {AMT} - {MER}'], fee: ['Gebyr trukket {AMT}'], incoming: ['Penge modtaget {AMT} - {CP}'], outgoing: ['MobilePay sendt {AMT} - {CP}'], bill: ['Regning betalt {AMT} - {MER}'] },
    push: { purchase: ['{EMO} {AMT} hos {MER}'], cnp: ['{EMO} {AMT} betalt online hos {MER}'], atm: ['{EMO} Kontanthævning {AMT}'], refund: ['{EMO} Refusion fra {MER}: {AMT}'], fee: ['{EMO} Vi har trukket et gebyr på {AMT}'], outgoing: ['{EMO} {AMT} sendt til {CP}'], bill: ['{EMO} {MER} trak {AMT}'] },
    fields: { title: { purchase: ['Køb med kort'], cnp: ['Onlinekøb'], atm: ['Kontanthævning'], refund: ['Refusion'], fee: ['Gebyr trukket'], incoming: ['Penge modtaget'], outgoing: ['Penge sendt'], bill: ['Regning betalt'] }, amount: ['Transaktionsbeløb'], place: ['Pengeautomat'], date: ['Bogført'] },
    trailer: { limit: ['Rådighed på kortet: {BAL}.'], fraud: ['Kender du ikke købet? Ring {PHONE}.'], threshold: ['Besked ved beløb over {THR}.'], optout: ['Skift beskeder i appen.'], link: ['Mere info: {DOMAIN}/posteringer'] },
    neg: { statement: ['a|Kortopgørelse: skyldig {AMT}, mindst {MIN}, betales senest {DUE}.'] },
  },
  nb: {
    headline: { purchase: ['Kjøp {AMT} - {MER}'], cnp: ['Netthandel {AMT} - {MER}'], atm: ['Kontantuttak {AMT}'], refund: ['Refusjon {AMT} - {MER}'], fee: ['Gebyr trukket {AMT}'], incoming: ['Penger mottatt {AMT} - {CP}'], outgoing: ['Vipps sendt {AMT} - {CP}'], bill: ['Regning betalt {AMT} - {MER}'] },
    push: { purchase: ['{EMO} {AMT} hos {MER}'], cnp: ['{EMO} {AMT} betalt på nett hos {MER}'], atm: ['{EMO} Kontantuttak {AMT}'], refund: ['{EMO} Refusjon fra {MER}: {AMT}'], fee: ['{EMO} Vi har trukket et gebyr på {AMT}'], outgoing: ['{EMO} {AMT} sendt til {CP}'], bill: ['{EMO} {MER} trakk {AMT}'] },
    fields: { title: { purchase: ['Kjøp med kort'], cnp: ['Netthandel'], atm: ['Kontantuttak'], refund: ['Refusjon'], fee: ['Gebyr trukket'], incoming: ['Penger mottatt'], outgoing: ['Penger sendt'], bill: ['Regning betalt'] }, amount: ['Transaksjonsbeløp'], place: ['Minibank'], date: ['Bokført'] },
    trailer: { limit: ['Disponibel kreditt: {BAL}.'], fraud: ['Kjenner du ikke igjen kjøpet? Ring {PHONE}.'], threshold: ['Varsel for beløp over {THR}.'], optout: ['Endre varsler i appen.'], link: ['Mer info: {DOMAIN}/transaksjoner'] },
    neg: { statement: ['a|Kortfaktura: å betale {AMT}, minstebeløp {MIN}, forfall {DUE}.'] },
  },
};
