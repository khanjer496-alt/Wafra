import { complimentaryCopy } from '@/lib/complimentary-copy';
import React, { useEffect, useRef, useState } from 'react';
import { AppState as Lifecycle, Platform, StyleSheet, TextInput, View } from 'react-native';
import { BandScaffold } from '@/components/ui/band-scaffold';
import { EButton } from '@/components/ui/band/e-button';
import { ThemedText } from '@/components/themed-text';
import { useBand } from '@/hooks/use-band';
import { useStore } from '@/lib/store';
import { complimentaryAccessUntil, isComplimentaryCode } from '@/lib/complimentary-access';
import { complimentaryDevice } from '@/lib/complimentary-device';

export default function ComplimentaryAccessScreen() {
  const { state, getStateSnapshot, getStateGeneration, setComplimentaryIssuedAt } = useStore();
  const words = complimentaryCopy(state.language);
  const band = useBand('settings');
  const [code, setCode] = useState('');
  const [busy, setBusy] = useState(false);
  const [status, setStatus] = useState<'invalid' | 'unavailable' | 'removed' | null>(null);
  const live = useRef(true);
  const working = useRef(false);
  useEffect(() => {
    live.current = true;
    const sub = Lifecycle.addEventListener('change', value => { if (value !== 'active') setCode(''); });
    return () => { live.current = false; sub.remove(); };
  }, []);
  const active = !!complimentaryAccessUntil(state.complimentaryIssuedAt);
  const title = words.title;
  async function redeem() {
    if (working.current || state.privateMode || Platform.OS !== 'android' || !state.hydrated || !isComplimentaryCode(code.trim())) return;
    const generation = getStateGeneration();
    working.current = true; setBusy(true); setStatus(null);
    const candidate = code.trim(); setCode('');
    try {
      const result = await complimentaryDevice.redeem(candidate);
      if (getStateGeneration() !== generation || !getStateSnapshot().hydrated) return;
      if (result.status === 'granted') await setComplimentaryIssuedAt(result.issuedAt);
      else if (live.current) setStatus(result.status === 'denied' ? 'invalid' : 'unavailable');
    } catch { if (live.current) setStatus('unavailable'); }
    finally { working.current = false; if (live.current) setBusy(false); }
  }
  async function remove() {
    if (working.current) return;
    working.current = true; setBusy(true); setCode(''); setStatus(null);
    try { await Promise.all([setComplimentaryIssuedAt(), complimentaryDevice.clear()]); if (live.current) setStatus('removed'); }
    catch { if (live.current) setStatus('unavailable'); }
    finally { working.current = false; if (live.current) setBusy(false); }
  }
  if (Platform.OS !== 'android') return null;
  return <BandScaffold band="settings" nav={{ back: true }} keyboardAware
    bandContent={<ThemedText type="title">{title}</ThemedText>}>
    <View style={styles.body}>
      <ThemedText>{words.body}</ThemedText>
      {active && <ThemedText accessibilityLiveRegion="polite">{words.active}</ThemedText>}
      {state.privateMode && <ThemedText>{words.privateMode}</ThemedText>}
      <TextInput accessibilityLabel={title} testID="complimentary-code" value={code} onChangeText={setCode}
        editable={!busy && !state.privateMode} placeholder={title} secureTextEntry maxLength={43}
        autoComplete="off" autoCorrect={false} autoCapitalize="none" importantForAutofill="no"
        style={[styles.input, { color: band.text, borderColor: band.rule }]} />
      <EButton palette={band} label={words.activate} onPress={() => void redeem()}
        disabled={busy || !state.hydrated || state.privateMode || !isComplimentaryCode(code.trim())} />
      {status && <ThemedText accessibilityRole="alert">{status === 'invalid'
        ? words.invalid
        : status === 'removed' ? words.removed
        : words.unavailable}</ThemedText>}
      <EButton palette={band} variant="quiet" disabled={busy} label={words.remove} onPress={() => void remove()} />
    </View>
  </BandScaffold>;
}
const styles = StyleSheet.create({ body: { gap: 16, padding: 20 }, input: { borderWidth: 1, borderRadius: 12, padding: 14, minHeight: 48 } });
