const assert = require('node:assert/strict');
const test = require('node:test');
const load = require('./load-ts.cjs').createLoader();
let P;
try { P = load('@/lib/private-alert-formats'); } catch (error) {
  if (!String(error.message).includes('private-alert-formats')) throw error;
  P = {};
}
const key = Uint8Array.from({ length: 32 }, (_, i) => i + 1);
const otherKey = Uint8Array.from({ length: 32 }, (_, i) => i + 2);
const NOW = Date.parse('2026-10-12T12:00:00Z');
const source = 'Sample Bank: Your card ending 1234 was charged USD 10.50 to Jane Doe on 2026-09-08. Available balance USD 900.00.';
const second = 'Sample Bank: Your card ending 6789 was charged USD 20.75 to Cedar Bookshop on 2026-10-09. Available balance USD 879.25.';
const confirmed = { amountMinor: 1050, currency: 'USD', exponent: 2, direction: 'debit', merchant: 'Jane Doe', date: '2026-09-08' };
const input = (patch = {}) => ({ source, sender: 'SAMPLEBANK', confirmed, context: { country: 'US' }, now: NOW, ...patch });
const learn = (patch = {}) => { const result = P.createPrivateAlertFormat(input(patch), key); assert.equal(result.ok, true, result.reason); return result.template; };
const store = template => ({ version: 1, templates: [template] });
const match = (body, template, patch = {}) => P.matchPrivateAlertFormat(body, 'SAMPLEBANK', store(template), key, { now: NOW, ...patch });
const validated = () => { const result = P.validatePrivateAlertFormat(learn(), second, 'SAMPLEBANK', key, { now: NOW, country: 'US' }); assert.equal(result.ok, true, result.reason); return result.template; };

test('production private learning API is available', () => {
  for (const name of ['createPrivateAlertFormat', 'matchPrivateAlertFormat', 'validatePrivateAlertFormat', 'normalizePrivateAlertFormatStore', 'emptyPrivateAlertFormatStore', 'removePrivateAlertFormat', 'authenticatePrivateAlertFormat', 'isValidPrivateAlertFormatStore']) assert.equal(typeof P[name], 'function', name);
});

test('first confirmation persists a private draft with no customer literals or values', () => {
  const template = learn();
  assert.equal(template.status, 'draft');
  const allStrings = value => typeof value === 'string' ? [value] : value && typeof value === 'object' ? Object.values(value).flatMap(allStrings) : [];
  const json = allStrings(template).filter(value => !/^(?:pf_)?[a-f0-9]{64}$/u.test(value)).join('\n');
  for (const privateValue of ['Sample', 'Bank', 'SAMPLEBANK', 'charged', 'Jane', 'Doe', '1234', '10.50', '2026-09-08', '900.00']) assert.equal(json.includes(privateValue), false, privateValue);
  assert.equal(json.includes(Buffer.from(key).toString('hex')), false);
  assert.equal(P.authenticatePrivateAlertFormat(template, key), true);
  assert.equal(P.isValidPrivateAlertFormatStore(store(template)), true);
  assert.deepEqual(match(second, template), { kind: 'none' });
  const preview = P.matchPrivateAlertFormat(second, 'SAMPLEBANK', store(template), key, { now: NOW }, template.id);
  assert.equal(preview.kind, 'prefill');
  assert.deepEqual(preview.fields, { amountMinor: 2075, currency: 'USD', exponent: 2, direction: 'debit', merchant: 'Cedar Bookshop', date: '2026-10-09', cardLast4: '6789' });
});

test('the same message cannot validate a draft even with whitespace and case changes', () => {
  const template = learn();
  for (const body of [source, source.toUpperCase(), '  ' + source + '  ']) assert.equal(P.validatePrivateAlertFormat(template, body, 'SAMPLEBANK', key, { now: NOW }).ok, false);
});

