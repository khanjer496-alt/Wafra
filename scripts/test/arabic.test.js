// Arabic bank SMS.
//
// Banks in both Gulf markets send Arabic to any customer whose profile
// language is Arabic. Every one of these messages was refused outright before
// the rewrite layer — including ones whose amount was already in Latin script.
//
// Two of the messages below are VERBATIM bank text, from the published corpus
// of obahareth/bank-al-bilad-sms-parser. They are the reference formats: the
// labelled, one-field-per-line shape used across the Gulf. The rest exercise
// one vocabulary rule each and are marked as such.

const { parseSms } = require('./build/sms-parser.js');
const { arabicToEnglish, hasArabic } = require('./build/arabic-sms.js');

let pass = 0;
let fail = 0;

function check(name, ok, detail) {
  if (ok) {
    pass++;
    console.log(`✓ ${name}`);
  } else {
    fail++;
    console.log(`✗ ${name}`, detail === undefined ? '' : JSON.stringify(detail));
  }
}

// The two public Bank Albilad bodies now live in the market-aware acceptance
// corpus. Keeping them here silently ran them under the default UAE pack and
// asserted everything except the amount, currency and date.

// ── one rule each ────────────────────────────────────────────────────────

const CASES = [
  {
    name: 'amount in Latin script inside an Arabic sentence',
    body: 'عملية شراء بمبلغ AED 250.00 لدى نون من بطاقتك المنتهية 8575',
    want: { type: 'expense', amountFils: 25000, merchant: 'نون', card: '8575' },
  },
  {
    name: 'تم خصم is a debit',
    body: 'تم خصم مبلغ 150.00 درهم من حسابك رقم 1234 لدى بيسان الطبي',
    want: { type: 'expense', amountFils: 15000, merchant: 'بيسان الطبي' },
  },
  {
    name: 'Arabic-Indic numerals ١٢٣ are read as digits',
    body: 'تم خصم مبلغ ١٥٠٫٥٠ درهم من حسابك رقم ١٢٣٤ لدى كارفور',
    want: { type: 'expense', amountFils: 15050, merchant: 'كارفور', category: 'groceries' },
  },
  {
    name: 'درهم spelled out is the local currency',
    body: 'تم خصم مبلغ 89.00 درهم من بطاقتك المنتهية 1234 لدى صيدلية العين',
    want: { type: 'expense', amountFils: 8900, category: 'health' },
  },
  {
    name: 'إيداع الراتب is income',
    body: 'تم إيداع الراتب بمبلغ 12,000.00 درهم في حسابك',
    want: { type: 'income', amountFils: 1200000, category: 'salary' },
  },
  {
    name: 'استرداد is money coming back',
    body: 'تم استرداد مبلغ 75.00 درهم إلى بطاقتك المنتهية 8575',
    want: { type: 'income', amountFils: 7500 },
  },
  {
    name: 'سحب نقدي is an ATM withdrawal',
    body: 'سحب نقدي بمبلغ 500.00 درهم من بطاقتك المنتهية 1234',
    want: { type: 'expense', amountFils: 50000, merchant: 'ATM withdrawal' },
  },
  {
    name: 'مطعم names a restaurant',
    body: 'عملية شراء بمبلغ 210.00 درهم لدى مطعم الحلبي من بطاقتك المنتهية 4321',
    want: { type: 'expense', amountFils: 21000, category: 'dining' },
  },
  {
    name: 'أدنوك is fuel',
    body: 'عملية شراء بمبلغ 120.00 درهم لدى أدنوك من بطاقتك المنتهية 4321',
    want: { type: 'expense', amountFils: 12000, category: 'transport' },
  },
  {
    name: 'د.إ as a symbol still works with no merchant',
    body: 'تم خصم د.إ 150.00 من حسابك',
    want: { type: 'expense', amountFils: 15000 },
  },
];

