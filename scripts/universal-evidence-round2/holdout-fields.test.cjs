const assert = require('node:assert/strict');
const test = require('node:test');
const load = require('../universal-test/load-ts.cjs').createLoader();
const {extractUniversalFields}=load('@/lib/universal-fields');
const {inspectAlertDraft}=load('@/lib/alert-draft');
const cases=require('./holdout.json').parser;
const extract=body=>extractUniversalFields(body,{},inspectAlertDraft(body).candidates.map(x=>x.span));
// The first held-out measurement remains immutable. These cases are now exposed
// regression examples, not a second unseen evaluation or real-bank templates.
for(const item of cases.filter(x=>x.expected['merchant.value'])) test(`exposed synthetic holdout seller: ${item.id}`,()=>{
 const field=extract(item.body).merchant; assert.equal(field.value,item.expected['merchant.value']);
 assert.ok(field.spans.some(s=>item.body.slice(s.start,s.end)===field.value));
});
for(const item of cases.filter(x=>Object.hasOwn(x.expected,'dueDate.value'))) test(`exposed synthetic holdout date: ${item.id}`,()=>{
 assert.equal(extract(item.body).dueDate.value,item.expected['dueDate.value']);
});
for(const label of ['fällig am','支払期限','Date limite','अंतिम तिथि']) test(`synthetic date control: ${label}`,()=>{
 for(const token of ['2027-02-30','14/10','04/05/27']) assert.equal(extract(`${label}: ${token}`).dueDate.value,null);
 assert.equal(extract(`${label}: 04/05/2027`).dueDate.evidence,'ambiguous');
 assert.equal(extract(`${label}: 2027-05-04; ${label}: 2027-05-05`).dueDate.evidence,'ambiguous');
 assert.equal(extract(`${label}: 2027-05-04`).transactionDate.value,null);
});
for(const item of cases.filter(x=>x.expected['merchant.value'])) test(`synthetic transport-label variant: ${item.id}`,()=>{
 const body=item.body.replace(/^\[[^\]]+\]\s*/u,'');
 assert.equal(extract(body).merchant.value,item.expected['merchant.value']);
 assert.equal(extract('[NOTICE] '+body).merchant.value,item.expected['merchant.value']);
});
for(const body of [
 'Compra EUR 3 en su cuenta.',
 'Contactez le service reçu de SUPPORT CENTRE.',
 'Visit TULIP STORE işyerindeki promotions.',
 'नीलकमल पुस्तकालय से संपर्क करें।',
 'こもれび文具での購入についてお問い合わせください。',
 '青藤纸屋的消费说明。',
 'For help visit Nuvem de Cobre será cobrada.',
 'Arroyo Violeta pagada para información.',
 'فاتورة شركة البنك معلومات فقط.',
]) test(`synthetic unsupported prose does not fabricate seller: ${body}`,()=>assert.equal(extract(body).merchant.value,null));
for(const [template, name] of [
 ['Stromrechnung von NAME: EUR 3, fällig am 2027-05-04.', 'STROMRECHNUNG ENERGY'],
 ['Factura de agua de NAME pagada. EUR 3 cargado en su cuenta.', 'PAGADA WATER'],
 ['Assinatura da NAME será cobrada em 2027-05-04 por BRL 3.', 'SERA CAFE'],
 ['Mensalidade da NAME paga: BRL 3 debitados.', 'PAGA MUSIC'],
 ['Acquisto completato presso NAME per EUR 3.', 'PER CAFE'],
 ['NAME işyerindeki TRY 3 tutarındaki alışveriş tamamlandı.', 'ISYERINDEKI SHOP'],
 ['NAME alışverişiniz tamamlandı.', 'ALISVERIS MARKET'],
 ['NAME से INR 3 का रिफंड आपके खाते में जमा हो गया है।','कार्ड पुस्तकालय'],
 ['تم سداد فاتورة NAME بنجاح. تم خصم SAR 3.', 'شركة بنجاح'],
 ['NAMEでの購入が完了しました。JPY 3。','購入書店'],
 ['NAMEの電気料金の請求です。JPY 3。','電気料金社'],
 ['您在NAME的消费已完成，账户已扣款CNY 3。','在竹书店'],
 ['NAME的退款 $3 已到账。','退款工坊'],
]) test(`synthetic seller/grammar and bounded overlength control: ${name}`,()=>{
 const source=template.replace('NAME',name), field=extract(source).merchant;
 assert.equal(field.value,name); assert.ok(field.spans.some(s=>source.slice(s.start,s.end)===name));
 assert.equal(extract(template.replace('NAME','青'.repeat(110)+name)).merchant.value,null);
});
for(const name of ['MANGO PAGA','MANGO PAGADA','NUVEM será cobrada']) test(`synthetic supplier-tail control: ordinary seller ${name}`,()=>{
 assert.equal(extract(`Paid USD 3 at ${name}.`).merchant.value,name);
});
for(const body of [
 '未払いの電気料金の請求です。請求額JPY 6439。',
 '今回の電気料金の請求です。請求額JPY 6439。',
 '本次交易的退款 CNY 28.40 已到账。',
 '123456789的退款 $28.40 已到账。',
 '123456789での購入が完了しました。JPY 3。',
 'For help contact Stromrechnung von SUPPORT CENTRE.',
]) test(`synthetic independent-review non-supplier control: ${body}`,()=>assert.equal(extract(body).merchant.value,null));
for(const [body,seller] of [
 ['Factura de agua de Arroyo Violeta no pagada. Importe EUR 31,76.','Arroyo Violeta'],
 ['Mensalidade da Trilha Sonora Azul não paga: BRL 37,26.','Trilha Sonora Azul'],
 ['Factura de agua de Arroyo Violeta será pagada. Importe EUR 31,76.','Arroyo Violeta'],
 ['Factura de agua de Arroyo Violeta está pagada. Importe EUR 31,76.','Arroyo Violeta'],
 ['Mensalidade da Trilha Sonora Azul será paga: BRL 37,26.','Trilha Sonora Azul'],
 ['今回電力の電気料金の請求です。請求額JPY 6439。','今回電力'],
 ['未払い電力の電気料金の請求です。請求額JPY 6439。','未払い電力'],
 ['本次交易工坊的退款 CNY 28.40 已到账。','本次交易工坊'],
 ['Mensalidade da NÃO MUSIC paga: BRL 37,26.','NÃO MUSIC'],
 ['Factura de agua de NO WATER pagada. EUR 31,76 cargado.','NO WATER'],
]) test(`synthetic independent-review supplier preserves qualifiers outside spans: ${seller}`,()=>{
 const field=extract(body).merchant; assert.equal(field.value,seller);
 assert.ok(field.spans.some(s=>body.slice(s.start,s.end)===seller));
});
