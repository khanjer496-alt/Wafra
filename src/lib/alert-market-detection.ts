import { inspectAlertInstitutionGrammar } from '@/lib/alert-institution-grammars';
import type { UniversalMarket } from '@/lib/alert-market-pack-types';
import { inspectMarketAlert, type MarketAlertReview } from '@/lib/alert-semantics';
import { MARKETS } from '@/lib/markets';

export type DetectedMarket = 'AE' | 'SA' | UniversalMarket;
export type MarketRouteEvidence = 'sender' | 'institution' | 'currency' |
  'grammar' | 'region-hint';

export interface AlertMarketRouteCandidate {
  market: DetectedMarket;
  evidence: MarketRouteEvidence[];
}

export interface AlertMarketRoute {
  decision: 'single' | 'ambiguous' | 'unknown';
  market: DetectedMarket | null;
  candidates: AlertMarketRouteCandidate[];
  reasons: string[];
}

export interface AlertMarketRoutingInput {
  source: string;
  sender?: string | null;
  /** Device/SIM-derived region is a hint only; it can never create a route. */
  regionHint?: string | null;
}

export interface UniversalAlertReview {
  route: AlertMarketRoute;
  /** Review-only global semantics. UAE/Saudi continue through parseSms. */
  review: MarketAlertReview | null;
}

export interface CaptureMarketInferenceInput {
  regionHint?: string | null;
  alerts: readonly {
    sourceKey: string;
    source: string;
    sender?: string | null;
  }[];
}

export interface CaptureMarketInference {
  decision: 'resolved' | 'provisional' | 'ambiguous' | 'unknown';
  market: DetectedMarket | null;
  candidates: DetectedMarket[];
  reasons: string[];
}

const UNIVERSAL_MARKETS: readonly UniversalMarket[] = [
  'US', 'GB', 'FR', 'DE', 'ES', 'IT', 'NL', 'IN', 'QA', 'KW', 'BH', 'OM', 'EG', 'JO',
];
const ALL_MARKETS: readonly DetectedMarket[] = ['AE', 'SA', ...UNIVERSAL_MARKETS];
const MARKET_CURRENCY: Record<DetectedMarket, string> = {
  AE: 'AED', SA: 'SAR', US: 'USD', GB: 'GBP', FR: 'EUR', DE: 'EUR', ES: 'EUR',
  IT: 'EUR', NL: 'EUR', IN: 'INR', QA: 'QAR', KW: 'KWD', BH: 'BHD', OM: 'OMR',
  EG: 'EGP', JO: 'JOD',
};
const GRAMMAR_MARKERS: Partial<Record<DetectedMarket, RegExp>> = {
  IN: /\b(?:upi|imps|neft|rtgs|aeps|nach)\b|₹|रु(?:पये)?/iu,
  US: /\b(?:zelle|ach debit)\b/iu,
  GB: /\b(?:faster payments|bacs|sort code)\b/iu,
  FR: /\b(?:d[eé]bit[eé]|cr[eé]dit[eé]|pr[eé]l[eè]vement)\b/iu,
  DE: /\b(?:abgebucht|gutgeschrieben|lastschrift|dauerauftrag)\b/iu,
  ES: /\b(?:domiciliaci[oó]n|cargado|abonado)\b/iu,
  IT: /\b(?:addebito|accreditato|bonifico)\b/iu,
  NL: /\b(?:afgeschreven|bijgeschreven|incasso)\b/iu,
  KW: /\bknet\b/iu,
  EG: /\bmeeza\b|ميزة/iu,
};

const regionMarket = (hint?: string | null): DetectedMarket | null => {
  if (!hint) return null;
  const parts = hint.replace('_', '-').split('-');
  const region = [...parts].reverse().find((part) => /^[A-Za-z]{2}$/.test(part))?.toUpperCase();
  return region && ALL_MARKETS.includes(region as DetectedMarket)
    ? region as DetectedMarket
    : null;
};

const currencyMarkets = (source: string): Set<DetectedMarket> => {
  const codes = new Set(
    source.slice(0, 4096).toUpperCase().match(/\b(?:AED|SAR|USD|GBP|EUR|INR|QAR|KWD|BHD|OMR|EGP|JOD)\b/g) ?? [],
  );
  const markets = new Set<DetectedMarket>();
  for (const market of ALL_MARKETS) {
    if (codes.has(MARKET_CURRENCY[market])) markets.add(market);
  }
  return markets;
};

interface MarketRouteEvidenceSummary {
  evidence: Map<DetectedMarket, Set<MarketRouteEvidence>>;
  institutionConflict: boolean;
}

