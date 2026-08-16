import { readFile } from 'node:fs/promises';

const metadata = JSON.parse(
  await readFile(new URL('../docs/store-metadata.json', import.meta.url), 'utf8'),
);

const errors = [];
const length = (value) => [...value].length;
const exactValues = (actual, expected, label) => {
  const normalized = [...actual].sort();
  if (JSON.stringify(normalized) !== JSON.stringify(expected)) {
    errors.push(`${label} must be exactly ${expected.join(', ')}`);
  }
};
const limit = (value, max, label) => {
  if (typeof value !== 'string' || value.trim() === '') {
    errors.push(`${label} is empty`);
  } else if (length(value) > max) {
    errors.push(`${label} is ${length(value)} characters; maximum is ${max}`);
  }
};

exactValues(Object.keys(metadata.apple.locales), ['ar-SA', 'en-US'], 'Apple launch locales');
for (const [locale, entry] of Object.entries(metadata.apple.locales)) {
  limit(entry.name, 30, `Apple ${locale} name`);
  limit(entry.subtitle, 30, `Apple ${locale} subtitle`);
  limit(entry.keywords, 100, `Apple ${locale} keywords`);
  limit(entry.promotionalText, 170, `Apple ${locale} promotional text`);
  limit(entry.description, 4000, `Apple ${locale} description`);
  if (/\s,|,\s/.test(entry.keywords)) {
    errors.push(`Apple ${locale} keywords must be comma-separated without spaces`);
  }
  const indexedWords = new Set(
    `${entry.name},${entry.subtitle}`
      .toLocaleLowerCase(locale)
      .split(/[^\p{L}\p{N}]+/u)
      .filter(Boolean),
  );
  const duplicates = entry.keywords
    .split(',')
    .filter((keyword) => indexedWords.has(keyword.toLocaleLowerCase(locale)));
  if (duplicates.length > 0) {
    errors.push(`Apple ${locale} keywords repeat name/subtitle words: ${duplicates.join(', ')}`);
  }
}

for (const [listing, entry] of Object.entries(metadata.googlePlay.listings)) {
  limit(entry.languageCode, 20, `Google Play ${listing} language code`);
  limit(entry.title, 30, `Google Play ${listing} title`);
  limit(entry.shortDescription, 80, `Google Play ${listing} short description`);
  limit(entry.fullDescription, 4000, `Google Play ${listing} full description`);
}

const launchListings = metadata.googlePlay.launchListings ?? [];
if (new Set(launchListings).size !== launchListings.length || launchListings.length < 1) {
  errors.push('Google Play launch listings must be a non-empty unique list');
}
for (const listing of launchListings) {
  const entry = metadata.googlePlay.listings[listing];
  if (!entry) {
    errors.push(`Google Play launch listing ${listing} does not exist`);
  } else if (entry.status?.startsWith('future-')) {
    errors.push(`Google Play launch listing ${listing} is marked as a future draft`);
  }
}
exactValues(
  launchListings.map((listing) => metadata.googlePlay.listings[listing]?.languageCode),
  ['ar', 'en-US'],
  'Google Play launch language codes',
);

const productIds = ['wafra_pro_monthly', 'wafra_pro_yearly'];
for (const productId of productIds) {
  const apple = metadata.apple.subscriptionLocalizations?.[productId] ?? {};
  for (const locale of ['en-US', 'ar-SA']) {
    const entry = apple[locale] ?? {};
    limit(entry.displayName, 30, `Apple ${productId} ${locale} display name`);
    limit(entry.description, 45, `Apple ${productId} ${locale} description`);
  }

  const google = metadata.googlePlay.subscriptionLocalizations?.[productId] ?? {};
  for (const locale of ['en-US', 'ar']) {
    const entry = google[locale] ?? {};
    limit(entry.title, 55, `Google Play ${productId} ${locale} title`);
    limit(entry.description, 200, `Google Play ${productId} ${locale} description`);
    if (!Array.isArray(entry.benefits) || entry.benefits.length < 1 || entry.benefits.length > 4) {
      errors.push(`Google Play ${productId} ${locale} must have 1–4 benefits`);
      continue;
    }
    entry.benefits.forEach((benefit, index) => {
      limit(benefit, 40, `Google Play ${productId} ${locale} benefit ${index + 1}`);
    });
  }
}

const customerFacing = JSON.stringify({
  apple: metadata.apple.locales,
  appleSubscriptions: metadata.apple.subscriptionLocalizations,
  googlePlay: metadata.googlePlay.listings,
  googlePlaySubscriptions: metadata.googlePlay.subscriptionLocalizations,
  screenshots: metadata.screenshots,
});
for (const claim of [
  /every bank/i,
  /all banks/i,
  /any bank/i,
  /every subscription/i,
  /works exactly like android/i,
  /all currencies/i,
  /worldwide parsing/i,
  /reads (your )?iphone messages/i,
]) {
  if (claim.test(customerFacing)) errors.push(`unsupported customer-facing claim matches ${claim}`);
}

const appleStory = metadata.screenshots.apple.story;
if (!Array.isArray(appleStory) || appleStory.length < 1 || appleStory.length > 10) {
  errors.push('Apple screenshot story must contain 1–10 frames');
}
for (const [index, frame] of (appleStory ?? []).entries()) {
  for (const locale of metadata.screenshots.apple.locales ?? []) {
    limit(frame.headline?.[locale], 80, `Apple screenshot ${index + 1} ${locale} headline`);
    limit(frame.altText?.[locale], 140, `Apple screenshot ${index + 1} ${locale} alt text`);
  }
}
for (const key of ['googleGlobal', 'googleGulf']) {
  const screenshots = metadata.screenshots[key];
  for (const locale of screenshots.locales ?? []) {
    const story = screenshots.story?.[locale];
    if (!Array.isArray(story) || story.length < 2 || story.length > 8) {
      errors.push(`${key} ${locale} screenshot story must contain 2–8 frames`);
      continue;
    }
    story.forEach((frame, index) => {
      limit(frame?.headline, 80, `${key} ${locale} screenshot ${index + 1} headline`);
      limit(frame?.altText, 140, `${key} ${locale} screenshot ${index + 1} alt text`);
    });
  }
}

if (JSON.stringify(metadata.launchScope?.storefronts) !== JSON.stringify(['AE', 'SA'])) {
  errors.push('launch storefronts must remain AE/SA until broader ledger currencies ship');
}
if (JSON.stringify(metadata.launchScope?.ledgerCurrencies) !== JSON.stringify(['AED', 'SAR'])) {
  errors.push('launch ledger currencies must match the shipping UAE/Saudi markets');
}

if (errors.length) {
  console.error('Store metadata is invalid:\n');
  for (const error of errors) console.error(`  - ${error}`);
  process.exit(1);
}

console.log('Store metadata limits, localized stories, launch scope, and guarded claims are valid.');
