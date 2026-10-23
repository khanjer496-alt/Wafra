'use strict';
/**
 * Alert-lab generator: composes labelled bank alerts from independent slot
 * inventories (market, language phrasing, layout, money style, date style,
 * instrument, merchant/counterparty, trailing context, sender style), then
 * derives paired NEGATIVE alerts (metamorphic safety mutations) and
 * label-preserving INVARIANCE variants from each positive.
 *
 * Every inventory item has a stable id; `splitOf(id)` puts it in DEV or
 * HOLDOUT. Generating with split "holdout" draws only holdout items, so the
 * output is phrasings/merchants/layout labels/money and date styles that the
 * parser lanes never tuned on. Structural choices (market, family, layout
 * kind, sender style, amounts, dates) are not split: they are the axes the
 * report is broken down by, not vocabulary.
 *
 * Deterministic: the same (seed, split, market, family, index) always yields
 * the same rows, independent of which other markets were requested.
 */
const { rngFor, splitOf, fnv1a, shortHash } = require('./lib/prng.cjs');
const { render, items } = require('./lib/template.cjs');
const { S, formatMoney, exponentOf, NBSP } = require('./lib/money.cjs');
const { formatDate, iso } = require('./lib/dates.cjs');
const { MARKETS, byId, SENDER_STYLES, FOREIGN } = require('./inventory/markets.cjs');
const M = require('./inventory/merchants.cjs');

const LEX = (() => {
  const nordic = require('./lexicon/nordic.cjs');
  const list = [require('./lexicon/en.cjs'), require('./lexicon/ar.cjs'), require('./lexicon/de.cjs'), require('./lexicon/fr.cjs'),
    require('./lexicon/nl.cjs'), require('./lexicon/es.cjs'), require('./lexicon/pt.cjs'), require('./lexicon/it.cjs'),
    require('./lexicon/pl.cjs'), require('./lexicon/cs.cjs'), nordic.sv, nordic.da, nordic.nb];
  const en = list[0];
  const extras = require('./lexicon/extras.cjs');
  const round2 = require('./lexicon/round2.cjs');
  const round3 = require('./lexicon/round3.cjs').lex;
  // Deep-merge: arrays concatenate, objects recurse. Packs stay read-only.
  const merge = (base, add) => {
    if (Array.isArray(base)) return base.concat(add ?? []);
    if (!add) return base;
    const out = { ...base };
    for (const [k, v] of Object.entries(add)) out[k] = k in out ? merge(out[k], v) : v;
    return out;
  };
  return Object.fromEntries(list.map((L) => [L.id, { ...merge(merge(merge(L, extras[L.id]), round2[L.id]), round3[L.id]), monthsEn: en.months }]));
})();

const FAMILIES = ['purchase', 'cnp', 'atm', 'refund', 'fee', 'incoming', 'outgoing', 'bill'];
const DIRECTION = { purchase: 'expense', cnp: 'expense', atm: 'expense', refund: 'income', fee: 'expense', incoming: 'income', outgoing: 'expense', bill: 'expense' };
const INS_KIND = { purchase: 'card', cnp: 'card', atm: 'card', refund: 'card', fee: 'account', incoming: 'account', outgoing: 'account', bill: 'account' };
const NEG_GROUP = { purchase: 'c', cnp: 'c', atm: 'c', refund: 'c', fee: 'c', incoming: 'x', outgoing: 'x', bill: 'x' };
const NEG_TYPES = ['declined', 'pending', 'future', 'conditional', 'question', 'negation', 'otp', 'promo', 'request', 'statement', 'balance', 'chat', 'scam',
  // Round 2 (english/europe lane reviews); see lexicon/round2.cjs.
  'hold', 'renewal', 'returned', 'example', 'limit', 'cardpay', 'ownmove', 'unclaimed', 'hedge', 'nocharge', 'gluedq', 'thirdp2p', 'notyet', 'billrecv', 'payeercpt',
  // Round 3 (final worldwide review); see lexicon/round3.cjs and composeTransform.
  'statusline', 'statusword', 'issuerpay', 'vishing', 'ownacct', 'signflip', 'krlang', 'threshold'];
const R3 = require('./lexicon/round3.cjs');
/** Round-3 kinds built by transforming the base positive rather than from a template. */
const TRANSFORM_TYPES = new Set(['statusline', 'statusword', 'issuerpay', 'vishing', 'ownacct', 'signflip']);

/**
 * What a negative may become instead of nothing. Anything else booked is a
 * FALSE-POST, except a transaction in a `wrong` direction, which is WRONG.
 * `amounts: 'stated'` = the alert's own amount (or a statement's minimum).
 *  - statement/future/renewal/billrecv: a typed reminder for the stated sum.
 *  - cardpay: paying a credit-card bill is a cardPayment, never an expense.
 *  - ownmove: a move between own accounts may book only as a transfer-flagged
 *    row (transferHint), which the ledger keeps out of spending and income.
 *  - thirdp2p: someone else sent the money; a credit is fine, an expense WRONG.
 *  - payeercpt: the payee confirms your payment; an expense is fine, income WRONG.
 */
