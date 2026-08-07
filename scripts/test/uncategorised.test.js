/**
 * The self-service categorisation list.
 *
 * What can go wrong here is not arithmetic, it is WHICH ROWS ARE ASKED ABOUT.
 * Every exclusion in uncategorised.ts exists because putting that row in front
 * of a user is a question with no right answer — "what kind of shop is an ATM
 * withdrawal" — and a list padded with those is a list nobody finishes. The
 * ranking matters for the same reason: the first three rows decide whether
 * there is a fourth tap.
 */
const {
  CATEGORISE_PROMPT_THRESHOLD,
  overrideAppliesTo,
  uncategorisedMerchants,
  worthPrompting,
} = require('./build/uncategorised');

let pass = 0;
let fail = 0;

function eq(name, actual, expected) {
  const a = JSON.stringify(actual);
  const e = JSON.stringify(expected);
  if (a === e) {
    pass++;
    console.log(`✓ ${name}`);
  } else {
    fail++;
    console.log(`✗ ${name}\n    got ${a}\n    want ${e}`);
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

const ACCOUNTS = [
  { id: 'main', name: 'Current', kind: 'bank', openingFils: 0, color: '#000' },
  { id: 'other-acct', name: 'Second', kind: 'bank', openingFils: 0, color: '#111' },
  { id: 'gone', name: 'Old card', kind: 'card', openingFils: 0, color: '#222', archived: true },
];

let seq = 0;
function tx(over) {
  seq += 1;
  return {
    id: `t${seq}`,
    type: 'expense',
    amountFils: 1000,
    category: 'other',
    accountId: 'main',
    title: 'Some Shop',
    date: '2026-07-01',
    source: 'sms',
    ...over,
  };
}

function state(transactions, over) {
  return {
    hydrated: true,
    accounts: ACCOUNTS,
    transactions,
    budgets: [],
    bills: [],
    cardDues: [],
    goals: [],
    merchantOverrides: {},
    accountHints: {},
    notSubscriptions: [],
    lastScanTs: 0,
    onboarded: true,
    userName: '',
    appLock: false,
    monthStartDay: 1,
    pro: true,
    privateMode: false,
    dailySummary: false,
    trialStartTs: 0,
    marketId: 'AE',
    language: 'en',
    themePreference: 'system',
    ...over,
  };
}

const names = (s) => uncategorisedMerchants(s).merchants.map((m) => m.merchant);

/* ── The empty case ─────────────────────────────────────────────────────── */

eq('an empty ledger produces an empty list', uncategorisedMerchants(state([])), {
  merchants: [],
  rowCount: 0,
  totalFils: 0,
});

eq(
  'a fully categorised ledger produces an empty list',
  uncategorisedMerchants(
    state([
      tx({ category: 'groceries', title: 'Carrefour' }),
      tx({ category: 'dining', title: 'Pizza Hut' }),
    ]),
  ),
  { merchants: [], rowCount: 0, totalFils: 0 },
);

ok('nothing on an empty list is worth prompting for', !worthPrompting(uncategorisedMerchants(state([]))));

/* ── Ranking: money first, count as the tiebreak ────────────────────────── */
//
// The whole argument for ranking on money is in this fixture. "Parking Barrier"
// is seen six times for AED 18 in total; "Al Noor Clinic" twice for AED 900.
// A count-ranked list leads with the barrier, which is the row whose category
// changes nothing anybody looks at.
{
  const rows = [
    ...Array.from({ length: 6 }, () => tx({ title: 'Parking Barrier', amountFils: 300 })),
    tx({ title: 'Al Noor Clinic', amountFils: 60000 }),
    tx({ title: 'Al Noor Clinic', amountFils: 30000 }),
    tx({ title: 'Al Bait Alhamawi Sup', amountFils: 4500 }),
  ];
  const out = uncategorisedMerchants(state(rows));
  eq('ranked by total money, not by how often it was seen', out.merchants.map((m) => m.merchant), [
    'Al Noor Clinic',
    'Al Bait Alhamawi Sup',
    'Parking Barrier',
  ]);
  eq('each merchant carries the money and the row count one tap moves', out.merchants[0], {
    key: 'al noor clinic',
    merchant: 'Al Noor Clinic',
    count: 2,
    totalFils: 90000,
    lastDate: '2026-07-01',
  });
  eq('the summary totals every row on the list', [out.rowCount, out.totalFils], [9, 96300]);
  ok('three merchants clears the prompt floor', worthPrompting(out));
}

{
  // Equal money: the one seen more often wins, because it is the one more
  // likely to be seen again, so the rule bought by that tap keeps paying.
  const rows = [
    tx({ title: 'Rare Shop', amountFils: 10000 }),
    tx({ title: 'Often Shop', amountFils: 5000 }),
    tx({ title: 'Often Shop', amountFils: 5000 }),
  ];
  eq('equal money is broken by the row count', names(state(rows)), ['Often Shop', 'Rare Shop']);
}

{
  // Equal on both: the order still has to be stable, or the list reshuffles
  // under the user's thumb on every re-render.
  const rows = [
    tx({ title: 'Zed Store', amountFils: 5000 }),
    tx({ title: 'Alpha Store', amountFils: 5000 }),
  ];
  eq('a total tie falls back to a stable name order', names(state(rows)), ['Alpha Store', 'Zed Store']);
}

/* ── Grouping: the key the store actually writes rules under ────────────── */
//
// THE FIXTURE IS THE TEST. `count` is the only warning the user gets before a
// bulk rewrite, so it has to be the blast radius of the tap and NOT the number
// of rows that put this merchant on the list — and those two numbers only ever
// differ over rows the candidacy filter drops. A fixture made purely of
// candidates asserts the right property and cannot fail, which is exactly how
// the unfiltered reducer shipped: three plain rows, count 3, blast radius 3.
//
// So this fixture carries one of every interesting row:
//
//   dropped by candidacy, MOVED by the rule — the archived-account row and the
//     row already sitting in `transport`. The merchant → category mapping is
//     global; hiding a card does not exempt its rows from a rule the user set,
//     and re-filing a guessed category is the whole point of an override.
//   dropped by BOTH — the hand-filed row, the income refund, the transfer leg.
//     Each is a decision or is not spending, and the reducer must not touch it.
{
  const rows = [
    tx({ title: 'ADNOC Station', amountFils: 5000 }),
    tx({ title: ' adnoc station ', amountFils: 5000, date: '2026-07-09' }),
    tx({ title: 'ADNOC Station', amountFils: 5000, date: '2026-07-05' }),
    tx({ title: 'ADNOC Station', amountFils: 5000, accountId: 'gone' }),
    tx({ title: 'ADNOC Station', amountFils: 5000, category: 'transport' }),
    tx({ title: 'ADNOC Station', amountFils: 5000, category: 'dining', userEdited: true }),
    tx({ title: 'ADNOC Station', amountFils: 7000, type: 'income' }),
    tx({ title: 'ADNOC Station', amountFils: 9000, isTransfer: true }),
  ];
  const out = uncategorisedMerchants(state(rows));
  eq('spellings that share an override key are one merchant', out.merchants.length, 1);
  eq('the key is the trimmed lowercase title the reducer matches', out.merchants[0].key, 'adnoc station');
  eq('the label shown is the commonest spelling', out.merchants[0].merchant, 'ADNOC Station');
  eq('the row count is every row that key will move', out.merchants[0].count, 5);
  eq('the money printed is the money those same rows carry', out.merchants[0].totalFils, 25000);
  eq('last seen is the newest of the group', out.merchants[0].lastDate, '2026-07-09');
  eq('the summary totals what the taps would move', [out.rowCount, out.totalFils], [5, 25000]);

  // The same fixture, said the other way round: the printed number IS the
  // predicate the store applies, row for row.
  const moved = rows.filter((t) => overrideAppliesTo(t, 'adnoc station'));
  eq('count equals exactly the rows the shared predicate moves', out.merchants[0].count, moved.length);
}

/* ── The predicate the reducer and both screens share ───────────────────── */
{
  const applies = (over) => overrideAppliesTo(tx({ title: 'Talabat', ...over }), 'talabat');

  ok('a plain other-category expense is moved', applies({}));
  ok('a row already guessed into another category is re-filed', applies({ category: 'dining' }));
  ok('an archived-account row is moved: the mapping is global', applies({ accountId: 'gone' }));
  ok('a differently-spelled row under the same key is moved',
    overrideAppliesTo(tx({ title: '  TALABAT  ' }), 'talabat'));

  ok('a hand-filed row is a decision and is left alone',
    !applies({ category: 'dining', userEdited: true }));
  ok('an income refund never takes an expense category',
    !applies({ type: 'income', category: 'other' }));
  ok('a flagged transfer is not spending and is left alone', !applies({ isTransfer: true }));
  ok('a card-payment leg is not spending and is left alone',
    !applies({ cardPaymentSide: 'debit' }));
  ok('a hand-split row keeps the category pinned to its largest part',
    !applies({
      splits: [
        { category: 'groceries', amountFils: 600 },
        { category: 'shopping', amountFils: 400 },
      ],
    }));
  ok('a different merchant is never touched', !overrideAppliesTo(tx({ title: 'Carrefour' }), 'talabat'));

  // The reported reproduction, whole. Five rows titled TALABAT; the screen
  // used to print 2 and the tap used to rewrite 5.
  const talabat = [
    tx({ title: 'TALABAT', amountFils: 4000 }),
    tx({ title: 'TALABAT', amountFils: 6000 }),
    tx({ title: 'TALABAT', amountFils: 5000, category: 'dining', userEdited: true }),
    tx({ title: 'TALABAT', amountFils: 3000, type: 'income' }),
    tx({ title: 'TALABAT', amountFils: 8000, accountId: 'gone' }),
  ];
  const out = uncategorisedMerchants(state(talabat));
  eq('the reproduction prints the blast radius, not the candidate count',
    out.merchants[0].count, 3);
  eq('and the blast radius is the rows the predicate names',
    talabat.filter((t) => overrideAppliesTo(t, 'talabat')).map((t) => t.amountFils),
    [4000, 6000, 8000]);
}

/* ── Exclusion: merchants the user has already ruled on ─────────────────── */
{
  const rows = [
    tx({ title: 'Known Shop', amountFils: 90000 }),
    tx({ title: 'Unknown Shop', amountFils: 1000 }),
  ];
  eq(
    'a merchant already in merchantOverrides is not asked about again',
    names(state(rows, { merchantOverrides: { 'known shop': 'other' } })),
    ['Unknown Shop'],
  );
  eq(
    'the override key is matched case-insensitively, as the store stores it',
    names(state([tx({ title: 'KNOWN SHOP' })], { merchantOverrides: { 'known shop': 'shopping' } })),
    [],
  );
  // "Already answered" only holds if the answer can REACH this row. Everything
  // on this list is an expense, and an income category may not decide an
  // expense row — `overrideFitsDirection` is that rule. An income pin is
  // reachable: correct a credit to Salary in the entry sheet and tap Remember.
  // On bare presence that pin struck the merchant's expense rows off the list
  // on the strength of a rule that can never apply to them, and they sat in
  // `other` forever, never asked about again.
  eq(
    'an income pin is not an answer about this merchant\'s expense rows',
    names(state([tx({ title: 'Known Shop' })], { merchantOverrides: { 'known shop': 'salary' } })),
    ['Known Shop'],
  );
  eq(
    'and the same is true of the other income category',
    names(state([tx({ title: 'Known Shop' })], { merchantOverrides: { 'known shop': 'business' } })),
    ['Known Shop'],
  );
  // `other` is in neither set on the income side, so it still answers here.
  eq(
    'an expense-side pin of "other" is still an answer',
    names(state([tx({ title: 'Known Shop' })], { merchantOverrides: { 'known shop': 'other' } })),
    [],
  );
  eq(
    'a row the user edited by hand is a decision, not a gap',
    names(state([tx({ title: 'Deliberate Shop', userEdited: true })])),
    [],
  );
  eq(
    'a row split across categories by hand is left alone',
    names(
      state([
        tx({
          title: 'Split Shop',
          amountFils: 1000,
          splits: [
            { category: 'groceries', amountFils: 600 },
            { category: 'shopping', amountFils: 400 },
          ],
        }),
      ]),
    ),
    [],
  );
}

/* ── Exclusion: transfers ───────────────────────────────────────────────── */
{
  eq(
    'a flagged transfer is not spending and gets no category question',
    names(state([tx({ title: 'Savings Sweep', isTransfer: true })])),
    [],
  );

  // Both halves of a move between the user's own accounts. Neither message
  // says the other exists; internalTransferIds pairs them, and neither leg is
  // a shop.
  const paired = [
    tx({ title: 'Outgoing transfer', amountFils: 1900000, isTransfer: true, date: '2026-07-02' }),
    tx({
      title: 'Incoming transfer',
      type: 'income',
      amountFils: 1900000,
      accountId: 'other-acct',
      date: '2026-07-02',
    }),
    tx({ title: 'Real Shop', amountFils: 2000 }),
  ];
  eq('neither leg of an internal transfer is offered', names(state(paired)), ['Real Shop']);

  eq(
    'money coming in is never a merchant to categorise',
    names(state([tx({ title: 'Mystery Credit', type: 'income', amountFils: 500000 })])),
    [],
  );
}

/* ── Exclusion: structural titles and the generic fallback ──────────────── */
{
  // These are the parser's OWN vocabulary for "this message names no payee".
  // An override on one is a rule about the app's words, not about a shop.
  const structural = [
    'ATM withdrawal',
    'Bank fee',
    'VAT fee',
    'Cash deposit',
    'Cheque',
    'Parking',
    'Outgoing transfer',
    'Refund',
    'Bank transfer',
    'Card payment',
    'Account debit',
    'Mobile recharge',
  ];
  eq(
    'no structural title is offered as a merchant',
    names(state(structural.map((title) => tx({ title, amountFils: 200000 })))),
    [],
  );
  eq(
    'the generic "Card purchase" fallback is not a merchant',
    names(state([tx({ title: 'Card purchase', amountFils: 500000 })])),
    [],
  );
  eq(
    'a title too short to be a safe override key is skipped',
    names(state([tx({ title: 'AB', amountFils: 500000 })])),
    [],
  );
}

/* ── Exclusion: rows that no longer count anywhere else ─────────────────── */
eq(
  'an archived account stops generating chores, as it stops counting',
  names(state([tx({ title: 'Old Shop', accountId: 'gone', amountFils: 500000 }), tx({ title: 'Live Shop' })])),
  ['Live Shop'],
);

/* ── The prompt floor ───────────────────────────────────────────────────── */
{
  const one = state([tx({ title: 'Lonely Shop' })]);
  const two = state([tx({ title: 'Shop One' }), tx({ title: 'Shop Two' })]);
  ok('below the floor Home stays quiet', !worthPrompting(uncategorisedMerchants(one)));
  ok('two merchants is still below the floor', !worthPrompting(uncategorisedMerchants(two)));
  ok('the floor is a named constant, not a literal', CATEGORISE_PROMPT_THRESHOLD === 3);

  // The list itself does not apply the floor: a user who opened the screen
  // asked, and one fixable merchant is a better answer than an empty page.
  eq('the screen still lists a single merchant', names(one), ['Lonely Shop']);
}

console.log(`\nuncategorised: ${pass} passed, ${fail} failed`);
if (fail) process.exit(1);
