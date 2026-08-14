const assert = require('assert');

const { interpretBankAlert } = require('./build/bank-alert-interpreter.js');
const { detectSubscriptions } = require('./build/subscriptions.js');

let pass = 0;
const ok = (name, condition, detail) => {
  assert.ok(condition, detail);
  pass += 1;
  console.log(`✓ ${name}`);
};

const wrapEveryFiveWords = (source) => source
  .split(' ')
  .map((word, index) => index > 0 && index % 5 === 0 ? `\n${word}` : index ? ` ${word}` : word)
  .join('');

const varyWhitespace = (source) => source
  .split(' ')
  .map((word, index) => index === 0 ? word : `${index % 3 === 0 ? '\u00a0' : index % 3 === 1 ? '  ' : '\t'}${word}`)
  .join('');

const cases = [
  ['salary ENBD', 'salary-income', 'ENBD', 'AE', 'AED', 750000, 'income',
    'Salary payment of AED 7,500.00 was credited into your account 1234.'],
  ['salary ADCB', 'salary-income', 'ADCB', 'AE', 'AED', 750000, 'income',
    'AED 7,500.00 salary has been deposited in your A/C 1234.'],
  ['salary Mashreq', 'salary-income', 'MASHREQ', 'AE', 'AED', 750000, 'income',
    'Payroll amount AED 7,500.00 received in your bank account 1234.'],
  ['salary FAB', 'salary-income', 'FAB', 'AE', 'AED', 750000, 'income',
    'Wages of AED 7,500.00 were posted to your account 1234.'],
  ['salary WPS', 'salary-income', 'ENBD', 'AE', 'AED', 750000, 'income',
    'WPS payment AED 7,500.00 successfully credited to account 1234.'],
  ['salary credit alert', 'salary-income', 'FAB', 'AE', 'AED', 750000, 'income',
    'Credit alert: AED 7,500.00 Salary payment in account 1234.'],
  ['monthly pay', 'salary-income', 'FAB', 'AE', 'AED', 750000, 'income',
    'Monthly pay AED 7,500.00 was credited into your account 1234.'],
  ['account-first monthly pay', 'salary-income', 'FAB', 'AE', 'AED', 750000, 'income',
    'Your account 1234 credited with monthly pay AED 7,500.00.'],
  ['remuneration', 'salary-income', 'ADCB', 'AE', 'AED', 750000, 'income',
    'Remuneration of AED 7,500.00 was deposited into your account 1234.'],
  ['payroll processed to account', 'salary-income', 'FAB', 'AE', 'AED', 750000, 'income',
    'Payroll AED 7,500.00 processed to account 1234.'],
  ['compact salary pay CR', 'salary-income', 'FAB', 'AE', 'AED', 750000, 'income',
    'SAL PAY AED 7,500.00 CR TO AC 1234'],
  ['compact salary account-first amount', 'salary-income', 'FAB', 'AE', 'AED', 750000, 'income',
    'CR A/C 1234 AED 7,500.00 SAL PAY'],
  ['compact WPS CR', 'salary-income', 'FAB', 'AE', 'AED', 750000, 'income',
    'WPS CR AED 7,500.00 TO AC 1234'],
  ['Saudi compact salary account-first', 'salary-income', 'ALRAJHI', 'SA', 'SAR', 750000, 'income',
    'CR A/C 1234 SAR 7,500.00 SAL PAY'],
  ['salary Albilad Arabic', 'salary-income', 'ALBILAD', 'SA', 'SAR', 750000, 'income',
    'تم إيداع راتب بقيمة SAR 7500.00 في حسابك بنجاح'],
  ['salary Rajhi Arabic', 'salary-income', 'ALRAJHI', 'SA', 'SAR', 750000, 'income',
    'راتبك SAR 7500.00 تم إيداعه في حسابك'],
  ['Arabic wages', 'salary-income', 'ALRAJHI', 'SA', 'SAR', 750000, 'income',
    'تم إيداع أجور SAR 7500.00 في حسابك بنجاح'],

  ['seller settlement', 'business-income', 'FAB', 'AE', 'AED', 125000, 'income',
    'Seller settlement of AED 1,250.00 was credited to your account 4321.'],
  ['sales proceeds', 'business-income', 'ENBD', 'AE', 'AED', 125000, 'income',
    'Sales proceeds AED 1,250.00 deposited into your account 4321.'],
  ['business income', 'business-income', 'ADCB', 'AE', 'AED', 125000, 'income',
    'Business income of AED 1,250.00 was received into account 4321.'],
  ['invoice payment', 'business-income', 'MASHREQ', 'AE', 'AED', 125000, 'income',
    'Payment against invoice of AED 1,250.00 was credited to your account 4321.'],
  ['paid invoice', 'business-income', 'FAB', 'AE', 'AED', 125000, 'income',
    'Invoice was paid. AED 1,250.00 credited to your account 4321.'],
  ['sales settlement', 'business-income', 'FAB', 'AE', 'AED', 125000, 'income',
    'Talabat sales settlement AED 1,250.00 credited to your account 4321.'],
  ['platform payout', 'business-income', 'ENBD', 'AE', 'AED', 125000, 'income',
    'Platform payout of AED 1,250.00 was credited to your account 4321.'],
  ['marketplace earnings', 'business-income', 'FAB', 'AE', 'AED', 125000, 'income',
    'Marketplace earnings AED 1,250.00 deposited into your account.'],
  ['delivery partner earnings', 'business-income', 'FAB', 'AE', 'AED', 125000, 'income',
    'Delivery partner earnings AED 1,250.00 deposited into your account.'],
  ['merchant disbursement', 'business-income', 'ENBD', 'AE', 'AED', 125000, 'income',
    'Merchant disbursement of AED 1,250.00 was credited to your account 4321.'],
  ['acquirer settlement', 'business-income', 'ADCB', 'AE', 'AED', 125000, 'income',
    'Acquirer settlement AED 1,250.00 received in your account 4321.'],
  ['account-first merchant settlement', 'business-income', 'FAB', 'AE', 'AED', 125000, 'income',
    'Your account 4321 has been credited with AED 1,250.00 as merchant settlement.'],
  ['account-first acquirer disbursement', 'business-income', 'FAB', 'AE', 'AED', 125000, 'income',
    'Acquirer disbursement: your account 4321 credited AED 1,250.00.'],
  ['delivery proceeds', 'business-income', 'FAB', 'AE', 'AED', 125000, 'income',
    'Proceeds from deliveries AED 1,250.00 posted to your account 4321.'],
  ['numbered invoice paid', 'business-income', 'FAB', 'AE', 'AED', 125000, 'income',
    'Invoice INV-481 was paid. AED 1,250.00 credited to your account 4321.'],
  ['compact merchant settlement CR', 'business-income', 'FAB', 'AE', 'AED', 125000, 'income',
    'MERCHANT SETTLEMENT CR AED 1,250.00 A/C 4321'],
  ['compact POS settlement credit', 'business-income', 'FAB', 'AE', 'AED', 125000, 'income',
    'POS SETTLEMENT AED 1,250.00 CREDITED A/C 4321'],
  ['compact POS settlement account-first amount', 'business-income', 'FAB', 'AE', 'AED', 125000, 'income',
    'CR A/C 4321 AED 1,250.00 POS SETTLEMENT'],
  ['compact Talabat payout CR', 'business-income', 'FAB', 'AE', 'AED', 125000, 'income',
    'TALABAT PAYOUT AED 1,250.00 CR TO A/C 4321'],
  ['Arabic sales revenue', 'business-income', 'ALRAJHI', 'SA', 'SAR', 125000, 'income',
    'تم إيداع إيرادات مبيعات SAR 1250.00 في حسابك'],
  ['Arabic delivery earnings', 'business-income', 'ALRAJHI', 'SA', 'SAR', 125000, 'income',
    'تم إيداع أرباح توصيل SAR 1250.00 في حسابك'],

  ['internal transfer', 'own-account-transfer', 'ADCB', 'AE', 'AED', 500000, 'expense',
    'Internal account transfer of AED 5,000.00 completed from your A/C 002 to your A/C 004.'],
  ['between accounts', 'own-account-transfer', 'FAB', 'AE', 'AED', 500000, 'expense',
    'AED 5,000.00 was transferred between your accounts successfully.'],
  ['self transfer', 'own-account-transfer', 'ENBD', 'AE', 'AED', 500000, 'expense',
    'Self transfer AED 5,000.00 was debited from your account 002.'],
  ['another owned account', 'own-account-transfer', 'MASHREQ', 'AE', 'AED', 500000, 'expense',
    'AED 5,000.00 moved from your account 002 into another of your accounts 004.'],
  ['debit and credit owned accounts', 'own-account-transfer', 'FAB', 'AE', 'AED', 500000, 'expense',
    'AED 5,000.00 debited from account 002 and credited to another of your accounts 004.'],
  ['incoming from other owned account', 'own-account-transfer', 'FAB', 'AE', 'AED', 500000, 'income',
    'Your account 0004 has been credited AED 5,000.00 from your other account 0002.'],
  ['incoming from own account', 'own-account-transfer', 'FAB', 'AE', 'AED', 500000, 'income',
    'AED 5,000.00 received in account 0004 from your own account 0002.'],
  ['outgoing to another account of yours', 'own-account-transfer', 'FAB', 'AE', 'AED', 500000, 'expense',
    'Transfer AED 5,000.00 from account 0002 to another account of yours 0004 completed.'],
  ['compact owned account transfer', 'own-account-transfer', 'FAB', 'AE', 'AED', 500000, 'expense',
    'OWN A/C TRF AED 5,000.00 DR A/C 0002 CR A/C 0004'],
  ['compact owned account transfer account-first', 'own-account-transfer', 'FAB', 'AE', 'AED', 500000, 'expense',
    'DR A/C 0002 AED 5,000.00 OWN A/C TRF CR A/C 0004'],
  ['Saudi compact owned account transfer', 'own-account-transfer', 'ALRAJHI', 'SA', 'SAR', 500000, 'expense',
    'OWN A/C TRF SAR 5,000.00 DR A/C 0002 CR A/C 0004'],
  ['Arabic internal transfer', 'own-account-transfer', 'ALRAJHI', 'SA', 'SAR', 500000, 'expense',
    'تم تحويل داخلي بمبلغ SAR 5000.00 من حسابك إلى حسابك الآخر'],
  ['Arabic account-to-account', 'own-account-transfer', 'ALRAJHI', 'SA', 'SAR', 500000, 'expense',
    'تم تحويل SAR 5000.00 من حسابك 002 إلى حسابك 004'],
  ['Arabic completed between accounts', 'own-account-transfer', 'ALRAJHI', 'SA', 'SAR', 50000, 'expense',
    'تحويل بين حساباتك SAR 500.00 تم بنجاح'],

  ['sent beneficiary', 'external-transfer', 'FAB', 'AE', 'AED', 70000, 'expense',
    'AED 700.00 was sent from your account 002 to AHMED.'],
  ['outward remittance', 'external-transfer', 'ADCB', 'AE', 'AED', 70000, 'expense',
    'Outward remittance AED 700.00 was debited from A/C 002.'],
  ['transferred out', 'external-transfer', 'ENBD', 'AE', 'AED', 70000, 'expense',
    'AED 700.00 transferred out of your account to beneficiary AHMED.'],
  ['Arabic beneficiary', 'external-transfer', 'ALBILAD', 'SA', 'SAR', 70000, 'expense',
    'تم تحويل SAR 700.00 الى مستفيد من حسابك'],
  ['Arabic sent beneficiary', 'external-transfer', 'ALRAJHI', 'SA', 'SAR', 50000, 'expense',
    'تم إرسال SAR 500.00 إلى المستفيد أحمد من حسابك'],
  ['fund transfer beneficiary', 'external-transfer', 'FAB', 'AE', 'AED', 70000, 'expense',
    'Fund transfer AED 700.00 to beneficiary AHMED completed from account 002.'],
  ['instant transfer payee', 'external-transfer', 'ENBD', 'AE', 'AED', 70000, 'expense',
    'Instant transfer AED 700.00 to AHMED was debited from your account 002.'],
  ['beneficiary-first transfer', 'external-transfer', 'FAB', 'AE', 'AED', 70000, 'expense',
    'Beneficiary AHMED received AED 700.00 from your account 002 via instant transfer.'],
  ['compact FT transfer', 'external-transfer', 'FAB', 'AE', 'AED', 70000, 'expense',
    'FT of AED 700.00 from A/C 002 to beneficiary AHMED successful.'],
  ['ledger FT debit', 'external-transfer', 'FAB', 'AE', 'AED', 70000, 'expense',
    'FT AED 700.00 DR A/C 0002 BEN AHMED'],
  ['ledger IBFT successful', 'external-transfer', 'FAB', 'AE', 'AED', 70000, 'expense',
    'IBFT AED 700.00 FROM A/C 0002 TO BEN AHMED SUCCESS'],
  ['ledger IBFT account-first', 'external-transfer', 'FAB', 'AE', 'AED', 70000, 'expense',
    'A/C 0002 DR AED 700.00 IBFT BEN AHMED SUCCESS'],
  ['beneficiary credited from owner account', 'external-transfer', 'FAB', 'AE', 'AED', 70000, 'expense',
    'BEN AHMED CR AED 700.00 FROM YOUR A/C 0002'],
  ['compact TRF beneficiary debit', 'external-transfer', 'FAB', 'AE', 'AED', 70000, 'expense',
    'TRF AED 700.00 DR A/C 0002 BEN AHMED'],

  ['card charged', 'card-purchase', 'FAB', 'AE', 'AED', 4799, 'expense',
    'Card ending 1234 was charged AED 47.99 at CANVA.'],
  ['purchase using card', 'card-purchase', 'ADCB', 'AE', 'AED', 4799, 'expense',
    'Purchase of AED 47.99 using card ending 1234 at CANVA was processed.'],
  ['POS transaction', 'card-purchase', 'ENBD', 'AE', 'AED', 4799, 'expense',
    'POS transaction AED 47.99 completed on card 1234 at CANVA.'],
  ['Arabic card purchase', 'card-purchase', 'ALBILAD', 'SA', 'SAR', 4799, 'expense',
    'تم شراء SAR 47.99 بالبطاقة 1234 لدى CANVA'],
  ['posted card purchase with future footer', 'card-purchase', 'FAB', 'AE', 'AED', 4799, 'expense',
    'Card ending 1234 was charged AED 47.99 at CANVA. Your next fee will be charged next month.'],
  ['field-list purchase with future footer', 'card-purchase', 'FAB', 'AE', 'AED', 4799, 'expense',
    'Credit Card Purchase\nCard No XXXX1234\nAED 47.99\nCANVA CAMDEN GBR\n18/02/26 15:19\nYour next fee will be charged next month.'],
  ['compact POS card debit', 'card-purchase', 'FAB', 'AE', 'AED', 4799, 'expense',
    'POS AED 47.99 DR CARD 1234 CANVA'],
  ['compact POS card-first debit', 'card-purchase', 'FAB', 'AE', 'AED', 4799, 'expense',
    'CARD 1234 DR AED 47.99 POS CANVA'],
  ['Saudi compact POS card debit', 'card-purchase', 'ALRAJHI', 'SA', 'SAR', 4799, 'expense',
    'CARD 1234 DR SAR 47.99 POS JARIR'],
  ['compact card purchase', 'card-purchase', 'FAB', 'AE', 'AED', 4799, 'expense',
    'CARD PUR AED 47.99 CARD 1234 CANVA'],

  ['card receipt', 'card-settlement', 'FAB', 'AE', 'AED', 90000, 'income',
    'Payment of AED 900.00 received for your credit card ending 1234.'],
  ['card funding debit', 'card-settlement', 'ADCB', 'AE', 'AED', 90000, 'expense',
    'AED 900.00 was debited from account 002 towards credit card ending 1234 payment.'],
  ['card payment processed', 'card-settlement', 'ENBD', 'AE', 'AED', 90000, 'expense',
    'Credit card ending 1234 payment AED 900.00 was processed successfully.'],
  ['card payment received prefix', 'card-settlement', 'FAB', 'AE', 'AED', 90000, 'income',
    'Credit card payment received AED 900.00 for card 1234.'],
  ['Arabic card payment', 'card-settlement', 'ALBILAD', 'SA', 'SAR', 90000, 'expense',
    'تم سداد SAR 900.00 للبطاقة الائتمانية 1234'],
  ['Arabic card payment receipt', 'card-settlement', 'ALRAJHI', 'SA', 'SAR', 90000, 'income',
    'تم استلام سداد SAR 900.00 للبطاقة الائتمانية 1234'],
  ['multiline card receipt', 'card-settlement', 'FAB', 'AE', 'AED', 90000, 'income',
    'Payment of AED 900.00 received\nfor your credit card ending 1234.'],
  ['payment applied to card', 'card-settlement', 'FAB', 'AE', 'AED', 90000, 'income',
    'AED 900.00 payment applied to your credit card ending 1234.'],
  ['card credited with payment', 'card-settlement', 'FAB', 'AE', 'AED', 90000, 'income',
    'Your credit card 1234 has been credited with payment AED 900.00.'],
  ['compact CC payment debit', 'card-settlement', 'FAB', 'AE', 'AED', 90000, 'expense',
    'CC PYMT AED 900.00 DR A/C 0002 FOR CC 1234'],
  ['compact CC payment receipt', 'card-settlement', 'FAB', 'AE', 'AED', 90000, 'income',
    'CC 1234 CR AED 900.00 CARD PYMT RECEIVED'],
  ['compact CC PMT debit', 'card-settlement', 'FAB', 'AE', 'AED', 90000, 'expense',
    'CC PMT AED 900.00 DR A/C 0002 FOR CC 1234'],
  ['Saudi compact CC payment receipt', 'card-settlement', 'ALRAJHI', 'SA', 'SAR', 90000, 'income',
    'CC 1234 CR SAR 900.00 CARD PMT RECEIVED'],

  ['electricity payment', 'utility-payment', 'ADCB', 'AE', 'AED', 41000, 'expense',
    'Electricity bill payment AED 410.00 processed successfully for account 1234.'],
  ['SEWA payment', 'utility-payment', 'FAB', 'AE', 'AED', 41000, 'expense',
    'SEWA payment AED 410.00 processed for consumer 1234.'],
  ['e& payment', 'utility-payment', 'ENBD', 'AE', 'AED', 41000, 'expense',
    'e& payment AED 410.00 paid for account 1234.'],
  ['internet payment', 'utility-payment', 'MASHREQ', 'AE', 'AED', 41000, 'expense',
    'Internet account AED 410.00 was paid successfully.'],
  ['paid internet account', 'utility-payment', 'FAB', 'AE', 'AED', 41000, 'expense',
    'Paid AED 410.00 for internet account 1234.'],
  ['Arabic utility', 'utility-payment', 'ALBILAD', 'SA', 'SAR', 41000, 'expense',
    'تم دفع فاتورة كهرباء SAR 410.00 بنجاح'],
  ['telecom debit-for', 'utility-payment', 'FAB', 'AE', 'AED', 41000, 'expense',
    'AED 410.00 debited for Etisalat account 1234 bill payment.'],
  ['compact SEWA billpay debit', 'utility-payment', 'FAB', 'AE', 'AED', 41000, 'expense',
    'BILLPAY AED 410.00 DR A/C 1234 SEWA CONSUMER 9999'],
  ['Saudi compact utility billpay debit', 'utility-payment', 'ALRAJHI', 'SA', 'SAR', 41000, 'expense',
    'BILLPAY SAR 410.00 DR A/C 1234 STC ACCOUNT 9999'],

  ['ATM completed', 'cash-withdrawal', 'ENBD', 'AE', 'AED', 60000, 'expense',
    'ATM cash withdrawal AED 600.00 completed using card 1234.'],
  ['cash machine', 'cash-withdrawal', 'FAB', 'AE', 'AED', 60000, 'expense',
    'AED 600.00 was withdrawn at cash machine from account 1234.'],
  ['Arabic ATM', 'cash-withdrawal', 'ALRAJHI', 'SA', 'SAR', 60000, 'expense',
    'تم سحب نقدي SAR 600.00 من صراف باستخدام البطاقة 1234'],
  ['compact ATM WDL debit', 'cash-withdrawal', 'FAB', 'AE', 'AED', 60000, 'expense',
    'ATM WDL AED 600.00 DB from A/C 1234.'],
  ['compact ATM WDL DR', 'cash-withdrawal', 'FAB', 'AE', 'AED', 60000, 'expense',
    'ATM WDL AED 600.00 DR A/C 1234'],
  ['compact cash WDL account', 'cash-withdrawal', 'FAB', 'AE', 'AED', 60000, 'expense',
    'CASH WDL AED 600.00 FROM A/C 1234'],
  ['Saudi compact ATM WDL debit', 'cash-withdrawal', 'ALRAJHI', 'SA', 'SAR', 60000, 'expense',
    'ATM WDL SAR 600.00 DR A/C 1234'],

  ['refund credit', 'refund', 'FAB', 'AE', 'AED', 12500, 'income',
    'Refund of AED 125.00 was credited to your account 4321.'],
  ['refunded card', 'refund', 'ADCB', 'AE', 'AED', 12500, 'income',
    'AED 125.00 was refunded to your card ending 1234.'],
  ['purchase reversal', 'refund', 'ENBD', 'AE', 'AED', 12500, 'income',
    'Purchase reversal AED 125.00 posted to card ending 1234.'],
  ['Arabic refund', 'refund', 'ALBILAD', 'SA', 'SAR', 12500, 'income',
    'تم استرداد SAR 125.00 إلى حسابك'],
  ['Arabic returned amount', 'refund', 'ALRAJHI', 'SA', 'SAR', 12500, 'income',
    'تم رد مبلغ SAR 125.00 إلى بطاقتك 1234'],
  ['outgoing transfer reversed', 'refund', 'FAB', 'AE', 'AED', 50000, 'income',
    'Outgoing transfer AED 500.00 to AHMED was reversed and credited to your account.'],
  ['ATM withdrawal reversed', 'refund', 'FAB', 'AE', 'AED', 60000, 'income',
    'Cash withdrawal AED 600.00 at ATM was reversed and credited to your account.'],
  ['utility payment reversed', 'refund', 'FAB', 'AE', 'AED', 41000, 'income',
    'Utility payment AED 410.00 was reversed and credited to your account.'],
  ['salary credit reversed', 'credit-reversal', 'FAB', 'AE', 'AED', 750000, 'expense',
    'Salary credit AED 7,500.00 to your account has been reversed.'],
  ['refund credit reversed', 'credit-reversal', 'FAB', 'AE', 'AED', 4799, 'expense',
    'Refund AED 47.99 to card 1234 was reversed and debited from your account.'],
  ['Arabic salary credit reversed', 'credit-reversal', 'ALRAJHI', 'SA', 'SAR', 750000, 'expense',
    'تم عكس راتب SAR 7500.00 المودع في حسابك'],
  ['Arabic transfer reversed', 'refund', 'ALRAJHI', 'SA', 'SAR', 50000, 'income',
    'تم عكس تحويل SAR 500.00 وإعادة المبلغ إلى حسابك'],
  ['re-credit for reversed purchase', 'refund', 'FAB', 'AE', 'AED', 12500, 'income',
    'AED 125.00 re-credited to card 1234 for reversed purchase.'],
  ['reversed annual fee', 'refund', 'FAB', 'AE', 'AED', 25000, 'income',
    'Annual fee AED 250.00 charged to card 1234 was reversed.'],
  ['compact refund CR', 'refund', 'FAB', 'AE', 'AED', 12500, 'income',
    'REFUND CR AED 125.00 TO CARD 1234'],
  ['compact ATM reversal CR', 'refund', 'FAB', 'AE', 'AED', 60000, 'income',
    'ATM WDL CR AED 600.00 CARD 1234'],
  ['compact fee reversal CR', 'refund', 'FAB', 'AE', 'AED', 25000, 'income',
    'ANNUAL FEE CR AED 250.00 CARD 1234'],
  ['compact POS reversal CR', 'refund', 'FAB', 'AE', 'AED', 4799, 'income',
    'POS CR AED 47.99 CARD 1234 CANVA'],
  ['compact billpay reversal CR', 'refund', 'FAB', 'AE', 'AED', 41000, 'income',
    'BILLPAY CR AED 410.00 A/C 1234 SEWA'],
  ['compact ATM debit reversed', 'refund', 'FAB', 'AE', 'AED', 60000, 'income',
    'ATM WDL AED 600.00 DR A/C 1234 REVERSED'],
  ['compact salary credit reversed', 'credit-reversal', 'FAB', 'AE', 'AED', 750000, 'expense',
    'SAL PAY AED 7,500.00 CR A/C 1234 REVERSED'],

  ['annual fee', 'fee', 'FAB', 'AE', 'AED', 25000, 'expense',
    'Annual card fee AED 250.00 was charged to card 1234.'],
  ['maintenance fee', 'fee', 'ADCB', 'AE', 'AED', 2500, 'expense',
    'Maintenance fee of AED 25.00 was deducted from account 1234.'],
  ['commission', 'fee', 'ENBD', 'AE', 'AED', 1500, 'expense',
    'Commission AED 15.00 was debited from your account.'],
  ['Arabic fee', 'fee', 'ALRAJHI', 'SA', 'SAR', 2500, 'expense',
    'تم خصم رسوم SAR 25.00 من حسابك'],
  ['Arabic deducted commission', 'fee', 'ALRAJHI', 'SA', 'SAR', 2500, 'expense',
    'تم استقطاع عمولة SAR 25.00 من حسابك'],
  ['maintenance fee applied', 'fee', 'FAB', 'AE', 'AED', 2500, 'expense',
    'Account maintenance fee AED 25.00 has been applied to account 1234.'],
  ['annual fee assessed', 'fee', 'FAB', 'AE', 'AED', 2500, 'expense',
    'AED 25.00 annual card fee was assessed on card 1234.'],
  ['compact annual fee DR', 'fee', 'FAB', 'AE', 'AED', 25000, 'expense',
    'ANNUAL FEE DR AED 250.00 CARD 1234'],
  ['compact commission DR', 'fee', 'FAB', 'AE', 'AED', 2500, 'expense',
    'COMMISSION AED 25.00 DR A/C 1234'],
  ['salary-certificate fee debit', 'fee', 'FAB', 'AE', 'AED', 2500, 'expense',
    'SALARY CERTIFICATE FEE DR AED 25.00 A/C 1234'],
];

