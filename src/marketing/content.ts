const getSiteUrl = () => {
  try {
    const parsed = new URL(process.env.EXPO_PUBLIC_WAFRA_SITE_URL ?? '');
    const isOriginOnly = parsed.pathname === '/' && !parsed.search && !parsed.hash;
    const hostname = parsed.hostname.toLowerCase();
    const isPlaceholder =
      hostname === 'localhost' ||
      hostname === '0.0.0.0' ||
      hostname === '[::1]' ||
      hostname === 'example.com' ||
      hostname === 'example.org' ||
      hostname === 'example.net' ||
      hostname.endsWith('.localhost') ||
      hostname.endsWith('.example') ||
      hostname.endsWith('.example.com') ||
      hostname.endsWith('.example.org') ||
      hostname.endsWith('.example.net') ||
      hostname.endsWith('.invalid') ||
      hostname.endsWith('.test');
    return parsed.protocol === 'https:' &&
      !parsed.username &&
      !parsed.password &&
      isOriginOnly &&
      !isPlaceholder
      ? parsed.origin
      : '';
  } catch {
    return '';
  }
};

export const SITE_URL = getSiteUrl();
export const TESTFLIGHT_URL = 'https://testflight.apple.com/join/jbwzCgZ6';
export const ANDROID_APK_URL =
  'https://github.com/khanjer496-alt/Wafra/releases/download/ledger-light-135-ios-54/Wafra-Ledger-Light-135.apk';
export const MARKETING_TITLE = 'Wafra — Private Budget & Expense Tracker';
export const MARKETING_DESCRIPTION =
  'Track spending, budgets, bills and subscriptions anywhere without a bank login. Start manually or use optional supported imports.';

export const PRODUCT_SCHEMA = {
  '@context': 'https://schema.org',
  '@type': 'SoftwareApplication',
  name: 'Wafra',
  alternateName: 'وفرة',
  applicationCategory: 'FinanceApplication',
  operatingSystem: 'iOS, Android',
  description: MARKETING_DESCRIPTION,
  inLanguage: ['en', 'ar'],
  featureList: [
    'Manual expense and income tracking',
    'Category budgets',
    'Bills and card due-date reminders',
    'Recurring charge detection',
    'Salary-day reporting periods',
    'Optional supported bank-alert imports where available',
    'Encrypted on-device ledger',
  ],
  ...(SITE_URL ? { url: SITE_URL } : {}),
};

export const FAQ_SCHEMA = {
  '@context': 'https://schema.org',
  '@type': 'FAQPage',
  mainEntity: [
    {
      '@type': 'Question',
      name: 'Does Wafra connect to my bank account?',
      acceptedAnswer: {
        '@type': 'Answer',
        text: 'No. Wafra works without a bank login. You can enter transactions manually or choose an optional supported import method.',
      },
    },
    {
      '@type': 'Question',
      name: 'Does Wafra read every message on my phone?',
      acceptedAnswer: {
        '@type': 'Answer',
        text: 'No. Android message access is optional and used for supported financial alerts when enabled. iPhone does not give Wafra direct Messages inbox access; optional automatic capture runs only for bank senders the user selects, then processes supported bank alerts locally on the iPhone. This path does not upload Message text.',
      },
    },
    {
      '@type': 'Question',
      name: 'Can I use Wafra anywhere?',
      acceptedAnswer: {
        '@type': 'Answer',
        text: 'Yes. Manual budgeting and expense tracking work anywhere. Automatic bank-alert imports vary by bank, country and message format.',
      },
    },
  ],
};

export const featureCards = [
  {
    number: '01',
    title: 'See what you spent',
    copy: 'Review recorded spending with income alongside it. Follow a calendar month or a reporting period that starts on your salary day.',
  },
  {
    number: '02',
    title: 'See what is coming',
    copy: 'Keep bills, card statements and recurring charges together, with due dates that do not disappear into a feed.',
  },
  {
    number: '03',
    title: 'Catch drift early',
    copy: 'Set category budgets and read spending pace before a small change becomes an end-of-month surprise.',
  },
];

