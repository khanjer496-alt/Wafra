/**
 * Android provider row IDs are local to one Messages database and may be reused
 * after a restore or on another phone. Bind them to the original message time.
 * Apple GUID-derived identities remain opaque and unchanged. No money, merchant
 * or arrival time can substitute for a missing original source timestamp.
 */
export const canonicalCaptureSourceKey = (key: string, observedAt?: number): string => {
  const apple = key.match(/^apple_message_review_source_([a-f0-9]{64})$/);
  if (apple) return `h${apple[1]}`;
  const android = key.match(/^(?:h|android_message_review_source_)(a(?:0|[1-9]\d{0,39}))(?:t(0|[1-9]\d{0,15}))?$/);
  if (!android) return key;
  const encoded = android[2];
  if (encoded !== undefined) return `h${android[1]}t${encoded}`;
  return Number.isSafeInteger(observedAt) && observedAt! >= 0 &&
    Number.isFinite(new Date(observedAt!).getTime())
    ? `h${android[1]}t${observedAt}` : `h${android[1]}`;
};

/** A local Android row id without its original clock is not an event identity. */
export const isUnboundAndroidSourceKey = (key: string): boolean =>
  /^(?:h|android_message_review_source_)a(?:0|[1-9]\d{0,39})$/.test(key);

/** Runtime validation for the reserved Android namespace, including encoded time. */
export const isValidAndroidSourceKey = (key: string): boolean => {
  const match = key.match(/^(?:h|android_message_review_source_)a(?:0|[1-9]\d{0,39})(?:t(0|[1-9]\d{0,15}))?$/);
  if (!match) return false;
  if (match[1] === undefined) return true;
  const timestamp = Number(match[1]);
  return Number.isSafeInteger(timestamp) && Number.isFinite(new Date(timestamp).getTime());
};

/** Composed review identities must agree with their explicit source timestamp. */
export const captureSourceTimeMatches = (key: string, observedAt: number): boolean => {
  const match = key.match(/^(?:h|android_message_review_source_)a\d+t(\d+)$/);
  return !match || (isValidAndroidSourceKey(key) && Number(match[1]) === observedAt);
};

/**
 * Whether a stored/captured identity may participate in ANY matching index.
 * Preserve malformed Android rows as money, but never use them to identify,
 * heal or delete another occurrence. Other historical opaque keys and Apple
 * GUIDs retain their existing semantics; their timestamps are not invented.
 */
export const isUsableCaptureSourceIdentity = (key?: string, observedAt?: number): boolean => {
  if (key === undefined) return true;
  if (typeof key !== 'string') return false;
  if (/^h[a-f0-9]{64}$/.test(key) || /^apple_message_review_source_[a-f0-9]{64}$/.test(key)) return true;
  const androidNamespace = /^ha(?:$|[\d+-])/.test(key) || key.startsWith('android_message_review_source_');
  if (!androidNamespace) return true;
  return isValidAndroidSourceKey(key) && Number.isSafeInteger(observedAt) && observedAt! >= 0 &&
    Number.isFinite(new Date(observedAt!).getTime()) && captureSourceTimeMatches(key, observedAt!);
};
