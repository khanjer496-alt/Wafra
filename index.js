// Keep Metro's runtime first for web Fast Refresh, as in Expo Router's entry.
import '@expo/metro-runtime';

// Native wakes load the bundle without rendering a route. Register capture
// here so Android can process an alert even after the app process was killed.
// Metro resolves the .web.ts stub on web, which has no background tasks.
import './src/lib/native-background-tasks';

// Router registration must remain last, after background task definitions.
import 'expo-router/entry';
