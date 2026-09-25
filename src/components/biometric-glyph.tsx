/**
 * The glyph and the kind of biometric this phone actually uses.
 *
 * `useBiometricKind` asks expo-local-authentication once per mount which
 * hardware classes are enrolled; `null` means "not known yet" and callers show
 * the neutral App Lock wording until the answer arrives.
 */
import * as LocalAuthentication from 'expo-local-authentication';
import React, { useEffect, useState } from 'react';
import { Platform } from 'react-native';
import Svg, { Path } from 'react-native-svg';

import { Icon } from '@/components/ui/icon';
import { PlatformSymbol } from '@/components/ui/platform-symbol';
import { biometricKindFrom, type BiometricKind } from '@/lib/biometric-kind';

export function useBiometricKind(): BiometricKind | null {
  const [kind, setKind] = useState<BiometricKind | null>(null);
  useEffect(() => {
    if (Platform.OS === 'web') return;
    let active = true;
    LocalAuthentication.supportedAuthenticationTypesAsync()
      .then((types) => {
        if (active) setKind(biometricKindFrom(types, Platform.OS));
      })
      .catch(() => {
        if (active) setKind('passcode');
      });
    return () => { active = false; };
  }, []);
  return kind;
}

/** A face outline in the house stroke style, for phones that unlock by face. */
function FaceGlyph({ size, color }: { size: number; color: string }) {
  const p = { stroke: color, strokeWidth: 1.8, strokeLinecap: 'round', strokeLinejoin: 'round', fill: 'none' } as const;
  return (
    <Svg aria-hidden width={size} height={size} viewBox="0 0 24 24">
      <Path {...p} d="M4 8V6a2 2 0 0 1 2-2h2" />
      <Path {...p} d="M16 4h2a2 2 0 0 1 2 2v2" />
      <Path {...p} d="M20 16v2a2 2 0 0 1-2 2h-2" />
      <Path {...p} d="M8 20H6a2 2 0 0 1-2-2v-2" />
      <Path {...p} d="M9 9.5v1" />
      <Path {...p} d="M15 9.5v1" />
      <Path {...p} d="M12 9.5v3.5h-1" />
      <Path {...p} d="M9.5 16a3.5 3.5 0 0 0 5 0" />
    </Svg>
  );
}

export function BiometricGlyph({ kind, size, color }: {
  kind: BiometricKind | null;
  size: number;
  color: string;
}) {
  if (kind === 'face-id') {
    return (
      <PlatformSymbol
        name="faceid"
        fallback={<FaceGlyph size={size} color={color} />}
        size={size}
        tintColor={color}
        weight="regular"
      />
    );
  }
  if (kind === 'face' || kind === 'iris') return <FaceGlyph size={size} color={color} />;
  if (kind === 'touch-id' || kind === 'fingerprint') return <Icon name="fingerprint" size={size} color={color} />;
  return <Icon name="lock" size={size} color={color} />;
}
