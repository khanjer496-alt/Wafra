// Learned bank formats, wired end to end (src/lib/learned-format-capture.ts):
// learning drafts made at capture time, Review confirmation → template,
// 1 confirmation → "Recognised format" Review prefill, 2 → auto-add with the
// learned marker, undo/confirm, AE/SA refusals, near misses, the tray and
// backup validation. Runs on the compiled build (scripts/test/build.sh).
const assert = require('node:assert/strict');
const test = require('node:test');
const B = './build/';
const L = require(`${B}learned-alert-formats`);
const C = require(`${B}learned-format-capture`);
const { createLaunchAlertSession } = require(`${B}launch-alert-parser`);
const { inspectSourceFreeRefusedAlert } = require(`${B}auto-import`);
const { parseHistoricalMessageRecords } = require(`${B}historical-import`);
const { normalizeAlertReviewTray } = require(`${B}alert-review-tray`);
const { isValidBackupState } = require(`${B}backup-validation`);
const country = require(`${B}country`);
const markets = require(`${B}markets`);
const i18n = require(`${B}i18n`);

const OBS = Date.parse('2026-09-04T10:00:00Z');
const SENDER = 'ZETABNK';
// No parser posts this shape and the generic reader cannot tell its direction:
// it reaches Review with the amount, merchant and date filled in.
const msg = (amount, merchant, day = '03', card = '4421') =>
  `Zeta Bank: USD ${amount} moved on card ending ${card} at ${merchant} on 09/${day}/2026.`;
const FIRST = msg('24.86', 'NORTH STAR MARKET');
const SECOND = msg('5.00', 'TARGET 0001', '04', '1234');
const THIRD = msg('1,205.10', 'SQ *BLUE BOTTLE COFFEE', '04', '9912');

const setUser = (code = 'US', ledger = 'USD') => {
  country.setActiveCountry(code);
  markets.setActiveMarket('ZZ');
  markets.setLedgerCurrency(ledger, ledger === 'KWD' ? 3 : 2);
};
const reset = (store = L.emptyLearnedFormatStore(), extra = {}) =>
  C.setLearnedFormatCaptureState({ store, autoPost: true, privateMode: false, ...extra });
const session = (extra = {}) => createLaunchAlertSession({
  overrides: {}, pinnedCurrency: 'USD', fxLookup: () => null, bestEffort: { enabled: true, country: 'US' }, ...extra,
});
const refusal = (source, sender = SENDER, s = session()) =>
  inspectSourceFreeRefusedAlert({ source, sender, observedAt: OBS, channel: 'inbox', session: s });
const confirm = (store, candidate, direction = 'debit', date) => C.learnedStoreAfterConfirmation(store, candidate, {
  direction,
  amount: candidate.event.amount.value,
  date: date ?? candidate.event.transactionDate.value,
}, OBS);
/** Learn FIRST (1 confirmation), optionally SECOND too (2). */
const learned = (times = 1) => {
  reset();
  let store = L.emptyLearnedFormatStore();
  for (const source of [FIRST, SECOND].slice(0, times)) {
    const decision = refusal(source);
    assert.equal(decision.kind, 'review', 'the unrecognised alert reaches Review');
    store = confirm(store, decision.candidate);
    assert.ok(store, 'confirmation learns');
    reset(store);
  }
  return store;
};

test.beforeEach(() => { setUser(); reset(); });
test.after(() => { markets.setLedgerCurrency(null); reset(); });

test('an unrecognised Review item carries a source-free learning draft', () => {
  const decision = refusal(FIRST);
  assert.equal(decision.kind, 'review');
  const { candidate } = decision;
  assert.equal(candidate.suggestedBy, undefined, 'an ordinary reading is not labelled');
  assert.ok(candidate.learn, 'draft attached');
  const text = JSON.stringify(candidate.learn);
  for (const secret of ['24.86', '2486', '4421', 'NORTH STAR', 'north star']) {
    assert.ok(!text.includes(secret), `draft never holds "${secret}"`);
  }
  assert.ok(L.validateLearnedTemplate(candidate.learn), 'draft passes restore validation');
});

test('Private Mode makes no learning drafts', () => {
  reset(L.emptyLearnedFormatStore(), { privateMode: true });
  const decision = refusal(FIRST);
  assert.equal(decision.kind, 'review');
  assert.equal(decision.candidate.learn, undefined);
});

