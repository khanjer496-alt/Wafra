/**
 * ONE status lexicon for every bank-alert reader: the words that say a
 * movement did NOT happen (yet), in the launch languages — German, French,
 * Spanish, Italian, Dutch, Portuguese, Polish, Swedish, Danish, Norwegian,
 * Czech, English and Arabic.
 *
 * Each language lists its status concepts as STEMS with an inflection class
 * (gender, number, participle and noun endings), plus the completion
 * participles whose NEGATION is a status ("nicht ausgeführt",
 * "niezrealizowana", "neprovedeno", "no realizada", "ikke gennemført").
 * Every form is generated from those lists, never typed one review at a
 * time: accent-free spellings (an all-capitals SMS often drops them) and the
 * German ae/oe/ue/ss transliteration are added automatically. Compound
 * languages (German, Dutch, the Nordic languages) also match a noun stem
 * inside a longer word ("Vorabautorisierung", "Lastschriftrückgabe",
 * "kortreservation").
 *
 * Matching is case-insensitive and word-boundary safe. The lexicon only ever
 * WITHDRAWS a posting: a word in it sends the alert to Review.
 *
 * Refund words are deliberately absent: a refund is a movement. The
 * "returned" concept (money sent back to the payer) is reported separately so
 * a refund alert can ignore it.
 */

export type StatusLanguage = 'de' | 'fr' | 'es' | 'it' | 'nl' | 'pt' | 'pl' | 'sv' | 'da' | 'nb' | 'cs' | 'en' | 'ar';
export type StatusConcept =
  | 'declined' | 'failed' | 'cancelled' | 'returned' | 'expired' | 'blocked' | 'held' | 'pending'
  | 'future' | 'retry' | 'unauthorised' | 'not-completed' | 'insufficient' | 'notice' | 'example' | 'unreadable'
  // Money paid back by a merchant ("hat Ihnen … erstattet"): the movement of a refund alert, a doubt anywhere else.
  | 'refunded' | 'request' | 'disputed';

/** Inflection classes: the endings a stem takes. */
const ENDINGS = {
  // German adjective/participle and noun endings.
  deAdj: ['', 'e', 'en', 'er', 'es', 'em'],
  deNoun: ['', 'en', 's'],
  // French participles: é, ée, és, ées.
  fr: ['', 'e', 's', 'es'],
  // Spanish/Portuguese -o/-a/-os/-as; Italian -o/-a/-i/-e.
  oa: ['o', 'a', 'os', 'as'],
  it: ['o', 'a', 'i', 'e'],
  // Polish adjectival participles.
  pl: ['a', 'y', 'e', 'o', 'ych', 'ej', 'ą', 'ego', 'ym', 'i', 'ie'],
  // Polish noun cases ("odmowa", "odmowy", "niepowodzeniem").
  plNoun: ['a', 'e', 'y', 'u', 'ą', 'ę', 'em', 'ie', 'iem'],
  // Czech participles (long and short).
  cs: ['', 'a', 'o', 'y', 'é', 'á', 'ý', 'í', 'ou', 'ých', 'ém', 'ého', 'ému', 'ými'],
  // Czech noun cases ("upomínka", "upomínky").
  csNoun: ['a', 'y', 'u', 'ou', 'e', 'ách'],
  // Dutch / Nordic participles take -e (definite/plural) or a Swedish -t/-de.
  e: ['', 'e'],
  sv: ['', 'e', 'es', 't', 'de', 'des', 's'],
  none: [''],
} as const;
type Ending = keyof typeof ENDINGS;
/** A stem with its inflection class; `infix` stems also match inside a compound word. */
interface Stem { stem: string; ending: Ending; infix?: boolean; compoundOnly?: boolean }
const s = (ending: Ending, ...stems: string[]): Stem[] => stems.map((stem) => ({ stem, ending }));
const infix = (...stems: string[]): Stem[] => stems.map((stem) => ({ stem, ending: 'none' as const, infix: true }));
const phrase = (...phrases: string[]): Stem[] => s('none', ...phrases);
/** A stem that is also an English word ("reservation"): only inside a compound ("kortreservation"). */
const compound = (...stems: string[]): Stem[] => stems.map((stem) => ({ stem, ending: 'none' as const, infix: true, compoundOnly: true }));

interface LanguageLexicon {
  concepts: Partial<Record<StatusConcept, Stem[]>>;
  /** Completion participles: negated they are "not completed". */
  completed: Stem[];
  /** Words and prefixes that negate a completion participle. */
  negators: readonly string[];
  /** Prefixes written onto the participle ("nie" + "zrealizowana"). */
  negationPrefixes?: readonly string[];
}