for (const [name, meaning, sender, market, currency, amountFils, type, source] of cases) {
  const result = interpretBankAlert({ source, sender, market });
  ok(`${name}: semantic meaning and money are exact`,
    result.outcome === 'parsed' && result.meaning === meaning &&
      result.parsed.type === type && result.parsed.currency === currency &&
      result.parsed.amountFils === amountFils,
    JSON.stringify(result));

  const accountingShape = result.outcome === 'parsed' && (
    meaning === 'own-account-transfer'
      ? result.parsed.transferHint === true && result.parsed.cardPaymentSide === undefined
      : meaning === 'card-settlement'
        ? result.parsed.transferHint === true &&
          result.parsed.cardPaymentSide === (type === 'income' ? 'receipt' : 'debit')
        : meaning === 'utility-payment'
          ? result.parsed.transferHint === false && result.parsed.paymentFlowSide === 'receipt'
          : result.parsed.transferHint === false && result.parsed.cardPaymentSide === undefined &&
            result.parsed.paymentFlowSide === undefined
  );
  ok(`${name}: accounting exclusion and reconciliation flags match the meaning`,
    accountingShape,
    JSON.stringify(result));

  const decoy = interpretBankAlert({
    source: `${source} Available balance ${currency} 99,999.00.`,
    sender,
    market,
  });
  ok(`${name}: a balance decoy never replaces the movement amount`,
    decoy.outcome === 'parsed' && decoy.meaning === meaning &&
      decoy.parsed.type === type && decoy.parsed.currency === currency &&
      decoy.parsed.amountFils === amountFils,
    JSON.stringify(decoy));

  const multiline = interpretBankAlert({
    source: wrapEveryFiveWords(source),
    sender,
    market,
  });
  ok(`${name}: line wrapping never changes accounting meaning or money`,
    multiline.outcome === 'parsed' && multiline.meaning === meaning &&
      multiline.parsed.type === type && multiline.parsed.currency === currency &&
      multiline.parsed.amountFils === amountFils,
    JSON.stringify(multiline));

  const spacing = interpretBankAlert({
    source: varyWhitespace(source),
    sender,
    market,
  });
  ok(`${name}: tabs, repeated spaces and non-breaking spaces do not alter accounting`,
    spacing.outcome === 'parsed' && spacing.meaning === meaning &&
      spacing.parsed.type === type && spacing.parsed.currency === currency &&
      spacing.parsed.amountFils === amountFils,
    JSON.stringify(spacing));

  const foldedCase = interpretBankAlert({
    source: source.toLocaleLowerCase('en-US'),
    sender,
    market,
  });
  ok(`${name}: casing does not alter accounting meaning or money`,
    foldedCase.outcome === 'parsed' && foldedCase.meaning === meaning &&
      foldedCase.parsed.type === type && foldedCase.parsed.currency === currency &&
      foldedCase.parsed.amountFils === amountFils,
    JSON.stringify(foldedCase));
}

