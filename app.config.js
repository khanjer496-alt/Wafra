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

  // High-refresh capability must live in Expo config rather than only in the
  // generated native projects. Otherwise a clean EAS/prebuild can silently
  // restore the 60 Hz ceiling on iOS and drop Android's refresh preference.
  const highRefreshPlugin = './modules/wafra-high-refresh/plugin';
  const withPagedPlugins = withPagedHistory.plugins || [];
  const hasHighRefreshPlugin = withPagedPlugins.some((plugin) =>
    (Array.isArray(plugin) ? plugin[0] : plugin) === highRefreshPlugin,
  );
  const withNativePerformance = hasHighRefreshPlugin
    ? withPagedHistory
    : { ...withPagedHistory, plugins: [...withPagedPlugins, highRefreshPlugin] };

  // EAS assigns the remote build number before prebuild. apple-targets reads
  // ios.buildNumber when creating the widget, so give both targets that same
  // number instead of letting the widget retain app.json's placeholder 1.
  const buildNumber = process.env.EAS_BUILD_IOS_BUILD_NUMBER;
  if (buildNumber && !/^\d+(?:\.\d+){0,2}$/.test(buildNumber)) {
    throw new Error('Invalid EAS iOS build number');
  }
  return buildNumber
    ? { ...withNativePerformance, ios: { ...withNativePerformance.ios, buildNumber } }
    : withNativePerformance;
};
