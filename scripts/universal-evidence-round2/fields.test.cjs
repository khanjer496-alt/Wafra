const assert = require('node:assert/strict');
const test = require('node:test');
const { createLoader } = require('../universal-test/load-ts.cjs');
const load = createLoader();
const { extractUniversalFields } = load('@/lib/universal-fields');
const { inspectAlertDraft } = load('@/lib/alert-draft');
const frozen = [...require('../universal-evidence/independent-cases.json').parser, ...require('../universal-evidence/public-cases.json').parser];
const extract = (body, context = {}) => extractUniversalFields(body, context, inspectAlertDraft(body, context).candidates.map(x => x.span));
// Exact, frozen round-one source examples; synthetic cases are not bank-coverage evidence.
for (const item of frozen.filter(x => x.expected['merchant.value'])) {
  test(`${item.kind}: merchant ${item.id}`, () => {
    const field = extract(item.body, item.context).merchant;
    assert.equal(field.value, item.expected['merchant.value'].replace(/\.$/u, ''));
    assert.equal(field.evidence, 'explicit');
    // Published CommBank punctuation is normalized by the existing seller contract.
    assert.ok(field.spans.some(span => item.body.slice(span.start, span.end) === field.value));
  });
}
for (const item of frozen.filter(x => x.expected['dueDate.value'])) {
  test(`${item.kind}: deadline ${item.id}`, () => {
    const field = extract(item.body, item.context).dueDate;
    assert.equal(field.value, item.expected['dueDate.value']);
    assert.equal(field.evidence, 'explicit');
  });
}
for (const [id, expected] of [
  ['ind-tr-tr-purchase','2026-08-30'], ['ind-tr-tr-decline','2026-08-31'],
  ['ind-hi-in-purchase','2026-08-14'], ['ind-hi-in-refund','2026-08-15'],
  ['ind-ja-jp-purchase','2026-08-18'], ['ind-ja-jp-decline','2026-08-19'],
  ['ind-zh-cn-purchase','2026-08-20'], ['ind-zh-cn-refund','2026-08-21'],
  ['ind-pt-br-purchase','2026-08-26'], ['ind-de-at-decline','2026-08-22'],
]) test(`synthetic-independent: transaction date ${id}`, () => assert.equal(extract(frozen.find(x=>x.id===id).body).transactionDate.value, expected));
// Derived controls below change no bank-template coverage claim.
for (const label of ['Date limite de paiement', 'Fecha límite de pago', 'scadenza', 'भुगतान की अंतिम तिथि', 'تاريخ استحقاق الدفع']) {
  test(`synthetic-control: ${label} keeps malformed/conflicting/order uncertainty`, () => {
    const invalid = extract(`${label}: 2026-02-30`).dueDate;
    assert.equal(invalid.value, null); assert.ok(invalid.issues.includes('invalid-date'));
    const conflict = extract(`${label}: 2026-09-15; ${label}: 2026-09-16`).dueDate;
    assert.equal(conflict.evidence, 'ambiguous'); assert.equal(conflict.value, null);
    assert.equal(extract(`${label}: 09/10/2026`).dueDate.evidence, 'ambiguous');
    assert.equal(extract(`${label}: 15/09/26`).dueDate.value, null);
    assert.equal(extract(`${label}: 2026-09-15`).transactionDate.value, null);
  });
}
for (const [body, seller] of [
  ['Kartenzahlung EUR 3 bei ABGELEHNT CAFE am 2026-08-21.', 'ABGELEHNT CAFE'],
  ['Betaling EUR 3 bij GEWEIGERD CAFE op 2026-08-21.', 'GEWEIGERD CAFE'],
  ['Refund received USD 3 from TO CARD CAFE to card ending 7214.', 'TO CARD CAFE'],
  ['Paid THB 3 by card no. x-1234 @ NEW BALANCE 15:15 Balance THB 100.', 'NEW BALANCE'],
]) test(`synthetic-control: seller retains meaningful words ${seller}`,()=>assert.equal(extract(body).merchant.value,seller));
for (const body of [
  'Contact us @ COMPANY NAME 15:15.',
  'Remboursement reçu sur votre carte CHF 3. Contactez le service de SUPPORT CENTRE.',
  'Visit MAVI YAPRAK MARKET işyerinde for offers.',
  'नील कमल किराना पर जाएं।',
  '您的银行卡在青竹书店附近。',
  '利用先の変更はサポートへ。',
]) test(`synthetic-control: instruction is not a merchant ${body}`,()=>assert.equal(extract(body).merchant.value,null));
for (const body of ['Reference: 2026-08-30 tarihinde', 'Reference: 2026-08-14 को', 'Reference: 2026-08-20在青竹书店', '利用先：青葉2026-08-18書店。']) {
  test(`synthetic-control: identifiers are not new-language dates ${body}`,()=>assert.equal(extract(body).transactionDate.value,null));
}
for (const body of ['Purchase JPY 2480。 From BANK SUPPORT', 'Purchase INR 2480। From BANK SUPPORT']) {
  test(`synthetic-review-control: Unicode sentence separates issuer footer ${body}`, () => assert.equal(extract(body).merchant.value, null));
}
for (const stop of ['.', '。', '।']) {
  test(`synthetic-review-control: KBank time followed by sentence stop ${stop}`, () => assert.equal(extract(`Paid THB 3 @ MANGO 15:15${stop} New balance THB 500`).merchant.value, 'MANGO'));
}
test('synthetic-review-control: overlong Chinese seller cannot restart at an internal 在', () => {
  const source = '您的银行卡在' + '青'.repeat(100) + '在竹书店消费成功，金额CNY 68.50。';
  assert.equal(extract(source).merchant.value, null);
});
for (const [body, seller, expectedStart] of [
  ['2026-08-30 tarihinde 4827 ile biten kartınızla tarihinde işyerinde TRY 325,50.', 'tarihinde', '2026-08-30 tarihinde 4827 ile biten kartınızla '.length],
  ['2026-08-14 को कार्ड 5728 से कार्ड पर INR 845.50 का भुगतान सफल हुआ।', 'कार्ड', '2026-08-14 को कार्ड 5728 से '.length],
]) test(`synthetic-review-control: repeated grammar preserves actual capture span ${seller}`, () => {
  const field = extract(body).merchant;
  assert.equal(field.value, seller);
  assert.deepEqual(field.spans, [{ start: expectedStart, end: expectedStart + seller.length }]);
});
