#!/usr/bin/env bash
# Hand a task to a headless Codex agent and print its answer.
#
# The mirror of ask-claude.sh: this is how Claude uses Codex as a subagent.
# Both agents can implement, review, and dispatch to the other — see AGENTS.md.
#
#   scripts/ask-codex.sh --review "Review my changes to src/lib/cards.ts"
#   scripts/ask-codex.sh --write --tier deep "Fix the ADCB refund case in src/lib/sms-parser.ts"
#   scripts/ask-codex.sh --tier fast "Which files import fx-summary.ts?"
#   scripts/ask-codex.sh --resume <thread-id> "now add a test for that"
#
# Model tiers (pay for depth only when the task needs it):
#   --tier fast      gpt-5.6-luna   grep-and-report, mechanical edits, lookups
#   --tier balanced  gpt-5.6-luna   ordinary implementation and review  [default]
#   --tier deep      gpt-5.6-sol    subtle logic, architecture, hard debugging
#
# Note: gpt-5.6-codex is NOT available on a ChatGPT account — luna and sol only.

set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$ROOT"

MODE="investigate"
TIER="balanced"
RESUME=""

while [[ $# -gt 0 ]]; do
  case "$1" in
    --write)   MODE="write";  shift ;;
    --review)  MODE="review"; shift ;;
    --tier)    TIER="${2:?--tier needs fast|balanced|deep}"; shift 2 ;;
    --resume)  RESUME="${2:?--resume needs a thread id}"; shift 2 ;;
    --help|-h) sed -n '2,20p' "${BASH_SOURCE[0]}" | sed 's/^# \{0,1\}//'; exit 0 ;;
    --) shift; break ;;
    *) break ;;
  esac
done

case "$TIER" in
  fast|balanced) MODEL="gpt-5.6-luna" ;;
  deep)          MODEL="gpt-5.6-sol"  ;;
  *) echo "ask-codex: --tier must be fast|balanced|deep" >&2; exit 1 ;;
esac

PROMPT="${*:-}"
[[ -n "$PROMPT" ]] || PROMPT="$(cat)"
[[ -n "$PROMPT" ]] || { echo "ask-codex: empty prompt" >&2; exit 1; }

# The template needs its own X's: GNU coreutils' mktemp rejects a -t
# argument with none ("too few X's in template"), while BSD/macOS mktemp
# appends them itself. Spelling them out works on both.
OUT="$(mktemp -t codex-reply.XXXXXX)"
# Start empty: on an API error codex leaves the file untouched, and a stale
# reply from a previous run would otherwise look like a successful answer.
: > "$OUT"
trap 'rm -f "$OUT"' EXIT

# A distinct board identity per dispatch — see the same comment in
# ask-claude.sh for why sharing one identity across instances was a real bug.
COORD_ID="codex:s$(printf '%04x' $$)"
export COORD_AGENT="$COORD_ID"

SHARED="You are Codex, working as a subagent alongside Claude Code in a SHARED working tree at $ROOT.

YOUR BOARD IDENTITY IS \`$COORD_ID\` — not plain 'codex'. Always pass --as $COORD_ID.
Plain 'codex' is a DIFFERENT agent (the main session) and may hold claims you must not touch.
Check your own mail with: node scripts/coord.mjs inbox --as $COORD_ID
Say your identity when you report, so you can be replied to directly.

Never run git commit, push, checkout, reset, or stash."

case "$MODE" in
  write)
    SANDBOX="workspace-write"
    PREAMBLE="$SHARED
Before editing ANY file you MUST claim it:
    node scripts/coord.mjs claim <paths> --as $COORD_ID --task \"<short description>\"
If that exits non-zero, Claude owns the path — do NOT edit it. Report the conflict instead.
When finished: node scripts/coord.mjs release --as $COORD_ID --all
Leave changes uncommitted for review."
    ;;
  review)
    SANDBOX="read-only"
    PREAMBLE="$SHARED
This is a REVIEW task. Do not modify any file.
Judge the code on correctness first, then clarity. Cite file:line for every point.
Say plainly if something is wrong — do not soften findings. If it looks correct, say so."
    ;;
  *)
    SANDBOX="read-only"
    PREAMBLE="$SHARED
This is a READ-ONLY task. Do not modify any file. Cite file paths and line numbers."
    ;;
esac

if [[ -n "$RESUME" ]]; then
  codex exec resume "$RESUME" --model "$MODEL" --sandbox "$SANDBOX" -o "$OUT" "$PROMPT" >&2
else
  codex exec --model "$MODEL" --sandbox "$SANDBOX" --skip-git-repo-check -o "$OUT" "$PREAMBLE

--- TASK ---
$PROMPT" >&2
fi

if [[ ! -s "$OUT" ]]; then
  echo "ask-codex: no reply — the run failed (check the log above)" >&2
  exit 1
fi

echo "--- codex reply ($MODEL) ---"
cat "$OUT"