for (const { name, body, want } of CASES) {
  const r = parseSms(body);
  if (!r) {
    check(name, false, 'REFUSED');
    continue;
  }
  const errs = [];
  if (want.type && r.type !== want.type) errs.push(`type ${r.type} != ${want.type}`);
  if (want.amountFils && r.amountFils !== want.amountFils) {
    errs.push(`amount ${r.amountFils} != ${want.amountFils}`);
  }
  if (want.merchant && r.merchant !== want.merchant) {
    errs.push(`merchant ${JSON.stringify(r.merchant)} != ${JSON.stringify(want.merchant)}`);
  }
  if (want.card && (!r.card || r.card.last4 !== want.card)) {
    errs.push(`card ${JSON.stringify(r.card)} != ${want.card}`);
  }
  if (want.category && r.categoryGuess !== want.category) {
    errs.push(`category ${r.categoryGuess} != ${want.category}`);
  }
  check(name, errs.length === 0, errs);
  check(`${name} — raw is untouched`, r.raw === body);
}

// ── the trap that nearly shipped ─────────────────────────────────────────
//
// The first draft of arabic-sms.ts anchored every rule with \b. JavaScript
// defines \b over [A-Za-z0-9_], so between a space and an Arabic letter there
// is no boundary at all and EVERY rule was dead. Nothing downstream would have
// noticed — the messages simply carried on being refused, which is exactly
// what they did before. So: assert the rewrite actually changes the text.

check('a \\b-style boundary does NOT work on Arabic (why word() exists)', !/\bخصم\b/.test('تم خصم مبلغ'));

for (const [label, arabic, expect] of [
  ['خصم', 'تم خصم 5.00 درهم', /debited/],
  ['شراء', 'عملية شراء 5.00 درهم', /purchase/],
  ['سحب', 'سحب نقدي 5.00 درهم', /withdrawal/],
  ['إيداع', 'تم إيداع 5.00 درهم', /deposited/],
  ['استرداد', 'تم استرداد 5.00 درهم', /refunded/],
  ['لدى', 'شراء لدى كارفور', /\bat\b/],
  ['بطاقة', 'بطاقة: **1234', /Card/],
  ['رصيد', 'رصيد: 100.00 درهم', /Avl Bal/],
  ['المنتهية', 'بطاقتك المنتهية 1234', /ending/],
  ['درهم', '5.00 درهم', /AED/],
  ['ريال', '5.00 ريال', /SAR/],
]) {
  check(`rewrite fires for ${label}`, expect.test(arabicToEnglish(arabic)), arabicToEnglish(arabic));
}

// Arabic-Indic and Persian digit forms both have to convert.
check('٠١٢٣٤٥٦٧٨٩ convert', arabicToEnglish('مبلغ ٠١٢٣٤٥٦٧٨٩ درهم').includes('0123456789'));
check('۰۱۲۳۴۵۶۷۸۹ convert', arabicToEnglish('مبلغ ۰۱۲۳۴۵۶۷۸۹ درهم').includes('0123456789'));
check('٫ is a decimal point', arabicToEnglish('١٥٠٫٥٠ درهم').includes('150.50'));

// The line structure has to survive: the parser's multi-line descriptor
// reader is behind an includes('\n') check, and the labelled format is one
// field per line.
check('line breaks survive the rewrite', arabicToEnglish('مبلغ: 12.00 SAR\nرصيد: 100.00 SAR').includes('\n'));

// ── the English path must not notice any of this ─────────────────────────

check('hasArabic is false for English', !hasArabic('Purchase of AED 120.00 at CARREFOUR'));
check(
  'an English message is returned byte-for-byte',
  arabicToEnglish('Purchase of AED 120.00 at CARREFOUR. Avl Bal AED 5,000.00') ===
    'Purchase of AED 120.00 at CARREFOUR. Avl Bal AED 5,000.00',
);

// ─────────────────────────────────────────────────────────────────────────
// The Arabic UI.
//
// Everything above this line is about reading a bank's Arabic. Everything
// below is about SHOWING Arabic to a person: the face it is set in, the shape
// the chart draws under RTL, and the strings themselves.
// ─────────────────────────────────────────────────────────────────────────

const fs = require('fs');
const path = require('path');
const i18n = require('./build/i18n.js');
const { STRUCTURAL_TITLES } = require('./build/sms-parser.js');

const ROOT = path.join(__dirname, '../..');
const read = (p) => fs.readFileSync(path.join(ROOT, p), 'utf8');

