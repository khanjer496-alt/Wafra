/**
 * Keeps the public list of community bank-format shapes fresh: at most one
 * download per 24 hours, started when the app is foregrounded, fully in the
 * background of the UI. No pairing and no account is needed to download, and
 * every failure is silent: the previous list (or none) simply stays in use.
 */
import { useEffect, useRef } from 'react';

import { useAppActive } from '@/hooks/use-app-active';
import { DEFAULT_RELAY_URL } from '@/lib/relay';
import {
  fetchPublishedSharedFormats,
  sharedAlertFormatsDue,
} from '@/lib/shared-alert-format-sync';
import { useStore } from '@/lib/store';

export function useSharedAlertFormats(): void {
  const { state, replaceSharedAlertFormats, touchSharedAlertFormats } = useStore();
  const active = useAppActive();
  const inFlight = useRef(false);
  const hydrated = state.hydrated;
  const privateMode = state.privateMode === true;
  const fetchedAt = state.sharedAlertFormats?.fetchedAt ?? null;
  const etag = state.sharedAlertFormats?.etag ?? null;
  const hasList = (state.sharedAlertFormats?.formats.length ?? 0) > 0;

  useEffect(() => {
    if (!active || !hydrated || privateMode || !DEFAULT_RELAY_URL || inFlight.current) return;
    if (!sharedAlertFormatsDue({ fetchedAt }, Date.now())) return;
    inFlight.current = true;
    let cancelled = false;
    void (async () => {
      try {
        // Without a stored list an old etag would only produce an empty 304.
        const result = await fetchPublishedSharedFormats(DEFAULT_RELAY_URL, hasList ? etag : null);
        if (cancelled) return;
        if (result.kind === 'updated') replaceSharedAlertFormats(result.etag, result.formats);
        else if (result.kind === 'not-modified') touchSharedAlertFormats();
        // A failure leaves fetchedAt alone; the next foregrounding retries.
      } catch { /* never surface */ } finally { inFlight.current = false; }
    })();
    return () => { cancelled = true; inFlight.current = false; };
  }, [active, hydrated, privateMode, fetchedAt, etag, hasList, replaceSharedAlertFormats, touchSharedAlertFormats]);
}
