// Brazil, Colombia, Mexico and Peru: market packs, routing, money shapes,
// exact per-bank templates and the never-post cases (fixtures/latam-alert-fixtures.js).
//
// The posting rule under test (docs/universal-parser-rollout.md, "LatAm
// authorisation-time templates"): approval wording ("APROVADA", "Aprobado(a)")
// may count as posted only inside one bank's exact template that also carries a
// masked card or account, and only with no negation, confirmation, pending,
// hold, decline, code, loan, offer or promotion wording. Everything else keeps
// the existing behaviour (refuse or Review).

const fixtures = require('./fixtures/latam-alert-fixtures');
const uaeFixtures = require('./fixtures/uae-bank-formats');
const saudiFixtures = require('./fixtures/saudi-bank-formats');
const publicEvidence = require('./fixtures/public-alert-evidence');
const templates = require('./build/latam-alert-templates');
const { routeAlertMarket, inferCaptureMarket } = require('./build/alert-market-detection');
const { inspectAlertInstitutionGrammar } = require('./build/alert-institution-grammars');
const { alertMarketPack } = require('./build/alert-market-packs');
const { extractUniversalMoney } = require('./build/universal-money');
const { inspectUniversalBankEvent } = require('./build/universal-parser');
const { certifyUniversalTemplate } = require('./build/universal-template-certification');
const { createLaunchAlertSession } = require('./build/launch-alert-parser');
const { decideBestEffortAutoPost, setBestEffortAutoPostEnabled } = require('./build/best-effort-autopost');
const { inspectSourceFreeRefusedAlert, shouldReviewParsedIncome } = require('./build/auto-import');
const { buildImportPlan } = require('./build/import-plan');
const { ledgerMoneySpec } = require('./build/ledger-money');
const markets = require('./build/markets');
const country = require('./build/country');

let pass = 0;
let fail = 0;
const ok = (name, condition, detail) => {
  if (condition) { pass += 1; console.log(`✓ ${name}`); }
  else { fail += 1; console.log(`✗ ${name}`, detail === undefined ? '' : JSON.stringify(detail)); }
};

setBestEffortAutoPostEnabled(true);
const OBSERVED = Date.parse('2026-10-10T08:00:00Z');
const LEDGER = { BR: 'BRL', CO: 'COP', MX: 'MXN', PE: 'PEN' };

/**
 * The Android SMS-inbox decision for a person in `cc` with a ledger in that
 * country's currency: unproven-format posting first, then the refusal/Review
 * policy. This is the same sequence capture runs.
 */
function smsDecision(body, cc, { sender = '', ledger = LEDGER[cc] ?? null, userCountry = cc } = {}) {
  markets.setActiveMarket('ZZ');
  markets.setLedgerCurrency(ledger, 2);
  country.setActiveCountry(userCountry);
  try {
    const session = createLaunchAlertSession({
      overrides: {}, regionHint: null, pinnedCurrency: ledger, activeMarket: 'ZZ',
      fxLookup: () => null, bestEffort: { enabled: true, country: userCountry },
    });
    const inspection = session.inspect(body, sender);
    const parsed = session.parseUnproven(body, sender, inspection, OBSERVED);
    const refusal = !parsed || shouldReviewParsedIncome(parsed)
      ? inspectSourceFreeRefusedAlert({
          source: body, sender, observedAt: OBSERVED, channel: 'inbox', session, existingInspection: inspection,
        })
      : null;
    const reviewed = refusal?.kind === 'review';
    return { parsed: parsed && !reviewed ? parsed : null, refusal, inspection };
  } finally {
    markets.setLedgerCurrency(null);
    country.setActiveCountry(null);
    markets.setActiveMarket('AE');
  }
}

