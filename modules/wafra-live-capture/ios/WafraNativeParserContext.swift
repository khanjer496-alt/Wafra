import Foundation

/// Non-ledger preferences for a versioned, source-matched preview only.
public struct WafraNativeParserContext: Codable, Equatable, Sendable {
  public struct Money: Codable, Equatable, Sendable {
    public let currency: String
    public let exponent: Int
    public init(currency: String, exponent: Int) { self.currency = currency; self.exponent = exponent }
    private enum CodingKeys: String, CodingKey { case currency, exponent }
    public init(from decoder: Decoder) throws {
      try exactKeys(decoder, ["currency", "exponent"])
      let values = try decoder.container(keyedBy: CodingKeys.self)
      currency = try values.decode(String.self, forKey: .currency)
      exponent = try values.decode(Int.self, forKey: .exponent)
      guard Self.isValid(currency: currency, exponent: exponent) else { throw InvalidContext.invalid }
    }
    private static func isValid(currency: String, exponent: Int) -> Bool {
      asciiUpper(currency, length: 3) && [0, 2, 3].contains(exponent)
    }
    public var isValidBasic: Bool { Self.isValid(currency: currency, exponent: exponent) }
  }

  public let v: Int
  public let country: String?
  public let parserMarket: String
  public let ledgerMoney: Money?
  public let sourceHash: String

  public init(v: Int = 1, country: String?, parserMarket: String, ledgerMoney: Money?, sourceHash: String) {
    self.v = v; self.country = country; self.parserMarket = parserMarket
    self.ledgerMoney = ledgerMoney; self.sourceHash = sourceHash
  }

  public var isValidBasic: Bool {
    v == 1 && country.map { Self.asciiUpper($0, length: 2) } != false &&
      ["AE", "SA", "ZZ"].contains(parserMarket) && ledgerMoney?.isValidBasic != false &&
      sourceHash.utf8.count == 64 && sourceHash.utf8.allSatisfy { (48...57).contains($0) || (97...102).contains($0) }
  }

  public init?(validatingJSON serialized: String) {
    guard serialized.utf8.count <= 2048, let data = serialized.data(using: .utf8),
      let value = try? JSONDecoder().decode(Self.self, from: data), value.isValidBasic else { return nil }
    self = value
  }

  public func serializedJSON() -> String? {
    guard isValidBasic else { return nil }
    let encoder = JSONEncoder(); encoder.outputFormatting = [.sortedKeys]
    guard let data = try? encoder.encode(self), data.count <= 2048 else { return nil }
    return String(data: data, encoding: .utf8)
  }

  private enum CodingKeys: String, CodingKey { case v, country, parserMarket, ledgerMoney, sourceHash }
  public init(from decoder: Decoder) throws {
    try Self.exactKeys(decoder, ["v", "country", "parserMarket", "ledgerMoney", "sourceHash"])
    let values = try decoder.container(keyedBy: CodingKeys.self)
    v = try values.decode(Int.self, forKey: .v)
    country = try values.decodeIfPresent(String.self, forKey: .country)
    parserMarket = try values.decode(String.self, forKey: .parserMarket)
    ledgerMoney = try values.decodeIfPresent(Money.self, forKey: .ledgerMoney)
    sourceHash = try values.decode(String.self, forKey: .sourceHash)
    guard isValidBasic else { throw InvalidContext.invalid }
  }
  public func encode(to encoder: Encoder) throws {
    var values = encoder.container(keyedBy: CodingKeys.self)
    try values.encode(v, forKey: .v)
    try values.encode(country, forKey: .country)
    try values.encode(parserMarket, forKey: .parserMarket)
    try values.encode(ledgerMoney, forKey: .ledgerMoney)
    try values.encode(sourceHash, forKey: .sourceHash)
  }

  private enum InvalidContext: Error { case invalid }
  private struct AnyKey: CodingKey {
    let stringValue: String
    let intValue: Int? = nil
    init?(stringValue: String) { self.stringValue = stringValue }
    init?(intValue: Int) { return nil }
  }
  private static func exactKeys(_ decoder: Decoder, _ names: Set<String>) throws {
    let values = try decoder.container(keyedBy: AnyKey.self)
    guard Set(values.allKeys.map(\.stringValue)) == names else { throw InvalidContext.invalid }
  }
  private static func asciiUpper(_ value: String, length: Int) -> Bool {
    value.utf8.count == length && value.utf8.allSatisfy { (65...90).contains($0) }
  }
}
