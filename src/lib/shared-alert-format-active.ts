import { setSharedAlertFormatMatcher, type SharedMatcher } from '@/lib/private-alert-format-runtime';
import {
  SHARED_FORMATS_MAX_LIST,
  matchSharedAlertShape,
  validateSharedAlertFormatList,
} from '@/lib/shared-alert-formats';

/**
 * Make the downloaded community shapes available to on-device matching. The
 * list is re-validated here; an empty or invalid list turns shared matching
 * off. Matches are PREFILL ONLY: private-alert-format-runtime issues them as
 * the same trusted Review prefill capability private formats use, so a shared
 * shape can fill fields for a person to confirm but never posts by itself.
 */
export function sharedMatcherFor(value: unknown): SharedMatcher | null {
  const formats = validateSharedAlertFormatList(value, SHARED_FORMATS_MAX_LIST) ?? [];
  return formats.length ? (source, sender, opts) => matchSharedAlertShape(source, sender, formats, opts) : null;
}

export function activateSharedAlertFormats(value: unknown): void {
  setSharedAlertFormatMatcher(sharedMatcherFor(value));
}
