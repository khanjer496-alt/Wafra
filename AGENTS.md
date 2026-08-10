# Expo HAS CHANGED

Read the exact versioned docs at https://docs.expo.dev/versions/v55.0.0/
before writing Expo or React Native code. Do not rely on guidance for another
Expo SDK version.

# Repository workflow

Codex is the only active repository session by default. Work directly in the
current tree; do not use `scripts/coord.mjs`, wait for Claude, or require path
claims merely to inspect or edit files.

If the human explicitly starts another repository-writing session later, stop
overlapping edits until the sessions agree on non-overlapping path ownership.
The coordination scripts may be re-enabled for that period, but they are not
part of the normal single-session workflow.

Subagents are optional workers within the current task, not separate owners of
the repository. Use them when parallel research, testing, or independent review
adds value. Give every writing subagent a narrow, non-overlapping file scope.
Read-only reviewers may inspect the whole tree.

# Worktree safety

The tree may already contain unfinished human or agent changes. Preserve them.
Before editing, inspect `git status` and the relevant diff. Do not discard,
overwrite, reformat, or bundle unrelated work.

Prefer narrow edits and explicit path lists. Shared files such as `package.json`,
`app.json`, and lockfiles should be changed only when the task requires them.

Never run destructive Git operations such as `git reset --hard`, force push,
or broad checkout/restore commands. Do not use `checkout`, `reset`, `rebase`,
or `stash` around a dirty worktree unless the human explicitly requests that
exact operation and its impact is understood.

# Commits and GitHub

The human controls publication. Commit or push only when the human explicitly
authorizes it. The authorization may cover a sequence of completed commits and
their push; do not require the human to repeat it for every commit.

Before each commit:

1. Inspect the complete diff and current branch.
2. Run verification appropriate to the changed surface.
3. Include only finished, reviewed work using explicit pathspecs.
4. Write a focused commit message that describes one coherent change.

Before pushing, verify the exact remote, branch, and commits. Never force-push.
Direct pushes to `main` are allowed only when the human explicitly requested
that destination. Otherwise use the current feature branch and open a PR when
requested.

# Engineering quality

- Keep parsing, money, dates, privacy, encryption, billing, and native import
  changes conservative and covered by focused tests.
- Preserve launch-tested UAE and Saudi behavior while adding broader support.
- Treat worldwide storefront billing and worldwide bank parsing as separate
  capabilities; never claim coverage the app does not have.
- Keep UI work accessible on both iOS and Android and verify important flows on
  the available simulator or device.
- Do not place secrets in source, logs, documentation, commits, or chat.
- Record unavoidable external launch blockers precisely instead of fabricating
  keys, legal URLs, store configuration, device evidence, or keyword-volume
  data.

# Review and verification

After a non-trivial change, obtain an independent read-only review when a
review agent is available. Parser, monetary, date, privacy, security, billing,
and native-platform changes require especially careful review.

Run the smallest useful checks while iterating, then the relevant full suite
before publication. A change is complete only when the implementation, tests,
documentation, and launch claims agree.
