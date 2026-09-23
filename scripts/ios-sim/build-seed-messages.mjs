#!/usr/bin/env node
// Turns the repository's public, redacted bank-alert corpus into rows a
// simulator Messages database can be seeded with (see seed-sms-db.py).
//
// Sources (all already public in this repository, none is a real customer's
// message): the named UAE and Saudi fixtures, the app-exported UAE accuracy
// reports, and the global near-real templates. Every row gets a stable GUID,
// a sender label inferred from the bank the body names, and a distinct
// second-resolution date spread backwards from the run time so the paged
// history graph's 90-day windows and its one-second overlap rule are both
// exercised.
//
// usage: node scripts/ios-sim/build-seed-messages.mjs [out.json] [--days 80] [--now ISO]
import { createHash } from 'node:crypto';
import { readFileSync, writeFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { resolve } from 'node:path';

const require = createRequire(import.meta.url);
const root = resolve(new URL('.', import.meta.url).pathname, '..', '..');

const args = process.argv.slice(2);
const flag = (name, fallback) => {
  const at = args.indexOf(name);
  return at === -1 ? fallback : args[at + 1];
};
const out = args.find((a, i) => !a.startsWith('--') && (i === 0 || !args[i - 1].startsWith('--'))) ?? null;
const days = Number(flag('--days', '80'));
const nowMs = Date.parse(flag('--now', new Date().toISOString()));
if (!Number.isFinite(days) || days <= 0 || !Number.isFinite(nowMs)) {
  console.error('usage: build-seed-messages.mjs [out.json] [--days N] [--now ISO]');
  process.exit(2);
}

// Sender labels as UAE/Saudi banks actually present them on an iPhone. The
// body-based lookup is deliberately simple: this only decides which
// conversation a seeded row lands in, not how Wafra parses it.
const SENDER_BY_BANK = {
  ENBD: 'EmiratesNBD', ADCB: 'ADCB', FAB: 'FAB', Mashreq: 'Mashreq', ADIB: 'ADIB',
  RAKBANK: 'RAKBANK', Liv: 'Liv', Wio: 'Wio', HSBC: 'HSBC', CBD: 'CBD', DIB: 'DIB',
  'Bank Albilad': 'Albilad', 'Al Rajhi': 'AlRajhi', SNB: 'SNB', Riyad: 'RiyadBank',
};
const BODY_HINTS = [
  [/emirates\s*nbd|\bENBD\b/i, 'EmiratesNBD'], [/\bADCB\b/i, 'ADCB'], [/\bFAB\b|first abu dhabi/i, 'FAB'],
  [/mashreq/i, 'Mashreq'], [/\bADIB\b/i, 'ADIB'], [/rakbank/i, 'RAKBANK'], [/\bliv\b/i, 'Liv'],
  [/\bwio\b/i, 'Wio'], [/\bHSBC\b/i, 'HSBC'], [/\bCBD\b/i, 'CBD'], [/\bDIB\b/i, 'DIB'],
  [/albilad|البلاد/i, 'Albilad'], [/rajhi|الراجحي/i, 'AlRajhi'], [/\bSNB\b|الأهلي/i, 'SNB'],
];
const senderFor = (row) => {
  if (typeof row.sender === 'string' && row.sender.trim()) return row.sender.trim();
  if (row.bank && SENDER_BY_BANK[row.bank]) return SENDER_BY_BANK[row.bank];
  for (const [re, label] of BODY_HINTS) if (re.test(row.body)) return label;
  return 'BankAlerts';
};

// The "#N (seen Nx):" export the app produces; same reader as scripts/test/corpus.js.
const readReport = (file) => {
  const blocks = [];
  let cur = null;
  for (const line of readFileSync(file, 'utf8').split('\n')) {
    const head = line.match(/^#(\d+)\s+\(seen[^)]*\):\s*$/);
    if (head) { if (cur) blocks.push(cur); cur = { n: Number(head[1]), lines: [] }; continue; }
    if (cur) cur.lines.push(line);
  }
  if (cur) blocks.push(cur);
  return blocks
    .map((b) => ({ id: `${file.split('/').pop()}#${b.n}`, body: b.lines.join('\n').replace(/\n{2,}[\s\S]*$/, '').trim() }))
    .filter((b) => b.body);
};

const sources = [
  ...require(resolve(root, 'scripts/test/fixtures/uae-bank-formats.js')),
  ...require(resolve(root, 'scripts/test/fixtures/saudi-bank-formats.js')),
  ...readReport(resolve(root, 'scripts/test/fixtures/uae-accuracy-report.txt')),
  ...readReport(resolve(root, 'scripts/test/fixtures/uae-accuracy-report-2.txt')),
  ...require(resolve(root, 'scripts/test/fixtures/global-alert-formats.js')),
].filter((r) => typeof r.body === 'string' && r.body.trim() && (r.channel ?? 'sms') === 'sms');

// Newest first, one row every (days / n) with a deterministic jitter so
// timestamps are irregular but never share a second.
const step = Math.max(2, Math.floor((days * 86_400) / sources.length));
const rows = sources.map((r, i) => {
  const digest = createHash('sha256').update(`wafra-sim-seed:${r.id}:${r.body}`).digest('hex');
  const jitter = parseInt(digest.slice(0, 4), 16) % Math.max(1, step - 1);
  const atMs = nowMs - 60_000 - i * step * 1000 - jitter * 1000;
  const guid = `${digest.slice(0, 8)}-${digest.slice(8, 12)}-4${digest.slice(13, 16)}-8${digest.slice(17, 20)}-${digest.slice(20, 32)}`.toUpperCase();
  return { guid, sender: senderFor(r), body: r.body, date: new Date(Math.floor(atMs / 1000) * 1000).toISOString(), source: r.id };
});

const seen = new Set();
for (const row of rows) {
  if (seen.has(row.guid) || seen.has(row.date)) throw new Error(`duplicate seed key for ${row.source}`);
  seen.add(row.guid); seen.add(row.date);
}

const json = JSON.stringify({ v: 1, generatedAt: new Date(nowMs).toISOString(), days, rows }, null, 2);
if (out) { writeFileSync(out, json); console.error(`wrote ${rows.length} rows to ${out}`); }
else process.stdout.write(json + '\n');
