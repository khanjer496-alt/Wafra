// Typecheck-only stand-in for the ExpoModulesCore surface this module uses
// (see typecheck.sh; the `import ExpoModulesCore` lines are stripped there).
import Foundation
import UIKit

public typealias ModuleDefinition = Void

open class Module {
  public init() {}
}

public func Name(_ name: String) {}

public func Function<R, A0>(_ name: String, _ closure: @escaping (A0) throws -> R) {}

open class BaseExpoAppDelegateSubscriber: UIResponder {
  public override required init() {
    super.init()
  }
}

public typealias ExpoAppDelegateSubscriber = BaseExpoAppDelegateSubscriber & UIApplicationDelegate
