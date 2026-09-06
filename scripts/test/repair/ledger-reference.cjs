'use strict';
// Behavioural reference: internalTransferIds at Android build 131 / b96b253.
// Keep this deliberately unoptimized for differential regression tests.
module.exports = function reference(transactions, accounts) {
  const accountIds = Array.isArray(accounts)
    ? new Set(accounts.map((a) => a.id))
    : new Set(transactions.map((t) => t.accountId));
  const paired = new Set();
  const outgoing = new Map();
  for (const t of transactions) {
    if (t.type !== 'expense' || !accountIds.has(t.accountId) ||
      !(t.isTransfer === true || /^(?:outgoing|bank|own account|self|savings) transfer$/i.test(t.title.trim()))) continue;
    const list = outgoing.get(t.amountFils);
    if (list) list.push(t);
    else outgoing.set(t.amountFils, [t]);
  }
  const DAY = 86400000;
  for (const t of transactions) {
    if (t.type !== 'income' || t.isTransfer || !accountIds.has(t.accountId) || t.category === 'salary' ||
      !/^(?:(?:incoming|bank|own account|self) transfer|inward remittance)$/i.test(t.title.trim())) continue;
    const candidates = outgoing.get(t.amountFils);
    if (!candidates) continue;
    const arrived = t.ts ?? Date.parse(`${t.date}T12:00:00Z`);
    const match = candidates.filter((o) => !paired.has(o.id) && o.accountId !== t.accountId &&
      Math.abs((o.ts ?? Date.parse(`${o.date}T12:00:00Z`)) - arrived) <= 3 * DAY)
      .sort((a, b) => Math.abs((a.ts ?? Date.parse(`${a.date}T12:00:00Z`)) - arrived) -
        Math.abs((b.ts ?? Date.parse(`${b.date}T12:00:00Z`)) - arrived))[0];
    if (!match) continue;
    paired.add(match.id);
    paired.add(t.id);
  }
  return paired;
};
