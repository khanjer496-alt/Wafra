# Transfers device fixes

1. Currency label on band tiles: Money gained an optional `currencyColor` prop (default unchanged: themed textSecondary). Transfers passes each tile's `quiet` colour (onBandSecondary on the band, band colour when selected, sheet textSecondary/onFill at large text).
2. Period chip: removed `flexWrap: 'wrap'`, added `flexShrink: 1` on the chip and its label; row, minHeight 44 and radius 22 kept, so the chevron stays beside the label.

Tests (scripts/test/repair/transfers-band.test.cjs): two new tests, RED (2 fail) before the change, GREEN after.
Suites: transfers-band + transfer-components 45/45; all suites importing ui/money 36/36; tsc and eslint clean.
