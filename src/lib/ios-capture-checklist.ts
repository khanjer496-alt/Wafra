/**
 * The four-row iPhone capture checklist shown in first-run setup.
 *
 * Each row is "done" only from recorded evidence: the owner's own
 * confirmation that the shortcut and the automation were added (setup
 * progress), and the native capture status read through the SAME rule the
 * setup screen uses, `resolveIosSetupReadiness` (capture enabled, and this
 * build's shortcut proof version — v3 when the bundled shortcut exists).
 * Unknown evidence is simply not done — the checklist never assumes a step.
 */
import type { IosSetupReadiness } from '@/lib/ios-capture-setup';

export type IosChecklistRowId = 'add' | 'test' | 'automate' | 'first-alert';

export interface IosChecklistRow {
  id: IosChecklistRowId;
  done: boolean;
}

export interface IosChecklistEvidence {
  shortcutConfirmed: boolean;
  automationConfirmed: boolean;
  /** resolveIosSetupReadiness over the native status; 'not-added' when unknown. */
  readiness: IosSetupReadiness;
}

export function iosCaptureChecklist(evidence: IosChecklistEvidence | null): IosChecklistRow[] {
  const tested = evidence !== null && evidence.readiness !== 'not-added';
  const firstAlert = evidence !== null && evidence.readiness === 'first-alert-captured';
  return [
    // A proven shortcut or a captured alert proves the earlier steps even if a
    // confirmation tap was skipped.
    { id: 'add', done: evidence !== null && (evidence.shortcutConfirmed || tested) },
    { id: 'test', done: tested },
    { id: 'automate', done: evidence !== null && (evidence.automationConfirmed || firstAlert) },
    { id: 'first-alert', done: firstAlert },
  ];
}
