const fs = require('node:fs');
const path = require('node:path');
const { IOSConfig, withXcodeProject } = require('@expo/config-plugins');

const intentTableName = 'WafraIntents.strings';
const intentLocalizations = ['en', 'ar'];

function unquoteProjectValue(value) {
  return String(value ?? '').replace(/^"|"$/g, '');
}

function ensureIntentResource({ project, filepath, group, resources, targetUuid }) {
  const fileReferences = project.pbxFileReferenceSection();
  let fileReference = Object.entries(fileReferences).find(
    ([key, entry]) => !key.endsWith('_comment') &&
      unquoteProjectValue(entry?.path) === filepath,
  )?.[0];

  if (!fileReference) {
    fileReference = project.generateUuid();
    project.addToPbxFileReferenceSection({
      basename: intentTableName,
      path: filepath,
      sourceTree: '"<group>"',
      fileEncoding: 4,
      lastKnownFileType: 'text.plist.strings',
      explicitFileType: undefined,
      includeInIndex: 0,
      fileRef: fileReference,
    });
  }
  if (!group.children.some(({ value }) => value === fileReference)) {
    group.children.push({ value: fileReference, comment: intentTableName });
  }

  const buildFiles = project.pbxBuildFileSection();
  const hasTargetMembership = resources.files.some(
    ({ value }) => buildFiles[value]?.fileRef === fileReference,
  );
  if (!hasTargetMembership) {
    const buildFile = {
      uuid: project.generateUuid(),
      fileRef: fileReference,
      basename: intentTableName,
      group: 'Resources',
      target: targetUuid,
    };
    project.addToPbxBuildFileSection(buildFile);
    project.addToPbxResourcesBuildPhase(buildFile);
  }
}

function ensureKnownRegion(project, localization) {
  const knownRegions = project.knownRegions || [];
  let found = false;
  project.knownRegions = knownRegions.filter((region) => {
    if (unquoteProjectValue(region) !== localization) return true;
    if (found) return false;
    found = true;
    return true;
  }).map((region) => (
    unquoteProjectValue(region) === localization ? localization : region
  ));
  if (!found) project.knownRegions.push(localization);
}

const intentSource = `import AppIntents
internal import WafraLiveCapture

@available(iOS 16.0, *)
private enum WafraLiveCaptureIntentError: Error, CustomLocalizedStringResourceConvertible {
  case setupProofFailed
  case stageFailed

  var localizedStringResource: LocalizedStringResource {
    switch self {
    case .setupProofFailed:
      return WafraLiveCaptureResources.localized("live.setup_proof.error")
    case .stageFailed:
      return WafraLiveCaptureResources.localized("live.stage.error")
    }
  }
}

@available(iOS 16.0, *)
struct RecordWafraCaptureSetupProofIntent: AppIntent {
  static let title = LocalizedStringResource(
    "live.setup_proof.title",
    table: "WafraIntents",
    bundle: .main
  )
  static let authenticationPolicy: IntentAuthenticationPolicy = .alwaysAllowed
  static let openAppWhenRun = false

  func perform() async throws -> some IntentResult {
    do {
      try WafraLiveCaptureStore.shared.recordSetupProof(version: 1, at: Date())
      return .result()
    } catch {
      throw WafraLiveCaptureIntentError.setupProofFailed
    }
  }
}

@available(iOS 26.0, *)
extension RecordWafraCaptureSetupProofIntent {
  static var supportedModes: IntentModes { .background }
}

@available(iOS 16.0, *)
struct StageWafraLiveMessageIntent: AppIntent {
  static let title = LocalizedStringResource(
    "live.stage.title",
    table: "WafraIntents",
    bundle: .main
  )
  static let authenticationPolicy: IntentAuthenticationPolicy = .alwaysAllowed
  static let openAppWhenRun = false

  @Parameter(title: LocalizedStringResource(
    "live.stage.sender.parameter",
    table: "WafraIntents",
    bundle: .main
  ))
  var sender: String

  @Parameter(title: LocalizedStringResource(
    "live.stage.message.parameter",
    table: "WafraIntents",
    bundle: .main
  ))
  var body: String

  @Parameter(title: LocalizedStringResource(
    "live.stage.event_id.parameter",
    table: "WafraIntents",
    bundle: .main
  ))
  var eventId: String

  @Parameter(title: LocalizedStringResource(
    "live.stage.observed_at.parameter",
    table: "WafraIntents",
    bundle: .main
  ))
  var observedAt: Date

  func perform() async throws -> some IntentResult & ReturnsValue<String> {
    do {
      let result = try WafraLiveCaptureStore.shared.stage(
        sender: sender,
        body: body,
        eventId: eventId,
        observedAt: observedAt
      )
      return .result(value: result.rawValue)
    } catch {
      throw WafraLiveCaptureIntentError.stageFailed
    }
  }
}

@available(iOS 26.0, *)
extension StageWafraLiveMessageIntent {
  static var supportedModes: IntentModes { .background }
}
`;

function withWafraIntentResources(config) {
  return withXcodeProject(config, async (modConfig) => {
    const projectRoot = modConfig.modRequest.projectRoot;
    const projectName = IOSConfig.XcodeUtils.getProjectName(projectRoot);
    const supportingDirectory = path.join(
      modConfig.modRequest.platformProjectRoot,
      projectName,
      'Supporting',
    );
    const sourceDirectory = path.resolve(__dirname, '../ios/Resources');
    const applicationTarget = IOSConfig.XcodeUtils.getApplicationNativeTarget({
      project: modConfig.modResults,
      projectName,
    });
    const targetUuid = applicationTarget.uuid;
    const resourcesLink = applicationTarget.target.buildPhases.find(
      ({ comment }) => unquoteProjectValue(comment) === 'Resources',
    );
    const resources = resourcesLink
      ? modConfig.modResults.hash.project.objects.PBXResourcesBuildPhase[resourcesLink.value]
      : null;
    if (!resources || resources.isa !== 'PBXResourcesBuildPhase') {
      throw new Error(`Unable to find the Resources build phase for ${projectName}`);
    }

    for (const localization of intentLocalizations) {
      const source = path.join(sourceDirectory, `${localization}.lproj`, intentTableName);
      const destinationDirectory = path.join(supportingDirectory, `${localization}.lproj`);
      const destination = path.join(destinationDirectory, intentTableName);
      const sourceBytes = await fs.promises.readFile(source);
      let destinationBytes = null;
      try {
        destinationBytes = await fs.promises.readFile(destination);
      } catch (error) {
        if (error?.code !== 'ENOENT') throw error;
      }
      await fs.promises.mkdir(destinationDirectory, { recursive: true });
      if (!destinationBytes?.equals(sourceBytes)) {
        await fs.promises.writeFile(destination, sourceBytes);
      }

      const groupName = `${projectName}/Supporting/${localization}.lproj`;
      const group = IOSConfig.XcodeUtils.ensureGroupRecursively(
        modConfig.modResults,
        groupName,
      );
      if (!group) throw new Error(`Unable to create Xcode group ${groupName}`);
      ensureIntentResource({
        project: modConfig.modResults,
        filepath: path.relative(supportingDirectory, destination),
        group,
        resources,
        targetUuid,
      });

      const project = modConfig.modResults.getFirstProject().firstProject;
      ensureKnownRegion(project, localization);
    }
    return modConfig;
  });
}

module.exports = function withWafraLiveCapture(config) {
  config = IOSConfig.XcodeProjectFile.withBuildSourceFile(config, {
    filePath: 'WafraLiveCaptureIntent.swift',
    contents: intentSource,
    overwrite: true,
  });
  return withWafraIntentResources(config);
};
