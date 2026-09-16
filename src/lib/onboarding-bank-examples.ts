import { MARKETS } from '@/lib/markets';
import type { UniversalMarket } from '@/lib/alert-market-pack-types';

export interface OnboardingBankExample {
  readonly name: string;
  readonly domain: string;
  readonly color: string;
}

export interface OnboardingBankRegion {
  readonly id: string;
  readonly currency: string;
  readonly banks: readonly OnboardingBankExample[];
}

type PreviewMarket = 'AE' | 'SA' | UniversalMarket;

const U = (name: string, domain: string, color = '#6B6559'): OnboardingBankExample =>
  Object.freeze({ name, domain, color });

/**
 * Display-only bank examples for onboarding. These mirror the institution
 * markets Wafra already knows how to inspect; they are not a partnership list
 * and they never claim that an individual user's bank has been connected.
 *
 * Keep this deliberately small (three identities per region). A country added
 * to the alert/institution layer can opt into onboarding by adding one row
 * here; unsupported locales fall back to neutral bank glyphs rather than a
 * famous-but-unverified brand.
 */
const UNIVERSAL_PREVIEWS: Readonly<Record<UniversalMarket, OnboardingBankRegion>> = Object.freeze({
  US: { id: 'US', currency: 'USD', banks: [
    U('Chase', 'chase.com', '#117ACA'), U('Bank of America', 'bankofamerica.com', '#E31837'), U('Wells Fargo', 'wellsfargo.com', '#D71E28'),
  ] },
  GB: { id: 'GB', currency: 'GBP', banks: [
    U('Barclays', 'barclays.co.uk', '#00AEEF'), U('HSBC', 'hsbc.co.uk', '#DB0011'), U('Lloyds Bank', 'lloydsbank.com', '#006A4D'),
  ] },
  FR: { id: 'FR', currency: 'EUR', banks: [
    U('BNP Paribas', 'bnpparibas.com', '#00965E'), U('Société Générale', 'societegenerale.com', '#E50A30'), U('Crédit Agricole', 'credit-agricole.com', '#007A71'),
  ] },
  DE: { id: 'DE', currency: 'EUR', banks: [
    U('Deutsche Bank', 'deutsche-bank.de', '#0018A8'), U('Commerzbank', 'commerzbank.de', '#FFCC00'), U('Sparkasse', 'sparkasse.de', '#E30613'),
  ] },
  ES: { id: 'ES', currency: 'EUR', banks: [
    U('Santander', 'santander.com', '#EC0000'), U('BBVA', 'bbva.com', '#004481'), U('CaixaBank', 'caixabank.com', '#007EAE'),
  ] },
  IT: { id: 'IT', currency: 'EUR', banks: [
    U('Intesa Sanpaolo', 'intesasanpaolo.com', '#258900'), U('UniCredit', 'unicredit.it', '#E30613'), U('Banco BPM', 'bancobpm.it', '#003B70'),
  ] },
  NL: { id: 'NL', currency: 'EUR', banks: [
    U('ING', 'ing.com', '#FF6200'), U('Rabobank', 'rabobank.nl', '#FF6600'), U('ABN AMRO', 'abnamro.nl', '#009B77'),
  ] },
  IN: { id: 'IN', currency: 'INR', banks: [
    U('State Bank of India', 'sbi.co.in', '#00AEEF'), U('HDFC Bank', 'hdfcbank.com', '#004C8F'), U('ICICI Bank', 'icicibank.com', '#F58220'),
  ] },
  QA: { id: 'QA', currency: 'QAR', banks: [
    U('QNB', 'qnb.com', '#7A1D5D'), U('Qatar Islamic Bank', 'qib.com.qa', '#7A2058'), U('Commercial Bank Qatar', 'cbq.qa', '#00529B'),
  ] },
  KW: { id: 'KW', currency: 'KWD', banks: [
    U('National Bank of Kuwait', 'nbk.com', '#00529B'), U('Kuwait Finance House', 'kfh.com', '#00843D'), U('Boubyan Bank', 'bankboubyan.com', '#1A1A1A'),
  ] },
  BH: { id: 'BH', currency: 'BHD', banks: [
    U('National Bank of Bahrain', 'nbbonline.com', '#B59A5B'), U('Bank of Bahrain and Kuwait', 'bbkonline.com', '#005CA9'), U('Bank ABC', 'bank-abc.com', '#5B2B82'),
  ] },
  OM: { id: 'OM', currency: 'OMR', banks: [
    U('Bank Muscat', 'bankmuscat.com', '#7F1D5A'), U('BankDhofar', 'bankdhofar.com', '#8B1B2D'), U('Sohar International', 'sib.om', '#00A3AD'),
  ] },
  EG: { id: 'EG', currency: 'EGP', banks: [
    U('National Bank of Egypt', 'nbe.com.eg', '#F3B61F'), U('Banque Misr', 'banquemisr.com', '#A11C36'), U('CIB', 'cibeg.com', '#0067B1'),
  ] },
  JO: { id: 'JO', currency: 'JOD', banks: [
    U('Arab Bank', 'arabbank.com', '#006A44'), U('Bank al Etihad', 'bankaletihad.com', '#E2231A'), U('Housing Bank', 'hbtf.com', '#007A3D'),
  ] },
});

const launchPreview = (id: 'AE' | 'SA'): OnboardingBankRegion => {
  const market = MARKETS.find((candidate) => candidate.id === id)!;
  return {
    id,
    currency: market.currency.code,
    banks: market.banks.filter((bank) => !!bank.domain).slice(0, 3).map((bank) => ({
      name: bank.name,
      domain: bank.domain!,
      color: bank.color,
    })),
  };
};

const REGION_IDS = new Set<PreviewMarket>([
  'AE', 'SA', 'US', 'GB', 'FR', 'DE', 'ES', 'IT', 'NL', 'IN', 'QA', 'KW', 'BH', 'OM', 'EG', 'JO',
]);

export function onboardingLocaleRegion(): PreviewMarket | null {
  try {
    const locale = Intl.DateTimeFormat().resolvedOptions().locale ?? '';
    const region = locale.match(/[-_]([A-Za-z]{2})\b/)?.[1]?.toUpperCase() as PreviewMarket | undefined;
    return region && REGION_IDS.has(region) ? region : null;
  } catch {
    return null;
  }
}

export function onboardingBankRegion(fallbackMarketId?: string | null, regionHint?: string | null): OnboardingBankRegion | null {
  const normalizedHint = regionHint?.trim().toUpperCase();
  // A real but unsupported device Region is positive evidence that the AE/SA
  // parser fallback is NOT the user's onboarding country. Stay neutral rather
  // than showing a famous bank from the wrong market.
  if (normalizedHint) {
    if (!REGION_IDS.has(normalizedHint as PreviewMarket)) return null;
    if (normalizedHint === 'AE' || normalizedHint === 'SA') return launchPreview(normalizedHint);
    return UNIVERSAL_PREVIEWS[normalizedHint as UniversalMarket] ?? null;
  }
  const localeRegion = onboardingLocaleRegion();
  if (localeRegion === 'AE' || localeRegion === 'SA') return launchPreview(localeRegion);
  if (localeRegion) return UNIVERSAL_PREVIEWS[localeRegion as UniversalMarket] ?? null;
  if (fallbackMarketId === 'AE' || fallbackMarketId === 'SA') return launchPreview(fallbackMarketId);
  return null;
}
