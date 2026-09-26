/**
 * App Lock decisions, kept free of expo-local-authentication so they can be
 * tested.
 *
 * The gate used to require `hasHardwareAsync() && isEnrolledAsync()` — both of
 * which are BIOMETRIC questions. A user who removed their Face ID or
 * fingerprints but kept a device passcode therefore read as "no screen lock":
 * the gate showed the "set up a screen lock" sheet with no unlock button, and
 * the only way out was the phone's Settings app. Their passcode, which is what
 * the lock copy promises ("Fingerprint, face unlock, or your phone PIN"), was
 * never offered.
 *
 * The question that matters is whether the device has ANY owner
 * authentication. `getEnrolledLevelAsync` answers it: SECRET means a
 * passcode/PIN/pattern only, BIOMETRIC_* means biometrics (with the passcode
 * behind them). Authentication then always runs with the device-credential
 * fallback enabled — iOS `LAPolicyDeviceOwnerAuthentication`, Android
 * `BIOMETRIC_WEAK | DEVICE_CREDENTIAL` — so a passcode-only phone gets its
 * passcode prompt directly and a biometric phone can still fall back to it.
 */

/** expo-local-authentication's `SecurityLevel` values (SDK 55). */
export const SECURITY_LEVEL = {
  NONE: 0,
  SECRET: 1,
  BIOMETRIC_WEAK: 2,
  BIOMETRIC_STRONG: 3,
} as const;

export type DeviceLockLevel = 'none' | 'passcode' | 'biometric';

export function deviceLockLevel(securityLevel: number | null | undefined): DeviceLockLevel {
  if (securityLevel === SECURITY_LEVEL.SECRET) return 'passcode';
  if (typeof securityLevel === 'number' && securityLevel >= SECURITY_LEVEL.BIOMETRIC_WEAK) {
    return 'biometric';
  }
  return 'none';
}

/**
 * Options for every App Lock `authenticateAsync` call. `disableDeviceFallback`
 * is false explicitly (it is also the SDK default) so nobody "tidies" the
 * passcode path away without a test failing.
 */
export const APP_LOCK_AUTH_OPTIONS = { disableDeviceFallback: false } as const;

export type UnlockOutcome = 'unlocked' | 'failed' | 'unavailable';

/**
 * What an `authenticateAsync` result means for the gate. Only the two errors
 * that say the device has no owner authentication at all become
 * 'unavailable'; every other failure (cancel, lockout, a wrong attempt) keeps
 * the retry button, because the device can still authenticate.
 */
export function unlockOutcome(result: { success: boolean; error?: string }): UnlockOutcome {
  if (result.success) return 'unlocked';
  if (result.error === 'not_enrolled' || result.error === 'passcode_not_set') return 'unavailable';
  return 'failed';
}
