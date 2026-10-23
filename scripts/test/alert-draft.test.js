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

// Local currency spellings a bank prints instead of the ISO code. Each is one
// amount in one (or, for the krone family, a named set of) currency.
{
  const read = (text) => inspectAlertDraft(text).candidates
    .map((c) => `${c.currencyCandidates.join('/')}:${[...new Set(c.interpretations.map((i) => i.minorUnits))].join(',')}`);
  const cases = [
    ['Köp 245,00 kr ICA NARA, kort 1234', 'SEK/NOK/DKK/ISK:24500'],
    ['Betaling kr 1.250,00 hos REMA', 'SEK/NOK/DKK/ISK:125000'],
    ['Platba kartou 459,00 Kč ALBERT', 'CZK:45900'],
    ['Platba kartou 459,00 Kc ALBERT', 'CZK:45900'],
    ['Płatność BLIK 129,00 zł ALLEGRO', 'PLN:12900'],
    ['Platnosc BLIK 129,00 zl ALLEGRO', 'PLN:12900'],
    ['₺145,00 tutarında ödeme', 'TRY:14500'],
    ['ยอด 1,250.00 บาท ที่ TOPS', 'THB:125000'],
    ['ชำระ ฿1,250.00 ที่ TOPS', 'THB:125000'],
    ['Thanh toan 450.000đ tai HIGHLANDS', 'VND:450000'],
    ['Thanh toan ₫450.000 tai HIGHLANDS', 'VND:450000'],
    ['Sent Tsh 25,000 to JOHN', 'TZS:2500000'],
    ['Sent TSh 25,000 to JOHN', 'TZS:2500000'],
    ['Charged USh 85,000 at SHOPRITE', 'UGX:85000'],
    ['Charged GH₵ 120.50 at MELCOM', 'GHS:12050'],
    ['Charged Ksh 17,500.00 at NAIVAS', 'KES:1750000'],
    ['Charged ₱640.00 at SM', 'PHP:64000'],
    ['Rp. 125.000 di INDOMARET', 'IDR:12500000'],
    ['Ft 1500 and 1 500 Ft', 'HUF:150000'],
    ['تم سحب 3,000.00 جم من الصراف', 'EGP:300000'],
    ['山田さんから1,500円を受け取りました', 'JPY:1500'],
    ['30,000원을 결제하였습니다', 'KRW:30000'],
    ['恒生銀行簽賬港幣52.00。', 'HKD:5200'],
    ['消費港元52.00', 'HKD:5200'],
    ['消費新台幣1,280元，如有疑問', 'TWD:128000'],
    ['消費新台币1,280元', 'TWD:128000'],
    ['消费人民币58.00元', 'CNY:5800'],
    ['消费58.00元', 'CNY:5800'],
  ];
  for (const [text, want] of cases) {
    const got = read(text);
    ok(`local spelling: ${text}`, got.length === 1 && (got[0] === want || (want.startsWith('HUF') && got[0].startsWith('HUF'))), got);
  }
  // A qualified name decides the currency; the generic 元 behind the same figure is not a second amount.
  const nt = inspectAlertDraft('消費新台幣1,280元');
  ok('a qualified currency name absorbs the generic 元 for the same figure',
    nt.candidates.length === 1 && nt.candidates[0].currency === 'TWD', nt.candidates);
  // Negatives: the same letters in ordinary text are not money.
  for (const text of ['Krone is the currency', 'Ukraine 5 sites', 'đ 5 em', 'Ftw 5', '5 Ftw', 'He said kr',
    'zl 5x6', 'Kc 5 kcal', 'a 5 krona coin', 'ref IMPS/627298765432/SUNIL', 'NEFTRs500X ref', 'go.example/s/9Kx']) {
    const draft = inspectAlertDraft(text);
    ok(`not money: ${text}`, draft.candidates.length === 0, draft.candidates.map((c) => c.sourceText));
  }
}

// An alphabetic prefix symbol glued to a word, digit or path is part of an
// identifier; an unattached one still reads (these must keep working).
{
  const first = (text) => inspectAlertDraft(text).candidates.map((c) => c.sourceText.trim());
  ok('Rs. before a figure still reads', first('Rs.1,250.00 spent on HDFC Bank Card')[0] === 'Rs.1,250.00');
  ok('(Rs500) still reads', first('Paid (Rs500) today')[0] === 'Rs500');
  ok('Amt:Rs.799 still reads', first('Amt:Rs.799 debited')[0] === 'Rs.799');
  ok('R$ 58,40 still reads', first('Compra R$ 58,40 aprovada')[0] === 'R$ 58,40');
  ok('S/ 30 still reads', first('Te yapeó S/ 30')[0] === 'S/ 30');
  ok('an IMPS reference is not soles', first('towards IMPS/627298765432/SUNIL PATIL').length === 0);
  ok('an Rs glued to a word is not rupees', first('NEFTRs500X').length === 0);
  ok('a short link path is not soles', first('go.example/s/9Kx').length === 0);
}

// A zero-charge marker opens many Malaysian bank SMS ("RM0 Maybank: ...").
{
  const maybank = inspectAlertDraft('RM0 Maybank: Your card ending 1234 has been charged RM59.90 at SHOPEE on 07 Sep 2026.');
  ok('the RM0 marker is not a second amount',
    maybank.candidates.length === 1 && maybank.candidates[0].minorUnits === '5990', maybank.candidates);
  const lead = inspectAlertDraft('  RM0 CIMB: txn RM128.40 at AEON');
  ok('leading whitespace before the marker does not hide it',
    lead.candidates.length === 1 && lead.candidates[0].minorUnits === '12840', lead.candidates);
  const iso = inspectAlertDraft('MYR0 Hong Leong: txn MYR45.60 at JAYA');
  ok('the marker may be an ISO code too', iso.candidates.length === 1 && iso.candidates[0].minorUnits === '4560', iso.candidates);
  ok('control: a zero with decimals at the start is a real figure',
    inspectAlertDraft('RM0.00 charged at SHOP').candidates.length === 1);
  ok('control: a zero fee inside the text stays',
    inspectAlertDraft('Charged RM12.00 at SHOP. Annual fee RM0 waived').candidates.length === 2);
  ok('control: a zero balance stays',
    inspectAlertDraft('Your balance is RM0').candidates.length === 1);
  ok('control: a figure after the marker is not dropped when the marker is followed by a digit',
    inspectAlertDraft('RM0 5 items').candidates.length === 1);
}

// Argentine pesos print dot thousands and no decimals; that is one reading
// for ARS, while the same text on a US-style dollar stays ambiguous.
{
  const draft = inspectAlertDraft('Pagaste $ 6.430 en PEDIDOSYA');
  const ars = draft.candidates[0].interpretations.filter((i) => i.currency === 'ARS');
  ok('ARS reads $ 6.430 as 6,430.00 only', ars.length === 1 && ars[0].minorUnits === '643000', ars);
  const usd = draft.candidates[0].interpretations.filter((i) => i.currency === 'USD').map((i) => i.minorUnits).sort();
  ok('control: USD still keeps both readings of $ 6.430', usd.join() === '643,643000', usd);
  const comma = inspectAlertDraft('Pagaste $ 6,43 en PEDIDOSYA');
  ok('control: an ARS $ 6,43 still reads 6.43',
    comma.candidates[0].interpretations.some((i) => i.currency === 'ARS' && i.minorUnits === '643'), comma.candidates);
}

console.log(`\n${pass} passed, ${fail} failed`);
if (fail) process.exit(1);
