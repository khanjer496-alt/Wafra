// Typecheck-only stand-in for the ExpoModulesCore surface this module uses.
// Build with the module sources, e.g.:
//   xcrun swiftc -typecheck -sdk "$(xcrun --sdk iphoneos --show-sdk-path)" \
//     -target arm64-apple-ios15.1 Tests/ExpoModulesCoreStub.swift \
//     WafraOnDeviceAIEngine.swift WafraOnDeviceAIModule.swift
// (the `import ExpoModulesCore` line is stripped by the check script).
import Foundation

public typealias ModuleDefinition = Void

open class Module {
  public init() {}
}

public func Name(_ name: String) {}

open class Exception: Error, @unchecked Sendable {
  public let name: String
  public let description: String
  public let code: String
  public init(name: String, description: String, code: String? = nil) {
    self.name = name
    self.description = description
    self.code = code ?? name
  }
}

public func AsyncFunction<R>(_ name: String, _ closure: @escaping () async throws -> R) {}
public func AsyncFunction<R, A0, each A>(_ name: String, _ closure: @escaping (A0, repeat each A) async throws -> R) {}
public func AsyncFunction<R, A0, each A>(_ name: String, _ closure: @escaping (A0, repeat each A) throws -> R) {}
