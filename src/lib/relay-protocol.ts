/**
 * Values shared by the iPhone Shortcut, the app, and the relay Worker.
 *
 * Keep this module platform-free: the Worker imports it directly and the test
 * harness runs it under Node. It must not import React Native or Expo modules.
 */

/** A manual Shortcut run sends this exact body to prove the whole pipe works. */
export const RELAY_TEST_MESSAGE = 'WAFRA_CAPTURE_TEST_V1';

/** The shared Shortcut's stable name, used by Apple's `shortcuts://` URL. */
export const RELAY_SHORTCUT_NAME = 'Wafra Capture';

export interface RelayShortcutSetup {
  v: 1;
  url: string;
  token: string;
}

/**
 * One paste instead of making the user shuttle a URL and token separately.
 * The published Shortcut reads this JSON with “Get Dictionary from Input”.
 */
export function shortcutSetupCode(ingestUrl: string, token: string): string {
  return JSON.stringify({ v: 1, url: ingestUrl, token } satisfies RelayShortcutSetup);
}

/** Open and manually run the installed Shortcut with a non-financial test. */
export function shortcutTestUrl(): string {
  const name = encodeURIComponent(RELAY_SHORTCUT_NAME);
  const text = encodeURIComponent(RELAY_TEST_MESSAGE);
  return `shortcuts://run-shortcut?name=${name}&input=text&text=${text}`;
}

export function isRelayTestPayload(value: unknown): value is { relayTest: true } {
  return (
    typeof value === 'object' &&
    value !== null &&
    'relayTest' in value &&
    (value as { relayTest?: unknown }).relayTest === true
  );
}
