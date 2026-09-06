/**
 * Wafra: clear records, useful status, a readable daily agenda.
 * Forest and warm neutral surfaces carry the approved reference;
 * income, expense and warning colours retain their financial meaning.
 */

import '@/global.css';

import { Platform } from 'react-native';

// Approved reference palette; global theme selection stays consistent across tabs.
export const Colors = {
  light: {
    text: '#10211E', textSecondary: '#566761', textTertiary: '#62716C',
    background: '#FAFAF7', backgroundElement: '#FFFFFF', backgroundSelected: '#EBF0EC',
    card: '#FFFFFF', cardBorder: '#E4E9E3', cardBorderStrong: '#C0CCC4',
    controlBorder: '#71847A', controlBorderHigh: '#425F50',
    inverseSurface: '#072E28', inverseText: '#F6FBF7', scrim: 'rgba(1, 22, 18, 0.44)',
    primary: '#106B50', primarySoft: '#E7F2EA', primaryBorder: '#C5DECE', onPrimary: '#FFFFFF',
    income: '#14734F', expense: '#B6384D', warning: '#8B5E11',
    incomeGraphic: '#14734F', expenseGraphic: '#D34B5E', warningGraphic: '#B77921',
    track: '#E6ECE7', expenseSoftBg: '#FFF0EF', expenseSoftBorder: '#EDD1CD',
    gold: '#89662C', goldSoft: '#F2E9DA',
  },
  dark: {
    text: '#F5F8F5', textSecondary: '#B7CFC5', textTertiary: '#9FBFB2',
    background: '#032521', backgroundElement: '#133630', backgroundSelected: '#22463D',
    card: '#133630', cardBorder: '#2B4940', cardBorderStrong: '#456457',
    controlBorder: '#789A88', controlBorderHigh: '#B1D3BF',
    inverseSurface: '#F6F8F2', inverseText: '#082820', scrim: 'rgba(0, 15, 12, 0.60)',
    primary: '#86D6B2', primarySoft: '#183E31', primaryBorder: '#355C46', onPrimary: '#062B20',
    income: '#80DDB3', expense: '#FF9CA8', warning: '#E2BF78',
    incomeGraphic: '#80DDB3', expenseGraphic: '#FF9CA8', warningGraphic: '#E2BF78',
    track: '#2A473B', expenseSoftBg: '#3E282E', expenseSoftBorder: '#73434B',
    gold: '#D7C397', goldSoft: '#3C3625',
  },
};
export const DataViz = {
  light: { ramp: ['#106B50', '#3C8C6D', '#6DA68B', '#A1C5AF', '#CFDFD1'], neutral: '#E6ECE7', axis: '#62716C', expenseSoft: '#B3747A' },
  dark: { ramp: ['#86D6B2', '#66BDA0', '#4B9F82', '#337C62', '#225540'], neutral: '#2A473B', axis: '#9FBFB2', expenseSoft: '#C88791' },
} as const;

export type ThemeColor = keyof typeof Colors.light & keyof typeof Colors.dark;

/**
 * Bundled faces, loaded once in `_layout.tsx` behind the splash screen.
 *
 * React Native applies no synthetic weights on Android — a `fontWeight` on a
 * custom family is silently dropped — so every weight has to be its own
 * family name. Geist carries Latin reading and money; Plex carries Arabic; Mono is reserved for code/editing.
 */
export const Fonts = {
  sans: 'Geist-Regular',
  sansMedium: 'Geist-Medium',
  sansSemi: 'Geist-SemiBold',
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
