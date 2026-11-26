import { withIosTabGate } from '@/components/ios-tab-gate';
import JournalHomeScreen from '@/screens/journal-home-screen';

// iOS: NativeTabs mounts every tab at launch and never freezes them; see ios-tab-gate.tsx.
export default withIosTabGate(JournalHomeScreen);
