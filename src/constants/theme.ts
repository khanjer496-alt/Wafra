/**
 * Wafra — Ledger & Light. Restored from Claude's 934e5cb design rules.
 * Limestone paper and warm charcoal; restrained green for action/selection.
 * Group with space and 1px dividers, not decorative cards or gradients.
 * A card earns its border only when wholly tappable or dismissible.
 * Meaningful income, clay expense and warning colours; glyph-led categories.
 * Control borders and text-grade warning aliases retain later accessibility fixes.
 */

import '@/global.css';

import { Platform } from 'react-native';

// Original palette, with explicit control/inverse roles required by current screens.
export const Colors = {
  light: {
    text: '#16130F',
    textSecondary: '#57524A',
    textTertiary: '#6B6559',
    background: '#F4F1EA',
    backgroundElement: '#FBF9F4',
    backgroundSelected: '#EDEAE1',
    card: '#FBF9F4',
    cardBorder: '#E3DED2',
    cardBorderStrong: '#D3CCBD',
    controlBorder: '#81796B',
    controlBorderHigh: '#57524A',
    inverseSurface: '#16130F',
    inverseText: '#F2EFE8',
    scrim: 'rgba(22, 19, 15, 0.48)',
    primary: '#1F6B52',
    primarySoft: '#E4EDE8',
    primaryBorder: '#C3D8CD',
    onPrimary: '#F7FBF8',
    income: '#1E7355',
    expense: '#A3402D',
    warning: '#7E5F14',
    incomeGraphic: '#2E8A63',
    expenseGraphic: '#B4503C',
    warningGraphic: '#A07B2A',
    track: '#E3DED2',
    expenseSoftBg: '#FBF3F0',
    expenseSoftBorder: '#E7D3CD',
    gold: '#7E5F14',
    goldSoft: '#F1E9D8',
  },
  dark: {
    text: '#F2EFE8',
    textSecondary: '#A9A29A',
    textTertiary: '#9B948A',
    background: '#14120F',
    backgroundElement: '#1C1A16',
    backgroundSelected: '#232019',
    card: '#1C1A16',
    cardBorder: '#3B362E',
    cardBorderStrong: '#4A443A',
    controlBorder: '#81796B',
    controlBorderHigh: '#A9A29A',
    inverseSurface: '#F2EFE8',
    inverseText: '#16130F',
    scrim: 'rgba(20, 18, 15, 0.64)',
    primary: '#57B894',
    primarySoft: '#1E3A31',
    primaryBorder: '#3B362E',
    onPrimary: '#0F2C23',
    income: '#6BC79E',
    expense: '#E0836B',
    warning: '#D9AE62',
    incomeGraphic: '#6BC79E',
    expenseGraphic: '#E0836B',
    warningGraphic: '#D9AE62',
    track: '#3B362E',
    expenseSoftBg: '#2A1D18',
    expenseSoftBorder: '#4A322A',
    gold: '#D9AE62',
    goldSoft: '#332A18',
  },
};

export const DataViz = {
  light: { ramp: ['#1F6B52', '#488269', '#779E89', '#A7BFAC', '#C8D8C9'], neutral: '#E3DED2', axis: '#6B6559', expenseSoft: '#B4503C',
    /** Multi-hue palette for a categorical picture (a pie or a stacked area) where the ramp's single-hue gradient would tell the reader "same series, different age" instead of "different categories". Kept muted and desaturated so it still reads as one Ledger & Light system, not a rainbow. */
    categorical: ['#1F6B52', '#B4503C', '#A07B2A', '#3B7A8C', '#7A4E76'] },
  dark: { ramp: ['#57B894', '#479A7B', '#377D63', '#29634D', '#1E4839'], neutral: '#3B362E', axis: '#9B948A', expenseSoft: '#E0836B',
    categorical: ['#57B894', '#E0836B', '#D9AE62', '#7EBACE', '#C79ABE'] },
} as const;

export type ThemeColor = keyof typeof Colors.light & keyof typeof Colors.dark;

/**
 * Bundled faces, loaded once in `_layout.tsx` behind the splash screen.
 *
 * React Native applies no synthetic weights on Android — a `fontWeight` on a
 * custom family is silently dropped — so every weight has to be its own
 * family name. Geist carries reading, Geist Mono carries figures, and Noto Kufi carries Arabic.
 */
