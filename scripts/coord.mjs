#!/usr/bin/env node
// Coordination board for multiple AI agents sharing this working tree.
//
// Two agents (Claude Code and Codex) edit /Users/naserkhanjar/Wafra at the same
// time. Nothing stops them from writing the same file two seconds apart, so this
// script is the referee: claim the paths you are about to edit, and refuse to
// touch paths somebody else has claimed.
//
//   node scripts/coord.mjs status
//   node scripts/coord.mjs claim src/lib/sms-parser.ts --as claude --task "ADCB refunds"
//   node scripts/coord.mjs check src/lib/cards.ts --as codex
//   node scripts/coord.mjs release --as claude --all
//   node scripts/coord.mjs send --as claude --to codex "parser.ts is yours, I took cards.ts"
//   node scripts/coord.mjs inbox --as codex
//
// State lives in .coord/ (gitignored). BOARD.md there is regenerated on every
// mutation so a human — or an agent that only reads files — can see the state.

import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
const DIR = path.join(ROOT, '.coord')
const STATE = path.join(DIR, 'state.json')
const BOARD = path.join(DIR, 'BOARD.md')
const LOG = path.join(DIR, 'log.jsonl')
const MUTEX = path.join(DIR, '.mutex')

const AGENTS = ['claude', 'codex']
const LOCK_TTL_MIN = 90
const MUTEX_STALE_MS = 15_000

const now = () => new Date().toISOString()
const die = (msg) => {
  process.stderr.write(`coord: ${msg}\n`)
  process.exit(1)
}

// --- mutex -----------------------------------------------------------------
// mkdir is atomic on POSIX, so it doubles as a cross-process lock. Both agents
// run as the same user on one machine, so this is all the mutual exclusion the
// state file needs.

// Any process.exit() while we hold the mutex would skip the finally below and
// wedge the next command, so drop it on the way out no matter how we leave.
let holding = false
process.on('exit', () => {
  if (holding) {
    try {
      fs.rmSync(MUTEX, { recursive: true, force: true })
    } catch {}
  }
})

function withMutex(fn) {
  fs.mkdirSync(DIR, { recursive: true })
  // Must exceed MUTEX_STALE_MS, or we would give up before a stale lock from a
  // killed process ever becomes breakable.
  const deadline = Date.now() + MUTEX_STALE_MS * 3
  for (;;) {
    try {
      fs.mkdirSync(MUTEX)
      break
    } catch (err) {
      if (err.code !== 'EEXIST') throw err
      let age = Infinity
      try {
        age = Date.now() - fs.statSync(MUTEX).mtimeMs
      } catch {
        continue // vanished under us; retry immediately
      }
      if (age > MUTEX_STALE_MS) {
        // Holder died mid-write. Break the lock rather than wedge forever.
        try {
          fs.rmSync(MUTEX, { recursive: true, force: true })
        } catch {}
        continue
      }
      if (Date.now() > deadline) die('timed out waiting for .coord/.mutex')
      Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, 25)
    }
  }
  holding = true
  try {
    return fn()
  } finally {
    holding = false
    try {
      fs.rmSync(MUTEX, { recursive: true, force: true })
    } catch {}
  }
}

// --- state -----------------------------------------------------------------

const EMPTY = { version: 1, seq: 0, locks: [], tasks: [], messages: [] }

function load() {
  try {
    const parsed = JSON.parse(fs.readFileSync(STATE, 'utf8'))
    return { ...EMPTY, ...parsed }
  } catch {
    return structuredClone(EMPTY)
  }
}

function save(state) {
  fs.mkdirSync(DIR, { recursive: true })
  const tmp = `${STATE}.tmp`
  fs.writeFileSync(tmp, `${JSON.stringify(state, null, 2)}\n`)
  fs.renameSync(tmp, STATE) // atomic: no reader ever sees a half-written file
  fs.writeFileSync(BOARD, renderBoard(state))
}

function append(event) {
  fs.mkdirSync(DIR, { recursive: true })
  fs.appendFileSync(LOG, `${JSON.stringify({ at: now(), ...event })}\n`)
}

// --- paths -----------------------------------------------------------------

