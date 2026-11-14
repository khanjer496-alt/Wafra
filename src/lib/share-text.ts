import * as Clipboard from 'expo-clipboard';
import * as FileSystem from 'expo-file-system/legacy';
import * as Sharing from 'expo-sharing';
import { Platform } from 'react-native';

type TextFileShareErrorCode =
  | 'download_unavailable'
  | 'cache_unavailable'
  | 'share_unavailable'
  | 'write_failed'
  | 'share_cancelled'
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

/** The picker may return a copied cache file or an external URI. Only the
 * former belongs to Wafra; consume it before showing the restore confirmation.
 */
export async function readBackupPickerCopy(uri: string, pickedFile?: { text(): Promise<string> }): Promise<string> {
  // Expo DocumentPicker provides a local File on web; native FileSystem is
  // unavailable there. Reading that File never fetches or uploads a URL.
  if (Platform.OS === 'web') {
    try {
      if (!pickedFile) throw new Error('The selected backup file is unavailable.');
      return await pickedFile.text();
    } finally {
      if (uri.startsWith('blob:')) URL.revokeObjectURL(uri);
    }
  }
  let ownedCopy = false;
  try {
    const cache = FileSystem.cacheDirectory ? new URL(FileSystem.cacheDirectory) : null;
    const file = new URL(uri);
    const path = decodeURIComponent(file.pathname);
    const root = cache ? decodeURIComponent(cache.pathname).replace(/\/?$/, '/') : null;
    ownedCopy = cache?.protocol === 'file:' && file.protocol === 'file:' &&
      file.host === cache.host && root !== null && path.startsWith(root) && path !== root &&
      !path.split('/').includes('..');
  } catch {
    // An unrecognized external URI never grants deletion authority.
  }
  try {
    return await FileSystem.readAsStringAsync(uri);
  } finally {
    if (ownedCopy) await FileSystem.deleteAsync(uri, { idempotent: true });
  }
}

const EXPORT_DIRECTORY = 'wafra-generated-exports/';
const EXPORT_GRACE_MS = 24 * 60 * 60 * 1000;
// Expo Print's native implementations both generate cache/Print/<UUID>.pdf.
const PRINT_PDF_NAME = /^[a-f\d]{8}-[a-f\d]{4}-[a-f\d]{4}-[a-f\d]{4}-[a-f\d]{12}\.pdf$/i;
const LEGACY_EXPORTS = [
  'wafra-backup.json', 'wafra-export.csv', 'wafra-card-diagnostic.txt',
  'wafra-parser-report.json', 'wafra-launch-metrics.json',
];
const activeExports = new Set<string>();
let exportSequence = 0;
let erasingExports = false;
let pdfExportActive = false;

function assertExportAllowed(): void {
  if (erasingExports) throw new TextFileShareError('share_cancelled');
}

function beginExport(): () => void {
  assertExportAllowed();
  const pending = `export-pending-${++exportSequence}`;
  activeExports.add(pending);
  return () => { activeExports.delete(pending); };
}

async function printFiles(cache: string): Promise<string[]> {
  const root = `${cache}Print/`;
  const info = await FileSystem.getInfoAsync(root);
  return info.exists ? (await FileSystem.readDirectoryAsync(root)).filter(name => PRINT_PDF_NAME.test(name)) : [];
}

/** Only app-generated files are eligible. Android recipients can read after
 * the chooser resolves, so retain their attachments for a bounded grace period.
 * Called at startup/foreground and during explicit ledger erase.
 */
export async function cleanupGeneratedExports(options: { eraseAll?: boolean } = {}): Promise<void> {
  const cache = FileSystem.cacheDirectory;
  if (Platform.OS === 'web' || !cache) return;
  if (options.eraseAll && (activeExports.size || erasingExports)) throw new Error('An export or erase is still in progress');
  if (options.eraseAll) erasingExports = true;
  try {
    const root = `${cache}${EXPORT_DIRECTORY}`;
    const info = await FileSystem.getInfoAsync(root);
    const children = info.exists ? await FileSystem.readDirectoryAsync(root) : [];
    const legacyCorpus = (await FileSystem.readDirectoryAsync(cache)).filter((name) =>
      /^wafra-sms-corpus-\d{4}-\d{2}-\d{2}\.json$/.test(name));
    const printRoot = `${cache}Print/`;
    const printed = await printFiles(cache);
    const candidates = [
      ...children.filter((name) => !name.includes('/') && name !== '..').map((name) => `${root}${name}`),
      ...[...LEGACY_EXPORTS, ...legacyCorpus].map((name) => `${cache}${name}`),
      ...printed.map(name => `${printRoot}${name}`),
    ];
    for (const uri of candidates) {
      if (activeExports.has(uri)) continue;
      const item = await FileSystem.getInfoAsync(uri);
      if (!item.exists) continue;
      if (options.eraseAll || ('modificationTime' in item &&
        item.modificationTime * 1000 <= Date.now() - EXPORT_GRACE_MS)) {
        await FileSystem.deleteAsync(uri, { idempotent: true });
      }
    }
  } finally {
    if (options.eraseAll) erasingExports = false;
  }
}

/** Keep PDF generation and sharing inside the same erase/retention lifecycle
 * as text exports. Only the SDK's app-owned cache files grant deletion rights.
 */
