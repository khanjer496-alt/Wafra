/**
 * The one part of iPhone capture that no code in this app can revoke.
 *
 * iOS capture is a personal automation the USER built in Apple Shortcuts, and
 * the ingest bearer token is baked into it. Apple exposes no API to read, edit
 * or delete somebody's Shortcut, so every "disconnect" Wafra performs is
 * one-sided: the relay forgets the device (`unpairDevice` /
 * `revokeTrustedDevice` / `deleteTrustedVault` all delete the row that carries
 * `ingest_token_hash`, so the token authenticates against nothing and the
 * Worker answers 401 before it reads the body), while the automation itself
 * stays installed and keeps firing on every bank alert the user pointed it at.
 *
 * That residue is not a stale credential — it is outbound traffic. The
 * Shortcut still puts the full text of a bank message on the network, to a
 * server that now refuses it. Telling a user "everything is erased" while that
 * continues is the kind of privacy claim this app cannot afford to get wrong,
 * so the honest ending to any iOS disconnect is: say the Shortcut is still
 * there, say what it is still doing, and hand the user the only door that can
 * close it.
 *
 * There is deliberately no automatic "cleanup" call here and no new network
 * request. `shortcuts://` opens Apple's own app and nothing else; Apple has no
 * URL that targets a single shortcut's delete action, so this is as far as the
 * OS lets anyone go.
 */
import { Linking, Platform } from 'react-native';

/** Apple's app-level URL scheme. It carries no query and no identifier. */
const SHORTCUTS_APP_URL = 'shortcuts://';

/**
 * True only when a Shortcut can actually exist: this is an iPhone, and the
 * relay pairing that the Shortcut was built against was really there.
 *
 * Passing `false` for `hadPairing` matters. A user who never set up iPhone
 * capture has no automation to delete, and telling them to go hunting for one
 * teaches them to ignore the warning on the day it is true.
 */
export function shortcutCleanupApplies(hadPairing: boolean): boolean {
  return Platform.OS === 'ios' && hadPairing;
}

/**
 * Open Apple's Shortcuts app. The only door this module can offer.
 *
 * This used to be `promptDeleteShortcut(body, language)`, which raised the
 * alert itself and put this call in a button's `onPress`. That was never the
 * inert-on-web defect the rest of the sweep was about — `shortcutCleanupApplies`
 * gates every call site on `Platform.OS === 'ios'`, so the alert could not
 * silently do nothing on a platform that never reaches it. It was a smaller
 * thing: a library reaching for UI, which is why the fix had to be a two-file
 * change and why the alert outlived every other one in the app.
 *
 * Now the callers own the asking — they are screens, they already hold the
 * body string that differs per path, and they can draw a sheet — and this owns
 * the one thing only it knows: the URL.
 *
 * Best effort by design. A phone with the Shortcuts app removed cannot open
 * it, and there is nothing useful to say about that: the sheet has already
 * told the user what is still installed and what it is still doing.
 */
export function openShortcutsApp(): void {
  void Linking.openURL(SHORTCUTS_APP_URL).catch(() => {});
}
