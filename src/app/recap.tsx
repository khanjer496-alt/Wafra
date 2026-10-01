import React, { useEffect, useMemo } from 'react';
import { useLocalSearchParams } from 'expo-router';
import { useRouter } from '@/hooks/use-app-router';

import { RecapStory } from '@/components/recap/recap-story';
import { ledgerMoneySpec } from '@/lib/ledger-money';
import { marketCurrencyCode } from '@/lib/markets';
import { normalizePreferredName } from '@/lib/onboarding';
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
  // "there" is the placeholder greeting name, never the person's own.
  // The same cleaning onboarding applied when it saved it (whitespace, control characters, length).
  const name = state.userName && state.userName.trim() !== 'there' ? normalizePreferredName(state.userName) : null;

  useEffect(() => {
    void markRecapViewed(descriptor.id);
  }, [descriptor.id]);

  return <RecapStory snapshot={snapshot} moneySpec={moneySpec} name={name} onClose={() => router.back()} />;
}
