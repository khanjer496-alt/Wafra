# Larger Text audit, 2026-09-25

Owner report: with iOS Settings → Accessibility → Display & Text Size → Larger Text turned up to
the accessibility sizes, screens across the app clipped, overlapped, pushed buttons off screen or
lost their proportions. Onboarding and iPhone setup were fixed earlier
(`2026-09-25-ios-setup-simplify.md`). This covers every other screen.

## How it was measured

React Native Web always reports `fontScale` 1, so the browser export could never show what an
AX-size phone draws. The seeded E2E export (`EXPO_PUBLIC_WAFRA_E2E_DEMO=1`, web only) now reads
`window.__WAFRA_E2E_FONT_SCALE__`, set by the harness before the bundle runs
(`src/lib/e2e-font-scale.ts`). Two things follow from it:

- `Dimensions` and `useWindowDimensions()` report that scale, so `useLargeTextLayout()` and every
  other layout decision take the same branch they take on a phone.
- `ThemedText`, `TextField`, the amount input and the Ask Wafra input scale fontSize, lineHeight
  and letterSpacing the way native Text does. `maxFontSizeMultiplier` and
  `allowFontScaling={false}` are honoured.

Icons, fixed boxes and spacing do not scale, which matches native. Production and native bundles
inline the flag as something other than `'1'`, so the emulation never runs there.

`scripts/e2e/e2e-large-text.mjs` checks 23 surfaces at 4 font scales (1, 1.35, 2 and 3.1) on 2
viewports (375×667 and 430×932) in English and Arabic: 368 states in all. On each screen, and
in the tab bar when it is showing, it records:

| Kind | Meaning |
|---|---|
| overflow | A visible text run or control extends past the viewport edge (horizontal scrollers excepted), or the document scrolls sideways |
| clipped | Text cut off by its own box or by a clipping ancestor, including an ellipsis on a money figure |
| overlap | Two painted text runs, two controls, or a control and text that is not its own drawn over each other. Only the painted part of each box counts: content scrolled out of a sheet does not "collide" with its footer |
| broken-word | A word or figure split across lines ("Spendi / ng", "11, / 755.99", a name one letter per line) |
| cramped | A scroll area squeezed below 30% of the screen by the chrome around it |
| unreachable | A control that cannot be scrolled fully onto the screen and hit-tested (for example, one stuck under the tab bar or off screen) |

An ellipsis on a non-money label is reported separately as "truncated" and does not count as a
failure. A navigation timeout is a harness error, reported apart and re-run.

```sh
EXPO_PUBLIC_WAFRA_E2E_DEMO=1 npx expo export --clear --platform web --output-dir dist
node scripts/e2e/serve.mjs dist 8126 &
node scripts/e2e/e2e-large-text.mjs        # SCALES= LANGS= VIEWPORTS= SURFACES= SHOTS=dir STRICT=1
node scripts/e2e/large-text-map.mjs before.json after.json
```

## Before and after

Each cell adds up both languages and both viewports. The first number is before, the second after.

| Surface | 1x | 1.35x | 2x | 3.1x |
|---|---|---|---|---|
| home | 0 → 0 | 0 → 0 | 5 → 0 | 33 → 0 |
| spending-categories | 0 → 0 | 0 → 0 | 4 → 0 | 39 → 0 |
| spending-activity | 0 → 0 | 0 → 0 | 3 → 0 | 20 → 0 |
| spending-trends | 0 → 0 | 0 → 0 | 23 → 0 | 60 → 0 |
| spending-category-sheet | 0 → 0 | 0 → 0 | 4 → 0 | 24 → 0 |
| bills | 0 → 0 | 0 → 0 | 7 → 0 | 23 → 0 |
| accounts | 18 → 0 | 14 → 0 | 7 → 0 | 39 → 0 |
| transactions | 0 → 0 | 0 → 0 | 0 → 0 | 17 → 0 |
| transaction-detail | 0 → 0 | 0 → 0 | 0 → 0 | 11 → 0 |
| add-transaction | 0 → 0 | 2 → 0 | 3 → 0 | 4 → 0 |
| review-alerts | 0 → 0 | 0 → 0 | 0 → 0 | 1 → 0 |
| review-transfers | 0 → 0 | 0 → 0 | 0 → 0 | 0 → 0 |
| transfers | 0 → 0 | 0 → 0 | 0 → 0 | 0 → 0 |
| assistant | 0 → 0 | 0 → 0 | 0 → 0 | 2 → 0 |
| settings | 0 → 0 | 0 → 0 | 0 → 0 | 0 → 0 |
| pro | 0 → 0 | 0 → 0 | 0 → 0 | 2 → 0 |
| statement-import | 0 → 0 | 0 → 0 | 0 → 0 | 0 → 0 |
| recap | 0 → 0 | 0 → 0 | 0 → 0 | 4 → 0 |
| cards | 0 → 0 | 1 → 0 | 12 → 0 | 14 → 0 |
| stats (Trends content) | 0 → 0 | 0 → 0 | 23 → 0 | 83 → 0 |
| merchants | 0 → 0 | 0 → 0 | 0 → 0 | 6 → 0 |
| currency | 0 → 0 | 0 → 0 | 0 → 0 | 2 → 0 |
| home-customize | 0 → 0 | 0 → 0 | 0 → 0 | 0 → 0 |
| **Total** | **18 → 0** | **17 → 0** | **91 → 0** | **384 → 0** |

