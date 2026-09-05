/** Only locally bundled artwork with established distribution rights belongs here. */
export interface MerchantLogo {
  id: string;
  /** Metro's static asset identifier; remote image URLs are not supported. */
  source: number;
}

// The researched artwork remains a private prototype until its usage rights are
// resolved. An empty shipping catalog intentionally uses the category fallback.
const LOGOS: ReadonlyMap<string, MerchantLogo> = new Map();

export function merchantLogoFor(title: string): MerchantLogo | null {
  return LOGOS.get(title.trim().toLowerCase()) ?? null;
}
