import { useRouter } from 'expo-router';
import React, { useCallback, useEffect, useState } from 'react';
import { Pressable, StyleSheet, View } from 'react-native';

import { ThemedText } from '@/components/themed-text';
import { Icon } from '@/components/ui/icon';
import { Row } from '@/components/ui/layout';
import { ScreenScaffold } from '@/components/ui/screen-scaffold';
import { Toggle } from '@/components/ui/controls';
import { Spacing } from '@/constants/theme';
import { useTheme } from '@/hooks/use-theme';
import {
  DEFAULT_HOME_WIDGETS,
  loadHomeWidgetPreferences,
  saveHomeWidgetPreferences,
  type HomeWidgetId,
  type HomeWidgetPreferences,
} from '@/lib/home-widgets';
import { t, type StringKey } from '@/lib/i18n';

const META: Record<HomeWidgetId, { titleKey: StringKey; detailKey: StringKey }> = {
  assistant: { titleKey: 'homeWidgetAssistantTitle', detailKey: 'homeWidgetAssistantDetail' },
  insight: { titleKey: 'homeWidgetInsightTitle', detailKey: 'homeWidgetInsightDetail' },
  due: { titleKey: 'homeWidgetDueTitle', detailKey: 'homeWidgetDueDetail' },
  activity: { titleKey: 'homeWidgetActivityTitle', detailKey: 'homeWidgetActivityDetail' },
  upcoming: { titleKey: 'homeWidgetUpcomingTitle', detailKey: 'homeWidgetUpcomingDetail' },
};

export default function HomeCustomizeScreen() {
  const router = useRouter();
  const theme = useTheme();
  const [preferences, setPreferences] = useState<HomeWidgetPreferences>(DEFAULT_HOME_WIDGETS);

  useEffect(() => {
    void loadHomeWidgetPreferences().then(setPreferences);
  }, []);

  const update = useCallback((next: HomeWidgetPreferences) => {
    setPreferences(next);
    void saveHomeWidgetPreferences(next);
  }, []);

  const toggle = (id: HomeWidgetId, visible: boolean) => {
    update({
      ...preferences,
      hidden: visible
        ? preferences.hidden.filter((item) => item !== id)
        : [...preferences.hidden.filter((item) => item !== id), id],
    });
  };

  const move = (id: HomeWidgetId, direction: -1 | 1) => {
    const index = preferences.order.indexOf(id);
    const nextIndex = index + direction;
    if (index < 0 || nextIndex < 0 || nextIndex >= preferences.order.length) return;
    const order = [...preferences.order];
    [order[index], order[nextIndex]] = [order[nextIndex], order[index]];
    update({ ...preferences, order });
  };

  return (
    <ScreenScaffold
      header={{ title: t('homeCustomizeTitle'), back: { label: t('back'), onPress: router.back } }}
      contentStyle={styles.content}>
      <View style={styles.intro}>
        <ThemedText type="heading">{t('homeCustomizeTitle')}</ThemedText>
        <ThemedText type="default" themeColor="textSecondary">{t('homeCustomizeBody')}</ThemedText>
      </View>

      <View style={styles.list}>
        {preferences.order.map((id, index) => {
          const visible = !preferences.hidden.includes(id);
          const meta = META[id];
          const title = t(meta.titleKey);
          const detail = t(meta.detailKey);
          return (
            <Row key={id} last={index === preferences.order.length - 1}>
              <View style={styles.copy}>
                <ThemedText type="smallBold">{title}</ThemedText>
                <ThemedText type="meta" themeColor="textSecondary">{detail}</ThemedText>
              </View>
              <View style={styles.actions}>
                <Pressable
                  accessibilityRole="button"
                  accessibilityLabel={`${t('moveUp')} ${title}`}
                  disabled={index === 0}
                  onPress={() => move(id, -1)}
                  style={[styles.iconButton, index === 0 && styles.disabled]}>
                  <Icon name="arrow-up" size={17} color={theme.textSecondary} />
                </Pressable>
                <Pressable
                  accessibilityRole="button"
                  accessibilityLabel={`${t('moveDown')} ${title}`}
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
      <ThemedText type="meta" themeColor="textTertiary">{t('homeCustomizeFixed')}</ThemedText>
    </ScreenScaffold>
  );
}

const styles = StyleSheet.create({
  content: { gap: Spacing.four },
  intro: { gap: Spacing.two },
  list: { gap: 0 },
  copy: { flex: 1, minWidth: 0, gap: 2 },
  actions: { flexDirection: 'row', alignItems: 'center', gap: Spacing.one },
  iconButton: { width: 40, height: 40, alignItems: 'center', justifyContent: 'center' },
  disabled: { opacity: 0.25 },
});
