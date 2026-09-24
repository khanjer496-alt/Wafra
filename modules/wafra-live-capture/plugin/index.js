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
import Foundation
internal import WafraLiveCapture

@available(iOS 16.0, *)
private enum WafraLiveCaptureIntentError: Error, CustomLocalizedStringResourceConvertible {
  case setupProofFailed
  case automationInputProbeFailed
  case stageFailed
  case captureDisabled
  case invalidMessage
  case captureCapacityReached
  case invalidNotification
  case notificationFailed
  case applePayInvalid
  case applePayFailed
  case applePaySetupFailed

  var localizedStringResource: LocalizedStringResource {
    switch self {
    case .setupProofFailed:
      return WafraLiveCaptureResources.localized("live.setup_proof.error")
    case .automationInputProbeFailed:
      return WafraLiveCaptureResources.localized("live.automation_input_probe.error")
    case .stageFailed:
      return WafraLiveCaptureResources.localized("live.stage.error")
    case .captureDisabled:
      return WafraLiveCaptureResources.localized("live.stage.disabled")
    case .invalidMessage:
      return WafraLiveCaptureResources.localized("live.stage.invalid")
    case .captureCapacityReached:
      return WafraLiveCaptureResources.localized("live.stage.capacity")
    case .invalidNotification:
      return WafraLiveCaptureResources.localized("live.notification.invalid")
    case .notificationFailed:
      return WafraLiveCaptureResources.localized("live.notification.error")
    case .applePayInvalid:
      return WafraLiveCaptureResources.localized("live.apple_pay.invalid")
    case .applePayFailed:
      return WafraLiveCaptureResources.localized("live.apple_pay.error")
    case .applePaySetupFailed:
      return WafraLiveCaptureResources.localized("live.apple_pay.setup.error")
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
struct RecordWafraCaptureV3SetupProofIntent: AppIntent {
  static let title = LocalizedStringResource(
    "live.setup_v3.title",
    table: "WafraIntents",
    bundle: .main
  )
  static let authenticationPolicy: IntentAuthenticationPolicy = .alwaysAllowed
  static let openAppWhenRun = false

  func perform() async throws -> some IntentResult {
    do {
      try WafraLiveCaptureStore.shared.recordSetupProof(version: 3, at: Date())
      return .result()
    } catch {
      throw WafraLiveCaptureIntentError.setupProofFailed
    }
  }
}

@available(iOS 26.0, *)
extension RecordWafraCaptureV3SetupProofIntent {
  static var supportedModes: IntentModes { .background }
}

#if DEBUG
@available(iOS 16.0, *)
struct ProbeWafraAutomationInputIntent: AppIntent {
  static let title = LocalizedStringResource(
    "live.automation_input_probe.title",
    table: "WafraIntents",
    bundle: .main
  )
  static let authenticationPolicy: IntentAuthenticationPolicy = .alwaysAllowed
  static let openAppWhenRun = false

  @Parameter(title: LocalizedStringResource(
    "live.automation_input_probe.message.parameter",
    table: "WafraIntents",
    bundle: .main
  ), inputConnectionBehavior: .connectToPreviousIntentResult)
  var message: String

  func perform() async throws -> some IntentResult & ReturnsValue<Bool> {
    do {
      let matched = try WafraLiveCaptureStore.shared.recordAutomationInputProbe(
        body: message,
        at: Date()
      )
      return .result(value: matched)
    } catch {
      throw WafraLiveCaptureIntentError.automationInputProbeFailed
    }
  }
}

@available(iOS 26.0, *)
extension ProbeWafraAutomationInputIntent {
  static var supportedModes: IntentModes { .background }
}
#endif

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
  var sender: String?

  @Parameter(title: LocalizedStringResource(
    "live.stage.message.parameter",
    table: "WafraIntents",
    bundle: .main
  ))
  var body: String?

  @Parameter(title: LocalizedStringResource(
    "live.stage.event_id.parameter",
    table: "WafraIntents",
    bundle: .main
  ))
  var eventId: String?

  @Parameter(title: LocalizedStringResource(
    "live.stage.observed_at.parameter",
    table: "WafraIntents",
    bundle: .main
  ))
  var observedAt: Date?

  // Every parameter is optional: on iOS 26.1 the automation's Message input
  // has Sender and Content but no Date, and GUID is not listed, so Capture v3
  // omits what Apple withholds. The store keeps SHA-256(GUID) only with the
  // Message's own date, otherwise stamps a fresh queue UUID (dated by a
  // supplied date or the receipt time), and ignores blank or expired rows.
  // Published Capture v2 always binds all four: its complete, current inputs
  // stage exactly as before; its empty-GUID/absent-date live input now stages
  // a UUID row instead of failing, and its sender-less no-input rows (blank
  // Content) are ignored instead of stopping the run.
  func perform() async throws -> some IntentResult & ReturnsValue<String> {
    do {
      let result = try WafraLiveCaptureStore.shared.stageAutomationMessage(
        sender: sender,
        body: body,
        eventId: eventId,
        observedAt: observedAt
      )
      switch result {
      case .accepted, .ignored:
        return .result(value: result.rawValue)
      case .disabled:
        throw WafraLiveCaptureIntentError.captureDisabled
      case .invalid:
        throw WafraLiveCaptureIntentError.invalidMessage
      case .capacityReached:
        throw WafraLiveCaptureIntentError.captureCapacityReached
      }
    } catch let error as WafraLiveCaptureIntentError {
      throw error
    } catch {
      throw WafraLiveCaptureIntentError.stageFailed
    }
  }
}

@available(iOS 26.0, *)
extension StageWafraLiveMessageIntent {
  static var supportedModes: IntentModes { .background }
}

/// Fallback for Personal Automations that coerce the received Message to plain
/// text before invoking the Shortcut. Keep it on-device and stage it through
/// the same protected queue; the shared parser still decides whether it is a
/// supported financial alert.
@available(iOS 16.0, *)
struct StageWafraLiveTextIntent: AppIntent {
  static let title = LocalizedStringResource(
    "live.stage_text.title",
    table: "WafraIntents",
    bundle: .main
  )
  static let authenticationPolicy: IntentAuthenticationPolicy = .alwaysAllowed
  static let openAppWhenRun = false

  @Parameter(
    title: LocalizedStringResource(
      "live.stage_text.message.parameter",
      table: "WafraIntents",
      bundle: .main
    ),
    inputConnectionBehavior: .connectToPreviousIntentResult
  )
  var body: String

  func perform() async throws -> some IntentResult & ReturnsValue<String> {
    do {
      let result = try WafraLiveCaptureStore.shared.stage(
        sender: "Wafra Automation",
        body: body,
        eventId: UUID().uuidString,
        observedAt: Date()
      )
      switch result {
      case .accepted, .ignored:
        return .result(value: result.rawValue)
      case .disabled:
        throw WafraLiveCaptureIntentError.captureDisabled
      case .invalid:
        throw WafraLiveCaptureIntentError.invalidMessage
      case .capacityReached:
        throw WafraLiveCaptureIntentError.captureCapacityReached
      }
    } catch let error as WafraLiveCaptureIntentError {
      throw error
    } catch {
      throw WafraLiveCaptureIntentError.stageFailed
    }
  }
}

@available(iOS 26.0, *)
extension StageWafraLiveTextIntent {
  static var supportedModes: IntentModes { .background }
}
/// Accepts only text explicitly supplied by the user's Shortcuts automation.
/// The app cannot observe other apps' notifications or configure their triggers.
@available(iOS 16.0, *)
struct CaptureWafraNotificationIntent: AppIntent {
  static let title = LocalizedStringResource(
    "live.notification.title", table: "WafraIntents", bundle: .main
  )
  static let authenticationPolicy: IntentAuthenticationPolicy = .alwaysAllowed
  static let openAppWhenRun = false

  @Parameter(
    title: LocalizedStringResource(
      "live.notification.text.parameter", table: "WafraIntents", bundle: .main
    ),
    inputConnectionBehavior: .connectToPreviousIntentResult
  )
  var text: String

  func perform() async throws -> some IntentResult & ReturnsValue<String> {
    do {
      if text.trimmingCharacters(in: .whitespacesAndNewlines) == WafraLiveCaptureStore.notificationSetupProbeText {
        try WafraLiveCaptureStore.shared.recordNotificationSetupProof(at: Date())
        return .result(value: "setup-checked")
      }
      let result = try WafraLiveCaptureStore.shared.stageNotification(
        text: text, eventId: UUID().uuidString, observedAt: Date()
      )
      switch result {
      case .accepted, .ignored:
        return .result(value: result.rawValue)
      case .disabled:
        throw WafraLiveCaptureIntentError.captureDisabled
      case .invalid:
        throw WafraLiveCaptureIntentError.invalidNotification
      case .capacityReached:
        throw WafraLiveCaptureIntentError.captureCapacityReached
      }
    } catch let error as WafraLiveCaptureIntentError {
      throw error
    } catch WafraLiveCaptureStore.StoreError.entitlementRequired {
      throw WafraLiveCaptureIntentError.captureDisabled
    } catch {
      throw WafraLiveCaptureIntentError.notificationFailed
    }
  }
}

@available(iOS 26.0, *)
extension CaptureWafraNotificationIntent {
  static var supportedModes: IntentModes { .background }
}

/// The Wallet Amount value carries a Decimal and currency together; never use Double.
@available(iOS 16.0, *)
struct CaptureWafraApplePayIntent: AppIntent {
  static let title = LocalizedStringResource("live.apple_pay.title", table: "WafraIntents", bundle: .main)
  static let authenticationPolicy: IntentAuthenticationPolicy = .alwaysAllowed
  static let openAppWhenRun = false

  @Parameter(title: LocalizedStringResource("live.apple_pay.amount.parameter", table: "WafraIntents", bundle: .main))
  var amount: IntentCurrencyAmount?
  @Parameter(title: LocalizedStringResource("live.apple_pay.merchant.parameter", table: "WafraIntents", bundle: .main))
  var merchant: String?

  func perform() async throws -> some IntentResult & ReturnsValue<Bool> {
    do {
      let result = try WafraLiveCaptureStore.shared.stageApplePay(
        amount: amount?.amount, currency: amount?.currencyCode ?? "", merchant: merchant,
        eventId: UUID().uuidString, observedAt: Date()
      )
      switch result {
      case .accepted: return .result(value: true)
      case .ignored: return .result(value: false)
      case .disabled: throw WafraLiveCaptureIntentError.captureDisabled
      case .invalid: throw WafraLiveCaptureIntentError.applePayInvalid
      case .capacityReached: throw WafraLiveCaptureIntentError.captureCapacityReached
      }
    } catch let error as WafraLiveCaptureIntentError {
      throw error
    } catch {
      throw WafraLiveCaptureIntentError.applePayFailed
    }
  }
}

@available(iOS 26.0, *)
extension CaptureWafraApplePayIntent {
  static var supportedModes: IntentModes { .background }
}

@available(iOS 16.0, *)
struct RecordWafraApplePaySetupProofIntent: AppIntent {
  static let title = LocalizedStringResource("live.apple_pay.setup.title", table: "WafraIntents", bundle: .main)
  static let authenticationPolicy: IntentAuthenticationPolicy = .alwaysAllowed
  static let openAppWhenRun = false

  func perform() async throws -> some IntentResult {
    do {
      try WafraLiveCaptureStore.shared.recordApplePaySetupProof(at: Date())
      return .result()
    } catch WafraLiveCaptureStore.StoreError.entitlementRequired {
      throw WafraLiveCaptureIntentError.captureDisabled
    } catch {
      throw WafraLiveCaptureIntentError.applePaySetupFailed
    }
  }
}

@available(iOS 26.0, *)
extension RecordWafraApplePaySetupProofIntent {
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
