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
  captureLanes,
  faqItems,
  featureCards,
  renewals,
  sortingRows,
  structuredData,
} from '@/marketing/content';

/* The exported page ships without JavaScript. Every demo below is CSS-only and
   rests on its finished frame when the visitor prefers reduced motion. */
function CaptureStage() {
  return (
    <figure className={styles.stage}>
      <div
        className={styles.stageScene}
        role="img"
        aria-label="Illustration with sample data: bank alerts arrive on an iPhone and an Android phone, then appear in the Wafra ledger with a merchant, category and amount."
      >
        <div className={`${styles.device} ${styles.iphone}`} aria-hidden="true">
          <div className={styles.screen}>
            <span className={styles.island} />
            <span className={styles.clock}>9:41</span>
            <span className={styles.date}>Thursday 25 September</span>
            <div className={`${styles.alert} ${styles.iosAlert} ${styles.alertOne}`}>
              <span className={styles.alertApp}><i className={styles.msgIcon} />Messages · Your bank</span>
              <span>Card ••4821 used for USD 6.75 at STARBUCKS #1182</span>
            </div>
            <div className={`${styles.alert} ${styles.iosAlert} ${styles.alertThree}`}>
              <span className={styles.alertApp}><i className={styles.msgIcon} />Messages · Your bank</span>
              <span>USD 15.49 charged at NETFLIX.COM on card ••4821</span>
            </div>
            <span className={styles.handoff}>Shortcuts → Wafra Local Capture</span>
          </div>
        </div>

        <div className={`${styles.device} ${styles.android}`} aria-hidden="true">
          <div className={styles.screen}>
            <span className={styles.punch} />
            <span className={styles.statusBar}><b>09:41</b><b>▾ ▮</b></span>
            <span className={styles.clockAndroid}>09:41</span>
            <div className={`${styles.alert} ${styles.droidAlert} ${styles.alertTwo}`}>
              <span className={styles.alertApp}><i className={styles.bankIcon} />Bank app · now</span>
              <span>Purchase EUR 42.00 at CARREFOUR MARKET PARIS</span>
            </div>
            <span className={styles.handoff}>Read on this phone</span>
          </div>
        </div>

        <div className={styles.tape} aria-hidden="true">
          <div className={styles.tapeHead}><span>Today</span><span>Wafra ledger</span></div>
          <div className={`${styles.tapeRow} ${styles.rowOne}`}>
            <span className={styles.tapeMerchant}>Starbucks</span>
            <span className={styles.stamp}>Dining</span>
            <span className={styles.tapeAmount}>−$6.75</span>
          </div>
          <div className={`${styles.tapeRow} ${styles.rowTwo}`}>
            <span className={styles.tapeMerchant}>Carrefour<small>€42.00 converted</small></span>
            <span className={styles.stamp}>Groceries</span>
            <span className={styles.tapeAmount}>−$45.62</span>
          </div>
          <div className={`${styles.tapeRow} ${styles.rowThree}`}>
            <span className={styles.tapeMerchant}>Netflix<small>Monthly · recurring</small></span>
            <span className={styles.stamp}>Entertainment</span>
            <span className={styles.tapeAmount}>−$15.49</span>
          </div>
        </div>
      </div>
      <label className={styles.motionToggle}>
        <input type="checkbox" />
        <span>Pause animations</span>
      </label>
      <figcaption className={styles.previewCaption}>
        Illustration · sample data · automatic capture depends on your bank’s alert format
      </figcaption>
    </figure>
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
            <a href="#categories">Categories</a>
            <a href="#subscriptions">Bills</a>
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

          <CaptureStage />
        </header>

        <section className={styles.capture} id="how-it-works" aria-labelledby="capture-title">
          <div className={styles.tourIntro}>
            <p className={styles.kicker}>Live capture</p>
            <h2 id="capture-title">From bank alert to ledger, on your phone.</h2>
            <p>
              Each platform allows something different, so Wafra uses a different route on each. Both end in the
              same encrypted ledger, and neither route needs a bank login.
            </p>
          </div>
          <ol className={styles.lanes}>
            {captureLanes.map((lane, laneIndex) => (
              <li className={styles.lane} key={lane.platform} style={{ '--lane': laneIndex } as React.CSSProperties}>
                <div className={styles.laneHead}>
                  <h3>{lane.platform}</h3>
                  <span>{lane.note}</span>
                </div>
                <ol className={styles.track}>
                  {lane.steps.map((step, stepIndex) => (
                    <li key={step.title}>
                      <span className={styles.trackIndex}>{String(stepIndex + 1).padStart(2, '0')}</span>
                      <div><strong>{step.title}</strong><span>{step.copy}</span></div>
                    </li>
                  ))}
                </ol>
              </li>
            ))}
          </ol>
        </section>

        <section className={styles.sorting} id="categories" aria-labelledby="sorting-title">
          <div className={styles.sortingIntro}>
            <p className={styles.kicker}>Automatic categories</p>
            <h2 id="sorting-title">Messy in.<br />Meaningful out.</h2>
            <p>
              Bank alerts name merchants in shorthand. Wafra trims the terminal codes, finds the merchant and gives
              the charge a category. It knows merchant words in English, Arabic and several other languages.
            </p>
            <ul className={styles.sortingRules}>
              <li>Refunds, card payments and transfers between your own accounts stay out of spending.</li>
              <li>When the merchant alone cannot tell, Wafra leaves the charge for you instead of guessing.</li>
            </ul>
          </div>

          <div className={styles.sorter}>
            <div className={styles.sorterHead} aria-hidden="true">
              <span>From your bank</span><span>In Wafra</span>
            </div>
            <ul className={styles.sorterRows} aria-label="Examples with sample data">
              {sortingRows.map((row, index) => (
                <li key={row.raw} style={{ '--i': index } as React.CSSProperties}>
                  <code className={styles.raw}>{row.raw}</code>
                  <span className={styles.sortArrow} aria-hidden="true">→</span>
                  <span className={styles.clean}>
                    <span>{row.merchant}</span>
                    <span className={row.neutral ? `${styles.chip} ${styles.chipNeutral}` : styles.chip}>
                      {row.neutral ? 'Refund · not spending' : row.category}
                    </span>
                  </span>
                </li>
              ))}
            </ul>

            <div className={styles.teach}>
              <div className={styles.teachCard} aria-hidden="true">
                <code>AL NOOR LDRY 22</code>
                <span className={styles.teachChips}>
                  <span className={`${styles.chip} ${styles.chipNeutral} ${styles.teachBefore}`}>Other</span>
                  <span className={`${styles.chip} ${styles.teachAfter}`}>Home services</span>
                  <span className={styles.tap} />
                </span>
              </div>
              <p><strong>Tell it once.</strong> Change a merchant’s category and its next charges follow your choice.</p>
            </div>
          </div>
        </section>

        <section className={styles.radar} id="subscriptions" aria-labelledby="radar-title">
          <div className={styles.radarIntro}>
            <p className={styles.kicker}>Subscriptions and bills</p>
            <h2 id="radar-title">See every renewal before it lands.</h2>
            <p>
              Wafra spots charges that repeat, learns their rhythm and shows when the next one is due. Price rises and
              services that have gone quiet are flagged.
            </p>
          </div>

          <div className={styles.radarBoard}>
            <div className={styles.timeline} aria-hidden="true">
              <span className={styles.today}>Today</span>
              {renewals.filter((item) => item.day !== null).map((item, index) => (
                <span
                  className={item.alert ? `${styles.pin} ${styles.pinAlert}` : styles.pin}
                  key={item.name}
                  style={{ '--day': item.day, '--i': index } as React.CSSProperties}
                >
                  <b>{item.name.split(' ')[0]}</b>
                </span>
              ))}
              <span className={styles.axis}><i>0</i><i>10 days</i><i>20 days</i><i>30</i></span>
            </div>

            <ul className={styles.renewals} aria-label="Upcoming charges, sample data">
              {renewals.map((item) => (
                <li className={item.muted ? styles.renewalMuted : undefined} key={item.name}>
                  <div>
                    <strong>{item.name}</strong>
                    <span>{item.detail}</span>
                  </div>
                  <span className={item.alert ? `${styles.tag} ${styles.tagAlert}` : styles.tag}>{item.tag}</span>
                  <span className={styles.renewalAmount}>{item.amount}</span>
                </li>
              ))}
            </ul>
            <div className={styles.radarTotal}>
              <span>Subscriptions</span>
              <strong>$27.48<small> / month</small></strong>
              <p>Utilities, rent and card statements are counted apart, so this is only what you could cancel.</p>
            </div>
          </div>
        </section>

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

        <section className={styles.features} id="daily-picture">
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
          <div>
            <p>Private budget and expense tracking anywhere, on iPhone and Android.</p>
            <p><a href="/privacy/">Privacy</a> · <a href="/terms/">Terms</a> · <a href="/support/">Support</a></p>
          </div>
          <p className={styles.footnote}>Automatic bank-alert support varies by bank, country and message format. Wafra is not a bank and does not provide financial advice.</p>
        </footer>
      </main>
    </>
  );
}