const launchBankSenders = {
  AE: [
    'ENBD', 'FAB', 'ADCB', 'ADIB', 'DIB', 'MASHREQ', 'RAK BANK', 'CBD',
    'HSBC', 'EMIRATES ISLAMIC', 'SIB', 'NBF', 'WIO', 'LIV', 'AJMAN BANK', 'CBI',
  ],
  SA: [
    'ALRAJHI', 'SNB', 'RIYAD BANK', 'ALINMA', 'ALBILAD', 'SAB', 'ANB', 'BSF',
    'ALJAZIRA', 'STC PAY', 'URPAY', 'D360',
  ],
};

for (const [market, senders] of Object.entries(launchBankSenders)) {
  const currency = market === 'AE' ? 'AED' : 'SAR';
  const crossBankCases = [
    ['salary-income', 'income', `Salary payment of ${currency} 7,500.00 was credited into your account 1234.`],
    ['business-income', 'income', `Seller settlement of ${currency} 1,250.00 was credited into your account 1234.`],
    ['own-account-transfer', 'expense', `Internal account transfer of ${currency} 500.00 completed from your A/C 002 to your A/C 004.`],
    ['external-transfer', 'expense', `${currency} 500.00 was sent from your account 002 to AHMED.`],
    ['card-purchase', 'expense', `Card ending 1234 was charged ${currency} 47.99 at EXAMPLE SHOP.`],
    ['card-settlement', 'income', `Payment of ${currency} 900.00 received for your credit card ending 1234.`],
    ['utility-payment', 'expense', `Electricity bill payment ${currency} 410.00 processed for account 1234.`],
    ['cash-withdrawal', 'expense', `ATM cash withdrawal ${currency} 600.00 completed using card 1234.`],
    ['refund', 'income', `Refund of ${currency} 125.00 was credited to your account 1234.`],
    ['fee', 'expense', `Annual card fee ${currency} 250.00 was charged to card 1234.`],
  ];
  for (const sender of senders) {
    const results = crossBankCases.map(([meaning, type, source]) => ({
      meaning,
      type,
      result: interpretBankAlert({ source, sender, market }),
    }));
    ok(`${market} ${sender}: semantic accounting is bank-independent across all ten families`,
      results.every(({ meaning, type, result }) =>
        result.outcome === 'parsed' && result.meaning === meaning && result.parsed.type === type),
      JSON.stringify(results));
  }
}