test('one confirmation pre-fills the next alert of that shape as "Recognised format"', () => {
  learned(1);
  const decision = refusal(THIRD);
  assert.equal(decision.kind, 'review');
  assert.equal(decision.candidate.suggestedBy, 'learned');
  const { event } = decision.candidate;
  assert.deepEqual(event.amount.value, { currency: 'USD', minorUnits: '120510', exponent: 2 });
  assert.equal(event.merchant.value, 'SQ *BLUE BOTTLE COFFEE');
  assert.equal(event.transactionDate.value, '2026-09-04');
  assert.equal(event.direction, 'debit', 'the confirmed direction');
  assert.deepEqual(event.instrument.value, { kind: 'card', last4: '9912' });
  assert.ok(decision.candidate.learn, 'confirming it counts toward the template');
  // One confirmation never posts.
  const s = session();
  assert.equal(s.parseUnproven(THIRD, SENDER, s.inspect(THIRD, SENDER), OBS), null);
});

test('two consistent confirmations auto-add with the learned marker (Android path and History path)', () => {
  const store = learned(2);
  assert.equal(store.templates.length, 1);
  assert.equal(store.templates[0].confirmations, 2);
  const s = session();
  const row = s.parseUnproven(THIRD, SENDER, s.inspect(THIRD, SENDER), OBS);
  assert.ok(row, 'posted');
  assert.equal(row.kind, 'transaction');
  assert.equal(row.type, 'expense');
  assert.equal(row.amountFils, 120510);
  assert.equal(row.currency, 'USD');
  assert.equal(row.merchant, 'SQ *BLUE BOTTLE COFFEE');
  assert.equal(row.date, '2026-09-04');
  assert.deepEqual(row.card, { last4: '9912', kind: 'unknown' });
  assert.equal(row.bestEffort.format, 'learned:template:debit');
  assert.equal(row.bestEffort.template, store.templates[0].id);
  assert.match(row.bestEffort.template, L.LEARNED_TEMPLATE_ID_RE);
  // The same through parse() (iOS History / delivery paths).
  const viaParse = s.parse(THIRD, SENDER, s.inspect(THIRD, SENDER), undefined, OBS);
  assert.equal(viaParse?.bestEffort?.format, 'learned:template:debit');
  // A session with learned formats disabled behaves exactly as before.
  const off = session({ learnedFormats: false });
  assert.equal(off.parseUnproven(THIRD, SENDER, off.inspect(THIRD, SENDER), OBS), null);
});

test('iOS History import (no sender): learned rows are added in the ledger currency', () => {
  // Learn two sender-less confirmations (anchor-signature key).
  reset();
  let store = L.emptyLearnedFormatStore();
  for (const source of [FIRST, SECOND]) {
    const decision = refusal(source, '');
    assert.equal(decision.kind, 'review');
    store = confirm(store, decision.candidate);
    reset(store);
  }
  assert.equal(store.templates[0].sender, null);
  assert.match(store.templates[0].key, /^a:/);
  const record = JSON.stringify({ v: 1, id: 'c'.repeat(64), text: THIRD, receivedAt: '2026-09-04T10:00:00.000Z' });
  const result = parseHistoricalMessageRecords([record], {}, new Date(OBS), new Set(), session());
  assert.equal(result.parsed.length, 1);
  assert.equal(result.parsed[0].bestEffort.format, 'learned:template:debit');
  assert.equal(result.parsed[0].raw, undefined, 'History never keeps text');
});

test('auto-add OFF keeps learned matches in Review; AE/SA users and AED/SAR ledgers never auto-add', () => {
  const store = learned(2);
  reset(store, { autoPost: false });
  let s = session();
  assert.equal(s.parseUnproven(THIRD, SENDER, s.inspect(THIRD, SENDER), OBS), null, 'setting off');
  assert.equal(refusal(THIRD).candidate.suggestedBy, 'learned', 'still pre-filled');
  reset(store);
  const input = { source: THIRD, sender: SENDER, observedAt: OBS, routedMarket: null, country: 'US', ledgerCurrency: 'USD', ledgerExponent: 2 };
  assert.ok(C.learnedPosting(input));
  assert.equal(C.learnedPosting({ ...input, ledgerCurrency: 'AED' }), null, 'AED ledger');
  assert.equal(C.learnedPosting({ ...input, ledgerCurrency: 'SAR' }), null, 'SAR ledger');
  assert.equal(C.learnedPosting({ ...input, country: 'AE' }), null, 'UAE user');
  assert.equal(C.learnedPosting({ ...input, country: 'SA' }), null, 'Saudi user');
  assert.equal(C.learnedPosting({ ...input, routedMarket: 'AE' }), null, 'AE route');
  s = session({ pinnedCurrency: null });
  assert.equal(s.parseUnproven(THIRD, SENDER, s.inspect(THIRD, SENDER), OBS), null, 'unpinned ledger');
});

