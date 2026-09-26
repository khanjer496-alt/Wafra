// Browser acceptance for learned bank formats and on-device AI suggestions:
// the Review labels ("Recognised format — confirm", "Suggested by on-device
// AI"), confirming a Review item teaches or counts toward a learned format,
// and Settings → Learned bank formats / On-device alert reader.
// Synthetic ledgers only; each case owns a fresh browser context.
//
//   BASE=http://localhost:8126 node scripts/e2e/e2e-learned-formats.mjs
//   SCREENSHOT_DIR=docs/design/2026-09-26-parser-ai-wire  (optional)
import assert from 'node:assert/strict';
import { existsSync, mkdirSync } from 'node:fs';
import path from 'node:path';
import { createRequire } from 'node:module';
import { chromium } from 'playwright';

const require = createRequire(import.meta.url);
const { createLoader } = require('../universal-test/load-ts.cjs');
const load = createLoader();
const country = load('@/lib/country');
const markets = load('@/lib/markets');
const { inspectUniversalBankEvent } = load('@/lib/universal-parser');
const { prepareUniversalReviewAlert, emptyAlertReviewTray } = load('@/lib/alert-review-tray');
const { ledgerMoneySpec } = load('@/lib/ledger-money');
const { gateAiAlert } = load('@/lib/ai-alert-extractor');
const { predictionFromPlatformReading } = load('@/lib/ai-alert-platform-reader');
const L = load('@/lib/learned-alert-formats');
const C = load('@/lib/learned-format-capture');

const BASE = process.env.BASE ?? 'http://localhost:8126';
const SHOTS = process.env.SCREENSHOT_DIR ?? '';
const ARTIFACTS = process.env.E2E_ARTIFACT_DIR ?? '/tmp/wafra-learned-formats-e2e';
const CHROMIUM = process.env.CHROMIUM_PATH ?? '/opt/pw-browsers/chromium';
const STATE_KEY = 'wafra/state/v1';
const browser = await chromium.launch(existsSync(CHROMIUM) ? { executablePath: CHROMIUM } : {});
let passed = 0;
let failed = 0;

/* ── synthetic fixtures through the production modules ─────────────── */
country.setActiveCountry('US');
markets.setActiveMarket('ZZ');
markets.setLedgerCurrency('USD', 2);
const NOW = Date.now();
const DAY = 24 * 60 * 60 * 1000;
const ZETA = (amount, merchant, card) => `Zeta Bank: USD ${amount} moved on card ending ${card} at ${merchant} on 09/03/2026.`;
const KAPPA = 'Kappa Bank | debit USD 42.10 | ACME HARDWARE | 09/04/2026 | card 7214';
const AI_SOURCE = 'ZetaPay: USD 12.40 debited via card xx4421 @ BLUE BOTTLE on 09/04/2026 ref A1B2C3';

const universalEvent = (source, sender) => {
  const event = inspectUniversalBankEvent(source, { sender, dateOrder: 'MDY' });
  assert.equal(event.decision, 'review');
  return event;
};
const draftFor = (source, sender, event) => {
  const draft = C.learnDraftForEvent(source, sender, event, { observedAt: NOW, country: 'US' });
  assert.ok(draft, `draft for ${source}`);
  return draft;
};
const review = (id, observedAt, event, extra = {}) => {
  const item = prepareUniversalReviewAlert({
    id: `learned_fixture_id_${id}`, sourceKey: `learned_fixture_src_${id}`, observedAt, channel: 'inbox', event,
  });
  assert.ok(item, `${id} passes the real review whitelist`);
  return { ...item, ...extra };
};

// One learned format (1 confirmation), learned from an earlier Zeta alert.
const first = ZETA('24.86', 'NORTH STAR MARKET', '4421');
const firstEvent = universalEvent(first, 'ZETABNK');
const learnedStore = C.learnedStoreAfterConfirmation(L.emptyLearnedFormatStore(),
  { event: firstEvent, learn: draftFor(first, 'ZETABNK', firstEvent) },
  { direction: 'debit', amount: firstEvent.amount.value, date: firstEvent.transactionDate.value }, NOW - 3 * DAY);
assert.equal(learnedStore.templates.length, 1);
const template = learnedStore.templates[0];

