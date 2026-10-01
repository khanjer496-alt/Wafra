/** Whole-Home layout editor. Visible order mirrors Home; changes save in sequence. */
import { useRouter } from '@/hooks/use-app-router';
import { useNavigation, usePreventRemove } from '@react-navigation/native';
import React, { useCallback, useEffect, useRef, useState } from 'react';
import { Pressable, StyleSheet, View } from 'react-native';

import { BandTitle } from '@/components/settings-band/band-title';
import { SettingsGroupTitle, SettingsIconTile } from '@/components/settings-rows';
import { ThemedText } from '@/components/themed-text';
import { BandScaffold, type BandNav } from '@/components/ui/band-scaffold';
import { EButton } from '@/components/ui/band/e-button';
import { Icon, type IconName } from '@/components/ui/icon';
import { Fonts } from '@/constants/theme';
import { useBand } from '@/hooks/use-band';
import { useLanguage } from '@/hooks/use-language';
import { useLargeTextLayout } from '@/hooks/use-large-text-layout';
import { customizeCopy } from '@/lib/customize-copy';
import {
  DEFAULT_HOME_WIDGETS,
  drawnHomeWidgetOrder,
  loadHomeWidgetPreferences,
  moveHomeWidgetDrawn,
  saveHomeWidgetPreferences,
  setHomeWidgetVisible,
  splitHomeWidgetLayout,
  type HomeWidgetId,
  type HomeWidgetPreferences,
} from '@/lib/home-widgets';
import { t } from '@/lib/i18n';

const ICONS: Record<HomeWidgetId, IconName> = {
  greeting: 'sun', overview: 'wallet', today: 'calendar', week: 'chart', capture: 'mail',
  assistant: 'spark', insight: 'trend', due: 'calendar', activity: 'receipt', upcoming: 'repeat',
};
type SaveStatus = 'loading' | 'saved' | 'saving' | 'error';
const defaults = (): HomeWidgetPreferences => ({ order: [...DEFAULT_HOME_WIDGETS.order], hidden: [...DEFAULT_HOME_WIDGETS.hidden] });

