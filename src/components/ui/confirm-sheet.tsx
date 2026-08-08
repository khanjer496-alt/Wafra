import React from 'react';
import { StyleSheet, View } from 'react-native';

import { ThemedText } from '@/components/themed-text';
import { BottomSheet } from '@/components/ui/bottom-sheet';
import { Button } from '@/components/ui/controls';
import { Spacing } from '@/constants/theme';
import { useLanguage } from '@/hooks/use-language';
import { t } from '@/lib/i18n';

interface ConfirmSheetProps {
  visible: boolean;
  onClose: () => void;
  /**
   * The question, verbatim — the string that used to be the alert's title.
   * Drawn as the sheet's own heading rather than in the caps header, because
   * the header is uppercased and "MARK “DEWA” AS PAID?" is a shout.
   */
  question: string;
  /** The one line under it: what confirming actually does. */
  body?: string;
  /** Label on the committing button. Also names the sheet unless `title` says otherwise. */
  confirmLabel: string;
  /** Overrides the caps label in the sheet header. */
  title?: string;
  /** Overrides the way out. Defaults to the shared Cancel. */
  cancelLabel?: string;
  /** Tints the committing button as a loss: delete, remove, erase. */
  destructive?: boolean;
  onConfirm: () => void;
}

/**
 * Confirm or cancel, with a destructive variant. The other half of ChoiceSheet:
 * that one PICKS from a list, this one GATES one action.
 *
 * It exists for the same reason ChoiceSheet does, and the cost of not having it
 * was higher. On react-native-web `Alert.alert` is `static alert() {}` — an
 * empty method, no dialog, no warning, no throw — so every action whose only
 * path ran through an alert's button array was inert in the web export. For a
 * picker that meant a row that opened nothing; for a confirmation it meant
 * "Mark paid", "Pay", "Delete" and "Remove" doing nothing at all, silently,
 * with the store call sitting unreachable inside `onPress` of an alert button
 * that was never drawn. A dead confirm reads as a broken app, and the user's
 * next move is to tap it again.
 *
 * So the confirmation is drawn, not delegated. Cancel comes first and the
 * commit second, which is the platform order in both writing directions —
 * `flexDirection: 'row'` flips under RTL, so Cancel stays on the reading-first
 * side. Both are real `Button`s, so both carry the shared 48dp target, the
 * accessibility role and label, and the tap haptic.
 */
export function ConfirmSheet({
  visible,
  onClose,
  question,
  body,
  confirmLabel,
  title,
  cancelLabel,
  destructive,
  onConfirm,
}: ConfirmSheetProps) {
  const language = useLanguage();

  // Close first, then commit. The sheet is gone before the store dispatches, so
  // a caller that unmounts on its own action — the card sheet closes itself
  // after filing the payment — never animates a sheet out of a tree that has
  // already been thrown away.
  const commit = () => {
    onClose();
    onConfirm();
  };

  return (
    <BottomSheet visible={visible} onClose={onClose} title={title ?? confirmLabel}>
      <View style={styles.copy}>
        <ThemedText type="subtitle" accessibilityRole="header">
          {question}
        </ThemedText>
        {body && (
          <ThemedText type="small" themeColor="textSecondary">
            {body}
          </ThemedText>
        )}
      </View>
      <View style={styles.actions}>
        <Button
          inline
          variant="outline"
          label={cancelLabel ?? t('cancel', language)}
          onPress={onClose}
        />
        <Button
          inline
          variant={destructive ? 'danger' : 'filled'}
          label={confirmLabel}
          onPress={commit}
        />
      </View>
    </BottomSheet>
  );
}

const styles = StyleSheet.create({
  copy: {
    gap: Spacing.two,
  },
  actions: {
    flexDirection: 'row',
    gap: Spacing.two + 2,
  },
});
