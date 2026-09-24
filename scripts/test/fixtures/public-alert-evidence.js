/**
 * Privacy-safe fixtures reconstructed from public evidence.
 *
 * Tier B (`standard-derived`) comes from official bank/payment documentation.
 * Tier C (`community-derived`) comes from a public user report whose personal
 * fields have been replaced. No row is a claim that a bank sends these exact
 * fictional values/names, and none may certify automatic import by itself.
 */

/**
 * Documented gaps between the TRUE label (`expected`) and what the shipped
 * parser returns today. A gap may only be wrong in the fail-closed direction:
 * the family, or a status/decision/direction that keeps a real posting OUT of
 * the ledger (never one that makes anything read as posted).
 *
 * - Itaú, Banorte and DBS document heading-style templates ("compra ...",
 *   "cargo recurrente ...", "PayNow outgoing ...") with no completion verb.
 *   The same headings open holds, requests, reversals, fraud questions,
 *   promotions and limit changes, so a heading is not posted evidence and
 *   these rows are refused until a template-specific adapter exists.
 *
 * - The generic reader assigns transfer/utility/recurring families only to a
 *   completed posting, so pending/failed/scheduled/request rows read `unknown`.
 * - "Card charge ... was charged" reads as a fee, "Zelle ... is paid" as a
 *   purchase, and ACH/deposit-posted wording has no transfer term. Fixing any
 *   of these would change first-wave routing/certification outcomes, which is
 *   a separate, reviewed change (see universal-template-certification.test.js).
 * - "was canceled" is not failure vocabulary; the alert is still refused.
 */
const KNOWN_GAPS = Object.freeze({
  'us-chase-charge-alert': { family: 'fee' },
  'us-bofa-zelle-pending-acceptance': { family: 'unknown' },
  'us-bofa-zelle-pending-review': { family: 'unknown' },
  'us-bofa-zelle-paid': { family: 'purchase' },
  'us-bofa-zelle-failed': { family: 'unknown' },
  'us-bofa-ach-debit': { family: 'unknown' },
  'us-wells-deposit-posted': { family: 'unknown' },
  'us-wells-zelle-scheduled': { family: 'unknown' },
  'us-wells-zelle-canceled': { status: 'unknown', family: 'unknown' },
  'ca-td-interac-request-not-posted': { family: 'unknown' },
  'au-anz-osko-failed': { family: 'unknown' },
  'au-anz-upcoming-scheduled': { family: 'unknown' },
  'sg-dbs-future-transfer': { family: 'unknown' },
  'br-itau-purchase-sms': { decision: 'refuse', status: 'unknown', direction: 'none' },
  'mx-banorte-purchase-control': { decision: 'refuse', status: 'unknown', direction: 'none' },
  'mx-banorte-recurring-control': { decision: 'refuse', status: 'unknown', family: 'unknown', direction: 'none' },
  'mx-banorte-refund-control': { decision: 'refuse', status: 'unknown', direction: 'none' },
  'sg-dbs-paynow-outgoing-sms': { decision: 'refuse', status: 'unknown', family: 'unknown', direction: 'none' },
});

const row = (id, market, sender, provenance, sourceRef, body, expected) => Object.freeze({
  id, market, sender, provenance, sourceRef, body, expected,
  ...(KNOWN_GAPS[id] ? { knownGap: Object.freeze({ ...KNOWN_GAPS[id] }) } : {}),
});

