// These trusted JavaScriptCore resources ship inside the native app. Changes
// require a new native runtime even when only shared TypeScript parser changed.
module.exports = {
  extraSources: [
    'modules/wafra-live-capture/ios/Resources/WafraBackgroundParser.js',
    'modules/wafra-live-capture/ios/Resources/WafraBackgroundParser.meta.json',
  ].map((filePath) => ({ type: 'file', filePath, reasons: ['wafraIosBackgroundParser'] })),
};
