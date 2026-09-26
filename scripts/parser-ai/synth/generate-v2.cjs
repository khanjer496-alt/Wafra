'use strict';
/**
 * Phase-2 compositional alert generator: many "authors" (writing styles) ×
 * per-language clause patterns (lexicon.cjs) × cue alternatives × optional
 * parts, so every language × event family has ≥30 distinct templates.
 *
 * Authors: sentence, formal, fieldlist (multi-line key: value), pipe
 * (single-line | separated), kv (KEY=value;), terse (DR/CR abbreviations),
 * emoji, mixed (Arabic/Hinglish with English field labels) and — HELD OUT
 * ENTIRELY — push (app-notification cards: title line, "•" separators).
 *
 * Splits: by TEMPLATE FAMILY (lang:event:author:pattern) → train/dev/test;
 * every template of the held-out author → 'author'. Merchant, person,
 * biller and employer names are split like phase 1 (test/author use the
 * held-out third). Gulf currency spellings (درهم, د.إ, Dhs, ريال, ر.س, SR …),
 * QA/OM/BH users, and balance / available-limit figures as labelled BAL
 * distractors are added. The phase-1 hand-written templates are NOT used
 * here: they stay an independent held-out author for evaluation.
 *
 *   node scripts/parser-ai/synth/generate-v2.cjs [--out dir] [--stats]
 */
const fs = require('node:fs');
const path = require('node:path');
const { COUNTRIES } = require('./locales.cjs');
const { EVENT_LABEL } = require('./templates.cjs');
const { LEXICON } = require('./lexicon.cjs');
const G = require('./generate.cjs');

const POSTING = ['purchase', 'refund', 'transfer_out', 'transfer_in', 'salary', 'fee', 'withdrawal', 'card_payment', 'bill_payment'];
const NEGATIVE = ['otp', 'pending', 'declined', 'promo', 'balance', 'statement', 'request', 'future', 'limit'];
const EVENTS = [...POSTING, ...NEGATIVE];
const LABELS = { ...EVENT_LABEL, limit: { status: 'informational', noAmount: true } };
const POLARITY = {
  purchase: 'd', transfer_out: 'd', fee: 'd', withdrawal: 'd', bill_payment: 'd',
  refund: 'c', transfer_in: 'c', salary: 'c', card_payment: 'c',
};
const HELD_OUT_AUTHOR = 'push';

/* ── country overlay: Gulf spellings and extra Gulf users ─────────────── */
const byCc = Object.fromEntries(COUNTRIES.map((c) => [c.cc, c]));
const withCf = (cc, extra) => ({ ...byCc[cc], cf: [...byCc[cc].cf, ...extra] });
const GULF_EXTRA = [
  { cc: 'QA', langs: ['ar', 'en'], cur: 'QAR', cf: [['QAR', 'b', 1], ['QAR', 'a', 1], ['QR', 'b', 1], ['ر.ق', 'a', 1], ['ريال', 'a', 1]], num: ['comma-dot', 'arabic'],
    dates: ['D/M/Y', 'D-M-Y', 'D Mon Y'], banks: [['QNB', 'QNB'], ['Commercial Bank', 'CBQ'], ['Doha Bank', 'DohaBank']],
    merchants: ['LULU DOHA', 'CARREFOUR VILLAGGIO', 'TALABAT QA', 'WOQOD 12', 'SNOONU', 'MONOPRIX QA', 'VIRGIN MEGASTORE', 'KARWA TAXI'], rails: ['Fawran'] },
  { cc: 'OM', langs: ['ar', 'en'], cur: 'OMR', cf: [['OMR', 'b', 1], ['OMR', 'a', 1], ['RO', 'b', 1], ['ر.ع', 'a', 1]], num: ['comma-dot'],
    dates: ['D/M/Y', 'D-M-Y'], banks: [['Bank Muscat', 'BankMuscat'], ['NBO', 'NBO']],
    merchants: ['LULU MUSCAT', 'CARREFOUR MOE', 'OMANOIL 44', 'TALABAT OM', 'NESTO', 'AL FAIR'], rails: ['Mobile Payments'] },
  { cc: 'BH', langs: ['ar', 'en'], cur: 'BHD', cf: [['BHD', 'b', 1], ['BHD', 'a', 1], ['BD', 'b', 1], ['د.ب', 'a', 1]], num: ['comma-dot'],
    dates: ['D/M/Y', 'D-M-Y'], banks: [['NBB', 'NBB'], ['BBK', 'BBK']],
    merchants: ['ALJAZIRA SUPERMARKET', 'TALABAT BH', 'BAPCO 7', 'LULU BH', 'CITY CENTRE BAHRAIN'], rails: ['Fawri+'] },
];
const COUNTRIES_V2 = [
  ...COUNTRIES.map((c) => (c.cc === 'AE'
    ? withCf('AE', [['درهم', 'a', 1], ['DHS', 'b', 1], ['AED', 'a', 0], ['د.إ', 'b', 1]])
    : c.cc === 'SA'
      ? withCf('SA', [['رس', 'a', 1], ['SR', 'a', 1], ['ر.س', 'b', 1]])
      : c)),
  ...GULF_EXTRA,
];

