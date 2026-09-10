'use strict';

const assert = require('node:assert/strict');
const { test } = require('node:test');
const path = require('node:path');
const load = require('./load-typescript.cjs');
const root = path.resolve(__dirname, '../../..');
const markets = load(path.join(root, 'src/lib/markets.ts'));
const core = load(path.join(root, 'src/lib/transfer-reconciliation.ts'), {
  '@/lib/markets': markets,
  '@/lib/currency-metadata': load(path.join(root, 'src/lib/currency-metadata.ts')),
  '@noble/hashes/sha2.js': require('@noble/hashes/sha2.js'),
  '@noble/hashes/utils.js': require('@noble/hashes/utils.js'),
});
const { isTransferCandidate, transferOwnership, transferFingerprint,
  reconcileTransfers, normalizeTransferLinks, applyTransferDecision } = core;
const ledger = load(path.join(root, 'src/lib/ledger.ts'), { '@/lib/transfer-reconciliation': core });
const NOW = Date.parse('2026-09-08T10:00:00Z');
const clone = x => JSON.parse(JSON.stringify(x));
const bank = (id, last4, bankName = 'ADCB', extra = {}) => ({
  id, name: id, kind: 'bank', bankName, last4, openingFils: 0, color: '#111111', ...extra,
});
const accounts = [bank('a', '1111'), bank('b', '2222'), bank('c', '3333')];
const instrument = (account = accounts[0]) => ({ last4: account.last4,
  kind: account.kind === 'bank' ? 'account' : account.cardType ?? 'unknown',
  bankIdentity: markets.bankIdentityForName(account.bankName),
});
function row(id, type = 'expense', extra = {}) {
  const account = type === 'expense' ? accounts[0] : accounts[1];
  return { id, type, amountFils: 10000, category: 'other', accountId: account.id,
    title: type === 'expense' ? 'Outgoing transfer' : 'Incoming transfer',
    date: '2026-09-08', ts: NOW, source: 'sms', smsKey: `s${NOW}-${id}`,
    captureInstrument: instrument(account),
    transferEvidence: { version: 1, currency: 'AED', attribution: 'source' }, ...extra };
}
function pair(extraA = {}, extraB = {}) {
  return [row('out', 'expense', { transferEvidence: { version: 1, currency: 'AED',
    attribution: 'source', reference: 'TRX-984512AB' }, ...extraA }),
  row('in', 'income', { transferEvidence: { version: 1, currency: 'AED',
    attribution: 'source', reference: 'TRX 984512AB' }, ...extraB })];
}
const sorted = set => [...set].sort();
function request(rows, ids, ownership, extra = {}) {
  return { ids, ownership, now: NOW, expectedFingerprints: Object.fromEntries(
    rows.map(t => [t.id, transferFingerprint(t)])), ...extra };
}

test('equal amounts and clocks cannot turn unknown bank transfers into own transfers', () => {
  const rows = [row('out', 'expense', { isTransfer: true }), row('in', 'income')];
  const result = reconcileTransfers(rows, accounts);
  assert.deepEqual(sorted(result.internalIds), []);
  assert.deepEqual(sorted(result.pendingIds), [], 'low-signal transfers are not a manual-review backlog');
  assert.equal(transferOwnership(rows[0]), 'unknown');
  assert.equal(result.byId.get('out').reason, 'missing-evidence');
});

test('legacy outward-remittance and telegraphic-transfer SMS titles remain recorded without forcing review', () => {
  for (const title of ['Outward remittance', 'Telegraphic transfer']) {
    const tx = row('legacy-transfer', 'expense', { title, isTransfer: true, transferEvidence: undefined });
    assert.equal(isTransferCandidate(tx), true, title);
    assert.equal(transferOwnership(tx), 'unknown', title);
    const result = reconcileTransfers([tx], accounts);
    assert.equal(result.pendingIds.has(tx.id), false, title);
    assert.equal(result.internalIds.has(tx.id), false, title);
  }
});

