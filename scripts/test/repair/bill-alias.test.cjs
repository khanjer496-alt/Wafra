'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const path = require('node:path');
const load = require('./load-typescript.cjs');

const root = path.resolve(__dirname, '../../..');
const source = (name) => path.join(root, 'src/lib', `${name}.ts`);

const categories = load(source('categories'), {
  '@/components/ui/icon.types': {},
  '@/lib/i18n': { getLanguage: () => 'en' },
});
const aliases = load(source('bill-alias'), {
  '@/lib/categories': categories,
});

const receipt = (extra = {}) => ({
  id: 'bill-row',
  type: 'expense',
  amountFils: 1284000,
  category: 'other',
  accountId: '__unassigned-transaction__',
  title: 'Fishbasket',
  date: '2026-09-02',
  source: 'sms',
  paymentFlowSide: 'receipt',
  billIdentity: 'consumer:4036',
  ...extra,
});

test('bill alias is scoped to privacy-safe bill identity and original bank nickname', () => {
  assert.equal(aliases.billAliasKey(' FishBasket ', 'consumer:4036'), 'consumer:4036|fishbasket');
  assert.equal(aliases.billAliasKey('Fishbasket', 'consumer:9999'), 'consumer:9999|fishbasket');
  assert.equal(aliases.billAliasKey('Fishbasket', 'consumer:123456789'), null);
  assert.equal(aliases.billAliasKey('Fishbasket', 'reference:4036'), null);
});

test('one bill correction cannot relabel a real merchant with the same name', () => {
  const ordinaryPurchase = receipt({
    id: 'restaurant', paymentFlowSide: undefined, billIdentity: undefined,
    accountId: 'card', category: 'dining', amountFils: 8500,
  });
  assert.equal(aliases.billAliasAppliesTo(receipt(), 'Fishbasket', 'consumer:4036'), true);
  assert.equal(aliases.billAliasAppliesTo(ordinaryPurchase, 'Fishbasket', 'consumer:4036'), false);
});

test('same nickname on a different bill account is left alone', () => {
  assert.equal(aliases.billAliasAppliesTo(
    receipt({ billIdentity: 'consumer:9999' }), 'Fishbasket', 'consumer:4036'), false);
});

test('user edits and split allocations are never bulk overwritten', () => {
  assert.equal(aliases.billAliasAppliesTo(receipt({ userEdited: true }), 'Fishbasket', 'consumer:4036'), false);
  assert.equal(aliases.billAliasAppliesTo(receipt({ splits: [
    { category: 'utilities', amountFils: 1000000 },
    { category: 'other', amountFils: 284000 },
  ] }), 'Fishbasket', 'consumer:4036'), false);
});

test('bulk alias changes only matching bill receipts and leaves money/date/account intact', () => {
  const matching = receipt();
  const otherIdentity = receipt({ id: 'other-bill', billIdentity: 'consumer:9999' });
  const restaurant = receipt({
    id: 'restaurant', paymentFlowSide: undefined, billIdentity: undefined,
    accountId: 'card', category: 'dining', amountFils: 8500,
  });
  const updated = aliases.applyBillAliasToTransactions(
    [matching, otherIdentity, restaurant],
    'Fishbasket',
    'consumer:4036',
    { title: 'SEWA', category: 'utilities' },
  );
  assert.equal(updated[0].title, 'SEWA');
  assert.equal(updated[0].category, 'utilities');
  assert.equal(updated[0].amountFils, matching.amountFils);
  assert.equal(updated[0].date, matching.date);
  assert.equal(updated[0].accountId, matching.accountId);
  assert.equal(updated[0].billIdentity, matching.billIdentity);
  assert.equal(updated[0].userEdited, undefined);
  assert.equal(updated[0].titleEdited, true);
  assert.equal(updated[1].title, 'Fishbasket');
  assert.equal(updated[2].title, 'Fishbasket');
  assert.equal(updated[2].category, 'dining');
});

test('stored alias validates title and expense category', () => {
  const alias = aliases.validBillAlias(' SEWA ', 'utilities');
  assert.equal(alias?.title, 'SEWA');
  assert.equal(alias?.category, 'utilities');
  assert.equal(aliases.validBillAlias('', 'utilities'), null);
  assert.equal(aliases.validBillAlias('SEWA', 'salary'), null);
});

test('lookup requires both nickname and bill identity', () => {
  const map = {
    'consumer:4036|fishbasket': { title: 'SEWA', category: 'utilities' },
  };
  assert.deepEqual(aliases.readBillAlias(map, 'Fishbasket', 'consumer:4036'), {
    title: 'SEWA', category: 'utilities',
  });
  assert.equal(aliases.readBillAlias(map, 'Fishbasket', 'consumer:9999'), undefined);
  assert.equal(aliases.readBillAlias(map, 'Fish Basket Rest', 'consumer:4036'), undefined);
});