const hardNegatives = [
  ['OTP', 'FAB', 'AE', 'OTP 123456 is required to approve salary AED 7,500.00.'],
  ['future salary', 'FAB', 'AE', 'Salary AED 7,500.00 will be credited tomorrow.'],
  ['future salary with balance snapshot', 'FAB', 'AE',
    'Salary AED 7,500.00 will be credited tomorrow. Available balance AED 500.00.'],
  ['expected salary', 'FAB', 'AE',
    'Credit alert: salary AED 7,500.00 expected tomorrow in account 1234.'],
  ['expected salary prefix', 'FAB', 'AE',
    'Expected salary AED 7,500.00 in your account tomorrow.'],
  ['failed payout', 'ENBD', 'AE', 'Merchant payout AED 1,250.00 to your account failed.'],
  ['scheduled disbursement', 'ENBD', 'AE',
    'Merchant disbursement AED 1,250.00 will be credited tomorrow.'],
  ['scheduled disbursement with balance snapshot', 'ENBD', 'AE',
    'Merchant payout AED 1,250.00 will be credited tomorrow. Available balance AED 500.00.'],
  ['delivery earnings promotion', 'FAB', 'AE',
    'Get delivery partner earnings of up to AED 1,250.00 when you join today.'],
  ['salary advance offer', 'FAB', 'AE',
    'Salary advance offer AED 5,000.00. Apply now.'],
  ['commission signup offer', 'FAB', 'AE',
    'Earn commission AED 100.00 after signup.'],
  ['ATM withdrawal limit', 'FAB', 'AE',
    'ATM WDL limit AED 5,000.00 on A/C 1234.'],
  ['future remuneration', 'FAB', 'AE',
    'Remuneration AED 7,500.00 will be deposited into your account next week.'],
  ['payout when eligible', 'FAB', 'AE',
    'Merchant payout AED 1,250.00 credited to your account when eligible.'],
  ['seller proceeds after registration', 'FAB', 'AE',
    'Earn seller proceeds: AED 1,250.00 credited to your account after registration.'],
  ['payout when qualified', 'FAB', 'AE',
    'Merchant payout AED 1,250.00 credited to your account when you qualify.'],
  ['payout once qualified', 'FAB', 'AE',
    'Merchant payout AED 1,250.00 credited to your account once qualified.'],
  ['payout if qualified', 'FAB', 'AE',
    'Merchant payout AED 1,250.00 credited to your account if you qualify.'],
  ['payout after signup', 'FAB', 'AE',
    'Seller proceeds AED 1,250.00 credited to your account after you register.'],
  ['payout after account opening', 'FAB', 'AE',
    'Seller proceeds AED 1,250.00 credited to your account after opening an account.'],
  ['conditional salary approval', 'FAB', 'AE',
    'Salary AED 7,500.00 credited to your account if approved.'],
  ['payout after onboarding', 'FAB', 'AE',
    'Merchant payout AED 1,250.00 credited to your account after completing onboarding.'],
  ['pending fee debit', 'FAB', 'AE',
    'Maintenance fee AED 25.00 pending debit from account 1234.'],
  ['pending transfer', 'ADCB', 'AE', 'AED 700.00 transfer to AHMED is pending.'],
  ['card approval', 'FAB', 'AE', 'Approve card purchase AED 47.99 in your app.'],
  ['cashback promotion', 'FAB', 'AE', 'Spend AED 6,000.00 and get up to 10% cashback.'],
  ['scheduled fee', 'ENBD', 'AE', 'Annual card fee AED 250.00 will be charged next month.'],
  ['scheduled fee with balance snapshot', 'ENBD', 'AE',
    'Annual card fee AED 250.00 will be charged next month. Available balance AED 500.00.'],
  ['scheduled card payment with limit snapshot', 'FAB', 'AE',
    'Credit card payment AED 900.00 is scheduled for tomorrow. Available limit AED 2,000.00.'],
  ['future refund with balance snapshot', 'FAB', 'AE',
    'Refund AED 125.00 will be deposited tomorrow. Available balance AED 500.00.'],
  ['expected compact refund', 'FAB', 'AE',
    'EXPECTED REFUND CR AED 125.00 TO CARD 1234'],
  ['pending compact card purchase', 'FAB', 'AE',
    'CARD PUR AED 47.99 CARD 1234 PENDING'],
  ['ambiguous IBT debit and credit', 'FAB', 'AE',
    'IBT AED 5,000.00 DR A/C 0002 CR A/C 0004'],
  ['unstated account transfer', 'FAB', 'AE',
    'A/C TRANSFER AED 5,000.00 FROM YOUR A/C 0002 TO YOUR A/C 0004'],
  ['compact own transfer missing credit leg', 'FAB', 'AE',
    'DR A/C 0002 AED 5,000.00 OWN A/C TRF A/C 0004'],
  ['compact external transfer missing beneficiary', 'FAB', 'AE',
    'A/C 0002 DR AED 700.00 IBFT SUCCESS'],
  ['compact card debit missing purchase rail', 'FAB', 'AE',
    'CARD 1234 DR AED 47.99 CANVA'],
  ['account last4 beside amount without movement', 'FAB', 'AE',
    'A/C 1234 AED 7,500.00 BALANCE INFORMATION'],
  ['utility due', 'ADCB', 'AE', 'Electricity bill AED 410.00 is due on 25 August.'],
  ['salary offer Arabic', 'ALRAJHI', 'SA', 'عرض راتب SAR 7500.00 عند فتح حساب جديد'],
  ['failed Arabic transfer', 'ALBILAD', 'SA', 'فشل تحويل SAR 700.00 من حسابك'],
  ['Arabic card approval', 'ALRAJHI', 'SA',
    'يرجى الموافقة على عملية شراء بمبلغ SAR 47.99 بالبطاقة 1234'],
  ['future Arabic salary', 'ALRAJHI', 'SA',
    'سيتم إيداع راتب SAR 7500.00 في حسابك غدا'],
  ['expected Arabic salary', 'ALRAJHI', 'SA',
    'راتب SAR 7500.00 متوقع غدا في حسابك'],
  ['future Arabic arrival', 'ALRAJHI', 'SA',
    'سيصل راتب SAR 7500.00 إلى حسابك غدا'],
  ['card payment request', 'FAB', 'AE',
    'Credit card payment request received AED 900.00 for card 1234.'],
  ['Arabic card payment request', 'ALRAJHI', 'SA',
    'تم استلام طلب سداد SAR 900.00 للبطاقة الائتمانية 1234'],
];