test('only transfer semantics enter reconciliation; commerce and settlement roles stay out', () => {
  for (const extra of [
    { title: 'Salary', category: 'salary' }, { category: 'business', title: 'Talabat Business' },
    { title: 'Cashback credit' }, { title: 'Purchase refund' },
    { cardPaymentSide: 'receipt' }, { paymentFlowSide: 'funding' },
    { title: 'Card payment', source: 'manual', smsKey: undefined, isTransfer: true },
    { title: 'Card •1234 payment', source: 'manual', smsKey: undefined, isTransfer: true },
    { title: 'Coffee shop', transferEvidence: undefined },
    { source: 'manual', smsKey: undefined, transferEvidence: undefined, isTransfer: false },
  ]) assert.equal(isTransferCandidate(row('x', 'income', extra)), false, JSON.stringify(extra));
  assert.equal(isTransferCandidate(row('x', 'income', { transferEvidence: undefined })), true);
});

test('a generic LLC-style transfer stays unresolved without becoming a mandatory review task', () => {
  const original = row('generic-llc-credit', 'income', { transferEvidence: undefined,
    raw: 'Funds credited. B/O EXAMPLE TRADING LLC.' });
  const reclassified = { ...original, category: 'business' };
  for (const tx of [original, reclassified]) {
    assert.equal(isTransferCandidate(tx), true);
    assert.equal(transferOwnership(tx), 'unknown');
    const result = reconcileTransfers([tx], accounts);
    assert.equal(result.pendingIds.has(tx.id), false);
    assert.equal(result.internalIds.has(tx.id), false);
    assert.equal(ledger.isIncome(tx), false, 'an inferred Business category does not prove external ownership');
  }
});

test('an explicit own-account side automatically absorbs one unique matching opposite posting', () => {
  const rows = [
    row('out', 'expense', { accountId: 'a', title: 'Own account transfer', isTransfer: true, ts: NOW }),
    row('in', 'income', { accountId: 'b', title: 'Incoming transfer', isTransfer: true, ts: NOW + 35_000 }),
  ];
  const result = reconcileTransfers(rows, accounts);
  assert.deepEqual(sorted(result.internalIds), ['in', 'out']);
  assert.deepEqual(sorted(result.pendingIds), []);
  assert.equal(result.byId.get('in').reason, 'explicit-ownership');
  assert.equal(result.byId.get('out').counterpartId, 'in');
});

test('a masked owned source and one unique opposite owned-account posting reconcile automatically', () => {
  const mask = 'a'.repeat(64);
  const fab = bank('fab', '0002', 'FAB');
  const hidden = `__unassigned-transfer__:liv:${mask}`;
  const outgoing = row('masked-out', 'expense', {
    accountId: hidden,
    captureInstrument: undefined,
    ts: NOW,
    transferEvidence: {
      version: 1, currency: 'AED', attribution: 'fallback', sourceBank: 'liv', sourceAccountKey: mask,
    },
  });
  const incoming = row('fab-in', 'income', {
    accountId: fab.id,
    captureInstrument: { last4: '0002', kind: 'account', bankIdentity: 'fab' },
    ts: NOW + 70_000,
    transferEvidence: {
      version: 1, currency: 'AED', attribution: 'source', sourceBank: 'fab', postingForm: 'credit-receipt',
    },
  });
  const result = reconcileTransfers([outgoing, incoming], [fab]);
  assert.deepEqual(sorted(result.internalIds), ['fab-in', 'masked-out']);
  assert.equal(result.byId.get('masked-out').reason, 'amount-time');
  assert.equal(result.byId.get('fab-in').counterpartId, 'masked-out');
  assert.deepEqual(sorted(result.pendingIds), []);
});

