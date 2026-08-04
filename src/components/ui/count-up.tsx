import React, { useEffect, useRef, useState } from 'react';

import { ThemedText, type ThemedTextProps } from '@/components/themed-text';
import { useReducedMotion } from '@/hooks/use-reduced-motion';
import { formatAmount } from '@/lib/format';

interface CountUpAmountProps extends Omit<ThemedTextProps, 'children'> {
  fils: number;
  prefix?: string;
  durationMs?: number;
}

/** Animates a money figure from its previous value to the new one. */
export function CountUpAmount({ fils, prefix = 'AED ', durationMs = 700, ...rest }: CountUpAmountProps) {
  const [display, setDisplay] = useState(fils);
  const fromRef = useRef(fils);
  const frame = useRef<number | null>(null);
  const reduced = useReducedMotion();

  useEffect(() => {
    const from = fromRef.current;
    if (from === fils) return;
    // Reduce Motion, or a screen reader that would announce all ~40 frames.
    if (reduced) {
      setDisplay(fils);
      fromRef.current = fils;
      return;
    }
    const start = Date.now();
    const tick = () => {
      const t = Math.min(1, (Date.now() - start) / durationMs);
      const eased = 1 - Math.pow(1 - t, 4); // ease-out-quart
      setDisplay(Math.round(from + (fils - from) * eased));
      if (t < 1) {
        frame.current = requestAnimationFrame(tick);
      } else {
        fromRef.current = fils;
      }
    };
    frame.current = requestAnimationFrame(tick);
    return () => {
      if (frame.current !== null) cancelAnimationFrame(frame.current);
      fromRef.current = fils;
    };
  }, [fils, durationMs, reduced]);

  return (
    <ThemedText tabular {...rest}>
      {prefix}
      {formatAmount(display, { decimals: false })}
    </ThemedText>
  );
}
