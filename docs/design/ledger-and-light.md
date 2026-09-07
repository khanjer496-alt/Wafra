# Wafra — Ledger & Light

Authoritative visual reference: Claude commit `934e5cb14bfaf8dedd1b6adb0a7bcbd87d10267f`, especially `src/constants/theme.ts`, `src/components/wafra-logo.tsx`, `src/components/themed-text.tsx` and `src/components/ui/layout.tsx`.

This restores the original design language onto consolidated main `3d390633a72d665f74e6b27e6f13f2176087431a`; it does not restore that old app's parser, storage, permissions or financial logic.

## Rules

Use limestone paper (`#F4F1EA`) and warm charcoal (`#14120F`), never a forest-green page or cool blue background. Use restrained green (`#1F6B52` / `#57B894`) for actions and selection. Income, clay expense and warning colours convey meaning, not decoration.

Group content with whitespace and one-pixel rules. Read-only summaries, category lists, account groups, payment schedules, detail tables and settings sections do not become decorative cards. A bordered block is justified when the whole thing is a control or dismissible notice. Sheet and button corners use the semantic original radius tokens; do not introduce giant floating pill navigation or a central plus.

Use Geist for Latin text, Geist Mono for financial figures and Noto Kufi Arabic for Arabic text. Font weight is a named bundled face. Keep current font-scaling support, Arabic joining/bidi handling, sufficient line height, readable body sizes and large-text stacking; the restoration does not justify accessibility regressions. Preserve exact financial amounts and their currency/unknown-state labels.

The original mark is the two-stroke W ending in an upward arrow. It uses one colour. No leaf branding, glow, gradients or decorative rotations. Launcher/splash assets are generated from the same paths as the in-app mark.

Categories use their glyph, not a rainbow of backgrounds. Do not invent bank connections, balance-history graphs, savings percentages or safe-to-spend figures to decorate a screen.

## Motion and SMS status

Selection is immediate. No tab-focus spring or entrance delay; progress bars initialize at their actual value rather than animating up from zero each time the view mounts. Retain existing platform/reduced-motion safeguards. This removes known presentation work; it is not a measured claim that all app/import latency is fixed.

SMS status reads the existing durable coordinator's `scanned`, `found`, `status` and `error`. Show checked-message and found-transaction counts, a native activity indicator while running, and the existing resume/permission action when interrupted. Do not fabricate a percentage, total, ETA or background-completion promise. Tell users to keep the app open while importing. Keep parsing, save/acknowledgement order and retention untouched.

## Regression checks and acceptance

`node --test scripts/test/repair/ledger-light.test.cjs` protects palette, faces, original logo geometry, category treatment, direct tab selection and truthful import states in English/Arabic. Existing payment/edit/budget/capture tests remain required. Run typecheck, lint, the full root suite and real Expo browser/native checks before release.

The new inverse/control-border roles remain compatible with current components. The deprecated light gold text alias uses the darker warning-text value rather than the original graphic value to retain contrast. This is an intentional accessibility preservation, not a new palette.

Any screen not visibly inspected in native release remains unverified. A successful build is not proof of physical-phone SMS throughput, frame pacing or upgrade/data retention.
