#!/usr/bin/env node
'use strict';
/**
 * Deterministic synthetic Ask Wafra question set for the on-device tagger's
 * intent head and BIO slot head.
 *
 *   node scripts/parser-ai/ask/questions.cjs --out <dir>   write train/dev/test JSONL + labels.json
 *   node scripts/parser-ai/ask/questions.cjs               print counts only
 *
 * Row: { id, language, dialect, template, split, question, intent, slots, spans }
 *   slots  normalised values: category (Wafra CategoryId), merchant (ledger
 *          title as written), account (account name), period / comparison
 *          (period key: this-month, month:3, since-month:1, last-days:30 …),
 *          topN (1..10, read from the user's words).
 *   spans  [{ label, start, end, text }] UTF-16 offsets into `question`, end
 *          exclusive; labels Q_CAT Q_MER Q_ACCT Q_PERIOD Q_CMP Q_TOPN.
 *
 * Split is by TEMPLATE: every rendering of one template lands in one split, so
 * test templates are never seen in training. Vocabulary (categories, months,
 * periods, numbers) comes from src/lib/ai-ask-understanding.ts — the same
 * lexicon the runtime mapping normalises against — and every generated span is
 * checked to normalise back to its slot value.
 */
const fs = require('node:fs');
const path = require('node:path');
const { createLoader } = require('../../universal-test/load-ts.cjs');
const { TEMPLATES } = require('./templates.cjs');

const load = createLoader();
const ask = load('@/lib/ai-ask-understanding');

const INTENTS = [...ask.ASK_INTENTS];
const SLOT_LABELS = [...ask.ASK_SLOT_LABELS];
const BIO_LABELS = [...ask.ASK_BIO_LABELS];
const LANGUAGES = [...ask.ASK_LANGUAGES];
const SEED = 20260925;
/** Reference "now" for resolving period keys when scoring (local time). */
const NOW = new Date(2026, 8, 20, 12, 0, 0);

const ACCOUNTS = [
  { id: 'acct-everyday', name: 'Everyday', kind: 'bank' },
  { id: 'acct-family', name: 'Family', kind: 'bank' },
  { id: 'acct-visa', name: 'Visa Platinum', kind: 'card' },
  { id: 'acct-mc', name: 'Mastercard Gold', kind: 'card' },
  { id: 'acct-amex', name: 'Amex Blue', kind: 'card' },
];

const GLOBAL_MERCHANTS = ['Amazon', 'Netflix', 'Spotify', 'Starbucks', 'IKEA', 'Zara', 'Uber', 'Shein'];
const MERCHANTS = {
  en: [...GLOBAL_MERCHANTS, 'Talabat', 'Carrefour', 'Noon', 'Careem', 'Lulu', 'Deliveroo', 'Spinneys', 'Walmart', 'Tesco', 'Costco'],
  ar: ['Talabat', 'Carrefour', 'Noon', 'Careem', 'Jahez', 'HungerStation', 'Lulu', 'Panda', 'Amazon', 'Starbucks',
    'طلبات', 'كارفور', 'نون', 'جاهز', 'هنقرستيشن', 'بنده', 'كريم', 'أمازون', 'ستاربكس', 'لولو'],
  es: [...GLOBAL_MERCHANTS, 'Mercadona', 'Carrefour', 'El Corte Inglés', 'Glovo', 'Cabify', 'Rappi', 'Mercado Libre', 'OXXO'],
  pt: [...GLOBAL_MERCHANTS, 'Pingo Doce', 'Continente', 'iFood', 'Mercado Livre', 'Magalu', 'Rappi', 'Renner', 'Americanas'],
  fr: [...GLOBAL_MERCHANTS, 'Carrefour', 'Monoprix', 'Leclerc', 'Auchan', 'Fnac', 'Deliveroo', 'Uber Eats', 'Decathlon', 'SNCF'],
  de: [...GLOBAL_MERCHANTS, 'Rewe', 'Edeka', 'Lidl', 'Aldi', 'Lieferando', 'Zalando', 'MediaMarkt', 'Deutsche Bahn'],
  it: [...GLOBAL_MERCHANTS, 'Esselunga', 'Coop', 'Conad', 'Glovo', 'Just Eat', 'Trenitalia', 'Lidl', 'Eataly'],
  nl: [...GLOBAL_MERCHANTS, 'Albert Heijn', 'Jumbo', 'Bol.com', 'Thuisbezorgd', 'Coolblue', 'Lidl', 'HEMA'],
  tr: [...GLOBAL_MERCHANTS, 'Migros', 'Getir', 'Trendyol', 'Yemeksepeti', 'A101', 'Hepsiburada', 'BIM'],
  id: [...GLOBAL_MERCHANTS, 'Tokopedia', 'Shopee', 'Gojek', 'Grab', 'Indomaret', 'Alfamart', 'Traveloka', 'GoFood'],
  'hi-Latn': [...GLOBAL_MERCHANTS, 'Swiggy', 'Zomato', 'Flipkart', 'BigBasket', 'Blinkit', 'Ola', 'Myntra', 'Zepto'],
};

