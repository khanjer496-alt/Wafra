import {
  setFeedbackTransport,
  type FeedbackPayload,
  type FeedbackReceipt,
} from '@/lib/feedback';
import { DEFAULT_RELAY_URL } from '@/lib/relay';

/**
 * The wire half of feedback: the only place in the app that sends a report.
 *
 * It is a separate module from `feedback.ts` on purpose. That file builds and
 * redacts the payload and promises to contain no network, so the tests can
 * drive the whole redaction path with no socket anywhere near it. This is the
 * other side of that seam, and it is deliberately thin — if it ever grows a
 * decision about WHAT to send, the decision is in the wrong file.
 *
 * Unauthenticated by design, which is unusual here and worth stating. Every
 * other relay route carries a scoped device token, but Android never pairs
 * with the relay at all — its capture is entirely on-device — so the users
 * most likely to find a parser bug have no credential to present. Requiring
 * one would have made this feature reach only the iPhone half of the users.
 * The endpoint is rate-limited and size-capped server-side instead.
 */

/** Matches the Worker's cap; rejected there too, but a 32 KB round trip to be told so is waste. */
const MAX_BODY_BYTES = 32768;

/** What the Worker answers with on success. */
interface FeedbackResponse {
  id?: unknown;
  dispatched?: unknown;
}

export class FeedbackSendError extends Error {
  /** The Worker's machine-readable reason, when it gave one. */
  readonly code: string | null;
  constructor(message: string, code: string | null) {
    super(message);
    this.name = 'FeedbackSendError';
    this.code = code;
  }
}

/**
 * POST one report.
 *
 * Throws on every non-success, never resolves on failure — the screen tells
 * the user their report is on its way based on this resolving, so resolving
 * without having sent anything would be a lie it has no way to detect.
 */
async function postFeedback(payload: FeedbackPayload): Promise<FeedbackReceipt> {
  if (!DEFAULT_RELAY_URL) {
    throw new FeedbackSendError('This build has no relay URL configured.', 'no_relay_url');
  }

  // The payload is sent EXACTLY as the screen showed it. The user consented to
  // a specific text; a transport that appended anything — a device id, a push
  // token, an install id — would be sending something they did not read.
  const body = JSON.stringify(payload);
  if (body.length > MAX_BODY_BYTES) {
    throw new FeedbackSendError('This report is too large to send.', 'too_large');
  }

  let response: Response;
  try {
    response = await fetch(`${DEFAULT_RELAY_URL}/v1/feedback`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body,
    });
  } catch {
    // Offline, DNS, TLS. Nothing here is worth showing a user verbatim, and
    // the message is deliberately about what to do rather than what broke.
    throw new FeedbackSendError('Could not reach the server.', 'network');
  }

  if (!response.ok) {
    // The Worker answers `{ "error": "rate_limited" }` and similar. Read it if
    // it is there, but never let a malformed error body mask the status.
    let code: string | null = null;
    try {
      const parsed: unknown = await response.json();
      if (parsed && typeof parsed === 'object' && typeof (parsed as { error?: unknown }).error === 'string') {
        code = (parsed as { error: string }).error;
      }
    } catch {
      code = null;
    }
    throw new FeedbackSendError(`The server refused the report (${response.status}).`, code);
  }

  let parsed: FeedbackResponse;
  try {
    parsed = (await response.json()) as FeedbackResponse;
  } catch {
    throw new FeedbackSendError('The server answered with something unreadable.', 'bad_response');
  }
  // A 202 with no id is not a success this app can report: the id is the only
  // thing the user could quote back, and inventing one would make a lost
  // report look filed.
  if (typeof parsed.id !== 'string' || parsed.id === '') {
    throw new FeedbackSendError('The server did not say where the report went.', 'no_id');
  }
  return { id: parsed.id };
}

/**
 * Install it. Called once from the root layout.
 *
 * No-op when the build has no relay URL, which leaves
 * `isFeedbackTransportInstalled()` false and makes the screen offer "save a
 * copy" instead of a Send button that could only fail.
 */
export function installFeedbackTransport(): void {
  if (!DEFAULT_RELAY_URL) return;
  setFeedbackTransport(postFeedback);
}
