import Foundation

// Logic checks for the iOS widget's Foundation-only code
// (targets/widget/WafraSnapshot.swift). Compiled and run on macOS by
// scripts/test/repair/widget-native-e.test.cjs; synthetic figures only.

var failures = 0

func check(_ condition: Bool, _ message: String) {
  if !condition {
    failures += 1
    print("FAIL: \(message)")
  }
}

func day(_ iso: String) -> Date {
  guard let date = WafraDates.parse(iso) else { fatalError("bad fixture date \(iso)") }
  return date
}

// Monday 28 September 2026, mid-afternoon local time.
let now = day("2026-09-28").addingTimeInterval(15 * 60 * 60)
let en = WafraStrings(language: .en)
let ar = WafraStrings(language: .ar)

// Due words: today, tomorrow, the weekday within the coming week, a date beyond it.
check(WafraDates.dueLabel(day("2026-09-28"), now: now, strings: en) == "Today", "today")
check(WafraDates.dueLabel(day("2026-09-29"), now: now, strings: en) == "Tomorrow", "tomorrow")
check(WafraDates.dueLabel(day("2026-09-30"), now: now, strings: en) == "Wednesday", "two days ahead is a weekday")
check(WafraDates.dueLabel(day("2026-10-04"), now: now, strings: en) == "Sunday", "six days ahead is a weekday")
let weekOut = WafraDates.dueLabel(day("2026-10-05"), now: now, strings: en)
check(weekOut != "Monday" && weekOut.contains("5") && weekOut.contains("Oct"),
      "seven days ahead is a date, never this Monday's name: \(weekOut)")
check(WafraDates.dueLabel(day("2026-09-28"), now: now, strings: ar) == "اليوم", "Arabic today")
check(WafraDates.dueLabel(day("2026-09-29"), now: now, strings: ar) == "غداً", "Arabic tomorrow")
let arWeekday = WafraDates.dueLabel(day("2026-09-30"), now: now, strings: ar)
check(arWeekday == "الأربعاء", "Arabic weekday: \(arWeekday)")
let arDate = WafraDates.dueLabel(day("2026-10-12"), now: now, strings: ar)
// Scalars, not String.contains: Foundation matches "١" against "1".
let arabicIndic = arDate.unicodeScalars.contains { (0x0660...0x0669).contains($0.value) }
check(arDate.unicodeScalars.contains { $0 == "1" } && !arabicIndic, "Arabic dates keep Latin digits: \(arDate)")

// Across a month end and just before midnight.
let lateNight = day("2026-09-30").addingTimeInterval(23 * 60 * 60 + 59 * 60)
check(WafraDates.dueLabel(day("2026-10-01"), now: lateNight, strings: en) == "Tomorrow", "tomorrow across month end")

// Merchant tile initials.
check(WafraInitial.of("DEWA") == "D", "initial of DEWA")
check(WafraInitial.of("  netflix") == "N", "initial skips spaces and uppercases")
check(WafraInitial.of("•••• 1234") == nil, "masked card has no letter, so no digit tile")
check(WafraInitial.of("الكهرباء") == "ا", "Arabic initial")
check(WafraInitial.of("") == nil, "empty title")

// Snapshot decoding and money parts.
func snapshot(hidden: Bool, extra: String = "") -> WafraSnapshot? {
  let generated = Int64(now.timeIntervalSince1970 * 1000)
  let json = """
  {"version":1,"generatedAt":\(generated),"language":"en","todayISO":"2026-09-28","currency":"AED",
   "exponent":2,"amountsSensitive":true,"hidden":\(hidden),"todayMinor":2400,"todayCount":3,
   "last7Minor":[100,200,0,null,500,600,2400],"leftInBudgetsMinor":36000,"perDayMinor":1200,
   "budgetsOver":0,"bills":[{"title":"DEWA","amountMinor":45000,"estimated":true,"dueISO":"2026-09-29"},
   {"title":"ADCB","amountMinor":120000,"estimated":false,"dueISO":"2026-10-05"}]\(extra)}
  """
  return WafraSnapshot.decode(json.data(using: .utf8)!)
}

if let shown = snapshot(hidden: false) {
  let parts = WafraMoney.parts(shown.todayMinor, in: shown)
  check(parts?.currency == "AED" && parts?.number == "24.00", "figure parts: \(String(describing: parts))")
  check(WafraMoney.format(shown.leftInBudgetsMinor, in: shown) == "AED 360.00", "left in budgets amount")
  check(shown.amountsSensitive, "amounts stay privacy-sensitive")
  check(shown.upcomingBills(at: now).map(\.title) == ["DEWA", "ADCB"], "bills soonest first")
} else {
  check(false, "valid snapshot decodes")
}

if let hidden = snapshot(hidden: true) {
  check(WafraMoney.parts(hidden.todayMinor, in: hidden) == nil, "hidden amounts have no figure parts")
  check(WafraMoney.format(hidden.leftInBudgetsMinor, in: hidden) == "—", "hidden left line is a dash")
  check(hidden.bills.allSatisfy { $0.amountMinor == nil }, "hidden bills carry no amounts")
} else {
  check(false, "hidden snapshot decodes")
}

// Copy parity for the new Today line.
check(en.leftInBudgets == "left in budgets" && en.amountLeadsBudgetLine, "English line reads amount first")
check(!ar.leftInBudgets.isEmpty && !ar.amountLeadsBudgetLine, "Arabic line reads words first")
check(!ar.amountHidden.isEmpty && en.amountHidden == "Amount hidden", "hidden amount is spoken")

if failures == 0 {
  print("widget logic: all checks passed")
  exit(0)
}
print("widget logic: \(failures) failure(s)")
exit(1)
