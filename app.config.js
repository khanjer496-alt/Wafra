// All existing profiles retain their app.json configuration. The paging producer
// is intentionally opt-in until the exact signed Shortcut passes device tests.
module.exports = ({ config }) => {
  if (process.env.WAFRA_PAGED_HISTORY_BETA !== '1') return config;
  return {
    ...config,
    plugins: [...(config.plugins || []), './modules/wafra-message-history/plugin/paged'],
  };
};