/* ── template expansion ───────────────────────────────────────────────── */
function expand(pattern, cue) {
  // Expand {V:a|b} (cue-marked) and {A:a|b} (plain) into every combination.
  const m = pattern.match(/\{([VA]):([^}]*)\}/u);
  if (!m) return [pattern];
  const alts = m[2].split('|');
  const out = [];
  for (const alt of alts) {
    const text = m[1] === 'V' ? `<${cue}>${alt}</${cue}>` : alt;
    out.push(...expand(pattern.replace(m[0], text), cue));
  }
  return out;
}

const cap = (text) => text.replace(/^(\s*(?:<[dcn]>)?)(\p{Ll})/u, (_, pre, ch) => pre + ch.toUpperCase());
const pickI = (list, i) => list[i % list.length];

const PARTY = {
  purchase: ['merchant', '{MER}'], refund: ['merchant', '{MER}'], transfer_out: ['to', '{NAME}'], transfer_in: ['from', '{NAME}'],
  salary: ['from', '{EMPLOYER}'], fee: null, withdrawal: ['merchant', '{ATM}'], card_payment: ['card', '{CARD}'],
  bill_payment: ['to', '{BILLER}'], otp: ['merchant', '{MER}'], pending: ['merchant', '{MER}'], declined: ['merchant', '{MER}'],
  promo: ['merchant', '{MER}'], balance: ['account', '{ACCT}'], statement: ['card', '{CARD}'], request: ['from', '{NAME}'],
  future: ['to', '{BILLER}'], limit: ['card', '{CARD}'],
};
const MONEY_SLOT = (event) => (['balance', 'statement'].includes(event) ? '{BAL}' : event === 'limit' ? '{LIMIT}' : '{AMT}');