// 1. A later Zeta alert the learned format read ("Recognised format").
const later = ZETA('1,205.10', 'SQ *BLUE BOTTLE COFFEE', '9912');
const learnedMatch = C.learnedReviewEvent(later, 'ZETABNK', { store: learnedStore, observedAt: NOW });
assert.ok(learnedMatch, 'the learned format reads the later alert');
// 2. An alert no parser read that the phone model suggested fields for.
const aiReading = { posting: 'yes', status: 'completed', amount: '12.40', currency: 'USD', direction: 'out',
  family: 'purchase', merchant: 'BLUE BOTTLE', date: '09/04/2026' };
const aiGate = gateAiAlert(AI_SOURCE, predictionFromPlatformReading(AI_SOURCE, aiReading), {
  sender: 'ZETAPAY', country: 'US', routedMarket: null, ledgerCurrency: 'USD', ledgerExponent: 2,
  observedAt: NOW, dateOrder: 'MDY', autoPostEnabled: false, bestEffortEnabled: true,
});
assert.equal(aiGate.outcome, 'prefill');
// 3. An unrecognised Kappa alert (ordinary reading, with its learning draft).
const kappaEvent = universalEvent(KAPPA, 'KAPPABNK');

const REVIEWS = {
  learned: review('learned_0001', NOW - 2 * 60_000, learnedMatch.event, { suggestedBy: 'learned', learn: learnedMatch.draft }),
  ai: review('ai_000000001', NOW - 60_000, aiGate.event, { suggestedBy: 'ai', learn: draftFor(AI_SOURCE, 'ZETAPAY', aiGate.event) }),
  plain: review('plain_000001', NOW - 3 * 60_000, kappaEvent, { learn: draftFor(KAPPA, 'KAPPABNK', kappaEvent) }),
};

const seed = (language = 'en') => {
  const state = {
    ledgerMoney: ledgerMoneySpec('USD'),
    reviewTray: { ...emptyAlertReviewTray(), pending: [REVIEWS.learned, REVIEWS.ai, REVIEWS.plain] },
    learnedAlertFormats: learnedStore,
    accounts: [
      { id: 'qa_card_9912', name: 'QA Visa', kind: 'card', cardType: 'credit', last4: '9912', openingFils: 0, color: '#367A61' },
      { id: 'qa_card_4421', name: 'QA Debit', kind: 'card', cardType: 'debit', last4: '4421', openingFils: 0, color: '#637581' },
      { id: 'qa_card_7214', name: 'QA Kappa Card', kind: 'card', cardType: 'debit', last4: '7214', openingFils: 0, color: '#637581' },
      { id: 'qa_current', name: 'QA Current', kind: 'bank', last4: '1234', openingFils: 100000, color: '#637581' },
    ],
    budgets: [], bills: [], cardDues: [], goals: [],
    merchantOverrides: {}, accountHints: {}, notSubscriptions: [],
    localCaptureQualifications: [], iosCaptureWarning: null,
    onboardingPlan: null, onboardingCurrencyEvidence: null,
    onboarded: true, userName: 'QA', appLock: false,
    marketId: 'ZZ', country: 'US', language, languagePreference: language, themePreference: 'light',
    monthStartDay: 1, pro: false, founderPro: false, trialStartTs: NOW,
    privateMode: false, captureOptOut: true, dailySummary: false,
    parserVersion: 32, lastScanTs: 0, historyImport: null,
    txChunks: 0, txChunkOrder: 'oldest-first',
  };
  return [[STATE_KEY, JSON.stringify(state)]];
};

/* ── helpers ────────────────────────────────────────────────────────── */
async function visible(locator, timeout = 8000) {
  const deadline = Date.now() + timeout;
  while (Date.now() < deadline) {
    for (const element of await locator.all()) {
      if (!await element.isVisible()) continue;
      await element.scrollIntoViewIfNeeded({ timeout: 700 }).catch(() => {});
      const exposed = await element.evaluate((node) => {
        const r = node.getBoundingClientRect();
        if (r.width < 1 || r.height < 1) return false;
        const top = document.elementFromPoint(r.x + r.width / 2, r.y + r.height / 2);
        return !!top && (node.contains(top) || top.contains(node));
      }).catch(() => false);
      if (exposed) return element;
    }
    await new Promise((resolve) => setTimeout(resolve, 80));
  }
  throw new Error(`No exposed UI match: ${locator}`);
}
const click = async (page, name, role = 'button') => (await visible(page.getByRole(role, { name, exact: true }))).click();

