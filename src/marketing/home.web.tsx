import Head from 'expo-router/head';
import React from 'react';

import { WafraMark } from '@/components/wafra-logo';
import styles from '@/marketing/home.module.css';
import {
  ANDROID_APK_URL,
  FAQ_SCHEMA,
  MARKETING_DESCRIPTION,
  MARKETING_TITLE,
  PRODUCT_SCHEMA,
  SITE_URL,
  TESTFLIGHT_URL,
  faqItems,
  structuredData,
} from '@/marketing/content';

const samples = [
  {
    key: 'purchase', label: 'Purchase',
    message: 'Purchase of AED 89.50 with Credit Card ending 4242 at CORNER CAFE on 05/09/2026',
    title: 'Corner Cafe', amount: '89.50', amountLabel: 'Purchase',
    details: [['Category', 'Dining'], ['Card', '•• 4242'], ['Date', '5 Sep 2026']],
  },
  {
    key: 'statement', label: 'Statement',
    message: 'Your Credit Card ending 4242 statement is generated. Total due AED 3,240.00, minimum due AED 162.00 by 05/10/2026',
    title: 'Card statement', amount: '3,240', amountLabel: 'Statement total',
    details: [['Due date', '5 Oct 2026'], ['Minimum due', 'AED 162'], ['Card', '•• 4242']],
  },
  {
    key: 'payment', label: 'Card payment',
    message: 'Payment of AED 250.00 received towards your Credit Card ending 4242. Thank you.',
    title: 'Card payment', amount: '250', amountLabel: 'Payment received',
    details: [['Card', '•• 4242'], ['Type', 'Card repayment'], ['Status', 'Receipt recognised']],
  },
] as const;

function Downloads() {
  return (
    <div className={styles.downloadLinks}>
      <a className={styles.downloadPrimary} href={TESTFLIGHT_URL} target="_blank" rel="noreferrer"
        aria-label="Join the Wafra beta on Apple TestFlight">
        <span className={styles.downloadPlatform}>iPhone</span><strong>Join TestFlight</strong>
        <span className={styles.downloadArrow} aria-hidden="true">↗</span>
      </a>
      <a className={styles.downloadSecondary} href={ANDROID_APK_URL} target="_blank" rel="noreferrer"
        aria-label="Download the Wafra Android test APK">
        <span className={styles.downloadPlatform}>Android</span><strong>Download APK</strong>
        <span className={styles.downloadArrow} aria-hidden="true">↓</span>
      </a>
    </div>
  );
}

function AlertDemo() {
  const panels = { purchase: styles.purchasePanel, statement: styles.statementPanel, payment: styles.paymentPanel };
  return (
    <fieldset className={styles.demo} id="how-it-works">
      <legend className={styles.srOnly}>Choose a sample bank alert</legend>
      {samples.map((sample) => (
        <input key={sample.key} type="radio" name="sample-alert" id={`demo-${sample.key}`}
          data-example={sample.key} className={styles.demoInput} defaultChecked={sample.key === 'purchase'} />
      ))}
      <div className={styles.demoControls}>
        <span>Try a sample</span>
        {samples.map((sample) => <label key={sample.key} htmlFor={`demo-${sample.key}`}>{sample.label}</label>)}
      </div>
      <div className={styles.demoStage}>
        {samples.map((sample) => (
          <div key={sample.key} className={`${styles.demoPanel} ${panels[sample.key]}`}>
            <div className={styles.message}>
              <div className={styles.messageMeta}>
                <span className={styles.messageSymbol} aria-hidden="true">↙</span>
                <span>Bank alert<small>Sample message</small></span>
                <span className={styles.messageTime}>SMS</span>
              </div>
              <p className={styles.messageBody}>{sample.message}</p>

            </div>
            <div className={styles.connector} aria-hidden="true">
              <svg viewBox="0 0 100 80" fill="none"><path d="M8 42C24 42 29 16 50 16S76 42 91 42M79 30l13 12-13 12" /></svg>
            </div>
            <div className={styles.result}>
              <div className={styles.resultHeader}><WafraMark size={24} color="#2855D9" /><span>Recognised details</span></div>
              <h2 className={styles.recordTitle}>{sample.title}</h2>
              <p className={styles.recordAmount}><span>AED</span> {sample.amount}</p>
              <p className={styles.recordLabel}>{sample.amountLabel}</p>
              <dl className={styles.recordDetails}>
                {sample.details.map(([label, value]) => <div key={label}><dt>{label}</dt><dd>{value}</dd></div>)}
              </dl>
            </div>
          </div>
        ))}
      </div>
      <p className={styles.sampleNote}>Examples of supported alerts. Setup varies on iPhone and Android.</p>
    </fieldset>
  );
}

