'use strict';
/**
 * PRIVATE real-UAE benchmark over the owner's own exported SMS + ledger backup.
 *
 * The export is read IN PLACE from the path given on the command line. This
 * script prints and writes AGGREGATE METRICS ONLY — never message text,
 * senders, card fragments, merchants or amounts. With --dump <dir> it writes
 * weak-labelled rows for the model probe to a SCRATCH directory (the caller
 * must keep that outside the repository and delete it afterwards).
 *
 * Weak labels: a message joined to a ledger transaction (by capture timestamp,
 * unique matches only) is a posting with that row's amount/direction/title/
 * category/date. The ledger is itself an earlier parser's output plus the
 * owner's edits/deletions, so agreement measures regression + owner
 * acceptance, not independent truth. Unjoined money-bearing messages whose
 * wording is clearly OTP / promotion / pending-hold / declined are weak
 * negatives. Everything else is unlabelled and excluded from field scoring.
 *
 *   node scripts/parser-ai/private-uae.cjs <export.json> [--json out] [--dump dir]
 */
const fs = require('node:fs');
const path = require('node:path');
const { runLedger } = require('./pipeline.cjs');
const { evaluate } = require('./run-baseline.cjs');
const { createLoader } = require('../universal-test/load-ts.cjs');
const { merchantMatch } = require('./schema.cjs');

const load = createLoader();
const launch = load('@/lib/launch-alert-parser');

const CUES = [
  ['otp', /\botp\b|one[-\s]?time\s+pass|verification\s+code|\bpasscode\b|رمز\s+(?:التحقق|التفعيل|سري)|كلمة\s+(?:المرور|السر)/iu],
  ['declined', /\bdeclined\b|\bunsuccessful\b|\bfailed\b|\binsufficient\b|مرفوض|رفض|فشل|تعذر/iu],
  ['pending', /\bpending\b|\bon\s+hold\b|\bauthori[sz]ation\s+(?:hold|request)\b|\bblocked\s+amount\b|معلق|قيد\s+(?:المعالجة|التنفيذ)/iu],
  ['promo', /\bcashback\b|\boffer\b|\bdiscount\b|\bpromo|\bvoucher\b|\bwin\b|\bearn\b\s+\d|%\s*off|عرض|تخفيض|اربح/iu],
];

/** Weak-labelled rows (with the joined ledger row as `tx`) plus join statistics. */
function buildPrivateUaeRowsWithStats(file) {
  const data = JSON.parse(fs.readFileSync(file, 'utf8'));
  const messages = data.sms.messages;
  const txs = data.backup.data.transactions;
  const byTs = new Map();
  messages.forEach((m, i) => byTs.set(m.receivedAtMs, [...(byTs.get(m.receivedAtMs) ?? []), i]));
  const txByMsg = new Map();
  let ambiguousJoin = 0;
  for (const t of txs) {
    const hits = byTs.get(t.ts) ?? [];
    if (hits.length !== 1) { ambiguousJoin++; continue; }
    txByMsg.set(hits[0], [...(txByMsg.get(hits[0]) ?? []), t]);
  }

  const rows = [];
  const cueCounts = {};
  let moneyUnjoined = 0;
  let unjoinedUncuedPosted = 0;
  messages.forEach((m, i) => {
    const linked = txByMsg.get(i);
    const base = { id: `uae:${i}`, source: 'private-uae', country: 'AE', language: /[؀-ۿ]/u.test(m.body) ? 'ar' : 'en', bank: null, sender: m.sender ?? '', template: 'private', split: 'eval', body: m.body };
    if (linked && linked.length === 1) {
      const t = linked[0];
      const foreign = t.originalCurrency && t.originalCurrency !== 'AED';
      rows.push({ ...base, weak: 'ledger', tx: t, label: {
        status: 'completed', shouldPost: true, family: undefined,
        direction: t.type === 'income' ? 'credit' : 'debit',
        amount: foreign ? undefined : { minor: String(t.amountFils), currency: 'AED', exponent: 2 },
        merchant: t.isTransfer ? undefined : t.title,
        date: undefined,
      } });
      return;
    }
    if (linked) return; // one message -> several ledger rows: skip
    if (!launch.hasBankAlertMoneyHint(m.body)) return;
    moneyUnjoined++;
    const cue = CUES.find(([, re]) => re.test(m.body));
    if (!cue) {
      if (runLedger(base).posted) unjoinedUncuedPosted++;
      return;
    }
    cueCounts[cue[0]] = (cueCounts[cue[0]] ?? 0) + 1;
    rows.push({ ...base, weak: `cue:${cue[0]}`, label: { status: cue[0], shouldPost: false, family: 'non-posting', direction: 'none' } });
  });
  return { rows, messages, txs, ambiguousJoin, moneyUnjoined, unjoinedUncuedPosted, cueCounts };
}

