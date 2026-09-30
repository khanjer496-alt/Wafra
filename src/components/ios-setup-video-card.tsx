import React, { useCallback, useEffect, useState, type ComponentType } from 'react';
import { AppState, Platform, Pressable, StyleSheet, View } from 'react-native';
import { useIsFocused } from '@react-navigation/native';
import { Image } from 'expo-image';
import { requireOptionalNativeModule } from 'expo-modules-core';

import { ThemedText } from '@/components/themed-text';
import { Icon } from '@/components/ui/icon';
import { BottomSheet } from '@/components/ui/bottom-sheet';
import { Button } from '@/components/ui/controls';
import { useLanguage } from '@/hooks/use-language';
import { useTheme } from '@/hooks/use-theme';
import { getIosSetupVideo, iosSetupVideoCopy, isIosSetupVideoSupported, type IosSetupVideoKind } from '@/lib/ios-setup-video';
import type { IosSetupVideoPlayerProps } from '@/components/ios-setup-video-player';

let closeCurrentGuide: (() => void) | null = null;

class PlayerBoundary extends React.Component<{ children: React.ReactNode; fallback: React.ReactNode }, { failed: boolean }> {
  state = { failed: false };
  static getDerivedStateFromError() { return { failed: true }; }
  render() { return this.state.failed ? this.props.fallback : this.props.children; }
}

/** Watching is presentation only: it never confirms an install, capture or import. */
export function IosSetupVideoCard({ kind, language: explicitLanguage, compact = false, disabled = false, preview = false }: {
  kind: IosSetupVideoKind;
  language?: string;
  compact?: boolean;
  disabled?: boolean;
  /** Explicit web QA/demo only. Never bypasses the iOS version requirement. */
  preview?: boolean;
}) {
  const inheritedLanguage = useLanguage();
  const language = explicitLanguage ?? inheritedLanguage;
  const theme = useTheme();
  const focused = useIsFocused();
  const supported = (Platform.OS === 'ios' && isIosSetupVideoSupported(Platform.Version, kind)) ||
    (Platform.OS === 'web' && preview);
  const video = supported ? getIosSetupVideo(kind, language) : null;
  const copy = iosSetupVideoCopy(language);
  const [open, setOpen] = useState(false);
  const [Player, setPlayer] = useState<ComponentType<IosSetupVideoPlayerProps> | null>(null);
  const close = useCallback(() => {
    setOpen(false);
    setPlayer(null);
    if (closeCurrentGuide === close) closeCurrentGuide = null;
  }, []);

  useEffect(() => {
    if (!focused || disabled || !supported) close();
  }, [focused, disabled, supported, close]);
  useEffect(() => {
    if (!open) return;
    const subscription = AppState.addEventListener('change', next => {
      if (next !== 'active') close();
    });
    return () => subscription.remove();
  }, [open, close]);
  useEffect(() => () => {
    if (closeCurrentGuide === close) closeCurrentGuide = null;
  }, [close]);

  if (!video) return null;
  const seconds = Math.round(video.durationSeconds);
  const duration = `${Math.floor(seconds / 60)}:${String(seconds % 60).padStart(2, '0')}`;
  const recorded = video.recording;
  const actionLabel = recorded ? copy.watch : copy.readGuide;
  const watch = () => {
    if (disabled || !focused || open) return;
    closeCurrentGuide?.();
    closeCurrentGuide = close;
    // Old installed binaries can receive JS that names expo-video. Never
    // evaluate its native binding until the optional module is present.
    let nextPlayer: ComponentType<IosSetupVideoPlayerProps> | null = null;
    try {
      if (recorded && (Platform.OS === 'web' || requireOptionalNativeModule('ExpoVideo'))) {
        // eslint-disable-next-line @typescript-eslint/no-require-imports
        nextPlayer = require('@/components/ios-setup-video-player').IosSetupVideoPlayer;
      }
    } catch { /* The transcript is usable even without a compatible decoder. */ }
    setPlayer(() => nextPlayer);
    setOpen(true);
  };
  const unavailable = <ThemedText testID="ios-setup-video-unavailable" accessibilityRole="alert"
    type="small" themeColor="textSecondary">{copy.videoUnavailable}</ThemedText>;

  return <>
    <Pressable testID={`ios-setup-video-${recorded ? 'watch' : 'read'}-${kind}`} accessibilityRole="button"
      accessibilityLabel={recorded ? `${actionLabel}. ${video.title}. ${duration}. ${video.recordingNote}` : `${actionLabel}. ${video.title}`}
      accessibilityState={{ disabled }} disabled={disabled} onPress={watch}
      style={({ pressed }) => [styles.card, compact && styles.compact,
        { borderColor: theme.cardBorder, backgroundColor: theme.backgroundSelected, opacity: disabled ? 0.45 : pressed ? 0.8 : 1 }]}>
      {recorded && <Image source={recorded.poster} contentFit="contain" style={compact ? styles.smallPoster : styles.poster}
        accessible={false} accessibilityElementsHidden importantForAccessibility="no-hide-descendants" />}
      <View style={styles.cardCopy}>
        <View style={styles.watchLine}>{recorded && <Icon name="play" size={18} color={theme.text} />}
          <ThemedText type="smallBold" style={styles.flexText}>{video.title}</ThemedText>
          {recorded && <ThemedText type="meta" themeColor="textSecondary" style={styles.duration}>{duration}</ThemedText>}
        </View>
        {!compact && <ThemedText type="small" themeColor="textSecondary">{video.description}</ThemedText>}
        <ThemedText type="meta" themeColor="textSecondary">{actionLabel}{recorded ? ` · ${video.recordingNote}` : ''}</ThemedText>
      </View>
    </Pressable>
    {open && focused && !disabled && <BottomSheet testID="ios-setup-video-modal" visible
      title={video.title} subtitle={video.recordingNote || undefined} onClose={close}
      footer={<View testID="ios-setup-video-close"><Button label={copy.close} variant="outline" onPress={close} /></View>}>
      <View style={styles.content}>
        {Player ? <PlayerBoundary key={`${kind}:${language}`} fallback={unavailable}>
          <Player video={video} copy={copy} />
        </PlayerBoundary> : recorded ? unavailable : null}
        <View testID="ios-setup-video-transcript" style={styles.transcript}>
          <ThemedText type="subtitle" accessibilityRole="header">{copy.readSteps}</ThemedText>
          {video.transcript.map((step, index) => <View key={`${index}:${step.startSeconds}`} style={styles.step}>
            <ThemedText type="smallBold" accessibilityRole="header">{`${index + 1}. ${step.title}`}</ThemedText>
            <ThemedText type="small" themeColor="textSecondary">{step.body}</ThemedText>
          </View>)}
        </View>
      </View>
    </BottomSheet>}
  </>;
}

const styles = StyleSheet.create({
  card: { borderWidth: StyleSheet.hairlineWidth, borderRadius: 16, overflow: 'hidden', gap: 12, padding: 14 },
  compact: { flexDirection: 'row', alignItems: 'center' },
  poster: { width: '100%', height: 160 }, smallPoster: { width: 48, height: 64, borderRadius: 6 },
  cardCopy: { flex: 1, gap: 6, minWidth: 0 }, watchLine: { flexDirection: 'row', alignItems: 'center', flexWrap: 'wrap', gap: 8 },
  flexText: { flex: 1, flexShrink: 1 }, duration: { writingDirection: 'ltr' },
  content: { gap: 18 },
  transcript: { gap: 18 }, step: { gap: 6 },
});
