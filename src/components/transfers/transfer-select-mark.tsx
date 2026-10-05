import { StyleSheet, View } from 'react-native';

import { Icon } from '@/components/ui/icon';
import type { BandPalette } from '@/constants/theme';

/** The tick box of select mode. Drawn only; the row it sits in is the checkbox that is spoken. */
export function SelectionMark({ checked, palette }: { checked: boolean; palette: BandPalette }) {
  return <View importantForAccessibility="no" accessibilityElementsHidden style={[styles.box,
    { borderColor: checked ? palette.tint : palette.textSecondary, backgroundColor: checked ? palette.fill : 'transparent' }]}>
    {checked ? <Icon name="check" size={17} color={palette.onFill} /> : null}
  </View>;
}

const styles = StyleSheet.create({
  box: { width: 24, height: 24, borderWidth: 2, borderRadius: 6, justifyContent: 'center', alignItems: 'center' },
});
