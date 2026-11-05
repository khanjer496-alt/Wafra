// Web and unsupported binaries fail closed. Metro selects .native on Android.
export const grantRemainingMs = (_issuedAt: number): number => 0;
export const anchorGrant = (_issuedAt: number, _budget: number): boolean => false;
export const clearGrantClock = (): boolean => true;