test('amount-time ownership stays fail-closed for named recipients, distant rows and collisions', () => {
  const mask = 'b'.repeat(64);
  const fab = bank('fab', '0002', 'FAB');
  const hidden = `__unassigned-transfer__:liv:${mask}`;
  const outgoing = row('masked-out', 'expense', {
    accountId: hidden, captureInstrument: undefined, ts: NOW,
    transferEvidence: { version: 1, currency: 'AED', attribution: 'fallback', sourceBank: 'liv', sourceAccountKey: mask },
  });
  const incoming = row('fab-in', 'income', {
    accountId: fab.id, captureInstrument: { last4: '0002', kind: 'account', bankIdentity: 'fab' }, ts: NOW + 70_000,
    transferEvidence: { version: 1, currency: 'AED', attribution: 'source', sourceBank: 'fab', postingForm: 'credit-receipt' },
  });
  const named = { ...outgoing, id: 'named', transferEvidence: { ...outgoing.transferEvidence, counterpartyName: 'Ahmad' } };
  assert.deepEqual(sorted(reconcileTransfers([named, incoming], [fab]).internalIds), []);
  assert.deepEqual(sorted(reconcileTransfers([outgoing, { ...incoming, ts: NOW + 5 * 60_000 + 1 }], [fab]).internalIds), []);
  const collision = { ...incoming, id: 'fab-in-2', ts: NOW + 80_000 };
  assert.deepEqual(sorted(reconcileTransfers([outgoing, incoming, collision], [fab]).internalIds), []);
});

test('generic Business-labelled transfers still match evidence while named business receipts remain income', () => {
  const evidenced = pair({ category: 'business' }, { category: 'business' });
  assert.deepEqual(sorted(reconcileTransfers(evidenced, accounts).internalIds), ['in', 'out']);
  for (const transferEvidence of [undefined, { version: 1, currency: 'AED', attribution: 'source' }]) {
    const named = row('named-business', 'income', { title: 'Talabat Business', category: 'business', transferEvidence });
    assert.equal(isTransferCandidate(named), false);
    assert.equal(transferOwnership(named), null);
    assert.equal(ledger.isIncome(named), true);
  }
});

test('manual and explicit own transfers remain own without inventing a partner', () => {
  for (const t of [
    row('manual', 'expense', { source: 'manual', smsKey: undefined, isTransfer: true, transferEvidence: undefined }),
    row('legacy', 'expense', { title: 'Own account transfer', isTransfer: true, transferEvidence: undefined }),
    row('explicit', 'expense', { transferEvidence: { version: 1, currency: 'SAR', attribution: 'source', explicitOwn: true } }),
  ]) {
    const r = reconcileTransfers([t], accounts);
    assert.equal(transferOwnership(t), 'own');
    assert.equal(r.byId.get(t.id).status, 'counterpart-missing');
    assert.equal(r.internalIds.has(t.id), true);
    assert.equal(r.pendingIds.has(t.id), false);
  }
});

test('strong same-bank reference pairs reciprocally and persists valid signatures', () => {
  const rows = pair();
  const before = clone(rows);
  const r = reconcileTransfers(rows, accounts);
  assert.deepEqual(sorted(r.internalIds), ['in', 'out']);
  assert.equal(r.byId.get('out').reason, 'reference');
  const normalized = normalizeTransferLinks(rows, accounts);
  assert.equal(normalized[0].transferMatch.counterpartId, 'in');
  assert.equal(normalized[1].transferMatch.counterpartId, 'out');
  assert.equal(normalized[0].transferMatch.signature, transferFingerprint(normalized[0]));
  assert.deepEqual(clone(rows), before, 'pure reconciliation cannot mutate financial rows');
  assert.equal(normalizeTransferLinks(normalized, accounts), normalized, 'no-op normalization preserves array identity');
});

test('reciprocal instruments can prove transfers across different banks and reference scopes', () => {
  const ac = [accounts[0], bank('b', '2222', 'Saudi National Bank')];
  const rows = [row('out', 'expense', { transferEvidence: { version: 1, currency: 'SAR',
    attribution: 'source', reference: 'FIRST984512', counterparty: instrument(ac[1]) } }),
  row('in', 'income', { captureInstrument: instrument(ac[1]), transferEvidence: {
    version: 1, currency: 'SAR', attribution: 'source', reference: 'OTHER843298', counterparty: instrument(ac[0]) } })];
  assert.deepEqual(sorted(reconcileTransfers(rows, ac).internalIds), ['in', 'out']);
  assert.equal(reconcileTransfers(rows, ac).byId.get('out').reason, 'reciprocal-instruments');
});