export const Fonts = {
  sans: 'Geist-Regular',
  sansMedium: 'Geist-Medium',
  sansSemi: 'Geist-SemiBold',
  mono: 'GeistMono-Regular',
  monoMedium: 'GeistMono-Medium',
  monoSemi: 'GeistMono-SemiBold',
  arabic: 'NotoKufiArabic-Regular',
  arabicBold: 'NotoKufiArabic-Bold',
} as const;

// The .ttf files themselves are required in `src/app/_layout.tsx`, not here:
// this module is imported by plain-node unit tests, which have no asset
// transformer and would choke on a binary require.

/** 4pt ladder. Name the step, not the pixel. */
export const Spacing = {
  half: 2,
  one: 4,
  two: 8,
  three: 16,
  four: 24,
  five: 32,
  six: 64,
} as const;

/**
 * Radii are named for what they wrap. The legacy `sm`/`md`/`lg`/`xl` names are
 * kept pointing at the new scale so every screen picks up the tighter geometry
 * without a thousand-line rename; new code should use the semantic names.
 */
export const Radius = {
  chip: 4,
  tile: 10,
  control: 12,
  sheet: 14,
  tabbar: 18,
  bottomSheet: 22,
  full: 999,
  /** @deprecated use `tile` */
  sm: 10,
  /** @deprecated use `control` */
  md: 12,
  /** @deprecated use `sheet` */
  lg: 14,
  /** @deprecated use `bottomSheet` */
  xl: 22,
} as const;

/**
 * One shadow in the whole system, tinted warm rather than black, and only on
 * the two surfaces that genuinely float: the tab bar and a bottom sheet.
 */
export const Elevation = {
  shadowColor: '#16130F',
  shadowOpacity: 0.18,
  shadowRadius: 24,
  shadowOffset: { width: 0, height: 8 },
  elevation: 10,
} as const;

/** Every scroller pads to this so the floating bar never covers the last row. */
/**
 * `cubic-bezier(.2, .8, .2, 1)` everywhere — the redesign's motion rules. No
 * linear, no bounce; the one overshoot the rules allow belongs to springs.
 */
export const EASE = [0.2, 0.8, 0.2, 1] as const;

/**
 * Durations in ms. Transform and opacity only.
 *
 * The rules: 150 for taps, 240 for most changes, 420 for first appearances,
 * and nothing longer than 500. A looping pulse counts per half-cycle, so a
 * `pulse` of 1000 runs 500 ms out and 500 ms back — it used to be 2800
 * (1400 ms halves), the one token that broke the ceiling.
 */
export const Motion = {
  tap: 150,
  change: 240,
  appear: 420,
  max: 500,
  rowPress: 220,
  sectionEnter: 320,
  sectionStagger: 40,
  sheet: 420,
  /** A figure's first appearance; kept at the first-appearance duration. */
  countUp: 420,
  pulse: 1000,
  /** Each changed digit of a rolling figure starts this long after the last. */
  digitStagger: 60,
  /** A keypad digit fades in over this long. */
  keyFade: 90,
} as const;

/**
 * The one spring: sheets, pins and the category check. With mass 1 this is
 * a damping ratio of ~0.74, one small overshoot and settled well inside
 * `Motion.max`. Callers that must not overshoot (a sheet whose bottom edge
 * would lift off the screen) clamp it themselves.
 */
export const MotionSpring = { stiffness: 260, damping: 24, mass: 1 } as const;

/**
 * Compact phone gutters. 18px keeps Ledger & Light airy without making the
 * interface feel zoomed-in on 390-430pt phones, and gives data-heavy screens
 * noticeably more usable width. Tablet/web content is still capped below.
 */
export const ScreenPadding = 18;

export const BottomTabInset = Platform.select({ ios: 50, android: 80 }) ?? 0;
export const MaxContentWidth = 800;

/* ─────────────────────────────────────────────────────────────────────────
 * Design language E — colour bands.
 *
 * Every tab owns a colour and every screen is a band of that colour holding
 * the one figure that matters, with a cream sheet over it holding the
 * detail. Detail screens take their parent's band. Additive: nothing above
 * this line changed, and screens that have not moved to bands keep reading
 * `Colors` through `useTheme()` as before. See docs/design/language-e.md.
 *
 * Every text colour here is solid (no alpha), so contrast is a property of
 * the token and is tested: `onBand` and `onBandSecondary` hold 4.5:1 on both
 * `band` and `tile`; `tint` holds 4.5:1 on `sheet`.
 * ───────────────────────────────────────────────────────────────────────── */

