'use strict';
/**
 * Phase-2 phrase lexicon for the compositional alert generator (generate-v2.cjs).
 *
 * Per language: clause patterns per event with inline alternatives
 *   {V:a|b|c}  a cue verb/noun of the event's polarity (debit <d>, credit <c>, non-posting <n>)
 *   {A:a|b}    a plain alternative (no cue markup)
 * plus slots ({AMT} {MER} …, see templates.cjs). Field labels, event type nouns
 * (with cue polarity) and DR/CR abbreviations feed the field-list, pipe,
 * key=value, terse and push-notification "authors".
 *
 * Every phrase is written for this benchmark; none copies a bank's exact text.
 */

const L = {};

L.en = {
  on: 'on {DATE}', bal: ['Avl Bal {BAL}', 'Available balance: {BAL}', 'Bal {BAL}', 'Avl Lmt {LIMIT}', 'Available credit limit {LIMIT}'],
  labels: { amount: ['Amount', 'Amt', 'Txn Amt'], merchant: ['Merchant', 'At', 'Payee'], date: ['Date', 'Txn Date', 'On'], card: ['Card', 'Card No'], account: ['Account', 'A/c'], type: ['Type', 'Txn'], from: ['From', 'Sender'], to: ['To', 'Beneficiary'], balance: ['Avl Bal', 'Balance'], limit: ['Avl Limit', 'Credit limit'], status: ['Status'], ok: ['Successful', 'Completed', 'Approved'] },
  dr: ['DR', 'Dr', 'DEBIT'], cr: ['CR', 'Cr', 'CREDIT'],
  greet: ['Dear Customer,', 'Hi,', 'Dear Client,'],
  ev: {
    purchase: { noun: ['{V:Purchase}', '{V:POS purchase}', '{V:Card spend}'], p: [
      'your card ending {CARD} was {V:charged|debited|used} {AMT} at {MER}',
      'you {V:spent|paid} {AMT} at {MER} with card *{CARD}',
      '{AMT} {V:debited|charged} for a {A:purchase|payment} at {MER}',
      'a {V:purchase} of {AMT} was made at {MER} using your {A:debit|credit} card {CARD}',
      '{V:purchase} {AMT} at {MER} on card XX{CARD}'] },
    refund: { noun: ['{V:Refund}', '{V:Refund credited}', '{V:Merchant refund}'], p: [
      'a {V:refund} of {AMT} from {MER} has been {A:credited|added} to your card {CARD}',
      '{AMT} {V:refunded|credited back} by {MER} to your account {ACCT}',
      '{MER} {V:refunded} you {AMT}',
      'you {V:received} a refund of {AMT} from {MER}'] },
    transfer_out: { noun: ['{V:Transfer sent}', '{V:Outgoing transfer}', '{V:Funds transfer DR}'], p: [
      '{AMT} {V:transferred|sent} from your account {ACCT} to {NAME}',
      'you {V:sent} {AMT} to {NAME} via {RAIL}',
      'your account {ACCT} was {V:debited} {AMT} for a transfer to {NAME}',
      'transfer of {AMT} to {NAME} {V:debited} from A/c {ACCT}'] },
    transfer_in: { noun: ['{V:Transfer received}', '{V:Incoming transfer}', '{V:Funds received}'], p: [
      '{AMT} {V:received|credited} from {NAME} to your account {ACCT}',
      'you have {V:received} {AMT} from {NAME} via {RAIL}',
      'your account {ACCT} has been {V:credited} with {AMT} by {NAME}',
      '{NAME} {V:sent you} {AMT}'] },
    salary: { noun: ['{V:Salary credit}', '{V:Payroll deposit}', '{V:Salary received}'], p: [
      'your salary of {AMT} has been {V:credited} to account {ACCT}',
      '{V:payroll deposit} of {AMT} from {EMPLOYER} {A:received|posted}',
      'account {ACCT} {V:credited} with {AMT} towards salary from {EMPLOYER}',
      '{EMPLOYER} {V:deposited} your salary {AMT}'] },
    fee: { noun: ['{V:Fee charged}', '{V:Service charge}', '{V:Fee debit}'], p: [
      'a {A:monthly|annual|service} fee of {AMT} was {V:charged|debited} to your account {ACCT}',
      '{AMT} {V:deducted} as {A:SMS|maintenance|card} charges from A/c {ACCT}',
      'annual card fee {AMT} {V:debited} to card XX{CARD}'] },
    withdrawal: { noun: ['{V:ATM withdrawal}', '{V:Cash withdrawal}', '{V:ATM WDL}'], p: [
      '{AMT} {V:withdrawn} at {ATM} using card XX{CARD}',
      'ATM {V:cash withdrawal} of {AMT} from account {ACCT} at {ATM}',
      'you {V:withdrew} {AMT} cash at {ATM}'] },
    card_payment: { noun: ['{V:Card payment received}', '{V:Payment received}'], p: [
      'we have {V:received} your credit card payment of {AMT} for card XX{CARD}',
      'payment of {AMT} {V:received} towards your card ending {CARD}. Thank you'] },
    bill_payment: { noun: ['{V:Bill paid}', '{V:Bill payment}'], p: [
      'bill payment of {AMT} to {BILLER} was {V:successful|completed}',
      '{AMT} {V:paid} to {BILLER} from A/c XX{ACCT}',
      'your {BILLER} bill of {AMT} has been {V:paid}'] },
    otp: { noun: ['OTP', 'Verification code'], p: [
      '{OTP} is your OTP for a {A:transaction|purchase} of {AMT} at {MER}. Do not share it',
      'use code {OTP} to approve your payment of {AMT} to {MER}'] },
    pending: { noun: ['{V:Pending}', '{V:Authorisation hold}'], p: [
      'a {V:pending} transaction of {AMT} at {MER} is awaiting settlement',
      '{V:authorisation hold} of {AMT} placed by {MER} on card *{CARD}'] },
    declined: { noun: ['{V:Declined}', '{V:Failed}'], p: [
      'your card ending {CARD} was {V:declined} for {AMT} at {MER}',
      'transaction of {AMT} at {MER} {V:failed}. No amount was debited'] },
    promo: { noun: ['Offer', 'Promo'], p: [
      'spend {AMT} or more at {MER} and get 10% cashback',
      'pre-approved loan up to {AMT}. Apply now'] },
    balance: { noun: ['Balance'], p: [
      'available balance in account {ACCT} is {BAL}',
      'your balance is {BAL}. No new transactions'] },
    statement: { noun: ['Statement'], p: [
      'statement for card XX{CARD} is ready. Total due {BAL}, minimum due {BAL2}, due by {DATE}',
      'minimum payment of {BAL} is due on {DATE}'] },
    request: { noun: ['{V:Request}'], p: [
      '{NAME} has {V:requested} {AMT} from you via {RAIL}',
      'collect {V:request} of {AMT} from {NAME} awaiting your approval'] },
    future: { noun: ['{V:Scheduled}'], p: [
      'your payment of {AMT} to {BILLER} {V:will be debited} on {DATE}',
      'auto-debit of {AMT} for {BILLER} is {V:scheduled} for {DATE}'] },
    limit: { noun: ['Limit update'], p: [
      'your credit limit has been increased to {LIMIT}',
      'available limit on card XX{CARD} is {LIMIT}'] },
  },
};

