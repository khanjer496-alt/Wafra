import React from 'react';
import {
  Platform,
  StyleSheet,
  TextInput,
  type TextInputProps,
  View,
} from 'react-native';

import { ThemedText } from '@/components/themed-text';
import { Fonts, Radius, Spacing } from '@/constants/theme';
import { useLanguage } from '@/hooks/use-language';
import { useTheme } from '@/hooks/use-theme';

type TextFieldEntryMode =
  | { numeric: true; keyboardType?: never; inputMode?: never }
  | {
      numeric?: false;
      keyboardType?: TextInputProps['keyboardType'];
      inputMode?: TextInputProps['inputMode'];
    };

export type TextFieldProps = Omit<
  TextInputProps,
  'value' | 'onChangeText' | 'keyboardType' | 'inputMode'
> &
  TextFieldEntryMode & {
    label: string;
    value: string;
    onChangeText: (value: string) => void;
    helperText?: string;
    errorText?: string;
    invalid?: boolean;
    leading?: React.ReactNode;
    trailing?: React.ReactNode;
  };

type WebAriaProps = {
  'aria-labelledby': string;
  'aria-describedby'?: string;
  'aria-invalid': boolean;
};

export const TextField = React.forwardRef<TextInput, TextFieldProps>((props, ref) => {
  const theme = useTheme();
  const [focused, setFocused] = React.useState(false);
  const language = useLanguage();
  const stableId = React.useId().replace(/:/g, '');
  const labelId = `text-field-${stableId}-label`;
  const descriptionId = `text-field-${stableId}-description`;
  const {
    label,
    value,
    onChangeText,
    helperText,
    errorText,
    invalid = false,
    leading,
    trailing,
    numeric = false,
    keyboardType,
    inputMode,
    accessibilityHint,
    accessibilityLabel = label,
    accessibilityLabelledBy,
    'aria-labelledby': ariaLabelledBy,
    placeholderTextColor = theme.textTertiary,
    selectionColor = theme.primary,
    style,
    onFocus,
    onBlur,
    ...inputProps
  } = props;

  const hasError = invalid || !!errorText;
  const activeDescription = errorText ?? helperText;
  const resolvedLabelledBy = accessibilityLabelledBy ?? labelId;
  const resolvedWebLabelledBy = ariaLabelledBy ?? (
    typeof resolvedLabelledBy === 'string'
      ? resolvedLabelledBy
      : resolvedLabelledBy.join(' ')
  );
  const resolvedHint = [accessibilityHint, activeDescription].filter(Boolean).join(' ') || undefined;
  const webAriaProps: WebAriaProps = {
    'aria-labelledby': resolvedWebLabelledBy,
    'aria-describedby': activeDescription ? descriptionId : undefined,
    'aria-invalid': hasError,
  };

  return (
    <View style={styles.field}>
      <ThemedText type="meta" nativeID={labelId}>
        {label}
      </ThemedText>
      <View
        style={[
          styles.inputFrame,
          {
            backgroundColor: focused ? theme.backgroundSelected : theme.backgroundElement,
            borderColor: hasError ? theme.expense : theme.controlBorder,
          },
        ]}>
        {leading}
        <TextInput
          {...inputProps}
          {...(Platform.OS === 'web' ? webAriaProps : {})}
          ref={ref}
          value={value}
          onChangeText={onChangeText}
          onFocus={(event) => { setFocused(true); onFocus?.(event); }}
          onBlur={(event) => { setFocused(false); onBlur?.(event); }}
          keyboardType={numeric ? 'decimal-pad' : keyboardType}
          inputMode={numeric ? undefined : inputMode}
          accessibilityLabel={accessibilityLabel}
          accessibilityLabelledBy={resolvedLabelledBy}
          accessibilityHint={resolvedHint}
          placeholderTextColor={placeholderTextColor}
          selectionColor={selectionColor}
          style={[
            styles.input,
            {
              color: theme.text,
              fontFamily: language === 'ar' ? Fonts.arabic : Fonts.sans,
              textAlign: language === 'ar' ? 'right' : 'left',
            },
            numeric && styles.numeric,
            style,
          ]}
        />
        {trailing}
      </View>
      {errorText ? (
        <ThemedText
          type="meta"
          themeColor="expense"
          nativeID={descriptionId}
          accessibilityLiveRegion="polite"
          selectable>
          {errorText}
        </ThemedText>
      ) : helperText ? (
        <ThemedText
          type="meta"
          themeColor="textTertiary"
          nativeID={descriptionId}
          selectable>
          {helperText}
        </ThemedText>
      ) : null}
    </View>
  );
});

TextField.displayName = 'TextField';

const styles = StyleSheet.create({
  field: { gap: Spacing.one },
  inputFrame: {
    minHeight: 52,
    flexDirection: 'row',
    alignItems: 'center',
    gap: Spacing.two,
    borderWidth: 1,
    borderRadius: Radius.control,
    paddingHorizontal: Spacing.three,
  },
  input: {
    flex: 1,
    minWidth: 0,
    paddingVertical: Spacing.two,
    fontSize: 17,
  },
  numeric: {
    // Stable-width digits without making finance fields look like source code.
    fontVariant: ['tabular-nums'],
  },
});
