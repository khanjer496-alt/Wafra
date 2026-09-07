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
  'https://github.com/khanjer496-alt/Wafra/releases/download/android-clarity-67f996b/Wafra-android-67f996b.apk';
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
