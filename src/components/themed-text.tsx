import { isValidElement, type ReactNode } from 'react';
import { StyleSheet, Text, type StyleProp, type TextProps, type TextStyle } from 'react-native';

import { Fonts, ThemeColor } from '@/constants/theme';
import { useLanguage } from '@/hooks/use-language';
import { useTheme } from '@/hooks/use-theme';
import { hasArabicScript } from '@/lib/i18n';

export type TextType =
  | 'default'
  | 'display'
  | 'amount'
  | 'sheetAmount'
  | 'title'
  | 'heading'
  | 'small'
  | 'smallBold'
  | 'meta'
  | 'micro'
  | 'nano'
  | 'subtitle'
  | 'link'
  | 'linkPrimary'
  | 'code';

export type ThemedTextProps = TextProps & {
  type?: TextType;
  themeColor?: ThemeColor;
  /**
   * Marks this as a money figure. Beyond tabular numerals it swaps the family
   * to Geist Mono at the same weight — the design rule is that the mono face
   * carries every figure in the app, and routing it through the prop that
   * already flags a figure means no call site has to be touched twice.
   */
  tabular?: boolean;
};

export function ThemedText({
  style,
  type = 'default',
  themeColor,
  tabular,
  ...rest
}: ThemedTextProps) {
  const theme = useTheme();
  const language = useLanguage();
  const color = themeColor ?? (type === 'linkPrimary' ? 'primary' : 'text');
  const arabic = language === 'ar' && !tabular;

  return (
    <Text
      allowFontScaling
      maxFontSizeMultiplier={rest.maxFontSizeMultiplier ?? MAX_SCALE[type]}
      style={[
        { color: theme[color] },
        styles[type],
        arabic && {
          fontFamily: ARABIC_FOR_WEIGHT[WEIGHT_OF[type]],
          // Tracking breaks cursive joins; uppercase has no meaning in Arabic.
          letterSpacing: 0,
          textTransform: 'none',
          writingDirection: 'rtl',
        },
        tabular && styles.tabular,
        tabular && { fontFamily: MONO_FOR_WEIGHT[WEIGHT_OF[type]] },
        style,
        // LAST, because the caller's `style` is the thing it is answering.
        language === 'ar' && arabicRescue(style, rest.children, type),
      ]}
      {...rest}
    />
  );
}

/**
 * The Arabic face put back over a call site that pinned a Latin one.
 *
 * `style` is applied after everything above it, which is the right rule for
 * colour and size and a silent disaster for the family: the bundled Geist cuts
 * have NO Arabic coverage — every codepoint in the block maps to .notdef — so
 * `style={{ fontFamily: Fonts.sansSemi }}` on a translated string does not
 * merely look off-house, it draws empty boxes. Onboarding and the storage
 * recovery screen both do this, in their own StyleSheets, which means the FIRST
 * screen an Arabic phone ever shows was unreadable.
 *
 * Reapplying the Arabic face unconditionally would be the wrong cure: the
 * wordmark ("Wafra", pinned to Geist SemiBold) and the currency prefix (pinned
 * to Geist Mono beside a figure) are Latin text that should stay in a Latin
 * face even on an Arabic phone. So the question this asks is not "is the app in
 * Arabic" but "is THIS string Arabic in a font that cannot draw it".
 *
 * The negative tracking goes with it. Geist's display sizes carry up to -1.4px
 * of letter-spacing; Arabic is cursive, and tracking pulls the joins apart.
 */
function arabicRescue(
  style: StyleProp<TextStyle>,
  children: ReactNode,
  type: TextType,
): TextStyle | false {
  const pinned = StyleSheet.flatten(style) as TextStyle | undefined;
  if (!pinned) return false;
  const family = typeof pinned.fontFamily === 'string' ? pinned.fontFamily : undefined;
  const latinFace = family !== undefined && family.startsWith('Geist');
  const tracked = typeof pinned.letterSpacing === 'number' && pinned.letterSpacing !== 0;
  if (!latinFace && !tracked) return false;
  if (!holdsArabic(children)) return false;
  const fix: TextStyle = { letterSpacing: 0 };
  if (latinFace) fix.fontFamily = ARABIC_FOR_FACE[family] ?? ARABIC_FOR_WEIGHT[WEIGHT_OF[type]];
  return fix;
}

/** Is any of this node's own text Arabic? */
function holdsArabic(node: ReactNode): boolean {
  if (typeof node === 'string') return hasArabicScript(node);
  if (Array.isArray(node)) return node.some(holdsArabic);
  if (isValidElement(node)) {
    return holdsArabic((node.props as { children?: ReactNode }).children);
  }
  return false;
}

/**
 * Which weight tier each type sits at, so `tabular` can pick the matching mono
 * cut. Android silently ignores `fontWeight` on a bundled family, so weight is
 * only ever expressed as a family name.
 */
