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
  light: { ramp: ['#1F6B52', '#488269', '#779E89', '#A7BFAC', '#C8D8C9'], neutral: '#E3DED2', axis: '#6B6559', expenseSoft: '#B4503C' },
  dark: { ramp: ['#57B894', '#479A7B', '#377D63', '#29634D', '#1E4839'], neutral: '#3B362E', axis: '#9B948A', expenseSoft: '#E0836B' },
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
