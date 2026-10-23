'use strict';
/**
 * Template-drift suite. For every generated POSITIVE that the parser books
 * correctly on a path, derive K label-preserving drift variants and measure
 * "drift survival": the share that still book with the identical amount,
 * currency, direction and kind. A variant that books WRONG money is unsafe
 * (must be 0); a variant that is not booked is only lost recall.
 *
 * Operators work in the alert's own language and stay inside the market's
 * real conventions. Two kinds:
 *  - STRUCTURAL operators re-render the alert from its composed slots
 *    (re-order fields, put the date first, move the card tail, drop the
 *    time / date / tail / balance footer, another money style, number
 *    grouping or date style of the same market, bank-name prefix on/off).
 *    Their content is the market's own inventory, already DEV/HOLDOUT
 *    split by generate.cjs, so they run in both halves.
 *  - LEXICAL operators edit text with a per-language table (synonyms,
 *    abbreviations, a harmless reference field, connectors, typo words,
 *    trailing emoji, casing, punctuation noise). Each table entry is split
 *    into DEV or HOLDOUT by its content.
 * `combo` applies 2-3 operators in sequence (structural first).
 */
const { rngFor, splitOf, fnv1a } = require('./lib/prng.cjs');
const { formatMoney } = require('./lib/money.cjs');
const { formatDate } = require('./lib/dates.cjs');
const G = require('./generate.cjs');
const { gradePositive, summarize } = require('./lab-eval.cjs');

const { renderBody, moneyPool, datePool, byId } = G.internals;

