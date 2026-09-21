/**
 * Messages that must NEVER produce a ledger row, whatever an engine believes.
 *
 * The held-out market corpus asks whether an engine can read an unfamiliar
 * bank. This one asks the opposite and more important question: when a message
 * is not a posted transaction at all, does the engine stay quiet?
 *
 * That is where invented money comes from. A one-time passcode carries a
 * six-digit number; a marketing message carries a price; a fraud warning
 * carries the amount someone is trying to take from you; a delivery notice
 * carries an order total. Every one of them looks, to a model reading for
 * "there is an amount and a merchant here", exactly like spending. The rules
 * refuse them because refusal is written down, not because the amount is
 * hard to find.
 *
 * WHY THIS IS THE HARD SET
 *
 * `validation/semantic-parser/FINDINGS.md` measured what happens when the
 * semantic model is trusted to make this call. A confidence gate tuned to 0
 * unsafe imports on in-domain validation produced 3 unsafe imports one dialect
 * away, and two independently trained models agreed 99.9-100% of the time at
 * high confidence *including on every case where the first was confidently
 * wrong*. Refusal cannot be learned from confidence. So these rows exist to be
 * a gate, not a training signal.
 *
 * `reason` records WHY a row must be refused, so the qualification report can
 * say which kind of refusal an engine is bad at rather than only how many it
 * missed. `security` rows carry a second obligation: they are the ones where
 * a wrong answer costs the user money to a fraudster, not just a wrong chart.
 *
 * WHICH LAYER IS SUPPOSED TO CATCH IT
 *
 * `defence` names the layer that owes the refusal, and it defaults to
 * `semantic`. Two rows are marked `source-trust` instead: a phishing SMS that
 * says "AED 4,300.00 was debited from your account" is, as text, exactly what
 * a genuine debit alert says. Nothing in the wording distinguishes them. What
 * distinguishes them is that it arrives from an unregistered number and links
 * to a credential form, and that is `sourceClass` / trusted-package territory,
 * not the parser's. Scoring those rows against the semantic layer would blame
 * the wrong component and invite a wording heuristic that suppresses real
 * debit alerts. They are reported separately and counted separately.
 *
 * EVIDENCE CLASS — every row is `synthetic` / `near-real-template`. They are
 * our reconstruction of message shapes, with fictional values, names, codes
 * and merchants. Per `./README.md` a synthetic row can never certify a bank or
 * a market. It can, however, disqualify one: refusing to invent money is a
 * property an engine either has or does not, and a synthetic counter-example
 * is enough to show it does not.
 */

