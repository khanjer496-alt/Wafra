import React from 'react';
import { Pressable, StyleSheet, View } from 'react-native';

import { ThemedText } from '@/components/themed-text';
import { Icon } from '@/components/ui/icon';
import { Radius, Spacing } from '@/constants/theme';
import { useTheme } from '@/hooks/use-theme';
import { tapped } from '@/lib/haptics';
import { t, type StringKey } from '@/lib/i18n';
import type { IosMessageSetupStatus } from '@/lib/ios-message-onboarding';

export interface ChecklistRowProps {
  title: string;
  detail?: string;
  status: IosMessageSetupStatus;
  /** Overrides the generic status word, e.g. "Skipped" for an explicit deferral. */
  statusLabel?: string;
  expanded: boolean;
  onPress(): void;
  children?: React.ReactNode;
}

const STATUS_KEYS: Record<IosMessageSetupStatus, StringKey> = {
  'not-started': 'iosMessageStatusNotStarted',
  'in-progress': 'iosMessageStatusInProgress',
  complete: 'iosMessageStatusComplete',
  skipped: 'iosMessageStatusSkipped',
};

export const ChecklistRow = ({
  title,
  detail,
  status,
  statusLabel,
  expanded,
  onPress,
  children,
}: ChecklistRowProps) => {
  const theme = useTheme();
  const complete = status === 'complete';
  const skipped = status === 'skipped';
  const statusKey = STATUS_KEYS[status];
  const statusText = statusLabel ?? t(statusKey);

  return (
    <View
      style={[
        styles.card,
        {
          backgroundColor: theme.card,
          borderColor: expanded ? theme.primaryBorder : theme.cardBorder,
        },
      ]}>
      <Pressable
        accessibilityRole="button"
        // Status is read once, as the value; repeating it in the label made
        // VoiceOver announce it twice.
        accessibilityLabel={[title, detail].filter(Boolean).join('. ')}
        accessibilityState={{ expanded }}
        accessibilityValue={{ text: statusText }}
        onPress={() => {
          tapped();
          onPress();
        }}
        style={({ pressed }) => [
          styles.header,
          { opacity: pressed ? 0.72 : 1 },
        ]}>
        <View
          style={[
            styles.status,
            {
              backgroundColor: complete
                ? theme.primary
                : skipped
                  ? theme.backgroundSelected
                  : theme.primarySoft,
            },
          ]}>
          {complete ? (
            <Icon name="check" size={15} color={theme.onPrimary} />
          ) : (
            // No number: the rows are independent (history is optional) and
            // the guide inside already numbers the Apple steps.
            <View style={[styles.dot, { backgroundColor: skipped ? theme.textSecondary : theme.primary }]} />
          )}
        </View>
        <View style={styles.copy}>
          <ThemedText type="smallBold">
            {title}
          </ThemedText>
          {detail && (
            <ThemedText type="meta" themeColor="textSecondary">{detail}</ThemedText>
          )}
        </View>
        <Icon
          name={expanded ? 'chevron-down' : 'chevron-right'}
          size={16}
          color={theme.textTertiary}
        />
      </Pressable>
      {expanded && children ? (
        <View
          style={[
            styles.actions,
          ]}>
          {children}
        </View>
      ) : null}
    </View>
  );
};

const styles = StyleSheet.create({
  card: {
    borderWidth: 1,
    borderRadius: 20,
    borderCurve: 'continuous',
    overflow: 'hidden',
  },
  header: {
    minHeight: 68,
    flexDirection: 'row',
    alignItems: 'center',
    gap: Spacing.three,
    paddingHorizontal: Spacing.three,
    paddingVertical: Spacing.three,
  },
  status: {
    width: 32,
    height: 32,
    borderRadius: Radius.full,
    alignItems: 'center',
    justifyContent: 'center',
  },
  dot: {
    width: 8,
    height: 8,
    borderRadius: Radius.full,
  },
  copy: {
    flex: 1,
    flexShrink: 1,
    gap: 2,
  },
  actions: {
    gap: Spacing.two,
    paddingStart: Spacing.three,
    paddingEnd: Spacing.three,
    paddingBottom: Spacing.three,
  },
});