L.ar = {
  on: 'بتاريخ {DATE}', bal: ['الرصيد المتاح {BAL}', 'رصيدك {BAL}', 'الحد المتاح {LIMIT}', 'Avl Bal {BAL}'],
  labels: { amount: ['المبلغ', 'مبلغ'], merchant: ['لدى', 'التاجر', 'المستفيد'], date: ['التاريخ', 'في'], card: ['البطاقة', 'بطاقة'], account: ['الحساب', 'حساب'], type: ['نوع العملية', 'العملية'], from: ['من', 'المرسل'], to: ['إلى', 'المستفيد'], balance: ['الرصيد', 'الرصيد المتاح'], limit: ['الحد المتاح'], status: ['الحالة'], ok: ['ناجحة', 'تمت'] },
  dr: ['مدين', 'خصم'], cr: ['دائن', 'إيداع'],
  greet: ['عزيزي العميل،', 'عميلنا العزيز،'],
  ev: {
    purchase: { noun: ['{V:شراء}', '{V:عملية شراء}', '{V:شراء عبر نقاط البيع}'], p: [
      'تمت عملية {V:شراء} بقيمة {AMT} لدى {MER} ببطاقتك المنتهية {CARD}',
      'تم {V:خصم} {AMT} من حسابك {ACCT} لعملية شراء لدى {MER}',
      '{V:شراء} بمبلغ {AMT} من {MER} بالبطاقة {CARD}',
      'عملية {V:شراء} {AMT} {MER}',
      'تم {V:استخدام} بطاقتك {CARD} لدفع {AMT} لدى {MER}'] },
    refund: { noun: ['{V:استرداد}', '{V:مبلغ مسترد}'], p: [
      'تم {V:إيداع} مبلغ مسترد {AMT} من {MER} في بطاقتك {CARD}',
      '{V:استرداد} مبلغ {AMT} من {MER} إلى حسابك {ACCT}',
      'تم {V:استرجاع} {AMT} من {MER}'] },
    transfer_out: { noun: ['{V:حوالة صادرة}', '{V:تحويل صادر}'], p: [
      'تم {V:تحويل} {AMT} من حسابك {ACCT} إلى {NAME}',
      '{V:حوالة صادرة}: تم خصم {AMT} لصالح {NAME}',
      'تم {V:خصم} {AMT} من حسابك {ACCT} لتحويل إلى {NAME}'] },
    transfer_in: { noun: ['{V:حوالة واردة}', '{V:تحويل وارد}'], p: [
      'تم {V:إيداع} حوالة واردة بمبلغ {AMT} في حسابك {ACCT} من {NAME}',
      '{V:حوالة واردة}: {V:أضيف} {AMT} إلى حسابك من {NAME}',
      'استلمت {AMT} من {NAME}، تم {V:الإيداع} في حسابك'] },
    salary: { noun: ['{V:إيداع راتب}', '{V:راتب}'], p: [
      'تم {V:إيداع} الراتب {AMT} في حسابك {ACCT}',
      '{V:إيداع راتب} {AMT} من {EMPLOYER}',
      '{V:أضيف} راتبك بمبلغ {AMT} إلى حسابك'] },
    fee: { noun: ['{V:رسوم}', '{V:خصم رسوم}'], p: [
      'تم {V:خصم} رسوم بقيمة {AMT} من حسابك {ACCT}',
      'رسوم سنوية {AMT} {V:خصمت} من البطاقة {CARD}'] },
    withdrawal: { noun: ['{V:سحب نقدي}', '{V:سحب من الصراف}'], p: [
      'تم {V:سحب} مبلغ {AMT} نقداً من الصراف {ATM}',
      '{V:سحب نقدي} {AMT} من حسابك {ACCT} عبر {ATM}'] },
    card_payment: { noun: ['{V:استلام دفعة}'], p: [
      'تم {V:استلام} دفعة {AMT} لبطاقتك الائتمانية {CARD}. شكراً',
      '{V:استلمنا} سدادك {AMT} لبطاقة {CARD}'] },
    bill_payment: { noun: ['{V:سداد فاتورة}', '{V:دفع فاتورة}'], p: [
      'تم {V:سداد} فاتورة {BILLER} بمبلغ {AMT} من حسابك {ACCT}',
      '{V:دفع فاتورة} {BILLER} بقيمة {AMT} تم بنجاح'] },
    otp: { noun: ['رمز التحقق'], p: [
      'رمز التحقق {OTP} لعملية شراء بقيمة {AMT} لدى {MER}. لا تشارك الرمز',
      'كلمة المرور لمرة واحدة {OTP} لتأكيد دفع {AMT}'] },
    pending: { noun: ['{V:قيد المعالجة}', '{V:معلقة}'], p: [
      'عملية بمبلغ {AMT} لدى {MER} {V:قيد المعالجة}',
      'تم {V:حجز} مبلغ {AMT} مؤقتاً لدى {MER}'] },
    declined: { noun: ['{V:مرفوضة}'], p: [
      'تم {V:رفض} عملية بقيمة {AMT} لدى {MER} لعدم كفاية الرصيد',
      '{V:فشلت} عملية التحويل بمبلغ {AMT} إلى {NAME}'] },
    promo: { noun: ['عرض'], p: [
      'احصل على استرداد نقدي 10% عند الإنفاق {AMT} لدى {MER}',
      'تمويل شخصي حتى {AMT}. قدم الآن'] },
    balance: { noun: ['رصيد'], p: [
      'رصيد حسابك {ACCT} المتاح هو {BAL}',
      'رصيدك الحالي {BAL}'] },
    statement: { noun: ['كشف حساب'], p: [
      'كشف بطاقتك {CARD} جاهز. المبلغ المستحق {BAL} والحد الأدنى {BAL2} قبل {DATE}',
      'الحد الأدنى المستحق {BAL} بتاريخ {DATE}'] },
    request: { noun: ['{V:طلب دفع}'], p: [
      '{NAME} {V:طلب} منك {AMT}. بانتظار موافقتك',
      '{V:طلب تحويل} بمبلغ {AMT} من {NAME}'] },
    future: { noun: ['{V:مجدولة}'], p: [
      '{V:سيتم خصم} {AMT} لصالح {BILLER} بتاريخ {DATE}',
      'دفعة {V:مجدولة} {AMT} إلى {BILLER} في {DATE}'] },
    limit: { noun: ['الحد الائتماني'], p: [
      'تم رفع الحد الائتماني لبطاقتك إلى {LIMIT}',
      'الحد المتاح لبطاقتك {CARD} هو {LIMIT}'] },
  },
};