export async function shareGeneratedPdf(
  createFile: () => Promise<{ uri: string }>,
  options: { dialogTitle?: string; shouldContinue?: () => boolean } = {},
): Promise<void> {
  const cache = FileSystem.cacheDirectory;
  if (Platform.OS === 'web' || !cache) throw new TextFileShareError('cache_unavailable');
  const assertActive = () => {
    assertExportAllowed();
    if (options.shouldContinue?.() === false) throw new TextFileShareError('share_cancelled');
  };
  if (pdfExportActive) throw new TextFileShareError('share_failed');
  const releaseExport = beginExport();
  pdfExportActive = true;
  let ownedUri: string | null = null;
  let beforePrint: Set<string> | null = null;
  let completed = false;
  try {
    assertActive();
    if (!(await Sharing.isAvailableAsync())) throw new TextFileShareError('share_unavailable');
    assertActive();
    beforePrint = new Set(await printFiles(cache));
    assertActive();
    const { uri } = await createFile();
    const root = new URL('Print/', cache);
    const file = new URL(uri);
    const pathname = decodeURIComponent(file.pathname);
    const rootPath = decodeURIComponent(root.pathname);
    if (file.protocol !== 'file:' || root.protocol !== 'file:' || file.host !== root.host ||
        file.search || file.hash || !pathname.startsWith(rootPath) ||
        !PRINT_PDF_NAME.test(pathname.slice(rootPath.length))) {
      throw new TextFileShareError('write_failed');
    }
    ownedUri = uri;
    activeExports.add(uri);
    assertActive();
    await Sharing.shareAsync(uri, { mimeType: 'application/pdf', UTI: 'com.adobe.pdf', dialogTitle: options.dialogTitle });
    completed = true;
  } catch (error) {
    // Native renderers can reject after creating a file without returning its
    // URI. PDF operations are exclusive, so only new UUIDs belong to this run.
    if (beforePrint) {
      for (const name of await printFiles(cache)) {
        if (!beforePrint.has(name)) await FileSystem.deleteAsync(`${cache}Print/${name}`, { idempotent: true });
      }
    }
    throw error;
  } finally {
    try {
      // Android receivers may consume the URI after chooser return. Startup
      // cleanup ages these files out; explicit erase removes them immediately.
      if (ownedUri && (Platform.OS === 'ios' || !completed)) await FileSystem.deleteAsync(ownedUri, { idempotent: true });
    } finally {
      if (ownedUri) activeExports.delete(ownedUri);
      pdfExportActive = false;
      releaseExport();
    }
  }
}

/**
 * Export text as an actual file, or reject. Never degrades to a message share.
 *
 * Reports and backups must produce one attachable file. A swallowed Web Share
 * failure or a plain-text intent must not claim that an export succeeded.
 */
export async function shareTextFile(
  filename: string,
  text: string,
  options: { mimeType?: string; dialogTitle?: string; shouldContinue?: () => boolean } = {},
): Promise<void> {
  const assertActive = () => {
    assertExportAllowed();
    if (options.shouldContinue?.() === false) throw new TextFileShareError('share_cancelled');
  };
  assertActive();
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
  const releaseExport = beginExport();
  try {
    let sharingAvailable = false;
    try {
      sharingAvailable = await Sharing.isAvailableAsync();
    } catch {
      throw new TextFileShareError('share_unavailable');
    }
    if (!sharingAvailable) {
      throw new TextFileShareError('share_unavailable');
    }

    if (!filename || filename.includes('/') || filename.includes('\\') || filename === '..') {
      throw new TextFileShareError('write_failed');
    }
    const folder = `${dir}${EXPORT_DIRECTORY}${Date.now()}-${++exportSequence}`;
    const uri = `${folder}/${filename}`;
    activeExports.add(folder);
    try {
      assertActive();
      await FileSystem.makeDirectoryAsync(folder, { intermediates: true });
      assertActive();
      await FileSystem.writeAsStringAsync(uri, text, {
        encoding: FileSystem.EncodingType.UTF8,
      });
    } catch {
      activeExports.delete(folder);
      await FileSystem.deleteAsync(folder, { idempotent: true }).catch(() => {});
      throw new TextFileShareError('write_failed');
    }
    let completed = false;
    try {
      // File IO can outlive the caller's screen or consent state.
      assertActive();
      await Sharing.shareAsync(uri, {
        mimeType,
        dialogTitle: options.dialogTitle ?? filename,
        UTI: mimeType === 'application/json' ? 'public.json'
          : mimeType === 'text/csv' ? 'public.comma-separated-values-text' : 'public.plain-text',
      });
      completed = true;
    } catch (error) {
      if (error instanceof TextFileShareError) throw error;
      throw new TextFileShareError('share_failed');
    } finally {
      activeExports.delete(folder);
      // iOS resolves after the activity completes/cancels. Android resolves at
      // chooser return, before some receiving apps have consumed the file.
      if (Platform.OS === 'ios' || !completed) {
        await FileSystem.deleteAsync(folder, { idempotent: true }).catch(() => {});
      }
    }
  } finally {
    releaseExport();
  }
}

/** Convenience name; exports always remain files, including large ledgers. */
export async function shareText(
  filename: string,
  text: string,
  options: { mimeType?: string; dialogTitle?: string } = {},
): Promise<void> {
  await shareTextFile(filename, text, options);
}
