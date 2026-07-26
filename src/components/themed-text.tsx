import { Platform, StyleSheet, Text, type TextProps } from 'react-native';

import { Fonts, ThemeColor } from '@/constants/theme';
import { useTheme } from '@/hooks/use-theme';

export type ThemedTextProps = TextProps & {
  type?:
    | 'default'
    | 'display'
    | 'title'
    | 'heading'
    | 'small'
    | 'smallBold'
    | 'micro'
    | 'subtitle'
    | 'link'
    | 'linkPrimary'
    | 'code';
  themeColor?: ThemeColor;
  /** Tabular numerals so amounts align in columns. Use on every money figure. */
  tabular?: boolean;
};

export function ThemedText({ style, type = 'default', themeColor, tabular, ...rest }: ThemedTextProps) {
  const theme = useTheme();

  return (
    <Text
      style={[
        { color: theme[themeColor ?? 'text'] },
        type === 'default' && styles.default,
        type === 'display' && styles.display,
        type === 'title' && styles.title,
        type === 'heading' && styles.heading,
        type === 'small' && styles.small,
        type === 'smallBold' && styles.smallBold,
        type === 'micro' && styles.micro,
        type === 'subtitle' && styles.subtitle,
        type === 'link' && styles.link,
        type === 'linkPrimary' && styles.linkPrimary,
        type === 'code' && styles.code,
        tabular && styles.tabular,
        style,
      ]}
      {...rest}
    />
  );
}

// Scale ratio ≥1.25 between steps: 11 → 13 → 15 → 19 → 24 → 30 → 44
const styles = StyleSheet.create({
  micro: {
    fontSize: 11,
    lineHeight: 15,
    fontWeight: 600,
    letterSpacing: 0.6,
    textTransform: 'uppercase',
  },
  small: {
    fontSize: 13,
    lineHeight: 19,
    fontWeight: 500,
  },
  smallBold: {
    fontSize: 13,
    lineHeight: 19,
    fontWeight: 700,
  },
  default: {
    fontSize: 15,
    lineHeight: 22,
    fontWeight: 500,
  },
  heading: {
    fontSize: 19,
    lineHeight: 25,
    fontWeight: 700,
  },
  subtitle: {
    fontSize: 24,
    lineHeight: 30,
    fontWeight: 700,
  },
  title: {
    fontSize: 30,
    lineHeight: 37,
    fontWeight: 800,
  },
  display: {
    fontSize: 44,
    lineHeight: 52,
    fontWeight: 800,
    letterSpacing: -1,
  },
  link: {
    lineHeight: 30,
    fontSize: 14,
  },
  linkPrimary: {
    lineHeight: 30,
    fontSize: 14,
    color: '#3c87f7',
  },
  code: {
    fontFamily: Fonts.mono,
    fontWeight: Platform.select({ android: 700 }) ?? 500,
    fontSize: 12,
  },
  tabular: {
    fontVariant: ['tabular-nums'],
  },
});