test('conflicting same-bank references reject even reciprocal instruments', () => {
  const rows = pair();
  rows[0].transferEvidence.counterparty = instrument(accounts[1]);
  rows[1].transferEvidence.counterparty = instrument(accounts[0]);
  rows[1].transferEvidence.reference = 'DIFFERENT99381';
  assert.deepEqual(sorted(reconcileTransfers(rows, accounts).internalIds), []);
});

test('partial counterparty contradictions block shared references even when its bank is missing', () => {
  for (const counterparty of [
    { last4: '9999', kind: 'account' }, { last4: '2222', kind: 'credit' },
    { last4: '2222', kind: 'unknown', bankIdentity: 'FAB' },
  ]) {
    const rows = pair(); rows[0].transferEvidence.counterparty = counterparty;
    assert.deepEqual(sorted(reconcileTransfers(rows, accounts).internalIds), [], JSON.stringify(counterparty));
  }
});

test('unattributed bank placeholders cannot prove ownership', () => {
  for (const bankName of ['Unknown', 'Bank', '__unattributed__', 'N/A']) {
    const ac = [bank('a', '1111', bankName), bank('b', '2222', bankName)];
    const rows = pair({ captureInstrument: instrument(ac[0]) }, { captureInstrument: instrument(ac[1]) });
    assert.deepEqual(sorted(reconcileTransfers(rows, ac).internalIds), [], bankName);
  }
});

test('reference alone does not bridge bank brands and common placeholders are not proof', () => {
  for (const reference of ['1', '20260908', '08/09/2026', '0000000000', '1234567890', 'UNKNOWN', 'REF', 'ABCABCABC']) {
    const rows = pair();
    for (const t of rows) t.transferEvidence.reference = reference;
    assert.deepEqual(sorted(reconcileTransfers(rows, accounts).internalIds), [], reference);
  }
  const ac = [bank('a', '1111', 'Liv'), bank('b', '2222', 'Emirates NBD')];
  const rows = pair({ captureInstrument: instrument(ac[0]) }, { captureInstrument: instrument(ac[1]) });
  assert.deepEqual(sorted(reconcileTransfers([...rows], ac).internalIds), []);
});

test('a reference reused across amounts or dates is not isolated into apparently unique payment pairs', () => {
  for (const later of [NOW, NOW + 30 * 86400000]) {
    const rows = [...pair(), ...pair({ id: 'second-out', amountFils: 5000, ts: later },
      { id: 'second-in', amountFils: 5000, ts: later })];
    for (const t of rows) t.transferEvidence.reference = 'ACCOUNT98765';
    assert.deepEqual(sorted(reconcileTransfers(rows, accounts).internalIds), []);
    assert.equal(reconcileTransfers(rows, accounts).pendingIds.size, 4);
  }
});

test('reviewing other uses of a reused bank reference cannot turn it into unique proof', () => {
  for (const disqualification of [{ userEdited: true }, { category: 'salary', title: 'Salary' },
    { paymentFlowSide: 'funding' }, { cardPaymentSide: 'receipt' },
    { transferEvidence: { version: 1, currency: 'AED', attribution: 'fallback' } },
    { amountFils: 0 }, { originalCurrency: 'USD' }, {
    transferDecision: { version: 1, ownership: 'external', decidedAt: NOW },
  }]) {
    const rows = [...pair(), ...pair({ id: 'second-out', amountFils: 5000, ...disqualification },
      { id: 'second-in', amountFils: 5000, ...disqualification })];
    for (const t of rows) t.transferEvidence.reference = 'ACCOUNT98765';
    assert.deepEqual(sorted(reconcileTransfers(rows, accounts).internalIds), []);
  }
});

test('reciprocal instrument proof remains usable when the bank reuses its reference', () => {
  const rows = [...pair(), ...pair({ id: 'second-out', amountFils: 5000 }, { id: 'second-in', amountFils: 5000 })];
  for (const t of rows) {
    t.transferEvidence.reference = 'ACCOUNT98765';
    t.transferEvidence.counterparty = instrument(t.type === 'expense' ? accounts[1] : accounts[0]);
  }
  const r = reconcileTransfers(rows, accounts);
  assert.deepEqual(sorted(r.internalIds), ['in', 'out', 'second-in', 'second-out']);
  for (const assessment of r.byId.values()) assert.equal(assessment.reason, 'reciprocal-instruments');
});