/** How each language wraps a period key around a sentence. `pre`/`post` stay outside the span. */
const PERIOD_RENDER = {
  en: { month: [{ pre: 'in ' }, { pre: 'during ' }], since: [(m) => `since ${m}`], days: [{ pre: 'in the ', fmt: (n) => `last ${n} days` }, { pre: 'over the ', fmt: (n) => `past ${n} days` }, { pre: '', fmt: (n) => `last ${n} days` }] },
  ar: { month: [{ pre: 'في ' }, { pre: 'في شهر ' }], since: [(m) => `من ${m}`, (m) => `منذ ${m}`, (m) => `من بداية ${m}`], days: [{ pre: 'في ', fmt: (n) => `آخر ${n} ${n <= 10 ? 'أيام' : 'يوم'}` }, { pre: 'خلال ', fmt: (n) => `آخر ${arabicDigits(n)} يوم` }] },
  es: { month: [{ pre: 'en ' }], since: [(m) => `desde ${m}`], days: [{ pre: 'en ', fmt: (n) => `los últimos ${n} días` }] },
  pt: { month: [{ pre: 'em ' }], since: [(m) => `desde ${m}`], days: [{ pre: 'nos ', fmt: (n) => `últimos ${n} dias` }] },
  fr: { month: [{ pre: 'en ' }], since: [(m) => `depuis ${m}`], days: [{ pre: 'sur ', fmt: (n) => `les ${n} derniers jours` }] },
  de: { month: [{ pre: 'im ' }], since: [(m) => `seit ${m}`], days: [{ pre: 'in den ', fmt: (n) => `letzten ${n} Tagen` }] },
  it: { month: [{ pre: 'a ' }, { pre: 'in ' }], since: [(m) => `da ${m}`], days: [{ pre: 'negli ', fmt: (n) => `ultimi ${n} giorni` }] },
  nl: { month: [{ pre: 'in ' }], since: [(m) => `sinds ${m}`], days: [{ pre: 'in de ', fmt: (n) => `afgelopen ${n} dagen` }] },
  tr: { month: [{ fmt: (m) => `${m} ayında` }], since: [(m) => `${m} ayından beri`], days: [{ fmt: (n) => `son ${n} gün içinde` }] },
  id: { month: [{ pre: 'di bulan ' }, { pre: 'pada bulan ' }], since: [(m) => `sejak ${m}`], days: [{ pre: 'dalam ', fmt: (n) => `${n} hari terakhir` }] },
  'hi-Latn': { month: [{ post: ' mein' }], since: [(m) => `${m} se`], days: [{ fmt: (n) => `last ${n} days`, post: ' mein' }, { fmt: (n) => `pichle ${n} din`, post: ' mein' }] },
};

function arabicDigits(n) { return String(n).replace(/\d/g, (d) => '٠١٢٣٤٥٦٧٨٩'[Number(d)]); }

function mulberry32(seed) {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}
const pick = (rng, list) => list[Math.floor(rng() * list.length)];