// Meaning- and direction-preserving word swaps, first match only. Only pairs
// that keep a debit a debit and a credit a credit.
const SYN = {
  en: [['purchase', 'transaction'], ['purchase', 'payment'], ['transaction', 'purchase'], [' at ', ' @ '], ['charged', 'debited'], ['debited', 'charged'], ['debited', 'deducted'], ['spent', 'paid'], ['withdrew', 'took out'], ['sent', 'transferred'], ['received', 'got'], ['refunded', 'returned']],
  de: [['Kartenzahlung', 'Kartenumsatz'], ['Zahlung', 'Umsatz'], ['bezahlt', 'gezahlt'], ['belastet', 'abgebucht'], ['Überweisung', 'Transfer'], ['erhalten', 'bekommen']],
  fr: [['Paiement', 'Achat'], ['chez', 'auprès de'], ['débitée', 'prélevée'], ['reçu', 'encaissé']],
  nl: [['Betaling', 'Pinbetaling'], ['afgeschreven', 'gedebiteerd'], ['ontvangen', 'gekregen']],
  es: [['Compra', 'Pago'], ['Compra', 'Cargo'], ['cargo', 'adeudo'], ['recibido', 'cobrado']],
  pt: [['Compra', 'Pagamento'], ['debitado', 'cobrado'], ['Recebeu', 'Entrou']],
  it: [['Pagamento', 'Acquisto'], ['presso', 'da'], ['addebitato', 'prelevato']],
  pl: [['Płatność', 'Transakcja'], ['Zapłacono', 'Opłacono'], ['Otrzymałeś', 'Dostałeś']],
  cs: [['Platba', 'Transakce'], ['stržena', 'odepsána'], ['Obdrželi jste', 'Přijali jste']],
  sv: [['Köp', 'Kortköp'], ['betalat', 'handlat för'], ['fått', 'tagit emot']],
  da: [['Køb', 'Kortkøb'], ['betalt', 'handlet for'], ['modtaget', 'fået']],
  nb: [['Kjøp', 'Kortkjøp'], ['betalt', 'handlet for'], ['mottatt', 'fått']],
  ar: [['عملية شراء', 'شراء'], ['لدى', 'في'], ['بمبلغ', 'بقيمة'], ['تم خصم', 'خُصم']],
};
const ABBR = {
  en: [['account', 'acct'], ['account', 'A/C'], ['account', 'acc.'], ['Available balance', 'Avl Bal'], ['Available balance', 'Avail. bal.'], ['transaction', 'txn'], ['transaction', 'trx'], ['Amount', 'Amt']],
  de: [['Konto', 'Kto.'], ['Verfügbarer Saldo', 'Verf. Saldo'], ['Kreditkarte', 'KK']],
  fr: [['compte', 'cpte'], ['Solde disponible', 'Solde dispo']],
  nl: [['rekening', 'rek.'], ['Beschikbaar saldo', 'Beschikb. saldo']],
  es: [['cuenta', 'cta.'], ['Saldo disponible', 'Saldo disp.']],
  pt: [['conta', 'cta'], ['Saldo disponível', 'Saldo disp.']],
  it: [['conto', 'c/c'], ['Saldo disponibile', 'Saldo disp.']],
  pl: [['rachunek', 'rach.'], ['Dostępne środki', 'Dost. środki']],
  cs: [['Disponibilní zůstatek', 'Disp. zůstatek'], ['účet', 'úč.']],
  sv: [['Disponibelt belopp', 'Disp. belopp'], ['konto', 'kto']],
  da: [['Disponibel saldo', 'Disp. saldo'], ['konto', 'kto.']],
  nb: [['Disponibelt', 'Disp.'], ['konto', 'kto.']],
  ar: [['الرصيد المتاح', 'الرصيد'], ['بطاقتك المنتهية بـ', 'بطاقتك']],
};
const REF = {
  en: ['Ref: {N}', 'Ref no. {N}', 'Auth code {N}', 'Terminal ID {N}'], de: ['Referenz: {N}', 'Beleg-Nr. {N}'], fr: ['Réf. {N}', 'N° autorisation {N}'],
  nl: ['Kenmerk: {N}', 'Ref. {N}'], es: ['Ref. {N}', 'Nº operación {N}'], pt: ['Ref. {N}', 'N.º operação {N}'], it: ['Rif. {N}', 'Cod. operazione {N}'],
  pl: ['Nr ref. {N}', 'ID transakcji {N}'], cs: ['VS: {N}', 'Ref. {N}'], sv: ['Referens: {N}', 'Ref. {N}'], da: ['Ref.: {N}', 'Bilagsnr. {N}'],
  nb: ['Referanse: {N}', 'Ref. {N}'], ar: ['رقم المرجع {N}', 'Ref: {N}'],
};
const TYPO = {
  en: ['your', 'account', 'ending', 'available', 'details', 'balance'], de: ['Ihre', 'Ihrer', 'Konto', 'Verfügbarer'], fr: ['votre', 'compte', 'disponible'],
  nl: ['uw', 'rekening', 'saldo'], es: ['su', 'cuenta', 'disponible'], pt: ['seu', 'conta', 'disponível'], it: ['tua', 'conto', 'disponibile'],
  pl: ['Twoja', 'rachunku', 'środki'], cs: ['vaší', 'účtu', 'zůstatek'], sv: ['ditt', 'konto', 'belopp'], da: ['dit', 'konto', 'saldo'],
  nb: ['ditt', 'konto', 'kortet'], ar: ['بطاقتك', 'حسابك', 'الرصيد'],
};
const CONNECTORS = [' - ', ' | ', ' – ', '\n'];
const EMOJI = [' ✅', ' 💳', ' 🙂', ' 🔔'];

/** Split each (op, lang) table into halves by content, with a both-sides fix-up. */
function splitTable(op, lang, entries) {
  const items = entries.map((e) => ({ e, ck: `drift|${op}|${lang}|${JSON.stringify(e)}` })).map((it) => ({ ...it, side: splitOf(it.ck) }));
  if (items.length >= 2 && items.every((it) => it.side === items[0].side)) {
    const mover = items.reduce((a, b) => (fnv1a(`move:${b.ck}`) > fnv1a(`move:${a.ck}`) ? b : a));
    mover.side = items[0].side === 'dev' ? 'holdout' : 'dev';
  }
  return items;
}
const half = (op, lang, entries, split) => (entries ? splitTable(op, lang, entries).filter((it) => split === 'all' || it.side === split) : []);

