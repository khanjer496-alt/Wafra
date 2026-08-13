const { inspectUnparsedLaunchAlert } = require('./build/unparsed-launch-alert.js');

let pass = 0;
let fail = 0;
const ok = (name, condition, detail) => {
  if (condition) { pass += 1; console.log(`✓ ${name}`); }
  else { fail += 1; console.log(`✗ ${name}`, detail ?? ''); }
};

const salary = inspectUnparsedLaunchAlert(
  'FAB payroll: AED 8,500.00 WPS credit posted to A/C XXXX1234.',
  'FAB',
);
ok('an unfamiliar Gulf salary format becomes incoming review evidence',
  salary.outcome === 'review' && salary.review.direction === 'credit' &&
    salary.review.amount.minorUnits === '850000' && salary.review.market === 'AE' &&
    salary.review.instrument?.kind === 'account' && salary.review.instrument.last4 === '1234',
  JSON.stringify(salary));

const salaryWithBalance = inspectUnparsedLaunchAlert(
  'FAB payroll: AED 8,500.00 WPS credit posted to account XXXX1234. Available balance AED 12,400.00.',
  'FAB',
);
ok('a salary review selects the movement amount rather than the balance',
  salaryWithBalance.outcome === 'review' && salaryWithBalance.review.amount.minorUnits === '850000',
  JSON.stringify(salaryWithBalance));

const ownMove = inspectUnparsedLaunchAlert(
  'ADCB notice: AED 2,000.00 moved out of A/C XXXX0021 into A/C XXXX0044.',
  'ADCB',
);
ok('an unfamiliar own-account movement remains a transfer for explicit review',
  ownMove.outcome === 'review' && ownMove.review.direction === 'debit' &&
    ownMove.review.family === 'transfer' && ownMove.review.amount.minorUnits === '200000',
  JSON.stringify(ownMove));

const namedIncoming = inspectUnparsedLaunchAlert(
  'AED 2,500.00 has been transferred to your FAB account from JOHN DOE',
  'FAB',
);
ok('a named incoming transfer can be reviewed without assuming salary or external income',
  namedIncoming.outcome === 'review' && namedIncoming.review.direction === 'credit' &&
    namedIncoming.review.family === 'transfer' && namedIncoming.review.amount.minorUnits === '250000',
  JSON.stringify(namedIncoming));

const saudi = inspectUnparsedLaunchAlert(
  'Al Rajhi: تم إيداع راتب ٧٥٠٠ ريال في حساب ١٢٣٤',
  'ALRAJHI',
);
ok('an unfamiliar Saudi salary stays exact SAR incoming review evidence',
  saudi.outcome === 'review' && saudi.review.market === 'SA' &&
    saudi.review.direction === 'credit' && saudi.review.amount.minorUnits === '750000',
  JSON.stringify(saudi));

for (const [name, source] of [
  ['OTP', 'FAB OTP 123456 to receive AED 8,500.00'],
  ['future salary', 'FAB: Salary AED 8,500.00 will be credited to your account tomorrow'],
  ['decline', 'FAB: AED 8,500.00 transfer to your account failed'],
  ['balance', 'FAB: Available balance AED 8,500.00'],
]) {
  const result = inspectUnparsedLaunchAlert(source, 'FAB');
  ok(`${name} cannot become reviewable posted money`, result.outcome === 'refuse', JSON.stringify(result));
}

const ambiguous = inspectUnparsedLaunchAlert(
  'FAB: AED 500.00 and AED 700.00 were transferred to your account.',
  'FAB',
);
ok('two plausible movement amounts fail closed', ambiguous.outcome === 'refuse', JSON.stringify(ambiguous));

const unknownSender = inspectUnparsedLaunchAlert(
  'AED 8,500.00 WPS credit posted to account XXXX1234.',
  'UNKNOWN',
);
ok('an unknown sender cannot create Gulf review evidence',
  unknownSender.outcome === 'refuse', JSON.stringify(unknownSender));

ok('review evidence retains neither source nor sender text',
  salary.outcome === 'review' && !JSON.stringify(salary.review).includes('WPS') &&
    !JSON.stringify(salary.review).includes('FAB payroll'), JSON.stringify(salary));

console.log(`\nunparsed-launch-alert: ${pass} passed, ${fail} failed`);
if (fail) process.exit(1);
