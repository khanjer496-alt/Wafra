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

/**
 * The event clock an alert states for itself, to the SECOND, as epoch ms.
 *
 * A bank notification's own identity is (package, post time), and a bank app
 * that re-posts one alert — FCM redelivery, a background sync, the app
 * refreshing its shade entry — gives the same text a new post time. ADCB was
 * seen posting one card alert three times minutes apart, and the copies became
 * separate ledger rows dated by post time. The text, not the post time, is the
 * identity of the event: "… on 25/09/2026 17:38:39 …" names one instant, and
 * two genuinely identical purchases name two (15:23:32 and 15:39:32).
 *
 * Deliberately narrow, because this becomes an identity:
 *  - Seconds are required. At minute precision a terminal double-tap produces
 *    two identical texts, and the second charge would be folded away.
 *  - The date part must agree with the date the parser already chose, in
 *    either numeric order, so this never re-decides DD/MM vs MM/DD.
 *  - Exactly one distinct clock. Two different clocks in one alert (a
 *    transaction time and a processing time) is not an identity.
 *  - Midnight/end-of-day batch stamps are not event instants.
 *
 * It is evidence, never a key on its own: dedupe pairs two alerts by it only
 * together with the same money, direction, card and merchant.
 *
 * The wall-clock digits are read in the device's zone. Every copy of the same
 * text reads the same instant, which is all identity needs; callers decide
 * separately whether that instant is plausible enough to DISPLAY.
 */
const NUMERIC_TEXT_CLOCK_RE =
  /(?<![\d/.:-])(\d{1,2})[/.-](\d{1,2})[/.-](\d{4}|\d{2})(?:[ \t]*,)?[ \t]+(?:at[ \t]+)?(\d{1,2}):(\d{2}):(\d{2})(?:[ \t]*([AaPp])\.?[Mm]\.?)?(?![\d:])/g;
const ISO_TEXT_CLOCK_RE =
  /(?<![\d/.:-])(\d{4})-(\d{1,2})-(\d{1,2})(?:[ \t]+|T)(\d{1,2}):(\d{2}):(\d{2})(?:[ \t]*([AaPp])\.?[Mm]\.?)?(?![\d:])/g;

const localClock = (
  year: number, month: number, day: number,
  hour: number, minute: number, second: number,
): number | null => {
  if (month < 1 || month > 12 || day < 1 || day > 31 || hour > 23 || minute > 59 || second > 59) return null;
  const at = new Date(year, month - 1, day, hour, minute, second, 0);
  if (at.getFullYear() !== year || at.getMonth() !== month - 1 || at.getDate() !== day ||
    at.getHours() !== hour || at.getMinutes() !== minute || at.getSeconds() !== second) return null;
  const ms = at.getTime();
  return Number.isSafeInteger(ms) && ms >= 0 ? ms : null;
};

const clockHour = (raw: string, meridiem: string | undefined): number | null => {
  const hour = Number(raw);
  if (!meridiem) return hour;
  if (hour < 1 || hour > 12) return null;
  const pm = meridiem.toLowerCase() === 'p';
  return pm ? (hour === 12 ? 12 : hour + 12) : (hour === 12 ? 0 : hour);
};

export function alertTextClock(source: string | undefined, isoDate: string | null | undefined): number | null {
  if (typeof source !== 'string' || !source || typeof isoDate !== 'string') return null;
  const day = isoDate.match(/^(\d{4})-(\d{2})-(\d{2})$/);
  if (!day) return null;
  const wantYear = Number(day[1]);
  const wantMonth = Number(day[2]);
  const wantDay = Number(day[3]);
  const clocks = new Set<number>();
  const consider = (year: number, month: number, dayOfMonth: number, time: RegExpMatchArray): boolean => {
    if (year !== wantYear || month !== wantMonth || dayOfMonth !== wantDay) return false;
    const hour = clockHour(time[4], time[7]);
    if (hour === null) return false;
    const minute = Number(time[5]);
    const second = Number(time[6]);
    // 00:00:00 and 23:59:59 are what batch-posted rows (subscriptions,
    // standing orders, fees) are stamped with, not an event instant: two
    // different charges share them. Leave those to the arrival-time rules.
    if ((hour === 0 && minute === 0 && second === 0) || (hour === 23 && minute === 59 && second === 59)) return false;
    const at = localClock(year, month, dayOfMonth, hour, minute, second);
    if (at === null) return false;
    clocks.add(at);
    return true;
  };
  for (const match of source.matchAll(NUMERIC_TEXT_CLOCK_RE)) {
    const year = match[3].length === 2 ? 2000 + Number(match[3]) : Number(match[3]);
    const first = Number(match[1]);
    const second = Number(match[2]);
    // Day-first is the launch grammar's default; month-first counts only when
    // it is the reading the parser itself chose for this alert's date.
    if (!consider(year, second, first, match)) consider(year, first, second, match);
  }
  for (const match of source.matchAll(ISO_TEXT_CLOCK_RE)) {
    consider(Number(match[1]), Number(match[2]), Number(match[3]), match);
  }
  return clocks.size === 1 ? [...clocks][0] : null;
}
