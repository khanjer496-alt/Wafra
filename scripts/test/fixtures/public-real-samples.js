'use strict';
/**
 * Held-out REAL bank-alert evaluation samples (parser-ai benchmark).
 *
 * EVALUATION ONLY — never use these rows for training, synthetic templates or
 * rule tuning. Each body was published verbatim as text on a public web page
 * (official bank alert/fraud pages, a government fraud-awareness page, or an
 * MIT-licensed open-source parser test: github.com/danrave1234/paytsek, MIT
 * License, copyright its authors) and is quoted briefly here with its
 * exact source URL and retrieval date. Bodies are unchanged except that
 * personal-looking values were redacted (`redacted: true`): individuals' names
 * -> "A. PERSON", phone and full account numbers masked. Placeholders the
 * source itself uses (XXXX, 09 XX XX XX XX) are kept.
 *
 * `note: 'scam'` marks a phishing/smishing text quoted by a bank or regulator:
 * a hard negative that must never post, labelled with the status it claims.
 * `title` is a push-notification title published alongside the body.
 * Labels follow scripts/parser-ai/schema.cjs; an omitted field is unlabelled.
 *
 * Samples from sources without a redistribution licence (GitHub issues,
 * GPL/AGPL/unlicensed corpora, news and complaint sites) are kept out of the
 * repository; scripts/parser-ai/public-real-eval-set.cjs can load them from a
 * local-only JSON via PARSER_AI_PUBLIC_LOCAL.
 */
