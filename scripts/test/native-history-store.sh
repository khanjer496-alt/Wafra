#!/usr/bin/env bash
set -euo pipefail

cd "$(dirname "$0")/../.."

verify_app_intents_metadata() {
  local metadata_file="$1"
  if [ ! -f "$metadata_file" ]; then
    echo "native-history-store.sh: App Intents metadata not found: $metadata_file" >&2
    return 1
  fi

  WAFRA_APP_INTENTS_METADATA="$metadata_file" node <<'NODE'
const fs = require('node:fs');

const metadataFile = process.env.WAFRA_APP_INTENTS_METADATA;
const fail = (message) => {
  console.error(`native-history-store.sh: ${message}`);
  process.exit(1);
};

let metadata;
try {
  metadata = JSON.parse(fs.readFileSync(metadataFile, 'utf8'));
} catch (error) {
  fail(`could not parse App Intents metadata: ${error.message}`);
}

const actions = metadata?.actions;
if (!actions || typeof actions !== 'object' || Array.isArray(actions)) {
  fail('App Intents metadata has no actions object.');
}

const expectedHistoryIdentifiers = [
  'BeginWafraHistoryImportIntent',
  'DiscardWafraPreparedHistoryV2Intent',
  'FinishWafraHistoryImportIntent',
  'ImportWafraMessageHistoryIntent',
  'ImportWafraPreparedHistoryIntent',
  'ImportWafraPreparedHistoryV2Intent',
  'PrepareWafraHistoryMessageIntent',
  'PrepareWafraHistoryMessageV2Intent',
  'PrepareWafraHistoryMessageV3Intent',
  'StageWafraMessageHistoryIntent',
];
const actualHistoryIdentifiers = Object.keys(actions)
  .filter((identifier) => /Wafra.*History.*Intent$/.test(identifier))
  .sort();
if (JSON.stringify(actualHistoryIdentifiers) !== JSON.stringify(expectedHistoryIdentifiers)) {
  fail(`history intent identifiers ${JSON.stringify(actualHistoryIdentifiers)} do not match ${JSON.stringify(expectedHistoryIdentifiers)}.`);
}

const intent = actions.ImportWafraMessageHistoryIntent;
if (intent.authenticationPolicy !== 2 || intent.isAuthPolExplicit !== true) {
  fail(`bulk authenticationPolicy must be explicit policy 2, received ${JSON.stringify({
    authenticationPolicy: intent.authenticationPolicy,
    isAuthPolExplicit: intent.isAuthPolExplicit,
  })}.`);
}
if (intent.supportedModes !== 1 || intent.openAppWhenRun !== false) {
  fail(`bulk supportedModes must be background mode 1 without opening the app, received ${JSON.stringify({
    supportedModes: intent.supportedModes,
    openAppWhenRun: intent.openAppWhenRun,
  })}.`);
}
if (intent.availabilityAnnotations?.LNPlatformNameIOS?.introducedVersion !== '26.0') {
  fail(`bulk iOS availability must be 26.0, received ${JSON.stringify(
    intent.availabilityAnnotations?.LNPlatformNameIOS,
  )}.`);
}
if (intent.outputType != null || intent.outputFlags !== 0) {
  fail(`bulk intent must expose no output value, received ${JSON.stringify({
    outputType: intent.outputType,
    outputFlags: intent.outputFlags,
  })}.`);
}

const primitiveType = (parameter) =>
  parameter?.valueType?.primitive?.wrapper?.typeIdentifier;
const arrayMemberType = (parameter) =>
  parameter?.valueType?.array?.wrapper?.memberValueType?.primitive?.wrapper?.typeIdentifier;
const actualParameters = (intent.parameters || []).map((parameter) => ({
  name: parameter.name,
  type: parameter.valueType?.array ? 'array' : 'primitive',
  typeIdentifier: parameter.valueType?.array
    ? arrayMemberType(parameter)
    : primitiveType(parameter),
  isOptional: parameter.isOptional,
  titleKey: parameter.title?.key,
}));
const expectedParameters = [
  { name: 'sessionId', type: 'primitive', typeIdentifier: 0, isOptional: false,
    titleKey: 'history.session_id.parameter' },
  { name: 'found', type: 'primitive', typeIdentifier: 2, isOptional: false,
    titleKey: 'history.found.parameter' },
  { name: 'messageGUIDs', type: 'array', typeIdentifier: 0, isOptional: false,
    titleKey: 'history.message_guids.parameter' },
  { name: 'bodies', type: 'array', typeIdentifier: 0, isOptional: false,
    titleKey: 'history.bodies.parameter' },
  { name: 'dates', type: 'array', typeIdentifier: 8, isOptional: false,
    titleKey: 'history.dates.parameter' },
];
if (JSON.stringify(actualParameters) !== JSON.stringify(expectedParameters)) {
  fail(`bulk parameters ${JSON.stringify(actualParameters)} do not match ${JSON.stringify(expectedParameters)}.`);
}

const expectedLowLevelIntents = [
  {
    identifier: 'BeginWafraHistoryImportIntent',
    authenticationPolicy: 2,
    outputTypeIdentifier: 0,
    parameters: [
      { name: 'sessionId', type: 'primitive', typeIdentifier: 0, isOptional: false,
        titleKey: 'history.session_id.parameter' },
    ],
  },
  {
    identifier: 'StageWafraMessageHistoryIntent',
    authenticationPolicy: 0,
    outputTypeIdentifier: 0,
    parameters: [
      { name: 'sessionId', type: 'primitive', typeIdentifier: 0, isOptional: false,
        titleKey: 'history.session_id.parameter' },
      { name: 'authorizationSecret', type: 'primitive', typeIdentifier: 0, isOptional: false,
        titleKey: 'history.authorization.parameter' },
      { name: 'chunkIndex', type: 'primitive', typeIdentifier: 2, isOptional: false,
        titleKey: 'history.chunk.parameter' },
      { name: 'records', type: 'array', typeIdentifier: 0, isOptional: false,
        titleKey: 'history.records.parameter' },
    ],
  },
  {
    identifier: 'FinishWafraHistoryImportIntent',
    authenticationPolicy: 0,
    outputTypeIdentifier: null,
    parameters: [
      { name: 'sessionId', type: 'primitive', typeIdentifier: 0, isOptional: false,
        titleKey: 'history.session_id.parameter' },
      { name: 'authorizationSecret', type: 'primitive', typeIdentifier: 0, isOptional: false,
        titleKey: 'history.authorization.parameter' },
      { name: 'totalChunks', type: 'primitive', typeIdentifier: 2, isOptional: false,
        titleKey: 'history.total_chunks.parameter' },
      { name: 'found', type: 'primitive', typeIdentifier: 2, isOptional: false,
        titleKey: 'history.found.parameter' },
      { name: 'attempted', type: 'primitive', typeIdentifier: 2, isOptional: false,
        titleKey: 'history.attempted.parameter' },
      { name: 'accepted', type: 'primitive', typeIdentifier: 2, isOptional: false,
        titleKey: 'history.accepted.parameter' },
      { name: 'skipped', type: 'primitive', typeIdentifier: 2, isOptional: false,
        titleKey: 'history.skipped.parameter' },
    ],
  },
  {
    identifier: 'PrepareWafraHistoryMessageIntent',
    authenticationPolicy: 0,
    outputTypeIdentifier: null,
    parameters: [
      { name: 'sessionId', type: 'primitive', typeIdentifier: 0, isOptional: false,
        titleKey: 'history.session_id.parameter' },
      { name: 'found', type: 'primitive', typeIdentifier: 2, isOptional: false,
        titleKey: 'history.found.parameter' },
      { name: 'position', type: 'primitive', typeIdentifier: 2, isOptional: false,
        titleKey: 'history.position.parameter' },
      { name: 'messageGUID', type: 'primitive', typeIdentifier: 0, isOptional: true,
        titleKey: 'history.message_guid.parameter' },
      { name: 'body', type: 'primitive', typeIdentifier: 0, isOptional: true,
        titleKey: 'history.body.parameter' },
      { name: 'sender', type: 'primitive', typeIdentifier: 0, isOptional: true,
        titleKey: 'history.sender.parameter' },
      { name: 'date', type: 'primitive', typeIdentifier: 8, isOptional: true,
        titleKey: 'history.date.parameter' },
    ],
  },
  {
    identifier: 'ImportWafraPreparedHistoryIntent',
    authenticationPolicy: 2,
    outputTypeIdentifier: null,
    parameters: [
      { name: 'sessionId', type: 'primitive', typeIdentifier: 0, isOptional: false,
        titleKey: 'history.session_id.parameter' },
      { name: 'found', type: 'primitive', typeIdentifier: 2, isOptional: false,
        titleKey: 'history.found.parameter' },
    ],
  },
  {
    identifier: 'PrepareWafraHistoryMessageV2Intent',
    authenticationPolicy: 0,
    outputTypeIdentifier: null,
    parameters: [
      { name: 'sessionId', type: 'primitive', typeIdentifier: 0, isOptional: false,
        titleKey: 'history.session_id.parameter' },
      { name: 'position', type: 'primitive', typeIdentifier: 2, isOptional: false,
        titleKey: 'history.position.parameter' },
      { name: 'rangeStart', type: 'primitive', typeIdentifier: 8, isOptional: false,
        titleKey: 'history.range_start.parameter' },
      { name: 'rangeEnd', type: 'primitive', typeIdentifier: 8, isOptional: false,
        titleKey: 'history.range_end.parameter' },
      { name: 'messageGUID', type: 'primitive', typeIdentifier: 0, isOptional: true,
        titleKey: 'history.message_guid.parameter' },
      { name: 'body', type: 'primitive', typeIdentifier: 0, isOptional: true,
        titleKey: 'history.body.parameter' },
      { name: 'sender', type: 'primitive', typeIdentifier: 0, isOptional: true,
        titleKey: 'history.sender.parameter' },
      { name: 'date', type: 'primitive', typeIdentifier: 8, isOptional: true,
        titleKey: 'history.date.parameter' },
    ],
  },
  {
    identifier: 'PrepareWafraHistoryMessageV3Intent',
    authenticationPolicy: 0,
    outputTypeIdentifier: null,
    parameters: [
      { name: 'sessionId', type: 'primitive', typeIdentifier: 0, isOptional: false,
        titleKey: 'history.session_id.parameter' },
      { name: 'position', type: 'primitive', typeIdentifier: 2, isOptional: false,
        titleKey: 'history.position.parameter' },
      { name: 'messageGUID', type: 'primitive', typeIdentifier: 0, isOptional: true,
        titleKey: 'history.message_guid.parameter' },
      { name: 'body', type: 'primitive', typeIdentifier: 0, isOptional: true,
        titleKey: 'history.body.parameter' },
      { name: 'sender', type: 'primitive', typeIdentifier: 0, isOptional: true,
        titleKey: 'history.sender.parameter' },
      { name: 'date', type: 'primitive', typeIdentifier: 8, isOptional: true,
        titleKey: 'history.date.parameter' },
    ],
  },
  {
    identifier: 'ImportWafraPreparedHistoryV2Intent',
    authenticationPolicy: 2,
    outputTypeIdentifier: null,
    parameters: [
      { name: 'sessionId', type: 'primitive', typeIdentifier: 0, isOptional: false,
        titleKey: 'history.session_id.parameter' },
    ],
  },
  {
    identifier: 'DiscardWafraPreparedHistoryV2Intent',
    authenticationPolicy: 0,
    outputTypeIdentifier: null,
    parameters: [
      { name: 'sessionId', type: 'primitive', typeIdentifier: 0, isOptional: false,
        titleKey: 'history.session_id.parameter' },
    ],
  },
];
for (const expected of expectedLowLevelIntents) {
  const action = actions[expected.identifier];
  if (action.authenticationPolicy !== expected.authenticationPolicy ||
      action.isAuthPolExplicit !== true) {
    fail(`${expected.identifier} authenticationPolicy does not match the extracted contract.`);
  }
  if (action.supportedModes !== 1 || action.openAppWhenRun !== false) {
    fail(`${expected.identifier} must remain background supportedModes 1 without opening the app.`);
  }
  if (action.availabilityAnnotations?.LNPlatformNameIOS?.introducedVersion !== '26.0') {
    fail(`${expected.identifier} iOS availability must remain 26.0.`);
  }
  const outputTypeIdentifier = action.outputType == null
    ? null
    : primitiveType({ valueType: action.outputType });
  if (outputTypeIdentifier !== expected.outputTypeIdentifier || action.outputFlags !== 0) {
    fail(`${expected.identifier} output type does not match the extracted contract.`);
  }
  const parameters = (action.parameters || []).map((parameter) => ({
    name: parameter.name,
    type: parameter.valueType?.array ? 'array' : 'primitive',
    typeIdentifier: parameter.valueType?.array
      ? arrayMemberType(parameter)
      : primitiveType(parameter),
    isOptional: parameter.isOptional,
    titleKey: parameter.title?.key,
  }));
  if (JSON.stringify(parameters) !== JSON.stringify(expected.parameters)) {
    fail(`${expected.identifier} parameters do not match the extracted contract.`);
  }
}

console.log('✓ extracted App Intents metadata has the exact ten-intent history contract');
NODE
}