const count = (n) => fixtures.filter((row) => row.n === n).length;
ok('fixtures cover every SPEC §6 number except the Banorte rows kept in public evidence (45-47) and the suite-level 87-88',
  Array.from({ length: 86 }, (_, i) => i + 1).filter((n) => ![45, 46, 47].includes(n)).every((n) => count(n) > 0),
  Array.from({ length: 86 }, (_, i) => i + 1).filter((n) => ![45, 46, 47].includes(n) && count(n) === 0));
ok('every fixture records provenance, institution field, channel and held-out split, and none is consented-redacted',
  fixtures.every((row) => ['synthetic', 'community-derived'].includes(row.provenance) &&
    'institution' in row && typeof row.channel === 'string' && row.heldOut === false));
ok('fixtures contain no links except the phishing shapes, and no real-looking card numbers',
  fixtures.every((row) => !row.body || row.category === 'phishing' || !/https?:\/\/|www\./iu.test(row.body)) &&
    fixtures.every((row) => !row.body || !/\b\d{13,19}\b/u.test(row.body)));

/* ── packs ─────────────────────────────────────────────────────────────── */
ok('CO pack: COP with a routed $ alias and Colombian rails',
  alertMarketPack('CO').currencies.join() === 'COP' && alertMarketPack('CO').currencyAliases.$.join() === 'COP' &&
    ['bre-b', 'pse', 'transfiya'].every((rail) => alertMarketPack('CO').rails.includes(rail)));
ok('PE pack: PEN with S/ and S/. and Peruvian rails',
  alertMarketPack('PE').currencies.join() === 'PEN' && alertMarketPack('PE').currencyAliases['S/'].join() === 'PEN' &&
    alertMarketPack('PE').currencyAliases['S/.'].join() === 'PEN' &&
    ['yape', 'plin', 'cci'].every((rail) => alertMarketPack('PE').rails.includes(rail)));
ok('Colombia and Peru read numeric dates day-first through country.ts',
  country.dateOrderForCountry('CO') === 'DMY' && country.dateOrderForCountry('PE') === 'DMY' &&
    country.dateOrderForCountry('MX') === 'DMY' && country.dateOrderForCountry('BR') === 'DMY');

/* ── 1-10 money ────────────────────────────────────────────────────────── */
const PARSERS = { cop: templates.parseCopFigure, mxn: templates.parseMxnFigure, pen: templates.parsePenFigure, brl: templates.parseBrlFigure };
for (const row of fixtures.filter((item) => item.kind === 'money')) {
  if (row.figure) {
    const parsed = PARSERS[row.parser](row.figure);
    const got = parsed === 'conflict' ? 'conflict' : parsed.minor.toString();
    ok(`#${row.n} ${row.parser.toUpperCase()} "${row.figure}" reads ${row.minor}`, got === row.minor, got);
    continue;
  }
  // A routed alert reads `$` / `S/.` through its own market pack's aliases.
  const extracted = extractUniversalMoney(row.body, row.market
    ? { market: row.market, currencyAliases: alertMarketPack(row.market).currencyAliases } : {});
  const value = extracted.amount.value;
  if (row.currency === null) {
    ok(`#${row.n} a bare figure with no route is not money: ${row.body}`,
      extracted.amount.evidence === 'missing' && extracted.draft.candidates.length === 0, extracted.amount);
  } else if (row.currency === 'USD') {
    const readings = [...(value ? [value] : []), ...extracted.amount.alternatives];
    ok(`#${row.n} US$ in a Peruvian alert is dollars, never PEN: ${row.body}`,
      readings.some((money) => money.currency === 'USD' && money.minorUnits === row.minor) &&
        readings.every((money) => money.currency !== 'PEN'), extracted.amount);
  } else {
    ok(`#${row.n} ${row.market}-routed universal reader: ${row.body}`,
      value?.currency === row.currency && value?.minorUnits === row.minor && value?.exponent === 2, extracted.amount);
  }
}
{
  // A Mexican route never turns the Colombian shape into pesos of either size.
  const event = inspectUniversalBankEvent('Retiraste $45.000 en Cajero Automático', { market: 'MX', sender: 'BBVA MEXICO' });
  ok('#7 an MX-routed "$45.000" goes to Review with a format conflict',
    event.decision === 'review' && event.status !== 'posted' && event.amount.evidence !== 'explicit' &&
      event.issues.includes('amount-format-conflict'), event);
  const generic = inspectUniversalBankEvent('Compra realizada con tarjeta por $45.000 en TIENDA DEMO', { market: 'MX' });
  const decision = decideBestEffortAutoPost({
    source: 'Compra realizada con tarjeta por $45.000 en TIENDA DEMO', event: generic, enabled: true, country: 'MX',
    routedMarket: 'MX', ledgerCurrency: 'MXN', ledgerExponent: 2, observedAt: OBSERVED,
  });
  ok('#7 amount shape may only block: a generic MX alert printing "$45.000" never auto-posts',
    decision.outcome === 'review', { decision, amount: generic.amount, status: generic.status });
  const sub50 = templates.matchLatamTemplate('Bancolombia: Compraste $45 en TIENDA DEMO con tu T.Cred *1234, el 02/10/2026 a las 09:15.');
  ok('a Colombian card purchase under 50 pesos is a mangled "45.000": Review, not posted',
    sub50?.status === 'unknown' && sub50.amountIssue === 'amount-implausible', sub50);
  const bareNu = templates.matchLatamTemplate('BANCO DEMO te envió 2.653.381,00.');
  ok('#10 the Nu Colombia bare amount is not COP without Nu Colombia identity', bareNu === null, bareNu);
}