const NEG_ALLOWED = {
  statement: { allowed: [{ kind: 'cardStatement' }, { kind: 'billDue' }] },
  future: { allowed: [{ kind: 'billDue' }] },
  renewal: { allowed: [{ kind: 'billDue' }] },
  billrecv: { allowed: [{ kind: 'billDue' }] },
  cardpay: { allowed: [{ kind: 'cardPayment' }] },
  ownmove: { allowed: [{ kind: 'transaction', transfer: true }] },
  thirdp2p: { allowed: [{ kind: 'transaction', type: 'income' }], wrong: ['expense'] },
  payeercpt: { allowed: [{ kind: 'transaction', type: 'expense' }], wrong: ['income'] },
  // Round 3: an issuer payee settles a card; an own-account destination is a
  // transfer; a contradicting sign or a `kr` in another Nordic language than
  // the user's country leaves direction / currency unknowable, so ANY booking
  // is WRONG.
  issuerpay: { allowed: [{ kind: 'cardPayment' }] },
  ownacct: { allowed: [{ kind: 'transaction', transfer: true }] },
  signflip: { allowed: [], wrong: ['income', 'expense'] },
  krlang: { allowed: [], wrong: ['income', 'expense'] },
};
const ISSUERS = {
  US: ['AMERICAN EXPRESS', 'CAPITAL ONE', 'CITI CARDS', 'DISCOVER CARD', 'CHASE CREDIT CRD AUTOPAY'],
  CA: ['AMEX BANK OF CANADA', 'RBC VISA', 'TD VISA'], GB: ['AMERICAN EXPRESS', 'BARCLAYCARD', 'MBNA'],
};
const INV_TYPES = ['balance-footer', 'fraud-footer', 'optout', 'whitespace', 'emoji', 'nbsp', 'merchant-case', 'sender-equivalent'];
const EMOJI = { purchase: ['🛒', '☕', '💳', '🛍️'], cnp: ['🌐', '📦', '💻'], atm: ['🏧', '💵'], refund: ['↩️', '💸'], fee: ['🧾', 'ℹ️'], incoming: ['💰', '📥', '🎉'], outgoing: ['💸', '📤'], bill: ['🧾', '⚡', '📱'] };
const MASKS = ['***{L4}', '****{L4}', 'xxxx{L4}', '·{L4}', '...{L4}', '*{L4}', 'XXXX{L4}', '••{L4}'];
const SCAM_DOMAINS = ['secure-verify-card.top', 'refund-claim.xyz', 'acct-unlock.info', 'parcel-fee.click'];
const OBSERVED = { y: 2026, m: 10, d: 12 };

// ---------------------------------------------------------------------------
// Inventories. Every item has an `id` (where it lives) and a content key `ck`
// (what it says). The DEV/HOLDOUT half is decided by CONTENT, once, across
// all markets and languages: "12,34 EUR", "NETFLIX" or an identical da/nb
// phrasing is on the same side everywhere, so HOLDOUT is unseen text, not
// just unseen ids.
const B = {
  lex: (lang, section, fam) => {
    const L = LEX[lang];
    const src = fam ? L[section]?.[fam] : L[section];
    return src ? items(`${lang}.${section}${fam ? `.${fam}` : ''}`, src).map((it) => ({ ...it, ck: `text|${it.t}` })) : [];
  },
  field: (lang, field, fam) => {
    const f = LEX[lang].fields;
    const src = field === 'title' ? f.title[fam] : f[field];
    return (src ?? []).map((t) => ({ id: `${lang}.fields.${field}${fam ? `.${fam}` : ''}:${t}`, t, ck: `text|${t}` }));
  },
  // The market's primary format(s) ("$12.34", "12,34 €", "AED 12.34") are
  // core: reading them is table stakes, not generalisation, so both halves
  // see them. Core = the first style of the list plus any marked `core`.
  money: (market, script) => {
    const list = script === 'ar' ? (market.money.ar ?? market.money.latin) : market.money.latin;
    return list.map((st, i) => ({ ...st, core: i === 0 || !!st.core, id: `${market.id}:money:${script}:${st.id}`, ck: `money|${st.id}` }));
  },
  date: (market, lang) => market.dates.filter((d) => !d.langs || d.langs.includes(lang))
    .map((d) => ({ ...d, id: `${market.id}:date:${lang}:${d.style}|${d.time}`, ck: `date|${d.style}|${d.time}` })),
  mask: () => MASKS.map((t) => ({ id: `mask:${t}`, t, ck: `mask|${t}` })),
  issuer: (market) => (R3.issuers[market.id] ?? []).concat(R3.issuers.global).map((t) => ({ id: `issuer.${market.id}:${t}`, t, ck: `issuer|${t}` })),
  ownAccount: (lang) => (R3.ownAccounts[lang] ?? R3.ownAccounts.en).map((t) => ({ id: `own.${lang}:${t}`, t, ck: `own|${t}` })),
  merchant: (market, kind, lang) => {
    const named = (prefix, list) => list.map((t) => ({ id: `${prefix}:${t}`, t, ck: `name|${t}` }));
    if (kind === 'local') return named(`mer.${market.id}`, M.local[market.id] ?? []);
    if (kind === 'global') return named('mer.global', M.global);
    if (kind === 'tricky') return named('mer.tricky', M.tricky);
    if (kind === 'arabic') return named('mer.ar', M.arabicLocal);
    if (kind === 'biller') return named(`bill.${market.id}`, (M.billers[market.id] ?? []).concat(M.billers.global));
    if (kind === 'atm') return named(`atm.${market.id}`, M.atm[market.id] ?? ['CITY CENTRE']);
    if (kind === 'person') return named(`person.${lang}`, M.people[lang] ?? M.people.en);
    if (kind === 'employer') return named(`employer.${lang}`, M.employers[lang] ?? M.employers.en);
    return [];
  },
};

/** Every inventory group, by name, for the split assignment and manifest. */
function allGroups() {
  const groups = [];
  const add = (name, list) => groups.push({ name, list });
  for (const lang of Object.keys(LEX)) {
    for (const section of ['sentence', 'headline', 'push']) for (const fam of FAMILIES) add(section, B.lex(lang, section, fam));
    for (const kind of ['card', 'account']) add('instrument', B.lex(lang, 'ins', kind));
    for (const kind of Object.keys(LEX[lang].trailer)) add('trailer', B.lex(lang, 'trailer', kind));
    for (const type of NEG_TYPES) add('negative', B.lex(lang, 'neg', type));
    for (const field of ['amount', 'merchant', 'place', 'payer', 'payee', 'card', 'date']) add('field-label', B.field(lang, field, null));
    for (const fam of FAMILIES) add('field-title', B.field(lang, 'title', fam));
  }
  add('mask', B.mask());
  for (const market of MARKETS) add('issuer', B.issuer(market));
  for (const lang of Object.keys(LEX)) add('own-account', B.ownAccount(lang));
  for (const market of MARKETS) {
    for (const script of ['latin', 'ar']) if (script === 'latin' || market.money.ar) add('money', B.money(market, script));
    for (const [l] of market.langs) add('date', B.date(market, l));
    for (const kind of ['local', 'biller', 'atm']) add('merchant', B.merchant(market, kind, 'en'));
  }
  for (const kind of ['global', 'tricky', 'arabic']) add('merchant', B.merchant(MARKETS[0], kind, 'en'));
  for (const lang of Object.keys(M.people)) { add('counterparty', B.merchant(MARKETS[0], 'person', lang)); add('counterparty', B.merchant(MARKETS[0], 'employer', lang)); }
  return groups;
}

