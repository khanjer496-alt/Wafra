/**
 * Wafra: clear records, useful status, a readable daily agenda.
 * Cool neutral surfaces carry the content. Blue identifies actions and selection;
 * income, expense and warning colours retain their financial meaning.
 */

import '@/global.css';

import { Platform } from 'react-native';

export const Colors = {
  light: {
    text: '#152033',
    textSecondary: '#4C5A70',
    textTertiary: '#5D6B81',
    background: '#F6F8FC',
    backgroundElement: '#FFFFFF',
    backgroundSelected: '#E9EDF5',
    card: '#FFFFFF',
    cardBorder: '#DCE3EE',
    cardBorderStrong: '#BDC9DA',
    controlBorder: '#73839C',
    controlBorderHigh: '#485D7A',
    inverseSurface: '#152033',
    inverseText: '#F3F6FC',
    scrim: 'rgba(15, 21, 32, 0.42)',
    primary: '#2855D9',
    primarySoft: '#E8EEFF',
    primaryBorder: '#BDCFF9',
    onPrimary: '#FFFFFF',
    income: '#16724C',
    expense: '#B83D4A',
    warning: '#865C05',
    incomeGraphic: '#16724C',
    expenseGraphic: '#B83D4A',
    warningGraphic: '#865C05',
    track: '#DCE3EE',
    expenseSoftBg: '#FFF0F2',
    expenseSoftBorder: '#EABFC7',
    gold: '#865C05',
    goldSoft: '#FFF3D4',
  },
  dark: {
    text: '#F3F6FC',
    textSecondary: '#BAC5D7',
    textTertiary: '#9BAAC1',
    background: '#0F1520',
    backgroundElement: '#172130',
    backgroundSelected: '#222F44',
    card: '#172130',
    cardBorder: '#334159',
    cardBorderStrong: '#4B5E7A',
    controlBorder: '#7186A8',
    controlBorderHigh: '#AABAD2',
    inverseSurface: '#F3F6FC',
    inverseText: '#152033',
    scrim: 'rgba(0, 0, 0, 0.54)',
    primary: '#9DBAFF',
    primarySoft: '#1C3158',
    primaryBorder: '#3D5475',
    onPrimary: '#102044',
    income: '#77D8AE',
    expense: '#FF9DA7',
    warning: '#F1C66F',
    incomeGraphic: '#77D8AE',
    expenseGraphic: '#FF9DA7',
    warningGraphic: '#F1C66F',
    track: '#334159',
    expenseSoftBg: '#3C222D',
    expenseSoftBorder: '#6D3C49',
    gold: '#F1C66F',
    goldSoft: '#392F1B',
  },
};

export const DataViz = {
  light: {
    ramp: ['#2855D9', '#5377D8', '#809AE4', '#A8B9EC', '#CDDAF7'],
    neutral: '#DCE3EE',
    axis: '#5D6B81',
    expenseSoft: '#987082',
  },
  dark: {
    ramp: ['#9DBAFF', '#779BFA', '#527BE1', '#385CAC', '#283F74'],
    neutral: '#334159',
    axis: '#9BAAC1',
    expenseSoft: '#AC7382',
  },
} as const;

export type ThemeColor = keyof typeof Colors.light & keyof typeof Colors.dark;

/**
 * Bundled faces, loaded once in `_layout.tsx` behind the splash screen.
 *
 * React Native applies no synthetic weights on Android — a `fontWeight` on a
 * custom family is silently dropped — so every weight has to be its own
 * family name. Plex carries reading and money; Mono is reserved for code/editing.
 */
export const Fonts = {
  sans: 'IBMPlexSans',
  sansMedium: 'IBMPlexSans-Medm',
  sansSemi: 'IBMPlexSans-SmBld',
  mono: 'GeistMono-Regular',
  monoMedium: 'GeistMono-Medium',
  monoSemi: 'GeistMono-SemiBold',
  arabic: 'IBMPlexSansArabic',
  arabicBold: 'IBMPlexSansArabic-SmBld',
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