/* ── 11-21 routing ─────────────────────────────────────────────────────── */
for (const row of fixtures.filter((item) => item.kind === 'route')) {
  const route = routeAlertMarket({ source: row.body, sender: row.sender });
  if (row.market) {
    ok(`#${row.n} routes single ${row.market}: ${row.body}`, route.decision === 'single' && route.market === row.market, route);
  }
  if (row.notMarkets) {
    ok(`#${row.n} never routes ${row.notMarkets.join('/')}: ${row.body}`,
      !(route.decision === 'single' && row.notMarkets.includes(route.market)), route);
  }
  if (row.candidate) {
    ok(`#${row.n} currency-backed ${row.candidate} candidate: ${row.body}`,
      route.candidates.some((c) => c.market === row.candidate && c.evidence.includes('currency')), route);
  }
}
{
  const [capture] = fixtures.filter((item) => item.kind === 'capture');
  const resolved = inferCaptureMarket({ regionHint: null, alerts: capture.alerts });
  const duplicate = inferCaptureMarket({ regionHint: null, alerts: [capture.alerts[0], capture.alerts[0]] });
  ok('#21 two independent consistent Colombian alerts resolve the capture market; a duplicate stays provisional',
    resolved.market === 'CO' && resolved.decision === 'resolved' &&
      duplicate.market === 'CO' && duplicate.decision === 'provisional', { resolved, duplicate });
  const shortCode = inspectAlertInstitutionGrammar('Compra aprobada por $45.000 en TIENDA DEMO', 'CO', '85540');
  ok('a shared numeric short code is not issuer evidence without the bank in the body',
    shortCode.decision === 'unknown', shortCode);
  const agreeing = inspectAlertInstitutionGrammar('Bancolombia: Compraste $45.000 en TIENDA DEMO', 'CO', '85540');
  ok('a shared numeric short code agrees with a body that names the bank',
    agreeing.institution === 'bancolombia' && agreeing.candidates[0].evidence.includes('sender'), agreeing);
  ok('BBVA Perú and Banco Santander México are not Spanish issuer evidence',
    inspectAlertInstitutionGrammar('BBVA Perú: transferencia de S/ 50.00', 'ES').decision === 'unknown' &&
      inspectAlertInstitutionGrammar('BANCO SANTANDER MEXICO: compra $50.00', 'ES').decision === 'unknown');
  ok('Santander and Mercado Pago are Brazilian only next to R$',
    inspectAlertInstitutionGrammar('Santander: Compra aprovada de R$ 95,00', 'BR').institution === 'santander-brasil' &&
      inspectAlertInstitutionGrammar('Santander: compra por $95.00', 'BR').decision === 'unknown' &&
      inspectAlertInstitutionGrammar('Mercado Pago: pagaste $45.000', 'BR').decision === 'unknown');
}

