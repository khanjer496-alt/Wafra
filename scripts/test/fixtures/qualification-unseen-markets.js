/**
 * Held-out markets: bank alerts from countries Wafra has NO grammar for.
 *
 * `alertMarketPack()` answers for exactly fourteen markets — US GB FR DE ES IT
 * NL IN QA KW BH OM EG JO — and `MARKETS` carries AE and SA for the launch
 * ledger parser. Every market in this file is outside both sets, on purpose.
 * Nothing here has ever been used to develop a rule, so it measures
 * generalisation rather than recall of the corpus the parser was written
 * against.
 *
 * EVIDENCE CLASS — read `./README.md` first.
 *
 * Every row is `synthetic` / `near-real-template`. These are OUR
 * reconstruction of what we believe these banks send, not ground truth about
 * what they do send. Per the corpus rules a synthetic row can never count as
 * evidence that a bank or market is supported, and the qualification harness
 * enforces that: `scripts/parser-benchmark/qualification.mjs` refuses to let a
 * synthetic row contribute to automatic-import eligibility, and reports the
 * held-out section separately from anything derived from public examples.
 *
 * Institution names, card tails, amounts, merchants and people are fictional.
 * They are plausible for the market's language and formatting conventions,
 * which is the point — the parser has to cope with a decimal comma, a dotted
 * thousands separator, a zero-decimal currency and a non-Latin script without
 * ever having seen the bank.
 *
 * WHAT EACH ROW IS FOR
 *
 * Per market: one posted debit (can the amount and direction be read at all),
 * one declined or otherwise non-posting alert (does it correctly refuse to
 * write a row), and one other family — a credit, a transfer, a withdrawal or
 * a bill. The declined rows are the ones that matter most: an engine that
 * reads them as spending invents money, which is the metric the whole
 * qualification exists to hold at zero.
 */

