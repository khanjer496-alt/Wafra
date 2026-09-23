import { LOCAL_PUBLIC_PARSER_HEAD, LOCAL_CANONICAL_PARSER_INDEX } from '@/lib/local-semantic-bundle';
import { createLocalParserFamilyClassifier, createLocalParserFamilyHeadAdvisory,
  createLocalSemanticRetriever, createLocalParserFamilyAdvisory,
  type LocalParserFamilyAdvisoryResult } from '@/lib/local-semantic-model';
import { getLocalSemanticEncoder, localSemanticRuntimeStatus } from '@/lib/local-semantic-runtime';
import type { UniversalBankEvent } from '@/lib/universal-types';

export async function evaluateLocalReviewWindow(event: UniversalBankEvent, window: string,
  cancelled: () => boolean): Promise<LocalParserFamilyAdvisoryResult> {
  const unavailable = { kind: 'refused', reason: 'model-unavailable' } as const;
  if (cancelled() || localSemanticRuntimeStatus().state !== 'ready') return unavailable;
  const encoder = await getLocalSemanticEncoder();
  if (cancelled()) return unavailable;
  // Share one inference between two independently calibrated decision heads.
  const vector = await encoder.encode(window, { priority: 'background', cancelled });
  if (cancelled()) return unavailable;
  const cachedEncoder = { manifest: encoder.manifest, encode: async () => vector };
  const learned = await createLocalParserFamilyHeadAdvisory({ event, semanticText: window,
    sensitiveSpans: [], classifier: createLocalParserFamilyClassifier(cachedEncoder, LOCAL_PUBLIC_PARSER_HEAD), cancelled });
  if (learned.kind !== 'parser-family-advisory' || cancelled()) return learned;
  const canonical = await createLocalParserFamilyAdvisory({ event, semanticText: window,
    sensitiveSpans: [], retriever: createLocalSemanticRetriever(cachedEncoder, LOCAL_CANONICAL_PARSER_INDEX), cancelled });
  return !cancelled() && canonical.kind === 'parser-family-advisory' && canonical.family === learned.family
    ? learned : { kind: 'refused', reason: 'low-score' };
}