const FIXED = ['today', 'yesterday', 'this-week', 'last-week', 'this-month', 'last-month', 'this-year', 'last-year', 'all-time'];
function samplePeriodKey(rng, intent) {
  if (intent === 'month_forecast') return 'this-month';
  const r = rng();
  const compare = intent === 'compare_periods';
  if (r < 0.6) return pick(rng, compare ? FIXED.filter((key) => key !== 'all-time') : FIXED);
  if (r < 0.8 || compare) return `month:${1 + Math.floor(rng() * 12)}`;
  if (r < 0.9) return `since-month:${1 + Math.floor(rng() * 9)}`;
  return `last-days:${pick(rng, [7, 10, 14, 30, 60, 90])}`;
}
function samplePeriodPair(rng) {
  const r = rng();
  if (r < 0.35) return ['this-month', 'last-month'];
  if (r < 0.5) return ['this-week', 'last-week'];
  if (r < 0.62) return ['this-year', 'last-year'];
  if (r < 0.7) return ['last-month', `month:${1 + Math.floor(rng() * 7)}`];
  const a = 1 + Math.floor(rng() * 12);
  let b = 1 + Math.floor(rng() * 12);
  if (b === a) b = (a % 12) + 1;
  return [`month:${a}`, `month:${b}`];
}

function renderPeriod(rng, language, key, bare) {
  const fixed = ask.ASK_PERIOD_LEXICON[language][key];
  if (fixed) return { pre: '', text: pick(rng, fixed), post: '' };
  const [kind, raw] = key.split(':');
  const value = Number(raw);
  const style = PERIOD_RENDER[language];
  if (kind === 'last-days') {
    const option = pick(rng, style.days);
    return { pre: option.pre ?? '', text: option.fmt(value), post: option.post ?? '' };
  }
  const variants = ask.ASK_MONTH_NAMES[language][value - 1];
  // Abbreviations (Jan, Sept) are rarer than full names.
  const name = variants.length > 1 && rng() < 0.75 ? variants[0] : pick(rng, variants);
  if (kind === 'since-month') return { pre: '', text: pick(rng, style.since)(name), post: '' };
  if (bare) return { pre: '', text: name, post: '' };
  const option = pick(rng, style.month);
  return { pre: option.pre ?? '', text: option.fmt ? option.fmt(name) : name, post: option.post ?? '' };
}

function renderTopN(rng, language, n) {
  if (rng() < 0.6) return language === 'ar' && rng() < 0.4 ? arabicDigits(n) : String(n);
  return pick(rng, ask.ASK_NUMBER_WORDS[language][n - 1]);
}

function sampleCategory(rng, language) {
  const lexicon = ask.ASK_CATEGORY_LEXICON[language];
  const id = pick(rng, Object.keys(lexicon));
  return { id, text: pick(rng, lexicon[id]) };
}

const PLACEHOLDER = /\{(CAT|MER|ACCT|PERIOD|CMP|N)(!?)\}/g;

/** Conversational openers, prepended to some renderings (outside every span). */
const OPENERS = {
  en: ['Hey Wafra, ', 'Please ', 'Quick question: ', 'Can you tell me '],
  ar: ['لو سمحت ', 'يا وفرة، ', 'سؤال: '],
  es: ['Oye, ', 'Por favor, ', 'Una pregunta: '],
  pt: ['Por favor, ', 'Oi, ', 'Me diz: '],
  fr: ['Dis-moi, ', 'Stp, ', 'Question : '],
  de: ['Sag mal, ', 'Bitte: ', 'Kurze Frage: '],
  it: ['Scusa, ', 'Per favore, ', 'Domanda: '],
  nl: ['Hé, ', 'Graag: ', 'Vraagje: '],
  tr: ['Lütfen ', 'Merhaba, ', 'Bir sorum var: '],
  id: ['Tolong, ', 'Halo, ', 'Mau tanya: '],
  'hi-Latn': ['Yaar, ', 'Please ', 'Batao, '],
};

