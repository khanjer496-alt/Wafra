import React, { useEffect, useRef, useState } from 'react';
import { ActivityIndicator, AppState, StyleSheet, View, useWindowDimensions } from 'react-native';
import { useEvent } from 'expo';
import { useVideoPlayer, VideoView } from 'expo-video';

import { ThemedText } from '@/components/themed-text';
import { Button } from '@/components/ui/controls';
import { useTheme } from '@/hooks/use-theme';
import type { getIosSetupVideo, iosSetupVideoCopy } from '@/lib/ios-setup-video';

export interface IosSetupVideoPlayerProps {
  video: ReturnType<typeof getIosSetupVideo>;
  copy: ReturnType<typeof iosSetupVideoCopy>;
}

/** Loaded only after Watch and the optional-native-module guard in the card. */
export function IosSetupVideoPlayer({ video, copy }: IosSetupVideoPlayerProps) {
  const theme = useTheme();
  const { width, height } = useWindowDimensions();
  const [ended, setEnded] = useState(false);
  const [fullscreenFailed, setFullscreenFailed] = useState(false);
  const videoView = useRef<VideoView>(null);
  const player = useVideoPlayer(video.recording?.source ?? null, instance => {
    instance.loop = false;
    instance.muted = true;
    instance.staysActiveInBackground = false;
    instance.allowsExternalPlayback = false;
    instance.audioMixingMode = 'mixWithOthers';
  });
  const { status } = useEvent(player, 'statusChange', { status: player.status });
  const startedPlayer = useRef<typeof player | null>(null);
  useEffect(() => {
    // Watch mounts this component. The web player cannot play until VideoView
    // attaches, so start after ready rather than inside the constructor setup.
    // Later buffering/ready events must respect the user's Pause choice.
    if (status !== 'readyToPlay' || startedPlayer.current === player) return;
    startedPlayer.current = player;
    player.play();
  }, [player, status]);
  useEffect(() => {
    const end = player.addListener('playToEnd', () => setEnded(true));
    const playback = player.addListener('playingChange', event => { if (event.isPlaying) setEnded(false); });
    const app = AppState.addEventListener('change', next => { if (next !== 'active') player.pause(); });
    return () => {
      end.remove(); playback.remove(); app.remove();
      // useVideoPlayer owns release on unmount. Depending on cleanup order,
      // that release may already have happened before this final pause.
      try { player.pause(); } catch { /* already released */ }
    };
  }, [player]);
  useEffect(() => { if (status === 'error') player.pause(); }, [player, status]);
  const aspectRatio = video.recording ? video.recording.width / video.recording.height : 1;
  const playerHeight = Math.max(120, Math.min((width - 40) / aspectRatio, height * 0.58, 560));
  return <View style={styles.root}>
    {status === 'error' ? <ThemedText testID="ios-setup-video-error" accessibilityRole="alert" type="small">
      {copy.failed}
    </ThemedText> : <>
      <Button label={copy.fullscreen} variant="outline" disabled={status !== 'readyToPlay'}
        onPress={() => {
          setFullscreenFailed(false);
          void videoView.current?.enterFullscreen().catch(() => setFullscreenFailed(true));
        }} />
      {fullscreenFailed && <ThemedText type="small" accessibilityRole="alert">{copy.fullscreenFailed}</ThemedText>}
      <VideoView ref={videoView} testID="ios-setup-video-view" player={player} nativeControls contentFit="contain" playsInline
        fullscreenOptions={{ enable: true }} allowsPictureInPicture={false} startsPictureInPictureAutomatically={false}
        allowsVideoFrameAnalysis={false} style={[styles.video, { height: playerHeight, width: playerHeight * aspectRatio }]}
        accessibilityLabel={`${video.title}. ${video.recordingNote}`} />
      {(status === 'idle' || status === 'loading') && <View testID="ios-setup-video-loading" style={styles.loading}
        accessibilityLiveRegion="polite" accessibilityState={{ busy: true }}>
        <ActivityIndicator color={theme.text} />
        <ThemedText type="small" themeColor="textSecondary">{copy.loading}</ThemedText>
      </View>}
      {ended && <Button label={copy.replay} variant="outline" onPress={() => { setEnded(false); player.replay(); }} />}
    </>}
  </View>;
}

const styles = StyleSheet.create({
  root: { gap: 12 }, video: { alignSelf: 'center', maxWidth: '100%', backgroundColor: '#000', borderRadius: 12 },
  loading: { flexDirection: 'row', alignItems: 'center', flexWrap: 'wrap', gap: 10 },
});