const LEXICON: Record<StatusLanguage, LanguageLexicon> = {
  de: {
    concepts: {
      example: phrase('beispiel', 'muster', 'musternachricht', 'beispielnachricht'),
      insufficient: s('deAdj', 'unzureichend'),
      notice: infix('erinnerung', 'entwurf'),
      declined: [...s('deAdj', 'abgelehnt', 'abgewiesen', 'verweigert', 'zurückgewiesen'), ...infix('ablehnung', 'abweisung', 'verweigerung')],
      failed: [...s('deAdj', 'fehlgeschlagen', 'gescheitert', 'misslungen', 'erfolglos', 'ungültig', 'geplatzt', 'ungedeckt', 'unvollständig'), ...infix('fehlschlag'),
        ...phrase('nicht möglich', 'nicht erfolgreich')],
      cancelled: [...s('deAdj', 'storniert', 'annulliert', 'widerrufen', 'abgebrochen', 'unterbrochen', 'zurückgezogen'), ...infix('stornierung', 'annullierung', 'abbruch')],
      refunded: s('deAdj', 'erstattet', 'rückerstattet'),
      returned: [...s('deAdj', 'zurückgebucht', 'zurückgegeben', 'rückgängig', 'widersprochen'), ...infix('rückbuchung', 'rücklastschrift', 'rückgabe', 'rückläufer', 'retoure', 'widerspruch', 'widerruf', 'storno')],
      expired: s('deAdj', 'abgelaufen', 'verfallen'),
      blocked: [...s('deAdj', 'gesperrt', 'blockiert', 'ausgesetzt', 'eingefroren'), ...infix('sperrung', 'blockierung')],
      held: [...s('deAdj', 'vorgemerkt', 'reserviert', 'vorautorisiert', 'vorläufig'),
        ...infix('vormerkung', 'vormerkposten', 'reservierung', 'vorautorisierung', 'vorabautorisierung', 'autorisierung')],
      pending: [...s('deAdj', 'ausstehend', 'offen'), ...phrase('möglicherweise', 'in bearbeitung', 'in der bearbeitung', 'bearbeitung läuft', 'in prüfung', 'wird geprüft',
        'wird bearbeitet', 'wird verarbeitet', 'läuft noch')],
      future: [...s('deAdj', 'geplant', 'terminiert'), ...phrase('wird gebucht', 'wird belastet', 'wird abgebucht', 'wird ausgeführt',
        'werden gebucht', 'werden belastet', 'noch nicht', 'morgen', 'erst morgen', 'erfolgt am', 'erst später'), ...infix('fälligkeit')],
      retry: phrase('erneut versuchen', 'nochmal versuchen', 'noch einmal versuchen', 'guthaben aufladen', 'aufladen'),
      unauthorised: s('deAdj', 'unautorisiert'),
    },
    completed: s('deAdj', 'ausgeführt', 'durchgeführt', 'gebucht', 'autorisiert', 'bestätigt', 'erfolgt', 'abgeschlossen', 'genehmigt', 'bezahlt', 'belastet', 'erfolgreich'),
    negators: ['nicht', 'nie', 'niemals', 'kein', 'keine'],
  },
  fr: {
    concepts: {
      example: phrase('exemple'),
      insufficient: [...s('fr', 'insuffisant'), ...phrase('insuffisance', 'provision insuffisante')],
      notice: phrase('rappel'),
      declined: [...s('fr', 'refusé', 'rejeté', 'décliné'), ...phrase('refus', 'rejet', 'refus de paiement')],
      failed: [...s('fr', 'échoué', 'impayé', 'erroné', 'invalide', 'non abouti'), ...phrase('échec')],
      cancelled: [...s('fr', 'annulé', 'révoqué', 'interrompu'), ...phrase('annulation')],
      refunded: s('fr', 'remboursé'),
      // (A transfer the payer recalled or the bank reversed: "Ce virement a été rappelé par l'émetteur", "Virement extourné".)
      returned: [...s('fr', 'retourné', 'renvoyé', 'contrepassé', 'rétrocédé', 'rappelé', 'extourné'), ...phrase('retour à l\'émetteur', 'extourne')],
      expired: s('fr', 'expiré', 'périmé'),
      blocked: [...s('fr', 'suspendu', 'bloqué', 'gelé'), ...phrase('en suspens', 'opposition')],
      held: [...s('fr', 'provisoire', 'préautorisé', 'pré-autorisé', 'réservé'), ...phrase('autorisation', 'préautorisation', 'pré-autorisation', 'réservation', 'empreinte bancaire')],
      pending: phrase('éventuellement', 'en attente', 'attente', 'en cours', 'en traitement', 'à valider', 'à confirmer', 'en vérification', 'en examen'),
      future: [...s('fr', 'programmé', 'planifié', 'prévu', 'différé'), ...phrase('à venir', 'sera', 'seront', 'demain', 'prévu le', 'prévue le', 'programmé le')],
      retry: phrase('réessayer', 'réessayez', 'recharger', 'rechargez', 'approvisionnez', 'alimentez votre compte'),
      unauthorised: s('fr', 'non autorisé'),
    },
    completed: s('fr', 'effectué', 'abouti', 'autorisé', 'validé', 'exécuté', 'réalisé', 'accepté', 'débité', 'crédité'),
    negators: ['non', 'jamais', 'pas', 'aucun', 'aucune'],
  },
  es: {
    concepts: {
      example: phrase('ejemplo'),
      insufficient: [...s('oa', 'impagad'), ...phrase('insuficiente', 'insuficientes')],
      notice: phrase('recordatorio'),
      declined: [...s('oa', 'denegad', 'rechazad', 'declinad'), ...phrase('denegación', 'rechazo', 'rechazó', 'denegó', 'rechazamos')],
      failed: [...s('oa', 'fallid', 'erróne', 'incorrect', 'inválid'), ...phrase('fallo', 'error', 'error en el pago', 'error en la operación', 'falló', 'no se pudo', 'no se ha podido', 'no pudo', 'no ha podido')],
      cancelled: [...s('oa', 'anulad', 'cancelad', 'revocad', 'interrumpid'), ...phrase('anulación', 'cancelación', 'anuló', 'canceló')],
      refunded: [...s('oa', 'devuelt', 'reembolsad'), ...phrase('devolución')],
      // ("La transferencia ha sido revertida": the credit was taken back.)
      returned: [...s('oa', 'retrocedid', 'revertid'), ...phrase('retrocesión')],
      expired: s('oa', 'caducad', 'vencid', 'expirad'),
      blocked: [...s('oa', 'suspendid', 'bloquead', 'congelad', 'retenid'), ...phrase('retención')],
      held: [...s('oa', 'preautorizad', 'reservad'), ...phrase('preautorización', 'autorización', 'provisional', 'reserva')],
      pending: phrase('posiblemente', 'pendiente', 'pendientes', 'en espera', 'en proceso', 'en trámite', 'en curso', 'procesando', 'en revisión', 'en verificación'),
      future: [...s('oa', 'programad', 'previst'), ...phrase('se realizará', 'será', 'serán', 'mañana', 'próximo', 'próxima')],
      retry: phrase('vuelve a intentarlo', 'inténtalo de nuevo', 'reintentar', 'reintenta', 'recarga', 'recargar', 'añade saldo'),
      unauthorised: s('oa', 'no autorizad'),
    },
    completed: s('oa', 'realizad', 'procesad', 'completad', 'efectuad', 'aprobad', 'ejecutad', 'autorizad', 'abonad', 'cargad'),
    negators: ['no', 'nunca', 'jamás'],
  },
  it: {
    concepts: {
      example: phrase('esempio'),
      insufficient: phrase('insufficiente', 'insufficienti'),
      notice: phrase('promemoria'),
      declined: [...s('it', 'rifiutat', 'respint', 'negat', 'declinat'), ...phrase('rifiuto', 'diniego')],
      failed: [...s('it', 'fallit', 'errat', 'invalid'), ...phrase('esito negativo', 'esito: negativo', 'non andato a buon fine', 'non andata a buon fine',
        'non è andato a buon fine', 'non è andata a buon fine')],
      cancelled: [...s('it', 'annullat', 'revocat', 'stornat', 'interrott'), ...phrase('annullamento')],
      refunded: s('it', 'rimborsat', 'riaccreditat'),
      // ("Il bonifico è stato richiamato dall'ordinante": the payer recalled it.)
      returned: [...s('it', 'restituit', 'retrocess', 'richiamat'), ...phrase('storno')],
      expired: s('it', 'scadut'),
      blocked: s('it', 'sospes', 'bloccat', 'congelat', 'trattenut'),
      held: [...s('it', 'preautorizzat', 'provvisori', 'riservat'), ...phrase('preautorizzazione', 'autorizzazione')],
      pending: phrase('eventualmente', 'in attesa', 'attesa', 'in corso', 'in lavorazione', 'in elaborazione', 'in verifica', 'in sospeso'),
      future: [...s('it', 'programmat', 'previst'), ...phrase('sarà', 'saranno', 'verrà', 'verranno', 'domani')],
      retry: phrase('riprova', 'riprovare', 'ricarica', 'ricaricare'),
      unauthorised: s('it', 'non autorizzat'),
    },
    completed: s('it', 'eseguit', 'autorizzat', 'riuscit', 'completat', 'effettuat', 'approvat', 'addebitat', 'accreditat'),
    negators: ['non', 'mai'],
  },
  nl: {
    concepts: {
      example: phrase('voorbeeld'),
      insufficient: phrase('onvoldoende'),
      notice: infix('herinnering'),
      declined: [...s('e', 'geweigerd', 'afgewezen', 'afgekeurd'), ...infix('weigering', 'afwijzing')],
      failed: s('e', 'mislukt', 'ongeldig', 'onjuist'),
      cancelled: [...s('e', 'geannuleerd', 'ingetrokken', 'afgebroken'), ...infix('annulering')],
      refunded: s('e', 'terugbetaald', 'teruggestort'),
      returned: [...s('e', 'teruggeboekt', 'gestorneerd', 'teruggedraaid'), ...infix('terugboeking', 'storno')],
      expired: s('e', 'verlopen'),
      blocked: s('e', 'geblokkeerd', 'opgeschort', 'bevroren', 'ingehouden'),
      held: [...s('e', 'gereserveerd', 'voorlopig'), ...infix('reservering', 'autorisatie')],
      pending: phrase('misschien', 'in behandeling', 'behandeling loopt', 'in afwachting', 'wordt verwerkt', 'in verwerking', 'in controle', 'loopt nog'),
      future: [...s('e', 'gepland', 'ingepland'), ...phrase('wordt afgeschreven', 'wordt bijgeschreven', 'zal', 'zullen', 'morgen', 'binnenkort')],
      retry: phrase('opnieuw proberen', 'probeer opnieuw', 'probeer het opnieuw', 'opwaarderen', 'waardeer op'),
      unauthorised: s('e', 'ongeautoriseerd'),
    },
    completed: s('e', 'uitgevoerd', 'verwerkt', 'goedgekeurd', 'geautoriseerd', 'gelukt', 'voltooid', 'afgeschreven', 'bijgeschreven'),
    negators: ['niet', 'nooit', 'geen'],
  },
  pt: {
    concepts: {
      example: phrase('exemplo'),
      insufficient: phrase('insuficiente', 'insuficientes'),
      notice: phrase('lembrete'),
      declined: [...s('oa', 'recusad', 'rejeitad', 'negad', 'declinad'), ...phrase('recusa')],
      failed: [...s('oa', 'falhad', 'inválid', 'errad', 'incorret'), ...phrase('falhou')],
      cancelled: s('oa', 'cancelad', 'anulad', 'revogad', 'interrompid'),
      refunded: [...s('oa', 'devolvid', 'reembolsad'), ...phrase('devolução')],
      // ("Transferência revertida": the credit was taken back.)
      returned: [...s('oa', 'estornad', 'revertid'), ...phrase('estorno')],
      expired: s('oa', 'expirad', 'caducad', 'vencid'),
      blocked: s('oa', 'suspens', 'bloquead', 'congelad', 'retid', 'cativ'),
      held: [...s('oa', 'pré-autorizad', 'preautorizad', 'provisóri', 'reservad'), ...phrase('pré-autorização', 'preautorização')],
      pending: phrase('possivelmente', 'pendente', 'pendentes', 'em análise', 'em processamento', 'em curso', 'em espera', 'a aguardar', 'aguarda'),
      future: [...s('oa', 'agendad', 'programad', 'previst'), ...phrase('será', 'serão', 'amanhã')],
      retry: phrase('tente novamente', 'tentar novamente', 'carregue', 'carregar o cartão'),
      unauthorised: s('oa', 'não autorizad'),
    },
    completed: s('oa', 'efetuad', 'autorizad', 'realizad', 'aprovad', 'concluíd', 'processad', 'debitad', 'creditad'),
    negators: ['não', 'nunca'],
  },
  pl: {
    concepts: {
      example: phrase('przykład'),
      insufficient: [...s('pl', 'niewystarczając'), ...phrase('brak środków')],
      notice: s('plNoun', 'przypomnieni'),
      declined: [...s('pl', 'odrzucon', 'odmówion'), ...s('plNoun', 'odmow', 'odrzuceni')],
      failed: [...s('pl', 'nieudan', 'błędn', 'nieprawidłow'), ...s('plNoun', 'niepowodzeni'), ...phrase('błąd')],
      cancelled: [...s('pl', 'anulowan', 'cofnięt', 'przerwan'), ...phrase('anulowanie')],
      refunded: [...s('pl', 'zwrócon'), ...phrase('zwrot')],
      expired: [...s('pl', 'przeterminowan'), ...phrase('wygasła', 'wygasło', 'wygasł')],
      blocked: [...s('pl', 'zablokowan', 'wstrzyman', 'zawieszon', 'zamrożon'), ...s('plNoun', 'blokad')],
      held: [...s('pl', 'zarezerwowan', 'tymczasow'), ...phrase('preautoryzacja', 'wstępnie autoryzowana', 'rezerwacja')],
      pending: [...s('pl', 'oczekując', 'przetwarzan'), ...phrase('prawdopodobnie', 'w toku', 'w trakcie', 'w realizacji', 'w weryfikacji', 'oczekuje')],
      future: [...s('pl', 'zaplanowan'), ...phrase('zostanie', 'zostaną', 'będzie', 'jutro')],
      retry: phrase('spróbuj ponownie', 'ponów', 'doładuj', 'doładowanie'),
      unauthorised: s('pl', 'nieautoryzowan'),
    },
    completed: s('pl', 'zrealizowan', 'wykonan', 'autoryzowan', 'zaakceptowan', 'przetworzon', 'zaksięgowan', 'udan'),
    negators: ['nie', 'nigdy'],
    negationPrefixes: ['nie'],
  },
  sv: {
    concepts: {
      example: phrase('exempel'),
      insufficient: s('sv', 'otillräcklig'),
      notice: infix('påminnelse'),
      declined: [...s('sv', 'nekad', 'nekat', 'avvisad', 'avvisat', 'avböjd'), ...phrase('nekades', 'nekats', 'avvisats', 'avslag', 'avslagen', 'avslaget')],
      failed: [...s('sv', 'misslyckad', 'misslyckat', 'ogiltig', 'felaktig'), ...phrase('misslyckades', 'gick inte igenom'),
        // Swedish puts the negation after a past passive: "Köpet godkändes inte".
        ...['godkändes', 'genomfördes', 'slutfördes', 'bokfördes', 'drogs', 'utfördes'].flatMap((verb) => phrase(`${verb} inte`, `${verb} ej`))],
      cancelled: [...s('sv', 'makulerad', 'annullerad', 'återkallad'), ...phrase('avbruten', 'avbrutet', 'avbrutna', 'avbrutits', 'avbröts', 'makulerats', 'annullerats'),
        ...infix('annullering', 'makulering')],
      refunded: s('sv', 'återbetald', 'återbetalat'),
      // (The perfect passive too: "Betalningen har återkallats", "… har återförts".)
      returned: [...s('sv', 'återförd', 'återfört', 'returnerad'), ...phrase('återkallats', 'återförts')],
      expired: phrase('utgången', 'utgånget'),
      blocked: s('sv', 'spärrad', 'spärrat', 'blockerad', 'fryst'),
      held: [...s('sv', 'reserverad', 'reserverat', 'preliminär', 'preliminärt'), ...compound('reservation')],
      pending: [...s('sv', 'väntande'), ...phrase('eventuellt', 'möjligen', 'väntar', 'väntar på godkännande', 'väntar på', 'behandlas', 'under behandling', 'pågår', 'granskas',
        'för att ta emot', 'godkänn i appen', 'för att godkänna')],
      future: [...s('sv', 'planerad', 'schemalagd'), ...phrase('kommer att', 'i morgon', 'imorgon', 'förfaller')],
      retry: phrase('försök igen', 'fyll på'),
      unauthorised: s('sv', 'obehörig'),
    },
    completed: s('sv', 'genomförd', 'genomfört', 'godkänd', 'godkänt', 'slutförd', 'slutfört', 'bokförd', 'bokfört', 'dragen', 'draget'),
    negators: ['inte', 'ej', 'icke', 'aldrig'],
  },
  da: {
    concepts: {
      example: phrase('eksempel'),
      insufficient: s('e', 'utilstrækkelig'),
      notice: infix('påmindelse'),
      declined: [...s('e', 'afvist', 'nægtet'), ...phrase('afslag')],
      failed: [...s('e', 'mislykket', 'ugyldig', 'forkert'), ...phrase('mislykkedes')],
      cancelled: [...s('e', 'annulleret', 'afbrudt', 'tilbagekaldt'), ...infix('annullering')],
      refunded: s('e', 'tilbagebetalt', 'refunderet'),
      returned: s('e', 'tilbageført', 'returneret'),
      expired: s('e', 'udløbet'),
      blocked: s('e', 'spærret', 'blokeret', 'suspenderet'),
      held: [...s('e', 'reserveret', 'foreløbig', 'forhåndsgodkendt'), ...compound('reservation')],
      pending: [...s('e', 'afventende'), ...phrase('muligvis', 'afventer', 'behandles', 'under behandling', 'venter', 'for at modtage', 'tryk for at modtage',
        'for at acceptere')],
      future: [...s('e', 'planlagt'), ...phrase('vil blive', 'i morgen', 'forfalder')],
      retry: phrase('prøv igen', 'fyld op'),
      unauthorised: s('e', 'uautoriseret'),
    },
    completed: s('e', 'gennemført', 'godkendt', 'behandlet', 'bogført', 'trukket'),
    negators: ['ikke', 'aldrig'],
  },
  nb: {
    concepts: {
      example: phrase('eksempel'),
      insufficient: [...s('e', 'utilstrekkelig'), ...phrase('ikke nok dekning', 'manglende dekning', 'ikke dekning')],
      notice: infix('påminnelse'),
      declined: [...s('e', 'avvist', 'avslått', 'nektet'), ...phrase('avslag')],
      failed: [...s('e', 'mislykket', 'ugyldig'), ...phrase('mislyktes', 'feil pinkode', 'feil pin')],
      cancelled: [...s('e', 'kansellert', 'avbrutt', 'annullert', 'tilbakekalt'), ...infix('kansellering', 'annullering')],
      refunded: s('e', 'tilbakebetalt', 'refundert'),
      returned: s('e', 'tilbakeført', 'returnert'),
      expired: s('e', 'utløpt'),
      blocked: s('e', 'sperret', 'blokkert'),
      held: [...s('e', 'reservert', 'foreløpig'), ...infix('reservasjon')],
      pending: [...s('e', 'ventende'), ...phrase('muligens', 'venter', 'avventer', 'behandles', 'under behandling', 'for å motta', 'for å ta imot', 'vil du ta imot')],
      future: [...s('e', 'planlagt'), ...phrase('vil bli', 'i morgen', 'forfaller')],
      retry: phrase('prøv igjen', 'fyll på'),
      unauthorised: s('e', 'uautorisert'),
    },
    completed: s('e', 'gjennomført', 'godkjent', 'behandlet', 'bokført', 'trukket'),
    negators: ['ikke', 'aldri'],
  },
  cs: {
    concepts: {
      example: phrase('příklad', 'ukázka'),
      insufficient: [...s('cs', 'nedostatečn'), ...phrase('nedostatek')],
      notice: s('csNoun', 'upomínk', 'připomínk'),
      declined: [...s('cs', 'zamítnut', 'odmítnut'), ...phrase('zamítnutí', 'odmítnutí')],
      failed: [...s('cs', 'neúspěšn', 'chybn', 'neplatn'), ...phrase('selhala', 'selhalo', 'selhal', 'nezdařila', 'nezdařilo', 'nezdařil', 'neproběhla', 'neproběhlo', 'neproběhl')],
      cancelled: [...s('cs', 'zrušen', 'stornován', 'přerušen'), ...phrase('storno')],
      refunded: [...s('cs', 'vrácen'), ...phrase('vratka')],
      expired: phrase('vypršela', 'vypršelo', 'propadla', 'propadlo'),
      blocked: [...s('cs', 'zablokován', 'blokován', 'pozastaven'), ...phrase('blokace')],
      held: [...s('cs', 'předautorizován', 'rezervován', 'předběžn', 'autorizován'), ...phrase('předautorizace', 'rezervace', 'autorizace')],
      pending: [...s('cs', 'čekající'), ...phrase('pravděpodobně', 'čeká', 'čeká na', 'čeká na zpracování', 'čeká na schválení', 'zpracovává', 've zpracování', 'probíhá', 'k ověření')],
      future: [...s('cs', 'naplánován'), ...phrase('bude', 'budou', 'zítra', 'proběhne')],
      retry: phrase('zkuste znovu', 'opakujte', 'dobijte'),
      unauthorised: s('cs', 'neautorizován'),
    },
    completed: s('cs', 'proveden', 'povolen', 'zaplacen', 'dokončen', 'zpracován', 'autorizován', 'schválen', 'uskutečněn'),
    negators: ['ne', 'nebyla', 'nebyl', 'nebylo', 'nikdy'],
    negationPrefixes: ['ne'],
  },
  en: {
    concepts: {
      example: phrase('example', 'sample', 'sample alert'),
      insufficient: s('none', 'insufficient', 'not enough', 'nsf', 'non-sufficient funds', 'not sufficient'),
      declined: [...s('none', 'declined', 'rejected', 'refused', 'denied', 'declnd', 'decl', 'dclnd'), ...phrase('decline', 'deny')],
      failed: s('none', 'failed', 'unsuccessful', 'invalid', 'incomplete', 'did not go through', 'didn\'t go through', 'no charge was made', 'no charge',
        'couldn\'t be completed', 'could not be completed', 'couldn\'t be processed', 'could not be processed'),
      cancelled: s('none', 'cancelled', 'canceled', 'voided', 'void'),
      // Money the payer or the bank took back after it arrived: "The sender has
      // recalled this payment", "This deposit was clawed back by the payer",
      // "This payment has been charged back", "Refunded to sender". ("Withdrawn"
      // alone is a cash withdrawal, so only "withdrawn by the sender/payer".)
      returned: s('none', 'reversed', 'returned', 'bounced', 'sent back', 'recalled', 'clawed back', 'clawed-back', 'charged back',
        'refunded to sender', 'refunded to the sender', 'refunded to the payer', 'withdrawn by sender', 'withdrawn by the sender',
        'withdrawn by the payer', 'withdrawn by payer', 'undone', 'retracted', 'taken back', 'debited back'),
      expired: s('none', 'expired'),
      blocked: s('none', 'suspended', 'blocked', 'frozen', 'on hold', 'held', 'hold placed', 'placed on hold'),
      held: s('none', 'reserved', 'pre-authorized', 'pre-authorised', 'preauthorized', 'preauthorised', 'pre-authorization',
        'pre-authorisation', 'preauth', 'provisional', 'authorization hold', 'authorisation hold', 'temporary hold',
        'authorization only', 'authorisation only', 'final amount may differ', 'may differ'),
      pending: s('none', 'pending', 'processing', 'under review', 'under investigation', 'in review', 'being reviewed', 'being processed', 'awaiting', 'waiting for',
        // Money a payee must still claim or accept.
        'needs to claim', 'needs to accept', 'must accept', 'must claim', 'to claim it', 'days to claim', 'not claimed', 'unclaimed',
        'hasn\'t claimed', 'has not claimed', 'must enroll', 'must enrol', 'needs to enroll', 'needs to enrol', 'to receive it',
        'to receive the money', 'to receive your money', 'to receive the payment', 'to receive this payment', 'enroll your email'),
      // ("will be" alone is everyday footer English — "Reward points will be added";
      // the settles-later wording has its own reader in universal-parser.ts.)
      future: s('none', 'scheduled', 'tomorrow', 'upcoming', 'not yet', 'to be credited', 'will post', 'will be posted', 'will be refunded', 'will be returned', 'will be reversed',
        'will be reviewed', 'will be delivered', 'may take', 'possibly', 'may have been'),
      retry: s('none', 'retry', 'try again', 'top up', 'top-up', 'retry payment', 'top up to complete', 'retry later'),
      unauthorised: s('none', 'unauthorized', 'unauthorised'),
    },
    completed: s('none', 'completed', 'processed', 'executed', 'approved', 'authorized', 'authorised', 'successful', 'posted', 'paid', 'charged',
      'accepted', 'claimed', 'received'),
    negators: ['not', 'never'],
  },
  ar: {
    concepts: {
      example: phrase('مثال', 'مثلاً', 'مثلا', 'نموذج'),
      declined: phrase('مرفوض', 'مرفوضة', 'رفض', 'رفضت', 'تم رفض'),
      failed: phrase('فشل', 'فشلت', 'فاشلة', 'لم تتم', 'لم يتم', 'ما تم', 'لن يتم', 'تعذر', 'غير ناجحة'),
      cancelled: phrase('ملغاة', 'ملغي', 'ملغاه', 'ألغيت', 'الغاء', 'إلغاء', 'تم إلغاء', 'تم الغاء'),
      expired: phrase('منتهية الصلاحية'),
      blocked: phrase('موقوف', 'موقوفة', 'مجمد', 'مجمدة', 'محظور'),
      held: phrase('محجوز', 'محجوزة', 'حجز مؤقت'),
      pending: phrase('معلق', 'معلقة', 'قيد المعالجة', 'قيد التنفيذ', 'قيد المراجعة', 'قيد الانتظار', 'يرجى تأكيد', 'هل تؤكد', 'بالرد بنعم', 'قد يتم'),
      future: phrase('سيتم', 'غدا', 'غداً'),
      retry: phrase('أعد المحاولة', 'اعد المحاولة', 'إعادة المحاولة', 'اعادة المحاولة'),
      unauthorised: phrase('غير مصرح', 'غير مصرح بها'),
      'not-completed': phrase('غير مكتمل', 'غير مكتملة'),
    },
    completed: [],
    negators: [],
  },
};