async function readLedger(page) {
  return page.evaluate((key) => JSON.parse(localStorage.getItem(key) ?? '{}'), STATE_KEY);
}
async function waitFor(page, predicate, arg) {
  await page.waitForFunction(({ key, body, arg }) => {
    const state = JSON.parse(localStorage.getItem(key) ?? '{}');
    return new Function('state', 'arg', body)(state, arg);
  }, { key: STATE_KEY, body: `return (${predicate.toString()})(state, arg);`, arg }, { timeout: 12000 });
  return readLedger(page);
}
async function shot(page, name) {
  if (!SHOTS) return;
  mkdirSync(SHOTS, { recursive: true });
  await page.waitForTimeout(400);
  await page.screenshot({ path: path.join(SHOTS, `${name}.png`) });
}
async function openRow(page, label) {
  const row = page.getByTestId('review-alert-row').filter({ hasText: label });
  await (await visible(row.getByTestId('review-alert-open'))).click();
  await page.waitForURL(/\/add-transaction\?reviewId=/);
}

async function scenario(name, run, { language = 'en', route = '/review-alerts' } = {}) {
  const context = await browser.newContext({ viewport: { width: 390, height: 844 }, deviceScaleFactor: 1, colorScheme: 'light' });
  await context.route('**/*', (request) => {
    const url = request.request().url();
    return url.startsWith(new URL('/', BASE).href) || url.startsWith('data:') || url.startsWith('blob:')
      ? request.continue() : request.abort();
  });
  const page = await context.newPage();
  const errors = [];
  page.on('pageerror', (error) => errors.push(String(error)));
  try {
    await context.addInitScript((entries) => {
      if (localStorage.getItem('wafra/e2e-learned-seeded') === '1') return;
      for (const [key, value] of entries) localStorage.setItem(key, value);
      localStorage.setItem('wafra/e2e-learned-seeded', '1');
    }, seed(language));
    await page.goto(new URL(route, BASE).href, { waitUntil: 'networkidle' });
    await run(page);
    assert.deepEqual(errors, [], 'no uncaught application error');
    passed += 1;
    console.log(`✓ learned formats: ${name}`);
  } catch (error) {
    failed += 1;
    mkdirSync(ARTIFACTS, { recursive: true });
    const file = path.join(ARTIFACTS, name.replace(/[^a-z0-9]+/gi, '-').toLowerCase() + '.png');
    await page.screenshot({ path: file, fullPage: true }).catch(() => {});
    console.error(`✗ learned formats: ${name}\n  ${error.stack ?? error}\n  Screenshot: ${file}`);
  } finally {
    await context.close();
  }
}

