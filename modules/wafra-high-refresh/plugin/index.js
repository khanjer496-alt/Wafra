const { withInfoPlist, withMainActivity } = require('@expo/config-plugins');

const IOS_PROMOTION_KEY = 'CADisableMinimumFrameDurationOnPhone';
const ANDROID_MARKER = 'wafra-high-refresh';

function patchKotlinMainActivity(source) {
  if (source.includes(`@generated begin ${ANDROID_MARKER}`)) return source;

  const createNeedle = '    super.onCreate(null)';
  if (!source.includes(createNeedle)) {
    throw new Error('Wafra high-refresh plugin could not find MainActivity.onCreate in Kotlin source.');
  }

  const setup = `${createNeedle}\n    // @generated begin ${ANDROID_MARKER} - expo prebuild (DO NOT MODIFY)\n    preferHighRefreshRate()\n    // @generated end ${ANDROID_MARKER}`;

  const methodAnchor = '  /**\n   * Returns the name of the main component registered from JavaScript.';
  if (!source.includes(methodAnchor)) {
    throw new Error('Wafra high-refresh plugin could not find the Kotlin MainActivity method anchor.');
  }

  const helper = `  // @generated begin ${ANDROID_MARKER}-helper - expo prebuild (DO NOT MODIFY)\n  @Suppress(\"DEPRECATION\")\n  private fun preferHighRefreshRate() {\n    val targetRate = if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.UPSIDE_DOWN_CAKE) {\n      // API 34+ accepts the app's intended rate and lets the scheduler choose\n      // the closest display mode. Wafra targets 120 fps on capable displays.\n      120f\n    } else {\n      // Older Android versions require an exact supported refresh rate. Pick\n      // the supported rate closest to 120 rather than hard-coding an invalid\n      // value on 90 Hz / 144 Hz devices.\n      windowManager.defaultDisplay.supportedRefreshRates\n        .minByOrNull { rate -> if (rate >= 120f) rate - 120f else 120f - rate }\n        ?: return\n    }\n\n    if (targetRate <= 60.5f) return\n\n    val params = window.attributes\n    params.preferredRefreshRate = targetRate\n    window.attributes = params\n\n    // Android 15+ can still lower the physical refresh rate while content is\n    // static, then ramp it back up for motion. This keeps 120 Hz interactions\n    // without needlessly holding a high refresh rate on idle finance screens.\n    if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.VANILLA_ICE_CREAM) {\n      window.setFrameRatePowerSavingsBalanced(true)\n    }\n  }\n  // @generated end ${ANDROID_MARKER}-helper\n\n`;

  return source
    .replace(createNeedle, setup)
    .replace(methodAnchor, `${helper}${methodAnchor}`);
}

function patchJavaMainActivity(source) {
  if (source.includes(`@generated begin ${ANDROID_MARKER}`)) return source;

  const createPattern = /super\.onCreate\((?:null|savedInstanceState)\);/;
  if (!createPattern.test(source)) {
    throw new Error('Wafra high-refresh plugin could not find MainActivity.onCreate in Java source.');
  }

  const setup = (match) => `${match}\n    // @generated begin ${ANDROID_MARKER} - expo prebuild (DO NOT MODIFY)\n    preferHighRefreshRate();\n    // @generated end ${ANDROID_MARKER}`;
  const classEnd = source.lastIndexOf('\n}');
  if (classEnd < 0) {
    throw new Error('Wafra high-refresh plugin could not find the Java MainActivity class end.');
  }

  const helper = `\n  // @generated begin ${ANDROID_MARKER}-helper - expo prebuild (DO NOT MODIFY)\n  @SuppressWarnings(\"deprecation\")\n  private void preferHighRefreshRate() {\n    float targetRate;\n    if (Build.VERSION.SDK_INT >= 34) {\n      targetRate = 120f;\n    } else {\n      float[] rates = getWindowManager().getDefaultDisplay().getSupportedRefreshRates();\n      if (rates.length == 0) return;\n      targetRate = rates[0];\n      float bestDistance = Math.abs(targetRate - 120f);\n      for (float rate : rates) {\n        float distance = Math.abs(rate - 120f);\n        if (distance < bestDistance) {\n          targetRate = rate;\n          bestDistance = distance;\n        }\n      }\n    }\n\n    if (targetRate <= 60.5f) return;\n    WindowManager.LayoutParams params = getWindow().getAttributes();\n    params.preferredRefreshRate = targetRate;\n    getWindow().setAttributes(params);\n    if (Build.VERSION.SDK_INT >= 35) {\n      getWindow().setFrameRatePowerSavingsBalanced(true);\n    }\n  }\n  // @generated end ${ANDROID_MARKER}-helper\n`;

  let next = source.replace(createPattern, setup);
  next = `${next.slice(0, classEnd)}${helper}${next.slice(classEnd)}`;
  if (!next.includes('import android.view.WindowManager;')) {
    const importAnchor = 'import android.os.Bundle;';
    if (!next.includes(importAnchor)) {
      throw new Error('Wafra high-refresh plugin could not find the Java import anchor.');
    }
    next = next.replace(importAnchor, `${importAnchor}\nimport android.view.WindowManager;`);
  }
  return next;
}

function withWafraHighRefresh(config) {
  config = withInfoPlist(config, (next) => {
    // Required for iPhone ProMotion. iOS still owns the actual adaptive refresh
    // decision, so this removes the 60 Hz ceiling without forcing 120 Hz idle.
    next.modResults[IOS_PROMOTION_KEY] = true;
    return next;
  });

  return withMainActivity(config, (next) => {
    const { language, contents } = next.modResults;
    if (language === 'kt') {
      next.modResults.contents = patchKotlinMainActivity(contents);
    } else if (language === 'java') {
      next.modResults.contents = patchJavaMainActivity(contents);
    } else {
      throw new Error(`Wafra high-refresh plugin does not support MainActivity language: ${language}`);
    }
    return next;
  });
}

module.exports = withWafraHighRefresh;
module.exports.patchKotlinMainActivity = patchKotlinMainActivity;
module.exports.patchJavaMainActivity = patchJavaMainActivity;

