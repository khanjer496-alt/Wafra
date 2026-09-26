/**
 * Customize Home.
 *
 * Design language E: Home's ink band carries the plain title, one sentence
 * and Done; the sheet lists what can move. Two groups: the two surfaces that
 * are ALWAYS on top (the money overview and automatic capture, drawn as fixed
 * rows rather than a footnote), and the sections the person can show, hide
 * and reorder. Reordering stays on real up/down buttons with 48pt targets — a
 * drag-only list is unusable with a screen reader or switch control. "Done"
 * closes the screen; every change is already saved as it is made.
 */
import { useRouter } from 'expo-router';
import React, { useCallback, useEffect, useState } from 'react';
import { Pressable, StyleSheet, View } from 'react-native';

import { BandTitle } from '@/components/settings-band/band-title';
import { SettingsGroupTitle, SettingsIconTile } from '@/components/settings-rows';
import { ThemedText } from '@/components/themed-text';
import { BandScaffold, type BandNav } from '@/components/ui/band-scaffold';
import { Toggle } from '@/components/ui/controls';
import { Icon, type IconName } from '@/components/ui/icon';
import { Fonts, Spacing } from '@/constants/theme';
import { useBand } from '@/hooks/use-band';
import { useLanguage } from '@/hooks/use-language';
import { useLargeTextLayout } from '@/hooks/use-large-text-layout';
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
  // Design language E: Customize Home is Home's detail, so it wears ink.
  const band = useBand('home');
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

  const nav: BandNav = {
    back: true,
    actions: [{ icon: 'check', label: copy.done, onPress: router.back, testID: 'home-customize-done' }],
  };

  const fixedRow = (title: string, detail: string, icon: IconName, last = false) => (
    <View accessible accessibilityLabel={`${title} · ${copy.fixed}`}
      style={[styles.row, largeText && styles.rowLarge, !last && { borderBottomWidth: StyleSheet.hairlineWidth, borderBottomColor: band.rule }]}>
      <View style={styles.titleRow}>
        <SettingsIconTile icon={icon} palette={band} />
        <View style={styles.copy}>
          <ThemedText type="smallBold" style={[styles.rowTitle, { color: band.text }]}>{title}</ThemedText>
          <ThemedText type="meta" style={{ color: band.textSecondary }}>{detail}</ThemedText>
        </View>
      </View>
      <View style={[styles.fixedBadge, largeText && styles.fixedBadgeLarge, { backgroundColor: band.glyphGround }]}>
        <ThemedText type="meta" style={{ color: band.text }}>{copy.fixed}</ThemedText>
      </View>
    </View>
  );

  return (
    <BandScaffold
      band="home"
      testID="home-customize-screen"
      nav={nav}
      contentStyle={styles.content}
      bandContent={(
        <View style={styles.bandBody}>
          <BandTitle title={t('homeCustomizeTitle')} body={t('homeCustomizeBody')} palette={band} testID="home-customize-title" />
        </View>
      )}>
      <View testID="home-customize-fixed">
        <SettingsGroupTitle title={copy.alwaysOnTop} palette={band} />
        {fixedRow(copy.moneyOverviewTitle, copy.moneyOverviewDetail, 'wallet')}
        {fixedRow(copy.captureTitle, copy.captureDetail, 'mail', true)}
      </View>

      <View style={styles.list} testID="home-customize-sections">
        <SettingsGroupTitle title={copy.yourSections} palette={band} />
        <ThemedText type="meta" style={[styles.hint, { color: band.textSecondary }]}>{copy.reorderHint}</ThemedText>
        {preferences.order.map((id, index) => {
          const visible = !preferences.hidden.includes(id);
          const meta = META[id];
          const title = copy.widgetTitle[id];
          const detail = t(meta.detailKey);
          const first = index === 0;
          const last = index === preferences.order.length - 1;
          return (
            <View key={id} testID={`home-customize-${id}`}
              style={[styles.row, largeText && styles.rowLarge,
                !last && { borderBottomWidth: StyleSheet.hairlineWidth, borderBottomColor: band.rule }]}>
              <View style={styles.titleRow}>
                <SettingsIconTile icon={meta.icon} palette={band} />
                <View style={styles.copy}>
                  <ThemedText type="smallBold" style={[styles.rowTitle, { color: visible ? band.text : band.textSecondary }]}>{title}</ThemedText>
                  <ThemedText type="meta" style={{ color: band.textSecondary }}>{detail}</ThemedText>
                </View>
              </View>
              <View style={[styles.actions, largeText && styles.actionsLarge]}>
                <Toggle value={visible} onChange={(next) => toggle(id, next)} label={title} />
                <Pressable
                  accessibilityRole="button"
                  accessibilityLabel={`${t('moveUp')} ${title}`}
                  accessibilityState={{ disabled: first }}
                  disabled={first}
                  onPress={() => move(id, -1)}
                  style={({ pressed }) => [styles.iconButton, first && styles.disabled, pressed && { opacity: 0.6 }]}>
                  <Icon name="arrow-up" size={18} strokeWidth={2} color={band.text} />
                </Pressable>
                <Pressable
                  accessibilityRole="button"
                  accessibilityLabel={`${t('moveDown')} ${title}`}
                  accessibilityState={{ disabled: last }}
                  disabled={last}
                  onPress={() => move(id, 1)}
                  style={({ pressed }) => [styles.iconButton, last && styles.disabled, pressed && { opacity: 0.6 }]}>
                  <Icon name="arrow-down" size={18} strokeWidth={2} color={band.text} />
                </Pressable>
              </View>
            </View>
          );
        })}
      </View>
    </BandScaffold>
  );
}

const styles = StyleSheet.create({
  content: { gap: Spacing.three },
  bandBody: { paddingBottom: Spacing.two },
  list: { gap: 0 },
  hint: { marginBottom: Spacing.one },
  row: { flexDirection: 'row', alignItems: 'center', gap: Spacing.two, minHeight: 64, paddingVertical: Spacing.two },
  rowLarge: { flexDirection: 'column', alignItems: 'stretch' },
  titleRow: { flex: 1, minWidth: 0, flexDirection: 'row', alignItems: 'center', gap: 14 },
  copy: { flex: 1, minWidth: 0, gap: 2 },
  rowTitle: { fontFamily: Fonts.sansSemi, fontSize: 16, lineHeight: 22 },
  fixedBadge: {
    borderRadius: 999,
    paddingHorizontal: 10,
    paddingVertical: 3,
  },
  fixedBadgeLarge: { alignSelf: 'flex-start' },
  actions: { flexDirection: 'row', alignItems: 'center', gap: Spacing.half },
  actionsLarge: { flexWrap: 'wrap', justifyContent: 'flex-end' },
  iconButton: { width: 48, height: 48, alignItems: 'center', justifyContent: 'center' },
  disabled: { opacity: 0.25 },
});
