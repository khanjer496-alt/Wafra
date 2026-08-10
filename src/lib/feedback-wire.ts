/** One versioned contract shared by the app and the Worker. */
export const FEEDBACK_WIRE_SCHEMA = 1;
export const FEEDBACK_RETENTION_DAYS = 14;
export const FEEDBACK_DIAGNOSTIC_MAX_BYTES = 16 * 1024;

export interface FeedbackDeliveryDisclosure {
  retentionDays: 14;
  reviewedBy: 'wafra-maintainers';
  thirdPartyAi: false;
}

export const FEEDBACK_DELIVERY: FeedbackDeliveryDisclosure = {
  retentionDays: FEEDBACK_RETENTION_DAYS,
  reviewedBy: 'wafra-maintainers',
  thirdPartyAi: false,
};

interface FeedbackWireSource {
  schema: number;
  message: string;
  detailRequested: string;
  detail: string;
  withheld: string | null;
  delivery: FeedbackDeliveryDisclosure;
  build: {
    version: string;
    platform: string;
    language: string;
    marketId: string;
    currency: string;
    privateMode: boolean;
  };
  counts: unknown;
  shapes: unknown;
  diagnostic: string | null;
}

export interface FeedbackWirePayload {
  schema: 1;
  text: string;
  appVersion: string;
  platform: string;
  locale: string;
  /** Literal false in this release. The Worker rejects true. */
  aiReviewConsent: false;
  diagnostic: {
    reportSchema: number;
    detailRequested: string;
    detail: string;
    withheld: string | null;
    delivery: FeedbackDeliveryDisclosure;
    build: Omit<FeedbackWireSource['build'], 'version' | 'platform' | 'language'>;
    counts: unknown;
    shapes: unknown;
    cardDiagnostic: string | null;
  };
}

/** Map every report field; the transport must not append device identity. */
export function toFeedbackWirePayload(payload: FeedbackWireSource): FeedbackWirePayload {
  return {
    schema: FEEDBACK_WIRE_SCHEMA,
    text: payload.message,
    appVersion: payload.build.version,
    platform: payload.build.platform,
    locale: payload.build.language,
    aiReviewConsent: false,
    diagnostic: {
      reportSchema: payload.schema,
      detailRequested: payload.detailRequested,
      detail: payload.detail,
      withheld: payload.withheld,
      delivery: payload.delivery,
      build: {
        marketId: payload.build.marketId,
        currency: payload.build.currency,
        privateMode: payload.build.privateMode,
      },
      counts: payload.counts,
      shapes: payload.shapes,
      cardDiagnostic: payload.diagnostic,
    },
  };
}

export interface SerializedFeedbackWire {
  body: string;
  bodyBytes: number;
  diagnosticBytes: number;
}

const wireEncoder = new TextEncoder();

/** UTF-8 sizes, matching the Worker's limits rather than JS string length. */
export function serializeFeedbackWire(payload: FeedbackWireSource): SerializedFeedbackWire {
  const wire = toFeedbackWirePayload(payload);
  const body = JSON.stringify(wire);
  return {
    body,
    bodyBytes: wireEncoder.encode(body).byteLength,
    diagnosticBytes: wireEncoder.encode(JSON.stringify(wire.diagnostic)).byteLength,
  };
}
