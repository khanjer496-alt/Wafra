import { useEffect } from 'react';

import { useLanguage } from '@/hooks/use-language';
import { useToday } from '@/hooks/use-today';
import { runAfterFirstFrames } from '@/lib/after-first-frames';
import { ledgerMoneySpec } from '@/lib/ledger-money';
import { marketCurrencyCode } from '@/lib/markets';
import { useStoreActions, useStoreSelector } from '@/lib/store';
import { fieldsEqual } from '@/lib/store-selection';
import type { AppState } from '@/lib/types';
import { invalidateWidgetSnapshotSync, requestWidgetSnapshotSync } from '@/lib/widget-sync';

/** Every AppState field the widget snapshot reads; nothing else re-renders this owner. */
const WIDGET_STATE_FIELDS = [
  'hydrated', 'onboarded', 'privateMode', 'language', 'marketId', 'ledgerMoney',
  'transactions', 'accounts', 'budgets', 'bills', 'cardDues', 'notSubscriptions', 'cancelledSubscriptions',
  'transferInternalIds', 'transferNormalizationVersion', 'historyImport', 'customCategories',
] as const satisfies readonly (keyof AppState)[];
const widgetStateEqual = fieldsEqual<AppState>(WIDGET_STATE_FIELDS);

const dayKey = (now: Date): string =>
  `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}-${String(now.getDate()).padStart(2, '0')}`;

/**
 * Keeps the home-screen widgets in step with the ledger.
 *
 * This used to run inside Home. Home can now be paused while another screen
 * or tab is on top (covered-screen-freeze, ios-tab-gate), and a paused Home
 * runs no effects, so a capture or History page that landed then left the
 * widgets stale until Home was shown again. The tab shell's CaptureOwner calls
 * this instead: it is never frozen. The effect is unchanged from Home.
 */
export function useWidgetSnapshotSync(): void {
  const language = useLanguage();
  const state = useStoreSelector(({ state: s }) => s, widgetStateEqual);
  const { getStateSnapshot, getStateGeneration } = useStoreActions();
  const moneySpec = state.ledgerMoney ?? ledgerMoneySpec(marketCurrencyCode(state.marketId))!;
  // Day-based, like Home's projection day: the same day's resume changes nothing.
  const projectionDay = dayKey(useToday());
  // Native widgets use Bills' complete 30-day recurring projection, never
  // Home's deliberately shorter 9-day list (which adds detected subscriptions
  // only once that shared projection has an answer).
  useEffect(() => {
    if (!state.hydrated || !state.onboarded || state.privateMode) {
      void invalidateWidgetSnapshotSync();
      return;
    }
    const generation = getStateGeneration();
    const source = getStateSnapshot();
    let request: ReturnType<typeof requestWidgetSnapshotSync> | undefined;
    let cancelled = false;
    const current = () => {
      const latest = getStateSnapshot();
      return !cancelled && generation === getStateGeneration() && latest.hydrated && latest.onboarded && !latest.privateMode
        && latest.transactions === source.transactions && latest.accounts === source.accounts
        && latest.budgets === source.budgets && latest.bills === source.bills && latest.cardDues === source.cardDues
        && latest.notSubscriptions === source.notSubscriptions && latest.cancelledSubscriptions === source.cancelledSubscriptions
        && latest.transferInternalIds === source.transferInternalIds && latest.transferNormalizationVersion === source.transferNormalizationVersion
        && latest.ledgerMoney === source.ledgerMoney && latest.marketId === source.marketId && latest.language === source.language
        && latest.historyImport === source.historyImport
        // The spending widget names categories, custom ones included (widget-ledger.ts).
        && latest.customCategories === source.customCategories;
    };
    // After the first frames: preparing the snapshot walks the ledger and the
    // native write re-renders every placed widget.
    const task = runAfterFirstFrames(() => {
      if (current()) request = requestWidgetSnapshotSync({ state: source, now: new Date(), moneySpec,
        language: language === 'ar' ? 'ar' : 'en' }, current);
    });
    return () => { cancelled = true; task.cancel(); request?.cancel(); };
    // Keyed on the day, not the resume clock: every reopen used to rebuild
    // the snapshot and rewrite the widgets with the same figures. A new day
    // still refreshes them (todayISO, the week, Coming up all move).
  }, [state.hydrated, state.onboarded, state.privateMode, state.transactions, state.accounts, state.budgets, state.bills,
    state.cardDues, state.notSubscriptions, state.cancelledSubscriptions, state.transferInternalIds, state.transferNormalizationVersion,
    state.ledgerMoney, state.marketId, state.historyImport, state.customCategories, moneySpec, language, projectionDay,
    getStateGeneration, getStateSnapshot]);
}