const WEIGHT_OF: Record<TextType, 'regular' | 'medium' | 'semi'> = {
  default: 'regular',
  display: 'semi',
  amount: 'semi',
  sheetAmount: 'semi',
  title: 'semi',
  heading: 'semi',
  small: 'medium',
  smallBold: 'semi',
  meta: 'regular',
  micro: 'medium',
  nano: 'medium',
  subtitle: 'semi',
  link: 'medium',
  linkPrimary: 'medium',
  code: 'regular',
};

const MONO_FOR_WEIGHT = {
  regular: Fonts.mono,
  medium: Fonts.monoMedium,
  semi: Fonts.monoSemi,
} as const;

const ARABIC_FOR_WEIGHT = {
  regular: Fonts.arabic,
  medium: Fonts.arabic,
  semi: Fonts.arabicBold,
} as const;

/**
 * The Arabic cut that stands in for a pinned Latin one, weight for weight, so
 * a rescued heading is still heavier than the sentence under it.
 */
const ARABIC_FOR_FACE: Record<string, string> = {
  [Fonts.sans]: Fonts.arabic,
  [Fonts.sansMedium]: Fonts.arabic,
  [Fonts.sansSemi]: Fonts.arabicBold,
  [Fonts.mono]: Fonts.arabic,
  [Fonts.monoMedium]: Fonts.arabic,
  [Fonts.monoSemi]: Fonts.arabicBold,
};

/**
 * Dynamic Type stays on everywhere. Large money figures and dense utility
 * labels get a generous cap so they remain a single, legible unit rather than
 * clipping the ledger; body and row copy can grow to the platform's full
 * accessibility sizes.
 */
const MAX_SCALE: Record<TextType, number | undefined> = {
  display: 1.5,
  amount: 1.5,
  sheetAmount: 1.5,
  title: 2,
  heading: 2,
  subtitle: 2,
  default: undefined,
  small: undefined,
  smallBold: undefined,
  meta: 2,
  micro: 1.7,
  nano: 1.7,
  link: undefined,
  linkPrimary: undefined,
  code: 2,
};

// Tracking is given in ems by the design; at these sizes that lands on the
// pixel values below.
const styles = StyleSheet.create<Record<TextType | 'tabular', TextStyle>>({
  /** Hero amount — the one figure a screen exists to show. */
  display: {
    fontFamily: Fonts.monoSemi,
    fontSize: 46,
    lineHeight: 46,
    letterSpacing: -1.4,
  },
  /** Screen amount: Wallet net worth, a card's outstanding. */
  amount: {
    fontFamily: Fonts.monoSemi,
    fontSize: 40,
    lineHeight: 40,
    letterSpacing: -1.2,
  },
  /** The figure inside a bottom sheet. */
  sheetAmount: {
    fontFamily: Fonts.monoSemi,
    fontSize: 34,
    lineHeight: 38,
    letterSpacing: -0.7,
  },
  /** Screen title. */
  title: {
    fontFamily: Fonts.sansSemi,
    fontSize: 27,
    lineHeight: 27,
    letterSpacing: -0.86,
  },
  /** Sheet title, and any heading that sits above a divided list. */
  subtitle: {
    fontFamily: Fonts.sansSemi,
    fontSize: 18,
    lineHeight: 22,
    letterSpacing: -0.36,
  },
  heading: {
    fontFamily: Fonts.sansSemi,
    fontSize: 20,
    lineHeight: 26,
    letterSpacing: -0.4,
  },
  /** Body copy. */
  default: {
    fontFamily: Fonts.sans,
    fontSize: 14,
    lineHeight: 21,
  },
  /** Row title. */
  small: {
    fontFamily: Fonts.sansMedium,
    fontSize: 14.5,
    lineHeight: 19,
  },
  /** Row title that carries weight, and — with `tabular` — the row figure. */
  smallBold: {
    fontFamily: Fonts.sansSemi,
    fontSize: 14.5,
    lineHeight: 19,
  },
  /** The second line of a row: category, account, date. */
  meta: {
    fontFamily: Fonts.sans,
    fontSize: 12,
    lineHeight: 17,
  },
  /** Caps section label. */
  micro: {
    fontFamily: Fonts.sansMedium,
    fontSize: 11.5,
    lineHeight: 15,
    letterSpacing: 0.72,
    textTransform: 'uppercase',
  },
  /** The smallest caps label — chart axes, tab labels, urgency tags. */
  nano: {
    fontFamily: Fonts.sansMedium,
    fontSize: 11,
    lineHeight: 14,
    letterSpacing: 0.55,
    textTransform: 'uppercase',
  },
  link: {
    fontFamily: Fonts.sansMedium,
    fontSize: 14,
    lineHeight: 21,
  },
  linkPrimary: {
    fontFamily: Fonts.sansMedium,
    fontSize: 14,
    lineHeight: 21,
  },
  code: {
    fontFamily: Fonts.mono,
    fontSize: 12,
    lineHeight: 18,
  },
  tabular: {
    fontVariant: ['tabular-nums'],
  },
});