verify_history_resources() {
  local app_bundle="$1"
  local resource_bundle="$2"
  WAFRA_HISTORY_APP_BUNDLE="$app_bundle" \
    WAFRA_HISTORY_RESOURCE_BUNDLE="$resource_bundle" node <<'NODE'
const { execFileSync } = require('node:child_process');
const path = require('node:path');

const expectedKeys = [
  'history.accepted.parameter',
  'history.attempted.parameter',
  'history.authorization.parameter',
  'history.begin.description',
  'history.begin.error',
  'history.begin.title',
  'history.bodies.parameter',
  'history.body.parameter',
  'history.chunk.parameter',
  'history.date.parameter',
  'history.dates.parameter',
  'history.finish.description',
  'history.finish.error',
  'history.finish.title',
  'history.found.parameter',
  'history.import.description',
  'history.import.error',
  'history.import.title',
  'history.import_prepared.description',
  'history.import_prepared.error',
  'history.import_prepared.title',
  'history.prepare_v2.description',
  'history.prepare_v2.error',
  'history.prepare_v2.title',
  'history.import_prepared_v2.description',
  'history.import_prepared_v2.error',
  'history.import_prepared_v2.title',
  'history.discard_prepared_v2.description',
  'history.discard_prepared_v2.error',
  'history.discard_prepared_v2.title',
  'history.message_guid.parameter',
  'history.message_guids.parameter',
  'history.position.parameter',
  'history.range_start.parameter',
  'history.range_end.parameter',
  'history.prepare.description',
  'history.prepare.error',
  'history.prepare.title',
  'history.records.parameter',
  'history.sender.parameter',
  'history.session_id.parameter',
  'history.skipped.parameter',
  'history.stage.description',
  'history.stage.error',
  'history.stage.title',
  'history.total_chunks.parameter',
].sort();
const roots = [
  ['app main bundle', process.env.WAFRA_HISTORY_APP_BUNDLE],
  ['nested resource bundle', process.env.WAFRA_HISTORY_RESOURCE_BUNDLE],
];
const parsedTables = [];
for (const [label, root] of roots) {
  for (const locale of ['en', 'ar']) {
    const filename = path.join(root, `${locale}.lproj`, 'WafraHistoryIntents.strings');
    let table;
    try {
      table = JSON.parse(execFileSync(
        'plutil',
        ['-convert', 'json', '-o', '-', filename],
        { encoding: 'utf8' },
      ));
    } catch (error) {
      console.error(`native-history-store.sh: could not parse ${label} ${locale} table: ${error.message}`);
      process.exit(1);
    }
    const keys = Object.keys(table).sort();
    if (JSON.stringify(keys) !== JSON.stringify(expectedKeys)) {
      console.error(`native-history-store.sh: ${label} ${locale} keys ${JSON.stringify(keys)} do not match the exact 46-key contract.`);
      process.exit(1);
    }
    if (Object.values(table).some((value) => typeof value !== 'string' || value.length === 0)) {
      console.error(`native-history-store.sh: ${label} ${locale} contains an empty localization.`);
      process.exit(1);
    }
    parsedTables.push({ label, locale, table });
  }
}
for (const label of roots.map(([value]) => value)) {
  const english = parsedTables.find((entry) => entry.label === label && entry.locale === 'en').table;
  const arabic = parsedTables.find((entry) => entry.label === label && entry.locale === 'ar').table;
  if (expectedKeys.some((key) => english[key] === arabic[key])) {
    console.error(`native-history-store.sh: ${label} does not contain distinct EN and AR values for every key.`);
    process.exit(1);
  }
}
console.log('✓ app and nested resource bundles contain exact distinct EN+AR 46-key tables');
NODE

  WAFRA_HISTORY_APP_BUNDLE="$app_bundle" \
    WAFRA_HISTORY_RESOURCE_BUNDLE="$resource_bundle" xcrun swift -e '
import Foundation
let environment = ProcessInfo.processInfo.environment
let keys = [
  "history.import.title",
  "history.import.description",
  "history.import.error",
  "history.message_guids.parameter",
  "history.bodies.parameter",
  "history.dates.parameter",
  "history.prepare.title",
  "history.prepare.description",
  "history.prepare.error",
  "history.import_prepared.title",
  "history.import_prepared.description",
  "history.import_prepared.error",
  "history.prepare_v2.title",
  "history.prepare_v2.description",
  "history.prepare_v2.error",
  "history.import_prepared_v2.title",
  "history.import_prepared_v2.description",
  "history.import_prepared_v2.error",
  "history.discard_prepared_v2.title",
  "history.discard_prepared_v2.description",
  "history.discard_prepared_v2.error",
  "history.position.parameter",
  "history.range_start.parameter",
  "history.range_end.parameter",
  "history.message_guid.parameter",
  "history.body.parameter",
  "history.sender.parameter",
  "history.date.parameter",
]
guard let resourceRoot = environment["WAFRA_HISTORY_RESOURCE_BUNDLE"],
      let appRoot = environment["WAFRA_HISTORY_APP_BUNDLE"],
      let resourceArabic = Bundle(path: resourceRoot + "/ar.lproj"),
      let mainArabic = Bundle(path: appRoot + "/ar.lproj") else {
  Foundation.exit(2)
}
for bundle in [resourceArabic, mainArabic] {
  for key in keys {
    let missing = "__WAFRA_MISSING_HISTORY_LOCALIZATION__"
    let value = bundle.localizedString(forKey: key, value: missing, table: "WafraHistoryIntents")
    let hasArabic = value.unicodeScalars.contains { scalar in
      (0x0600...0x06ff).contains(Int(scalar.value))
    }
    guard value != missing, value != key, hasArabic else {
      Foundation.exit(3)
    }
  }
}
print("✓ both built bundles resolve all 28 bulk, prepared, and bounded Arabic localizations at runtime")
'
}

