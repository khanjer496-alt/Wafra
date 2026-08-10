import type { AlertMarketPack } from '@/lib/alert-market-pack-types';

export const US_EU_ALERT_MARKET_PACKS = {
  US: {
    market: 'US', currencies: ['USD'], currencyAliases: { '$': ['USD'] },
    rails: ['ach', 'wire transfer', 'zelle'],
    transferTerms: ['transfer', 'direct deposit'],
    utilityTerms: ['utility', 'electric', 'water bill', 'gas bill'],
    recurringTerms: ['recurring', 'autopay', 'standing instruction'],
  },
  GB: {
    market: 'GB', currencies: ['GBP'], currencyAliases: {},
    rails: ['faster payments', 'bacs', 'chaps'],
    transferTerms: ['bank transfer'],
    utilityTerms: ['council tax', 'energy bill', 'water bill', 'mobile bill'],
    recurringTerms: ['recurring', 'standing order'],
  },
  FR: {
    market: 'FR', currencies: ['EUR'], currencyAliases: {},
    rails: ['sepa'], transferTerms: ['virement'],
    utilityTerms: ['électricité', 'gaz', 'eau', 'téléphone'],
    recurringTerms: ['récurrent', 'abonnement'],
    postedTerms: ['débité', 'crédité', 'effectué'],
    failedTerms: ['refusé', 'rejeté', 'échoué'], futureTerms: ['sera débité', 'à venir'],
    debitTerms: ['débité'], creditTerms: ['crédité'],
  },
  DE: {
    market: 'DE', currencies: ['EUR'], currencyAliases: {},
    rails: ['sepa'], transferTerms: ['überweisung'],
    utilityTerms: ['strom', 'gas', 'wasser', 'telefon'],
    recurringTerms: ['dauerauftrag', 'lastschrift', 'abonnement'],
    failedTerms: ['abgelehnt', 'fehlgeschlagen'], futureTerms: ['wird abgebucht', 'fällig'],
    debitTerms: ['belastet', 'abgebucht'], creditTerms: ['gutgeschrieben'],
  },
  ES: {
    market: 'ES', currencies: ['EUR'], currencyAliases: {},
    rails: ['sepa', 'bizum'], transferTerms: ['transferencia'],
    utilityTerms: ['suministros', 'electricidad', 'agua', 'teléfono'],
    recurringTerms: ['recurrente', 'suscripción'],
    failedTerms: ['rechazado', 'fallido'], futureTerms: ['se cargará', 'próximo'],
    debitTerms: ['cargado', 'pagado'], creditTerms: ['abonado'],
  },
  IT: {
    market: 'IT', currencies: ['EUR'], currencyAliases: {},
    rails: ['sepa'], transferTerms: ['bonifico'],
    utilityTerms: ['utenza', 'elettricità', 'acqua', 'telefono'],
    recurringTerms: ['ricorrente', 'abbonamento'],
    failedTerms: ['rifiutato', 'fallito'], futureTerms: ['sarà addebitato', 'in scadenza'],
    debitTerms: ['addebitato'], creditTerms: ['accreditato'],
  },
  NL: {
    market: 'NL', currencies: ['EUR'], currencyAliases: {},
    rails: ['sepa', 'ideal'], transferTerms: ['overboeking'],
    utilityTerms: ['energie', 'water', 'telefoon'],
    recurringTerms: ['periodiek', 'abonnement'],
    failedTerms: ['geweigerd', 'mislukt'], futureTerms: ['wordt afgeschreven', 'aankomend'],
    debitTerms: ['afgeschreven', 'betaald'], creditTerms: ['bijgeschreven'],
  },
} as const satisfies Record<string, AlertMarketPack>;
