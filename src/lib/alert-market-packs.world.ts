import type { AlertMarketPack } from '@/lib/alert-market-pack-types';

/**
 * Second-wave review-only market packs: Canada, Australia, Brazil, Mexico,
 * Singapore, Colombia and Peru.
 *
 * Like the first-wave packs these add vocabulary and routing evidence only.
 * They do not authorize automatic ledger import by themselves, and their
 * fixtures are standard-/community-derived reconstructions, not consented real
 * alerts. Every term here is scoped to its own market: a bare `$` means CAD
 * only after an alert has been routed to Canada, and Spanish or Portuguese
 * words never change how another market's alerts are read.
 *
 * Terms are deliberately phrase-shaped where a single word would be ambiguous
 * (for example "internet" is a purchase channel, not a utility, and "fast" is
 * an English word, not the FAST rail).
 */
export const WORLD_ALERT_MARKET_PACKS = {
  CA: {
    market: 'CA', currencies: ['CAD'], currencyAliases: { 'C$': ['CAD'], '$': ['CAD'] },
    rails: ['interac e-transfer', 'interac etransfer', 'eft'],
    transferTerms: ['interac e-transfer', 'interac etransfer', 'electronic funds transfer', 'bank transfer'],
    utilityTerms: ['utility', 'hydro bill', 'electricity bill', 'gas bill', 'water bill', 'mobile bill'],
    recurringTerms: ['recurring', 'pre-authorized debit', 'pre-authorized payment', 'automatic payment'],
  },
  AU: {
    market: 'AU', currencies: ['AUD'], currencyAliases: { 'A$': ['AUD'], '$': ['AUD'] },
    // BPAY is a bill-payment rail, not proof of a utility bill.
    rails: ['npp', 'osko', 'payid', 'payto', 'bpay'],
    transferTerms: ['npp payment', 'osko', 'payid', 'bank transfer'],
    utilityTerms: ['electricity bill', 'energy bill', 'water bill', 'mobile bill'],
    recurringTerms: ['payto', 'direct debit', 'recurring payment', 'scheduled payment'],
  },
  BR: {
    market: 'BR', currencies: ['BRL'], currencyAliases: { 'R$': ['BRL'] },
    rails: ['pix', 'ted'],
    transferTerms: ['pix', 'transferência', 'transferencia', 'ted'],
    utilityTerms: [
      'conta de luz', 'energia elétrica', 'energia eletrica', 'conta de água', 'conta de agua',
      'conta de telefone', 'conta de internet',
    ],
    recurringTerms: ['pix automático', 'pix automatico', 'débito automático', 'debito automatico', 'assinatura recorrente'],
    // Completion verbs only. Template headings such as "compra com cartão" or
    // "compra aprovada" name an event family, not a settled posting: the same
    // heading also opens holds, reversals, questions and future charges.
    postedTerms: [
      'debitado', 'debitada', 'creditado', 'creditada', 'recebido', 'recebida',
      'foi pago', 'foi paga', 'concluído', 'concluido', 'compra realizada', 'pagamento realizado',
      'pagamento efetuado', 'foi estornado', 'foi estornada',
      // Completed person-to-person transfers.
      'você enviou', 'voce enviou', 'você recebeu', 'voce recebeu', 'pix enviado', 'transferência enviada',
      'transferencia enviada',
    ],
    failedTerms: [
      'recusado', 'recusada', 'negado', 'negada', 'falhou', 'não aprovado', 'nao aprovado',
      'não aprovada', 'nao aprovada', 'não autorizada', 'nao autorizada', 'cancelado', 'cancelada',
    ],
    futureTerms: [
      'será debitado', 'sera debitado', 'será debitada', 'sera debitada', 'será creditado', 'sera creditado',
      'será creditada', 'sera creditada', 'será pago', 'sera pago', 'será paga', 'sera paga',
      'será cobrado', 'sera cobrado', 'será cobrada', 'sera cobrada', 'será lançada', 'sera lancada',
      'será lançado', 'sera lancado', 'será processada', 'sera processada', 'será processado', 'sera processado',
      'agendado', 'agendada', 'próxima compra', 'proxima compra', 'suas compras',
    ],
    debitTerms: [
      'compra com cartão', 'compra com cartao', 'compra aprovada', 'debitado', 'debitada',
      'cobrado', 'cobrada', 'foi pago', 'foi paga', 'você enviou', 'voce enviou', 'pix enviado',
      'transferência enviada', 'transferencia enviada',
    ],
    creditTerms: [
      'creditado', 'creditada', 'recebido', 'recebida', 'estorno', 'estornado', 'estornada',
      'você recebeu', 'voce recebeu',
    ],
    purchaseTerms: ['compra com cartão', 'compra com cartao', 'compra aprovada', 'compra no débito', 'compra no crédito'],
    refundTerms: ['estorno', 'estornado', 'estornada', 'reembolso'],
    cashTerms: ['saque'],
    feeTerms: ['tarifa'],
    moneyLabels: ['recebido', 'recebida', 'creditado', 'creditada', 'debitada', 'estorno', 'saque', 'pix'],
  },
  MX: {
    market: 'MX', currencies: ['MXN'], currencyAliases: { 'MX$': ['MXN'], '$': ['MXN'] },
    rails: ['spei', 'codi', 'dimo'],
    transferTerms: ['spei', 'transferencia', 'transferencia electrónica', 'transferencia electronica'],
    utilityTerms: ['recibo de luz', 'recibo de agua', 'recibo de teléfono', 'recibo de telefono', 'electricidad'],
    recurringTerms: ['domiciliación', 'domiciliacion', 'pago recurrente', 'cargo recurrente'],
    // Completion verbs only: "compra", "cargo recurrente" and "devolución"
    // are headings that also open requests, holds, fraud questions,
    // promotions and future charges, so they classify family, never posting.
    postedTerms: [
      'compra realizada', 'compra aplicada', 'cargo aplicado', 'devolución aplicada', 'devolucion aplicada',
      'fue cargado', 'fue cargada', 'fue abonado', 'fue abonada',
      // Second-person preterites state completion.
      'enviaste', 'recibiste', 'retiraste', 'transferencia enviada', 'transferencia recibida',
    ],
    failedTerms: [
      'rechazado', 'rechazada', 'fallido', 'fallida', 'no aprobado', 'no aprobada',
      'no autorizado', 'no autorizada', 'declinada', 'declinado', 'cancelado', 'cancelada',
    ],
    // "compra" is a posting word only for a purchase that happened; an offer
    // about a next purchase is not one.
    futureTerms: [
      'se cargará', 'se cargara', 'se abonará', 'se abonara', 'se aplicará', 'se aplicara',
      'se reflejará', 'se reflejara', 'será cargado', 'sera cargado', 'será cargada', 'sera cargada',
      'será abonado', 'sera abonado', 'será abonada', 'sera abonada', 'programado', 'programada',
      'próxima compra', 'proxima compra', 'siguiente compra', 'tus compras', 'meses sin intereses',
    ],
    debitTerms: [
      'compra', 'cargo recurrente', 'cargado', 'cargada', 'debitado', 'debitada', 'pagado', 'pagada',
      'enviaste', 'retiraste', 'transferencia enviada',
    ],
    creditTerms: [
      'devolución', 'devolucion', 'reembolso', 'abonado', 'abonada', 'acreditado', 'acreditada',
      'recibiste', 'transferencia recibida',
    ],
    purchaseTerms: ['compra'],
    refundTerms: ['devolución', 'devolucion', 'reembolso'],
    cashTerms: ['retiro de efectivo', 'retiro en cajero', 'retiraste'],
    feeTerms: ['comisión', 'comision'],
    moneyLabels: ['cargo recurrente', 'devolución', 'devolucion', 'retiro de efectivo', 'spei'],
  },
  // Colombia and Peru: review/best-effort only, exactly like the packs above.
  // "$" is COP only after an alert has been routed to Colombia (issuer, Bre-B,
  // PSE or TransfiYa); S/ is unique to Peru. Spanish second-person preterites
  // ("compraste", "pagaste", "recibiste") state completion; approval words
  // ("aprobado(a)") do not, and post only inside an exact bank template
  // (src/lib/latam-alert-templates.ts).
  CO: {
    market: 'CO', currencies: ['COP'], currencyAliases: { '$': ['COP'], 'COP$': ['COP'] },
    rails: ['bre-b', 'breb', 'pse', 'transfiya'],
    transferTerms: ['transferiste', 'enviaste', 'te enviaron', 'recibiste una transferencia', 'transferencia', 'bre-b', 'transfiya'],
    utilityTerms: ['servicios públicos', 'servicios publicos', 'factura de energía', 'factura de energia', 'factura de agua', 'factura de gas'],
    recurringTerms: ['débito automático', 'debito automatico', 'pago automático', 'pago automatico'],
    postedTerms: [
      'compraste', 'pagaste', 'retiraste', 'transferiste', 'enviaste', 'recibiste', 'te enviaron',
      'te envió', 'te envio', 'paso plata',
    ],
    failedTerms: [
      'rechazada', 'rechazado', 'declinada', 'declinado', 'no aprobada', 'no aprobado', 'no autorizada',
      'no autorizado', 'no fue posible', 'fallida', 'fallido', 'cancelada', 'cancelado',
    ],
    futureTerms: [
      'programado', 'programada', 'se debitará', 'se debitara', 'tienes un pago', 'completa tu pago',
      'pago mínimo', 'pago minimo', 'fecha límite', 'fecha limite', 'te pidió', 'te pidio',
    ],
    debitTerms: ['compraste', 'compra', 'pagaste', 'retiraste', 'transferiste', 'enviaste', 'paso plata', 'avance'],
    creditTerms: ['recibiste', 'te enviaron', 'te envió', 'te envio', 'consignación', 'consignacion', 'abono'],
    purchaseTerms: ['compraste', 'compra', 'pagaste'],
    refundTerms: ['devolución', 'devolucion', 'reembolso', 'reverso'],
    cashTerms: ['retiraste', 'retiro', 'cajero'],
    feeTerms: ['cuota de manejo', 'comisión', 'comision'],
    moneyLabels: ['compraste', 'pagaste', 'retiraste', 'transferiste', 'enviaste', 'recibiste', 'te enviaron', 'paso plata'],
  },
  PE: {
    // Only S/ is the sol: BCP and Interbank print dollar amounts as US$, which
    // stays dollar money (never PEN) in a Peru-routed alert.
    market: 'PE', currencies: ['PEN'], currencyAliases: { 'S/': ['PEN'], 'S/.': ['PEN'] },
    rails: ['yape', 'plin', 'cci'],
    transferTerms: ['yapeaste', 'te yapeó', 'te yapeo', 'te envió un pago', 'te envio un pago', 'has enviado', 'enviaste', 'transferencia', 'plin', 'cci'],
    utilityTerms: ['recibo de luz', 'recibo de agua', 'pago de servicios'],
    recurringTerms: ['débito automático', 'debito automatico', 'cargo recurrente'],
    postedTerms: [
      'realizaste', 'yapeaste', 'te yapeó', 'te yapeo', 'te envió', 'te envio', 'te envío', 'te ha enviado',
      'has enviado', 'enviaste', 'recibiste', 'pagaste', 'transferencia efectuada', 'transferencia recibida',
    ],
    failedTerms: [
      'rechazada', 'rechazado', 'declinada', 'declinado', 'no aprobada', 'no aprobado', 'no autorizada',
      'no autorizado', 'no fue posible', 'fallida', 'fallido', 'cancelada', 'cancelado',
    ],
    futureTerms: ['programado', 'programada', 'se cargará', 'se cargara', 'pago mínimo', 'pago minimo', 'fecha límite', 'fecha limite'],
    debitTerms: ['realizaste un consumo', 'consumo', 'compra', 'yapeaste', 'has enviado', 'enviaste', 'pagaste', 'transferencia efectuada'],
    creditTerms: ['te yapeó', 'te yapeo', 'te envió', 'te envio', 'te envío', 'te ha enviado', 'recibiste', 'abono', 'transferencia recibida'],
    purchaseTerms: ['consumo', 'compra'],
    refundTerms: ['devolución', 'devolucion', 'extorno', 'reembolso'],
    cashTerms: ['retiro', 'cajero'],
    feeTerms: ['comisión', 'comision'],
    moneyLabels: ['consumo', 'yapeaste', 'te yapeó', 'te envió', 'te ha enviado', 'has enviado', 'enviaste', 'recibiste'],
  },
  SG: {
    market: 'SG', currencies: ['SGD'], currencyAliases: { 'S$': ['SGD'], '$': ['SGD'] },
    rails: ['paynow', 'fast transfer', 'giro', 'sgqr'],
    transferTerms: ['paynow', 'fast transfer', 'fund transfer', 'funds transfer', 'bank transfer'],
    utilityTerms: ['utility bill', 'electricity bill', 'water bill', 'gas bill', 'mobile bill'],
    recurringTerms: ['giro', 'recurring', 'standing instruction', 'scheduled payment'],
    // No posted terms: "PayNow outgoing" and "card transaction" are headings
    // that also open limit changes, holds and approval requests.
    debitTerms: ['paynow outgoing', 'local card transaction', 'online card transaction'],
    purchaseTerms: ['local card transaction', 'online card transaction'],
    moneyLabels: ['paynow outgoing', 'local card transaction', 'online card transaction'],
  },
} as const satisfies Record<string, AlertMarketPack>;
