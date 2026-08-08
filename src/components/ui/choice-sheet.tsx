import React from 'react';
import { Pressable, StyleSheet, View } from 'react-native';

import { ThemedText } from '@/components/themed-text';
import { BottomSheet } from '@/components/ui/bottom-sheet';
import { Icon } from '@/components/ui/icon';
import { Spacing } from '@/constants/theme';
import { tapped } from '@/lib/haptics';
import { useTheme } from '@/hooks/use-theme';

export interface Choice<T extends string> {
  value: T;
  label: string;
  /** One line under the label — what picking this actually changes. */
  detail?: string;
  /**
   * Offered, visibly, but not selectable — with `detail` carrying the reason.
   *
   * Not the same as omitting the option, and the difference matters: a user
   * looking for Saudi Arabia in a list that does not contain it concludes the
   * app cannot do it. Shown and greyed with "your ledger is recorded in AED"
   * underneath, they learn what the constraint actually is. The alternative
   * that was considered and rejected is letting the tap through and reporting
   * the refusal afterwards, which spends a tap to say what the row could have
   * said on sight.
   */
  disabled?: boolean;
}

interface ChoiceSheetProps<T extends string> {
  visible: boolean;
  onClose: () => void;
  title: string;
  /**
   * The question, in sentence case, above the list.
   *
   * `title` goes in the sheet's caps header, which is right for a NOUN — the
   * thing being chosen ("Country", "Language"). It is wrong for a sentence:
   * an alert's title moved verbatim into it came out as "REMEMBER FOR
   * CARREFOUR?", which is a shout, and the copy is not the part that was
   * broken. ConfirmSheet has carried this slot since it was written; this is
   * the same slot, so a question reads the same whichever sheet answers it.
   */
  question?: string;
  /** Optional lede under it, for a choice with consequences. */
  body?: string;
  options: Choice<T>[];
  /**
   * The option that is currently on, ticked and not re-applied when picked.
   * Omitted where the sheet picks an ACTION rather than a setting — an export
   * scope has no "current", and ticking one would claim it did.
   */
  value?: T;
  onSelect: (value: T) => void;
}

/**
 * Pick one of a short list. The control behind Country and Language.
 *
 * It exists because `Alert.alert` could not be it, for two reasons that only
 * showed up on the two platforms nobody develops on:
 *
 *  • On react-native-web `Alert.alert` is `static alert() {}` — an empty
 *    method. Not a fallback, not a console warning: nothing happens and no
 *    error is raised. Every alert-driven chooser was therefore inert in the
 *    web export, which is also the build the end-to-end suite drives, so
 *    "tap Language" silently did nothing and the language never changed.
 *  • On Android an alert draws at most THREE buttons. Two packs plus Cancel
 *    was already the ceiling; a third country would have been accepted by the
 *    type checker and dropped by the platform at runtime.
 *
 * So the list is drawn, not delegated: it works everywhere, it can hold more
 * than three options, it can afford a sub-line per option, and — unlike an
 * alert's flat button stack — it can show which one is currently on.
 */
export function ChoiceSheet<T extends string>({
  visible,
  onClose,
  title,
  question,
  body,
  options,
  value,
  onSelect,
}: ChoiceSheetProps<T>) {
  const theme = useTheme();

  const pick = (next: T) => {
    tapped();
    onClose();
    // Selecting the option that is already on is a no-op, not a re-apply:
    // Language re-applies I18nManager and Country rebuilds the parser
    // registry, and neither should happen because someone confirmed the
    // status quo.
    if (next !== value) onSelect(next);
  };

  return (
    <BottomSheet visible={visible} onClose={onClose} title={title}>
      {question && (
        <ThemedText type="subtitle" accessibilityRole="header">
          {question}
        </ThemedText>
      )}
      {body && (
        <ThemedText type="small" themeColor="textSecondary">
          {body}
        </ThemedText>
      )}
      <View>
        {options.map((option, i) => {
          const active = option.value === value;
          const off = option.disabled === true;
          return (
            <Pressable
              key={option.value}
              accessibilityRole="button"
              accessibilityState={{ selected: active, disabled: off }}
              accessibilityLabel={option.label}
              // No handler at all rather than a guarded one: a Pressable with
              // an onPress still reports itself as pressable to a screen
              // reader and still animates under the thumb, which is the same
              // lie the silent no-op told.
              onPress={off ? undefined : () => pick(option.value)}
              style={({ pressed }) => [
                styles.option,
                i > 0 && {
                  borderTopWidth: StyleSheet.hairlineWidth,
                  borderTopColor: theme.cardBorder,
                },
                pressed && !off && { transform: [{ scale: 0.985 }] },
              ]}>
              <View style={styles.text}>
                <ThemedText type="small" style={off ? styles.labelOff : undefined}>
                  {option.label}
                </ThemedText>
                {option.detail && (
                  <ThemedText type="meta" themeColor="textTertiary">
                    {option.detail}
                  </ThemedText>
                )}
              </View>
              {/*
                The tick is rendered at zero opacity rather than omitted, so
                every label starts at the same x and the list does not jump
                sideways when the selection moves.
              */}
              <View style={{ opacity: active ? 1 : 0 }}>
                <Icon name="check" size={16} color={theme.primary} />
              </View>
            </Pressable>
          );
        })}
      </View>
    </BottomSheet>
  );
}

const styles = StyleSheet.create({
  option: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: Spacing.two,
    minHeight: 52,
    paddingVertical: Spacing.two,
  },
  text: {
    flex: 1,
    gap: Spacing.half,
  },
  // The label dims; the line under it does not. That line is the whole point
  // of showing a disabled option, and dimming it along with the label is how
  // a greyed row ends up unable to say why it is greyed.
  labelOff: {
    opacity: 0.5,
  },
});
