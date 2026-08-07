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
{
  const rows = [
    tx({ title: 'ADNOC Station', amountFils: 5000 }),
    tx({ title: ' adnoc station ', amountFils: 5000, date: '2026-07-09' }),
    tx({ title: 'ADNOC Station', amountFils: 5000, date: '2026-07-05' }),
  ];
  const out = uncategorisedMerchants(state(rows));
  eq('spellings that share an override key are one merchant', out.merchants.length, 1);
  eq('the key is the trimmed lowercase title the reducer matches', out.merchants[0].key, 'adnoc station');
  eq('the label shown is the commonest spelling', out.merchants[0].merchant, 'ADNOC Station');
  eq('the row count is every row that key will move', out.merchants[0].count, 3);
  eq('last seen is the newest of the group', out.merchants[0].lastDate, '2026-07-09');
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
