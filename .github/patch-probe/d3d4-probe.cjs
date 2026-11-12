'use strict';
// Temporary CI probe (side branch only): where a blanked D3/D4 side note becomes income. Synthetic bodies only.
const repo = process.argv[2];
const load = require(`${repo}/scripts/universal-test/load-ts.cjs`).createLoader();
const country = load('@/lib/country'); const markets = load('@/lib/markets');
const sms = load('@/lib/sms-parser');
const { interpretBankAlert } = load('@/lib/bank-alert-interpreter');
country.setActiveCountry('AE'); markets.setLedgerCurrency('AED', 2); markets.setActiveMarket('AE');
const d = 'AED 250.00 was debited from your card ending 1234 at NOON.COM on 12/11/2026.';
for (const body of [`${d} It is not refunded to your card.`, `${d} The refund is being processed.`, `${d} This amount has not been refunded to your card.`,
  `${d} Your purchase has not been refunded to your card.`, d]) {
  const p = sms.parseSms(body, {}, { sender: 'ENBD', observedAt: Date.parse('2026-11-05T10:00:00Z') });
  let i = null; try { const r = interpretBankAlert({ source: body, sender: 'ENBD', market: 'AE' }); i = `${r.outcome}/${r.meaning}/${r.origin ?? ''}`; } catch (e) { i = 'err ' + e.message; }
  console.log(JSON.stringify({ body: body.slice(d.length + 1), verdict: sms.refundSideNoteVerdict(body), nonPosting: sms.nonPostingReason(body),
    parse: p && { type: p.type, amount: p.amountFils, merchant: p.merchant, category: p.categoryGuess, deliberate: p.categoryDeliberate, transferHint: p.transferHint }, interp: i }));
}
