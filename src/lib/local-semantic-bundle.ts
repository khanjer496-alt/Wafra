import assistantIndexJson from '@/assets/local-ai/assistant-prototype-index.e5.int8.json';
import canonicalParserIndexJson from '@/assets/local-ai/parser-canonical-centroids.e5.int8.json';
import parserHeadJson from '@/assets/local-ai/parser-family-head.e5.public.json';

import type {
  LocalParserFamilyLinearHead,
  LocalSemanticPrototypeIndex,
} from '@/lib/local-semantic-model';

/**
 * Small, code-owned semantic metadata ships with Wafra. The ~35.5 MiB encoder
 * is downloaded and hash-verified separately. No user data is represented in
 * these artifacts; the parser head is public-anchor-only by contract.
 */
export const LOCAL_ASSISTANT_PROTOTYPE_INDEX =
  assistantIndexJson as LocalSemanticPrototypeIndex;

export const LOCAL_CANONICAL_PARSER_INDEX =
  canonicalParserIndexJson as LocalSemanticPrototypeIndex;

export const LOCAL_PUBLIC_PARSER_HEAD =
  parserHeadJson as LocalParserFamilyLinearHead;
