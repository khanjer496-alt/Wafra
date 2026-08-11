/**
 * The cross-border merchant vocabulary, and what it is deliberately BLIND to.
 *
 * Every message below is real, taken from a second user's inbox export (the
 * `····` runs in that export are the exporter's own redaction of digit runs and
 * are written out here as plain digits, because no rule may ever match a mask).
 *
 * HALF THIS FILE IS NEGATIVE. A category rule that fires is worth one row; a
 * category rule that fires on the wrong row is worth less than nothing, because
 * `other` is honest and "Groceries" on a real-estate agency is a lie the user
 * has to find and undo. So each brand rule is paired with the string it must
 * NOT claim, and the merchants left in `other` on purpose are asserted to still
 * be there — if a later rule takes one of them, that is a regression and this
 * suite is where it shows up.
 */
const { guessCategory, parseSms } = require('./build/sms-parser');
const { CATEGORIES } = require('./build/categories');
const { getActiveMarket, setActiveMarket } = require('./build/markets');

let pass = 0;
let fail = 0;

function eq(name, actual, expected) {
  if (actual === expected) {
    pass++;
    console.log(`✓ ${name}`);
  } else {
    fail++;
    console.log(`✗ ${name}\n    got ${JSON.stringify(actual)}\n    want ${JSON.stringify(expected)}`);
  }
}

function ok(name, condition, detail) {
  if (condition) {
    pass++;
    console.log(`✓ ${name}`);
  } else {
    fail++;
    console.log(`✗ ${name}${detail ? ` — ${detail}` : ''}`);
  }
}

{
  const cash = CATEGORIES.find((category) => category.id === 'cash-withdrawal');
  ok('cash withdrawal is a complete bilingual expense category',
    cash?.label === 'Cash withdrawal' && cash?.labelAr === 'سحب نقدي' &&
      cash?.icon === 'cash' && cash?.type === 'expense', cash);
}

/** The category a purchase SMS resolves to, read the way the store reads it. */
const cat = (text) => guessCategory(text, 'expense');

/* ── The two real descriptor shapes these merchants arrive in ───────────── */

const purchase = (descriptor) =>
  `Purchase of AED 68.38 with Debit Card ending 8783 at ${descriptor}. Avl Balance is AED 2,954.09.`;
const cardPurchase = (descriptor) =>
  `Credit Card Purchase / Card No XXXX9960 / THB 547.00 / ${descriptor} / 04/12/25 08:39`;

/* ── Chains hiding behind a store code ──────────────────────────────────── */
//
// The store number is the whole descriptor: the brand name never appears in
// full, so "MCD" and "CENTRAL" are all there is to read.

eq(
  'MCD- and a store number is McDonald\'s',
  cat(cardPurchase('MCD-000297 PHUKET AIRPO PHUKET THA')),
  'dining',
);
eq(
  'the same brand on the other card shape',
  cat(purchase('MCD-0297 PHUKET AIRPO, PHUKET')),
  'dining',
);
// The digit is what makes MCD a store code. Without it, three capitals are
// three capitals — this parser has filed a fish shop as a utility on exactly
// that kind of evidence before.
eq('bare MCD with no store number is not claimed', cat(purchase('MCD TRADING LLC, DUBAI')), 'shopping');
eq('and MCD inside a word is not McDonald\'s', cat(purchase('AMCD-1 GENERAL, SHARJAH')), 'other');

eq(
  'a Central Group mall is a department store',
  cat(purchase('PZD131 CENTRAL PHUKET, PHUKET')),
  'shopping',
);
eq('and its Bangkok siblings', cat(cardPurchase('CENTRAL FESTIVAL PHUKET THA')), 'shopping');
eq('and the one written as one word', cat(cardPurchase('CENTRALWORLD BANGKOK THA')), 'shopping');
// "Central" is in half the street addresses on earth. Alone it means nothing,
// and a shopping rule that ate every "central" would be the capitals bug again.
eq('a central BANK is not a mall', cat(purchase('CENTRAL BANK OF UAE, ABU DHABI')), 'other');
eq('nor is a central clinic', cat(purchase('CENTRAL MEDICAL CENTRE, DUBAI')), 'health');