// ── the bundled Latin faces cannot draw a single Arabic letter ───────────
//
// This is the premise of the ThemedText rule below, and it is a fact about
// the .ttf files rather than about the code, so it is read out of them. A
// character the font has no glyph for maps to id 0 — .notdef, the empty box.
// If someone ever swaps Geist for a face WITH Arabic coverage, this test says
// so rather than quietly leaving a rule in place that no longer earns its
// keep.
function glyphIds(file, codepoints) {
  const d = fs.readFileSync(path.join(ROOT, 'assets/fonts', file));
  let cmap = 0;
  for (let i = 0; i < d.readUInt16BE(4); i++) {
    const o = 12 + 16 * i;
    if (d.toString('latin1', o, o + 4) === 'cmap') cmap = d.readUInt32BE(o + 8);
  }
  let sub = 0;
  for (let i = 0; i < d.readUInt16BE(cmap + 2); i++) {
    const o = cmap + 4 + 8 * i;
    const pid = d.readUInt16BE(o);
    const eid = d.readUInt16BE(o + 2);
    // The Unicode subtables, in the order a shaper would prefer them.
    if ((pid === 3 && (eid === 1 || eid === 10)) || (pid === 0 && eid >= 3)) {
      sub = cmap + d.readUInt32BE(o + 4);
    }
  }
  const format = d.readUInt16BE(sub);
  return codepoints.map((cp) => {
    if (format === 4) {
      const segs = d.readUInt16BE(sub + 6) / 2;
      const endAt = sub + 14;
      const startAt = endAt + segs * 2 + 2;
      const deltaAt = startAt + segs * 2;
      const rangeAt = deltaAt + segs * 2;
      for (let i = 0; i < segs; i++) {
        if (cp > d.readUInt16BE(endAt + i * 2) || cp < d.readUInt16BE(startAt + i * 2)) continue;
        const delta = d.readInt16BE(deltaAt + i * 2);
        const range = d.readUInt16BE(rangeAt + i * 2);
        if (range === 0) return (cp + delta) & 0xffff;
        const at = rangeAt + i * 2 + range + (cp - d.readUInt16BE(startAt + i * 2)) * 2;
        const g = d.readUInt16BE(at);
        return g === 0 ? 0 : (g + delta) & 0xffff;
      }
      return 0;
    }
    if (format === 12) {
      const groups = d.readUInt32BE(sub + 12);
      for (let i = 0; i < groups; i++) {
        const o = sub + 16 + i * 12;
        const start = d.readUInt32BE(o);
        const end = d.readUInt32BE(o + 4);
        if (cp >= start && cp <= end) return d.readUInt32BE(o + 8) + (cp - start);
      }
      return 0;
    }
    throw new Error(`unhandled cmap format ${format} in ${file}`);
  });
}

const ARABIC_LETTERS = [...'الرصيد'].map((c) => c.codePointAt(0));
for (const face of ['Geist-Regular.ttf', 'Geist-Medium.ttf', 'Geist-SemiBold.ttf', 'GeistMono-Regular.ttf']) {
  const ids = glyphIds(face, ARABIC_LETTERS);
  check(`${face} has NO Arabic coverage`, ids.every((g) => g === 0), ids);
}
for (const face of ['NotoKufiArabic-Regular.ttf', 'NotoKufiArabic-Bold.ttf']) {
  const ids = glyphIds(face, ARABIC_LETTERS);
  check(`${face} draws Arabic`, ids.every((g) => g > 0), ids);
}
// And the Arabic face carries Latin too, which is what lets a mixed string —
// "دفعة Emirates NBD" — stay in one family instead of falling back mid-word.
check('the Arabic face also carries Latin', glyphIds('NotoKufiArabic-Regular.ttf', [65, 48]).every((g) => g > 0));

