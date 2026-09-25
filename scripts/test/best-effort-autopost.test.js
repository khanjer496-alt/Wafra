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
  ok('iOS live capture builds its sessions with the policy disabled',
    /createLaunchAlertSession\(\{[\s\S]{0,300}?bestEffort: \{ enabled: false, country: null \}/.test(read('src/lib/ios-local-capture.ts')) &&
      !/parseUnproven/.test(read('src/lib/ios-local-capture.ts')) && !/parseUnproven/.test(read('src/lib/local-message-record.ts')));
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
    /certification\?\.decision === 'semantic-generalized' && universalEvent\s*\?\s*decideBestEffortAutoPost/.test(autoImport));
  ok('a certified template reading never carries the marker',
    /launchParsed\?\.bestEffort && certification\?\.decision === 'automatic'/.test(autoImport));
}

console.log(`\nbest-effort-autopost: ${pass} passed, ${fail} failed`);
if (fail > 0) process.exit(1);
