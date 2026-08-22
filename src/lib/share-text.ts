import * as Clipboard from 'expo-clipboard';
import * as FileSystem from 'expo-file-system/legacy';
import * as Sharing from 'expo-sharing';
import { Platform, Share } from 'react-native';

export type TextFileShareErrorCode =
  | 'download_unavailable'
  | 'cache_unavailable'
  | 'share_unavailable'
  | 'write_failed'
  | 'share_failed';

/** Named so the screen can answer a failed file export without platform detail. */
export class TextFileShareError extends Error {
  readonly code: TextFileShareErrorCode;

  constructor(code: TextFileShareErrorCode) {
    super(`Could not export a text file (${code}).`);
    this.name = 'TextFileShareError';
    this.code = code;
  }
}

export class TextClipboardError extends Error {
  readonly code: 'too_large';

  constructor(code: 'too_large') {
    super(`Could not copy text (${code}).`);
    this.name = 'TextClipboardError';
    this.code = code;
  }
}

const CLIPBOARD_TEXT_MAX_BYTES = 128 * 1024;

/** Copy only text a caller has already made safe for the system clipboard. */
export async function copyTextToClipboard(text: string): Promise<void> {
  if (text.length > CLIPBOARD_TEXT_MAX_BYTES ||
    new TextEncoder().encode(text).byteLength > CLIPBOARD_TEXT_MAX_BYTES) {
    throw new TextClipboardError('too_large');
  }
  await Clipboard.setStringAsync(text);
}

/**
 * Export text as an actual file, or reject. Never degrades to a message share.
 *
 * Parser reports depend on the user receiving one attachable JSON file. The
 * permissive `shareText` fallback below is right for convenience exports and
 * wrong here: a swallowed Web Share failure or a plain-text intent looks like
 * success while leaving the tester with no file to hand to Codex.
 */
export async function shareTextFile(
  filename: string,
  text: string,
  options: { mimeType?: string; dialogTitle?: string } = {},
): Promise<void> {
  const mimeType = options.mimeType ?? 'text/plain';
  if (Platform.OS === 'web') {
    if (typeof document === 'undefined' || typeof Blob === 'undefined' ||
      !document.body || typeof URL === 'undefined' ||
      typeof URL.createObjectURL !== 'function') {
      throw new TextFileShareError('download_unavailable');
    }
    try {
      const uri = URL.createObjectURL(new Blob([text], { type: mimeType }));
      const anchor = document.createElement('a');
      anchor.href = uri;
      anchor.download = filename;
      anchor.rel = 'noopener';
      document.body.appendChild(anchor);
      anchor.click();
      anchor.remove();
      // Some browsers consume Blob downloads asynchronously after click().
      // Revoking on the next tick can cancel the file before it is claimed.
      setTimeout(() => URL.revokeObjectURL(uri), 1_000);
      return;
    } catch {
      throw new TextFileShareError('download_unavailable');
    }
  }

  const dir = FileSystem.cacheDirectory;
  if (!dir) throw new TextFileShareError('cache_unavailable');
  let sharingAvailable = false;
  try {
    sharingAvailable = await Sharing.isAvailableAsync();
  } catch {
    throw new TextFileShareError('share_unavailable');
  }
  if (!sharingAvailable) {
    throw new TextFileShareError('share_unavailable');
  }

  const uri = `${dir}${filename}`;
  try {
    await FileSystem.writeAsStringAsync(uri, text, {
      encoding: FileSystem.EncodingType.UTF8,
    });
  } catch {
    throw new TextFileShareError('write_failed');
  }
  try {
    await Sharing.shareAsync(uri, {
      mimeType,
      dialogTitle: options.dialogTitle ?? filename,
      UTI: mimeType === 'application/json' ? 'public.json' : 'public.plain-text',
    });
  } catch {
    throw new TextFileShareError('share_failed');
  }
}

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
