const { runLaunchReviewRollout } = require('./build/launch-review-rollout.js');

let pass = 0;
let fail = 0;
const ok = (name, condition, detail = '') => {
  if (condition) { pass += 1; console.log(`✓ ${name}`); }
  else { fail += 1; console.log(`✗ ${name}${detail ? ` — ${detail}` : ''}`); }
};

const positive = [
  ['fab-wps', 'FAB', 'WPS AED 8,500.00 posted to A/C XXXX1234.', 'AE', 'credit', '850000'],
  ['adcb-move', 'ADCB', 'AED 2,000.00 moved out of account XXXX0021 into account XXXX0044.', 'AE', 'debit', '200000'],
  ['enbd-payroll', 'ENBD', 'Payroll AED 7,250.00 posted into your account XXXX4455.', 'AE', 'credit', '725000'],
  ['mashreq-cash', 'MASHREQ', 'Cash withdrawal AED 400.00 from account XXXX7788 at ATM.', 'AE', 'debit', '40000'],
  ['rajhi-salary', 'ALRAJHI', 'تم إيداع راتب ٧٥٠٠ ريال في حساب ١٢٣٤', 'SA', 'credit', '750000'],
  ['riyad-wps', 'RIYADBANK', 'WPS SAR 9,000.00 posted to account XXXX9090.', 'SA', 'credit', '900000'],
].map(([id, sender, source, market, direction, minorUnits]) => ({
  id, sender, source, expected: 'review', market, direction, minorUnits,
  provenance: 'synthetic', heldOut: true,
}));

const negativeBodies = [
  ['otp', 'FAB OTP 123456 for AED 500.00'],
  ['future', 'Salary AED 8,500.00 will be credited to your account tomorrow'],
  ['failed', 'AED 500.00 transfer to your account failed'],
  ['balance', 'Available balance AED 8,500.00'],
  ['two-money', 'AED 500.00 and AED 700.00 were transferred to your account'],
  ['offer', 'Cashback offer: spend AED 500.00 and receive AED 50.00'],
  ['statement', 'Your statement total AED 1,200.00 is due on 20 August'],
  ['pending', 'AED 300.00 transfer to your account is pending'],
  ['approve', 'Approve AED 250.00 purchase in your app'],
  ['minimum', 'Minimum due AED 100.00 on your card statement'],
];
const negatives = negativeBodies.map(([suffix, source], index) => ({
  id: `negative-${suffix}`, sender: index % 2 ? 'ADCB' : 'FAB', source,
  expected: 'refuse', provenance: 'synthetic', heldOut: true,
}));

const report = runLaunchReviewRollout([...positive, ...negatives]);
ok('the synthetic adversarial seed has perfect review recall',
  report.reviewRecall === 1, JSON.stringify(report));
ok('the synthetic adversarial seed admits no hard negative',
  report.unsafeAdmissionRate === 0, JSON.stringify(report));
ok('grounded market, direction and amount fields are exact',
  report.exactFieldRate === 1, JSON.stringify(report));
ok('synthetic examples cannot self-certify a public review beta',
  report.reviewBetaReady === false &&
    report.blockers.includes('consented-held-out-too-small') &&
    report.blockers.includes('held-out-corpus-too-small'), JSON.stringify(report));
ok('reports expose only generated references and never fixture text or ids',
  !JSON.stringify(report).includes('FAB OTP') && !JSON.stringify(report).includes('fab-wps'),
  JSON.stringify(report));

const duplicate = runLaunchReviewRollout([positive[0], { ...positive[0], id: 'another-id' }]);
ok('duplicate source padding is a hard corpus blocker',
  duplicate.blockers.includes('invalid-corpus') &&
    duplicate.failures.some((failure) => failure.reason === 'invalid-or-duplicate-fixture'),
  JSON.stringify(duplicate));

console.log(`\nlaunch-review-rollout: ${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
