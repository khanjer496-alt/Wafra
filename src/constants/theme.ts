/**
 * Wafra design tokens v3 — rebuilt from scratch.
 *
 * Principles: one brand hue (emerald) tints every neutral; three elevation
 * tiers (background → element → selected) with visible but quiet borders;
 * accent stays under ~10% of any surface; a strict 4pt spatial ladder.
 */

import '@/global.css';

import { Platform } from 'react-native';

export const Colors = {
  light: {
    text: '#101D17',
    background: '#F2F6F3',
    backgroundElement: '#FCFEFC',
    backgroundSelected: '#E4ECE7',
    textSecondary: '#57685F',
    card: '#FCFEFC',
    cardBorder: '#DDE6E0',
    primary: '#0C9E7C',
    primarySoft: '#D7F1E7',
    onPrimary: '#F3FCF8',
    gold: '#A5872B',
    goldSoft: '#F4EDD6',
    income: '#088A5E',
    expense: '#D63258',
    warning: '#BE7810',
    track: '#E1E9E3',
  },
  dark: {
    text: '#F0F7F3',
    background: '#070D0B',
    backgroundElement: '#101915',
    backgroundSelected: '#1A2620',
    textSecondary: '#93A79C',
    card: '#101915',
    cardBorder: '#22302A',
    primary: '#31DBAE',
    primarySoft: '#10352B',
    onPrimary: '#052019',
    gold: '#E8BC55',
    goldSoft: '#362D12',
    income: '#45DB94',
    expense: '#F76F81',
    warning: '#F4AC35',
    track: '#202C26',
  },
} as const;

export type ThemeColor = keyof typeof Colors.light & keyof typeof Colors.dark;

export const Fonts = Platform.select({
  ios: {
    /** iOS `UIFontDescriptorSystemDesignDefault` */
    sans: 'system-ui',
    /** iOS `UIFontDescriptorSystemDesignSerif` */
    serif: 'ui-serif',
    /** iOS `UIFontDescriptorSystemDesignRounded` */
    rounded: 'ui-rounded',
    /** iOS `UIFontDescriptorSystemDesignMonospaced` */
    mono: 'ui-monospace',
  },
  default: {
    sans: 'normal',
    serif: 'serif',
    rounded: 'normal',
    mono: 'monospace',
  },
  web: {
    sans: 'var(--font-display)',
    serif: 'var(--font-serif)',
    rounded: 'var(--font-rounded)',
    mono: 'var(--font-mono)',
  },
});

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

export const Radius = {
  sm: 12,
  md: 18,
  lg: 24,
  xl: 30,
  full: 999,
} as const;

export const BottomTabInset = Platform.select({ ios: 50, android: 80 }) ?? 0;
export const MaxContentWidth = 800;