const reEsc = (t) => t.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
const wordRe = (w) => new RegExp(`(^|[^\\p{L}])(${reEsc(w)})(?=$|[^\\p{L}])`, 'u');
function replaceWord(text, from, to) {
  for (const f of [from, from[0].toUpperCase() + from.slice(1)]) {
    const t = f === from ? to : to[0].toUpperCase() + to.slice(1);
    if (/^\s|\s$/.test(f)) { if (text.includes(f)) return text.replace(f, t); continue; }
    const re = wordRe(f);
    if (re.test(text)) return text.replace(re, (m, pre) => pre + t);
  }
  return null;
}

// ----------------------------------------------------------------------------
// Operators. Each returns null when it does not apply to this alert.
// Structural: (spec, ctx) -> { spec, label? }. Lexical: (text, ctx) -> text.
const needs = (spec, slot) => (spec.tpl?.required ?? []).includes(slot) || (spec.tplSecond?.required ?? []).includes(slot);
const STRUCT = {
  'date-first': (spec, c) => {
    if (!spec.includeDate || needs(spec, 'DATE')) return null;
    const L = G.LEX[spec.lang];
    const d = formatDate(spec.date, spec.dateStyle.style, spec.dateStyle.time, L);
    return { spec: { ...spec, includeDate: false }, prefixText: `${d}${c.rng.pick([': ', ' ', ' - '])}` };
  },
  'tail-moved': (spec, c) => {
    if (!spec.includeIns || spec.layout === 'fields' || needs(spec, 'INS')) return null;
    const m = spec.mask.t.replace('{L4}', spec.l4);
    return { spec: { ...spec, includeIns: false }, suffixText: c.rng.pick([` (${m})`, ` · ${m}`, `\n${m}`]) };
  },
  'fields-reorder': (spec) => {
    if (spec.layout !== 'fields') return null;
    const order = spec.fields.order.slice(1).concat(spec.fields.order[0]);
    return { spec: { ...spec, fields: { ...spec.fields, order } } };
  },
  'drop-time': (spec) => (spec.includeDate && spec.dateStyle.time !== 'none' ? { spec: { ...spec, dateStyle: { ...spec.dateStyle, time: 'none' } } } : null),
  'drop-date': (spec) => (spec.includeDate && !needs(spec, 'DATE') ? { spec: { ...spec, includeDate: false }, label: { date: null } } : null),
  'drop-tail': (spec) => (spec.includeIns && !needs(spec, 'INS') ? { spec: { ...spec, includeIns: false }, label: { last4: null } } : null),
  'drop-balance': (spec) => (spec.trailers.some((t) => t.kind === 'balance' || t.kind === 'limit') ? { spec: { ...spec, trailers: spec.trailers.filter((t) => t.kind !== 'balance' && t.kind !== 'limit') } } : null),
  'currency-style': (spec, c) => {
    if (spec.foreign) return null;
    const market = byId[spec.market];
    const others = moneyPool(market, spec.lang === 'ar' ? 'ar' : 'latin', spec.lang, c.split).filter((st) => st.id !== spec.money.id);
    if (!others.length) return null;
    const money = c.rng.pick(others);
    return { spec: { ...spec, money, moneySecond: spec.layout === 'bilingual' ? spec.moneySecond : money } };
  },
  'number-format': (spec, c) => {
    if (spec.foreign || spec.amountMinor < 1000 * 10 ** spec.exponent) return null;
    const market = byId[spec.market];
    const sameDec = moneyPool(market, 'latin', spec.lang, 'all').filter((st) => st.dec === spec.money.dec && st.grp);
    const grp = spec.money.grp ? '' : (sameDec[0]?.grp ?? null);
    if (grp === null) return null;
    const money = { ...spec.money, grp };
    return { spec: { ...spec, money, moneySecond: spec.layout === 'bilingual' ? spec.moneySecond : money } };
  },
  'date-format': (spec, c) => {
    if (!spec.includeDate) return null;
    const others = datePool(byId[spec.market], spec.lang, c.split).filter((d) => d.style !== spec.dateStyle.style || d.time !== spec.dateStyle.time);
    return others.length ? { spec: { ...spec, dateStyle: c.rng.pick(others) } } : null;
  },
  'bank-prefix-add': (spec) => (spec.prefix === 'none' && spec.layout !== 'push' ? { spec: { ...spec, prefix: 'colon' } } : null),
  'bank-prefix-remove': (spec) => (spec.prefix !== 'none' ? { spec: { ...spec, prefix: 'none' } } : null),
};

