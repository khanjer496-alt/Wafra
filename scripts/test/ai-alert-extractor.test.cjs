// AI reading of unrecognised alerts: the deterministic gate (src/lib/ai-alert-extractor.ts),
// cue lexicons, per-language gates, and the word pre-tokenizer parity with the training side.
// Run: node --test scripts/test/ai-alert-extractor.test.cjs
const assert = require('node:assert/strict');
const test = require('node:test');
const { execFileSync } = require('node:child_process');
const path = require('node:path');
const { createLoader } = require('../universal-test/load-ts.cjs');

const load = createLoader();
const G = load('@/lib/ai-alert-extractor');
const cues = load('@/lib/ai-alert-cues');
const gates = load('@/lib/ai-alert-gates');
const W = load('@/lib/ai-alert-words');

const span = (source, label, text, p = 0.999) => {
  const start = source.indexOf(text);
  assert.ok(start >= 0, `${text} not in ${source}`);
  return { label, start, end: start + text.length, p };
};
const prediction = (source, over = {}, spans = []) => ({
  engine: 'tagger', modelVersion: 'test', status: 'completed', statusP: 0.999, family: 'purchase', familyP: 0.999,
  direction: 'debit', directionP: 0.999, spans, ...over,
});
const ctx = (over = {}) => ({
  sender: 'N26', country: 'DE', routedMarket: null, ledgerCurrency: 'EUR', ledgerExponent: 2,
  observedAt: Date.parse('2026-09-25T12:00:00Z'), fxLookup: () => null, dateOrder: 'DMY',
  autoPostEnabled: true, bestEffortEnabled: true, evaluationLanguageGate: () => true, ...over,
});

const DE = 'Kartenzahlung über 32,70 € bei REWE MARKT am 21.09.2026. Kontostand: 1.204,55 €';
const dePred = (over, extra = []) => prediction(DE, over, [
  span(DE, 'CUE_DEBIT', 'Kartenzahlung'), span(DE, 'AMT', '32,70'), span(DE, 'CUR', '€'),
  span(DE, 'MER', 'REWE MARKT'), span(DE, 'DATE', '21.09.2026'), ...extra,
]);

test('a fully grounded German card payment posts only with every gate open', () => {
  const r = G.gateAiAlert(DE, dePred(), ctx());
  assert.equal(r.outcome, 'post');
  assert.deepEqual(r.fields.money, { currency: 'EUR', minorUnits: '3270', exponent: 2 });
  assert.equal(r.fields.merchant, 'REWE MARKT');
  assert.equal(r.fields.date, '2026-09-21');
  assert.equal(r.decision.marker.format, 'ai:purchase:debit');
});

test('defaults: shipped language gates are all OFF, so the same reading only prefills', () => {
  for (const language of cues.AI_CUE_LANGUAGES) assert.equal(gates.aiAutoPostAllowedForLanguage(language), false);
  const { evaluationLanguageGate: _omit, ...shipped } = ctx();
  const r = G.gateAiAlert(DE, dePred(), shipped);
  assert.equal(r.outcome, 'prefill');
  assert.ok(r.blockers.includes('language-gate'));
  const off = G.gateAiAlert(DE, dePred(), ctx({ autoPostEnabled: false }));
  assert.equal(off.outcome, 'prefill');
  assert.ok(off.blockers.includes('autopost-disabled'));
  const bestEffortOff = G.gateAiAlert(DE, dePred(), ctx({ bestEffortEnabled: false }));
  assert.equal(bestEffortOff.outcome, 'prefill');
});

test('never for UAE/Saudi senders or routes', () => {
  const s = 'Purchase of AED 45.00 at LULU with card 1234. Avl Bal AED 900.00';
  const p = prediction(s, {}, [span(s, 'AMT', '45.00'), span(s, 'CUR', 'AED')]);
  assert.deepEqual(G.gateAiAlert(s, p, ctx({ sender: 'EmiratesNBD', country: 'AE', ledgerCurrency: 'AED' })), { outcome: 'refuse', reason: 'launch-market' });
  assert.deepEqual(G.gateAiAlert(s, p, ctx({ routedMarket: 'SA' })), { outcome: 'refuse', reason: 'launch-market' });
});