/* ── 22-70 posting templates ───────────────────────────────────────────── */
for (const row of fixtures.filter((item) => item.kind === 'post')) {
  const { expect } = row;
  const { parsed } = smsDecision(row.body, row.market, { sender: row.sender });
  const label = `#${row.n} ${row.id}`;
  ok(`${label}: posts ${expect.type} ${LEDGER[row.market]} ${expect.minor}`,
    !!parsed && parsed.kind === 'transaction' && parsed.type === expect.type && parsed.currency === LEDGER[row.market] &&
      parsed.amountFils === expect.minor && !!parsed.transferHint === expect.transfer,
    parsed && { type: parsed.type, currency: parsed.currency, amountFils: parsed.amountFils, transferHint: parsed.transferHint });
  if (!parsed) continue;
  ok(`${label}: carries the "Auto-added — check" marker (community/synthetic evidence)`,
    parsed.bestEffort?.market === row.market && parsed.bestEffort.format === `universal:${expect.family}:${expect.direction}`,
    parsed.bestEffort);
  if (expect.merchant) ok(`${label}: merchant "${expect.merchant}"`, parsed.merchant === expect.merchant, parsed.merchant);
  if (expect.family === 'transfer') {
    ok(`${label}: a transfer keeps its structural title, never a person's name`,
      ['Incoming transfer', 'Outgoing transfer', 'Salary'].includes(parsed.merchant), parsed.merchant);
  }
  if (expect.last4) ok(`${label}: card/account •${expect.last4}`, parsed.card?.last4 === expect.last4, parsed.card);
  if ('date' in expect) ok(`${label}: date ${expect.date}`, parsed.date === expect.date, parsed.date);
  if (expect.category) ok(`${label}: category ${expect.category}`, parsed.categoryGuess === expect.category, parsed.categoryGuess);
  if (expect.receiptCode) {
    ok(`${label}: Yape's receipt check is never stored`, !String(parsed.raw).includes(expect.receiptCode) &&
      !/c[óo]d/iu.test(String(parsed.raw)), parsed.raw);
  }
  // The notification path: an identified institution certifies the template.
  const event = inspectUniversalBankEvent(row.body, { market: row.market, sender: row.sender });
  const certification = certifyUniversalTemplate({
    market: row.market, institution: row.institution, source: row.body, event,
  });
  ok(`${label}: certified as ${row.template} when the router identified ${row.institution}`,
    certification.decision === 'automatic' && certification.templateId === row.template, certification);
  if (expect.receiptCode) {
    ok(`${label}: the receipt code never reaches the event`, !JSON.stringify(event).includes(expect.receiptCode));
  }
}
{
  const nubank = fixtures.find((row) => row.id === 'br-nubank-purchase');
  const event = inspectUniversalBankEvent(nubank.body, { market: 'BR' });
  const certification = certifyUniversalTemplate({ market: 'BR', institution: null, source: nubank.body, event });
  ok('a template the body alone matches is not issuer proof for unmarked certification',
    certification.decision !== 'automatic', certification);
  const wrongBank = certifyUniversalTemplate({ market: 'BR', institution: 'itau-brasil', source: nubank.body, event });
  ok('a template certifies only for its own institution', wrongBank.decision !== 'automatic', wrongBank);
  const unidentifiedNequi = smsDecision('Enviaste $40.000 a ANA PRUEBA', 'CO');
  ok('a "$" template that needs issuer identity does not post without it',
    unidentifiedNequi.parsed === null, unidentifiedNequi.parsed);
}