test('never for AE/SA launch senders: no draft, no match, no post', () => {
  const ae = 'ADCB: USD 24.86 moved on card ending 4421 at NORTH STAR MARKET on 09/03/2026.';
  const draft = C.learnDraftForEvent(ae, 'ADCBAlert', refusal(FIRST).candidate.event, { observedAt: OBS, country: 'US' });
  assert.equal(draft, null);
  const store = learned(2);
  // Even a template whose sender is later seen as an AE/SA sender is refused.
  assert.equal(C.readLearnedFormat(THIRD, 'ADCBAlert', { store }).kind, 'none');
  assert.equal(C.learnedReviewEvent(THIRD, 'ADCBAlert', { store }), null);
  assert.equal(C.learnedReviewEvent(THIRD, SENDER, { store, routedMarket: 'SA' }), null);
  assert.equal(C.learnedPosting({ source: THIRD, sender: 'ADCBAlert', observedAt: OBS, routedMarket: null, country: 'US', ledgerCurrency: 'USD', ledgerExponent: 2, store }), null);
});

test('a UAE/Saudi user or an AED/SAR ledger gets no drafts, no learning and no learned prefill', () => {
  const store = learned(2);
  for (const [code, ledger] of [['AE', 'USD'], ['SA', 'USD'], ['US', 'AED'], ['US', 'SAR']]) {
    setUser(code, ledger);
    reset(store);
    const decision = refusal(THIRD);
    assert.ok(decision.kind !== 'review' || (decision.candidate.suggestedBy === undefined && decision.candidate.learn === undefined),
      `${code}/${ledger}`);
    const plain = refusal(FIRST);
    assert.ok(plain.kind !== 'review' || plain.candidate.learn === undefined, `${code}/${ledger} draft`);
    const withDraft = { event: plain.kind === 'review' ? plain.candidate.event : null, learn: store.templates[0] };
    if (withDraft.event) {
      assert.equal(C.learnedStoreAfterConfirmation(store, withDraft,
        { direction: 'debit', amount: withDraft.event.amount.value, date: '2026-09-03' }, OBS), null, `${code}/${ledger} learn`);
    }
  }
  setUser();
});

test('deleting, undoing or correcting a learned row stops its format', () => {
  const store = learned(2);
  const id = store.templates[0].id;
  const row = { bestEffort: { v: 1, format: 'learned:template:debit', market: 'US', template: id } };
  assert.equal(C.learnedStoreAfterRejection(store, [row], OBS).templates[0].blocked, true);
  assert.equal(C.learnedStoreAfterRejection(store, [{ bestEffort: { v: 1, format: 'universal:purchase:debit', market: 'US' } }, {}], OBS), null);
});

test('an alert routed to AE/SA by its own AED/SAR money is never learned', () => {
  for (const source of [
    'Zeta Bank: AED 24.86 moved on card ending 4421 at NORTH STAR MARKET on 09/03/2026.',
    'Zeta Bank: SAR 24.86 moved on card ending 4421 at NORTH STAR MARKET on 09/03/2026.',
  ]) {
    const decision = refusal(source);
    assert.ok(decision.kind !== 'review' || decision.candidate.learn === undefined, source);
  }
});

test('near misses refuse: pending, declined, an extra amount, another direction word', () => {
  const store = learned(2);
  for (const source of [
    'Zeta Bank: USD 5.00 moved on card ending 4421 at SHOP on 09/03/2026. Pending.',
    'Zeta Bank: USD 5.00 declined on card ending 4421 at SHOP on 09/03/2026.',
    'Zeta Bank: USD 5.00 moved on card ending 4421 at SHOP on 09/03/2026. Fee USD 1.00.',
    'Zeta Bank: USD 5.00 refunded on card ending 4421 at SHOP on 09/03/2026.',
    'Zeta Bank: USD 5.00 will be moved on card ending 4421 at SHOP on 09/03/2026.',
    'Zeta Bank: USD 5.00 moved on card ending 4421 at SHOP on 09/30/2026.', // future-dated
  ]) {
    assert.equal(C.readLearnedFormat(source, SENDER, { store, observedAt: OBS }).kind, 'none', source);
    assert.equal(C.learnedPosting({ source, sender: SENDER, observedAt: OBS, routedMarket: null, country: 'US', ledgerCurrency: 'USD', ledgerExponent: 2, store }), null, source);
    const decision = refusal(source);
    assert.notEqual(decision.kind === 'review' && decision.candidate.suggestedBy, 'learned', source);
  }
});

