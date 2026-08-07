/**
 * There is no native module in Node, which is exactly the situation the app's
 * own native modules are written for: `requireOptionalNativeModule` returns
 * null on iOS, on web, and in Expo Go. Returning null here means the real
 * `modules/sms-reader/index.ts` and `modules/notification-reader/index.ts` are
 * compiled and tested rather than replaced by hand-written stand-ins.
 */
export function requireOptionalNativeModule<T>(_name: string): T | null {
  return null;
}
