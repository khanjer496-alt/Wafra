/**
 * The parts of `react-native` the pure-logic modules touch, and nothing else.
 *
 * `Platform.OS` is deliberately writable: the relay is iOS-only and the SMS
 * scan is Android-only, so a test that cannot move between platforms cannot
 * assert either gate. Set it, run, and set it back.
 */
export const Platform: { OS: 'ios' | 'android' | 'web' } = { OS: 'ios' };

export const PermissionsAndroid = {
  PERMISSIONS: { READ_SMS: 'android.permission.READ_SMS', RECEIVE_SMS: 'android.permission.RECEIVE_SMS' },
  RESULTS: { GRANTED: 'granted', DENIED: 'denied' },
  async check(_permission: string): Promise<boolean> {
    return false;
  },
  async requestMultiple(permissions: string[]): Promise<Record<string, string>> {
    return Object.fromEntries(permissions.map((p) => [p, 'denied']));
  },
};