function renderTemplate(rng, source, language, intent) {
  let template = source.replace(/\[([^\]]*)\]/g, (_, body) => (rng() < 0.55 ? body : ''));
  template = template.replace(/ {2,}/g, ' ').trim();
  if (rng() < 0.2) {
    const opener = pick(rng, OPENERS[language]);
    const lowered = /^\p{Lu}\p{Ll}/u.test(template) && language !== 'de' ? template[0].toLocaleLowerCase('en-US') + template.slice(1) : template;
    template = opener + lowered.replace(/^[¿¡]/u, '');
  }
  const names = new Set([...template.matchAll(PLACEHOLDER)].map((match) => match[1]));
  const values = {};
  if (names.has('CAT')) values.CAT = sampleCategory(rng, language);
  if (names.has('MER')) values.MER = pick(rng, MERCHANTS[language]);
  if (names.has('ACCT')) values.ACCT = pick(rng, ACCOUNTS).name;
  if (names.has('PERIOD') && names.has('CMP')) [values.PERIOD, values.CMP] = samplePeriodPair(rng);
  else if (names.has('PERIOD')) values.PERIOD = samplePeriodKey(rng, intent);
  else if (names.has('CMP')) values.CMP = samplePeriodPair(rng)[1];
  if (names.has('N')) values.N = pick(rng, [2, 3, 3, 4, 5, 5, 5, 6, 7, 8, 10, 10]);

  let question = '';
  const spans = [];
  const slots = {};
  let cursor = 0;
  for (const match of template.matchAll(PLACEHOLDER)) {
    question += template.slice(cursor, match.index);
    cursor = match.index + match[0].length;
    const [name, bare] = [match[1], match[2] === '!'];
    let piece;
    let label;
    if (name === 'CAT') { piece = { text: values.CAT.text }; label = 'Q_CAT'; slots.category = values.CAT.id; }
    if (name === 'MER') { piece = { text: values.MER }; label = 'Q_MER'; slots.merchant = values.MER; }
    if (name === 'ACCT') { piece = { text: values.ACCT }; label = 'Q_ACCT'; slots.account = values.ACCT; }
    if (name === 'PERIOD') { piece = renderPeriod(rng, language, values.PERIOD, bare); label = 'Q_PERIOD'; slots.period = values.PERIOD; }
    if (name === 'CMP') { piece = renderPeriod(rng, language, values.CMP, bare); label = 'Q_CMP'; slots.comparison = values.CMP; }
    if (name === 'N') { piece = { text: renderTopN(rng, language, values.N) }; label = 'Q_TOPN'; slots.topN = values.N; }
    question += piece.pre ?? '';
    const start = question.length;
    question += piece.text;
    spans.push({ label, start, end: question.length, text: piece.text });
    question += piece.post ?? '';
  }
  question += template.slice(cursor);
  return { question, spans, slots };
}

/** Surface noise that never moves an offset: first-letter case, all-lower, dropped final '?'. */
function surfaceVariant(rng, row) {
  let { question } = row;
  if (/^\p{Ll}/u.test(question)) {
    const upper = question[0].toLocaleUpperCase('en-US');
    if (upper.length === 1) question = upper + question.slice(1);
  }
  if (!/\p{Script=Arabic}/u.test(question) && rng() < 0.2) {
    const lower = question.toLocaleLowerCase('en-US');
    if (lower.length === question.length) question = lower;
  }
  if (rng() < 0.25) question = question.replace(/\s*[?؟]$/u, '');
  const spans = row.spans.map((span) => ({ ...span, text: question.slice(span.start, span.end) }));
  return { ...row, question, spans };
}

function splitFor(index, count) {
  if (count >= 10) return index % 7 === 5 ? 'test' : index % 7 === 6 ? 'dev' : 'train';
  if (index === count - 1) return 'test';
  if (index === count - 2) return 'dev';
  return 'train';
}