L.es = {
  on: 'el {DATE}', bal: ['Saldo disponible {BAL}', 'Saldo: {BAL}', 'Límite disponible {LIMIT}'],
  labels: { amount: ['Importe', 'Monto'], merchant: ['Comercio', 'En'], date: ['Fecha'], card: ['Tarjeta'], account: ['Cuenta'], type: ['Operación', 'Tipo'], from: ['De', 'Ordenante'], to: ['Para', 'Beneficiario'], balance: ['Saldo'], limit: ['Límite disponible'], status: ['Estado'], ok: ['Aprobada', 'Realizada'] },
  dr: ['CARGO', 'Cargo'], cr: ['ABONO', 'Abono'],
  greet: ['Estimado cliente:', 'Hola,'],
  ev: {
    purchase: { noun: ['{V:Compra}', '{V:Compra con tarjeta}', '{V:Cargo}'], p: [
      '{V:compra} aprobada por {AMT} en {MER} con tu tarjeta *{CARD}',
      'se realizó un {V:cargo} de {AMT} en {MER} a tu tarjeta {CARD}',
      '{V:pagaste} {AMT} en {MER}',
      'tu tarjeta {CARD} fue {V:cargada} con {AMT} en {MER}'] },
    refund: { noun: ['{V:Devolución}', '{V:Reembolso}', '{V:Abono}'], p: [
      '{V:devolución} de {AMT} de {MER} {A:abonada|aplicada} a tu tarjeta {CARD}',
      'te hemos {V:abonado} {AMT} por un reembolso de {MER}',
      '{MER} te {V:reembolsó} {AMT}'] },
    transfer_out: { noun: ['{V:Transferencia enviada}', '{V:Transferencia realizada}'], p: [
      'has {V:enviado} {AMT} a {NAME} por {RAIL}',
      'transferencia {V:realizada}: {AMT} a {NAME}',
      'se {V:cargaron} {AMT} en tu cuenta {ACCT} por transferencia a {NAME}'] },
    transfer_in: { noun: ['{V:Transferencia recibida}', '{V:Abono por transferencia}'], p: [
      'has {V:recibido} {AMT} de {NAME}',
      '{V:abono} por transferencia de {NAME} por {AMT} en tu cuenta {ACCT}',
      '{NAME} te {V:envió} {AMT} por {RAIL}'] },
    salary: { noun: ['{V:Abono de nómina}', '{V:Depósito de nómina}'], p: [
      'tu nómina de {AMT} ha sido {V:abonada} en tu cuenta {ACCT}',
      '{V:depósito} de nómina {EMPLOYER} por {AMT}',
      '{EMPLOYER} te {V:depositó} {AMT}'] },
    fee: { noun: ['{V:Comisión cobrada}', '{V:Cargo por comisión}'], p: [
      'se ha {V:cobrado} una comisión de {AMT} en tu cuenta {ACCT}',
      'cuota anual {AMT} {V:cargada} a la tarjeta *{CARD}'] },
    withdrawal: { noun: ['{V:Retiro en cajero}', '{V:Retiro de efectivo}'], p: [
      '{V:retiro} de {AMT} en cajero {ATM} con tarjeta *{CARD}',
      'has {V:retirado} {AMT} en efectivo en {ATM}'] },
    card_payment: { noun: ['{V:Pago recibido}'], p: [
      'hemos {V:recibido} tu pago de {AMT} a tu tarjeta de crédito {CARD}',
      'tu pago de {AMT} a la tarjeta {CARD} fue {V:recibido}'] },
    bill_payment: { noun: ['{V:Pago de servicio}', '{V:Recibo pagado}'], p: [
      'pago de {BILLER} por {AMT} {V:realizado} con éxito',
      'se {V:pagó} tu recibo de {BILLER} por {AMT} desde tu cuenta {ACCT}'] },
    otp: { noun: ['Código'], p: [
      'tu código de verificación es {OTP} para la compra de {AMT} en {MER}. No lo compartas',
      'clave {OTP} para autorizar la transferencia de {AMT}'] },
    pending: { noun: ['{V:Pendiente}'], p: [
      'tu compra de {AMT} en {MER} está {V:pendiente}',
      'transferencia de {AMT} a {NAME} {V:en proceso}'] },
    declined: { noun: ['{V:Rechazada}'], p: [
      'tu compra de {AMT} en {MER} fue {V:rechazada}',
      'operación {V:no autorizada}: {AMT} en {MER}'] },
    promo: { noun: ['Promoción'], p: [
      'gana 15% de reembolso en {MER} por compras mayores a {AMT}',
      'préstamo preaprobado hasta {AMT}'] },
    balance: { noun: ['Saldo'], p: ['el saldo disponible de tu cuenta {ACCT} es {BAL}', 'tu saldo es {BAL}'] },
    statement: { noun: ['Estado de cuenta'], p: ['tu estado de cuenta está listo. Pago mínimo {BAL}, fecha límite {DATE}', 'saldo a pagar {BAL} antes del {DATE}'] },
    request: { noun: ['{V:Solicitud}'], p: ['{NAME} te ha {V:solicitado} {AMT}', '{V:solicitud} de pago de {AMT} de {NAME}'] },
    future: { noun: ['{V:Programado}'], p: ['el cargo de {AMT} de {BILLER} se {V:realizará} el {DATE}', 'pago {V:programado} de {AMT} a {BILLER} el {DATE}'] },
    limit: { noun: ['Límite'], p: ['tu límite de crédito aumentó a {LIMIT}', 'límite disponible en tu tarjeta {CARD}: {LIMIT}'] },
  },
};

L.pt = {
  on: 'em {DATE}', bal: ['Saldo disponível {BAL}', 'Saldo: {BAL}', 'Limite disponível {LIMIT}'],
  labels: { amount: ['Valor'], merchant: ['Estabelecimento', 'Local'], date: ['Data'], card: ['Cartão'], account: ['Conta'], type: ['Tipo', 'Operação'], from: ['De', 'Pagador'], to: ['Para', 'Favorecido'], balance: ['Saldo'], limit: ['Limite disponível'], status: ['Status'], ok: ['Aprovada', 'Concluída'] },
  dr: ['DÉBITO', 'Débito'], cr: ['CRÉDITO', 'Crédito'],
  greet: ['Olá,', 'Prezado cliente,'],
  ev: {
    purchase: { noun: ['{V:Compra aprovada}', '{V:Compra no débito}', '{V:Compra no crédito}'], p: [
      '{V:compra} aprovada no cartão final {CARD}: {AMT} em {MER}',
      'você {V:gastou} {AMT} em {MER} com o cartão {CARD}',
      '{AMT} {V:debitado} em {MER}',
      '{V:pagamento} de {AMT} em {MER} aprovado'] },
    refund: { noun: ['{V:Estorno}', '{V:Reembolso}'], p: [
      '{V:estorno} de {AMT} referente a {MER} {A:creditado|lançado} no cartão {CARD}',
      'você {V:recebeu} um reembolso de {AMT} de {MER}',
      '{AMT} {V:creditado} na sua conta: estorno {MER}'] },
    transfer_out: { noun: ['{V:Pix enviado}', '{V:Transferência enviada}'], p: [
      'Pix {V:enviado}: {AMT} para {NAME}',
      'transferência de {AMT} {V:realizada} para {NAME}',
      'você {V:enviou} {AMT} para {NAME} via {RAIL}'] },
    transfer_in: { noun: ['{V:Pix recebido}', '{V:Transferência recebida}'], p: [
      'Pix {V:recebido}: {AMT} de {NAME}',
      'você {V:recebeu} uma transferência de {AMT} de {NAME}',
      '{AMT} {V:creditado} na conta {ACCT}, enviado por {NAME}'] },
    salary: { noun: ['{V:Crédito de salário}', '{V:Salário recebido}'], p: [
      'salário de {AMT} {V:creditado} na sua conta {ACCT}',
      '{V:crédito} de salário {EMPLOYER}: {AMT}',
      'você {V:recebeu} seu salário de {AMT}'] },
    fee: { noun: ['{V:Tarifa cobrada}'], p: [
      'tarifa de {AMT} {V:debitada} da sua conta',
      'anuidade {AMT} {V:cobrada} no cartão {CARD}'] },
    withdrawal: { noun: ['{V:Saque}'], p: [
      '{V:saque} de {AMT} realizado no caixa {ATM}',
      'você {V:sacou} {AMT} com o cartão {CARD}'] },
    card_payment: { noun: ['{V:Pagamento de fatura recebido}'], p: [
      '{V:recebemos} o pagamento de {AMT} da fatura do cartão {CARD}',
      'pagamento da fatura de {AMT} {V:recebido}'] },
    bill_payment: { noun: ['{V:Boleto pago}', '{V:Conta paga}'], p: [
      'pagamento de boleto {BILLER} de {AMT} {V:efetuado}',
      'conta de {BILLER} {V:paga}: {AMT}'] },
    otp: { noun: ['Código'], p: ['seu código de segurança é {OTP} para a compra de {AMT} em {MER}. Não compartilhe', 'código {OTP} para confirmar Pix de {AMT}'] },
    pending: { noun: ['{V:Em processamento}'], p: ['compra de {AMT} em {MER} {V:em processamento}', 'Pix de {AMT} para {NAME} {V:em análise}'] },
    declined: { noun: ['{V:Recusada}'], p: ['compra de {AMT} em {MER} {V:recusada}', 'transação {V:não aprovada}: {AMT} em {MER}'] },
    promo: { noun: ['Oferta'], p: ['ganhe 10% de cashback em compras acima de {AMT} na {MER}', 'empréstimo pré-aprovado de até {AMT}'] },
    balance: { noun: ['Saldo'], p: ['saldo disponível na conta {ACCT}: {BAL}', 'seu saldo é {BAL}'] },
    statement: { noun: ['Fatura'], p: ['sua fatura fechou: total {BAL}, vencimento {DATE}', 'pagamento mínimo {BAL} até {DATE}'] },
    request: { noun: ['{V:Cobrança}'], p: ['{NAME} te enviou uma {V:cobrança} Pix de {AMT}', '{V:pedido} de pagamento de {AMT} de {NAME}'] },
    future: { noun: ['{V:Agendado}'], p: ['Pix {V:agendado}: {AMT} para {NAME} em {DATE}', 'débito automático de {AMT} {V:agendado} para {DATE}'] },
    limit: { noun: ['Limite'], p: ['seu limite aumentou para {LIMIT}', 'limite disponível no cartão {CARD}: {LIMIT}'] },
  },
};