// Further words per language and concept, kept apart from the table above
// only for review: payment requests ("een Tikkie", "petición de Bizum"),
// disputes, stopped or postponed payments, unclaimed money ("Tilmeld dig for
// at få pengene"), and the completion words a "Status:" label or a negation
// may carry ("Betaald", "Payé", "nezaúčtována").
const EXTRA: Partial<Record<StatusLanguage, { concepts?: Partial<Record<StatusConcept, Stem[]>>; completed?: Stem[]; negationPrefixes?: string[] }>> = {
  de: { concepts: {
    request: phrase('zahlungsanforderung', 'geldanforderung', 'zahlungsaufforderung', 'fordert von dir', 'fordert von ihnen'),
    disputed: [...s('deAdj', 'strittig', 'beanstandet'), ...infix('klärung')],
    blocked: s('deAdj', 'gestoppt', 'angehalten', 'pausiert'),
    future: s('deAdj', 'verschoben', 'aufgeschoben'),
    pending: phrase('registriere dich', 'registrieren sie sich'),
    failed: [...s('deAdj', 'angefochten', 'überzogen', 'unverbucht'), ...infix('störung'), ...phrase('unter vorbehalt')],
  } },
  fr: { concepts: {
    request: phrase('demande de paiement', 'demande d\'argent', 'vous demande', 'te demande'),
    disputed: [...s('fr', 'contesté', 'litigieux'), ...phrase('litige', 'en litige', 'en contestation')],
    blocked: s('fr', 'stoppé', 'arrêté'),
    future: s('fr', 'reporté', 'ajourné'),
    failed: [...s('fr', 'retenu'), ...phrase('incident', 'à régulariser', 'a regulariser')],
    pending: phrase('inscrivez-vous', 'inscris-toi', 'en instance', 'créez un compte', 'pour les récupérer', 'pour le récupérer', 'pour la récupérer'),
  }, completed: s('fr', 'payé', 'réglé') },
  es: { concepts: {
    request: phrase('petición de bizum', 'solicitud de bizum', 'petición de dinero', 'solicitud de pago', 'petición de pago', 'te ha solicitado', 'te solicita', 'te pide'),
    disputed: [...s('oa', 'disputad', 'reclamad'), ...phrase('en disputa', 'disputa')],
    declined: s('oa', 'rehusad'),
    blocked: s('oa', 'detenid', 'paralizad', 'parad'),
    future: s('oa', 'aplazad', 'pospuest'),
    pending: phrase('regístrate', 'crea una cuenta', 'para recibirlo'),
    failed: phrase('sin éxito', 'incidencia', 'en estudio', 'excede el límite', 'supera el límite'),
  }, completed: s('oa', 'pagad') },
  it: { concepts: {
    request: phrase('richiesta di pagamento', 'richiesta di denaro', 'ti ha chiesto', 'ti chiede'),
    disputed: [...s('it', 'contestat'), ...phrase('in contestazione')],
    blocked: [...s('it', 'fermat'), ...phrase('sospensione', 'esito ko')],
    future: s('it', 'rinviat', 'posticipat'),
    pending: phrase('registrati'),
  }, completed: s('it', 'pagat', 'saldat') },
  nl: { concepts: {
    request: phrase('een tikkie', 'betaalverzoek', 'verzoek om te betalen', 'vraagt je'),
    disputed: s('e', 'betwist'),
    blocked: s('e', 'tegengehouden', 'gestopt', 'gepauzeerd'),
    future: s('e', 'uitgesteld'),
    pending: phrase('registreer je', 'om het geld te ontvangen', 'in onderzoek', 'openstaand', 'openstaande', 'wachtend', 'wachtende', 'foutief', 'limiet overschreden'),
  }, completed: s('e', 'betaald', 'voldaan') },
  pt: { concepts: {
    request: phrase('pedido de pagamento', 'pedido de dinheiro', 'pediu-lhe', 'pede-lhe'),
    disputed: [...s('oa', 'contestad'), ...phrase('em disputa')],
    blocked: s('oa', 'parad', 'interrompid'),
    future: s('oa', 'adiad'),
    pending: phrase('registe-se', 'registre-se'),
  }, completed: s('oa', 'pag', 'liquidad') },
  pl: { concepts: {
    request: phrase('prośba o płatność', 'prośba o przelew', 'prośba o pieniądze', 'prosi o'),
    disputed: [...s('pl', 'sporn', 'reklamowan', 'zakwestionowan'), ...phrase('do wyjaśnienia', 'przekroczony limit')],
    cancelled: s('pl', 'odwołan'),
    blocked: s('pl', 'zatrzyman'),
    future: s('pl', 'odroczon', 'przełożon'),
    pending: phrase('zarejestruj się', 'aby otrzymać', 'załóż konto', 'by je odebrać', 'aby je odebrać', 'aby odebrać'),
  }, completed: s('pl', 'zatwierdzon', 'zapłacon', 'opłacon', 'rozliczon', 'przyjęt', 'obciążon') },
  sv: { concepts: {
    request: phrase('betalningsförfrågan', 'betalningsbegäran', 'begär'),
    disputed: s('sv', 'bestridd', 'bestritt', 'reklamerad', 'reklamerat'),
    blocked: s('sv', 'stoppad', 'stoppat', 'pausad', 'pausat'),
    future: s('sv', 'uppskjuten', 'uppskjutet'),
    pending: phrase('registrera dig', 'för att få pengarna', 'på vänt'),
  }, completed: s('sv', 'bekräftad', 'bekräftat', 'betald'), negationPrefixes: ['o'] },
  da: { concepts: {
    request: phrase('anmodning om betaling', 'betalingsanmodning', 'anmoder dig'),
    disputed: s('e', 'bestridt', 'indsigelse', 'omtvistet'),
    blocked: s('e', 'stoppet', 'sat på pause'),
    future: s('e', 'udskudt'),
    pending: phrase('tilmeld dig', 'for at få pengene', 'overtrukket', 'mangler dækning'),
  }, completed: s('e', 'bekræftet') },
  nb: { concepts: {
    request: phrase('betalingsforespørsel', 'forespørsel om betaling', 'ber deg om'),
    disputed: s('e', 'bestridt', 'omtvistet'),
    blocked: s('e', 'stoppet', 'satt på pause'),
    future: s('e', 'utsatt'),
    pending: phrase('registrer deg', 'for å få pengene', 'på vent', 'mangler dekning'),
  }, completed: s('e', 'bekreftet') },
  cs: { concepts: {
    request: phrase('žádost o platbu', 'žádost o peníze', 'žádá o'),
    disputed: s('cs', 'sporn', 'reklamován'),
    failed: [...s('csNoun', 'chyb'), ...phrase('nepodařila', 'nepodařilo', 'nepodařil', 'se nepodařila')],
    blocked: s('cs', 'pozdržen', 'zadržen'),
    future: s('cs', 'odložen'),
    pending: phrase('vyřizuje se', 'zaregistrujte se'),
    held: phrase('nepovedla', 'nepovedlo', 'nepovedl'),
  }, completed: s('cs', 'potvrzen', 'vyřízen', 'zaúčtován') },
  en: { concepts: {
    request: phrase('payment request', 'money request', 'request for payment', 'has requested', 'have requested', 'is requesting', 'requested money'),
    disputed: phrase('disputed', 'in dispute', 'under dispute'),
    failed: phrase('unpaid', 'dishonoured', 'dishonored', 'could not process', 'could not complete', 'couldn\'t process', 'couldn\'t complete',
      'transaction error', 'payment error', 'processing error', 'not honored', 'not honoured'),
    cancelled: phrase('reverted', 'revoked'),
    blocked: phrase('halted', 'paused', 'stopped', 'on pause'),
    pending: phrase('queued', 'unsettled', 'enrolls', 'days to enroll', 'days to enrol', 'to collect it', 'to get it', 'to get the money', 'to collect the money', 'register within',
      'enroll with', 'enrol with', 'sign up in', 'sign up within', 'to collect', 'enroll to receive', 'join to collect'),
    held: phrase('auth only'),
  }, completed: s('none', 'settled', 'debited', 'credited') },
};
for (const [language, extra] of Object.entries(EXTRA) as [StatusLanguage, NonNullable<typeof EXTRA[StatusLanguage]>][]) {
  const lexicon = LEXICON[language];
  for (const [concept, stems] of Object.entries(extra.concepts ?? {}) as [StatusConcept, Stem[]][]) {
    lexicon.concepts[concept] = [...(lexicon.concepts[concept] ?? []), ...stems];
  }
  lexicon.completed = [...lexicon.completed, ...(extra.completed ?? [])];
  if (extra.negationPrefixes) lexicon.negationPrefixes = [...(lexicon.negationPrefixes ?? []), ...extra.negationPrefixes];
}

