/**
 * Customize Home.
 *
 * Two groups: the two surfaces that are ALWAYS on top (the money overview and
 * automatic capture, drawn as fixed rows rather than a footnote), and the
 * sections the person can show, hide and reorder. Reordering stays on real
 * up/down buttons with 48pt targets — a drag-only list is unusable with a
 * screen reader or switch control. "Done" in the header closes the screen;
 * every change is already saved as it is made.
 */
import { useRouter } from 'expo-router';
import React, { useCallback, useEffect, useState } from 'react';
import { Pressable, StyleSheet, View } from 'react-native';

import { SettingsIconTile } from '@/components/settings-rows';
import { ThemedText } from '@/components/themed-text';
import { Icon, type IconName } from '@/components/ui/icon';
import { Row } from '@/components/ui/layout';
import { ScreenScaffold } from '@/components/ui/screen-scaffold';
import { SectionHeader } from '@/components/ui/section-header';
import { Toggle } from '@/components/ui/controls';
import { Spacing } from '@/constants/theme';
import { useLanguage } from '@/hooks/use-language';
import { useLargeTextLayout } from '@/hooks/use-large-text-layout';
import { useTheme } from '@/hooks/use-theme';
import { customizeCopy } from '@/lib/customize-copy';
import {
  DEFAULT_HOME_WIDGETS,
  loadHomeWidgetPreferences,
  moveHomeWidget,
  saveHomeWidgetPreferences,
  setHomeWidgetVisible,
  type HomeWidgetId,
  type HomeWidgetPreferences,
} from '@/lib/home-widgets';
import { t, type StringKey } from '@/lib/i18n';

const META: Record<HomeWidgetId, { detailKey: StringKey; icon: IconName }> = {
  assistant: { detailKey: 'homeWidgetAssistantDetail', icon: 'spark' },
  insight: { detailKey: 'homeWidgetInsightDetail', icon: 'trend' },
  due: { detailKey: 'homeWidgetDueDetail', icon: 'calendar' },
  activity: { detailKey: 'homeWidgetActivityDetail', icon: 'receipt' },
  upcoming: { detailKey: 'homeWidgetUpcomingDetail', icon: 'repeat' },
};

export default function HomeCustomizeScreen() {
  const router = useRouter();
  const theme = useTheme();
  const largeText = useLargeTextLayout();
  const copy = customizeCopy(useLanguage());
  const [preferences, setPreferences] = useState<HomeWidgetPreferences>(() => ({
    order: [...DEFAULT_HOME_WIDGETS.order],
    hidden: [],
  }));

  useEffect(() => {
    void loadHomeWidgetPreferences().then(setPreferences);
  }, []);

  const update = useCallback((next: HomeWidgetPreferences) => {
    setPreferences(next);
    void saveHomeWidgetPreferences(next).catch(() => undefined);
  }, []);

  const toggle = (id: HomeWidgetId, visible: boolean) => {
    update(setHomeWidgetVisible(preferences, id, visible));
  };

  const move = (id: HomeWidgetId, direction: -1 | 1) => {
    update(moveHomeWidget(preferences, id, direction));
  };

  const fixedRow = (title: string, detail: string, icon: IconName, last = false) => (
    <Row last={last} accessibilityLabel={`${title} · ${copy.fixed}`}>
      <SettingsIconTile icon={icon} />
      <View style={styles.copy}>
        <ThemedText type="smallBold">{title}</ThemedText>
        <ThemedText type="meta" themeColor="textSecondary">{detail}</ThemedText>
      </View>
      <View style={[styles.fixedBadge, { borderColor: theme.cardBorderStrong }]}>
        <ThemedText type="meta" themeColor="textSecondary">{copy.fixed}</ThemedText>
      </View>
    </Row>
  );

  return (
    <ScreenScaffold
      header={{
        title: t('homeCustomizeTitle'),
        back: { label: t('back'), onPress: router.back },
        actions: [{ label: copy.done, onPress: router.back }],
      }}
      contentStyle={styles.content}>
      <View style={styles.intro}>
        <ThemedText type="default" themeColor="textSecondary">{t('homeCustomizeBody')}</ThemedText>
      </View>

      <View testID="home-customize-fixed">
        <SectionHeader title={copy.alwaysOnTop} />
        {fixedRow(copy.moneyOverviewTitle, copy.moneyOverviewDetail, 'wallet')}
        {fixedRow(copy.captureTitle, copy.captureDetail, 'mail', true)}
      </View>

      <View style={styles.list} testID="home-customize-sections">
        <SectionHeader title={copy.yourSections} />
        <ThemedText type="meta" themeColor="textSecondary" style={styles.hint}>{copy.reorderHint}</ThemedText>
        {preferences.order.map((id, index) => {
          const visible = !preferences.hidden.includes(id);
          const meta = META[id];
          const title = copy.widgetTitle[id];
          const detail = t(meta.detailKey);
          return (
            <Row key={id} last={index === preferences.order.length - 1} style={largeText && styles.rowLarge}>
              <View style={styles.titleRow}>
                <SettingsIconTile icon={meta.icon} />
                <View style={styles.copy}>
                  <ThemedText type="smallBold">{title}</ThemedText>
                  <ThemedText type="meta" themeColor="textSecondary">{detail}</ThemedText>
                </View>
              </View>
              <View style={[styles.actions, largeText && styles.actionsLarge]}>
                <Pressable
                  accessibilityRole="button"
                  accessibilityLabel={`${t('moveUp')} ${title}`}
                  accessibilityState={{ disabled: index === 0 }}
                  disabled={index === 0}
                  onPress={() => move(id, -1)}
                  style={[styles.iconButton, index === 0 && styles.disabled]}>
                  <Icon name="arrow-up" size={17} color={theme.textSecondary} />
                </Pressable>
                <Pressable
                  accessibilityRole="button"
                  accessibilityLabel={`${t('moveDown')} ${title}`}
                  accessibilityState={{ disabled: index === preferences.order.length - 1 }}
                  disabled={index === preferences.order.length - 1}
                  onPress={() => move(id, 1)}
                  style={[styles.iconButton, index === preferences.order.length - 1 && styles.disabled]}>
                  <Icon name="arrow-down" size={17} color={theme.textSecondary} />
                </Pressable>
                <Toggle value={visible} onChange={(next) => toggle(id, next)} label={title} />
              </View>
            </Row>
          );
        })}
      </View>
    </ScreenScaffold>
  );
}

const styles = StyleSheet.create({
  content: { gap: Spacing.four },
  intro: { gap: Spacing.two },
  list: { gap: 0 },
  hint: { marginBottom: Spacing.two },
  titleRow: { flex: 1, minWidth: 0, flexDirection: 'row', alignItems: 'center', gap: 12 },
  copy: { flex: 1, minWidth: 0, gap: 2 },
  fixedBadge: {
    borderWidth: StyleSheet.hairlineWidth,
    borderRadius: 999,
    paddingHorizontal: Spacing.two,
    paddingVertical: Spacing.half,
  },
  actions: { flexDirection: 'row', alignItems: 'center', gap: Spacing.one },
  rowLarge: { flexDirection: 'column', alignItems: 'stretch' },
  actionsLarge: { flexWrap: 'wrap', justifyContent: 'flex-end' },
  iconButton: { width: 48, height: 48, alignItems: 'center', justifyContent: 'center' },
  disabled: { opacity: 0.25 },
});
