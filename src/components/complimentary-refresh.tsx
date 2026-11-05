import { useEffect } from 'react';
import { AppState as Lifecycle } from 'react-native';
import { complimentaryAccessUntil, COMPLIMENTARY_LEASE_SECONDS } from '@/lib/complimentary-access';
import { complimentaryDevice } from '@/lib/complimentary-device';
import { useStoreSelector } from '@/lib/store';

export function ComplimentaryRefresh() {
  const { hydrated, privateMode, complimentaryIssuedAt, getStateGeneration, getStateSnapshot, setComplimentaryIssuedAt } =
    useStoreSelector(({ state, getStateGeneration, getStateSnapshot, setComplimentaryIssuedAt }) => ({
      hydrated: state.hydrated, privateMode: state.privateMode, complimentaryIssuedAt: state.complimentaryIssuedAt,
      getStateGeneration, getStateSnapshot, setComplimentaryIssuedAt,
    }));
  useEffect(() => {
    // Undefined is unenrolled. A restored backup or a stale keychain entry cannot
    // enroll a fresh ledger. Zero means previously enrolled but awaiting a new lease.
    if (!hydrated || complimentaryIssuedAt === undefined) return;
    let alive = true;
    const generation = getStateGeneration();
    const current = () => alive && getStateGeneration() === generation && getStateSnapshot().hydrated &&
      getStateSnapshot().complimentaryIssuedAt !== undefined;
    const refresh = async () => {
      if (!current() || Lifecycle.currentState !== 'active' || getStateSnapshot().privateMode) return;
      const result = await complimentaryDevice.refresh();
      if (!current() || getStateSnapshot().privateMode) return;
      if (result.status === 'granted') await setComplimentaryIssuedAt(result.issuedAt).catch(() => {});
      else if (result.status === 'absent') await setComplimentaryIssuedAt().catch(() => {});
      else if (result.status === 'denied') await setComplimentaryIssuedAt(0).catch(() => {});
      else if (result.status === 'unavailable' && !complimentaryAccessUntil(getStateSnapshot().complimentaryIssuedAt)) await setComplimentaryIssuedAt(0).catch(() => {});
    };
    // Only enrolled devices re-verify when the app resumes.
    const subscription = Lifecycle.addEventListener('change', value => { if (value === 'active') void refresh(); });
    const end = complimentaryAccessUntil(complimentaryIssuedAt);
    const refreshAt = end - COMPLIMENTARY_LEASE_SECONDS * 1000 / 3;
    let refreshTimer: ReturnType<typeof setTimeout> | undefined;
    if (refreshAt > Date.now()) refreshTimer = setTimeout(() => void refresh(), refreshAt - Date.now());
    else void refresh();
    // Drop access exactly at expiry even when revalidation is unavailable or Private Mode is on.
    const expiryTimer = complimentaryIssuedAt ? setTimeout(() => {
      if (current() && !complimentaryAccessUntil(getStateSnapshot().complimentaryIssuedAt)) void setComplimentaryIssuedAt(0).catch(() => {});
    }, Math.max(0, end - Date.now())) : undefined;
    const retry = complimentaryIssuedAt === 0 && !privateMode ? setInterval(() => void refresh(), 120_000) : undefined;
    return () => {
      alive = false;
      subscription.remove();
      clearInterval(retry);
      clearTimeout(refreshTimer);
      clearTimeout(expiryTimer);
    };
  }, [hydrated, privateMode, complimentaryIssuedAt, getStateGeneration, getStateSnapshot, setComplimentaryIssuedAt]);
  return null;
}
