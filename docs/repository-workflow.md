# One development line: main

The working repository is `/Users/naserkhanjar/Documents/Wafra` and the remote
is `khanjer496-alt/Wafra`. `main`, tracking `origin/main`, is the canonical
development line for every platform.

## Before working

```sh
git status --short --branch
git remote -v
git fetch origin
git log -5 --oneline --decorate
```

Only fast-forward a clean checkout. Preserve and review unfinished work before
updating it. Do not hard-reset, force-push, or overwrite another session's
files. A branch with active builds or another writer must not be deleted.

All shipping code is in `src/`, `modules/`, and `server/`; tests are in
`scripts/test/`, `scripts/e2e/`, and `server/test/`. Do not reconstruct an old
commit plus an encoded patch to obtain the current app. The normal checkout
is sufficient. The recovered all-screen redesign includes Home, Spending
(Categories, Activity and Trends), Bills, Accounts and supporting workflows.
`/stats` is a compatibility redirect to Spending trends, not another product.

## Verification and release entry points

Use the Node and npm versions pinned in `package.json` and `.nvmrc`.

```sh
npm ci
npm --prefix server ci
npx expo prebuild --platform ios --no-install
npm run typecheck
npm run lint
npm test
npm run test:e2e
```

The iOS prebuild creates ignored native sources required by contract tests;
it does not deploy or install the app. On macOS, `npm test` also runs the
native Swift gates and requires a configured Xcode/CocoaPods environment.
GitHub CI runs the app/server/browser gates and the relevant native iOS gate.
Keep all original monetary, parser, privacy and payment tests enabled.

Current workflows are `CI`, `Build Android APK`, `iOS build (TestFlight)`,
`Device screenshots`, `Deploy relay`, and `Mobile OTA update`. Use `main`
when selecting the source. A green JavaScript check is not proof that a
native release, physical-device capture or App Store submission passed.

The dated branch-specific workflows, `validation/` payloads, and old build
IDs are retained historical recovery material. They must not be retargeted
to `main`, rerun as a new release, or used instead of the normal source.
The feedback agent may create temporary draft PRs; it cannot auto-merge them.

Production OTA, relay deployment, store submission and device installation
require separate owner authorization. Consolidating source does none of them.

## Integration and preservation

The September 7 consolidation combines the latest repair baseline, Android
import performance fixes, Home redesign, full recovered screen/workflow
redesign, validation tests, and iOS Shortcut/release tooling. The two older
merge commits already on `main` remain in its ancestry.

The full redesign was recovered against
`bcdf4f8b2d244801c3fb291454abaa293082dcd3`. Before additional reviewed changes,
all 239 source files matched the recovery manifest SHA-256
`a5ee1c356e79432d6dab55ac50027ef0d91e464530e88ca8338c048d515ac3c0`.
Those files and tests now live directly in their normal paths. Arabic-digit
amount input from the older feedback PR is integrated using the current
strict currency/minor-unit parser rather than its obsolete floating-point
implementation.

The initial local checkout was an older July revision with nine edited or
untracked files. Their exact copies, binary patch, ref inventory and verified
Git bundle are preserved locally under
`.git/consolidation/20260906T204623Z/`. These drafts are not blindly reapplied:
old screen layouts, config and lockfiles can undo the newer implementation.
Review the preserved patch when recovering a specific unfinished idea.

The same nine files are also preserved in the local-only annotated tag
`archive/local-drafts-20260907`. Do not publish this private draft snapshot
with a blanket `git push --tags`.

Historical branches are not competing development lines. Retire only branches
whose work is integrated or separately preserved, and never race an active
writer. New changes, reviews and releases should converge on `main`.
