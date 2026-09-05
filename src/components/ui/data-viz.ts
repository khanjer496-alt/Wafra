import { DataViz } from '@/constants/theme';

export const rampColor = (index: number, dark: boolean): string => {
  const ramp = DataViz[dark ? 'dark' : 'light'].ramp;
  return ramp[Math.min(index, ramp.length - 1)];
};