/** Home ink · Spending clay · Bills ochre · Accounts slate · capture/review green · settings sand. */
export type BandId = 'home' | 'spending' | 'bills' | 'accounts' | 'flow' | 'settings';
export const BAND_IDS: readonly BandId[] = ['home', 'spending', 'bills', 'accounts', 'flow', 'settings'];

export interface BandPalette {
  id: BandId;
  scheme: 'light' | 'dark';
  /** The band itself, and the top overscroll. */
  band: string;
  /** Text and icons set on the band. */
  onBand: string;
  /** Labels and qualifiers on the band (4.5:1 on band and tile). */
  onBandSecondary: string;
  /** A stat tile / segmented track / chip on the band: the band's own tone. */
  tile: string;
  /** Hairline divider or unfilled bar on the band. */
  bandRule: string;
  /** Week bars and share segments that are not the highlighted one. */
  bandMark: string;
  /** Sheet surface (and the bottom overscroll); dialogs use it lifted. */
  sheet: string;
  /** A card or keypad key sitting on the sheet. */
  card: string;
  /** Dividers and tracks on the sheet. */
  rule: string;
  /** The single ground every category glyph tile on the sheet uses. */
  glyphGround: string;
  text: string;
  textSecondary: string;
  /** The band's colour as it reads on the sheet: links, active segment text, glyphs. */
  tint: string;
  /** Fill of a control in the band colour on the sheet (EButton primary). */
  fill: string;
  /** Text on `fill`. */
  onFill: string;
  /** The segmented control's selected pill on the band, and its label. */
  selected: string;
  onSelected: string;
  /** Mint: the one accent (today's bar, the Left-in-budgets tile, Add). */
  accent: string;
  onAccent: string;
  onAccentSecondary: string;
  /** Limit status: within, near (≥85%), over. Text-grade on the sheet. */
  statusOk: string;
  statusNear: string;
  statusOver: string;
  statusOkSoft: string;
  statusNearSoft: string;
  statusOverSoft: string;
  /** expo-status-bar style: light content on dark bands. */
  statusBar: 'light' | 'dark';
  /** iOS NativeTabs selected tint for the tab this band belongs to. */
  tabTint: string;
}

type BandCore = Pick<BandPalette, 'band' | 'onBand' | 'onBandSecondary' | 'tile' | 'bandRule' | 'bandMark' |
  'tint' | 'fill' | 'onFill' | 'selected' | 'onSelected' | 'statusBar' | 'tabTint'>;

const CREAM = '#F4F1EA';
const INK = '#16130F';
const MINT = '#57B894';
// Named, not inlined: the accessibility suite reads `text:`/`textSecondary:`
// hex literals in this file as the two page palettes above.
const LIGHT_SECONDARY = '#57524A';
const DARK_TEXT = '#F2EFE8';
const DARK_SECONDARY = '#A9A29A';

const SHEET_LIGHT = {
  sheet: '#F4F1EA', card: '#FBF9F4', rule: '#E3DED2', glyphGround: '#EDE3CF', text: INK, textSecondary: LIGHT_SECONDARY,
  accent: MINT, onAccent: INK, onAccentSecondary: '#23342A',
  statusOk: '#1F6B52', statusNear: '#7E5F14', statusOver: '#A3402D',
  statusOkSoft: '#E4EDE8', statusNearSoft: '#F1E9D8', statusOverSoft: '#FBF3F0',
} as const;

// dark.py: sheets #1C1A16, cards #24211C, rules #3B362E, text #F2EFE8,
// secondary #A9A29A; glyph/link/status tints move lighter.
const SHEET_DARK = {
  sheet: '#1C1A16', card: '#24211C', rule: '#3B362E', glyphGround: '#2E2A23', text: DARK_TEXT, textSecondary: DARK_SECONDARY,
  accent: MINT, onAccent: INK, onAccentSecondary: '#23342A',
  statusOk: '#57B894', statusNear: '#D9AE62', statusOver: '#E08A70',
  statusOkSoft: '#1E3A31', statusNearSoft: '#3A3020', statusOverSoft: '#2A1D18',
} as const;

