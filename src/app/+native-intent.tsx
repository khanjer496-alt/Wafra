import { Paths } from 'expo-file-system';
import { Platform } from 'react-native';

import { incomingStatementRedirect } from '@/lib/incoming-statement-file';

/** This app's documents directory URI (iOS puts handed-over copies in its Inbox). */
function documentDirectory(): string | null {
  try {
    return Paths.document.uri;
  } catch {
    return null;
  }
}

/**
 * Expo Router's system-URL hook (SDK 55, native only). Every URL the app is
 * opened with passes through here before routing; `path` may be a full URL.
 *
 * Only one case is rewritten: a statement iOS hands to Wafra from the Share
 * Sheet or Files arrives as a file:// URL to a copy in Documents/Inbox. It
 * becomes the statement import screen with a one-time token (the file itself
 * stays in memory, see incoming-statement-file.ts); the screen asks before
 * anything is uploaded. Any other file:// URL — including one outside this
 * app's Inbox — is dropped (null: stay where the app is) rather than routed
 * to "not found". Every other link is returned untouched. Android registers
 * no document intent filters, so this is iOS only.
 */
export function redirectSystemPath({ path }: { path: string; initial: boolean }): string | null {
  if (Platform.OS !== 'ios' || typeof path !== 'string' || !/^file:/i.test(path)) return path;
  try {
    return incomingStatementRedirect(path, documentDirectory());
  } catch {
    // Never crash the launch over a handed-over file.
    return null;
  }
}