/* Illustration data for the landing demos. Synthetic sample data only. */
export const captureLanes = [
  {
    platform: 'iPhone',
    note: 'Bank texts from senders you choose',
    steps: [
      { title: 'A bank text arrives', copy: 'Only from a bank sender you selected in Apple Shortcuts.' },
      { title: 'Shortcuts hands it over', copy: 'A personal automation passes it to Wafra Local Capture on the same iPhone. There is no network step.' },
      { title: 'Read on the iPhone', copy: 'The parser keeps the amount, merchant and date. Codes and promotions are dropped, and the raw text is deleted.' },
      { title: 'In your ledger', copy: 'When iOS next lets Wafra run, or as soon as you open it.' },
    ],
  },
  {
    platform: 'Android',
    note: 'Bank SMS and bank-app alerts',
    steps: [
      { title: 'An alert arrives', copy: 'A bank SMS, or an optional bank-app notification.' },
      { title: 'Read on the device', copy: 'Only with the access you grant. Messages that are not financial are ignored.' },
      { title: 'Sorted and saved', copy: 'Added to the encrypted ledger, or held for your review when Wafra is not sure.' },
    ],
  },
  {
    platform: 'Past months',
    note: 'Both platforms',
    steps: [
      { title: 'Import a statement', copy: 'A PDF or CSV from your bank fills in what happened before you installed Wafra.' },
      { title: 'Or add it by hand', copy: 'Manual entry works in every country, with or without alerts.' },
    ],
  },
];

export const sortingRows = [
  { raw: 'POS 4821 CARREFOUR MKT 0231', merchant: 'Carrefour', category: 'Groceries' },
  { raw: 'UBER *TRIP HELP.UBER.COM', merchant: 'Uber', category: 'Transport' },
  { raw: 'STARBUCKS #1182 DUBAI MALL', merchant: 'Starbucks', category: 'Dining' },
  { raw: 'NETFLIX.COM 866-579-7172', merchant: 'Netflix', category: 'Entertainment' },
  { raw: 'REFUND AMAZON MKTPLACE', merchant: 'Amazon', category: 'Refund', neutral: true },
];

export const renewals = [
  { name: 'Netflix', detail: 'Monthly · renews in 3 days', amount: '$15.49', day: 3, tag: 'Subscription' },
  { name: 'Spotify', detail: 'Monthly · was $10.99', amount: '$11.99', day: 12, tag: 'Price went up', alert: true },
  { name: 'Electricity', detail: 'Utilities · due in 9 days', amount: '≈ $84.20', day: 9, tag: 'Bill' },
  { name: 'Visa ••4821 statement', detail: 'Card · due in 18 days', amount: '$1,240.00', day: 18, tag: 'Card due' },
  { name: 'City Gym', detail: 'No charge for two months', amount: '$39.00', day: null, tag: 'Likely stopped', muted: true },
];

export const faqItems = [
  {
    question: 'Does Wafra connect to my bank account?',
    answer:
      'No. There is no bank login. Start manually, paste an alert you choose, or enable an optional supported import method on your device.',
  },
  {
    question: 'Does Wafra read every message on my phone?',
    answer:
      'No. Android message access is optional and only used after you choose supported alert imports. iPhone does not expose the Messages inbox to Wafra; optional capture runs only for bank senders the user selects, then processes supported bank alerts locally on the iPhone. This path does not upload Message text.',
  },
  {
    question: 'Can I use Wafra anywhere?',
    answer:
      'Yes. Manual budgeting and expense tracking work anywhere. Automatic bank-alert imports vary by bank, country and message format, so manual entry remains available when an alert is not supported.',
  },
];

export const structuredData = (value: object) => ({
  __html: JSON.stringify(value).replace(/</g, '\\u003c'),
});
