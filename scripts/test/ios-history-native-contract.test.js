const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { spawnSync } = require('node:child_process');
const configPlugins = require('@expo/config-plugins');
const ts = require('typescript');

const ROOT = path.join(__dirname, '../..');
let passed = 0;
let failed = 0;

function ok(name, condition, detail = '') {
  if (condition) {
    passed += 1;
    console.log(`✓ ${name}`);
    return;
  }
  failed += 1;
  console.log(`✗ ${name}${detail ? `\n    ${detail}` : ''}`);
}

function eq(name, actual, expected) {
  ok(
    name,
    JSON.stringify(actual) === JSON.stringify(expected),
    `${JSON.stringify(actual)} != ${JSON.stringify(expected)}`,
  );
}

function read(relative) {
  const filename = path.join(ROOT, relative);
  if (!fs.existsSync(filename)) {
    ok(`required Task 2 file exists: ${relative}`, false, filename);
    return '';
  }
  return fs.readFileSync(filename, 'utf8');
}

function executeTypeScript(relative) {
  const filename = path.join(ROOT, relative);
  const output = ts.transpileModule(fs.readFileSync(filename, 'utf8'), {
    compilerOptions: {
      module: ts.ModuleKind.CommonJS,
      target: ts.ScriptTarget.ES2022,
      esModuleInterop: true,
    },
    fileName: filename,
  }).outputText;
  const loaded = { exports: {} };
  Function('require', 'module', 'exports', '__filename', '__dirname', output)(
    (id) => { throw new Error(`unexpected web bridge dependency: ${id}`); },
    loaded,
    loaded.exports,
    filename,
    path.dirname(filename),
  );
  return loaded.exports;
}

function localizationKeys(source) {
  return [...source.matchAll(/^\s*"([^"]+)"\s*=/gm)]
    .map((match) => match[1])
    .sort();
}

function verifyExtractedMetadata(metadata) {
  const fixtureRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'wafra-app-intents-metadata-'));
  const metadataFile = path.join(fixtureRoot, 'extract.actionsdata');
  try {
    fs.writeFileSync(metadataFile, JSON.stringify(metadata));
    return spawnSync(
      'bash',
      [path.join(ROOT, 'scripts/test/native-history-store.sh'),
        '--verify-app-intents-metadata', metadataFile],
      { cwd: ROOT, encoding: 'utf8' },
    );
  } finally {
    fs.rmSync(fixtureRoot, { recursive: true, force: true });
  }
}

function extractedHistoryIntentFixture() {
  const primitive = (typeIdentifier) => ({ primitive: { wrapper: { typeIdentifier } } });
  const array = (typeIdentifier) => ({
    array: {
      wrapper: {
        memberValueType: primitive(typeIdentifier),
      },
    },
  });
  const parameter = (name, titleKey, valueType, isOptional = false) => ({
    isOptional,
    name,
    title: { key: titleKey },
    valueType,
  });
  const intent = (authenticationPolicy, parameters, outputType) => ({
    authenticationPolicy,
    availabilityAnnotations: {
      LNPlatformNameIOS: { introducedVersion: '26.0' },
    },
    isAuthPolExplicit: true,
    openAppWhenRun: false,
    outputFlags: 0,
    ...(outputType === null ? {} : { outputType }),
    parameters,
    supportedModes: 1,
  });
  return {
    actions: {
      BeginWafraHistoryImportIntent: intent(2, [
        parameter('sessionId', 'history.session_id.parameter', primitive(0)),
      ], primitive(0)),
      FinishWafraHistoryImportIntent: intent(0, [
        parameter('sessionId', 'history.session_id.parameter', primitive(0)),
        parameter('authorizationSecret', 'history.authorization.parameter', primitive(0)),
        parameter('totalChunks', 'history.total_chunks.parameter', primitive(2)),
        parameter('found', 'history.found.parameter', primitive(2)),
        parameter('attempted', 'history.attempted.parameter', primitive(2)),
        parameter('accepted', 'history.accepted.parameter', primitive(2)),
        parameter('skipped', 'history.skipped.parameter', primitive(2)),
      ], null),
      ImportWafraMessageHistoryIntent: intent(2, [
        parameter('sessionId', 'history.session_id.parameter', primitive(0)),
        parameter('found', 'history.found.parameter', primitive(2)),
        parameter('messageGUIDs', 'history.message_guids.parameter', array(0)),
        parameter('bodies', 'history.bodies.parameter', array(0)),
        parameter('dates', 'history.dates.parameter', array(8)),
      ], null),
      ImportWafraPreparedHistoryIntent: intent(2, [
        parameter('sessionId', 'history.session_id.parameter', primitive(0)),
        parameter('found', 'history.found.parameter', primitive(2)),
      ], null),
      PrepareWafraHistoryMessageIntent: intent(0, [
        parameter('sessionId', 'history.session_id.parameter', primitive(0)),
        parameter('found', 'history.found.parameter', primitive(2)),
        parameter('position', 'history.position.parameter', primitive(2)),
        parameter('messageGUID', 'history.message_guid.parameter', primitive(0), true),
        parameter('body', 'history.body.parameter', primitive(0), true),
        parameter('sender', 'history.sender.parameter', primitive(0), true),
        parameter('date', 'history.date.parameter', primitive(8), true),
      ], null),
      PrepareWafraHistoryMessageV2Intent: intent(0, [
        parameter('sessionId', 'history.session_id.parameter', primitive(0)),
        parameter('position', 'history.position.parameter', primitive(2)),
        parameter('rangeStart', 'history.range_start.parameter', primitive(8)),
        parameter('rangeEnd', 'history.range_end.parameter', primitive(8)),
        parameter('messageGUID', 'history.message_guid.parameter', primitive(0), true),
        parameter('body', 'history.body.parameter', primitive(0), true),
        parameter('sender', 'history.sender.parameter', primitive(0), true),
        parameter('date', 'history.date.parameter', primitive(8), true),
      ], null),
      PrepareWafraHistoryMessageV3Intent: intent(0, [
        parameter('sessionId', 'history.session_id.parameter', primitive(0)),
        parameter('position', 'history.position.parameter', primitive(2)),
        parameter('messageGUID', 'history.message_guid.parameter', primitive(0), true),
        parameter('body', 'history.body.parameter', primitive(0), true),
        parameter('sender', 'history.sender.parameter', primitive(0), true),
        parameter('date', 'history.date.parameter', primitive(8), true),
      ], null),
      ImportWafraPreparedHistoryV2Intent: intent(2, [
        parameter('sessionId', 'history.session_id.parameter', primitive(0)),
      ], null),
      DiscardWafraPreparedHistoryV2Intent: intent(0, [
        parameter('sessionId', 'history.session_id.parameter', primitive(0)),
      ], null),
      StageWafraMessageHistoryIntent: intent(0, [
        parameter('sessionId', 'history.session_id.parameter', primitive(0)),
        parameter('authorizationSecret', 'history.authorization.parameter', primitive(0)),
        parameter('chunkIndex', 'history.chunk.parameter', primitive(2)),
        parameter('records', 'history.records.parameter', array(0)),
      ], primitive(0)),
      StageWafraShortcutHistoryIntent: intent(0, [
        parameter('sessionId', 'history.session_id.parameter', primitive(0)),
        parameter('authorizationSecret', 'history.authorization.parameter', primitive(0)),
        parameter('chunkIndex', 'history.chunk.parameter', primitive(2)),
        parameter('records', 'history.records.parameter', array(0)),
      ], primitive(0)),
    },
  };
}

function captureHistoryIntentPlugin() {
  const pluginPath = path.join(ROOT, 'modules/wafra-message-history/plugin/index.js');
  const xcodeProjectFile = configPlugins.IOSConfig.XcodeProjectFile;
  const original = xcodeProjectFile.withBuildSourceFile;
  const invocations = [];
  xcodeProjectFile.withBuildSourceFile = (config, options) => {
    invocations.push(options);
    return config;
  };
  delete require.cache[require.resolve(pluginPath)];
  try {
    require(pluginPath)({
      name: 'Wafra',
      slug: 'wafra',
      ios: { bundleIdentifier: 'app.wafra.ios' },
    });
  } finally {
    xcodeProjectFile.withBuildSourceFile = original;
    delete require.cache[require.resolve(pluginPath)];
  }
  return invocations;
}

function swiftBracedBlock(source, declarationIndex) {
  if (declarationIndex < 0) return '';
  const openingBrace = source.indexOf('{', declarationIndex);
  if (openingBrace < 0) return '';
  let depth = 0;
  let mode = 'code';
  let blockCommentDepth = 0;
  for (let index = openingBrace; index < source.length; index += 1) {
    const character = source[index];
    const next = source[index + 1];
    if (mode === 'line-comment') {
      if (character === '\n') mode = 'code';
      continue;
    }
    if (mode === 'block-comment') {
      if (character === '/' && next === '*') {
        blockCommentDepth += 1;
        index += 1;
      } else if (character === '*' && next === '/') {
        blockCommentDepth -= 1;
        index += 1;
        if (blockCommentDepth === 0) mode = 'code';
      }
      continue;
    }
    if (mode === 'string') {
      if (character === '\\') {
        index += 1;
      } else if (character === '"') {
        mode = 'code';
      }
      continue;
    }
    if (character === '/' && next === '/') {
      mode = 'line-comment';
      index += 1;
      continue;
    }
    if (character === '/' && next === '*') {
      mode = 'block-comment';
      blockCommentDepth = 1;
      index += 1;
      continue;
    }
    if (character === '"') {
      mode = 'string';
      continue;
    }
    if (character === '{') depth += 1;
    if (character !== '}') continue;
    depth -= 1;
    if (depth === 0) return source.slice(declarationIndex, index + 1);
  }
  return '';
}