export default function MarketingHome() {
  return (
    <>
      <Head>
        <title>{MARKETING_TITLE}</title>
        <meta name="description" content={MARKETING_DESCRIPTION} />
        <meta name="robots" content="index, follow, max-image-preview:large" />
        <meta name="googlebot" content="index, follow, max-image-preview:large" />
        <meta
          name="keywords"
          content="budget app, expense tracker, worldwide money manager, bill tracker, subscription tracker, private finance app"
        />
        <meta property="og:type" content="website" />
        <meta property="og:site_name" content="Wafra" />
        <meta property="og:title" content={MARKETING_TITLE} />
        <meta property="og:description" content={MARKETING_DESCRIPTION} />
        <meta name="twitter:card" content="summary_large_image" />
        <meta name="twitter:title" content={MARKETING_TITLE} />
        <meta name="twitter:description" content={MARKETING_DESCRIPTION} />
        <meta name="theme-color" content="#2855D9" />
        {SITE_URL ? <link rel="canonical" href={SITE_URL} /> : null}
        {SITE_URL ? <meta property="og:url" content={SITE_URL} /> : null}
        {SITE_URL ? <meta property="og:image" content={`${SITE_URL}/wafra-social.png`} /> : null}
        {SITE_URL ? <meta name="twitter:image" content={`${SITE_URL}/wafra-social.png`} /> : null}
      </Head>

      <script type="application/ld+json" dangerouslySetInnerHTML={structuredData(PRODUCT_SCHEMA)} />
      <script type="application/ld+json" dangerouslySetInnerHTML={structuredData(FAQ_SCHEMA)} />

      <main className={styles.page}>
        <header className={styles.hero} id="top">
          <nav className={styles.nav} aria-label="Primary navigation">
            <a className={styles.brand} href="#top" aria-label="Wafra home"><WafraMark size={32} color="#FFFFFF" /><span>Wafra</span><small lang="ar" dir="rtl">وفرة</small></a>
            <div className={styles.navLinks}><a href="#how-it-works">Try it</a><a href="#privacy">Privacy</a></div>
            <a href="#download" className={styles.getApp}>Get Wafra <span aria-hidden="true">↗</span></a>
          </nav>
          <div className={styles.heroIntro}>
            <h1>Your bank texts.<br /><span>Finally organised.</span></h1>
            <p className={styles.heroLead}>Purchases, card statements and payments. One private place.</p>
          </div>
          <AlertDemo />
          <div className={styles.heroBottom}><p>Your ledger, on your device.<br />English and Arabic.</p><a href="#download">Get Wafra <span aria-hidden="true">↓</span></a></div>
        </header>

        <section className={styles.overview} aria-labelledby="overview-title">
          <div className={styles.overviewCopy}>
            <p className={styles.kicker}>AFTER THE ALERT</p>
            <h2 id="overview-title">Your month.<br />In one view.</h2>
            <p>See what you spent. Keep an eye on due dates. Bring your accounts together.</p>
            <ul className={styles.overviewList}>
              <li><span>01</span>Spending by category</li>
              <li><span>02</span>Card statements and bills</li>
              <li><span>03</span>Your bank, card and cash accounts</li>
            </ul>
            <p className={styles.overviewNote}>English and Arabic. Light and dark.</p>
          </div>
          <figure className={styles.appProof}>
            <div className={styles.proofLabel}><span>IN THE APP</span><span>Home / dark</span></div>
            <img src="/wafra-app-home.png" width={1206} height={2622}
              alt="Wafra Home in dark mode showing recorded spending, income and recent activity" loading="lazy" />
            <figcaption>Wafra, shown with demo entries.</figcaption>
          </figure>
        </section>

        <section className={styles.privacy} id="privacy" aria-labelledby="privacy-title">
          <div className={styles.privacyTitle}><p className={styles.kicker}>YOURS STAYS YOURS</p><h2 id="privacy-title">A money app.<br />Without the bank login.</h2><p>No sign-up. No ads. Your main ledger is encrypted on your device.</p></div>
          <div className={styles.privacyColumns}>
            <article><span className={styles.platformNumber}>01 / Android</span><h3>Start with your alerts.</h3><p>Supported bank SMS and optional bank-app notifications are processed on the device when you enable access. Availability varies by bank and country.</p></article>
            <article><span className={styles.platformNumber}>02 / iPhone</span><h3>A little setup. Then capture.</h3><p>Wafra cannot read the Messages inbox. Optional automatic capture runs only for bank senders the user selects, then processes supported bank alerts locally on this iPhone. This path does not upload their text.</p></article>
            <article><span className={styles.platformNumber}>03 / Your choice</span><h3><strong>Manual-only</strong></h3><p>Leave automatic Message capture off and use manual entry or user-initiated imports instead.</p><p>Manual tracking works wherever you live.</p></article>
          </div>
        </section>

        <section className={styles.faq} id="questions">
          <h2>A few things<br />worth knowing.</h2>
          <div className={styles.faqList}>{faqItems.map((item) => <details key={item.question}><summary>{item.question}<span aria-hidden="true">+</span></summary><p>{item.answer}</p></details>)}</div>
        </section>

        <section className={styles.download} id="download" aria-labelledby="download-title">
          <p className={styles.kicker}>YOUR NEXT MONEY HABIT</p>
          <h2 id="download-title">Let the texts<br />do some work.</h2>
          <Downloads />
          <p className={styles.betaNote}>Public beta · Android installs outside Google Play</p>
        </section>
        <footer className={styles.footer}>
          <a className={styles.footerBrand} href="#top" aria-label="Back to Wafra"><WafraMark size={38} color="#2855D9" /><span>Wafra</span></a>
          <p>Use Wafra anywhere. Automatic bank-alert support varies by bank, country and message format.</p>
          <p>Wafra is not a bank and does not provide financial advice.</p>
        </footer>
      </main>
    </>
  );
}