test('archived accounts still establish identity but missing, cash, credit and duplicate identities do not', () => {
  assert.deepEqual(sorted(reconcileTransfers(pair(), [accounts[0], { ...accounts[1], archived: true }]).internalIds), ['in', 'out']);
  for (const ac of [
    [accounts[0]], [accounts[0], { ...accounts[1], kind: 'cash' }],
    [accounts[0], { ...accounts[1], kind: 'card', cardType: 'credit' }],
    [...accounts, { ...accounts[1], id: 'duplicate' }],
  ]) assert.deepEqual(sorted(reconcileTransfers(pair(), ac).internalIds), []);
});

test('fallback attribution, unknown instrument kind and editable routing are not ownership proof', () => {
  for (const change of [
    t => { t.transferEvidence.attribution = 'fallback'; },
    t => { delete t.captureInstrument.bankIdentity; },
    t => { t.captureInstrument.kind = 'unknown'; },
    t => { t.captureInstrument.last4 = '9999'; },
    t => { t.accountId = 'c'; },
    t => { t.userEdited = true; },
  ]) {
    const rows = pair(); change(rows[0]);
    assert.deepEqual(sorted(reconcileTransfers(rows, accounts).internalIds), []);
  }
});

test('bank normalization preserves Unicode banks and resolves known aliases', () => {
  const ac = [bank('a', '1111', 'بنك أول'), bank('b', '2222', 'بنك أول')];
  const rows = pair({ captureInstrument: instrument(ac[0]) }, { captureInstrument: instrument(ac[1]) });
  assert.deepEqual(sorted(reconcileTransfers(rows, ac).internalIds), ['in', 'out']);
  rows[1].captureInstrument.bankIdentity = 'بنك ثان';
  assert.deepEqual(sorted(reconcileTransfers([...rows], ac).internalIds), []);
  const aliases = [bank('a', '1111', 'ADCB'), bank('b', '2222', 'ADCB')];
  const compatible = pair({ captureInstrument: { last4: '1111', kind: 'account', bankIdentity: 'adcb' } });
  assert.deepEqual(sorted(reconcileTransfers(compatible, aliases).internalIds), ['in', 'out']);
});

test('original currency and minor amounts govern matching, never converted-base coincidences', () => {
  for (const currency of ['AED', 'SAR', 'USD', 'JPY', 'KWD']) {
    const rows = pair({ originalCurrency: currency, originalAmountMinor: 1250, amountFils: 4530 },
      { originalCurrency: currency, originalAmountMinor: 1250, amountFils: 4590 });
    for (const t of rows) t.transferEvidence.currency = currency;
    assert.deepEqual(sorted(reconcileTransfers(rows, accounts).internalIds), ['in', 'out'], currency);
  }
  for (const extra of [
    { originalCurrency: 'USD', originalAmountMinor: 10000 },
    { originalAmountMinor: 10000 }, { originalCurrency: 'AED' },
    { amountFils: 10001 }, { fxSource: 'fallback' }, { amountFils: NaN },
  ]) assert.deepEqual(sorted(reconcileTransfers(pair(extra), accounts).internalIds), []);
});

test('time windows accept three days exactly including year/leap boundaries but never invalid clocks', () => {
  for (const start of ['2024-02-28T23:59:59Z', '2025-12-31T23:59:59Z']) {
    const at = Date.parse(start);
    assert.deepEqual(sorted(reconcileTransfers(pair({ ts: at }, { ts: at + 3 * 86400000 }), accounts).internalIds), ['in', 'out']);
    assert.deepEqual(sorted(reconcileTransfers(pair({ ts: at }, { ts: at + 3 * 86400000 + 1 }), accounts).internalIds), []);
  }
  for (const ts of [NaN, Infinity, -1, '1788861600000', 9e17]) {
    assert.deepEqual(sorted(reconcileTransfers(pair({ ts }), accounts).internalIds), []);
  }
  assert.deepEqual(sorted(reconcileTransfers(pair({ ts: undefined, smsKey: 'h-missing-clock' }), accounts).internalIds), []);
  assert.deepEqual(sorted(reconcileTransfers(pair({ ts: undefined }), accounts).internalIds), ['in', 'out']);
});