/** Every author returns [{ family, text }] for one (lang, event). */
function authorTemplates(lang, event) {
  const lex = LEXICON[lang];
  const ev = lex.ev[event];
  const cue = POLARITY[event] ?? 'n';
  const lab = lex.labels;
  const out = [];
  const push = (author, key, text) => out.push({ author, family: `${lang}:${event}:${author}:${key}`, text });
  const clauses = ev.p.map((p) => expand(p, cue));
  const nouns = ev.noun.map((n) => expand(n, cue)).flat();
  const party = PARTY[event];
  const moneySlot = MONEY_SLOT(event);
  const dated = !['balance', 'limit', 'promo'].includes(event);
  const drcr = POLARITY[event] === 'd' ? lex.dr : POLARITY[event] === 'c' ? lex.cr : null;

  clauses.forEach((variants, pi) => variants.forEach((clause, vi) => {
    for (let t = 0; t < 8; t++) {
      const bank = t & 1 ? '{BANK}: ' : '';
      const date = !(t & 2) ? '' : dated && !clause.includes('{DATE}') ? ` ${lex.on}` : ' {TIME}';
      const tail = POLARITY[event] && (vi + t) % 2 === 0 ? ` ${pickI(lex.bal, pi + vi + t)}.` : '';
      const sign = t & 4 ? ` - {BANK}` : '';
      push('sentence', `p${pi}`, `${bank}${cap(clause)}${date}.${tail}${sign}`);
    }
    for (const greet of lex.greet) push('formal', `p${pi}`, `${greet} ${clause}${dated && !clause.includes('{DATE}') ? ` ${lex.on}` : ''}.${POLARITY[event] ? ` ${pickI(lex.bal, vi)}.` : ''} {BANK}`);
    // (one formal variant per greeting)
    push('emoji', `p${pi}`, `${pickI(['💳', '🔔', '✅', '📣'], pi + vi)} ${cap(clause)}${dated && !clause.includes('{DATE}') ? ` 📅 {DATE}` : ''}`);
  }));

  nouns.forEach((noun, ni) => {
    for (let t = 0; t < 3; t++) {
      const lines = [`${pickI(lab.type, t)}: ${noun}`, `${pickI(lab.amount, t)}: ${moneySlot}`];
      if (party) lines.push(`${pickI(lab[party[0]], t + ni)}: ${party[1]}`);
      if (dated) lines.push(`${pickI(lab.date, t)}: {DATE}`);
      if (POLARITY[event] && t !== 1) lines.push(`${t ? pickI(lab.limit, ni) : pickI(lab.balance, ni)}: ${t ? '{LIMIT}' : '{BAL}'}`);
      const order = t === 2 ? [lines[1], lines[0], ...lines.slice(2)] : lines;
      push('fieldlist', `n${ni}`, `${t === 1 ? '{BANK}\n' : ''}${order.join('\n')}`);
      const cells = [noun, moneySlot, party ? party[1] : null, dated ? '{DATE}' : null].filter(Boolean);
      push('pipe', `n${ni}`, t === 0 ? cells.join(' | ') : t === 1
        ? `{BANK} | ${cells.join(' | ')}${POLARITY[event] ? ` | ${pickI(lab.balance, ni)} {BAL}` : ''}`
        : `${noun} | ${pickI(lab.amount, ni)} ${moneySlot}${party ? ` | ${pickI(lab[party[0]], ni)} ${party[1]}` : ''}${dated ? ` | {DATE}` : ''}`);
      const kv = [`TXN=${noun}`, `AMT=${moneySlot}`, party ? `${party[0].toUpperCase().slice(0, 3)}=${party[1]}` : null, dated ? 'DT={DATE}' : null,
        POLARITY[event] && t ? 'BAL={BAL}' : null].filter(Boolean);
      push('kv', `n${ni}`, `${t === 2 ? '{BANK} ' : ''}${kv.join(t === 1 ? '; ' : ';')}`);
      // Held-out author: app-notification card.
      push(HELD_OUT_AUTHOR, `n${ni}`, t === 0
        ? `{BANK}\n${noun}\n${moneySlot}${party ? ` • ${party[1]}` : ''}`
        : t === 1
          ? `${noun} • ${moneySlot}\n${party ? `${party[1]} • ` : ''}{TIME}`
          : `{BANK} · ${noun}\n${moneySlot}${dated ? ` · {DATE}` : ''}${POLARITY[event] ? `\n${pickI(lab.balance, ni)} {BAL}` : ''}`);
    }
  });

  if (drcr) {
    drcr.forEach((abbr, ai) => {
      for (let t = 0; t < 3; t++) {
        const partyText = party ? party[1] : '';
        const bal = t !== 1 ? ` ${pickI(lab.balance, ai)} {BAL}` : '';
        push('terse', `a${ai}`, t === 0
          ? `{BANK} <${POLARITY[event]}>${abbr}</${POLARITY[event]}> {AMT} ${partyText} {DATE}${bal}`.replace(/\s+/gu, ' ')
          : t === 1
            ? `A/c XX{ACCT} <${POLARITY[event]}>${abbr}</${POLARITY[event]}> {AMT} ${partyText}`.trim()
            : `{AMT} <${POLARITY[event]}>${abbr}</${POLARITY[event]}> ${pickI(lab.date, ai)} {DATE} ${partyText}${bal}`.replace(/\s+/gu, ' '));
      }
    });
  } else {
    nouns.forEach((noun, ni) => push('terse', `n${ni}`, `{BANK} ${noun} ${moneySlot}${party ? ` ${party[1]}` : ''}`));
  }

  if (lang === 'ar' || lang === 'hi-latn') {
    // Mixed-script author: local-language cue with English field labels.
    nouns.forEach((noun, ni) => {
      push('mixed', `n${ni}`, `Card: XX{CARD}\n${noun}\nAmount: ${moneySlot}${party ? `\n${party[0] === 'merchant' ? 'At' : party[0] === 'to' ? 'To' : 'From'}: ${party[1]}` : ''}${dated ? '\nDate: {DATE}' : ''}`);
      push('mixed', `n${ni}`, `${noun} ${moneySlot}${party ? ` ${party[1]}` : ''}. Avl Bal {BAL}`);
    });
  }
  return out;
}

