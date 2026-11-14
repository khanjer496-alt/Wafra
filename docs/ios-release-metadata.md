# Final iOS local-network metadata gate

The distribution IPA built from4ee1de54 contained Expo development-discovery
metadata, despite distribution signing and no development implementation binary.
Why Expo's existing strip phase did not remove it is still unproven.

`app.config.js` registers expo-dev-client explicitly, preserving its existing
options, then the release-metadata plugin. The later automatic legacy pass uses
the existing run-once history. Cleanup awaits the full inner Info.plist mod
chain before deleting only an exact `_expo._tcp` service and a description
containing the case-sensitive text `Expo Dev Launcher`. It deletes the service
array only when empty. Custom services/descriptions, other usage keys and ATS
local-network settings remain untouched.

Explicit inherited iOS Debug/Release configuration wins; otherwise development-client
profiles (including inherited ones) retain discovery even with NODE_ENV=production.
With no EAS profile, local generation retains Debug
discovery unless NODE_ENV=production is explicit. Named non-development EAS
profiles clean the metadata. Invalid/cyclic profile ancestry fails configuration.
Local final Release generation must set NODE_ENV=production; final archive
checking remains mandatory regardless of how source generation was invoked.

`scripts/check-ios-product-versions.py` is a final Release/Store product gate:
besides resolved equal host/extension versions, it rejects either leftover in
the host or extensions. It intentionally is not a development-client checker.

Focused tests run the installed real Expo launcher + cleanup + automatic legacy
Info.plist mod chain in memory, and the real Python checker on binary plists.
They prove custom-key preservation, development behavior, profile inheritance,
and rejection of both artifacts independently. They do not produce a native
project, archive, application build or upload. The next actual final IPA must
prove absence using the shipping checker, with source/build ID/IPA hash recorded.