test('competing three-way matches stay ambiguous, independent of input order', () => {
  const rows = pair();
  rows.push({ ...clone(rows[1]), id: 'third', accountId: 'c', captureInstrument: instrument(accounts[2]) });
  for (const input of [rows, [...rows].reverse()]) {
    const r = reconcileTransfers(input, accounts);
    assert.deepEqual(sorted(r.internalIds), []);
    assert.deepEqual(sorted(r.pendingIds), ['in', 'out', 'third']);
    for (const t of rows) assert.equal(r.byId.get(t.id).status, 'ambiguous');
  }
});

test('user decisions override inference and undo returns low-signal transfers to normal cash flow', () => {
  const rows = [row('out')];
  const decided = applyTransferDecision(rows, accounts, request(rows, ['out'], 'external'));
  assert.equal(transferOwnership(decided[0]), 'external');
  assert.equal(reconcileTransfers(decided, accounts).byId.get('out').status, 'confirmed-external');
  const undone = applyTransferDecision(decided, accounts, request(decided, ['out'], null));
  assert.equal(transferOwnership(undone[0]), 'unknown');
  assert.equal(undone[0].transferDecision, undefined);
  assert.equal(reconcileTransfers(undone, accounts).pendingIds.has('out'), false);
});

test('valid user ownership survives later semantic changes and remains undoable', () => {
  for (const patch of [
    { category: 'business', title: 'Business receipt' }, { category: 'salary', title: 'Salary' },
    { title: 'Cashback credit' }, { title: 'Card payment', cardPaymentSide: 'receipt' },
    { title: 'Utility payment', paymentFlowSide: 'funding' },
  ]) {
    const initial = [row('reviewed')];
    const decided = applyTransferDecision(initial, accounts, request(initial, ['reviewed'], 'own'));
    const changed = [{ ...decided[0], ...patch }];
    assert.equal(transferOwnership(changed[0]), 'own', JSON.stringify(patch));
    assert.equal(reconcileTransfers(changed, accounts).internalIds.has('reviewed'), true);
    const undone = applyTransferDecision(changed, accounts, request(changed, ['reviewed'], null));
    assert.equal(undone[0].transferDecision, undefined);
    assert.equal(isTransferCandidate(undone[0]), false, 'semantic exclusions apply again after undo');
  }
});

test('explicit manual pairing is atomic, reciprocal, and can represent known fees or FX', () => {
  const rows = pair({ amountFils: 10300, userEdited: true }, { amountFils: 10000 });
  const decided = applyTransferDecision(rows, accounts, request(rows, ['out'], 'own', { counterpartId: 'in' }));
  assert.equal(decided[0].transferDecision.counterpartId, 'in');
  assert.equal(decided[1].transferDecision.counterpartId, 'out');
  assert.equal(decided[0].transferMatch.basis, 'user');
  assert.deepEqual(sorted(reconcileTransfers(decided, accounts).internalIds), ['in', 'out']);
  assert.equal(rows[0].transferDecision, undefined);
});

