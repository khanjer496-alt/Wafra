# Automatic Pro in selected tester artifacts

The Android APK workflow grants automatic Pro only when dispatched with
`auto_pro: true`, `founder_unlock: true`, and `bundle: false`. The normal APK
default remains the existing optional founder gesture. Conflicting automatic
Pro and Play-bundle inputs fail before compilation.

The iOS `history-beta` EAS profile enables automatic Pro for the selected
TestFlight artifact. It uses the preview environment and its own beta channel.
Production and production-candidate profiles compile automatic access off;
release checks reject tester grants in public profiles or public channels.

On first native hydration, the selected artifact grants the existing local
`founderPro` entitlement. It does not mark a store purchase active, charge the
user, or fabricate a Superwall entitlement. Capture permissions and source
opt-outs still apply.

The grant is durable on that installation: it survives ledger erase, restore,
and later production upgrades. Exported backups do not carry it to another
installation. It is not a store-account entitlement or a promise about access
after uninstalling. Native capture reuses the existing founder lifetime lease.
