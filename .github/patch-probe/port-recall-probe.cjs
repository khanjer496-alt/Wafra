'use strict';
// Temporary CI probe (side branch only): which layer refuses the 5 remaining #190 recall shapes. Synthetic bodies only.
const repo = process.argv[2];
const load = require(`${repo}/scripts/universal-test/load-ts.cjs`).createLoader();
const country = load('@/lib/country');
const markets = load('@/lib/markets');
const sms = load('@/lib/sms-parser');
const { interpretBankAlert } = load('@/lib/bank-alert-interpreter');
const { inspectUnparsedLaunchAlert } = load('@/lib/unparsed-launch-alert');
const { createLaunchAlertSession } = load('@/lib/launch-alert-parser');
country.setActiveCountry('AE'); markets.setLedgerCurrency('AED', 2); markets.setActiveMarket('AE');
const session = createLaunchAlertSession({ overrides: {}, pinnedCurrency: 'AED', fxLookup: () => null,
  bestEffort: { enabled: true, country: 'AE' }, regionHint: 'AE' });
const observedAt = Date.parse('2026-10-12T12:00:00Z');
const sender = 'EmiratesNBD';
const p = 'Purchase of AED 50.00 with Debit Card ending 1234 at TEST MART on 01/11/2026.';
const card = 'Your Debit Card ending 4321 was used for AED 45.00 at SAMPLE CAFE on 05/10/2026.';
for (const [name, body] of [
  ['yes/no footer', `${card} Not you? Reply NO to block your card.`],
  ['yes/no ctl', card],
  ['not you? only', `${card} Not you?`],
  ['reply NO only', `${card} Reply NO to block your card.`],
  ['was-this-you 1 line', `${p} Was this you?`],
  ['was-this-you 2 lines', `${p}\nWas this you?`],
  ['was-this-you balance', 'Purchase of AED 50.00 with Debit Card ending 1234 at TEST MART on 01/11/2026. Avl Balance AED 1,000.00 Was this you?'],
  ['purchase ctl', p],
]) {
  const legacy = sms.parseSms(body, {}, { sender, observedAt, fxLookup: () => null });
  let interp = null;
  try { const r = interpretBankAlert({ source: body, sender, market: 'AE', observedAt }); interp = `${r.outcome}/${r.meaning}${r.reason ? '/' + r.reason : ''}`; } catch (e) { interp = 'err ' + e.message; }
  let unparsed = null;
  try { const u = inspectUnparsedLaunchAlert(body, sender); unparsed = `${u.outcome}${u.reason ? '/' + u.reason : ''}`; } catch (e) { unparsed = 'err ' + e.message; }
  const s = session.parse(body, sender, session.inspect(body, sender), 'AE', observedAt);
  console.log(JSON.stringify({ name, nonPosting: sms.nonPostingReason(body), notice: sms.moneyNoticeKind(body),
    legacy: legacy && `${legacy.type} ${legacy.amountFils}`, interp, unparsed, session: s && `${s.type} ${s.amountFils}` }));
}