const BAND_CORE: Record<'light' | 'dark', Record<BandId, BandCore>> = {
  light: {
    home: { band: INK, onBand: CREAM, onBandSecondary: '#A09D96', tile: '#282521', bandRule: '#3E3B36', bandMark: '#64615C',
      tint: INK, fill: INK, onFill: CREAM, selected: CREAM, onSelected: INK, statusBar: 'light', tabTint: INK },
    spending: { band: '#A4432F', onBand: CREAM, onBandSecondary: '#EBDED5', tile: '#8D3B2A', bandRule: '#B26251', bandMark: '#D5ADA1',
      tint: '#A4432F', fill: '#A4432F', onFill: CREAM, selected: CREAM, onSelected: '#A4432F', statusBar: 'light', tabTint: '#A4432F' },
    // Ochre is light: ink text on it, and its sheet tint is the text-grade ochre.
    bills: { band: '#E2B45A', onBand: INK, onBandSecondary: '#574727', tile: '#E9CC94', bandRule: '#BD974D', bandMark: '#7A6234',
      tint: '#7E5F14', fill: INK, onFill: CREAM, selected: INK, onSelected: CREAM, statusBar: 'dark', tabTint: '#7E5F14' },
    accounts: { band: '#2F6577', onBand: CREAM, onBandSecondary: '#D6DCD9', tile: '#2B5866', bandRule: '#527E8C', bandMark: '#9FB5B9',
      tint: '#2F6577', fill: '#2F6577', onFill: CREAM, selected: CREAM, onSelected: '#2F6577', statusBar: 'light', tabTint: '#2F6577' },
    flow: { band: '#1F6B52', onBand: CREAM, onBandSecondary: '#D6DED5', tile: '#1E5D47', bandRule: '#45836D', bandMark: '#9BB9AA',
      tint: '#1F6B52', fill: '#1F6B52', onFill: CREAM, selected: CREAM, onSelected: '#1F6B52', statusBar: 'light', tabTint: '#1F6B52' },
    settings: { band: '#EDE3CF', onBand: INK, onBandSecondary: '#6A645A', tile: '#F1EBDF', bandRule: '#C6BEAC', bandMark: '#888175',
      tint: INK, fill: INK, onFill: CREAM, selected: INK, onSelected: CREAM, statusBar: 'dark', tabTint: INK },
  },
  // Dark mode deepens each band so it never glares at night; text on every band is light.
  dark: {
    home: { band: '#0B0A08', onBand: '#F2EFE8', onBandSecondary: '#96938E', tile: '#1D1C1A', bandRule: '#353330', bandMark: '#605F5B',
      tint: '#F2EFE8', fill: '#F2EFE8', onFill: INK, selected: '#1C1A16', onSelected: '#F2EFE8', statusBar: 'light', tabTint: '#F2EFE8' },
    spending: { band: '#6E2B1E', onBand: '#F2EFE8', onBandSecondary: '#D0BCB3', tile: '#793B2E', bandRule: '#864E42', bandMark: '#A98379',
      tint: '#E08A70', fill: '#E08A70', onFill: INK, selected: '#1C1A16', onSelected: '#E08A70', statusBar: 'light', tabTint: '#E08A70' },
    bills: { band: '#5E4719', onBand: '#F2EFE8', onBandSecondary: '#D6CFC1', tile: '#6A542A', bandRule: '#79653E', bandMark: '#A4967A',
      tint: '#D9AE62', fill: '#D9AE62', onFill: INK, selected: '#1C1A16', onSelected: '#D9AE62', statusBar: 'light', tabTint: '#D9AE62' },
    accounts: { band: '#1B3F4A', onBand: '#F2EFE8', onBandSecondary: '#B2BAB9', tile: '#2C4D57', bandRule: '#425F66', bandMark: '#75898C',
      tint: '#7FB4C4', fill: '#7FB4C4', onFill: INK, selected: '#1C1A16', onSelected: '#7FB4C4', statusBar: 'light', tabTint: '#7FB4C4' },
    flow: { band: '#14473A', onBand: '#F2EFE8', onBandSecondary: '#B6C2B9', tile: '#265448', bandRule: '#3C6559', bandMark: '#738F85',
      tint: '#57B894', fill: '#57B894', onFill: INK, selected: '#1C1A16', onSelected: '#57B894', statusBar: 'light', tabTint: '#57B894' },
    settings: { band: '#26221C', onBand: '#F2EFE8', onBandSecondary: '#A09D96', tile: '#36322C', bandRule: '#4B4741', bandMark: '#6F6C65',
      tint: '#F2EFE8', fill: '#F2EFE8', onFill: INK, selected: '#1C1A16', onSelected: '#F2EFE8', statusBar: 'light', tabTint: '#F2EFE8' },
  },
};