const rows = Object.freeze([
  /* ── One-time passcodes: a number that is not money ─────────────────── */
  {
    id: 'neg-otp-plain-en', kind: 'authentication', reason: 'otp-code',
    market: 'GB', sender: 'HSBC', channel: 'sms',
    provenance: 'synthetic', basis: 'near-real-template',
    body: 'Your one-time passcode is 483920. Never share it with anyone, including bank staff.',
  },
  {
    id: 'neg-otp-with-amount-en', kind: 'authentication', reason: 'otp-code-naming-an-amount',
    market: 'GB', sender: 'HSBC', channel: 'sms',
    provenance: 'synthetic', basis: 'near-real-template',
    // The amount is real, the transaction has NOT happened. Authorising is not posting.
    body: 'Use code 771204 to authorise a payment of GBP 240.00 to BRIGHT ELECTRICALS. Do not share this code.',
  },
  {
    id: 'neg-3ds-ar', kind: 'authentication', reason: 'otp-code-naming-an-amount',
    market: 'AE', sender: 'BANK', channel: 'sms',
    provenance: 'synthetic', basis: 'near-real-template',
    body: 'رمز التحقق 918273 لإتمام عملية بمبلغ 560.00 درهم لدى متجر النخيل. لا تشارك الرمز مع أي شخص.',
  },
  {
    id: 'neg-otp-login', kind: 'authentication', reason: 'otp-code',
    market: 'IN', sender: 'HDFCBK', channel: 'sms',
    provenance: 'synthetic', basis: 'near-real-template',
    body: 'OTP 552061 is for logging in to NetBanking. Valid for 5 minutes.',
  },

  /* ── Fraud and security warnings: money the user has NOT spent ──────── */
  {
    id: 'neg-fraud-check-en', kind: 'security', reason: 'fraud-verification-request',
    market: 'US', sender: 'CHASE', channel: 'sms',
    provenance: 'synthetic', basis: 'near-real-template',
    body: 'Did you attempt a USD 1,299.00 purchase at TECH OUTLET? Reply YES or NO. We have not processed it.',
  },
  {
    id: 'neg-fraud-blocked-en', kind: 'security', reason: 'blocked-attempt',
    market: 'GB', sender: 'HSBC', channel: 'sms',
    provenance: 'synthetic', basis: 'near-real-template',
    body: 'We blocked a suspicious attempt of GBP 890.00 on your card ending 3321. No money has left your account.',
  },
  {
    id: 'neg-phishing-en', kind: 'security', reason: 'phishing', defence: 'source-trust',
    market: 'AE', sender: '+971500000000', channel: 'sms',
    provenance: 'synthetic', basis: 'near-real-template',
    // Not from a bank at all. Reads like a debit alert on purpose.
    body: 'ALERT: AED 4,300.00 was debited from your account. If this was not you, verify now at http://secure-verify-account.example/login',
  },
  {
    id: 'neg-phishing-ar', kind: 'security', reason: 'phishing', defence: 'source-trust',
    market: 'SA', sender: '+966500000000', channel: 'sms',
    provenance: 'synthetic', basis: 'near-real-template',
    body: 'تنبيه: تم خصم 2,150.00 ريال من حسابك. إذا لم تكن أنت، حدّث بياناتك فوراً عبر http://verify-account.example',
  },
  {
    id: 'neg-card-blocked', kind: 'security', reason: 'service-notice',
    market: 'AE', sender: 'BANK', channel: 'sms',
    provenance: 'synthetic', basis: 'near-real-template',
    body: 'Your card ending 4412 has been temporarily blocked for your protection. Call us to reactivate.',
  },

  /* ── Marketing: a price is not a purchase ───────────────────────────── */
  {
    id: 'neg-marketing-loan', kind: 'marketing', reason: 'offer',
    market: 'AE', sender: 'BANK', channel: 'sms',
    provenance: 'synthetic', basis: 'near-real-template',
    body: 'Get a personal loan up to AED 250,000 at 3.99% p.a. Apply in the app today. T&C apply.',
  },
  {
    id: 'neg-marketing-cashback', kind: 'marketing', reason: 'offer',
    market: 'SA', sender: 'BANK', channel: 'sms',
    provenance: 'synthetic', basis: 'near-real-template',
    body: 'استمتع باسترداد نقدي حتى 500 ريال عند استخدام بطاقتك في المطاعم هذا الشهر. تطبق الشروط.',
  },
  {
    id: 'neg-marketing-retail', kind: 'marketing', reason: 'offer',
    market: 'GB', sender: 'SHOPCO', channel: 'sms',
    provenance: 'synthetic', basis: 'near-real-template',
    body: 'FLASH SALE: everything under GBP 20.00 this weekend only. Shop now at shopco.example',
  },
  {
    id: 'neg-marketing-telco', kind: 'marketing', reason: 'offer',
    market: 'AE', sender: 'TELCO', channel: 'sms',
    provenance: 'synthetic', basis: 'near-real-template',
    body: 'Upgrade to our 200 Mbps plan for only AED 389 per month. Reply UPGRADE to switch.',
  },

  /* ── Commerce that is not the user's bank posting a debit ───────────── */
  {
    id: 'neg-delivery-order', kind: 'commerce', reason: 'merchant-order-confirmation',
    market: 'AE', sender: 'DELIVERY', channel: 'sms',
    provenance: 'synthetic', basis: 'near-real-template',
    // A merchant confirming an order. The bank debit, if any, arrives separately —
    // importing both is how one lunch becomes two.
    body: 'Your order #48213 totalling AED 74.50 is on its way. Track it in the app.',
  },
  {
    id: 'neg-invoice-due', kind: 'commerce', reason: 'invoice-not-yet-paid',
    market: 'GB', sender: 'UTILITY', channel: 'sms',
    provenance: 'synthetic', basis: 'near-real-template',
    body: 'Your bill of GBP 112.40 is due on 30 September. Please make sure funds are available.',
  },
  {
    id: 'neg-subscription-renewal-notice', kind: 'commerce', reason: 'future-charge-notice',
    market: 'US', sender: 'STREAMCO', channel: 'sms',
    provenance: 'synthetic', basis: 'near-real-template',
    body: 'Your subscription renews on 1 October for USD 15.99. Manage your plan any time.',
  },
  {
    id: 'neg-price-quote', kind: 'commerce', reason: 'quote',
    market: 'AE', sender: 'GARAGE', channel: 'sms',
    provenance: 'synthetic', basis: 'near-real-template',
    body: 'Estimate for your service: AED 1,240.00. Reply APPROVE to proceed.',
  },

  /* ── Bank messages that are information, not movement ───────────────── */
  {
    id: 'neg-balance-only', kind: 'informational', reason: 'balance-enquiry',
    market: 'AE', sender: 'BANK', channel: 'sms',
    provenance: 'synthetic', basis: 'near-real-template',
    body: 'Your available balance is AED 12,480.33 as of 21/09/2026.',
  },
  {
    id: 'neg-limit-notice', kind: 'informational', reason: 'credit-limit-notice',
    market: 'AE', sender: 'BANK', channel: 'sms',
    provenance: 'synthetic', basis: 'near-real-template',
    body: 'Your credit limit has been increased to AED 60,000. No action is required.',
  },
  {
    id: 'neg-statement-ready', kind: 'informational', reason: 'statement-availability',
    market: 'GB', sender: 'BANK', channel: 'sms',
    provenance: 'synthetic', basis: 'near-real-template',
    body: 'Your September statement is ready to view in the app.',
  },
  {
    id: 'neg-branch-hours', kind: 'informational', reason: 'service-notice',
    market: 'SA', sender: 'BANK', channel: 'sms',
    provenance: 'synthetic', basis: 'near-real-template',
    body: 'ستكون فروعنا مغلقة يوم الجمعة. الخدمات الرقمية متاحة على مدار الساعة.',
  },
  {
    id: 'neg-scheduled-payment-set', kind: 'informational', reason: 'instruction-accepted-not-posted',
    market: 'AE', sender: 'BANK', channel: 'sms',
    provenance: 'synthetic', basis: 'near-real-template',
    body: 'Your standing instruction of AED 1,500.00 to SCHOOL FEES has been set up successfully.',
  },
  {
    id: 'neg-cheque-received', kind: 'informational', reason: 'awaiting-clearance',
    market: 'AE', sender: 'BANK', channel: 'sms',
    provenance: 'synthetic', basis: 'near-real-template',
    body: 'A cheque for AED 8,000.00 has been received and sent for clearing.',
  },

  /* ── Not financial at all ───────────────────────────────────────────── */
  {
    id: 'neg-personal-sms', kind: 'non-financial', reason: 'personal-message',
    market: 'AE', sender: '+971501234567', channel: 'sms',
    provenance: 'synthetic', basis: 'near-real-template',
    body: 'Hey, can you send me 50 dirhams for the taxi? I will pay you back tomorrow.',
  },
  {
    id: 'neg-appointment', kind: 'non-financial', reason: 'appointment-reminder',
    market: 'GB', sender: 'CLINIC', channel: 'sms',
    provenance: 'synthetic', basis: 'near-real-template',
    body: 'Reminder: your appointment is on 24 September at 15:30. Reply C to cancel.',
  },
  {
    id: 'neg-traffic-fine-notice', kind: 'non-financial', reason: 'government-notice',
    market: 'AE', sender: 'GOV', channel: 'sms',
    provenance: 'synthetic', basis: 'near-real-template',
    body: 'A traffic fine of AED 400 has been registered against vehicle plate A-12345. View details on the portal.',
  },
  {
    id: 'neg-weather', kind: 'non-financial', reason: 'public-alert',
    market: 'AE', sender: 'ALERT', channel: 'sms',
    provenance: 'synthetic', basis: 'near-real-template',
    body: 'Unstable weather expected this evening. Please drive carefully.',
  },
  {
    id: 'neg-prose-english', kind: 'non-financial', reason: 'not-a-message-shape',
    market: 'GB', sender: 'UNKNOWN', channel: 'sms',
    provenance: 'synthetic', basis: 'near-real-template',
    body: 'The quarterly review covers spending of about 250 pounds per person across the team, which is roughly in line with last year.',
  },
  {
    id: 'neg-source-code', kind: 'non-financial', reason: 'not-a-message-shape',
    market: 'GB', sender: 'UNKNOWN', channel: 'sms',
    provenance: 'synthetic', basis: 'near-real-template',
    body: 'const total = items.reduce((sum, item) => sum + item.price, 0); // AED 1200.00 expected',
  },

  /* ── Reversal and adjustment language that is not a fresh debit ─────── */
  {
    id: 'neg-pending-authorisation', kind: 'informational', reason: 'authorisation-hold',
    market: 'US', sender: 'BANK', channel: 'sms',
    provenance: 'synthetic', basis: 'near-real-template',
    body: 'A temporary hold of USD 50.00 has been placed by GAS STATION 42. It is not a final charge.',
  },
  {
    id: 'neg-duplicate-notice', kind: 'informational', reason: 'advisory-about-a-past-row',
    market: 'AE', sender: 'BANK', channel: 'sms',
    provenance: 'synthetic', basis: 'near-real-template',
    body: 'We noticed a duplicate charge of AED 210.00 and are investigating. No action is needed from you.',
  },
]);

module.exports = rows;
