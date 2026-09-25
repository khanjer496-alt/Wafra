/**
 * Wafra Home Screen and Lock Screen widgets (WidgetKit).
 *
 * The widget reads ONE value: the privacy-reduced JSON summary the app writes
 * to the shared App Group through modules/wafra-widgets (see
 * src/lib/widget-snapshot.ts). It never opens the ledger.
 *
 * deploymentTarget is 16.1 because @bacons/apple-targets always links
 * ActivityKit (iOS 16.1) and AppIntents (iOS 16.0) into a `widget` target; a
 * lower target would risk a load failure on older iOS. On iOS 15 the app runs
 * as before and simply offers no widgets. Newer APIs (iOS 17 container
 * backgrounds) are gated with #available in Swift.
 *
 * @type {import('@bacons/apple-targets/app.plugin').ConfigFunction}
 */
module.exports = () => ({
  type: 'widget',
  name: 'widget',
  displayName: 'Wafra',
  bundleIdentifier: '.widget',
  deploymentTarget: '16.1',
  entitlements: {
    'com.apple.security.application-groups': ['group.app.wafra.ios'],
  },
});
