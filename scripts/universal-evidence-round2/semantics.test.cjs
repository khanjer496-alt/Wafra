const assert = require('node:assert/strict');
const test = require('node:test');
const load = require('../universal-test/load-ts.cjs').createLoader();
const inspect = load('@/lib/universal-parser').inspectUniversalBankEvent;
const categorize = load('@/lib/universal-categorization').categorizeMerchant;
const corpus = require('../universal-evidence/independent-cases.json');
const publicCorpus = require('../universal-evidence/public-cases.json');
for (const item of [...corpus.parser, ...publicCorpus.parser]) test('source event semantics: ' + item.id, () => {
  const actual = inspect(item.body, item.context);
  assert.equal(actual.status, item.expected.status);
  if (item.expected.status === 'posted' && item.expected.direction) assert.equal(actual.direction, item.expected.direction);
});
for (const item of corpus.categorization) test('source merchant activity: ' + item.id, () => {
  const actual = categorize(item.input);
  assert.equal(actual.category, item.expected.category);
  assert.equal(actual.needsReview, item.expected.needsReview);
});
// Synthetic contrast fixtures: a request or authorization is not a completed debit.
for (const body of [
  'Transfer request received for USD 12.50. No payment has been made.',
  'Paiement par carte prévu : EUR 12,50 chez CAFE BLEU.',
  'Kartenzahlung angefragt: EUR 12,50 bei CAFE BLAU.',
  'Compra solicitada: EUR 12,50 en CAFE AZUL.',
  'Pedido de compra aprovado: BRL 12,50. O pagamento ainda está pendente.',
  'Pagamento con carta richiesto: EUR 12,50 presso CAFFE BLU.',
  'Kaartbetaling aangevraagd: EUR 12,50 bij CAFE BLAUW.',
  'TRY 12,50 tutarında alışveriş talebiniz alındı. Henüz ödeme yapılmadı.',
  'INR 12.50 के भुगतान का अनुरोध मिला। भुगतान अभी बाकी है।',
  'カード利用の承認待ちです。利用金額：JPY 1250。',
  '您的支付请求已提交，金额CNY 12.50，尚未扣款。',
]) test('request does not establish a posting: ' + body, () => assert.notEqual(inspect(body).status, 'posted'));
for (const merchant of ['KIRANA SOFTWARE', 'ECZANE RESTAURANT', 'THE PAYMENT RECEIVED CAFE']) {
  test('mixed activity or status words do not imply income: ' + merchant, () => {
    assert.equal(categorize({ merchant, type: 'income', meaning: 'unknown' }).category, 'other');
  });
}
for (const body of [
  'Aucun paiement effectué : EUR 12,50 chez CAFE BLEU.',
  'Pas de paiement par carte effectué : EUR 12,50 chez CAFE BLEU.',
  'No compra realizada con tarjeta: EUR 12,50 en CAFE AZUL.',
  'Nessun pagamento con carta eseguito: EUR 12,50 presso CAFFE BLU.',
  'Geen kaartbetaling voltooid: EUR 12,50 bij CAFE BLAUW.',
  'Kein Kartenzahlung erfolgreich: EUR 12,50 bei CAFE BLAU.',
  'Keine Kartenzahlung erfolgreich: EUR 12,50 bei CAFE BLAU.',
  'USD 12.50 was not sent to CAFE BLUE.',
  'USD 12.50 will be sent to CAFE BLUE.',
  '如果消费成功，金额CNY 12.50。',
  '退款到账失败通知：青竹文具店退回CNY 25.80。',
  'カード利用が完了しましたか？利用金額：JPY 1250。',
  'भुगतान सफल हुआ नहीं: INR 12.50।',
  'Aucun remboursement reçu de CAFE : EUR 12,50.',
  'No reembolso recibido de CAFE : EUR 12,50.',
  '退款到账尚未完成，金额CNY 25.80。',
  'Remboursement non reçu de CAFE : EUR 12,50.',
]) test('qualified completion cannot be mistaken for an actual posting: ' + body, () => {
  const event = inspect(body);
  assert.notEqual(event.status, 'posted');
  assert.notEqual(event.status, 'unknown');
});
test('an unrelated later request does not replace a proven purchase', () => {
  assert.equal(inspect('Payment completed USD 12.50 at SHOP. Transfer request received for a separate transfer.').status, 'posted');
});
for (const body of [
  'Purchase USD 12.50 at TRANSFER REQUEST RECEIVED CAFE.',
  'Paiement effectué EUR 12,50 chez PAYMENT REQUEST ACCEPTED CAFE.',
  'Refund received USD 12.50 from PAYMENT REQUEST APPROVED SHOP.',
]) test('request wording within a seller does not veto a posting: ' + body, () => {
  assert.equal(inspect(body).status, 'posted');
});
for (const body of [
  'Remboursement reçu de CAFE : EUR 12,50, débité sur votre carte.',
  'Paiement effectué EUR 12,50 chez CAFE, crédité sur votre carte.',
]) test('opposing direction verbs cannot be filled from a completion guess: ' + body, () => {
  assert.equal(inspect(body).direction, 'unknown');
});
