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
  // Worldwide card statements become the card's bill; card payments settle it.
  {
    // A statement naming no card number is still a card statement; the import
    // planner attaches it only to the one eligible card (as on the Gulf path).
    const cardless = worldwide('USD', 'US', '24273', 'Chase: Your credit card statement is ready. Statement balance $1,234.56, minimum payment $35.00 due 10/25/2026.');
    ok('a cardless credit-card statement is a statement, never spending',
      cardless?.kind === 'cardStatement' && cardless.card === null && cardless.amountFils === 123456 && cardless.type === 'expense', cardless);
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

console.log(`\nbest-effort-autopost: ${pass} passed, ${fail} failed`);
if (fail > 0) process.exit(1);