/* ── Processor prefixes: the ones where the payee survives ──────────────── */

eq(
  'Opn\'s prefix does not hide Gowabi, a beauty-and-wellness platform',
  cat(purchase('OPN*gowabi.com, 4567')),
  'personal-care',
);

/* ── Telecom, and why this one is anchored hard ─────────────────────────── */
//
// `telecom` unlocks the relaxed bill path in subscriptions.ts, so a false
// positive here does not mislabel a row — it mints a permanent monthly bill.

eq(
  'Zain\'s own web/self-care portal is telecom',
  cat(
    'Purchase of JOD 13.760 with Credit Card ending 8917 at ZAIN WEBSITE AND SELFC, AMMAN.' +
      ' Avl Cr. Limit is AED 19,011.30. Pls refer stmt for exact amt',
  ),
  'telecom',
);
eq('and its country storefronts', cat(purchase('ZAIN JORDAN PREPAID, AMMAN')), 'telecom');
// Zain is a common given name. A bare /zain/ would file this man's shop as a
// phone bill and then bill the user for it every month.
eq('a shop belonging to a man called Zain is not a phone company',
  cat(purchase('ZAIN ALI GENERAL TRADING, SHARJAH')), 'shopping');
eq('nor is a restaurant', cat(purchase('ZAIN AL SHAM RESTAURANT, DUBAI')), 'dining');

/* ── Travel ─────────────────────────────────────────────────────────────── */

eq(
  'a Vietnamese e-visa is a trip cost',
  cat(cardPurchase('E-VISA VIET NAM HA NOI VNM')),
  'travel',
);
eq('spelled without the hyphen too', cat(cardPurchase('EVISA VIET NAM HA NOI VNM')), 'travel');
// The card network is called Visa and is named in a large share of these
// messages. Only the e- form is a travel document.
// Asserted as "not travel" rather than "is other" on purpose: the descriptor
// still gets a turn at the global vocabulary, and pinning the whole answer here
// would make this a test of whatever shop name the fixture happened to use.
ok(
  'a bare "Visa" is the card network, not a travel document',
  cat('Purchase of AED 50.00 with Visa Debit Card ending 8783 at ZQ TRADING, DUBAI.') !== 'travel',
  cat('Purchase of AED 50.00 with Visa Debit Card ending 8783 at ZQ TRADING, DUBAI.'),
);
ok(
  'and the word appears in the card line of half these messages without claiming them',
  cat('Your Visa Credit Card XXX2518 was used for AED 12.00 at ZQ GENERAL, DUBAI-AE.') !== 'travel',
);

eq(
  'Don Muang is Bangkok\'s other airport',
  cat(cardPurchase('CF-1024 DON MUANG BANGKOK THA')),
  'travel',
);
// Ordering, asserted rather than assumed: a generic `airport` rule would sit
// above MCD- and file an airport McDonald's as travel. There is no such rule,
// and this is what would catch one being added.
eq(
  'an airport McDonald\'s is still a meal',
  cat(cardPurchase('MCD-000297 PHUKET AIRPO PHUKET THA')),
  'dining',
);

/* ── Entertainment: things you buy a ticket for ─────────────────────────── */

eq(
  'a muay thai stadium is a spectator sport',
  cat(cardPurchase('PATONG BOXING STADIUM PHUKET THA')),
  'entertainment',
);
// Dubai's metro has a station called Stadium. `\bstadium\b` alone is transport
// as often as it is entertainment, so the rule carries the sport.
eq('a stadium on its own is not claimed', cat(purchase('STADIUM STATION KIOSK, DUBAI')), 'other');

eq('a go-kart track', cat(cardPurchase('PHUKET KART SPEED PHUKET THA')), 'entertainment');
eq('however it is spelled', cat(purchase('GO KARTING DUBAI, DUBAI')), 'entertainment');
// One letter from `mart` and `cart`, in a field that truncates.
eq('a bare KART is not a track', cat(purchase('AL KART GENERAL TRADING, AJMAN')), 'shopping');

