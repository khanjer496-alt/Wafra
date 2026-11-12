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
  ['3c returned cheque fee + other refund', 'A returned cheque fee of AED 50.00 was debited from your account ending 1234. Refund for your cancelled order has been credited to your card.'],
  ['3c reversed charges apply + other refund', 'AED 250.00 was debited from your card ending 1234 at NOON.COM (reversed charges apply). Refund for your cancelled order has been credited to your card.'],
  ['3c the refund is being processed', 'AED 250.00 was debited from your card ending 1234 at NOON.COM on 12/11/2026. The refund is being processed.'],
  ['3c CR reversed then the refund', 'AED 250.00 charged at NOON.COM on 01/11 has been reversed. The refund has been credited to your card ending 1234.'],
  ['3c CR charged then a refund of the same', 'Your card ending 1234 was charged AED 250.00 at NOON.COM on 01/11. A refund of the same has been credited to your card.'],
  ['F4 dotted no digits', 'Purchase amount of AED 250.00 at NOON.COM on your Debit Card has been refunded.'],
  ['F4 dotted digits', 'Purchase amount of AED 250.00 at NOON.COM on your Debit Card ending 1234 has been refunded.'],
  ['F4 plain no digits', 'Purchase amount of AED 250.00 at NOON on your Debit Card has been refunded.'],
  ['F4 www successfully to card', 'Purchase amount of AED 250.00 at WWW.NOON.COM on your Credit Card ending 1234 has been successfully refunded to your card.'],
  ['F4 ctl LIV', 'Purchase amount of AED 106.00 at CAREEM on your Credit Card ending 1234 has been refunded to your card. Avl Limit is AED 22,475.82.'],
  ['F4 ctl PAYPAL card account', 'Purchase amount of AED 3.78 at PAYPAL on your Debit Card has been refunded to your card account. Avl Bal is AED 3,998.93.'],
  ['F4 shape purchase of with card at dotted refunded', 'Purchase of AED 250.00 with Debit Card ending 1234 at NOON.COM has been refunded.'],
  ['F4 shape purchase of at dotted with card reversed', 'Purchase of AED 250.00 at NOON.COM with Debit Card ending 1234 has been reversed.'],
  ['F4 ctl plain purchase dotted', 'Purchase of AED 120.50 with Credit Card ending 1234 at NOON.COM. Avl Limit is AED 9,880.00'],
  ['F4 refuse will be refunded', 'Purchase amount of AED 250.00 at NOON.COM on your Debit Card will be refunded.'],
  ['F4 refuse not refunded', 'Purchase amount of AED 250.00 at NOON.COM on your Debit Card has not been refunded.'],
  ['F4 refuse pending refund', 'Purchase amount of AED 250.00 at NOON.COM on your Debit Card is pending refund.'],
  ['F4 refuse request', 'Your refund request for the purchase amount of AED 250.00 at NOON.COM has been received.'],
  ['F4 refuse reversed and will be refunded', 'Purchase amount of AED 250.00 at NOON.COM on your Debit Card has been reversed and will be refunded.'],
  ['KL1 confirmed + when refund', `${confirmed} When a refund is credited to your card you will receive an SMS.`],
  ['KL2 purchase of + when refund', `${purchase} When a refund is credited to your card you will receive an SMS.`],
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
