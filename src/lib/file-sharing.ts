import * as FileSystem from 'expo-file-system/legacy';
import * as Sharing from 'expo-sharing';
import { Platform, Share } from 'react-native';

export interface SharedFileOptions {
  uri: string;
  dialogTitle: string;
  mimeType: string;
  /** Cache exports are one-use files and may be removed after share targets finish reading. */
  deleteAfter?: boolean;
}

// Android share targets are allowed to hand the content URI to a background
// upload. shareAsync resolves when their Activity finishes, not when Drive or
// WhatsApp has finished copying the bytes. Immediate deletion made a working
// chooser produce a truncated upload. Keep the private cache file long enough
// for that hand-off; Android/iOS may clear app cache sooner under pressure.
const SHARED_FILE_GRACE_MS = 60 * 60 * 1000;
const STALE_EXPORT_AGE_MS = 2 * SHARED_FILE_GRACE_MS;
const WAFRA_EXPORT_PREFIX = 'wafra-';

function deleteSharedFileLater(uri: string): void {
  setTimeout(() => {
    void FileSystem.deleteAsync(uri, { idempotent: true }).catch(() => {});
  }, SHARED_FILE_GRACE_MS);
}

/**
 * Remove plaintext exports left behind if Android killed Wafra while another
 * app was copying a shared file. Cache eviction is not a privacy boundary.
 * The two-hour floor leaves twice the normal hand-off grace for slow uploads.
 */
export async function sweepStaleExportFiles(exceptUri?: string): Promise<void> {
  if (Platform.OS === 'web' || !FileSystem.cacheDirectory) return;
  const cache = FileSystem.cacheDirectory;
  let names: string[];
  try {
    names = await FileSystem.readDirectoryAsync(cache);
  } catch {
    return;
  }
  const cutoffSeconds = (Date.now() - STALE_EXPORT_AGE_MS) / 1000;
  await Promise.all(
    names
      .filter((name) => name.startsWith(WAFRA_EXPORT_PREFIX))
      .map(async (name) => {
        const uri = `${cache}${name}`;
        if (uri === exceptUri) return;
        try {
          const info = await FileSystem.getInfoAsync(uri);
          if (!info.exists || (info.modificationTime ?? 0) <= cutoffSeconds) {
            await FileSystem.deleteAsync(uri, { idempotent: true });
          }
        } catch {
          // A racing OS cache eviction already achieved the same outcome.
        }
      }),
  );
}

/**
 * Open the platform file share sheet and surface failures to the caller.
 *
 * The old exports used `Share.share({ message: hugeString })` and swallowed
 * every rejection. Android share targets routinely reject large text payloads,
 * which made a tap appear to do nothing. A real cache file is both more
 * compatible and much cheaper to move between processes.
 */
export async function shareExistingFile({
  uri,
  dialogTitle,
  mimeType,
  deleteAfter = false,
}: SharedFileOptions): Promise<void> {
  await sweepStaleExportFiles(uri);
  try {
    if (!(await Sharing.isAvailableAsync())) throw new Error('share_unavailable');
    await Sharing.shareAsync(uri, { dialogTitle, mimeType });
    if (deleteAfter) deleteSharedFileLater(uri);
  } catch (error) {
    if (deleteAfter) {
      await FileSystem.deleteAsync(uri, { idempotent: true }).catch(() => {});
    }
    throw error;
  }
}

export async function shareTextFile(options: {
  filename: string;
  contents: string;
  dialogTitle: string;
  mimeType: string;
}): Promise<void> {
  // Browser QA cannot share a local URI. Keep the existing text fallback so
  // web previews remain operable; Android and iOS always take the file path.
  if (Platform.OS === 'web') {
    await Share.share({ title: options.filename, message: options.contents });
    return;
  }
  if (!FileSystem.cacheDirectory) throw new Error('cache_unavailable');
  const safeName = options.filename.replace(/[^A-Za-z0-9._-]/g, '-');
  const uri = `${FileSystem.cacheDirectory}${safeName}`;
  await FileSystem.writeAsStringAsync(uri, options.contents, {
    encoding: FileSystem.EncodingType.UTF8,
  });
  await shareExistingFile({
    uri,
    dialogTitle: options.dialogTitle,
    mimeType: options.mimeType,
    deleteAfter: true,
  });
}
