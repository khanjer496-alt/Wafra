// Cases for the SMS carrier-duplicate fold (auto-import.ts
// hasCarrierDuplicateIdentity): may a byte-identical SMS from the same sender,
// minutes later, be treated as a second delivery of ONE message?
//
// [body, fold]
//
// Only two things are unique to one posting:
//   - an explicit transaction date + time WITH SECONDS, the same rule
//     NotificationCaptureStore.TRANSACTION_DATETIME_RE applies to notification
//     re-posts (kotlin-regex.test.js checks the two patterns are identical);
//   - a balance FIGURE after a balance label, which moves with every charge.
// A bare hh:mm is NOT enough: a double tap or a merchant charging twice in one
// minute produces identical text and both charges are real. Static footers
// (offers, hotlines, "available at 1000+ outlets", card expiry) and reference
// or limit wording are never enough either.
module.exports = [
  ['Credit Card XX7720 was used for AED25.90 on 14/09/2026 23:52:52 at TEST MERCHANT', true],
  ['AED300.00 debited from Acc/Cr.Card XXX7720 for Salik on 11-02-2025 09:03:37 through ADCB Mobile App.', true],
  ['Purchase of AED 50.00 at CARREFOUR. Avl Bal AED 1,234.00', true],
  ['AED 50.00 spent at CAFE. Available balance is AED 900.00', true],
  ['تم خصم 150.00 درهم من حسابك. الرصيد المتاح 2500.00 درهم', true],
  ['شراء عبر نقاط البيع\nبطاقة: **1234;الإئتمانية\nمبلغ: 12.00 SAR\nرصيد: 1234.56 SAR', true],
  // Minute precision: never folds an SMS.
  ['Purchase of AED 110.00 at TABBY on 03/07/26 05:53.', false],
  ['Purchase of AED 50.00 at CARREFOUR at 9:05. Card ending 1234', false],
  ['عملية شراء بمبلغ 50 ريال الساعة ١٤:٣٢', false],
  // Shipped fixtures bank-albilad-arabic-mada-pos and adib-compact-masked-card.
  ['مشتريات نقاط البيع\nبطاقة: **4567;مدى\nمن: xx005\nمبلغ: 34.00 SAR\nلدى: Some restaurant\nدولة: السعودية\nفي: 2019/05/07 01:29', false],
  ['XXX456789 was used for AED 42.50 on Jan 17 2023 1:04PM at CARREFOUR,AE.', false],
  // Nothing unique to one posting.
  ['Purchase of AED 50.00 at CARREFOUR with Debit Card ending 1234', false],
  ['Card purchase CAD 24.90 at LOCAL CAFE.', false],
  ['AED 12.00 spent at CAFE on 14/09/2026', false],
  ['Your refund of AED 30.00 from NOON has been processed', false],
  ['AED 12.00 spent at CAFE. Check your balance in the app', false],
  ['Transfer of AED 100.00 completed. Ref No: 4829301', false],
  ['Using your card for GHS 120.00 at SHOP. Avl Limit AED 5,000.00', false],
  ['Paiement par carte débité de EUR 9,99 chez PRIVATE-CAFE', false],
  // Static footers.
  ['AED 50.00 spent at CAFE. Avail 0% Easy Payment Plan 600 52 2229', false],
  ['AED 50.00 spent at CAFE. Available to use at 1000+ outlets', false],
  ['AED 50.00 spent at CAFE. Balance transfer offer 3 months', false],
  ['AED 50.00 spent at CAFE. Balance transfer offer AED 5,000.00', false],
  ['AED 50.00 spent at CAFE with card 1234 exp 12:26', false],
  ['تم خصم 50 ريال. للاستفسار المتاح 24 ساعة 8001240', false],
];
