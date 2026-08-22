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
  featureCards,
  structuredData,
} from '@/marketing/content';

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
        <meta name="theme-color" content="#07100c" />
        {SITE_URL ? <link rel="canonical" href={SITE_URL} /> : null}
        {SITE_URL ? <meta property="og:url" content={SITE_URL} /> : null}
        {SITE_URL ? <meta property="og:image" content={`${SITE_URL}/wafra-social.png`} /> : null}
        {SITE_URL ? <meta name="twitter:image" content={`${SITE_URL}/wafra-social.png`} /> : null}
      </Head>

      <script type="application/ld+json" dangerouslySetInnerHTML={structuredData(PRODUCT_SCHEMA)} />
      <script type="application/ld+json" dangerouslySetInnerHTML={structuredData(FAQ_SCHEMA)} />

      <main className={styles.page}>
        <nav className={styles.nav} aria-label="Primary navigation">
          <a className={styles.brand} href="#top" aria-label="Wafra home">
            <WafraMark size={34} color="#61d5a6" />
            <span>Wafra</span>
            <span className={styles.arabic} lang="ar" dir="rtl">وفرة</span>
          </a>
          <div className={styles.navLinks}>
            <a href="#how-it-works">How it works</a>
            <a href="#privacy">Privacy</a>
            <a href="#questions">Questions</a>
          </div>
          <span className={styles.availability}>iPhone + Android</span>
        </nav>

        <header className={styles.hero} id="top">
          <div className={styles.heroCopy}>
            <p className={styles.eyebrow}><span /> Private money clarity</p>
            <h1>Know where your money went. See what comes next.</h1>
            <p className={styles.lede}>
              Use Wafra anywhere to bring spending, budgets, bills and recurring charges into one private ledger—without asking for your bank login.
            </p>
            <div className={styles.heroActions}>
              <a
                className={styles.primaryAction}
                href={TESTFLIGHT_URL}
                target="_blank"
                rel="noreferrer"
                aria-label="Join the Wafra beta on Apple TestFlight"
              >
                <span className={styles.actionPlatform}>iPhone</span>
                <span>Join TestFlight</span>
                <span className={styles.actionArrow} aria-hidden="true">↗</span>
              </a>
              <a
                className={styles.secondaryAction}
                href={ANDROID_APK_URL}
                target="_blank"
                rel="noreferrer"
                aria-label="Download the Wafra Android test APK"
              >
                <span className={styles.actionPlatform}>Android</span>
                <span>Download APK</span>
                <span className={styles.actionArrow} aria-hidden="true">↓</span>
              </a>
            </div>
            <p className={styles.betaNote}>Public beta builds · Android installs outside Google Play</p>
            <dl className={styles.heroFacts}>
              <div><dt>0</dt><dd>bank logins</dd></div>
              <div><dt>2</dt><dd>languages</dd></div>
              <div><dt>1</dt><dd>clear ledger</dd></div>
            </dl>
          </div>

          <div className={styles.productStage} aria-label="Wafra app previews">
            <div className={`${styles.phone} ${styles.phoneBack}`}>
              <img
                src="/wafra-app-bills.png"
                alt="Wafra statistics screen showing spending categories and period comparisons"
              />
            </div>
            <div className={`${styles.phone} ${styles.phoneFront}`}>
              <img
                src="/wafra-app-home.png"
                alt="Wafra home screen showing monthly income, spending and money left"
              />
            </div>
            <div className={styles.stageNote}><span>PRIVATE LEDGER</span><strong>Yours to read.<br />Yours to keep.</strong></div>
          </div>
        </header>

        <section className={styles.signalStrip} aria-label="Wafra principles">
          <span>Manual-first</span><i />
          <span>No ads</span><i />
          <span>Encrypted ledger</span><i />
          <span>English + العربية</span>
        </section>

        <section className={styles.features} id="how-it-works">
          <div className={styles.sectionIntro}>
            <p className={styles.kicker}>A clearer money month</p>
            <h2>Less dashboard.<br />More direction.</h2>
            <p>Wafra is built around the three questions that matter before you spend again.</p>
          </div>
          <div className={styles.featureList}>
            {featureCards.map((feature) => (
              <article className={styles.featureCard} key={feature.number}>
                <span>{feature.number}</span>
                <div><h3>{feature.title}</h3><p>{feature.copy}</p></div>
                <b aria-hidden="true">→</b>
              </article>
            ))}
          </div>
        </section>

        <section className={styles.privacy} id="privacy">
          <div className={styles.privacyMark}><WafraMark size={70} color="#06100c" /></div>
          <div className={styles.privacyCopy}>
            <p className={styles.kicker}>Private by design</p>
            <h2>Your money picture should not require your bank password.</h2>
            <p>
              Wafra has no sign-up and no advertising. Your main ledger is encrypted on your device. Manual tracking works wherever you live; supported bank-alert imports are optional and platform-specific.
            </p>
          </div>
          <ul className={styles.privacyList}>
            <li><span>01</span><div><strong>Android</strong><p>Supported bank SMS and optional bank-app notifications are processed on the device when you enable access. Availability varies by bank and country.</p></div></li>
            <li><span>02</span><div><strong>iPhone</strong><p>Wafra cannot read the SMS inbox. Optional automatic capture uses a personal Shortcut for bank senders you select.</p></div></li>
            <li><span>03</span><div><strong>Private mode</strong><p>Leave message access off and use manual entry or user-initiated imports instead.</p></div></li>
          </ul>
        </section>

        <section className={styles.faq} id="questions">
          <div className={styles.sectionIntro}>
            <p className={styles.kicker}>Plain answers</p>
            <h2>Before you trust a money app.</h2>
          </div>
          <div className={styles.faqList}>
            {faqItems.map((item) => (
              <details key={item.question}>
                <summary>{item.question}<span aria-hidden="true">+</span></summary>
                <p>{item.answer}</p>
              </details>
            ))}
          </div>
        </section>

        <footer className={styles.footer}>
          <div className={styles.footerBrand}><WafraMark size={30} color="#61d5a6" /><span>Wafra</span></div>
          <p>Private budget and expense tracking anywhere, on iPhone and Android.</p>
          <p className={styles.footnote}>Automatic bank-alert support varies by bank, country and message format. Wafra is not a bank and does not provide financial advice.</p>
        </footer>
      </main>
    </>
  );
}