/** Minor-unit digits come from `currency-metadata.js`; VND is 0, the rest here are 2. */
const rows = Object.freeze([
  /* ── Brazil — decimal comma ─────────────────────────────────────────── */
  {
    id: 'br-cartao-posted', market: 'BR', institution: 'fictional-br-bank',
    sender: 'BANCOEX', channel: 'sms',
    provenance: 'synthetic', basis: 'near-real-template', sourceRef: 'held-out-market-v1',
    body: 'BancoEx: Compra aprovada no cartao final 3312 de BRL 148,90 em PADARIA CENTRAL em 21/09.',
    expected: { decision: 'review', status: 'posted', family: 'purchase', direction: 'debit', currency: 'BRL', minorUnits: '14890' },
  },
  {
    id: 'br-cartao-negada', market: 'BR', institution: 'fictional-br-bank',
    sender: 'BANCOEX', channel: 'sms',
    provenance: 'synthetic', basis: 'near-real-template', sourceRef: 'held-out-market-v1',
    body: 'BancoEx: Compra NEGADA de BRL 92,40 em LIVRARIA SUL no cartao final 3312.',
    expected: { decision: 'refuse', status: 'failed', family: 'purchase', direction: 'none', currency: 'BRL', minorUnits: '9240' },
  },
  {
    id: 'br-pix-recebido', market: 'BR', institution: 'fictional-br-bank',
    sender: 'BANCOEX', channel: 'sms',
    provenance: 'synthetic', basis: 'near-real-template', sourceRef: 'held-out-market-v1',
    body: 'BancoEx: Voce recebeu um Pix de BRL 1.250,00 de M. ALVES. Saldo disponivel BRL 4.310,22.',
    expected: { decision: 'review', status: 'posted', family: 'transfer', direction: 'credit', currency: 'BRL', minorUnits: '125000' },
  },

  /* ── Turkey ─────────────────────────────────────────────────────────── */
  {
    id: 'tr-kart-harcama', market: 'TR', institution: 'fictional-tr-bank',
    sender: 'TRBANKA', channel: 'sms',
    provenance: 'synthetic', basis: 'near-real-template', sourceRef: 'held-out-market-v1',
    body: 'TRBanka: 5678 numarali kartinizla TRY 349,75 tutarinda EL MARKET alisverisi gerceklesti.',
    expected: { decision: 'review', status: 'posted', family: 'purchase', direction: 'debit', currency: 'TRY', minorUnits: '34975' },
  },
  {
    id: 'tr-kart-reddedildi', market: 'TR', institution: 'fictional-tr-bank',
    sender: 'TRBANKA', channel: 'sms',
    provenance: 'synthetic', basis: 'near-real-template', sourceRef: 'held-out-market-v1',
    body: 'TRBanka: TRY 780,00 tutarindaki islem REDDEDILDI. Kart: 5678.',
    expected: { decision: 'refuse', status: 'failed', family: 'purchase', direction: 'none', currency: 'TRY', minorUnits: '78000' },
  },
  {
    id: 'tr-atm-cekim', market: 'TR', institution: 'fictional-tr-bank',
    sender: 'TRBANKA', channel: 'sms',
    provenance: 'synthetic', basis: 'near-real-template', sourceRef: 'held-out-market-v1',
    body: 'TRBanka: ATM nakit cekim TRY 1.000,00. Kart 5678. Kullanilabilir bakiye TRY 2.430,10.',
    expected: { decision: 'review', status: 'posted', family: 'cash-withdrawal', direction: 'debit', currency: 'TRY', minorUnits: '100000' },
  },

  /* ── Poland ─────────────────────────────────────────────────────────── */
  {
    id: 'pl-karta-transakcja', market: 'PL', institution: 'fictional-pl-bank',
    sender: 'PLBANK', channel: 'sms',
    provenance: 'synthetic', basis: 'near-real-template', sourceRef: 'held-out-market-v1',
    body: 'PLBank: Karta ...4455. Transakcja PLN 89,99 w SKLEP DOBRY. Dostepne srodki PLN 1 234,56.',
    expected: { decision: 'review', status: 'posted', family: 'purchase', direction: 'debit', currency: 'PLN', minorUnits: '8999' },
  },
  {
    id: 'pl-karta-odrzucona', market: 'PL', institution: 'fictional-pl-bank',
    sender: 'PLBANK', channel: 'sms',
    provenance: 'synthetic', basis: 'near-real-template', sourceRef: 'held-out-market-v1',
    body: 'PLBank: Transakcja PLN 210,00 w STACJA PALIW zostala ODRZUCONA. Karta ...4455.',
    expected: { decision: 'refuse', status: 'failed', family: 'purchase', direction: 'none', currency: 'PLN', minorUnits: '21000' },
  },
  {
    id: 'pl-przelew-wychodzacy', market: 'PL', institution: 'fictional-pl-bank',
    sender: 'PLBANK', channel: 'sms',
    provenance: 'synthetic', basis: 'near-real-template', sourceRef: 'held-out-market-v1',
    body: 'PLBank: Przelew wychodzacy PLN 450,00 do J. NOWAK zostal zrealizowany.',
    expected: { decision: 'review', status: 'posted', family: 'transfer', direction: 'debit', currency: 'PLN', minorUnits: '45000' },
  },

  /* ── Sweden ─────────────────────────────────────────────────────────── */
  {
    id: 'se-kortkop', market: 'SE', institution: 'fictional-se-bank',
    sender: 'SEBANK', channel: 'sms',
    provenance: 'synthetic', basis: 'near-real-template', sourceRef: 'held-out-market-v1',
    body: 'SEBank: Kortkop SEK 245,00 hos NORRA KAFE med kort som slutar 7788.',
    expected: { decision: 'review', status: 'posted', family: 'purchase', direction: 'debit', currency: 'SEK', minorUnits: '24500' },
  },
  {
    id: 'se-nekad', market: 'SE', institution: 'fictional-se-bank',
    sender: 'SEBANK', channel: 'sms',
    provenance: 'synthetic', basis: 'near-real-template', sourceRef: 'held-out-market-v1',
    body: 'SEBank: Kortkop SEK 1 120,00 hos ELEKTRONIK AB NEKADES. Kort 7788.',
    expected: { decision: 'refuse', status: 'failed', family: 'purchase', direction: 'none', currency: 'SEK', minorUnits: '112000' },
  },
  {
    id: 'se-lon-insatt', market: 'SE', institution: 'fictional-se-bank',
    sender: 'SEBANK', channel: 'sms',
    provenance: 'synthetic', basis: 'near-real-template', sourceRef: 'held-out-market-v1',
    body: 'SEBank: Lon SEK 28 400,00 har satts in pa ditt konto.',
    expected: { decision: 'review', status: 'posted', family: 'transfer', direction: 'credit', currency: 'SEK', minorUnits: '2840000' },
  },

  /* ── Vietnam — ZERO-DECIMAL currency ────────────────────────────────── */
  {
    id: 'vn-the-giao-dich', market: 'VN', institution: 'fictional-vn-bank',
    sender: 'VNBANK', channel: 'sms',
    provenance: 'synthetic', basis: 'near-real-template', sourceRef: 'held-out-market-v1',
    // VND has no minor unit: 450,000 VND is 450000 minor units, not 45000000.
    body: 'VNBank: TK 0123 GD: -450,000 VND tai SIEU THI MINH. So du: 3,200,000 VND.',
    expected: { decision: 'review', status: 'posted', family: 'purchase', direction: 'debit', currency: 'VND', minorUnits: '450000' },
  },
  {
    id: 'vn-tu-choi', market: 'VN', institution: 'fictional-vn-bank',
    sender: 'VNBANK', channel: 'sms',
    provenance: 'synthetic', basis: 'near-real-template', sourceRef: 'held-out-market-v1',
    body: 'VNBank: Giao dich 1,850,000 VND tai CUA HANG DIEN MAY bi TU CHOI. The 0123.',
    expected: { decision: 'refuse', status: 'failed', family: 'purchase', direction: 'none', currency: 'VND', minorUnits: '1850000' },
  },
  {
    id: 'vn-rut-tien', market: 'VN', institution: 'fictional-vn-bank',
    sender: 'VNBANK', channel: 'sms',
    provenance: 'synthetic', basis: 'near-real-template', sourceRef: 'held-out-market-v1',
    body: 'VNBank: Rut tien ATM 2,000,000 VND. TK 0123.',
    expected: { decision: 'review', status: 'posted', family: 'cash-withdrawal', direction: 'debit', currency: 'VND', minorUnits: '2000000' },
  },

  /* ── Indonesia — DOTTED thousands separator ─────────────────────────── */
  {
    id: 'id-transaksi-kartu', market: 'ID', institution: 'fictional-id-bank',
    sender: 'IDBANK', channel: 'sms',
    provenance: 'synthetic', basis: 'near-real-template', sourceRef: 'held-out-market-v1',
    // "250.000" is two hundred fifty thousand rupiah, not two hundred fifty.
    body: 'IDBank: Transaksi kartu 8812 sebesar IDR 250.000 di TOKO SEJAHTERA.',
    expected: { decision: 'review', status: 'posted', family: 'purchase', direction: 'debit', currency: 'IDR', minorUnits: '25000000' },
  },
  {
    id: 'id-transaksi-ditolak', market: 'ID', institution: 'fictional-id-bank',
    sender: 'IDBANK', channel: 'sms',
    provenance: 'synthetic', basis: 'near-real-template', sourceRef: 'held-out-market-v1',
    body: 'IDBank: Transaksi IDR 1.750.000 di ELEKTRONIK JAYA DITOLAK. Kartu 8812.',
    expected: { decision: 'refuse', status: 'failed', family: 'purchase', direction: 'none', currency: 'IDR', minorUnits: '175000000' },
  },
  {
    id: 'id-tagihan-listrik', market: 'ID', institution: 'fictional-id-bank',
    sender: 'IDBANK', channel: 'sms',
    provenance: 'synthetic', basis: 'near-real-template', sourceRef: 'held-out-market-v1',
    body: 'IDBank: Pembayaran tagihan listrik IDR 430.500 berhasil.',
    expected: { decision: 'review', status: 'posted', family: 'utility', direction: 'debit', currency: 'IDR', minorUnits: '43050000' },
  },

  /* ── Thailand — Thai script ─────────────────────────────────────────── */
  {
    id: 'th-card-posted', market: 'TH', institution: 'fictional-th-bank',
    sender: 'THBANK', channel: 'sms',
    provenance: 'synthetic', basis: 'near-real-template', sourceRef: 'held-out-market-v1',
    body: 'THBank: ชำระเงิน THB 1,250.00 ที่ ร้านกาแฟสุข ด้วยบัตร 9911',
    expected: { decision: 'review', status: 'posted', family: 'purchase', direction: 'debit', currency: 'THB', minorUnits: '125000' },
  },
  {
    id: 'th-card-declined', market: 'TH', institution: 'fictional-th-bank',
    sender: 'THBANK', channel: 'sms',
    provenance: 'synthetic', basis: 'near-real-template', sourceRef: 'held-out-market-v1',
    body: 'THBank: รายการ THB 4,800.00 ถูกปฏิเสธ บัตร 9911',
    expected: { decision: 'refuse', status: 'failed', family: 'purchase', direction: 'none', currency: 'THB', minorUnits: '480000' },
  },
  {
    id: 'th-refund', market: 'TH', institution: 'fictional-th-bank',
    sender: 'THBANK', channel: 'sms',
    provenance: 'synthetic', basis: 'near-real-template', sourceRef: 'held-out-market-v1',
    body: 'THBank: คืนเงิน THB 620.00 เข้าบัตร 9911',
    expected: { decision: 'review', status: 'posted', family: 'refund', direction: 'credit', currency: 'THB', minorUnits: '62000' },
  },

  /* ── Pakistan ───────────────────────────────────────────────────────── */
  {
    id: 'pk-card-posted', market: 'PK', institution: 'fictional-pk-bank',
    sender: 'PKBANK', channel: 'sms',
    provenance: 'synthetic', basis: 'near-real-template', sourceRef: 'held-out-market-v1',
    body: 'PKBank: Your card ending 2244 was used for PKR 3,500.00 at AL FAISAL STORE.',
    expected: { decision: 'review', status: 'posted', family: 'purchase', direction: 'debit', currency: 'PKR', minorUnits: '350000' },
  },
  {
    id: 'pk-card-declined', market: 'PK', institution: 'fictional-pk-bank',
    sender: 'PKBANK', channel: 'sms',
    provenance: 'synthetic', basis: 'near-real-template', sourceRef: 'held-out-market-v1',
    body: 'PKBank: Transaction of PKR 18,000.00 at CITY ELECTRONICS was declined. Card 2244.',
    expected: { decision: 'refuse', status: 'failed', family: 'purchase', direction: 'none', currency: 'PKR', minorUnits: '1800000' },
  },
  {
    id: 'pk-atm', market: 'PK', institution: 'fictional-pk-bank',
    sender: 'PKBANK', channel: 'sms',
    provenance: 'synthetic', basis: 'near-real-template', sourceRef: 'held-out-market-v1',
    body: 'PKBank: Cash withdrawal PKR 10,000.00 from ATM. Card 2244. Balance PKR 47,220.00.',
    expected: { decision: 'review', status: 'posted', family: 'cash-withdrawal', direction: 'debit', currency: 'PKR', minorUnits: '1000000' },
  },

  /* ── Morocco — Arabic script, non-AE/SA ─────────────────────────────── */
  {
    id: 'ma-achat-posted', market: 'MA', institution: 'fictional-ma-bank',
    sender: 'MABANK', channel: 'sms',
    provenance: 'synthetic', basis: 'near-real-template', sourceRef: 'held-out-market-v1',
    body: 'MABank: Achat de MAD 320,00 chez EPICERIE ATLAS avec carte se terminant par 6677.',
    expected: { decision: 'review', status: 'posted', family: 'purchase', direction: 'debit', currency: 'MAD', minorUnits: '32000' },
  },
  {
    id: 'ma-refuse', market: 'MA', institution: 'fictional-ma-bank',
    sender: 'MABANK', channel: 'sms',
    provenance: 'synthetic', basis: 'near-real-template', sourceRef: 'held-out-market-v1',
    body: 'MABank: Operation de MAD 1 450,00 REFUSEE. Carte 6677.',
    expected: { decision: 'refuse', status: 'failed', family: 'purchase', direction: 'none', currency: 'MAD', minorUnits: '145000' },
  },
  {
    id: 'ma-arabic-purchase', market: 'MA', institution: 'fictional-ma-bank',
    sender: 'MABANK', channel: 'sms',
    provenance: 'synthetic', basis: 'near-real-template', sourceRef: 'held-out-market-v1',
    body: 'MABank: شراء بمبلغ 275,50 درهم لدى مقهى الأطلس بالبطاقة المنتهية 6677.',
    expected: { decision: 'review', status: 'posted', family: 'purchase', direction: 'debit', currency: 'MAD', minorUnits: '27550' },
  },

  /* ── Kenya ──────────────────────────────────────────────────────────── */
  {
    id: 'ke-card-posted', market: 'KE', institution: 'fictional-ke-bank',
    sender: 'KEBANK', channel: 'sms',
    provenance: 'synthetic', basis: 'near-real-template', sourceRef: 'held-out-market-v1',
    body: 'KEBank: Confirmed. KES 2,450.00 paid to MAMA MBOGA SHOP from card ending 5521.',
    expected: { decision: 'review', status: 'posted', family: 'purchase', direction: 'debit', currency: 'KES', minorUnits: '245000' },
  },
  {
    id: 'ke-card-failed', market: 'KE', institution: 'fictional-ke-bank',
    sender: 'KEBANK', channel: 'sms',
    provenance: 'synthetic', basis: 'near-real-template', sourceRef: 'held-out-market-v1',
    body: 'KEBank: Sorry, your payment of KES 8,900.00 to NAKURU HARDWARE failed. Card 5521.',
    expected: { decision: 'refuse', status: 'failed', family: 'purchase', direction: 'none', currency: 'KES', minorUnits: '890000' },
  },
  {
    id: 'ke-transfer-in', market: 'KE', institution: 'fictional-ke-bank',
    sender: 'KEBANK', channel: 'sms',
    provenance: 'synthetic', basis: 'near-real-template', sourceRef: 'held-out-market-v1',
    body: 'KEBank: You have received KES 15,000.00 from A. WANJIKU. New balance KES 22,140.00.',
    expected: { decision: 'review', status: 'posted', family: 'transfer', direction: 'credit', currency: 'KES', minorUnits: '1500000' },
  },

  /* ── Nigeria ────────────────────────────────────────────────────────── */
  {
    id: 'ng-debit-alert', market: 'NG', institution: 'fictional-ng-bank',
    sender: 'NGBANK', channel: 'sms',
    provenance: 'synthetic', basis: 'near-real-template', sourceRef: 'held-out-market-v1',
    body: 'NGBank: Debit Alert. NGN 12,500.00 on card 3390 at LEKKI SUPERMART.',
    expected: { decision: 'review', status: 'posted', family: 'purchase', direction: 'debit', currency: 'NGN', minorUnits: '1250000' },
  },
  {
    id: 'ng-declined', market: 'NG', institution: 'fictional-ng-bank',
    sender: 'NGBANK', channel: 'sms',
    provenance: 'synthetic', basis: 'near-real-template', sourceRef: 'held-out-market-v1',
    body: 'NGBank: Your transaction of NGN 45,000.00 at IKEJA STORES was declined.',
    expected: { decision: 'refuse', status: 'failed', family: 'purchase', direction: 'none', currency: 'NGN', minorUnits: '4500000' },
  },
  {
    id: 'ng-credit-alert', market: 'NG', institution: 'fictional-ng-bank',
    sender: 'NGBANK', channel: 'sms',
    provenance: 'synthetic', basis: 'near-real-template', sourceRef: 'held-out-market-v1',
    body: 'NGBank: Credit Alert. NGN 220,000.00 salary payment received.',
    expected: { decision: 'review', status: 'posted', family: 'transfer', direction: 'credit', currency: 'NGN', minorUnits: '22000000' },
  },

  /* ── South Africa ───────────────────────────────────────────────────── */
  {
    id: 'za-card-purchase', market: 'ZA', institution: 'fictional-za-bank',
    sender: 'ZABANK', channel: 'sms',
    provenance: 'synthetic', basis: 'near-real-template', sourceRef: 'held-out-market-v1',
    body: 'ZABank: Card purchase of ZAR 389.45 at KLOOF GROCER on card ending 4412.',
    expected: { decision: 'review', status: 'posted', family: 'purchase', direction: 'debit', currency: 'ZAR', minorUnits: '38945' },
  },
  {
    id: 'za-card-declined', market: 'ZA', institution: 'fictional-za-bank',
    sender: 'ZABANK', channel: 'sms',
    provenance: 'synthetic', basis: 'near-real-template', sourceRef: 'held-out-market-v1',
    body: 'ZABank: Purchase of ZAR 2 150.00 at SANDTON OUTFITTERS was DECLINED. Card 4412.',
    expected: { decision: 'refuse', status: 'failed', family: 'purchase', direction: 'none', currency: 'ZAR', minorUnits: '215000' },
  },
  {
    id: 'za-debit-order', market: 'ZA', institution: 'fictional-za-bank',
    sender: 'ZABANK', channel: 'sms',
    provenance: 'synthetic', basis: 'near-real-template', sourceRef: 'held-out-market-v1',
    body: 'ZABank: Debit order of ZAR 799.00 for KLOOF INSURANCE has been processed.',
    expected: { decision: 'review', status: 'posted', family: 'recurring-payment', direction: 'debit', currency: 'ZAR', minorUnits: '79900' },
  },

  /* ── Philippines ────────────────────────────────────────────────────── */
  {
    id: 'ph-card-used', market: 'PH', institution: 'fictional-ph-bank',
    sender: 'PHBANK', channel: 'sms',
    provenance: 'synthetic', basis: 'near-real-template', sourceRef: 'held-out-market-v1',
    body: 'PHBank: Your card ending 7701 was used for PHP 1,899.00 at MAKATI SUPERMARKET.',
    expected: { decision: 'review', status: 'posted', family: 'purchase', direction: 'debit', currency: 'PHP', minorUnits: '189900' },
  },
  {
    id: 'ph-card-declined', market: 'PH', institution: 'fictional-ph-bank',
    sender: 'PHBANK', channel: 'sms',
    provenance: 'synthetic', basis: 'near-real-template', sourceRef: 'held-out-market-v1',
    body: 'PHBank: Transaction of PHP 12,400.00 at CEBU GADGETS was not approved. Card 7701.',
    expected: { decision: 'refuse', status: 'failed', family: 'purchase', direction: 'none', currency: 'PHP', minorUnits: '1240000' },
  },
  {
    id: 'ph-bill-paid', market: 'PH', institution: 'fictional-ph-bank',
    sender: 'PHBANK', channel: 'sms',
    provenance: 'synthetic', basis: 'near-real-template', sourceRef: 'held-out-market-v1',
    body: 'PHBank: Bills payment of PHP 2,340.50 to MANILA WATER was successful.',
    expected: { decision: 'review', status: 'posted', family: 'utility', direction: 'debit', currency: 'PHP', minorUnits: '234050' },
  },

  /* ── Mexico ─────────────────────────────────────────────────────────── */
  {
    id: 'mx-compra', market: 'MX', institution: 'fictional-mx-bank',
    sender: 'MXBANCO', channel: 'sms',
    provenance: 'synthetic', basis: 'near-real-template', sourceRef: 'held-out-market-v1',
    body: 'MXBanco: Compra por MXN 540.25 en FARMACIA DEL SOL con tarjeta terminacion 3344.',
    expected: { decision: 'review', status: 'posted', family: 'purchase', direction: 'debit', currency: 'MXN', minorUnits: '54025' },
  },
  {
    id: 'mx-rechazada', market: 'MX', institution: 'fictional-mx-bank',
    sender: 'MXBANCO', channel: 'sms',
    provenance: 'synthetic', basis: 'near-real-template', sourceRef: 'held-out-market-v1',
    body: 'MXBanco: Su compra por MXN 3,200.00 en TIENDA NORTE fue RECHAZADA. Tarjeta 3344.',
    expected: { decision: 'refuse', status: 'failed', family: 'purchase', direction: 'none', currency: 'MXN', minorUnits: '320000' },
  },
  {
    id: 'mx-comision', market: 'MX', institution: 'fictional-mx-bank',
    sender: 'MXBANCO', channel: 'sms',
    provenance: 'synthetic', basis: 'near-real-template', sourceRef: 'held-out-market-v1',
    body: 'MXBanco: Se aplico una comision por manejo de cuenta de MXN 180.00.',
    expected: { decision: 'review', status: 'posted', family: 'fee', direction: 'debit', currency: 'MXN', minorUnits: '18000' },
  },
]);

module.exports = rows;
