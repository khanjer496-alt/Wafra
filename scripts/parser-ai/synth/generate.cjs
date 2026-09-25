'use strict';
/**
 * Deterministic synthetic multilingual bank-alert generator.
 *
 * Every row's label is known by construction (schema.cjs) and every slot's
 * character span is recorded, so the same data drives both the rule-baseline
 * scoring and token-tagger training. Splits are by TEMPLATE FAMILY: a test
 * row's template never appears in train/dev. Merchant, person, biller and
 * employer names are split the same way, so test rows also carry unseen names.
 *
 *   node scripts/parser-ai/synth/generate.cjs [--out dir] [--seed n]
 * writes train/dev/test .jsonl (default: stdout summary only).
 */
const fs = require('node:fs');
const path = require('node:path');
const { COUNTRIES, SCALE } = require('./locales.cjs');
const { TEMPLATES, EVENT_LABEL } = require('./templates.cjs');

const EXPONENT = { KWD: 3, BHD: 3, OMR: 3, JOD: 3, JPY: 0, CLP: 0, KRW: 0 };
const exponentOf = (cur) => EXPONENT[cur] ?? 2;

function rngFrom(seed) {
  let a = seed >>> 0;
  const next = () => {
    a = (a + 0x6D2B79F5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
  const pick = (list) => list[Math.floor(next() * list.length)];
  const int = (lo, hi) => lo + Math.floor(next() * (hi - lo + 1));
  return { next, pick, int, chance: (p) => next() < p };
}

/* ── money ─────────────────────────────────────────────────────────────── */
const AR_DIGITS = '٠١٢٣٤٥٦٧٨٩';
const STYLES = {
  'comma-dot': [',', '.'], 'dot-comma': ['.', ','], 'space-comma': [' ', ','], 'nbsp-comma': [' ', ','],
  'apos-dot': ["'", '.'], lakh: [',', '.'], plain: ['', '.'], 'dot-int': ['.', null], arabic: ['٬', '٫'],
};
function groupInt(intStr, sep, lakh) {
  if (!sep || intStr.length <= 3) return intStr;
  if (lakh) {
    const last3 = intStr.slice(-3);
    const rest = intStr.slice(0, -3).replace(/\B(?=(\d{2})+(?!\d))/g, sep);
    return `${rest}${sep}${last3}`;
  }
  return intStr.replace(/\B(?=(\d{3})+(?!\d))/g, sep);
}
function formatNumber(minor, exp, style, rng) {
  const [group, dec] = STYLES[style];
  const s = minor.toString().padStart(exp + 1, '0');
  const intStr = exp ? s.slice(0, -exp) : s;
  const frac = exp ? s.slice(-exp) : '';
  const useGroup = style === 'dot-int' || rng.chance(0.7);
  let out = groupInt(intStr, useGroup ? group : '', style === 'lakh');
  if (dec && exp && !(Number(frac) === 0 && rng.chance(0.3))) out += dec + frac;
  if (style === 'arabic') out = out.replace(/\d/g, (d) => AR_DIGITS[Number(d)]);
  return out;
}
function drawAmount(cur, rng, kind) {
  const [lo, hi] = kind === 'salary' ? [900, 9000] : kind === 'withdrawal' ? [20, 600] : kind === 'balance' ? [50, 25000] : [1.5, 450];
  const scale = SCALE[cur] ?? 1;
  let major = Math.exp(Math.log(lo) + rng.next() * (Math.log(hi) - Math.log(lo))) * scale;
  const exp = exponentOf(cur);
  if (scale >= 1000) major = Math.round(major / 500) * 500 || 500;
  else if (scale >= 50) major = rng.chance(0.5) ? Math.round(major) : major;
  if (kind === 'withdrawal') major = Math.max(1, Math.round(major / (scale >= 50 ? 100 * Math.round(scale / 50) : 20)) * (scale >= 50 ? 100 * Math.round(scale / 50) : 20));
  return BigInt(Math.max(1, Math.round(major * 10 ** exp)));
}

/* ── dates ─────────────────────────────────────────────────────────────── */
const MONTHS = {
  en: ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'],
  fr: ['janv.', 'févr.', 'mars', 'avr.', 'mai', 'juin', 'juil.', 'août', 'sept.', 'oct.', 'nov.', 'déc.'],
  de: ['Jan.', 'Feb.', 'März', 'Apr.', 'Mai', 'Juni', 'Juli', 'Aug.', 'Sep.', 'Okt.', 'Nov.', 'Dez.'],
  es: ['ene', 'feb', 'mar', 'abr', 'may', 'jun', 'jul', 'ago', 'sep', 'oct', 'nov', 'dic'],
  pt: ['jan', 'fev', 'mar', 'abr', 'mai', 'jun', 'jul', 'ago', 'set', 'out', 'nov', 'dez'],
  it: ['gen', 'feb', 'mar', 'apr', 'mag', 'giu', 'lug', 'ago', 'set', 'ott', 'nov', 'dic'],
  nl: ['jan', 'feb', 'mrt', 'apr', 'mei', 'jun', 'jul', 'aug', 'sep', 'okt', 'nov', 'dec'],
  tr: ['Oca', 'Şub', 'Mar', 'Nis', 'May', 'Haz', 'Tem', 'Ağu', 'Eyl', 'Eki', 'Kas', 'Ara'],
  id: ['Jan', 'Feb', 'Mar', 'Apr', 'Mei', 'Jun', 'Jul', 'Agu', 'Sep', 'Okt', 'Nov', 'Des'],
  ar: ['يناير', 'فبراير', 'مارس', 'أبريل', 'مايو', 'يونيو', 'يوليو', 'أغسطس', 'سبتمبر', 'أكتوبر', 'نوفمبر', 'ديسمبر'],
};
const YEARLESS = new Set(['M/D', 'D Mon', 'D/M', 'D.M.']);
function formatDate(fmt, y, m, d, lang, rng) {
  const p = (n) => String(n).padStart(2, '0');
  const dd = rng.chance(0.8) ? p(d) : String(d);
  const mm = rng.chance(0.8) ? p(m) : String(m);
  const mon = (MONTHS[lang] ?? MONTHS.en)[m - 1];
  const yy = String(y).slice(2);
  switch (fmt) {
    case 'M/D/Y': return `${mm}/${dd}/${y}`;
    case 'M/D/YY': return `${mm}/${dd}/${yy}`;
    case 'Mon D, Y': return `${mon} ${d}, ${y}`;
    case 'M/D': return `${mm}/${dd}`;
    case 'D/M/Y': return `${dd}/${mm}/${y}`;
    case 'D-M-Y': return `${dd}-${mm}-${y}`;
    case 'D.M.Y': return `${p(d)}.${p(m)}.${y}`;
    case 'D/M/YY': return `${dd}/${mm}/${yy}`;
    case 'D-M-YY': return `${p(d)}-${p(m)}-${yy}`;
    case 'D.M.YY': return `${p(d)}.${p(m)}.${yy}`;
    case 'Y-M-D': return `${y}-${p(m)}-${p(d)}`;
    case 'Y/M/D': return `${y}/${p(m)}/${p(d)}`;
    case 'D Mon Y': return `${d} ${mon} ${y}`;
    case 'DMonYY': return `${p(d)}${MONTHS.en[m - 1]}${yy}`;
    case 'D-Mon-Y': return `${p(d)}-${MONTHS.en[m - 1]}-${y}`;
    case 'D Mon': return `${d} ${mon}`;
    case 'D/M': return `${dd}/${mm}`;
    case 'D.M.': return `${p(d)}.${p(m)}.`;
    default: throw new Error(`date format ${fmt}`);
  }
}

/* ── name pools (split into train/test halves by index) ───────────────── */
const PEOPLE = {
  en: ['JOHN MILLER', 'Priya Nair', 'A. OKAFOR', 'Sarah Lee', 'MOHAMMED ALI', 'Grace Wanjiru', 'David Chen', 'Thabo Nkosi', 'Emily Brown', 'Rahul Verma', 'Maria Santos', 'Ahmed Raza'],
  ar: ['أحمد محمد', 'سارة علي', 'خالد العتيبي', 'فاطمة حسن', 'محمد الشمري', 'نورة سالم', 'يوسف إبراهيم', 'مريم عبدالله'],
  es: ['JUAN PEREZ', 'María García', 'Carlos López', 'LUCIA MARTINEZ', 'Andrés Gómez', 'Sofía Ruiz'],
  pt: ['JOAO SILVA', 'Ana Souza', 'Pedro Costa', 'MARIANA LIMA', 'Lucas Oliveira', 'Beatriz Santos'],
  fr: ['JEAN DUPONT', 'Marie Martin', 'Luc Bernard', 'CAMILLE PETIT', 'Hugo Moreau', 'Léa Laurent'],
  de: ['MAX MUELLER', 'Anna Schmidt', 'Lukas Weber', 'LENA FISCHER', 'Jonas Wagner', 'Sophie Becker'],
  it: ['MARCO ROSSI', 'Giulia Bianchi', 'Luca Romano', 'CHIARA COLOMBO', 'Matteo Ricci', 'Sara Greco'],
  nl: ['JAN DE VRIES', 'Emma Jansen', 'Daan Bakker', 'SANNE VISSER', 'Lars Smit', 'Fleur de Boer'],
  tr: ['AHMET YILMAZ', 'Ayşe Kaya', 'Mehmet Demir', 'ELIF ÇELIK', 'Emre Şahin', 'Zeynep Öztürk'],
  id: ['BUDI SANTOSO', 'Siti Rahma', 'Agus Wijaya', 'DEWI LESTARI', 'Rizky Pratama', 'Putri Ayu'],
  'hi-latn': ['RAHUL SHARMA', 'Priya Singh', 'Amit Kumar', 'NEHA GUPTA', 'Vikas Yadav', 'Pooja Patel'],
};
const EMPLOYERS = ['ACME TRADING LLC', 'GLOBEX SERVICES', 'NORTHWIND LTD', 'BLUE RIVER TECH', 'SUNRISE FOODS CO', 'ORBIT LOGISTICS', 'HELIX CONSULTING', 'CEDAR HEALTH GROUP'];
const BILLERS = {
  en: ['CITY ELECTRIC', 'WATERWORKS UTILITY', 'FIBERNET BROADBAND', 'MOBILE POSTPAID', 'CITY COUNCIL TAX', 'GAS CO'],
  ar: ['هيئة الكهرباء والماء', 'شركة الاتصالات', 'DEWA', 'SEC', 'du', 'Etisalat'],
  es: ['CFE', 'IBERDROLA', 'Movistar', 'Aguas de Barcelona', 'Telmex', 'Naturgy'],
  pt: ['ENEL', 'Sabesp', 'Vivo', 'Claro', 'CEMIG', 'EDP'],
  fr: ['EDF', 'Engie', 'Orange', 'SFR', 'Free Mobile', 'Veolia'],
  de: ['Stadtwerke', 'Vodafone', 'Telekom', 'E.ON', 'Rundfunkbeitrag', 'Vattenfall'],
  it: ['ENEL Energia', 'TIM', 'Hera', 'A2A', 'Fastweb', 'Acea'],
  nl: ['Vattenfall', 'KPN', 'Eneco', 'Ziggo', 'Waternet', 'Odido'],
  tr: ['Enerjisa', 'Türk Telekom', 'İSKİ', 'Turkcell', 'İGDAŞ', 'Vodafone TR'],
  id: ['PLN', 'Telkomsel', 'PDAM', 'IndiHome', 'BPJS Kesehatan', 'XL Axiata'],
  'hi-latn': ['BESCOM', 'Airtel', 'Jio', 'Tata Power', 'MSEDCL', 'BSNL'],
};
const ATMS = ['ATM 0412 MAIN ST', 'MALL BRANCH ATM', 'ATM-2231', 'CITY CENTRE ATM', 'AIRPORT T2 ATM'];
const half = (list, split) => list.filter((_, i) => (split === 'test' ? i % 3 === 2 : i % 3 !== 2));

/* ── composition with spans ───────────────────────────────────────────── */
function compose(template, fill) {
  let text = '';
  const spans = [];
  const re = /\{([A-Z0-9]+)\}|<([dcn])>|<\/([dcn])>/g;
  let last = 0;
  const open = {};
  for (let m = re.exec(template); m; m = re.exec(template)) {
    text += template.slice(last, m.index);
    last = re.lastIndex;
    if (m[1]) {
      const value = fill(m[1]);
      const start = text.length;
      text += value.text;
      for (const sub of value.spans ?? []) spans.push({ label: sub.label, start: start + sub.start, end: start + sub.end });
      if (value.label) spans.push({ label: value.label, start, end: text.length });
    } else if (m[2]) open[m[2]] = text.length;
    else {
      const label = { d: 'CUE_DEBIT', c: 'CUE_CREDIT', n: 'CUE_NONPOST' }[m[3]];
      spans.push({ label, start: open[m[3]], end: text.length });
    }
  }
  text += template.slice(last);
  return { text, spans };
}

function money(cur, minor, country, rng, forceCode) {
  const exp = exponentOf(cur);
  const home = cur === country.cur;
  const forms = home && !forceCode ? country.cf : [[cur, 'b', 1], [cur, 'a', 1]];
  const [sym, pos, space] = rng.pick(forms);
  let style = home ? rng.pick(country.num) : rng.pick(['comma-dot', country.num[0] === 'arabic' ? 'comma-dot' : country.num[0]]);
  if (style === 'dot-int' && minor % BigInt(10 ** exp) !== 0n) style = 'dot-comma';
  const num = formatNumber(minor, exp, style, rng);
  const gap = space ? ' ' : '';
  if (pos === 'b') return { text: `${sym}${gap}${num}`, spans: [{ label: 'CUR', start: 0, end: sym.length }, { label: 'AMT', start: sym.length + gap.length, end: sym.length + gap.length + num.length }] };
  return { text: `${num}${gap}${sym}`, spans: [{ label: 'AMT', start: 0, end: num.length }, { label: 'CUR', start: num.length + gap.length, end: num.length + gap.length + sym.length }] };
}

const FOOTERS = {
  en: [' Not you? Call us immediately.', ' Never share your OTP or PIN with anyone.', ' Avl Bal: {BAL}.', ' Download the {BANK} app for details.'],
  ar: [' إذا لم تقم بهذه العملية يرجى الاتصال بنا.', ' لا تشارك رمز التحقق مع أي شخص.', ' الرصيد المتاح {BAL}.'],
  es: [' Si no reconoces este movimiento, llámanos.', ' Nunca compartas tus claves.', ' Saldo: {BAL}.'],
  pt: [' Não reconhece? Ligue para a central.', ' Nunca informe sua senha.', ' Saldo: {BAL}.'],
  fr: [' Si vous n’êtes pas à l’origine de cette opération, contactez-nous.', ' Ne communiquez jamais vos codes.'],
  de: [' Nicht von Ihnen? Rufen Sie uns an.', ' Geben Sie niemals Ihre TAN weiter.'],
  it: [' Non sei stato tu? Chiamaci.', ' Non comunicare mai i tuoi codici.'],
  nl: [' Niet door u gedaan? Bel ons.', ' Deel nooit uw codes.'],
  tr: [' Bilginiz dışında ise bizi arayınız.', ' Şifrenizi kimseyle paylaşmayınız.'],
  id: [' Bukan Anda? Hubungi kami.', ' Jangan berikan PIN/OTP kepada siapa pun.'],
  'hi-latn': [' Aapne nahi kiya? Turant call karein.', ' Apna OTP kisi ko na batayein.'],
};

function splitOf(idx, groupSize) {
  if (groupSize < 2) return 'train';
  return ['train', 'test', 'train', 'dev'][idx % 4];
}

function templateCatalog() {
  const out = [];
  for (const [lang, list] of Object.entries(TEMPLATES)) {
    const counts = {};
    for (const [event] of list) counts[event] = (counts[event] ?? 0) + 1;
    const seen = {};
    for (const [event, template, options] of list) {
      const idx = seen[event] = (seen[event] ?? -1) + 1;
      out.push({ id: `${lang}:${event}:${idx}`, lang, event, template, only: options?.only ?? null, split: splitOf(idx, counts[event]) });
    }
  }
  return out;
}

function generate({ seed = 20260925, perTemplate = { train: 24, dev: 12, test: 30 } } = {}) {
  const rng = rngFrom(seed);
  const rows = [];
  for (const tpl of templateCatalog()) {
    const countries = COUNTRIES.filter((c) => c.langs.includes(tpl.lang) && (!tpl.only || tpl.only.includes(c.cc)));
    if (!countries.length) continue;
    const n = perTemplate[tpl.split];
    const lab = EVENT_LABEL[tpl.event];
    for (let k = 0; k < n; k++) {
      const country = rng.pick(countries);
      const [bankName, sender] = rng.pick(country.banks);
      const foreign = tpl.event === 'purchase' && country.cc !== 'US' && rng.chance(0.12);
      const cur = foreign ? rng.pick(['USD', 'EUR', 'GBP'].filter((c) => c !== country.cur)) : country.cur;
      const amountKind = tpl.event === 'salary' ? 'salary' : tpl.event === 'withdrawal' ? 'withdrawal' : 'txn';
      const minor = drawAmount(cur, rng, amountKind);
      const y = 2026; const m = rng.int(1, 9); const d = rng.int(1, m === 2 ? 28 : m === 9 ? 20 : 30);
      const dateFmt = rng.pick(country.dates);
      const dateText = formatDate(dateFmt, y, m, d, tpl.lang, rng);
      const merchant = rng.pick(half(country.merchants, tpl.split));
      const merchantText = rng.chance(0.15) && !/[؀-ۿ]/.test(merchant) ? `${merchant} ${rng.pick(['DUBAI', 'LONDON', 'MUMBAI', 'SAO PAULO', 'PARIS', 'BERLIN', 'MADRID', 'MILANO', 'ISTANBUL', 'JAKARTA', 'NAIROBI', 'LAGOS'])}` : merchant;
      const lang = tpl.lang;
      const person = rng.pick(half(PEOPLE[lang] ?? PEOPLE.en, tpl.split));
      const biller = rng.pick(half(BILLERS[lang] ?? BILLERS.en, tpl.split));
      const employer = rng.pick(half(EMPLOYERS, tpl.split));
      const card = String(rng.int(1000, 9999));
      const balMinor = drawAmount(country.cur, rng, 'balance');
      const fill = (slot) => {
        switch (slot) {
          case 'AMT': return money(cur, minor, country, rng, foreign);
          case 'BAL': case 'BAL2': return { ...money(country.cur, slot === 'BAL2' ? balMinor / 20n + 1n : balMinor, country, rng), label: 'BAL', spans: [] };
          case 'MER': return { text: merchantText, label: 'MER' };
          case 'BILLER': return { text: biller, label: 'MER' };
          case 'NAME': return { text: person };
          case 'EMPLOYER': return { text: employer };
          case 'DATE': return { text: dateText, label: 'DATE' };
          case 'TIME': return { text: rng.chance(0.5) ? `${String(rng.int(0, 23)).padStart(2, '0')}:${String(rng.int(0, 59)).padStart(2, '0')}` : `${rng.int(1, 12)}:${String(rng.int(0, 59)).padStart(2, '0')} ${rng.pick(['AM', 'PM'])}` };
          case 'CARD': return { text: card };
          case 'ACCT': return { text: rng.chance(0.3) ? `XXXX${rng.int(1000, 9999)}` : String(rng.int(1000, 9999)) };
          case 'BANK': return { text: bankName };
          case 'OTP': return { text: String(rng.int(100000, 999999)) };
          case 'REF': return { text: Array.from({ length: 10 }, () => rng.pick('ABCDEFGHJKLMNPQRSTUVWXYZ0123456789'.split(''))).join('') };
          case 'VPA': return { text: `${person.split(' ')[0].toLowerCase()}${rng.int(1, 99)}@ok${rng.pick(['axis', 'hdfcbank', 'sbi', 'icici'])}` };
          case 'PHONE': return { text: `07${rng.int(10, 99)}***${rng.int(100, 999)}` };
          case 'ATM': return { text: rng.pick(ATMS) };
          case 'RAIL': return { text: rng.pick(country.rails ?? ['bank transfer']) };
          default: throw new Error(`slot ${slot}`);
        }
      };
      let template = tpl.template;
      if (!template.includes('{BANK}') && rng.chance(0.3)) template = `{BANK}: ${template}`;
      if (rng.chance(0.25)) template += rng.pick(FOOTERS[lang] ?? FOOTERS.en);
      let { text, spans } = compose(template, fill);
      if (rng.chance(0.05) && lang !== 'ar') text = text.toUpperCase();
      const posting = lab.status === 'completed';
      const mer = spans.find((s) => s.label === 'MER');
      const hasDate = tpl.template.includes('{DATE}');
      const label = {
        status: lab.status,
        shouldPost: posting,
        family: posting ? lab.family : 'non-posting',
        direction: posting ? lab.direction : 'none',
        amount: lab.noAmount ? null : { minor: minor.toString(), currency: cur, exponent: exponentOf(cur) },
        merchant: posting && lab.merchantSlot && mer ? text.slice(mer.start, mer.end) : undefined,
        date: !posting ? undefined : !hasDate ? null : YEARLESS.has(dateFmt) ? undefined : `${y}-${String(m).padStart(2, '0')}-${String(d).padStart(2, '0')}`,
      };
      rows.push({
        id: `syn:${tpl.id}:${k}`, source: 'synthetic', country: country.cc, language: lang, bank: bankName, sender,
        template: tpl.id, event: tpl.event, split: tpl.split, body: text, label, spans: spans.sort((a, b) => a.start - b.start),
        foreignCurrency: foreign, dateFormat: hasDate ? dateFmt : null,
      });
    }
  }
  return rows;
}

module.exports = {
  generate, templateCatalog, formatNumber, compose,
  // Shared with generate-v2.cjs (phase 2); exporting them changes no output.
  rngFrom, money, drawAmount, formatDate, exponentOf, half, PEOPLE, EMPLOYERS, BILLERS, ATMS, FOOTERS, YEARLESS,
};

if (require.main === module) {
  const args = process.argv.slice(2);
  const out = args.includes('--out') ? args[args.indexOf('--out') + 1] : null;
  const seed = args.includes('--seed') ? Number(args[args.indexOf('--seed') + 1]) : undefined;
  const rows = generate({ seed });
  const by = {};
  for (const r of rows) by[r.split] = (by[r.split] ?? 0) + 1;
  const cat = templateCatalog();
  const tplBy = {};
  for (const t of cat) tplBy[t.split] = (tplBy[t.split] ?? 0) + 1;
  console.log(JSON.stringify({ rows: rows.length, bySplit: by, templates: cat.length, templatesBySplit: tplBy,
    countries: new Set(rows.map((r) => r.country)).size, languages: new Set(rows.map((r) => r.language)).size }));
  if (out) {
    fs.mkdirSync(out, { recursive: true });
    for (const split of ['train', 'dev', 'test']) {
      fs.writeFileSync(path.join(out, `${split}.jsonl`), rows.filter((r) => r.split === split).map((r) => JSON.stringify(r)).join('\n') + '\n');
    }
  }
}
