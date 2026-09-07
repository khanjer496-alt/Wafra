import Head from 'expo-router/head';
import React from 'react';

import { WafraMark } from '@/marketing/wafra-mark.web';
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
        <meta name="theme-color" content="#F4F1EA" />
        <link rel="icon" href="/wafra-icon.svg" type="image/svg+xml" />
        <meta property="og:image:alt" content="Wafra. Know your spending. Plan what comes next." />
        {SITE_URL ? <link rel="canonical" href={SITE_URL} /> : null}
        {SITE_URL ? <meta property="og:url" content={SITE_URL} /> : null}
        {SITE_URL ? <meta property="og:image" content={`${SITE_URL}/wafra-social.png`} /> : null}
        {SITE_URL ? <meta name="twitter:image" content={`${SITE_URL}/wafra-social.png`} /> : null}
      </Head>

      <script type="application/ld+json" dangerouslySetInnerHTML={structuredData(PRODUCT_SCHEMA)} />
      <script type="application/ld+json" dangerouslySetInnerHTML={structuredData(FAQ_SCHEMA)} />

      <main className={styles.page}>
        <a className={styles.skipLink} href="#top">Skip to content</a>
        <nav className={styles.nav} aria-label="Primary navigation">
          <a className={styles.brand} href="#top" aria-label="Wafra home">
            <WafraMark size={32} color="#1F6B52" />
            <span>Wafra</span>
            <span className={styles.arabic} lang="ar" dir="rtl">وفرة</span>
          </a>
          <div className={styles.navLinks}>
            <a href="#how-it-works">How it works</a>
            <a href="#inside-wafra">Inside the app</a>
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

          <figure className={styles.productStage} aria-label="Wafra app previews">
            <div className={styles.phonePair}>
            <div className={`${styles.phone} ${styles.phoneBack}`}>
              <img
                src="/wafra-app-bills.png"
                decoding="async"
                alt="Redesigned Wafra Bills in dark mode, with subscriptions separated from utilities and telecom; sample data"
                width={390}
                height={844}
              />
            </div>
            <div className={`${styles.phone} ${styles.phoneFront}`}>
              <img
                src="/wafra-app-home.png"
                fetchPriority="high"
                alt="Redesigned Wafra Home, focused on spending, income and the next payments instead of a total balance; sample data"
                width={390}
                height={844}
              />
            </div>
            </div>
            <figcaption className={styles.previewCaption}>App previews · sample data</figcaption>
          </figure>
        </header>

        <section className={styles.appTour} id="inside-wafra" aria-labelledby="app-tour-title">
          <div className={styles.tourIntro}>
            <p className={styles.kicker}>A closer look</p>
            <h2 id="app-tour-title">Less clutter. More clarity.</h2>
            <p>Three focused views for your everyday money. Actual app screens with sample data.</p>
          </div>
          <div className={styles.screenGrid}>
            <figure className={styles.screenPreview}>
              <figcaption><h3>Home</h3><p>Your spending first. Income, the next payments and recent activity, without a wall of cards.</p></figcaption>
              <img src="/wafra-app-home.png" alt="Wafra Home: one spending summary, a smaller income row and upcoming payments; sample data" width={390} height={844} loading="lazy" decoding="async" />
            </figure>
            <figure className={styles.screenPreview}>
              <figcaption><h3>Spending</h3><p>See each category’s share of total spending. Budget usage is labelled separately.</p></figcaption>
              <img src="/wafra-app-spending.png" alt="Wafra Spending: amounts, category percentages and proportional bars, with separate budget usage; sample data" width={390} height={844} loading="lazy" decoding="async" />
            </figure>
            <figure className={styles.screenPreview}>
              <figcaption><h3>Bills</h3><p>Subscriptions and utilities in separate sections. Dates and estimated charges stay visible.</p></figcaption>
              <img src="/wafra-app-bills-light.png" alt="Wafra Bills: separate Subscriptions and Utilities and telecom sections with renewal dates; sample data" width={390} height={844} loading="lazy" decoding="async" />
            </figure>
          </div>
        </section>

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
          <div className={styles.footerBrand}><WafraMark size={30} color="#1F6B52" /><span>Wafra</span></div>
          <p>Private budget and expense tracking anywhere, on iPhone and Android.</p>
          <p className={styles.footnote}>Automatic bank-alert support varies by bank, country and message format. Wafra is not a bank and does not provide financial advice.</p>
        </footer>
      </main>
    </>
  );
}
