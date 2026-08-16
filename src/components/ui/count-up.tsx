import React, { useEffect, useRef, useState } from 'react';

import { ThemedText, type ThemedTextProps } from '@/components/themed-text';
import { useMotionPreference } from '@/hooks/use-reduced-motion';
import { formatAmount } from '@/lib/format';
import { ledgerCurrencyDisplay } from '@/lib/markets';

interface CountUpAmountProps extends Omit<ThemedTextProps, 'children'> {
  fils: number;
  prefix?: string;
  durationMs?: number;
  active?: boolean;
}

/** Animates a money figure from its previous value to the new one. */
export function CountUpAmount({
  fils,
  prefix = `${ledgerCurrencyDisplay()} `,
  durationMs = 700,
  active = true,
  ...rest
}: CountUpAmountProps) {
  const { ready, reducedMotion } = useMotionPreference();
  // The final value is the safe first render while screen-reader state is
  // unknown. Its parent reveal is still transparent; once the query resolves
  // for a motion-enabled user, this resets to zero and begins visibly.
  const initial = useRef(ready && !reducedMotion ? 0 : fils).current;
  const [display, setDisplay] = useState(initial);
  const displayRef = useRef(initial);
  const frame = useRef<number | null>(null);
  const mountAnimationStarted = useRef(ready && !reducedMotion);

  useEffect(() => {
    if (!ready) return;
    // Reduce Motion, or a screen reader that would announce all ~40 frames.
    // Losing tab focus also settles permanently, cancelling the JS/render tail
    // while the destination screen is trying to draw.
    if (reducedMotion || !active) {
      // Consuming the one-shot here prevents disabling an accessibility
      // preference later from retroactively replaying a mount animation.
      mountAnimationStarted.current = true;
      setDisplay(fils);
      displayRef.current = fils;
      return;
    }
    if (!mountAnimationStarted.current) {
      mountAnimationStarted.current = true;
      displayRef.current = 0;
      setDisplay(0);
    }
    const from = displayRef.current;
    if (from === fils) return;
    const start = Date.now();
    const tick = () => {
      const t = Math.min(1, (Date.now() - start) / durationMs);
      const eased = 1 - Math.pow(1 - t, 4); // ease-out-quart
      const next = Math.round(from + (fils - from) * eased);
      displayRef.current = next;
      setDisplay(next);
      if (t < 1) {
        frame.current = requestAnimationFrame(tick);
      }
    };
    frame.current = requestAnimationFrame(tick);
    return () => {
      if (frame.current !== null) cancelAnimationFrame(frame.current);
    };
  }, [active, fils, durationMs, ready, reducedMotion]);

  return (
    <ThemedText tabular {...rest}>
      {prefix}
      {formatAmount(display, { decimals: false })}
    </ThemedText>
  );
}
