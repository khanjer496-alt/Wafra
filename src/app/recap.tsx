import React, { useEffect, useMemo } from 'react';
import { useLocalSearchParams } from 'expo-router';
import { useRouter } from '@/hooks/use-app-router';

import { RecapStory } from '@/components/recap/recap-story';
import { ThemedText } from '@/components/themed-text';
import { BandScaffold } from '@/components/ui/band-scaffold';
import { EButton } from '@/components/ui/band/e-button';
import { useBand } from '@/hooks/use-band';
import { useLanguage } from '@/hooks/use-language';
import { recapWords } from '@/lib/recap-copy';
import { ledgerMoneySpec } from '@/lib/ledger-money';
import { marketCurrencyCode } from '@/lib/markets';
import { normalizePreferredName } from '@/lib/onboarding';
import { hasRecapActivity, primaryRecapDescriptor, projectRecap, recapDescriptor, type RecapKind } from '@/lib/recap';
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
  const band = useBand('home');
  const words = recapWords(useLanguage());
  // A link (or a deep link) can name a period with nothing recorded: say so
  // instead of a story of zeros. Home only offers periods that have activity.
  const active = useMemo(() => hasRecapActivity(state.transactions, descriptor), [state.transactions, descriptor]);
  const snapshot = useMemo(() => projectRecap(state, descriptor), [descriptor, state]);
  const moneySpec = state.ledgerMoney ?? ledgerMoneySpec(marketCurrencyCode(state.marketId))!;
  // "there" is the placeholder greeting name, never the person's own.
  // The same cleaning onboarding applied when it saved it (whitespace, control characters, length).
  const name = state.userName && state.userName.trim() !== 'there' ? normalizePreferredName(state.userName) : null;

  useEffect(() => {
    void markRecapViewed(descriptor.id);
  }, [descriptor.id]);

  if (!active) return <BandScaffold band="home" testID="recap-empty" nav={{ close: () => router.back(), title: words.recap }}
    bandContent={<ThemedText type="title" accessibilityRole="header" style={{ color: band.onBand }}>
      {words.emptyTitle(descriptor.label)}</ThemedText>}>
    <ThemedText type="default" style={{ color: band.textSecondary }}>{words.emptyBody}</ThemedText>
    <EButton palette={band} label={words.done} onPress={() => router.back()} />
  </BandScaffold>;

  return <RecapStory snapshot={snapshot} moneySpec={moneySpec} name={name} onClose={() => router.back()} />;
}
