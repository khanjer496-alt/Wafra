# Expo HAS CHANGED

Read the exact versioned docs at https://docs.expo.dev/versions/v55.0.0/ before writing any code.

# You are not alone in this repo

Claude Code and Codex both work in this tree at the same time. Neither can see
the other's edits until they hit disk, so an unclaimed edit can be silently
overwritten. `scripts/coord.mjs` is the referee. Read `.coord/BOARD.md` to see
the current state at a glance.

**Identify yourself in every command:** `--as claude` or `--as codex`.

## Identities: one per agent, not one per kind

An identity is a base (`claude`, `codex`) with an optional instance suffix
(`claude:s7f2`). Both sides dispatch subagents of their own kind, and the two
dispatch scripts now mint an instance id automatically and put it in
`COORD_AGENT`, so a subagent is never the same actor as the session that
spawned it.

This is not tidiness. When every Claude shared one identity, all three of these
were true at once, and the third actually happened:

- a subagent's claims were indistinguishable from the main session's
- `release --all` from either wiped **both**
- mail Codex addressed to its subagent landed in the main session's inbox,
  where reading it marked it read and the subagent never saw it

Ownership and routing are by **full** identity, so `claude` and `claude:s7f2`
block each other exactly as `claude` and `codex` do. Address a subagent by its
suffix; a bare base reaches only the main session.

## Before you edit anything

Claim the paths first. A claim on a directory covers everything under it.

```bash
node scripts/coord.mjs claim src/lib/sms-parser.ts --as codex --task "ADCB refund case"
```

Exit 0 means the paths are yours. **Exit 2 means another agent owns them — do
not edit those files.** Work elsewhere, or ask for a handoff:

```bash
node scripts/coord.mjs send --as codex --to claude "can I take src/lib/cards.ts?"
```

To test without claiming, use `check` (same exit codes, no side effects).

## While you work

- `node scripts/coord.mjs status` — the whole board
- `node scripts/coord.mjs inbox --as <you>` — read and drain your messages
- `node scripts/coord.mjs note --as <you> "<what you just did>"` — activity log

**Check your inbox at the start of a turn and before you claim anything.** It is
the only way the other agent can reach you.

## When you finish

```bash
node scripts/coord.mjs release --as codex --all
```

Holding claims you are done with blocks the other agent. Claims auto-expire
after 90 minutes so a crashed session cannot wedge the tree forever, but do not
rely on that.

## Rules that keep this safe

1. **Never edit a path another agent holds.** This is the whole point.
2. **Never `git commit`, `push`, `checkout`, `reset`, or `stash`.** The tree has
   a large pile of uncommitted work in flight. Branch state is the human's call.
3. **Claim narrowly.** Claim `src/lib/cards.ts`, not `src/`.
4. **Release promptly.**
5. Shared/high-traffic files (`package.json`, `app.json`, lockfiles) — claim,
   edit, release immediately. Never hold them across a long task.

## Dispatching the other agent as a subagent

Either agent can hand work to the other. The two scripts are mirrors of each
other, same flags, same meaning:

```bash
scripts/ask-codex.sh  --review "Review my changes to src/lib/cards.ts"
scripts/ask-claude.sh --write --tier deep "Fix the settled-statement bug in src/lib/cards.ts"
scripts/ask-codex.sh  --tier fast "Which files import fx-summary.ts?"
```

| Mode | Sandbox | Use for |
| --- | --- | --- |
| *(default)* | read-only | look something up, trace a call path |
| `--review` | read-only | judge code someone already wrote |
| `--write` | workspace-write | implement — the subagent claims paths first |

`ask-claude.sh` needs the standalone `claude` CLI to be logged in — run
`claude login` in a terminal once. It prefers the native build at
`~/.local/bin/claude`. The desktop app's session does not carry over to the CLI.
Until that login happens, only the Claude → Codex direction works.

Claude can also reach Codex through the `codex` MCP server in `.mcp.json`
(tools `codex` and `codex-reply` for threaded multi-turn); that needs a Claude
Code restart to appear. `scripts/ask-codex.sh --resume <thread-id>` does the
same thing from the shell today.

## Picking a model — do not send every task to the big one

Both scripts take `--tier fast|balanced|deep`. Default is `balanced`.

| Tier | Codex | Claude | Send it |
| --- | --- | --- | --- |
| `fast` | gpt-5.6-luna | haiku | lookups, "which files import X", mechanical edits, running tests and reporting |
| `balanced` | gpt-5.6-luna | sonnet | ordinary implementation, ordinary review |
| `deep` | gpt-5.6-sol | opus | subtle logic, money/rounding/allocation code, architecture, a bug that already resisted one attempt |

Rules of thumb:

- **Fan out on `fast`, converge on `deep`.** Ten cheap agents finding candidate
  problems then one deep agent judging them beats ten deep agents.
- **Start one tier lower than feels right.** Escalate when the cheap answer is
  visibly thin — that costs less on average than defaulting to `deep`.
- **Anything touching money, statements, or dates gets `deep`.** This app gets
  those wrong in ways that are expensive and quiet.
- `gpt-5.6-codex` is **not** available on a ChatGPT account. luna and sol only.

Claude's own `Agent` tool takes the same idea via its `model` parameter
(`haiku` / `sonnet` / `opus`) — the tier table applies there too.

## Implement and review, both directions

Neither agent is "the implementer". Whoever holds the claim implements; the
other reviews. The point of the pairing is that a model which has **not** seen
your reasoning catches what you cannot: your own blind spots survive your own
review, and they do not survive someone else's.

After any non-trivial change, ask the other agent for a `--review` pass before
telling the human it is done. Cheap, and it is the whole reason two agents beat
one fast agent.
