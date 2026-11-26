import { DataViz } from '@/constants/theme';
import { useColorScheme } from '@/hooks/use-color-scheme';

export function useRamp(): readonly string[] {
  const scheme = useColorScheme();
  return DataViz[scheme === 'dark' ? 'dark' : 'light'].ramp;
}

export { ProgressBar } from '@/components/ui/progress-bar';
