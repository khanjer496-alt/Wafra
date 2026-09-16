import type { IconName } from '@/components/ui/icon.types';
import type { OnboardingBankExample, OnboardingBankRegion } from '@/lib/onboarding-bank-examples';

/**
 * Display-only example alerts for the first-run welcome. Each example is a
 * bank text the user could plausibly receive in their region, split into the
 * pieces Wafra reads (amount, card, merchant) and the pieces it ignores.
 *
 * UAE and Saudi purchase and salary wording follows the formats in the parser
 * corpus. Other regions use a neutral card-alert wording and are labelled as
 * examples on screen; they never claim to be a specific bank's template.
 * Nothing here touches the ledger.
 */

export type AlertToken = 'amount' | 'card' | 'merchant';
export interface AlertSegment { readonly text: string; readonly token?: AlertToken }

export interface OnboardingMerchantExample {
  readonly name: string;
  /** Verified brand domain for the logo CDN; absent when the row should show its category glyph only. */
  readonly domain?: string;
  readonly icon: IconName;
}

export interface OnboardingAlertExample {
  readonly kind: 'purchase' | 'bill' | 'salary';
  readonly bank: OnboardingBankExample | null;
  readonly segments: readonly AlertSegment[];
  readonly merchant: OnboardingMerchantExample;
  /** Signed, formatted as the ledger row shows it. */
  readonly amount: string;
  readonly income: boolean;
}

const M = (name: string, icon: IconName, domain?: string): OnboardingMerchantExample => ({ name, icon, domain });

/** One grocer per region with a verified brand domain, so the example row carries a real logo. */
const GROCERS: Readonly<Record<string, OnboardingMerchantExample>> = {
  AE: M('Carrefour', 'cart', 'carrefouruae.com'),
  SA: M('Panda', 'cart', 'panda.com.sa'),
  US: M('Whole Foods', 'cart', 'wholefoodsmarket.com'),
  GB: M('Tesco', 'cart', 'tesco.com'),
  FR: M('Carrefour', 'cart', 'carrefour.fr'),
  DE: M('REWE', 'cart', 'rewe.de'),
  ES: M('Mercadona', 'cart', 'mercadona.es'),
  IT: M('Esselunga', 'cart', 'esselunga.it'),
  NL: M('Albert Heijn', 'cart', 'ah.nl'),
  IN: M('BigBasket', 'cart', 'bigbasket.com'),
  QA: M('Lulu', 'cart', 'luluhypermarket.com'),
  KW: M('Sultan Center', 'cart', 'sultan-center.com'),
  BH: M('Lulu', 'cart', 'luluhypermarket.com'),
  OM: M('Lulu', 'cart', 'luluhypermarket.com'),
  EG: M('Carrefour', 'cart', 'carrefouregypt.com'),
  JO: M('Carrefour', 'cart', 'carrefourjordan.com'),
};

const UTILITIES: Readonly<Record<string, OnboardingMerchantExample>> = {
  AE: M('DEWA', 'bolt', 'dewa.gov.ae'),
  SA: M('Saudi Electricity', 'bolt', 'se.com.sa'),
  GB: M('Octopus Energy', 'bolt', 'octopus.energy'),
  US: M('Con Edison', 'bolt', 'coned.com'),
  QA: M('Kahramaa', 'bolt', 'km.qa'),
};

const GULF_FORMAT = new Set(['AE', 'SA', 'QA', 'KW', 'BH', 'OM']);

export function onboardingAlertExamples(
  region: OnboardingBankRegion | null,
  labels: { grocery: string; electricity: string; salary: string },
): readonly OnboardingAlertExample[] {
  const id = region?.id ?? '';
  const currency = region?.currency ?? '';
  const money = (value: string): string => (currency ? `${currency} ${value}` : value);
  const banks = region?.banks ?? [];
  const grocer = GROCERS[id] ?? M(labels.grocery, 'cart');
  const utility = UTILITIES[id] ?? M(labels.electricity, 'bolt');
  const gulf = GULF_FORMAT.has(id);
  const upper = grocer.name.toUpperCase();

  const purchase: readonly AlertSegment[] = gulf
    ? [
      { text: 'Purchase of ' }, { text: money('120.00'), token: 'amount' }, { text: ' with Debit Card ending ' },
      { text: '1234', token: 'card' }, { text: ' at ' }, { text: upper, token: 'merchant' },
      { text: `. Avl Balance is ${money('5,000.00')}.` },
    ]
    : [
      { text: money('120.00'), token: 'amount' }, { text: ' spent at ' }, { text: upper, token: 'merchant' },
      { text: ' with card ending ' }, { text: '1234', token: 'card' }, { text: '.' },
    ];
  const bill: readonly AlertSegment[] = [
    { text: money('318.00'), token: 'amount' }, { text: ' paid to ' }, { text: utility.name, token: 'merchant' },
    { text: ' from account ending ' }, { text: '5678', token: 'card' }, { text: '.' },
  ];
  const salary: readonly AlertSegment[] = [
    { text: 'Your salary of ' }, { text: money('7,500.00'), token: 'amount' }, { text: ' has been credited to your account ending ' },
    { text: '5678', token: 'card' }, { text: '.' },
  ];

  return [
    { kind: 'purchase', bank: banks[0] ?? null, segments: purchase, merchant: grocer, amount: `−${money('120.00')}`, income: false },
    { kind: 'bill', bank: banks[1] ?? null, segments: bill, merchant: utility, amount: `−${money('318.00')}`, income: false },
    { kind: 'salary', bank: banks[2] ?? null, segments: salary, merchant: M(labels.salary, 'briefcase'), amount: `+${money('7,500.00')}`, income: true },
  ];
}