L.fr = {
  on: 'le {DATE}', bal: ['Solde disponible : {BAL}', 'Solde {BAL}', 'Plafond disponible {LIMIT}'],
  labels: { amount: ['Montant'], merchant: ['Commerçant', 'Chez'], date: ['Date'], card: ['Carte'], account: ['Compte'], type: ['Opération', 'Type'], from: ['De', 'Émetteur'], to: ['Vers', 'Bénéficiaire'], balance: ['Solde'], limit: ['Plafond disponible'], status: ['Statut'], ok: ['Effectuée', 'Validée'] },
  dr: ['DÉBIT', 'Débit'], cr: ['CRÉDIT', 'Crédit'],
  greet: ['Bonjour,', 'Cher client,'],
  ev: {
    purchase: { noun: ['{V:Paiement carte}', '{V:Achat}', '{V:Débit carte}'], p: [
      '{V:paiement} par carte de {AMT} chez {MER}',
      'achat de {AMT} chez {MER} {V:débité} sur votre carte {CARD}',
      'votre carte {CARD} a été {V:débitée} de {AMT} chez {MER}',
      'vous avez {V:payé} {AMT} chez {MER}'] },
    refund: { noun: ['{V:Remboursement}', '{V:Avoir}'], p: [
      '{V:remboursement} de {AMT} de {MER} {A:crédité|reçu} sur votre carte {CARD}',
      'un avoir de {AMT} de {MER} a été {V:crédité} sur votre compte',
      '{MER} vous a {V:remboursé} {AMT}'] },
    transfer_out: { noun: ['{V:Virement émis}', '{V:Virement envoyé}'], p: [
      'virement de {AMT} {V:émis} vers {NAME}',
      'votre virement de {AMT} à {NAME} a été {V:débité}',
      'vous avez {V:envoyé} {AMT} à {NAME} via {RAIL}'] },
    transfer_in: { noun: ['{V:Virement reçu}'], p: [
      'virement {V:reçu} de {NAME} : {AMT}',
      'vous avez {V:reçu} {AMT} de {NAME}',
      '{AMT} {V:crédité} sur votre compte {ACCT} de la part de {NAME}'] },
    salary: { noun: ['{V:Salaire crédité}', '{V:Virement salaire reçu}'], p: [
      'votre salaire de {AMT} a été {V:crédité} sur votre compte',
      'virement {V:reçu} de {EMPLOYER} (salaire) : {AMT}'] },
    fee: { noun: ['{V:Frais prélevés}'], p: [
      'frais de tenue de compte de {AMT} {V:prélevés}',
      'cotisation carte {AMT} {V:débitée} sur votre compte {ACCT}'] },
    withdrawal: { noun: ['{V:Retrait DAB}', '{V:Retrait espèces}'], p: [
      '{V:retrait} de {AMT} au distributeur {ATM}',
      'retrait d’espèces de {AMT} {V:débité} avec votre carte {CARD}'] },
    card_payment: { noun: ['{V:Remboursement carte reçu}'], p: [
      'nous avons {V:reçu} votre paiement de {AMT} sur votre carte de crédit {CARD}',
      'paiement de {AMT} {V:reçu} pour votre carte {CARD}, merci'] },
    bill_payment: { noun: ['{V:Facture payée}', '{V:Prélèvement}'], p: [
      'prélèvement {BILLER} de {AMT} {V:débité}',
      'votre facture {BILLER} de {AMT} a été {V:payée}'] },
    otp: { noun: ['Code'], p: ['votre code de sécurité est {OTP} pour valider un paiement de {AMT} chez {MER}', 'code {OTP} pour confirmer le virement de {AMT}. Ne le communiquez jamais'] },
    pending: { noun: ['{V:En attente}'], p: ['paiement de {AMT} chez {MER} {V:en attente}', 'virement de {AMT} vers {NAME} {V:en cours de traitement}'] },
    declined: { noun: ['{V:Refusé}'], p: ['paiement de {AMT} chez {MER} {V:refusé}', 'votre virement de {AMT} a {V:échoué}'] },
    promo: { noun: ['Offre'], p: ['5% remboursés chez {MER} dès {AMT} d’achat', 'prêt jusqu’à {AMT} à taux réduit'] },
    balance: { noun: ['Solde'], p: ['solde de votre compte {ACCT} : {BAL}', 'votre solde est de {BAL}'] },
    statement: { noun: ['Relevé'], p: ['votre relevé est disponible. Montant dû {BAL} avant le {DATE}', 'échéance de {BAL} le {DATE}'] },
    request: { noun: ['{V:Demande}'], p: ['{NAME} vous a envoyé une {V:demande} de paiement de {AMT}', '{V:demande} de {AMT} de {NAME}'] },
    future: { noun: ['{V:Prévu}'], p: ['prélèvement {BILLER} de {AMT} {V:prévu} le {DATE}', 'votre paiement de {AMT} {V:sera débité} le {DATE}'] },
    limit: { noun: ['Plafond'], p: ['votre plafond a été relevé à {LIMIT}', 'plafond disponible sur votre carte {CARD} : {LIMIT}'] },
  },
};

