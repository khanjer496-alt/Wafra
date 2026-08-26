public typealias ModuleDefinition = Void

open class Module {
  public init() {}
}

public protocol Record {}

public protocol TestFieldValue {
  var testValue: Any { get }
}

@propertyWrapper
public struct Field<Value>: TestFieldValue {
  public var wrappedValue: Value

  public init(wrappedValue: Value) {
    self.wrappedValue = wrappedValue
  }

  public init() where Value: ExpressibleByNilLiteral {
    self.wrappedValue = nil
  }

  public var testValue: Any {
    let reflection = Mirror(reflecting: wrappedValue)
    if reflection.displayStyle == .optional, let child = reflection.children.first {
      return child.value
    }
    return wrappedValue
  }
}

public enum TestAsyncFunctionRegistryError: Error {
  case missingFunction
  case invalidArguments
}

public enum TestAsyncFunctionRegistry {
  public typealias Invocation = ([Any]) throws -> Any

  public private(set) static var moduleName: String?
  public private(set) static var functions: [String: Invocation] = [:]

  public static func reset() {
    moduleName = nil
    functions = [:]
  }

  public static func setModuleName(_ name: String) {
    moduleName = name
  }

  public static func register(_ name: String, invocation: @escaping Invocation) {
    functions[name] = invocation
  }

  public static func invoke(_ name: String, _ arguments: [Any] = []) throws -> Any {
    guard let invocation = functions[name] else {
      throw TestAsyncFunctionRegistryError.missingFunction
    }
    return try invocation(arguments)
  }
}

public func Name(_ name: String) {
  TestAsyncFunctionRegistry.setModuleName(name)
}

public func AsyncFunction<Result>(
  _ name: String,
  _ body: @escaping () throws -> Result
) {
  TestAsyncFunctionRegistry.register(name) { arguments in
    guard arguments.isEmpty else {
      throw TestAsyncFunctionRegistryError.invalidArguments
    }
    return try body()
  }
}

public func AsyncFunction<Argument, Result>(
  _ name: String,
  _ body: @escaping (Argument) throws -> Result
) {
  TestAsyncFunctionRegistry.register(name) { arguments in
    guard arguments.count == 1, let argument = arguments[0] as? Argument else {
      throw TestAsyncFunctionRegistryError.invalidArguments
    }
    return try body(argument)
  }
}

public func AsyncFunction<First, Second, Result>(
  _ name: String,
  _ body: @escaping (First, Second) throws -> Result
) {
  TestAsyncFunctionRegistry.register(name) { arguments in
    guard
      arguments.count == 2,
      let first = arguments[0] as? First,
      let second = arguments[1] as? Second
    else {
      throw TestAsyncFunctionRegistryError.invalidArguments
    }
    return try body(first, second)
  }
}

public func AsyncFunction<First, Second, Third, Result>(
  _ name: String,
  _ body: @escaping (First, Second, Third) throws -> Result
) {
  TestAsyncFunctionRegistry.register(name) { arguments in
    guard
      arguments.count == 3,
      let first = arguments[0] as? First,
      let second = arguments[1] as? Second,
      let third = arguments[2] as? Third
    else {
      throw TestAsyncFunctionRegistryError.invalidArguments
    }
    return try body(first, second, third)
  }
}