function checkRow(row) {
  for (const span of row.spans) {
    if (row.question.slice(span.start, span.end) !== span.text) throw new Error(`${row.id}: span text drift`);
    const text = span.text;
    const fail = (what, got) => { throw new Error(`${row.id}: ${span.label} "${text}" normalises to ${got}, expected ${what}`); };
    if (span.label === 'Q_CAT' && ask.normalizeAskCategory(text) !== row.slots.category) fail(row.slots.category, ask.normalizeAskCategory(text));
    if (span.label === 'Q_PERIOD' && ask.normalizeAskPeriodKey(text) !== row.slots.period) fail(row.slots.period, ask.normalizeAskPeriodKey(text));
    if (span.label === 'Q_CMP' && ask.normalizeAskPeriodKey(text) !== row.slots.comparison) fail(row.slots.comparison, ask.normalizeAskPeriodKey(text));
    if (span.label === 'Q_TOPN' && ask.normalizeAskTopN(text) !== row.slots.topN) fail(row.slots.topN, ask.normalizeAskTopN(text));
  }
  if (!INTENTS.includes(row.intent)) throw new Error(`${row.id}: unknown intent ${row.intent}`);
  const allowed = ask.ASK_INTENT_SLOTS[row.intent];
  if (row.intent !== 'unknown' && row.spans.some((span) => !allowed.includes(span.label))) {
    throw new Error(`${row.id}: ${row.intent} cannot carry ${row.spans.map((s) => s.label)}`);
  }
}

/** Renderings per template: more for the smaller non-EN/AR template sets, more for out-of-scope. */
function repetitions(language, intent) {
  const big = language === 'en' || language === 'ar';
  if (intent === 'unknown') return big ? 6 : 8;
  return big ? 4 : 5;
}

function generate() {
  const rng = mulberry32(SEED);
  const rows = [];
  const seen = new Set();
  for (const language of LANGUAGES) {
    const byIntent = TEMPLATES[language];
    for (const intent of INTENTS) {
      const list = byIntent[intent];
      if (!list) throw new Error(`templates missing ${language}/${intent}`);
      list.forEach((raw, index) => {
        const gulf = raw.startsWith('g|');
        const source = gulf ? raw.slice(2) : raw;
        const split = splitFor(index, list.length);
        const template = `${language}/${intent}/${String(index).padStart(2, '0')}`;
        for (let rep = 0; rep < repetitions(language, intent) * 4 && rows.filter((r) => r.template === template).length < repetitions(language, intent); rep++) {
          const rendered = renderTemplate(rng, source, language, intent);
          const row = surfaceVariant(rng, {
            id: `${template.replace(/\//g, '-')}-${rep}`,
            language,
            dialect: language === 'ar' ? (gulf ? 'gulf' : 'msa') : null,
            template,
            split,
            question: rendered.question,
            intent,
            slots: rendered.slots,
            spans: rendered.spans,
          });
          if (seen.has(row.question)) continue;
          seen.add(row.question);
          checkRow(row);
          rows.push(row);
        }
      });
    }
  }
  return rows;
}

function stats(rows) {
  const count = (key) => rows.reduce((acc, row) => { const k = key(row); acc[k] = (acc[k] ?? 0) + 1; return acc; }, {});
  return {
    total: rows.length,
    bySplit: count((row) => row.split),
    byLanguage: count((row) => row.language),
    byIntent: count((row) => row.intent),
    bySplitLanguage: count((row) => `${row.split}/${row.language}`),
    templates: new Set(rows.map((row) => row.template)).size,
  };
}

function writeOut(dir, rows) {
  fs.mkdirSync(dir, { recursive: true });
  for (const split of ['train', 'dev', 'test']) {
    fs.writeFileSync(path.join(dir, `${split}.jsonl`), rows.filter((row) => row.split === split).map((row) => JSON.stringify(row)).join('\n') + '\n');
  }
  fs.writeFileSync(path.join(dir, 'labels.json'), JSON.stringify({ intents: INTENTS, slotLabels: SLOT_LABELS, bioLabels: BIO_LABELS, languages: LANGUAGES, seed: SEED, now: NOW.toISOString() }, null, 2) + '\n');
}

module.exports = { INTENTS, SLOT_LABELS, BIO_LABELS, LANGUAGES, ACCOUNTS, MERCHANTS, NOW, SEED, generate, stats };

if (require.main === module) {
  const args = process.argv.slice(2);
  const outIndex = args.indexOf('--out');
  const rows = generate();
  if (outIndex >= 0) {
    const dir = path.resolve(args[outIndex + 1] ?? '');
    writeOut(dir, rows);
    console.log(`wrote ${rows.length} rows to ${dir}`);
  }
  console.log(JSON.stringify(stats(rows), null, 2));
}