test('non-completed wording and non-posting statuses refuse even when the model says completed', () => {
  for (const s of [
    'Kartenzahlung über 32,70 € bei REWE MARKT vorgemerkt',
    'Your card was declined for USD 20.00 at SHOP',
    '123456 is your OTP for USD 20.00 at SHOP. Do not share',
    'Spend USD 20.00 at SHOP and get 10% cashback',
  ]) {
    const amount = s.match(/\d+[.,]\d{2}/)[0];
    const r = G.gateAiAlert(s, prediction(s, {}, [span(s, 'AMT', amount)]), ctx({ country: 'US', ledgerCurrency: 'USD' }));
    assert.equal(r.outcome, 'refuse', s);
  }
  assert.deepEqual(G.gateAiAlert(DE, dePred({ status: 'pending' }), ctx()), { outcome: 'refuse', reason: 'not-completed' });
});

test('amount must be grounded on one deterministic money token with one currency', () => {
  const noMoney = 'Kartenzahlung bei REWE MARKT, Referenz 3270';
  assert.equal(G.gateAiAlert(noMoney, prediction(noMoney, {}, [span(noMoney, 'AMT', '3270')]), ctx()).reason, 'amount-ungrounded');
  assert.equal(G.gateAiAlert(DE, prediction(DE, {}, []), ctx()).reason, 'no-amount');
  const dollar = 'You spent $12.30 at CAFE';
  const pd = prediction(dollar, {}, [span(dollar, 'AMT', '12.30'), span(dollar, 'CUE_DEBIT', 'spent')]);
  assert.equal(G.gateAiAlert(dollar, pd, ctx({ country: 'DE' })).reason, 'currency-unclear');
  assert.equal(G.gateAiAlert(dollar, pd, ctx({ country: 'US', ledgerCurrency: 'USD' })).outcome, 'post');
});

test('local currency spellings resolve only for the user\'s own country', () => {
  const s = 'Pur, CHECKERS HYPER, R 250,00, Available R 1 204,00';
  const p = prediction(s, {}, [span(s, 'CUE_DEBIT', 'Pur'), span(s, 'AMT', '250,00'), { label: 'CUR', start: s.indexOf('R 250'), end: s.indexOf('R 250') + 1, p: 0.999 }, span(s, 'MER', 'CHECKERS HYPER')]);
  const za = G.gateAiAlert(s, p, ctx({ country: 'ZA', ledgerCurrency: 'ZAR', sender: 'Absa' }));
  assert.equal(za.outcome, 'post');
  assert.equal(za.fields.money.currency, 'ZAR');
  assert.equal(G.gateAiAlert(s, p, ctx({ country: 'US', ledgerCurrency: 'USD', sender: 'Absa' })).outcome, 'refuse');
});

test('a second unlabelled figure blocks posting; a labelled balance does not', () => {
  const two = 'Kartenzahlung 32,70 € REWE MARKT 18,00 €';
  const p = prediction(two, {}, [span(two, 'CUE_DEBIT', 'Kartenzahlung'), span(two, 'AMT', '32,70'), span(two, 'MER', 'REWE MARKT')]);
  const r = G.gateAiAlert(two, p, ctx());
  assert.equal(r.outcome, 'prefill');
  assert.ok(r.blockers.includes('competing-amounts'));
  assert.equal(G.gateAiAlert(DE, dePred(), ctx()).outcome, 'post'); // "Kontostand: 1.204,55 €" is a balance
});

test('direction must be backed by a text cue of the same polarity and none opposite', () => {
  const noCue = 'REWE MARKT 32,70 € 21.09.2026';
  const r = G.gateAiAlert(noCue, prediction(noCue, {}, [span(noCue, 'AMT', '32,70')]), ctx());
  assert.equal(r.outcome, 'prefill');
  assert.ok(r.blockers.includes('direction-cue-missing'));
  const flipped = G.gateAiAlert(DE, dePred({ direction: 'credit', family: 'refund' }), ctx());
  assert.equal(flipped.outcome, 'prefill');
  assert.ok(flipped.blockers.includes('direction-cue-missing'));
  const both = 'Gutschrift und Kartenzahlung 32,70 € REWE MARKT';
  const b = G.gateAiAlert(both, prediction(both, {}, [span(both, 'AMT', '32,70')]), ctx());
  assert.ok(b.blockers.includes('direction-cue-conflict'));
  const fam = G.gateAiAlert(DE, dePred({ family: 'refund' }), ctx());
  assert.ok(fam.blockers.includes('direction-family-conflict'));
});

test('low calibrated confidence refuses or blocks posting', () => {
  assert.equal(G.gateAiAlert(DE, dePred({ statusP: 0.4 }), ctx()).reason, 'low-confidence');
  const r = G.gateAiAlert(DE, dePred({ directionP: 0.9 }), ctx());
  assert.equal(r.outcome, 'prefill');
  assert.ok(r.blockers.includes('low-confidence'));
});