const buildPrivateUaeRows = (file) => buildPrivateUaeRowsWithStats(file).rows;

function main() {
  const [file] = process.argv.slice(2);
  const jsonOut = process.argv.includes('--json') ? process.argv[process.argv.indexOf('--json') + 1] : null;
  const dump = process.argv.includes('--dump') ? process.argv[process.argv.indexOf('--dump') + 1] : null;
  if (!file) throw new Error('usage: private-uae.cjs <export.json>');
  const { rows, messages, txs, ambiguousJoin, moneyUnjoined, unjoinedUncuedPosted, cueCounts } = buildPrivateUaeRowsWithStats(file);

  // Field agreement with the ledger beyond the scorer: category, date, transfer flag.
  const agree = { n: 0, posted: 0, amount: 0, amountN: 0, direction: 0, merchantStrict: 0, merchantLoose: 0, merchantN: 0,
    category: 0, date: 0, dateN: 0, transfer: 0 };
  const catConfusion = {};
  for (const row of rows) {
    if (row.weak !== 'ledger') continue;
    const t = row.tx;
    agree.n++;
    const p = runLedger(row);
    if (!p.posted) continue;
    agree.posted++;
    if (row.label.amount) { agree.amountN++; if (p.amount.minor === row.label.amount.minor || p.amount.minor === String(t.amountFils)) agree.amount++; }
    if (p.direction === row.label.direction) agree.direction++;
    if (row.label.merchant) {
      agree.merchantN++;
      const mm = merchantMatch(p.merchant, row.label.merchant);
      if (mm.strict) agree.merchantStrict++;
      if (mm.loose) agree.merchantLoose++;
    }
    if (p.category === t.category) agree.category++;
    else { const k = `${t.category}->${p.category}`; catConfusion[k] = (catConfusion[k] ?? 0) + 1; }
    if (p.date && t.date) { agree.dateN++; if (t.date.startsWith(p.date)) agree.date++; }
    if (!!t.isTransfer === (p.family === 'transfer')) agree.transfer++;
  }
  const r = (a, b) => (b ? Number((a / b).toFixed(4)) : null);
  const scored = evaluate(rows, ['weak']);
  const report = {
    messages: messages.length, ledgerRows: txs.length, ledgerRowsNotUniquelyJoined: ambiguousJoin,
    joinedPostings: rows.filter((x) => x.weak === 'ledger').length, moneyBearingUnjoined: moneyUnjoined, weakNegativesByCue: cueCounts,
    postedAmongUnjoinedUncued: unjoinedUncuedPosted,
    currentParserVsLedger: {
      recallOnLedgerRows: r(agree.posted, agree.n), amount: r(agree.amount, agree.amountN), direction: r(agree.direction, agree.posted),
      merchantStrict: r(agree.merchantStrict, agree.merchantN), merchantLoose: r(agree.merchantLoose, agree.merchantN),
      category: r(agree.category, agree.posted), transferFlag: r(agree.transfer, agree.posted), dateWhenStated: r(agree.date, agree.dateN),
      topCategoryDisagreements: Object.entries(catConfusion).sort((a, b) => b[1] - a[1]).slice(0, 8),
    },
    falsePostsOnWeakNegatives: scored.falsePostsByStatus,
    byWeakLabel: Object.fromEntries(Object.entries(scored.weak).map(([k, s]) => [k, { n: s.n, posted: k === 'ledger' ? s.ledger.autoPostRecall : s.ledger.falsePostRate }])),
    ledgerLatencyMs: scored.ledgerLatencyMs,
  };
  if (jsonOut) fs.writeFileSync(jsonOut, JSON.stringify(report, null, 1) + '\n');
  if (dump) {
    // Message text may only be written OUTSIDE the repository (scratch).
    const repoRoot = path.resolve(__dirname, '../..');
    if (path.resolve(dump).startsWith(repoRoot + path.sep) || path.resolve(dump) === repoRoot) {
      throw new Error('--dump must be outside the repository');
    }
    fs.mkdirSync(dump, { recursive: true });
    fs.writeFileSync(path.join(dump, 'uae_private.jsonl'), rows.map(({ tx, ...row }) => JSON.stringify(row)).join('\n') + '\n');
  }
  console.log(JSON.stringify(report, null, 1));
}

if (require.main === module) main();
module.exports = { buildPrivateUaeRows };
