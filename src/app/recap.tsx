import React, { useEffect, useMemo } from 'react';
import { useLocalSearchParams, useRouter } from 'expo-router';

import { RecapStory } from '@/components/recap/recap-story';
import { ledgerMoneySpec } from '@/lib/ledger-money';
import { marketCurrencyCode } from '@/lib/markets';
import { primaryRecapDescriptor, projectRecap, recapDescriptor, type RecapKind } from '@/lib/recap';
import { markRecapViewed } from '@/lib/recap-view-state';
import { useStore } from '@/lib/store';

export default function RecapScreen() {
  const router = useRouter();
  const params = useLocalSearchParams<{ kind?: string; value?: string }>();
  const { state } = useStore();
  const descriptor = useMemo(() => {
    const kind: RecapKind | null = params.kind === 'month' || params.kind === 'year' ? params.kind : null;
    if (!kind || !params.value) return primaryRecapDescriptor(new Date());
    return recapDescriptor(kind, kind === 'year' ? Number(params.value) : params.value);
  }, [params.kind, params.value]);
  const snapshot = useMemo(() => projectRecap(state, descriptor), [descriptor, state]);
  const moneySpec = state.ledgerMoney ?? ledgerMoneySpec(marketCurrencyCode(state.marketId))!;

  useEffect(() => {
    void markRecapViewed(descriptor.id);
  }, [descriptor.id]);

  return <RecapStory snapshot={snapshot} moneySpec={moneySpec} onClose={() => router.back()} />;
}
