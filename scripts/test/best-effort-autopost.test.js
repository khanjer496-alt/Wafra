// Best-effort automatic posting for UNPROVEN bank-alert formats.
//
// Only the UAE/Saudi launch grammar and certified templates are proven. Every
// other format may still be added automatically, but only through the single
// policy in best-effort-autopost.ts, and every such row carries the
// "Auto-added — check" marker so the person can confirm, edit or undo it.
// These cases pin the guardrails: what posts, what always stays in Review,
// how the setting and undo behave, and that AE/SA behaviour is unchanged.
const fs = require('node:fs');
const path = require('node:path');
const policy = require('./build/best-effort-autopost');
const { createLaunchAlertSession } = require('./build/launch-alert-parser');
const { inspectUniversalBankEvent } = require('./build/universal-parser');
const { buildImportPlan } = require('./build/import-plan');
const { parseHistoricalMessageRecords } = require('./build/historical-import');
const { inspectSourceFreeRefusedAlert } = require('./build/auto-import');
const { isValidBackupState } = require('./build/backup-validation');
const markets = require('./build/markets');
const i18n = require('./build/i18n');

let pass = 0;
let fail = 0;
function ok(name, condition, detail) {
  if (condition) { pass += 1; console.log(`✓ ${name}`); }
  else { fail += 1; console.log(`✗ ${name}`, detail === undefined ? '' : JSON.stringify(detail)); }
}

const NOW = Date.parse('2026-09-06T10:00:00Z');
const session = (currency, country, extra = {}) => createLaunchAlertSession({
  overrides: {},
  pinnedCurrency: currency,
  fxLookup: () => null,
  bestEffort: { enabled: true, country },
  ...extra,
});
const unproven = (currency, country, sender, body, extra) => {
  const s = session(currency, country, extra);
  return s.parseUnproven(body, sender, s.inspect(body, sender), NOW);
};

/* ── Posts: one clear completed movement, marked for checking ─────────── */
for (const [currency, country, sender, body, minor, format] of [
  ['USD', 'US', 'CHASE', 'Chase Bank alert: Your card ending 4421 was charged USD 24.86 at NORTH STAR MARKET.', 2486, 'universal:purchase:debit'],
  ['USD', 'US', 'CHASE', 'Chase: You made a $24.86 purchase at NORTH STAR MARKET with card ending 4421.', 2486, 'universal:purchase:debit'],
  ['EUR', 'DE', 'DEUTSCHEBANK', 'Deutsche Bank: Kartenzahlung EUR 28,40 wurde belastet bei NORD MARKT.', 2840, 'universal:purchase:debit'],
  ['INR', 'IN', 'VM-HDFCBK-T', 'HDFC Bank: INR 1,249.50 debited on card ending 7312 for purchase at NORTH MART.', 124950, 'universal:purchase:debit'],
  ['INR', 'IN', 'VM-HDFCBK-T', 'HDFC Bank: Rs 1,249.50 debited on card ending 7312 for purchase at NORTH MART.', 124950, 'universal:purchase:debit'],
  ['JPY', 'JP', 'SMBC', 'SMBC card ending 1234: purchase JPY 3,200 at NORTH MART.', 3200, 'universal:purchase:debit'],
  ['JPY', 'JP', 'SMBC', 'SMBC card ending 1234: purchase of ¥3,200 at NORTH MART.', 3200, 'universal:purchase:debit'],
  ['KES', 'KE', 'EQUITY', 'Equity Bank: KES 1,250.00 spent at NORTH MART with card ending 4411.', 125000, 'universal:purchase:debit'],
  ['USD', 'US', 'CHASE', 'Chase: Refund of USD 24.86 from NORTH STAR MARKET credited to card ending 4421.', 2486, 'universal:refund:credit'],
  ['USD', 'US', 'CHASE', 'Chase Bank alert: Your card ending 4421 was charged USD 24.86 at NORTH STAR MARKET. Available balance USD 900.00.', 2486, 'universal:purchase:debit'],
]) {
  const row = unproven(currency, country, sender, body);
  ok(`${country}: posts ${body.slice(0, 48)}…`,
    row?.kind === 'transaction' && row.amountFils === minor && row.currency === currency &&
      row.bestEffort?.v === 1 && row.bestEffort.format === format && row.bestEffort.market === country,
    row);
  ok(`${country}: marker holds code-owned identifiers only`,
    row && Object.keys(row.bestEffort).sort().join() === 'format,market,v' &&
      !JSON.stringify(row.bestEffort).includes(sender) && !/\d{3}/.test(JSON.stringify(row.bestEffort)));
}
{
  const refund = unproven('USD', 'US', 'CHASE', 'Chase: Refund of USD 24.86 from NORTH STAR MARKET credited to card ending 4421.');
  ok('a refund is money in', refund?.type === 'income', refund);
  const transfer = unproven('USD', 'US', 'CHASE', 'Chase: Transfer of USD 40.00 debited from account ending 4421 to JOHN SMITH.');
  ok('a directed transfer posts as a transfer, never as spending at a person',
    transfer?.transferHint === true && transfer.type === 'expense' && transfer.merchant === 'Outgoing transfer' &&
      transfer.bestEffort?.format === 'universal:transfer:debit', transfer);
}

/* ── Never posts: every non-completed or unclear message stays in Review ── */
for (const [label, body] of [
  ['pending authorisation', 'Chase: A pending authorization of USD 24.86 at NORTH STAR MARKET on card ending 4421.'],
  ['declined', 'Chase: Your purchase of USD 24.86 at NORTH STAR MARKET was declined. Card ending 4421.'],
  ['OTP', 'Your OTP for USD 24.86 purchase at NORTH STAR MARKET is 123456. Do not share.'],
  ['balance only', 'Chase: Your account ending 4421 balance is USD 1,024.86.'],
  ['promotion', 'Get 20% cashback! Spend USD 50.00 at NORTH STAR MARKET this week.'],
  ['payment request', 'John requested USD 24.86 from you.'],
  ['future charge', 'Chase Bank alert: Your card ending 4421 will be charged USD 24.86 at NORTH STAR MARKET.'],
  ['reversal wording', 'Chase Bank alert: Your card ending 4421 was charged USD 24.86 at NORTH STAR MARKET. Reversed.'],
  ['two competing amounts', 'Chase Bank alert: Your card ending 4421 was charged USD 24.86 and USD 12.00 at NORTH STAR MARKET.'],
  ['undirected transfer', 'Chase: USD 40.00 transferred from your account ending 4421 to JOHN SMITH.'],
  ['future-dated', 'Chase Bank alert: Your card ending 4421 was charged USD 24.86 at NORTH STAR MARKET on 2026-12-30.'],
  ['statement', 'Chase: Your statement is ready. Statement balance USD 1,024.86, minimum payment due USD 35.00.'],
]) {
  ok(`never auto-added: ${label}`, unproven('USD', 'US', 'CHASE', body) === null);
}
for (const body of [
  'Deutsche Bank: Kartenzahlung EUR 28,40 ausstehend bei NORD MARKT.',
  'BNP Paribas : paiement par carte EUR 32,70 refusé chez MAISON VERTE.',
  'Santander: compra de EUR 12,00 pendiente en TIENDA SOL.',
]) {
  ok(`non-English non-completed wording is refused: ${body.slice(0, 40)}`, policy.hasNonCompletedWording(body));
}
ok('completed German wording is not mistaken for a future charge',
  !policy.hasNonCompletedWording('Deutsche Bank: Kartenzahlung EUR 28,40 wurde belastet bei NORD MARKT.'));

/* ── Currency: a shared symbol resolves through the bank's route, else the user's country ── */
{
  const dollar = 'Chase: You made a $24.86 purchase at NORTH STAR MARKET with card ending 4421.';
  ok('$ from a US bank for a user in Germany stays in Review without a rate', unproven('EUR', 'DE', 'CHASE', dollar) === null);
  const event = inspectUniversalBankEvent(dollar, { sender: 'CHASE' });
  const decide = (country, routedMarket, ledgerCurrency, fxLookup) => policy.decideBestEffortAutoPost({
    source: dollar, event, enabled: true, country, routedMarket,
    ledgerCurrency, ledgerExponent: 2, observedAt: NOW, ...(fxLookup ? { fxLookup } : {}),
  });
  const decision = decide('DE', 'US', 'EUR');
  ok('…read as USD and waiting for a rate', decision.outcome === 'review' && decision.reason === 'fx-rate-unavailable', decision);
  // The route wins over the user's country: never the user's own dollar.
  const mx = decide('MX', 'US', 'MXN');
  ok('$ from a US bank for a user in Mexico is not MXN', mx.outcome === 'review' && mx.reason === 'fx-rate-unavailable', mx);
  const mxRate = decide('MX', 'US', 'MXN', (base, quote, date) => (base === 'USD' && quote === 'MXN' ? { base, quote, rate: 18, date } : null));
  ok('…and converts from USD with a dated rate', mxRate.outcome === 'post' && JSON.stringify(mxRate).includes('USD'), mxRate);
  const us = decide('US', 'CA', 'USD');
  ok('$ from a Canadian bank for a US user is CAD, not USD', us.outcome === 'review' && us.reason === 'fx-rate-unavailable', us);
  ok('$ with a route matching the country stays in that currency', decide('US', 'US', 'USD').outcome === 'post');
  ok('$ with no route resolves through the country', decide('US', null, 'USD').outcome === 'post');
  ok('$ with a route that has no dollar is unclear', decide('US', 'GB', 'USD').reason === 'currency-unclear');
  ok('$ for a user in the United States resolves to USD', policy.sharedSymbolCurrencyForCountry('US') === 'USD');
  ok('an unshared-symbol country resolves nothing', policy.sharedSymbolCurrencyForCountry('DE') === null);
}

/* ── Foreign money converts only with a dated rate already on the device ── */
{
  const body = 'HDFC Bank: EUR 45.00 debited on card ending 7312 for purchase at CAFE DE FLORE on 2026-09-05.';
  const withRate = unproven('INR', 'IN', 'VM-HDFCBK-T', body, {
    fxLookup: (base, quote, date) => (base === 'EUR' && quote === 'INR' ? { base, quote, rate: 100, date } : null),
  });
  ok('a foreign charge with a known rate posts converted, keeping the original',
    withRate?.currency === 'INR' && withRate.amountFils === 450000 && withRate.originalCurrency === 'EUR' &&
      withRate.fxSource === 'reference' && withRate.bestEffort?.v === 1, withRate);
  ok('without a rate the alert waits in Review', unproven('INR', 'IN', 'VM-HDFCBK-T', body) === null);
  const event = inspectUniversalBankEvent(body, { sender: 'VM-HDFCBK-T' });
  const decision = policy.decideBestEffortAutoPost({
    source: body, event, enabled: true, country: 'IN', routedMarket: 'IN',
    ledgerCurrency: 'INR', ledgerExponent: 2, observedAt: NOW, fxLookup: () => null,
  });
  ok('…with reason fx-rate-unavailable', decision.reason === 'fx-rate-unavailable', decision);
}

/* ── The setting ─────────────────────────────────────────────────────── */
{
  const body = 'Chase Bank alert: Your card ending 4421 was charged USD 24.86 at NORTH STAR MARKET.';
  const off = createLaunchAlertSession({ overrides: {}, pinnedCurrency: 'USD', fxLookup: () => null,
    bestEffort: { enabled: false, country: 'US' } });
  ok('setting off: nothing unproven is auto-added (parseUnproven)', off.parseUnproven(body, 'CHASE', off.inspect(body, 'CHASE'), NOW) === null);
  ok('setting off: the universal seam of parse() is also review-first', off.parse(body, 'CHASE', off.inspect(body, 'CHASE'), undefined, NOW) === null);
  ok('the setting defaults to on', (policy.setBestEffortAutoPostEnabled(undefined), policy.bestEffortAutoPostEnabled()) === true);
  policy.setBestEffortAutoPostEnabled(false);
  ok('an explicit false turns it off', policy.bestEffortAutoPostEnabled() === false);
  policy.setBestEffortAutoPostEnabled(true);
}

/* ── UAE/Saudi launch behaviour is unchanged ─────────────────────────── */
{
  const enbd = 'Purchase of AED 20.00 with Debit Card ending 1234 at SAMPLE STORE.';
  const gulf = createLaunchAlertSession({ overrides: {}, activeMarket: 'AE', pinnedCurrency: 'AED',
    bestEffort: { enabled: true, country: 'AE' } });
  const launch = gulf.parse(enbd, 'ENBD', gulf.inspect(enbd, 'ENBD'));
  ok('an ENBD alert still parses through the launch grammar, unmarked',
    launch?.amountFils === 2000 && launch.currency === 'AED' && launch.bestEffort === undefined, launch);
  ok('parseUnproven never runs for an AE/SA sender', gulf.parseUnproven(enbd, 'ENBD', gulf.inspect(enbd, 'ENBD'), NOW) === null);
  const us = 'Chase Bank alert: Your card ending 4421 was charged USD 24.86 at NORTH STAR MARKET.';
  ok('an AED ledger does not auto-add an unrouted/foreign alert without a rate',
    gulf.parseUnproven(us, 'CHASE', gulf.inspect(us, 'CHASE'), NOW) === null);
  const event = inspectUniversalBankEvent(enbd, { sender: 'ENBD' });
  for (const [routed, sender] of [['AE', null], ['SA', null], [null, 'AE']]) {
    const decision = policy.decideBestEffortAutoPost({
      source: enbd, event, enabled: true, country: 'AE', routedMarket: routed, launchSenderMarket: sender,
      ledgerCurrency: 'AED', ledgerExponent: 2, observedAt: NOW,
    });
    ok(`the policy refuses a launch-market alert (${routed ?? sender})`, decision.reason === 'launch-market', decision);
  }
  const unpinned = createLaunchAlertSession({ overrides: {}, pinnedCurrency: null, fxLookup: () => null,
    bestEffort: { enabled: true, country: 'US' } });
  ok('no pinned ledger currency: nothing unproven is auto-added',
    unpinned.parseUnproven(us, 'CHASE', unpinned.inspect(us, 'CHASE'), NOW) === null);
}

