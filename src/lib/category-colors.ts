/**
 * Each category's own colour: soft neon, chosen to read on Spending's
 * near-black band, with dark ink set on it anywhere it is a ground. The same
 * category is the same colour everywhere it is drawn (the coins on the band,
 * their legend, the glyph tiles on the sheet).
 *
 * A custom category takes a colour from the same set by a stable hash of its
 * id, so it keeps that colour across launches and devices. Where several are
 * drawn together, `categoryColors` moves a custom category off a colour
 * another one there already has. Every colour holds 7:1 for the dark ink and
 * 7:1 against the near-black band (tested).
 */
import type { CategoryId } from '@/lib/types';

/** Dark ink for a glyph or label set on a category colour. */
export const CATEGORY_INK = '#16130F';

/** Several small categories pooled into one ("4 other categories"): a quiet warm grey, no category's colour. */
export const CATEGORY_REST = '#A39E95';

const BUILT_IN: Record<string, string> = {
  rent: '#7CC4F5',
  // Not lime: that is the accent (the selected pill, the Spending tab).
  groceries: '#FFB86B',
  shopping: '#5FE08A',
  health: '#B9A2F8',
  dining: '#EC9FE8',
  travel: '#F6A9BA',
  transport: '#ECDFA8',
  entertainment: '#F2EC5C',
  education: '#F2D27A',
  utilities: '#67DCCB',
  telecom: '#97A9F8',
  loan: '#FF9784',
  'personal-care': '#FBC79E',
  'home-services': '#DCC79C',
  software: '#79E2F0',
  investing: '#A9E68F',
  charity: '#F7BCD8',
  government: '#A9BCD6',
  'cash-withdrawal': '#CDD1D7',
  other: '#C4BDB2',
  salary: '#B6EC7A',
  business: '#F5D579',
  bank: '#B8C2CC',
  card: '#C9C2E0',
  cash: '#D3D8C4',
};

/** The set custom categories draw from: the built-in colours, in a fixed order. */
export const CATEGORY_PALETTE: readonly string[] = Object.values(BUILT_IN);

/** FNV-1a: small, stable across platforms, and spreads short ids well. */
function hash(text: string): number {
  let value = 0x811c9dc5;
  for (let index = 0; index < text.length; index += 1) {
    value ^= text.charCodeAt(index);
    value = Math.imul(value, 0x01000193) >>> 0;
  }
  return value;
}

export function categoryColor(category: CategoryId | string): string {
  return BUILT_IN[category] ?? CATEGORY_PALETTE[hash(category) % CATEGORY_PALETTE.length]!;
}

/**
 * Colours for categories drawn side by side: built-in ones keep their own; a
 * custom one takes its hashed colour, or the next one in the set that nothing
 * else here has, so two coins never look alike. Deterministic for a given list.
 */
export function categoryColors(categories: readonly (CategoryId | string)[]): Map<string, string> {
  const colors = new Map<string, string>();
  const used = new Set<string>();
  for (const category of categories) {
    const own = BUILT_IN[category];
    if (own) {
      colors.set(category, own);
      used.add(own);
    }
  }
  for (const category of categories) {
    if (colors.has(category)) continue;
    const start = hash(category) % CATEGORY_PALETTE.length;
    let pick = CATEGORY_PALETTE[start]!;
    for (let step = 0; step < CATEGORY_PALETTE.length; step += 1) {
      const candidate = CATEGORY_PALETTE[(start + step) % CATEGORY_PALETTE.length]!;
      if (!used.has(candidate)) {
        pick = candidate;
        break;
      }
    }
    colors.set(category, pick);
    used.add(pick);
  }
  return colors;
}