/* ── review-only templates and issuers ─────────────────────────────────── */
for (const row of fixtures.filter((item) => item.kind === 'review')) {
  const decision = smsDecision(row.body, row.market, { sender: row.sender });
  const candidate = decision.refusal?.kind === 'review' ? decision.refusal.candidate : null;
  const value = candidate?.event?.amount?.value ?? candidate?.event?.amount?.alternatives?.[0] ?? null;
  ok(`#${row.n} ${row.id}: Review, never posted`,
    decision.parsed === null && candidate?.kind === 'universal' && candidate.event.status !== 'posted' &&
      candidate.event.family === row.expect.family && candidate.event.direction === row.expect.direction &&
      value?.minorUnits === row.expect.minor && value?.currency === LEDGER[row.market],
    { parsed: decision.parsed, refusal: decision.refusal });
}

/* ── 71-86 never post ──────────────────────────────────────────────────── */
const neverCategories = new Set();
for (const row of fixtures.filter((item) => item.kind === 'never')) {
  neverCategories.add(row.category);
  for (const [cc, userCountry] of [[row.market, row.market], [row.market, null]]) {
    const { parsed } = smsDecision(row.body, cc, { sender: row.sender, userCountry });
    ok(`#${row.n} ${row.id} (${row.category}) never posts${userCountry ? '' : ' without a user country'}`, parsed === null,
      parsed && { type: parsed.type, amountFils: parsed.amountFils, currency: parsed.currency });
  }
  const event = inspectUniversalBankEvent(row.body, { market: row.market, sender: row.sender });
  const certification = certifyUniversalTemplate({ market: row.market, institution: null, source: row.body, event });
  const institution = inspectAlertInstitutionGrammar(row.body, row.market, row.sender).institution;
  const certified = certifyUniversalTemplate({ market: row.market, institution, source: row.body, event });
  ok(`#${row.n} ${row.id}: no template certification`, certification.decision !== 'automatic' && certified.decision !== 'automatic',
    { certification, certified });
}
ok('never-post categories cover OTP, declines, bills, balances, loans, promos, orders, investments, phishing, zero amounts, confirmations, requests, scheduled and pending',
  ['otp', 'decline', 'bill', 'balance', 'loan', 'promo', 'order', 'investment', 'phishing', 'zero', 'confirmation', 'request',
    'scheduled', 'pending', 'approval-outside-template', 'review-only-issuer'].every((category) => neverCategories.has(category)),
  [...neverCategories]);
{
  const usDollar = smsDecision('Chase Bank: Card purchase $20.00 at SAMPLE SHOP was charged.', 'CO', { sender: 'CHASE' });
  ok('#wrong-market a US alert\'s "$" never becomes COP on a Colombian ledger',
    usDollar.parsed === null || usDollar.parsed.currency !== 'COP' || usDollar.parsed.originalCurrency === 'USD', usDollar.parsed);
  const unrouted = smsDecision('Compraste $45.000 en TIENDA DEMO con tu tarjeta', 'CO', { userCountry: null });
  ok('#wrong-market a "$" with no route and no user country never posts', unrouted.parsed === null, unrouted.parsed);
  const yapeCode = templates.matchLatamTemplate('Yape! ANA PRUEBA te envió un pago por S/ 35. El cód. de seguridad es: 482');
  ok('the Yape exemption removes only the receipt clause from what guards and storage see',
    yapeCode?.status === 'posted' && !yapeCode.policySource.includes('482') && yapeCode.policySource.startsWith('Yape! ANA PRUEBA'),
    yapeCode);
  const mpFuture = templates.matchLatamTemplate('Você pagou R$ 12,40 a TRANSPORTE DEMO - O valor vai entrar na próxima fatura do seu Cartão Mercado Pago.');
  ok('"próxima fatura" names the card bill a posted purchase lands on; it is not a future charge',
    mpFuture?.status === 'posted' && mpFuture.family === 'purchase', mpFuture);
}

