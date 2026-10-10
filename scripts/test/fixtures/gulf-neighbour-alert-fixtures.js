// Gulf-neighbour (Qatar, Kuwait, Bahrain, Oman) alert fixtures.
//
// Every row is written in Wafra's own words with fictional values: SAMPLE
// merchants, TEST PERSON, last four 1234, dates in 2026. No text is copied
// from any third-party corpus or repository.
//
// provenance:
//  - 'synthetic': invented to exercise the shared English/Arabic launch
//    families on a neighbour route. No real QA/KW/BH alert text exists, so
//    every QA, KW and BH row is synthetic.
//  - 'community-derived': reconstructs the STRUCTURE of the one Bank Muscat
//    family documented in the research spec (OM-BM-1, abstracted from three
//    community-collected alerts); the bank's fixed Arabic template words are
//    its own, every value here is invented.
// None of these is a consented real alert; none counts toward any gate.
//
// expect: 'certified' (exact per-bank template, unmarked), 'best-effort'
// (launch grammar, "Auto-added — check" marker), or 'never' (no row).
'use strict';

const POSTING = [
  // Kuwait
  { id: 'kw-en-purchase', market: 'KW', ledger: 'KWD', sender: 'NBK', provenance: 'synthetic',
    text: 'Purchase of KWD 12.345 with Debit Card ending 1234 at SAMPLE SHOP on 05/10/2026. Avl Bal KWD 250.500',
    expect: 'best-effort', type: 'expense', minor: 12345, date: '2026-10-05' },
  { id: 'kw-en-purchase-kd', market: 'KW', ledger: 'KWD', sender: 'NBK', provenance: 'synthetic',
    text: 'Purchase of KD 0.650 with Debit Card ending 1234 at SAMPLE CAFE on 05/10/2026. Avl Bal KD 250.500',
    expect: 'best-effort', type: 'expense', minor: 650, date: '2026-10-05' },
  { id: 'kw-en-debit', market: 'KW', ledger: 'KWD', sender: 'KFH', provenance: 'synthetic',
    text: 'KWD 7.250 debited from A/C XX1234 on 05/10/2026 at SAMPLE PHARMACY. Avl Bal KWD 99.100',
    expect: 'best-effort', type: 'expense', minor: 7250, date: '2026-10-05' },
  { id: 'kw-ar-debit', market: 'KW', ledger: 'KWD', sender: 'KFH', provenance: 'synthetic',
    text: 'تم خصم 3.500 د.ك من حسابك رقم XXXX1234 لدى SAMPLE SHOP. رصيدك الحالي 120.250 د.ك',
    expect: 'best-effort', type: 'expense', minor: 3500, date: null },
  { id: 'kw-en-atm', market: 'KW', ledger: 'KWD', sender: 'KFH', provenance: 'synthetic',
    text: 'KWD 20.000 withdrawn from ATM using card ending 1234 on 05/10/2026. Avl Bal KWD 180.500',
    expect: 'best-effort', type: 'expense', minor: 20000, date: '2026-10-05' },
  // Qatar
  { id: 'qa-en-purchase', market: 'QA', ledger: 'QAR', sender: 'QNB', provenance: 'synthetic',
    text: 'Purchase of QAR 150.00 with Credit Card ending 1234 at SAMPLE MARKET on 05/10/2026. Avl limit QAR 9,000.00',
    expect: 'best-effort', type: 'expense', minor: 15000, date: '2026-10-05' },
  { id: 'qa-en-qr', market: 'QA', ledger: 'QAR', sender: 'QNB', provenance: 'synthetic',
    text: 'Purchase of QR 42.50 with Credit Card ending 1234 at SAMPLE BAKERY on 05/10/2026.',
    expect: 'best-effort', type: 'expense', minor: 4250, date: '2026-10-05' },
  { id: 'qa-en-transfer-out', market: 'QA', ledger: 'QAR', sender: 'CBQ', provenance: 'synthetic',
    text: 'QAR 500.00 has been debited from your account XX1234 for a transfer to TEST PERSON on 05/10/2026. Avl Bal QAR 4,500.00',
    expect: 'best-effort', type: 'expense', minor: 50000, date: '2026-10-05' },
  { id: 'qa-ar-purchase', market: 'QA', ledger: 'QAR', sender: 'QIB', provenance: 'synthetic',
    text: 'تم خصم 85.00 ر.ق من بطاقتك المنتهية 1234 لدى SAMPLE MARKET',
    expect: 'best-effort', type: 'expense', minor: 8500, date: null },
  // Bahrain
  { id: 'bh-en-credit', market: 'BH', ledger: 'BHD', sender: 'NBB', provenance: 'synthetic',
    text: 'BHD 4.250 credited to your A/C XX1234 on 05/10/2026. Avl Bal BHD 300.000',
    expect: 'best-effort', type: 'income', minor: 4250, date: '2026-10-05' },
  { id: 'bh-en-salary', market: 'BH', ledger: 'BHD', sender: 'BBK', provenance: 'synthetic',
    text: 'Salary of BHD 850.000 has been credited to your account XX1234 on 01/10/2026. Avl Bal BHD 1,200.000',
    expect: 'best-effort', type: 'income', minor: 850000, date: '2026-10-01' },
  { id: 'bh-en-refund', market: 'BH', ledger: 'BHD', sender: 'NBB', provenance: 'synthetic',
    text: 'A refund of BHD 3.750 from SAMPLE SHOP has been credited to your card ending 1234 on 05/10/2026.',
    expect: 'best-effort', type: 'income', minor: 3750, date: '2026-10-05' },
  // Oman: launch grammar for families with no template
  { id: 'om-en-credit-ro', market: 'OM', ledger: 'OMR', sender: 'BankDhofar', provenance: 'synthetic',
    text: 'RO 250.000 has been credited to your account XXXX1234 on 01/10/2026. Avl Bal RO 1,250.500',
    expect: 'best-effort', type: 'income', minor: 250000, date: '2026-10-01' },
  { id: 'om-ar-salary', market: 'OM', ledger: 'OMR', sender: 'BankMuscat', provenance: 'synthetic',
    text: 'تم إيداع راتب بمبلغ 850.000 ريال عماني في حسابك رقم XXXX1234',
    expect: 'best-effort', type: 'income', minor: 850000, date: null },
  // Oman: OM-BM-1 certified template (OMR after, then before the amount)
  { id: 'om-bm1-suffix', market: 'OM', ledger: 'OMR', sender: 'BankMuscat', provenance: 'community-derived',
    text: 'تم خصم 0.750 OMR من حسابك رقم XXXXX1234 بإستخدام بطاقة الخصم المباشر في 123456-SAMPLE GROCERY MUSCAT بتاريخ 2026/10/02 14:43:57. رصيدك الحالي هو 500.120 OMR.',
    expect: 'certified', type: 'expense', minor: 750, date: '2026-10-02', merchant: 'SAMPLE GROCERY MUSCAT', last4: '1234' },
  { id: 'om-bm1-prefix', market: 'OM', ledger: 'OMR', sender: 'BankMuscat', provenance: 'community-derived',
    text: 'تم خصم OMR 1.200 من حسابك رقم XXXXXXX1234 بإستخدام بطاقة الخصم المباشر في SAMPLE CAFE-654321 SEEB بتاريخ 2026/10/03 09:15:00. رصيدك الحالي هو 1498.920 OMR.',
    expect: 'certified', type: 'expense', minor: 1200, date: '2026-10-03', merchant: 'SAMPLE CAFE SEEB', last4: '1234' },
  { id: 'om-bm1-grouped', market: 'OM', ledger: 'OMR', sender: 'BankMuscat', provenance: 'community-derived',
    text: 'تم خصم 1,250.000 OMR من حسابك رقم XXXXX1234 بإستخدام بطاقة الخصم المباشر في SAMPLE FURNITURE-778899 بتاريخ 2026/10/04 18:02:11. رصيدك الحالي هو 2,100.500 OMR.',
    expect: 'certified', type: 'expense', minor: 1250000, date: '2026-10-04', merchant: 'SAMPLE FURNITURE', last4: '1234' },
];

