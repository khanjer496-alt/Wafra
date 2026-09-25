/**
 * The four-row iPhone capture checklist shown in first-run setup.
 *
 * Each row is "done" only from recorded evidence: the owner's own
 * confirmation that the shortcut and the automation were added (setup
 * progress), the shortcut's native test proof, and the native first-capture
 * timestamp. Unknown evidence is simply not done — the checklist never
 * assumes a step happened.
 */
export type IosChecklistRowId = 'add' | 'test' | 'automate' | 'first-alert';

export interface IosChecklistRow {
  id: IosChecklistRowId;
  done: boolean;
}

export interface IosChecklistEvidence {
  shortcutConfirmed: boolean;
  automationConfirmed: boolean;
  /** Native setup proof version recorded by the shortcut's test run. */
  setupProofVersion: number | null;
  /** The proof version this build's shortcut records (3 for Capture v3, else 1). */
  requiredProofVersion: number;
  firstCapturedAt: number | null;
}

const isTimestamp = (value: unknown): value is number =>
  typeof value === 'number' && Number.isFinite(value) && value > 0 && value <= 8_640_000_000_000_000;

export function iosCaptureChecklist(evidence: IosChecklistEvidence | null): IosChecklistRow[] {
  const tested = evidence !== null && evidence.setupProofVersion === evidence.requiredProofVersion;
  const firstAlert = evidence !== null && isTimestamp(evidence.firstCapturedAt);
  return [
    // A captured alert proves the earlier steps even if a confirmation tap was skipped.
    { id: 'add', done: evidence !== null && (evidence.shortcutConfirmed || tested || firstAlert) },
    { id: 'test', done: tested || firstAlert },
    { id: 'automate', done: evidence !== null && (evidence.automationConfirmed || firstAlert) },
    { id: 'first-alert', done: firstAlert },
  ];
}
