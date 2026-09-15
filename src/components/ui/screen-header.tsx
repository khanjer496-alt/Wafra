import { Stack } from 'expo-router';
import React, { useMemo } from 'react';
import { Platform, Pressable, StyleSheet, View } from 'react-native';

import { ThemedText } from '@/components/themed-text';
import { ActionIconButton } from '@/components/ui/action-icon-button';
import type { IconName } from '@/components/ui/icon';
import { Spacing } from '@/constants/theme';
import { tapped } from '@/lib/haptics';
import { hasArabicScript } from '@/lib/i18n';

export type HeaderAction = {
  label: string;
  icon?: IconName;
  onPress: () => void;
  disabled?: boolean;
};

export type ScreenHeaderProps = {
  title: string;
  subtitle?: string;
  back?: HeaderAction;
  leading?: React.ReactNode;
  actions?: HeaderAction[];
  largeTitle?: boolean;
};

type ScreenHeaderRendererProps = ScreenHeaderProps & {
  mode?: 'native' | 'inline';
};

const HeaderTextAction = ({ action }: { action: HeaderAction }) => (
  <Pressable
    accessibilityRole="button"
    accessibilityLabel={action.label}
    accessibilityState={{ disabled: !!action.disabled }}
    disabled={action.disabled}
    onPress={() => {
      tapped();
      action.onPress();
    }}
    pressRetentionOffset={16}
    style={({ pressed }) => [
      styles.textAction,
      Platform.OS === 'android' && styles.androidTextAction,
      { opacity: action.disabled ? 0.4 : pressed ? 0.72 : 1 },
    ]}>
    <ThemedText type="linkPrimary">{action.label}</ThemedText>
  </Pressable>
);

const HeaderActions = ({ actions = [] }: Pick<ScreenHeaderProps, 'actions'>) => (
  <View style={styles.actionGroup}>
    {actions.slice(0, 2).map((action, index) =>
      action.icon ? (
        <ActionIconButton
          key={`${action.label}-${index}`}
          icon={action.icon}
          label={action.label}
          onPress={action.onPress}
          disabled={action.disabled}
          variant="plain"
        />
      ) : (
        <HeaderTextAction key={`${action.label}-${index}`} action={action} />
      ),
    )}
  </View>
);

const HeaderLeading = ({ back, leading }: Pick<ScreenHeaderProps, 'back' | 'leading'>) => {
  if (!back && leading === undefined) return null;

  return (
    <View style={styles.leadingGroup}>
      {back ? (
        <ActionIconButton
          icon={back.icon ?? 'chevron-left'}
          label={back.label}
          onPress={back.onPress}
          disabled={back.disabled}
          variant="plain"
        />
      ) : null}
      {leading}
    </View>
  );
};

const InlineHeader = (props: ScreenHeaderProps) => (
  <View style={styles.inlineHeader}>
    <View style={styles.headerRow}>
      <HeaderLeading back={props.back} />
      <View style={styles.titleGroup}>
        <ThemedText
          type={props.back ? 'heading' : 'title'}
          accessibilityRole="header"
          style={[styles.title, hasArabicScript(props.title) && (props.back ? styles.arabicDetailTitle : styles.arabicTitle)]}>
          {props.title}
        </ThemedText>
        {props.subtitle ? (
          <ThemedText type="default" themeColor="textSecondary" style={styles.subtitle}>
            {props.subtitle}
          </ThemedText>
        ) : null}
      </View>
      <HeaderActions actions={props.actions} />
    </View>
    {props.leading !== undefined ? <View style={styles.contextRow}>{props.leading}</View> : null}
  </View>
);

const NativeTitle = ({ title, subtitle }: Pick<ScreenHeaderProps, 'title' | 'subtitle'>) => (
  <View style={styles.nativeTitle}>
    <ThemedText type="smallBold" accessibilityRole="header">
      {title}
    </ThemedText>
    <ThemedText type="meta" themeColor="textSecondary">
      {subtitle}
    </ThemedText>
  </View>
);

export function ScreenHeader({ mode = 'inline', ...props }: ScreenHeaderRendererProps) {
  // Android's native-stack header reads I18nManager only at process launch.
  // Inline headers stay inside the live language-direction subtree instead.
  const inlineFallback = mode === 'inline' || Platform.OS === 'android' ||
    (!!props.subtitle && !!props.largeTitle);

  const { title, subtitle, largeTitle, back, leading, actions } = props;
  // `Stack.Screen` calls `navigation.setOptions` whenever this object's
  // identity changes, and the native header re-renders with it. Screens
  // build their header prop inline, so without this every scaffold render
  // (keyboard toggles, store updates) rebuilt the native-stack header.
  const nativeOptions = useMemo(() => ({
    headerShown: true,
    title,
    headerLargeTitleEnabled: !!largeTitle,
    headerTitle: subtitle
      ? () => <NativeTitle title={title} subtitle={subtitle} />
      : undefined,
    headerLeft:
      back || leading !== undefined
        ? () => <HeaderLeading back={back} leading={leading} />
        : undefined,
    headerRight:
      actions?.length
        ? () => <HeaderActions actions={actions} />
        : undefined,
  }), [title, subtitle, largeTitle, back, leading, actions]);
  const inlineOptions = useMemo(() => ({ headerShown: false, title }), [title]);

  if (inlineFallback) {
    return (
      <>
        <Stack.Screen options={inlineOptions} />
        <InlineHeader {...props} />
      </>
    );
  }

  return <Stack.Screen options={nativeOptions} />;
}

const styles = StyleSheet.create({
  inlineHeader: { width: '100%', gap: 6 },
  contextRow: { alignItems: 'flex-start' },
  headerRow: {
    minHeight: 44,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
  },
  leadingGroup: { flexDirection: 'row', alignItems: 'center', gap: Spacing.one },
  actionGroup: { flexDirection: 'row', alignItems: 'center', gap: Spacing.one },
  titleGroup: { flex: 1, minWidth: 0, gap: 2 },
  title: { flexShrink: 1 },
  // Plex Arabic needs 1.5em for its full vertical metrics.
  arabicTitle: { lineHeight: 44 },
  arabicDetailTitle: { lineHeight: 34 },
  subtitle: { flexShrink: 1 },
  nativeTitle: { alignItems: 'flex-start' },
  textAction: { minWidth: 44, minHeight: 44, alignItems: 'center', justifyContent: 'center' },
  androidTextAction: { minWidth: 48, minHeight: 48 },
});
