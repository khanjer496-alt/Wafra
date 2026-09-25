/**
 * Which biometric the phone will actually ask for.
 *
 * App Lock used to draw a fingerprint and say "Touch the sensor" on every
 * phone, including every Face ID iPhone. expo-local-authentication reports the
 * enrolled hardware classes as numbers (FINGERPRINT = 1, FACIAL_RECOGNITION =
 * 2, IRIS = 3); this module turns that list into one kind the lock screen and
 * the Settings row can name. Pure, so it runs under the plain-node suites.
 */
export type BiometricKind = 'face-id' | 'touch-id' | 'fingerprint' | 'face' | 'iris' | 'passcode';

/** expo-local-authentication's AuthenticationType values, restated so node tests need no native import. */
export const AUTH_TYPE = { FINGERPRINT: 1, FACIAL_RECOGNITION: 2, IRIS: 3 } as const;

export function biometricKindFrom(types: readonly number[] | null | undefined, platform: string): BiometricKind {
  const list = Array.isArray(types) ? types : [];
  const has = (value: number) => list.includes(value);
  if (platform === 'ios') {
    // An iPhone carries one of the two, never both.
    if (has(AUTH_TYPE.FACIAL_RECOGNITION)) return 'face-id';
    if (has(AUTH_TYPE.FINGERPRINT)) return 'touch-id';
    return 'passcode';
  }
  // Android can report several classes. The fingerprint sensor is the one
  // BiometricPrompt reliably offers, so it names the lock when present.
  if (has(AUTH_TYPE.FINGERPRINT)) return 'fingerprint';
  if (has(AUTH_TYPE.FACIAL_RECOGNITION)) return 'face';
  if (has(AUTH_TYPE.IRIS)) return 'iris';
  return 'passcode';
}