test('a distinct second source validates for Review only and changed values remain source grounded', () => {
  const template = validated();
  assert.equal(template.status, 'validated');
  assert.equal(P.authenticatePrivateAlertFormat(template, key), true);
  const hit = match(second.replace('20.75', '32.10').replace('Cedar Bookshop', 'Aster Market'), template, { postThreshold: 1 });
  assert.equal(hit.kind, 'prefill');
  assert.equal(hit.fields.amountMinor, 3210);
  assert.equal(hit.fields.merchant, 'Aster Market');
  assert.equal(hit.templateId, template.id);
  assert.equal(Object.hasOwn(hit, 'source'), false);
});

test('wrong keys reject creation and all matches or validation fail closed', () => {
  assert.equal(P.createPrivateAlertFormat(input(), new Uint8Array(31)).ok, false);
  const template = learn();
  assert.equal(P.authenticatePrivateAlertFormat(template, otherKey), false);
  assert.equal(P.validatePrivateAlertFormat(template, second, 'SAMPLEBANK', otherKey, { now: NOW }).ok, false);
  assert.deepEqual(P.matchPrivateAlertFormat(second, 'SAMPLEBANK', store(validated()), otherKey, { now: NOW }), { kind: 'none' });
});

for (const [name, mutate] of [
  ['status', t => ({ ...t, status: 'validated', validatedSampleDigest: 'a'.repeat(64) })],
  ['direction', t => ({ ...t, direction: 'credit' })],
  ['currency', t => ({ ...t, currency: 'EUR' })],
  ['sample binding', t => ({ ...t, sampleDigest: 'a'.repeat(64) })],
  ['sender binding', t => ({ ...t, senderDigest: 'a'.repeat(64) })],
  ['literal digest', t => ({ ...t, tokens: t.tokens.map((x, i) => i === 0 ? { k: 'L', h: 'a'.repeat(64) } : x) })],
  ['timestamp', t => ({ ...t, updatedAt: t.updatedAt + 1 })],
]) test(`tampered ${name} cannot authenticate or match`, () => {
  const template = mutate(validated());
  assert.equal(P.authenticatePrivateAlertFormat(template, key), false);
  assert.deepEqual(match(second, template), { kind: 'none' });
});

for (const [name, body] of [
  ['pending status', second + ' Pending.'],
  ['declined status', second.replace('was charged', 'was declined')],
  ['changed direction', second.replace('was charged', 'was credited')],
  ['OTP control', second + ' OTP 456789.'],
  ['extra sentence', second + ' Extra instruction.'],
  ['extra money', second + ' Fee USD 3.00.'],
  ['changed currency', second.replace('USD 20.75', 'EUR 20.75')],
  ['changed balance currency', second.replace('USD 879.25', 'EUR 879.25')],
  ['missing clause', second.replace(' Available balance USD 879.25.', '')],
  ['future date', second.replace('2026-10-09', '2027-10-09')],
  ['invalid date', second.replace('2026-10-09', '2026-02-31')],
  ['malformed decimal', second.replace('USD 20.75', 'USD 1,23.4')],
]) test(`full source mismatch refuses ${name}`, () => {
  const template = learn();
  assert.equal(P.validatePrivateAlertFormat(template, body, 'SAMPLEBANK', key, { now: NOW }).ok, false);
  assert.deepEqual(match(body, validated()), { kind: 'none' });
});

test('sender and AE/SA route checks are preserved', () => {
  const template = validated();
  assert.deepEqual(P.matchPrivateAlertFormat(second, 'OTHERBANK', store(template), key, { now: NOW }), { kind: 'none' });
  for (const routedMarket of ['AE', 'SA']) {
    assert.equal(P.createPrivateAlertFormat(input({ context: { routedMarket } }), key).ok, false);
    assert.deepEqual(match(second, template, { routedMarket }), { kind: 'none' });
  }
});

