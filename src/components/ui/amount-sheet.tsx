import React, { useEffect, useRef, useState } from 'react';
import type { TextInput } from 'react-native';

import { ThemedText } from '@/components/themed-text';
import { BottomSheet } from '@/components/ui/bottom-sheet';
import { Button } from '@/components/ui/controls';
import { TextField } from '@/components/ui/text-field';
import { useLanguage } from '@/hooks/use-language';
import { parseAmountToFils } from '@/lib/format';
import { t } from '@/lib/i18n';

interface AmountSheetProps {
  visible: boolean;
  onClose: () => void;
  /** Caps header — the thing being added to. */
  title: string;
  /** The question in sentence case, as ConfirmSheet and ChoiceSheet draw it. */
  question?: string;
  /** What the number means. Shown as the field's placeholder. */
  placeholder: string;
  confirmLabel?: string;
  /** Called with a positive fils amount. Never called with 0 or NaN. */
  onSubmit: (fils: number) => void;
}

/**
 * Ask for one amount.
 *
 * The third sheet, and the one that replaced the worst control in the app.
 * Adding to a savings goal was written as `Alert.prompt?.(…) ?? (+100)`, which
 * behaves differently on all three platforms and correctly on one:
 *
 *  • iOS drew the prompt, which is where the design came from.
 *  • Web returned early — `if (Platform.OS === 'web') return;` — so the tap
 *    did nothing at all.
 *  • Android has no `Alert.prompt`. The optional call therefore evaluated to
 *    `undefined`, the `??` fallback fired, and tapping a goal row SILENTLY
 *    ADDED AED 100 to it. No dialog, no confirmation, no undo, and no way to
 *    say any other number. A comment called this a "quick +100 with
 *    long-press hint"; the hint was a delete confirmation, and nothing on
 *    screen said a tap would move money.
 *
 * That is the same defect family as the alert sweep — a control whose real
 * work is unreachable on a platform nobody develops on — except this one did
 * not go quiet, it guessed. A dead button is bad; a button that writes a
 * number the user never typed is worse, because the ledger now disagrees with
 * them and nothing points at why.
 */
export function AmountSheet({
  visible,
  onClose,
  title,
  question,
  placeholder,
  confirmLabel,
  onSubmit,
}: AmountSheetProps) {
  const language = useLanguage();
  const inputRef = useRef<TextInput>(null);
  const [text, setText] = useState('');

  // Cleared on open, not on close: a sheet that unmounts mid-animation would
  // otherwise blank its own field while it is still on screen.
  useEffect(() => {
    if (visible) setText('');
  }, [visible]);

  const fils = parseAmountToFils(text);
  const valid = fils !== null && fils > 0;

  const submit = () => {
    if (!valid) return;
    onClose();
    onSubmit(fils);
  };

  return (
    <BottomSheet visible={visible} onClose={onClose} title={title}>
      {question && (
        <ThemedText type="subtitle" accessibilityRole="header">
          {question}
        </ThemedText>
      )}
      <TextField
        ref={inputRef}
        label={placeholder}
        value={text}
        onChangeText={setText}
        numeric
        autoFocus
        onSubmitEditing={submit}
        returnKeyType="done"
      />
      {/*
        Disabled rather than accepting and discarding. The control this
        replaced had no failure state at all — an unparseable amount fell
        through `if (fils && goal)` and the sheet closed as though it had
        worked.
      */}
      <Button label={confirmLabel ?? t('save', language)} disabled={!valid} onPress={submit} />
    </BottomSheet>
  );
}
