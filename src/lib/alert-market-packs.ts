import { INDIA_ME_ALERT_MARKET_PACKS } from '@/lib/alert-market-packs.india-me';
import type { AlertMarketPack, UniversalMarket } from '@/lib/alert-market-pack-types';
import { US_EU_ALERT_MARKET_PACKS } from '@/lib/alert-market-packs.us-eu';

const ALERT_MARKET_PACKS = {
  ...US_EU_ALERT_MARKET_PACKS,
  ...INDIA_ME_ALERT_MARKET_PACKS,
} as const satisfies Record<UniversalMarket, AlertMarketPack>;

export const alertMarketPack = (market: UniversalMarket): AlertMarketPack =>
  ALERT_MARKET_PACKS[market];

export type { AlertFamily, MoneyDirection, PostingStatus, UniversalMarket } from '@/lib/alert-market-pack-types';