const stripAccents = (value: string): string => value.normalize('NFD').replace(/\p{M}+/gu, '').normalize('NFC');
const transliterateGerman = (value: string): string =>
  value.replace(/ä/gu, 'ae').replace(/ö/gu, 'oe').replace(/ü/gu, 'ue').replace(/ß/gu, 'ss');
// An accent-free spelling that is an ordinary English word ("reservation",
// "expire") would read an English merchant name as a status.
const ENGLISH_WORDS = new Set(['reservation', 'reserve', 'reserves', 'retire', 'retour']);
// A four-letter word without its accent is often another word or a name
// ("sara" for "sarà", "sera"): only forms of five letters or more ("echec")
// get an accent-free spelling.
const variants = (form: string, language: StatusLanguage): string[] => {
  const out = new Set([form]);
  const plain = stripAccents(form);
  if ((form.length >= 5 || form.includes(' ')) && !ENGLISH_WORDS.has(plain)) out.add(plain);
  if (language === 'de') out.add(transliterateGerman(form));
  return [...out];
};
const inflect = ({ stem, ending }: Stem): string[] => ENDINGS[ending].map((end) => stem + end);

export interface StatusForm { form: string; concept: StatusConcept; language: StatusLanguage; infix: boolean; compoundOnly?: boolean }

