import { learnFromConfirmation, type ConfirmedFields } from '@/lib/learned-alert-formats';
import type { SharedAlertShape } from '@/lib/shared-alert-formats';
import { toSharedAlertShape } from '@/lib/shared-alert-formats';

/**
 * Sharing consent. `undefined` means the person never chose, which is ON; only
 * an explicit `false` (their choice, or a restored backup's) is off. Private
 * Mode overrides everything and never sends.
 */
export const sharesAlertFormats = (state: { shareAlertFormats?: boolean; privateMode?: boolean }): boolean =>
  state.shareAlertFormats !== false && state.privateMode !== true;

export interface ShareConfirmedFormatInput {
  /** Alert text; used only to build the shape, never stored or sent. */
  source: string;
  sender: string | null;
  confirmed: ConfirmedFields;
  consent: boolean | undefined;
  privateMode: boolean;
  /** The alert was recognised by the proven AE/SA launch route. */
  launchRoute: boolean;
  country?: string | null;
  now: number;
}

export interface ShareConfirmedFormatDeps {
  getConfig: () => Promise<{ baseUrl: string; syncToken: string } | null>;
  submit: (cfg: { baseUrl: string; syncToken: string }, shape: SharedAlertShape) => Promise<unknown>;
}

/**
 * Build the anonymous shape for a confirmed, unrecognised alert and submit it.
 * Never throws, never logs, never reports why it skipped. Returns true only
 * when a submission was attempted. Merchant is used only if it is an exact
 * substring of the text.
 */
export async function shareConfirmedAlertFormat(
  input: ShareConfirmedFormatInput,
  deps: ShareConfirmedFormatDeps,
): Promise<boolean> {
  try {
    if (input.consent === false || input.privateMode || input.launchRoute) return false;
    const merchant = input.confirmed.merchant && input.source.includes(input.confirmed.merchant)
      ? input.confirmed.merchant : null;
    const learned = learnFromConfirmation({
      source: input.source, sender: input.sender, now: input.now,
      confirmed: { ...input.confirmed, merchant },
      context: { country: input.country ?? null, launchRoute: false },
    });
    if (learned.ok === false) return false;
    const made = toSharedAlertShape(learned.template);
    if (made.ok === false) return false;
    const cfg = await deps.getConfig();
    if (!cfg) return false;
    await deps.submit(cfg, made.shape);
    return true;
  } catch {
    return false;
  }
}
