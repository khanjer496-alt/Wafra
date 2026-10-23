import type { AlertMarketPack } from '@/lib/alert-market-pack-types';

export const US_EU_ALERT_MARKET_PACKS = {
  US: {
    market: 'US', currencies: ['USD'], currencyAliases: { '$': ['USD'] },
    rails: ['ach', 'wire transfer', 'zelle'],
    transferTerms: ['transfer', 'direct deposit', 'zelle', 'venmo', 'cash app'],
    utilityTerms: ['utility', 'electric', 'water bill', 'gas bill'],
    recurringTerms: ['recurring', 'autopay', 'standing instruction'],
  },
  GB: {
    market: 'GB', currencies: ['GBP'], currencyAliases: {},
    rails: ['faster payments', 'bacs', 'chaps'],
    transferTerms: ['bank transfer', 'faster payment', 'faster payments'],
    utilityTerms: ['council tax', 'energy bill', 'water bill', 'mobile bill'],
    recurringTerms: ['recurring', 'standing order'],
  },
  // The FR, DE, ES, IT and NL packs also read French-, German- and
  // Dutch-speaking Belgium, Switzerland, Austria and Luxembourg. Every
  // unrouted alert is read by all language packs (universal-parser.ts), so
  // failed/future terms veto a posting worldwide: they are whole words of
  // this language only. Completion terms are completed verbs, never a bare
  // noun or a heading that comes before the merchant ("Paiement par carte de
  // X chez SHOP", "Compra de X en SHOP"): the merchant extractor can swallow
  // a trailing status ("chez SHOP a été rejeté", "en SHOP ha sido
  // denegada") and that text is masked before these terms are read, so a
  // heading would post the declined payment.
  // Each language's verification question ("avez-vous", "¿has"), money
  // request ("vous demande") and conditional ("si vous") is future, so a
  // question or an offer about a payment is never a posting. Where a verb can
  // name either side ("reçu": "nous avons reçu votre paiement"), the paying
  // side is listed too and the two cancel, leaving direction to the person.
  FR: {
    market: 'FR', currencies: ['EUR'], currencyAliases: {},
    rails: ['sepa'],
    transferTerms: [
      'virement', 'vous a envoyé', 'vous a versé', 'vous avez envoyé', 'virement émis', 'a été crédité',
      'vous avez reçu',
    ],
    utilityTerms: ['électricité', 'gaz', 'eau', 'téléphone'],
    recurringTerms: ['récurrent', 'abonnement'],
    postedTerms: [ 'a été prélevée de',
      'débité', 'débitée', 'crédité', 'créditée', 'effectué', 'effectuée', 'payé', 'payée',
      // Unaccented SMS spellings: "Votre compte 1234 a ete debite de ...".
      'a ete debite', 'a ete credite', 'prélevé', 'prélevée', 'prélevés', 'prélevées',
      'reçu', 'reçue', 'vous a envoyé', 'vous a versé', 'a été traité', 'a été traitée',
      'exécuté', 'exécutée', 'réalisation de votre virement',
     
     
      'vous a remboursé', 'payés', 'payées', 'vous avez retiré', 'vous avez envoyé',
      'ont été prélevés', 'a été effectué',
      'a prélevé', 'a été payée', 'a été crédité',
    ],
    failedTerms: [
      'refusé', 'refusée', 'rejeté', 'rejetée', 'échoué', 'échouée', 'non payé', 'non payée',
      'pas été payé', 'pas été payée', 'non effectué', 'non effectuée', 'non abouti', 'non aboutie',
      'annulé', 'annulée', 'impayé', 'impayée', 'provision insuffisante', 'solde insuffisant',
      'non reçu', 'code de confirmation', 'code de validation', 'ne le communiquez',
      // "Votre virement … n'a pu être effectué", "… n'a pas pu être exécuté".
      "n'a pu", "n’a pu", "n'a pas pu", "n’a pas pu", "n'ont pu", "n'ont pas pu", "n'a pas été",
      "n’a pas été", 'pas été effectué', 'pas été exécuté',
      // Nothing was charged; a limit was reached ("plafond journalier atteint").
      "n'a été", 'n’a été', 'aucun montant', 'aucune somme', 'aucun débit',
      'plafond journalier atteint', 'plafond atteint', 'atteint',
      // A payment reported as fraud is disputed, not booked.
      'fraude', 'signalé comme', 'signalée comme', 'contesté', 'contestée',
      'bloqué', 'bloquée',
    ],
    futureTerms: [
      'sera débité', 'sera crédité', 'à venir', 'sera prélevé', 'sera prélevée', 'sera effectué',
      'sera effectuée', 'sera versé', 'en attente', 'en cours', 'prévu', 'prévue', 'programmé',
      'programmée', 'vous demande', 'demande de paiement', "demande d'argent", 'si vous',
      'lorsque', 'dès que', 'avez-vous', 'est-ce vous', 'confirmez', 'veuillez confirmer',
      'pré-autorisation', 'empreinte',
      // An offer on a later purchase ("prochain") is not a posting.
      'prochain', 'prochaine', 'remise', 'profitez',
      // An example; unclaimed money ("créez votre compte pour le recevoir").
      'par exemple', 'exemple :', 'exemple:', 'pour le recevoir', 'pour recevoir', 'créez votre compte',
      'demande de remboursement', 'en cours de traitement',
      // An authorisation; a payment to the reader's own credit card.
      'autorisé', 'autorisée', 'à votre carte de crédit', 'sur votre carte de crédit',
      // A hedge ("Eventuell wurden …", "Det kan ha blitt trukket …") or a sample notification is
      // not a posting.
      'peut-être', 'éventuellement', 'il est possible', 'notification exemple', "exemple d'alerte",
      'exemple de notification',
      // A limit or availability notice ("Bargeldabhebung bis 200,00 € täglich möglich") names no
      // movement. A new bill to pay.
      "possible jusqu'à", 'par jour', 'nouvelle facture', 'à payer avant',
      'seront', 'vont être', 'va être',
      'autorisation', 'pré-autorisation', 'préautorisation', 'à valider', 'à confirmer',
      'débit différé', 'à compter du',
      'a reçu votre', 'ont reçu votre', 'vers votre livret', 'sur votre livret', 'le plus tôt possible',
      'dès que possible',
    ],
    debitTerms: [ 'a été prélevée de',
      'débité', 'débitée', 'a ete debite', 'payé', 'payée', 'prélevé', 'prélevée', 'prélevés',
      'prélevées', 'prélèvement', 'paiement par carte', 'votre paiement', 'vous avez envoyé',
      'virement émis', 'votre virement', 'retrait',
      'achat', 'retrait', 'commission', 'frais', 'vous avez retiré', 'vous avez envoyé',
      'a été débitée', 'a prélevé',
    ],
    creditTerms: [
      // Not "reçu de": "Votre reçu de paiement" is a receipt for money that left.
      'crédité', 'créditée', 'a ete credite', 'vous a envoyé', 'vous a versé', 'virement reçu',
      'vous avez reçu', 'remboursé', 'remboursée',
      'vous a remboursé', 'remboursement',
      'à votre attention', 'pour vous',
    ],
    purchaseTerms: ['paiement chez', 'votre paiement de', 'prélèvement de',
      'achat', 'paiement en ligne', 'paiement par carte', 'payés en ligne', 'payées en ligne',
      'a été débitée', 'a été débité', 'a prélevé', 'a été payée', 'a été payé',
    ],
    refundTerms: ['remboursé', 'remboursée'],
    // "DAB" alone can be a shop name; the cash machine is named with its verb.
    cashTerms: ['retrait dab', 'au dab', 'distributeur',
      "retrait d'espèces", 'vous avez retiré',
    ],
    // Notification headings: a noun that opens the message (after an optional bank name) and
    // names a completed movement. They count only through the heading reader in universal-
    // parser.ts, which also requires every other line to be a known field, balance or footer and
    // every word after the amount to be a known connector, so a status the vocabulary does not
    // know keeps the alert in Review.
    headingTerms: [
      'achat', 'achat internet', 'paiement par carte', 'paiement en ligne', 'retrait',
      'retrait dab', 'virement émis', 'commission', 'frais', 'remboursement', 'virement reçu',
      'paiement par carte de', 'retrait de', 'achat de',
    ],
  },
  DE: {
    market: 'DE', currencies: ['EUR'], currencyAliases: {},
    // A "Gutschrift" (credit booking) with no refund wording is money in.
    rails: ['sepa'],
    transferTerms: ['überweisung', 'echtzeit-überweisung', 'zahlungseingang', 'gutschrift',
      '^gesendet', 'geld erhalten', 'überwiesen',
    ],
    utilityTerms: ['strom', 'gas', 'wasser', 'telefon'],
    recurringTerms: ['dauerauftrag', 'abonnement'],
    postedTerms: [ 'gezahlt',
      'gezahlt', 'erhalten', 'eingegangen', 'zahlungseingang', 'neue buchung',
      'neuer umsatz', 'umsatz soll', 'umsatz haben', 'abgehoben', 'ausgeführt', 'zahlung erfolgreich',
     
     
     
      'erstattet', 'überwiesen',
      'abgehoben',
    ],
    failedTerms: [
      'abgelehnt', 'fehlgeschlagen', 'nicht bezahlt', 'nicht abgebucht', 'nicht ausgeführt',
      'nicht durchgeführt', 'nicht erfolgreich', 'nicht erhalten', 'konnte nicht', 'zurückgewiesen',
      'storniert', 'stornierung', 'nicht genügend', 'smstan', 'pushtan', 'mobiletan', 'chiptan',
      'tan lautet', 'bestätigungscode', 'freigabecode',
      // "Ihre erwartete Überweisung … ist noch nicht eingegangen".
      'noch nicht', 'nicht eingegangen', 'nicht gezahlt', 'nicht gesendet', 'nicht überwiesen',
      'nicht gutgeschrieben', 'nicht belastet', 'nicht abgehoben',
      // Nothing was charged; a limit was reached.
      'wurden keine', 'wurde keine', 'wurde kein', 'es wurden keine', 'keine belastung',
      'limit erreicht', 'tageslimit erreicht', 'limit überschritten',
      // A payment reported as fraud is disputed, not booked.
      'betrug', 'als betrug', 'reklamiert', 'widersprochen',
      'nie überwiesen', 'nie abgebucht', 'nie belastet', 'nie gezahlt', 'nie erhalten', 'wurden nie',
      'wurde nie',
    ],
    futureTerms: [
      'wird abgebucht', 'wird morgen abgebucht', 'wird morgen gutgeschrieben', 'fällig',
      'wird belastet', 'wird gutgeschrieben', 'wird ausgeführt', 'wird am', 'wird erst', 'werden am',
      'vorgemerkt', 'vormerkung', 'reserviert', 'reservierung', 'ausstehend', 'geplant', 'angefragt',
      'anfrage', 'möchte', 'fordert', 'zahlungsaufforderung', 'geldanforderung', 'sie erhalten',
      'erhalten sie', 'du erhältst', 'erhältst du', 'hast du', 'haben sie', 'waren sie das',
      // Conditionals carry their subject: the English word "falls" is a US
      // place name ("NIAGARA FALLS", "SIOUX FALLS") on ordinary purchases.
      'warst du das', 'bitte bestätigen', 'bestätigen sie', 'freigeben', 'wenn sie', 'wenn du',
      'falls sie', 'falls du', 'sobald',
      'in kürze', 'voraussichtlich', 'erwartete', 'erwarteter', 'erwartetes', 'wird gesendet',
      'werden gesendet', 'wird überwiesen', 'wird gutgeschrieben',
      // "Wir haben Ihren Auftrag erhalten: Überweisung über …" acknowledges an
      // instruction; it moved no money and is not money in.
      'auftrag',
      // An offer on a later purchase ("nächste") is not a posting.
      'nächste', 'nächsten', 'rabatt', 'gutschein', 'sparen sie',
      // Requested or under review; an example; money to be claimed.
      'beantragt', 'in bearbeitung', 'in prüfung', 'wird geprüft', 'zum beispiel', 'beispiel:',
      'um es zu erhalten', 'um das geld zu erhalten',
      // An authorised hold ("genehmigt, vorbehaltlich der endgültigen Abrechnung"); a payment to
      // the reader's own credit card.
      'genehmigt', 'vorbehaltlich', 'endgültigen abrechnung', 'an ihre kreditkarte',
      'an deine kreditkarte', 'kreditkartenabrechnung',
      // A hedge ("Eventuell wurden …", "Det kan ha blitt trukket …") or a sample notification is
      // not a posting.
      'eventuell', 'möglicherweise', 'unter umständen', 'muster-benachrichtigung', 'musternachricht',
      'muster:', 'beispielnachricht', 'beispiel-benachrichtigung',
      // A limit or availability notice ("Bargeldabhebung bis 200,00 € täglich möglich") names no
      // movement. A new bill to pay.
      'möglich', 'täglich', 'pro tag', 'höchstens', 'maximal', 'neue rechnung', 'zahlbar bis',
      'werden belastet', 'werden abgebucht', 'werden morgen',
      'vorankündigung', 'ankündigung', 'vorabinformation', 'gesperrt', 'blockiert', 'zurückgebucht',
      'nicht erfolgt', 'nicht autorisiert', 'vorläufig', 'freigabe erforderlich', 'buchung folgt',
      // A sentence opening with a condition; the payee's receipt of the reader's payment; a move to the reader's own savings.
      '^falls', '^wenn', 'hat ihre zahlung', 'hat deine zahlung', 'hat deine überweisung',
      'hat ihre überweisung', 'auf sparkonto', 'auf ihr sparkonto',
    ],
    debitTerms: [ 'kartenumsatz',
      'belastet', 'abgebucht', 'bezahlt', 'gezahlt', 'kartenzahlung', 'lastschrift', 'umsatz soll',
      'abgehoben', 'abhebung', 'gesendet',
      // "LISA hat deine Überweisung erhalten" is the payee's receipt of money
      // that left: listed so "erhalten" cannot make it a credit on its own.
      'deine zahlung', 'ihre zahlung', 'deine überweisung', 'ihre überweisung',
      'einkauf', 'internetkauf', 'onlinekauf', 'online-umsatz', 'bargeldabhebung', 'bargeldauszahlung',
      'bargeld abgehoben', 'überweisung ausgeführt', 'dauerauftrag ausgeführt', 'überwiesen', 'gebühr',
      'entgelt', '^gesendet',
    ],
    // "NAME hat dir 20 € gesendet" is money in: it cancels "gesendet".
    creditTerms: [
      'gutgeschrieben', 'zahlungseingang', 'eingegangen', 'erhalten', 'umsatz haben', 'rückerstattung',
      'erstattet', 'hat dir', 'hat ihnen',
      'erstattung', 'gutschrift', 'geld erhalten',
      // "Gesendet von LUKAS: 20,00 EUR an dich" is money in.
      'an dich', 'für dich',
    ],
    // A charged direct debit is spending, as in universal-parser.ts; whether
    // it recurs is the subscription detector's call, not one alert's.
    purchaseTerms: ['lastschrift',
      'einkauf', 'internetkauf', 'onlinekauf', 'online-umsatz',
      'bezahlt',
      'gezahlt',
    ],
    refundTerms: ['rückerstattung', 'erstattet'],
    cashTerms: ['abhebung', 'abgehoben', 'bargeldauszahlung',
      'bargeld abgehoben',
    ],
    feeTerms: ['kontoführungsgebühr', 'gebühren'],
    // Notification headings: a noun that opens the message (after an optional bank name) and
    // names a completed movement. They count only through the heading reader in universal-
    // parser.ts, which also requires every other line to be a known field, balance or footer and
    // every word after the amount to be a known connector, so a status the vocabulary does not
    // know keeps the alert in Review.
    headingTerms: [ 'kartenumsatz',
      'einkauf', 'internetkauf', 'onlinekauf', 'online-umsatz', 'kartenzahlung', 'kartenumsatz',
      'neuer umsatz', 'bargeldabhebung', 'bargeldauszahlung', 'bargeld abgehoben', 'lastschrift',
      'überweisung ausgeführt', 'dauerauftrag ausgeführt', 'gebühr belastet', 'entgelt', 'gesendet',
      'erstattung', 'gutschrift', 'geld erhalten', 'kartenzahlung über', 'bargeldabhebung über',
      'gutschrift über', 'erstattung über',
    ],
  },
  ES: {
    market: 'ES', currencies: ['EUR'], currencyAliases: {},
    rails: ['sepa', 'bizum'],
    transferTerms: [
      'transferencia', 'bizum', 'bizum recibido', 'bizum enviado', 'transferencia recibida',
      'transferencia enviada', 'has recibido', 'has enviado',
    ],
    utilityTerms: ['suministros', 'electricidad', 'agua', 'teléfono'],
    recurringTerms: ['recurrente', 'suscripción'],
    postedTerms: [
      'has pagado', 'has realizado', 'has recibido', 'has enviado', 'acabas de enviar',
      'ha sido utilizada', 'ha sido utilizado', 'se ha cargado', 'se ha abonado', 'pago aceptado',
      'aceptado el pago', 'compra aceptada', 'acreditado', 'acreditada', 'abonada',
     
     
      'te ha cobrado',
      'te hemos cobrado', 'ha sido utilizada para',
      'te ha devuelto',
      // Spain's "Compra: 137,14 € en SHOP" heading carries its colon; the bare "Compra …" heading
      // is also Latin American, where a template decides.
     
      // "Compra de 32,15 EUR con su tarjeta … en SHOP": a trailing status after the shop stays
      // visible (universal-fields.ts), and the Latin American headings ("Compra aprobada", "compra
      // a meses") are not this phrase.
     
    ],
    failedTerms: [
      'rechazado', 'fallido', 'no pagado', 'no cargado', 'rechazada', 'denegada', 'denegado',
      'fallida', 'no autorizada', 'no autorizado', 'anulada', 'anulado', 'cancelada', 'cancelado',
      'no realizada', 'no se ha podido', 'no ha podido', 'saldo insuficiente', 'código para confirmar',
      'codigo para confirmar', 'código de confirmación', 'codigo de confirmacion', 'no lo compartas',
      'no compartas',
      // Nothing was charged; a limit was reached.
      'no se ha cargado', 'no se te ha cobrado', 'ningún cargo', 'ningun cargo',
      'límite diario alcanzado', 'límite alcanzado', 'alcanzado',
      // A one-time code for a purchase ("O código para a compra de …", "Tu código para la compra
      // de …"); both spellings in both packs.
      'tu código', 'tu codigo', 'el código', 'el codigo', 'su código', 'código para la',
      'codigo para la', 'o código', 'código para a', 'seu código',
      // A payment reported as fraud is disputed, not booked.
      'fraude', 'reportada como', 'reportado como', 'disputada',
      'no completada', 'no completado', 'bloqueada', 'bloqueado',
    ],
    futureTerms: [
      'se cargará', 'será abonado', 'próximo', 'se abonará', 'será cargado', 'se realizará',
      'será acreditado', 'sera acreditado', 'se acreditará', 'se acreditara',
      'programada', 'programado', 'te ha solicitado', 'ha solicitado', 'solicitud', 'si usted',
      'si tú', 'si no', '¿has', '¿ha', '¿reconoces', '¿realizaste', '¿es', 'confirma tu',
      'confirma la', 'confirmar la', 'para confirmar',
      // An offer on a later purchase ("próxima") is not a posting.
      'próxima', 'proxima', 'descuento', 'obtén', 'obten',
      // An example; unclaimed or requested money.
      'por ejemplo', 'para recibir', 'para cobrarlo', 'en trámite', 'solicitada',
      // An authorised hold ("autorizada; puede tardar 2 días"); a card bill payment.
      'autorizada', 'autorizado', 'puede tardar', 'tardar', 'a tu tarjeta de crédito',
      'a su tarjeta de crédito',
      // A hedge ("Eventuell wurden …", "Det kan ha blitt trukket …") or a sample notification is
      // not a posting.
      'posiblemente', 'es posible que', 'puede que', 'mensaje de ejemplo', 'notificación de ejemplo',
      'ejemplo:',
      // A limit or availability notice ("Bargeldabhebung bis 200,00 € täglich möglich") names no
      // movement. A new bill ("Has recibido una nueva factura … vence el …").
      'hasta', 'al día', 'por día', 'nueva factura', 'vence',
      // An approval the reader must still give ("Aprove no app a compra de …"): Spanish and
      // Portuguese read each other's alerts, so both packs list both spellings.
      'aprueba', 'aprobar', 'aprove', 'aprovar', 'expira',
      'aparecerá', 'aparecera', 'aparecería',
      'se cargarán', 'serán cargados', 'van a ser',
      'a partir de', 'preautorización',
      'ha recibido tu', 'ha recibido su', 'a tu cuenta de ahorro',
    ],
    debitTerms: [ 'cargo', 'adeudo',
      'cargado', 'pagado', 'has pagado', 'compra', 'retirada', 'has enviado', 'acabas de enviar',
      'se ha cargado', 'cargo de', 'cargo en', 'adeudo', 'pago de', 'pago aceptado', 'aceptado el pago',
      'recibo', 'utilizada por',
      // "Hemos recibido tu pago" acknowledges money that left you.
      'tu pago', 'su pago',
      'retirada', 'reintegro', 'comisión', 'bizum enviado', 'transferencia enviada', 'te ha cobrado',
      'te hemos cobrado', 'pago por internet',
      'tu transferencia', 'tu bizum', 'su transferencia',
    ],
    creditTerms: [
      'abonado', 'abonada', 'has recibido', 'recibido', 'acreditado', 'acreditada', 'reembolso',
      'devolución', 'ingreso', 'nómina',
      'bizum recibido', 'transferencia recibida', 'abono por devolución',
      'te ha devuelto',
    ],
    purchaseTerms: [ 'cargo',
      'compra', 'has pagado', 'pago con tarjeta', 'pago aceptado', 'aceptado el pago', 'adeudo', 'recibo',
      'pago por internet', 'compra online',
    ],
    cashTerms: ['retirada de efectivo', 'cajero', 'reintegro'],
    refundTerms: [
      'abono por devolución',
      'te ha devuelto',
    ],
    // Notification headings: a noun that opens the message (after an optional bank name) and
    // names a completed movement. They count only through the heading reader in universal-
    // parser.ts, which also requires every other line to be a known field, balance or footer and
    // every word after the amount to be a known connector, so a status the vocabulary does not
    // know keeps the alert in Review.
    headingTerms: [ 'cargo', 'cargo de', 'adeudo',
      'compra online', 'pago por internet', 'retirada', 'reintegro', 'devolución',
      'abono por devolución', 'comisión', 'bizum recibido', 'transferencia recibida',
      'bizum enviado', 'transferencia enviada', 'compra:', 'compra de', 'compra online de',
      'retirada de efectivo de', 'retirada de',
    ],
  },
  IT: {
    market: 'IT', currencies: ['EUR'], currencyAliases: {},
    rails: ['sepa'],
    transferTerms: [
      'bonifico', 'hai inviato', 'bonifico ricevuto', 'bonifico in uscita', 'accredito stipendio',
    ],
    utilityTerms: ['utenza', 'elettricità', 'acqua', 'telefono'],
    recurringTerms: ['ricorrente', 'abbonamento'],
    postedTerms: [
      'pagato', 'pagata', 'hai pagato', 'eseguito', 'eseguita', 'effettuato', 'effettuata',
      'addebitata', 'accreditata', 'hai ricevuto', 'ricevuto',
     
     
      'è stata usata per', 'hai prelevato', 'hai inviato',
      'ha addebitato', 'bolletta pagata', 'ti ha rimborsato', 'accredito stipendio',
    ],
    failedTerms: [
      'rifiutato', 'fallito', 'non pagato', 'non addebitato', 'rifiutata', 'fallita', 'negato',
      'negata', 'non autorizzato', 'non autorizzata', 'annullato', 'annullata', 'non riuscito',
      'non riuscita', 'non andato a buon fine', 'non andata a buon fine', 'non eseguito',
      'non eseguita', 'fondi insufficienti', 'disponibilità insufficiente', 'non condividere',
      // Nothing was charged; a limit was reached.
      'nessun addebito', 'nessun importo', 'non è stato addebitato', 'non è stata addebitata',
      'limite raggiunto', 'raggiunto',
      // A payment reported as fraud is disputed, not booked.
      'frode', 'segnalato come', 'segnalata come', 'contestato', 'contestata',
      'bloccato', 'bloccata', 'stornata', 'stornato',
    ],
    futureTerms: [
      'sarà addebitato', 'sarà accreditato', 'in scadenza', 'sarà addebitata', 'sarà accreditata',
      'verrà addebitato', 'verrà addebitata', 'verrà accreditato', 'verrà accreditata',
      'ti ricordiamo', 'in attesa', 'in lavorazione', 'programmato', 'programmata', 'ti ha chiesto',
      'ti chiede', 'richiesta', 'se hai', 'se non', 'qualora', 'hai effettuato tu', 'riconosci',
      'confermi',
      // An offer on a later purchase ("prossimo") is not a posting.
      'prossimo', 'prossima', 'sconto',
      // An example; unclaimed money.
      'ad esempio', 'per esempio', 'per riceverlo', 'per ricevere',
      // An authorised hold; a payment to the reader's own credit card.
      'autorizzato', 'autorizzata', 'contabilizzazione', 'può richiedere', 'alla tua carta di credito',
      'sulla tua carta di credito', 'alla carta di credito',
      // A hedge ("Eventuell wurden …", "Det kan ha blitt trukket …") or a sample notification is
      // not a posting.
      'potrebbe', 'forse', 'eventualmente', 'notifica di esempio', 'messaggio di esempio', 'esempio:',
      // A limit or availability notice ("Bargeldabhebung bis 200,00 € täglich möglich") names no
      // movement. A new bill to pay.
      'al giorno', 'fino a', 'nuova fattura', 'da pagare',
      'saranno addebitati', 'verranno addebitati',
      'in elaborazione', 'da confermare', 'preautorizzazione', 'a partire da',
      'ha ricevuto il tuo', 'ha ricevuto la tua',
    ],
    debitTerms: [
      'addebitato', 'pagato', 'pagata', 'addebitata', 'hai pagato', 'prelievo', 'hai inviato', 'acquisto',
      // "Abbiamo ricevuto il tuo pagamento" acknowledges money that left you.
      'tuo pagamento', 'suo pagamento',
      'pagamento', 'prelievo', 'hai prelevato', 'commissione', 'bonifico in uscita',
      'è stata usata per',
      'ha addebitato', 'bolletta pagata',
      'il tuo bonifico', 'tuo bonifico', 'il suo bonifico',
    ],
    creditTerms: ['accreditato', 'accreditata', 'hai ricevuto', 'ricevuto', 'rimborso', 'stipendio',
      'storno', 'bonifico ricevuto',
      'ti ha rimborsato', 'accredito stipendio',
    ],
    purchaseTerms: ['hai pagato',
      'pagamento', 'acquisto', 'è stata usata per',
      'ha addebitato', 'bolletta pagata',
    ],
    // Not "bancomat": in Italy it is also the debit-card scheme of a shop payment.
    refundTerms: [
      'storno',
      'ti ha rimborsato',
    ],
    cashTerms: [
      'hai prelevato', 'prelievo bancomat',
    ],
    // Notification headings: a noun that opens the message (after an optional bank name) and
    // names a completed movement. They count only through the heading reader in universal-
    // parser.ts, which also requires every other line to be a known field, balance or footer and
    // every word after the amount to be a known connector, so a status the vocabulary does not
    // know keeps the alert in Review.
    headingTerms: [
      'pagamento', 'pagamento con carta', 'acquisto', 'acquisto online', 'prelievo',
      'prelievo bancomat', 'storno', 'rimborso', 'commissione', 'commissione addebitata',
      'bonifico ricevuto', 'bonifico in uscita', 'pagamento di', 'acquisto online di',
      'prelievo di',
    ],
  },
  NL: {
    market: 'NL', currencies: ['EUR'], currencyAliases: {},
    rails: ['sepa', 'ideal'],
    transferTerms: [ 'gekregen','overboeking', 'bijgeschreven op je rekening', 'bijgeschreven op uw rekening',
      'gestuurd', 'overgemaakt', 'bijschrijving',
      'ontvangen',
    ],
    utilityTerms: ['energie', 'water', 'telefoon'],
    recurringTerms: ['periodiek', 'abonnement'],
    postedTerms: ['ontvangen', 'is uitgevoerd', 'opgenomen',
     
     
      'je betaalde', 'gestuurd', 'overgemaakt', 'geïncasseerd',
     
    ],
    failedTerms: [
      'geweigerd', 'mislukt', 'niet betaald', 'niet afgeschreven', 'afgewezen', 'geannuleerd',
      'niet gelukt', 'niet uitgevoerd', 'onvoldoende saldo', 'mislukte', 'geweigerde',
      // "De overboeking van € 500,00 is nog niet ontvangen."
      'nog niet', 'niet ontvangen', 'niet bijgeschreven', 'niet overgemaakt', 'niet opgenomen',
      // "Je overboeking … is teruggestort": the transfer came back, it did not arrive.
      'teruggestort', 'teruggeboekt', 'retour gestort',
      // Nothing was charged; a limit was reached.
      'geen bedrag', 'niets afgeschreven', 'er is geen', 'limiet bereikt', 'bereikt',
      // A payment reported as fraud is disputed, not booked.
      'fraude', 'gemeld als', 'betwist',
      'niet voltooid', 'geblokkeerd', 'gestorneerd',
    ],
    futureTerms: [
      'wordt afgeschreven', 'wordt morgen afgeschreven', 'wordt morgen bijgeschreven', 'aankomend',
      'wordt uitgevoerd', 'wordt op', 'zal worden', 'in behandeling', 'gepland', 'geplande',
      'gereserveerd', 'reservering', 'binnenkort', 'betaalverzoek', 'verzoek', 'vraagt', 'als u',
      'als je', 'indien', 'zodra', 'heb je', 'heeft u', 'herken je', 'herkent u', 'was jij dit',
      'bevestig', 'zorg voor voldoende saldo',
      // An offer on a later purchase ("volgende") is not a posting.
      'volgende', 'korting',
      // "Bijvoorbeeld: je hebt € 100 betaald bij …" is an example.
      'bijvoorbeeld', 'om het te ontvangen', 'aangevraagd',
      // An authorisation; a card bill payment.
      'geautoriseerd', 'goedgekeurd', 'aan je creditcard', 'aan uw creditcard',
      // A hedge ("Eventuell wurden …", "Det kan ha blitt trukket …") or a sample notification is
      // not a posting.
      'mogelijk', 'misschien', 'kan zijn', 'voorbeeldbericht', 'voorbeeldmelding', 'voorbeeld:',
      // A limit or availability notice ("Bargeldabhebung bis 200,00 € täglich möglich") names no
      // movement. A new bill; a credit-card repayment ("Aflossing creditcard …").
      'per dag', 'tot maximaal', 'nieuwe rekening', 'te betalen', 'aflossing', 'aflossing creditcard',
      'ingepland', 'aangekondigd',
      'vanaf januari', 'vanaf februari', 'vanaf maart', 'vanaf april', 'vanaf mei', 'vanaf juni',
      'vanaf juli', 'vanaf augustus', 'vanaf september', 'vanaf oktober', 'vanaf november',
      'vanaf december', 'vanaf volgende maand',
      'naar spaarrekening', 'naar je spaarrekening', 'naar uw spaarrekening',
    ],
    debitTerms: [
      'afgeschreven', 'betaald', 'betaling met bankkaart', 'betaling met kaart', 'opgenomen',
      // "We hebben je betaling ontvangen" acknowledges money that left you.
      'je betaling', 'uw betaling',
      'pinbetaling', 'online betaling', 'opname', 'kosten', 'incasso', 'je betaalde',
      'geïncasseerd',
      'internetaankoop', 'aankoop',
      '^overboeking',
      // "EMMA heeft € 71,59 van je ontvangen" is the payee's receipt; "heeft je … gestuurd" is
      // money in.
      'gestuurd naar', 'overgemaakt naar', 'van je', 'van u',
    ],
    creditTerms: [ 'gekregen','bijgeschreven', 'ontvangen',
      // "X heeft € 20 naar je overgemaakt" is money in: it cancels "overgemaakt".
      'bijschrijving', 'terugbetaling', 'naar je', 'aan je',
      'heeft je', 'heeft u',
    ],
    // ING's "Betaald: € 23,45 aan SHOP" heading names the spending itself.
    purchaseTerms: ['betaling met bankkaart', 'betaling met kaart', 'betaald', 'incasso',
      'online betaling', 'je betaalde',
      'internetaankoop', 'aankoop',
    ],
    refundTerms: [ 'restitutie',
      'terugbetaling',
    ],
    cashTerms: ['opname', 'geldautomaat',
      'opgenomen',
    ],
    // Notification headings: a noun that opens the message (after an optional bank name) and
    // names a completed movement. They count only through the heading reader in universal-
    // parser.ts, which also requires every other line to be a known field, balance or footer and
    // every word after the amount to be a known connector, so a status the vocabulary does not
    // know keeps the alert in Review.
    headingTerms: [ 'gekregen',
      'pinbetaling', 'betaling', 'online betaling', 'opname', 'overboeking', 'kosten',
      'kosten afgeschreven', 'incasso', 'automatische incasso', 'bijschrijving', 'terugbetaling',
      'ontvangen', 'internetaankoop', 'aankoop', 'betaling met bankkaart van',
      'online betaling van', 'bijschrijving van', 'terugbetaling van',
    ],
  },
  // European language packs beyond the first wave: Portugal, Poland, Sweden,
  // Denmark, Norway and Czechia. German-, French- and Dutch-speaking Austria,
  // Switzerland, Belgium and Luxembourg are read by the DE, FR and NL packs.
  //
  // Like every pack these add vocabulary only. They grant no automatic import:
  // the best-effort policy still decides, and its own wording guards still run.
  // Because the unrouted universal reader consults every language pack, each
  // term here must be a word or phrase of its own language that an English,
  // Arabic or other-language alert cannot contain by accident.
  //
  // How the lists are shaped:
  //  - postedTerms are completed verbs ("została zrealizowana", "du har fått")
  //    or a card-payment heading that names the instrument ("płatność kartą",
  //    "kortköp", "platba kartou"). A bare purchase noun ("köp", "compra") is
  //    family evidence only: "Köp nu!" is an advert. A heading is accepted
  //    only because these languages' merchant prepositions ("w", "hos", "til")
  //    are not merchant-extraction prepositions in universal-fields.ts, so a
  //    trailing "odrzucona"/"nekades" stays visible. If those prepositions are
  //    ever added, the merchant status tail must learn these languages'
  //    decline words first (see the note above the FR pack).
  //  - failedTerms and futureTerms win over postedTerms. Besides declines,
  //    holds, schedules and money requests they carry each language's
  //    verification question ("var det du", "czy to ty") and conditional
  //    ("hvis", "jeśli"), so a question about a payment is never a posting.
  //    Codes and passwords ("hasło", "engångskod") are failed, like an OTP.
  //  - Where a word reads both ways ("har skickat" can be to or from you), the
  //    receiving phrase is listed as credit too, so the two cancel and the
  //    direction stays with the person.
  //
  // Fixtures are synthetic reconstructions of published or commonly reported
  // formats with fictional values, not consented real alerts.
  PT: {
    market: 'PT', currencies: ['EUR'], currencyAliases: {},
    rails: ['mb way', 'multibanco', 'sepa'],
    // "enviou"/"recebeu"/"pagou" are third person as often as second: "JOAO
    // enviou um Pix para você", "ANA enviou-lhe 20,00 EUR", "JOAO SILVA te
    // enviou R$ 50,00" are money IN. Only a stated subject decides: "você
    // enviou" is out; "te enviou", "enviou-lhe", "… para você/sua conta" is in.
    // A verb that opens the clause ("^enviou", see findTerm in
    // alert-semantics.ts) has the reader as its unstated subject: "Recebeu
    // 20,00 EUR de ANA", "MB WAY: enviou 20,00 EUR para ANA". Anywhere else a
    // bare verb carries no posting or direction evidence.
    transferTerms: [
      'transferência', 'transferencia', 'mb way', 'você enviou', 'voce enviou', 'você recebeu',
      'voce recebeu', 'te enviou', 'enviou-lhe', '^enviou', '^recebeu',
      'transferência recebida', 'mb way enviado',
    ],
    utilityTerms: ['eletricidade', 'conta da água', 'conta da agua', 'telecomunicações'],
    recurringTerms: ['débito direto', 'debito direto', 'subscrição', 'subscricao'],
    postedTerms: [
      'você enviou', 'voce enviou', 'você recebeu', 'voce recebeu', 'te enviou', 'enviou-lhe',
      '^enviou', '^recebeu', 'efetuada', 'efetuado', 'pagamento efetuado', 'compra efetuada',
      'foi debitado', 'foi debitada', 'foi creditado', 'foi creditada', 'debitado', 'debitada',
      'creditado', 'creditada',
     
     
      '^pagou',
      // Portugal's headings that Brazil does not share; Brazilian generic headings are decided by
      // its templates.
     
     
    ],
    failedTerms: [
      'recusado', 'recusada', 'rejeitado', 'rejeitada', 'não autorizado', 'não autorizada',
      'nao autorizado', 'nao autorizada', 'cancelado', 'cancelada', 'anulado', 'anulada',
      'falhou', 'sem sucesso', 'saldo insuficiente', 'não foi', 'nao foi', 'não foram', 'nao foram',
      'código de confirmação', 'codigo de confirmacao',
      'não partilhe', 'nao partilhe', 'não compartilhe', 'nao compartilhe',
      // Nothing was charged; a limit was reached.
      'nenhum valor', 'nenhum montante', 'limite atingido', 'atingido',
      // A one-time code for a purchase ("O código para a compra de …", "Tu código para la compra
      // de …"); both spellings in both packs.
      'o código', 'o codigo', 'código para a', 'codigo para a', 'seu código', 'seu codigo', 'tu código',
      'código para la',
      // A payment reported as fraud is disputed, not booked.
      'fraude', 'reportada como', 'reportado como', 'contestada', 'contestado',
      'não concluído', 'não concluída', 'nao concluido', 'bloqueado', 'bloqueada', 'falhado',
    ],
    futureTerms: [
      'será debitado', 'sera debitado', 'será debitada', 'sera debitada', 'será creditado',
      'sera creditado', 'agendado', 'agendada', 'a pagar', 'data limite', 'extrato', 'pediu',
      'pedido de', 'solicitou', 'solicitação', 'solicitacao', 'se não', 'se nao', 'caso não',
      'caso nao', 'foi você', 'foi voce',
      // A Pix charge request or a bill to pay, received: nothing has moved.
      'cobrança', 'cobranca', 'fatura', 'boleto', 'para pagamento',
      'confirme', 'confirma a compra', 'confirmar a compra', 'para confirmar', 'em processamento',
      // An offer on a later purchase ("próxima") is not a posting.
      'próxima', 'proxima', 'desconto', 'ganhe',
      // An example; unclaimed money ("ative o MB WAY para receber").
      'por exemplo', 'para receber', 'ative o mb way', 'ative o seu', 'para o receber',
      // An authorised hold; a card bill payment.
      'autorizada', 'autorizado', 'pode demorar', 'ao seu cartão de crédito', 'ao cartão de crédito',
      // A hedge ("Eventuell wurden …", "Det kan ha blitt trukket …") or a sample notification is
      // not a posting.
      'possivelmente', 'pode ter sido', 'talvez', 'mensagem de exemplo', 'notificação de exemplo',
      'exemplo:',
      // A limit or availability notice ("Bargeldabhebung bis 200,00 € täglich möglich") names no
      // movement. A new bill.
      'por dia', 'até', 'nova fatura',
      // An approval the reader must still give ("Aprove no app a compra de …"): Spanish and
      // Portuguese read each other's alerts, so both packs list both spellings.
      'aprove', 'aprovar', 'aprueba', 'expira',
      'a partir de',
      'recebeu o seu', 'recebeu a sua',
    ],
    debitTerms: [
      'você enviou', 'voce enviou', '^enviou', 'você pagou', 'voce pagou', 'compra', 'debitado', 'debitada',
      'levantamento',
      // "ANA recebeu o seu pagamento" is the payee's receipt of money that
      // left: listed so "recebeu" cannot make it a credit on its own.
      'o seu pagamento', 'a sua transferência', 'a sua transferencia',
      '^pagou', 'pagamento online', 'pagamento de serviços', 'levantamento', 'comissão',
      'mb way enviado', 'débito na conta',
    ],
    creditTerms: [
      'você recebeu', 'voce recebeu', '^recebeu', 'te enviou', 'enviou-lhe', 'te pagou', 'pagou-lhe',
      'para você', 'para voce', 'para sua conta', 'para a sua conta', 'na sua conta', 'recebido',
      'recebida', 'creditado', 'creditada', 'reembolso', 'estorno', 'devolução', 'devolucao',
      'transferência recebida',
    ],
    purchaseTerms: ['compra', 'pagamento com cartão', 'pagamento com cartao',
      '^pagou', 'pagamento online', 'compra online',
    ],
    refundTerms: ['reembolso', 'estorno', 'devolução', 'devolucao'],
    cashTerms: ['levantamento'],
    feeTerms: ['comissão', 'comissao', 'anuidade'],
    moneyLabels: ['compra', 'levantamento', 'montante', 'valor'],
    // Notification headings: a noun that opens the message (after an optional bank name) and
    // names a completed movement. They count only through the heading reader in universal-
    // parser.ts, which also requires every other line to be a known field, balance or footer and
    // every word after the amount to be a known connector, so a status the vocabulary does not
    // know keeps the alert in Review.
    headingTerms: [
      'compra online', 'pagamento de serviços', 'levantamento', 'comissão', 'comissão cobrada',
      'mb way enviado', 'débito na conta', 'compra:', 'compra de', 'compra online de',
      'levantamento de',
    ],
  },
  PL: {
    market: 'PL', currencies: ['PLN'], currencyAliases: { 'zł': ['PLN'] },
    rails: ['blik', 'elixir', 'express elixir', 'sepa'],
    transferTerms: ['przelew', 'przelew na telefon', 'blik na telefon',
      'przesłał ci', 'przesłała ci', 'wpływ na rachunek', 'przelew przychodzący', 'przelew wychodzący',
      'przelew wysłany',
      'wysłałeś przelew', 'wysłałaś przelew',
    ],
    utilityTerms: ['rachunek za prąd', 'rachunek za gaz', 'rachunek za wodę', 'energia elektryczna'],
    recurringTerms: ['polecenie zapłaty', 'zlecenie stałe', 'subskrypcja'],
    postedTerms: [
      'zrealizowana', 'zrealizowany', 'zrealizowano', 'została zrealizowana', 'zaksięgowano',
      'zaksięgowana', 'wykonano', 'wydano', 'wydałeś', 'wydałaś', 'wydał', 'wydała',
      'otrzymano', 'otrzymałeś', 'otrzymałaś', 'przelew przych', 'przelew wych',
      'płatność kartą', 'platnosc karta', 'uznanie', 'obciążenie', 'obciazenie',
     
     
     
      'wypłaciłeś', 'wypłaciłaś', 'przesłał ci', 'przesłała ci', 'zaksięgowany',
      'zaksięgowana', 'pobrał', 'pobrała',
      'wysłałeś', 'wysłałaś', 'zapłacono',
    ],
    failedTerms: [
      'odrzucona', 'odrzucono', 'odrzucony', 'nieudana', 'nieudany', 'odmowa', 'odmówiona',
      'anulowana', 'anulowano', 'nie została', 'nie zostala', 'nie został', 'nie zostało',
      'nie zrealizowano', 'nie zaksięgowano', 'nie wykonano', 'nie otrzymano', 'brak środków',
      'brak srodkow',
      'hasło', 'haslo', 'kod blik', 'kod sms', 'nie podawaj',
      // Nothing was charged; a limit was reached.
      'nie pobrano', 'nie obciążono', 'osiągnięty', 'przekroczono',
      // A payment reported as fraud is disputed, not booked.
      'oszustwo', 'zgłoszona jako', 'zgłoszony jako', 'reklamacja',
      'zablokowana', 'zablokowany', 'nie powiodła się', 'zwrócona', 'zwrócony',
    ],
    futureTerms: [
      // "Planowane obciążenie …"; an invoice received is a bill, not money in.
      'planowane', 'planowana', 'planowany', 'faktura', 'fakturę', 'fakture',
      'oczekująca', 'oczekujaca', 'oczekujący', 'oczekuje', 'zostanie', 'zaplanowana',
      'zaplanowany', 'blokada', 'zablokowano', 'prośba o', 'prosba o', 'prosi o', 'czy to ty',
      'czy to pan', 'czy to pani', 'czy potwierdzasz', 'czy zlecałeś', 'czy zlecałaś',
      'czy dokonałeś', 'czy dokonałaś', 'jeśli', 'jesli', 'jeżeli', 'jezeli', 'potwierdź', 'potwierdz',
      'do zapłaty', 'termin płatności',
      // An offer on a later purchase ("następny") is not a posting. Not
      // "rabat": Rabat is a Moroccan city in ordinary merchant descriptors.
      'następny', 'następna', 'następnym', 'zniżka', 'zniżki', 'kod rabatowy',
      // An example; unclaimed money.
      'na przykład', 'przykładowo', 'aby odebrać',
      // An authorised hold; a card bill payment.
      'autoryzowana', 'zautoryzowana', 'może potrwać', 'spłata karty', 'na kartę kredytową',
      // A hedge ("Eventuell wurden …", "Det kan ha blitt trukket …") or a sample notification is
      // not a posting.
      'możliwe', 'prawdopodobnie', 'mogło zostać', 'mogła zostać', 'przykładowe powiadomienie',
      'przykład:',
      // A limit or availability notice ("Bargeldabhebung bis 200,00 € täglich möglich") names no
      // movement. A new bill.
      'dziennie', 'do kwoty', 'nowa faktura',
      'od stycznia', 'od lutego', 'od marca',
    ],
    debitTerms: [ 'transakcja internetowa',
      'wydano', 'wydał', 'wydała', 'wydałeś', 'wydałaś', 'płatność', 'platnosc', 'obciążenie',
      'obciazenie', 'przelew wych', 'wypłata', 'wyplata', 'zapłacono', 'zaplacono',
      // "Otrzymano Twoją płatność" is the payee confirming money that left.
      'twoją płatność', 'twoja płatność', 'twoja platnosc',
      'transakcja kartą', 'płatność internetowa', 'płatność w internecie', 'wypłaciłeś', 'wypłaciłaś',
      'przelew wychodzący', 'przelew wysłany', 'zakup online', 'polecenie zapłaty', 'pobrał', 'pobrała',
      'opłata',
      'wysłałeś', 'wysłałaś',
      'twój przelew', 'twoj przelew', 'twoją płatność',
    ],
    creditTerms: [
      'otrzymano', 'otrzymałeś', 'otrzymałaś', 'przelew przych', 'uznanie', 'wpływ', 'wplyw',
      'wpłata', 'wplata', 'zwrot',
      'przesłał ci', 'przesłała ci', 'wpływ na rachunek', 'przelew przychodzący', 'zwrot środków',
    ],
    purchaseTerms: [ 'transakcja internetowa',
      'płatność kartą', 'platnosc karta', 'płatność blik', 'platnosc blik', 'zakup', 'wydano',
      'transakcja kartą', 'płatność internetowa', 'płatność w internecie', 'zakup online',
    ],
    refundTerms: ['zwrot'],
    cashTerms: ['wypłata z bankomatu', 'wyplata z bankomatu', 'wypłata gotówki', 'bankomat',
      'wypłaciłeś', 'wypłaciłaś',
    ],
    feeTerms: ['opłata za', 'oplata za', 'prowizja',
      'opłata', 'oplata',
    ],
    moneyLabels: ['kwota', 'kwotę', 'wydano', 'otrzymano', 'płatność', 'platnosc'],
    // Notification headings: a noun that opens the message (after an optional bank name) and
    // names a completed movement. They count only through the heading reader in universal-
    // parser.ts, which also requires every other line to be a known field, balance or footer and
    // every word after the amount to be a known connector, so a status the vocabulary does not
    // know keeps the alert in Review.
    headingTerms: [ 'transakcja internetowa',
      'transakcja kartą', 'płatność internetowa', 'płatność w internecie', 'wypłata z bankomatu',
      'wypłata gotówki', 'zwrot', 'zwrot środków', 'opłata', 'wpływ na rachunek',
      'przelew przychodzący', 'przelew wychodzący', 'przelew wysłany', 'zakup online',
      'polecenie zapłaty', 'płatność internetowa na kwotę', 'płatność kartą na kwotę',
    ],
  },
  SE: {
    market: 'SE', currencies: ['SEK'], currencyAliases: { kr: ['SEK'], 'kr.': ['SEK'] },
    rails: ['swish', 'bankgiro', 'plusgiro', 'autogiro'],
    transferTerms: ['swish', 'överföring', 'insättning',
      '^överföring',
      'du har fått', 'har fått',
    ],
    utilityTerms: ['elräkning', 'vattenräkning', 'telefonräkning'],
    recurringTerms: ['autogiro', 'prenumeration', 'stående överföring'],
    postedTerms: [ 'handlat för',
      'du har fått', 'har fått', 'du har betalat', 'har betalat', 'betalat', 'har dragits',
      'dragits', 'genomförd', 'genomfört', 'genomförts', 'kortköp', 'du har skickat',
     
      'drog', 'vi drog', 'återbetalade', 'har återbetalat',
     
    ],
    failedTerms: [
      'kunde inte', 'har inte', 'inte genomförd', 'inte genomförts', 'inte dragits',
      'inte betalats', 'nekad', 'nekades', 'nekat', 'nekats', 'avvisad', 'avvisades',
      'avbruten', 'avbröts', 'misslyckades', 'misslyckad', 'otillräckligt saldo', 'täckning saknas',
      'engångskod', 'säkerhetskod', 'dela inte',
      // Nothing was charged; a limit was reached.
      'inget belopp', 'nådd', 'överskriden',
      // A payment reported as fraud is disputed, not booked.
      'bedrägeri', 'bestriden', 'bestridd',
      'spärrat', 'spärrad', 'avbrutet', 'makulerat', 'återkallat', 'återbetald',
      'ej genomförd', 'ej genomfört', 'ej genomförts',
    ],
    futureTerms: [
      // Not "reservation": that English word names hotel and travel merchants.
      'reserverad', 'reserverat', 'kommer att', 'väntande', 'väntar', 'schemalagd',
      'planerad', 'förfrågan', 'betalningsförfrågan', 'vill ha', 'begär', 'om du', 'var det du',
      'bekräfta', 'har du',
      // An offer on a later purchase ("nästa") is not a posting.
      'nästa', 'rabatt',
      // An example; unclaimed money; a credit-card bill payment (settlement, not new spending).
      'till exempel', 'exempel:', 'för att ta emot', 'kreditkortet', 'kortfakturan',
      'kreditkortsfaktura',
      // An authorised hold ("godkänt; bokföring kan ta 2 dagar").
      'godkänt', 'godkänd', 'bokföring kan ta', 'kan ta',
      // A hedge ("Eventuell wurden …", "Det kan ha blitt trukket …") or a sample notification is
      // not a posting.
      'kan ha', 'eventuellt', 'möjligen', 'exempelavisering', 'exempelmeddelande',
      // A limit or availability notice ("Bargeldabhebung bis 200,00 € täglich möglich") names no
      // movement. A new bill; a payment to the reader's own credit card ("till ditt …
      // kreditkort").
      'per dag', 'upp till', 'ny faktura', 'att betala', 'till ditt', 'till din',
      'kreditkortsbetalning',
      'under behandling', 'preliminär', 'preliminärt', 'väntar på', 'från januari',
      'kanske',
    ],
    debitTerms: [ 'handlat för',
      'du har betalat', 'betalat', 'har dragits', 'dragits', 'köp', 'kortköp', 'uttag',
      'du har skickat',
      // "Vi har fått din betalning" acknowledges money that left you.
      // "ERIK har fått 200 kr från dig" is the payee's receipt.
      'din betalning', 'från dig',
      'onlineköp', 'avgift', 'överföring', 'räkning betald', 'drog',
      'autogiro',
      'fra deg', 'fra dig',
    ],
    // "ERIK har skickat 150 kr till dig" is money in: "till dig" cancels the
    // outgoing reading of "skickat" so the person decides.
    creditTerms: ['du har fått', 'har fått', 'insättning', 'återbetalning', 'återbetalt', 'till dig',
      'återbetalade', 'har återbetalat',
    ],
    purchaseTerms: [ 'handlat för','köp', 'kortköp', 'kortbetalning',
      'onlineköp',
      'du har betalat', 'betalat online',
    ],
    refundTerms: ['återbetalning', 'återbetalt',
      'återbetalade', 'har återbetalat',
    ],
    cashTerms: ['uttag', 'kontantuttag', 'bankomat', 'uttagsautomat'],
    feeTerms: ['avgift', 'årsavgift'],
    moneyLabels: ['köp', 'kortköp', 'belopp', 'fått', 'betalat', 'uttag'],
    // Notification headings: a noun that opens the message (after an optional bank name) and
    // names a completed movement. They count only through the heading reader in universal-
    // parser.ts, which also requires every other line to be a known field, balance or footer and
    // every word after the amount to be a known connector, so a status the vocabulary does not
    // know keeps the alert in Review.
    headingTerms: [
      'köp', 'onlineköp', 'uttag', 'avgift', 'avgift dragen', 'överföring', 'räkning betald',
      'autogiro', 'köp med kort', 'köp på', 'kortköp på', 'onlineköp på',
    ],
  },
  DK: {
    market: 'DK', currencies: ['DKK'], currencyAliases: { kr: ['DKK'], 'kr.': ['DKK'] },
    rails: ['mobilepay', 'betalingsservice', 'nemkonto'],
    transferTerms: ['mobilepay', 'overførsel', 'har sendt dig',
      'penge sendt', 'du har sendt',
    ],
    utilityTerms: ['elregning', 'vandregning'],
    recurringTerms: ['betalingsservice', 'fast overførsel'],
    postedTerms: [ 'handlet for',
      'du har betalt', 'har betalt', 'betalt', 'har sendt dig', 'sendt dig', 'du har modtaget',
      'modtaget', 'hævet', 'er hævet', 'indsat', 'gennemført',
     
      'du har sendt', 'opkrævet', 'er trukket',
      'er blevet trukket',
    ],
    failedTerms: [
      'afvist', 'afvises', 'fejlede', 'fejlet', 'mislykkedes', 'kunne ikke gennemføres',
      'ikke gennemført', 'ikke betalt', 'ikke modtaget', 'annulleret', 'ikke nok penge',
      'utilstrækkelig dækning', 'engangskode', 'del ikke', 'ikke hævet', 'ikke trukket',
      'ikke overført', 'ikke sendt', 'ikke indsat', 'blev ikke', 'har ikke',
      // Nothing was charged; a limit was reached.
      'intet beløb', 'nået', 'overskredet',
      // A payment reported as fraud is disputed, not booked.
      'svindel', 'indsigelse',
      'blokeret', 'tilbageført', 'kan ikke gennemføres', 'manglende dækning',
    ],
    futureTerms: [
      'reserveret', 'vil blive', 'bliver hævet', 'bliver trukket', 'bliver overført',
      // A bill received ("en ny regning … til betaling") is not money in.
      'til betaling',
      'planlagt', 'afventer', 'afventende', 'anmodning', 'anmoder', 'beder om', 'hvis',
      'var det dig', 'har du', 'bekræft', 'forfalder',
      // An offer on a later purchase ("næste") is not a posting. Not "rabat"
      // (Rabat, Morocco, appears in merchant descriptors).
      'næste', 'rabatkode',
      // A new bill; an example; unclaimed money; a credit-card bill payment.
      'ny regning', 'regning fra', 'for eksempel', 'eksempel:', 'for at modtage', 'kreditkortet',
      'kreditkortregningen',
      // An authorised hold.
      'godkendt', 'kan tage',
      // A hedge ("Eventuell wurden …", "Det kan ha blitt trukket …") or a sample notification is
      // not a posting.
      'kan være', 'muligvis', 'eventuelt', 'eksempelbesked', 'eksempelmeddelelse',
      // A limit or availability notice ("Bargeldabhebung bis 200,00 € täglich möglich") names no
      // movement.
      'pr. dag', 'op til', 'til dit kreditkort',
      'foreløbig', 'fra januar',
      'måske',
    ],
    // "Vi har modtaget din betaling" acknowledges money that left you.
    debitTerms: [ 'handlet for',
      // "Mette har modtaget 200 kr fra dig" is the payee's receipt.
      'du har betalt', 'har betalt', 'betalt', 'hævet', 'køb', 'kortkøb', 'hævning', 'din betaling',
      'fra dig', 'fra deg',
      'onlinekøb', 'gebyr', 'regning betalt', 'penge sendt', 'du har sendt', 'opkrævet', 'er trukket',
      'trukket', 'nethandel', 'kontanthævning',
      'från dig',
    ],
    // "Mette har betalt dig 200 kr." is money in: it cancels the outgoing
    // "betalt". Danish and Norwegian read each other's alerts, so both
    // spellings ("dig"/"deg") are listed here and in the NO pack.
    creditTerms: [
      'har sendt dig', 'sendt dig', 'betalt dig', 'betalt deg', 'du har modtaget', 'modtaget',
      'indsat', 'indbetaling', 'tilbagebetaling',
      'refusion',
    ],
    purchaseTerms: [ 'handlet for','du har betalt', 'køb', 'kortkøb',
      'onlinekøb', 'køb med kort',
      'er blevet trukket', 'trukket',
      'nethandel',
    ],
    refundTerms: ['tilbagebetaling', 'refundering', 'refusion',
      'tilbagebetaling',
    ],
    cashTerms: ['hævning', 'kontanthævning', 'pengeautomat', 'hæveautomat',
      'kontanthævning',
    ],
    feeTerms: ['gebyr'],
    moneyLabels: ['beløb', 'betalt', 'modtaget', 'køb', 'hævet'],
    // Notification headings: a noun that opens the message (after an optional bank name) and
    // names a completed movement. They count only through the heading reader in universal-
    // parser.ts, which also requires every other line to be a known field, balance or footer and
    // every word after the amount to be a known connector, so a status the vocabulary does not
    // know keeps the alert in Review.
    headingTerms: [
      'køb med kort', 'køb', 'onlinekøb', 'gebyr', 'regning betalt', 'penge sendt',
      'tilbagebetaling', 'refusion', 'nethandel', 'kontanthævning', 'køb på', 'onlinekøb på',
    ],
  },
  NO: {
    market: 'NO', currencies: ['NOK'], currencyAliases: { kr: ['NOK'], 'kr.': ['NOK'] },
    rails: ['vipps', 'avtalegiro', 'efaktura'],
    transferTerms: ['vipps', 'overføring', 'har sendt deg',
      'sendt til', 'penger mottatt', 'innbetaling',
    ],
    utilityTerms: ['strømregning'],
    recurringTerms: ['avtalegiro', 'faste trekk'],
    postedTerms: [ 'handlet for', 'penger fått',
      'du betalte', 'betalte', 'du har betalt', 'har betalt', 'har sendt deg', 'sendt deg',
      'du har mottatt', 'mottatt', 'trukket', 'er trukket', 'gjennomført',
     
      'tatt ut', 'gebyr trukket',
      'er brukt til', 'sendt til', 'er betalt',
      'du har handlet', 'har handlet',
    ],
    failedTerms: [
      'avvist', 'avvises', 'feilet', 'mislyktes', 'kunne ikke gjennomføres', 'ikke gjennomført',
      'ikke betalt', 'avbrutt', 'ikke nok dekning', 'manglende dekning', 'engangskode', 'ikke del',
      'ikke trukket', 'ikke belastet', 'ikke overført', 'ikke mottatt', 'ikke sendt', 'ble ikke',
      'har ikke',
      // Nothing was charged; a limit was reached.
      'ingen beløp', 'nådd', 'overskredet',
      // A payment reported as fraud is disputed, not booked.
      'svindel', 'reklamert',
      'blokkert', 'kansellert', 'tilbakeført',
    ],
    futureTerms: [
      'reservert', 'reservasjon', 'vil bli', 'blir trukket', 'blir belastet', 'planlagt', 'venter',
      'faktura',
      'ventende', 'forespørsel', 'ber om', 'hvis', 'var det deg', 'har du', 'bekreft', 'forfaller',
      // An offer on a later purchase ("neste kjøp") is not a posting. Not bare
      // "neste": NESTE is a fuel-station brand in merchant descriptors.
      'neste kjøp', 'ditt neste', 'din neste', 'rabatt',
      // A new bill; an example; unclaimed money; a credit-card bill payment ("Du har betalt … til
      // … kredittkortet ditt").
      'ny regning', 'regning fra', 'for eksempel', 'eksempel:', 'for å motta', 'kredittkortet',
      'kredittkortregningen', 'kredittkortet ditt',
      // An authorised hold.
      'godkjent', 'kan ta',
      // A hedge ("Eventuell wurden …", "Det kan ha blitt trukket …") or a sample notification is
      // not a posting.
      'kan ha blitt', 'kan ha', 'muligens', 'eventuelt', 'eksempelvarsel', 'eksempelmelding',
      // A limit or availability notice ("Bargeldabhebung bis 200,00 € täglich möglich") names no
      // movement.
      'per dag', 'opptil',
      'foreløpig', 'fra januar',
      'kanskje',
    ],
    debitTerms: [ 'handlet for',
      'du betalte', 'betalte', 'har betalt', 'trukket', 'kjøp', 'varekjøp', 'kortkjøp', 'uttak',
      // "Ola har mottatt betaling på 200 kr fra deg" is the payee's receipt.
      'din betaling', 'fra deg', 'fra dig',
      'netthandel', 'kontantuttak', 'gebyr', 'avtalegiro', 'tatt ut', 'er brukt til', 'sendt til',
      'du har handlet', 'har handlet',
      'från dig',
    ],
    creditTerms: [ 'penger fått',
      'har sendt deg', 'sendt deg', 'betalt deg', 'betalt dig', 'du har mottatt', 'mottatt',
      'innbetaling', 'tilbakebetaling',
      'innbetaling', 'penger mottatt', 'refusjon',
    ],
    purchaseTerms: [ 'handlet for','du betalte', 'kjøp', 'varekjøp', 'kortkjøp',
      'netthandel', 'er brukt til', 'nettkjøp',
      'betalt på nett', 'betalt',
      'har handlet',
    ],
    refundTerms: ['tilbakebetaling', 'refusjon', 'refundert'],
    cashTerms: ['uttak', 'kontantuttak', 'minibank',
      'tatt ut',
    ],
    feeTerms: ['gebyr'],
    moneyLabels: ['beløp', 'betalte', 'mottatt', 'kjøp', 'uttak'],
    // Notification headings: a noun that opens the message (after an optional bank name) and
    // names a completed movement. They count only through the heading reader in universal-
    // parser.ts, which also requires every other line to be a known field, balance or footer and
    // every word after the amount to be a known connector, so a status the vocabulary does not
    // know keeps the alert in Review.
    headingTerms: [
      'kortkjøp', 'kjøp', 'netthandel', 'kontantuttak', 'uttak', 'gebyr', 'innbetaling',
      'penger mottatt', 'refusjon', 'tilbakebetaling', 'avtalegiro', 'nettkjøp', 'kjøp på',
    ],
  },
  CZ: {
    market: 'CZ', currencies: ['CZK'], currencyAliases: { 'Kč': ['CZK'] },
    rails: ['sepa', 'qr platba'],
    transferTerms: ['převod', 'příchozí platba', 'odchozí platba',
      'připsána platba', 'odeslaná platba',
    ],
    utilityTerms: ['elektřina', 'záloha na plyn'],
    recurringTerms: ['inkaso', 'trvalý příkaz'],
    postedTerms: [ 'byla odepsána', 'odepsána částka',
      'platba kartou', 'příchozí platba', 'prichozi platba', 'odchozí platba', 'odchozi platba',
      'byla provedena', 'proběhla', 'zaplaceno', 'připsáno', 'pripsano', 'odepsáno', 'strženo',
     
     
      'byla stržena', 'vám vrátil', 'vám vrátila',
      'provedeno',
      'zaplatili jste', 'připsána refundace',
    ],
    failedTerms: [
      'zamítnuta', 'zamítnuto', 'zamitnuta', 'odmítnuta', 'odmitnuta', 'neprovedena',
      'nebyla provedena', 'nebyla', 'nebyl', 'nebylo', 'neproběhla', 'neprobehla', 'zrušena',
      'zrusena', 'vrácena', 'vracena', 'nedostatek prostředků',
      'neúspěšná', 'neuspesna', 'ověřovací kód', 'overovaci kod', 'nesdělujte',
      // Nothing was charged; a limit was reached.
      'nebyla stržena', 'žádná částka', 'dosažen', 'překročen',
      // A payment reported as fraud is disputed, not booked.
      'podvod', 'reklamace', 'reklamována',
      'vrácen',
    ],
    futureTerms: [
      'čeká na', 'ceka na', 'čekající', 'cekajici', 'rezervace', 'blokace', 'bude odečtena',
      'bude stržena', 'bude připsána', 'naplánovaná', 'naplanovana', 'žádost o platbu',
      'zadost o platbu', 'žádá', 'pokud', 'jestliže', 'potvrďte', 'potvrdte', 'provedl jste',
      // An offer on a later purchase ("příští") is not a posting.
      'příští', 'sleva', 'slevu',
      // An example; still being processed.
      'například', 'příklad:', 'zpracovává', 'zpracování',
      // An authorised hold; a card bill payment.
      'autorizována', 'autorizovaná', 'může trvat', 'splátka kreditní karty',
      // A hedge ("Eventuell wurden …", "Det kan ha blitt trukket …") or a sample notification is
      // not a posting.
      'možná', 'pravděpodobně', 'mohla být', 'mohlo být', 'ukázková zpráva', 'ukázka:',
      'vzorová zpráva',
      // A limit or availability notice ("Bargeldabhebung bis 200,00 € täglich möglich") names no
      // movement.
      'denně', 'až do', 'nová faktura',
      'naplánována', 'naplánováno', 'od ledna',
    ],
    debitTerms: [ 'byla odepsána', 'odepsána částka',
      'platba kartou', 'odchozí platba', 'odchozi platba', 'výběr', 'zaplaceno', 'odepsáno', 'strženo',
      'nákup', 'online platba', 'internetová platba', 'výběr hotovosti', 'poplatek', 'odeslaná platba',
      'trvalý příkaz', 'zaplaceno inkaso', 'byla stržena',
      'zaplatili jste',
      'vaši platbu', 'vaši platbu přijal',
    ],
    creditTerms: ['příchozí platba', 'prichozi platba', 'připsáno', 'pripsano', 'vrácení', 'vraceni',
      'refundace', 'připsána platba', 'vám vrátil', 'vám vrátila',
      'připsána refundace',
    ],
    purchaseTerms: [ 'byla odepsána','platba kartou', 'nákup',
      'online platba', 'internetová platba', 'nákup na internetu', 'byla stržena',
      'zaplatili jste',
    ],
    refundTerms: ['vrácení', 'vraceni', 'refundace',
      'vám vrátil', 'vám vrátila',
      'refundace',
    ],
    cashTerms: ['výběr z bankomatu', 'výběr hotovosti', 'bankomat'],
    feeTerms: ['poplatek'],
    moneyLabels: ['částka', 'platba kartou', 'příchozí platba', 'odchozí platba'],
    // Notification headings: a noun that opens the message (after an optional bank name) and
    // names a completed movement. They count only through the heading reader in universal-
    // parser.ts, which also requires every other line to be a known field, balance or footer and
    // every word after the amount to be a known connector, so a status the vocabulary does not
    // know keeps the alert in Review.
    headingTerms: [
      'nákup', 'nákup na internetu', 'online platba', 'internetová platba', 'výběr hotovosti',
      'výběr z bankomatu', 'poplatek', 'refundace', 'připsána platba', 'odeslaná platba',
      'trvalý příkaz provedeno', 'zaplaceno inkaso',
    ],
  },
} as const satisfies Record<string, AlertMarketPack>;
