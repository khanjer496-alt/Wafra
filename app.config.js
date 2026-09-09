// The owner-test profile includes the paged receiver without changing the
// production Shortcut or exposing source acquisition in Android.
module.exports = ({ config }) => {
  const enabled = process.env.WAFRA_PAGED_HISTORY_BETA === '1';
  if (enabled !== (process.env.EXPO_PUBLIC_WAFRA_PAGED_HISTORY_BETA === '1')) {
    throw new Error('paged_history_flags_must_match');
  }
  return enabled ? { ...config, plugins: [...(config.plugins || []), './modules/wafra-message-history/plugin/paged'] } : config;
};
