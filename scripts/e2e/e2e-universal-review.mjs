// Browser acceptance for the real source-free generic review and paste UI.
// Each case owns a fresh browser context; no existing user storage is touched.
import assert from 'node:assert/strict';
import { existsSync, mkdirSync } from 'node:fs';
import path from 'node:path';
import { createRequire } from 'node:module';
import { chromium } from 'playwright';

const require = createRequire(import.meta.url);
const { STATE_KEY, SOURCES, SUPPORTED_PASTE, createReviewFixture, createWebSeed } = require('./universal-review-fixtures.cjs');
const BASE = process.env.BASE ?? 'http://localhost:8126';
const ARTIFACTS = process.env.E2E_ARTIFACT_DIR ?? '/tmp/wafra-universal-review-e2e';
const CHROMIUM = process.env.CHROMIUM_PATH ?? '/opt/pw-browsers/chromium';
const browser = await chromium.launch(existsSync(CHROMIUM) ? { executablePath: CHROMIUM } : {});
let passed = 0;
let failed = 0;

// RN-web keeps prior routes mounted. Find an actually exposed, hit-testable
// control; an offscreen/covered match must never satisfy a UI assertion.
async function visible(locator, timeout = 8000) {
  const deadline = Date.now() + timeout;
  while (Date.now() < deadline) {
    for (const element of await locator.all()) {
      if (!await element.isVisible()) continue;
      await element.scrollIntoViewIfNeeded({ timeout: 700 }).catch(() => {});
      const exposed = await element.evaluate((node) => {
        let parent = node.parentElement;
        while (parent && !(parent.scrollHeight > parent.clientHeight + 4 && parent.clientHeight > 200)) parent = parent.parentElement;
        if (parent) {
          const r = node.getBoundingClientRect(), p = parent.getBoundingClientRect();
          if (r.bottom > Math.min(p.bottom, innerHeight) - 120 || r.top < p.top) {
            parent.scrollTop += r.top - p.top - Math.max(24, parent.clientHeight / 3);
          }
        }
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

const button = (page, name) => page.getByRole('button', { name, exact: true });
const click = async (page, name, role = 'button') => (await visible(page.getByRole(role, { name, exact: true }))).click();
const field = (page, name) => page.getByRole('textbox', { name, exact: true });
const fill = async (page, name, value) => (await visible(field(page, name))).fill(value);
// TextField's visible web label is authoritative through aria-labelledby;
// its longer native accessibilityLabel does not override that browser name.
const DATE_LABEL = 'When';
const TITLE_LABEL = 'Merchant or description';
const CONFIRM = 'Confirm and add';

async function readLedger(page) {
  return page.evaluate((key) => {
    const meta = JSON.parse(localStorage.getItem(key) ?? '{}');
    const transactions = Array.isArray(meta.transactions) ? meta.transactions :
      Array.from({ length: meta.txChunks ?? 0 }, (_, index) => JSON.parse(localStorage.getItem(`${key}:tx:${index}`) ?? '[]')).flat();
    return { ...meta, transactions };
  }, STATE_KEY);
}

async function waitForLedger(page, transactionCount, pendingCount) {
  await page.waitForFunction(({ key, transactionCount, pendingCount }) => {
    const meta = JSON.parse(localStorage.getItem(key) ?? '{}');
    const count = Array.isArray(meta.transactions) ? meta.transactions.length :
      Array.from({ length: meta.txChunks ?? 0 }, (_, index) => JSON.parse(localStorage.getItem(`${key}:tx:${index}`) ?? '[]')).reduce((n, chunk) => n + chunk.length, 0);
    return count === transactionCount && meta.reviewTray?.pending?.length === pendingCount;
  }, { key: STATE_KEY, transactionCount, pendingCount }, { timeout: 12000 });
  return readLedger(page);
}

async function openReview(page) {
  await visible(page.getByText('Issuer not verified', { exact: false }));
  await click(page, 'Review details');
  await page.waitForURL(/\/add-transaction\?reviewId=/);
}

async function remainsPending(page) {
  const stored = await readLedger(page);
  assert.equal(stored.transactions.length, 0, 'incomplete/refused review must not create a transaction');
  assert.equal(stored.reviewTray.pending.length, 1, 'incomplete/refused review must remain available');
}

async function expectConfirmationRefusal(page) {
  await click(page, CONFIRM);
  await visible(page.getByText('Confirm the amount, direction, account, category and date first.', { exact: true }));
  await remainsPending(page);
}

async function scenario(name, fixtureName, run, route = '/review-alerts') {
  const context = await browser.newContext({ viewport: { width: 412, height: 915 }, colorScheme: 'light' });
  const page = await context.newPage();
  const errors = [];
  page.on('pageerror', (error) => errors.push(String(error)));
  try {
    const fixture = fixtureName ? createReviewFixture(fixtureName) : null;
    const entries = createWebSeed(fixture?.review, Date.now(), fixture?.currency);
    await context.addInitScript((entries) => {
      // Run once per fresh context, not again on reload (which would mask a
      // persistence/idempotency bug by overwriting the actual saved ledger).
      if (localStorage.getItem('wafra/e2e-universal-seeded') === '1') return;
      for (const [key, value] of entries) localStorage.setItem(key, value);
      localStorage.setItem('wafra/e2e-universal-seeded', '1');
    }, entries);
    await page.goto(new URL(route, BASE).href, { waitUntil: 'networkidle' });
    await run(page, fixture);
    assert.deepEqual(errors, [], 'no uncaught application error');
    passed += 1;
    console.log(`✓ universal review: ${name}`);
  } catch (error) {
    failed += 1;
    mkdirSync(ARTIFACTS, { recursive: true });
    const screenshot = path.join(ARTIFACTS, name.replace(/[^a-z0-9]+/gi, '-').toLowerCase() + '.png');
    await page.screenshot({ path: screenshot, fullPage: true }).catch(() => {});
    console.error(`✗ universal review: ${name}\n  ${error.stack ?? error}\n  Screenshot: ${screenshot}`);
  } finally {
    await context.close();
  }
}

try {
  await scenario('unknown issuer suggestions can be corrected and saved exactly once', 'purchase', async (page, fixture) => {
    await openReview(page);
    await visible(page.getByText('AED 89.50', { exact: true }));
    await visible(page.getByText('AED 1000.00', { exact: true }));
    assert.equal(await (await visible(field(page, TITLE_LABEL))).inputValue(), 'Cedar Cafe');
    assert.equal(await (await visible(field(page, DATE_LABEL))).inputValue(), '2026-09-01');
    await visible(button(page, 'QA Review Card'));
    await click(page, 'QA Review Card');
    await click(page, 'Dining');
    await fill(page, TITLE_LABEL, 'Cedar Cafe reviewed');
    await fill(page, DATE_LABEL, '2026-09-02');
    await click(page, CONFIRM);
    const saved = await waitForLedger(page, 1, 0);
    const tx = saved.transactions[0];
    assert.deepEqual({ amount: tx.amountFils, title: tx.title, category: tx.category, account: tx.accountId, date: tx.date, type: tx.type },
      { amount: 8950, title: 'Cedar Cafe reviewed', category: 'dining', account: 'qa_review_card_4844', date: '2026-09-02', type: 'expense' });
    assert.equal(saved.reviewTray.tombstones.filter((item) => item.sourceKey === fixture.review.sourceKey && item.outcome === 'added').length, 1);
    assert.equal(saved.reviewTray.templateRules.length, 0, 'generic confirmation must not teach automatic rules');
    assert.ok(!JSON.stringify(saved).includes(fixture.source), 'full source must not enter persistent ledger state');
    assert.ok(!tx.raw && !tx.sender, 'saved transaction must remain source-free');
    await page.reload({ waitUntil: 'networkidle' });
    await waitForLedger(page, 1, 0);
    await page.goto(new URL('/review-alerts', BASE).href, { waitUntil: 'networkidle' });
    assert.equal(await button(page, 'Review details').count(), 0, 'resolved review has no second Add path');
    await page.goto(new URL(`/add-transaction?reviewId=${fixture.review.id}`, BASE).href, { waitUntil: 'networkidle' });
    assert.equal(await (await visible(button(page, 'Save transaction'))).isDisabled(), true, 'stale review URL cannot add another entry');
    await waitForLedger(page, 1, 0);
  });

  await scenario('single-purchase currency and date ambiguity requires explicit choices', 'ambiguous', async (page) => {
    await openReview(page);
    await click(page, 'Dining');
    assert.notEqual(await page.getByRole('radio', { name: 'USD 24.90', exact: true }).getAttribute('aria-checked'), 'true');
    assert.notEqual(await page.getByRole('radio', { name: 'CAD 24.90', exact: true }).getAttribute('aria-checked'), 'true');
    assert.equal(await (await visible(field(page, DATE_LABEL))).inputValue(), '');
    await expectConfirmationRefusal(page);
    await click(page, 'USD 24.90', 'radio');
    await expectConfirmationRefusal(page);
    await click(page, '2026-04-03', 'radio');
    await click(page, CONFIRM);
    const saved = await waitForLedger(page, 1, 0);
    assert.equal(saved.transactions[0].amountFils, 2490);
    assert.equal(saved.ledgerMoney.currency, 'USD');
    assert.equal(saved.transactions[0].date, '2026-04-03');
  });

  await scenario('unknown direction and posting status each need confirmation', 'unresolved', async (page) => {
    await openReview(page);
    await fill(page, TITLE_LABEL, 'Confirmed account activity');
    await click(page, 'QA Current Account');
    await click(page, 'Dining');
    assert.notEqual(await page.getByRole('tab', { name: 'Expense', exact: true }).getAttribute('aria-selected'), 'true');
    assert.notEqual(await page.getByRole('tab', { name: 'Income', exact: true }).getAttribute('aria-selected'), 'true');
    await click(page, 'I confirm this money has moved.', 'checkbox');
    await expectConfirmationRefusal(page); // Posting alone cannot supply direction.
    await click(page, 'I confirm this money has moved.', 'checkbox');
    await click(page, 'Expense', 'tab');
    await click(page, 'Dining'); // Changing direction deliberately resets category.
    await expectConfirmationRefusal(page); // Direction alone cannot supply posting.
    await click(page, 'I confirm this money has moved.', 'checkbox');
    await click(page, CONFIRM);
    const saved = await waitForLedger(page, 1, 0);
    assert.equal(saved.transactions[0].amountFils, 4275);
    assert.equal(saved.transactions[0].type, 'expense');
  });

  await scenario('a different currency is refused without losing the review', 'mismatch', async (page) => {
    await openReview(page);
    await visible(page.getByText('USD 15.00', { exact: true }));
    await click(page, 'Dining');
    await click(page, CONFIRM);
    await visible(page.getByText('Choose an amount in your ledger’s currency.', { exact: true }));
    await remainsPending(page);
    await page.reload({ waitUntil: 'networkidle' });
    const persisted = await waitForLedger(page, 0, 1);
    assert.equal(persisted.ledgerMoney.currency, 'AED');
  });

  for (const name of ['statement', 'minimumOnly']) {
    await scenario(`${name} stays informational and never offers ordinary Add`, name, async (page) => {
      await openReview(page);
      await visible(page.getByText('These are account details, not a new transaction.', { exact: true }));
      await visible(page.getByText('AED 50.00', { exact: true }));
      if (name === 'statement') await visible(page.getByText('AED 500.00', { exact: true }));
      else await visible(page.getByText('The total balance is not stated. A minimum payment is not the full amount owed.', { exact: true }));
      assert.equal(await button(page, CONFIRM).count(), 0);
      assert.equal(await button(page, 'Save transaction').count(), 0);
      await visible(button(page, 'Open cards'));
      await remainsPending(page);
    });
  }

  await scenario('multiple independent purchases cannot be reduced to one posting', 'multiplePurchases', async (page) => {
    await openReview(page);
    await visible(page.getByText('These are account details, not a new transaction.', { exact: true }));
    await visible(page.getByText('AED 89.50 / AED 95.00', { exact: true }));
    assert.equal(await button(page, CONFIRM).count(), 0);
    assert.equal(await button(page, 'Save transaction').count(), 0);
    await remainsPending(page);
    await page.reload({ waitUntil: 'networkidle' });
    await waitForLedger(page, 0, 1);
  });

  await scenario('French purchase preserves exact decimal-comma money through confirmation', 'frenchPurchase', async (page) => {
    await openReview(page);
    await visible(page.getByText('EUR 12.40', { exact: true }));
    await visible(page.getByText('EUR 908.20', { exact: true }));
    assert.equal(await (await visible(field(page, TITLE_LABEL))).inputValue(), 'BOULANGERIE DES PINS');
    assert.equal(await (await visible(field(page, DATE_LABEL))).inputValue(), '2026-08-19');
    await click(page, 'QA Current Account');
    await click(page, 'Dining');
    await click(page, CONFIRM);
    const saved = await waitForLedger(page, 1, 0);
    assert.equal(saved.transactions[0].amountFils, 1240);
    assert.equal(saved.transactions[0].title, 'BOULANGERIE DES PINS');
    assert.equal(saved.transactions[0].category, 'dining');
    assert.equal(saved.transactions[0].date, '2026-08-19');
    assert.equal(saved.ledgerMoney.currency, 'EUR');
    assert.equal(saved.ledgerMoney.exponent, 2);
    await page.reload({ waitUntil: 'networkidle' });
    await waitForLedger(page, 1, 0);
  });

  await scenario('Japanese held-out purchase needs a date and preserves zero-decimal yen', 'japanesePurchase', async (page) => {
    await openReview(page);
    await visible(page.getByText('JPY 2786', { exact: true }));
    assert.equal(await (await visible(field(page, TITLE_LABEL))).inputValue(), 'こもれび文具');
    assert.equal(await (await visible(field(page, DATE_LABEL))).inputValue(), '');
    await click(page, 'QA Current Account');
    await click(page, 'Shopping');
    await expectConfirmationRefusal(page);
    await fill(page, DATE_LABEL, '2026-09-05');
    await click(page, CONFIRM);
    const saved = await waitForLedger(page, 1, 0);
    assert.equal(saved.transactions[0].amountFils, 2786);
    assert.equal(saved.transactions[0].title, 'こもれび文具');
    assert.equal(saved.transactions[0].date, '2026-09-05');
    assert.equal(saved.ledgerMoney.currency, 'JPY');
    assert.equal(saved.ledgerMoney.exponent, 0);
    await page.reload({ waitUntil: 'networkidle' });
    await waitForLedger(page, 1, 0);
  });

  await scenario('Spanish statement keeps total minimum and due date out of transactions', 'spanishStatement', async (page) => {
    await openReview(page);
    for (const text of ['Statement total', 'MXN 2450.60', 'Minimum payment', 'MXN 180.00', 'Due date', '2026-09-18']) {
      await visible(page.getByText(text, { exact: true }));
    }
    assert.equal(await button(page, CONFIRM).count(), 0);
    await remainsPending(page);
    await page.reload({ waitUntil: 'networkidle' });
    await waitForLedger(page, 0, 1);
  });

  await scenario('ambiguous JOD statement displays both interpretations without posting', 'jordanStatement', async (page) => {
    await openReview(page);
    await visible(page.getByText('JOD 180.250 / JOD 180250.000', { exact: true }));
    await visible(page.getByText('JOD 10.000 / JOD 10000.000', { exact: true }));
    await visible(page.getByText('2026-09-19', { exact: true }));
    assert.equal(await button(page, CONFIRM).count(), 0);
    await remainsPending(page);
    await page.reload({ waitUntil: 'networkidle' });
    const saved = await waitForLedger(page, 0, 1);
    assert.equal(saved.reviewTray.pending[0].event.statementTotal.value, null);
    assert.equal(saved.reviewTray.pending[0].event.statementTotal.alternatives.length, 2);
  });

  await scenario('CAD refund saves as deliberate Other income rather than salary', 'canadianRefund', async (page) => {
    await openReview(page);
    await visible(page.getByText('CAD 42.60', { exact: true }));
    assert.equal(await (await visible(field(page, TITLE_LABEL))).inputValue(), 'LANTERN BOOKSHOP');
    await click(page, 'QA Refund Card');
    await click(page, 'Other');
    await click(page, CONFIRM);
    const saved = await waitForLedger(page, 1, 0);
    assert.equal(saved.transactions[0].amountFils, 4260);
    assert.equal(saved.transactions[0].type, 'income');
    assert.equal(saved.transactions[0].category, 'other');
    assert.equal(saved.transactions[0].accountId, 'qa_refund_card_7214');
    assert.equal(saved.ledgerMoney.currency, 'CAD');
    assert.equal(saved.reviewTray.templateRules.length, 0);
    await page.reload({ waitUntil: 'networkidle' });
    const reloaded = await waitForLedger(page, 1, 0);
    assert.equal(reloaded.transactions[0].category, 'other');
  });

  await scenario('explicit category correction wins over the merchant suggestion after reload', 'purchase', async (page) => {
    await openReview(page);
    await click(page, 'QA Review Card');
    await click(page, 'Dining');
    await click(page, 'Transport');
    await click(page, CONFIRM);
    const saved = await waitForLedger(page, 1, 0);
    assert.equal(saved.transactions[0].category, 'transport');
    assert.equal(saved.transactions[0].amountFils, 8950);
    await page.reload({ waitUntil: 'networkidle' });
    const reloaded = await waitForLedger(page, 1, 0);
    assert.equal(reloaded.transactions[0].category, 'transport');
    assert.equal(reloaded.reviewTray.templateRules.length, 0);
  });

  await scenario('mixed paste keeps supported preview and generic review separate', null, async (page) => {
    await fill(page, 'Paste bank messages', `${SUPPORTED_PASTE}\n\n${SOURCES.unresolved}`);
    await click(page, 'Parse pasted text');
    await visible(button(page, 'Review 1 alert'));
    await visible(button(page, 'File 1 entry'));
    const staged = await waitForLedger(page, 0, 1);
    assert.equal(staged.reviewTray.pending[0].kind, 'universal');
    assert.equal(staged.reviewTray.pending[0].event.amount.value.minorUnits, '4275');
    await click(page, 'File 1 entry');
    const saved = await waitForLedger(page, 1, 1);
    assert.equal(saved.transactions[0].amountFils, 1725);
    assert.equal(saved.transactions[0].type, 'expense');
    await page.goto(new URL('/review-alerts', BASE).href, { waitUntil: 'networkidle' });
    await openReview(page);
    await visible(page.getByRole('checkbox', { name: 'I confirm this money has moved.', exact: true }));
    assert.equal((await readLedger(page)).transactions.length, 1, 'opening the refused block cannot file it');
  }, '/import-sms?manual=1');
} finally {
  await browser.close();
}

console.log(`\nUniversal review browser suite: ${passed} passed, ${failed} failed`);
process.exitCode = failed ? 1 : 0;