export default function HomeCustomizeScreen() {
  const router = useRouter();
  const navigation = useNavigation();
  const band = useBand('home');
  const largeText = useLargeTextLayout();
  const copy = customizeCopy(useLanguage());
  const [preferences, setPreferences] = useState<HomeWidgetPreferences>(defaults);
  const [loaded, setLoaded] = useState(false);
  const [saveStatus, setSaveStatus] = useState<SaveStatus>('loading');
  const [leaving, setLeaving] = useState(false);
  const current = useRef(preferences);
  const alive = useRef(true);
  const closing = useRef(false);
  const allowRemoval = useRef(false);
  const revision = useRef(0);
  const saveTail = useRef<Promise<boolean>>(Promise.resolve(true));

  useEffect(() => {
    alive.current = true;
    void loadHomeWidgetPreferences().then(value => {
      if (!alive.current) return;
      current.current = value;
      setPreferences(value);
      setLoaded(true);
      setSaveStatus('saved');
    });
    // A queued write remains valid after navigation. Only screen updates stop.
    return () => { alive.current = false; };
  }, []);

  const persist = useCallback((next: HomeWidgetPreferences) => {
    allowRemoval.current = false;
    const mine = ++revision.current;
    setSaveStatus('saving');
    // Fast repeated taps must not let an older storage write win last.
    const done = saveTail.current.then(() => saveHomeWidgetPreferences(next)).then(
      () => { if (alive.current && mine === revision.current) setSaveStatus('saved'); return true; },
      () => { if (alive.current && mine === revision.current) setSaveStatus('error'); return false; },
    );
    saveTail.current = done;
    return done;
  }, []);

  const update = (change: (before: HomeWidgetPreferences) => HomeWidgetPreferences) => {
    if (!loaded || closing.current) return;
    const next = change(current.current);
    current.current = next;
    setPreferences(next);
    void persist(next);
  };
  const finishNavigation = async (leave: () => void) => {
    if (closing.current) return;
    closing.current = true;
    setLeaving(true);
    const saved = await saveTail.current;
    closing.current = false;
    if (!alive.current) return;
    setLeaving(false);
    if (saved) {
      allowRemoval.current = true;
      leave();
    }
  };
  // Covers native hardware Back, swipe-to-dismiss and parent navigation too.
  // Dispatching the captured action preserves the navigator's removal token,
  // so an approved retry does not trigger the same guard recursively.
  usePreventRemove(saveStatus === 'saving' || saveStatus === 'error', ({ data }) => {
    if (allowRemoval.current) { navigation.dispatch(data.action); return; }
    void finishNavigation(() => navigation.dispatch(data.action));
  });
  const close = () => finishNavigation(() => router.back());
  const leaveUnsaved = () => { allowRemoval.current = true; router.back(); };
  const nav: BandNav = {
    back: () => { void close(); }, backDisabled: leaving,
    actions: [{ icon: 'check', label: copy.done, onPress: () => { void close(); }, testID: 'home-customize-done' }],
  };
  const enabled = loaded && !leaving;
  // The preview lists sections in the order Home draws them: the overview
  // leads the sheet under the band rather than sitting second.
  const drawn = splitHomeWidgetLayout(preferences);
  const visible = [...drawn.band, ...drawn.sheet];
  const statusLabel = saveStatus === 'loading' ? t('stillLoading')
    : saveStatus === 'saving' ? copy.saving : saveStatus === 'error' ? copy.saveError : copy.saved;

  return <BandScaffold band="home" testID="home-customize-screen" nav={nav} contentStyle={styles.content}
    bandContent={<BandTitle title={copy.title} body={copy.body} palette={band} testID="home-customize-title" />}
    footer={<View style={styles.savePanel}>
      <ThemedText testID="home-customize-save-status" type="meta" accessibilityLiveRegion="polite"
        accessibilityRole={saveStatus === 'error' ? 'alert' : 'text'} style={{ color: saveStatus === 'error' ? band.statusOver : band.textSecondary }}>{statusLabel}</ThemedText>
      {saveStatus === 'error' ? <View style={styles.errorActions}>
        <Pressable testID="home-customize-retry" accessibilityRole="button" onPress={() => { void persist(current.current); }} style={styles.textAction}>
          <ThemedText type="smallBold" style={{ color: band.tint }}>{copy.retry}</ThemedText>
        </Pressable>
        <Pressable testID="home-customize-leave-unsaved" accessibilityRole="button" onPress={leaveUnsaved} style={styles.textAction}>
          <ThemedText type="meta" style={{ color: band.textSecondary }}>{copy.leaveWithoutSaving}</ThemedText>
        </Pressable>
      </View> : null}
    </View>}>
    <View style={styles.previewSection}>
      <SettingsGroupTitle title={copy.previewTitle} palette={band} />
      <View testID="home-customize-preview" style={[styles.preview, { backgroundColor: band.band }]}>
        {visible.length ? visible.map((id, index) => <View key={id} testID={`home-customize-preview-${id}`}
          accessible accessibilityRole="text" accessibilityLabel={`${index + 1}. ${copy.widgetTitle[id]}`}
          style={[styles.previewRow, index > 0 && { borderTopWidth: StyleSheet.hairlineWidth, borderTopColor: band.bandRule }]}>
          <ThemedText type="meta" tabular maxFontSizeMultiplier={1.5} style={[styles.previewIndex, { color: band.onBandSecondary }]}>{index + 1}</ThemedText>
          <Icon name={ICONS[id]} size={16} color={band.onBandSecondary} />
          <ThemedText type="meta" maxFontSizeMultiplier={1.5} style={[styles.previewTitle, { color: band.onBand }]}>{copy.widgetTitle[id]}</ThemedText>
        </View>) : <ThemedText type="small" testID="home-customize-preview-empty" style={{ color: band.onBand }}>{copy.previewEmpty}</ThemedText>}
      </View>
      <ThemedText type="meta" style={{ color: band.textSecondary }}>{copy.fixedNote}</ThemedText>
    </View>
    <View style={styles.list} testID="home-customize-sections">
      <SettingsGroupTitle title={copy.yourSections} palette={band} />
      <ThemedText type="meta" style={{ color: band.textSecondary }}>{copy.reorderHint}</ThemedText>
      {/* Listed in the order Home draws them, like the preview. A move is one
          drawn step; a step Home cannot draw (the overview on the band) is
          disabled rather than offered as a press that changes nothing. */}
      {drawnHomeWidgetOrder(preferences).map((id) => {
        const shown = !preferences.hidden.includes(id);
        const title = copy.widgetTitle[id];
        const first = moveHomeWidgetDrawn(preferences, id, -1) === null;
        const last = moveHomeWidgetDrawn(preferences, id, 1) === null;
        return <View key={id} testID={`home-customize-${id}`} style={[styles.card, { backgroundColor: band.card }]}>
          <View style={[styles.titleRow, largeText && styles.titleRowLarge]}>
            <SettingsIconTile icon={ICONS[id]} palette={band} />
            <View style={[styles.copy, largeText && styles.copyLarge]}>
              <ThemedText type="smallBold" maxFontSizeMultiplier={2} style={[styles.rowTitle, { color: shown ? band.text : band.textSecondary }]}>{title}</ThemedText>
              <ThemedText type="meta" style={{ color: band.textSecondary }}>{copy.widgetDetail[id]}</ThemedText>
            </View>
          </View>
          <View style={styles.actions}>
            <Pressable testID={`home-customize-toggle-${id}`} accessibilityRole="switch" accessibilityLabel={title}
              accessibilityState={{ checked: shown, disabled: !enabled }} aria-checked={shown} disabled={!enabled}
              onPress={() => update(before => setHomeWidgetVisible(before, id, before.hidden.includes(id)))}
              style={[styles.visibility, { borderColor: band.rule, backgroundColor: shown ? band.glyphGround : 'transparent', opacity: enabled ? 1 : 0.5 }]}>
              <Icon name={shown ? 'check' : 'close'} size={16} color={band.text} />
              <ThemedText type="meta" style={{ color: band.text }}>{shown ? copy.shown : copy.hidden}</ThemedText>
            </Pressable>
            <View style={styles.moves}>
              <Pressable testID={`home-customize-up-${id}`} accessibilityRole="button" accessibilityLabel={`${t('moveUp')} ${title}`}
                accessibilityState={{ disabled: first || !enabled }} disabled={first || !enabled}
                onPress={() => update(before => moveHomeWidgetDrawn(before, id, -1) ?? before)}
                style={({ pressed }) => [styles.iconButton, { backgroundColor: band.glyphGround }, (first || !enabled) && styles.disabled, pressed && styles.pressed]}>
                <Icon name="arrow-up" size={20} color={band.text} />
              </Pressable>
              <Pressable testID={`home-customize-down-${id}`} accessibilityRole="button" accessibilityLabel={`${t('moveDown')} ${title}`}
                accessibilityState={{ disabled: last || !enabled }} disabled={last || !enabled}
                onPress={() => update(before => moveHomeWidgetDrawn(before, id, 1) ?? before)}
                style={({ pressed }) => [styles.iconButton, { backgroundColor: band.glyphGround }, (last || !enabled) && styles.disabled, pressed && styles.pressed]}>
                <Icon name="arrow-down" size={20} color={band.text} />
              </Pressable>
            </View>
          </View>
        </View>;
      })}
    </View>
    <EButton testID="home-customize-reset" palette={band} variant="secondary" label={copy.resetLayout}
      disabled={!enabled} onPress={() => update(defaults)} />
  </BandScaffold>;
}

