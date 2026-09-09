import Foundation

/// Backwards pagination over a bounded, date-sorted Messages provider.
/// Whole-second overlap avoids requiring sub-second Shortcuts date arithmetic.
/// This reducer never treats a page limit, missing anchor, or query failure as EOF.
public enum WafraHistoryCursor {
  public struct Reference: Codable, Equatable {
    public let id: String
    public let milliseconds: Int64
    public init(id: String, milliseconds: Int64) {
      self.id = id; self.milliseconds = milliseconds
    }
  }

  public struct Checkpoint: Codable, Equatable {
    public let version: Int
    public let oldest: Reference
    public let newest: Reference
    public let frozenBefore: Int64
    public var before: Int64
    public var limit: Int
    public var revision: Int
    public var checked: Int
    public var overlap: [Reference]
    public var complete: Bool
  }

  public struct Decision {
    public let next: Checkpoint
    /// Prefix proven safe to commit. The final second is withheld on full pages.
    public let commitCount: Int
  }

  public enum Failure: String, Error {
    case invalidCheckpoint = "invalid-checkpoint"
    case invalidPage = "invalid-page"
    case wrongDateRange = "wrong-date-range"
    case missingOverlap = "missing-overlap"
    case missingOldest = "missing-oldest"
    case denseSecond = "dense-second"
    case alreadyComplete = "already-complete"
  }

  public static let initialLimit = 51
  public static let maximumLimit = 408
  public static let maximumRecords = 1_000_000
  private static let maximumTimestamp: Int64 = 253_402_300_798_999

  private static func valid(_ row: Reference) -> Bool {
    row.id.utf8.count == 64 && row.id.utf8.allSatisfy {
      (48...57).contains($0) || (97...102).contains($0)
    } && row.milliseconds > 0 && row.milliseconds <= maximumTimestamp
  }

  public static func begin(oldest: Reference, newest: Reference) throws -> Checkpoint {
    guard valid(oldest), valid(newest), oldest.milliseconds <= newest.milliseconds,
          oldest.id != newest.id || oldest.milliseconds == newest.milliseconds else {
      throw Failure.invalidCheckpoint
    }
    let upper = (newest.milliseconds / 1_000 + 1) * 1_000
    return Checkpoint(version: 1, oldest: oldest, newest: newest, frozenBefore: upper,
      before: upper, limit: initialLimit, revision: 0, checked: 0,
      overlap: [newest], complete: false)
  }

  public static func validate(_ state: Checkpoint) throws {
    guard state.version == 1, valid(state.oldest), valid(state.newest),
          state.oldest.milliseconds <= state.newest.milliseconds,
          state.frozenBefore == (state.newest.milliseconds / 1_000 + 1) * 1_000,
          state.before > state.oldest.milliseconds,
          state.before <= state.frozenBefore, state.before % 1_000 == 0,
          [51, 102, 204, 408].contains(state.limit),
          state.revision >= 0, state.revision < 1_000_000,
          state.checked >= 0, state.checked <= maximumRecords,
          !state.overlap.isEmpty, state.overlap.count <= maximumLimit,
          Set(state.overlap.map(\.id)).count == state.overlap.count,
          state.overlap.allSatisfy({ valid($0) && $0.milliseconds < state.before &&
            $0.milliseconds >= state.oldest.milliseconds }) else {
      throw Failure.invalidCheckpoint
    }
    if state.revision == 0 {
      guard state.before == state.frozenBefore, state.checked == 0,
            state.overlap == [state.newest], !state.complete else {
        throw Failure.invalidCheckpoint
      }
    } else if !state.complete {
      guard state.overlap.allSatisfy({ $0.milliseconds >= state.before - 1_000 }) else {
        throw Failure.invalidCheckpoint
      }
    }
  }

  public static func advance(_ state: Checkpoint, records: [Reference]) throws -> Decision {
    try validate(state)
    guard !state.complete else { throw Failure.alreadyComplete }
    guard !records.isEmpty, records.count <= state.limit,
          Set(records.map(\.id)).count == records.count,
          records.allSatisfy(valid) else { throw Failure.invalidPage }
    var previous = state.before
    for row in records {
      guard row.milliseconds < state.before,
            row.milliseconds >= state.oldest.milliseconds,
            row.milliseconds <= previous else { throw Failure.wrongDateRange }
      previous = row.milliseconds
    }
    let observed = Dictionary(uniqueKeysWithValues: records.map { ($0.id, $0.milliseconds) })
    guard state.overlap.allSatisfy({ observed[$0.id] == $0.milliseconds }) else {
      // Catches ignored/rounded date filters, silent discontinuities and deletions
      // at the cursor. Never jump past the absent boundary to make progress.
      throw Failure.missingOverlap
    }
    var next = state
    next.revision += 1
    if records.count < state.limit {
      guard observed[state.oldest.id] == state.oldest.milliseconds else {
        throw Failure.missingOldest
      }
      next.checked += records.count
      next.complete = true
      return Decision(next: next, commitCount: records.count)
    }
    let boundary = (records[records.count - 1].milliseconds / 1_000 + 1) * 1_000
    let committed = records.prefix { $0.milliseconds >= boundary }.count
    if committed == 0 {
      guard state.limit < maximumLimit else { throw Failure.denseSecond }
      next.limit = min(maximumLimit, state.limit * 2)
      // The first page can cover less than one second; retain its exact anchor.
      next.before = boundary
      next.overlap = records
    } else {
      guard boundary < state.before else { throw Failure.wrongDateRange }
      next.before = boundary
      next.limit = initialLimit
      next.checked += committed
      next.overlap = Array(records.dropFirst(committed))
    }
    try validate(next)
    return Decision(next: next, commitCount: committed)
  }
}