if [ "${1:-}" = "--verify-app-intents-metadata" ]; then
  if [ "$#" -ne 2 ]; then
    echo "usage: native-history-store.sh --verify-app-intents-metadata <extract.actionsdata>" >&2
    exit 2
  fi
  verify_app_intents_metadata "$2"
  exit
fi
if [ "${1:-}" = "--verify-history-resources" ]; then
  if [ "$#" -ne 3 ]; then
    echo "usage: native-history-store.sh --verify-history-resources <app-bundle> <resource-bundle>" >&2
    exit 2
  fi
  verify_history_resources "$2" "$3"
  exit
fi

if ! command -v swiftc >/dev/null 2>&1; then
  echo "native-history-store.sh: swiftc is required to test the iOS history bridge." >&2
  exit 1
fi

generated_intent="ios/Wafra/WafraMessageHistoryIntent.swift"
project_file="ios/Wafra.xcodeproj/project.pbxproj"
plugin_file="modules/wafra-message-history/plugin/index.js"

for file in "$generated_intent" "$project_file" "$plugin_file"; do
  if [ ! -f "$file" ]; then
    echo "native-history-store.sh: missing required native integration file: $file" >&2
    exit 1
  fi
done

for intent in \
  BeginWafraHistoryImportIntent \
  StageWafraMessageHistoryIntent \
  FinishWafraHistoryImportIntent \
  ImportWafraMessageHistoryIntent \
  PrepareWafraHistoryMessageIntent \
  ImportWafraPreparedHistoryIntent \
  PrepareWafraHistoryMessageV2Intent \
  PrepareWafraHistoryMessageV3Intent \
  ImportWafraPreparedHistoryV2Intent \
  DiscardWafraPreparedHistoryV2Intent; do
  grep -q "struct $intent: AppIntent" "$generated_intent" || {
    echo "native-history-store.sh: generated $intent is missing." >&2
    exit 1
  }
