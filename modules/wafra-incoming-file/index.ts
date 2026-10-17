import { requireOptionalNativeModule } from 'expo-modules-core';

/**
 * "Open in Wafra" for a statement iOS hands over by its original location
 * (Files, iCloud Drive) instead of copying it into Documents/Inbox.
 *
 * iOS only; null on Android and web. Only a file URL iOS actually opened
 * Wafra with can be adopted: native code keeps those URL objects (they carry
 * the security-scoped access) and refuses any other string.
 */
export interface WafraIncomingFileNativeModule {
  /**
   * Synchronously copies the handed-over statement into
   * `<Library/Caches>/IncomingStatements/<sanitised unique name>` (iOS lets an
   * app read and delete `Documents/Inbox`, not write it) and returns that
   * file:// URL,
   * or null when the URL was not handed over, is not a statement extension,
   * is inside Wafra's own containers, is a symlink or directory, is over the
   * size cap, or could not be read in time. Runs on the JS thread with a
   * bounded wait; never logs names or paths.
   */
  adoptExternalDocument(url: string): string | null;
}

export default requireOptionalNativeModule<WafraIncomingFileNativeModule>('WafraIncomingFile');
