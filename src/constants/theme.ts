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
    primary: '#1F6B52', // the only accent
    primarySoft: '#E4EDE8',
    primaryBorder: '#C3D8CD',
    onPrimary: '#F7FBF8',
    income: '#2E8A63',
    expense: '#B4503C', // clay red, not pink
    warning: '#A07B2A',
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
    textTertiary: '#8C857A', // 5.12:1 on bg
    background: '#14120F', // warm charcoal. never #070D0B
    backgroundElement: '#1C1A16',
    backgroundSelected: '#232019',
    card: '#1C1A16',
    cardBorder: '#302C25',
    cardBorderStrong: '#3A352E',
    primary: '#57B894',
    primarySoft: '#1E3A31',
    primaryBorder: '#302C25',
    onPrimary: '#0F2C23',
    income: '#6BC79E',
    expense: '#E0836B',
    warning: '#D9AE62',
    track: '#302C25',
    expenseSoftBg: '#2A1D18',
    expenseSoftBorder: '#4A322A',
    /** @deprecated */
    gold: '#D9AE62',
    /** @deprecated */
    goldSoft: '#332A18',
  },
} as const;

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
export const ScreenPadding = 22;

export const BottomTabInset = Platform.select({ ios: 50, android: 80 }) ?? 0;
export const MaxContentWidth = 800;