let SIDE = null;
/**
 * Content -> half. Parity of a hash of the content decides; then, for any
 * group of two or more items that landed on one side, the item that sits in
 * the fewest groups (ties: highest secondary hash) moves across, globally.
 * Repeated until stable, so the result is one consistent assignment.
 */
function sides() {
  if (SIDE) return SIDE;
  const coreKeys = new Set(allGroups().flatMap((g) => g.list.filter((it) => it.core).map((it) => it.ck)));
  const groups = allGroups().map((g) => [...new Set(g.list.filter((it) => !coreKeys.has(it.ck)).map((it) => it.ck))]).filter((g) => g.length >= 2);
  const membership = new Map();
  for (const g of groups) for (const ck of g) membership.set(ck, (membership.get(ck) ?? 0) + 1);
  const side = new Map();
  for (const g of allGroups()) for (const it of g.list) if (!side.has(it.ck)) side.set(it.ck, splitOf(it.ck));
  for (let pass = 0; pass < 20; pass += 1) {
    let changed = false;
    for (const g of groups) {
      const first = side.get(g[0]);
      if (!g.every((ck) => side.get(ck) === first)) continue;
      const mover = g.slice().sort((a, b) => (membership.get(a) - membership.get(b)) || (fnv1a(`alert-lab-move:${b}`) - fnv1a(`alert-lab-move:${a}`)))[0];
      side.set(mover, first === 'dev' ? 'holdout' : 'dev');
      changed = true;
    }
    if (!changed) break;
  }
  // Content that is core anywhere (a market's primary money format) is
  // shared everywhere, so no half can be said to have it "unseen".
  for (const g of allGroups()) for (const it of g.list) if (it.core) side.set(it.ck, 'both');
  SIDE = side;
  return SIDE;
}

const cache = new Map();
const pool = (key, build, split) => {
  const k = `${key}#${split}`;
  if (!cache.has(k)) {
    const S = sides();
    const all = build().map((it) => ({ ...it, split: S.get(it.ck) ?? splitOf(it.ck) }));
    cache.set(k, split === 'all' ? all : all.filter((it) => it.split === split || it.split === 'both'));
  }
  return cache.get(k);
};

const lexPool = (lang, section, fam, split) => pool(`lex:${lang}:${section}:${fam}`, () => B.lex(lang, section, fam), split);
const fieldPool = (lang, field, fam, split) => pool(`field:${lang}:${field}:${fam ?? ''}`, () => B.field(lang, field, fam), split);
// Split the market's whole list, THEN filter by language.
const moneyPool = (market, script, lang, split) => pool(`money:${market.id}:${script}`, () => B.money(market, script), split)
  .filter((st) => !st.lang || st.lang === lang);
const datePool = (market, lang, split) => pool(`date:${market.id}:${lang}`, () => B.date(market, lang), split);
const maskPool = (split) => pool('masks', () => B.mask(), split);
const issuerPool = (market, split) => pool(`issuer:${market.id}`, () => B.issuer(market), split);
const ownAccountPool = (lang, split) => pool(`own:${lang}`, () => B.ownAccount(lang), split);
const merchantPool = (market, kind, lang, split) => pool(`mer:${market.id}:${kind}:${lang}`, () => B.merchant(market, kind, lang), split);

/** Non-empty pick from the split pool, else from the full pool (recorded). */
function pickFrom(rng, list, fallback, leaks, what) {
  if (list.length) return rng.pick(list);
  const all = fallback();
  if (!all.length) return null;
  leaks.push(what);
  return rng.pick(all);
}

// ---------------------------------------------------------------------------
const SCALE = { USD: 1, CAD: 1.3, GBP: 0.8, EUR: 0.9, CHF: 0.9, PLN: 4, SEK: 10, NOK: 10, DKK: 7, CZK: 23, AED: 3.7, SAR: 3.75, QAR: 3.6, KWD: 0.3, BHD: 0.38, OMR: 0.38, JOD: 0.7, EGP: 48, IQD: 1300, JPY: 150, MXN: 18 };

function amountFor(rng, family, currency) {
  const exp = exponentOf(currency);
  const scale = SCALE[currency] ?? 1;
  let major;
  if (family === 'atm') major = rng.pick([20, 40, 50, 60, 80, 100, 200, 300, 400, 500, 1000]) * (scale >= 3 ? Math.round(scale / 10) * 10 || 1 : 1) * (scale < 1 ? 1 : 1);
  else {
    const R = { purchase: [1, 180], cnp: [3, 220], refund: [3, 250], fee: [0.5, 35], incoming: [10, 1500], outgoing: [5, 2500], bill: [15, 450] }[family];
    major = R[0] + rng.next() * (R[1] - R[0]);
    if ((family === 'purchase' || family === 'cnp') && rng.chance(0.12)) major = 180 + rng.next() * 3800;
    if (family === 'incoming' && rng.chance(0.3)) major = 1500 + rng.next() * 7500;
    major *= scale;
  }
  const unit = 10 ** exp;
  let minor = Math.round(major * unit);
  if (exp === 0) minor = Math.max(250, Math.round(minor / 250) * 250);
  if (family === 'atm') minor = Math.max(unit, Math.round(minor / unit) * unit);
  else if (exp > 0 && rng.chance(0.15)) minor = Math.max(unit, Math.round(minor / unit) * unit);
  return Math.max(1, minor);
}

