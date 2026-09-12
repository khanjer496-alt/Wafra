/** Shared constants for the credential-free, device-local iPhone Shortcut. */

const RETIRED_CAPTURE_SHORTCUT_IDS = new Set([
  // Retired relay-backed release URL.
  '03d2ab22a33f4fef9d503142575a70fb',
  // Older graph with Apple's invalid file-path action.
  '85bd1e080e5849b591049eccffb9a3a1',
  // Build 99 public graph. It predates dual full-Message/plain-text capture and
  // must never be offered by a binary containing the new native fallback.
  '96f93402213144e8885db33f48fc6168',
]);

/**
 * Accept only Apple's exact public Shortcut URL shape.
 *
 * This deliberately does not share the relay-era normalizer. A URL with a
 * credential, query, fragment, extra path, non-hex ID, or retired graph must
 * leave setup unavailable instead of handing financial automation to an
 * ambiguous artifact.
 */
export function normalizeIosLocalCaptureShortcutUrl(value: unknown): string | null {
  if (typeof value !== 'string') return null;
  const match = /^https:\/\/www\.icloud\.com\/shortcuts\/([0-9A-Fa-f]{32})$/.exec(value);
  if (!match) return null;
  const id = match[1].toLowerCase();
  if (RETIRED_CAPTURE_SHORTCUT_IDS.has(id)) return null;
  return `https://www.icloud.com/shortcuts/${id}`;
}

/**
 * Public, production Shortcut share.
 *
 * Keep the approved iCloud URL in source instead of making onboarding depend on
 * an EAS profile variable. We previously shipped builds where the profile did
 * not inject the variable, leaving "Add Shortcut" with nothing useful to open;
 * an older published graph also contained the GitHub-era handoff. Environment
 * overrides are still accepted for device testing, but production always has a
 * known-good Apple share as its fallback.
 */
// Deliberately no legacy fallback. A new binary must not silently send users
// to Build 99's older graph if its release environment was misconfigured.
export const IOS_LOCAL_CAPTURE_SHORTCUT_URL = normalizeIosLocalCaptureShortcutUrl(
  process.env.EXPO_PUBLIC_WAFRA_SHORTCUT_URL,
);

// Apple installs this published share with the name in its public record,
// which differs from the generator's default name. A name-based run must match
// that record, or a device with both versions can run the older Shortcut.
export const IOS_LOCAL_CAPTURE_SHORTCUT_NAME = IOS_LOCAL_CAPTURE_SHORTCUT_URL ===
  'https://www.icloud.com/shortcuts/9a85d5f8b44d416181a76e68fcdf569d'
  ? 'WafraLocalCapture'
  : 'Wafra Capture v2';

const IOS_LOCAL_CAPTURE_SETUP_CHECK_MARKER = 'WAFRA_SETUP_CHECK_V1';
// Configure this version only with the verified share containing the control
// branch. Never send its marker into a legacy graph's plain-text capture path.
const hasSetupCheckBranch = IOS_LOCAL_CAPTURE_SHORTCUT_URL !== null &&
  IOS_LOCAL_CAPTURE_SHORTCUT_URL !== 'https://www.icloud.com/shortcuts/9a85d5f8b44d416181a76e68fcdf569d' &&
  process.env.EXPO_PUBLIC_WAFRA_SHORTCUT_SETUP_CHECK_VERSION === '1';

/** New graphs check setup without scanning Messages; legacy shares keep their no-input contract. */
export function iosLocalCaptureTestUrl(fromOnboarding = false): string {
  const callback = (result: 'success' | 'cancel' | 'error') =>
    encodeURIComponent(
      `wafra://ios-setup?shortcutResult=${result}${
        fromOnboarding ? '&fromOnboarding=1' : ''
      }`,
    );

  return `shortcuts://x-callback-url/run-shortcut?name=${encodeURIComponent(
    IOS_LOCAL_CAPTURE_SHORTCUT_NAME,
  )}` +
    (hasSetupCheckBranch ? `&input=text&text=${encodeURIComponent(IOS_LOCAL_CAPTURE_SETUP_CHECK_MARKER)}` : '') +
    `&x-success=${callback('success')}` +
    `&x-cancel=${callback('cancel')}` +
    `&x-error=${callback('error')}`;
}

/**
 * User-initiated recovery run. The Shortcut's no-input branch rereads a
 * bounded recent overlap and stages it through the same GUID-keyed live queue.
 * The callback only returns to Wafra; the foreground listener owns the drain.
 */
export function iosLocalCaptureCatchupUrl(): string {
  const callback = encodeURIComponent('wafra://');
  return `shortcuts://x-callback-url/run-shortcut?name=${encodeURIComponent(
    IOS_LOCAL_CAPTURE_SHORTCUT_NAME,
  )}` +
    `&x-success=${callback}` +
    `&x-cancel=${callback}` +
    `&x-error=${callback}`;
}