L.de = {
  on: 'am {DATE}', bal: ['Kontostand: {BAL}', 'Verfügbar: {BAL}', 'Verfügbarer Rahmen {LIMIT}'],
  labels: { amount: ['Betrag'], merchant: ['Händler', 'Bei'], date: ['Datum'], card: ['Karte'], account: ['Konto'], type: ['Umsatzart', 'Art'], from: ['Von', 'Auftraggeber'], to: ['An', 'Empfänger'], balance: ['Kontostand'], limit: ['Verfügbarer Rahmen'], status: ['Status'], ok: ['Ausgeführt', 'Erfolgreich'] },
  dr: ['Belastung', 'Soll'], cr: ['Gutschrift', 'Haben'],
  greet: ['Hallo,', 'Sehr geehrte Kundin, sehr geehrter Kunde,'],
  ev: {
    purchase: { noun: ['{V:Kartenzahlung}', '{V:Belastung}', '{V:Zahlung}'], p: [
      '{V:Kartenzahlung} über {AMT} bei {MER}',
      'Ihre Karte {CARD} wurde mit {AMT} bei {MER} {V:belastet}',
      'Sie haben {AMT} bei {MER} {V:bezahlt}',
      '{AMT} {V:abgebucht} für Einkauf bei {MER}'] },
    refund: { noun: ['{V:Gutschrift}', '{V:Erstattung}'], p: [
      '{V:Gutschrift} von {AMT} von {MER} auf Ihre Karte {CARD}',
      '{V:Erstattung} {AMT} von {MER} wurde Ihrem Konto gutgeschrieben',
      '{MER} hat Ihnen {AMT} {V:erstattet}'] },
    transfer_out: { noun: ['{V:Überweisung ausgeführt}', '{V:Überweisung gesendet}'], p: [
      'Überweisung über {AMT} an {NAME} {V:ausgeführt}',
      'Sie haben {AMT} an {NAME} {V:gesendet}',
      '{AMT} von Konto {ACCT} an {NAME} {V:abgebucht}'] },
    transfer_in: { noun: ['{V:Zahlungseingang}', '{V:Gutschrift}'], p: [
      '{V:Eingang}: {AMT} von {NAME} auf Konto {ACCT}',
      'Sie haben {AMT} von {NAME} {V:erhalten}',
      '{AMT} von {NAME} {V:gutgeschrieben}'] },
    salary: { noun: ['{V:Gehaltseingang}', '{V:Lohneingang}'], p: [
      'Gehalt {AMT} von {EMPLOYER} {V:gutgeschrieben}',
      '{V:Lohneingang} {AMT} auf Ihr Konto {ACCT}'] },
    fee: { noun: ['{V:Gebühr belastet}'], p: [
      'Kontoführungsgebühr {AMT} {V:abgebucht}',
      'Jahresgebühr Kreditkarte {AMT} {V:belastet}'] },
    withdrawal: { noun: ['{V:Bargeldabhebung}', '{V:Abhebung}'], p: [
      '{V:Bargeldabhebung} {AMT} am Geldautomat {ATM}',
      'Sie haben {AMT} am Automaten {V:abgehoben}'] },
    card_payment: { noun: ['{V:Zahlung eingegangen}'], p: [
      'Ihre Zahlung von {AMT} auf die Kreditkarte {CARD} ist {V:eingegangen}',
      'Zahlung {AMT} für Karte {CARD} {V:erhalten}, danke'] },
    bill_payment: { noun: ['{V:Lastschrift}', '{V:Rechnung bezahlt}'], p: [
      '{V:Lastschrift} {BILLER} {AMT} {A:abgebucht|eingelöst}',
      'Rechnung {BILLER} über {AMT} {V:bezahlt}'] },
    otp: { noun: ['TAN'], p: ['Ihre TAN {OTP} für die Zahlung von {AMT} an {MER}. Nicht weitergeben', 'Bestätigungscode {OTP} für Überweisung {AMT}'] },
    pending: { noun: ['{V:Vorgemerkt}'], p: ['Umsatz {AMT} bei {MER} {V:vorgemerkt}', 'Zahlung {AMT} an {NAME} {V:in Bearbeitung}'] },
    declined: { noun: ['{V:Abgelehnt}'], p: ['Kartenzahlung {AMT} bei {MER} {V:abgelehnt}', 'Überweisung {AMT} {V:fehlgeschlagen}'] },
    promo: { noun: ['Angebot'], p: ['5% Cashback bei {MER} ab {AMT} Einkauf', 'Kredit bis {AMT} jetzt beantragen'] },
    balance: { noun: ['Kontostand'], p: ['Ihr Kontostand: {BAL}', 'Kontostand Konto {ACCT}: {BAL}'] },
    statement: { noun: ['Abrechnung'], p: ['Ihre Kreditkartenabrechnung ist da: {BAL} fällig am {DATE}', 'Mindestbetrag {BAL} fällig am {DATE}'] },
    request: { noun: ['{V:Anfrage}'], p: ['{NAME} hat {AMT} {V:angefordert}', 'Zahlungs{V:anfrage} über {AMT} von {NAME}'] },
    future: { noun: ['{V:Geplant}'], p: ['Lastschrift {AMT} von {BILLER} {V:wird abgebucht} am {DATE}', 'Dauerauftrag {AMT} an {NAME} {V:geplant} für {DATE}'] },
    limit: { noun: ['Rahmen'], p: ['Ihr Kreditrahmen wurde auf {LIMIT} erhöht', 'Verfügbarer Rahmen Karte {CARD}: {LIMIT}'] },
  },
};

