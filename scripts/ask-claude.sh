#!/usr/bin/env bash
# Hand a task to a headless Claude agent and print its answer.
#
# The mirror of ask-codex.sh: this is how Codex uses Claude as a subagent.
# Both agents can implement, review, and dispatch to the other — see AGENTS.md.
#
#   scripts/ask-claude.sh --review "Review my changes to src/lib/cards.ts"
#   scripts/ask-claude.sh --write --tier deep "Fix the statement-settled bug in src/lib/cards.ts"
#   scripts/ask-claude.sh --tier fast "Which files import fx-summary.ts?"
#
# Model tiers (pay for depth only when the task needs it):
#   --tier fast      haiku    grep-and-report, mechanical edits, lookups
#   --tier balanced  sonnet   ordinary implementation and review  [default]
#   --tier deep      opus     subtle logic, architecture, hard debugging

set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$ROOT"

MODE="investigate"
TIER="balanced"

while [[ $# -gt 0 ]]; do
  case "$1" in
    --write)   MODE="write";   shift ;;
    --review)  MODE="review";  shift ;;
    --tier)    TIER="${2:?--tier needs fast|balanced|deep}"; shift 2 ;;
    --help|-h) sed -n '2,18p' "${BASH_SOURCE[0]}" | sed 's/^# \{0,1\}//'; exit 0 ;;
    --) shift; break ;;
    *) break ;;
  esac
done

case "$TIER" in
  fast)     MODEL="haiku"  ;;
  balanced) MODEL="sonnet" ;;
  deep)     MODEL="opus"   ;;
  *) echo "ask-claude: --tier must be fast|balanced|deep" >&2; exit 1 ;;
esac

PROMPT="${*:-}"
[[ -n "$PROMPT" ]] || PROMPT="$(cat)"
[[ -n "$PROMPT" ]] || { echo "ask-claude: empty prompt" >&2; exit 1; }

# Prefer the native build in ~/.local/bin over an older npm global: it reads the
# keychain properly and reports auth failures in a way you can act on.
CLAUDE_BIN="$HOME/.local/bin/claude"
[[ -x "$CLAUDE_BIN" ]] || CLAUDE_BIN="$(command -v claude)" || {
  echo "ask-claude: no claude binary found" >&2; exit 1; }

SHARED="You are Claude, working as a subagent alongside Codex in a SHARED working tree at $ROOT.
Never run git commit, push, checkout, reset, or stash."

# Bash commands a review/investigate agent needs without stalling on a prompt.
#
# These are PREFIX patterns, so `git log && rm -rf x` shares a prefix with an
# allowed entry. Empirically such chained writes were blocked every time we
# tried, but we could not confirm which layer refused them — so do not treat
# this list as a hard boundary. Two consequences:
#   - keep it minimal: ls/cat/grep/wc are omitted because Read/Grep/Glob already
#     cover them, and each extra prefix is another chaining opportunity
#   - the real read-only guarantee is the --tools list below, which withholds
#     Edit and Write at the tool level rather than the argument level
RO_BASH="Bash(node scripts/coord.mjs:*),Bash(git diff:*),Bash(git status:*),Bash(git log:*)"

# The project's own verification commands. A write agent needs these to leave
# the suite green; none of them commit, push, or move a branch.
VALIDATE_BASH="Bash(npm test:*),Bash(npm run typecheck:*),Bash(npm run lint:*),Bash(npm run check:*),Bash(bash scripts/test/run.sh:*),Bash(node scripts/test/corpus.js:*),Bash(npx eslint:*)"

case "$MODE" in
  write)
    PREAMBLE="$SHARED
Before editing ANY file you MUST claim it:
    node scripts/coord.mjs claim <paths> --as claude --task \"<short description>\"
If that exits non-zero, Codex owns the path — do NOT edit it. Report the conflict instead.
When finished: node scripts/coord.mjs release --as claude --all
Leave changes uncommitted for review."
    # acceptEdits auto-approves file writes but NOT Bash, and both the claim
    # protocol and the test suite are Bash. Allowing only coord meant write
    # agents could edit but never check their own work: four separate runs
    # handed back diffs stamped "UNVALIDATED — I could not execute a single
    # command", and the dispatcher had to validate by hand. An agent that
    # cannot run the suite cannot be asked to leave it green.
    ARGS=(--permission-mode acceptEdits --allowedTools "$RO_BASH,$VALIDATE_BASH")
    ;;
  review)
    PREAMBLE="$SHARED
This is a REVIEW task. Do not modify any file.
Judge the code on correctness first, then clarity. Cite file:line for every point.
Say plainly if something is wrong — do not soften findings. If it looks correct, say so."
    ARGS=(--tools "Read,Grep,Glob,Bash" --allowedTools "$RO_BASH")
    ;;
  *)
    PREAMBLE="$SHARED
This is a READ-ONLY task. Do not modify any file. Cite file paths and line numbers."
    ARGS=(--tools "Read,Grep,Glob,Bash" --allowedTools "$RO_BASH")
    ;;
esac

# The prompt goes in on stdin, never as a trailing argument: `--tools` is
# variadic and would otherwise swallow it as a tool name.
OUT="$(mktemp -t claude-reply)"
trap 'rm -f "$OUT"' EXIT

if ! printf '%s\n\n--- TASK ---\n%s\n' "$PREAMBLE" "$PROMPT" |
     "$CLAUDE_BIN" -p --model "$MODEL" "${ARGS[@]}" >"$OUT" 2>&1; then
  cat "$OUT" >&2
  grep -qiE "authenticate|oauth|api key|login" "$OUT" &&
    echo "
ask-claude: the standalone Claude CLI is not logged in.
Run this in a terminal, then retry:  claude login" >&2
  exit 1
fi

echo "--- claude reply ($MODEL) ---"
cat "$OUT"