/* ── Import plan: marker, duplicates, undo tombstones ────────────────── */
const BASE = {
  hydrated: true, accounts: [], transactions: [], budgets: [], bills: [], goals: [], cardDues: [],
  accountHints: {}, merchantOverrides: {}, billAliases: {}, lastScanTs: 0, parserVersion: 0,
};
const apply = (state, plan) => ({
  ...state,
  ledgerMoney: state.ledgerMoney ?? plan.batch.importMoney,
  transactions: [...state.transactions, ...plan.batch.transactions.map((t, i) => ({
    ...t, id: `tx${state.transactions.length + i}`,
  }))],
});
{
  markets.setLedgerCurrency('USD', 2);
  const body = 'Chase Bank alert: Your card ending 4421 was charged USD 24.86 at NORTH STAR MARKET.';
  const ts = NOW - 60_000;
  const parsed = unproven('USD', 'US', 'CHASE', body);
  const scanned = { ...parsed, date: '2026-09-06', smsTs: ts, sender: 'CHASE', channel: 'inbox' };
  const plan = buildImportPlan([scanned], BASE, ts);
  const row = plan.batch.transactions[0];
  ok('the planned row keeps the marker', plan.txCount === 1 && row?.bestEffort?.format === 'universal:purchase:debit', plan.batch);
  ok('the parser reading carried source text, but the planned best-effort row stores none',
    typeof parsed.raw === 'string' && parsed.raw.length > 0 && row && !('raw' in row && row.raw !== undefined), row);
  const state = apply(BASE, plan);
  const again = buildImportPlan([scanned], state, ts);
  ok('a rescan of the same alert does not duplicate it', again.txCount === 0, again.batch.transactions);

  const keys = policy.bestEffortUndoKeys(state.transactions[0], 'USD');
  ok('undo keys cover the source identity and the observation time, currency and amount',
    keys.includes(`t${ts}:USD2486`) && keys.includes(state.transactions[0].smsKey), keys);
  const undone = {
    ...state,
    transactions: [],
    bestEffortUndone: policy.appendBestEffortUndo(undefined, keys),
  };
  const rescan = buildImportPlan([scanned], undone, ts);
  ok('after Undo, a rescan does not add the alert back', rescan.txCount === 0, rescan.batch.transactions);
  const onlyObservation = { ...undone, bestEffortUndone: [`t${ts}:USD2486`] };
  ok('after Undo, the same best-effort reading is recognised by time, currency and amount',
    buildImportPlan([scanned], onlyObservation, ts).txCount === 0);
  const differentMoney = buildImportPlan([{ ...scanned, amountFils: 2400 }], onlyObservation, ts);
  ok('a different amount at the same time is a different movement and is not suppressed',
    differentMoney.txCount === 1, differentMoney.batch.transactions);
  const proven = { ...scanned, bestEffort: undefined, smsKey: undefined, merchant: 'OTHER SHOP', amountFils: 999 };
  const provenPlan = buildImportPlan([proven], undone, ts);
  ok('a tombstone never hides a proven alert that merely shares the timestamp', provenPlan.txCount === 1,
    provenPlan.batch.transactions);
  ok('without a tombstone the undone alert would have been re-added',
    buildImportPlan([scanned], { ...state, transactions: [] }, ts).txCount === 1);

  // A proven reading of the same alert settles the marked row.
  const provenReading = { ...scanned, bestEffort: undefined };
  const healed = buildImportPlan([provenReading], state, ts);
  ok('a proven reading merging into a marked row clears its marker, adding nothing',
    healed.txCount === 0 && healed.batch.updates.some((u) => u.id === state.transactions[0].id && u.clearBestEffort === true),
    healed.batch.updates);
  const { applyHealUpdates } = require('./build/heal');
  const settled = applyHealUpdates(state.transactions, healed.batch.updates);
  ok('…and applying it removes only the marker', settled[0].bestEffort === undefined && settled[0].amountFils === 2486);

  // Every removal path writes tombstones for marked rows only.
  const removedRows = [
    { bestEffort: { v: 1 }, smsKey: 's1-100', ts: 1, amountFils: 100 },
    { smsKey: 's2-200', ts: 2, amountFils: 200 },
  ];
  const written = policy.tombstonesForRemoved(['old'], removedRows, 'USD');
  ok('removal tombstones cover marked rows and ignore proven ones',
    JSON.stringify(written) === JSON.stringify(['old', 's1-100', 't1:USD100']), written);
  ok('removing only proven rows writes nothing', policy.tombstonesForRemoved(['old'], [removedRows[1]], 'USD') === undefined);

  const capped = policy.appendBestEffortUndo(Array.from({ length: policy.BEST_EFFORT_UNDO_CAP }, (_, i) => `k${i}`), ['new']);
  ok('the tombstone list is bounded and keeps the newest', capped.length === policy.BEST_EFFORT_UNDO_CAP &&
    capped[capped.length - 1] === 'new' && !capped.includes('k0'));
  markets.setLedgerCurrency(null);
}

/* ── UAE/Saudi senders on a non-Gulf ledger keep the strict, unmarked seam ── */
{
  for (const [sender, body] of [
    ['ADCB', 'Your ADCB Debit Card XXX1234 was used for AED 50.00 at CARREFOUR on 05/09/2026.'],
    ['FAB', 'FAB: Purchase of USD 24.86 at AMAZON US with card ending 4421.'],
    ['ADCB', 'ADCB: USD 24.86 spent at NORTH STAR MARKET with card ending 4421.'],
  ]) {
    const read = (enabled) => {
      const s = createLaunchAlertSession({ overrides: {}, pinnedCurrency: 'USD', fxLookup: () => null,
        bestEffort: { enabled, country: 'US' } });
      return s.parse(body, sender, s.inspect(body, sender), undefined, NOW);
    };
    const on = read(true);
    const off = read(false);
    ok(`${sender} on a USD ledger: never marked, unaffected by the setting (${body.slice(0, 30)})`,
      (on === null || on.bestEffort === undefined) && JSON.stringify(on) === JSON.stringify(off), { on, off });
  }
}

/* ── Hold and authorisation wording ──────────────────────────────────── */
for (const body of [
  'Chase: A temporary authorization of USD 24.86 at NORTH STAR MARKET on card ending 4421.',
  'Chase: Temporary hold USD 24.86 placed at NORTH STAR HOTEL, card ending 4421.',
  'Chase: A temporary charge of USD 1.00 at NORTH STAR MARKET on card ending 4421.',
  'Chase: Transaction of USD 24.86 at NORTH STAR MARKET authorized on card ending 4421.',
]) {
  ok(`hold/authorisation wording is refused: ${body.slice(7, 45)}`, policy.hasNonCompletedWording(body));
}
ok('authorised plus completed wording is not refused for that reason alone',
  !policy.hasNonCompletedWording('Chase: Transaction of USD 24.86 at NORTH STAR MARKET authorized and posted to card ending 4421.'));

/* ── Unpinned ledger: the best-effort seam of parse() stays in Review ──── */
{
  const us = 'Chase Bank alert: Your card ending 4421 was charged USD 24.86 at NORTH STAR MARKET.';
  const s = createLaunchAlertSession({ overrides: {}, pinnedCurrency: null, fxLookup: () => null,
    bestEffort: { enabled: true, country: 'US' } });
  ok('parse() never writes a best-effort row before the ledger currency is pinned',
    s.parse(us, 'CHASE', s.inspect(us, 'CHASE'), undefined, NOW) === null);
}

/* ── iOS live capture: explicitly review-only for unverified formats ──── */
{
  const us = 'Chase Bank alert: Your card ending 4421 was charged USD 24.86 at NORTH STAR MARKET.';
  const rate = (base, quote, date) => (base === 'USD' && quote === 'AED' ? { base, quote, rate: 3.6725, date } : null);
  // The exact session options ios-local-capture builds for an AE page.
  const make = (bestEffort) => createLaunchAlertSession({ overrides: {}, activeMarket: 'AE', pinnedCurrency: 'AED',
    fxLookup: rate, bestEffort });
  const live = make({ enabled: false, country: null });
  const policyOn = make({ enabled: true, country: 'AE' });
  const onRow = policyOn.parse(us, 'CHASE', policyOn.inspect(us, 'CHASE'), undefined, NOW);
  ok('with the iOS live options an unverified alert is not auto-added',
    live.parse(us, 'CHASE', live.inspect(us, 'CHASE'), undefined, NOW) === null &&
      live.parseUnproven(us, 'CHASE', live.inspect(us, 'CHASE'), NOW) === null);
  ok('…where the same session with the policy on would have added a marked row',
    onRow?.bestEffort?.v === 1 && onRow.currency === 'AED', onRow);
}

/* ── Verified-app path: pending anywhere, and the recipient's bank receipt ── */
{
  const { certifyUniversalTemplate } = require('./build/universal-template-certification');
  for (const [market, institution, sender, body] of [
    ['US', 'jpmorgan-chase', 'CHASE', 'Transfer of USD 50.00 received from JOHN SMITH, pending confirmation.'],
    ['GB', 'barclays-uk', 'BARCLAYS', 'Transfer of GBP 50.00 received from JOHN SMITH, pending confirmation.'],
    ['BR', null, 'ITAU', 'Pix de R$ 50,00 recebido de JOAO, pendente.'],
    ['BR', null, 'NUBANK', 'Transferência de R$ 50,00 recebido de JOAO SILVA, pendente'],
  ]) {
    // BR has no market pack on every branch yet: read it bank-agnostically.
    const packMarket = market === 'BR' ? undefined : market;
    const event = inspectUniversalBankEvent(body, { sender, market: packMarket });
    const cert = certifyUniversalTemplate({ source: body, market, institution, event, allowSemanticGeneralization: true });
    ok(`${market}: pending anywhere is never a posting (${body.slice(0, 36)})`,
      event.status !== 'posted' && event.issues.includes('pending-not-posting') && event.decision === 'review' &&
        cert.decision !== 'automatic' && cert.decision !== 'semantic-generalized' &&
        unproven(market === 'BR' ? 'BRL' : market === 'GB' ? 'GBP' : 'USD', market, sender, body) === null,
      { status: event.status, issues: event.issues, cert });
  }
  for (const [market, institution, sender, body] of [
    ['US', 'jpmorgan-chase', 'CHASE', 'Your payment of USD 50.00 to Jane was received by her bank.'],
    ['GB', 'barclays-uk', 'BARCLAYS', 'Your payment of GBP 50.00 to Jane was received by her bank.'],
    ['US', 'jpmorgan-chase', 'CHASE', 'Your payment of USD 50.00 to Jane Co was received by their bank.'],
  ]) {
    const event = inspectUniversalBankEvent(body, { sender, market });
    const cert = certifyUniversalTemplate({ source: body, market, institution, event, allowSemanticGeneralization: true });
    ok(`${market}: the recipient's bank receiving a payment is never money in (${body.slice(0, 36)})`,
      event.direction !== 'credit' && cert.decision !== 'automatic' && cert.decision !== 'semantic-generalized' &&
        unproven(market === 'GB' ? 'GBP' : 'USD', market, sender, body) === null,
      { direction: event.direction, cert });
  }
  const credit = inspectUniversalBankEvent('Chase: USD 50.00 received from JOHN SMITH was credited to your account ending 4421.',
    { sender: 'CHASE', market: 'US' });
  ok('an ordinary completed incoming transfer still reads as money in', credit.direction === 'credit' && credit.status === 'posted',
    { direction: credit.direction, status: credit.status });
}

/* ── iOS History import: marked rows only in the ledger currency ─────── */
{
  const record = (id, text, sender) => JSON.stringify({ v: 1, id: id.repeat(64), text, sender, receivedAt: '2026-09-05T10:00:00.000Z' });
  const us = 'Chase Bank alert: Your card ending 4421 was charged USD 24.86 at NORTH STAR MARKET.';
  const withSession = (country) => createLaunchAlertSession({
    overrides: {}, pinnedCurrency: 'USD', fxLookup: () => null, bestEffort: { enabled: true, country },
  });
  markets.setLedgerCurrency('USD', 2);
  const result = parseHistoricalMessageRecords([record('a', us, 'CHASE')], {}, new Date(NOW), new Set(), withSession('US'));
  ok('History: an unproven US alert on a USD ledger is added and marked',
    result.parsed.length === 1 && result.parsed[0].bestEffort?.v === 1 && result.parsed[0].raw === undefined, result);
  const off = createLaunchAlertSession({ overrides: {}, pinnedCurrency: 'USD', fxLookup: () => null,
    bestEffort: { enabled: false, country: 'US' } });
  const reviewed = parseHistoricalMessageRecords([record('b', us, 'CHASE')], {}, new Date(NOW), new Set(), off);
  ok('History: with the setting off the same alert is not added', reviewed.parsed.length === 0, reviewed);
  markets.setLedgerCurrency(null);
}

/* ── Backup validation ───────────────────────────────────────────────── */
{
  const tx = {
    id: 'tx1', type: 'expense', amountFils: 2486, category: 'other', accountId: 'a1', title: 'NORTH', date: '2026-09-06',
  };
  const state = (patch, txPatch = {}) => ({ transactions: [{ ...tx, ...txPatch }], ...patch });
  ok('a marked row and the setting restore',
    isValidBackupState(state({ bestEffortAutoPost: false, bestEffortUndone: ['t123', 'sms:abc'] },
      { bestEffort: { v: 1, format: 'universal:cash-withdrawal:debit', market: 'US' } })));
  ok('a marker carrying message text is rejected',
    !isValidBackupState(state({}, { bestEffort: { v: 1, format: 'Chase charged USD 24.86', market: 'US' } })));
  ok('a marker with extra fields is rejected',
    !isValidBackupState(state({}, { bestEffort: { v: 1, format: 'universal:purchase:debit', market: 'US', raw: 'x' } })));
  ok('a non-boolean setting is rejected', !isValidBackupState(state({ bestEffortAutoPost: 'yes' })));
}