eq(
  'the Ancient City is an open-air museum',
  cat(cardPurchase('MUANG BORAN SAMUTPRAKAN THA')),
  'entertainment',
);

/* ── Shopping ───────────────────────────────────────────────────────────── */

eq(
  'ebooks are books',
  cat('Purchase of USD 300.00 with Credit Card ending 8917 at WASSAGY EBOOKS MAAHEKO-ACCRA GHA'),
  'shopping',
);

/* ── LEFT IN "OTHER" ON PURPOSE ─────────────────────────────────────────── */
//
// This block is the deliverable, not the shortfall. Each of these was read
// correctly and still says nothing about what was bought: a payment processor
// with the payee stripped, a store code, a person's name, a company suffix.
// Guessing at any of them would be a claim the message does not support, and
// `other` is the honest answer. A rule that turns one of these green has almost
// certainly over-matched somewhere else too.
{
  const leftAlone = [
    // Processors whose payee the descriptor does not carry at all.
    ['WWW.2C2P.COM*2C2P (THA, BANGKOK', 'the gateway, not the shop it charged for'],
    ['FAT*THE VIOLE, Dubai', 'a processor star and a cut-off name'],
    ['HTTPS SWIFAPP COM, ABU DHABI', 'an app name that says nothing about its trade'],
    ['Simplex_Elastum, s@simplex.com', 'Simplex is also an ordinary company name'],
    // Store codes with nothing chain-shaped behind them.
    ['DB267 FO SHARJAH CORNI, SHARJAH', 'a store code and a corniche'],
    ['SP ALL-CHARMS, 7501', 'SP is two letters; it is not evidence'],
    ['SP LUETTI 1980, 0586', 'same'],
    // Marketplaces and services where the charge is not the goods.
    ['Tap*OpenSooq, Dubai', 'a classifieds listing fee is not a purchase'],
    // Names that are people or places.
    ['PRASERT ON-PUTTHA, PHUKET', 'a person'],
    ['MARFAA SHARJAH ARE', 'unguessable'],
    ['SHEETWA, 4074', 'unguessable'],
    ['TUBA INT, SHARJAH', 'unguessable'],
    ['CRO, st Julians', 'three letters'],
    ['THE BOX, SHARJAH', 'a common phrase, not a trade'],
    ['AL NIMAR AL ABYADH SHARJAH ARE', 'unguessable'],
    ['ABO ALO,SHARJAH-AE', 'unguessable'],
    ['AMERICAN DEALD, AMMAN', 'unguessable'],
    ['AT TWENTY TWO HOUSE, PHUKET', 'a house name'],
    ['AROMAYA, PHUKET', 'unguessable'],
    ['NIKORN MARINE, PHUKET', 'marine is engineering as often as it is a boat'],
    // The traps that would each be a WRONG answer, not merely a bold one.
    ['BLUE BAY REAL ESTATE L, DUBAI', 'AED 40 to an agency is not Rent, and Rent mints bills'],
    ['VEDA INC INVESTMENT L., DUBAI MEDIA C', 'a company with Investment in its name is not an investment'],
    ['SAVING HOME, AJMAN', 'a shop called Saving Home is not a savings account'],
    ['CUSTOMER CARE BRANCH, SHARJAH', 'whose customer care is not stated'],
    ['ON TECHNOLOGIES FZ LLC, DUBAI', '"Technologies" is a company suffix, not a trade'],
    ['XPOWERPLUS, DUBAI', 'unguessable'],
    ['DUBAI FAMILIES, SHARJAH', 'unguessable'],
    ['Loop DXB LLC 1, Dubai', 'unguessable'],
    ['PUFFTOPIA CANNABIS CO PHUKET THA', 'the app has no category this belongs in'],
    ['KING ABDUL AZIZ STREET DUBAI AE', 'a street, not a shop'],
    ['TOPS-MY FRONT YARD PHU PHUKET THA', 'TOPS is an English word; see the report'],
  ];
  for (const [descriptor, why] of leftAlone) {
    eq(`left in other on purpose: ${descriptor} — ${why}`, cat(purchase(descriptor)), 'other');
  }
}