done
awk '
  /Begin PBXSourcesBuildPhase section/ { in_sources = 1 }
  /End PBXSourcesBuildPhase section/ { in_sources = 0 }
  in_sources { print }
' "$project_file" | grep -q 'WafraMessageHistoryIntent.swift in Sources' || {
  echo "native-history-store.sh: App Intent is not a member of the iOS Sources build phase." >&2
  exit 1
}
grep -q "filePath: 'WafraMessageHistoryIntent.swift'" "$plugin_file" || {
  echo "native-history-store.sh: config plugin no longer generates the App Intent." >&2
  exit 1
}

test_dir="$(mktemp -d /tmp/wafra-native-history.XXXXXX)"
trap 'rm -rf "$test_dir"' EXIT

# Host protocol tests use a metadata-only adapter because hosted macOS VMs
# cannot provide iPhone Data Protection. Production sources and every existing
# protection/tampering assertion remain unchanged. The Xcode app build below
# does NOT compile any scripts/test/support source. Real device encryption and
# locked-phone behavior require separate device testing, not a green host job.
echo "History host contracts: file-protection metadata modelled; device encryption NOT certified."
swiftc -warnings-as-errors -parse-as-library \
  scripts/test/support/host-file-protection.swift \
  scripts/test/support/host-file-protection.test.swift \
  -o "$test_dir/host-protection-model-tests"