/** Every generated form, for tests and for review. */
export const STATUS_FORMS: readonly StatusForm[] = (() => {
  const forms = new Map<string, StatusForm>();
  const add = (form: string, concept: StatusConcept, language: StatusLanguage, isInfix: boolean, compoundOnly = false) => {
    for (const variant of variants(form.toLocaleLowerCase('de-DE'), language)) {
      const key = `${variant}|${isInfix}|${compoundOnly}`;
      if (!forms.has(key)) forms.set(key, { form: variant, concept, language, infix: isInfix, compoundOnly });
    }
  };
  // (English first: a spelling English shares with another language — "provisional" — is English.)
  const languages = (Object.entries(LEXICON) as [StatusLanguage, LanguageLexicon][])
    .sort(([a], [b]) => (a === 'en' ? 0 : 1) - (b === 'en' ? 0 : 1));
  for (const [language, lexicon] of languages) {
    for (const [concept, stems] of Object.entries(lexicon.concepts) as [StatusConcept, Stem[]][]) {
      for (const entry of stems) for (const form of inflect(entry)) add(form, concept, language, Boolean(entry.infix), Boolean(entry.compoundOnly));
    }
    for (const entry of lexicon.completed) {
      for (const form of inflect(entry)) {
        for (const negator of lexicon.negators) add(`${negator} ${form}`, 'not-completed', language, false);
        for (const prefix of lexicon.negationPrefixes ?? []) add(`${prefix}${form}`, 'not-completed', language, false);
      }
    }
  }
  return [...forms.values()];
})();

const escapeRegExp = (value: string): string => value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
// Words of a multi-word status may be joined by spaces, a hyphen or an
// underscore ("non-autorisé", "Zahlung_abgelehnt").
const WORD_GAP = String.raw`[\s_\-‐]+`;
const alternation = (forms: readonly StatusForm[]): string => [...new Set(forms.map((form) => form.form))]
  .sort((a, b) => b.length - a.length)
  .map((form) => form.split(' ').map(escapeRegExp).join(WORD_GAP))
  .join('|');
// Invisible characters inside a word ("E\u200bCHEC") and Unicode spaces are
// read as nothing and as a space.
/**
 * The text with every Unicode space, and an underscore joining words
 * ("Not_you?_Call_0800…"), as an ASCII space (same length, same indices).
 */