const evidenceFor = (input: AlertMarketRoutingInput): MarketRouteEvidenceSummary => {
  const evidence = new Map<DetectedMarket, Set<MarketRouteEvidence>>();
  let institutionConflict = false;
  const add = (market: DetectedMarket, kind: MarketRouteEvidence) => {
    const kinds = evidence.get(market) ?? new Set<MarketRouteEvidence>();
    kinds.add(kind);
    evidence.set(market, kinds);
  };
  const source = input.source.slice(0, 4096);
  const sender = input.sender?.slice(0, 256) ?? '';

  for (const market of UNIVERSAL_MARKETS) {
    const review = inspectAlertInstitutionGrammar(source, market, sender);
    for (const candidate of review.candidates) {
      if (candidate.evidence.includes('sender')) add(market, 'sender');
      if (candidate.evidence.includes('body')) add(market, 'institution');
    }
    // The old implementation called inspectAlertInstitutionGrammar a second
    // time for every market solely to derive this boolean. Carry the result
    // out of the same pass so route semantics stay identical while global
    // candidates do half the institution-grammar work.
    if (
      review.decision === 'ambiguous' &&
      review.candidates.some((candidate) => candidate.evidence.includes('sender')) &&
      review.candidates.some((candidate) => candidate.evidence.includes('body'))
    ) {
      institutionConflict = true;
    }
  }
  for (const market of MARKETS) {
    if (!sender || (market.id !== 'AE' && market.id !== 'SA')) continue;
    if (market.banks.some((bank) => bank.re.test(sender))) add(market.id as 'AE' | 'SA', 'sender');
  }
  for (const market of currencyMarkets(source)) add(market, 'currency');
  for (const [market, marker] of Object.entries(GRAMMAR_MARKERS)) {
    if (marker?.test(source)) add(market as DetectedMarket, 'grammar');
  }
  const region = regionMarket(input.regionHint);
  if (region && evidence.has(region)) add(region, 'region-hint');
  return { evidence, institutionConflict };
};

const candidatesFrom = (
  evidence: Map<DetectedMarket, Set<MarketRouteEvidence>>,
): AlertMarketRouteCandidate[] => [...evidence].map(([market, kinds]) => ({
  market,
  evidence: [...kinds].sort(),
})).sort((a, b) => a.market.localeCompare(b.market));

/** Resolve one alert's issuer/grammar market without retaining its source or sender. */
export const routeAlertMarket = (input: AlertMarketRoutingInput): AlertMarketRoute => {
  const { evidence, institutionConflict } = evidenceFor(input);
  const candidates = candidatesFrom(evidence);
  if (institutionConflict) {
    return { decision: 'ambiguous', market: null, candidates, reasons: ['sender-institution-conflict'] };
  }
  const withKind = (kind: MarketRouteEvidence) =>
    candidates.filter((candidate) => candidate.evidence.includes(kind));
  const sender = withKind('sender');
  const institution = withKind('institution');

  if (sender.length > 1) {
    return { decision: 'ambiguous', market: null, candidates, reasons: ['overlapping-sender'] };
  }
  if (sender.length === 1) {
    const bodyConflict = institution.some((candidate) => candidate.market !== sender[0].market);
    if (bodyConflict) {
      return { decision: 'ambiguous', market: null, candidates, reasons: ['sender-institution-conflict'] };
    }
    return { decision: 'single', market: sender[0].market, candidates, reasons: [] };
  }
  if (institution.length === 1) {
    return { decision: 'single', market: institution[0].market, candidates, reasons: [] };
  }
  if (institution.length > 1) {
    return { decision: 'ambiguous', market: null, candidates, reasons: ['multiple-institutions'] };
  }

  const grammar = withKind('grammar');
  if (grammar.length === 1 && grammar[0].evidence.includes('currency')) {
    return { decision: 'single', market: grammar[0].market, candidates, reasons: [] };
  }
  if (candidates.length > 0) {
    return { decision: 'ambiguous', market: null, candidates, reasons: ['insufficient-market-evidence'] };
  }
  return { decision: 'unknown', market: null, candidates: [], reasons: ['no-market-evidence'] };
};

/** Inspect a global alert only after its route is unambiguous. Never imports. */
export const inspectUniversalAlert = (input: AlertMarketRoutingInput): UniversalAlertReview => {
  const route = routeAlertMarket(input);
  if (route.decision !== 'single' || !route.market || route.market === 'AE' || route.market === 'SA') {
    return { route, review: null };
  }
  return {
    route,
    review: inspectMarketAlert(input.source, route.market, { sender: input.sender }),
  };
};

/** Resolve a capture market from independent alerts; locale alone stays provisional. */
export const inferCaptureMarket = (input: CaptureMarketInferenceInput): CaptureMarketInference => {
  const seen = new Set<string>();
  const routes: AlertMarketRoute[] = [];
  for (const alert of input.alerts.slice(0, 50)) {
    if (!/^[A-Za-z0-9_-]{16,128}$/.test(alert.sourceKey) || seen.has(alert.sourceKey)) continue;
    seen.add(alert.sourceKey);
    routes.push(routeAlertMarket({
      source: alert.source,
      sender: alert.sender,
      regionHint: input.regionHint,
    }));
  }
  const single = routes.filter((route) => route.decision === 'single' && route.market);
  const markets = [...new Set(single.map((route) => route.market as DetectedMarket))].sort();
  if (markets.length > 1) {
    return { decision: 'ambiguous', market: null, candidates: markets, reasons: ['conflicting-alert-markets'] };
  }
  if (markets.length === 1) {
    const market = markets[0];
    const matching = single.filter((route) => route.market === market);
    const oneFullyCorroborated = matching.some((route) => {
      const candidate = route.candidates.find((item) => item.market === market);
      return candidate?.evidence.includes('sender') && candidate.evidence.includes('currency') &&
        candidate.evidence.includes('region-hint');
    });
    return {
      decision: matching.length >= 2 || oneFullyCorroborated ? 'resolved' : 'provisional',
      market,
      candidates: [market],
      reasons: matching.length >= 2 || oneFullyCorroborated ? [] : ['needs-independent-alert'],
    };
  }
  const region = regionMarket(input.regionHint);
  if (region) {
    return { decision: 'provisional', market: region, candidates: [region], reasons: ['region-hint-only'] };
  }
  return { decision: 'unknown', market: null, candidates: [], reasons: ['no-market-evidence'] };
};
