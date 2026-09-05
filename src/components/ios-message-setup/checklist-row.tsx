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
  step: number;
  status: IosMessageSetupStatus;
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
  step,
  status,
  expanded,
  onPress,
  children,
}: ChecklistRowProps) => {
  const theme = useTheme();
  const complete = status === 'complete';
  const skipped = status === 'skipped';
  const statusKey = STATUS_KEYS[status];

  return (
    <View
      style={[
        styles.card,
        {
          backgroundColor: expanded ? theme.backgroundElement : undefined,
          borderColor: theme.cardBorder,
        },
      ]}>
      <Pressable
        accessibilityRole="button"
        accessibilityLabel={[title, detail, t(statusKey)].filter(Boolean).join('. ')}
        accessibilityState={{ expanded }}
        accessibilityValue={{ text: t(statusKey) }}
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
            <ThemedText type="smallBold" themeColor={skipped ? 'textSecondary' : 'primary'}>{step}</ThemedText>
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
    borderBottomWidth: StyleSheet.hairlineWidth,
    borderRadius: Radius.control,
    borderCurve: 'continuous',
    overflow: 'hidden',
  },
  header: {
    minHeight: 44,
    flexDirection: 'row',
    alignItems: 'center',
    gap: Spacing.three,
    paddingHorizontal: Spacing.three,
    paddingVertical: Spacing.two,
  },
  status: {
    width: 32,
    height: 32,
    borderRadius: Radius.full,
    alignItems: 'center',
    justifyContent: 'center',
  },
  copy: {
    flex: 1,
    flexShrink: 1,
    gap: 2,
  },
  actions: {
    gap: Spacing.two,
    paddingStart: Spacing.three + 32 + Spacing.three,
    paddingEnd: Spacing.three,
    paddingBottom: Spacing.three,
  },
});
