export interface ConsentPrompt {
  question: string;
  body: string;
  confirmLabel: string;
  cancelLabel: string;
}

type Presenter = (prompt: ConsentPrompt) => Promise<boolean | null>;
let present: Presenter | null = null;

/** Null means that no choice was made (for example, the app is locked). */
export function requestConsent(prompt: ConsentPrompt): Promise<boolean | null> {
  return present ? present(prompt) : Promise.resolve(null);
}

export function registerConsentPresenter(presenter: Presenter): () => void {
  present = presenter;
  return () => { if (present === presenter) present = null; };
}
