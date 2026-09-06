# Main consolidation verification

This is a source consolidation, not a production release or deployment.

## Verified locally

- Complete Git history recovery: `git fsck --full --no-dangling` passes after
  recovering a cloud-only pack and one older reflog commit. The original pack
  and index remain preserved; no history was force-pushed or discarded.
- Nine previous local draft files are preserved byte-for-byte in a backup
  and in the local-only `archive/local-drafts-20260907` tag.
- All 239 recovered source files matched the reviewed recovery manifest
  before applying the separately checksum-verified numeric-input repair.
- Application and server TypeScript checks pass.
- ESLint passes with no warnings after updating legacy validation imports.
- All 71 original app JavaScript suites passed in the consolidated checkout.
- All 126 focused redesign, workflow and protected-handler tests pass.
- All 24 localized amount-input regressions pass, including AED/KWD/JPY
  precision, Arabic/Persian glyphs, decimal/group separators and overflow.
- Server tests, universal parser/evidence/holdout checks and Worker build
  dry-run passed. The native iOS contract source generation passed.

## Not certified by this consolidation

The original browser smoke suite is being migrated from the retired screen
layout. Its first run reached the redesigned screens but exposed stale total
and modal selectors, and did not observe the expected selected-month state.
The selectors with directly verified source equivalents were updated. Do not
claim the complete browser suite is green until the canonical CI run passes.
All browser gates remain enabled; no monetary checks were suppressed.

Native iOS runtime/storage tests, complete Android/iOS builds, physical-device
capture and store distribution were not rerun as part of this cleanup. Other
branches' release evidence does not certify this exact consolidated revision.

Local logs are retained in `.git/consolidation/checks/`. The Mac had 3.8 GiB
free when checked and a Git pack was marked cloud-only. Keep the project and
Git database available locally before further large native builds.