for (const [name, sender, market, source] of hardNegatives) {
  const result = interpretBankAlert({ source, sender, market });
  ok(`${name}: non-posting evidence never becomes a transaction`,
    result.outcome !== 'parsed' ||
    result.parsed.kind === 'billDue' || result.parsed.kind === 'cardStatement',
    JSON.stringify(result));

  const multiline = interpretBankAlert({
    source: wrapEveryFiveWords(source),
    sender,
    market,
  });
  ok(`${name}: line wrapping cannot turn non-posting evidence into money`,
    multiline.outcome !== 'parsed' ||
      multiline.parsed.kind === 'billDue' || multiline.parsed.kind === 'cardStatement',
    JSON.stringify(multiline));
}

const completedApprovalControls = [
  ['English completed approval', 'FAB', 'AE',
    'Your card purchase of AED 47.99 at CANVA was approved. Card ending 1234.'],
  ['Arabic completed approval', 'ALRAJHI', 'SA',
    'تم تأكيد عملية شراء بمبلغ SAR 47.99 لدى CANVA بالبطاقة 1234'],
];

for (const [name, sender, market, source] of completedApprovalControls) {
  const result = interpretBankAlert({ source, sender, market });
  ok(`${name}: completed purchase remains posted`,
    result.outcome === 'parsed' && result.meaning === 'card-purchase' &&
      result.parsed.type === 'expense' && result.parsed.amountFils === 4_799,
    JSON.stringify(result));
}

