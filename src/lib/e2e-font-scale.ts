import { Dimensions, Platform, StyleSheet, type StyleProp, type TextStyle } from 'react-native';

/**
 * Larger Text emulation for the browser acceptance harness only.
 *
 * iOS Larger Text (Settings → Accessibility → Display & Text Size) reaches the
 * app two ways: `useWindowDimensions().fontScale` rises, and every `<Text>`
 * with `allowFontScaling` draws its fontSize, lineHeight and letterSpacing
 * multiplied by that scale (capped by `maxFontSizeMultiplier`). React Native
 * Web does neither — fontScale is always 1 in a browser — so a web export can
 * never show the clipping an AX5 iPhone user sees.
 *
 * The seeded E2E export (`EXPO_PUBLIC_WAFRA_E2E_DEMO=1`, web only) reads a
 * scale the harness sets before the bundle runs, via
 * `window.__WAFRA_E2E_FONT_SCALE__`, and reproduces both effects: Dimensions
 * report it, and the app's text components scale their own style with
 * `scaleTextStyleForE2E`. Every production and native bundle inlines the flag
 * as something other than '1', so `E2E_FONT_SCALE` is null there and nothing
 * below runs.
 */
export const E2E_FONT_SCALE: number | null = readScale();

function readScale(): number | null {
  if (Platform.OS !== 'web' || process.env.EXPO_PUBLIC_WAFRA_E2E_DEMO !== '1') return null;
  if (typeof window === 'undefined') return null;
  const raw = Number((window as unknown as { __WAFRA_E2E_FONT_SCALE__?: unknown }).__WAFRA_E2E_FONT_SCALE__);
  return Number.isFinite(raw) && raw > 0 && raw !== 1 ? raw : null;
}

type Dims = ReturnType<typeof Dimensions.get>;
type ChangeHandler = (event: { window: Dims; screen: Dims }) => void;

if (E2E_FONT_SCALE !== null) {
  const scale = E2E_FONT_SCALE;
  const seen = new WeakMap<Dims, Dims>();
  const withScale = (dims: Dims): Dims => {
    if (!dims) return dims;
    let patched = seen.get(dims);
    if (!patched) {
      patched = { ...dims, fontScale: scale };
      seen.set(dims, patched);
    }
    return patched;
  };
  const originalGet = Dimensions.get.bind(Dimensions);
  const originalAdd = Dimensions.addEventListener.bind(Dimensions);
  const target = Dimensions as unknown as {
    get: (dimension: 'window' | 'screen') => Dims;
    addEventListener: (type: 'change', handler: ChangeHandler) => { remove: () => void };
  };
  target.get = (dimension) => withScale(originalGet(dimension));
  target.addEventListener = (type, handler) =>
    originalAdd(type, ((event: { window: Dims; screen: Dims }) =>
      handler({ window: withScale(event.window), screen: withScale(event.screen) })) as never);
}

/**
 * The style a native Text would draw with at the emulated scale. Returns the
 * input unchanged outside the harness.
 */
export function scaleTextStyleForE2E(
  style: StyleProp<TextStyle>,
  allowFontScaling: boolean | undefined,
  maxFontSizeMultiplier: number | null | undefined,
): StyleProp<TextStyle> {
  if (E2E_FONT_SCALE === null || allowFontScaling === false) return style;
  const cap = maxFontSizeMultiplier != null && maxFontSizeMultiplier >= 1 ? maxFontSizeMultiplier : Infinity;
  const factor = Math.min(E2E_FONT_SCALE, cap);
  if (factor === 1) return style;
  const flat = (StyleSheet.flatten(style) ?? {}) as TextStyle;
  const fontSize = typeof flat.fontSize === 'number' ? flat.fontSize : 14;
  const next: TextStyle = { ...flat, fontSize: fontSize * factor };
  if (typeof flat.lineHeight === 'number') next.lineHeight = flat.lineHeight * factor;
  if (typeof flat.letterSpacing === 'number') next.letterSpacing = flat.letterSpacing * factor;
  return next;
}