// (An underscore inside a host — "secure_chase.com/x" — is kept: it is a disguised link, not a gap.)
export const withPlainSpaces = (text: string): string => text.replace(/[\u00a0\u2000-\u200a\u202f\u205f\u3000]/gu, ' ')
  .replace(/(?<![a-z0-9-])_|_(?![a-z0-9_-]{0,63}\.[a-z]{2,12}(?:[/?#]|(?![\p{L}\p{N}])))/giu, ' ');
// `origin` maps an index in the normalized text back to the input.
const INVISIBLE = /[\u00ad\u200b-\u200d\u2060\ufeff]/u;
const normalizeText = (input: string): { text: string; origin: (index: number) => number } => {
  const spaced = input.replace(/[\u00a0\u2000-\u200a\u202f\u205f\u3000]/gu, ' ');
  if (!INVISIBLE.test(spaced)) return { text: spaced, origin: (index) => index };
  const kept: number[] = [];
  let text = '';
  for (let index = 0; index < spaced.length; index += 1) {
    if (INVISIBLE.test(spaced[index])) continue;
    kept.push(index);
    text += spaced[index];
  }
  return { text, origin: (index) => (index < kept.length ? kept[index] : spaced.length) };
};
// "Example"/"Sample"/"Beispiel" is a status only as a LABEL ("Example: …",
// "TD - Example - A charge …", "Exempel – kortköp …"), never inside a name
// ("SAMPLE MART", "CLAIRE EXEMPLE"). So is "Reservation", an English word that
// is a Nordic status ("… 1.250,00 kr.\nReservation") but also a merchant
// ("HOTEL RESERVATION DESK").
// So are "Hold" and an error noun ("… REWE. FEJL"), which footers also use ("Ved fejl kontakt os").
const LABEL_ONLY = ['reservation', 'reservationen', 'reservasjon', 'hold', 'fejl', 'feil', 'errore', 'error', 'ko', 'fout', 'fel', 'erreur'];
const TRAILING_ERROR = ['fejl', 'feil', 'errore', 'error', 'ko', 'fout', 'fel', 'erreur'];
const EXAMPLE_WORDS = STATUS_FORMS.filter((form) => form.concept === 'example');
const EXAMPLE_WORD = new RegExp(`(?<![\\p{L}])(?:${[...new Set([...EXAMPLE_WORDS.map((form) => form.form), ...LABEL_ONLY])]
  .sort((a, b) => b.length - a.length).map((form) => form.split(' ').map(escapeRegExp).join('\\s+')).join('|')})(?![\\p{L}\\p{N}])`, 'giu');
/**
 * An example label: "Example:", or the word set apart by punctuation, a
 * bracket, a symbol or a line ("TD - Example - …", "Exempel – kortköp",
 * "… kr.\n(Reservation)", "#Reservation 🙁"), never a word of a name.
 */
const exampleLabels = (text: string): RegExpMatchArray[] => [...text.matchAll(EXAMPLE_WORD)].filter((match) => {
  // Only the characters next to the word decide (never a whole-text slice).
  let before = match.index! - 1;
  while (before >= 0 && (text[before] === ' ' || text[before] === '\t')) before -= 1;
  let after = match.index! + match[0].length;
  while (after < text.length && (text[after] === ' ' || text[after] === '\t')) after += 1;
  // (Never a word of an e-mail address or host: "jane.c@example.com", "sample.org/x".)
  if (/[@.]/u.test(text[match.index! - 1] ?? '') || /^\.[a-z]{2,12}(?![\p{L}])/iu.test(text.slice(match.index! + match[0].length))) return false;
  if (text[after] === ':') return true;
  // (Or a lower-case label after a capitalised name, ending the text: "… at TESCO hold".)
  // (An error noun ending the text after a capitalised name counts in any case: "… presso ESSELUNGA KO".)
  const ending = /^[\s.!]*$/u.test(text.slice(match.index! + match[0].length));
  const lower = match[0].toLowerCase();
  const caseContrast = ending && LABEL_ONLY.includes(lower) && /\p{Lu}{2,}[ \t]*$/u.test(text.slice(0, match.index!)) &&
    (match[0] === lower || TRAILING_ERROR.includes(lower));
  const beforeOk = before < 0 || text[before] === '\n' || /[^\p{L}\s]/u.test(text[before]) || caseContrast;
  const afterOk = after >= text.length || /[^\p{L}\p{N} \t]/u.test(text[after]) || /^alert(?![\p{L}\p{N}])/iu.test(text.slice(after, after + 6));
  return beforeOk && afterOk;
});
export const hasExampleLabel = (text: string): boolean => exampleLabels(normalizeText(text).text).length > 0;
const WORD_FORMS = STATUS_FORMS.filter((form) => !form.infix && form.concept !== 'example');
const INFIX_FORMS = STATUS_FORMS.filter((form) => form.infix && !form.compoundOnly);
const COMPOUND_FORMS = STATUS_FORMS.filter((form) => form.compoundOnly);
// (A spelling two languages share — "provisional", "error" — is reported as English.)
const FORM_INDEX = new Map<string, StatusForm>();
for (const form of STATUS_FORMS) if (form.language === 'en' && !FORM_INDEX.has(form.form)) FORM_INDEX.set(form.form, form);
for (const form of STATUS_FORMS) if (!FORM_INDEX.has(form.form)) FORM_INDEX.set(form.form, form);
// Matching is driven by the words of the text, so a long input costs one
// lookup per word, never one attempt per character per form: whole-word forms
// are grouped by their first word and tried (sticky) only where a text word
// equals it; compound stems are searched inside each word.
const firstWord = (form: string): string => form.match(/^[\p{L}\p{M}]+/u)?.[0] ?? form;
const WORD_GROUP_FORMS = new Map<string, StatusForm[]>();
for (const form of WORD_FORMS) {
  const key = firstWord(form.form);
  const list = WORD_GROUP_FORMS.get(key);
  if (list) list.push(form); else WORD_GROUP_FORMS.set(key, [form]);
}
// Each group's matcher is compiled the first time a text word needs it.
const WORD_GROUPS = new Map<string, RegExp>();
const wordGroup = (key: string): RegExp | undefined => {
  const cached = WORD_GROUPS.get(key);
  if (cached) return cached;
  const forms = WORD_GROUP_FORMS.get(key);
  if (!forms) return undefined;
  const pattern = new RegExp(`(?:${alternation(forms)})(?![\\p{L}\\p{N}])`, 'iuy');
  WORD_GROUPS.set(key, pattern);
  return pattern;
};
const TEXT_WORD = /[\p{L}\p{M}]+/gu;
const GLUE_TOKEN = /[\p{L}\p{M}]+(?:['’][\p{L}\p{M}]+)*/gu;

// Negation with words between it and the participle: "Not yet posted", "n'a
// pas été effectuée", "no ha sido realizada", "non è stato eseguito", "nie
// została zrealizowana", "ikke blevet gennemført". Up to two auxiliary or
// adverb words may stand between, in the same clause.
const NEGATION_FILLERS = new Set([
  'yet', 'been', 'be', 'fully', 'successfully', 't', 'have', 'has', 'was', 'were', 'is', 'being',
  'noch', 'erfolgreich', 'vollständig', 'wurde', 'worden', 'ganz', 'mehr',
  'été', 'ete', 'encore', 'pu', 'être', 'etre', 'bien', 'correctement',
  'ha', 'han', 'sido', 'se', 'aún', 'aun', 'todavía', 'todavia', 'fue', 'pudo', 'ser', 'correctamente',
  'è', 'e', 'stato', 'stata', 'stati', 'state', 'ancora', 'sono', 'correttamente',
  'nog', 'wordt', 'worden', 'zijn', 'succesvol', 'helemaal',
  'foi', 'foram', 'ainda', 'é',
  'została', 'został', 'zostało', 'zostały', 'jeszcze', 'jest', 'była', 'zostala', 'zostal', 'zostalo',
  'har', 'ännu', 'annu', 'blivit', 'är', 'ar', 'kunnat',
  'blevet', 'endnu', 'er', 'blev', 'blitt', 'ennå', 'enna', 'ble',
  'ještě', 'jeste',
]);
// English contractions arrive as "didn" + "t": the stem is the negator.
const EXTRA_NEGATORS: Partial<Record<StatusLanguage, readonly string[]>> = {
  en: ['couldn', 'didn', 'wasn', 'hasn', 'haven', 'isn', 'weren', 'won', 'cannot'],
};
const NEGATORS = new Map<string, Set<StatusLanguage>>();
const COMPLETED = new Map<string, Set<StatusLanguage>>();
const addTo = (map: Map<string, Set<StatusLanguage>>, key: string, language: StatusLanguage) => {
  const set = map.get(key);
  if (set) set.add(language); else map.set(key, new Set([language]));
};
for (const [language, lexicon] of Object.entries(LEXICON) as [StatusLanguage, LanguageLexicon][]) {
  for (const negator of [...lexicon.negators, ...(EXTRA_NEGATORS[language] ?? [])]) {
    if (!negator.includes(' ')) addTo(NEGATORS, negator, language);
  }
  for (const entry of lexicon.completed) {
    for (const form of inflect(entry)) {
      for (const variant of variants(form.toLocaleLowerCase('de-DE'), language)) if (!variant.includes(' ')) addTo(COMPLETED, variant, language);
    }
  }
}
const sameLanguage = (a: Set<StatusLanguage>, b: Set<StatusLanguage>): boolean => [...a].some((language) => b.has(language));

// A status written into a longer token: "ZAHLUNGABGELEHNT", "#Zahlungabgelehnt",
// "*1234DECLINED", "Köpetgodkändesinte", "PAIEMENTENECHEC". Forms of seven
// letters or more are read anywhere inside another word; forms of five or six
// letters only at its end or start with three more letters ("…ERFOLGTMORGEN",
// "Attesaconferma", "Retrylater"), never in the words listed below
// ("OFFENBACH", "Refusion"). Never Arabic, and never inside the ordinary words that
// happen to contain one ("spending", "independiente", "carta ricaricabile",
// "reservations", "different", "aplicativos", "pozostanie").
const GLUE_MIN = 7;
const GLUE_SUFFIX_MIN = 5;
const GLUE_HOSTS = ['spending', 'depending', 'impending', 'independ', 'preserv', 'unschedul', 'differen', 'ricaricabil',
  'recargabl', 'reservation', 'remboursement', 'icativ', 'ucativ', 'pozostan', 'programm', 'unblock', 'unfrozen',
  // Place names and words that open with a short status ("Offenbach", "Morgenstern").
  'offenb', 'offenburg', 'offens', 'morgenst', 'morgenp', 'zwrotn', 'negativz', 'errors', 'refusion', 'echecs',
  // French "rappelez-nous", "rappeler", "nous rappelons" hold "rappelé" (a recalled transfer).
  'rappelez', 'rappeler', 'rappelon'];
// Phrases read ONLY when glued into one token ("Vardetdu?SvaraJAellerNEJ",
// "#YoupaidSarahLee$25.00"): spaced, a confirmation prompt or a direction is
// read by the template and footer readers, which know a bank's own "Not you?".
const GLUE_ONLY: Partial<Record<StatusLanguage, readonly string[]>> = {
  en: ['reply yes', 'was this you', 'not you', 'you paid', 'you sent', 'you received', 'paid you', 'sent you', 'requested', 'enrolls',
    'alerted'],
  de: ['antworten sie ja', 'waren sie das'],
  fr: ['répondez oui', 'c\'était vous'],
  es: ['responde si', 'responde sí', 'has sido tú'],
  it: ['rispondi si', 'rispondi sì', 'sei stato tu'],
  nl: ['antwoord ja', 'was u dit'],
  pt: ['responda sim', 'foi você'],
  pl: ['odpowiedz tak', 'czy to ty'],
  sv: ['svara ja', 'var det du'],
  da: ['svar ja', 'var det dig', 'send mig'],
  nb: ['svar ja', 'var det deg'],
  cs: ['odpovězte ano', 'byli jste to vy'],
};
const GLUE_FORMS = new Map<string, StatusForm>();
// A refund noun glued onto a purchase ("REWE *1234ERSTATTUNG") contradicts it.
const GLUE_ONLY_RETURNED: Partial<Record<StatusLanguage, readonly string[]>> = { de: ['erstattung', 'rückerstattung'] };
for (const [table, concept] of [[GLUE_ONLY, 'pending'], [GLUE_ONLY_RETURNED, 'refunded']] as const) {
  for (const [language, phrases] of Object.entries(table) as [StatusLanguage, readonly string[]][]) {
    for (const phrase of phrases) {
      for (const spelling of [phrase, stripAccents(phrase)]) {
        GLUE_FORMS.set(spelling.replace(/[\s'’]+/gu, ''), { form: phrase, concept, language, infix: false });
      }
    }
  }
}
for (const form of STATUS_FORMS) {
  if (form.concept === 'example' || form.compoundOnly || form.language === 'ar') continue;
  // Inside a token an English look-alike ("refuse" for "refusé") is the status.
  for (const spelling of [form.form, stripAccents(form.form)]) {
    const glued = spelling.replace(/[\s\-‐'’]+/gu, '');
    if (glued.length >= GLUE_SUFFIX_MIN && /^[\p{L}\p{M}]+$/u.test(glued) && !GLUE_FORMS.has(glued)) GLUE_FORMS.set(glued, form);
  }
}
const GLUE_LENGTHS = [...new Set([...GLUE_FORMS.keys()].map((form) => form.length))].sort((a, b) => a - b);
const gluedHost = (lower: string, at: number, length: number): boolean => GLUE_HOSTS.some((host) => {
  let from = lower.indexOf(host);
  while (from >= 0) {
    if (from < at + length && at < from + host.length) return true;
    from = lower.indexOf(host, from + 1);
  }
  return false;
});

// "Status: Bearbeitung", "Estado: en revisión", "Stav: čeká": a status label
// whose value is not a completion word is a status in itself.
const STATUS_LABEL = /(?<!\p{L})(?:status|statut|estado|stato|stav|tila|state|estat|esito|état|etat|situação|situacao|stan|tilstand|estatus)[ \t_]*[:=][ \t_]*([\p{L}\p{M}]+)/giu;
const SETTLED_VALUES = new Set(['ok', 'okay', 'success', 'successo', 'sukces', 'succes', 'éxito', 'exito', 'sent', 'received', 'delivered',
  'done', 'active', 'aktiv', 'settled', 'cleared', 'booked', 'gebucht', 'ausgeführt', 'erledigt', 'abgeschlossen', 'confirmed', 'live',
  'enviado', 'enviada', 'recibido', 'recibida', 'envoyé', 'envoye', 'reçu', 'recu', 'inviato', 'ricevuto', 'verzonden', 'ontvangen',
  'enviada', 'recebido', 'wysłany', 'wysłana', 'otrzymany', 'skickad', 'mottagen', 'sendt', 'modtaget', 'mottatt', 'odesláno', 'přijato']);

export interface StatusMatch { index: number; text: string; concept: StatusConcept; language: StatusLanguage }

const formFor = (matched: string): StatusForm | undefined => {
  const key = matched.toLocaleLowerCase('de-DE').replace(/[\s_]+/gu, ' ');
  return FORM_INDEX.get(key) ?? FORM_INDEX.get(key.replace(/[-‐]+/gu, ' ')) ??
    FORM_INDEX.get(stripAccents(key)) ?? FORM_INDEX.get(stripAccents(key.replace(/[-‐]+/gu, ' ')));
};

/** Every status word in `text` (case-insensitive, word-boundary safe). */
// A run of more than this many letters is no word of a bank alert: it waits in
// Review rather than being searched letter by letter.
const LONGEST_WORD = 48;

// Phrases that carry a status word without being a status: an authorisation
// REFERENCE ("N° autorisation 918875", "código de autorización"), money that
// arrives at the payee tomorrow, a frozen-yogurt shop. They are read as blanks.
const NEUTRAL_PHRASES = new RegExp([
  String.raw`n[°º]\s*(?:d['’])?autori[sz]ation`, String.raw`num[ée]ro\s+d['’]autorisation`, String.raw`code\s+(?:d['’])?autorisation`,
  String.raw`autorisation\s*(?:n[°º]|:)`, String.raw`c[óo]digo\s+de\s+autori[zs]aci[óo]n`, String.raw`n[º°o]\.?\s*(?:de\s+)?autori[zs]aci[óo]n`,
  String.raw`autori[zs]aci[óo]n\s*(?:n[º°o]|:)`, String.raw`codice\s+(?:di\s+)?autorizzazione`, String.raw`autorizzazione\s*(?:n[°º.]|:)`,
  String.raw`c[óo]digo\s+de\s+autoriza[çc][ãa]o`, String.raw`autorisierungs(?:nummer|code)`, String.raw`autorisatie(?:code|nummer)`,
  String.raw`autoriza[čc]n[íi]\s+k[óo]d`, String.raw`authori[sz]ation\s+(?:code|no\.?|number|#)`, String.raw`auth\.?\s+code`,
  String.raw`(?:will|should|is\s+expected\s+to)\s+arrive\s+(?:by\s+)?tomorrow`, String.raw`arrives?\s+tomorrow`,
  String.raw`frozen\s+(?:yogh?urt|custard|foods?|treats)`, String.raw`stornoway`,
  // A general rule, not this movement: "Card payments can't be undone", "… cannot be recalled".
  String.raw`(?:can(?:no|['’])?t|can\s+not|could\s+not|couldn['’]t)\s+be\s+(?:undone|recalled|retracted|taken\s+back|clawed\s+back|charged\s+back)`,
  // …and the same rule about payments in general, whatever the modal: "Payments
  // can be undone within 30 minutes", "Faster Payments may be recalled only in
  // cases of fraud". (Only a plural or "a payment": "This payment may be
  // reversed" is about this movement and stays a status.)
  String.raw`(?:payments|transfers|deposits|transactions|credits|an?\s+(?:payment|transfer|deposit|transaction))\s+(?:can|cannot|can['’]t|may|might|could|could\s+not|will\s+not|won['’]t)\s+(?:not\s+)?(?:only\s+)?be\s+(?:undone|recalled|reversed|retracted|reclaimed|taken\s+back|clawed\s+back|charged\s+back|pulled\s+back)`,
  // Periodic credits of another kind are no status of this movement:
  // "Interest to be credited monthly", "Cashback to be credited at month end".
  String.raw`(?:interest|cashback|cash\s+back|rewards?|points|bonus|dividends?|profit)\s+(?:[\p{L}-]+\s+){0,2}?to\s+be\s+credited(?:\s+(?:monthly|quarterly|annually|yearly|weekly|daily))?`,
  String.raw`to\s+be\s+credited\s+(?:monthly|quarterly|annually|yearly|weekly|daily|each|every)`,
].map((arm) => `(?<![\p{L}\p{N}])(?:${arm})(?![\p{L}])`).join('|'), 'giu');

/** The text with those phrases blanked (same length), for the other readers. */
export const withoutNeutralPhrases = (text: string): string => text.replace(NEUTRAL_PHRASES, (phrase) => ' '.repeat(phrase.length));

export const findStatusWords = (input: string): StatusMatch[] => {
  const normalized = normalizeText(input);
  const origin = normalized.origin;
  const text = normalized.text.replace(NEUTRAL_PHRASES, (phrase) => ' '.repeat(phrase.length));
  const out: StatusMatch[] = [];
  const push = (index: number, matched: string, form: StatusForm | undefined) => {
    if (form) out.push({ index, text: matched, concept: form.concept, language: form.language });
  };
  const words = [...text.matchAll(TEXT_WORD)];
  for (let w = 0; w < words.length; w += 1) {
    const word = words[w];
    const index = word.index!;
    const lower = word[0].toLocaleLowerCase('de-DE');
    const group = wordGroup(lower);
    if (group) {
      group.lastIndex = index;
      const match = group.exec(text);
      if (match) push(index, match[0], formFor(match[0]));
    }
    for (const form of INFIX_FORMS) {
      const at = lower.indexOf(form.form);
      if (at >= 0) push(index + at, word[0].slice(at, at + form.form.length), form);
    }
    for (const form of COMPOUND_FORMS) {
      const at = lower.indexOf(form.form, 1);
      if (at > 0) push(index + at, word[0].slice(at, at + form.form.length), form);
    }
    // A negator, up to two auxiliary words, then a completion participle.
    const negatorLanguages = NEGATORS.get(lower);
    if (negatorLanguages) {
      let end = index + word[0].length;
      for (let next = w + 1; next < words.length && next <= w + 3; next += 1) {
        const gap = text.slice(end, words[next].index!);
        if (!/^[ \t'’ -]+$/u.test(gap)) break;
        const nextLower = words[next][0].toLocaleLowerCase('de-DE');
        const completed = COMPLETED.get(nextLower);
        if (completed && sameLanguage(completed, negatorLanguages)) {
          const language = [...completed].find((item) => negatorLanguages.has(item))!;
          out.push({ index, text: text.slice(index, words[next].index! + words[next][0].length), concept: 'not-completed', language });
          break;
        }
        if (!NEGATION_FILLERS.has(nextLower)) break;
        end = words[next].index! + words[next][0].length;
      }
    }
  }
  // A status glued into a longer token (apostrophes dropped: "COULDN'TBECOMPLETED").
  for (const token of text.matchAll(GLUE_TOKEN)) {
    const index = token.index!;
    const glued = token[0].replace(/['’]/gu, '');
    const lower = glued.toLocaleLowerCase('de-DE');
    if (lower.length > LONGEST_WORD) {
      out.push({ index, text: glued.slice(0, LONGEST_WORD), concept: 'unreadable', language: 'en' });
    } else if (lower.length >= GLUE_SUFFIX_MIN && GLUE_FORMS.has(lower) && GLUE_FORMS.get(lower)!.form.includes(' ')) {
      // The whole token is a glued phrase ("ONHOLD", "Prévule", "àvenir").
      push(index, glued, GLUE_FORMS.get(lower));
    } else if (lower.length >= GLUE_SUFFIX_MIN + 3) {
      const plain = stripAccents(lower);
      const spellings = plain.length === lower.length && plain !== lower ? [lower, plain] : [lower];
      for (let at = 0; at + GLUE_SUFFIX_MIN <= lower.length; at += 1) {
        for (const length of GLUE_LENGTHS) {
          if (at + length > lower.length) break;
          // A short form only ends or opens the token ("…ERFOLGTMORGEN", "Attesaconferma").
          if (length < GLUE_MIN && !((at + length === lower.length && at >= 3) || (at === 0 && lower.length - length >= 3))) continue;
          for (const spelling of spellings) {
            const form = GLUE_FORMS.get(spelling.slice(at, at + length));
            if (form && !gluedHost(lower, at, length)) { push(index + at, glued.slice(at, at + length), form); break; }
          }
        }
      }
    }
  }
  for (const match of text.matchAll(STATUS_LABEL)) {
    const value = match[1].toLocaleLowerCase('de-DE');
    if (SETTLED_VALUES.has(value) || COMPLETED.has(value)) continue;
    out.push({ index: match.index!, text: match[0], concept: 'pending', language: 'en' });
  }
  for (const match of exampleLabels(text)) out.push({ index: match.index!, text: match[0], concept: 'example', language: 'en' });
  return out.map((match) => ({ ...match, index: origin(match.index) }));
};

/** A status word in `text`, optionally ignoring some languages or concepts. */
export const hasStatusWord = (
  text: string,
  options: { ignoreLanguages?: readonly StatusLanguage[]; ignoreConcepts?: readonly StatusConcept[] } = {},
): boolean => findStatusWords(text).some((match) => match.concept === 'example' || match.concept === 'unreadable' ||
  (!(options.ignoreLanguages ?? []).includes(match.language) && !(options.ignoreConcepts ?? []).includes(match.concept)));

/* ── Which status words describe THIS movement ──────────────────────────── */

// A status word vetoes a posting only when it describes the movement itself.
// Two places never do: a conditional or advice clause ("If your payment was
// declined, contact support", "Wenn Ihre Kartenzahlung abgelehnt wird, …",
// "إذا تم رفض السحب …") and the inside of a capitalised merchant or payee
// name ("at DECLINED CAFE", "chez PAYMENT REQUEST ACCEPTED CAFE"). A status
// that ENDS a name run ("at WALMART DENEGADA", "em SHOP FALHADA") or stands on
// its own line ("… at TARGET\nDECLINED") still describes the movement.

// Conditional openers at the start of a sentence, in every launch language.
// ("When"/"cuando" are left out: "When your card was used … it was declined"
// reports the movement.)
// (Italian/Portuguese "se" only before a negation or a "you" verb: Spanish
// "Se ha rechazado tu pago" is a status, not a condition.)
const CONDITIONAL_OPENER = new RegExp(String.raw`^(?:` + [
  String.raw`if|in\s+case|should\s+you|should\s+(?:this|the|your)`,
  String.raw`wenn|falls|sollten?|im\s+falle?`,
  String.raw`si|s['’]il|s['’]ils|au\s+cas\s+o[uù]|en\s+cas\s+d['’e]`,
  String.raw`en\s+caso\s+de`,
  String.raw`se\s+(?:non|n[ãa]o|nao|hai|ha\s+domande|desideri|vuoi|tiver|quiser|precisar|voc[êe])|qualora|nel\s+caso|caso`,
  String.raw`als|indien|mocht`,
  String.raw`je[śs]li|je[żz]eli|gdy|w\s+przypadku`,
  String.raw`om|ifall|hvis`,
  String.raw`pokud|jestli|jestli[žz]e|v\s+p[řr][íi]pad[ěe]`,
  String.raw`إذا|اذا|في\s+حال|في\s+حالة|لو`,
].join('|') + String.raw`)(?![\p{L}\p{N}])`, 'iu');
// Sentence ends: a line, "!", "?" or a point that is no decimal point ("12.50").
const isSentenceStop = (text: string, at: number): boolean => {
  const char = text[at];
  return char === '\n' || char === '!' || char === '?' || char === '？' || (char === '.' && !/\d/u.test(text[at + 1] ?? ''));
};
// (Bounded: a "sentence" longer than this is read only this far either side,
// so a text without stops costs a fixed amount per status word.)
const SENTENCE_REACH = 400;
const sentenceBounds = (text: string, at: number): [number, number] => {
  let start = at;
  while (start > 0 && at - start < SENTENCE_REACH && !isSentenceStop(text, start - 1)) start -= 1;
  let end = at;
  while (end < text.length && end - at < SENTENCE_REACH && !isSentenceStop(text, end)) end += 1;
  return [start, end];
};
/**
 * True when `at` sits inside a conditional clause: from its opener to the
 * clause's first comma or the sentence end. A clause that carries a money
 * figure ("If your payment of USD 12.50 was declined, …") may be the
 * movement itself, hypothetical: it is never set aside.
 */
const inConditionalClause = (text: string, at: number): boolean => {
  const [start, end] = sentenceBounds(text, at);
  const sentence = text.slice(start, end);
  const lead = sentence.match(/^[^\p{L}\p{N}]*/u)![0].length;
  if (!CONDITIONAL_OPENER.test(sentence.slice(lead))) return false;
  // (A comma between words, never inside a figure: "USD 1,000.00".)
  const comma = sentence.slice(lead).search(/[,،](?!\d)/u);
  const clauseEnd = comma < 0 ? end : start + lead + comma;
  return at < clauseEnd && !/\d/u.test(text.slice(start, clauseEnd));
};
// The word that opens a merchant or payee run, or labels one.
const NAME_RUN_OPENER = /(?<![\p{L}\p{N}])(?:at|from|to|with|in|chez|bei|presso|bij|hos|en|em|no|na|u|w|v|da|de|von|van|fra|från|od|à|au|merchant|händler|commerçant|comercio|esercente|payee|beneficiary|bénéficiaire|empfänger)[ \t]*:?[ \t]+((?:[\p{Lu}\p{N}&'’.*#/-]+[ \t]+){0,5})$/iu;
// Function words and alert labels that continue a sentence, not a name
// ("DECLINED DUE TO …", "DECLINED CALL 800 …", "ABGELEHNT VON …").
const RUN_FUNCTION_WORD = /^(?:WAS|IS|HAS|HAVE|HAD|WERE|WILL|BEEN|BE|TO|FOR|ON|AT|IN|OF|WITH|FROM|AND|OR|BY|DUE|VIA|AS|THE|YOUR|NO|NOT|PLEASE|FUNDS?|INSUFFICIENT|CALL|CONTACT|REPLY|TRY|REF|REFERENCE|TXN|TRANSACTION|PAYMENT|PURCHASE|CARD|ACCOUNT|ACCT|AVL|AVAILABLE|BAL|BALANCE|AMOUNT|AMT|DATE|TIME|WURDE|WIRD|IST|HAT|AM|AN|AUF|VON|FÜR|MIT|UND|WEGEN|BITTE|EST|A|À|AU|PAR|POUR|DE|ET|ES|FUE|HA|POR|PARA|EL|LA|È|E|DA|PER|IS|IN|ER|ÄR|BLEV|BLE|AV|AF|PÅ|FÖR|JE|BYLA|BYL|FOI|PELO|ZOSTAŁA|ZOSTAL|PRZEZ|DO)$/u;
/** True when the match is a word INSIDE a capitalised name run: another name word follows it on the line. */
const insideNameRun = (text: string, match: StatusMatch, shouting: boolean): boolean => {
  // (Read the whole token the match sits in: "DECLINED" holds "DECLINE" too.)
  let from = match.index;
  while (from > 0 && /[\p{L}\p{M}\p{N}'’-]/u.test(text[from - 1])) from -= 1;
  let to = match.index + match.text.length;
  while (to < text.length && /[\p{L}\p{M}\p{N}'’-]/u.test(text[to])) to += 1;
  const token = text.slice(from, to);
  if (!/\p{L}/u.test(token) || token !== token.toLocaleUpperCase('de-DE')) return false;
  // In an all-capitals message every word is capitalised: no name run can be told apart.
  if (shouting) return false;
  // (A run never crosses a sentence: "at LOCAL CAFE. TRANSACTION DECLINED CALL …".)
  const [sentenceStart] = sentenceBounds(text, from);
  const opener = text.slice(Math.max(sentenceStart, from - 80), from).match(NAME_RUN_OPENER);
  // (The words between the opener and the match are name words, never statuses.)
  if (!opener || findStatusWords(opener[1]).length > 0) return false;
  const next = text.slice(to).match(/^[ \t]+([\p{Lu}\p{N}][\p{Lu}\p{N}&'’-]*)(?![\p{Ll}])/u)?.[1];
  if (!next || RUN_FUNCTION_WORD.test(next)) return false;
  // …and the next word is no status itself ("… REWE ABGELEHNT STORNIERT").
  return findStatusWords(next).length === 0;
};

// A sentence about this movement: "this payment", "the money", "it".
const THIS_MOVEMENT = /(?<![\p{L}])(?:(?:this|the|your)[ \t]+(?:payment|purchase|transaction|transfer|charge|deposit|withdrawal|money|funds|card[ \t]+payment)|it)(?![\p{L}])/iu;
// …and one about ANOTHER money object (the balance, a fee, "your planned
// deposit"), or a promotion ("Learn more about scheduled transfers …").
const OTHER_OBJECT = /(?<![\p{L}])(?:your|a|an|the|our|any)[ \t]+(?:[\p{L}-]+[ \t]+)?(balance|fees?|deposit|statement|limit|points|rewards?|cashback|interest|subscription)(?![\p{L}])/iu;
const PROMOTION_OPENER = /^[^\p{L}]*(?:learn\s+more|find\s+out|discover|explore|download|did\s+you\s+know|set\s+up|enjoy|get\s+the\s+app)(?![\p{L}])/iu;
// A money figure: a currency code or sign beside digits ("USD 1,000.00", "$5", "5,00 €"), never "14 days".
const MONEY_FIGURE = /(?:(?<![\p{L}])[A-Z]{3}|[$€£¥₹])[ \t]?\d[\d.,'’]*|\d[\d.,'’]*[ \t]?(?:[$€£¥₹]|[A-Z]{3}(?![\p{L}]))/gu;

/**
 * The status words of `text` that describe the movement itself: never one
 * in a conditional clause or inside a capitalised name run. With `principal`
 * (the amount's span), a word in another English sentence that is about
 * another money object or a promotion — "Your balance USD 1,000.00 has not
 * been updated yet", "A fee of USD 5.00 has not been charged", "Learn more
 * about scheduled transfers" — does not count either; any sentence that names this movement
 * ("This payment was returned", "Sign up to get it") does.
 * Example and unreadable markers always count.
 */
export const transactionStatusWords = (
  text: string,
  options: {
    principal?: { start: number; end: number } | null;
    matches?: readonly StatusMatch[];
    /** Which matches a name run may hold (default: all). */
    nameRunWord?: (match: StatusMatch) => boolean;
  } = {},
): StatusMatch[] => {
  const matches = options.matches ?? findStatusWords(text);
  if (matches.length === 0) return [];
  // (Read once per text, never once per match.)
  const letters = text.match(/\p{L}/gu) ?? [];
  const shouting = letters.length === 0 || letters.filter((letter) => /\p{Lu}/u.test(letter)).length / letters.length > 0.8;
  return matches.filter((match) => {
  if (match.concept === 'example' || match.concept === 'unreadable') return true;
  if (inConditionalClause(text, match.index)) return false;
  if ((options.nameRunWord?.(match) ?? true) && insideNameRun(text, match, shouting)) return false;
  // "Top up" asks the reader to add money only as an imperative ("Top up to
  // complete the payment", "Please top up"); after a name it is the product
  // bought ("payment towards Ooredoo TOPUP", "VODAFONE TOP-UP").
  // (A glued run stays a status: "*1234TOPUPTOCOMPLETE".)
  if (match.concept === 'retry' && /^top[ \t_-]*up$/iu.test(match.text) &&
    !/[\p{L}\p{N}*]/u.test(text[match.index - 1] ?? '') && !/[\p{L}\p{N}]/u.test(text[match.index + match.text.length] ?? '')) {
    const [start] = sentenceBounds(text, match.index);
    if (!/(?:^[^\p{L}\p{N}]*|(?<![\p{L}])(?:please|pls|to|and|then|or|now)[ \t]+|[,;:][ \t]*)$/iu.test(text.slice(start, match.index))) return false;
  }
  const principal = options.principal;
  if (!principal || match.language !== 'en') return true;
  const [start, end] = sentenceBounds(text, match.index);
  if (principal.start < end && start < principal.end) return true;
  const sentence = text.slice(start, end);
  if (THIS_MOVEMENT.test(sentence)) return true;
  // (Its own, different figure names another object too: "Your balance USD 1,000.00 …".)
  const digits = (value: string): string => value.replace(/\D/gu, '');
  const principalFigure = digits(text.slice(principal.start, principal.end));
  const otherFigure = (sentence.match(MONEY_FIGURE) ?? []).some((figure) => digits(figure) !== principalFigure);
  // (The other object must be one the movement's own sentence does not name: "Deposit of $500.00 … Your recent deposit was returned".)
  const [principalStart, principalEnd] = sentenceBounds(text, principal.start);
  const object = sentence.match(OTHER_OBJECT)?.[1];
  const otherObject = object !== undefined &&
    !new RegExp(`(?<![\\p{L}])${object.replace(/s$/u, '')}`, 'iu').test(text.slice(principalStart, principalEnd));
  return !(otherObject || otherFigure || PROMOTION_OPENER.test(sentence));
  });
};
