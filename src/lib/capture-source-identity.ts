// Grouped in one object so each pattern is compiled once per module load.
const SOURCE_KEY = {
  apple: /^apple_message_review_source_([a-f0-9]{64})$/,
  android: /^(?:h|android_message_review_source_)(a(?:0|[1-9]\d{0,39}))(?:t(0|[1-9]\d{0,15}))?$/,
  androidComposedTime: /^(?:h|android_message_review_source_)a\d+t(\d+)$/,
  opaqueHistory: /^h[a-f0-9]{64}$/,
  opaqueApple: /^apple_message_review_source_[a-f0-9]{64}$/,
  androidNamespace: /^ha(?:$|[\d+-])/,
};

/**
 * Everything these predicates read from a key that does not depend on the
 * observed time, parsed once per distinct key.
 *
 * Every capture re-validates the identity of every stored row — the import
 * planner's duplicate index and the post-import duplicate repair each walk the
 * whole ledger — and the regexes below were a large share of a live capture's
 * JS time on a 15k-row ledger. The answers are pure functions of the key
 * string, so a string-keyed memo returns exactly what re-running them would.
 */
interface KeyShape {
  /** Apple GUID hex, when the key is an Apple review source. */
  apple: string | null;
  /** The `a<digits>` provider row id of a reserved Android key. */
  android: string | null;
  /** The encoded `t<digits>` original time of a reserved Android key. */
  encoded: string | undefined;
  /** isValidAndroidSourceKey(key). */
  validAndroid: boolean;
  /** The loosely composed `…a<digits>t<digits>` time, or null. */
  composedTime: string | null;
  /** An opaque Apple/history identity, usable with no timestamp. */
  opaque: boolean;
  /** The reserved Android namespace, which must carry a valid time. */
  androidNamespace: boolean;
}

const KEY_SHAPE_LIMIT = 65_536;
let keyShapes = new Map<string, KeyShape>();

const validTimestamp = (encoded: string | undefined): boolean => {
  if (encoded === undefined) return true;
  const timestamp = Number(encoded);
  return Number.isSafeInteger(timestamp) && Number.isFinite(new Date(timestamp).getTime());
};

function shapeOf(key: string): KeyShape {
  const cached = keyShapes.get(key);
  if (cached) return cached;
  const apple = key.match(SOURCE_KEY.apple);
  // The two reserved namespaces cannot overlap: an Apple key starts with
  // "apple_", an Android key with "h" or "android_".
  const android = apple ? null : key.match(SOURCE_KEY.android);
  const composed = key.match(SOURCE_KEY.androidComposedTime);
  const shape: KeyShape = {
    apple: apple ? apple[1] : null,
    android: android ? android[1] : null,
    encoded: android ? android[2] : undefined,
    validAndroid: android !== null && validTimestamp(android[2]),
    composedTime: composed ? composed[1] : null,
    opaque: SOURCE_KEY.opaqueHistory.test(key) || SOURCE_KEY.opaqueApple.test(key),
    androidNamespace: SOURCE_KEY.androidNamespace.test(key) || key.startsWith('android_message_review_source_'),
  };
  // Bounded: a restore or a very long history can only ever cost a re-parse.
  if (keyShapes.size >= KEY_SHAPE_LIMIT) keyShapes = new Map();
  keyShapes.set(key, shape);
  return shape;
}

/**
 * Android provider row IDs are local to one Messages database and may be reused
 * after a restore or on another phone. Bind them to the original message time.
 * Apple GUID-derived identities remain opaque and unchanged. No money, merchant
 * or arrival time can substitute for a missing original source timestamp.
 */
export const canonicalCaptureSourceKey = (key: string, observedAt?: number): string => {
  const shape = shapeOf(key);
  if (shape.apple !== null) return `h${shape.apple}`;
  if (shape.android === null) return key;
  if (shape.encoded !== undefined) return `h${shape.android}t${shape.encoded}`;
  return Number.isSafeInteger(observedAt) && observedAt! >= 0 &&
    Number.isFinite(new Date(observedAt!).getTime())
    ? `h${shape.android}t${observedAt}` : `h${shape.android}`;
};

/** A local Android row id without its original clock is not an event identity. */
export const isUnboundAndroidSourceKey = (key: string): boolean => {
  const shape = shapeOf(key);
  return shape.android !== null && shape.encoded === undefined;
};

/** Runtime validation for the reserved Android namespace, including encoded time. */
export const isValidAndroidSourceKey = (key: string): boolean => shapeOf(key).validAndroid;

/** Composed review identities must agree with their explicit source timestamp. */
export const captureSourceTimeMatches = (key: string, observedAt: number): boolean => {
  const shape = shapeOf(key);
  return shape.composedTime === null ||
    (shape.validAndroid && Number(shape.composedTime) === observedAt);
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
  const shape = shapeOf(key);
  if (shape.opaque) return true;
  if (!shape.androidNamespace) return true;
  return shape.validAndroid && Number.isSafeInteger(observedAt) && observedAt! >= 0 &&
    Number.isFinite(new Date(observedAt!).getTime()) && captureSourceTimeMatches(key, observedAt!);
};