const statementControls = [
  ['full English statement', 'FAB', 'AE', 25,
    'Statement generated for credit card ending 1234. Total amount due AED 1,200.00. Minimum due AED 100.00. Payment due date 25/08/2026.'],
  ['yearless English statement', 'FAB', 'AE', 25,
    'Credit card bill AED 1,200.00 due on 25 Aug. Minimum payment AED 100.00 for card 1234.'],
  ['Arabic statement', 'ALRAJHI', 'SA', 25,
    'كشف حساب البطاقة الائتمانية 1234 المبلغ المستحق SAR 1200.00 الحد الأدنى SAR 100.00 تاريخ الاستحقاق 25/08/2026'],
];
for (const [name, sender, market, dueDay, source] of statementControls) {
  const result = interpretBankAlert({ source, sender, market });
  ok(`${name}: a statement remains a due and never becomes spending`,
    result.outcome === 'parsed' && result.meaning === 'card-statement' &&
      result.parsed.kind === 'cardStatement' && result.parsed.amountFils === 120_000 &&
      result.parsed.minDueFils === 10_000 && result.parsed.dueDay === dueDay,
    JSON.stringify(result));
}

for (const [name, meaning, sender, market, amountFils, source] of [
  ['salary with currency suffix', 'salary-income', 'FAB', 'AE', 750_000,
    'Salary payment of 7,500.00 AED was credited into your account 1234.'],
  ['business payout with currency suffix', 'business-income', 'ENBD', 'AE', 125_000,
    'Merchant settlement of 1,250.00 AED was credited into your account 1234.'],
  ['fund transfer with currency suffix', 'external-transfer', 'FAB', 'AE', 70_000,
    'Fund transfer 700.00 AED to beneficiary AHMED completed from account 002.'],
  ['card purchase with currency suffix', 'card-purchase', 'FAB', 'AE', 4_799,
    'Card ending 1234 was charged 47.99 AED at CANVA.'],
  ['utility with currency suffix', 'utility-payment', 'FAB', 'AE', 41_000,
    'Electricity bill payment 410.00 AED processed successfully for account 1234.'],
  ['Arabic salary with currency suffix', 'salary-income', 'ALRAJHI', 'SA', 750_000,
    'تم إيداع راتب 7500.00 SAR في حسابك بنجاح'],
]) {
  const result = interpretBankAlert({ source, sender, market });
  ok(`${name}: word order around the amount is not a format dependency`,
    result.outcome === 'parsed' && result.meaning === meaning &&
      result.parsed.amountFils === amountFils,
    JSON.stringify(result));
}