test('date policy conflicts and missing finite observed day refuse', () => {
  const template = validated();
  assert.deepEqual(match(second, template, { country: 'GB' }), { kind: 'none' });
  assert.deepEqual(match(second, template, { dateOrder: 'DMY' }), { kind: 'none' });
  assert.deepEqual(P.matchPrivateAlertFormat(second, 'SAMPLEBANK', store(template), key, {}), { kind: 'none' });
});

test('all dates must be valid and not future even when they were not taught as extracted date', () => {
  const noDate = learn({ confirmed: { ...confirmed, date: undefined } });
  assert.equal(P.matchPrivateAlertFormat(second.replace('2026-10-09', '2027-10-09'), 'SAMPLEBANK', store(noDate), key, { now: NOW }, noDate.id).kind, 'none');
  assert.equal(P.createPrivateAlertFormat(input({ source: source.replace('2026-09-08', '2027-09-08'), confirmed: { ...confirmed, date: undefined } }), key).ok, false);
});

test('Arabic digits and merchant layouts work with private anchors', () => {
  const arabic = 'بنك المثال: تم خصم JOD ١٠٫٥٠٠ من بطاقة ١٢٣٤ لدى متجر النور بتاريخ ٢٠٢٦-٠٩-٠٨.';
  const learned = P.createPrivateAlertFormat({ source: arabic, sender: 'JO-DEMO', confirmed: { amountMinor: 10500, currency: 'JOD', exponent: 3, direction: 'debit', merchant: 'متجر النور', date: '2026-09-08' }, context: { country: 'JO' }, now: NOW }, key);
  assert.equal(learned.ok, true, learned.reason);
  const next = 'بنك المثال: تم خصم JOD ٢٣٫٧٥٠ من بطاقة ٦٧٨٩ لدى مكتبة الياسمين بتاريخ ٢٠٢٦-١٠-٠٩.';
  const validation = P.validatePrivateAlertFormat(learned.template, next, 'JO-DEMO', key, { now: NOW, country: 'JO' });
  assert.equal(validation.ok, true, validation.reason);
  assert.equal(validation.fields.amountMinor, 23750);
  assert.equal(validation.fields.merchant, 'مكتبة الياسمين');
  assert.equal(validation.fields.date, '2026-10-09');
  assert.equal(JSON.stringify(validation.template).includes('المثال'), false);
});

test('unknown or legacy serialized fields and hostile getters never survive store validation', () => {
  const template = validated();
  for (const value of [
    { ...template, sender: 'SAMPLEBANK' }, { ...template, source },
    { ...template, tokens: [{ k: 'L', v: 'Jane' }, ...template.tokens.slice(1)] },
    { ...template, aliases: { Jane: 'USD' } },
    { ...template, tokens: [{ k: 'NUM', f: 'Jane' }, ...template.tokens.slice(1)] },
    { ...template, tokens: Array(161).fill({ k: 'AMT' }) },
  ]) {
    assert.equal(P.isValidPrivateAlertFormatStore(store(value)), false);
    assert.deepEqual(P.normalizePrivateAlertFormatStore(store(value)), { version: 1, templates: [] });
  }
  let reads = 0;
  const hostile = Object.defineProperty({}, 'version', { enumerable: true, get() { reads++; throw Error('hostile'); } });
  assert.deepEqual(P.normalizePrivateAlertFormatStore(hostile), { version: 1, templates: [] });
  assert.equal(reads, 0);
  assert.deepEqual(P.normalizePrivateAlertFormatStore(new Proxy({}, { ownKeys() { throw Error('hostile'); } })), { version: 1, templates: [] });
});