const styles = StyleSheet.create({
  content: { gap: 24 }, previewSection: { gap: 10 },
  preview: { borderRadius: 22, paddingHorizontal: 16, paddingVertical: 10 },
  previewRow: { minHeight: 34, flexDirection: 'row', alignItems: 'center', gap: 10, paddingVertical: 7 },
  previewIndex: { minWidth: 22 }, previewTitle: { flex: 1, flexShrink: 1 },
  list: { gap: 12 }, card: { borderRadius: 22, padding: 16, gap: 16 },
  titleRow: { flexDirection: 'row', alignItems: 'flex-start', gap: 12 },
  titleRowLarge: { flexDirection: 'column' },
  copy: { flex: 1, minWidth: 0, gap: 4 },
  copyLarge: { flex: 0, alignSelf: 'stretch' },
  rowTitle: { fontFamily: Fonts.sansSemi, fontSize: 17, lineHeight: 23 },
  actions: { flexDirection: 'row', flexWrap: 'wrap', alignItems: 'center', justifyContent: 'space-between', gap: 8 },
  visibility: { minHeight: 48, borderRadius: 14, borderWidth: 1, paddingHorizontal: 12, paddingVertical: 8, flexDirection: 'row', flexWrap: 'wrap', alignItems: 'center', gap: 8 },
  moves: { flexDirection: 'row', gap: 6 },
  iconButton: { width: 48, height: 48, borderRadius: 14, alignItems: 'center', justifyContent: 'center' },
  disabled: { opacity: 0.3 }, pressed: { opacity: 0.6 },
  savePanel: { gap: 4 }, errorActions: { flexDirection: 'row', flexWrap: 'wrap', gap: 12 },
  textAction: { minHeight: 48, justifyContent: 'center' },
});
