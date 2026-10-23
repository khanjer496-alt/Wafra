'use strict';
// Round-2 NEGATIVE kinds, from the english and europe parser-lane reviews:
// shapes the round-1 mutations did not generate. Merged into each language
// pack's `neg` section by generate.cjs. Every kind is labelled
// shouldPost=false; generate.cjs `NEG_ALLOWED` lists the few outcomes that
// are tolerated instead of a FALSE-POST (e.g. a credit-card payment may book
// as kind cardPayment) and the directions that count as WRONG.
//
//   hold       approval / hold continuation after a completed-looking noun phrase
//   renewal    subscription renewal or upcoming charge
//   returned   returned / bounced / reported-as-fraud
//   example    example or sample framing
//   limit      a limit stated as the amount
//   cardpay    paying a credit-card bill (not an expense)
//   ownmove    move between the person's own accounts (not spending/income)
//   unclaimed  P2P money not yet accepted
//   hedge      "may have been used", "might have been"
//   nocharge   "nothing charged"
//   gluedq     a question glued onto the movement ("…, didn't make this?")
//   thirdp2p   someone else sent money to you (an expense booking is WRONG)
//   notyet     not yet arrived / not executed / being sent / tomorrow
//   billrecv   a bill that was received (not income)
//   payeercpt  the payee confirms receiving your payment (income is WRONG)
//
// Slots: {AMT} {MER} {CP} {INS} {DUE} {ISSUER} (card issuer) {BANK} {L4}.
module.exports = {
  en: { neg: {
    hold: [
      "c|A charge of {AMT} at {MER} requires approval.",
      "c|A charge of {AMT} at {MER} may appear on your {INS}.",
      "c|A charge of {AMT} at {MER} was approved. It may take 2 days to post.",
      "c|A purchase of {AMT} at {MER} was approved, subject to final settlement.",
      "c|A charge of {AMT} at {MER} was approved. Final amount will be updated.",
      "c|Your {INS} has been used for {AMT} at {MER} for card verification.",
      "c|A charge of {AMT} at {MER} is waiting for your approval.",
    ],
    renewal: [
      "a|Your {MER} subscription of {AMT} renews on {DUE}.",
      "a|A charge of {AMT} at {MER} is coming up.",
      "a|{MER}: your free trial ends soon, then {AMT} per month.",
      "a|A charge of {AMT} at {MER} renews tomorrow.",
    ],
    returned: [
      "x|Your {AMT} payment to {MER} was sent back to you.",
      "x|You've sent {AMT} to {CP} but it bounced back.",
      "c|A charge of {AMT} at {MER} was reported as fraud.",
      "c|Debit card payment of {AMT} at {MER} was returned.",
      "x|You've received {AMT} from {CP}. It was returned to sender.",
    ],
    example: [
      "a|Example: A charge of {AMT} at {MER} was approved.",
      "a|For example, a charge of {AMT} at {MER} will show like this.",
      "a|Sample alert. You made a {AMT} purchase at {MER}.",
    ],
    limit: [
      "a|ATM withdrawal of {AMT} daily limit applies.",
      "a|ATM withdrawal of {AMT} limit reached for today.",
      "a|Contactless payments of up to {AMT} are available with your new card.",
      "a|Your daily card spending limit of {AMT} has been reached.",
    ],
    cardpay: [
      "a|Your bill payment of {AMT} to {ISSUER} was completed.",
      "a|Your {AMT} payment to {ISSUER} was sent.",
      "a|You transferred {AMT} to your {BANK} credit card.",
      "a|You sent {AMT} to your {ISSUER} card ending {L4}.",
      "a|Online bill payment of {AMT} to {ISSUER} was deducted from your account.",
    ],
    ownmove: [
      "a|You transferred {AMT} to your savings account.",
      "a|You sent {AMT} to your Savings account.",
      "a|You've sent {AMT} to your Savings pot.",
      "a|You received {AMT} from your Savings account into your Checking.",
    ],
    unclaimed: [
      "a|{CP} sent you {AMT}. Accept it?",
      "a|{CP} sent you {AMT} and is waiting for you to enroll.",
      "a|You received {AMT} from {CP}. Accept within 7 days.",
      "a|You received {AMT} via Zelle. Enroll to receive it.",
    ],
    hedge: [
      "c|Your {INS} may have been used for {AMT} at {MER}.",
      "c|Your {INS} might have been charged {AMT} at {MER}.",
      "c|It looks like {AMT} may have been spent at {MER} with your {INS}.",
    ],
    nocharge: [
      "a|We have charged nothing from your account for {AMT}.",
      "c|Nothing was charged to your {INS} for the {AMT} order at {MER}.",
      "c|You have not been charged {AMT} by {MER}.",
    ],
    gluedq: [
      "c|Your {INS} has been used for {AMT} at {MER}, didn't make this?",
      "c|Your {INS} was used for {AMT} at {MER} or was it not you?",
      "c|{AMT} at {MER} on your {INS}, or did you not make it?",
      "c|Your {INS} has been used for {AMT} at {MER}, really not you?",
    ],
    notyet: [
      "x|Your transfer of {AMT} to {CP} has not arrived yet.",
      "x|Your payment of {AMT} to {CP} is being sent.",
      "x|Your direct debit of {AMT} to {MER} will be taken tomorrow.",
    ],
    billrecv: [
      "a|You have received a new bill from {MER} for {AMT}, due {DUE}.",
      "a|New bill received: {MER}, {AMT}, due {DUE}.",
    ],
    payeercpt: [
      "x|{CP} has received your {AMT} transfer.",
      "x|{CP} received your payment of {AMT}.",
    ],
  } },

  ar: { neg: {
    hold: ["c|عملية شراء بمبلغ {AMT} لدى {MER} بانتظار موافقتك.", "c|تمت الموافقة على عملية بمبلغ {AMT} لدى {MER}، وقد يستغرق قيدها يومين.", "c|عملية بمبلغ {AMT} لدى {MER} خاضعة للتسوية النهائية."],
    renewal: ["a|سيتم تجديد اشتراكك في {MER} بمبلغ {AMT} بتاريخ {DUE}.", "a|تنتهي الفترة التجريبية في {MER} قريباً، ثم {AMT} شهرياً."],
    returned: ["x|ارتدت حوالتك بمبلغ {AMT} إلى {CP} ولم تتم.", "c|تم الإبلاغ عن عملية {AMT} لدى {MER} كعملية احتيال."],
    example: ["a|مثال: عملية شراء بمبلغ {AMT} لدى {MER}.", "a|على سبيل المثال، ستظهر عملية شراء بمبلغ {AMT} لدى {MER} هكذا."],
    limit: ["a|سحب نقدي حتى {AMT}: تم بلوغ الحد اليومي.", "a|الحد اليومي للمشتريات {AMT} لبطاقتك الجديدة."],
    cardpay: ["a|تم سداد {AMT} لبطاقتك الائتمانية من {BANK}.", "a|تم دفع {AMT} إلى {ISSUER} لسداد مستحقات البطاقة."],
    ownmove: ["a|تم تحويل {AMT} إلى حساب التوفير الخاص بك.", "a|تحويل بين حساباتك: {AMT} إلى حساب الادخار."],
    unclaimed: ["a|أرسل لك {CP} مبلغ {AMT}. هل تقبله؟", "a|أرسل لك {CP} مبلغ {AMT}؛ سجّل لاستلامه خلال 7 أيام."],
    hedge: ["c|ربما تم استخدام {INS} لعملية بمبلغ {AMT} لدى {MER}.", "c|قد يكون تم خصم {AMT} لدى {MER}."],
    nocharge: ["a|لم يتم خصم أي مبلغ لطلبك بقيمة {AMT}.", "c|لم يقم {MER} بخصم {AMT}."],
    gluedq: ["c|تم استخدام {INS} بمبلغ {AMT} لدى {MER}، ألست أنت؟", "c|{AMT} لدى {MER} عبر {INS}، أم لم تكن أنت؟"],
    notyet: ["x|لم تصل حوالتك بمبلغ {AMT} إلى {CP} بعد.", "x|جارٍ إرسال حوالتك بمبلغ {AMT} إلى {CP}."],
    billrecv: ["a|وصلتك فاتورة جديدة من {MER} بمبلغ {AMT} مستحقة في {DUE}.", "a|فاتورة جديدة: {MER}، {AMT}."],
    payeercpt: ["x|استلم {CP} حوالتك بمبلغ {AMT}.", "x|تم استلام {CP} لمبلغ {AMT} منك."],
  } },

  de: { neg: {
    hold: ["c|Eine Kartenzahlung über {AMT} bei {MER} muss noch freigegeben werden.", "c|Eine Zahlung über {AMT} bei {MER} wurde autorisiert; die Buchung kann 2 Tage dauern.", "c|Kartenzahlung über {AMT} bei {MER} genehmigt, vorbehaltlich der endgültigen Abrechnung."],
    renewal: ["a|Ihr Abo bei {MER} über {AMT} verlängert sich am {DUE}.", "a|Ihre Testphase bei {MER} endet bald, danach {AMT} pro Monat."],
    returned: ["x|Ihre Überweisung über {AMT} an {CP} wurde zurückgebucht.", "c|Die Kartenzahlung über {AMT} bei {MER} wurde als Betrug gemeldet.", "x|Die Lastschrift über {AMT} von {MER} ist zurückgegangen."],
    example: ["a|Beispiel: Kartenzahlung über {AMT} bei {MER}.", "a|Muster-Benachrichtigung: Sie haben {AMT} bei {MER} bezahlt."],
    limit: ["a|Bargeldabhebung bis {AMT} täglich möglich.", "a|Ihr Tageslimit von {AMT} für Kartenzahlungen ist erreicht."],
    cardpay: ["a|Ihre Zahlung über {AMT} an Ihre {BANK} Kreditkarte wurde ausgeführt.", "a|Kreditkartenabrechnung {ISSUER}: {AMT} wurden von Ihrem Girokonto ausgeglichen."],
    ownmove: ["a|Sie haben {AMT} auf Ihr Tagesgeldkonto übertragen.", "a|Umbuchung von {AMT} auf Ihr Sparkonto ausgeführt.", "a|Du hast {AMT} in deinen Space „Urlaub“ verschoben."],
    unclaimed: ["a|{CP} hat dir {AMT} gesendet. Jetzt annehmen?", "a|{CP} möchte dir {AMT} senden. Registriere dich, um das Geld zu erhalten."],
    hedge: ["c|Ihre {INS} wurde möglicherweise für {AMT} bei {MER} verwendet.", "c|Eventuell wurden {AMT} bei {MER} mit Ihrer {INS} belastet."],
    nocharge: ["a|Es wurden keine {AMT} von Ihrem Konto abgebucht.", "c|Für die Bestellung über {AMT} bei {MER} wurde nichts belastet."],
    gluedq: ["c|Ihre {INS} wurde mit {AMT} bei {MER} belastet, waren Sie das nicht?", "c|{AMT} bei {MER} mit Ihrer {INS} – oder waren Sie es nicht?"],
    notyet: ["x|Ihre Überweisung über {AMT} an {CP} ist noch nicht eingegangen.", "x|Ihre Zahlung über {AMT} an {CP} wird gesendet.", "x|Die Lastschrift über {AMT} von {MER} wird morgen abgebucht."],
    billrecv: ["a|Sie haben eine neue Rechnung von {MER} über {AMT} erhalten, fällig am {DUE}.", "a|Neue Rechnung eingegangen: {MER}, {AMT}."],
    payeercpt: ["x|{CP} hat Ihre Zahlung über {AMT} erhalten.", "x|{CP} hat deine Überweisung über {AMT} empfangen."],
  } },

  fr: { neg: {
    hold: ["c|Un paiement de {AMT} chez {MER} nécessite votre validation.", "c|Un paiement de {AMT} chez {MER} a été autorisé ; il peut apparaître sous 2 jours.", "c|Paiement de {AMT} chez {MER} accepté, sous réserve du montant définitif."],
    renewal: ["a|Votre abonnement {MER} de {AMT} sera renouvelé le {DUE}.", "a|Votre essai gratuit {MER} se termine bientôt, ensuite {AMT} par mois."],
    returned: ["x|Votre virement de {AMT} à {CP} a été rejeté et vous a été retourné.", "c|Le paiement de {AMT} chez {MER} a été signalé comme frauduleux."],
    example: ["a|Exemple : paiement par carte de {AMT} chez {MER}.", "a|Par exemple, un achat de {AMT} chez {MER} s'affichera ainsi."],
    limit: ["a|Retrait de {AMT} : plafond journalier atteint.", "a|Paiements sans contact jusqu'à {AMT} disponibles avec votre nouvelle carte."],
    cardpay: ["a|Votre remboursement de {AMT} sur votre carte de crédit {BANK} a été effectué.", "a|Paiement de {AMT} à {ISSUER} pour votre relevé de carte effectué."],
    ownmove: ["a|Vous avez transféré {AMT} vers votre Livret A.", "a|Virement interne de {AMT} vers votre compte épargne effectué."],
    unclaimed: ["a|{CP} vous a envoyé {AMT}. Acceptez-le ?", "a|{CP} vous a envoyé {AMT} ; créez votre compte pour le recevoir."],
    hedge: ["c|Votre {INS} a peut-être été utilisée pour {AMT} chez {MER}.", "c|Un paiement de {AMT} chez {MER} aurait pu être effectué avec votre {INS}."],
    nocharge: ["a|Aucun montant n'a été prélevé pour la commande de {AMT}.", "c|Rien n'a été débité pour {AMT} chez {MER}."],
    gluedq: ["c|Votre {INS} a été débitée de {AMT} chez {MER}, ce n'est pas vous ?", "c|{AMT} chez {MER} avec votre {INS}, ou n'était-ce pas vous ?"],
    notyet: ["x|Votre virement de {AMT} à {CP} n'a pas pu être effectué.", "x|Votre virement de {AMT} à {CP} est en cours d'envoi.", "x|Le prélèvement de {AMT} de {MER} sera débité demain."],
    billrecv: ["a|Vous avez reçu une nouvelle facture {MER} de {AMT}, à régler avant le {DUE}.", "a|Nouvelle facture reçue : {MER}, {AMT}."],
    payeercpt: ["x|{CP} a bien reçu votre virement de {AMT}.", "x|{CP} a reçu votre paiement de {AMT}."],
  } },

  nl: { neg: {
    hold: ["c|Een betaling van {AMT} bij {MER} moet nog worden goedgekeurd.", "c|Betaling van {AMT} bij {MER} geautoriseerd; verwerking kan 2 dagen duren."],
    renewal: ["a|Je abonnement bij {MER} van {AMT} wordt verlengd op {DUE}.", "a|Je proefperiode bij {MER} eindigt binnenkort, daarna {AMT} per maand."],
    returned: ["x|Je overboeking van {AMT} naar {CP} is teruggestort.", "c|De betaling van {AMT} bij {MER} is gemeld als fraude."],
    example: ["a|Voorbeeld: betaling van {AMT} bij {MER}.", "a|Bijvoorbeeld: je hebt {AMT} betaald bij {MER}."],
    limit: ["a|Geldopname van {AMT}: daglimiet bereikt.", "a|Contactloos betalen tot {AMT} is beschikbaar met je nieuwe pas."],
    cardpay: ["a|Je betaling van {AMT} aan je {BANK} creditcard is uitgevoerd.", "a|Aflossing creditcard {ISSUER}: {AMT} overgemaakt."],
    ownmove: ["a|Je hebt {AMT} overgezet naar je spaarrekening.", "a|{AMT} verplaatst naar je Spaarpotje."],
    unclaimed: ["a|{CP} heeft je {AMT} gestuurd. Accepteren?", "a|{CP} wil je {AMT} sturen. Meld je aan om het geld te ontvangen."],
    hedge: ["c|Je {INS} is mogelijk gebruikt voor {AMT} bij {MER}.", "c|Er is misschien {AMT} afgeschreven bij {MER}."],
    nocharge: ["a|Er is niets afgeschreven voor de bestelling van {AMT}.", "c|Er is geen {AMT} afgeschreven door {MER}."],
    gluedq: ["c|Je {INS} is gebruikt voor {AMT} bij {MER}, was jij dit niet?", "c|{AMT} bij {MER} met je {INS}, of was jij het niet?"],
    notyet: ["x|Je betaling van {AMT} aan {CP} is nog niet ontvangen.", "x|Je overboeking van {AMT} naar {CP} wordt verzonden."],
    billrecv: ["a|Je hebt een nieuwe rekening van {MER} ontvangen van {AMT}, te betalen voor {DUE}.", "a|Nieuwe factuur ontvangen: {MER}, {AMT}."],
    payeercpt: ["x|{CP} heeft je betaling van {AMT} ontvangen.", "x|{CP} heeft {AMT} van je ontvangen."],
  } },

  es: { neg: {
    hold: ["c|Un cargo de {AMT} en {MER} requiere tu aprobación.", "c|Compra de {AMT} en {MER} autorizada; puede tardar 2 días en reflejarse."],
    renewal: ["a|Tu suscripción a {MER} de {AMT} se renueva el {DUE}.", "a|Tu prueba gratuita de {MER} termina pronto; después {AMT} al mes."],
    returned: ["x|Tu transferencia de {AMT} a {CP} ha sido devuelta.", "c|El cargo de {AMT} en {MER} se ha marcado como fraude."],
    example: ["a|Ejemplo: compra de {AMT} en {MER}.", "a|Por ejemplo, una compra de {AMT} en {MER} aparecerá así."],
    limit: ["a|Retirada de {AMT}: límite diario alcanzado.", "a|Pagos contactless de hasta {AMT} disponibles con tu nueva tarjeta."],
    cardpay: ["a|Has pagado {AMT} a tu tarjeta de crédito {BANK}.", "a|Pago de {AMT} a {ISSUER} para liquidar tu tarjeta realizado."],
    ownmove: ["a|Has traspasado {AMT} a tu cuenta de ahorro.", "a|Traspaso de {AMT} a tu hucha realizado."],
    unclaimed: ["a|{CP} te ha enviado {AMT}. ¿Lo aceptas?", "a|{CP} te ha enviado {AMT}; regístrate en Bizum para recibirlo."],
    hedge: ["c|Tu {INS} podría haberse usado para {AMT} en {MER}.", "c|Es posible que se haya cargado {AMT} en {MER}."],
    nocharge: ["a|No se te ha cobrado nada por el pedido de {AMT}.", "c|{MER} no te ha cobrado {AMT}."],
    gluedq: ["c|Tu {INS} se ha usado para {AMT} en {MER}, ¿no has sido tú?", "c|{AMT} en {MER} con tu {INS}, ¿o no fuiste tú?"],
    notyet: ["x|Tu transferencia de {AMT} a {CP} aún no se ha recibido.", "x|Tu transferencia de {AMT} a {CP} se está enviando."],
    thirdp2p: ["a|{CP} envió {AMT} a tu cuenta.", "a|{CP} ha realizado una transferencia de {AMT} a tu favor."],
    billrecv: ["a|Has recibido una nueva factura de {MER} por {AMT}, vence el {DUE}.", "a|Nueva factura recibida: {MER}, {AMT}."],
    payeercpt: ["x|{CP} ha recibido tu Bizum de {AMT}.", "x|{CP} ha recibido tu transferencia de {AMT}."],
  } },

  pt: { neg: {
    hold: ["c|Uma compra de {AMT} em {MER} aguarda aprovação.", "c|Compra de {AMT} em {MER} autorizada; pode demorar 2 dias a ser lançada."],
    renewal: ["a|A sua subscrição {MER} de {AMT} renova a {DUE}.", "a|O seu período experimental {MER} termina em breve; depois {AMT} por mês."],
    returned: ["x|A sua transferência de {AMT} para {CP} foi devolvida.", "c|A compra de {AMT} em {MER} foi reportada como fraude."],
    example: ["a|Exemplo: compra de {AMT} em {MER}.", "a|Por exemplo, uma compra de {AMT} em {MER} aparece assim."],
    limit: ["a|Levantamento de {AMT}: limite diário atingido.", "a|Pagamentos contactless até {AMT} disponíveis no seu novo cartão."],
    cardpay: ["a|Pagou {AMT} ao seu cartão de crédito {BANK}.", "a|Pagamento de {AMT} a {ISSUER} para o extrato do cartão efetuado."],
    ownmove: ["a|Transferiu {AMT} para a sua conta poupança.", "a|Movimento de {AMT} para o seu mealheiro efetuado."],
    unclaimed: ["a|{CP} enviou-lhe {AMT}. Aceita?", "a|{CP} enviou-lhe {AMT}; ative o MB WAY para receber."],
    hedge: ["c|O seu {INS} pode ter sido usado para {AMT} em {MER}.", "c|É possível que tenham sido debitados {AMT} em {MER}."],
    nocharge: ["a|Não foi cobrado nada pela encomenda de {AMT}.", "c|{MER} não lhe cobrou {AMT}."],
    gluedq: ["c|O seu {INS} foi usado para {AMT} em {MER}, não foi você?", "c|{AMT} em {MER} com o seu {INS}, ou não foi você?"],
    notyet: ["x|A sua transferência de {AMT} para {CP} ainda não foi recebida.", "x|A sua transferência de {AMT} para {CP} está a ser enviada."],
    thirdp2p: ["a|{CP} enviou um Pix de {AMT} para você.", "a|{CP} transferiu {AMT} para a sua conta.", "a|{CP} enviou {AMT} por MB WAY para si."],
    billrecv: ["a|Recebeu a fatura {MER} de {AMT}, a pagar até {DUE}.", "a|Nova fatura recebida: {MER}, {AMT}."],
    payeercpt: ["x|{CP} recebeu a sua transferência de {AMT}.", "x|{CP} recebeu o seu pagamento de {AMT}."],
  } },

  it: { neg: {
    hold: ["c|Un addebito di {AMT} presso {MER} richiede la tua approvazione.", "c|Pagamento di {AMT} presso {MER} autorizzato; la contabilizzazione può richiedere 2 giorni."],
    renewal: ["a|Il tuo abbonamento {MER} di {AMT} si rinnova il {DUE}.", "a|La prova gratuita di {MER} termina presto, poi {AMT} al mese."],
    returned: ["x|Il tuo bonifico di {AMT} a {CP} è stato restituito.", "c|Il pagamento di {AMT} presso {MER} è stato segnalato come frode."],
    example: ["a|Esempio: pagamento di {AMT} presso {MER}.", "a|Ad esempio, un acquisto di {AMT} da {MER} apparirà così."],
    limit: ["a|Prelievo di {AMT}: limite giornaliero raggiunto.", "a|Pagamenti contactless fino a {AMT} disponibili con la nuova carta."],
    cardpay: ["a|Hai pagato {AMT} alla tua carta di credito {BANK}.", "a|Pagamento di {AMT} a {ISSUER} per il saldo della carta eseguito."],
    ownmove: ["a|Hai trasferito {AMT} sul tuo conto deposito.", "a|Giroconto di {AMT} verso il tuo salvadanaio eseguito."],
    unclaimed: ["a|{CP} ti ha inviato {AMT}. Vuoi accettarli?", "a|{CP} ti ha inviato {AMT}; registrati per riceverli."],
    hedge: ["c|La tua {INS} potrebbe essere stata usata per {AMT} presso {MER}.", "c|Forse sono stati addebitati {AMT} da {MER}."],
    nocharge: ["a|Non ti è stato addebitato nulla per l'ordine di {AMT}.", "c|{MER} non ti ha addebitato {AMT}."],
    gluedq: ["c|La tua {INS} è stata usata per {AMT} presso {MER}, non sei stato tu?", "c|{AMT} presso {MER} con la tua {INS}, o non eri tu?"],
    notyet: ["x|Il tuo bonifico di {AMT} a {CP} non è ancora arrivato.", "x|Il tuo bonifico di {AMT} a {CP} è in fase di invio."],
    thirdp2p: ["a|{CP} ha inviato {AMT} sul tuo conto.", "a|{CP} ti ha fatto un bonifico di {AMT}."],
    billrecv: ["a|Hai ricevuto una nuova bolletta {MER} di {AMT}, scadenza {DUE}.", "a|Nuova fattura ricevuta: {MER}, {AMT}."],
    payeercpt: ["x|{CP} ha ricevuto il tuo bonifico di {AMT}.", "x|{CP} ha ricevuto il tuo pagamento di {AMT}."],
  } },

  pl: { neg: {
    hold: ["c|Transakcja {AMT} w {MER} wymaga Twojej akceptacji.", "c|Transakcja {AMT} w {MER} autoryzowana; zaksięgowanie może potrwać 2 dni."],
    renewal: ["a|Subskrypcja {MER} za {AMT} odnowi się {DUE}.", "a|Okres próbny {MER} wkrótce się kończy, potem {AMT} miesięcznie."],
    returned: ["x|Przelew {AMT} do {CP} został zwrócony.", "c|Transakcja {AMT} w {MER} została zgłoszona jako oszustwo."],
    example: ["a|Przykład: płatność kartą {AMT} w {MER}.", "a|Na przykład zakup {AMT} w {MER} będzie wyglądał tak."],
    limit: ["a|Wypłata {AMT}: osiągnięto dzienny limit.", "a|Płatności zbliżeniowe do {AMT} dostępne z nową kartą."],
    cardpay: ["a|Spłaciłeś {AMT} na kartę kredytową {BANK}.", "a|Spłata karty {ISSUER}: {AMT} przelano."],
    ownmove: ["a|Przelałeś {AMT} na swoje konto oszczędnościowe.", "a|Przelew własny {AMT} na rachunek oszczędnościowy wykonany."],
    unclaimed: ["a|{CP} wysłał Ci {AMT}. Przyjmij przelew.", "a|{CP} wysłał Ci {AMT} na telefon; zarejestruj BLIK, aby odebrać."],
    hedge: ["c|Twoja karta {INS} mogła zostać użyta do transakcji {AMT} w {MER}.", "c|Możliwe, że pobrano {AMT} w {MER}."],
    nocharge: ["a|Nie pobrano żadnej kwoty za zamówienie {AMT}.", "c|{MER} nie pobrał {AMT}."],
    gluedq: ["c|Karta {INS} użyta do transakcji {AMT} w {MER}, to nie Ty?", "c|{AMT} w {MER} kartą {INS}, czy to nie Ty?"],
    notyet: ["x|Przelew {AMT} do {CP} jeszcze nie dotarł.", "x|Przelew {AMT} do {CP} jest w trakcie wysyłania."],
    billrecv: ["a|Otrzymałeś fakturę od {MER} na kwotę {AMT}, termin płatności {DUE}.", "a|Nowa faktura: {MER}, {AMT}."],
    payeercpt: ["x|{CP} otrzymał Twój przelew {AMT}.", "x|{CP} odebrał od Ciebie {AMT}."],
  } },

  cs: { neg: {
    hold: ["c|Platba {AMT} u {MER} čeká na schválení.", "c|Platba {AMT} u {MER} autorizována; zaúčtování může trvat 2 dny."],
    renewal: ["a|Předplatné {MER} za {AMT} se obnoví {DUE}.", "a|Zkušební verze {MER} brzy končí, poté {AMT} měsíčně."],
    returned: ["x|Platba {AMT} pro {CP} byla vrácena.", "c|Platba {AMT} u {MER} byla nahlášena jako podvod."],
    example: ["a|Příklad: platba kartou {AMT} u {MER}.", "a|Například nákup {AMT} u {MER} se zobrazí takto."],
    limit: ["a|Výběr {AMT}: denní limit dosažen.", "a|Bezkontaktní platby do {AMT} s novou kartou."],
    cardpay: ["a|Splátka kreditní karty {BANK} ve výši {AMT} provedena.", "a|Úhrada {AMT} na kartu {ISSUER} provedena."],
    ownmove: ["a|Převedli jste {AMT} na svůj spořicí účet.", "a|Převod {AMT} mezi vlastními účty proveden."],
    unclaimed: ["a|{CP} vám poslal {AMT}. Přijmout?", "a|{CP} vám poslal {AMT}; pro přijetí se zaregistrujte."],
    hedge: ["c|Vaše karta {INS} mohla být použita na {AMT} u {MER}.", "c|Možná bylo strženo {AMT} u {MER}."],
    nocharge: ["a|Za objednávku {AMT} nebylo nic strženo.", "c|{MER} vám nestrhl {AMT}."],
    gluedq: ["c|Karta {INS} použita na {AMT} u {MER}, nebyli jste to vy?", "c|{AMT} u {MER} kartou {INS}, nebo jste to nebyli vy?"],
    notyet: ["x|Platba {AMT} pro {CP} neproběhla.", "x|Platba {AMT} pro {CP} se odesílá."],
    billrecv: ["a|Obdrželi jste novou fakturu od {MER} na {AMT}, splatnost {DUE}.", "a|Nová faktura: {MER}, {AMT}."],
    payeercpt: ["x|{CP} obdržel vaši platbu {AMT}.", "x|{CP} přijal vaši platbu {AMT}."],
  } },

  sv: { neg: {
    hold: ["c|Ett köp på {AMT} hos {MER} måste godkännas.", "c|Köp på {AMT} hos {MER} godkänt; bokföring kan ta 2 dagar."],
    renewal: ["a|Ditt abonnemang hos {MER} på {AMT} förnyas {DUE}.", "a|Din provperiod hos {MER} tar snart slut, sedan {AMT} per månad."],
    returned: ["x|Din överföring på {AMT} till {CP} har returnerats.", "c|Köpet på {AMT} hos {MER} har anmälts som bedrägeri."],
    example: ["a|Exempel: kortköp {AMT} hos {MER}.", "a|Till exempel visas ett köp på {AMT} hos {MER} så här."],
    limit: ["a|Uttag {AMT}: daglig gräns nådd.", "a|Kontaktlösa köp upp till {AMT} med ditt nya kort."],
    cardpay: ["a|Du har betalat {AMT} till ditt {BANK} kreditkort.", "a|Inbetalning {AMT} till {ISSUER} kortfaktura genomförd."],
    ownmove: ["a|Du har flyttat {AMT} till ditt sparkonto.", "a|Överföring {AMT} mellan egna konton genomförd."],
    unclaimed: ["a|{CP} har skickat {AMT} till dig. Godkänn?", "a|{CP} vill skicka {AMT} till dig. Anslut Swish för att ta emot."],
    hedge: ["c|Ditt {INS} kan ha använts för {AMT} hos {MER}.", "c|Möjligen har {AMT} dragits hos {MER}."],
    nocharge: ["a|Inget har dragits för beställningen på {AMT}.", "c|{MER} har inte dragit {AMT}."],
    gluedq: ["c|Ditt {INS} har använts för {AMT} hos {MER}, var det inte du?", "c|{AMT} hos {MER} med ditt {INS}, eller var det inte du?"],
    notyet: ["x|Din överföring på {AMT} till {CP} har inte kommit fram än.", "x|Din betalning på {AMT} till {CP} skickas."],
    billrecv: ["a|Du har fått en ny faktura från {MER} på {AMT}, förfaller {DUE}.", "a|Ny e-faktura: {MER}, {AMT}."],
    payeercpt: ["x|{CP} har tagit emot din betalning på {AMT}.", "x|{CP} har fått {AMT} från dig."],
  } },

  da: { neg: {
    hold: ["c|Et køb på {AMT} hos {MER} skal godkendes.", "c|Køb på {AMT} hos {MER} godkendt; bogføring kan tage 2 dage."],
    renewal: ["a|Dit abonnement hos {MER} på {AMT} fornyes den {DUE}.", "a|Din prøveperiode hos {MER} slutter snart, derefter {AMT} om måneden."],
    returned: ["x|Din overførsel på {AMT} til {CP} er returneret.", "c|Købet på {AMT} hos {MER} er anmeldt som svindel."],
    example: ["a|Eksempel: kortkøb {AMT} hos {MER}.", "a|For eksempel vises et køb på {AMT} hos {MER} sådan."],
    limit: ["a|Hævning {AMT}: daglig grænse nået.", "a|Kontaktløse betalinger op til {AMT} med dit nye kort."],
    cardpay: ["a|Du har indbetalt {AMT} på dit {BANK} kreditkort.", "a|Betaling {AMT} til {ISSUER} kortopgørelse gennemført."],
    ownmove: ["a|Du har flyttet {AMT} til din opsparingskonto.", "a|Overførsel {AMT} mellem egne konti gennemført."],
    unclaimed: ["a|{CP} har sendt dig {AMT}. Vil du modtage dem?", "a|{CP} vil sende dig {AMT}. Tilmeld MobilePay for at modtage."],
    hedge: ["c|Dit {INS} kan være brugt til {AMT} hos {MER}.", "c|Der er muligvis trukket {AMT} hos {MER}."],
    nocharge: ["a|Der er ikke trukket noget for ordren på {AMT}.", "c|{MER} har ikke trukket {AMT}."],
    gluedq: ["c|Dit {INS} er brugt til {AMT} hos {MER}, var det ikke dig?", "c|{AMT} hos {MER} med dit {INS}, eller var det ikke dig?"],
    notyet: ["x|Din overførsel på {AMT} til {CP} er ikke hævet endnu.", "x|Betalingen på {AMT} til {MER} bliver hævet i morgen."],
    billrecv: ["a|Du har modtaget en ny regning fra {MER} på {AMT}, forfald {DUE}.", "a|Ny regning modtaget: {MER}, {AMT}."],
    payeercpt: ["x|{CP} har modtaget din betaling på {AMT}.", "x|{CP} har fået {AMT} fra dig."],
  } },

  nb: { neg: {
    hold: ["c|Et kjøp på {AMT} hos {MER} må godkjennes.", "c|Kjøp på {AMT} hos {MER} godkjent; bokføring kan ta 2 dager."],
    renewal: ["a|Abonnementet ditt hos {MER} på {AMT} fornyes {DUE}.", "a|Prøveperioden din hos {MER} slutter snart, deretter {AMT} per måned."],
    returned: ["x|Overføringen din på {AMT} til {CP} er returnert.", "c|Kjøpet på {AMT} hos {MER} er meldt som svindel."],
    example: ["a|Eksempel: kortkjøp {AMT} hos {MER}.", "a|For eksempel vises et kjøp på {AMT} hos {MER} slik."],
    limit: ["a|Uttak {AMT}: daglig grense nådd.", "a|Kontaktløse betalinger opptil {AMT} med det nye kortet ditt."],
    cardpay: ["a|Du har betalt {AMT} til {BANK} kredittkortet ditt.", "a|Innbetaling {AMT} til {ISSUER} kortfaktura gjennomført."],
    ownmove: ["a|Du har flyttet {AMT} til sparekontoen din.", "a|Overføring {AMT} mellom egne kontoer gjennomført."],
    unclaimed: ["a|{CP} har sendt deg {AMT}. Vil du ta imot?", "a|{CP} vil sende deg {AMT}. Registrer deg i Vipps for å motta."],
    hedge: ["c|Ditt {INS} kan ha blitt brukt til {AMT} hos {MER}.", "c|Det kan ha blitt trukket {AMT} hos {MER}."],
    nocharge: ["a|Det er ikke trukket noe for bestillingen på {AMT}.", "c|{MER} har ikke trukket {AMT}."],
    gluedq: ["c|Ditt {INS} er brukt til {AMT} hos {MER}, var det ikke deg?", "c|{AMT} hos {MER} med ditt {INS}, eller var det ikke deg?"],
    notyet: ["x|Betalingen på {AMT} til {CP} ble ikke trukket.", "x|Overføringen din på {AMT} til {CP} er ikke kommet fram ennå."],
    billrecv: ["a|Du har mottatt en ny regning fra {MER} på {AMT}, forfall {DUE}.", "a|Ny eFaktura mottatt: {MER}, {AMT}."],
    payeercpt: ["x|{CP} har mottatt betaling på {AMT} fra deg.", "x|{CP} har fått {AMT} fra deg."],
  } },
};