function normalize(p) {
  const abs = path.resolve(process.cwd(), p)
  const rel = path.relative(ROOT, abs)
  if (rel.startsWith('..')) die(`path is outside the repo: ${p}`)
  return rel === '' ? '.' : rel
}

// A claim on a directory covers everything under it, so "src/lib" and
// "src/lib/cards.ts" collide. Compare segment-wise so "src/libs" does not.
function overlaps(a, b) {
  if (a === b) return true
  // normalize() renders the repo root as ".", which is an ancestor of every
  // path but shares no leading segment with any of them.
  if (a === '.' || b === '.') return true
  const A = a.split('/')
  const B = b.split('/')
  const n = Math.min(A.length, B.length)
  for (let i = 0; i < n; i++) if (A[i] !== B[i]) return false
  return true
}

const expired = (lock) =>
  Date.now() - new Date(lock.at).getTime() > (lock.ttlMin ?? LOCK_TTL_MIN) * 60_000

function liveLocks(state) {
  return state.locks.filter((l) => !expired(l))
}

// --- rendering -------------------------------------------------------------

function ago(iso) {
  const mins = Math.round((Date.now() - new Date(iso).getTime()) / 60_000)
  if (mins < 1) return 'just now'
  if (mins < 60) return `${mins}m ago`
  return `${Math.round(mins / 60)}h ago`
}

function renderBoard(state) {
  const live = liveLocks(state)
  const out = ['# Agent coordination board', '', `_Generated ${now()} — do not hand-edit; use scripts/coord.mjs._`, '']

  out.push('## Claimed paths', '')
  if (!live.length) out.push('_Nothing claimed. The tree is free._', '')
  else {
    out.push('| Path | Owner | Task | Claimed | Expires in |', '| --- | --- | --- | --- | --- |')
    for (const l of live) {
      const mins = Math.round(
        ((l.ttlMin ?? LOCK_TTL_MIN) * 60_000 - (Date.now() - new Date(l.at).getTime())) / 60_000,
      )
      const warn = mins <= 15 ? ` ⚠️ renew` : ''
      out.push(`| \`${l.path}\` | **${l.agent}** | ${l.task || '—'} | ${ago(l.at)} | ${mins}m${warn} |`)
    }
    out.push('')
  }

  const open = state.tasks.filter((t) => t.status !== 'done')
  out.push('## Tasks', '')
  if (!open.length) out.push('_No open tasks._', '')
  else {
    out.push('| # | Status | Owner | Title |', '| --- | --- | --- | --- |')
    for (const t of open) out.push(`| ${t.id} | ${t.status} | ${t.owner || '—'} | ${t.title} |`)
    out.push('')
  }

  for (const agent of AGENTS) {
    const unread = state.messages.filter((m) => m.to === agent && !m.read)
    if (unread.length) {
      out.push(`## Unread for ${agent} (${unread.length})`, '')
      for (const m of unread) out.push(`- **from ${m.from}**, ${ago(m.at)}: ${m.text}`)
      out.push('')
    }
  }

  return out.join('\n')
}

// --- arg parsing -----------------------------------------------------------

function parseArgs(argv) {
  const flags = {}
  const positional = []
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i]
    if (a.startsWith('--')) {
      const key = a.slice(2)
      const next = argv[i + 1]
      if (next === undefined || next.startsWith('--')) flags[key] = true
      else {
        flags[key] = next
        i++
      }
    } else positional.push(a)
  }
  return { flags, positional }
}

function whoami(flags) {
  const who = flags.as || process.env.COORD_AGENT
  if (!who) die('who are you? pass --as claude|codex (or set COORD_AGENT)')
  if (!AGENTS.includes(who)) die(`unknown agent "${who}" — expected one of ${AGENTS.join(', ')}`)
  return who
}

// --- commands --------------------------------------------------------------