L.it = {
  on: 'il {DATE}', bal: ['Saldo disponibile {BAL}', 'Saldo: {BAL}', 'Disponibilità {LIMIT}'],
  labels: { amount: ['Importo'], merchant: ['Esercente', 'Presso'], date: ['Data'], card: ['Carta'], account: ['Conto'], type: ['Operazione', 'Tipo'], from: ['Da', 'Ordinante'], to: ['A', 'Beneficiario'], balance: ['Saldo'], limit: ['Disponibilità'], status: ['Esito'], ok: ['Eseguita', 'Autorizzata'] },
  dr: ['ADDEBITO', 'Addebito'], cr: ['ACCREDITO', 'Accredito'],
  greet: ['Gentile cliente,', 'Ciao,'],
  ev: {
    purchase: { noun: ['{V:Pagamento con carta}', '{V:Acquisto}', '{V:Addebito carta}'], p: [
      '{V:pagamento} di {AMT} presso {MER} con carta {CARD}',
      '{V:acquisto} di {AMT} presso {MER}',
      '{AMT} {V:addebitati} sulla carta {CARD} per {MER}',
      'hai {V:speso} {AMT} da {MER}'] },
    refund: { noun: ['{V:Rimborso}', '{V:Storno accreditato}'], p: [
      '{V:rimborso} di {AMT} da {MER} {A:accreditato|ricevuto} sulla carta {CARD}',
      '{AMT} {V:accreditati} da {MER} (rimborso)'] },
    transfer_out: { noun: ['{V:Bonifico inviato}', '{V:Bonifico eseguito}'], p: [
      'bonifico di {AMT} {V:inviato} a {NAME}',
      'hai {V:inviato} {AMT} a {NAME} con {RAIL}',
      '{AMT} {V:addebitati} sul conto {ACCT} per bonifico a {NAME}'] },
    transfer_in: { noun: ['{V:Bonifico ricevuto}', '{V:Accredito bonifico}'], p: [
      'bonifico {V:ricevuto} da {NAME}: {AMT}',
      'hai {V:ricevuto} {AMT} da {NAME}',
      '{AMT} {V:accreditati} sul conto {ACCT} da {NAME}'] },
    salary: { noun: ['{V:Accredito stipendio}'], p: [
      '{V:stipendio} di {AMT} accreditato sul conto {ACCT}',
      '{V:accredito} stipendio {EMPLOYER}: {AMT}'] },
    fee: { noun: ['{V:Commissione addebitata}'], p: [
      'canone mensile {AMT} {V:addebitato}',
      'commissione di {AMT} {V:addebitata} sul conto {ACCT}'] },
    withdrawal: { noun: ['{V:Prelievo}'], p: [
      '{V:prelievo} di {AMT} allo sportello {ATM}',
      'hai {V:prelevato} {AMT} con la carta {CARD}'] },
    card_payment: { noun: ['{V:Pagamento ricevuto}'], p: ['abbiamo {V:ricevuto} il pagamento di {AMT} sulla carta di credito {CARD}',
      'pagamento di {AMT} per la carta {CARD} {V:ricevuto}, grazie'] },
    bill_payment: { noun: ['{V:Bolletta pagata}'], p: ['bolletta {BILLER} di {AMT} {V:pagata}', '{V:pagamento} bolletta {BILLER} {AMT} eseguito'] },
    otp: { noun: ['Codice'], p: ['il codice {OTP} autorizza il pagamento di {AMT} presso {MER}. Non condividerlo', 'codice di sicurezza {OTP} per bonifico di {AMT}'] },
    pending: { noun: ['{V:In attesa}'], p: ['pagamento di {AMT} presso {MER} {V:in attesa}', 'bonifico di {AMT} {V:in lavorazione}'] },
    declined: { noun: ['{V:Rifiutato}'], p: ['pagamento di {AMT} presso {MER} {V:rifiutato}', 'bonifico di {AMT} {V:non riuscito}'] },
    promo: { noun: ['Offerta'], p: ['cashback del 10% da {MER} per spese oltre {AMT}', 'prestito fino a {AMT} a tasso zero'] },
    balance: { noun: ['Saldo'], p: ['saldo disponibile del conto {ACCT}: {BAL}', 'il tuo saldo è {BAL}'] },
    statement: { noun: ['Estratto conto'], p: ['estratto conto pronto: da pagare {BAL} entro il {DATE}', 'rata minima {BAL} in scadenza il {DATE}'] },
    request: { noun: ['{V:Richiesta}'], p: ['{NAME} ti ha inviato una {V:richiesta} di {AMT}', '{V:richiesta} di pagamento di {AMT}'] },
    future: { noun: ['{V:Programmato}'], p: ['addebito di {AMT} per {BILLER} {V:sarà addebitato} il {DATE}', 'bonifico {V:programmato} di {AMT} il {DATE}'] },
    limit: { noun: ['Plafond'], p: ['il plafond della carta è stato aumentato a {LIMIT}', 'disponibilità carta {CARD}: {LIMIT}'] },
  },
};

L.nl = {
  on: 'op {DATE}', bal: ['Saldo: {BAL}', 'Beschikbaar saldo {BAL}', 'Beschikbare limiet {LIMIT}'],
  labels: { amount: ['Bedrag'], merchant: ['Winkel', 'Bij'], date: ['Datum'], card: ['Kaart'], account: ['Rekening'], type: ['Soort', 'Transactie'], from: ['Van'], to: ['Aan', 'Begunstigde'], balance: ['Saldo'], limit: ['Beschikbare limiet'], status: ['Status'], ok: ['Gelukt', 'Uitgevoerd'] },
  dr: ['AF', 'Af'], cr: ['BIJ', 'Bij'],
  greet: ['Beste klant,', 'Hoi,'],
  ev: {
    purchase: { noun: ['{V:Betaling}', '{V:Pinbetaling}', '{V:Aankoop}'], p: [
      '{V:betaling} van {AMT} bij {MER} met kaart {CARD}',
      'je hebt {AMT} {V:betaald} bij {MER}',
      '{AMT} {V:afgeschreven} voor {MER}',
      '{V:aankoop} {AMT} bij {MER}'] },
    refund: { noun: ['{V:Terugbetaling}', '{V:Bijschrijving}'], p: [
      '{V:terugbetaling} van {AMT} van {MER} op je rekening',
      '{AMT} {V:bijgeschreven} door {MER} (retour)'] },
    transfer_out: { noun: ['{V:Overboeking verstuurd}'], p: [
      'je hebt {AMT} {V:overgemaakt} naar {NAME}',
      'overboeking van {AMT} naar {NAME} {V:afgeschreven}',
      '{AMT} {V:verstuurd} aan {NAME} via {RAIL}'] },
    transfer_in: { noun: ['{V:Geld ontvangen}', '{V:Bijschrijving}'], p: [
      'je hebt {AMT} {V:ontvangen} van {NAME}',
      '{AMT} {V:bijgeschreven} van {NAME} op rekening {ACCT}'] },
    salary: { noun: ['{V:Salaris ontvangen}'], p: [
      'je {V:salaris} van {AMT} is bijgeschreven',
      '{AMT} {V:ontvangen} van {EMPLOYER} (salaris)'] },
    fee: { noun: ['{V:Kosten afgeschreven}'], p: ['kosten betaalpakket {AMT} {V:afgeschreven}', 'jaarlijkse kosten creditcard {AMT} {V:afgeschreven}'] },
    withdrawal: { noun: ['{V:Geldopname}'], p: ['{V:geldopname} van {AMT} bij {ATM}', 'je hebt {AMT} {V:opgenomen} met kaart {CARD}'] },
    card_payment: { noun: ['{V:Betaling ontvangen}'], p: ['we hebben je betaling van {AMT} op creditcard {CARD} {V:ontvangen}',
      'betaling van {AMT} voor kaart {CARD} {V:ontvangen}, bedankt'] },
    bill_payment: { noun: ['{V:Incasso}', '{V:Rekening betaald}'], p: ['incasso {BILLER} {AMT} {V:afgeschreven}', 'factuur {BILLER} van {AMT} {V:betaald}'] },
    otp: { noun: ['Code'], p: ['je code is {OTP} voor de betaling van {AMT} bij {MER}. Deel deze niet', 'bevestigingscode {OTP} voor overboeking van {AMT}'] },
    pending: { noun: ['{V:In behandeling}'], p: ['betaling van {AMT} bij {MER} {V:in behandeling}', '{AMT} {V:gereserveerd} door {MER}'] },
    declined: { noun: ['{V:Geweigerd}'], p: ['betaling van {AMT} bij {MER} {V:geweigerd}', 'overboeking van {AMT} {V:mislukt}'] },
    promo: { noun: ['Aanbieding'], p: ['10% korting bij {MER} vanaf {AMT}', 'lenen tot {AMT} tegen lage rente'] },
    balance: { noun: ['Saldo'], p: ['saldo rekening {ACCT}: {BAL}', 'je saldo is {BAL}'] },
    statement: { noun: ['Overzicht'], p: ['je creditcardoverzicht: {BAL} te betalen voor {DATE}', 'minimaal te betalen {BAL} op {DATE}'] },
    request: { noun: ['{V:Betaalverzoek}'], p: ['{NAME} stuurde je een {V:betaalverzoek} van {AMT}', '{V:verzoek} om {AMT} te betalen aan {NAME}'] },
    future: { noun: ['{V:Gepland}'], p: ['incasso van {AMT} {V:wordt afgeschreven} op {DATE}', '{V:geplande} betaling van {AMT} op {DATE}'] },
    limit: { noun: ['Limiet'], p: ['je bestedingslimiet is verhoogd naar {LIMIT}', 'beschikbare limiet kaart {CARD}: {LIMIT}'] },
  },
};

