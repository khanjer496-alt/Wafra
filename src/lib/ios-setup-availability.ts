/** Product exposure only: older captured Apple Pay records remain valid. */
export function iosSupportsApplePayAutomation(version: unknown): boolean {
  if (typeof version !== 'string' && typeof version !== 'number') return false;
  const value = String(version);
  if (!/^\d+(?:\.\d+)*$/.test(value)) return false;
  const parts = value.split('.').map(Number);
  return parts.every(Number.isSafeInteger) && parts[0] >= 27;
}

/** A view choice, never a mutation of the owner's saved source or receipts. */
export function visibleIosSetupSource(source: unknown, available: { applePay: boolean; notification: boolean }):
  'message' | 'apple-pay' | 'notification' {
  if (source === 'apple-pay' && available.applePay) return 'apple-pay';
  if (source === 'notification' && available.notification) return 'notification';
  return 'message';
}