for (const [name, sender, market, source] of [
  ['future direct-debit mandate', 'FAB', 'AE',
    'Direct debit mandate for AED 250.00 will start next month.'],
  ['registered direct-debit mandate', 'FAB', 'AE',
    'Your direct debit mandate for AED 250.00 has been registered.'],
  ['active autopay instruction', 'FAB', 'AE',
    'Autopay AED 250.00 is now active for your account.'],
  ['Arabic direct-debit mandate', 'ALRAJHI', 'SA',
    'تم تسجيل أمر خصم تلقائي SAR 250.00 للحساب 1234'],
]) {
  const result = interpretBankAlert({ source, sender, market });
  ok(`${name}: an instruction lifecycle never becomes a charge`,
    result.outcome !== 'parsed' || result.parsed.kind !== 'transaction',
    JSON.stringify(result));
}

const subscriptionRows = ['2026-05-03', '2026-06-03', '2026-07-03'].map((date) => {
  const result = interpretBankAlert({
    source: 'Your Netflix monthly subscription AED 55.00 was charged to card ending 1234.',
    sender: 'FAB',
    market: 'AE',
  });
  assert.equal(result.outcome, 'parsed', JSON.stringify(result));
  return {
    id: `netflix-${date}`,
    type: result.parsed.type,
    amountFils: result.parsed.amountFils,
    category: result.parsed.categoryGuess,
    accountId: 'card-1234',
    title: result.parsed.merchant,
    date,
  };
});
const subscriptions = detectSubscriptions(subscriptionRows, [], new Date(2026, 6, 10));
ok('format-independent charges retain provider identity and become one subscription',
  subscriptionRows.every((row) => row.title === 'Netflix') &&
    subscriptions.length === 1 && subscriptions[0].title === 'Netflix' &&
    subscriptions[0].cadence === 'monthly' && subscriptions[0].monthlyEquivalentFils === 5_500,
  JSON.stringify({ subscriptionRows, subscriptions }));

const ambiguous = interpretBankAlert({
  source: 'Payroll amounts AED 7,500.00 and AED 500.00 were posted to your account 1234.',
  sender: 'FAB',
  market: 'AE',
});
ok('two movement amounts never use semantic automatic interpretation',
  ambiguous.outcome !== 'parsed' || ambiguous.origin !== 'semantic',
  JSON.stringify(ambiguous));

const misleadingPurchaseText = [
  ['merchant named Internal Transfer Cafe',
    'Card ending 1234 was charged AED 20.00 at INTERNAL TRANSFER CAFE.'],
  ['merchant named ATM Cafe',
    'Card ending 1234 was charged AED 20.00 at ATM CAFE.'],
  ['merchant named Cash Withdrawal Cafe',
    'Card ending 1234 was charged AED 20.00 at CASH WITHDRAWAL CAFE.'],
  ['merchant named Annual Card Fee Shop',
    'Card ending 1234 was charged AED 20.00 at ANNUAL CARD FEE SHOP.'],
  ['merchant named Delivery Partner Earnings Cafe',
    'Card ending 1234 was charged AED 20.00 at DELIVERY PARTNER EARNINGS CAFE.'],
  ['merchant named Acquirer Settlement Services',
    'Card ending 1234 was charged AED 20.00 at ACQUIRER SETTLEMENT SERVICES.'],
  ['an own-transfer feature footer',
    'Card ending 1234 was charged AED 20.00 at SAMPLE SHOP. Transfer between your accounts in the app.'],
  ['a fee feature footer',
    'Card ending 1234 was charged AED 20.00 at SAMPLE SHOP. Annual card fee AED 0 for new customers.'],
  ['an automatic card-payment footer',
    'Card ending 1234 was charged AED 20.00 at SAMPLE SHOP. Credit card payment processed automatically.'],
  ['a utility feature footer',
    'Card ending 1234 was charged AED 20.00 at SAMPLE SHOP. Pay utility bills in the app.'],
  ['an Arabic merchant named Cash Withdrawal',
    'تم شراء AED 20.00 بالبطاقة 1234 لدى مطعم سحب نقدي'],
  ['compact purchase at DR MARTENS',
    'CARD 1234 DR AED 200.00 POS DR MARTENS'],
  ['compact purchase at CR7 SPORTS',
    'CARD 1234 DR AED 75.00 POS CR7 SPORTS'],
  ['compact purchase at POS SETTLEMENT CAFE',
    'CARD 1234 DR AED 47.99 POS SETTLEMENT CAFE'],
];

for (const [name, source] of misleadingPurchaseText) {
  const result = interpretBankAlert({ source, sender: 'FAB', market: 'AE' });
  ok(`${name} cannot change a posted purchase's accounting role`,
    result.outcome === 'parsed' && result.meaning === 'card-purchase' &&
      result.parsed.type === 'expense' && result.parsed.transferHint === false &&
      result.parsed.paymentFlowSide === undefined && result.parsed.cardPaymentSide === undefined,
    JSON.stringify(result));
}