test('confirmation edge cases: other amount learns nothing; another day drops the date; opposite direction stops the format', () => {
  reset();
  const { candidate } = refusal(FIRST);
  const otherAmount = C.learnedStoreAfterConfirmation(L.emptyLearnedFormatStore(), candidate, {
    direction: 'debit', amount: { currency: 'USD', minorUnits: '99', exponent: 2 }, date: '2026-09-03',
  }, OBS);
  assert.equal(otherAmount, null);
  const noDraft = C.learnedStoreAfterConfirmation(L.emptyLearnedFormatStore(), { ...candidate, learn: undefined }, {
    direction: 'debit', amount: candidate.event.amount.value, date: '2026-09-03',
  }, OBS);
  assert.equal(noDraft, null);
  const otherDay = confirm(L.emptyLearnedFormatStore(), candidate, 'debit', '2026-09-02');
  const tokens = otherDay.templates[0].tokens.map((token) => token.k);
  assert.ok(!tokens.includes('DATE') && tokens.includes('DATEX'), 'date slot no longer extracted');
  assert.equal(otherDay.templates[0].dateOrder, null);
  // A learned prefill confirmed with the other direction blocks the template.
  const store = learned(1);
  reset(store);
  const prefill = refusal(THIRD).candidate;
  const contradicted = confirm(store, prefill, 'credit');
  assert.equal(contradicted.templates.length, 1);
  assert.equal(contradicted.templates[0].blocked, true);
  assert.equal(C.readLearnedFormat(THIRD, SENDER, { store: contradicted }).kind, 'none');
  const otherDayFlip = confirm(store, prefill, 'credit', '2026-09-01');
  assert.equal(otherDayFlip.templates.length, 1, 'no second template');
  assert.equal(otherDayFlip.templates[0].blocked, true, 'blocked even when the day changed');
});

test('"Looks right" counts a confirmation; "Undo" stops the format', () => {
  const store = learned(2);
  const id = store.templates[0].id;
  const marker = { v: 1, format: 'learned:template:debit', market: 'US', template: id };
  const confirmed = C.learnedStoreAfterResolution(store, marker, 'confirm', OBS);
  assert.equal(confirmed.templates[0].confirmations, 3);
  const undone = C.learnedStoreAfterResolution(store, marker, 'undo', OBS);
  assert.equal(undone.templates[0].blocked, true);
  reset(undone);
  const s = session();
  assert.equal(s.parseUnproven(THIRD, SENDER, s.inspect(THIRD, SENDER), OBS), null, 'no longer posts');
  assert.equal(C.learnedStoreAfterResolution(store, { v: 1, format: 'universal:purchase:debit', market: 'US' }, 'undo', OBS), null,
    'other best-effort rows leave learned formats alone');
});

test('foreign-currency learned rows need a dated rate on the device, like every best-effort row', () => {
  reset();
  const eur = (amount, merchant) => `Zeta Bank: EUR ${amount} moved on card ending 4421 at ${merchant} on 09/03/2026.`;
  let store = L.emptyLearnedFormatStore();
  for (const source of [eur('10.00', 'CAFE UNO'), eur('12.00', 'CAFE DOS')]) {
    store = confirm(store, refusal(source).candidate);
    reset(store);
  }
  const input = { source: eur('7.50', 'CAFE TRES'), sender: SENDER, observedAt: OBS, routedMarket: null, country: 'US', ledgerCurrency: 'USD', ledgerExponent: 2, store };
  assert.equal(C.learnedPosting(input), null, 'no rate: Review');
  const withRate = C.learnedPosting({ ...input, fxLookup: (base, quote, date) => ({ base, quote, rate: 1.1, date }) });
  assert.equal(withRate?.amountFils, 825);
  assert.equal(withRate?.originalCurrency, 'EUR');
});