"$test_dir/host-protection-model-tests"

swiftc \
  -warnings-as-errors \
  -parse-as-library \
  scripts/test/support/host-file-protection.swift \
  modules/wafra-message-history/ios/WafraMessageHistoryStore.swift \
  modules/wafra-message-history/ios/WafraPreparedHistoryStore.swift \
  modules/wafra-message-history/ios/WafraMessageHistoryImporter.swift \
  scripts/test/native-history-store.swift \
  -o "$test_dir/native-history-store-tests"

"$test_dir/native-history-store-tests"

if ! command -v xcodebuild >/dev/null 2>&1; then
  echo "native-history-store.sh: xcodebuild is required to verify the iOS resource bundle." >&2
  exit 1
fi

xcode_log="$test_dir/xcodebuild.log"
if ! xcodebuild \
  -workspace ios/Wafra.xcworkspace \
  -scheme Wafra \
  -configuration Debug \
  -sdk iphonesimulator \
  -destination 'generic/platform=iOS Simulator' \
  -derivedDataPath "$test_dir/DerivedData" \
  CODE_SIGNING_ALLOWED=NO \
  ONLY_ACTIVE_ARCH=YES \
  ARCHS=arm64 \
  build >"$xcode_log" 2>&1; then
  tail -n 120 "$xcode_log" >&2
  exit 1
