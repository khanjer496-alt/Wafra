#!/usr/bin/env bash
set -euo pipefail

# Point the app, release check and tests at a newly published History Shortcut
# iCloud record, and retire the previous record so no build can adopt it again.
#
# usage: bash scripts/refresh-history-shortcut-record.sh <old-32-hex-id> <new-32-hex-id>
# then:  node scripts/release/ios-public-shortcut-check.mjs

OLD_ID=$(printf '%s' "${1:-}" | tr 'A-F' 'a-f')
NEW_ID=$(printf '%s' "${2:-}" | tr 'A-F' 'a-f')
[[ $OLD_ID =~ ^[0-9a-f]{32}$ && $NEW_ID =~ ^[0-9a-f]{32}$ ]] || { echo "usage: $0 <old-id> <new-id>" >&2; exit 2; }
[[ $OLD_ID != "$NEW_ID" ]] || { echo "FAIL: old and new record IDs are identical" >&2; exit 1; }

cd "$(dirname "${BASH_SOURCE[0]}")/.."

FILES=(
  eas.json
  src/lib/ios-history-setup.ts
  src/lib/ios-paged-setup.ts
  scripts/release/ios-public-shortcut-check.mjs
  scripts/test/ios-setup-ux.test.js
  scripts/test/ios-journey/paged-history-interactions.test.cjs
  scripts/test/ios-journey/paged-history-setup.test.cjs
)
grep -q "'$OLD_ID': { name:" src/lib/ios-history-setup.ts || { echo "FAIL: $OLD_ID is not the installed record" >&2; exit 1; }

OLD_UP=$(printf '%s' "$OLD_ID" | tr 'a-f' 'A-F')
NEW_UP=$(printf '%s' "$NEW_ID" | tr 'a-f' 'A-F')
for f in "${FILES[@]}"; do
  perl -pi -e "s/$OLD_ID/$NEW_ID/g; s/$OLD_UP/$NEW_UP/g" "$f"
done

# Retire the replaced record at the top of the retired set.
perl -0pi -e "s{(const RETIRED_HISTORY_SHORTCUT_IDS = new Set\(\[\n)}{\$1  // Replaced History record; see git history for the reason.\n  '$OLD_ID',\n}" src/lib/ios-history-setup.ts

if grep -rn "$OLD_ID" "${FILES[@]}" | grep -v "^src/lib/ios-history-setup.ts:.*  '$OLD_ID',$"; then
  echo "FAIL: stale references to $OLD_ID remain" >&2
  exit 1
fi
echo "record refreshed: $OLD_ID -> $NEW_ID"