Before, by kind: 188 overlap, 178 overflow, 115 broken-word, 16 unreachable, 9 clipped, 4 cramped. After: none.

The worst "before" cases at 3.1x:
- The Android/web tab bar labels were drawn over one another, and "Accounts" ran off the screen.
- The Home hero figure was split into "11," and "755.99", and the + and Settings buttons sat on
  top of the "Wafra" wordmark.
- In the Trends chart, the axis labels and every month's figures ran past the right edge.
- In the transaction details sheet, the header and the pinned Edit/Delete footer left 87pt of
  content visible, and the amount ran off both edges.
- On Payment cards, the card name was squeezed to one letter per line.
- On Transactions, the pinned search and filter controls left the list a 44pt strip. In Arabic,
  every row was unreachable.
- In Arabic at the default text size, each account row on Accounts overlapped its own manage
  control, because of a negative end margin.

## What changed

Shared:
- **`ThemedText` follows Apple's Dynamic Type ramp.** Display sizes only grow as far as their iOS
  counterparts do at AX5: display and sheetAmount 1.75x, amount 1.8x, title 2x, subtitle 2.75x,
  heading 2.4x. Everything at or below Body (all copy, labels and row figures) is not capped at all. A
  caller's own `maxFontSizeMultiplier` still takes precedence. Each capped style still ends up
  larger than body text at every size.
- **Money hero figures are never truncated** (`src/lib/large-text-figure.ts`). A hero figure
  shrinks toward the width it has, but never below 60% of the size Larger Text asked for (the
  `minimumFontScale 0.6` floor), and wraps once it reaches that floor. The full amount stays in the
  accessibility label. At the accessibility sizes every Money figure keeps its whole width, so its
  row wraps it onto its own line instead of breaking the digits.
- **BottomSheet.** At the accessibility sizes the footer scrolls at the end of the content rather
  than staying pinned. The close button moves to its own row, and the sheet may use 96% of the
  height.
- **Android/web tab bar** (iOS uses the system `NativeTabs`). At the accessibility sizes the bar
  shows icons only, as the iOS system bar does. Every tab keeps its accessibility label, and a
  long press shows the name.
- **`Row` wraps at the accessibility sizes.**

Screens (all switch on `useLargeTextLayout()`, so nothing changes at the default size except where
noted):
- **Spending:** category rows stack the avatar above the name. Legend shares and the foreign-spending
  total each move to their own line. On Trends, merchant and change rows stack; month figures show
  the label above the value; the decorative axis is hidden (every month's exact figures remain in the
  list under the chart); and weekday names take their own line. The six-month history in the category
  sheet becomes a list (month, exact amount and a horizontal bar) instead of six columns.
- **Bills:** the filter chips wrap instead of scrolling sideways. The summary figure is fitted to
  its card.
- **Accounts:** the negative margin on the manage control is gone. This fixes the Arabic overlap
  at every size. Goal rows stack and are now labelled buttons.
- **Cards:** the figure and caption drop under the card name. At normal sizes the caption column
  is capped at 55% width so the name is never squeezed.
- **Transactions / Ask Wafra:** at large text, the search and filter controls, and the Ask Wafra
  period and status line, scroll with the content. Only the question field and Send stay pinned.
- **Home:** payment amounts drop under the payee.
- **Merchants, Currency, Pro:** rows stack. The Pro plan price wraps under the plan name.
- **Recap:** story titles and figures follow the ramp and are fitted. The faint watermark numeral
  does not scale, because it is decoration.
- **Add transaction:** the selected account name wraps instead of truncating. This is a
  default-size change: it used to be limited to one line.

Arabic: every stacked layout uses `flex-start` and `textAlign: 'auto'`. With the root's
`direction: 'rtl'`, the stacks start from the right. Stacked-layout checks in Arabic show 0
failures at all four scales on both viewports.

## Screenshots (375×667, 3.1x unless noted)

In `2026-09-25-large-text-audit/`: `home`, `transaction-detail`, `cards`, `assistant`,
`spending-categories` and `recap`, each saved as `*-3.1x-before.png` and `*-3.1x-after.png`. Also
`accounts-ar-1x-before.png` and `accounts-ar-1x-after.png`, which show the Arabic overlap at the
default size.

## What the browser cannot prove

These need a physical iPhone, at AX1 (1.79x) and at AX5 (3.57x, above the 3.1x ceiling of this
matrix):

1. **Font metrics.** SF Pro/Geist line breaking and the Noto Kufi Arabic metrics differ slightly
   from Chromium's. The hero fit uses an estimated 0.62em mono advance.
2. **The system tab bar.** On iOS the app uses `NativeTabs`, whose large-text behaviour (Large
   Content Viewer on long press) comes from UIKit. The harness only measures the Android/web bar.
3. **Sheets.** Keyboard avoidance with a footer that scrolls inline (the Edit Transaction form and
   the period sheet's custom range) at large text, and VoiceOver order when the close button sits
   on its own row.
4. **Scroll behaviour on Transactions and Ask Wafra.** With the search and context controls
   scrolling at large text, check the focus and keyboard behaviour of the search field when it is
   the list's first cell.
5. **Dynamic changes.** Changing the text size while the app is open: each layout switches on the
   next render through `useWindowDimensions()`.
6. **Android.** The largest system font scale (2.0), including the icon-only tab bar and the
   long-press name peek.

Screens the matrix did not open: parser-research, trusted-devices, import-sms, feedback,
accuracy, categorise and the iOS setup screens (covered separately), plus most sheets other than
the transaction details and category sheets.
