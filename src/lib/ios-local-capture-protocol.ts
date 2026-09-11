/** Shared constants for the credential-free, device-local iPhone Shortcut. */
export const IOS_LOCAL_CAPTURE_SHORTCUT_NAME = 'Wafra Local Capture';

const RETIRED_CAPTURE_SHORTCUT_IDS = new Set([
  // Retired relay-backed release URL.
  '03d2ab22a33f4fef9d503142575a70fb',
  // Older graph with Apple's invalid file-path action.
  '85bd1e080e5849b591049eccffb9a3a1',
]);

/**
 * Accept only Wafra's approved Shortcut distribution URL shapes.
 *
 * This deliberately does not share the relay-era normalizer. A URL with a
 * credential, query, fragment, extra path, non-hex ID, or retired graph must
 * leave setup unavailable instead of handing financial automation to an
 * ambiguous artifact.
 */
export function normalizeIosLocalCaptureShortcutUrl(value: unknown): string | null {
  if (typeof value !== 'string') return null;

  const iCloudMatch = /^https:\/\/www\.icloud\.com\/shortcuts\/([0-9A-Fa-f]{32})$/.exec(value);
  if (iCloudMatch) {
    const id = iCloudMatch[1].toLowerCase();
    if (RETIRED_CAPTURE_SHORTCUT_IDS.has(id)) return null;
    return `https://www.icloud.com/shortcuts/${id}`;
  }

  // Production onboarding must only use Apple's public iCloud Shortcut share.
  // GitHub-hosted .shortcut artifacts are intentionally rejected so an old
  // beta fallback can never hijack the Add Shortcut CTA.

  return null;
}

/**
 * Keep a known-good Apple share in source so onboarding never depends on a
 * missing build-time variable. Environment overrides remain available for
 * device testing, but production always has a working iCloud fallback.
 */
export const IOS_LOCAL_CAPTURE_SHORTCUT_URL = normalizeIosLocalCaptureShortcutUrl(
  process.env.EXPO_PUBLIC_WAFRA_SHORTCUT_URL,
) ?? 'https://www.icloud.com/shortcuts/96f93402213144e8885db33f48fc6168';

/** Run the installed Shortcut without input so its local setup-proof branch executes. */
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