module.exports = [
  {
    id: "in-01", source: 'public-real', country: "IN", language: "en",
    bank: "Deutsche Bank India", sender: "",
    url: "https://www.deutsche.bank.in/en/connect-with-us/sms-alert.html",
    retrieved: "2026-09-25",
    redacted: true,
    body: "INR 35,000.00 withdrawn from a/c 40XXXXXXXXX0019 on 08/AUG 10:55 for NET/NEFT/A. PERSON/ABER000123. Clear Balance: INR 75,000.00.",
    label: { status: "completed", shouldPost: true, family: "transfer", direction: "debit", amount: { minor: "3500000", currency: "INR", exponent: 2 } },
  },
  {
    id: "es-05", source: 'public-real', country: "ES", language: "es",
    bank: "BBVA (impersonated)", sender: "",
    url: "https://agendaaudiovisual.castillalamancha.es/noticias/nuevo-intento-de-phishing-suplanta-bbva-es-un-fraude",
    retrieved: "2026-09-25",
    note: "scam",
    body: "BBVA: Utilice el codigo 637956 para autorizar la transferencia de 8600 EUROS",
    label: { status: "otp", shouldPost: false, family: "non-posting", direction: "none", amount: { minor: "860000", currency: "EUR", exponent: 2 } },
  },
  {
    id: "fr-01", source: 'public-real', country: "FR", language: "fr",
    bank: "unspecified ('SOS carte')", sender: "",
    url: "https://www.cybermalveillance.gouv.fr/tous-nos-contenus/actualites/lhameconnage-au-faux-numero-dopposition-bancaire",
    retrieved: "2026-09-25",
    note: "scam",
    body: "Merci pour votre commande n°8945623 – 589,99 € seront débités.\nUn problème ? Appelez immédiatement le 09 XX XX XX XX. SOS carte",
    label: { status: "future", shouldPost: false, family: "non-posting", direction: "none", amount: { minor: "58999", currency: "EUR", exponent: 2 } },
  },
  {
    id: "fr-02", source: 'public-real', country: "FR", language: "fr",
    bank: "unspecified ('Service Opposition')", sender: "",
    url: "https://www.cybermalveillance.gouv.fr/tous-nos-contenus/actualites/lhameconnage-au-faux-numero-dopposition-bancaire",
    retrieved: "2026-09-25",
    note: "scam",
    body: "Bonjour\nVotre achat de 594,98 EUR chez Darty a bien été enregistré.\nSi vous n’avez pas initié ce paiement, contacter vite le service opposition au 07 XX XX XX XX (non surtaxé).\nCordialement,\nService Opposition",
    label: { status: "completed", shouldPost: false, family: "non-posting", direction: "none", amount: { minor: "59498", currency: "EUR", exponent: 2 }, merchant: "Darty" },
  },
  {
    id: "fr-03", source: 'public-real', country: "FR", language: "fr",
    bank: "Crédit Agricole (impersonated)", sender: "",
    url: "https://www.cybermalveillance.gouv.fr/tous-nos-contenus/actualites/lhameconnage-au-faux-numero-dopposition-bancaire",
    retrieved: "2026-09-25",
    note: "scam",
    body: "Crédit Agricole: Un paiement de 657,99 € est en cours de validation. Si vous n’en êtes pas l’auteur, veuillez contacter le service de sécurité au 09 XX XX XX XX.",
    label: { status: "pending", shouldPost: false, family: "non-posting", direction: "none", amount: { minor: "65799", currency: "EUR", exponent: 2 } },
  },
  {
    id: "fr-04", source: 'public-real', country: "FR", language: "fr",
    bank: "unspecified", sender: "",
    url: "https://www.cybermalveillance.gouv.fr/tous-nos-contenus/actualites/lhameconnage-au-faux-numero-dopposition-bancaire",
    retrieved: "2026-09-25",
    note: "scam",
    body: "Votre virement de 2132.27 eur à bien été pris en compte. Si vous n’avez effectué aucune opération veuillez contacter le 01 XX XX XX XX.",
    label: { status: "completed", shouldPost: false, family: "non-posting", direction: "none", amount: { minor: "213227", currency: "EUR", exponent: 2 } },
  },
  {
    id: "fr-05", source: 'public-real', country: "FR", language: "fr",
    bank: "BRED (impersonated)", sender: "",
    url: "https://www.cybermalveillance.gouv.fr/tous-nos-contenus/actualites/lhameconnage-au-faux-numero-dopposition-bancaire",
    retrieved: "2026-09-25",
    note: "scam",
    body: "Info Bred: Opération de 935 € initiée chez Bureau Vallée sur votre carte. Si non autorisée, appelez au 09 XX XX XX XX",
    label: { status: "pending", shouldPost: false, family: "non-posting", direction: "none", amount: { minor: "93500", currency: "EUR", exponent: 2 }, merchant: "Bureau Vallée" },
  },
  {
    id: "fr-06", source: 'public-real', country: "FR", language: "fr",
    bank: "unspecified", sender: "",
    url: "https://www.cybermalveillance.gouv.fr/tous-nos-contenus/actualites/lhameconnage-au-faux-numero-dopposition-bancaire",
    retrieved: "2026-09-25",
    note: "scam",
    body: "Réf. 1075PTA40M Un nouvel appareil a été détecté sur votre espace personnel. Une transaction est en cours : 3 300 € à destination de C*** C***. Une opération par carte terminant par XXXX a également été signalée. Montant : 1 912,99 € 📞 Si vous n’êtes pas à l’origine de ces opérations, veuillez nous contacter immédiatement : 09 XX XX XX XX (appel 24h/24) Merci de votre vigilance. ❗ Ne répondez pas à ce message si vous êtes à l’origine de ces opérations.",
    label: { status: "pending", shouldPost: false, family: "non-posting", direction: "none" },
  },
  {
    id: "ke-01", source: 'public-real', country: "KE", language: "en",
    bank: "Safaricom M-PESA", sender: "",
    url: "https://www.safaricom.co.ke/media-center-landing/frequently-asked-questions/international-money-transfer",
    retrieved: "2026-09-25",
    body: "G68EG702 confirmed. You have received Ksh5, 000 from Diaspora Friend via XYZ on 24/4/14 at 3:56PM. New M-PESA balance is Ksh10, 500.",
    label: { status: "completed", shouldPost: true, family: "transfer", direction: "credit", amount: { minor: "500000", currency: "KES", exponent: 2 }, date: "2014-04-24" },
  },
  {
    id: "ke-02", source: 'public-real', country: "KE", language: "en",
    bank: "Safaricom M-PESA", sender: "",
    url: "https://www.safaricom.co.ke/media-center-landing/frequently-asked-questions/international-money-transfer",
    retrieved: "2026-09-25",
    body: "G68EG702 Confirmed. Ksh5, 000 was sent to you via XYZ and M-PESA. You must register at an M-PESA Agent within 21 days to access these funds. Receipt G68EG702 on 24/4/09 at 3:58PM. Please call customer care on 234",
    label: { status: "pending", shouldPost: false, family: "non-posting", direction: "none", amount: { minor: "500000", currency: "KES", exponent: 2 } },
  },
  {
    id: "ph-07", source: 'public-real', country: "PH", language: "en",
    bank: "GCash", sender: "",
    url: "https://raw.githubusercontent.com/danrave1234/paytsek/HEAD/modules/payment-collector/android/src/test/java/ph/paytsek/collector/NotificationParserTest.kt",
    retrieved: "2026-09-25",
    body: "You have received PHP 1,096.10 of GCash from MI*A P. 0915••••847.",
    label: { status: "completed", shouldPost: true, family: "transfer", direction: "credit", amount: { minor: "109610", currency: "PHP", exponent: 2 }, date: null },
  },
  {
    id: "ph-08", source: 'public-real', country: "PH", language: "en",
    bank: "GCash", sender: "",
    url: "https://raw.githubusercontent.com/danrave1234/paytsek/HEAD/modules/payment-collector/android/src/test/java/ph/paytsek/collector/NotificationParserTest.kt",
    retrieved: "2026-09-25",
    body: "You have received PHP 5,000.00 via InstaPay from BDO on Sep 8, 2025 1:45 PM. Ref. No. 7031245896012.",
    label: { status: "completed", shouldPost: true, family: "transfer", direction: "credit", amount: { minor: "500000", currency: "PHP", exponent: 2 }, date: "2025-09-08" },
  },
  {
    id: "ph-09", source: 'public-real', country: "PH", language: "en",
    bank: "Maya", sender: "",
    url: "https://raw.githubusercontent.com/danrave1234/paytsek/HEAD/modules/payment-collector/android/src/test/java/ph/paytsek/collector/NotificationParserTest.kt",
    retrieved: "2026-09-25",
    body: "You received ₱1,899.00 in your wallet via InstaPay",
    label: { status: "completed", shouldPost: true, family: "transfer", direction: "credit", amount: { minor: "189900", currency: "PHP", exponent: 2 }, date: null },
  },
  {
    id: "ph-10", source: 'public-real', country: "PH", language: "en",
    bank: "GoTyme", sender: "",
    url: "https://raw.githubusercontent.com/danrave1234/paytsek/HEAD/modules/payment-collector/android/src/test/java/ph/paytsek/collector/NotificationParserTest.kt",
    retrieved: "2026-09-25",
    redacted: true,
    body: "You received P25,000.00 from A. PERSON. Your available balance is P31,250.55.",
    label: { status: "completed", shouldPost: true, family: "transfer", direction: "credit", amount: { minor: "2500000", currency: "PHP", exponent: 2 }, date: null },
  },
  {
    id: "ph-11", source: 'public-real', country: "PH", language: "en",
    bank: "SeaBank PH", sender: "",
    url: "https://raw.githubusercontent.com/danrave1234/paytsek/HEAD/modules/payment-collector/android/src/test/java/ph/paytsek/collector/NotificationParserTest.kt",
    retrieved: "2026-09-25",
    body: "You’ve received PHP 1,299.99 from bank with account ending 5678",
    label: { status: "completed", shouldPost: true, family: "transfer", direction: "credit", amount: { minor: "129999", currency: "PHP", exponent: 2 }, date: null },
  },
  {
    id: "ph-12", source: 'public-real', country: "PH", language: "en",
    bank: "SeaBank PH", sender: "",
    url: "https://raw.githubusercontent.com/danrave1234/paytsek/HEAD/modules/payment-collector/android/src/test/java/ph/paytsek/collector/NotificationParserTest.kt",
    retrieved: "2026-09-25",
    body: "You've successfully sent PHP 500.00 to account ending 9012",
    label: { status: "completed", shouldPost: true, family: "transfer", direction: "debit", amount: { minor: "50000", currency: "PHP", exponent: 2 }, date: null },
  },
  {
    id: "us-15", source: 'public-real', country: "US", language: "en",
    bank: "Farmers and Merchants Bank (MS)", sender: "",
    url: "https://www.fmbms.com/Card-Text-Alerts",
    retrieved: "2026-09-25",
    body: "Free MSG: The FMBank Fraud Center $201.45 on card 1234 at Shopsmart. If valid reply YES, fraud NO. To Opt Out, STOP.",
    label: { status: "pending", shouldPost: false, family: "non-posting", direction: "none", amount: { minor: "20145", currency: "USD", exponent: 2 }, merchant: "Shopsmart" },
  },
  {
    id: "us-16", source: 'public-real', country: "US", language: "en",
    bank: "7 17 Credit Union", sender: "",
    url: "https://www.717cu.com/personal/services/account-alerts",
    retrieved: "2026-09-25",
    body: "Free MSG: 7 17 Credit Union Debit Fraud Center 8772538962$201.45 on card 1111 at Walmart. If valid reply YES, fraud NO. To Opt Out, STOP.",
    label: { status: "pending", shouldPost: false, family: "non-posting", direction: "none", amount: { minor: "20145", currency: "USD", exponent: 2 }, merchant: "Walmart" },
  },
  {
    id: "us-17", source: 'public-real', country: "US", language: "en",
    bank: "7 17 Credit Union", sender: "",
    url: "https://www.717cu.com/personal/services/account-alerts",
    retrieved: "2026-09-25",
    body: "Free Msg: 7 17 CU Fraud Dept: Suspicious txn on acct 1111: $209.99 WALMART. If authorized reply YES, otherwise NO. To Opt Out reply STOP.",
    label: { status: "pending", shouldPost: false, family: "non-posting", direction: "none", amount: { minor: "20999", currency: "USD", exponent: 2 }, merchant: "WALMART" },
  },
  {
    id: "gb-01", source: 'public-real', country: "GB", language: "en",
    bank: "Barclays", sender: "",
    url: "https://www.barclays.co.uk/ways-to-bank/mobile-banking-services/alerts/text-alerts/",
    retrieved: "2026-09-25",
    body: "Online Statement Alert\nNAME5 Your statement\ncan be viewed online\nfrom DDMMM\nEND\nVisit barclays.mobi/app",
    label: { status: "informational", shouldPost: false, family: "non-posting", direction: "none", amount: null },
  },
  {
    id: "gb-02", source: 'public-real', country: "GB", language: "en",
    bank: "NatWest (NatWest International page)", sender: "",
    url: "https://www.natwestinternational.com/global/fraud-and-security/spotting-scams/text-message-scams.html",
    retrieved: "2026-09-25",
    note: "scam",
    body: "A withdrawal of £1566.04 has been made from your account. If this wasn’t you please call the fraud team on XXXX XXX XXXX immediately.",
    label: { status: "completed", shouldPost: false, family: "non-posting", direction: "none", amount: { minor: "156604", currency: "GBP", exponent: 2 } },
  },
  {
    id: "gb-03", source: 'public-real', country: "GB", language: "en",
    bank: "NatWest (NatWest International page)", sender: "",
    url: "https://www.natwestinternational.com/global/fraud-and-security/spotting-scams/text-message-scams.html",
    retrieved: "2026-09-25",
    note: "scam",
    body: "Our security team need to speak with you urgently. Your bank account was accessed at 14:35PM. If this wasn’t you, please call our fraud team immediately on XXXX XXX XXXX.",
    label: { status: "informational", shouldPost: false, family: "non-posting", direction: "none", amount: null },
  },
  {
    id: "gb-04", source: 'public-real', country: "GB", language: "en",
    bank: "NatWest (NatWest International page)", sender: "",
    url: "https://www.natwestinternational.com/global/fraud-and-security/spotting-scams/text-message-scams.html",
    retrieved: "2026-09-25",
    note: "scam",
    body: "WARNING we’ve noticed some suspicious activity on your account. For your security, your account will be suspended if you do not get in touch. Click this link to contact our fraud team.",
    label: { status: "informational", shouldPost: false, family: "non-posting", direction: "none", amount: null },
  },
];