function hash(text) {
  let h = 2166136261;
  for (let i = 0; i < text.length; i++) h = Math.imul(h ^ text.charCodeAt(i), 16777619) >>> 0;
  return h;
}

const splitOfFamily = (family, author) => {
  if (author === HELD_OUT_AUTHOR) return 'author';
  const r = hash(family) % 20;
  return r < 12 ? 'train' : r < 15 ? 'dev' : 'test';
};

function catalogV2({ maxPerCell = 60, seed = 20260926 } = {}) {
  const rng = G.rngFrom(seed);
  const out = [];
  const cells = {};
  for (const lang of Object.keys(LEXICON)) {
    for (const event of EVENTS) {
      if (!LEXICON[lang].ev[event]) continue;
      const seen = new Set();
      let list = authorTemplates(lang, event).filter((t) => (seen.has(t.text) ? false : (seen.add(t.text), true)));
      if (list.length > maxPerCell) {
        // Deterministic sample that keeps every author represented.
        const byAuthor = {};
        for (const t of list) (byAuthor[t.author] ??= []).push(t);
        const authors = Object.keys(byAuthor).sort();
        for (const a of authors) byAuthor[a].sort(() => rng.next() - 0.5);
        const picked = [];
        for (let i = 0; picked.length < maxPerCell; i++) {
          let any = false;
          for (const a of authors) if (byAuthor[a][i] && picked.length < maxPerCell) { picked.push(byAuthor[a][i]); any = true; }
          if (!any) break;
        }
        list = picked;
      }
      cells[`${lang}:${event}`] = list.length;
      list.forEach((t, i) => out.push({ ...t, id: `${t.family}:${i}`, lang, event, split: splitOfFamily(t.family, t.author) }));
    }
  }
  return { templates: out, cells };
}