function swiftIntent(source, name) {
  const declaration = new RegExp(`struct\\s+${name}:\\s*AppIntent`).exec(source);
  return declaration ? swiftBracedBlock(source, declaration.index) : '';
}

function swiftFunction(source, name) {
  const declaration = new RegExp(`func\\s+${name}\\s*\\(`).exec(source);
  return declaration ? swiftBracedBlock(source, declaration.index) : '';
}

const historyIntentNames = [
  'BeginWafraHistoryImportIntent',
  'StageWafraMessageHistoryIntent',
  'FinishWafraHistoryImportIntent',
  'ImportWafraMessageHistoryIntent',
  'PrepareWafraHistoryMessageIntent',
  'ImportWafraPreparedHistoryIntent',
  'PrepareWafraHistoryMessageV2Intent',
  'PrepareWafraHistoryMessageV3Intent',
  'ImportWafraPreparedHistoryV2Intent',
  'DiscardWafraPreparedHistoryV2Intent',
  'StageWafraShortcutHistoryIntent',
];

function historyIntentPolicyContract(source) {
  const [
    begin,
    stage,
    finish,
    bulk,
    prepare,
    preparedImport,
    prepareV2,
    prepareV3,
    preparedImportV2,
    discardV2,
    shortcutStage,
  ] = historyIntentNames
    .map((name) => swiftIntent(source, name));
  const hasExactPolicy = (intent, required, forbidden) =>
    (intent.match(/authenticationPolicy:\s*IntentAuthenticationPolicy\s*=\s*\.[A-Za-z]+/g) || [])
      .length === 1 &&
    new RegExp(`authenticationPolicy:\\s*IntentAuthenticationPolicy\\s*=\\s*\\.${required}`)
      .test(intent) &&
    !new RegExp(`authenticationPolicy:\\s*IntentAuthenticationPolicy\\s*=\\s*\\.${forbidden}`)
      .test(intent);
  return Boolean(
    begin && stage && finish && bulk && prepare && preparedImport &&
      prepareV2 && prepareV3 && preparedImportV2 && discardV2 && shortcutStage
  ) &&
    hasExactPolicy(begin, 'requiresLocalDeviceAuthentication', 'alwaysAllowed') &&
    hasExactPolicy(stage, 'alwaysAllowed', 'requiresLocalDeviceAuthentication') &&
    hasExactPolicy(finish, 'alwaysAllowed', 'requiresLocalDeviceAuthentication') &&
    hasExactPolicy(bulk, 'requiresLocalDeviceAuthentication', 'alwaysAllowed') &&
    hasExactPolicy(prepare, 'alwaysAllowed', 'requiresLocalDeviceAuthentication') &&
    hasExactPolicy(preparedImport, 'requiresLocalDeviceAuthentication', 'alwaysAllowed') &&
    hasExactPolicy(prepareV2, 'alwaysAllowed', 'requiresLocalDeviceAuthentication') &&
    hasExactPolicy(prepareV3, 'alwaysAllowed', 'requiresLocalDeviceAuthentication') &&
    hasExactPolicy(preparedImportV2, 'requiresLocalDeviceAuthentication', 'alwaysAllowed') &&
    hasExactPolicy(discardV2, 'alwaysAllowed', 'requiresLocalDeviceAuthentication') &&
    hasExactPolicy(shortcutStage, 'alwaysAllowed', 'requiresLocalDeviceAuthentication');
}

function historyIntentAvailabilityContract(source) {
  return historyIntentNames.every((name) => {
    const intent = swiftIntent(source, name);
    const availability = new RegExp(
      `@available\\(iOS 26\\.0, \\*\\)\\s*struct\\s+${name}:\\s*AppIntent`,
    );
    return availability.test(source) &&
      (intent.match(/supportedModes:\s*IntentModes\s*=\s*\.[A-Za-z]+/g) || []).length === 1 &&
      /supportedModes:\s*IntentModes\s*=\s*\.background/.test(intent);
  });
}