test('store caps, duplicates, removal and returned copies cannot leak or mutate persisted shapes', () => {
  const base = validated();
  const many = Array.from({ length: 60 }, (_, i) => ({ ...base, id: 'pf_' + i.toString(16).padStart(64, '0'), updatedAt: NOW + i }));
  const normalized = P.normalizePrivateAlertFormatStore({ version: 1, templates: many });
  assert.equal(normalized.templates.length, 50);
  assert.equal(P.isValidPrivateAlertFormatStore({ version: 1, templates: many }), false);
  assert.equal(P.normalizePrivateAlertFormatStore({ version: 1, templates: [base, base] }).templates.length, 1);
  assert.deepEqual(P.removePrivateAlertFormat(store(base), base.id), P.emptyPrivateAlertFormatStore());
  const copied = P.normalizePrivateAlertFormatStore(store(base));
  copied.templates[0].tokens[0].h = 'a'.repeat(64);
  assert.equal(P.authenticatePrivateAlertFormat(base, key), true);
});

test('conflicting overlapping formats refuse even though each independently matches', () => {
  const unknown = source.replace('was charged', 'transaction posted').replace(' Available balance USD 900.00.', '');
  const nextUnknown = second.replace('was charged', 'transaction posted').replace(' Available balance USD 879.25.', '');
  const draft = learn({ source: unknown });
  const first = P.validatePrivateAlertFormat(draft, nextUnknown, 'SAMPLEBANK', key, { now: NOW }).template;
  const reversed = P.createPrivateAlertFormat(input({ source: unknown, confirmed: { ...confirmed, direction: 'credit' } }), key);
  assert.equal(reversed.ok, true, reversed.reason);
  const result = P.validatePrivateAlertFormat(reversed.template, nextUnknown, 'SAMPLEBANK', key, { now: NOW });
  assert.equal(result.ok, true, result.reason);
  assert.equal(P.matchPrivateAlertFormat(nextUnknown, 'SAMPLEBANK', { version: 1, templates: [first, result.template] }, key, { now: NOW }).kind, 'none');
});

test('a confirmed balance, fee beside principal, limit or due amount never becomes a learned principal', () => {
  for (const [body, amountMinor] of [
    [source, 90000],
    ['Sample Bank: Your card was charged USD 10.50. Fee USD 2.00.', 200],
    ['Sample Bank: Your card was charged USD 10.50. Available credit limit USD 900.00.', 90000],
    ['Sample Bank: Your card was charged USD 10.50. Minimum due USD 5.00.', 500],
  ]) assert.equal(P.createPrivateAlertFormat(input({ source: body, confirmed: { ...confirmed, amountMinor, merchant: undefined, date: undefined } }), key).ok, false);
});

test('user currency choice and custom aliases cannot repair ambiguous source currency or decimal conventions', () => {
  assert.equal(P.createPrivateAlertFormat(input({ source: source.replace('USD 10.50', '$10.50') }), key).ok, false);
  const ambiguous = 'Sample Bank: Your card ending 1234 was charged JOD 1.234 to Jane Doe on 2026-09-08.';
  assert.equal(P.createPrivateAlertFormat(input({ source: ambiguous, confirmed: { ...confirmed, currency: 'JOD', exponent: 3, amountMinor: 1234 } }), key).ok, false);
  const customized = source.replace('USD 10.50', 'Jane 10.50');
  assert.equal(P.createPrivateAlertFormat(input({ source: customized, context: { currencyAliases: { Jane: ['USD'] } } }), key).ok, false);
});

test('unlabelled numeric or alphanumeric status codes stay fixed private anchors', () => {
  for (const suffix of [' Status 00.', ' Result AB01.', ' 00.']) {
    const seed = source.replace(' Available balance USD 900.00.', '');
    const next = second.replace(' Available balance USD 879.25.', '');
    const template = learn({ source: seed + suffix });
    const validation = P.validatePrivateAlertFormat(template, next + suffix, 'SAMPLEBANK', key, { now: NOW });
    assert.equal(validation.ok, true, validation.reason);
    const changed = suffix.replace('00', '01').replace('AB01', 'ZZ99');
    assert.equal(match(next + changed, validation.template).kind, 'none');
    assert.equal(JSON.stringify(template).includes('AB01'), false);
  }
  const withRef = learn({ source: source + ' Ref AB1234.' });
  assert.equal(P.matchPrivateAlertFormat(second + ' Ref ZZ6789.', 'SAMPLEBANK', store(withRef), key, { now: NOW }, withRef.id).kind, 'prefill');
});

