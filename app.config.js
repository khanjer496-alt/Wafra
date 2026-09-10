// The owner-test profile includes the paged receiver without changing the
// production Shortcut or exposing source acquisition in Android.
module.exports = ({ config }) => {
  const enabled = process.env.WAFRA_PAGED_HISTORY_BETA === '1';
  if (enabled !== (process.env.EXPO_PUBLIC_WAFRA_PAGED_HISTORY_BETA === '1')) {
    throw new Error('paged_history_flags_must_match');
  }
  const withPagedHistory = enabled
    ? { ...config, plugins: [...(config.plugins || []), './modules/wafra-message-history/plugin/paged'] }
    : config;

  // Screenmap runs an iOS development client against a Metro server that it
  // starts inside the GitHub runner. Fingerprint runtime matching is useful for
  // real OTA builds, but it adds an unrelated compatibility gate to this
  // synthetic visual-review client and can leave expo-dev-launcher on its
  // "problem loading the project" page even after Metro has produced a valid
  // bundle. Disable updates only when BOTH private Screenmap flags are present.
  // Production has founder unlock disabled, so it cannot enter this branch.
  const screenmapDemo =
    process.env.EXPO_PUBLIC_WAFRA_SCREENMAP_DEMO === '1' &&
    process.env.EXPO_PUBLIC_WAFRA_FOUNDER_UNLOCK === '1';

  if (!screenmapDemo) return withPagedHistory;

  return {
    ...withPagedHistory,
    runtimeVersion: undefined,
    updates: {
      ...(withPagedHistory.updates || {}),
      enabled: false,
    },
  };
};