test('the Review tray keeps a valid label and draft, and drops tampered ones', () => {
  const { candidate } = refusal(FIRST);
  const item = { ...candidate, id: 'review_id_0000000001', sourceKey: 'review_src_000000001', suggestedBy: 'learned' };
  const tray = normalizeAlertReviewTray({ schemaVersion: 1, pending: [item], tombstones: [], templateRules: [] }, OBS);
  assert.equal(tray.pending[0].suggestedBy, 'learned');
  assert.equal(tray.pending[0].learn.id, candidate.learn.id);
  const tampered = normalizeAlertReviewTray({ schemaVersion: 1, pending: [{
    ...item, suggestedBy: 'model', learn: { ...candidate.learn, id: 'lf_00000000000' },
  }], tombstones: [], templateRules: [] }, OBS);
  assert.equal(tampered.pending.length, 1, 'the item itself survives');
  assert.equal(tampered.pending[0].suggestedBy, undefined);
  assert.equal(tampered.pending[0].learn, undefined);
});

test('backups carry learned formats and learned markers, validated', () => {
  const store = learned(2);
  const tx = { id: 'tx1', type: 'expense', amountFils: 2486, category: 'other', accountId: 'a1', title: 'X', date: '2026-09-03' };
  const id = store.templates[0].id;
  assert.ok(isValidBackupState({ transactions: [tx], learnedAlertFormats: store, learnedFormatAutoPost: false, aiAlertPrefill: true }));
  assert.ok(isValidBackupState({ transactions: [{ ...tx, bestEffort: { v: 1, format: 'learned:template:debit', market: 'US', template: id } }] }));
  assert.ok(!isValidBackupState({ transactions: [tx], learnedAlertFormats: { version: 2, templates: [] } }), 'bad container');
  assert.ok(!isValidBackupState({ transactions: [tx], learnedFormatAutoPost: 'yes' }));
  assert.ok(!isValidBackupState({ transactions: [{ ...tx, bestEffort: { v: 1, format: 'universal:purchase:debit', market: 'US', template: id } }] }),
    'only a learned marker names a template');
  assert.ok(!isValidBackupState({ transactions: [{ ...tx, bestEffort: { v: 1, format: 'learned:template:debit', market: 'US', template: 'NORTH STAR' } }] }),
    'a template id is a code-owned hash');
  // A tampered template is dropped on restore; the store still restores.
  const tampered = { version: 1, templates: [{ ...store.templates[0], id: 'lf_00000000000' }] };
  assert.ok(isValidBackupState({ transactions: [tx], learnedAlertFormats: tampered }));
  assert.equal(C.normalizeLearnedFormatStore(tampered).templates.length, 0);
});

test('with no learned formats nothing changes', () => {
  reset();
  for (const source of [FIRST, THIRD, 'Zeta Bank alert: card ending 4421 spent USD 24.86 at NORTH STAR MARKET on 09/03/2026. Avl bal USD 900.00']) {
    const on = session();
    const off = session({ learnedFormats: false });
    assert.deepEqual(on.parseUnproven(source, SENDER, on.inspect(source, SENDER), OBS),
      off.parseUnproven(source, SENDER, off.inspect(source, SENDER), OBS));
    assert.deepEqual(on.parse(source, SENDER, on.inspect(source, SENDER), undefined, OBS),
      off.parse(source, SENDER, off.inspect(source, SENDER), undefined, OBS));
    const decision = refusal(source);
    assert.ok(decision.kind !== 'review' || decision.candidate.suggestedBy === undefined);
  }
});

test('copy exists in English and Arabic', () => {
  for (const key of ['learnedFormatCheck', 'learnedFormatExplain', 'reviewRecognisedFormat', 'reviewRecognisedFormatHint',
    'reviewSuggestedByAi', 'reviewSuggestedByAiHint', 'learnedFormatsTitle', 'learnedFormatsIntro', 'learnedFormatsAutoTitle',
    'learnedFormatsAutoBody', 'learnedFormatsEmpty', 'learnedFormatsForget', 'learnedFormatsForgetAll', 'aiReaderTitle',
    'aiReaderIntro', 'aiReaderToggleTitle', 'aiReaderDownloadBody', 'aiReaderWifiOnly', 'aiReaderNeedsWifi', 'aiReaderDelete']) {
    const en = i18n.t(key, 'en');
    const ar = i18n.t(key, 'ar');
    assert.ok(en && en !== key, `${key} en`);
    assert.match(ar, /[؀-ۿ]/, `${key} ar`);
  }
});
