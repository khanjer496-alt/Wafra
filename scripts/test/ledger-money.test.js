const {
  checkedMinorSum,
  formatMinorUnits,
  isLedgerMoneySpec,
  ledgerMoneySpec,
  ledgerMoneyMatchesCurrentMetadata,
  migrateLegacyLedgerMoney,
  parseMajorToMinor,
  roundToWholeMajorMinor,
  storedLedgerMoneySpec,
} = require('./build/ledger-money.js');

let pass = 0;
let fail = 0;
const ok = (name, condition, detail) => {
  if (condition) { pass += 1; console.log(`✓ ${name}`); }
  else { fail += 1; console.log(`✗ ${name}`, detail ?? ''); }
};
const throws = (fn) => { try { fn(); return false; } catch { return true; } };

const JPY = ledgerMoneySpec('JPY');
const AED = ledgerMoneySpec('AED');
const KWD = ledgerMoneySpec('KWD');
ok('0/2/3 exponent ledger specs are pinned from ISO metadata',
  JPY?.exponent === 0 && AED?.exponent === 2 && KWD?.exponent === 3);
ok('unsupported exponent-4 currency is not a ledger spec', ledgerMoneySpec('CLF') === null);
const historicKwd2 = storedLedgerMoneySpec('KWD', 2);
ok('a persisted exponent remains authoritative if current ISO metadata changes',
  historicKwd2?.exponent === 2 && isLedgerMoneySpec(historicKwd2) &&
    ledgerMoneyMatchesCurrentMetadata(historicKwd2) === false &&
    formatMinorUnits(125, historicKwd2) === '1.25');

ok('JPY parses whole units exactly', parseMajorToMinor('12,345', JPY) === 12345);
ok('JPY refuses fractional units', parseMajorToMinor('12.5', JPY) === null);
ok('AED parses and pads one decimal place', parseMajorToMinor('1,234.5', AED) === 123450);
ok('KWD parses three decimals exactly', parseMajorToMinor('1.250', KWD) === 1250);
ok('KWD refuses excess fractional precision', parseMajorToMinor('1.2509', KWD) === null);
ok('malformed grouping is refused', parseMajorToMinor('12,34.50', AED) === null);
ok('zero and safe-integer overflow are refused',
  parseMajorToMinor('0', AED) === null && parseMajorToMinor('900719925474099.99', AED) === null);

ok('minor-unit formatting honors every exponent',
  formatMinorUnits(12345, JPY) === '12,345' &&
    formatMinorUnits(123450, AED) === '1,234.50' &&
    formatMinorUnits(1250, KWD) === '1.250');
ok('hidden decimals round at the ledger exponent',
  formatMinorUnits(7699, AED, { decimals: false }) === '77' &&
    roundToWholeMajorMinor(1499, KWD) === 1000);
ok('negative sub-unit values never print negative zero',
  formatMinorUnits(-20, AED, { decimals: false }) === '0');
ok('checked sums fail closed on unsafe arithmetic',
  checkedMinorSum([100, 200]) === 300 &&
    throws(() => checkedMinorSum([Number.MAX_SAFE_INTEGER, 1])));

const legacyAe = { marketId: 'AE', accounts: [], transactions: [{ amountFils: 12345 }] };
const legacySa = { marketId: 'SA', accounts: [{ openingFils: 100 }] };
const aeSpec = migrateLegacyLedgerMoney(legacyAe);
const saSpec = migrateLegacyLedgerMoney(legacySa);
ok('legacy UAE and Saudi ledgers gain specs without touching amounts',
  aeSpec?.currency === 'AED' && aeSpec.exponent === 2 &&
    saSpec?.currency === 'SAR' && saSpec.exponent === 2 &&
    legacyAe.transactions[0].amountFils === 12345);
ok('empty first-run state remains unpinned',
  migrateLegacyLedgerMoney({ marketId: '', transactions: [], accounts: [] }) === null);
ok('legacy money with no market follows the documented UAE rule',
  migrateLegacyLedgerMoney({ transactions: [{ amountFils: 500 }] })?.currency === 'AED');
ok('unknown legacy market with money fails closed',
  throws(() => migrateLegacyLedgerMoney({ marketId: 'XX', transactions: [{ amountFils: 500 }] })));
ok('an explicit ledger currency is authoritative over the parser-market preference',
  migrateLegacyLedgerMoney({
    marketId: 'AE', ledgerMoney: KWD, transactions: [{ amountFils: 500 }],
  }) === KWD);
ok('a total-only card due still counts as monetary history',
  throws(() => migrateLegacyLedgerMoney({ marketId: 'XX', cardDues: [{ totalDueFils: 500 }] })));
ok('budget and goal money pin the schema before a bank transaction exists',
  migrateLegacyLedgerMoney({
    marketId: 'AE', budgets: [{ limitFils: 500 }], goals: [{ targetFils: 1_000 }],
  })?.currency === 'AED');
ok('migration is idempotent for a valid v2 spec',
  migrateLegacyLedgerMoney({ ledgerMoney: AED, transactions: [{ amountFils: 500 }] }) === AED);

console.log(`\nledger-money: ${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