/* ── Copy and wiring ─────────────────────────────────────────────────── */
for (const key of ['autoAddedCheck', 'autoAddedExplain', 'autoAddedLooksRight', 'autoAddedUndo', 'autoAddedUndoHint',
  'autoAddedFilter', 'autoAddedCount', 'autoAddedUndoConfirm', 'autoAddedSettingTitle', 'autoAddedSettingBody', 'autoAddedSettingSaveFailed']) {
  const en = i18n.t(key, 'en');
  const ar = i18n.t(key, 'ar');
  ok(`copy "${key}" exists in English and Arabic`, en && en !== key && /[؀-ۿ]/.test(ar));
}
{
  const root = path.join(__dirname, '../..');
  const read = (file) => fs.readFileSync(path.join(root, file), 'utf8');
  const store = read('src/lib/store.tsx');
  ok('Undo removes the row and records its tombstone in one reducer step',
    /case 'resolveBestEffort':[\s\S]*?transactions: state\.transactions\.filter[\s\S]*?bestEffortUndone: tombstonesForRemoved/.test(store));
  ok('deleting a marked row also leaves a tombstone',
    /case 'deleteTransaction': \{[\s\S]*?tombstonesForRemoved/.test(store));
  ok('the persisted setting is mirrored on hydrate/restore', /setBestEffortAutoPostEnabled\(next\.bestEffortAutoPost\)/.test(store));
  ok('the row shows the marker', /best-effort-marker/.test(read('src/components/transaction-row.tsx')));
  const sheet = read('src/components/entry-detail-sheet.tsx');
  ok('the entry sheet offers Looks right and Undo',
    /resolveBestEffort\(transaction\.id, 'confirm'\)/.test(sheet) && /resolveBestEffort\(transaction\.id, 'undo'\)/.test(sheet));
  ok('Transactions can filter to auto-added rows', /bestEffortOnly: autoAddedActive/.test(read('src/app/transactions.tsx')));
  ok('Settings exposes the toggle', /autoAddedSettingTitle/.test(read('src/app/settings.tsx')));
  // The same Settings switch governs iPhone live capture (behaviour is pinned
  // in repair/ios-best-effort-capture.test.cjs): the drain reads the setting,
  // and only the one unproven path (parseUnproven) can post such a row.
  ok('iOS live capture builds its sessions from the persisted setting',
    /createLaunchAlertSession\(\{[\s\S]{0,600}?bestEffort: \{ enabled: bestEffortAutoPostEnabled\(\), country: getActiveCountry\(\) \}/.test(read('src/lib/ios-local-capture.ts')) &&
      !/bestEffort: \{ enabled: (?:true|false)/.test(read('src/lib/ios-local-capture.ts')) &&
      (read('src/lib/local-message-record.ts').match(/\.parseUnproven\(/g) ?? []).length === 1);
  ok('the killed-process Android wake mirrors the persisted setting before parsing',
    /function applyLedgerContext[\s\S]*?setBestEffortAutoPostEnabled\(state\.bestEffortAutoPost\)[\s\S]*?return true;/
      .test(read('src/lib/android-live-background.ts')));
  ok('undoBatch and deleteAccount tombstone the marked rows they remove',
    /case 'undoBatch': \{[\s\S]*?tombstonesForRemoved/.test(store) && /case 'deleteAccount': \{[\s\S]*?tombstonesForRemoved/.test(store));
  ok('a failed save reverts the setting',
    /if \(!written\) \{\s*\/\/[^\n]*\n\s*dispatch\(\{ type: 'setBestEffortAutoPost', enabled: previous \}\)/.test(store));
  ok('Undo asks for confirmation first',
    /onPress=\{\(\) => setConfirmingUndo\(true\)\}/.test(sheet) && /autoAddedUndoConfirm/.test(sheet));
  const autoImport = read('src/lib/auto-import.ts');
  ok('semantic generalisation posts only through the same policy',
    /certification\?\.decision === 'semantic-generalized' && universalEvent(?:\s*&&\s*!gulfNeighbourOwned)?\s*\?\s*decideBestEffortAutoPost/.test(autoImport));
  // Qatar/Kuwait/Bahrain/Oman via a recognised institution are owned by
  // decideGulfNeighbourPosting: neither semantic generalization nor
  // certification may post them on the notification path.
  ok('a Gulf-neighbour notification is never posted by certification or semantic generalization',
    /const universalPosting = universalEvent && !gulfNeighbourOwned &&/.test(autoImport));
  ok('a certified template reading never carries the marker',
    /launchParsed\?\.bestEffort && certification\?\.decision === 'automatic'/.test(autoImport));
}


/* ── 2026-10 worldwide accuracy pass (synthetic grammar probes) ───────────
 * The production entry point (parse with inspect), a pinned non-Gulf ledger
 * and the person's country, exactly as a phone outside the Gulf runs it.
 * Every case was a refusal or a wrong category before the pass. */
{
  const country = require('./build/country');
  const OBSERVED = Date.parse('2026-10-03T08:00:00Z');
  const worldwide = (currency, cc, sender, body, exponent = 2) => {
    markets.setActiveMarket('ZZ');
    markets.setLedgerCurrency(currency, exponent);
    country.setActiveCountry(cc);
    const s = createLaunchAlertSession({ overrides: {}, regionHint: cc, fxLookup: () => null,
      bestEffort: { enabled: true, country: cc } });
    try { return s.parse(body, sender, s.inspect(body, sender), undefined, OBSERVED); }
    finally { markets.setLedgerCurrency(null); country.setActiveCountry(null); markets.setActiveMarket('AE'); }
  };
  for (const [currency, cc, sender, body, minor, type, category, exponent] of [
    ['USD', 'US', '24273', 'Chase: You made a $45.67 transaction with STARBUCKS STORE 1234 on Oct 2, 2026 at 8:14 AM ET.', 4567, 'expense', 'dining'],
    ['USD', 'US', '24273', 'Chase Sapphire: A $15.49 transaction with NETFLIX.COM was made on Oct 1, 2026.', 1549, 'expense', 'entertainment'],
    ['USD', 'US', '263978', 'American Express: A charge of $120.00 at WHOLE FOODS MARKET was made on your Card ending 1005 on 10/02/2026.', 12000, 'expense', 'groceries'],
    ['USD', 'US', '24273', 'Chase: You withdrew $200.00 at ATM 5TH AVE NY from account ending 4321 on Oct 2, 2026.', 20000, 'expense', 'cash-withdrawal'],
    ['USD', 'US', '73981', 'BofA: You sent $250.00 to JOHN SMITH with Zelle(R). Ref# ABC123.', 25000, 'expense', 'other'],
    ['USD', 'US', '73981', 'BofA: JANE DOE sent you $80.00 with Zelle(R). It is in your account.', 8000, 'income', 'other'],
    ['GBP', 'GB', 'Monzo', 'You spent £12.50 at Tesco Express', 1250, 'expense', 'groceries'],
    ['GBP', 'GB', 'Monzo', 'You spent £2.80 at TfL Travel Charge', 280, 'expense', 'transport'],
    ['GBP', 'GB', 'HSBC', 'HSBC UK: £2,450.00 has been credited to your account ending 5678. Ref: SALARY OCT.', 245000, 'income', 'salary'],
    ['EUR', 'DE', 'Sparkasse', 'Kartenzahlung erfolgreich: 34,90 EUR bei REWE Markt GmbH am 02.10.2026.', 3490, 'expense', 'groceries'],
    ['INR', 'IN', 'VM-HDFCBK', 'Rs.1,250.00 spent on HDFC Bank Card x1234 at SWIGGY on 2026-10-02:13:45:10. Avl Lmt: Rs.85,000.00', 125000, 'expense', 'dining'],
    ['INR', 'IN', 'VK-ICICIB', 'ICICI Bank Acct XX123 credited with Rs 85,000.00 on 01-Oct-26; SALARY OCT 2026. Avl Bal Rs 1,02,345.67.', 8500000, 'income', 'salary'],
    ['EGP', 'EG', 'CIB', 'Your CIB credit card ending with 1234 was charged for EGP 850.00 at CARREFOUR MAADI on 02/10/2026. Available limit EGP 40,150.00', 85000, 'expense', 'groceries'],
    ['QAR', 'QA', 'QNB', 'Your QNB Debit Card ending 1234 was used for QAR 125.00 at LULU HYPERMARKET DOHA on 02/10/2026. Available balance QAR 8,450.00', 12500, 'expense', 'groceries'],
    ['KWD', 'KW', 'NBK', 'NBK: Purchase of KWD 12.500 with card ending 1234 at TALABAT KUWAIT on 02/10/2026. Available balance KWD 845.250', 12500, 'expense', 'dining', 3],
    ['TRY', 'TR', 'GARANTI BBVA', '1234 ile biten kartınızla 02.10.2026 tarihinde MIGROS işyerinden 456,75 TL tutarında alışverişiniz gerçekleşmiştir.', 45675, 'expense', 'groceries'],
    ['PKR', 'PK', 'HBL', 'HBL: PKR 3,500.00 has been debited from your A/C ****1234 at FOODPANDA on 02-Oct-2026. Avl Bal PKR 45,210.50', 350000, 'expense', 'dining'],
    ['SGD', 'SG', 'DBS', 'DBS: A transaction of SGD 18.50 was made with your DBS/POSB card ending 1234 on 02 Oct 2026 at GRAB*FOOD. If unauthorised, call 1800 111 1111.', 1850, 'expense', undefined],
    ['EUR', 'FR', 'SG', 'Société Générale : Virement reçu de 1 250,00 EUR de la part de EMPLOYEUR SA, libellé SALAIRE SEPTEMBRE.', 125000, 'income', 'salary'],
    ['EUR', 'NL', 'ING', 'ING: Kaartbetaling voltooid: EUR 12,95 bij ALBERT HEIJN 1234 op 02-10-2026.', 1295, 'expense', 'groceries'],
    ['BRL', 'BR', 'Nubank', 'Nubank: Pix enviado de R$ 150,00 para JOAO SILVA.', 15000, 'expense', 'other'],
    ['BRL', 'BR', 'Itau', 'Itaú: Você recebeu um Pix de R$ 200,00 de MARIA SOUZA.', 20000, 'income', 'other'],
    ['TRY', 'TR', 'Ziraat', 'Hesabınıza 1.500,00 TL tutarında havale gelmiştir. Gönderen: AHMET YILMAZ', 150000, 'income', 'other'],
    ['IDR', 'ID', 'BCA', 'BCA: Transaksi Rp 125.000 di INDOMARET pada 02/10/2026 dengan kartu ****1234 berhasil.', 12500000, 'expense', undefined],
    ['THB', 'TH', 'KBank', 'KBank: Payment THB 320.00 at 7-ELEVEN with card x1234 on 02/10/26.', 32000, 'expense', 'groceries'],
    ['MYR', 'MY', 'Maybank', 'Maybank: RM45.90 charged to card ending 1234 at TESCO PUCHONG on 02/10/2026.', 4590, 'expense', 'groceries'],
    ['SGD', 'SG', 'OCBC', 'OCBC: You have sent SGD 50.00 via PayNow to JOHN TAN on 02 Oct 2026.', 5000, 'expense', 'other'],
    ['BDT', 'BD', 'bKash', 'You have received Tk 1,000.00 from 01712345678. Fee Tk 0.00. Balance Tk 2,500.00. TrxID ABC123 at 02/10/2026 10:15', 100000, 'income', 'other'],
    ['ZAR', 'ZA', 'FNB', 'FNB: R450.00 paid from Cheq a/c..1234 @ CHECKERS SANDTON. Avail R5,200.00. 02Oct 10:15', 45000, 'expense', 'groceries'],
    ['INR', 'IN', 'AD-SBIINB', 'Dear UPI user A/C X1234 debited by 450.0 on date 02Oct26 trf to ZOMATO Refno 627512345678. If not u? call 1800111109 -SBI', 45000, 'expense', 'dining'],
    // Ordinary words that contain a short symbol ("users", "Sharma") must not
    // switch off the currency-less UPI reading.
    ['INR', 'IN', 'AD-SBIINB', 'Dear UPI user A/C X1234 debited by 450.0 on date 02Oct26 trf to Rahul Sharma Refno 412345678901. If not u? call 1800111109. -SBI', 45000, 'expense', undefined],
    ['EUR', 'ES', 'CaixaBank', 'CaixaBank: Has recibido un Bizum de 25,00 EUR de LAURA GARCIA.', 2500, 'income', 'other'],
    ['EUR', 'ES', 'Santander', 'Santander: Se ha realizado un cargo de 64,30 EUR con su tarjeta ****1234 en EL CORTE INGLES.', 6430, 'expense', 'shopping'],
    ['EUR', 'PT', 'CGD', 'CGD: Compra de 18,90 EUR efetuada no PINGO DOCE com o cartao terminado em 1234.', 1890, 'expense', 'groceries'],
    ['PLN', 'PL', 'PKO BP', 'PKO BP: Transakcja karta 1234 na kwote 54,99 PLN w BIEDRONKA zostala zrealizowana.', 5499, 'expense', 'groceries'],
    ['PEN', 'PE', 'BCP', 'BCP: Realizaste un consumo de S/ 45.50 en PLAZA VEA con tu tarjeta ****1234.', 4550, 'expense', 'groceries'],
    ['KRW', 'KR', 'Shinhan', '[신한카드] 승인 12,000원 GS25 강남점 10/02 14:30', 12000, 'expense', undefined, 0],
    ['CNY', 'CN', 'ICBC', '您尾号1234的卡于10月02日在美团消费成功,金额58.00元。', 5800, 'expense', undefined],
    ['GHS', 'GH', 'MobileMoney', 'Payment made for GHS 45.00 to SHOPRITE ACCRA. Current Balance: GHS 320.00. Transaction Id: 12345678.', 4500, 'expense', 'groceries'],
    ['MAD', 'MA', 'AttijariWafa', 'Attijariwafa bank: Paiement par carte effectué : 320,00 MAD chez MARJANE le 02/10/2026.', 32000, 'expense', 'groceries'],
    ['PKR', 'PK', 'JazzCash', 'You have successfully sent Rs. 1,500 to ALI KHAN (0300XXXX123) via JazzCash. TID: 1234567890.', 150000, 'expense', 'other'],
    ['INR', 'IN', 'VM-SBIINB', 'आपके खाते XX1234 से रु 750.00 डेबिट किए गए हैं, BIGBASKET को भुगतान सफल हुआ।', 75000, 'expense', 'groceries'],
    ['EUR', 'DE', 'Sparkasse', 'Sparkasse: Lastschrift über 49,99 EUR von TELEKOM DEUTSCHLAND wurde Ihrem Konto belastet.', 4999, 'expense', 'telecom'],
    ['KES', 'KE', 'MPESA', 'QJK1ABC124 Confirmed. You have received Ksh2,000.00 from JOHN KAMAU 0712345678 on 2/10/26 at 11:00 AM. New M-PESA balance is Ksh7,300.00.', 200000, 'income', 'other'],
    ['NGN', 'NG', 'GTBank', 'Acct: ****1234 Amt: NGN5,000.00 DR Desc: POS PURCHASE SHOPRITE LEKKI Avail Bal: NGN45,000.00 Date: 02-Oct-2026', 500000, 'expense', 'groceries'],
  ]) {
    const row = worldwide(currency, cc, sender, body, exponent);
    ok(`${cc}: ${body.slice(0, 56)}… posts ${type}${category ? ` / ${category}` : ''}`,
      row?.kind === 'transaction' && row.amountFils === minor && row.currency === currency && row.type === type &&
        (category === undefined || row.categoryGuess === category) && !!row.bestEffort, row);
  }
  {
    const salary = worldwide('GBP', 'GB', 'HSBC', 'HSBC UK: £2,450.00 has been credited to your account ending 5678. Ref: SALARY OCT.');
    ok('a worldwide salary is income, never a transfer kept out of Income',
      salary?.type === 'income' && salary.categoryGuess === 'salary' && salary.transferHint === false, salary);
  }
  // Unverified worldwide statements stay typed Review; marked card payments
  // retain the separate settlement path.
  {
    const body = 'Chase: Your credit card statement is ready. Statement balance $1,234.56, minimum payment $35.00 due 10/25/2026.';
    const cardless = worldwide('USD', 'US', '24273', body);
    const reader = session('USD', 'US');
    const review = inspectSourceFreeRefusedAlert({ source: body, sender: '24273', session: reader,
      existingInspection: reader.inspect(body, '24273'), observedAt: Date.parse('2026-10-02T12:00:00Z'), channel: 'inbox' });
    const event = review.kind === 'review' && review.candidate.kind === 'universal' ? review.candidate.event : null;
    ok('a cardless statement stays typed Review with its ambiguous money and known deadline',
      cardless === null && event?.family === 'statement' && event.instrument.value === null &&
        event.statementTotal.evidence === 'ambiguous' &&
        event.statementTotal.alternatives.some(m => m.currency === 'USD' && m.minorUnits === '123456') &&
        event.minimumDue.alternatives.some(m => m.currency === 'USD' && m.minorUnits === '3500') &&
        event.dueDate.value === '2026-10-25', review);
  }
  for (const [currency, cc, sender, body, expect] of [
    ['USD', 'US', 'Chase', 'Chase: Your credit card ending 1005 statement is ready. Statement balance $1,234.56, minimum payment $35.00 due 10/25/2026.',
      { kind: 'cardStatement', amountFils: 123456, minDueFils: 3500, date: '2026-10-25', last4: '1005' }],
    ['INR', 'IN', 'AX-AXISBK', 'Axis Bank Credit Card XX5678 statement: Total Amount Due INR 23,456.00, Minimum Amount Due INR 1,173.00, Payment Due Date 20-10-2026.',
      { kind: 'cardStatement', amountFils: 2345600, minDueFils: 117300, date: '2026-10-20', last4: '5678' }],
    ['GBP', 'GB', 'Barclaycard', 'Barclaycard: Your statement is ready. Balance £845.20, minimum payment £25.00 due by 18/10/2026 on card ending 4321.',
      { kind: 'cardStatement', amountFils: 84520, minDueFils: 2500, date: '2026-10-18', last4: '4321' }],
    ['USD', 'US', 'Chase', 'Chase: We received your payment of $1,234.56 to your credit card ending 1005 on 10/02/2026. Thank you.',
      { kind: 'cardPayment', amountFils: 123456, side: 'receipt', last4: '1005' }],
    ['INR', 'IN', 'VM-HDFCBK', 'Payment of Rs.23,456.00 has been received towards your HDFC Bank Credit Card ending 5678 on 02-10-2026. Thank you.',
      { kind: 'cardPayment', amountFils: 2345600, side: 'receipt', last4: '5678' }],
  ]) {
    const row = worldwide(currency, cc, sender, body);
    if (expect.kind === 'cardStatement') {
      const reader = session(currency, cc);
      const review = inspectSourceFreeRefusedAlert({ source: body, sender, session: reader,
        existingInspection: reader.inspect(body, sender), observedAt: Date.parse('2026-10-02T12:00:00Z'), channel: 'inbox' });
      const event = review.kind === 'review' && review.candidate.kind === 'universal' ? review.candidate.event : null;
      // Barclaycard labels this figure only as Balance. Preserve that role;
      // Review must not silently promote it into an explicit statement total.
      const figure = cc === 'GB' ? event?.balance : event?.statementTotal;
      ok(`${cc}: unverified statement retains native facts in typed Review`,
        row === null && event?.family === 'statement' &&
          figure?.value?.minorUnits === String(expect.amountFils) && figure.value.currency === currency &&
          event.minimumDue.value?.minorUnits === String(expect.minDueFils) &&
          event.instrument.value?.kind === 'card' && event.instrument.value.last4 === expect.last4 &&
          event.dueDate.value === expect.date && (cc !== 'GB' || event.statementTotal.value === null), review);
      continue;
    }
    ok(`${cc}: ${expect.kind} — ${body.slice(0, 52)}…`,
      row?.kind === expect.kind && row.amountFils === expect.amountFils && row.currency === currency &&
        row.card?.last4 === expect.last4 && row.card?.kind === 'credit' &&
        (expect.minDueFils === undefined || row.minDueFils === expect.minDueFils) &&
        (expect.date === undefined || row.date === expect.date) &&
        (expect.side === undefined || (row.cardPaymentSide === expect.side && row.transferHint === true)), row);
  }
  for (const [currency, cc, sender, body] of [
    ['USD', 'US', '24273', 'Chase: A $500.00 transaction at BEST BUY was declined on your card ending 1005.'],
    ['USD', 'US', '24273', "Chase: Your one-time code is 482913. Don't share it. We'll never call to ask for it."],
    // A comma-written three-decimal figure stays ambiguous even in Kuwait.
    ['KWD', 'KW', 'NBK', 'NBK: Purchase of KWD 12,500 with card ending 1234 at TALABAT KUWAIT on 02/10/2026.'],
    // A dot-written KWD figure resolves only with dot-decimal locale evidence:
    // the person's country or the issuer's routed market. Neither here.
    ['KWD', 'DE', 'MYBANK', 'MYBANK: Purchase of KWD 12.500 with card ending 1234 at TALABAT KUWAIT on 02/10/2026.'],
    // Pound STERLING written in Arabic is not the Egyptian pound.
    ['EGP', 'EG', 'CIB', 'تم خصم 100.00 جنيه استرليني من بطاقتك رقم 1234 لدى AMAZON UK'],
    // A "compra aprobada" heading also opens holds and fraud questions; it stays in Review.
    ['MXN', 'MX', 'BBVA', 'BBVA: Compra aprobada por $350.00 MXN en OXXO con tu tarjeta terminación 1234.'],
    // A statement in another currency than the ledger is never a due.
    ['EUR', 'DE', 'Chase', 'Chase: Your credit card ending 1005 statement is ready. Statement balance USD 1,234.56, minimum payment USD 35.00 due 10/25/2026.'],
    // A card payment that names no card cannot settle one.
    ['USD', 'US', 'Chase', 'Chase: We received your payment of $1,234.56 to your credit card. Thank you.'],
    // A plain "balance" outside a statement announcement is not an amount owed.
    ['GBP', 'GB', 'Barclaycard', 'Barclaycard: Balance £845.20 on card ending 4321. Minimum payment £25.00 due by 18/10/2026.'],
    ['EUR', 'ES', 'BBVA', 'BBVA: Tienes una compra pendiente de 120,00 EUR en ZARA.'],
    ['KRW', 'KR', 'Shinhan', '[신한카드] 승인취소 12,000원 GS25 강남점 10/02 14:35'],
    ['USD', 'US', 'Chase', 'Chase: Your credit limit has been increased to $8,000.00 on card ending 1005.'],
    // Independent-review regressions: none of these may post.
    ['KRW', 'KR', 'Shinhan', '[신한카드] 승인거절 12,000원 GS25 강남점 10/02 14:30 잔액부족'],
    ['KRW', 'KR', 'Shinhan', '[신한카드] 승인 한도 안내: 잔여한도 1,500,000원'],
    ['KRW', 'KR', 'Shinhan', '[신한카드] 승인 즉시 10,000원 캐시백! 이벤트 응모하세요 10/31 까지'],
    ['USD', 'US', 'Chase', 'Chase: Your payment of $1,234.56 received to your credit card ending 1005 has been reversed.'],
    ['INR', 'IN', 'VM-HDFCBK', 'Payment of Rs.23,456.00 towards your HDFC Bank Credit Card ending 5678 will be auto debited on 15-10-2026.'],
    ['USD', 'US', 'Chase', 'Chase: We received your payment of $1,234.56 to your credit card ending 1005. It is processing and may take 2 days to post.'],
    ['USD', 'US', 'Chase', 'Chase: We received your payment of $1,234.56 to your credit card ending 1005 on 10/20/2026. Thank you.'],
    ['GBP', 'GB', 'Barclaycard', 'Barclaycard: Your statement is ready. Available balance £2,845.20, minimum payment £25.00 due by 18/10/2026 on card ending 4321.'],
    ['GBP', 'GB', 'Barclaycard', 'Barclaycard: Your statement is ready. Balance £45.20 CR, no payment due. Minimum payment £0.00 due by 18/10/2026 on card ending 4321.'],
    ['INR', 'IN', 'AX-AXISBK', 'Axis Bank Credit Card XX5678 statement: Total Amount Due INR 2,345.00 Cr, Minimum Amount Due INR 0.00, Payment Due Date 20-10-2026.'],
    ['INR', 'IN', 'AX-AXISBK', 'Thank you! Total Amount Due INR 23,456.00 on your Axis Bank Credit Card XX5678 statement has been paid in full. Payment Due Date 20-10-2026.'],
    ['INR', 'IN', 'AX-AXISBK', 'Your Axis Bank Credit Card XX5678 statement will be generated on 15-10-2026. Total Amount Due INR 12,345.00 so far. Payment Due Date 05-11-2026.'],
    ['INR', 'IN', 'AX-AXISBK', 'Your Axis Bank Personal Loan XX5678 EMI statement: Total Amount Due INR 23,456.00, Payment Due Date 20-10-2026. Pay via credit card.'],
    ['USD', 'US', 'Chase', 'Chase: Reminder: your credit card ending 1005 statement balance of $1,234.56 was due 09/25/2026. Minimum payment $35.00.'],
    ['CAD', 'CA', 'Chase', 'Chase: We received your payment of $1,234.56 to your credit card ending 1005 on 10/02/2026.'],
    ['INR', 'IN', 'VM-ICICIB', 'Payment of Rs.500.00 received towards your ICICI FASTag card XX1234 on 02-10-2026. Thank you.'],
    ['PLN', 'PL', 'PKO BP', 'PKO BP: Transakcja karta 1234 na kwote 54,99 PLN w BIEDRONKA nie zostala zrealizowana.'],
    ['PLN', 'PL', 'PKO BP', 'PKO BP: Blokada srodkow: transakcja karta 1234 na kwote 54,99 PLN w BIEDRONKA zostala zrealizowana i oczekuje na rozliczenie.'],
    ['INR', 'IN', 'VM-SBIINB', 'रु 750.00 जो पहले डेबिट किए गए थे, आपके खाते XX1234 में वापस क्रेडिट कर दिए गए हैं।'],
    ['INR', 'IN', 'VM-SBIINB', 'आपके खाते XX1234 से रु 750.00 डेबिट किए गए थे, लेनदेन रिवर्स किया गया।'],
    ['CNY', 'CN', 'ICBC', '您尾号1234的卡于10月02日在如家酒店消费成功(预授权),金额580.00元。'],
    // A bare "R" is the rand only for a person in South Africa.
    ['USD', 'US', 'FNB', 'FNB: R450.00 paid from Cheq a/c..1234 @ CHECKERS SANDTON. Avail R5,200.00. 02Oct 10:15'],
    // A currency-less figure is rupees only in India, and only on a UPI/IMPS/NEFT account alert.
    ['USD', 'US', 'AD-SBIINB', 'Dear UPI user A/C X1234 debited by 450.0 on date 02Oct26 trf to ZOMATO Refno 627512345678.'],
    ['INR', 'IN', 'AD-SBIINB', 'Your A/C X1234 debited by 450.0 on 02Oct26 at ZOMATO.'],
    // "يتم" is in progress, not completed.
    ['EGP', 'EG', 'NBE', 'يتم تحويل مبلغ 1,500.00 جنيه من حسابك رقم ***1234 إلى أحمد محمد'],
  ]) {
    ok(`${cc}: never auto-posted — ${body.slice(0, 56)}…`, worldwide(currency, cc, sender, body, currency === 'KWD' ? 3 : 2) === null);
  }
}

/* ── 2026-10 batch 2: wrong money from unverified formats ─────────────────
 * Every message here is synthetic text shaped like a public sample. Each
 * negative is paired with the genuine alert it must not take down. */
{
  const country = require('./build/country');
  const OBSERVED = Date.parse('2026-10-03T08:00:00Z');
  const worldwide = (currency, cc, sender, body) => {
    markets.setActiveMarket('ZZ');
    markets.setLedgerCurrency(currency, 2);
    country.setActiveCountry(cc);
    const s = createLaunchAlertSession({ overrides: {}, regionHint: cc, fxLookup: () => null,
      bestEffort: { enabled: true, country: cc } });
    try { return s.parse(body, sender, s.inspect(body, sender), undefined, OBSERVED); }
    finally { markets.setLedgerCurrency(null); country.setActiveCountry(null); markets.setActiveMarket('AE'); }
  };

  // (a) A link that asks you to dispute/verify/cancel/claim is the scam's
  // call to action, whatever the money sentence before it says.
  for (const [currency, cc, body] of [
    ['USD', 'US', 'Your card ending 4421 was charged $612.00 at LAPTOP WORLD. If this was not you, dispute here: http://card-dispute-centre.example'],
    ['USD', 'US', 'Your credit card has been charged $350 for a tablet purchase. Not you? Dispute at https://charge-help.example/claim'],
    ['GBP', 'GB', 'Your card was charged £89.00 at ONLINE STORE. Not you? Cancel now: https://secure-refund.example/x'],
    ['USD', 'US', 'Your card was charged USD 45.00 at CITY MART. Verify the charge at www.card-verify.example'],
    ['USD', 'US', 'Your card was charged USD 45.00 at CITY MART. Visit card-help.example/verify to cancel this payment.'],
    ['NGN', 'NG', 'Your account was credited NGN 7,500.00. Claim it here: bit.ly/claim-funds'],
  ]) {
    ok(`${cc}: a link call-to-action never auto-posts — ${body.slice(0, 52)}…`,
      worldwide(currency, cc, 'UNKNOWN', body) === null && policy.isNotAutoPostableMoney(body));
  }
  for (const [currency, cc, body, minor] of [
    ['USD', 'US', 'Chase: You made a $24.86 purchase at NORTH STAR MARKET with card ending 4421. Not you? Visit chase.com/fraud', 2486],
    ['USD', 'US', 'Your card ending 4421 was charged USD 24.86 at NORTH STAR MARKET. For details visit https://www.examplebank.com/alerts', 2486],
  ]) {
    const row = worldwide(currency, cc, 'CHASE', body);
    ok(`${cc}: a plain bank-site footer still posts — ${body.slice(0, 52)}…`,
      row?.type === 'expense' && row.amountFils === minor && !!row.bestEffort, row);
  }

  // (b) "NAME paid you" is money in; "You paid NAME" stays money out.
  {
    const incoming = worldwide('USD', 'US', '86753', 'JORDAN LEE paid you $48.20 dinner');
    ok('a peer who paid you is income, posted as an incoming transfer',
      incoming?.type === 'income' && incoming.amountFils === 4820 && incoming.transferHint === true &&
        incoming.bestEffort?.format === 'universal:transfer:credit', incoming);
    const outgoing = worldwide('USD', 'US', '86753', 'You paid JORDAN LEE $48.20');
    ok('…while you paying a peer stays an expense', outgoing?.type === 'expense' && outgoing.amountFils === 4820, outgoing);
    ok('…and a request to pay you never posts', worldwide('USD', 'US', '86753', 'JORDAN LEE requested $48.20 from you') === null);
  }

  // (c) "NAME has received your bank transfer" is the counterparty's receipt:
  // the money left this account.
  {
    const sent = worldwide('EUR', 'DE', 'de.number26.android', 'JAMIE ROE has received your bank transfer of €75 ║ N26');
    ok('a counterparty receiving your transfer is money out',
      sent?.type === 'expense' && sent.amountFils === 7500 && sent.transferHint === true &&
        sent.bestEffort?.format === 'universal:transfer:debit', sent);
    const received = worldwide('EUR', 'DE', 'de.number26.android', "You've received a transfer of € 75.00 from JAMIE ROE.");
    ok('…while a transfer you received stays money in', received?.type === 'income' && received.amountFils === 7500, received);
  }

  // (d) Not a new movement of the person's money.
  for (const [label, currency, cc, sender, body] of [
    ['an EMI conversion of an earlier purchase', 'BDT', 'BD', 'BANK', 'Your purchase of BDT 2,400.00 at CORNER SHOP has been converted to EMI for 12 months at 15% p.a. interest.'],
    ['an instalment-plan conversion', 'INR', 'IN', 'VM-BANK', 'Your purchase of Rs 9,999.00 at PHONE HOUSE has been converted into instalments of Rs 1,700.00 for 6 months.'],
    ['airtime received (phone credit, not money)', 'KES', 'KE', 'MPESA', 'QX12AB34CD confirmed. You have received Airtime of Ksh50.00 from SAMPLE SHOP on 2/3/26 at 9:10 AM.'],
    ['airtime received, lower case', 'GHS', 'GH', 'MTN', 'Transaction ID: 000001234 confirmed. You have received airtime of GHS5.00 from 0240000000 - SAMPLE NAME on 2026-03-02 at 10:00:00.'],
    ['a merchant order receipt', 'INR', 'IN', 'TX-FOODAP-S', 'Payment Confirmed! Your FoodApp Order #998877665544 of Rs. 420.0 was successfully paid on 02/03/2026 at 8:10 PM. Txn ID: 1122334455. Enjoy!'],
    ['a fund unit allocation', 'KES', 'KE', 'SAMPLEFUND', 'Dear MEMBER, Your account for Sample Money Market Fund has been credited with Kes 3,000.00 and 3,000.00 units, as of 02 Mar, 2026.'],
    ['a payment to your own card (a settlement, not spending)', 'USD', 'US', '227898', 'Capital One Alert: You paid $1,250.00 to your Sample Rewards Card…(1234) on May 8, 2026. Msg & data rates may apply.'],
  ]) {
    ok(`never auto-added: ${label}`, worldwide(currency, cc, sender, body) === null);
  }
  for (const [label, currency, cc, sender, body, minor, type] of [
    ['buying airtime is still spending', 'KES', 'KE', 'MPESA', 'QX12AB34CE Confirmed. Ksh50.00 sent to SAFARICOM for airtime on 2/3/26 at 9:12 AM. New M-PESA balance is Ksh1,200.00.', 5000, 'expense'],
    ['a bank debit for the same order still posts', 'INR', 'IN', 'VM-HDFCBK', 'Rs.420.00 spent on HDFC Bank Card x1234 at FOODAPP on 2026-03-02:20:10:10. Avl Lmt: Rs.85,000.00', 42000, 'expense'],
  ]) {
    const row = worldwide(currency, cc, sender, body);
    ok(`still posts: ${label}`, row?.type === type && row.amountFils === minor, row);
  }
}

/* ── 2026-10 batch 2: US/UK/EU card-alert recall, each with its twins ───── */
{
  const country = require('./build/country');
  const OBSERVED = Date.parse('2026-10-03T08:00:00Z');
  const worldwide = (currency, cc, sender, body) => {
    markets.setActiveMarket('ZZ');
    markets.setLedgerCurrency(currency, 2);
    country.setActiveCountry(cc);
    const s = createLaunchAlertSession({ overrides: {}, regionHint: cc, fxLookup: () => null,
      bestEffort: { enabled: true, country: cc } });
    try { return s.parse(body, sender, s.inspect(body, sender), undefined, OBSERVED); }
    finally { markets.setLedgerCurrency(null); country.setActiveCountry(null); markets.setActiveMarket('AE'); }
  };
  for (const [label, currency, cc, sender, body, minor, date] of [
    ['Chase card-not-present wording', 'USD', 'US', '24273', 'Chase Freedom: You made an online, phone, or mail transaction of $27.40 with SAMPLE BOOKS on Oct 2, 2026 at 3:15 PM ET.', 2740, '2026-10-02'],
    ['Chase authorised-user wording', 'USD', 'US', '24273', 'Prime Visa 1234: ALEX made a $19.99 transaction with CORNER CAFE on Oct 2, 2026 at 9:41 AM ET.', 1999, '2026-10-02'],
    ['BofA "was deducted"', 'USD', 'US', '73981', 'Bank of America: Money transfer of $250.00 for account 1234 was deducted on 10/02/2026. Go online to view details.', 25000, '2026-10-02'],
    ['BofA card-not-present charge', 'USD', 'US', '73981', 'BofA: Debit card 1234 charge made online, by phone, or mail on 10/02/2026 for $30.00. Log in to view details.', 3000, '2026-10-02'],
    ['Capital One approved purchase', 'USD', 'US', '227898', 'Capital One: Your purchase for $23.50 at SAMPLE DINER was approved.', 2350, null],
    ['Revolut spend beside available credit', 'EUR', 'LT', 'Revolut', '🛒 You spent 150 € Available credit: 1.288,73 € ║ Sample Fuel', 15000, null],
    ['Revolut decimal-comma spend', 'EUR', 'LT', 'Revolut', 'You spent 525,60 € Available credit: 1.443,68 € ║ Sample Shop', 52560, null],
  ]) {
    const row = worldwide(currency, cc, sender, body);
    ok(`posts: ${label}`, row?.type === 'expense' && row.amountFils === minor && row.currency === currency &&
      !!row.bestEffort && (date === null || row.date === date), row);
  }
  {
    const cnp = worldwide('USD', 'US', '24273', 'Chase Freedom: You made an online, phone, or mail transaction of $27.40 with SAMPLE BOOKS on Oct 2, 2026 at 3:15 PM ET.');
    ok('the card-not-present merchant is the name after WITH', cnp?.merchant === 'SAMPLE BOOKS', cnp);
  }
  for (const [label, currency, cc, sender, body] of [
    ['Chase pending', 'USD', 'US', '24273', 'Chase: You have a $27.40 pending transaction with SAMPLE BOOKS.'],
    ['Chase declined card-not-present', 'USD', 'US', '24273', 'Chase Freedom: Your online, phone, or mail transaction of $27.40 with SAMPLE BOOKS was declined.'],
    ['Chase question', 'USD', 'US', '24273', 'Chase: Did ALEX make a $19.99 transaction with CORNER CAFE? Reply YES or NO.'],
    ['Chase negated', 'USD', 'US', '24273', 'Chase: ALEX has not made a $19.99 transaction with CORNER CAFE.'],
    ['Chase code', 'USD', 'US', '24273', 'Chase: Use code 123456 to verify your online, phone, or mail transaction of $27.40 with SAMPLE BOOKS. Do not share.'],
    ['BofA declined prefix', 'USD', 'US', '73981', 'Declined, Debit card 1234 charge made online, by phone, or mail on 10/02/2026 for $30.00. ║ BofA'],
    ['BofA (Declined) prefix', 'USD', 'US', '73981', 'Bank of America: (Declined) Money transfer of $250.00 for account 1234 was deducted on 10/02/2026.'],
    ['BofA future deduction', 'USD', 'US', '73981', 'Bank of America: Money transfer of $250.00 for account 1234 will be deducted on 10/09/2026.'],
    ['BofA negated deduction', 'USD', 'US', '73981', 'Bank of America: Money transfer of $250.00 for account 1234 was not deducted on 10/02/2026.'],
    ['Capital One declined', 'USD', 'US', '227898', 'Capital One: Your purchase for $23.50 at SAMPLE DINER was declined.'],
    ['Capital One pending', 'USD', 'US', '227898', 'Capital One: Your purchase for $23.50 at SAMPLE DINER is pending approval.'],
    ['Revolut declined', 'EUR', 'LT', 'Revolut', '🚫 Your payment of 10 € to SAMPLE NAME has been declined. Available credit: 1.288,73 €'],
    ['Revolut pending', 'EUR', 'LT', 'Revolut', 'Your payment of 150 € at Sample Fuel is pending. Available credit: 1.288,73 €'],
    ['available credit alone', 'EUR', 'LT', 'Revolut', 'Available credit: 1.288,73 € ║ Revolut'],
  ]) {
    ok(`never auto-added: ${label}`, worldwide(currency, cc, sender, body) === null);
  }
  // A threshold, a daily total or a credit headroom is never the amount.
  for (const [label, currency, cc, sender, body, notMinor, principal] of [
    ['a Chase alert threshold', 'USD', 'US', '24273', 'Chase acct 1234: A charge of $64.10 at SAMPLE GRILL on Oct 2, 2026 at 7:00 PM ET is greater than your $5.00 limit in your Alerts settings.', 500, 6410],
    ['a Chase alert threshold without "limit"', 'USD', 'US', '24273', 'Chase acct 1234: Your $1.75 debit card transaction with SAMPLE SHOP on Oct 2, 2026 at 7:00 PM ET was more than the $0.01 in your Alerts settings.', 1, 175],
    ['a Monzo daily total', 'GBP', 'GB', 'Monzo', 'You’ve spent £54.20 on your card today. ║ 💳 £12.40 at Sample Bakery', 5420, 1240],
    ['a Revolut spent-today total', 'EUR', 'LT', 'Revolut', '😉 Paid €12.30 at Sample Store 😉 Spent today: €40.00 ║ Sample Store', 4000, 1230],
    ['Revolut available credit', 'EUR', 'LT', 'Revolut', '🛒 You spent 150 € Available credit: 1.288,73 € ║ Sample Fuel', 128873, 15000],
  ]) {
    const row = worldwide(currency, cc, sender, body);
    const event = inspectUniversalBankEvent(body, { sender });
    ok(`never the amount: ${label}`, (row === null || row.amountFils === principal) &&
      event.amount.value?.minorUnits !== String(notMinor), { row, amount: event.amount.value });
  }
}

/* ── 2026-10 batch 2, review round: every reviewer probe is pinned ─────── */
{
  const country = require('./build/country');
  const OBSERVED = Date.parse('2026-10-03T08:00:00Z');
  const worldwide = (currency, cc, sender, body) => {
    markets.setActiveMarket('ZZ');
    markets.setLedgerCurrency(currency, 2);
    country.setActiveCountry(cc);
    const s = createLaunchAlertSession({ overrides: {}, regionHint: cc, fxLookup: () => null,
      bestEffort: { enabled: true, country: cc } });
    try { return s.parse(body, sender, s.inspect(body, sender), undefined, OBSERVED); }
    finally { markets.setLedgerCurrency(null); country.setActiveCountry(null); markets.setActiveMarket('AE'); }
  };
  const never = (label, currency, cc, sender, body) =>
    ok(`review round, never auto-added: ${label}`, worldwide(currency, cc, sender, body) === null,
      worldwide(currency, cc, sender, body));
  const posts = (label, currency, cc, sender, body, minor, type) => {
    const row = worldwide(currency, cc, sender, body);
    ok(`review round, posts: ${label}`, row?.type === type && row.amountFils === minor, row);
  };

  // 1. "[name] made a … transaction": only a header-prefixed ALL-CAPS name.
  for (const body of [
    'Chase: Fraud alert. Somebody made a $499.00 transaction with BESTBUY. Text YES if it was you, NO if not.',
    'Unusual activity: someone made a $499.00 transaction with BESTBUY on Oct 2, 2026.',
    'Your card was locked after someone made a $499.00 transaction with BESTBUY.',
    'Chase: SOMEONE made a $499.00 transaction with BESTBUY on Oct 2, 2026.',
    'Chase: If ALEX made a $19.99 transaction with CORNER CAFE, no action is needed.',
    'Chase: If you see that ALEX made a $19.99 transaction with CORNER CAFE, let us know.',
    'Prime Visa 1234: ALEX made a $19.99 transaction with CORNER CAFE that we blocked.',
    'Prime Visa 1234: ALEX made a $19.99 transaction with CORNER CAFE that we stopped for your protection.',
    'Prime Visa 1234: ALEX made a $19.99 transaction with CORNER CAFE that is under review.',
    'Chase: You made a $19.99 transaction with CORNER CAFE. Was this you? Reply YES or NO.',
    'Chase: Suspicious activity. You made a $19.99 transaction with CORNER CAFE on Oct 2, 2026.',
  ]) never(body.slice(0, 60), 'USD', 'US', '24273', body);
  posts('a conditional "suspicious" footer does not stop a completed purchase', 'QAR', 'QA', 'QNB',
    'Your QNB debit card SAMPLE1 has been used for a purchase for QAR 120 at SAMPLE STORE and the available balance is QAR 900. In case the transaction is suspicious Please Call 40000000', 12000, 'expense');
  posts('the real authorised-user shape still posts', 'USD', 'US', '24273',
    'Prime Visa 1234: ALEX made a $19.99 transaction with CORNER CAFE on Oct 2, 2026 at 9:41 AM ET.', 1999, 'expense');

  // 2. "has received your transfer": only a named person flips it to money out.
  for (const body of [
    'Revolut has received your bank transfer of €500',
    'N26 has received your transfer of €500',
    'PayPal has received your transfer of €500',
    'Wise has received your transfer of €500',
    'Revolut Ltd has received your transfer of €75 — your top-up is complete',
    'Your savings space has received your transfer of €100',
    'Once JAMIE ROE has received your bank transfer of €75 we will notify you.',
  ]) never(body.slice(0, 60), 'EUR', 'DE', 'de.number26.android', body);
  posts('a named person receiving your transfer is money out', 'EUR', 'DE', 'de.number26.android',
    'JAMIE ROE has received your bank transfer of €75 ║ N26', 7500, 'expense');

  // 3. "paid you": a sentence-initial payer only, never an ad or a question.
  for (const body of [
    'Earn $5 every time a friend has paid you via Venmo',
    'JORDAN LEE paid you $48.20\nTap to accept: venmo-claim.example/claim',
    "JORDAN LEE hasn't paid you $48.20 yet. Remind them?",
    'Has JORDAN paid you $48.20? Mark as paid.',
    'If JORDAN LEE paid you $48.20, mark it received.',
  ]) never(body.slice(0, 60), 'USD', 'US', '86753', body);
  posts('a peer who paid you is still income', 'USD', 'US', '86753', 'JORDAN LEE paid you $48.20 dinner', 4820, 'income');

  // 4. Real footers are not scam calls to action; bait still is.
  posts('UCO-shaped "Report Dispute <short link>" footer', 'INR', 'IN', 'VM-UCOBNK',
    'A/c XX1234 Credited with Rs.6.00 on 07-02-2024 by UCO-UPI.Avl Bal Rs.51.98. Report Dispute https://bit.ly/sample1 .For feedback https://rb.gy/sample2', 600, 'income');
  posts('"To cancel alerts, visit chase.com/alerts"', 'USD', 'US', 'CHASE',
    'Chase: You made a $24.86 purchase at NORTH STAR MARKET with card ending 4421. To cancel alerts, visit chase.com/alerts', 2486, 'expense');
  posts('"To dispute this charge visit <bank domain>" on a completed alert', 'USD', 'US', 'CHASE',
    'Chase: You made a $24.86 purchase at NORTH STAR MARKET with card ending 4421. To dispute this charge visit www.chase.com/dispute', 2486, 'expense');
  never('"To dispute this charge visit <short link>"', 'USD', 'US', 'UNKNOWN',
    'Your card ending 4421 was charged $612.00 at LAPTOP WORLD. To dispute this charge visit bit.ly/card-help');
  never('"log in" at a lookalike link', 'USD', 'US', 'UNKNOWN',
    'Your card ending 4421 was charged $612.00 at LAPTOP WORLD. Not you? Log in at https://card-secure-login.example');

  // 5. Narrowed shapes.
  posts('paying a friend with your card is not a payment TO your card', 'USD', 'US', '86753',
    'You paid $50.00 to your friend using your debit card', 5000, 'expense');
  never('a merchant shipping notice that repeats the payment', 'USD', 'US', 'AMAZON',
    'Your order #12345 has shipped. You paid $50.00 with card 1234 at AMAZON.');

  // Re-review round.
  // 1. Fraud prompts under the header-colon authorised-user shape.
  for (const body of [
    'Chase: ALEX made a $19.99 transaction with CORNER CAFE. Did you authorize this? Reply Y/N',
    'Chase: ALEX made a $19.99 transaction with CORNER CAFE. Reply 1 if you recognize it, 2 if not.',
    'Chase: ALEX made a $19.99 transaction with CORNER CAFE that we flagged as suspicious.',
    'Chase: ALEX made a $19.99 transaction with CORNER CAFE that we held.',
    'Chase: ALEX made a $19.99 transaction with CORNER CAFE. Code 123456.',
    'Chase: ALEX made a $19.99 return transaction with CORNER CAFE.',
  ]) never(body.slice(0, 70), 'USD', 'US', '24273', body);
  // 2. Anonymous payers and money-claim links.
  for (const body of [
    'Somebody paid you $500! Collect now at venmo-pay.example/collect',
    'Somebody paid you $500!',
    'JORDAN LEE wants to know if they paid you $48.20',
  ]) never(body.slice(0, 60), 'USD', 'US', '86753', body);
  // 3. Only an ALL-CAPS personal name flips "has received your transfer".
  for (const body of [
    'Trade Republic has received your transfer of €500',
    'Scalable Capital has received your bank transfer of €500',
  ]) {
    const row = worldwide('EUR', 'DE', 'de.number26.android', body);
    ok(`a broker top-up is never money out — ${body.slice(0, 40)}`, row === null || row.type !== 'expense', row);
  }
  // 4. Real bank footers on a completed alert.
  for (const footer of [
    'Not you? Sign in at secure.chase.com/alerts',
    'To update your alerts, log in at https://secure.chase.com',
    'Update the app: https://apps.apple.com/us/app/chase-mobile/id298867247',
    'Log in: https://www.chase.com',
  ]) {
    posts(`real footer "${footer.slice(0, 40)}"`, 'USD', 'US', 'CHASE',
      `Chase: You made a $24.86 purchase at NORTH STAR MARKET with card ending 4421. ${footer}`, 2486, 'expense');
  }
  never('"update your details" at a link', 'USD', 'US', 'UNKNOWN',
    'Your card ending 4421 was charged $612.00 at LAPTOP WORLD. Update your details here: https://cardholder-portal.example');
  // 5. Lookalike hosts in a "not you" footer, and a TLD-spoofing host.
  for (const footer of [
    'Not you? Click https://chase-x.example',
    'Visit https://chase.com-refund.example/x',
    'To stop this payment visit chasebank-alerts.example/x',
  ]) {
    never(`lookalike footer "${footer.slice(0, 40)}"`, 'USD', 'US', 'UNKNOWN',
      `Your card ending 4421 was charged $612.00 at LAPTOP WORLD. ${footer}`);
  }

  // Round 3: genuine footers must not cost a completed alert.
  for (const [label, currency, cc, sender, body, minor] of [
    ['first direct hyphenated fraud link', 'GBP', 'GB', 'firstdirect', 'first direct: You spent £12.50 at Tesco Express. Not you? Visit www.first-direct.com/fraud', 1250],
    ['Co-operative Bank fraud link', 'GBP', 'GB', 'CoopBank', 'Co-operative Bank: You spent £12.50 at Tesco Express. Not you? Visit www.co-operativebank.co.uk/fraud', 1250],
    ['Co-operative Bank help link', 'GBP', 'GB', 'CoopBank', 'You spent £12.50 at Tesco Express. For help visit https://www.co-operativebank.co.uk/help', 1250],
    ['a hyphenated bank domain', 'USD', 'US', 'CHASE', 'Chase: You made a $24.86 purchase at NORTH STAR MARKET with card ending 4421. Manage cards at https://www.bank-abc.com/cards', 2486],
    ['a net-banking domain', 'USD', 'US', 'CHASE', 'Chase: You made a $24.86 purchase at NORTH STAR MARKET with card ending 4421. Statements: www.net-banking.example.com/home', 2486],
    ['Crédit Agricole fraud link', 'EUR', 'FR', 'CA', 'Paiement par carte effectué : 32,00 EUR chez MARCHE BIO le 02/10/2026. Not you? Visit www.credit-agricole.fr/fraude', 3200],
    ['Sparkasse block link', 'EUR', 'DE', 'Sparkasse', 'Kartenzahlung erfolgreich: 34,90 EUR bei REWE Markt GmbH am 02.10.2026. Not you? Visit www.sparkasse-koelnbonn.de/sperren', 3490],
    ['an authorisation code footer', 'INR', 'IN', 'VM-HDFCBK', 'Rs.420.00 spent on HDFC Bank Card x1234 at FOODAPP on 2026-10-02:20:10:10. Auth code 123456.', 42000],
    ['a merchant category code', 'USD', 'US', 'CHASE', 'Chase: You made a $24.86 purchase at TARGET with card ending 4421, merchant code 5411.', 2486],
    ['a lost-card locking tip', 'USD', 'US', 'CHASE', 'Chase: You made a $24.86 purchase at NORTH STAR MARKET with card ending 4421. If your card is lost, it can be locked in the app.', 2486],
    ['a rewards tagline', 'USD', 'US', 'CHASE', 'Chase: You made a $24.86 purchase at NORTH STAR MARKET with card ending 4421. Earn 5% back on groceries.', 2486],
  ]) posts(label, currency, cc, sender, body, minor, 'expense');
  never('a weak verb with "now" at a non-brand domain', 'USD', 'US', 'UNKNOWN',
    'Your card was charged $612.00 at LAPTOP WORLD. Log in now: http://chasebank.example/x');
  never('a branded header does not vouch for a different domain', 'USD', 'US', 'UNKNOWN',
    'Chase: Your card was charged $612.00 at LAPTOP WORLD. Log in now: http://chasebank.example/x');

  // 7. "will have been" is future.
  never('"will have been debited"', 'USD', 'US', 'CHASE', 'Chase: $40.00 will have been debited from your account ending 4421 by Friday.');
}

/* ── External-corpus wrong bookings (synthetic fixtures; own wording) ──── */
{
  const country = require('./build/country');
  const OBS = Date.parse('2026-10-10T08:00:00Z');
  const auto = (currency, cc, body, exponent = 2, sender = '') => {
    markets.setActiveMarket('ZZ');
    markets.setLedgerCurrency(currency, exponent);
    country.setActiveCountry(cc);
    const s = createLaunchAlertSession({ overrides: {}, regionHint: cc, pinnedCurrency: currency, fxLookup: () => null,
      bestEffort: { enabled: true, country: cc } });
    try { return s.parseUnproven(body, sender, s.inspect(body, sender), OBS); }
    finally { markets.setLedgerCurrency(null); country.setActiveCountry(null); markets.setActiveMarket('AE'); }
  };
  // B6. A fraud check or unconfirmed authorisation is not a completed purchase.
  for (const body of [
    'Kestrel CU alert for card x5501: online order AUD $318.40 (CITY GADGETS) is under review. Text back Y to approve or N to decline.',
    'Kestrel CU: card x2290 is on hold. We spotted a purchase attempt of AUD $92.10 that looks unusual. Text Y if this was you, N if not.',
    'Kestrel CU: before card x4473 is used again we need to confirm AUD $57.80 at MOSSVALE PANTRY. Text Y (yes, mine) or N (not mine).',
    'Kestrel CU is checking recent activity on card x3318: AUD $140.00 online at a new store. Text Y to confirm or N to report it.',
    'Kestrel CU: AUD $480.00 purchase attempt on card x6604. Restrictions were placed until you answer: text Y if genuine, N otherwise.',
    'Kestrel CU security: AUD 77.25 at GEARHOUSE went through on card x9031. Was it yours? Text Y or N.',
  ]) {
    ok(`AU: a fraud check is never auto-added — ${body.slice(0, 60)}…`, auto('AUD', 'AU', body) === null, auto('AUD', 'AU', body));
  }
  {
    const row = auto('AUD', 'AU', 'Kestrel CU: AUD 64.90 spent at MOSSVALE PANTRY on card ending 4473 on 08/10/2026. Available balance AUD 1,203.55.');
    ok('AU control: a completed purchase is still auto-added', row?.bestEffort && row.amountFils === 6490 && row.type === 'expense', row);
  }
  ok('a refusal of the fraud-question wording is reflected in the wording guard',
    policy.hasNonCompletedWording('Before card x4473 is used again we need to confirm AUD $57.80 at MOSSVALE PANTRY.') &&
      policy.hasNonCompletedWording('Restrictions were placed on card ending 6604.') &&
      !policy.hasNonCompletedWording('AUD 64.90 spent at MOSSVALE PANTRY. Not you? SMS BLOCK 4473 to 5676.'));
  // B7. "Refund initiated … update your bank details" is neither completed nor safe.
  ok('IN: an initiated refund asking for bank details is never auto-added',
    auto('INR', 'IN', 'Refund initiated: Amt: Rs.7815.40 on Axis Bank Credit Card 2203. To receive your Refund, please update your Bank details: bit.ly/x') === null);
  {
    const row = auto('INR', 'IN', 'Refund of INR 781.40 from NORTH MART credited to card ending 2203.');
    ok('IN control: a completed refund credit is still auto-added as income',
      row?.bestEffort && row.type === 'income' && row.amountFils === 78140, row);
  }
  // B8. One dot and three digits in a two-decimal currency is 7.00 OR 7,000.00.
  ok('IN: "Rs. 7.000" is ambiguous and never auto-added',
    auto('INR', 'IN', 'Rs. 7.000 credited to your A/c xxxxxx5512 on 04/10/2026 through NEFT by NORTHWIND SUPPLY PVT LTD') === null);
  ok('DE: "EUR 1.234" is ambiguous and never auto-added',
    auto('EUR', 'DE', 'EUR 1.234 debited from your account on 04/10/2026 at MEDIAMARKT BERLIN.') === null);
  for (const [currency, cc, body, minor, exponent] of [
    ['INR', 'IN', 'Rs. 7.00 credited to your A/c xxxxxx5512 on 04/10/2026 through NEFT by NORTHWIND SUPPLY PVT LTD', 700, 2],
    ['INR', 'IN', 'Rs. 7,000.00 credited to your A/c xxxxxx5512 on 04/10/2026 through NEFT by NORTHWIND SUPPLY PVT LTD', 700000, 2],
    ['KWD', 'KW', 'KWD 12.345 debited from your account 4410 at THE AVENUES MALL on 05/10/2026.', 12345, 3],
    ['BHD', 'BH', 'BHD 7.250 spent on your card ending 8812 at CITY CENTRE BAHRAIN on 05/10/2026.', 7250, 3],
    ['OMR', 'OM', 'OMR 4.125 debited from your account 2207 at LULU MUSCAT on 05/10/2026.', 4125, 3],
  ]) {
    const row = auto(currency, cc, body, exponent);
    ok(`${cc} control: ${body.slice(0, 40)}… posts exactly ${minor}`, row?.amountFils === minor && row.currency === currency, row);
  }
  {
    const row = auto('EUR', 'DE', 'EUR 1.234,56 debited from your account on 04/10/2026 at MEDIAMARKT BERLIN.');
    ok('DE control: a comma-decimal "1.234,56" never posts a wrong value', row === null || row.amountFils === 123456, row);
  }
  // F1. "sent to <the alerting bank's own masked account>" is money arriving.
  for (const body of [
    'Raast: PKR 4,750.00 sent to SCB PK A/C ***8821 from AYESHA KHAN via MEEZAN BANK on 06-Oct-26. TID 61822',
    'PKR 12,300.00 has been sent to SCB PK A/C ****4410 through Raast from BILAL TRADERS. Ref 7781',
  ]) {
    ok(`PK: an inbound "sent to <own account>" alert is never auto-added as spending — ${body.slice(0, 40)}`,
      auto('PKR', 'PK', body, 2, 'SCB') === null, auto('PKR', 'PK', body, 2, 'SCB'));
  }
  {
    // Refused from auto-add, but still a possible money movement: a masked
    // account reference is bank context, so the refusal lands in Review.
    const { hasGenericBankAlertContext } = require('./build/launch-alert-parser');
    ok('PK: the refused inbound alert keeps bank context for Review',
      hasGenericBankAlertContext('Dear Customer, PKR 9,800.00 sent to SCB PK A/C ****4410 for FUNDS TRANSFER via RAAST', ''));
    ok('control: a personal message with an amount still has no bank context',
      !hasGenericBankAlertContext('I sent you PKR 500 for lunch, see you at 4', ''));
  }
  {
    const row = auto('PKR', 'PK', 'PKR 1,250.00 sent to HAMZA ALI via Raast from your A/C ****4410 on 06-Oct-26.', 2, 'SCB');
    ok('PK control: an outbound "sent to <named person> from your A/C" is still auto-added as an expense',
      row?.bestEffort && row.type === 'expense' && row.amountFils === 125000, row);
    const named = auto('PKR', 'PK', 'Raast: PKR 4,750.00 sent to AYESHA KHAN MEEZAN A/C ***8821 from your SCB PK A/C ****4410 on 06-Oct-26. TID 61822', 2, 'SCB');
    ok('PK control: an outbound transfer to a named payee account from your account still auto-adds as an expense',
      named?.bestEffort && named.type === 'expense' && named.amountFils === 475000, named);
  }
  // G1. A zero-decimal figure with decimals is unreadable; never book a substitute.
  ok('JP: "812.40 JPY 7 SAKURA MART" is never auto-added as JPY 7',
    auto('JPY', 'JP', 'Card purchase 812.40 JPY 7 SAKURA MART 2 Balance 15,200 JPY', 0) === null);
  ok('KR: a clock "9:45" is never read as KRW 9',
    auto('KRW', 'KR', '38.15 KRW 9:45 HANA STORE card ending 4410', 0) === null);
  {
    const row = auto('JPY', 'JP', 'Purchase of JPY 4,650 at SAKURA MART with card ending 4410 on 05/10/2026.', 0);
    ok('JP control: a whole-yen purchase still auto-adds exactly', row?.amountFils === 4650 && row.currency === 'JPY', row);
  }
  // G2. "Transaction Error ... encountered an issue processing" is a failed payment.
  ok('US: a transaction-error alert is never auto-added',
    auto('USD', 'US', 'Transaction Error: We encountered an issue processing your transaction of USD 64.20 at HARBOR OUTFITTERS. Card ending 4410.') === null);
  {
    const row = auto('USD', 'US', 'USD 64.20 spent at HARBOR OUTFITTERS with card ending 4410 on 05/10/2026. To report errors call 1-800-555-0100.');
    ok('US control: a posted alert with a "report errors" footer still auto-adds', row?.amountFils === 6420 && row.type === 'expense', row);
  }
  // D3. An offer is not a purchase.
  ok('MY: "Get RM50 off your next purchase" is never auto-added',
    auto('MYR', 'MY', 'Flash sale! Get RM50 off your next purchase at KEDAI MAJU this weekend.') === null);
  // D4. A qualified dollar prefix names its own currency.
  for (const [currency, cc, body] of [
    ['USD', 'US', 'You paid NT$350.00 at TAIPEI NOODLE HOUSE with card ending 4410 on 05/10/2026.'],
    ['SGD', 'SG', 'You paid US$42.00 at HARBOUR BOOKS with card ending 4410 on 05/10/2026.'],
    ['AUD', 'AU', 'You paid US$42.00 at HARBOUR BOOKS with card ending 4410 on 05/10/2026.'],
    ['USD', 'US', 'You paid NZ$15.00 at KIWI CAFE with card ending 4410 on 05/10/2026.'],
    ['USD', 'US', 'You paid RD$900.00 at COLMADO SOL with card ending 4410 on 05/10/2026.'],
  ]) {
    const row = auto(currency, cc, body);
    ok(`${cc}: a foreign dollar prefix is never relabelled as ${currency} — ${body.slice(9, 20)}`,
      row === null || row.currency !== currency || row.originalCurrency !== undefined, row);
  }
  // H1. Scam lures and fraud questions with an amount are never auto-added.
  for (const [currency, cc, body] of [
    // (a) fraud questions
    ['USD', 'US', 'Lakeside Bank: Did you make a purchase of $412.18 at HOME DEPOT on card ending 2201? Reply Y/N.'],
    ['USD', 'US', 'Lakeside Bank: a $388.40 charge at BEST BUY on card ending 2201. Was this you? Reply YES or NO.'],
    ['GBP', 'GB', 'Northgate: your card was used for £640.12 at CURRYS. If this was not you, click to verify this transaction.'],
    ['USD', 'US', 'You sent a payment of $249.99 to M. CARTER. If you did not authorize this transaction, check here.'],
    ['USD', 'US', 'Lakeside Bank: verify account activity. A purchase of $511.20 at TARGET on card 2201. Respond Y to approve.'],
    // (b) refund / grant lures
    ['USD', 'US', '[Tax Office] You will receive a tax refund of $612.00, but we need you to confirm your information in the link.'],
    ['GBP', 'GB', 'Revenue Office: you are eligible for a rebate of £286.40. Claim your money today.'],
    // (c) a link next to the money
    ['EUR', 'DE', 'Belastung von 1.250,00 EUR auf Ihrem Konto. Nicht Sie? Pruefen: konto-sicher.example/check'],
    ['USD', 'US', 'Your account was charged $329.00 for a renewal. Details: https://acct-help.example/renew'],
    // (d) India promo / loan bait
    ['INR', 'IN', 'Rs. 750 credited to your account. Only 45 mins left. Tap here to Claim Now! shopzy.example/u/a81f'],
    ['INR', 'IN', 'Congrats, INR 45,000.00 Can Be Credited To Your A/c xxxxx4410. Check Now: qk7.example/z1'],
    // (e) an initiated refund that will only reflect later
    ['INR', 'IN', 'Refund of Rs 84.0 has been initiated for your order FD5521. Updated balance should reflect in 3-5 days.'],
    // (f) activation / PIN codes
    ['INR', 'IN', 'ACTIVATION CODE 448812 for your card 4410: a charge of Rs.50 applies on activation.'],
    ['USD', 'US', 'Your PIN 9921 authorises the purchase of $75.00 at QUICKMART. Do not share it.'],
  ]) {
    ok(`${cc}: a lure or fraud question is never auto-added — ${body.slice(0, 50)}…`, auto(currency, cc, body) === null,
      auto(currency, cc, body));
  }
  for (const [currency, cc, body, type, minor] of [
    ['INR', 'IN', 'Rs. 2,400.00 credited to your A/c XX4410 on 05/10/2026 by A/c linked to VPA asha@upi (UPI Ref No 512233).', 'income', 240000],
    ['USD', 'US', 'Lakeside Bank: $64.90 spent at RIVERSIDE GROCER on card ending 2201. Not you? Call 1-800-555-0100.', 'expense', 6490],
    ['QAR', 'QA', 'Your debit card has been used for a purchase of QAR 318 at CITY MART and the available balance is QAR 1,120. In case the transaction is suspicious please call 4440000.', 'expense', 31800],
  ]) {
    const row = auto(currency, cc, body);
    ok(`${cc} control: a genuine alert still auto-adds — ${body.slice(0, 40)}…`,
      row?.bestEffort && row.type === type && row.amountFils === minor, row);
  }
  {
    // A link footer: allowed from a registered alphanumeric bank header,
    // never from a phone number, an e-mail address or a generic header.
    const body = 'Rs.640.00 paid to KIRAN STORES from your a/c XX4410 on 05/10/2026. History: https://m.walletbank.example/h';
    const row = auto('INR', 'IN', body, 2, 'AD-WLTBNK');
    ok('IN control: a registered bank header with a link footer still auto-adds',
      row?.bestEffort && row.type === 'expense' && row.amountFils === 64000, row);
    for (const sender of ['56161', 'com.walletbank.android']) {
      const r = auto('INR', 'IN', body, 2, sender);
      ok(`IN control: a carrier short code / app package "${sender}" with a link footer still auto-adds`,
        r?.bestEffort && r.amountFils === 64000, r);
    }
    for (const sender of ['+919812345678', 'alerts@walletbank.example', 'INFO']) {
      ok(`IN: the same link-carrying alert from "${sender}" is never auto-added`, auto('INR', 'IN', body, 2, sender) === null);
    }
    // Parser fold of #151: with NO sender (iOS History, paste) a link stands
    // only beside a completed movement on the own account tail and with no
    // call to action — the UCO "Report Dispute <link>" shape.
    const senderless = auto('INR', 'IN', body, 2, '');
    ok('IN: the same own-account alert with no sender keeps its link footer and auto-adds',
      senderless?.bestEffort && senderless.amountFils === 64000, senderless);
    for (const bait of [
      'Rs.640.00 paid to KIRAN STORES from your a/c XX4410 on 05/10/2026. Not you? Dispute here: https://m.walletbank.example/h',
      'Rs.640.00 paid to KIRAN STORES on 05/10/2026. History: https://m.walletbank.example/h',
    ]) {
      ok(`IN: a senderless link without an own tail, or with a call to action, never auto-adds — ${bait.slice(40, 80)}`,
        auto('INR', 'IN', bait, 2, '') === null);
    }
    const descriptor = auto('THB', 'TH', 'Purchase 412.00 THB WWW.SIAMRIDE.COM from card x-4801 (06/03/26, 11:22 hr)', 2, '');
    ok('TH control: an upper-case merchant domain in a card descriptor is not a link',
      descriptor?.bestEffort && descriptor.amountFils === 41200, descriptor);
  }
  // H3. "<payee> has received your transfer" is money OUT, never income.
  ok('DE: "<payee> has received your bank transfer" is never auto-added as income',
    auto('EUR', 'DE', 'Jonas Albrecht has received your bank transfer of €210 from your account.') === null ||
      auto('EUR', 'DE', 'Jonas Albrecht has received your bank transfer of €210 from your account.')?.type !== 'income');
  // F1 control: a named payee before A/C is not the alerting bank's account.
  {
    const row = auto('KES', 'KE', 'KES 18,250 sent to WANJIRU MAINA A/C ****5520. Pesalink transfer complete.');
    ok('KE control: "sent to <NAMED PAYEE> A/C ****" still auto-adds as an expense',
      row?.bestEffort && row.type === 'expense' && row.amountFils === 1825000, row);
  }
  for (const [currency, cc, body, minor] of [
    ['USD', 'US', 'You paid $15.00 at CORNER CAFE with card ending 4410 on 05/10/2026.', 1500],
    ['SGD', 'SG', 'You paid S$15.00 at CORNER CAFE with card ending 4410 on 05/10/2026.', 1500],
    ['USD', 'US', 'You paid US$15.00 at CORNER CAFE with card ending 4410 on 05/10/2026.', 1500],
  ]) {
    const row = auto(currency, cc, body);
    ok(`${cc} control: ${body.slice(9, 17)} on a ${currency} ledger posts ${minor}`, row?.amountFils === minor && row.currency === currency, row);
  }
  /* H4. Reported smishing, round 7 (IMC25 families, Kaggle India suspects).
   * All wording below is Wafra's own; none is copied from a corpus. */
  // (a) A "money arrived" claim from a phone number, naming none of the
  // reader's own accounts or cards, waits in Review; the same text from the
  // wallet's registered header or short code still auto-adds, and so does
  // the same text with NO sender (an iOS History record or a paste): a
  // missing sender is not an unverified one, it is marked "Auto-added — check".
  {
    const mpesa = 'QX81TR4KLM Confirmed. You have received Ksh 6,400.00 from PETER KAMAU 0711000333 on 4/10/26 at 9:15 AM. New M-PESA balance is Ksh 6,512.40.';
    ok('KE: a received-money claim from a mobile number with no own account is never auto-added',
      auto('KES', 'KE', mpesa, 2, '+254711000222') === null, auto('KES', 'KE', mpesa, 2, '+254711000222'));
    // Parser fold of #151: a BLANK sender (iOS History, paste) is treated
    // like a phone number for a money-arrived claim with no own tail.
    ok('KE: the same credit with no sender at all is never auto-added',
      auto('KES', 'KE', mpesa) === null, auto('KES', 'KE', mpesa));
    const genuine = auto('KES', 'KE', mpesa, 2, 'MPESA');
    ok('KE control: the same M-Pesa credit from MPESA still auto-adds',
      genuine?.bestEffort && genuine.type === 'income' && genuine.amountFils === 640000, genuine);
    const wallet = 'TID 88120044. You have received Rs. 7,500.00 from NADIA PERVEEN. Your new wallet balance is Rs. 7,612.40.';
    ok('PK: a wallet credit claim from a mobile number is never auto-added', auto('PKR', 'PK', wallet, 2, '03001234567') === null);
    const shortCode = auto('PKR', 'PK', wallet, 2, '8558');
    ok('PK control: the same wallet credit from a carrier short code still auto-adds',
      shortCode?.bestEffort && shortCode.type === 'income' && shortCode.amountFils === 750000, shortCode);
    const php = 'You have received PHP 2,500.00 from J. SANTOS 09170000000. Your new balance is PHP 2,612.75. Ref. No. 40021.';
    ok('PH: a "You have received PHP" claim from a mobile number is never auto-added',
      auto('PHP', 'PH', php, 2, '+639170000000') === null);
    ok('PH: the same claim with no sender is never auto-added', auto('PHP', 'PH', php) === null);
    ok('KE: a USSD code ("Dial *334#") is not an own-card reference',
      auto('KES', 'KE', 'Dial *334# to join. Confirmed. You have received Ksh 9,930.00 from MARY ATIENO. New balance is Ksh 9,940.00.', 2, '+254711000222') === null);
    // A masked figure that is NOT the reader's own (the payer's phone, a
    // reference) does not answer for an unverified sender.
    for (const body of [
      'RT55KQ19ZX Confirmed. You have received Ksh18,250.00 from ALICE WANJIRU 0722***519 on 6/10/26 at 2:40 PM. New M-PESA balance is Ksh18,301.10.',
      'RT55KQ19ZX Confirmed. You have received Ksh18,250.00 from ALICE WANJIRU 2547*****519 on 6/10/26 at 2:40 PM New M-PESA balance is Ksh18,301.10.',
    ]) {
      ok(`KE: a masked payer phone is not an own account — ${body.slice(70, 98)}`,
        auto('KES', 'KE', body, 2, '+254733000444') === null, auto('KES', 'KE', body, 2, '+254733000444'));
    }
    ok('US: a masked reference ("Ref *2207") is not an own account',
      auto('USD', 'US', 'You have received $1,450.00 from MARK JONES. Ref *2207.', 2, '+12025550147') === null);
    // Own-instrument words with a tail still answer for it, in any script.
    for (const [currency, cc, body, minor] of [
      ['INR', 'IN', 'Rs 1,800.00 credited to a/c *917 on 06-10-26 by IMPS from RAVI K. Ref 600123.', 180000],
      ['INR', 'IN', 'INR 2,250.00 credited to A/c XX5520 on 06-10-26 by NEFT. Ref 600124.', 225000],
      ['USD', 'US', 'Your refund of $31.00 from CITY BOOKS was credited to card ending 4421.', 3100],
    ]) {
      const row = auto(currency, cc, body, 2, '+12025550147');
      ok(`${cc}: an own account or card tail answers for a phone sender — ${body.slice(0, 40)}`,
        row?.bestEffort && row.type === 'income' && row.amountFils === minor, row);
    }
    for (const [name, text] of [
      ['Arabic account number', 'تم إيداع مبلغ 500 في حساب رقم XXXX1234'],
      ['Arabic card tail', 'عملية على بطاقة …1234'],
      ['card ending in', 'paid with card ending in 4421'],
      ['masked account with prefix digits', 'account 0312XXXXX4410 credited'],
      ['two-dot account mask', 'paid from cheq a/c..123456 @ store'],
    ]) {
      ok(`own-instrument tail: ${name}`, policy.namesOwnInstrumentTail(text) === true);
    }
    for (const [name, text] of [
      ['payer phone', 'from JOHN DOE 0712***678'],
      ['reference', 'Ref *4410.'],
      ['USSD code', 'Dial *334# now'],
      ['fully masked account', 'credited to a/c XXXXXX'],
    ]) {
      ok(`not an own-instrument tail: ${name}`, policy.namesOwnInstrumentTail(text) === false);
    }
    const tailed = auto('INR', 'IN', 'Rs. 2,400.00 credited to your A/c XX4410 on 05/10/2026 by A/c linked to VPA asha@upi (UPI Ref No 512233).', 2, '+919812345678');
    ok('IN control: a credit naming the own account tail still auto-adds from a long number',
      tailed?.bestEffort && tailed.type === 'income' && tailed.amountFils === 240000, tailed);
  }
  {
    // A senderless exact template posts like any senderless alert; from a
    // mobile number it is still an unverified claim.
    const yape = 'Te yapeo S/ 15.00 ROSA QUISPE';
    const senderless = auto('PEN', 'PE', yape);
    ok('PE control: a senderless exact Yape template still auto-adds',
      senderless?.bestEffort && senderless.type === 'income' && senderless.amountFils === 1500, senderless);
    ok('PE: the same Yape text from a mobile number is never auto-added', auto('PEN', 'PE', yape, 2, '+51987000111') === null);
  }
  // (b) A debit whose only hook is a callback, from a phone number and with
  // no own card or account, waits in Review; with the card tail it still
  // adds. With no sender at all the text alone decides, and this one carries
  // no lure wording, so it is auto-added marked for a check (the honest cost
  // of not treating a missing sender as unverified).
  ok('GB: a purchase claim from a mobile number with only a callback hook is never auto-added',
    auto('GBP', 'GB', 'You paid £2,150.00 for a laptop on 03/10/2026. Need help? Call 0800 000 1111.', 2, '+447700900321') === null);
  {
    const row = auto('GBP', 'GB', 'You paid £2,150.00 for a laptop on 03/10/2026. Need help? Call 0800 000 1111.');
    ok('GB: the same text with no sender is never auto-added (blank sender, callback hook, no own card)',
      row === null, row);
  }
  {
    const row = auto('GBP', 'GB', 'You paid £21.50 at CORNER CAFE with card ending 4410 on 03/10/2026. Need help? Call 0800 000 1111.');
    ok('GB control: the same footer on a purchase naming the card still auto-adds',
      row?.bestEffort && row.type === 'expense' && row.amountFils === 2150, row);
  }
  // (c) Lure wording, refused whoever the sender is.
  for (const [currency, cc, sender, body] of [
    ['GBP', 'GB', 'GOVREFUND', 'You are due a tax refund of £318.40 for the last tax year. Complete the short form to release your payment.'],
    ['GBP', 'GB', 'GOVREFUND', 'At this time we owe you a refund of £96.30 for last year.'],
    ['GBP', 'GB', 'GOVUK', 'You have an outstanding vehicle tax refund of £104. To deposit it, visit the portal.'],
    ['USD', 'US', 'ACCTSVC', 'Your refund of $19.75 is now available. Visit the portal to finish.'],
    ['CAD', 'CA', 'ETRANSFER', 'Interac e-Transfer: CITY UTILITIES sent you a refund of $58.20. To deposit the funds, follow the steps in the portal.'],
    ['INR', 'IN', 'AD-EXCHX', 'Rs.9,800 is credited in your trading account. Install the app and verify details to receive the amount.'],
    ['INR', 'IN', 'AD-REFNDX', 'Rs 18,846 is Credited in your Demat Account. Download and withdraw it now.'],
    ['INR', 'IN', 'QP-GAMERX', 'Big bonus waiting! Make your first purchase of Rs. 99 using code START99. Hurry!'],
    ['USD', 'US', 'GIGWORK', 'Get paid $400 a week by placing our logo on your car.'],
    ['INR', 'IN', 'AD-SHOPKT', 'Your order for running shoes will be delivered tomorrow. Amount to be paid is Rs. 2,499.'],
    ['INR', 'IN', 'AD-SHOPKT', 'Thanks for your purchase of Rs. 640.00 from CRAFT CORNER! We will let you know when it ships.'],
    ['INR', 'IN', 'AD-SHOPKT', 'You have made a purchase of Rs 5,000 from KIRAN TRADERS. Click to pay: pay.example.in/k'],
    ['INR', 'IN', 'AD-CARDSX', 'To activate your new credit card, please confirm the following: Rs. 12,400 spent at ONLINE STORE on card ending 8821. To confirm please call 1800 000 000.'],
    ['INR', 'IN', 'AD-TATACD', "Rs.50,000.00 spent on your Example Card ending 4410 at KIRAN TRADERS. If this trx. wasn't done by you, click pay.example.in/x"],
    ['INR', 'IN', 'AD-SBIINB', 'Chq 004512 for INR 41,227.00 fvr GREEN TRUST recd in clg wl be paid if in order. If not issued by you call 1800 000 000.'],
    ['ZAR', 'ZA', 'FNBALERT', 'R 50.00 paid into your dormant account. Visit a branch before Friday to activate the account.'],
    // The order-number + callback rule on its own: a registered header, so
    // the unverified-sender rule is not what refuses it.
    ['USD', 'US', 'SHOPALERT', 'Your card was charged $1,249.00 for a 65-inch television. Order no. TV-55812. If this was not you, call 1-888-555-0199.'],
    ['USD', 'US', '', 'Your card was charged $1,249.00 for a 65-inch television. Order no. TV-55812. If this was not you, call 1-888-555-0199.'],
    // Lures added in round 8.
    ['USD', 'US', '', 'You are due to receive $640.00 from the settlement fund. Reply to this message to begin.'],
    ['GBP', 'GB', '', 'A refund of £212.90 has been credited for you. Please verify your details at the counter to release it.'],
    ['USD', 'US', '', 'Your refund of $19.75 is now available. Visit the portal to finish.'],
    ['INR', 'IN', 'AD-REFNDX', 'Rs 3,400 refund approved. Use the payment link to receive it in your bank.'],
    // Kaggle India: an upper-case activation code with a charge to pay in cash.
    ['INR', 'IN', 'AP-PAYBNK', 'Your Payments Bank savings a/c ACTIVATION CODE is: 552910. To continue opening the a/c, share this code with our agent. A one-time charge of Rs. 50 must be paid in cash to the agent.'],
  ]) {
    ok(`${cc}: lure wording is never auto-added — ${body.slice(0, 54)}…`, auto(currency, cc, body, 2, sender) === null,
      auto(currency, cc, body, 2, sender));
  }
  // (d) Genuine alerts that share words with those lures still auto-add.
  for (const [currency, cc, sender, body, type, minor] of [
    ['INR', 'IN', 'VM-EXBANK', 'Rs.45 paid at RIVERSIDE Toll Plaza for KA01AB1234 on 04-10-2026 08:10:11 with Example Bank FASTag. Bal Rs.320. Call 18000001234 for dispute', 'expense', 4500],
    ['CAD', 'CA', 'CIBC', 'INTERAC e-Transfer: JOHN SMITH sent you $50.00 and the money has been automatically deposited into your account ending 4410.', 'income', 5000],
    ['INR', 'IN', 'AD-PAYTMB', 'Paid Rs.120.00 to GREEN GROCERS. Order ID: 77120334. Updated Balance: Wallet Rs 880.00', 'expense', 12000],
    ['INR', 'IN', 'AD-ITDEPT', 'Refund of Rs 4,210 for AY 2026-27 has been credited to your A/c XX7781 on 03-10-2026.', 'income', 421000],
    ['INR', 'IN', 'AD-SBIINB', 'Rs. 3,200.00 credited to A/c XX5521 on 04-10-26 by NEFT from ACME PAYROLL. Avl Bal Rs 41,200.00', 'income', 320000],
    ['USD', 'US', 'CHASE', 'Chase: You made a $24.86 purchase at NORTH STAR MARKET with card ending 4421. If this was not you, call us.', 'expense', 2486],
    ['KES', 'KE', 'SANLAM_UT', 'Dear Member, your account for Fixed Income Fund has been credited with KES 5,000.00 as of 04 Oct, 2026.', 'income', 500000],
  ]) {
    const row = auto(currency, cc, body, 2, sender);
    ok(`${cc} control: a genuine alert still auto-adds — ${body.slice(0, 44)}…`,
      row?.bestEffort && row.type === type && row.amountFils === minor, row);
  }
  // (e) Round 8: a merchant name or a bank's own promo footer is not lure
  // wording. Each of these is a completed movement naming the own card or
  // account (or from a registered header) and auto-adds.
  for (const [currency, cc, sender, body, type, minor] of [
    ['USD', 'US', 'CHASE', 'Chase: You made a $38.20 purchase at HURRY CURRY OF OSAKA with card ending 5512.', 'expense', 3820],
    ['USD', 'US', 'CHASE', 'Chase: You made a $6.75 purchase at PAY NOW GARAGE with card ending 5512.', 'expense', 675],
    ['USD', 'US', 'CHASE', 'Chase: Direct deposit of $2,300.00 posted to account ending 5512. Get paid up to 2 days early with Chase.', 'income', 230000],
    ['USD', 'US', 'WELLSFARGO', 'Wells Fargo: A refund of $27.50 is available in account ending 5512.', 'income', 2750],
    ['CAD', 'CA', 'RBC', 'RBC: Purchase of $62.00 at CANADIAN TIRE on card ending 5512. If any dispute, call 1-800-000-0000.', 'expense', 6200],
    ['INR', 'IN', 'VM-ICICIB', 'Dear Customer, Acct XX552 is credited with Rs 12,000.00 on 06-Oct-26 from PRIYA. UPI:600125-ICICI Bank. Earn up to 7.25% on FD - apply now', 'income', 1200000],
    ['INR', 'IN', 'AD-ICICIB', 'INR 1,349.00 spent using ICICI Bank Card XX5520 on 06-Oct-26 on MYNTRA. Avl Limit: INR 52,000. Track your order on the Myntra app.', 'expense', 134900],
    ['INR', 'IN', 'VM-HDFCBK', 'Rs.3500 credited to a/c **5520 on 06-10-26 by payment link plink_q from CASHFREE', 'income', 350000],
    ['INR', 'IN', 'VM-SBIINB', 'Dear Customer, INR 4,000.00 credited to your A/c XX5520 on 06-10-26 by cash deposit at CDM. To deposit cash anytime use our CDM. -SBI', 'income', 400000],
    ['INR', 'IN', 'VM-HDFCBK', 'Rs.900.00 spent on HDFC Bank Card x5520 at ZOMATO on 06-10-26. Reward points will be added to your account. Not you? Call 1800 000 0000', 'expense', 90000],
  ]) {
    const row = auto(currency, cc, body, 2, sender);
    ok(`${cc}: a merchant name or promo footer is not lure wording — ${body.slice(0, 48)}…`,
      row?.bestEffort && row.type === type && row.amountFils === minor, row);
  }
  // The same advert words with no completed movement, no own tail, or as the
  // whole message, still refuse.
  for (const [currency, cc, sender, body] of [
    ['USD', 'US', 'GIGWORK', 'Get paid $400 a week by placing our logo on your car.'],
    ['INR', 'IN', 'QP-GAMERX', 'Big bonus waiting! Make your first purchase of Rs. 99 using code START99. Hurry!'],
    ['KES', 'KE', '+254711000555', 'You have received Ksh 7,700.00. Earn up to Ksh 20,000 weekly, apply now.'],
    ['INR', 'IN', 'AD-SHOPKT', 'Paid Rs 2,100 for order no. 55190. If you did not place it, call our helpline 9800000000.'],
    // A registered header does not excuse an advert dressed as a credit that
    // carries a link.
    ['INR', 'IN', 'VK-LOANAP', 'Rs.12,00,000 has been Credited to your account. To see it, apply now for your Personal Loan in our app: https://ln.example/a1'],
  ]) {
    ok(`${cc}: advert or order wording without an own completed movement still refuses — ${body.slice(0, 40)}…`,
      auto(currency, cc, body, 2, sender) === null, auto(currency, cc, body, 2, sender));
  }
  // "Received this message in error" is a mail footer, not the
  // sent-by-mistake scam.
  ok('"if you received this message in error" is not lure wording',
    policy.hasNonCompletedWording('You made a purchase on card ending in 2210 for $86.00 at HARBOUR HARDWARE. If you received this message in error, contact us.') === false);
  ok('"credited to you in error, send it back" is lure wording',
    policy.hasNonCompletedWording('Ksh 4,000 was credited to you in error. Please send it back to 0711000999.') === true);
  // Merchant masking never hides prose: a title-case "Hurry!" still counts.
  ok('a merchant descriptor is not wording, prose is', policy.hasNonCompletedWording('Paid $9.00 at HURRY CURRY with card ending 5512.') === false &&
    policy.hasNonCompletedWording('Hurry! Only a few seats left.') === true);
  // A payment link that is a lure, not a rail.
  ok('"use the payment link to receive" is lure wording', policy.hasNonCompletedWording('Use the payment link to receive your Rs 3,400.') === true);
  ok('"by payment link ... from RAZORPAY" is a rail, not a lure', policy.hasNonCompletedWording('Rs.2000 credited to a/c **4410 by payment link plink_x from RAZORPAY') === false);
  for (const sender of ['+254711000222', '0244 000 111', '29610101', 'alerts@wallet.example', 'INFO']) {
    ok(`"${sender}" is an unverified sender for a money claim`, policy.isUnverifiedAlertSender(sender) === true);
  }
  for (const sender of [undefined, '', '   ']) {
    ok(`a missing sender (${JSON.stringify(sender)}) is not an unverified one`, policy.isUnverifiedAlertSender(sender) === false);
  }
  for (const sender of ['MPESA', 'SG', 'SANLAM_UT', 'T-CASH', 'VM-HDFCBK', '8558', 'com.wallet.app']) {
    ok(`"${sender}" is a bank or wallet header, not a person`, policy.isUnverifiedAlertSender(sender) === false);
  }
}

/* ── Review, not silence: refused claims and refused bank credits ───── */
{
  const record = (id, text, sender) => JSON.stringify({ v: 1, id: id.repeat(64), text, ...(sender ? { sender } : {}),
    receivedAt: '2026-10-05T10:00:00.000Z' });
  const history = (currency, cc, text, sender) => {
    markets.setLedgerCurrency(currency, 2);
    const country = require('./build/country');
    country.setActiveCountry(cc);
    try {
      return parseHistoricalMessageRecords([record('a', text, sender)], {}, new Date('2026-10-10T08:00:00Z'), new Set(),
        createLaunchAlertSession({ overrides: {}, pinnedCurrency: currency, fxLookup: () => null, bestEffort: { enabled: true, country: cc } }));
    } finally { markets.setLedgerCurrency(null); country.setActiveCountry(null); }
  };
  const mpesa = 'QX81TR4KLM Confirmed. You have received Ksh 6,400.00 from PETER KAMAU 0711000333 on 4/10/26 at 9:15 AM. New M-PESA balance is Ksh 6,512.40.';
  const senderless = history('KES', 'KE', mpesa);
  ok('History: a senderless M-Pesa credit naming no own account waits in Review instead of being auto-added',
    senderless.parsed.length === 0 && senderless.reviewCandidates.length === 1, senderless);
  const fromPhone = history('KES', 'KE', mpesa, '+254711000222');
  ok('History: the same credit from a mobile number waits in Review instead of being dropped',
    fromPhone.parsed.length === 0 && fromPhone.reviewCandidates.length === 1, fromPhone);
  const fromWallet = history('KES', 'KE', mpesa, 'MPESA');
  ok('History control: the same credit from MPESA is added', fromWallet.parsed.length === 1, fromWallet);
  const linked = history('INR', 'IN', 'Your A/C XXXXX771204 is credited with INR 12,500.00 on 04/10/26 10:12. Your new balance is INR 40,210.55. Chat with us: examplebank.in/chat');
  // Parser fold of #151: a senderless credit on the own account tail keeps
  // a link footer with no call to action (the UCO "Report Dispute" shape).
  ok('History: a senderless bank credit on the own account keeps its link footer and is added, marked',
    linked.parsed.length === 1 && !!linked.parsed[0].bestEffort && linked.parsed[0].amountFils === 1250000, linked);
  {
    const uco = history('INR', 'IN', 'A/c XX8360 Credited with Rs.6.00 on 07-02-2024 by UCO-UPI.Avl Bal Rs.51.98. Report Dispute https://bit.ly/3y39tLP .For feedback https://rb.gy/fdfmda');
    ok('History: UCO "Report Dispute <link>" with no sender is added',
      uco.parsed.length === 1 && uco.parsed[0].type === 'income' && uco.parsed[0].amountFils === 600, uco);
    const bbk = history('BHD', 'BH', 'Your account BH19BBKUXXXXXXXXXXXX74 was credited by BHD975.000 from BH51BBMEXXXXXXXXXXXX20 for Fawri 001 on 16/02/2023 14:06 ref:LP SEF3013J5.For help 17207777');
    ok('History: a senderless BBK credit naming the own masked IBAN is not an unverified claim',
      bbk.parsed.length === 1 || bbk.reviewCandidates.length === 1, bbk);
  }
  const bait = history('INR', 'IN', 'Congrats, INR 30,000.00 Can Be Credited To Your Bank A/c. Check Now: lv.example/x', '+919800000000');
  ok('History: a refused "Can Be Credited" bait never becomes a Review card',
    bait.parsed.length === 0 && bait.reviewCandidates.length === 0, bait);
  const linkedClaim = history('INR', 'IN', 'Your wallet amount of Rs. 48,200 is credited to 98XXXXXX10. Sign up today: w4l.example/k2', '+919800000001');
  ok('History: a phone-number credit claim with a link never becomes a Review card',
    linkedClaim.parsed.length === 0 && linkedClaim.reviewCandidates.length === 0, linkedClaim);
  // Parser fold of #151: a senderless credit that names no own account or
  // card is never auto-added (it is the shape of a fake "you received" text).
  // One with a rail or bank word waits in Review; a bare one is not imported.
  {
    const pix = history('BRL', 'BR', 'Pix recebido de R$ 90,00 de MARINA SOUZA.');
    ok('History: a senderless Pix credit naming no own account waits in Review',
      pix.parsed.length === 0 && pix.reviewCandidates.length === 1, pix);
    const refund = history('USD', 'US', 'Refund of $35.00 from RIVER SHOES');
    ok('History: a bare senderless refund claim is never auto-added', refund.parsed.length === 0, refund);
  }
  // From a mobile number the same credits wait in Review.
  {
    const row = history('BRL', 'BR', 'Pix recebido de R$ 90,00 de MARINA SOUZA.', '+5511988887777');
    ok('History: a Pix credit claim from a mobile number waits in Review',
      row.parsed.length === 0 && row.reviewCandidates.length === 1, row);
  }
  // Senderless LURES are still refused by their wording or their link.
  for (const [currency, cc, text] of [
    ['USD', 'US', 'You are due to receive $640.00 from the settlement fund. Reply to this message to begin.'],
    ['GBP', 'GB', 'A refund of £212.90 has been credited for you. Please verify your details at the counter to release it.'],
    ['INR', 'IN', 'Congrats, INR 30,000.00 Can Be Credited To Your Bank A/c. Check Now: lv.example/x'],
    ['USD', 'US', 'You have received $820.00 from the rebate office. Details: rebate-desk.example/claim'],
    ['KES', 'KE', 'Confirmed. You have received Ksh 9,000 from PAUL. Kindly send it back, it was a mistake. Call 0711000999'],
  ]) {
    const row = history(currency, cc, text);
    ok(`History: a senderless lure is never auto-added — ${text.slice(0, 36)}`, row.parsed.length === 0, row);
  }
  // A personal chat is not a bank alert, even from a phone number with a
  // "you received" line in it: neither added nor a Review card.
  for (const [currency, cc, text, sender] of [
    ['KES', 'KE', 'Hi Ann, you received Ksh 3,000 from me? I sent it at lunch', '+254722000111'],
    ['USD', 'US', 'Did you get it? You received $60 from me on Venmo', '+12025550190'],
    ['USD', 'US', 'The neighbour refunded $120 of the party money today!', '+12025550190'],
  ]) {
    const row = history(currency, cc, text, sender);
    ok(`History: a personal chat is neither added nor reviewed — ${text.slice(0, 30)}`,
      row.parsed.length === 0 && row.reviewCandidates.length === 0, row);
  }
  // Item 4: a registered wallet header's completed payment refused only by an
  // order-callback footer reaches Review instead of being dropped.
  {
    const row = history('INR', 'IN', 'Rs.350 paid to Zomato from Paytm wallet. Order ID: 4471. Need help? Contact 24x7 Helpline', 'VM-PAYTMB');
    ok('History: a registered wallet payment refused only for its order footer waits in Review',
      row.parsed.length === 0 && row.reviewCandidates.length === 1, row);
  }
  // Known trade-off (documented): a bank that alerts from a full phone
  // number, with no own account tail, reaches Review, not the ledger.
  {
    const row = history('EUR', 'LV', '410 EUR received from MARIJA OZOLA. Notification from Examplebank', '29610101');
    ok('History: a bank credit from a full phone number with no own tail waits in Review (trade-off)',
      row.parsed.length === 0 && row.reviewCandidates.length === 1, row);
  }
  {
    const row = history('PKR', 'PK', 'TID 55120077. You have received Rs. 4,200.00 from SANA IQBAL. Your new wallet balance is Rs. 4,310.00. Get paid instantly with JazzCash.', '8558');
    ok('History: a short-code wallet credit with a "Get paid" footer is auto-added',
      row.parsed.length === 1 && !!row.parsed[0].bestEffort && row.parsed[0].amountFils === 420000, row);
  }
  {
    const row = history('GBP', 'GB', "You've paid £58.00 to Amazon. Order ID 204-7781234. If you did not make this payment, call us on 0345 000 0000.", 'HSBC');
    ok('History: a registered-bank payment with an order number and callback (no card tail) waits in Review',
      row.parsed.length === 0 && row.reviewCandidates.length === 1, row);
  }
}

/* ── Fold re-review: a PAYER's account or card is not the reader's own ── */
{
  const country = require('./build/country');
  const OBSERVED = Date.parse('2026-10-03T08:00:00Z');
  const worldwide = (sender, body) => {
    markets.setActiveMarket('ZZ');
    markets.setLedgerCurrency('USD', 2);
    country.setActiveCountry('US');
    const s = createLaunchAlertSession({ overrides: {}, regionHint: 'US', fxLookup: () => null,
      bestEffort: { enabled: true, country: 'US' } });
    try { return s.parse(body, sender, s.inspect(body, sender), undefined, OBSERVED); }
    finally { markets.setLedgerCurrency(null); country.setActiveCountry(null); markets.setActiveMarket('AE'); }
  };
  for (const sender of ['', '+15551234567']) {
    for (const body of [
      'You have received USD 5,000.00 from account XXXX9876 of JOHN',
      'Transfer of USD 5,000.00 credited from card 1234 holder JOHN',
    ]) {
      ok(`a credit naming only the PAYER's account/card is not auto-added from "${sender}" — ${body.slice(0, 44)}`,
        worldwide(sender, body) === null, worldwide(sender, body));
    }
  }
  ok('the payer word decides only on a credit: "paid from cheq a/c..123456" is the own account',
    policy.namesOwnInstrumentTail('paid from cheq a/c..123456 @ store', 'debit'));
  ok('…and "from account XXXX9876" on a credit is the payer\'s',
    !policy.namesOwnInstrumentTail('You have received USD 5,000.00 from account XXXX9876 of JOHN', 'credit'));
  ok('a field-labelled destination "To: **1234" names the own account',
    policy.namesOwnInstrumentTail('Incoming Transfer\nAmount: 500 SAR\nTo: **1234\nFrom: AHMED', 'credit'));
  {
    // Real (west corpus, ZKB, phone sender): "Your card" earlier makes the
    // later "Visa Debit card no. xxxx 5387" the reader's own card.
    const zkb = 'online@zkb.ch Your card has been credited CHF 32.70 Refund ZKB Visa Debit card no. xxxx 5387, digitec Galaxus (Online).';
    ok('a credit whose text first says "Your card" names that own card by its later tail',
      policy.namesOwnInstrumentTail(zkb, 'credit'));
    ok('…but "Your account" earlier never makes a payer\'s "from account XXXX9876" own',
      !policy.namesOwnInstrumentTail('Your account has been credited USD 5,000.00 from account XXXX9876 of JOHN', 'credit'));
  }
  const control = worldwide('', 'USD 5,000.00 has been credited to your account XXXX1234 from JOHN.');
  ok('control: a senderless credit to "your account XXXX1234" still auto-adds',
    control?.type === 'income' && control.amountFils === 500000, control);
}

console.log(`\nbest-effort-autopost: ${pass} passed, ${fail} failed`);
if (fail > 0) process.exit(1);
