import { grantRemainingMs } from '@/lib/complimentary-clock';
/** An optional, renewable grant; it never sets a storefront purchase or founder flag. */
export const COMPLIMENTARY_LEASE_SECONDS = 900;
export const isComplimentaryCode = (code: string) => /^[A-Za-z0-9_-]{43}$/.test(code);
export function complimentaryAccessUntil(issuedAt: number | undefined, now = Date.now()): number {
  if (!Number.isSafeInteger(issuedAt) || !issuedAt || issuedAt <= 0 || issuedAt > now) return 0;
  const end = issuedAt + COMPLIMENTARY_LEASE_SECONDS * 1000;
  const remaining = grantRemainingMs(issuedAt);
  return end > now && remaining > 0 ? Math.min(end, now + remaining) : 0;
}

type Verification = 'granted' | 'denied' | 'unavailable';
type ComplimentaryResult =
  | { status: 'granted'; issuedAt: number }
  | { status: 'denied' | 'unavailable' | 'absent' | 'superseded' };
interface ComplimentaryDeviceIO {
  read(): Promise<string | null>;
  store(code: string): Promise<void>;
  remove(): Promise<void>;
  verify(code: string): Promise<Verification>;
  anchor(issuedAt: number, budget: number): boolean;
  clearAnchor(): boolean;
  now(): number;
}

/** All writes and erases share one queue; an old request cannot restore an erased code. */
export function createComplimentaryDevice(io: ComplimentaryDeviceIO) {
  let generation = 0;
  let redeeming = false;
  let knownAbsent = false;
  let retryAfter = 0;
  let activeRefresh: Promise<ComplimentaryResult> | null = null;
  let storageTail = Promise.resolve();
  const mutate = (work: () => Promise<void>) => {
    const next = storageTail.then(work);
    storageTail = next.catch(() => {});
    return next;
  };
  async function check(code: string, index: number, newCode: boolean): Promise<ComplimentaryResult> {
    const issuedAt = io.now();
    if (!isComplimentaryCode(code)) return { status: 'denied' };
    const answer = await io.verify(code).catch(() => 'unavailable' as const);
    if (index !== generation) return { status: 'superseded' };
    if (answer === 'unavailable') return { status: 'unavailable' };
    try {
      if (answer === 'denied') {
        if (!newCode) {
          try { io.clearAnchor(); } catch { /* Denial still clears the JS entitlement. */ }
          retryAfter = io.now() + 120_000;
        }
        return { status: index === generation ? 'denied' : 'superseded' };
      }
      const age = io.now() - issuedAt;
      if (age < 0 || age >= COMPLIMENTARY_LEASE_SECONDS * 1000) return { status: 'unavailable' };
      if (newCode) await mutate(async () => { if (index === generation) await io.store(code); });
      if (index !== generation) return { status: 'superseded' };
      const budget = COMPLIMENTARY_LEASE_SECONDS * 1000 - (io.now() - issuedAt);
      if (budget <= 0 || budget > COMPLIMENTARY_LEASE_SECONDS * 1000 || !io.anchor(issuedAt, budget)) return { status: 'unavailable' };
      retryAfter = 0;
      return { status: 'granted', issuedAt };
    } catch { return { status: index === generation ? 'unavailable' : 'superseded' }; }
  }

  const refresh = async (): Promise<ComplimentaryResult> => {
    if (redeeming) return { status: 'superseded' };
    if (knownAbsent) return { status: 'absent' };
    if (retryAfter > io.now() && retryAfter - io.now() <= 120_000) return { status: 'unavailable' };
    const index = generation;
    try {
      await storageTail;
      const code = await io.read();
      if (index !== generation) return { status: 'superseded' };
      if (!code) { knownAbsent = true; return { status: 'absent' }; }
      const answer = await check(code, index, false);
      return answer;
    } catch { return { status: 'unavailable' }; }
  };
  return {
    async redeem(code: string): Promise<ComplimentaryResult> {
      const index = ++generation;
      redeeming = true;
      try {
        const answer = await check(code.trim(), index, true);
        if (answer.status === 'granted') knownAbsent = false;
        return answer;
      } finally {
        if (index === generation) redeeming = false;
      }
    },
    refresh(): Promise<ComplimentaryResult> {
      activeRefresh ??= refresh().finally(() => { activeRefresh = null; });
      return activeRefresh;
    },
    clear(): Promise<void> {
      generation++;
      redeeming = false;
      knownAbsent = true;
      let cleared = false;
      try { cleared = io.clearAnchor(); } catch { /* Always try to remove the bearer too. */ }
      return mutate(async () => { await io.remove(); if (!cleared) throw new Error('Could not clear lease'); });
    },
  };
}