test('source direction contradictions refuse instead of remembering the opposite human choice', () => {
  assert.equal(P.createPrivateAlertFormat(input({ confirmed: { ...confirmed, direction: 'credit' } }), key).ok, false);
  assert.equal(P.createPrivateAlertFormat(input({ source: source.replace('was charged', 'was credited'), confirmed }), key).ok, false);
});

test('dates and merchants from owner metadata, due fields, bank headings and support are not learned', () => {
  for (const [body, patch] of [
    ['Account opening date 2012-04-03. ' + source, { date: '2012-04-03' }],
    [source + ' For support visit on 2012-04-03.', { date: '2012-04-03' }],
    [source + ' Account holder name: John Smith.', { merchant: 'John Smith' }],
    [source + ' Call support: Service Team.', { merchant: 'Service Team' }],
    [source, { merchant: 'Sample Bank' }],
    [source, { merchant: 'card ending 1234' }],
  ]) assert.equal(P.createPrivateAlertFormat(input({ source: body, confirmed: { ...confirmed, ...patch } }), key).ok, false);
  assert.equal(P.createPrivateAlertFormat(input({ confirmed: { ...confirmed, date: '2026-09-09' } }), key).ok, false);
  assert.equal(P.createPrivateAlertFormat(input({ source: source.replace('2026-09-08', '08/09/26'), confirmed }), key).ok, false);
});

test('masked card and account digits remain eligible only beneath an explicit instrument label', () => {
  const body = source.replace('ending 1234', '****1234');
  const learned = learn({ source: body });
  const hit = P.matchPrivateAlertFormat(second.replace('ending 6789', '****6789'), 'SAMPLEBANK', store(learned), key, { now: NOW }, learned.id);
  assert.equal(hit.kind, 'prefill');
});

test('ambiguous symbols cannot be substituted into a formerly explicit currency slot', () => {
  const template = validated();
  assert.deepEqual(match(second.replace('USD 20.75', '$20.75'), template), { kind: 'none' });
});

test('a completed standalone bank fee can be taught while a secondary fee stays informational', () => {
  const body = 'Sample Bank: Service fee USD 2.50 was debited from account 1234 on 2026-09-08.';
  const result = P.createPrivateAlertFormat(input({ source: body, confirmed: { amountMinor: 250, currency: 'USD', exponent: 2, direction: 'debit', date: '2026-09-08' } }), key);
  assert.equal(result.ok, true, result.reason);
  const validation = P.validatePrivateAlertFormat(result.template, body.replace('USD 2.50', 'USD 3.00').replace('1234', '5678'), 'SAMPLEBANK', key, { now: NOW });
  assert.equal(validation.ok, true, validation.reason);
  assert.equal(validation.fields.amountMinor, 300);
});

test('a second completed or unresolved principal cannot be silently made a balance slot', () => {
  for (const suffix of [' Another card was charged USD 4.00.', ' A transfer of USD 4.00 completed.', ' Other money USD 4.00.']) {
    assert.equal(P.createPrivateAlertFormat(input({ source: source + suffix }), key).ok, false);
  }
});

test('sender truncation cannot cause two distinct source identifiers to share a format binding', () => {
  const prefix = 'BANK'.repeat(16);
  assert.equal(P.createPrivateAlertFormat(input({ sender: prefix + 'FIRST' }), key).ok, false);
  const draft = learn({ sender: prefix });
  const accepted = P.validatePrivateAlertFormat(draft, second, prefix, key, { now: NOW });
  assert.equal(accepted.ok, true, accepted.reason);
  assert.equal(P.matchPrivateAlertFormat(second, prefix + 'OTHER', store(accepted.template), key, { now: NOW }).kind, 'none');
});
