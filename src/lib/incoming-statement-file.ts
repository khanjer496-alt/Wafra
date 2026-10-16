/**
 * A statement handed to Wafra by iOS ("Open in Wafra" from the Share Sheet or
 * Files). With LSSupportsOpeningDocumentsInPlace false, iOS copies the file
 * into this app's Documents/Inbox and opens Wafra with its file:// URL, which
 * Expo Router passes to +native-intent's redirectSystemPath.
 *
 * Pure and platform-free so the URL rules run in the Node test suite.
 *
 * The file URI never travels as a route parameter. A route parameter can be
 * written by anyone who can open a wafra:// link, so a link naming a file
 * already in Wafra's sandbox (an export, say) must not be able to upload it.
 * Instead the redirect records the validated file here, in memory, and the
 * route carries only a one-time token; the statement screen trades the token
 * for the file exactly once.
 */

/** The statement types Wafra registers for (app.json CFBundleDocumentTypes). */
// Structured statements are registered with their own imported types. Generic
// XML (camt) is left to the in-app picker so Wafra is not offered for every
// .xml file on the phone.
export const INCOMING_STATEMENT_EXTENSIONS: readonly string[] = [
  'pdf', 'csv', 'tsv', 'xlsx', 'ofx', 'qfx', 'qif', 'sta', 'mt940', '940',
];

/** The statement import route's parameter that carries the one-time token. */
export const INCOMING_STATEMENT_PARAM = 'incomingStatement';

const MAX_URL_LENGTH = 2048;
const MAX_NAME_LENGTH = 255;

export interface IncomingStatementFile {
  /** The file:// URL exactly as iOS gave it. */
  uri: string;
  /** The decoded file name, for the import's per-file result. */
  name: string;
}

/**
 * The decoded path segments of a file URL, or null. `strict` (an incoming
 * URL) demands the exact file:/// form; the documents directory may also be
 * spelled file:/path. One trailing slash is allowed. A segment that is
 * empty, `.` or `..`, or decodes to a separator or control character fails.
 */
function fileSegments(value: string, strict: boolean): string[] | null {
  let path: string;
  if (value.startsWith('file:///')) path = value.slice('file://'.length);
  else if (!strict && value.startsWith('file:/') && !value.startsWith('file://')) path = value.slice('file:'.length);
  else return null;
  if (/[\u0000-\u001f\u007f\\?#]/.test(path)) return null;
  const raw = path.slice(1).split('/');
  if (!strict && raw.length > 1 && raw[raw.length - 1] === '') raw.pop();
  const segments: string[] = [];
  for (const part of raw) {
    let decoded: string;
    try {
      decoded = decodeURIComponent(part);
    } catch {
      return null;
    }
    if (decoded === '' || decoded === '.' || decoded === '..' || /[/\\\u0000-\u001f\u007f]/.test(decoded)) return null;
    segments.push(decoded);
  }
  // iOS spells the same container /var/… and /private/var/… (a symlink).
  if (segments[0] === 'private' && segments[1] === 'var') segments.shift();
  return segments;
}

/**
 * Accept only a statement file directly inside `<documents>/Inbox/` — where
 * iOS puts the copy it hands over — as a strict file:/// URL with no query,
 * fragment or traversal, and a statement extension. Anything else is null
 * (and is never touched). `documentDirectory` is expo-file-system's
 * Paths.document URI.
 */
export function parseIncomingStatementUrl(
  value: unknown,
  documentDirectory: string | null | undefined,
): IncomingStatementFile | null {
  if (typeof value !== 'string' || value.length === 0 || value.length > MAX_URL_LENGTH) return null;
  if (typeof documentDirectory !== 'string' || documentDirectory.length === 0) return null;
  const documents = fileSegments(documentDirectory, false);
  const segments = fileSegments(value, true);
  if (!documents || documents.length === 0 || !segments) return null;
  if (segments.length !== documents.length + 2) return null;
  if (documents.some((segment, index) => segments[index] !== segment)) return null;
  if (segments[documents.length] !== 'Inbox') return null;
  const name = segments[segments.length - 1];
  if (name.length > MAX_NAME_LENGTH || name.startsWith('.')) return null;
  const extension = /\.([A-Za-z0-9]+)$/.exec(name)?.[1].toLowerCase();
  if (!extension || !INCOMING_STATEMENT_EXTENSIONS.includes(extension)) return null;
  return { uri: value, name };
}

let pending: { token: string; file: IncomingStatementFile } | null = null;
let sequence = 0;
/** Handed-over copies a newer file replaced before the screen claimed them. */
let superseded: string[] = [];

/** Remember a validated file and return the one-time token that claims it. */
export function registerIncomingStatement(file: IncomingStatementFile): string {
  if (pending && pending.file.uri !== file.uri) superseded.push(pending.file.uri);
  sequence += 1;
  const token = `${sequence.toString(36)}${Math.random().toString(36).slice(2, 10)}`;
  pending = { token, file };
  return token;
}

/** The file for this token, once; any other value (or a second claim) is null. */
export function takeIncomingStatement(token: unknown): IncomingStatementFile | null {
  if (!pending || typeof token !== 'string' || token !== pending.token) return null;
  const { file } = pending;
  pending = null;
  return file;
}

/** Inbox copies replaced before they were claimed, for the screen to delete (once). */
export function takeSupersededIncomingStatements(): string[] {
  const uris = superseded;
  superseded = [];
  return uris;
}

/** The handed-over file still waiting to be claimed, so cleanup spares it. */
export function pendingIncomingStatementUri(): string | null {
  return pending?.file.uri ?? null;
}

/**
 * The route for an incoming URL: the statement import screen with a token
 * when it is a statement file, otherwise null (stay where the app is).
 */
export function incomingStatementRedirect(url: unknown, documentDirectory: string | null | undefined): string | null {
  const file = parseIncomingStatementUrl(url, documentDirectory);
  if (!file) return null;
  const token = registerIncomingStatement(file);
  return `/statement-import?${INCOMING_STATEMENT_PARAM}=${encodeURIComponent(token)}`;
}