// Never-post cases, English and Arabic, each on a recognised-institution route.
const NEVER = [
  { id: 'otp-en', market: 'KW', ledger: 'KWD', sender: 'NBK', text: 'Your OTP for purchase of KWD 12.345 at SAMPLE SHOP is 123456. Do not share it.' },
  { id: 'otp-ar', market: 'KW', ledger: 'KWD', sender: 'NBK', text: 'رمز التحقق 482913 لعملية شراء بمبلغ 12.345 د.ك لدى SAMPLE SHOP. لا تشاركه مع أحد' },
  { id: 'decline-en', market: 'KW', ledger: 'KWD', sender: 'NBK', text: 'Purchase of KWD 12.345 with Debit Card ending 1234 at SAMPLE SHOP was declined due to insufficient balance.' },
  { id: 'decline-ar', market: 'KW', ledger: 'KWD', sender: 'KFH', text: 'عملية شراء بمبلغ 12.345 د.ك من بطاقتك المنتهية 1234 لدى SAMPLE SHOP مرفوضة' },
  { id: 'pending-en', market: 'BH', ledger: 'BHD', sender: 'NBB', text: 'A transaction of BHD 4.250 at SAMPLE SHOP on card ending 1234 is pending.' },
  { id: 'pending-ar', market: 'BH', ledger: 'BHD', sender: 'NBB', text: 'عملية بمبلغ 4.250 د.ب على بطاقتك المنتهية 1234 لدى SAMPLE SHOP معلقة' },
  { id: 'promo-en', market: 'QA', ledger: 'QAR', sender: 'QNB', text: 'QNB: Get 10% cashback on purchases above QAR 200.00 at SAMPLE MALL this weekend. T&Cs apply.' },
  { id: 'promo-ar', market: 'QA', ledger: 'QAR', sender: 'QNB', text: 'عرض خاص: استرداد نقدي 10% على مشترياتك فوق 200.00 ر.ق لدى SAMPLE MALL' },
  { id: 'balance-en', market: 'OM', ledger: 'OMR', sender: 'BankMuscat', text: 'Your available balance in account XXXX1234 is OMR 500.120 as of 05/10/2026.' },
  { id: 'balance-ar', market: 'OM', ledger: 'OMR', sender: 'BankMuscat', text: 'رصيدك الحالي هو 500.120 OMR في حسابك رقم XXXXX1234' },
  { id: 'limit-en', market: 'KW', ledger: 'KWD', sender: 'NBK', text: 'Your credit card ending 1234 limit has been increased to KWD 2,000.000.' },
  { id: 'limit-ar', market: 'KW', ledger: 'KWD', sender: 'NBK', text: 'تم رفع الحد الائتماني لبطاقتك المنتهية 1234 إلى 2,000.000 د.ك' },
  { id: 'ministatement-en', market: 'BH', ledger: 'BHD', sender: 'BBK', text: 'Mini statement A/C XX1234: 01/10 BHD 5.000 DR; 02/10 BHD 12.000 CR; 03/10 BHD 3.500 DR.' },
  { id: 'ministatement-ar', market: 'BH', ledger: 'BHD', sender: 'BBK', text: 'كشف حساب مختصر XX1234: 01/10 سحب 5.000 د.ب؛ 02/10 إيداع 12.000 د.ب' },
  { id: 'billdue-en', market: 'QA', ledger: 'QAR', sender: 'QNB', text: 'Your credit card ending 1234 bill of QAR 1,250.00 is due on 20/10/2026. Minimum due QAR 62.50.' },
  { id: 'billdue-ar', market: 'QA', ledger: 'QAR', sender: 'QNB', text: 'المبلغ المستحق على بطاقتك المنتهية 1234 هو 1,250.00 ر.ق بتاريخ 20/10/2026' },
  // Heading-only notices: no completion verb, no certified template.
  { id: 'heading-en', market: 'KW', ledger: 'KWD', sender: 'NBK', text: 'NBK Card 1234 POS KWD 5.000 SAMPLE SHOP 05/10/2026' },
  { id: 'heading-ar', market: 'KW', ledger: 'KWD', sender: 'NBK', text: 'بطاقة 1234 شراء KWD 5.000 SAMPLE SHOP' },
  // A stated date after the alert arrived.
  { id: 'future-en', market: 'KW', ledger: 'KWD', sender: 'NBK', text: 'Purchase of KWD 12.345 with Debit Card ending 1234 at SAMPLE SHOP on 25/12/2026.' },
  { id: 'future-bm1', market: 'OM', ledger: 'OMR', sender: 'BankMuscat', text: 'تم خصم 0.750 OMR من حسابك رقم XXXXX1234 بإستخدام بطاقة الخصم المباشر في SAMPLE GROCERY بتاريخ 2026/12/02 14:43:57. رصيدك الحالي هو 500.120 OMR.' },
  // A template-shaped alert carrying OTP wording.
  { id: 'bm1-otp', market: 'OM', ledger: 'OMR', sender: 'BankMuscat', text: 'تم خصم 0.750 OMR من حسابك رقم XXXXX1234 بإستخدام بطاقة الخصم المباشر في SAMPLE GROCERY بتاريخ 2026/10/02 14:43:57. رصيدك الحالي هو 500.120 OMR. لا تشارك رمز التحقق' },
  // A comma-written three-decimal figure stays ambiguous even when routed.
  { id: 'comma-kwd', market: 'KW', ledger: 'KWD', sender: 'NBK', text: 'Purchase of KWD 12,500 with Debit Card ending 1234 at SAMPLE SHOP on 05/10/2026.' },
  // A three-digit dot tail in a two-decimal currency is never a decimal.
  { id: 'qar-three-digits', market: 'QA', ledger: 'QAR', sender: 'QNB', text: 'Purchase of QAR 12.345 with Debit Card ending 1234 at SAMPLE SHOP on 05/10/2026.' },
];

module.exports = { POSTING, NEVER, OBSERVED: Date.parse('2026-10-10T08:00:00Z') };