/* ── 87 Bancolombia cash advance + matching transfer-in ────────────────── */
{
  const advanceBody = fixtures.find((row) => row.id === 'co-bancolombia-cash-advance').body;
  const receiptBody = fixtures.find((row) => row.id === 'co-bancolombia-transfer-in').body;
  const advance = smsDecision(advanceBody, 'CO').parsed;
  const receipt = smsDecision(receiptBody, 'CO').parsed;
  ok('#87 both legs of a cash advance read as transfers of the same amount',
    advance?.transferHint === true && receipt?.transferHint === true && advance.amountFils === receipt.amountFils &&
      advance.type === 'expense' && receipt.type === 'income', { advance, receipt });
  if (advance && receipt) {
    const state = {
      hydrated: true, accounts: [], transactions: [], budgets: [], bills: [], goals: [], cardDues: [],
      accountHints: {}, merchantOverrides: {}, billAliases: {}, lastScanTs: 0, parserVersion: 0,
      ledgerMoney: ledgerMoneySpec('COP'),
    };
    const rows = [
      { ...advance, smsTs: OBSERVED - 60_000, sender: 'BANCOLOMBIA', channel: 'inbox' },
      { ...receipt, smsTs: OBSERVED, sender: 'BANCOLOMBIA', channel: 'inbox' },
    ].map(({ raw: _raw, ...row }) => row);
    markets.setActiveMarket('ZZ');
    markets.setLedgerCurrency('COP', 2);
    try {
      const plan = buildImportPlan(rows, state, OBSERVED, new Date(OBSERVED));
      const income = plan.batch.transactions.filter((tx) => tx.type === 'income' && !tx.isTransfer);
      ok('#87 the advance never double-books as income: both planned rows are transfers',
        plan.batch.transactions.length === 2 && plan.batch.transactions.every((tx) => tx.isTransfer === true) && income.length === 0,
        plan.batch.transactions.map((tx) => ({ type: tx.type, isTransfer: tx.isTransfer, amountFils: tx.amountFils })));
      const again = buildImportPlan(rows, { ...state, transactions: plan.batch.transactions.map((tx, i) => ({ ...tx, id: `tx${i}` })) },
        OBSERVED, new Date(OBSERVED));
      ok('#87 rescanning the same pair adds nothing (import duplicate guard)', again.txCount === 0, again.txCount);
    } finally {
      markets.setLedgerCurrency(null);
      markets.setActiveMarket('AE');
    }
  }
}

/* ── 88 launch markets and known gaps are untouched ────────────────────── */
{
  const launchBodies = [...uaeFixtures, ...saudiFixtures].map((row) => row.body).filter(Boolean);
  ok(`#88 no UAE/Saudi fixture (${launchBodies.length}) matches a LatAm template or a review-only LatAm issuer`,
    launchBodies.every((body) => templates.matchLatamTemplate(body) === null && !templates.isReviewOnlyLatamInstitution(body)),
    launchBodies.find((body) => templates.matchLatamTemplate(body) || templates.isReviewOnlyLatamInstitution(body)));
  const banorte = publicEvidence.filter((row) => row.id.startsWith('mx-banorte-'));
  ok('Banorte heading templates match no LatAm template and stay pinned known gaps',
    banorte.length === 3 && banorte.every((row) => row.knownGap?.decision === 'refuse' &&
      templates.matchLatamTemplate(row.body, { sender: row.sender }) === null));
  const itau = publicEvidence.find((row) => row.id === 'br-itau-purchase-sms');
  ok('the Itaú heading with no masked card stays a pinned known gap',
    itau?.knownGap?.decision === 'refuse' && templates.matchLatamTemplate(itau.body) === null);
}

console.log(`\nlatam-alert-packs: ${pass} passed, ${fail} failed · ${fixtures.length} fixtures`);
process.exit(fail ? 1 : 0);