fi

resource_bundle="$(find "$test_dir/DerivedData/Build/Products" \
  -path '*/Wafra.app/WafraMessageHistoryResources.bundle' -print -quit)"
if [ -z "$resource_bundle" ]; then
  echo "native-history-store.sh: built app is missing WafraMessageHistoryResources.bundle." >&2
  exit 1
fi
for localization in en ar; do
  table="$resource_bundle/$localization.lproj/WafraHistoryIntents.strings"
  if [ ! -f "$table" ]; then
    echo "native-history-store.sh: built resource bundle is missing $localization.lproj/WafraHistoryIntents.strings." >&2
    exit 1
  fi
done
app_bundle="$(dirname "$resource_bundle")"
for localization in en ar; do
  table="$app_bundle/$localization.lproj/WafraHistoryIntents.strings"
  if [ ! -f "$table" ]; then
    echo "native-history-store.sh: built app main bundle is missing $localization.lproj/WafraHistoryIntents.strings." >&2
    exit 1
  fi
done

metadata_file="$(find "$app_bundle/Metadata.appintents" \
  -type f -name 'extract.actionsdata' -print -quit 2>/dev/null || true)"
if [ -z "$metadata_file" ]; then
  echo "native-history-store.sh: built app is missing Metadata.appintents/extract.actionsdata." >&2
  exit 1
fi
verify_app_intents_metadata "$metadata_file"
verify_history_resources "$app_bundle" "$resource_bundle"

echo "✓ generated App Intents are in Sources and both built bundles resolve Arabic resources"