// ── ThemedText: the caller's font may not silently un-set the Arabic one ──
//
// The style array puts the caller's `style` last, which is right for colour
// and size. It was also last for fontFamily, and the onboarding flow and the
// storage-recovery screen both pin `Fonts.sansSemi` in their own StyleSheets
// — so the FIRST screen an Arabic phone shows was Arabic copy in a face with
// no Arabic glyphs, i.e. a column of empty boxes, on the one screen a person
// cannot skip. The rescue has to come AFTER `style` to undo that.
{
  const src = read('src/components/themed-text.tsx');
  const array = src.match(/style=\{\[([\s\S]*?)\]\}/)[1];
  const entries = array
    .split('\n')
    .map((l) => l.trim())
    .filter((l) => l && !l.startsWith('//'));
  check('ThemedText applies the Arabic rescue', /arabicRescue\(/.test(array), entries);
  check(
    'the Arabic rescue is applied AFTER the caller style',
    entries.findIndex((l) => /arabicRescue\(/.test(l)) > entries.findIndex((l) => /^style,$/.test(l)),
    entries,
  );
  // It fires on the TEXT, not on the language: "Wafra" in the wordmark and
  // "AED" beside a figure are Latin strings that keep their Latin face even
  // on an Arabic phone.
  check('the rescue asks whether the string is Arabic', /hasArabicScript/.test(src));
  check('the rescue also drops the negative tracking', /letterSpacing: 0/.test(src));
}

check('hasArabicScript sees Arabic', i18n.hasArabicScript('كل مساء الساعة ٩'));
check('hasArabicScript leaves the wordmark alone', !i18n.hasArabicScript('Wafra'));
check('hasArabicScript leaves a figure alone', !i18n.hasArabicScript('AED 12,000.00'));

// ── TrendCurve's fill under RTL ──────────────────────────────────────────
//
// The X mapping is mirrored for Arabic, so the path ENDS at x=0. Closing it
// through the LTR corners (width, then 0) ran the polygon back across the
// whole chart and out again along the floor: it crossed itself, and what the
// nonzero rule then filled was a sliver between the curve and its own chord
// — 42% of the plot wrong — under the Wallet net-worth line.
//
// The expression is lifted out of the component and evaluated, so this tests
// the shipping path string rather than a copy of it.
{
  const src = read('src/components/ui/charts.tsx');
  const expr = src.match(/const area =([\s\S]*?);\n/)[1];
  const buildArea = new Function('line', 'width', 'y', 'lo', 'rtl', `return (${expr});`);

  const width = 320;
  const height = 104;
  const pad = 8;
  const plot = height - pad * 2;
  const series = [100, 140, 180, 260, 300, 420];
  const lo = Math.min(...series);
  const span = Math.max(...series) - lo;
  const y = (fils) => pad + (1 - (fils - lo) / span) * plot;

  const pathFor = (rtl) => {
    const x = (i) => {
      const at = (i / (series.length - 1)) * width;
      return rtl ? width - at : at;
    };
    const line = series.map((p, i) => `${i === 0 ? 'M' : 'L'}${x(i)},${y(p)}`).join(' ');
    return buildArea(line, width, y, lo, rtl);
  };

  // Nonzero winding, the rule an SVG fill uses by default.
  const winding = (poly, px, py) => {
    let w = 0;
    for (let i = 0; i < poly.length; i++) {
      const a = poly[i];
      const b = poly[(i + 1) % poly.length];
      const side = (b[0] - a[0]) * (py - a[1]) - (px - a[0]) * (b[1] - a[1]);
      if (a[1] <= py) {
        if (b[1] > py && side > 0) w += 1;
      } else if (b[1] <= py && side < 0) {
        w -= 1;
      }
    }
    return w;
  };
  const points = (d) =>
    d
      .trim()
      .split(' ')
      .filter((s) => s !== 'Z')
      .map((s) => s.slice(1).split(',').map(Number));

  for (const rtl of [false, true]) {
    const poly = points(pathFor(rtl));
    let wrong = 0;
    let filled = 0;
    for (let px = 1; px < width; px += 2) {
      for (let py = 1; py < height; py += 2) {
        // Where the curve really is at this x, and so whether this sample
        // belongs under it.
        const at = (rtl ? width - px : px) / width * (series.length - 1);
        const i = Math.min(series.length - 2, Math.floor(at));
        const curve = y(series[i]) + (y(series[i + 1]) - y(series[i])) * (at - i);
        const under = py >= curve && py <= y(lo);
        const inside = winding(poly, px, py) !== 0;
        if (inside) filled += 1;
        if (inside !== under) wrong += 1;
      }
    }
    check(`the ${rtl ? 'RTL' : 'LTR'} area fill is the area under the curve`, wrong === 0, {
      wrong,
      filled,
      d: pathFor(rtl),
    });
  }

  // The mirrored path ends where the LTR one begins, which is the whole
  // reason the corner order has to follow it: nearest corner first.
  check(
    'the RTL fill closes through x=0 first',
    pathFor(true).endsWith(`L0,${y(lo)} L${width},${y(lo)} Z`),
    pathFor(true),
  );
  check(
    'the LTR fill is unchanged',
    pathFor(false).endsWith(`L${width},${y(lo)} L0,${y(lo)} Z`),
    pathFor(false),
  );
}

// ── the screen for a link that leads nowhere ─────────────────────────────
//
// It was the one screen in the app with no translations at all — four English
// strings, one of which (Back) already had a key two hundred lines up in the
// table. It slips past the contracts gate because its heading sits inline
// with its JSX tags and its body has a full stop mid-sentence.
{
  const src = read('src/app/+not-found.tsx');
  for (const gone of ['This page moved on', 'Nothing lives at that link', 'Go home', 'label="Back"']) {
    check(`+not-found no longer hardcodes ${JSON.stringify(gone)}`, !src.includes(gone));
  }
  for (const key of ['notFoundTitle', 'notFoundBody', 'goHome', 'back']) {
    check(`+not-found asks for ${key}`, new RegExp(`t\\('${key}'`).test(src));
    check(`${key} is really translated`, i18n.t(key, 'ar') !== i18n.t(key, 'en') && i18n.hasArabicScript(i18n.t(key, 'ar')));
  }
}

// ── the string table's own Arabic ────────────────────────────────────────
//
// Read back off the compiled table, not off the source: what matters is what
// t() hands a screen.
check(
  'the daily-summary line is spelled correctly',
  i18n.t('dailySummaryOn', 'ar') === 'كل مساء الساعة ٩، إذا صرفت شيئاً',
  i18n.t('dailySummaryOn', 'ar'),
);
// ta marbuta on الساعة, hamza on إذا, tanween on شيئاً — three errors in one
// nine-word sentence, all of them the kind a reader notices immediately.
check('الساعه is gone', !i18n.t('dailySummaryOn', 'ar').includes('الساعه'));
check('اذا has its hamza', !/(^|\s)اذا(\s|$)/.test(i18n.t('dailySummaryOn', 'ar')));
check('"+{count} more" is أخرى, not اخري', i18n.t('dailySummaryMore', 'ar').includes('أخرى'));

// ── titles the parser writes, shown in the reader's language ─────────────
//
// The English literal stays in the ledger — STRUCTURAL_TITLES.has() and the
// accuracy export both match on it — and the translation happens on the way
// to the screen. Every title the parser can mint needs one, or an Arabic
// user's daily list is Arabic chrome over English rows.
{
  const untranslated = [...STRUCTURAL_TITLES].filter(
    (title) => !i18n.hasArabicScript(i18n.structuralTitleLabel(title, 'ar')),
  );
  check('every structural title has an Arabic label', untranslated.length === 0, untranslated);

  // These four are minted outside the set, so the set cannot vouch for them.
  for (const title of ['Card statement', 'Bill payment', 'Salary', 'Savings transfer']) {
    check(`${title} has an Arabic label`, i18n.hasArabicScript(i18n.structuralTitleLabel(title, 'ar')));
  }

  check(
    'a card payment keeps its digits',
    i18n.structuralTitleLabel('Card •3644 payment', 'ar') === 'دفعة بطاقة •3644',
    i18n.structuralTitleLabel('Card •3644 payment', 'ar'),
  );
  check(
    'a card statement row keeps its digits',
    i18n.structuralTitleLabel('Card •3644', 'ar') === 'بطاقة •3644',
    i18n.structuralTitleLabel('Card •3644', 'ar'),
  );
  // A merchant is a proper noun. Passing one through has to be a no-op, which
  // is what lets a display layer call this on every title it holds.
  check('a merchant name is returned untouched', i18n.structuralTitleLabel('Carrefour', 'ar') === 'Carrefour');
  check('an unknown title is returned untouched', i18n.structuralTitleLabel('Le Pain Quotidien', 'ar') === 'Le Pain Quotidien');
  check('English still gets the stored literal', i18n.structuralTitleLabel('ATM withdrawal', 'en') === 'ATM withdrawal');
}

console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail === 0 ? 0 : 1);