function stageOutputContract(source, shortcut = false) {
  const stage = swiftIntent(source, shortcut ? 'StageWafraShortcutHistoryIntent' : 'StageWafraMessageHistoryIntent');
  const perform = swiftFunction(stage, 'perform');
  return Boolean(perform) &&
    (shortcut
      ? /let counts = try WafraMessageHistoryStore\.shared\.stageShortcutChunk\(/.test(perform)
      : /let counts = try WafraMessageHistoryStore\.shared\.stageChunk\(/.test(perform)) &&
    /let value = "\{\\"attempted\\":\\\(counts\.attempted\),\\"accepted\\":\\\(counts\.accepted\),\\"skipped\\":\\\(counts\.skipped\)\}"/
      .test(perform) &&
    (perform.match(/return\s+\.result\(/g) || []).length === 1 &&
    (perform.match(/return\s+\.result\(value:\s*value\)/g) || []).length === 1;
}

function finishOutputContract(source) {
  const finish = swiftIntent(source, 'FinishWafraHistoryImportIntent');
  const perform = swiftFunction(finish, 'perform');
  return Boolean(perform) &&
    /func\s+perform\(\)\s+async\s+throws\s+->\s+some\s+IntentResult\s*\{/.test(perform) &&
    (perform.match(/return\s+\.result\(\)/g) || []).length === 1 &&
    !/ReturnsValue|return\s+\.result\(value:/.test(finish);
}

function swiftParameters(intent) {
  return [...intent.matchAll(
    /@Parameter\(\s*title:\s*LocalizedStringResource\(\s*"([^"]+)",[\s\S]*?\)\s*\)\s*var\s+([A-Za-z_]\w*):\s*([^\n]+)/g,
  )].map((match) => ({
    titleKey: match[1],
    name: match[2],
    type: match[3].trim(),
  }));
}

function bulkImportContract(source) {
  const bulk = swiftIntent(source, 'ImportWafraMessageHistoryIntent');
  const perform = swiftFunction(bulk, 'perform');
  const exactParameters = [
    { titleKey: 'history.session_id.parameter', name: 'sessionId', type: 'String' },
    { titleKey: 'history.found.parameter', name: 'found', type: 'Int' },
    { titleKey: 'history.message_guids.parameter', name: 'messageGUIDs', type: '[String]' },
    { titleKey: 'history.bodies.parameter', name: 'bodies', type: '[String]' },
    { titleKey: 'history.dates.parameter', name: 'dates', type: '[Date]' },
  ];
  return Boolean(bulk && perform) &&
    JSON.stringify(swiftParameters(bulk)) === JSON.stringify(exactParameters) &&
    (perform.match(/WafraMessageHistoryImporter\.shared\.importMessages\(/g) || []).length === 1 &&
    /_ = try WafraMessageHistoryImporter\.shared\.importMessages\(/.test(perform) &&
    /sessionId:\s*sessionId/.test(perform) &&
    /found:\s*found/.test(perform) &&
    /messageGUIDs:\s*messageGUIDs/.test(perform) &&
    /bodies:\s*bodies/.test(perform) &&
    /dates:\s*dates/.test(perform) &&
    (perform.match(/return\s+\.result\(\)/g) || []).length === 1 &&
    !/ReturnsValue|return\s+\.result\(value:/.test(bulk);
}

function preparedMessageContract(source) {
  const prepare = swiftIntent(source, 'PrepareWafraHistoryMessageIntent');
  const perform = swiftFunction(prepare, 'perform');
  const exactParameters = [
    { titleKey: 'history.session_id.parameter', name: 'sessionId', type: 'String' },
    { titleKey: 'history.found.parameter', name: 'found', type: 'Int' },
    { titleKey: 'history.position.parameter', name: 'position', type: 'Int' },
    { titleKey: 'history.message_guid.parameter', name: 'messageGUID', type: 'String?' },
    { titleKey: 'history.body.parameter', name: 'body', type: 'String?' },
    { titleKey: 'history.sender.parameter', name: 'sender', type: 'String?' },
    { titleKey: 'history.date.parameter', name: 'date', type: 'Date?' },
  ];
  return Boolean(prepare && perform) &&
    JSON.stringify(swiftParameters(prepare)) === JSON.stringify(exactParameters) &&
    (perform.match(/WafraPreparedHistoryStore\.shared\.prepare\(/g) || []).length === 1 &&
    /try WafraPreparedHistoryStore\.shared\.prepare\(/.test(perform) &&
    /sessionId:\s*sessionId/.test(perform) &&
    /found:\s*found/.test(perform) &&
    /position:\s*position/.test(perform) &&
    /guid:\s*messageGUID/.test(perform) &&
    /body:\s*body/.test(perform) &&
    /sender:\s*sender/.test(perform) &&
    /date:\s*date/.test(perform) &&
    (perform.match(/return\s+\.result\(\)/g) || []).length === 1 &&
    !/ReturnsValue|ProvidesDialog|return\s+\.result\([^)]*value:|return\s+\.result\([^)]*dialog:/.test(prepare);
}

function preparedImportContract(source) {
  const preparedImport = swiftIntent(source, 'ImportWafraPreparedHistoryIntent');
  const perform = swiftFunction(preparedImport, 'perform');
  const exactParameters = [
    { titleKey: 'history.session_id.parameter', name: 'sessionId', type: 'String' },
    { titleKey: 'history.found.parameter', name: 'found', type: 'Int' },
  ];
  return Boolean(preparedImport && perform) &&
    JSON.stringify(swiftParameters(preparedImport)) === JSON.stringify(exactParameters) &&
    (perform.match(/WafraMessageHistoryImporter\.shared\.importPrepared\(/g) || []).length === 1 &&
    /_ = try WafraMessageHistoryImporter\.shared\.importPrepared\(/.test(perform) &&
    /sessionId:\s*sessionId/.test(perform) &&
    /found:\s*found/.test(perform) &&
    (perform.match(/return\s+\.result\(\)/g) || []).length === 1 &&
    !/ReturnsValue|ProvidesDialog|return\s+\.result\([^)]*value:|return\s+\.result\([^)]*dialog:/.test(preparedImport);
}

function preparedMessageV2Contract(source) {
  const prepare = swiftIntent(source, 'PrepareWafraHistoryMessageV2Intent');
  const perform = swiftFunction(prepare, 'perform');
  const exactParameters = [
    { titleKey: 'history.session_id.parameter', name: 'sessionId', type: 'String' },
    { titleKey: 'history.position.parameter', name: 'position', type: 'Int' },
    { titleKey: 'history.range_start.parameter', name: 'rangeStart', type: 'Date' },
    { titleKey: 'history.range_end.parameter', name: 'rangeEnd', type: 'Date' },
    { titleKey: 'history.message_guid.parameter', name: 'messageGUID', type: 'String?' },
    { titleKey: 'history.body.parameter', name: 'body', type: 'String?' },
    { titleKey: 'history.sender.parameter', name: 'sender', type: 'String?' },
    { titleKey: 'history.date.parameter', name: 'date', type: 'Date?' },
  ];
  return Boolean(prepare && perform) &&
    JSON.stringify(swiftParameters(prepare)) === JSON.stringify(exactParameters) &&
    (perform.match(/WafraPreparedHistoryStore\.shared\.prepareV2\(/g) || []).length === 1 &&
    /try WafraPreparedHistoryStore\.shared\.prepareV2\(/.test(perform) &&
    /sessionId:\s*sessionId/.test(perform) &&
    /position:\s*position/.test(perform) &&
    /rangeStart:\s*rangeStart/.test(perform) &&
    /rangeEnd:\s*rangeEnd/.test(perform) &&
    /guid:\s*messageGUID/.test(perform) &&
    /body:\s*body/.test(perform) &&
    /sender:\s*sender/.test(perform) &&
    /date:\s*date/.test(perform) &&
    !/\bfound\b/.test(prepare) &&
    (perform.match(/return\s+\.result\(\)/g) || []).length === 1 &&
    !/ReturnsValue|ProvidesDialog|return\s+\.result\([^)]*value:|return\s+\.result\([^)]*dialog:/.test(prepare);
}

function preparedImportV2Contract(source) {
  const intent = swiftIntent(source, 'ImportWafraPreparedHistoryV2Intent');
  const perform = swiftFunction(intent, 'perform');
  const exactParameters = [
    { titleKey: 'history.session_id.parameter', name: 'sessionId', type: 'String' },
  ];
  return Boolean(intent && perform) &&
    JSON.stringify(swiftParameters(intent)) === JSON.stringify(exactParameters) &&
    (perform.match(/WafraMessageHistoryImporter\.shared\.importPreparedV2\(/g) || []).length === 1 &&
    /try WafraMessageHistoryImporter\.shared\.importPreparedV2\(sessionId:\s*sessionId\)/
      .test(perform) &&
    (perform.match(/return\s+\.result\(\)/g) || []).length === 1 &&
    !/ReturnsValue|ProvidesDialog|return\s+\.result\([^)]*value:|return\s+\.result\([^)]*dialog:/.test(intent);
}

function preparedMessageV3Contract(source) {
  const prepare = swiftIntent(source, 'PrepareWafraHistoryMessageV3Intent');
  const perform = swiftFunction(prepare, 'perform');
  const exactParameters = [
    { titleKey: 'history.session_id.parameter', name: 'sessionId', type: 'String' },
    { titleKey: 'history.position.parameter', name: 'position', type: 'Int' },
    { titleKey: 'history.message_guid.parameter', name: 'messageGUID', type: 'String?' },
    { titleKey: 'history.body.parameter', name: 'body', type: 'String?' },
    { titleKey: 'history.sender.parameter', name: 'sender', type: 'String?' },
    { titleKey: 'history.date.parameter', name: 'date', type: 'Date?' },
  ];
  return Boolean(prepare && perform) &&
    /static let title\s*=\s*LocalizedStringResource\(\s*"history\.prepare_v2\.title",/
      .test(prepare) &&
    /static let description\s*=\s*IntentDescription\(\s*LocalizedStringResource\(\s*"history\.prepare_v2\.description",/
      .test(prepare) &&
    JSON.stringify(swiftParameters(prepare)) === JSON.stringify(exactParameters) &&
    (perform.match(/WafraPreparedHistoryStore\.shared\.prepareV3\(/g) || []).length === 1 &&
    /try WafraPreparedHistoryStore\.shared\.prepareV3\(/.test(perform) &&
    /sessionId:\s*sessionId/.test(perform) &&
    /position:\s*position/.test(perform) &&
    /guid:\s*messageGUID/.test(perform) &&
    /body:\s*body/.test(perform) &&
    /sender:\s*sender/.test(perform) &&
    /date:\s*date/.test(perform) &&
    /catch\s*\{\s*throw\s+WafraHistoryIntentError\.prepareV3Failed\s*\}/.test(perform) &&
    (perform.match(/throw\s+WafraHistoryIntentError\.prepareV3Failed/g) || []).length === 1 &&
    !/\b(?:found|rangeStart|rangeEnd)\b/.test(prepare) &&
    (perform.match(/return\s+\.result\(\)/g) || []).length === 1 &&
    !/ReturnsValue|ProvidesDialog|return\s+\.result\([^)]*value:|return\s+\.result\([^)]*dialog:/.test(prepare);
}

function preparedMessageV3ErrorLocalizationContract(source) {
  const declarationIndex = source.indexOf('private enum WafraHistoryIntentError');
  const errors = swiftBracedBlock(source, declarationIndex);
  return Boolean(errors) &&
    (errors.match(/\bcase\s+prepareV3Failed\b/g) || []).length === 1 &&
    (errors.match(
      /case\s+\.prepareV3Failed:\s*return\s+WafraMessageHistoryResources\.localized\("history\.prepare_v2\.error"\)/g,
    ) || []).length === 1;
}

function discardPreparedV2Contract(source) {
  const intent = swiftIntent(source, 'DiscardWafraPreparedHistoryV2Intent');
  const perform = swiftFunction(intent, 'perform');
  const exactParameters = [
    { titleKey: 'history.session_id.parameter', name: 'sessionId', type: 'String' },
  ];
  return Boolean(intent && perform) &&
    JSON.stringify(swiftParameters(intent)) === JSON.stringify(exactParameters) &&
    (perform.match(/WafraPreparedHistoryStore\.shared\.discardPrepared\(/g) || []).length === 1 &&
    /try WafraPreparedHistoryStore\.shared\.discardPrepared\(sessionId:\s*sessionId\)/
      .test(perform) &&
    (perform.match(/return\s+\.result\(\)/g) || []).length === 1 &&
    !/ReturnsValue|ProvidesDialog|return\s+\.result\([^)]*value:|return\s+\.result\([^)]*dialog:/.test(intent);
}

(async () => {
  const types = read('modules/wafra-message-history/src/WafraMessageHistory.types.ts');
  const web = read('modules/wafra-message-history/src/WafraMessageHistoryModule.web.ts');
  const swiftModule = read('modules/wafra-message-history/ios/WafraMessageHistoryModule.swift');
  const preparedStore = read(
    'modules/wafra-message-history/ios/WafraPreparedHistoryStore.swift',
  );
  const resources = read('modules/wafra-message-history/ios/WafraMessageHistoryResources.swift');
  const podspec = read('modules/wafra-message-history/ios/WafraMessageHistory.podspec');
  const plugin = read('modules/wafra-message-history/plugin/index.js');
  const firstPluginInvocations = captureHistoryIntentPlugin();
  const generated = firstPluginInvocations[0]?.contents || '';
  const shortcutStage = swiftIntent(generated, 'StageWafraShortcutHistoryIntent');
  ok('Shortcut Stage exposes a separate native offset adapter',
    Boolean(shortcutStage) && /shared\.stageShortcutChunk\(/.test(shortcutStage), 'new adapter intent missing');

  const appConsumer = read('src/app/import-sms.tsx');
  const english = read(
    'modules/wafra-message-history/ios/Resources/en.lproj/WafraHistoryIntents.strings',
  );
  const arabic = read(
    'modules/wafra-message-history/ios/Resources/ar.lproj/WafraHistoryIntents.strings',
  );

  const exactTypes = `
    export interface CompletedHistorySession {
      chunkIndices: number[];
      found: number;
      attempted: number;
      accepted: number;
      skipped: number;
    }

    export interface WafraHistoryNativeModule {
      getCompletedSession(sessionId: string): Promise<CompletedHistorySession | null>;
      recoverCompletedSession(startedAfterMs: number): Promise<(CompletedHistorySession & { sessionId: string }) | null>;
      readChunk(sessionId: string, chunkIndex: number): Promise<string[]>;
      discardSession(sessionId: string): Promise<void>;
      purgeExpired(): Promise<number>;
      eraseAll(): Promise<void>;
    }
  `.replace(/\s+/g, ' ').trim();
  eq(
    'TypeScript exposes only the completed-history bridge contract',
    types.replace(/\/\*[^]*?\*\//g, '').replace(/^\s*paged\?: boolean;\s*$/gm, '')
      .replace(/^\s*getPagedStatus\?\(\): Promise<string \| null>;\s*$/gm, '')
      .replace(/^\s*discardPagedHistory\?\(\): Promise<void>;\s*$/gm, '').replace(/\s+/g, ' ').trim(),
    exactTypes,
  );

  ok(
    'web bridge has the exact fail-closed method set',
    /getCompletedSession/.test(web) && /recoverCompletedSession/.test(web) && /readChunk/.test(web) &&
      /discardSession/.test(web) && /purgeExpired/.test(web) && /eraseAll/.test(web) &&
      !/beginSession|stageChunk|finishSession|listSessionChunks/.test(web),
    web,
  );
  if (web && ['getCompletedSession', 'recoverCompletedSession', 'readChunk', 'discardSession', 'purgeExpired', 'eraseAll']
    .every((method) => typeof executeTypeScript(
      'modules/wafra-message-history/src/WafraMessageHistoryModule.web.ts',
    ).default?.[method] === 'function')) {
    const webBridge = executeTypeScript(
      'modules/wafra-message-history/src/WafraMessageHistoryModule.web.ts',
    ).default;
    eq('web completed lookup returns null', await webBridge.getCompletedSession('session'), null);
    eq('web completed recovery returns null without exposing native state',
      await webBridge.recoverCompletedSession(Date.now()), null);
    eq('web chunk read returns no source records', await webBridge.readChunk('session', 0), []);
    eq('web expiry purge reports no native deletion', await webBridge.purgeExpired(), 0);
    eq('web discard and erase expose no staging result', [
      await webBridge.discardSession('session'),
      await webBridge.eraseAll(),
    ], [undefined, undefined]);
  } else {
    ok('web bridge runtime implements every completed-only method', false, web);
  }

  const bridgeMethods = [
    'getCompletedSession',
    'recoverCompletedSession',
    'readChunk',
    'discardSession',
    'purgeExpired',
    'eraseAll',
    'getPagedStatus',
    'discardPagedHistory',
  ];
  eq(
    'Swift bridge exports the exact completed-only method set',
    [...swiftModule.matchAll(/AsyncFunction\("([^"]+)"/g)].map((match) => match[1]),
    bridgeMethods,
  );
  ok(
    'completed lookup maps every authoritative descriptor field',
    /WafraMessageHistoryStore\.shared\.completedSession\(\s*sessionId:\s*sessionId\s*\)/
      .test(swiftModule) &&
      ['chunkIndices', 'found', 'attempted', 'accepted', 'skipped']
        .every((field) => new RegExp(`record\\.${field}\\s*=\\s*descriptor\\.${field}`).test(swiftModule)),
    swiftModule,
  );
  const recoveryStart = swiftModule.indexOf('AsyncFunction("recoverCompletedSession")');
  const recoveryEnd = swiftModule.indexOf('AsyncFunction("readChunk")');
  const recoveryBridge = recoveryStart >= 0 && recoveryEnd > recoveryStart
    ? swiftModule.slice(recoveryStart, recoveryEnd)
    : '';
  ok(
    'completed recovery accepts only a millisecond cutoff and maps no source records',
    /\(startedAfterMs:\s*Double\)/.test(recoveryBridge) &&
      /recoverCompletedSession\(\s*startedAfter:/.test(recoveryBridge) &&
      ['sessionId', 'chunkIndices', 'found', 'attempted', 'accepted', 'skipped']
        .every((field) => new RegExp(`record\\.${field}\\s*=\\s*recovered\\.${field}`).test(recoveryBridge)) &&
      !/readChunk|recordIDs|records|text|sender|receivedAt/.test(recoveryBridge),
    recoveryBridge,
  );
  const readStart = swiftModule.indexOf('AsyncFunction("readChunk")');
  const readEnd = swiftModule.indexOf('AsyncFunction("discardSession")');
  const readBridge = readStart >= 0 && readEnd > readStart
    ? swiftModule.slice(readStart, readEnd)
    : '';
  const cleanupWiringStart = preparedStore.indexOf(
    'static let shared = WafraHistoryCleanupCoordinator(',
  );
  const cleanupWiringEnd = preparedStore.indexOf(
    'private let discardCompleted',
    cleanupWiringStart,
  );
  const cleanupWiring = cleanupWiringStart >= 0 && cleanupWiringEnd > cleanupWiringStart
    ? preparedStore.slice(cleanupWiringStart, cleanupWiringEnd)
    : '';
  ok(
    'bridge refuses a chunk until the completed descriptor lists its index',
    /completedSession\(\s*sessionId:\s*sessionId\s*\)/.test(readBridge) &&
      /chunkIndices\.contains\(chunkIndex\)/.test(readBridge) &&
      readBridge.indexOf('completedSession(') < readBridge.indexOf('WafraMessageHistoryStore.shared.readChunk(') &&
      /WafraPagedHistoryStore.shared.readChunk\(/.test(readBridge) &&
      /guard head.sessionId == sessionId, head.checkpoint.complete else/.test(read('modules/wafra-message-history/ios/WafraPagedHistoryStore.swift')) &&
      /if offset < head.pages\[index\].chunks/.test(read('modules/wafra-message-history/ios/WafraPagedHistoryStore.swift')),
    readBridge,
  );
  ok(
    'bridge maps every cleanup operation through the two-store coordinator',
    /WafraHistoryCleanupCoordinator\.shared\.discardSession\(sessionId:\s*sessionId\)/
      .test(swiftModule) &&
      /WafraHistoryCleanupCoordinator\.shared\.purgeExpired\(now:\s*Date\(\)\)/
        .test(swiftModule) &&
      /WafraHistoryCleanupCoordinator\.shared\.eraseAll\(\)/.test(swiftModule) &&
      !/Wafra(?:Message|Prepared)HistoryStore\.shared\.(?:discardSession|discardPrepared|purgeExpired|eraseAll)/
        .test(swiftModule) &&
      /WafraMessageHistoryStore\.shared\.discardSession\(sessionId:\s*\$0\)/
        .test(cleanupWiring) &&
      /WafraPreparedHistoryStore\.shared\.discardPrepared\(sessionId:\s*\$0\)/
        .test(cleanupWiring) &&
      /WafraMessageHistoryStore\.shared\.purgeExpired\(now:\s*\$0\)/
        .test(cleanupWiring) &&
      /WafraPreparedHistoryStore\.shared\.purgeExpired\(now:\s*\$0\)/
        .test(cleanupWiring) &&
      /WafraMessageHistoryStore\.shared\.eraseAll\(\)/.test(cleanupWiring) &&
      /WafraPreparedHistoryStore\.shared\.eraseAll\(\)/.test(cleanupWiring) &&
      !/AsyncFunction\("(?:beginSession|stageChunk|finishSession|listSessionChunks)"/.test(swiftModule),
    `${swiftModule}\n${cleanupWiring}`,
  );
  ok(
    'app consumer delegates completed-session loading to the bounded coordinator',
    /loadIosHistorySession\(\{/.test(appConsumer) &&
      !/\.(?:listSessionChunks|getCompletedSession|readChunk)\(/.test(appConsumer),
    appConsumer,
  );

  eq('generated source declares exactly one of all eleven history intents', [
    generated.match(/struct BeginWafraHistoryImportIntent:\s*AppIntent/g)?.length || 0,
    generated.match(/struct StageWafraMessageHistoryIntent:\s*AppIntent/g)?.length || 0,
    generated.match(/struct FinishWafraHistoryImportIntent:\s*AppIntent/g)?.length || 0,
    generated.match(/struct ImportWafraMessageHistoryIntent:\s*AppIntent/g)?.length || 0,
    generated.match(/struct PrepareWafraHistoryMessageIntent:\s*AppIntent/g)?.length || 0,
    generated.match(/struct ImportWafraPreparedHistoryIntent:\s*AppIntent/g)?.length || 0,
    generated.match(/struct PrepareWafraHistoryMessageV2Intent:\s*AppIntent/g)?.length || 0,
    generated.match(/struct PrepareWafraHistoryMessageV3Intent:\s*AppIntent/g)?.length || 0,
    generated.match(/struct ImportWafraPreparedHistoryV2Intent:\s*AppIntent/g)?.length || 0,
    generated.match(/struct DiscardWafraPreparedHistoryV2Intent:\s*AppIntent/g)?.length || 0,
    generated.match(/struct StageWafraShortcutHistoryIntent:\s*AppIntent/g)?.length || 0,
  ], [1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1]);
  ok('each history intent is iOS 26 and background-only in its own struct',
    historyIntentAvailabilityContract(generated), generated);
  ok('each history intent has its required authentication policy in its own struct',
    historyIntentPolicyContract(generated), generated);
  const beginIntent = swiftIntent(generated, 'BeginWafraHistoryImportIntent');
  const stageIntent = swiftIntent(generated, 'StageWafraMessageHistoryIntent');
  eq('Shortcut Stage binds exact legacy scalar authorization and record-list parameters',
    swiftParameters(shortcutStage), swiftParameters(stageIntent));
  ok('Shortcut Stage returns only authoritative counts without opening or finishing history',
    stageOutputContract(generated, true) &&
      !/OpenURL|openAppWhenRun|finishSession|openURL|ImportWafra|readChunk/.test(shortcutStage), shortcutStage);
  ok('Shortcut Stage contract rejects accidental strict-store dispatch',
    !stageOutputContract(generated.replace(shortcutStage,
      shortcutStage.replace('shared.stageShortcutChunk(', 'shared.stageChunk(')), true));

  const bulkIntent = swiftIntent(generated, 'ImportWafraMessageHistoryIntent');
  const prepareIntent = swiftIntent(generated, 'PrepareWafraHistoryMessageIntent');
  const preparedImportIntent = swiftIntent(generated, 'ImportWafraPreparedHistoryIntent');
  const prepareV2Intent = swiftIntent(generated, 'PrepareWafraHistoryMessageV2Intent');
  const prepareV3Intent = swiftIntent(generated, 'PrepareWafraHistoryMessageV3Intent');
  const preparedImportV2Intent = swiftIntent(
    generated,
    'ImportWafraPreparedHistoryV2Intent',
  );
  const discardV2Intent = swiftIntent(
    generated,
    'DiscardWafraPreparedHistoryV2Intent',
  );
  const swappedPolicySource = generated
    .replace(
      beginIntent,
      beginIntent.replace('.requiresLocalDeviceAuthentication', '.alwaysAllowed'),
    )
    .replace(
      stageIntent,
      stageIntent.replace('.alwaysAllowed', '.requiresLocalDeviceAuthentication'),
    );
  ok('policy contract rejects swapped Begin and Stage authentication policies',
    !historyIntentPolicyContract(swappedPolicySource), swappedPolicySource);
  const swappedPreparedPolicySource = generated
    .replace(
      prepareIntent,
      prepareIntent.replace('.alwaysAllowed', '.requiresLocalDeviceAuthentication'),
    )
    .replace(
      preparedImportIntent,
      preparedImportIntent.replace('.requiresLocalDeviceAuthentication', '.alwaysAllowed'),
    );
  ok('policy contract rejects swapped Prepare and Import Prepared authentication policies',
    !historyIntentPolicyContract(swappedPreparedPolicySource), swappedPreparedPolicySource);
  ok(
    'intent source has no dialog, URL, log, notification, clipboard, or file sink',
    !/(?:ProvidesDialog|dialog\s*:|https?:|\bURL\s*\(|URLSession|FileManager|UIPasteboard|clipboard|\bprint\s*\(|os_log|Logger\s*\(|UNUserNotificationCenter|notification)/i
      .test(generated),
    generated,
  );
  ok('Stage perform returns only its exact source-free count JSON object',
    stageOutputContract(generated), stageIntent);
  const leakingStageSource = generated.replace(
    stageIntent,
    stageIntent.replace(
      'return .result(value: value)',
      'return .result(value: authorizationSecret)',
    ),
  );
  ok('Stage output contract rejects a returned authorization-secret leak',
    !stageOutputContract(leakingStageSource), leakingStageSource);
  const finishIntent = swiftIntent(generated, 'FinishWafraHistoryImportIntent');
  ok('Finish perform returns no value', finishOutputContract(generated), finishIntent);
  const leakingFinishSource = generated.replace(
    finishIntent,
    finishIntent.replace('return .result()', 'return .result(value: authorizationSecret)'),
  );
  ok('Finish output contract rejects a returned authorization-secret leak',
    !finishOutputContract(leakingFinishSource), leakingFinishSource);
  ok('bulk intent maps five exact parameters and returns no source data',
    bulkImportContract(generated), bulkIntent);
  const missingBulkDateBinding = generated.replace(
    bulkIntent,
    bulkIntent.replace(/\s*dates:\s*dates,?/, ''),
  );
  ok('bulk contract rejects a missing Date-array binding',
    !bulkImportContract(missingBulkDateBinding), missingBulkDateBinding);
  const leakingBulkOutput = generated.replace(
    bulkIntent,
    bulkIntent.replace('return .result()', 'return .result(value: bodies.first ?? "")'),
  );
  ok('bulk contract rejects returned Message source data',
    !bulkImportContract(leakingBulkOutput), leakingBulkOutput);
  const duplicateBulkImporterCall = generated.replace(
    bulkIntent,
    bulkIntent.replace(
      '_ = try WafraMessageHistoryImporter.shared.importMessages(',
      '_ = try WafraMessageHistoryImporter.shared.importMessages(\n' +
        '        sessionId: sessionId, found: found, messageGUIDs: messageGUIDs, ' +
        'bodies: bodies, dates: dates)\n' +
        '      _ = try WafraMessageHistoryImporter.shared.importMessages(',
    ),
  );
  ok('bulk contract rejects duplicate importer execution',
    !bulkImportContract(duplicateBulkImporterCall), duplicateBulkImporterCall);
  const swappedBulkParameterTitles = generated.replace(
    bulkIntent,
    bulkIntent
      .replace('"history.message_guids.parameter"', '"history.__swap.parameter"')
      .replace('"history.bodies.parameter"', '"history.message_guids.parameter"')
      .replace('"history.__swap.parameter"', '"history.bodies.parameter"'),
  );
  ok('bulk contract rejects parameter title keys bound to the wrong arrays',
    !bulkImportContract(swappedBulkParameterTitles), swappedBulkParameterTitles);
  ok('prepare intent maps seven exact scalar parameters and returns no source data',
    preparedMessageContract(generated), prepareIntent);
  const missingPreparedBodyBinding = generated.replace(
    prepareIntent,
    prepareIntent.replace(/\s*body:\s*body,?/, ''),
  );
  ok('prepare contract rejects a missing optional Body binding',
    !preparedMessageContract(missingPreparedBodyBinding), missingPreparedBodyBinding);
  const missingPreparedSenderBinding = generated.replace(
    prepareIntent,
    prepareIntent.replace(/\s*sender:\s*sender,?/, ''),
  );
  ok('prepare contract rejects a missing optional Sender binding',
    !preparedMessageContract(missingPreparedSenderBinding), missingPreparedSenderBinding);
  const requiredPreparedGUID = generated.replace(
    prepareIntent,
    prepareIntent.replace('var messageGUID: String?', 'var messageGUID: String'),
  );
  ok('prepare contract rejects Message GUID becoming required',
    !preparedMessageContract(requiredPreparedGUID), requiredPreparedGUID);
  const duplicatePrepareCall = generated.replace(
    prepareIntent,
    prepareIntent.replace(
      'try WafraPreparedHistoryStore.shared.prepare(',
      'try WafraPreparedHistoryStore.shared.prepare(\n' +
        '        sessionId: sessionId, found: found, position: position, guid: messageGUID, ' +
        'body: body, sender: sender, date: date)\n' +
        '      try WafraPreparedHistoryStore.shared.prepare(',
    ),
  );
  ok('prepare contract rejects duplicate protected-store writes',
    !preparedMessageContract(duplicatePrepareCall), duplicatePrepareCall);
  const leakingPreparedBody = generated.replace(
    prepareIntent,
    prepareIntent.replace('return .result()', 'return .result(value: body ?? "")'),
  );
  ok('prepare contract rejects returned Message source data',
    !preparedMessageContract(leakingPreparedBody), leakingPreparedBody);
  ok('prepared import maps its exact scalar parameters and returns no source data',
    preparedImportContract(generated), preparedImportIntent);
  const missingPreparedFoundBinding = generated.replace(
    preparedImportIntent,
    preparedImportIntent.replace(/\s*found:\s*found,?/, ''),
  );
  ok('prepared import contract rejects a missing found-count binding',
    !preparedImportContract(missingPreparedFoundBinding), missingPreparedFoundBinding);
  const duplicatePreparedImport = generated.replace(
    preparedImportIntent,
    preparedImportIntent.replace(
      '_ = try WafraMessageHistoryImporter.shared.importPrepared(',
      '_ = try WafraMessageHistoryImporter.shared.importPrepared(\n' +
        '        sessionId: sessionId, found: found)\n' +
        '      _ = try WafraMessageHistoryImporter.shared.importPrepared(',
    ),
  );
  ok('prepared import contract rejects duplicate importer execution',
    !preparedImportContract(duplicatePreparedImport), duplicatePreparedImport);
  const leakingPreparedImportOutput = generated.replace(
    preparedImportIntent,
    preparedImportIntent.replace('return .result()', 'return .result(value: sessionId)'),
  );
  ok('prepared import contract rejects returned session data',
    !preparedImportContract(leakingPreparedImportOutput), leakingPreparedImportOutput);

  ok('V2 prepare maps eight exact scalar parameters with selected bounds and no declared found count',
    preparedMessageV2Contract(generated), prepareV2Intent);
  const foundInV2Prepare = generated.replace(
    prepareV2Intent,
    prepareV2Intent.replace(
      'var position: Int',
      'var found: Int\n\n  var position: Int',
    ),
  );
  ok('V2 prepare contract rejects a reintroduced found count',
    !preparedMessageV2Contract(foundInV2Prepare), foundInV2Prepare);
  const missingV2RangeEnd = generated.replace(
    prepareV2Intent,
    prepareV2Intent.replace(/\s*rangeEnd:\s*rangeEnd,?/, ''),
  );
  ok('V2 prepare contract rejects a missing selected-range guard',
    !preparedMessageV2Contract(missingV2RangeEnd), missingV2RangeEnd);
  const duplicateV2Prepare = generated.replace(
    prepareV2Intent,
    prepareV2Intent.replace(
      'try WafraPreparedHistoryStore.shared.prepareV2(',
      'try WafraPreparedHistoryStore.shared.prepareV2(\n' +
        '        sessionId: sessionId, position: position, rangeStart: rangeStart, ' +
        'rangeEnd: rangeEnd, guid: messageGUID, ' +
        'body: body, sender: sender, date: date)\n' +
        '      try WafraPreparedHistoryStore.shared.prepareV2(',
    ),
  );
  ok('V2 prepare contract rejects duplicate protected-store writes',
    !preparedMessageV2Contract(duplicateV2Prepare), duplicateV2Prepare);
  const leakingV2Prepare = generated.replace(
    prepareV2Intent,
    prepareV2Intent.replace('return .result()', 'return .result(value: body ?? "")'),
  );
  ok('V2 prepare contract rejects returned Message source data',
    !preparedMessageV2Contract(leakingV2Prepare), leakingV2Prepare);

  ok('V3 prepare maps six exact scalar parameters without count or range inputs',
    preparedMessageV3Contract(generated), prepareV3Intent);
  ok('V3 prepare maps its source-free error to the existing V2 localization',
    preparedMessageV3ErrorLocalizationContract(generated), generated);
  const wrongV3Title = generated.replace(
    prepareV3Intent,
    prepareV3Intent.replace('"history.prepare_v2.title"', '"history.begin.title"'),
  );
  ok('V3 prepare contract rejects the wrong localized title key',
    !preparedMessageV3Contract(wrongV3Title), wrongV3Title);
  const wrongV3Description = generated.replace(
    prepareV3Intent,
    prepareV3Intent.replace(
      '"history.prepare_v2.description"',
      '"history.begin.description"',
    ),
  );
  ok('V3 prepare contract rejects the wrong localized description key',
    !preparedMessageV3Contract(wrongV3Description), wrongV3Description);
  const wrongV3ThrownError = generated.replace(
    prepareV3Intent,
    prepareV3Intent.replace(
      'throw WafraHistoryIntentError.prepareV3Failed',
      'throw WafraHistoryIntentError.prepareV2Failed',
    ),
  );
  ok('V3 prepare contract rejects routing failures through the V2 error case',
    !preparedMessageV3Contract(wrongV3ThrownError), wrongV3ThrownError);
  const wrongV3ErrorLocalization = generated.replace(
    /case \.prepareV3Failed:\s*return WafraMessageHistoryResources\.localized\("history\.prepare_v2\.error"\)/,
    'case .prepareV3Failed:\n      return WafraMessageHistoryResources.localized("history.begin.error")',
  );
  ok('V3 error contract rejects the wrong source-free localization key',
    !preparedMessageV3ErrorLocalizationContract(wrongV3ErrorLocalization),
    wrongV3ErrorLocalization);
  const rangeInputsInV3Prepare = generated.replace(
    prepareV3Intent,
    prepareV3Intent.replace(
      'var position: Int',
      'var position: Int\n\n  var rangeStart: Date\n\n  var rangeEnd: Date',
    ),
  );
  ok('V3 prepare contract rejects reintroduced Date-range inputs',
    !preparedMessageV3Contract(rangeInputsInV3Prepare), rangeInputsInV3Prepare);
  const requiredV3GUID = generated.replace(
    prepareV3Intent,
    prepareV3Intent.replace('var messageGUID: String?', 'var messageGUID: String'),
  );
  ok('V3 prepare contract rejects Message GUID becoming required',
    !preparedMessageV3Contract(requiredV3GUID), requiredV3GUID);
  const missingV3DateBinding = generated.replace(
    prepareV3Intent,
    prepareV3Intent.replace(/\s*date:\s*date,?/, ''),
  );
  ok('V3 prepare contract rejects a missing optional Date binding',
    !preparedMessageV3Contract(missingV3DateBinding), missingV3DateBinding);
  const duplicateV3Prepare = generated.replace(
    prepareV3Intent,
    prepareV3Intent.replace(
      'try WafraPreparedHistoryStore.shared.prepareV3(',
      'try WafraPreparedHistoryStore.shared.prepareV3(\n' +
        '        sessionId: sessionId, position: position, guid: messageGUID, ' +
        'body: body, sender: sender, date: date)\n' +
        '      try WafraPreparedHistoryStore.shared.prepareV3(',
    ),
  );
  ok('V3 prepare contract rejects duplicate protected-store writes',
    !preparedMessageV3Contract(duplicateV3Prepare), duplicateV3Prepare);
  const leakingV3Prepare = generated.replace(
    prepareV3Intent,
    prepareV3Intent.replace('return .result()', 'return .result(value: body ?? "")'),
  );
  ok('V3 prepare contract rejects returned Message source data',
    !preparedMessageV3Contract(leakingV3Prepare), leakingV3Prepare);

  ok('V2 prepared import derives its count from one exact session parameter',
    preparedImportV2Contract(generated), preparedImportV2Intent);
  const duplicateV2Import = generated.replace(
    preparedImportV2Intent,
    preparedImportV2Intent.replace(
      'try WafraMessageHistoryImporter.shared.importPreparedV2(sessionId: sessionId)',
      'try WafraMessageHistoryImporter.shared.importPreparedV2(sessionId: sessionId)\n' +
        '      try WafraMessageHistoryImporter.shared.importPreparedV2(sessionId: sessionId)',
    ),
  );
  ok('V2 prepared import rejects duplicate importer execution',
    !preparedImportV2Contract(duplicateV2Import), duplicateV2Import);

  ok('V2 discard maps one exact session parameter and returns no source data',
    discardPreparedV2Contract(generated), discardV2Intent);
  const leakingV2Discard = generated.replace(
    discardV2Intent,
    discardV2Intent.replace('return .result()', 'return .result(value: sessionId)'),
  );
  ok('V2 discard contract rejects returned session data',
    !discardPreparedV2Contract(leakingV2Discard), leakingV2Discard);

  const expectedKeys = [
    'history.accepted.parameter',
    'history.attempted.parameter',
    'history.authorization.parameter',
    'history.begin.description',
    'history.begin.error',
    'history.begin.title',
    'history.chunk.parameter',
    'history.bodies.parameter',
    'history.dates.parameter',
    'history.finish.description',
    'history.finish.error',
    'history.finish.title',
    'history.found.parameter',
    'history.import.description',
    'history.import.error',
    'history.import.title',
    'history.message_guids.parameter',
    'history.message_guid.parameter',
    'history.body.parameter',
    'history.sender.parameter',
    'history.date.parameter',
    'history.position.parameter',
    'history.range_start.parameter',
    'history.range_end.parameter',
    'history.prepare.description',
    'history.prepare.error',
    'history.prepare.title',
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
    'history.records.parameter',
    'history.session_id.parameter',
    'history.skipped.parameter',
    'history.stage.description',
    'history.stage.error',
    'history.stage.title',
    'history.stage_shortcut.title',
    'history.stage_shortcut.description',
    'history.stage_shortcut.error',
    'history.total_chunks.parameter',
  ].sort();
  eq('English localization table contains the closed history key set',
    localizationKeys(english), expectedKeys);
  eq('Arabic localization table contains the identical closed history key set',
    localizationKeys(arabic), expectedKeys);
  ok(
    'Arabic values contain Arabic text and differ from English fallbacks',
    /[\u0600-\u06ff]/.test(arabic) && arabic !== english,
    arabic,
  );

  const metadataResources = [...generated.matchAll(
    /LocalizedStringResource\(\s*"(history\.[^"]+)",\s*defaultValue:\s*"",\s*table:\s*"WafraHistoryIntents",\s*bundle:\s*\.main\s*\)/gs,
  )].map((match) => match[1]);
  eq('metadata is Apple-extractable while source-free errors use the custom helper', [
    generated.match(/static let title\s*=\s*LocalizedStringResource\(/g)?.length || 0,
    generated.match(/static let description\s*=\s*IntentDescription\(\s*LocalizedStringResource\(/g)?.length || 0,
    generated.match(/@Parameter\(title:\s*LocalizedStringResource\(/g)?.length || 0,
    generated.match(/return WafraMessageHistoryResources\.localized\("history\.[^"]+\.error"\)/g)?.length || 0,
    metadataResources.length,
    metadataResources.every((key) => expectedKeys.includes(key)),
  ], [11, 11, 46, 11, 68, true]);
  ok(
    'generated metadata retains no literal English fallback',
    !/static let (?:title|description)[^\n]*=\s*"|@Parameter\(title:\s*"|IntentDescription\(\s*"/.test(generated),
    generated,
  );
  ok(
    'source-free localized intent errors replace underlying store errors',
      /CustomLocalizedStringResourceConvertible/.test(generated) &&
      (generated.match(/catch\s*\{/g)?.length || 0) === 11 &&
      !/throw error\b/.test(generated),
    generated,
  );

  ok(
    'podspec packages the exact CocoaPods localization resource bundle',
    /s\.resource_bundles\s*=\s*\{\s*'WafraMessageHistoryResources'\s*=>\s*\['Resources\/\*\*\/\*'\]\s*\}/s
      .test(podspec) && /s\.resources\s*=\s*\['Resources\/\*\*\/\*'\]/.test(podspec),
    podspec,
  );
  ok(
    'resource helper searches module and main bundles and fails closed',
    /Bundle\(for:\s*ResourceAnchor\.self\)/.test(resources) &&
      /Bundle\.main/.test(resources) &&
      /bundleName\s*=\s*"WafraMessageHistoryResources"/.test(resources) &&
      /withExtension:\s*"bundle"/.test(resources) &&
      /preconditionFailure|fatalError/.test(resources),
    resources,
  );
  ok(
    'resource helper validates the key then builds the required localized resource',
    /_ key:\s*StaticString/.test(resources) &&
      /func bundle\(for key:\s*StaticString\)/.test(resources) &&
      /localizedString\(\s*forKey:\s*lookupKey/.test(resources) &&
      /LocalizedStringResource\(\s*key,\s*defaultValue:\s*defaultValue,\s*table:\s*(?:Self\.)?tableName,\s*bundle:\s*\.atURL\(bundle\.bundleURL\)/s
        .test(resources) &&
      /WafraHistoryIntents/.test(resources),
    resources,
  );

  const validMetadataResult = verifyExtractedMetadata(extractedHistoryIntentFixture());
  ok(
    'compiled metadata gate accepts the exact eleven-intent history contract',
    validMetadataResult.status === 0 &&
      /exact .*history contract/.test(validMetadataResult.stdout),
    `status=${validMetadataResult.status}\n${validMetadataResult.stdout}${validMetadataResult.stderr}`,
  );
  const missingHistoryIntentMetadata = extractedHistoryIntentFixture();
  delete missingHistoryIntentMetadata.actions.StageWafraMessageHistoryIntent;
  const missingHistoryIntentResult = verifyExtractedMetadata(missingHistoryIntentMetadata);
  ok(
    'compiled metadata gate rejects a missing history intent identifier',
    missingHistoryIntentResult.status !== 0 &&
      /history intent identifiers/.test(
        `${missingHistoryIntentResult.stdout}${missingHistoryIntentResult.stderr}`,
      ),
    `status=${missingHistoryIntentResult.status}\n` +
      `${missingHistoryIntentResult.stdout}${missingHistoryIntentResult.stderr}`,
  );
  const wrongAuthenticationMetadata = extractedHistoryIntentFixture();
  wrongAuthenticationMetadata.actions.ImportWafraMessageHistoryIntent.authenticationPolicy = 0;
  const wrongAuthenticationResult = verifyExtractedMetadata(wrongAuthenticationMetadata);
  ok(
    'compiled metadata gate rejects a bulk intent without local-device authentication',
    wrongAuthenticationResult.status !== 0 &&
      /authenticationPolicy/.test(`${wrongAuthenticationResult.stdout}${wrongAuthenticationResult.stderr}`),
    `status=${wrongAuthenticationResult.status}\n${wrongAuthenticationResult.stdout}${wrongAuthenticationResult.stderr}`,
  );
  const foregroundMetadata = extractedHistoryIntentFixture();
  foregroundMetadata.actions.ImportWafraMessageHistoryIntent.supportedModes = 0;
  const foregroundResult = verifyExtractedMetadata(foregroundMetadata);
  ok(
    'compiled metadata gate rejects a bulk intent that is not background mode 1',
    foregroundResult.status !== 0 &&
      /supportedModes/.test(`${foregroundResult.stdout}${foregroundResult.stderr}`),
    `status=${foregroundResult.status}\n${foregroundResult.stdout}${foregroundResult.stderr}`,
  );
  const oldIosMetadata = extractedHistoryIntentFixture();
  oldIosMetadata.actions.ImportWafraMessageHistoryIntent
    .availabilityAnnotations.LNPlatformNameIOS.introducedVersion = '25.0';
  const oldIosResult = verifyExtractedMetadata(oldIosMetadata);
  ok(
    'compiled metadata gate rejects bulk intent availability before iOS 26',
    oldIosResult.status !== 0 &&
      /iOS availability/.test(`${oldIosResult.stdout}${oldIosResult.stderr}`),
    `status=${oldIosResult.status}\n${oldIosResult.stdout}${oldIosResult.stderr}`,
  );
  const renamedParameterMetadata = extractedHistoryIntentFixture();
  renamedParameterMetadata.actions.ImportWafraMessageHistoryIntent.parameters[2].name = 'guids';
  const renamedParameterResult = verifyExtractedMetadata(renamedParameterMetadata);
  ok(
    'compiled metadata gate rejects a renamed bulk parameter',
    renamedParameterResult.status !== 0 &&
      /bulk parameters/.test(`${renamedParameterResult.stdout}${renamedParameterResult.stderr}`),
    `status=${renamedParameterResult.status}\n` +
      `${renamedParameterResult.stdout}${renamedParameterResult.stderr}`,
  );
  const wrongDateTypeMetadata = extractedHistoryIntentFixture();
  wrongDateTypeMetadata.actions.ImportWafraMessageHistoryIntent.parameters[4]
    .valueType.array.wrapper.memberValueType.primitive.wrapper.typeIdentifier = 0;
  const wrongDateTypeResult = verifyExtractedMetadata(wrongDateTypeMetadata);
  ok(
    'compiled metadata gate rejects a Date array extracted as the wrong type',
    wrongDateTypeResult.status !== 0 &&
      /bulk parameters/.test(`${wrongDateTypeResult.stdout}${wrongDateTypeResult.stderr}`),
    `status=${wrongDateTypeResult.status}\n` +
      `${wrongDateTypeResult.stdout}${wrongDateTypeResult.stderr}`,
  );
  const leakingOutputMetadata = extractedHistoryIntentFixture();
  leakingOutputMetadata.actions.ImportWafraMessageHistoryIntent.outputType = {
    primitive: { wrapper: { typeIdentifier: 0 } },
  };
  const leakingOutputResult = verifyExtractedMetadata(leakingOutputMetadata);
  ok(
    'compiled metadata gate rejects a bulk intent with an extracted output value',
    leakingOutputResult.status !== 0 &&
      /no output value/.test(`${leakingOutputResult.stdout}${leakingOutputResult.stderr}`),
    `status=${leakingOutputResult.status}\n` +
      `${leakingOutputResult.stdout}${leakingOutputResult.stderr}`,
  );
  const wrongStagePolicyMetadata = extractedHistoryIntentFixture();
  wrongStagePolicyMetadata.actions.StageWafraMessageHistoryIntent.authenticationPolicy = 2;
  const wrongStagePolicyResult = verifyExtractedMetadata(wrongStagePolicyMetadata);
  ok(
    'compiled metadata gate rejects a changed Stage authentication policy',
    wrongStagePolicyResult.status !== 0 &&
      /StageWafraMessageHistoryIntent authenticationPolicy/.test(
        `${wrongStagePolicyResult.stdout}${wrongStagePolicyResult.stderr}`,
      ),
    `status=${wrongStagePolicyResult.status}\n` +
      `${wrongStagePolicyResult.stdout}${wrongStagePolicyResult.stderr}`,
  );
  for (const mutation of ['policy', 'parameters', 'foreground']) {
    const fixture = extractedHistoryIntentFixture();
    const action = fixture.actions.StageWafraShortcutHistoryIntent;
    if (mutation === 'policy') action.authenticationPolicy = 2;
    if (mutation === 'parameters') action.parameters[3].valueType = { primitive: { wrapper: { typeIdentifier: 0 } } };
    if (mutation === 'foreground') action.openAppWhenRun = true;
    const result = verifyExtractedMetadata(fixture);
    ok(`compiled metadata gate refuses Shortcut Stage ${mutation} drift`,
      result.status !== 0 && /StageWafraShortcutHistoryIntent/.test(`${result.stdout}${result.stderr}`));
  }
  const leakingFinishMetadata = extractedHistoryIntentFixture();
  leakingFinishMetadata.actions.FinishWafraHistoryImportIntent.outputType = {
    primitive: { wrapper: { typeIdentifier: 0 } },
  };
  const leakingFinishResult = verifyExtractedMetadata(leakingFinishMetadata);
  ok(
    'compiled metadata gate rejects an extracted Finish output value',
    leakingFinishResult.status !== 0 &&
      /FinishWafraHistoryImportIntent output type/.test(
        `${leakingFinishResult.stdout}${leakingFinishResult.stderr}`,
      ),
    `status=${leakingFinishResult.status}\n` +
      `${leakingFinishResult.stdout}${leakingFinishResult.stderr}`,
  );
  const wrongBeginParameterMetadata = extractedHistoryIntentFixture();
  wrongBeginParameterMetadata.actions.BeginWafraHistoryImportIntent.parameters[0].name = 'id';
  const wrongBeginParameterResult = verifyExtractedMetadata(wrongBeginParameterMetadata);
  ok(
    'compiled metadata gate rejects changed Begin parameters',
    wrongBeginParameterResult.status !== 0 &&
      /BeginWafraHistoryImportIntent parameters/.test(
        `${wrongBeginParameterResult.stdout}${wrongBeginParameterResult.stderr}`,
      ),
    `status=${wrongBeginParameterResult.status}\n` +
      `${wrongBeginParameterResult.stdout}${wrongBeginParameterResult.stderr}`,
  );
  const wrongPrepareAuthenticationMetadata = extractedHistoryIntentFixture();
  wrongPrepareAuthenticationMetadata.actions.PrepareWafraHistoryMessageIntent
    .authenticationPolicy = 2;
  const wrongPrepareAuthenticationResult = verifyExtractedMetadata(
    wrongPrepareAuthenticationMetadata,
  );
  ok(
    'compiled metadata gate rejects authenticated per-message preparation',
    wrongPrepareAuthenticationResult.status !== 0 &&
      /PrepareWafraHistoryMessageIntent authenticationPolicy/.test(
        `${wrongPrepareAuthenticationResult.stdout}${wrongPrepareAuthenticationResult.stderr}`,
      ),
    `status=${wrongPrepareAuthenticationResult.status}\n` +
      `${wrongPrepareAuthenticationResult.stdout}${wrongPrepareAuthenticationResult.stderr}`,
  );
  const requiredPrepareBodyMetadata = extractedHistoryIntentFixture();
  requiredPrepareBodyMetadata.actions.PrepareWafraHistoryMessageIntent.parameters[4]
    .isOptional = false;
  const requiredPrepareBodyResult = verifyExtractedMetadata(requiredPrepareBodyMetadata);
  ok(
    'compiled metadata gate rejects required prepared-message Body metadata',
    requiredPrepareBodyResult.status !== 0 &&
      /PrepareWafraHistoryMessageIntent parameters/.test(
        `${requiredPrepareBodyResult.stdout}${requiredPrepareBodyResult.stderr}`,
      ),
    `status=${requiredPrepareBodyResult.status}\n` +
      `${requiredPrepareBodyResult.stdout}${requiredPrepareBodyResult.stderr}`,
  );
  const wrongPrepareDateTypeMetadata = extractedHistoryIntentFixture();
  wrongPrepareDateTypeMetadata.actions.PrepareWafraHistoryMessageIntent.parameters[6]
    .valueType.primitive.wrapper.typeIdentifier = 0;
  const wrongPrepareDateTypeResult = verifyExtractedMetadata(wrongPrepareDateTypeMetadata);
  ok(
    'compiled metadata gate rejects prepared Date extracted as String',
    wrongPrepareDateTypeResult.status !== 0 &&
      /PrepareWafraHistoryMessageIntent parameters/.test(
        `${wrongPrepareDateTypeResult.stdout}${wrongPrepareDateTypeResult.stderr}`,
      ),
    `status=${wrongPrepareDateTypeResult.status}\n` +
      `${wrongPrepareDateTypeResult.stdout}${wrongPrepareDateTypeResult.stderr}`,
  );
  const unauthenticatedPreparedImportMetadata = extractedHistoryIntentFixture();
  unauthenticatedPreparedImportMetadata.actions.ImportWafraPreparedHistoryIntent
    .authenticationPolicy = 0;
  const unauthenticatedPreparedImportResult = verifyExtractedMetadata(
    unauthenticatedPreparedImportMetadata,
  );
  ok(
    'compiled metadata gate rejects unauthenticated prepared import',
    unauthenticatedPreparedImportResult.status !== 0 &&
      /ImportWafraPreparedHistoryIntent authenticationPolicy/.test(
        `${unauthenticatedPreparedImportResult.stdout}${unauthenticatedPreparedImportResult.stderr}`,
      ),
    `status=${unauthenticatedPreparedImportResult.status}\n` +
      `${unauthenticatedPreparedImportResult.stdout}${unauthenticatedPreparedImportResult.stderr}`,
  );
  const leakingPreparedImportMetadata = extractedHistoryIntentFixture();
  leakingPreparedImportMetadata.actions.ImportWafraPreparedHistoryIntent.outputType = {
    primitive: { wrapper: { typeIdentifier: 0 } },
  };
  const leakingPreparedImportResult = verifyExtractedMetadata(leakingPreparedImportMetadata);
  ok(
    'compiled metadata gate rejects prepared import output metadata',
    leakingPreparedImportResult.status !== 0 &&
      /ImportWafraPreparedHistoryIntent output type/.test(
        `${leakingPreparedImportResult.stdout}${leakingPreparedImportResult.stderr}`,
      ),
    `status=${leakingPreparedImportResult.status}\n` +
      `${leakingPreparedImportResult.stdout}${leakingPreparedImportResult.stderr}`,
  );
  const prepareOutputFlagsMetadata = extractedHistoryIntentFixture();
  prepareOutputFlagsMetadata.actions.PrepareWafraHistoryMessageIntent.outputFlags = 1;
  const prepareOutputFlagsResult = verifyExtractedMetadata(prepareOutputFlagsMetadata);
  ok(
    'compiled metadata gate rejects prepared-message output flags',
    prepareOutputFlagsResult.status !== 0 &&
      /PrepareWafraHistoryMessageIntent output type/.test(
        `${prepareOutputFlagsResult.stdout}${prepareOutputFlagsResult.stderr}`,
      ),
    `status=${prepareOutputFlagsResult.status}\n` +
      `${prepareOutputFlagsResult.stdout}${prepareOutputFlagsResult.stderr}`,
  );
  const foregroundPreparedImportMetadata = extractedHistoryIntentFixture();
  foregroundPreparedImportMetadata.actions.ImportWafraPreparedHistoryIntent.supportedModes = 0;
  const foregroundPreparedImportResult = verifyExtractedMetadata(foregroundPreparedImportMetadata);
  ok(
    'compiled metadata gate rejects foreground-only prepared import',
    foregroundPreparedImportResult.status !== 0 &&
      /ImportWafraPreparedHistoryIntent.*background supportedModes 1/.test(
        `${foregroundPreparedImportResult.stdout}${foregroundPreparedImportResult.stderr}`,
      ),
    `status=${foregroundPreparedImportResult.status}\n` +
      `${foregroundPreparedImportResult.stdout}${foregroundPreparedImportResult.stderr}`,
  );
  const openingPrepareMetadata = extractedHistoryIntentFixture();
  openingPrepareMetadata.actions.PrepareWafraHistoryMessageIntent.openAppWhenRun = true;
  const openingPrepareResult = verifyExtractedMetadata(openingPrepareMetadata);
  ok(
    'compiled metadata gate rejects prepared-message work that opens Wafra',
    openingPrepareResult.status !== 0 &&
      /PrepareWafraHistoryMessageIntent.*background supportedModes 1/.test(
        `${openingPrepareResult.stdout}${openingPrepareResult.stderr}`,
      ),
    `status=${openingPrepareResult.status}\n` +
      `${openingPrepareResult.stdout}${openingPrepareResult.stderr}`,
  );
  const oldPreparedIntentMetadata = extractedHistoryIntentFixture();
  oldPreparedIntentMetadata.actions.PrepareWafraHistoryMessageIntent
    .availabilityAnnotations.LNPlatformNameIOS.introducedVersion = '25.0';
  const oldPreparedIntentResult = verifyExtractedMetadata(oldPreparedIntentMetadata);
  ok(
    'compiled metadata gate rejects prepared-message availability before iOS 26',
    oldPreparedIntentResult.status !== 0 &&
      /PrepareWafraHistoryMessageIntent iOS availability/.test(
        `${oldPreparedIntentResult.stdout}${oldPreparedIntentResult.stderr}`,
      ),
    `status=${oldPreparedIntentResult.status}\n` +
      `${oldPreparedIntentResult.stdout}${oldPreparedIntentResult.stderr}`,
  );

  const authenticatedV3Metadata = extractedHistoryIntentFixture();
  authenticatedV3Metadata.actions.PrepareWafraHistoryMessageV3Intent
    .authenticationPolicy = 2;
  const authenticatedV3Result = verifyExtractedMetadata(authenticatedV3Metadata);
  ok(
    'compiled metadata gate rejects authenticated V3 preparation',
    authenticatedV3Result.status !== 0 &&
      /PrepareWafraHistoryMessageV3Intent authenticationPolicy/.test(
        `${authenticatedV3Result.stdout}${authenticatedV3Result.stderr}`,
      ),
    `status=${authenticatedV3Result.status}\n` +
      `${authenticatedV3Result.stdout}${authenticatedV3Result.stderr}`,
  );
  const foregroundV3Metadata = extractedHistoryIntentFixture();
  foregroundV3Metadata.actions.PrepareWafraHistoryMessageV3Intent.supportedModes = 0;
  const foregroundV3Result = verifyExtractedMetadata(foregroundV3Metadata);
  ok(
    'compiled metadata gate rejects foreground-only V3 preparation',
    foregroundV3Result.status !== 0 &&
      /PrepareWafraHistoryMessageV3Intent.*background supportedModes 1/.test(
        `${foregroundV3Result.stdout}${foregroundV3Result.stderr}`,
      ),
    `status=${foregroundV3Result.status}\n` +
      `${foregroundV3Result.stdout}${foregroundV3Result.stderr}`,
  );
  const oldV3Metadata = extractedHistoryIntentFixture();
  oldV3Metadata.actions.PrepareWafraHistoryMessageV3Intent
    .availabilityAnnotations.LNPlatformNameIOS.introducedVersion = '25.0';
  const oldV3Result = verifyExtractedMetadata(oldV3Metadata);
  ok(
    'compiled metadata gate rejects V3 preparation availability before iOS 26',
    oldV3Result.status !== 0 &&
      /PrepareWafraHistoryMessageV3Intent iOS availability/.test(
        `${oldV3Result.stdout}${oldV3Result.stderr}`,
      ),
    `status=${oldV3Result.status}\n${oldV3Result.stdout}${oldV3Result.stderr}`,
  );
  const leakingV3Metadata = extractedHistoryIntentFixture();
  leakingV3Metadata.actions.PrepareWafraHistoryMessageV3Intent.outputType = {
    primitive: { wrapper: { typeIdentifier: 0 } },
  };
  const leakingV3Result = verifyExtractedMetadata(leakingV3Metadata);
  ok(
    'compiled metadata gate rejects V3 preparation output metadata',
    leakingV3Result.status !== 0 &&
      /PrepareWafraHistoryMessageV3Intent output type/.test(
        `${leakingV3Result.stdout}${leakingV3Result.stderr}`,
      ),
    `status=${leakingV3Result.status}\n${leakingV3Result.stdout}${leakingV3Result.stderr}`,
  );
  const requiredV3BodyMetadata = extractedHistoryIntentFixture();
  requiredV3BodyMetadata.actions.PrepareWafraHistoryMessageV3Intent.parameters[3]
    .isOptional = false;
  const requiredV3BodyResult = verifyExtractedMetadata(requiredV3BodyMetadata);
  ok(
    'compiled metadata gate rejects a required V3 Body parameter',
    requiredV3BodyResult.status !== 0 &&
      /PrepareWafraHistoryMessageV3Intent parameters/.test(
        `${requiredV3BodyResult.stdout}${requiredV3BodyResult.stderr}`,
      ),
    `status=${requiredV3BodyResult.status}\n` +
      `${requiredV3BodyResult.stdout}${requiredV3BodyResult.stderr}`,
  );
  const rangedV3Metadata = extractedHistoryIntentFixture();
  rangedV3Metadata.actions.PrepareWafraHistoryMessageV3Intent.parameters.splice(
    2,
    0,
    JSON.parse(JSON.stringify(
      rangedV3Metadata.actions.PrepareWafraHistoryMessageV2Intent.parameters[2],
    )),
  );
  const rangedV3Result = verifyExtractedMetadata(rangedV3Metadata);
  ok(
    'compiled metadata gate rejects a V3 Date-range parameter',
    rangedV3Result.status !== 0 &&
      /PrepareWafraHistoryMessageV3Intent parameters/.test(
        `${rangedV3Result.stdout}${rangedV3Result.stderr}`,
      ),
    `status=${rangedV3Result.status}\n${rangedV3Result.stdout}${rangedV3Result.stderr}`,
  );

  eq('plugin owns one deterministic generated source path', [
    plugin.match(/filePath:\s*'WafraMessageHistoryIntent\.swift'/g)?.length || 0,
    plugin.match(/overwrite:\s*true/g)?.length || 0,
  ], [1, 1]);
  eq('plugin registers exactly one generated Swift source without a native tree',
    firstPluginInvocations.map(({ filePath, overwrite }) => ({ filePath, overwrite })),
    [{ filePath: 'WafraMessageHistoryIntent.swift', overwrite: true }]);
  const secondPluginInvocations = captureHistoryIntentPlugin();
  ok(
    'plugin emits deterministic App Intent bytes across clean-tree passes',
    secondPluginInvocations.length === 1 &&
      secondPluginInvocations[0].contents === generated,
    secondPluginInvocations[0]?.contents || 'plugin emitted no source',
  );

  console.log(`\niOS history native contract: ${passed} passed, ${failed} failed`);
  if (failed > 0) process.exit(1);
})().catch((error) => {
  console.error(error);
  process.exit(1);
});