test('decisions reject stale fingerprints, unknown IDs, same direction and partner stealing before any changes', () => {
  const rows = pair();
  const before = clone(rows);
  for (const req of [
    request(rows, ['out', 'missing'], 'own'),
    request(rows, ['out'], 'external', { expectedFingerprints: { out: 'stale' } }),
    request(rows, ['out'], 'own', { counterpartId: 'out' }),
    request(rows, ['out'], 'own', { counterpartId: 'in', expectedFingerprints: { out: transferFingerprint(rows[0]) } }),
  ]) assert.throws(() => applyTransferDecision(rows, accounts, req));
  const sameDirection = [rows[0], { ...rows[1], type: 'expense' }];
  assert.throws(() => applyTransferDecision(sameDirection, accounts, request(sameDirection, ['out'], 'own', { counterpartId: 'in' })));
  const linked = applyTransferDecision(rows, accounts, request(rows, ['out'], 'own', { counterpartId: 'in' }));
  linked.push(row('third', 'expense', { accountId: 'c', captureInstrument: instrument(accounts[2]) }));
  assert.throws(() => applyTransferDecision(linked, accounts, request(linked, ['third'], 'own', { counterpartId: 'in' })));
  assert.deepEqual(clone(rows), before);
});

test('undo unlinks both sides while preserving the counterpart ownership decision', () => {
  const rows = pair({ transferEvidence: undefined }, { transferEvidence: undefined });
  const linked = applyTransferDecision(rows, accounts, request(rows, ['out'], 'own', { counterpartId: 'in' }));
  const undone = applyTransferDecision(linked, accounts, request(linked, ['out'], null));
  assert.equal(undone[0].transferDecision, undefined);
  assert.equal(undone[1].transferDecision.ownership, 'own');
  assert.equal(undone[1].transferDecision.counterpartId, undefined);
  assert.equal(undone[0].transferMatch, undefined);
  assert.equal(undone[1].transferMatch, undefined);
});

test('edits, deletes, remaps and one-sided restored links cannot preserve stale partners', () => {
  const linked = normalizeTransferLinks(pair(), accounts);
  const edited = clone(linked); edited[0].amountFils += 1; edited[0].userEdited = true;
  for (const rows of [edited, [linked[0]], [{ ...linked[0], accountId: 'c' }, linked[1]]]) {
    const cleaned = normalizeTransferLinks(rows, accounts);
    assert.ok(cleaned.every(t => t.transferMatch === undefined));
  }
  const manual = applyTransferDecision(pair(), accounts, request(pair(), ['out'], 'own', { counterpartId: 'in' }));
  const alone = normalizeTransferLinks([manual[0]], accounts)[0];
  assert.equal(alone.transferDecision.ownership, 'own');
  assert.equal(alone.transferDecision.counterpartId, undefined);
  assert.equal(alone.transferMatch, undefined);
  const broken = clone(linked); delete broken[1].transferMatch;
  assert.ok(normalizeTransferLinks(broken, accounts).every(t => !t.transferMatch));
});

test('malformed backup-like evidence, decisions and links fail closed without crashing', () => {
  for (const invalid of [null, [], 'own', { version: 2, ownership: 'own', decidedAt: NOW },
    { version: 1, ownership: 'own', decidedAt: Infinity }, { version: 1, ownership: 'own', decidedAt: NOW, counterpartId: 5 }]) {
    const t = row('x', 'expense', { transferDecision: invalid });
    assert.notEqual(transferOwnership(t), 'own');
    assert.doesNotThrow(() => normalizeTransferLinks([t], accounts));
  }
  for (const evidence of [null, [], { version: 1, currency: 5, attribution: 'source' },
    { version: 1, currency: 'AED', attribution: 'source', counterparty: { last4: 1111 } }]) {
    assert.deepEqual(sorted(reconcileTransfers(pair({ transferEvidence: evidence }), accounts).internalIds), []);
  }
});

test('backup validators reject object-valued enum fields without coercion or exceptions', () => {
  for (const bad of [{ toString: null }, { toString: 4 }, {}]) {
    assert.equal(core.isTransferEvidence({ version: 1, currency: 'AED', attribution: 'source',
      counterparty: { last4: '1111', kind: bad, bankIdentity: 'ADCB' } }), false);
    assert.equal(core.isTransferMatch({ version: 1, counterpartId: 'x', basis: bad,
      signature: `tr1:${'a'.repeat(64)}`, counterpartSignature: `tr1:${'b'.repeat(64)}` }), false);
  }
});

