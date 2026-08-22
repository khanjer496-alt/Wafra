/**
 * Wafra design tokens — "Ledger & Light".
 *
 * Warm neutrals only: limestone paper and warm charcoal, never a cool grey and
 * never a true black. One accent hue (a desaturated green) carries brand and
 * affirmative meaning; beyond that, colour is reserved for meaning alone —
 * `income`, `expense`, `warning`. Category identity comes from its glyph, not
 * from seventeen competing hues.
 *
 * Grouping is done with 1px dividers, not cards. A card only earns its border
 * when the whole thing is tappable or dismissible.
 */

import '@/global.css';

import { Platform } from 'react-native';

export const Colors = {
  light: {
    text: '#16130F', // ink — off-black, warm. never #000
    textSecondary: '#57524A', // 6.87:1 on paper
    textTertiary: '#6B6559', // 5.13:1 on paper — row meta, caps labels
    background: '#F4F1EA', // limestone paper
    backgroundElement: '#FBF9F4',
    backgroundSelected: '#EDEAE1',
    card: '#FBF9F4',
    cardBorder: '#E3DED2',
    cardBorderStrong: '#D3CCBD',
    // Interactive boundaries must remain visible without relying on colour.
    // 3.65:1 against backgroundElement, clearing WCAG's 3:1 non-text floor.
    controlBorder: '#8A8173',
    controlBorderHigh: '#6B6559',
    primary: '#1F6B52', // the only accent
    primarySoft: '#E4EDE8',
    primaryBorder: '#C3D8CD',
    onPrimary: '#F7FBF8',
    // These three carry meaning as TEXT — "+2,400", "over by AED 431", "3 days
    // late" — so they are held to WCAG AA (4.5:1) on paper, not the 3:1 that
    // would be enough for a bar or a dot. The lighter values they replaced
    // measured 3.77, 4.48 and 3.47:1 respectively.
    income: '#1E7355', // 5.12:1 on paper
    expense: '#A3402D', // 5.59:1 — clay red, not pink
    warning: '#7E5F14', // 5.27:1
    // …and these are the same three as INK: bars, dots, chart fills. WCAG asks
    // 3:1 of a graphic rather than 4.5:1, and the text-grade values go muddy
    // at bar size — a near-limit bar in #7E5F14 reads as olive sludge. These
    // are the pre-AA values, which measure 3.77, 4.48 and 3.47:1.
    incomeGraphic: '#2E8A63',
    expenseGraphic: '#B4503C',
    warningGraphic: '#A07B2A',
    track: '#E3DED2',
    expenseSoftBg: '#FBF3F0',
    expenseSoftBorder: '#E7D3CD',
    /** @deprecated warm accent kept as an alias so older screens still build. */
    gold: '#A07B2A',
    /** @deprecated */
    goldSoft: '#F1E9D8',
  },
  dark: {
    text: '#F2EFE8',
    textSecondary: '#A9A29A', // 7.41:1
    textTertiary: '#9B948A',
    background: '#14120F', // warm charcoal. never #070D0B
    backgroundElement: '#1C1A16',
    backgroundSelected: '#232019',
    card: '#1C1A16',
    cardBorder: '#3B362E',
    cardBorderStrong: '#4A443A',
    // 3.55:1 against backgroundElement; the high-contrast value reaches 6.88:1.
    controlBorder: '#777064',
    controlBorderHigh: '#A9A29A',
    primary: '#57B894',
    primarySoft: '#1E3A31',
    primaryBorder: '#3B362E',
    onPrimary: '#0F2C23',
    income: '#6BC79E',
    expense: '#E0836B',
    warning: '#D9AE62',
    // Dark mode already clears AA as text (9.16, 6.79 and 9.06:1), so the
    // graphic pair is the same colour — the split exists for light mode.
    incomeGraphic: '#6BC79E',
    expenseGraphic: '#E0836B',
    warningGraphic: '#D9AE62',
    track: '#3B362E',
    expenseSoftBg: '#2A1D18',
    expenseSoftBorder: '#4A322A',
    /** @deprecated */
    gold: '#D9AE62',
    /** @deprecated */
    goldSoft: '#332A18',
  },
};

export type ThemeColor = keyof typeof Colors.light & keyof typeof Colors.dark;

/**
 * Bundled faces, loaded once in `_layout.tsx` behind the splash screen.
 *
 * React Native applies no synthetic weights on Android — a `fontWeight` on a
 * custom family is silently dropped — so every weight has to be its own
 * family name. Geist Mono carries every figure in the app.
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
/** `cubic-bezier(0.16, 1, 0.3, 1)` everywhere — no linear, no bounce. */
export const EASE = [0.16, 1, 0.3, 1] as const;

/** Durations in ms. Transform and opacity only. */
export const Motion = {
  rowPress: 220,
  sectionEnter: 320,
  sectionStagger: 40,
  sheet: 420,
  countUp: 900,
  pulse: 2800,
} as const;

export const ScreenPadding = 22;

export const BottomTabInset = Platform.select({ ios: 50, android: 80 }) ?? 0;
export const MaxContentWidth = 800;
