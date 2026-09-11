module.exports = ({ config }) => {
  // Paged history is the shipping iOS transport. The old Shortcut crossed the
  // app boundary once per Message; this keeps native paging intents available
  // in every iOS build so Wafra can receive bounded batches and process them
  // locally.
  const pagedPlugin = './modules/wafra-message-history/plugin/paged';
  const plugins = config.plugins || [];
  const hasPagedPlugin = plugins.some((plugin) =>
    (Array.isArray(plugin) ? plugin[0] : plugin) === pagedPlugin,
  );
  const withPagedHistory = hasPagedPlugin
    ? config
    : { ...config, plugins: [...plugins, pagedPlugin] };

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
