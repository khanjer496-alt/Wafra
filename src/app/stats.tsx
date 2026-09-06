/** Backward-compatible destination for saved /stats links. Analytics now lives in Spending. */
import { Redirect } from 'expo-router';
export default function StatsScreen() {
  return <Redirect href="/flow?view=trends" />;
}
