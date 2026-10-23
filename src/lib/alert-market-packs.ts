import { INDIA_ME_ALERT_MARKET_PACKS } from '@/lib/alert-market-packs.india-me';
import type { AlertMarketPack, UniversalMarket } from '@/lib/alert-market-pack-types';
import { US_EU_ALERT_MARKET_PACKS } from '@/lib/alert-market-packs.us-eu';
import { WORLD_ALERT_MARKET_PACKS } from '@/lib/alert-market-packs.world';

// Iraq and Lebanon: registry entries only, so their senders, institutions and
// money can be routed and reviewed. No posting vocabulary of their own yet;
// Arabic wording is read by the existing Gulf-neighbour packs. Lebanese
// alerts also quote USD, which stays USD evidence, never LBP. Neither is in
// universal-parser.ts LANGUAGE_PACKS. IQD figures carry no dot-decimal
// convention here: "IQD 250.000" is not read as 250 dinars by a route.
const MENA_REGISTRY_PACKS = {
  IQ: {
    market: 'IQ', currencies: ['IQD'], currencyAliases: {},
    rails: [], transferTerms: [], utilityTerms: [], recurringTerms: [],
  },
  LB: {
    market: 'LB', currencies: ['LBP', 'USD'], currencyAliases: {},
    rails: [], transferTerms: [], utilityTerms: [], recurringTerms: [],
  },
} as const satisfies Record<string, AlertMarketPack>;

const ALERT_MARKET_PACKS = {
  ...US_EU_ALERT_MARKET_PACKS,
  ...INDIA_ME_ALERT_MARKET_PACKS,
  ...WORLD_ALERT_MARKET_PACKS,
  ...MENA_REGISTRY_PACKS,
} as const satisfies Record<UniversalMarket, AlertMarketPack>;

export const alertMarketPack = (market: UniversalMarket): AlertMarketPack =>
  ALERT_MARKET_PACKS[market];

export type { AlertFamily, MoneyDirection, PostingStatus, UniversalMarket } from '@/lib/alert-market-pack-types';
