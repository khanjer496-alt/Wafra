/**
 * Pure layout figures for the settings-side screens in design language E.
 * Kept out of the screens so they are tested without a renderer.
 */
import { Spacing } from '@/constants/theme';

/**
 * Where a Settings recovery link (`/settings?section=imports`) scrolls: the
 * top of a group inside the sheet, less a little air.
 *
 * `bandContentBottom` is the end of the band content inside the band's
 * column, and `sectionY` the group's offset inside the sheet. BandScaffold
 * pads the band by Spacing.two above its column and by the sheet overlap plus
 * Spacing.four below it, and the sheet starts one overlap higher than the band
 * ends — so the sheet's top in the scroll content is the band content's end
 * plus those two paddings.
 */
export function settingsSectionScrollY(bandContentBottom: number, sectionY: number): number {
  const sheetTop = Spacing.two + bandContentBottom + Spacing.four;
  return Math.max(0, Math.round(sheetTop + sectionY - Spacing.three));
}

/**
 * An invite's remaining time as the band shows it, "09:42", and the parts the
 * spoken sentence needs. Never negative; an expired invite reads "00:00".
 */
export function inviteCountdown(secondsLeft: number): { text: string; minutes: number; seconds: string } {
  const safe = Number.isFinite(secondsLeft) ? Math.max(0, Math.floor(secondsLeft)) : 0;
  const minutes = Math.floor(safe / 60);
  const seconds = String(safe % 60).padStart(2, '0');
  return { text: `${String(minutes).padStart(2, '0')}:${seconds}`, minutes, seconds };
}
