const {
  inspectAlertDraft,
  normalizeAlertText,
} = require('./build/alert-draft.js');
const {
  CURRENCY_MINOR_UNITS,
  ISO_4217_SNAPSHOT_DATE,
  currencyMinorUnits,
} = require('./build/currency-metadata.js');

let pass = 0;
let fail = 0;
function ok(name, condition, detail) {
  if (condition) {
    pass += 1;
    console.log(`✓ ${name}`);
  } else {
    fail += 1;
    console.log(`✗ ${name}${detail === undefined ? '' : ` — ${detail}`}`);
  }
}

ok('currency metadata is pinned to the current SIX snapshot',
  ISO_4217_SNAPSHOT_DATE === '2026-01-01' && Object.keys(CURRENCY_MINOR_UNITS).length === 165);
ok('ISO exponents cover zero, two, three and four minor units',
  currencyMinorUnits('JPY') === 0 && currencyMinorUnits('AED') === 2 &&
  currencyMinorUnits('KWD') === 3 && currencyMinorUnits('CLF') === 4);
ok('unknown and historical codes are not guessed',
  currencyMinorUnits('XYZ') === null && currencyMinorUnits('BGN') === null);

{
  const source = 'خصم AED ١٢٣٫٤٥ والرصيد ۹٬۸۷۶٫۵۴';
  const normalized = normalizeAlertText(source);
  ok('Arabic-Indic and Persian digits normalize in one pass',
    normalized === 'خصم AED 123٫45 والرصيد 9,876٫54', normalized);
  ok('normalization preserves UTF-16 offsets', normalized.length === source.length);
}

function one(source) {
  const draft = inspectAlertDraft(source);
  ok(`${source}: exactly one candidate`, draft.candidates.length === 1,
    JSON.stringify(draft.candidates));
  return { draft, candidate: draft.candidates[0] };
}

{
  const { draft, candidate } = one('Purchase JPY 12,345 at TOKYO STORE');
  ok('JPY uses exponent zero', candidate.exponent === 0 && candidate.minorUnits === '12345');
  ok('inspector can review but can never auto-import', draft.decision === 'review');
}

{
  const { candidate } = one('Card charged EUR 1.234,56 at MARKET');
  ok('mixed European separators resolve from the ISO exponent',
    candidate.exponent === 2 && candidate.minorUnits === '123456');
}

{
  const { candidate } = one('INR १,२५,०००.५० debited from your account');
  ok('Devanagari digits and Indian grouping are grounded',
    candidate.exponent === 2 && candidate.minorUnits === '12500050',
    JSON.stringify(candidate));
}

{
  const { candidate } = one('KWD 1.250 purchase');
  ok('a 3-digit separator without locale evidence has no asserted value',
    candidate.currency === 'KWD' && candidate.exponent === null && candidate.minorUnits === null);
  ok('both KWD decimal and grouping interpretations survive for review',
    candidate.interpretations.some((x) => x.minorUnits === '1250') &&
    candidate.interpretations.some((x) => x.minorUnits === '1250000'));
}

{
  const { candidate } = one('خصم KWD ١٫٢٥٠ لشراء بالبطاقة');
  ok('the Arabic decimal separator grounds an exact three-decimal value',
    candidate.currency === 'KWD' && candidate.exponent === 3 &&
      candidate.minorUnits === '1250' && candidate.interpretations.length === 1,
    JSON.stringify(candidate));
}

{
  const { candidate } = one('KWD 1,234,567 debited');
  ok('repeated separators in an exponent-3 currency never assert one value',
    candidate.minorUnits === null && candidate.exponent === null &&
    candidate.interpretations.some((x) => x.minorUnits === '1234567') &&
    candidate.interpretations.some((x) => x.minorUnits === '1234567000'),
    JSON.stringify(candidate));
}

for (const malformed of [
  'USD 1.2.3,456 paid',
  'USD 1,234.567 paid',
  'JPY 12,345.00 paid',
  'USD 1,2,3 paid',
  'USD 1e6 paid',
  'Ref ABC123 USD',
  'Posted 2026-08-10 SAR',
]) {
  const draft = inspectAlertDraft(malformed);
  ok(`${malformed}: malformed/embedded numbers are not partially parsed`,
    draft.candidates.length === 0 && draft.decision === 'refuse', JSON.stringify(draft));
}

{
  const { candidate } = one('$25.00 purchase');
  ok('a dollar sign is not silently called USD',
    candidate.currency === null && candidate.minorUnits === null &&
    candidate.ambiguities.includes('currency-symbol'));
}