const pastDate = (rng) => {
  const back = rng.int(1, 22);
  const dt = new Date(Date.UTC(OBSERVED.y, OBSERVED.m - 1, OBSERVED.d - back));
  return { y: dt.getUTCFullYear(), m: dt.getUTCMonth() + 1, d: dt.getUTCDate(), h: rng.int(7, 22), min: rng.int(0, 59) };
};
const futureDate = (rng) => {
  const ahead = rng.int(4, 28);
  const dt = new Date(Date.UTC(OBSERVED.y, OBSERVED.m - 1, OBSERVED.d + ahead));
  return { y: dt.getUTCFullYear(), m: dt.getUTCMonth() + 1, d: dt.getUTCDate(), h: 0, min: 0 };
};
const titleCase = (s) => s.toLowerCase().replace(/(^|[\s/&*.'-])(\p{L})/gu, (m, a, b) => a + b.toUpperCase());

// ---------------------------------------------------------------------------
/** Choose every slot for one positive alert. Pure function of its rng. */
function composePositive({ market, family, split, rng, index }) {
  const leaks = [];
  const lang = rng.weighted(market.langs);
  const L = LEX[lang];
  const bilingualOk = market.langs.some(([l]) => l === 'ar') && market.langs.some(([l]) => l === 'en');
  let layout = rng.weighted([['sentence', 5], ['headline', 2], ['fields', 2], ['push', 1.5], ['bilingual', bilingualOk ? 1 : 0]]);
  // A layout whose vocabulary has nothing in this split falls back to a
  // plain sentence instead of borrowing the other half's items.
  const partyField = family === 'incoming' ? 'payer' : family === 'outgoing' || family === 'bill' ? 'payee' : family === 'atm' ? 'place' : family === 'fee' ? null : 'merchant';
  const has = (list) => list.length > 0;
  const available = {
    sentence: true,
    headline: has(lexPool(lang, 'headline', family, split)),
    push: has(lexPool(lang, 'push', family, split)),
    bilingual: bilingualOk && has(lexPool('ar', 'sentence', family, split)) && has(lexPool('en', 'sentence', family, split)),
    fields: ['amount', 'card', 'date'].every((f) => has(fieldPool(lang, f, null, split))) && has(fieldPool(lang, 'title', family, split)) &&
      (!partyField || has(fieldPool(lang, partyField, null, split))),
  };
  if (!available[layout]) layout = 'sentence';
  const primaryLang = layout === 'bilingual' ? 'ar' : lang;

  // Currency: the ledger, or (purchases only) an explicitly named foreign one.
  let currency = market.ledger;
  let foreign = false;
  if ((family === 'purchase' || family === 'cnp') && rng.chance(0.08)) {
    currency = rng.pick(FOREIGN[market.id] ?? FOREIGN.default).replace(market.ledger, 'USD');
    if (currency === market.ledger) currency = 'EUR';
    foreign = currency !== market.ledger;
  }
  const exponent = exponentOf(currency);
  const amountMinor = amountFor(rng, family, currency);
  const pickMoney = (forLang) => {
    const script = forLang === 'ar' ? 'ar' : 'latin';
    return pickFrom(rng, moneyPool(market, script, forLang, split), () => moneyPool(market, script, forLang, 'all'), leaks, `money:${market.id}:${script}`);
  };
  let money = pickMoney(primaryLang);
  if (foreign) {
    // A foreign amount names its ISO code; keep the market's decimal habits.
    const base = moneyPool(market, 'latin', lang, 'all')[0];
    money = { ...S(rng.chance(0.5) ? 'pre' : 'post', currency, ' ', base.dec, base.grp === '' ? ',' : base.grp), id: `${market.id}:money:foreign` };
    if (money.dec === money.grp) money.grp = money.dec === ',' ? '.' : ',';
  }
  const moneySecond = layout === 'bilingual' && !foreign ? pickMoney('en') : money;

  const dateStyle = pickFrom(rng, datePool(market, primaryLang, split), () => datePool(market, primaryLang, 'all'), leaks, `date:${market.id}`);
  const date = pastDate(rng);
  const insKind = INS_KIND[family];
  const insTpl = pickFrom(rng, lexPool(primaryLang, 'ins', insKind, split), () => lexPool(primaryLang, 'ins', insKind, 'all'), leaks, `ins:${primaryLang}`);
  const insTplSecond = layout === 'bilingual' ? pickFrom(rng, lexPool('en', 'ins', insKind, split), () => lexPool('en', 'ins', insKind, 'all'), leaks, 'ins:en') : null;
  const mask = pickFrom(rng, maskPool(split), () => maskPool('all'), leaks, 'mask');
  const l4 = String(rng.int(1000, 9999));

  let merchant = null;
  let merchantSource = null;
  if (family === 'bill') { merchantSource = 'biller'; }
  else if (family === 'atm') { merchantSource = 'atm'; }
  else if (family === 'purchase' || family === 'cnp' || family === 'refund') {
    merchantSource = rng.weighted([['local', 6], ['global', 2.5], ['tricky', 1.5], ['arabic', primaryLang === 'ar' && layout !== 'bilingual' ? 0.5 : 0]]);
  }
  if (merchantSource) {
    const list = merchantPool(market, merchantSource, primaryLang, split);
    // An ATM place is optional context; never borrow one across the split.
    merchant = merchantSource === 'atm' ? (list.length ? rng.pick(list) : null)
      : pickFrom(rng, list, () => merchantPool(market, merchantSource, primaryLang, 'all'), leaks, `mer:${merchantSource}`);
  }
  let cp = null;
  if (family === 'incoming' || family === 'outgoing') {
    const src = family === 'incoming' && rng.chance(0.3) ? 'employer' : 'person';
    const cpLang = layout === 'bilingual' ? 'ar' : lang;
    cp = pickFrom(rng, merchantPool(market, src, cpLang, split), () => merchantPool(market, src, cpLang, 'all'), leaks, `cp:${src}`);
  }
  // A merchant for negatives of transfer families and vice versa.
  const negMerchant = merchant ?? pickFrom(rng, merchantPool(market, 'local', lang, split), () => merchantPool(market, 'local', lang, 'all'), leaks, 'mer:local');
  const negCp = cp ?? pickFrom(rng, merchantPool(market, 'person', lang, split), () => merchantPool(market, 'person', lang, 'all'), leaks, 'cp:person');

  const merchantCase = rng.chance(0.25) ? 'title' : 'upper';

  // Template for the chosen layout.
  const section = layout === 'bilingual' ? 'sentence' : layout === 'fields' ? null : layout;
  let tpl = null;
  let tplSecond = null;
  if (section) {
    tpl = pickFrom(rng, lexPool(primaryLang, section, family, split), () => lexPool(primaryLang, section, family, 'all'), leaks, `${primaryLang}.${section}.${family}`);
  }
  if (layout === 'bilingual') tplSecond = pickFrom(rng, lexPool('en', 'sentence', family, split), () => lexPool('en', 'sentence', family, 'all'), leaks, `en.sentence.${family}`);
  // A slot the phrasing cannot do without is always present.
  const required = new Set([...(tpl?.required ?? []), ...(tplSecond?.required ?? [])]);
  const includeIns = required.has('INS') || rng.chance(0.7);
  const includeDate = required.has('DATE') || rng.chance(0.65);
  let fields = null;
  if (layout === 'fields') {
    const fp = (field, fam) => pickFrom(rng, fieldPool(primaryLang, field, fam, split), () => fieldPool(primaryLang, field, fam, 'all'), leaks, `${primaryLang}.fields.${field}`);
    fields = {
      title: fp('title', family), amount: fp('amount'), party: partyField ? fp(partyField) : null, card: fp('card'), date: fp('date'),
      sign: rng.weighted([['', 3], [DIRECTION[family] === 'income' ? '+' : '-', 2]]),
      joiner: rng.weighted([['\n', 6], [' | ', 2], ['; ', 1], [', ', 1]]),
      order: rng.shuffle(['amount', 'party', 'card', 'date']),
      includeParty: family !== 'atm' || rng.chance(0.5),
    };
  }

  // Sender and bank.
  const styles = (SENDER_STYLES[market.id] ?? SENDER_STYLES.default).filter(([s]) => s !== 'push' || market.push?.length);
  let senderStyle = layout === 'push' ? (rng.chance(0.75) ? 'push' : 'blank') : rng.weighted(styles.filter(([s]) => s !== 'push').concat([['push', 0.5]]));
  if (senderStyle === 'push' && !market.push?.length) senderStyle = 'alpha';
  const bank = rng.pick(market.banks);
  let sender = '';
  if (senderStyle === 'alpha') sender = bank.senders.find((s) => !/^\d+$/.test(s)) ?? bank.senders[0];
  else if (senderStyle === 'short') sender = bank.senders.find((s) => /^\d+$/.test(s)) ?? bank.senders[0];
  else if (senderStyle === 'push') sender = rng.pick(market.push);
  const prefix = senderStyle === 'push' || layout === 'push' ? 'none' : rng.weighted([['none', 4], ['colon', 3], ['newline', 1]]);

  // Trailing context.
  const trailers = [];
  const trailerPick = (kind) => {
    // Trailing context is optional: a kind with nothing in this split is omitted.
    const list = lexPool(primaryLang, 'trailer', kind, split);
    if (list.length) trailers.push({ kind, item: rng.pick(list) });
  };
  const cardish = INS_KIND[family] === 'card';
  if (rng.chance(0.3)) trailerPick(cardish && rng.chance(0.3) ? 'limit' : 'balance');
  if (primaryLang === 'en' && ['US', 'CA', 'GB'].includes(market.id) && rng.chance(0.12)) trailerPick('threshold');
  if (rng.chance(0.2)) trailerPick('fraud');
  if (rng.chance(0.05)) trailerPick('link');
  if (rng.chance(0.1)) trailerPick('optout');
  const balanceMinor = amountMinor + amountFor(rng, 'outgoing', currency) * rng.int(2, 9) + rng.int(1, 99);

  return {
    market: market.id, ledger: market.ledger, family, lang: primaryLang, layout, split, index,
    currency, exponent, amountMinor, foreign, money, moneySecond, dateStyle, date, insKind, insTpl, insTplSecond, mask, l4,
    merchant, merchantSource, cp, negMerchant, negCp, merchantCase, includeIns, includeDate, tpl, tplSecond, fields, emoji: rng.pick(EMOJI[family]),
    senderStyle, bank: { name: bank.name, slug: bank.slug, senders: bank.senders, registered: bank.registered ?? null, fictional: !!bank.fictional },
    sender, prefix, trailers, trailerJoin: layout === 'fields' || rng.chance(0.4) ? '\n' : ' ', balanceMinor,
    thrMinor: rng.chance(0.5) ? 1 : 10 ** exponentOf(market.ledger) * rng.pick([1, 5, 10, 50]),
    leaks,
  };
}

// ---------------------------------------------------------------------------
function slotValues(spec, forLang, { second = false } = {}) {
  const market = byId[spec.market];
  const L = LEX[forLang];
  const money = second ? spec.moneySecond : spec.money;
  const insTpl = second ? spec.insTplSecond : spec.insTpl;
  const name = (it) => (it ? (spec.merchantCase === 'title' ? titleCase(it.t) : it.t) : null);
  return {
    AMT: formatMoney(spec.amountMinor, spec.exponent, money),
    MER: name(spec.merchant) ?? '',
    CP: name(spec.cp) ?? '',
    INS: spec.includeIns ? insTpl.t.replace('{L4}', spec.l4) : '',
    DATE: spec.includeDate ? formatDate(spec.date, spec.dateStyle.style, spec.dateStyle.time, L) : '',
    EMO: spec.emoji,
    BAL: formatMoney(spec.balanceMinor, exponentOf(spec.ledger), spec.foreign ? moneyPool(market, 'latin', spec.lang, 'all')[0] : money),
    THR: formatMoney(spec.thrMinor, exponentOf(spec.ledger), spec.foreign ? moneyPool(market, 'latin', spec.lang, 'all')[0] : money),
    PHONE: market.phone,
    SHORT: market.short,
    DOMAIN: `${spec.bank.slug}.example`,
  };
}

/** Render the core (no prefix/trailers) and report which slots it used. */
function renderCore(spec) {
  const v = slotValues(spec, spec.lang);
  if (spec.layout === 'fields') {
    const f = spec.fields;
    const signed = formatMoney(spec.amountMinor, spec.exponent, spec.money, f.sign);
    const used = new Set(['AMT']);
    const lines = { amount: `${f.amount.t}: ${signed}` };
    const partyValue = spec.family === 'incoming' || spec.family === 'outgoing' ? v.CP : v.MER;
    if (f.party && f.includeParty && partyValue) { lines.party = `${f.party.t}: ${partyValue}`; used.add(spec.cp ? 'CP' : 'MER'); }
    if (v.INS) { lines.card = `${f.card.t}: ${spec.mask.t.replace('{L4}', spec.l4)}`; used.add('INS'); }
    if (v.DATE) { lines.date = `${f.date.t}: ${v.DATE}`; used.add('DATE'); }
    const body = [f.title.t, ...f.order.filter((k) => lines[k]).map((k) => lines[k])].join(f.joiner);
    return { text: body, used };
  }
  const first = render(spec.tpl.t, v);
  if (spec.layout !== 'bilingual') return first;
  const second = render(spec.tplSecond.t, slotValues(spec, 'en', { second: true }));
  const used = new Set([...first.used].filter((s) => second.used.has(s)));
  return { text: `${first.text}\n${second.text}`, used };
}

function renderTrailers(spec) {
  const v = slotValues(spec, spec.lang);
  return spec.trailers.map((t) => render(t.item.t, v).text);
}

function renderBody(spec) {
  const core = renderCore(spec);
  let text = core.text;
  if (spec.prefix === 'colon') text = `${spec.bank.name}: ${text}`;
  else if (spec.prefix === 'newline') text = `${spec.bank.name}\n${text}`;
  const tails = renderTrailers(spec);
  if (tails.length) text = `${text}${spec.trailerJoin}${tails.join(spec.trailerJoin)}`;
  return { text, used: core.used };
}

const labelOf = (spec, used) => ({
  shouldPost: true,
  kind: 'transaction',
  family: spec.family,
  direction: DIRECTION[spec.family],
  amountMinor: spec.amountMinor,
  currency: spec.currency,
  exponent: spec.exponent,
  date: used.has('DATE') ? iso(spec.date) : null,
  merchant: used.has('MER') && ['purchase', 'cnp', 'refund', 'bill'].includes(spec.family) ? spec.merchant.t : used.has('CP') ? spec.cp.t : null,
  last4: used.has('INS') ? spec.l4 : null,
});

// Slot provenance as content keys (what the split is decided on); a
// foreign-currency style is synthesised per row and has none.
const ck = (it) => (it ? it.ck ?? null : null);
const slotIds = (spec) => ({
  tpl: ck(spec.tpl), tplSecond: ck(spec.tplSecond),
  fields: spec.fields ? [spec.fields.title, spec.fields.amount, spec.fields.party, spec.fields.card, spec.fields.date].map(ck).filter(Boolean) : null,
  money: ck(spec.money), date: ck(spec.dateStyle), ins: ck(spec.insTpl), mask: ck(spec.mask),
  merchant: ck(spec.merchant), cp: ck(spec.cp), trailers: spec.trailers.map((t) => ck(t.item)),
});

function rowOf(spec, { kind, id, body, sender, label, negType = null, invType = null, baseId = null, slots = null, paths = null }) {
  return {
    id, split: spec.split, market: spec.market, country: spec.market, ledger: spec.ledger, lang: spec.lang, family: spec.family,
    layout: spec.layout, kind, negType, invType, baseId, sender, body, label,
    slots: slots ?? slotIds(spec), leaks: spec.leaks.length ? [...new Set(spec.leaks)] : undefined, paths,
  };
}

// ---------------------------------------------------------------------------
// Metamorphic NEGATIVES: same slots, wording that must never book.
function composeNegative(spec, type, rng) {
  if (TRANSFORM_TYPES.has(type)) return composeTransform(spec, type, rng);
  if (type === 'krlang' && !['SE', 'DK', 'NO'].includes(spec.market)) return null;
  // krlang: a Nordic `kr` alert written in ANOTHER Nordic language than the
  // person's country, so `kr` cannot be resolved from the country.
  const lang = type === 'krlang' ? rng.pick(['sv', 'da', 'nb'].filter((l) => l !== spec.lang))
    : spec.layout === 'bilingual' ? rng.pick(['ar', 'en']) : spec.lang;
  const group = NEG_GROUP[spec.family];
  const poolFor = (s) => lexPool(lang, 'neg', type, s).filter((it) => it.group === 'a' || it.group === group);
  let list = poolFor(spec.split);
  const leaks = [];
  // Prefer a pairing in the same group (card vs transfer wording); never
  // borrow a negative phrasing from the other half of the split.
  if (!list.length) list = lexPool(lang, 'neg', type, spec.split);
  if (!list.length) return null;
  const tpl = rng.pick(list);
  const market = byId[spec.market];
  const L = LEX[lang];
  const money = type === 'krlang' ? S('post', 'kr', ' ', ',', rng.pick([' ', '.'])) : lang === spec.lang ? spec.money : (spec.moneySecond ?? spec.money);
  const insTpl = lang === spec.lang ? spec.insTpl : (spec.insTplSecond ?? spec.insTpl);
  let amount = spec.amountMinor;
  let minMinor = null;
  if (type === 'balance') amount = spec.balanceMinor;
  if (type === 'statement') {
    amount = spec.amountMinor * rng.int(3, 12) + rng.int(0, 99);
    minMinor = Math.max(10 ** spec.exponent, Math.round(amount * 0.05));
  }
  if (type === 'promo' || type === 'limit' || type === 'threshold') amount = 10 ** spec.exponent * rng.pick([50, 100, 200, 500]) * (SCALE[spec.currency] >= 3 ? 10 : 1);
  const rule = NEG_ALLOWED[type];
  const allowed = rule ? rule.allowed.map((a) => ({ ...a, amounts: minMinor === null ? [amount] : [amount, minMinor] })) : [];
  const due = futureDate(rng);
  const values = {
    AMT: formatMoney(amount, spec.exponent, money),
    MIN: formatMoney(minMinor ?? 0, spec.exponent, money),
    MER: (spec.merchant ?? spec.negMerchant).t,
    CP: (spec.cp ?? spec.negCp).t,
    INS: insTpl.t.replace('{L4}', spec.l4),
    DATE: spec.includeDate ? formatDate(spec.date, spec.dateStyle.style, spec.dateStyle.time, L) : '',
    DUE: formatDate(due, spec.dateStyle.style, 'none', L),
    OTP: String(rng.int(100000, 999999)),
    PHONE: market.phone,
    URL: `http://${rng.pick(SCAM_DOMAINS)}/${shortHash(spec.market + spec.index + type).slice(0, 5)}`,
    ISSUER: rng.pick(ISSUERS[spec.market] ?? [`${spec.bank.name.toUpperCase()} CREDIT CARD`, 'AMERICAN EXPRESS']),
    BANK: spec.bank.name,
    L4: spec.l4,
  };
  let text = render(tpl.t, values).text;
  let sender = spec.sender;
  const personal = type === 'chat' || type === 'scam';
  if (personal) sender = type === 'chat' ? market.personal : rng.pick([market.personal, 'Secure-Alert', 'INFO-SMS']);
  if (!personal && spec.prefix === 'colon') text = `${spec.bank.name}: ${text}`;
  if (!personal && spec.prefix === 'newline') text = `${spec.bank.name}\n${text}`;
  // Ordinary footers stay on bank-sent negatives: a footer must not turn a
  // declined/pending alert into a posting either.
  if (!personal && spec.trailers.length && rng.chance(0.5)) {
    const tails = renderTrailers({ ...spec, lang: spec.lang });
    text = `${text}${spec.trailerJoin}${tails.join(spec.trailerJoin)}`;
  }
  const label = {
    shouldPost: false, kind: null, family: spec.family, negType: type, direction: null,
    amountMinor: amount, currency: spec.currency, exponent: spec.exponent, date: null, merchant: null, last4: null,
    allowed, wrongTypes: rule?.wrong ?? [],
  };
  const slots = { ...slotIds(spec), neg: tpl.ck };
  return { text, sender, label, slots, leaks, lang };
}

/**
 * Round-3 TRANSFORM negatives: the base positive, unchanged, plus one change
 * that makes it non-postable (or a non-expense), in the alert's own language.
 */
function composeTransform(spec, type, rng) {
  const market = byId[spec.market];
  const lang = spec.lang;
  const base = renderBody(spec);
  const partySlot = base.used.has('MER') ? 'merchant' : base.used.has('CP') ? 'cp' : null;
  const pickLex = () => { const list = lexPool(lang, 'neg', type, spec.split); return list.length ? rng.pick(list) : null; };
  let text = null;
  let sender = spec.sender;
  let paths = null;
  let piece = null;
  const withParty = (name, keepCase = true) => {
    const s2 = { ...spec, [partySlot]: { ...spec[partySlot], t: name }, merchantCase: keepCase ? 'upper' : spec.merchantCase };
    return renderBody(s2).text;
  };
  if (type === 'statusline') {
    piece = pickLex(); if (!piece) return null;
    text = `${base.text}\n${piece.t}`;
  } else if (type === 'statusword') {
    piece = pickLex(); if (!piece || !partySlot) return null;
    text = withParty(`${spec[partySlot].t.toUpperCase()} ${piece.t}`);
  } else if (type === 'issuerpay') {
    if (!partySlot || !['purchase', 'cnp', 'bill', 'outgoing'].includes(spec.family)) return null;
    const list = issuerPool(market, spec.split); if (!list.length) return null;
    piece = rng.pick(list);
    text = withParty(piece.t);
  } else if (type === 'ownacct') {
    if (!partySlot || !['incoming', 'outgoing', 'bill'].includes(spec.family)) return null;
    const list = ownAccountPool(lang, spec.split); if (!list.length) return null;
    piece = rng.pick(list);
    text = withParty(piece.t);
  } else if (type === 'signflip') {
    if (spec.layout === 'fields' && spec.fields.sign) return null;
    const amt = formatMoney(spec.amountMinor, spec.exponent, spec.money);
    if (!base.text.includes(amt)) return null;
    const income = DIRECTION[spec.family] === 'income';
    // German Soll/Haben: "S" marks a debit, "H" a credit.
    const de = market.langs.some(([l]) => l === 'de');
    const options = income ? [`-${amt}`, `${amt}-`, ...(de ? [`${amt} S`] : [])] : [`${amt}+`, `+${amt}`, ...(de ? [`${amt} H`] : [])];
    const flipped = rng.pick(options);
    piece = { ck: `signflip|${income ? 'credit' : 'debit'}`, t: flipped };
    text = base.text.replace(amt, flipped);
  } else if (type === 'vishing') {
    piece = pickLex(); if (!piece) return null;
    const digits = market.phone.replace(/\D/g, '');
    const values = {
      VPHONE: rng.pick([market.phone, digits, market.phone.replace(/[ -]/g, '.')]),
      LOOK: rng.pick([`${spec.bank.slug}-secure.com`, `secure-${spec.bank.slug}.app`, `${spec.bank.slug}-help.net?id=${rng.int(10, 99)}`]),
    };
    text = `${base.text}\n${render(piece.t, values).text}`;
    sender = rng.pick([market.personal, `alerts@${spec.bank.slug}-mail.com`]);
    // A call-back footer is only distinguishable by its sender, which iPhone
    // History does not have; a lookalike domain is suspicious on both paths.
    if (!piece.t.includes('{LOOK}')) paths = ['android-sms'];
  }
  if (!text || text === base.text) return null;
  const rule = NEG_ALLOWED[type];
  const label = {
    shouldPost: false, kind: null, family: spec.family, negType: type, direction: null,
    amountMinor: spec.amountMinor, currency: spec.currency, exponent: spec.exponent, date: null, merchant: null, last4: null,
    allowed: rule ? rule.allowed.map((a) => ({ ...a, amounts: [spec.amountMinor] })) : [], wrongTypes: rule?.wrong ?? [],
  };
  return { text, sender, label, slots: { ...slotIds(spec), neg: piece?.ck ?? null }, leaks: [], lang, paths };
}

// ---------------------------------------------------------------------------
// INVARIANCE: label-preserving variants of a positive.
function applicableInvariants(spec, used) {
  return INV_TYPES.filter((t) => {
    if (t === 'merchant-case') return used.has('MER') || used.has('CP');
    if (t === 'sender-equivalent') return (spec.senderStyle === 'alpha' || spec.senderStyle === 'short') && spec.bank.senders.length > 1;
    if (t === 'nbsp') return true;
    return true;
  });
}

function variantOf(spec, type, rng, baseBody) {
  const s = { ...spec, trailers: spec.trailers.slice() };
  const toggle = (kind) => {
    const at = s.trailers.findIndex((t) => t.kind === kind || (kind === 'balance' && t.kind === 'limit'));
    if (at >= 0) s.trailers.splice(at, 1);
    else {
      const list = lexPool(s.lang, 'trailer', kind, s.split);
      if (!list.length) return false;
      const item = rng.pick(list);
      if (kind === 'balance') s.trailers.unshift({ kind, item }); else s.trailers.push({ kind, item });
    }
    return true;
  };
  let sender = spec.sender;
  let text;
  if (type === 'balance-footer') { if (!toggle('balance')) return null; text = renderBody(s).text; }
  else if (type === 'fraud-footer') { if (!toggle('fraud')) return null; text = renderBody(s).text; }
  else if (type === 'optout') { if (!toggle('optout')) return null; text = renderBody(s).text; }
  else if (type === 'merchant-case') { s.merchantCase = spec.merchantCase === 'title' ? 'upper' : 'title'; text = renderBody(s).text; }
  else if (type === 'sender-equivalent') {
    const alt = spec.bank.senders.filter((x) => x !== spec.sender);
    if (!alt.length) return null;
    sender = rng.pick(alt);
    text = baseBody;
  } else if (type === 'whitespace') {
    const how = rng.pick(['collapse-newlines', 'sentence-newlines', 'double-spaces', 'pad']);
    if (how === 'collapse-newlines') text = baseBody.replace(/\s*\n\s*/g, ' ');
    // Break only at a real sentence end: after a word of 3+ lowercase letters
    // or a 2+ digit number, before a capital or Arabic letter. Never after an
    // abbreviation or currency token ("Fr. 12", "kr. hos", "Avl Cr. Limit").
    else if (how === 'sentence-newlines') text = baseBody.replace(/(\p{Ll}{3,}|\d{2,})([.!?]) (?=\p{Lu}|[\u0600-\u06ff])/gu, '$1$2\n');
    else if (how === 'double-spaces') text = baseBody.replace(/: /g, ':  ').replace(/ (?=\S)/, '  ');
    else text = ` ${baseBody}\n`;
    if (text === baseBody) text = `${baseBody}\n`;
  } else if (type === 'emoji') {
    text = rng.chance(0.5) ? `🔔 ${baseBody}` : `${baseBody} ✅`;
  } else if (type === 'nbsp') {
    const amt = formatMoney(spec.amountMinor, spec.exponent, spec.money);
    if (amt.includes(' ')) text = baseBody.split(amt).join(amt.replace(/ /g, NBSP));
    else text = baseBody.replace(new RegExp(`(\\S) (${amt.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}) `), `$1${NBSP}$2${NBSP}`);
    if (text === baseBody) text = baseBody.replace(/ /, NBSP);
  }
  if (text === undefined || (text === baseBody && sender === spec.sender)) return null;
  return { text, sender, slots: { ...slotIds(s) } };
}

// ---------------------------------------------------------------------------
/**
 * Generate rows. `neg`: negatives per positive (number, or 'all'); `inv`:
 * invariance variants per positive (number or 'all').
 */
function generate({ split = 'dev', n = 10, seed = 'alert-lab', markets = null, families = FAMILIES, neg = 3, inv = 2 } = {}) {
  if (!['dev', 'holdout', 'all'].includes(split)) throw new Error(`split must be dev|holdout|all, got ${split}`);
  const chosen = markets ? markets.map((id) => { if (!byId[id]) throw new Error(`unknown market ${id}`); return byId[id]; }) : MARKETS;
  const rows = [];
  for (const market of chosen) {
    for (const family of families) {
      for (let i = 0; i < n; i += 1) {
        const rng = rngFor(seed, split, market.id, family, i);
        const spec = composePositive({ market, family, split, rng, index: i });
        const baseId = `${split}:${market.id}:${family}:${i}`;
        const { text, used } = renderBody(spec);
        const posRow = rowOf(spec, { kind: 'positive', id: baseId, body: text, sender: spec.sender, label: labelOf(spec, used) });
        // The drift suite re-renders from the composed slots; keep them off
        // the enumerable row so rows stay plain, comparable data.
        Object.defineProperty(posRow, 'spec', { value: spec, enumerable: false });
        rows.push(posRow);

        const negRng = rngFor(seed, split, market.id, family, i, 'neg');
        // Kinds with no wording in this language/half are skipped without
        // using up one of the `neg` slots.
        let made = 0;
        for (const type of neg === 'all' ? NEG_TYPES : negRng.shuffle(NEG_TYPES)) {
          if (neg !== 'all' && made >= neg) break;
          const out = composeNegative(spec, type, negRng);
          if (!out) continue;
          made += 1;
          const row = rowOf(spec, { kind: 'negative', id: `${baseId}:neg-${type}`, body: out.text, sender: out.sender, label: out.label, negType: type, baseId, slots: out.slots, paths: out.paths ?? null });
          if (out.leaks.length) row.leaks = [...(row.leaks ?? []), ...out.leaks];
          row.lang = out.lang;
          rows.push(row);
        }

        const invRng = rngFor(seed, split, market.id, family, i, 'inv');
        const applicable = applicableInvariants(spec, used);
        const invTypes = inv === 'all' ? applicable : invRng.shuffle(applicable).slice(0, inv);
        for (const type of invTypes) {
          const v = variantOf(spec, type, invRng, text);
          if (!v) continue;
          rows.push(rowOf(spec, {
            kind: 'invariant', id: `${baseId}:inv-${type}`, body: v.text, sender: v.sender, label: labelOf(spec, used), invType: type, baseId, slots: v.slots,
            // iOS History has no sender, so a sender swap is Android-only.
            paths: type === 'sender-equivalent' ? ['android-sms'] : null,
          }));
        }
      }
    }
  }
  return rows;
}

/** Every inventory item with its half: the record of what HOLDOUT means. */
function splitManifest() {
  const S = sides();
  const groups = {};
  for (const g of allGroups()) {
    const out = groups[g.name] ??= { dev: new Set(), holdout: new Set(), both: new Set() };
    for (const it of g.list) out[S.get(it.ck)].add(it.ck);
  }
  return Object.fromEntries(Object.entries(groups).map(([name, g]) => [name, { dev: [...g.dev].sort(), holdout: [...g.holdout].sort(), both: [...g.both].sort() }]));
}

module.exports = { generate, splitManifest, FAMILIES, NEG_TYPES, NEG_ALLOWED, INV_TYPES, LEX, DIRECTION,
  // For drift.cjs: re-render a positive from (modified) slots.
  internals: { renderBody, labelOf, moneyPool, datePool, byId, titleCase } };