test('invalid cyclic metadata cannot crash normalization and is removed', () => {
  const decision = { version: 1, ownership: 'own', decidedAt: -1 };
  decision.loop = decision;
  const match = { version: 2 }; match.loop = match;
  const tx = row('x', 'expense', { transferDecision: decision, transferMatch: match });
  const result = normalizeTransferLinks([tx], accounts);
  assert.equal(result[0].transferDecision, undefined);
  assert.equal(result[0].transferMatch, undefined);
});

test('only four contiguous digits are an instrument tail; masking gaps cannot establish ownership', () => {
  for (const last4 of ['11XX11', 'XXX11-11', '111', '11111', 1111, '١١١١']) {
    const rows = pair({ captureInstrument: { kind: 'account', last4, bankIdentity: 'ADCB' } });
    assert.deepEqual(sorted(reconcileTransfers(rows, accounts).internalIds), []);
  }
});

test('reconciliation reuses only the last immutable array pair and recomputes fresh ledgers', () => {
  const rows = pair();
  const result = reconcileTransfers(rows, accounts);
  assert.equal(reconcileTransfers(rows, accounts), result);
  const changed = rows.map(t => t.id === 'out' ? { ...t, amountFils: 1 } : t);
  assert.deepEqual(sorted(reconcileTransfers(changed, accounts).internalIds), []);
  assert.notEqual(reconcileTransfers(rows, [...accounts]), result);
});

test('low-signal counterparty hints do not create transfer-review backlog or false ownership', () => {
  const rows = [row('one'), row('two'), row('known1', 'expense', { transferEvidence: {
    version: 1, currency: 'AED', attribution: 'source', counterparty: instrument(accounts[2]) } }),
  row('known2', 'expense', { transferEvidence: {
    version: 1, currency: 'AED', attribution: 'source', counterparty: instrument(accounts[2]) } })];
  const r = reconcileTransfers(rows, accounts);
  assert.equal(r.groups.length, 0);
  assert.equal(r.pendingIds.size, 0);
  assert.equal(r.internalIds.has('known1'), false);
  assert.equal(r.internalIds.has('known2'), false);
  assert.deepEqual(r.groups.map(g => g.id).sort(), reconcileTransfers([...rows].reverse(), accounts).groups.map(g => g.id).sort());
});

test('bulk decisions reject low-signal or already-auto-resolved transfers at the atomic resolver boundary', () => {
  const knownEvidence = { version: 1, currency: 'AED', attribution: 'source',
    counterparty: instrument(accounts[2]) };
  const unknown = [row('one'), row('two')];
  const known = [row('one', 'expense', { transferEvidence: knownEvidence }),
    row('two', 'expense', { transferEvidence: knownEvidence }),
    row('three', 'expense', { transferEvidence: knownEvidence })];
  for (const ownership of ['own', 'external']) {
    for (const rows of [unknown,
      [known[0], row('two')],
      [known[0], { ...known[1], accountId: 'b' }],
      [known[0], { ...known[1], type: 'income' }],
      [known[0], { ...known[1], transferEvidence: { ...knownEvidence, attribution: 'fallback' } }],
    ]) {
      const before = clone(rows);
      assert.throws(() => applyTransferDecision(rows, accounts, request(rows, ['one', 'two'], ownership)),
        /counterparty|group/i);
      assert.deepEqual(clone(rows), before, 'rejected bulk decisions change nothing');
    }
    assert.throws(() => applyTransferDecision(known, accounts, request(known, ['one', 'two'], ownership)),
      /counterparty|group/i, 'automatically resolved ownership is corrected individually, not via a catchall bulk action');
  }
});

test('12,000 repeated amounts/reference collisions remain bounded and never greedily pair', () => {
  const rows = Array.from({ length: 12000 }, (_, i) => row(`load-${i}`, i % 2 ? 'income' : 'expense', {
    transferEvidence: { version: 1, currency: 'AED', attribution: 'source', reference: 'COLLISION984512' },
  }));
  const at = performance.now();
  const r = reconcileTransfers(rows, accounts);
  assert.equal(r.internalIds.size, 0);
  assert.equal(r.pendingIds.size, 12000);
  assert.ok(performance.now() - at < 5000, 'bounded evidence scans should not become quadratic');
});
