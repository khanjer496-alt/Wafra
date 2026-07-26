import { Tabs } from 'expo-router';
import React from 'react';

import { WafraTabBar } from '@/components/tab-bar';

export default function TabsLayout() {
  return (
    <Tabs
      screenOptions={{ headerShown: false }}
      tabBar={(props) => <WafraTabBar {...props} />}>
      <Tabs.Screen name="index" />
      <Tabs.Screen name="flow" />
      <Tabs.Screen name="bills" />
      <Tabs.Screen name="wallet" />
    </Tabs>
  );
}
