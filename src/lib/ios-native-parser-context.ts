import { normalizeCountryCode } from '@/lib/country';
import { currencyMinorUnits } from '@/lib/currency-metadata';
import { IOS_BACKGROUND_PARSER_SOURCE_HASH } from '@/lib/ios-background-parser-source.generated';
import type { NativeParserContext } from '@/lib/ios-background-alert-parser';
import type { AppState } from '@/lib/types';
import type { WafraLiveCaptureNativeModule } from '../../modules/wafra-live-capture';

type Preferences = Pick<AppState, 'hydrated' | 'onboarded' | 'country' | 'marketId' | 'ledgerMoney'>;
type NativeContextWriter = Pick<WafraLiveCaptureNativeModule, 'setNativeParserContext'>;

/** Only accounting preferences cross this boundary; neither ledger data nor a guessed region. */
export const buildIosNativeParserContext = (state: Preferences): NativeParserContext | null => {
  if (!state.hydrated || !state.onboarded || !/^[a-f0-9]{64}$/.test(IOS_BACKGROUND_PARSER_SOURCE_HASH)) return null;
  const country = state.country == null ? null : normalizeCountryCode(state.country);
  if (state.country != null && country !== state.country) return null;
  if (state.marketId !== 'AE' && state.marketId !== 'SA' && state.marketId !== 'ZZ') return null;
  const money = state.ledgerMoney;
  if (money && (typeof money.currency !== 'string' || !/^[A-Z]{3}$/.test(money.currency) ||
    currencyMinorUnits(money.currency) !== money.exponent)) return null;
  return { v: 1, country, parserMarket: state.marketId,
    ledgerMoney: money ? { currency: money.currency, exponent: money.exponent } : null,
    sourceHash: IOS_BACKGROUND_PARSER_SOURCE_HASH };
};

type Synchronizer = { sync(state: Preferences): Promise<boolean>; invalidate(): void };
const synchronizers = new WeakMap<object, Synchronizer>();

const contextSynchronizer = (native: NativeContextWriter): Synchronizer => {
  let latest = 0;
  let sent: string | null | undefined;
  let tail = Promise.resolve();
  return {
    invalidate() {
      latest++;
      sent = undefined;
    },
    sync(state) {
      // A cold locked-phone launch cannot hydrate the ledger. Retain the last
      // valid background preferences rather than erasing them before hydration.
      if (!state.hydrated || !native.setNativeParserContext) return Promise.resolve(false);
      const context = buildIosNativeParserContext(state);
      const value = context ? JSON.stringify(context) : null;
      const request = ++latest;
      let wrote = false;
      const operation = tail.then(async () => {
        if (request !== latest || value === sent) return;
        await native.setNativeParserContext!(value);
        if (request === latest) sent = value;
        wrote = true;
      });
      // A failed native write is retryable; it never marks that value as sent.
      tail = operation.catch(() => {});
      return operation.then(() => wrote);
    },
  };
};

/** All foreground hook instances share one ordered, latest-request-wins writer. */
export const syncIosNativeParserContext = (
  native: NativeContextWriter,
  state: Preferences,
): Promise<boolean> => {
  if (!native.setNativeParserContext) return Promise.resolve(false);
  let synchronizer = synchronizers.get(native);
  if (!synchronizer) {
    synchronizer = contextSynchronizer(native);
    synchronizers.set(native, synchronizer);
  }
  return synchronizer.sync(state);
};

/** Erasure happens outside this writer; discard its cache and queued old requests. */
export const invalidateIosNativeParserContext = (native: NativeContextWriter): void => {
  synchronizers.get(native)?.invalidate();
};
