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
        <meta name="theme-color" content="#F6F8FC" />
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
            <WafraMark size={32} color="#2855D9" />
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
            <p className={styles.eyebrow}>Your everyday money, clearly.</p>
            <h1>Know your spending.<br />Plan what comes next.</h1>
            <p className={styles.lede}>
              Spending, budgets and bills in one private ledger. No bank login needed.
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
            <p className={styles.languageNote}>Available in English and Arabic.</p>
          </div>

          <div className={styles.productStage} aria-label="Wafra app previews">
            <div className={`${styles.phone} ${styles.phoneBack}`}>
              <img
                src="/wafra-app-bills.png"
                alt="Wafra Bills screen with a card statement, remaining balance and payment action"
                width={1206}
                height={2622}
              />
            </div>
            <div className={`${styles.phone} ${styles.phoneFront}`}>
              <img
                src="/wafra-app-home.png"
                alt="Wafra Home screen showing recorded spending, income and recent activity"
                width={1206}
                height={2622}
              />
            </div>
          </div>
        </header>

        <section className={styles.features} id="how-it-works">
          <div className={styles.sectionIntro}>
            <p className={styles.kicker}>The daily picture</p>
            <h2>Make sense of the details.</h2>
            <p>See what you have spent, what is due and how your categories are tracking.</p>
          </div>
          <div className={styles.featureList}>
            {featureCards.map((feature) => (
              <article className={styles.featureCard} key={feature.number}>
                <span>{feature.number}</span>
                <div><h3>{feature.title}</h3><p>{feature.copy}</p></div>
              </article>
            ))}
          </div>
        </section>

        <section className={styles.privacy} id="privacy">
          <div className={styles.privacyCopy}>
            <p className={styles.kicker}>Private by design</p>
            <h2>Your ledger.<br />No bank login.</h2>
            <p>
              Wafra has no sign-up and no advertising. Your main ledger is encrypted on your device. Manual tracking works wherever you live; supported bank-alert imports are optional and platform-specific.
            </p>
          </div>
          <ul className={styles.privacyList}>
            <li><strong>Android</strong><p>Supported bank SMS and optional bank-app notifications are processed on the device when you enable access. Availability varies by bank and country.</p></li>
            <li><strong>iPhone</strong><p>Wafra cannot read the Messages inbox. Optional automatic capture runs only for bank senders the user selects, then processes supported bank alerts locally on this iPhone. This path does not upload their text.</p></li>
            <li><strong>Manual-only</strong><p>Leave automatic Message capture off and use manual entry or user-initiated imports instead.</p></li>
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
          <div className={styles.footerBrand}><WafraMark size={30} color="#2855D9" /><span>Wafra</span></div>
          <p>Private budget and expense tracking anywhere, on iPhone and Android.</p>
          <p className={styles.footnote}>Automatic bank-alert support varies by bank, country and message format. Wafra is not a bank and does not provide financial advice.</p>
        </footer>
      </main>
    </>
  );
}