const LEXICAL = {
  synonym: (text, c) => {
    for (const it of c.rng.shuffle(half('synonym', c.lang, SYN[c.lang], c.split))) {
      const out = replaceWord(text, it.e[0], it.e[1]);
      if (out && out !== text) return out;
    }
    return null;
  },
  abbreviation: (text, c) => {
    for (const it of c.rng.shuffle(half('abbreviation', c.lang, ABBR[c.lang], c.split))) {
      const out = replaceWord(text, it.e[0], it.e[1]);
      if (out && out !== text) return out;
    }
    return null;
  },
  'add-ref': (text, c) => {
    const list = half('add-ref', c.lang, REF[c.lang], c.split);
    if (!list.length) return null;
    return `${text}${c.rng.pick(['\n', ' '])}${c.rng.pick(list).e.replace('{N}', String(c.rng.int(100000, 999999)))}`;
  },
  connector: (text, c) => {
    const list = half('connector', 'all', CONNECTORS, c.split);
    if (!list.length || !/: |·/.test(text)) return null;
    const to = c.rng.pick(list).e;
    return text.replace(/(?<!\d): /g, to).replace(/ · /g, to);
  },
  typo: (text, c) => {
    for (const it of c.rng.shuffle(half('typo', c.lang, TYPO[c.lang], c.split))) {
      const w = it.e;
      if (w.length < 4 || !wordRe(w).test(text)) continue;
      const i = 1 + (fnv1a(w) % (w.length - 2));
      const typo = w.slice(0, i) + w[i + 1] + w[i] + w.slice(i + 2);
      if (typo !== w) return text.replace(wordRe(w), (m, pre) => pre + typo);
    }
    return null;
  },
  'trailing-emoji': (text, c) => { const list = half('trailing-emoji', 'all', EMOJI, c.split); return list.length ? text + c.rng.pick(list).e : null; },
  'all-caps': (text, c) => (c.lang === 'ar' ? null : text.toUpperCase()),
  'title-case': (text, c) => (c.lang === 'ar' ? null : text.toLowerCase().replace(/(^|[\s(])(\p{L})/gu, (m, a, b) => a + b.toUpperCase())),
  'double-spaces': (text) => (text.includes(' ') ? text.replace(/ (?=\S)/g, (m, i) => (i % 3 === 0 ? '  ' : ' ')) : null),
  'no-final-stop': (text) => (/\.$/.test(text) ? text.replace(/\.$/, '') : null),
  'smart-quotes': (text) => (/['"]/.test(text) ? text.replace(/'/g, '’').replace(/"([^"]*)"/g, '“$1”') : null),
  'bank-suffix-add': (text, c) => (c.spec.layout === 'push' ? null : `${text} - ${c.spec.bank.name}`),
};

const SINGLE_OPS = [...Object.keys(STRUCT), ...Object.keys(LEXICAL)];

/** Apply operators to a positive; returns { body, label } or null. */
function applyOps(row, ops, rng, split) {
  let spec = row.spec;
  const labelPatch = {};
  let prefixText = '';
  let suffixText = '';
  for (const op of ops.filter((o) => STRUCT[o])) {
    const r = STRUCT[op](spec, { rng, split });
    if (!r) return null;
    spec = r.spec;
    Object.assign(labelPatch, r.label ?? {});
    prefixText = r.prefixText ?? prefixText;
    suffixText = r.suffixText ?? suffixText;
  }
  let text;
  try {
    text = renderBody(spec).text;
    // A moved card tail goes after the alert's own clause, before any footer.
    if (suffixText) {
      const core = renderBody({ ...spec, trailers: [] }).text;
      text = core + suffixText + text.slice(core.length);
    }
  } catch { return null; }
  if (prefixText) text = prefixText + text;
  const ctx = { rng, split, lang: spec.lang, spec };
  for (const op of ops.filter((o) => LEXICAL[o])) {
    const out = LEXICAL[op](text, ctx);
    if (out === null || out === undefined) return null;
    text = out;
  }
  if (text === row.body) return null;
  return { body: text, label: { ...row.label, ...labelPatch } };
}

/** Up to K distinct drift variants of one correctly-booked positive. */
function driftVariants(row, K, seed) {
  const rng = rngFor(seed, 'drift', row.id);
  const out = [];
  const tried = new Set();
  for (const op of rng.shuffle(SINGLE_OPS.concat(['combo', 'combo']))) {
    if (out.length >= K) break;
    let ops = [op];
    if (op === 'combo') {
      const n = rng.int(2, 3);
      ops = rng.shuffle(SINGLE_OPS).slice(0, n);
      if (ops.includes('all-caps') && ops.includes('title-case')) continue;
    }
    const key = ops.join('+');
    if (tried.has(key)) continue;
    tried.add(key);
    const v = applyOps(row, ops, rng, row.split);
    if (!v) continue;
    out.push({ id: `${row.id}:drift-${key}`, op: op === 'combo' ? 'combo' : op, ops, body: v.body, label: v.label, sender: row.sender });
  }
  return out;
}

// ----------------------------------------------------------------------------
function emptyDrift() { return { base: {}, tally: {}, wrong: [], examples: {}, variants: 0 }; }
const bump = (o, keys, field) => {
  let at = o;
  for (const k of keys) at = at[k] ??= {};
  at.n = at.n ?? 0; at.ok = at.ok ?? 0; at.lost = at.lost ?? 0; at.wrong = at.wrong ?? 0;
  if (field) at[field] += 1;
  return at;
};

function evaluateDrift(driver, rows, { K = 4, seed = 'alert-lab-drift', paths = ['android-sms', 'ios-history'] } = {}) {
  const rep = emptyDrift();
  for (const row of rows) {
    if (row.kind !== 'positive' || !row.spec) continue;
    let variants = null;
    for (const p of paths) {
      const res = driver.run(row, p);
      const b = bump(rep.base, [row.market, p]);
      b.n += 1;
      if (gradePositive(row.label, res.accepted, null, row.ledger).verdict !== 'ok') continue;
      b.ok += 1;
      variants ??= driftVariants(row, K, seed);
      for (const v of variants) {
        rep.variants += 1;
        const r2 = driver.run({ ...row, id: v.id, body: v.body, sender: v.sender }, p);
        const g = gradePositive(v.label, r2.accepted, null, row.ledger);
        const outcome = g.verdict === 'ok' ? 'ok' : g.verdict === 'wrong' ? 'wrong' : 'lost';
        const cell = bump(rep.tally, [row.market, p, row.family, v.op]);
        cell.n += 1; cell[outcome] += 1;
        if (outcome === 'wrong') {
          rep.wrong.push({ path: p, id: v.id, market: row.market, op: v.op, ops: v.ops, detail: g.detail, before: row.body, after: v.body, sender: row.sender, parsed: summarize(r2.accepted) });
        } else if (outcome === 'lost') {
          const key = `${v.op}|${row.market}|${p}`;
          rep.examples[key] ??= { ops: v.ops, before: row.body, after: v.body, sender: row.sender };
        }
      }
    }
  }
  return rep;
}

function mergeDrift(a, b) {
  const deep = (x, y) => { for (const [k, v] of Object.entries(y)) { if (typeof v === 'number') x[k] = (x[k] ?? 0) + v; else deep(x[k] ??= {}, v); } };
  deep(a.base, b.base); deep(a.tally, b.tally);
  a.wrong.push(...b.wrong);
  for (const [k, v] of Object.entries(b.examples)) a.examples[k] ??= v;
  a.variants += b.variants;
  return a;
}

module.exports = { driftVariants, evaluateDrift, mergeDrift, emptyDrift, SINGLE_OPS };