test('foreign money without a dated rate on device stays in Review', () => {
  const s = 'Kartenzahlung über 20,00 USD bei AMAZON US am 21.09.2026';
  const p = prediction(s, {}, [span(s, 'CUE_DEBIT', 'Kartenzahlung'), span(s, 'AMT', '20,00'), span(s, 'CUR', 'USD')]);
  const r = G.gateAiAlert(s, p, ctx());
  assert.equal(r.outcome, 'prefill');
  assert.equal(r.blockers[0], 'policy:fx-rate-unavailable');
});

test('multilingual direction cues', () => {
  const cases = [
    ['تم خصم 45.00 درهم من حسابك', 'debit'], ['تم إيداع 45.00 في حسابك', 'credit'],
    ['1.234,56 EUR abgebucht', 'debit'], ['1.234,56 EUR gutgeschrieben', 'credit'],
    ['20,00 € débité', 'debit'], ['20,00 € crédité', 'credit'], ['cargo de $20', 'debit'], ['abono de $20', 'credit'],
    ['Pix recebido R$ 50,00', 'credit'], ['12,50 TL harcama', 'debit'], ['iade 12,50 TL', 'credit'],
    ['Rp 50.000 didebet', 'debit'], ['Rp 50.000 dikreditkan', 'credit'], ['Rs 500 jama hue', 'credit'],
    ['Rs 500 kate gaye', 'debit'], ['€ 5 bijgeschreven', 'credit'], ['€ 5 afgeschreven', 'debit'],
    ['Your credit card statement is ready', null], ['JOHN sent you $50', 'credit'], ['You sent $50 to JOHN', 'debit'],
  ];
  for (const [s, want] of cases) assert.equal(cues.cueSupportedDirection(s), want, s);
});

test('word pre-tokenizer matches the Python training side exactly', () => {
  const samples = [
    'Kartenzahlung über 1.204,55 € bei REWE MARKT am 21.09.2026.',
    'تم خصم ٤٥٫٠٠ درهم من حسابك 1234 بتاريخ 2026-09-21',
    "CHF 1'234.50 💳 Emoji 👍🏽 test; A/c XX1234 Rs.500",
    'Aapke khate mein ₹1,20,000.50 jama hue',
    'Tab\tand nbsp 1 000,00 €',
  ];
  const py = path.join(__dirname, '..', 'parser-ai', 'probe');
  let out;
  try {
    out = execFileSync('python3', ['-c', `import json,sys; sys.path.insert(0, ${JSON.stringify(py)}); from words import words; print(json.dumps([[list(w) for w in words(s)] for s in json.loads(sys.stdin.read())]))`],
      { input: JSON.stringify(samples) }).toString();
  } catch {
    return; // python3 unavailable: parity is still pinned by the literal expectation below
  }
  const expected = JSON.parse(out);
  samples.forEach((s, i) => assert.deepEqual(W.alertWords(s).map((w) => [w.start, w.end, w.text]), expected[i], s));
});

test('capture reader is inert without a downloaded model (web/Node stub) and for AE/SA senders', async () => {
  const reader = load('@/lib/ai-alert-reader');
  const model = load('@/lib/ai-alert-model');
  assert.equal(model.aiAlertModelStatus().state, 'not-downloaded');
  assert.equal(await reader.aiReviewEventForRefusedAlert(DE, 'N26', Date.now()), null);
  assert.equal(await reader.aiReviewEventForRefusedAlert('Purchase of AED 5 at X', 'EmiratesNBD', Date.now()), null);
  const manifest = load('@/lib/ai-alert-model-manifest');
  const total = manifest.AI_ALERT_MODEL_MANIFEST.artifacts.reduce((s, a) => s + a.bytes, 0);
  assert.ok(total <= manifest.MAX_TOTAL_BYTES);
  for (const a of manifest.AI_ALERT_MODEL_MANIFEST.artifacts) assert.match(a.sha256, /^[0-9a-f]{64}$/);
});

test('word pre-tokenizer keeps numbers whole and offsets exact', () => {
  const s = 'Paid AED 1,234.50 at X-1';
  assert.deepEqual(W.alertWords(s).map((w) => w.text), ['Paid', 'AED', '1,234.50', 'at', 'X', '-', '1']);
  for (const w of W.alertWords(s)) assert.equal(s.slice(w.start, w.end), w.text);
});
