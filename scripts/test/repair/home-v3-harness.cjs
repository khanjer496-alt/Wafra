'use strict';
// Home v3's pieces for the source-component harnesses that render Home
// (journal-harness.cjs, reference-harness.cjs): the Spent hero, the
// transactions list and the Needs you pill run from source; money is added up
// by the shipping modules. Native boundaries (device motion, gestures, the
// tab bar's measured clearance, the share bar's coins) are stubs.
const path = require('node:path');

const root = path.resolve(__dirname, '../../..');
const build = path.resolve(__dirname, '../build');

/** The earlier Home's order with every section on, plus the Spent hero and Transfers. */
const EVERY_SECTION = { order: ['greeting', 'hero', 'overview', 'today', 'week', 'due', 'upcoming', 'activity', 'transfers', 'assistant', 'insight', 'capture'], hidden: [] };

function installHomeV3(deps, { load, jsx, language = 'en', events = [], options = {}, globals }) {
  const native = deps['react-native'];
  const format = deps['@/lib/format'];
  const months = language === 'ar'
    ? ['يناير', 'فبراير', 'مارس', 'أبريل', 'مايو', 'يونيو', 'يوليو', 'أغسطس', 'سبتمبر', 'أكتوبر', 'نوفمبر', 'ديسمبر']
    : ['January', 'February', 'March', 'April', 'May', 'June', 'July', 'August', 'September', 'October', 'November', 'December'];
  if (format && !format.monthLabel) format.monthLabel = (key) => `${months[Number(key.slice(5, 7)) - 1]} ${key.slice(0, 4)}`;
  if (format && !format.shiftMonthKey) format.shiftMonthKey = require(path.join(build, 'format.js')).shiftMonthKey;
  if (!deps['@/lib/insights']) deps['@/lib/insights'] = { summarizeMonth: require(path.join(build, 'insights.js')).summarizeMonth };
  deps['@/lib/home-hero'] = require(path.join(build, 'home-hero.js'));
  deps['@/lib/home-copy'] = require(path.join(build, 'home-copy.js'));
  deps['@/lib/home-needs-you'] = require(path.join(build, 'home-needs-you.js'));
  deps['@/lib/home-pace-nudge'] = { loadPaceMemory: async () => options.paceMemory ?? null,
    savePaceMemory: async (memory) => { events.push(['pace', memory]); } };
  deps['@/lib/haptics'] = { ...(deps['@/lib/haptics'] ?? {}), tapped: deps['@/lib/haptics']?.tapped ?? (() => {}),
    captured: () => events.push(['haptic', 'nudge']) };
  if (!deps['@/lib/reference-presentation']) deps['@/lib/reference-presentation'] = load(path.join(root, 'src/lib/reference-presentation.ts'), deps);
  if (!deps['@/lib/category-colors']) deps['@/lib/category-colors'] = load(path.join(root, 'src/lib/category-colors.ts'), deps);
  if (deps['@/lib/i18n'] && !deps['@/lib/i18n'].isRTL) deps['@/lib/i18n'] = { ...deps['@/lib/i18n'], isRTL: () => language === 'ar' };
  if (!native.PanResponder) native.PanResponder = { create: (config) => ({ panHandlers: { onMoveShouldSetResponder: config.onMoveShouldSetPanResponder } }) };
  native.Easing = { ...(native.Easing ?? {}), in: (f) => f, out: (f) => f, quad: (t) => t };
  if (!native.Animated.add) native.Animated.add = (a) => a;
  deps['@/hooks/use-device-tilt'] = { useDeviceTilt: () => ({ x: new native.Animated.Value(0), y: new native.Animated.Value(0) }) };
  if (!deps['@/hooks/use-tab-bar-clearance']) deps['@/hooks/use-tab-bar-clearance'] = { useTabBarClearance: () => 100 };
  deps['@/components/ui/band/share-bar'] = { ...(deps['@/components/ui/band/share-bar'] ?? {}), ShareBar: (props) => jsx('ShareBar', props) };
  if (!deps['react-native-svg']) deps['react-native-svg'] = { __esModule: true, default: 'svg', Circle: 'circle', Line: 'line', Path: 'path', Rect: 'rect' };
  for (const name of ['home-sparkline', 'home-hero', 'home-recent', 'needs-you-pill']) {
    deps[`@/components/home/${name}`] = load(path.join(root, `src/components/home/${name}.tsx`), deps, globals);
  }
  // These suites exercise every Home section: unless a case asks for the app's
  // own default ('default': Home v3, Spent then the transactions), the saved
  // layout already in memory has every section on.
  const layout = options.homeWidgets === 'default' ? null : options.homeWidgets ?? EVERY_SECTION;
  if (layout && deps['@/lib/home-widgets']) deps['@/lib/home-widgets'] = { ...deps['@/lib/home-widgets'], peekHomeWidgetPreferences: () => layout };
}

module.exports = { installHomeV3, EVERY_SECTION };