/* ── Person-to-person transfers stay uncategorised, and that is the ask ─── */
//
// 51 of the 91 sightings in the diagnostic. The app has no category for money
// sent to a person, and none of the ones it has is true of it. What is missing
// is not vocabulary — the parser reads the payee's name perfectly — it is a
// FLAG next to `transferHint` saying "this left the user's money and went to a
// third party". These assertions pin today's behaviour so the boundary is
// visible rather than forgotten.
{
  const p2p = "Hey Customer, you've successfully transferred AED 202.00 to Sam Example.";
  const fastpay =
    'Dear Customer, AED 750.00 has been debited from your Saving Bank Account ending with 2501' +
    ' for a FastPay transfer to Alex Example.';
  eq('a send to a named person is not filed under a spending category', cat(p2p), 'other');
  eq('nor is the FastPay shape', cat(fastpay), 'other');
  // And specifically NOT any of the four that would be actively wrong.
  for (const text of [p2p, fastpay]) {
    ok(
      `a person-to-person send never lands on a bill-minting category (${text.slice(0, 24)}…)`,
      !['utilities', 'telecom', 'rent', 'loan'].includes(cat(text)),
      cat(text),
    );
  }
  for (const [name, text, title] of [
    ['completed transfer', p2p, 'Transfer to Sam Example'],
    ['FastPay transfer', fastpay, 'Transfer to Alex Example'],
  ]) {
    const parsed = parseSms(text);
    ok(
      `${name} is intentionally understood rather than an uncategorised miss`,
      parsed?.merchant === title && parsed?.categoryGuess === 'other' &&
        parsed?.categoryDeliberate === true && parsed?.transferHint === false,
      JSON.stringify(parsed && {
        merchant: parsed.merchant,
        category: parsed.categoryGuess,
        deliberate: parsed.categoryDeliberate,
        transferHint: parsed.transferHint,
      }),
    );
  }
}

/* ── Bounded merchant evidence from the supplied accuracy report ───────── */
// These rules name the business, never its city. The controls below keep
// PHUKET and DUBAI from becoming category evidence in their own right.
eq('L\'ETO is the documented restaurant brand', cat(cardPurchase('LETO DUBAI ARE')), 'dining');
eq('Little Bangkok is the documented restaurant brand', cat(purchase('LITTLE BANGKOK, DUBAI')), 'dining');
eq('Akiba Dori is a documented restaurant', cat(purchase('AKIBA DORI FZ LLC, DUBAI')), 'dining');
eq('Tum Rub Thai is bounded as the restaurant name', cat(cardPurchase('TUM RUB THAI/TOPS PHUK PHUKET THA')), 'dining');
eq('Bartels behind its gateway is a documented cafe', cat(cardPurchase('WWW.KSHER.CO*BARTELS C BANGKOK THA')), 'dining');
eq('Marush Phuket is a documented restaurant', cat(cardPurchase('MARUSH PHUKET THA')), 'dining');
eq('Loof Garden Phuket is a documented cafe', cat(cardPurchase('LOOF GARDEN PHUKET THA')), 'dining');
eq('Phukettique Phuket is a documented cafe', cat(cardPurchase('PHUKETTIQUE PHUKET THA')), 'dining');
eq('Moontree Spa is bounded without matching Vespa', cat(cardPurchase('MOONTREESPA 24192419 THA')), 'personal-care');
eq('Plenary Wellness is a documented health and wellness centre', cat(cardPurchase('PLENARY WELLNESS PHUKET THA')), 'health');
eq('the exact Al Mazoon studio is known personal care', cat(purchase('AL MAZOON STUDIO BR 1 SHARJAH ARE')), 'personal-care');
eq('a Thai souvenir descriptor is retail', cat(cardPurchase('SAWADEEKATHAISOUVENIRS PHUKET THA')), 'shopping');
eq('Mrs Wrap is documented travel-accessory retail', cat(cardPurchase('MRS.WRAP CO.,LTD. PHUKET THA')), 'shopping');
eq('the garment-trading truncation remains retail', cat(purchase('LAMSAT QOTUNIA GAR TR, SHARJAH')), 'shopping');
eq('a different studio stays unknown', cat(purchase('BLUE LIGHT STUDIO, DUBAI')), 'other');
eq('a Vespa merchant is not a spa', cat(purchase('VESPA MOTOR STORE, DUBAI')), 'shopping');
eq('Phuket alone is not travel or wellness', cat(cardPurchase('GREEN NATURAL PHUKET THA')), 'other');

