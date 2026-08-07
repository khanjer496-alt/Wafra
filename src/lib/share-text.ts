import * as FileSystem from 'expo-file-system/legacy';
import * as Sharing from 'expo-sharing';
import { Platform, Share } from 'react-native';

/**
 * Share a block of text as a FILE rather than as an intent payload.
 *
 * `Share.share({ message })` hands the whole string to the OS share sheet, and
 * on Android that crosses a Binder transaction with a hard ceiling around 512KB
 * — over it the process is killed with TransactionTooLargeException, which
 * surfaces to the user as the app simply disappearing. Nothing in JS can catch
 * it: the `.catch()` on Share.share never runs, because the failure is native
 * and terminal.
 *
 * Every caller here can exceed that. The card diagnostic prints every
 * card-related row WITH its raw bank message; a CSV export and a JSON backup are
 * the entire ledger. A few hundred transactions is enough. The user who reported
 * this had 174 in one month.
 *
 * So: write to the cache directory and share the file's URI, which is a few
 * dozen bytes whatever the content weighs. The file lands in the cache, so the
 * OS reclaims it without the app having to track it.
 *
 * Web has no cache directory and no share sheet worth the name, so it keeps the
 * message path — payloads there are not crossing a Binder transaction.
 */
export async function shareText(
  filename: string,
  text: string,
  options: { mimeType?: string; dialogTitle?: string } = {},
): Promise<void> {
  if (Platform.OS === 'web') {
    await Share.share({ title: filename, message: text }).catch(() => {});
    return;
  }

  const dir = FileSystem.cacheDirectory;
  // No cache directory means no file to share; the message path is still better
  // than nothing, and a short payload will survive it.
  if (!dir) {
    await Share.share({ title: filename, message: text }).catch(() => {});
    return;
  }

  const uri = `${dir}${filename}`;
  try {
    await FileSystem.writeAsStringAsync(uri, text, {
      encoding: FileSystem.EncodingType.UTF8,
    });
    if (await Sharing.isAvailableAsync()) {
      await Sharing.shareAsync(uri, {
        mimeType: options.mimeType ?? 'text/plain',
        dialogTitle: options.dialogTitle ?? filename,
        UTI: options.mimeType === 'application/json' ? 'public.json' : 'public.plain-text',
      });
      return;
    }
  } catch {
    // Fall through — a failed write or an unavailable share sheet should not
    // take the screen down with it.
  }
  await Share.share({ title: filename, message: text }).catch(() => {});
}
