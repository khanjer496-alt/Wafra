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
check(weekOut == "in 7 days", "seven days ahead counts days, never this Monday's name: \(weekOut)")
check(WafraDates.dueLabel(day("2026-10-07"), now: now, strings: ar) == "بعد 9 أيام", "Arabic 3–10 days")
check(WafraDates.dueLabel(day("2026-10-12"), now: now, strings: ar) == "بعد 14 يومًا", "Arabic 11+ days")
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
check(WafraInitial.of("كهرباء") == "ك", "Arabic initial")
check(WafraInitial.of("الكهرباء") == "ك", "Arabic initial skips the article")
check(WafraInitial.of("الإيجار") == "إ", "Arabic initial skips the article before a hamza")
check(WafraInitial.of("ال") == "ا", "a bare article keeps its first letter")
check(WafraInitial.of("Allianz") == "A", "Latin titles are untouched")

// Masked card titles hold left to right inside Arabic only.
check(WafraTitle.display("•••• 1234", .ar) == "\u{200E}•••• 1234\u{200E}", "masked card title is isolated in Arabic")
check(WafraTitle.display("•••• 1234", .en) == "•••• 1234", "English titles are unchanged")
check(WafraTitle.display("الكهرباء", .ar) == "الكهرباء", "Arabic titles with letters are unchanged")
check(WafraInitial.of("") == nil, "empty title")

// Snapshot decoding and money parts.
func snapshot(hidden: Bool, extra: String = "", billLogo: String = "", week: String = "[100,200,0,null,500,600,2400]") -> WafraSnapshot? {
  let generated = Int64(now.timeIntervalSince1970 * 1000)
  let json = """
  {"version":1,"generatedAt":\(generated),"language":"en","todayISO":"2026-09-28","currency":"AED",
   "exponent":2,"amountsSensitive":true,"hidden":\(hidden),"todayMinor":2400,"todayCount":3,
   "last7Minor":\(week),"leftInBudgetsMinor":36000,"perDayMinor":1200,
   "budgetsOver":0,"bills":[{"title":"DEWA",\(billLogo)"amountMinor":45000,"estimated":true,"dueISO":"2026-09-29"},
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

check(snapshot(hidden: false)?.weekTotalMinor == nil, "partial week never has a guessed total")
check(snapshot(hidden: false, week: "[1,2,3,4,5,6,7]")?.weekTotalMinor == 28, "seven-day total retains minor units exactly")
check(snapshot(hidden: true, week: "[1,2,3,4,5,6,7]")?.weekTotalMinor == nil, "hidden week has no total")
check(snapshot(hidden: false, week: "[9007199254740991,1,0,0,0,0,0]")?.weekTotalMinor == nil, "unsafe week total is hidden")
check(snapshot(hidden: false, billLogo: "\"logoId\":\"dewa\",")?.bills.first?.logoId == "dewa", "bundled logo id decodes")
check(snapshot(hidden: false, billLogo: "\"logoId\":\"../../dewa\",")?.bills.first?.logoId == nil, "paths cannot select a logo")
check(snapshot(hidden: false)?.bills.first?.logoId == nil, "older snapshots retain fallback")

// The Spending month: optional, validated, hidden-safe.
check(snapshot(hidden: false)?.spending == nil, "an older snapshot has no month")
let month = ",\"spending\":{\"monthKey\":\"2026-09\",\"totalMinor\":548000,\"categories\":[{\"label\":\"Groceries\",\"amountMinor\":183600},{\"label\":\" \",\"amountMinor\":1},{\"label\":\"Dining\",\"amountMinor\":100400}],\"otherMinor\":264000}"
if let spent = snapshot(hidden: false, extra: month)?.spending {
  check(spent.month == 9 && spent.totalMinor == 548000, "month and total")
  check(spent.categories.map(\.label) == ["Groceries", "Dining"], "blank labels are dropped")
  let segments = spent.segments(hidden: false)
  check(segments.map(\.alpha) == [0.92, 0.7, 0.24], "named segments then the quiet rest: \(segments)")
  check(abs(segments.map(\.share).reduce(0, +) - 1) < 0.000001, "shares fill the bar")
  check(spent.segments(hidden: true).isEmpty, "hidden draws no shares")
} else {
  check(false, "month decodes")
}
if let hiddenMonth = snapshot(hidden: true, extra: month)?.spending {
  check(hiddenMonth.totalMinor == nil && hiddenMonth.categories.allSatisfy { $0.amountMinor == nil }, "hidden month has names only")
} else {
  check(false, "hidden month decodes")
}
check(snapshot(hidden: false, extra: ",\"spending\":{\"monthKey\":\"2026-13\"}")?.spending == nil, "bad month is no month")
check(snapshot(hidden: false, extra: ",\"spending\":7") != nil, "a wrong-typed month never breaks the snapshot")
check(WafraMoney.whole(183650, exponent: 2) == "1,837" && WafraMoney.whole(183649, exponent: 2) == "1,836", "whole units half up")
check(WafraMoney.whole(1234, exponent: 0) == "1,234" && WafraMoney.whole(-40, exponent: 2) == "0", "whole edge cases")
check(WafraDates.monthName(9, language: .en) == "September", "month name")
check(WafraDates.monthName(9, language: .ar) == "سبتمبر", "Arabic month name: \(WafraDates.monthName(9, language: .ar))")
if let shown = snapshot(hidden: false) {
  let listed = shown.upcomingBills(at: now)
  check(WafraMoney.billsTotal(listed, in: shown) == "≈ AED 1,650.00", "total due: \(String(describing: WafraMoney.billsTotal(listed, in: shown)))")
  check(shown.budgetFraction == nil, "no limits, no budget bar")
}
if let budgeted = snapshot(hidden: false, extra: ",\"budgetTotalMinor\":100000") {
  check(budgeted.budgetFraction == 0.64, "budget used: \(String(describing: budgeted.budgetFraction))")
}

if failures == 0 {
  print("widget logic: all checks passed")
  exit(0)
}
print("widget logic: \(failures) failure(s)")
exit(1)