{
  const processor = parseSms(
    'Purchase of THB 584.00 with Debit Card ending 1354 at WWW.2C2P.COM*2C2P (THA, BANGKOK. Avl Balance is AED 23,965.65.',
  );
  ok(
    'a bare payment processor is intentionally Other, not an unread category',
    processor?.merchant === '2c2p' && processor?.categoryGuess === 'other' &&
      processor?.categoryDeliberate === true,
    JSON.stringify(processor && {
      merchant: processor.merchant,
      category: processor.categoryGuess,
      deliberate: processor.categoryDeliberate,
    }),
  );
}

/* ── The list itself ────────────────────────────────────────────────────── */
//
// Every rule in a market pack must name a category the app can actually draw.
// A typo'd id compiles (CategoryId is a union of literals, but the packs are
// assembled from several arrays) and then renders as a blank chip.
{
  const ids = new Set(CATEGORIES.map((c) => c.id));
  const packs = ['AE', 'SA'];
  let allKnown = true;
  let bad = '';
  for (const id of packs) {
    setActiveMarket(id);
    for (const [re, category] of getActiveMarket().keywords) {
      if (!ids.has(category)) {
        allKnown = false;
        bad = `${id}: ${re} → ${category}`;
      }
    }
  }
  setActiveMarket('AE');
  ok('every market keyword names a category the app can draw', allKnown, bad);

  // Failure mode 3 in the parser's own notes: a /g regex carries lastIndex
  // between .test() calls, so the second identical message silently misses.
  let stateful = '';
  for (const id of packs) {
    setActiveMarket(id);
    for (const [re] of getActiveMarket().keywords) {
      if (re.global || re.sticky) stateful = `${id}: ${re}`;
    }
  }
  setActiveMarket('AE');
  ok('no market keyword is a stateful /g or /y regex', stateful === '', stateful);

  // The same message read twice must give the same answer — the observable
  // form of the check above, across the whole pack rather than one flag.
  const twice = purchase('PZD131 CENTRAL PHUKET, PHUKET');
  eq('reading the same message twice gives the same category', cat(twice), cat(twice));
}

/* ── The Saudi pack gets the same chains ────────────────────────────────── */
//
// These merchants are not UAE facts. A card issued in Riyadh meets the same
// descriptor at the same airport, so the list is shared rather than copied.
{
  setActiveMarket('SA');
  eq('a Saudi ledger reads the same store codes', cat(cardPurchase('MCD-000297 PHUKET AIRPO PHUKET THA')), 'dining');
  eq('and the same airport', cat(cardPurchase('CF-1024 DON MUANG BANGKOK THA')), 'travel');
  // ...without disturbing the pack's own telecom rule, which runs first.
  eq('Saudi telecom vocabulary still wins in its own pack', cat(purchase('MOBILY RECHARGE, RIYADH')), 'telecom');
  eq('Jarir Bookstore is Saudi retail', cat(purchase('JARIR BOOKSTORE, RIYADH')), 'shopping');
  eq('Nahdi Pharmacy is Saudi health', cat(purchase('NAHDI PHARMACY, JEDDAH')), 'health');
  eq('Flynas is travel', cat(purchase('FLYNAS BOOKING, RIYADH')), 'travel');
  eq('the ordinary word extra is not treated as the electronics chain',
    cat(purchase('EXTRA REWARDS PROMOTION, RIYADH')), 'other');
  eq('SADAD is a payment rail and cannot invent a utility category',
    cat(purchase('SADAD PAYMENT REFERENCE 1234')), 'other');
  eq('a named Saudi utility still categorizes through SADAD',
    cat(purchase('SADAD SAUDI ELECTRIC PAYMENT')), 'utilities');
  setActiveMarket('AE');
}

console.log(`\ncategories: ${pass} passed, ${fail} failed`);
if (fail) process.exit(1);
