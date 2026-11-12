'use strict';
// Temporary CI probe (side branch only): refund side notes on a debit alert, review 1e2ad89f. Synthetic bodies only.
const repo = process.argv[2];
const load = require(`${repo}/scripts/universal-test/load-ts.cjs`).createLoader();
const markets = load('@/lib/markets');
const country = load('@/lib/country');
const { parseSms, nonPostingReason } = load('@/lib/sms-parser');
const { createLaunchAlertSession } = load('@/lib/launch-alert-parser');
const { inspectSourceFreeRefusedAlert } = load('@/lib/auto-import');
country.setActiveCountry('AE');
markets.setActiveMarket('AE');
markets.setLedgerCurrency('AED', 2);
const session = createLaunchAlertSession({ overrides: {}, activeMarket: 'AE', pinnedCurrency: 'AED',
  bestEffort: { enabled: true, country: 'AE' } });
const at = Date.parse('2026-11-05T10:00:00Z');
const fs = require('node:fs');
const vm = require('node:vm');
const resources = `${repo}/modules/wafra-live-capture/ios/Resources`;
const meta = JSON.parse(fs.readFileSync(`${resources}/WafraBackgroundParser.meta.json`));
const sandbox = vm.createContext({});
vm.runInContext(fs.readFileSync(`${resources}/WafraBackgroundParser.js`, 'utf8'), sandbox);
const native = (body) => {
  const out = JSON.parse(sandbox.wafraNativeAlertParse(JSON.stringify({ v: 1, body, sender: 'ENBD', observedAt: at,
    context: { v: 1, country: 'AE', parserMarket: 'AE', ledgerMoney: { currency: 'AED', exponent: 2 }, sourceHash: meta.sourceHash } })));
  return `${out.route}${out.notification ? ` ${out.notification.direction} ${out.notification.amount?.minorUnits}` : ''}`;
};
const confirmed = 'We confirm that AED 85.00 was debited from your account ending 1234 for purchase at AMAZON.COM.';
const debit = 'AED 250.00 was debited from your card ending 1234 at NOON.COM on 12/11/2026.';
const purchase = 'Purchase of AED 50.00 with Debit Card ending 1234 at CARREFOUR.';
const bodies = [
  ['debit alone', debit],
  ['CR reversed then the refund', 'AED 250.00 charged at NOON.COM on 01/11 has been reversed. The refund has been credited to your card ending 1234.'],
  ['CR charged then a refund of the same', 'Your card ending 1234 was charged AED 250.00 at NOON.COM on 01/11. A refund of the same has been credited to your card.'],
  ['debit then the refund credited', `${debit} The refund has been credited to your card.`],
  ['debit then the refund for another order', `${debit} The refund for your cancelled order has been credited to your card.`],
  ['debit then it will be refunded', `${debit} It will be refunded to your card in 5 days.`],
  ['confirmed alone', confirmed],
  ['confirmed + not refunded to', `${confirmed} The annual fee is not refunded to your card.`],
  ['confirmed + when refund credited', `${confirmed} When a refund is credited to your card you will receive an SMS.`],
  ['confirmed + refund for cancelled order', `${confirmed} Refund for your cancelled order has been credited to your card.`],
  ['M purchase not refunded', `${debit} Your purchase has not been refunded to your card.`],
  ['H not refunded to', `${debit} The annual fee is not refunded to your card.`],
  ['H has not been refunded', `${debit} The annual fee has not been refunded to your card.`],
  ['H non-refundable', `${debit} The annual fee is non-refundable.`],
  ['H purchase not refunded to', `${purchase} The annual fee is not refunded to your card.`],
  ['M refund for cancelled order', `${debit} Refund for your cancelled order has been credited to your card.`],
  ['M refund processed to card', `${debit} Your refund has been processed to your card.`],
  ['M it has been refunded', `${debit} It has been refunded to your card.`],
  ['M this amount refunded', `${debit} This amount has been refunded to your card.`],
  ['M refund for this purchase', `${debit} Refund for this purchase has been credited to your card.`],
  ['M refund will be credited', `${debit} The refund will be credited to your card in 5 days.`],
  ['L when refund credited', `${debit} When a refund is credited to your card you will receive an SMS.`],
  ['L if refund credited', `${debit} If a refund is credited to your card, you will receive an SMS.`],
  ['L refunds if any', `${debit} Refunds, if any, will be credited to your card.`],
  ['L refund not credited yet', `${debit} The refund has not been credited yet.`],
  ['L refund queries', `${debit} For refund queries call 600 54 0000.`],
  ['L refund request received', `${debit} Your refund request has been received.`],
  ['own amount is not refunded', 'AED 100.00 is not refunded to your card ending 1234.'],
  ['own amount has not been refunded', 'AED 100.00 has not been refunded to your card ending 1234.'],
  ['genuine + negated fee footer', 'Refund of AED 100.00 from IKEA has been credited to your card ending 1234. The delivery fee is not refunded.'],
  ['genuine + if not refunded footer', 'Refund of AED 100.00 from IKEA has been credited to your card ending 1234. If not refunded within 5 days, call 600 54 0000.'],
  ['purchase refunded one sentence', 'Purchase amount of AED 250.00 at NOON.COM on your Debit Card has been refunded.'],
  ['refund credited', 'Refund of AED 100.00 from IKEA has been credited to your card ending 1234.'],
];
for (const [name, body] of bodies) {
  const p = parseSms(body, {}, { sender: 'ENBD', observedAt: at });
  const s = session.parse(body, 'ENBD', session.inspect(body, 'ENBD'), undefined, at);
  let held = null;
  try {
    const h = inspectSourceFreeRefusedAlert({ source: body, sender: 'ENBD', observedAt: at, channel: 'inbox', session });
    const money = h.candidate?.event?.amount.value ?? h.candidate?.amount;
    held = `${h.kind}${h.reason ? ` ${h.reason}` : ''}${money ? ` ${money.minorUnits}` : ''}${h.candidate?.event?.direction ? ` ${h.candidate.event.direction}` : ''}`;
  } catch (error) { held = `error ${error.message}`; }
  console.log(JSON.stringify({ name, reason: nonPostingReason(body), parse: p && `${p.type} ${p.amountFils}`,
    session: s && `${s.type} ${s.amountFils}`, native: native(body), refusedPath: held }));
}