function generateV2({ seed = 20260926, perTemplate = { train: 3, dev: 2, test: 2, author: 2 }, maxPerCell = 60 } = {}) {
  const rng = G.rngFrom(seed);
  const { templates } = catalogV2({ maxPerCell, seed });
  const rows = [];
  for (const tpl of templates) {
    const countries = COUNTRIES_V2.filter((c) => c.langs.includes(tpl.lang));
    if (!countries.length) continue;
    const lab = LABELS[tpl.event];
    const nameSplit = tpl.split === 'train' || tpl.split === 'dev' ? 'train' : 'test';
    for (let k = 0; k < perTemplate[tpl.split]; k++) {
      const country = rng.pick(countries);
      const [bankName, sender] = rng.pick(country.banks);
      const foreign = tpl.event === 'purchase' && country.cc !== 'US' && rng.chance(0.1);
      const cur = foreign ? rng.pick(['USD', 'EUR', 'GBP'].filter((c) => c !== country.cur)) : country.cur;
      const minor = G.drawAmount(cur, rng, tpl.event === 'salary' ? 'salary' : tpl.event === 'withdrawal' ? 'withdrawal' : 'txn');
      const y = 2026; const m = rng.int(1, 9); const d = rng.int(1, m === 2 ? 28 : m === 9 ? 20 : 30);
      const dateFmt = rng.pick(country.dates);
      const dateText = G.formatDate(dateFmt, y, m, d, tpl.lang === 'hi-latn' ? 'en' : tpl.lang, rng);
      const merchant = rng.pick(G.half(country.merchants, nameSplit));
      const person = rng.pick(G.half(G.PEOPLE[tpl.lang] ?? G.PEOPLE.en, nameSplit));
      const biller = rng.pick(G.half(G.BILLERS[tpl.lang] ?? G.BILLERS.en, nameSplit));
      const employer = rng.pick(G.half(G.EMPLOYERS, nameSplit));
      const balMinor = G.drawAmount(country.cur, rng, 'balance');
      const limitMinor = G.drawAmount(country.cur, rng, 'balance') * 4n + 100000n;
      const fill = (slot) => {
        switch (slot) {
          case 'AMT': return G.money(cur, minor, country, rng, foreign);
          case 'BAL': case 'BAL2': return { ...G.money(country.cur, slot === 'BAL2' ? balMinor / 20n + 1n : balMinor, country, rng), label: 'BAL', spans: [] };
          case 'LIMIT': return { ...G.money(country.cur, limitMinor, country, rng), label: 'BAL', spans: [] };
          case 'MER': return { text: merchant, label: 'MER' };
          case 'BILLER': return { text: biller, label: 'MER' };
          case 'NAME': return { text: person };
          case 'EMPLOYER': return { text: employer };
          case 'DATE': return { text: dateText, label: 'DATE' };
          case 'TIME': return { text: `${String(rng.int(0, 23)).padStart(2, '0')}:${String(rng.int(0, 59)).padStart(2, '0')}` };
          case 'CARD': return { text: String(rng.int(1000, 9999)) };
          case 'ACCT': return { text: String(rng.int(1000, 9999)) };
          case 'BANK': return { text: bankName };
          case 'OTP': return { text: String(rng.int(100000, 999999)) };
          case 'REF': return { text: Array.from({ length: 10 }, () => rng.pick('ABCDEFGHJKLMNPQRSTUVWXYZ0123456789'.split(''))).join('') };
          case 'ATM': return { text: rng.pick(G.ATMS) };
          case 'RAIL': return { text: rng.pick(country.rails ?? ['bank transfer']) };
          default: throw new Error(`slot ${slot}`);
        }
      };
      let template = tpl.text;
      if (rng.chance(0.15)) template += rng.pick(G.FOOTERS[tpl.lang] ?? G.FOOTERS.en).replace('{BAL}', '{BAL}');
      let { text, spans } = G.compose(template, fill);
      if (rng.chance(0.04) && tpl.lang !== 'ar') text = text.toUpperCase();
      const posting = lab.status === 'completed';
      const mer = spans.find((s) => s.label === 'MER');
      const hasDate = template.includes('{DATE}');
      const merchantSlot = lab.merchantSlot && mer ? text.slice(mer.start, mer.end) : undefined;
      rows.push({
        id: `syn2:${tpl.id}:${k}`, source: 'synthetic-v2', country: country.cc, language: tpl.lang, bank: bankName, sender,
        template: tpl.id, family: tpl.family, author: tpl.author, event: tpl.event, split: tpl.split, body: text,
        label: {
          status: lab.status,
          shouldPost: posting,
          family: posting ? lab.family : 'non-posting',
          direction: posting ? lab.direction : 'none',
          amount: lab.noAmount ? null : { minor: minor.toString(), currency: cur, exponent: G.exponentOf(cur) },
          merchant: posting ? merchantSlot : undefined,
          date: !posting ? undefined : !hasDate ? null : G.YEARLESS.has(dateFmt) ? undefined : `${y}-${String(m).padStart(2, '0')}-${String(d).padStart(2, '0')}`,
        },
        spans: spans.sort((a, b) => a.start - b.start),
        foreignCurrency: foreign,
      });
    }
  }
  return rows;
}

module.exports = { generateV2, catalogV2, COUNTRIES_V2, EVENTS, HELD_OUT_AUTHOR };

if (require.main === module) {
  const args = process.argv.slice(2);
  const out = args.includes('--out') ? args[args.indexOf('--out') + 1] : null;
  const { templates, cells } = catalogV2();
  const rows = generateV2();
  const by = (list, key) => list.reduce((acc, r) => ((acc[r[key]] = (acc[r[key]] ?? 0) + 1), acc), {});
  const minCell = Math.min(...Object.values(cells));
  const thin = Object.entries(cells).filter(([, n]) => n < 30);
  console.log(JSON.stringify({ rows: rows.length, bySplit: by(rows, 'split'), templates: templates.length,
    templatesBySplit: by(templates, 'split'), templatesByAuthor: by(templates, 'author'), minTemplatesPerLangEvent: minCell,
    cellsBelow30: thin, languages: new Set(rows.map((r) => r.language)).size, countries: new Set(rows.map((r) => r.country)).size }));
  if (out) {
    fs.mkdirSync(out, { recursive: true });
    for (const split of ['train', 'dev', 'test', 'author']) {
      fs.writeFileSync(path.join(out, `${split}.jsonl`), rows.filter((r) => r.split === split).map((r) => JSON.stringify(r)).join('\n') + '\n');
    }
  }
}