{
  const draft = inspectAlertDraft('Charged USD 9.99 (AED 36.70) at EXAMPLE');
  ok('two bank-quoted currencies remain two grounded candidates',
    draft.candidates.length === 2 && draft.candidates[0].currency === 'USD' &&
    draft.candidates[0].minorUnits === '999' && draft.candidates[1].currency === 'AED' &&
    draft.candidates[1].minorUnits === '3670', JSON.stringify(draft.candidates));
}

{
  const draft = inspectAlertDraft('Card charged USD 20.00. Available balance USD 800.00');
  ok('charged transaction wording prevents a trailing balance-only refusal',
    draft.decision === 'review' && !draft.reasons.includes('balance-only'), JSON.stringify(draft));
}

{
  const source = 'تم خصم AED ١٢٣٫٤٥ من البطاقة';
  const { candidate } = one(source);
  ok('candidate spans slice the exact original-script source',
    source.slice(candidate.span.start, candidate.span.end) === candidate.sourceText &&
    candidate.sourceText === 'AED ١٢٣٫٤٥', JSON.stringify(candidate));
}

for (const [label, source, reason] of [
  ['OTP', 'OTP 778899 approves USD 25.00 at SHOP. Do not share.', 'authentication-or-otp'],
  ['decline', 'Your purchase of EUR 10.00 was declined.', 'declined-or-failed'],
  ['future debit', 'USD 29.99 will be debited on Monday.', 'scheduled-or-due'],
  ['balance only', 'Available balance AED 4,500.00', 'balance-only'],
  ['summary', 'Your monthly spending summary is USD 900.00', 'aggregate-or-summary'],
]) {
  const draft = inspectAlertDraft(source);
  ok(`${label} with an amount is refused`, draft.decision === 'refuse' && draft.reasons.includes(reason),
    JSON.stringify(draft));
}

{
  const draft = inspectAlertDraft('Hello from your bank');
  ok('text with no grounded currency amount is refused',
    draft.decision === 'refuse' && draft.reasons.includes('no-grounded-money'));
}

{
  const source = `USD ${'9'.repeat(5000)}`;
  const started = Date.now();
  const draft = inspectAlertDraft(source);
  ok('pathological input is bounded and refused quickly',
    Date.now() - started < 250 && draft.normalizedText.length === 4096 && draft.decision === 'refuse');
}

{
  const source = `${'1'.repeat(60)}${' '.repeat(4000)} USD`;
  const started = Date.now();
  const draft = inspectAlertDraft(source);
  ok('long digit/space backtracking input is bounded',
    Date.now() - started < 250 && draft.decision === 'refuse');
}

{
  const draft = inspectAlertDraft('Compra aprobada por $350.00 MXN en OXXO');
  ok('a symbol and ISO code on one figure are one amount, not two',
    draft.candidates.length === 1 && draft.candidates[0].interpretations.length === 1 &&
      draft.candidates[0].interpretations[0].currency === 'MXN', draft.candidates);
  const two = inspectAlertDraft('Paid $20.00 and USD 35.00 later');
  ok('two different figures stay two amounts', two.candidates.length === 2, two.candidates);
}

// G1 (synthetic). A figure the currency's exponent cannot hold is the
// unreadable transaction amount; it must not hand the amount to another number.
{
  const yen = inspectAlertDraft('Card purchase 812.40 JPY 7 SAKURA MART 2 Balance 15,200 JPY');
  ok('an impossible yen figure is flagged, never silently skipped', yen.reasons.includes('exponent-invalid-money') &&
    yen.decision === 'refuse', yen.reasons);
  const clock = inspectAlertDraft('38.15 KRW 9:45 HANA STORE card ending 4410');
  ok('a clock is never a money candidate', !clock.candidates.some((c) => c.minorUnits === '9'), clock.candidates);
  ok('a won figure with decimals is flagged', clock.reasons.includes('exponent-invalid-money'), clock.reasons);
  const valid = inspectAlertDraft('Purchase of JPY 4,650 at SAKURA MART');
  ok('control: a whole yen figure still reads exactly', valid.candidates.length === 1 &&
    valid.candidates[0].minorUnits === '4650' && !valid.reasons.includes('exponent-invalid-money'), valid);
  const padded = inspectAlertDraft('Purchase of JPY 4,650.00 at SAKURA MART. AED 113.85');
  ok('control: an all-zero yen fraction is not treated as an impossible figure',
    !padded.reasons.includes('exponent-invalid-money'), padded.reasons);
  const kwd = inspectAlertDraft('KWD 12.345 debited at THE AVENUES');
  ok('control: a three-decimal dinar is not flagged', !kwd.reasons.includes('exponent-invalid-money') &&
    kwd.candidates[0].interpretations.some((i) => i.minorUnits === '12345'), kwd);
}

console.log(`\n${pass} passed, ${fail} failed`);
if (fail) process.exit(1);
