import {
  setFeedbackTransport,
  type FeedbackPayload,
  type FeedbackReceipt,
} from '@/lib/feedback';
import {
  FEEDBACK_DIAGNOSTIC_MAX_BYTES,
  type ParserResearchWirePayload,
  serializeFeedbackWire,
} from '@/lib/feedback-wire';
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

const wireEncoder = new TextEncoder();

export class FeedbackSendError extends Error {
  /** The Worker's machine-readable reason, when it gave one. */
  readonly code: string | null;
  /**
   * The HTTP status, when the failure came from a response at all.
   *
   * Carried because the Worker's `error` body is optional and the screen has
   * to say something true either way. Without it, a 429 the Worker did not
   * label and a 500 were indistinguishable at the point where the user is
   * being told whether trying again is worth their time.
   */
  readonly status: number | null;
  constructor(message: string, code: string | null, status: number | null = null) {
    super(message);
    this.name = 'FeedbackSendError';
    this.code = code;
    this.status = status;
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

  // The shared converter maps every displayed field and appends no device id,
  // push token, install id or other identity.
  const serialized = serializeFeedbackWire(payload);
  if (serialized.diagnosticBytes > FEEDBACK_DIAGNOSTIC_MAX_BYTES) {
    throw new FeedbackSendError('This report attachment is too large to send.', 'diagnostic_too_large');
  }
  if (serialized.bodyBytes > MAX_BODY_BYTES) {
    throw new FeedbackSendError('This report is too large to send.', 'too_large');
  }

  let response: Response;
  try {
    response = await fetch(`${DEFAULT_RELAY_URL}/v1/feedback`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: serialized.body,
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
    throw new FeedbackSendError(
      `The server refused the report (${response.status}).`,
      code,
      response.status,
    );
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
  return { id: parsed.id, dispatched: parsed.dispatched === true };
}

/**
 * Post a parser-research report that the tester has previewed and explicitly
 * authorized for the disclosed coding-AI workflow. Unlike ordinary feedback,
 * the body is already the final wire object and contains no user prose.
 */
export async function submitParserResearchFeedback(
  wire: ParserResearchWirePayload,
): Promise<FeedbackReceipt> {
  if (!DEFAULT_RELAY_URL) {
    throw new FeedbackSendError('This build has no relay URL configured.', 'no_relay_url');
  }
  const body = JSON.stringify(wire);
  const diagnosticBytes = wireEncoder.encode(JSON.stringify(wire.diagnostic)).byteLength;
  if (diagnosticBytes > FEEDBACK_DIAGNOSTIC_MAX_BYTES) {
    throw new FeedbackSendError('This report attachment is too large to send.', 'diagnostic_too_large');
  }
  if (wireEncoder.encode(body).byteLength > MAX_BODY_BYTES) {
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
    throw new FeedbackSendError('Could not reach the server.', 'network');
  }
  if (!response.ok) {
    let code: string | null = null;
    try {
      const parsed: unknown = await response.json();
      if (parsed && typeof parsed === 'object' && typeof (parsed as { error?: unknown }).error === 'string') {
        code = (parsed as { error: string }).error;
      }
    } catch {
      code = null;
    }
    throw new FeedbackSendError(
      `The server refused the report (${response.status}).`,
      code,
      response.status,
    );
  }
  let parsed: FeedbackResponse;
  try {
    parsed = (await response.json()) as FeedbackResponse;
  } catch {
    throw new FeedbackSendError('The server answered with something unreadable.', 'bad_response');
  }
  if (typeof parsed.id !== 'string' || parsed.id === '') {
    throw new FeedbackSendError('The server did not say where the report went.', 'no_id');
  }
  return { id: parsed.id, dispatched: parsed.dispatched === true };
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
