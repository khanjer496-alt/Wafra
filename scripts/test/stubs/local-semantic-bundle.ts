/**
 * The app imports the three local-AI metadata artifacts as JSON modules
 * (`@/assets/local-ai/*.json`), which Metro resolves and inlines. The test
 * build compiles with `tsc build/*.ts --outDir build`, where a JSON import
 * cannot be resolved without `--resolveJsonModule`, and enabling that makes
 * tsc try to emit the JSON back over its own input.
 *
 * So this stub stands in for the module, not for the data: it reads the SAME
 * files off disk at runtime. The vectors, the linear head and its thresholds
 * are the real shipped ones, so anything asserting on scores or gates is
 * testing the artifacts the app actually carries.
 */
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

import type {
  LocalParserFamilyLinearHead,
  LocalSemanticPrototypeIndex,
} from '@/lib/local-semantic-model';

// build/ lives at scripts/test/build, so the repository root is three up.
const assets = join(__dirname, '..', '..', '..', 'assets', 'local-ai');
const load = <T>(name: string): T => JSON.parse(readFileSync(join(assets, name), 'utf8')) as T;

export const LOCAL_ASSISTANT_PROTOTYPE_INDEX =
  load<LocalSemanticPrototypeIndex>('assistant-prototype-index.e5.int8.json');

export const LOCAL_CANONICAL_PARSER_INDEX =
  load<LocalSemanticPrototypeIndex>('parser-canonical-centroids.e5.int8.json');

export const LOCAL_PUBLIC_PARSER_HEAD =
  load<LocalParserFamilyLinearHead>('parser-family-head.e5.public.json');