try {
  await scenario('Review shows who proposed the fields', async (page) => {
    await visible(page.getByText('Recognised format — confirm', { exact: true }));
    await visible(page.getByText('Suggested by on-device AI', { exact: true }));
    assert.equal(await page.getByTestId('review-alert-row').count(), 3);
    await page.evaluate(() => window.scrollTo(0, 0));
    await shot(page, 'review-list-labels');
  });

  await scenario('confirming a recognised format counts toward it; the person can edit first', async (page) => {
    await openRow(page, 'Recognised format — confirm');
    await visible(page.getByTestId('review-recognised-format'));
    await visible(page.getByText('USD 1205.10', { exact: true }));
    await shot(page, 'review-recognised-format-card');
    await click(page, 'Confirm and add');
    const saved = await waitFor(page, (state) => state.reviewTray?.pending?.length === 2 &&
      state.learnedAlertFormats?.templates?.[0]?.confirmations === 2);
    const template = saved.learnedAlertFormats.templates[0];
    assert.equal(template.direction, 'debit');
    assert.ok(!JSON.stringify(saved.learnedAlertFormats).includes('BLUE BOTTLE'), 'no merchant text learned');
    assert.ok(!JSON.stringify(saved.learnedAlertFormats).includes('1205'), 'no amount learned');
  });

  await scenario('an AI suggestion is editable, and confirming it teaches its format', async (page) => {
    await openRow(page, 'Suggested by on-device AI');
    await visible(page.getByTestId('review-suggested-by-ai'));
    // Every model-proposed field the person may need to correct is open.
    await visible(page.getByRole('tab', { name: 'Expense', exact: true }));
    const title = await visible(page.getByRole('textbox', { name: 'Merchant or description', exact: true }));
    await shot(page, 'review-suggested-by-ai-card');
    await title.fill('Blue Bottle Coffee');
    await click(page, 'Confirm and add');
    const saved = await waitFor(page, (state) => state.reviewTray?.pending?.length === 2 &&
      state.learnedAlertFormats?.templates?.length === 2);
    const learnedAi = saved.learnedAlertFormats.templates.find((row) => row.sender === 'ZETAPAY');
    assert.ok(learnedAi, 'learned under its sender');
    assert.equal(learnedAi.confirmations, 1);
    assert.equal(learnedAi.direction, 'debit');
    const chunks = await page.evaluate((key) => Object.keys(localStorage).filter((k) => k.startsWith(`${key}:tx:`))
      .flatMap((k) => JSON.parse(localStorage.getItem(k) ?? '[]')), STATE_KEY);
    const rows = [...(saved.transactions ?? []), ...chunks];
    assert.equal(rows.length, 1);
    assert.equal(rows[0].title, 'Blue Bottle Coffee', 'the person\'s title wins');
    assert.equal(rows[0].amountFils, 1240);
    assert.ok(!rows[0].raw, 'no message text on the row');
  });

  await scenario('answering the other direction on a recognised format stops that format', async (page) => {
    await openRow(page, 'Recognised format — confirm');
    await click(page, 'Income', 'tab');
    await click(page, 'Confirm and add');
    const saved = await waitFor(page, (state) => state.reviewTray?.pending?.length === 2 &&
      state.learnedAlertFormats?.templates?.[0]?.blocked === true);
    assert.equal(saved.learnedAlertFormats.templates.length, 1);
  });

  await scenario('an unrecognised alert with no direction needs the person, then teaches the format', async (page) => {
    await openRow(page, 'USD 42.10');
    await click(page, 'Expense', 'tab');
    await click(page, 'Confirm and add');
    const saved = await waitFor(page, (state) => state.learnedAlertFormats?.templates?.length === 2);
    assert.ok(saved.learnedAlertFormats.templates.some((row) => row.sender === 'KAPPABNK' && row.direction === 'debit'));
  });

  await scenario('Settings → Learned bank formats lists masked shapes; auto-add off; forget one and all', async (page) => {
    await visible(page.getByTestId('learned-format-row'));
    const text = await page.getByTestId('learned-formats-list').innerText();
    assert.match(text, /ZETABNK/);
    assert.match(text, /\{AMOUNT\}/);
    assert.ok(!/NORTH STAR|24\.86|4421/.test(text), 'masked shape only');
    await shot(page, 'settings-learned-formats');
    await click(page, 'Auto-add from learned formats', 'switch');
    await waitFor(page, (state) => state.learnedFormatAutoPost === false);
    await click(page, 'Forget');
    await click(page, 'Forget');
    await waitFor(page, (state) => state.learnedAlertFormats?.templates?.length === 0);
    await visible(page.getByTestId('learned-formats-empty'));
  }, { route: '/learned-formats' });

  await scenario('Settings → On-device alert reader: suggestions switch, reader is native-only on web', async (page) => {
    await visible(page.getByTestId('alert-reader-phone-model'));
    await visible(page.getByTestId('alert-reader-native-only'));
    await shot(page, 'settings-alert-reader');
    await click(page, 'Suggest fields with on-device AI', 'switch');
    await waitFor(page, (state) => state.aiAlertPrefill === false);
  }, { route: '/alert-reader' });

  await scenario('Settings links to both screens', async (page) => {
    const row = await visible(page.getByRole('button', { name: 'Learned bank formats', exact: true }));
    await row.scrollIntoViewIfNeeded();
    await visible(page.getByRole('button', { name: 'On-device alert reader', exact: true }));
    await shot(page, 'settings-rows');
    await row.click();
    await page.waitForURL(/\/learned-formats/);
  }, { route: '/settings' });

  await scenario('Arabic labels', async (page) => {
    await visible(page.getByText('صيغة معروفة — أكِّدها', { exact: true }));
    await visible(page.getByText('مقترح من الذكاء الاصطناعي على الجهاز', { exact: true }));
    await shot(page, 'review-list-labels-ar');
  }, { language: 'ar' });
} finally {
  await browser.close();
}
console.log(`learned formats e2e: ${passed} passed, ${failed} failed`);
if (failed) process.exit(1);
