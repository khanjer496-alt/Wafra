import { Platform } from 'react-native';
import NotificationReader from '../../modules/notification-reader';

/** The local boot/elapsed clock is independent of notification access and never opens notification content. */
export const grantRemainingMs = (issuedAt: number): number => {
  if (Platform.OS !== 'android') return 0;
  try { return NotificationReader?.complimentaryRemainingMs?.(issuedAt) ?? 0; } catch { return 0; }
};
export const anchorGrant = (issuedAt: number, budget: number): boolean =>
  Platform.OS === 'android' && NotificationReader?.anchorComplimentaryLease?.(issuedAt, budget) === true;
export const clearGrantClock = (): boolean =>
  Platform.OS !== 'android' || NotificationReader?.clearComplimentaryLease?.() === true;