module.exports = Object.freeze([
  // United States — major banks publish detailed alert categories. These rows
  // reconstruct those documented event families with fictional values rather
  // than claiming exact bank copy.
  row('us-chase-charge-alert', 'US', 'CHASE', 'standard-derived',
    'chase-account-alerts-official',
    'Chase Bank: Card charge USD 42.10 was charged at SAMPLE SHOP.',
    { decision: 'review', status: 'posted', family: 'purchase', direction: 'debit' }),
  row('us-chase-refund-alert', 'US', 'CHASE', 'standard-derived',
    'chase-account-alerts-official',
    'Chase Bank: Refund USD 18.25 was credited to your card ending 4421.',
    { decision: 'review', status: 'posted', family: 'refund', direction: 'credit' }),
  row('us-chase-fraud-review', 'US', 'CHASE', 'standard-derived',
    'chase-fraud-alerts-official',
    'Chase fraud alert: Did you make this purchase of USD 120.00 at SAMPLE SHOP?',
    { decision: 'refuse', status: 'informational', family: 'authentication', direction: 'none' }),
  row('us-bofa-direct-deposit-alert', 'US', 'BANKOFAMERICA', 'standard-derived',
    'bofa-digital-alerts-official',
    'Bank of America: Direct deposit USD 850.00 was credited to your account.',
    { decision: 'review', status: 'posted', family: 'transfer', direction: 'credit' }),
  row('us-bofa-card-charge-alert', 'US', 'BANKOFAMERICA', 'standard-derived',
    'bofa-digital-alerts-official',
    'Bank of America: Your debit card was charged USD 31.20 at SAMPLE STORE.',
    { decision: 'review', status: 'posted', family: 'purchase', direction: 'debit' }),
  row('us-wells-declined-alert', 'US', 'WELLSFARGO', 'standard-derived',
    'wells-credit-card-alerts-official',
    'Wells Fargo: Card purchase USD 61.20 at RIVER BOOKS was declined.',
    { decision: 'refuse', status: 'failed', family: 'purchase', direction: 'none' }),
  row('us-wells-online-purchase-alert', 'US', 'WELLSFARGO', 'standard-derived',
    'wells-credit-card-alerts-official',
    'Wells Fargo: Online card purchase USD 79.40 was charged at SAMPLE ONLINE STORE.',
    { decision: 'review', status: 'posted', family: 'purchase', direction: 'debit' }),
  row('us-citi-purchase-alert', 'US', 'CITI', 'standard-derived',
    'citi-card-account-alerts-official',
    'Citi Bank: Credit card purchase USD 75.00 was charged at SAMPLE SHOP.',
    { decision: 'review', status: 'posted', family: 'purchase', direction: 'debit' }),
  row('us-discover-purchase-alert', 'US', 'DISCOVERCARD', 'standard-derived',
    'discover-account-alerts-official',
    'Discover Card: Purchase USD 35.00 was charged at SAMPLE SHOP.',
    { decision: 'review', status: 'posted', family: 'purchase', direction: 'debit' }),
  row('us-bofa-zelle-pending-acceptance', 'US', 'BANKOFAMERICA', 'standard-derived',
    'bofa-zelle-status-official',
    'Bank of America: Zelle payment USD 125.00 is pending acceptance by the recipient.',
    { decision: 'refuse', status: 'future', family: 'transfer', direction: 'none' }),
  row('us-bofa-zelle-pending-review', 'US', 'BANKOFAMERICA', 'standard-derived',
    'bofa-zelle-status-official',
    'Bank of America: Incoming Zelle payment USD 210.00 is pending review.',
    { decision: 'refuse', status: 'future', family: 'transfer', direction: 'none' }),
  row('us-bofa-zelle-paid', 'US', 'BANKOFAMERICA', 'standard-derived',
    'bofa-zelle-status-official',
    'Bank of America: Zelle payment USD 95.00 to SAMPLE PERSON is paid.',
    { decision: 'review', status: 'posted', family: 'transfer', direction: 'debit' }),
  row('us-bofa-zelle-failed', 'US', 'BANKOFAMERICA', 'standard-derived',
    'bofa-zelle-status-official',
    'Bank of America: Zelle payment USD 95.00 to SAMPLE PERSON failed.',
    { decision: 'refuse', status: 'failed', family: 'transfer', direction: 'none' }),
  row('us-bofa-incoming-wire-credit', 'US', 'BANKOFAMERICA', 'standard-derived',
    'bofa-zelle-wire-ach-alert-channel-official',
    'Bank of America: Incoming wire transfer USD 1,250.00 was credited to your account.',
    { decision: 'review', status: 'posted', family: 'transfer', direction: 'credit' }),
  row('us-bofa-ach-debit', 'US', 'BANKOFAMERICA', 'standard-derived',
    'bofa-zelle-wire-ach-alert-channel-official',
    'Bank of America: ACH debit USD 65.00 was debited from your account.',
    { decision: 'review', status: 'posted', family: 'transfer', direction: 'debit' }),
  row('us-wells-pending-card-authorization', 'US', 'WELLSFARGO', 'standard-derived',
    'wells-pending-activity-official',
    'Wells Fargo: Card purchase USD 48.20 at SAMPLE GAS is pending authorization.',
    { decision: 'refuse', status: 'future', family: 'purchase', direction: 'none' }),
  row('us-wells-deposit-posted', 'US', 'WELLSFARGO', 'standard-derived',
    'wells-deposit-posted-alert-official',
    'Wells Fargo: Deposit posted USD 500.00 to your account.',
    { decision: 'review', status: 'posted', family: 'transfer', direction: 'credit' }),
  row('us-wells-atm-withdrawal', 'US', 'WELLSFARGO', 'standard-derived',
    'wells-atm-account-activity-official',
    'Wells Fargo: ATM withdrawal USD 100.00 was debited from your account.',
    { decision: 'review', status: 'posted', family: 'cash-withdrawal', direction: 'debit' }),
  row('us-citi-direct-deposit-alert', 'US', 'CITI', 'standard-derived',
    'citi-direct-deposit-alert-official',
    'Citi: Direct deposit USD 1,100.00 was credited to your account.',
    { decision: 'review', status: 'posted', family: 'transfer', direction: 'credit' }),
  row('us-chase-card-payment-posted', 'US', 'CHASE', 'standard-derived',
    'chase-payment-posted-alert-official',
    'Chase Bank: Payment USD 500.00 was credited to your credit card account.',
    { decision: 'review', status: 'posted', family: 'card-payment', direction: 'credit', engine: 'universal' }),
  row('us-chase-available-balance', 'US', 'CHASE', 'standard-derived',
    'chase-balance-alert-official',
    'Chase Bank: Available balance USD 850.00.',
    { decision: 'refuse', status: 'informational', family: 'balance', direction: 'none' }),
  row('us-chase-card-payment-due', 'US', 'CHASE', 'standard-derived',
    'chase-payment-due-alert-official',
    'Chase Bank: Credit card payment due USD 75.00 on 09/30/2026.',
    { decision: 'review', status: 'future', family: 'bill', direction: 'none', engine: 'universal' }),
  row('us-bofa-card-payment-posted', 'US', 'BANKOFAMERICA', 'standard-derived',
    'bofa-card-payment-posted-alert-official',
    'Bank of America: Payment USD 425.00 was credited to your credit card account.',
    { decision: 'review', status: 'posted', family: 'card-payment', direction: 'credit', engine: 'universal' }),
  row('us-citi-low-balance-alert', 'US', 'CITI', 'standard-derived',
    'citi-low-balance-alert-official',
    'Citi: Available balance USD 95.00 is below your selected limit.',
    { decision: 'refuse', status: 'informational', family: 'balance', direction: 'none' }),
  row('us-discover-payment-due', 'US', 'DISCOVERCARD', 'standard-derived',
    'discover-payment-due-alert-official',
    'Discover Card: Payment due USD 60.00 on 09/30/2026.',
    { decision: 'review', status: 'future', family: 'bill', direction: 'none', engine: 'universal' }),
  row('us-wells-zelle-scheduled', 'US', 'WELLSFARGO', 'standard-derived',
    'wells-zelle-notifications-official',
    'Wells Fargo: Zelle payment USD 140.00 is scheduled for tomorrow.',
    { decision: 'refuse', status: 'future', family: 'transfer', direction: 'none' }),
  row('us-wells-zelle-canceled', 'US', 'WELLSFARGO', 'standard-derived',
    'wells-zelle-notifications-official',
    'Wells Fargo: Zelle payment USD 140.00 was canceled.',
    { decision: 'refuse', status: 'failed', family: 'transfer', direction: 'none' }),

  // Canada — TD documents SMS/email Request Money notifications and that funds
  // deposit only after acceptance. Community reports supply a real-world
  // Interac deposit-confirmation grammar with all personal fields replaced.
  row('ca-td-interac-request-not-posted', 'CA', 'TDCANADATRUST', 'standard-derived',
    'td-interac-request-money-official',
    'TD Canada Trust: Interac e-Transfer request for CAD 50.00 received. Accept the request to pay.',
    { decision: 'refuse', status: 'informational', family: 'transfer', direction: 'none' }),
  row('ca-interac-deposit-confirmation', 'CA', '100001', 'community-derived',
    'public-interac-deposit-confirmation-redacted',
    'INTERAC e-Transfer: CAD 250.00 from SAMPLE SENDER has been deposited to your account.',
    { decision: 'review', status: 'posted', family: 'transfer', direction: 'credit',
      currency: 'CAD', minorUnits: '25000', transactionDate: null }),

  // Australia — ANZ documents notifications for Osko send/receive/fail and
  // upcoming scheduled payments. A failed Osko route is not itself proof the
  // payment failed overall because ANZ may retry through another channel.
  row('au-anz-osko-received', 'AU', 'ANZ', 'standard-derived',
    'anz-osko-account-notifications-official',
    'ANZ: AUD 320.00 received via Osko into your account.',
    { decision: 'review', status: 'posted', family: 'transfer', direction: 'credit',
      currency: 'AUD', minorUnits: '32000', transactionDate: null }),
  row('au-anz-osko-failed', 'AU', 'ANZ', 'standard-derived',
    'anz-osko-account-notifications-official',
    'ANZ: Osko payment AUD 75.00 failed. We may attempt another payment channel.',
    { decision: 'refuse', status: 'failed', family: 'transfer', direction: 'none' }),
  row('au-anz-upcoming-scheduled', 'AU', 'ANZ', 'standard-derived',
    'anz-osko-account-notifications-official',
    'ANZ: Upcoming scheduled payment AUD 120.00 is due tomorrow.',
    { decision: 'refuse', status: 'future', family: 'recurring-payment', direction: 'none' }),

  // Brazil — Itaú documents an SMS for every card purchase that tells the
  // customer where and how much was spent. The wording below is reconstructed,
  // while preserving those documented fields.
  row('br-itau-purchase-sms', 'BR', 'ITAU', 'standard-derived',
    'itau-aviso-sms-official',
    'Itaú: compra com cartão BRL 89,90 em MERCADO TESTE.',
    { decision: 'review', status: 'posted', family: 'purchase', direction: 'debit',
      currency: 'BRL', minorUnits: '8990', transactionDate: null }),

  // Mexico — Banorte Avisa officially documents control SMS for purchases,
  // recurring charges and refunds, including date, amount, concept and last4.
  row('mx-banorte-purchase-control', 'MX', 'BANORTE', 'standard-derived',
    'banorte-avisa-official',
    'Banorte: 18/09 compra MXN 1,250.00 SUPERMERCADO. Tarjeta terminación 1234.',
    { decision: 'review', status: 'posted', family: 'purchase', direction: 'debit',
      currency: 'MXN', minorUnits: '125000', transactionDate: null }),
  row('mx-banorte-recurring-control', 'MX', 'BANORTE', 'standard-derived',
    'banorte-avisa-official',
    'Banorte: 18/09 cargo recurrente MXN 299.00 VIDEO CASA. Tarjeta terminación 1234.',
    { decision: 'review', status: 'posted', family: 'recurring-payment', direction: 'debit',
      currency: 'MXN', minorUnits: '29900', transactionDate: null }),
  row('mx-banorte-refund-control', 'MX', 'BANORTE', 'standard-derived',
    'banorte-avisa-official',
    'Banorte: 18/09 devolución MXN 350.00 COMERCIO TESTE. Tarjeta terminación 1234.',
    { decision: 'review', status: 'posted', family: 'refund', direction: 'credit',
      currency: 'MXN', minorUnits: '35000', transactionDate: null }),

  // Singapore — DBS documents outgoing PayNow SMS alerts and selectable alerts
  // for card, transfer, ATM, bill-payment and future-dated transfer activity.
  row('sg-dbs-paynow-outgoing-sms', 'SG', 'DBSSG', 'standard-derived',
    'dbs-paynow-notifications-official',
    'DBS Bank: PayNow outgoing SGD 88.00 to SAMPLE PAYEE.',
    { decision: 'review', status: 'posted', family: 'transfer', direction: 'debit',
      currency: 'SGD', minorUnits: '8800', transactionDate: null }),
  row('sg-dbs-future-transfer', 'SG', 'DBSSG', 'standard-derived',
    'dbs-transaction-alerts-official',
    'DBS Bank: Future-dated funds transfer SGD 150.00 is scheduled for tomorrow.',
    { decision: 'refuse', status: 'future', family: 'transfer', direction: 'none' }),
]);
