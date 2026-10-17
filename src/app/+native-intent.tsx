import { Paths } from 'expo-file-system';
import { Platform } from 'react-native';

import { incomingStatementRedirect, type ExternalStatementAdopter } from '@/lib/incoming-statement-file';

import IncomingFileNative from '../../modules/wafra-incoming-file';

/** This app's documents directory URI (iOS puts handed-over copies in its Inbox). */
function documentDirectory(): string | null {
  try {
    return Paths.document.uri;
  } catch {
    return null;
  }
}

/** The native Files / iCloud Drive adopter, or null when the module is absent. */
function externalAdopter(): ExternalStatementAdopter | null {
  const native = IncomingFileNative;
  if (!native || typeof native.adoptExternalDocument !== 'function') return null;
  return (url) => native.adoptExternalDocument(url);
}

/**
 * Expo Router's system-URL hook (SDK 55, native only). Every URL the app is
 * opened with passes through here before routing; `path` may be a full URL.
 *
 * Only one case is rewritten: a statement iOS hands to Wafra from the Share
 * Sheet or Files arrives as a file:// URL to a copy in Documents/Inbox. It
 * becomes the statement import screen with a one-time token (the file itself
 * stays in memory, see incoming-statement-file.ts); the screen asks before
 * anything is uploaded. A statement opened from Files in iCloud Drive
 * arrives instead as its original URL (iOS logs "Not copying to Inbox"); the
 * native adopter copies it into the Inbox, and the copy takes the same route.
 * Any other file:// URL is dropped (null: stay where the app is) rather than
 * routed to "not found". Every other link is returned untouched. Android
 * registers no document intent filters, so this is iOS only.
 */
export function redirectSystemPath({ path }: { path: string; initial: boolean }): string | null {
  if (Platform.OS !== 'ios' || typeof path !== 'string' || !/^file:/i.test(path)) return path;
  try {
    return incomingStatementRedirect(path, documentDirectory(), externalAdopter());
  } catch {
    // Never crash the launch over a handed-over file.
    return null;
  }
}