for (const [name, source] of [
  ['merchantless purchase with own-transfer footer',
    'Your card ending 1234 was charged AED 20.00. Transfer between your accounts in the app.'],
  ['merchantless purchase with card-payment footer',
    'Your card ending 1234 was charged AED 20.00. Credit card payment processed automatically.'],
  ['merchantless debit-using-card with own-transfer footer',
    'AED 20.00 was debited using your card ending 1234. Transfer between your accounts in the app.'],
  ['merchantless debit-from-card with own-transfer footer',
    'AED 20.00 debited from your card ending 1234. Transfer between your accounts in the app.'],
]) {
  const result = interpretBankAlert({ source, sender: 'FAB', market: 'AE' });
  ok(`${name} remains spending`,
    result.outcome === 'parsed' && result.meaning === 'card-purchase' &&
      result.parsed.type === 'expense' && result.parsed.transferHint === false &&
      result.parsed.cardPaymentSide === undefined && result.parsed.paymentFlowSide === undefined,
    JSON.stringify(result));
}

const sameBankBeneficiary = interpretBankAlert({
  source: 'Internal transfer AED 500.00 completed from account 002 to beneficiary AHMED.',
  sender: 'FAB',
  market: 'AE',
});
ok('an internal-bank transfer to a beneficiary is external cash out, not self movement',
  sameBankBeneficiary.outcome === 'parsed' &&
    sameBankBeneficiary.meaning === 'external-transfer' &&
    sameBankBeneficiary.parsed.transferHint === false,
  JSON.stringify(sameBankBeneficiary));

const outwardRemittance = interpretBankAlert({
  source: 'Outward remittance AED 700.00 to beneficiary AHMED was debited from account 002.',
  sender: 'FAB',
  market: 'AE',
});
ok('an outward remittance can never retain an owned-transfer exclusion',
  outwardRemittance.outcome === 'parsed' &&
    outwardRemittance.meaning === 'external-transfer' &&
    outwardRemittance.parsed.type === 'expense' &&
    outwardRemittance.parsed.transferHint === false,
  JSON.stringify(outwardRemittance));

const loanRemittance = interpretBankAlert({
  source: 'AED 700.00 was transferred from your account 002 to HOME FINANCE BANK for loan repayment.',
  sender: 'HSBC',
  market: 'AE',
});
ok('correcting an external transfer flag preserves a deliberate loan category',
  loanRemittance.outcome === 'parsed' &&
    loanRemittance.meaning === 'external-transfer' &&
    loanRemittance.parsed.transferHint === false &&
    loanRemittance.parsed.categoryGuess === 'loan' &&
    loanRemittance.parsed.categoryDeliberate === true,
  JSON.stringify(loanRemittance));

const internalNamedPayee = interpretBankAlert({
  source: 'AED 500.00 debited from your account 002 to INTERNAL TRANSFER SERVICES.',
  sender: 'FAB',
  market: 'AE',
});
ok('a payee containing Internal Transfer is not treated as an owned account',
  internalNamedPayee.outcome === 'parsed' &&
    internalNamedPayee.meaning !== 'own-account-transfer' &&
    internalNamedPayee.parsed.transferHint === false,
  JSON.stringify(internalNamedPayee));

const externalWithOwnTransferFooter = interpretBankAlert({
  sender: 'FAB',
  market: 'AE',
  source: 'AED 700.00 was sent from your account 002 to beneficiary AHMED. Transfer between your accounts instantly in our app.',
});
ok('an own-transfer feature footer cannot hide an external beneficiary transfer',
  externalWithOwnTransferFooter.outcome === 'parsed' &&
    externalWithOwnTransferFooter.meaning === 'external-transfer' &&
    externalWithOwnTransferFooter.parsed.transferHint === false,
  JSON.stringify(externalWithOwnTransferFooter));

const atmWithOwnTransferFooter = interpretBankAlert({
  sender: 'FAB',
  market: 'AE',
  source: 'ATM WDL AED 600.00 DB from A/C 1234. Transfer between your accounts in our app.',
});
ok('an own-transfer feature footer cannot hide an ATM cash withdrawal',
  atmWithOwnTransferFooter.outcome === 'parsed' &&
    atmWithOwnTransferFooter.meaning === 'cash-withdrawal' &&
    atmWithOwnTransferFooter.parsed.transferHint === false,
  JSON.stringify(atmWithOwnTransferFooter));

const salaryWithRefundPolicy = interpretBankAlert({
  sender: 'FAB',
  market: 'AE',
  source: 'Salary AED 7,500.00 credited to account 1234. See our refund policy online.',
});
ok('a refund-policy footer cannot relabel posted salary income',
  salaryWithRefundPolicy.outcome === 'parsed' &&
    salaryWithRefundPolicy.meaning === 'salary-income' &&
    salaryWithRefundPolicy.parsed.categoryGuess === 'salary',
  JSON.stringify(salaryWithRefundPolicy));

const businessWithRefundPolicy = interpretBankAlert({
  sender: 'FAB',
  market: 'AE',
  source: 'Merchant settlement AED 1,250.00 credited to account 1234. Refund policy applies to card purchases.',
});
ok('a refund-policy footer cannot relabel posted business income',
  businessWithRefundPolicy.outcome === 'parsed' &&
    businessWithRefundPolicy.meaning === 'business-income',
  JSON.stringify(businessWithRefundPolicy));

for (const [name, expectedMeaning, expectedFlag, source] of [
  ['ATM withdrawal', 'cash-withdrawal', 'cash-withdrawal',
    'ATM cash withdrawal AED 600.00 completed using card 1234. Credit card payment processed automatically.'],
  ['bank fee', 'fee', 'other',
    'Annual card fee AED 250.00 was charged to card 1234. Credit card payment processed automatically.'],
  ['utility payment', 'utility-payment', 'utilities',
    'Electricity bill payment AED 410.00 processed using card 1234. Credit card payment processed automatically.'],
]) {
  const result = interpretBankAlert({ sender: 'FAB', market: 'AE', source });
  ok(`a card-payment footer cannot relabel a posted ${name}`,
    result.outcome === 'parsed' && result.meaning === expectedMeaning &&
      result.parsed.transferHint === false && result.parsed.cardPaymentSide === undefined &&
      result.parsed.categoryGuess === expectedFlag,
    JSON.stringify(result));
}

const cardPaymentWithFutureFeeFooter = interpretBankAlert({
  sender: 'FAB',
  market: 'AE',
  source: 'Credit card payment AED 900.00 was processed for card 1234. A late payment fee will be charged next month.',
});
ok('a future-fee footer cannot relabel a posted card settlement',
  cardPaymentWithFutureFeeFooter.outcome === 'parsed' &&
    cardPaymentWithFutureFeeFooter.meaning === 'card-settlement' &&
    cardPaymentWithFutureFeeFooter.parsed.cardPaymentSide === 'debit',
  JSON.stringify(cardPaymentWithFutureFeeFooter));

console.log(`\nbank-alert-semantics-matrix: ${pass} passed, 0 failed`);