const commands = {
  status({ flags }) {
    const state = load()
    if (flags.json) {
      process.stdout.write(`${JSON.stringify({ ...state, locks: liveLocks(state) }, null, 2)}\n`)
      return
    }
    process.stdout.write(`${renderBoard(state)}\n`)
  },

  claim({ flags, positional }) {
    const me = whoami(flags)
    if (!positional.length) die('claim what? pass one or more paths')
    const paths = positional.map(normalize)
    // Report conflicts after releasing the mutex, never from inside it.
    const conflicts = withMutex(() => {
      const state = load()
      const live = liveLocks(state)
      const found = []
      for (const p of paths)
        for (const l of live)
          if (l.agent !== me && overlaps(l.path, p)) found.push({ want: p, held: l })
      if (found.length && !flags.force) return found

      // Drop expired locks and any prior claim of mine on the same paths.
      state.locks = live.filter((l) => !(l.agent === me && paths.some((p) => overlaps(l.path, p))))
      for (const p of paths) {
        state.seq++
        state.locks.push({
          id: state.seq,
          agent: me,
          path: p,
          task: typeof flags.task === 'string' ? flags.task : '',
          ttlMin: flags.ttl ? Number(flags.ttl) : LOCK_TTL_MIN,
          at: now(),
        })
      }
      save(state)
      append({ event: 'claim', agent: me, paths, task: flags.task })
      process.stdout.write(`claimed by ${me}: ${paths.join(', ')}\n`)
      return null
    })

    if (conflicts) {
      for (const c of conflicts)
        process.stderr.write(
          `BLOCKED  ${c.want} — ${c.held.agent} holds ${c.held.path} (${c.held.task || 'no task'}, ${ago(c.held.at)})\n`,
        )
      process.stderr.write(
        `\nDo not edit these. Either work elsewhere, or ask:\n` +
          `  node scripts/coord.mjs send --as ${me} --to ${conflicts[0].held.agent} "can I take ${conflicts[0].want}?"\n`,
      )
      process.exit(2)
    }
  },

  // Locks expire so a crashed session cannot wedge the tree, but a long task
  // would otherwise lose its claim mid-edit without noticing. Renew to reset
  // the clock on everything you still hold.
  renew({ flags }) {
    const me = whoami(flags)
    withMutex(() => {
      const state = load()
      let n = 0
      for (const l of state.locks)
        if (l.agent === me && !expired(l)) {
          l.at = now()
          n++
        }
      save(state)
      append({ event: 'renew', agent: me, count: n })
      process.stdout.write(
        n ? `renewed ${n} claim(s) for ${me}\n` : `${me} holds no live claims — re-claim to take them back\n`,
      )
    })
  },

  release({ flags, positional }) {
    const me = whoami(flags)
    if (!positional.length && !flags.all) die('release what? pass paths, or --all')
    const paths = positional.map(normalize)
    withMutex(() => {
      const state = load()
      const before = state.locks.length
      state.locks = state.locks.filter((l) => {
        if (l.agent !== me) return true
        if (flags.all) return false
        return !paths.some((p) => overlaps(l.path, p))
      })
      save(state)
      append({ event: 'release', agent: me, paths: flags.all ? ['*'] : paths })
      process.stdout.write(`released ${before - state.locks.length} claim(s) held by ${me}\n`)
    })
  },

  // Exit 0 = safe to edit. Exit 2 = someone else owns it. Meant for scripting:
  //   node scripts/coord.mjs check src/foo.ts --as claude && edit it
  check({ flags, positional }) {
    const me = whoami(flags)
    if (!positional.length) die('check what? pass one or more paths')
    const state = load()
    const live = liveLocks(state)
    let blocked = false
    for (const p of positional.map(normalize)) {
      const held = live.find((l) => l.agent !== me && overlaps(l.path, p))
      if (held) {
        blocked = true
        process.stdout.write(`BLOCKED ${p} — held by ${held.agent} (${held.task || 'no task'})\n`)
      } else {
        const mine = live.find((l) => l.agent === me && overlaps(l.path, p))
        process.stdout.write(`${mine ? 'OK-MINE' : 'FREE   '} ${p}\n`)
      }
    }
    process.exit(blocked ? 2 : 0)
  },

  send({ flags, positional }) {
    const me = whoami(flags)
    const to = flags.to
    if (!AGENTS.includes(to)) die('--to must be claude or codex')
    if (to === me) die('you cannot message yourself')
    const text = positional.join(' ').trim()
    if (!text) die('empty message')
    withMutex(() => {
      const state = load()
      state.seq++
      state.messages.push({ id: state.seq, from: me, to, text, at: now(), read: false })
      save(state)
      append({ event: 'send', from: me, to, text })
      process.stdout.write(`sent to ${to} (#${state.seq})\n`)
    })
  },

  inbox({ flags }) {
    const me = whoami(flags)
    withMutex(() => {
      const state = load()
      const unread = state.messages.filter((m) => m.to === me && !m.read)
      if (!unread.length) {
        process.stdout.write(`no new messages for ${me}\n`)
        return
      }
      for (const m of unread) process.stdout.write(`#${m.id} from ${m.from} (${ago(m.at)}): ${m.text}\n`)
      if (!flags.peek) {
        for (const m of unread) m.read = true
        save(state)
      }
    })
  },

  task({ flags, positional }) {
    const [sub, ...rest] = positional
    withMutex(() => {
      const state = load()
      if (sub === 'add') {
        const title = rest.join(' ').trim()
        if (!title) die('task add <title>')
        state.seq++
        const id = `T${state.seq}`
        state.tasks.push({
          id,
          title,
          owner: typeof flags.owner === 'string' ? flags.owner : '',
          status: 'todo',
          at: now(),
        })
        save(state)
        append({ event: 'task-add', id, title, owner: flags.owner })
        process.stdout.write(`${id}  ${title}\n`)
        return
      }
      if (sub === 'start' || sub === 'done' || sub === 'block') {
        const me = whoami(flags)
        const id = rest[0]
        const t = state.tasks.find((x) => x.id === id)
        if (!t) die(`no such task: ${id}`)
        t.status = sub === 'start' ? 'doing' : sub === 'done' ? 'done' : 'blocked'
        if (sub === 'start') t.owner = me
        save(state)
        append({ event: `task-${sub}`, id, agent: me })
        process.stdout.write(`${id} -> ${t.status}\n`)
        return
      }
      if (sub === 'list' || sub === undefined) {
        for (const t of state.tasks) process.stdout.write(`${t.id}  ${t.status.padEnd(7)} ${t.owner.padEnd(6)} ${t.title}\n`)
        return
      }
      die(`unknown: task ${sub} (expected add|start|done|block|list)`)
    })
  },

  note({ flags, positional }) {
    const me = whoami(flags)
    const text = positional.join(' ').trim()
    if (!text) die('note <text>')
    append({ event: 'note', agent: me, text })
    process.stdout.write('logged\n')
  },

  log({ flags }) {
    const n = Number(flags.n || 30)
    let lines = []
    try {
      lines = fs.readFileSync(LOG, 'utf8').trim().split('\n').filter(Boolean)
    } catch {
      process.stdout.write('(no activity yet)\n')
      return
    }
    for (const line of lines.slice(-n)) {
      const e = JSON.parse(line)
      const who = e.agent || e.from || '—'
      const what = e.text || e.title || (e.paths ? e.paths.join(' ') : '') || e.id || ''
      process.stdout.write(`${e.at}  ${who.padEnd(6)} ${e.event.padEnd(11)} ${what}\n`)
    }
  },

  reset({ flags }) {
    if (!flags.yes) die('this wipes all claims, tasks and messages. re-run with --yes')
    withMutex(() => {
      save(structuredClone(EMPTY))
      append({ event: 'reset' })
      process.stdout.write('board reset\n')
    })
  },
}

const [, , cmd, ...rest] = process.argv
if (!cmd || cmd === 'help' || cmd === '--help') {
  process.stdout.write(
    [
      'Agent coordination board — see AGENTS.md for the protocol.',
      '',
      '  status [--json]                          show the board',
      '  claim <paths...> --as X [--task T]       take ownership before editing',
      '  check <paths...> --as X                  exit 2 if someone else owns a path',
      '  renew --as X                             reset the clock on your claims',
      '  release [paths...] --as X | --all        give paths back',
      '  send --as X --to Y <text>                message the other agent',
      '  inbox --as X [--peek]                    read your messages',
      '  task add <title> [--owner X]             add a task',
      '  task start|done|block <id> --as X        move a task',
      '  task list                                list tasks',
      '  note --as X <text>                       append to the activity log',
      '  log [--n 30]                             recent activity',
      '  reset --yes                              wipe the board',
      '',
    ].join('\n'),
  )
  process.exit(0)
}
if (!commands[cmd]) die(`unknown command "${cmd}" — run \`node scripts/coord.mjs help\``)
commands[cmd](parseArgs(rest))