L.tr = {
  on: '{DATE} tarihinde', bal: ['Kullanılabilir bakiye {BAL}', 'Bakiye: {BAL}', 'Kullanılabilir limit {LIMIT}'],
  labels: { amount: ['Tutar'], merchant: ['İşyeri', 'Üye işyeri'], date: ['Tarih'], card: ['Kart'], account: ['Hesap'], type: ['İşlem', 'İşlem tipi'], from: ['Gönderen'], to: ['Alıcı'], balance: ['Bakiye'], limit: ['Kullanılabilir limit'], status: ['Durum'], ok: ['Başarılı', 'Onaylandı'] },
  dr: ['BORÇ', 'Borç'], cr: ['ALACAK', 'Alacak'],
  greet: ['Sayın müşterimiz,', 'Merhaba,'],
  ev: {
    purchase: { noun: ['{V:Harcama}', '{V:Alışveriş}', '{V:Kartla ödeme}'], p: [
      '{CARD} ile biten kartınızla {MER} işyerinden {AMT} {V:harcama} yapılmıştır',
      '{MER} {AMT} {V:alışveriş} onaylandı',
      'kartınızdan {AMT} {V:tahsil edildi}, işyeri {MER}',
      '{AMT} tutarındaki {V:ödemeniz} {MER} işyerinde gerçekleşti'] },
    refund: { noun: ['{V:İade}', '{V:İade alacak}'], p: [
      '{MER} işyerinden {AMT} {V:iade} kartınıza yansıtıldı',
      'kartınıza {AMT} tutarında {V:iade} yapılmıştır ({MER})',
      '{AMT} {V:iade} hesabınıza geçti'] },
    transfer_out: { noun: ['{V:Giden havale}', '{V:Giden FAST}', '{V:EFT gönderildi}'], p: [
      '{NAME} adlı kişiye {AMT} {V:gönderildi}',
      'hesabınızdan {AMT} {RAIL} ile {V:gönderilmiştir}, alıcı {NAME}',
      '{AMT} tutarında {V:havale} {NAME} hesabına yapıldı'] },
    transfer_in: { noun: ['{V:Gelen havale}', '{V:Gelen FAST}'], p: [
      '{NAME} tarafından hesabınıza {AMT} {V:yatırıldı}',
      'hesabınıza {AMT} {V:gelen} {RAIL}, gönderen {NAME}',
      '{AMT} {V:hesabınıza geçti}, gönderen {NAME}'] },
    salary: { noun: ['{V:Maaş ödemesi}', '{V:Maaş yatırıldı}'], p: [
      '{AMT} {V:maaş} ödemeniz hesabınıza yatırıldı',
      '{EMPLOYER} tarafından {AMT} {V:maaş} hesabınıza geçti'] },
    fee: { noun: ['{V:Ücret tahsilatı}'], p: ['hesap işletim ücreti {AMT} {V:tahsil edildi}', 'kart aidatı {AMT} {V:tahsil edilmiştir}'] },
    withdrawal: { noun: ['{V:Nakit çekim}'], p: ['{ATM} ATM’den {AMT} {V:çekildi}', '{AMT} nakit {V:çekim} yapıldı, kart {CARD}'] },
    card_payment: { noun: ['{V:Kart borcu ödendi}'], p: ['kredi kartı borcunuza {AMT} {V:ödeme} alınmıştır', '{CARD} kartınıza {AMT} {V:ödeme} yapıldı, teşekkürler'] },
    bill_payment: { noun: ['{V:Fatura ödendi}'], p: ['{BILLER} faturanız {AMT} {V:ödendi}', '{BILLER} fatura {V:ödemesi} {AMT} başarılı'] },
    otp: { noun: ['Şifre'], p: ['{MER} işyerindeki {AMT} tutarlı işlem için doğrulama kodu {OTP}. Kimseyle paylaşmayın', 'tek kullanımlık şifreniz {OTP}, tutar {AMT}'] },
    pending: { noun: ['{V:Beklemede}'], p: ['{MER} {AMT} işleminiz {V:provizyonda}', '{AMT} tutarlı işlem {V:beklemede}'] },
    declined: { noun: ['{V:Reddedildi}'], p: ['{MER} {AMT} işleminiz {V:reddedildi}', '{AMT} tutarlı işlem {V:gerçekleştirilemedi}, yetersiz bakiye'] },
    promo: { noun: ['Kampanya'], p: ['{MER} işyerinde {AMT} üzeri harcamaya %10 bonus', '{AMT} ihtiyaç kredisi fırsatı'] },
    balance: { noun: ['Bakiye'], p: ['hesap bakiyeniz {BAL}', '{ACCT} hesabınızın bakiyesi {BAL}'] },
    statement: { noun: ['Ekstre'], p: ['ekstreniz kesildi: toplam borç {BAL}, son ödeme {DATE}', 'asgari ödeme tutarı {BAL}, son ödeme tarihi {DATE}'] },
    request: { noun: ['{V:Ödeme isteği}'], p: ['{NAME} sizden {AMT} {V:talep etti}', '{AMT} {V:ödeme isteği} onayınızı bekliyor'] },
    future: { noun: ['{V:Talimat}'], p: ['{BILLER} otomatik ödeme talimatı {AMT} {DATE} tarihinde {V:tahsil edilecek}', '{V:ileri tarihli} {AMT} ödeme {DATE}'] },
    limit: { noun: ['Limit'], p: ['kart limitiniz {LIMIT} olarak güncellendi', '{CARD} kartınızın kullanılabilir limiti {LIMIT}'] },
  },
};

