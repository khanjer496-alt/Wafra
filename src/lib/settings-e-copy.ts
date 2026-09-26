/**
 * Words the settings-side screens speak in design language E: Settings' Pro
 * card, the in-context Pro sheet, Trusted devices' invite band and the
 * not-found screen. Only strings those screens did not already have live
 * here; everything older stays in its own module (settings-copy, pro-copy,
 * customize-copy, feedback-copy, i18n). English and Arabic carry identical
 * keys (settings-e-copy.test.cjs).
 *
 * Truth rules:
 * - The Pro sheet names only what Pro gates (automatic capture, and on Android
 *   the bank-app notification reader and the past-SMS import). Prices are never
 *   written here: the sheet shows the storefront's own display strings.
 * - An invite relays new items only; it never copies older transactions.
 */
import type { ProGatedFeature } from '@/lib/pro-gate';

const en = {
  /** Settings' dark Pro card. */
  seePlans: 'See plans',
  /** The same card for someone who already has Pro. */
  proDetails: 'Details',

  /** The in-context Pro sheet: a plain title naming the feature that was tapped. */
  proSheetTitle: {
    capture: 'Automatic capture is part of Pro',
    notifications: 'Bank-app notifications are part of Pro',
  } satisfies Record<ProGatedFeature, string>,
  proSheetNotNow: 'Not now',
  /** Opens the full Pro screen (restore, management, every detail). */
  proSheetMore: 'All Pro details',

  /** Trusted devices' band while an invite is live. */
  inviteExpiresIn: 'Invite code expires in',
  inviteExpired: 'This invite has expired',
  /** Trusted devices' group names, in the sentence case every E screen uses. */
  trustedSample: 'Sample household · demo',
  trustedStart: 'Start a trusted vault',
  trustedDevices: 'Devices',
  trustedThisDevice: 'This device',
  trustedInvite: 'Add someone you trust',
  trustedVault: 'Trusted vault',

  /** Feedback's sheet: plain group names instead of the older caps labels. */
  feedbackMessage: 'Your message',
  feedbackWhatWeSend: 'What we’ll send',
  feedbackParser: 'Bank message problem',

  /** The not-found screen. */
  notFoundTitle: 'Page not found',
  notFoundBody: 'This page doesn’t exist. Your ledger is fine.',
  notFoundHome: 'Back to Home',
};

type SettingsECopy = typeof en;

const ar: SettingsECopy = {
  seePlans: 'عرض الخطط',
  proDetails: 'التفاصيل',

  proSheetTitle: {
    capture: 'الالتقاط التلقائي جزء من برو',
    notifications: 'إشعارات تطبيقات البنوك جزء من برو',
  },
  proSheetNotNow: 'ليس الآن',
  proSheetMore: 'كل تفاصيل برو',

  inviteExpiresIn: 'تنتهي صلاحية رمز الدعوة خلال',
  inviteExpired: 'انتهت صلاحية هذه الدعوة',
  trustedSample: 'عائلة تجريبية · عرض',
  trustedStart: 'ابدأ خزنة موثوقة',
  trustedDevices: 'الأجهزة',
  trustedThisDevice: 'هذا الجهاز',
  trustedInvite: 'أضف شخصاً تثق به',
  trustedVault: 'الخزنة الموثوقة',

  feedbackMessage: 'رسالتك',
  feedbackWhatWeSend: 'ما سنرسله',
  feedbackParser: 'مشكلة في رسالة بنكية',

  notFoundTitle: 'الصفحة غير موجودة',
  notFoundBody: 'هذه الصفحة غير موجودة. سجلّك سليم.',
  notFoundHome: 'العودة إلى الرئيسية',
};

export const SETTINGS_E_COPY: Record<'en' | 'ar', SettingsECopy> = { en, ar };

export function settingsECopy(language: string | null | undefined): SettingsECopy {
  return language === 'ar' ? ar : en;
}
