import { useWindowDimensions } from 'react-native';

/** Layout breakpoint for the platform accessibility text-size categories. */
export function useLargeTextLayout(): boolean {
  const { fontScale, width } = useWindowDimensions();
  return fontScale >= 1.6 || width / Math.max(fontScale, 1) < 260;
}