L.id = {
  on: 'pada {DATE}', bal: ['Saldo {BAL}', 'Sisa saldo: {BAL}', 'Limit tersedia {LIMIT}'],
  labels: { amount: ['Nominal', 'Jumlah'], merchant: ['Merchant', 'Di'], date: ['Tanggal', 'Tgl'], card: ['Kartu'], account: ['Rekening', 'Rek'], type: ['Transaksi', 'Jenis'], from: ['Dari', 'Pengirim'], to: ['Ke', 'Penerima'], balance: ['Saldo'], limit: ['Limit tersedia'], status: ['Status'], ok: ['Berhasil', 'Sukses'] },
  dr: ['DB', 'Debet'], cr: ['CR', 'Kredit'],
  greet: ['Nasabah Yth,', 'Halo,'],
  ev: {
    purchase: { noun: ['{V:Pembelian}', '{V:Pembayaran QRIS}', '{V:Transaksi debit}'], p: [
      '{V:pembelian} {AMT} di {MER} dengan kartu {CARD}',
      'rekening Anda {V:didebet} {AMT} untuk {MER}',
      '{V:pembayaran} {AMT} ke {MER} berhasil',
      'saldo Anda {V:terpotong} {AMT} di {MER}'] },
    refund: { noun: ['{V:Pengembalian dana}', '{V:Refund}'], p: [
      '{V:pengembalian dana} {AMT} dari {MER} masuk ke rekening Anda',
      '{AMT} {V:dikreditkan} ke kartu {CARD} (refund {MER})'] },
    transfer_out: { noun: ['{V:Transfer keluar}', '{V:Transfer berhasil}'], p: [
      '{V:transfer ke} {NAME} sebesar {AMT} berhasil',
      'Anda telah {V:mengirim} {AMT} ke {NAME} via {RAIL}',
      'rek {ACCT} {V:didebet} {AMT} transfer ke {NAME}'] },
    transfer_in: { noun: ['{V:Dana masuk}', '{V:Transfer masuk}'], p: [
      '{V:dana masuk} {AMT} dari {NAME}',
      'Anda {V:menerima} {AMT} dari {NAME} via {RAIL}',
      'rek {ACCT} {V:dikreditkan} {AMT} dari {NAME}'] },
    salary: { noun: ['{V:Gaji masuk}'], p: ['{V:gaji} Anda {AMT} telah masuk ke rekening {ACCT}', '{AMT} {V:dikreditkan} dari {EMPLOYER} (gaji)'] },
    fee: { noun: ['{V:Biaya administrasi}'], p: ['biaya admin bulanan {AMT} {V:didebet}', 'iuran tahunan kartu {AMT} {V:terpotong}'] },
    withdrawal: { noun: ['{V:Tarik tunai}'], p: ['{V:tarik tunai} {AMT} di {ATM}', 'Anda {V:menarik} {AMT} di ATM {ATM}'] },
    card_payment: { noun: ['{V:Pembayaran kartu diterima}'], p: ['pembayaran kartu kredit {CARD} sebesar {AMT} telah {V:diterima}',
      'pembayaran {AMT} untuk kartu {CARD} {V:diterima}, terima kasih'] },
    bill_payment: { noun: ['{V:Bayar tagihan}'], p: ['{V:pembayaran} tagihan {BILLER} {AMT} berhasil', 'tagihan {BILLER} {AMT} telah {V:dibayar}'] },
    otp: { noun: ['OTP'], p: ['kode OTP {OTP} untuk transaksi {AMT} di {MER}. JANGAN berikan ke siapa pun', 'OTP {OTP} untuk transfer {AMT}'] },
    pending: { noun: ['{V:Diproses}'], p: ['transaksi {AMT} di {MER} sedang {V:diproses}', 'transfer {AMT} ke {NAME} {V:tertunda}'] },
    declined: { noun: ['{V:Ditolak}'], p: ['transaksi {AMT} di {MER} {V:ditolak}', 'transfer {AMT} {V:gagal}, saldo tidak cukup'] },
    promo: { noun: ['Promo'], p: ['cashback 10% di {MER} min. transaksi {AMT}', 'pinjaman hingga {AMT}, ajukan sekarang'] },
    balance: { noun: ['Saldo'], p: ['saldo rekening {ACCT} Anda {BAL}', 'info saldo: {BAL}'] },
    statement: { noun: ['Tagihan'], p: ['tagihan kartu kredit Anda {BAL}, jatuh tempo {DATE}', 'pembayaran minimum {BAL} sebelum {DATE}'] },
    request: { noun: ['{V:Permintaan}'], p: ['{NAME} {V:meminta} {AMT} dari Anda', '{V:permintaan} dana {AMT} menunggu persetujuan'] },
    future: { noun: ['{V:Terjadwal}'], p: ['autodebet {AMT} untuk {BILLER} {V:akan didebet} pada {DATE}', 'transfer {V:terjadwal} {AMT} pada {DATE}'] },
    limit: { noun: ['Limit'], p: ['limit kartu kredit Anda naik menjadi {LIMIT}', 'limit tersedia kartu {CARD}: {LIMIT}'] },
  },
};

L['hi-latn'] = {
  on: '{DATE} ko', bal: ['Avl Bal {BAL}', 'Bal {BAL}', 'Avl Lmt {LIMIT}'],
  labels: { amount: ['Amt', 'Rashi'], merchant: ['At', 'Merchant'], date: ['Date', 'Tareekh'], card: ['Card'], account: ['A/c', 'Khata'], type: ['Txn', 'Type'], from: ['From', 'Se'], to: ['To', 'Ko'], balance: ['Avl Bal'], limit: ['Avl Lmt'], status: ['Status'], ok: ['Safal', 'Success'] },
  dr: ['DR', 'Dr'], cr: ['CR', 'Cr'],
  greet: ['Priya grahak,', 'Namaste,'],
  ev: {
    purchase: { noun: ['{V:Kharidari}', '{V:Card se bhugtan}'], p: [
      'aapke card XX{CARD} se {MER} par {AMT} {V:kharch} hue',
      '{MER} par {AMT} ka {V:bhugtan} safal raha',
      'aapke khate se {AMT} {V:kate}, {MER} ko payment'] },
    refund: { noun: ['{V:Refund}', '{V:Paise wapas}'], p: [
      '{MER} se {AMT} ka refund aapke khate mein {V:jama} hua',
      '{AMT} {V:wapas} aaye {MER} se'] },
    transfer_out: { noun: ['{V:Transfer bheja}'], p: [
      '{AMT} {V:debit hue} aapke A/c XX{ACCT} se, {NAME} ko transfer',
      'aapne {NAME} ko {AMT} {V:bheje} {RAIL} se'] },
    transfer_in: { noun: ['{V:Paise mile}', '{V:Jama}'], p: [
      'aapke khate XX{ACCT} mein {NAME} se {AMT} {V:jama} hue',
      '{NAME} se {AMT} {V:mile} {RAIL} dwara',
      '{AMT} {V:credit hue} aapke A/c mein {NAME} se'] },
    salary: { noun: ['{V:Salary jama}'], p: ['aapki salary {AMT} aapke khate mein {V:credit ho gayi}', '{EMPLOYER} se {AMT} salary {V:jama}'] },
    fee: { noun: ['{V:Charges kate}'], p: ['SMS charges {AMT} aapke khate se {V:kaate} gaye', 'card fee {AMT} {V:kati}'] },
    withdrawal: { noun: ['{V:ATM nikasi}'], p: ['ATM {ATM} se {AMT} {V:nikale} gaye', '{AMT} ki {V:nikasi} card XX{CARD} se'] },
    card_payment: { noun: ['{V:Card bill jama}'], p: ['aapke credit card XX{CARD} mein {AMT} ka payment {V:jama} ho gaya'] },
    bill_payment: { noun: ['{V:Bill bhugtan}'], p: ['{BILLER} bill ka {AMT} ka {V:bhugtan} safal', '{BILLER} ko {AMT} {V:bheje} gaye (bill)'] },
    otp: { noun: ['OTP'], p: ['aapka OTP {OTP} hai {MER} par {AMT} ke liye. Kisi ko na batayein', 'OTP {OTP}, rashi {AMT}'] },
    pending: { noun: ['{V:Pending}'], p: ['{MER} par {AMT} ka transaction {V:pending} hai', '{AMT} ka transfer {V:process ho raha} hai'] },
    declined: { noun: ['{V:Fail}'], p: ['{MER} par {AMT} ka transaction {V:fail ho gaya}', '{AMT} ka payment {V:asafal} raha'] },
    promo: { noun: ['Offer'], p: ['{MER} par {AMT} se zyada kharch karein aur 10% cashback paayein', '{AMT} tak loan turant paayein'] },
    balance: { noun: ['Balance'], p: ['aapke khate XX{ACCT} ka balance {BAL} hai', 'avl bal {BAL}'] },
    statement: { noun: ['Statement'], p: ['card statement: kul bakaya {BAL}, antim tareekh {DATE}', 'minimum due {BAL}, {DATE} tak'] },
    request: { noun: ['{V:Request}'], p: ['{NAME} ne aapse {AMT} ki {V:request bheji} hai', '{AMT} ki collect {V:request}, approve karein'] },
    future: { noun: ['{V:Scheduled}'], p: ['{BILLER} ka auto-debit {AMT} {DATE} ko {V:hoga}', '{AMT} ka {V:scheduled} payment {DATE} ko'] },
    limit: { noun: ['Limit'], p: ['aapke card ki limit {LIMIT} ho gayi hai', 'card XX{CARD} ki avl limit {LIMIT}'] },
  },
};

module.exports = { LEXICON: L };
