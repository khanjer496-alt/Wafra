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
const REQUEST_TIMEOUT_MS = 15_000;

/** What the Worker answers with on success. */
interface FeedbackResponse {
  id?: unknown;
  dispatched?: unknown;
}

export interface TesterDiagnosticWirePayload {
  schema: 1;
  text: 'Android tester diagnostics.';
  appVersion: string;
  platform: 'android';
  locale: string;
  aiReviewConsent: false;
  diagnostic: Record<string, unknown>;
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

/** One deadline covers both response headers and body consumption. */
async function postFeedbackBody(
  body: string,
  noun: 'report' | 'diagnostic' = 'report',
): Promise<FeedbackReceipt> {
  const controller = new AbortController();
  let timer: ReturnType<typeof setTimeout> | undefined;
  let knownRefusal: FeedbackSendError | null = null;
  const deadline = new Promise<never>((_resolve, reject) => {
    timer = setTimeout(() => {
      // Settle even if the platform fails to reject its fetch/body promise on
      // abort. A timeout means delivery is unconfirmed, not proven absent.
      reject(knownRefusal ?? new FeedbackSendError('Could not reach the server.', 'network'));
      controller.abort();
    }, REQUEST_TIMEOUT_MS);
  });
  const request = async (): Promise<FeedbackReceipt> => {
    let response: Response;
    try {
      response = await fetch(`${DEFAULT_RELAY_URL}/v1/feedback`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body,
        signal: controller.signal,
      });
    } catch {
      throw new FeedbackSendError('Could not reach the server.', 'network');
    }
    if (!response.ok) {
      // Error details are optional. Preserve an already received refusal even
      // when its body stalls until the deadline or contains malformed JSON.
      knownRefusal = new FeedbackSendError(
        `The server refused the ${noun} (${response.status}).`, null, response.status,
      );
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
        `The server refused the ${noun} (${response.status}).`, code, response.status,
      );
    }
    let parsed: FeedbackResponse | null;
    try {
      parsed = (await response.json()) as FeedbackResponse | null;
    } catch {
      throw new FeedbackSendError('The server answered with something unreadable.', 'bad_response');
    }
    // A response without an id cannot confirm delivery to the user.
    if (!parsed || typeof parsed.id !== 'string' || parsed.id === '') {
      throw new FeedbackSendError('The server did not say where the report went.', 'no_id');
    }
    return { id: parsed.id, dispatched: parsed.dispatched === true };
  };
  try {
    return await Promise.race([deadline, request()]);
  } finally {
    clearTimeout(timer);
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

  return postFeedbackBody(serialized.body);
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

  return postFeedbackBody(body);
}

/**
 * Explicit final-test support upload. It deliberately reuses the already
 * deployed, short-retention Cloudflare feedback store instead of adding a
 * second unauthenticated upload surface. The report builder owns redaction;
 * this transport only enforces the same byte ceilings as every other feedback
 * attachment and returns the Cloudflare report id.
 */
export async function submitTesterDiagnostics(
  wire: TesterDiagnosticWirePayload,
): Promise<FeedbackReceipt> {
  if (!DEFAULT_RELAY_URL) {
    throw new FeedbackSendError('This build has no relay URL configured.', 'no_relay_url');
  }
  const diagnosticBytes = wireEncoder.encode(JSON.stringify(wire.diagnostic)).byteLength;
  if (diagnosticBytes > FEEDBACK_DIAGNOSTIC_MAX_BYTES) {
    throw new FeedbackSendError('This diagnostic is too large to send.', 'diagnostic_too_large');
  }
  const body = JSON.stringify(wire);
  if (wireEncoder.encode(body).byteLength > MAX_BODY_BYTES) {
    throw new FeedbackSendError('This diagnostic is too large to send.', 'too_large');
  }

  const receipt = await postFeedbackBody(body, 'diagnostic');
  return { ...receipt, dispatched: false };
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