function buildBands(scheme: 'light' | 'dark'): Record<BandId, BandPalette> {
  const sheet = scheme === 'light' ? SHEET_LIGHT : SHEET_DARK;
  const out = {} as Record<BandId, BandPalette>;
  for (const id of BAND_IDS) out[id] = { id, scheme, ...sheet, ...BAND_CORE[scheme][id] };
  return out;
}

/** Resolved band palettes. Prefer `useBand(id)`; this is for pure code and tests. */
export const BandPalettes: Record<'light' | 'dark', Record<BandId, BandPalette>> = {
  light: buildBands('light'),
  dark: buildBands('dark'),
};

export function bandPalette(id: BandId, scheme: 'light' | 'dark'): BandPalette {
  return BandPalettes[scheme][id];
}

/** Geometry of the band + sheet composition. */
export const BandLayout = {
  /** The sheet's top corners. */
  sheetRadius: 28,
  /** How far the sheet overlaps the bottom of the band. */
  sheetOverlap: 28,
  /** How far the sheet rises on its first appearance (spring 260/24). */
  sheetRise: 40,
  /** Plain E buttons. */
  buttonHeight: 56,
  buttonRadius: 16,
  /** Chips on a band. */
  chipHeight: 38,
} as const;

/**
 * The floating ink tab bar (Android and web). The selected tab shows its
 * band colour and its name; the others are icons with a spoken label.
 * iOS keeps the system bar and uses `BandPalette.tabTint` instead.
 */
export interface TabPillColors {
  bar: string;
  border: string;
  inactive: string;
  ripple: string;
  home: { fill: string; text: string };
  spending: { fill: string; text: string };
  bills: { fill: string; text: string };
  accounts: { fill: string; text: string };
}
export const TabPill: Record<'light' | 'dark', TabPillColors> = {
  light: {
    bar: INK, border: INK, inactive: '#BDBAB3', ripple: 'rgba(244, 241, 234, 0.16)',
    home: { fill: CREAM, text: INK }, spending: { fill: '#A4432F', text: CREAM },
    bills: { fill: '#E2B45A', text: INK }, accounts: { fill: '#2F6577', text: CREAM },
  },
  dark: {
    bar: '#0B0A08', border: '#3B362E', inactive: '#B8B6B0', ripple: 'rgba(242, 239, 232, 0.14)',
    home: { fill: DARK_TEXT, text: INK }, spending: { fill: '#A4432F', text: DARK_TEXT },
    bills: { fill: '#E2B45A', text: INK }, accounts: { fill: '#2F6577', text: DARK_TEXT },
  },
};

/**
 * The personal pattern's palette. Tokens only ever name a colour; a tile
 * never encodes money. `fill` paints shapes and tile grounds; `mark` paints a
 * glyph or letter set on a tile.
 */
export type PatternColor = 'ink' | 'clay' | 'ochre' | 'slate' | 'green' | 'mint' | 'sand' | 'cream';
export const PatternPalette: Record<'light' | 'dark', { fill: Record<PatternColor, string>; mark: Record<PatternColor, string> }> = {
  light: {
    fill: { ink: INK, clay: '#A4432F', ochre: '#E2B45A', slate: '#2F6577', green: '#1F6B52', mint: MINT, sand: '#EDE3CF', cream: CREAM },
    mark: { ink: INK, clay: '#A4432F', ochre: '#7E5F14', slate: '#2F6577', green: '#1F6B52', mint: '#1F6B52', sand: '#EDE3CF', cream: CREAM },
  },
  dark: {
    fill: { ink: '#F2EFE8', clay: '#A4432F', ochre: '#E2B45A', slate: '#2F6577', green: '#1F6B52', mint: MINT, sand: '#2E2A23', cream: '#F2EFE8' },
    mark: { ink: '#F2EFE8', clay: '#E08A70', ochre: '#D9AE62', slate: '#7FB4C4', green: MINT, mint: MINT, sand: '#2E2A23', cream: CREAM },
  },
};
