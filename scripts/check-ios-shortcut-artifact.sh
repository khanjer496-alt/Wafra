#!/usr/bin/env bash
set -euo pipefail

# Inspect the exact unsigned action graph behind a public iCloud Shortcut.
# This is intentionally a macOS release tool: plutil understands Apple's
# binary property-list source without adding a parser dependency to the app.

URL=${1:-}
if [[ ! "$URL" =~ ^https://www\.icloud\.com/shortcuts/([A-Za-z0-9_-]+)/*$ ]]; then
  echo "usage: bash scripts/check-ios-shortcut-artifact.sh https://www.icloud.com/shortcuts/<id>" >&2
  exit 2
fi

SHORTCUT_ID=${BASH_REMATCH[1]}
if [[ "$SHORTCUT_ID" == "85bd1e080e5849b591049eccffb9a3a1" ]]; then
  echo "FAIL: this is the retired Shortcut with the invalid file-path action" >&2
  exit 1
fi

TMP_DIR=$(mktemp -d "${TMPDIR:-/tmp}/wafra-shortcut-check.XXXXXX")
trap 'rm -rf "$TMP_DIR"' EXIT

curl --fail --silent --show-error --location \
  "https://www.icloud.com/shortcuts/api/records/$SHORTCUT_ID" \
  --output "$TMP_DIR/record.json"

NAME=$(jq -r '.fields.name.value // ""' "$TMP_DIR/record.json")
DOWNLOAD=$(jq -r \
  '.fields.shortcut.value.downloadURL | gsub("\\$\\{f\\}"; "WafraCapture.shortcut")' \
  "$TMP_DIR/record.json")

if [[ "$NAME" != "Wafra Capture" || -z "$DOWNLOAD" || "$DOWNLOAD" == "null" ]]; then
  echo "FAIL: the public record is not a downloadable Wafra Capture Shortcut" >&2
  exit 1
fi

curl --fail --silent --show-error --location "$DOWNLOAD" \
  --output "$TMP_DIR/WafraCapture.shortcut"
plutil -convert json -o "$TMP_DIR/shortcut.json" "$TMP_DIR/WafraCapture.shortcut"

jq -e '
  .WFWorkflowImportQuestions as $questions
  | ($questions | length) == 1
  and $questions[0].Category == "Parameter"
  and $questions[0].ParameterKey == "WFTextActionText"
  and ($questions[0].ActionIndex | type) == "number"
  and (.WFWorkflowActions[$questions[0].ActionIndex].WFWorkflowActionIdentifier
       == "is.workflow.actions.gettext")
  and ((.WFWorkflowActions[$questions[0].ActionIndex]
        .WFWorkflowActionParameters.WFTextActionText // "") == "")
' "$TMP_DIR/shortcut.json" >/dev/null || {
  echo "FAIL: setup must be one empty Text field protected by one import question" >&2
  exit 1
}

if jq -e '
  [.WFWorkflowActions[].WFWorkflowActionIdentifier]
  | any(test("documentpicker|file\\.move|file\\.create|folder"; "i"))
' "$TMP_DIR/shortcut.json" >/dev/null; then
  echo "FAIL: file/folder configuration actions are prohibited" >&2
  exit 1
fi

if jq -e '[.. | strings] | any(test("config\\.json|wafra-relay\\.|khanjer496"; "i"))' \
  "$TMP_DIR/shortcut.json" >/dev/null; then
  echo "FAIL: the shared graph contains a retired path or literal relay origin" >&2
  exit 1
fi

for required in sender eventId receivedAt; do
  if ! jq -e --arg required "$required" \
    '[.. | strings] | any(. == $required)' "$TMP_DIR/shortcut.json" >/dev/null; then
    echo "FAIL: the shared graph does not contain the required $required field" >&2
    exit 1
  fi
done

echo "PASS: $NAME uses import-question setup, has no file actions, and carries sender/event/date fields"
