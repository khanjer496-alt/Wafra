import React from 'react';
import { Text } from 'react-native';

import { ThemedText } from '@/components/themed-text';
import { Fonts } from '@/constants/theme';
import { useTheme } from '@/hooks/use-theme';

// Currency amounts, bare figures, and percentages — everything the eye should
// be able to pick out of a sentence without reading it.
const FIGURE = /((?:[A-Z]{3}\s)?\d[\d,]*(?:\.\d+)?%?)/g;
// The same pattern without /g: a global regex carries lastIndex between
// calls, so testing with it would match every other fragment.
const IS_FIGURE = /^(?:[A-Z]{3}\s)?\d[\d,]*(?:\.\d+)?%?$/;

/**
 * A written insight with its figures set in mono, so the numbers stay
 * scannable inside a sentence instead of dissolving into the prose.
 */
export function RichSentence({
  text,
  color,
  size = 14,
}: {
  text: string;
  color?: string;
  size?: number;
}) {
  const theme = useTheme();
  const parts = text.split(FIGURE).filter((p) => p !== '');

  return (
    <ThemedText type="default" style={[{ fontSize: size, lineHeight: size * 1.5 }, color ? { color } : null]}>
      {parts.map((part, i) =>
        IS_FIGURE.test(part) ? (
          <Text
            key={i}
            style={{
              fontFamily: Fonts.monoMedium,
              fontVariant: ['tabular-nums'],
              color: color ?? theme.text,
            }}>
            {part}
          </Text>
        ) : (
          part
        ),
      )}
    </ThemedText>
  );
}
