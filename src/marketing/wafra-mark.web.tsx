import React from 'react';

/** Exact two-stroke W-arrow from Claude reference 934e5cb.
 * Keep marketing identity independent of the native app's in-flight redesign.
 */
export function WafraMark({ size = 40, color = '#1F6B52' }: { size?: number; color?: string }) {
  return (
    <svg width={size} height={size} viewBox="0 0 48 48" fill="none" stroke={color} strokeWidth={4.2} strokeLinecap="round" strokeLinejoin="round" aria-hidden="true" focusable="false">
      <path d="M8 15 L15.5 33 L23 19 L30.5 33 L40 11.5" />
      <path d="M34 11.5 H40 V17.5" />
    </svg>
  );
}
