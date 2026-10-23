/**
 * Every automatic iPhone capture path (bank texts, notifications, Apple Pay)
 * runs through App Intents, which arrived in iOS 16. Parsed as the native
 * module gate parses it (capture.ts): a whole-number major, unknown is 0.
 */
export function iosSupportsLiveCapture(version: unknown): boolean {
  const major = typeof version === 'number' ? Math.trunc(version) : Number.parseInt(String(version), 10);
  return Number.isFinite(major) && major >= 16;
}

/**
 * Product exposure only: older captured Apple Pay records remain valid.
 * Wallet Transaction automations arrived in iOS 17; before iOS 27 the owner
 * builds a personal automation that runs the bundled Shortcut.
 */
export function iosSupportsApplePayAutomation(version: unknown): boolean {
  if (typeof version !== 'string' && typeof version !== 'number') return false;
  const value = String(version);
  if (!/^\d+(?:\.\d+)*$/.test(value)) return false;
  const parts = value.split('.').map(Number);
  return parts.every(Number.isSafeInteger) && parts[0] >= 17;
}

/** A view choice, never a mutation of the owner's saved source or receipts. */
export function visibleIosSetupSource(source: unknown, available: { applePay: boolean; notification: boolean }):
  'message' | 'apple-pay' | 'notification' {
  if (source === 'apple-pay' && available.applePay) return 'apple-pay';
  if (source === 'notification' && available.notification) return 'notification';
  return 'message';
}

/** iOS 27 shortcuts carry their own automations; earlier versions use a personal automation. */
export function iosShortcutsCarryAutomations(version: unknown): boolean {
  if (typeof version !== 'string' && typeof version !== 'number') return false;
  const major = Number(String(version).split('.')[0]);
  return Number.isSafeInteger(major) && major >= 27;
}
