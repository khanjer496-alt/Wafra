/**
 * Keep the native llama entitlement plugin out of every ordinary/store build.
 * The dependency remains installed for the explicitly flagged internal build,
 * but production must not inherit its large-address-space entitlements merely
 * because the package exists in node_modules.
 */
module.exports = ({ config }) => {
  const localAiEnabled = process.env.EXPO_PUBLIC_WAFRA_LOCAL_AI_EVAL === '1';
  const plugins = (config.plugins ?? []).filter((entry) => {
    const name = Array.isArray(entry) ? entry[0] : entry;
    return localAiEnabled || name !== 'llama.rn';
  });
  return { ...config, plugins };
};
