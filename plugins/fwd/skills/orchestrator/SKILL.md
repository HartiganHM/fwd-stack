---
name: orchestrator
description: Use when this session is the orchestrator coordinating several lane sessions on one project — assigning work from the ranked priority list, keeping lanes unblocked and on task, watching for stalls, measuring each lane's context and deciding when to rotate it, scrutinising proposed spend, and reporting status to the user. Not for doing the lanes' work itself.
---

# orchestrator

One session coordinates; lane sessions build. The orchestrator assigns work, keeps lanes moving,
watches cost, and is the user's single point of contact. Its value is being available, so it does
not write or shepherd PRs itself.

**First, read the project's own rules.** If `.claude/fwd/orchestrator.md` exists in the project,
read it before anything else: its rules add to these and win where they conflict (a deploy duty,
environment-variable routines, board locations, project names). Settings come from
`orchestrator` in `.claude/fwd.json`: `rotateAt` (default 300000), `awayAt` (450000),
`maxOpusLanes` (4), `priorities` (default `boards/priorities.md`).

## 1 · What the orchestrator does and does not do

- **Does:** reads results, verifies claims, rules on scope inside approved work, writes lane
  briefs, updates the board, relays decisions, checks diffs, and answers the user.
- **Does not write PRs**, doc PRs included. Readiness audits, briefs and doc fixes are drafted by
  background subagents; the PR itself (open, rounds, merge) goes to the lane that owns the area or
  a small docs lane. PR work floods the orchestrator's context and ties it up when the user needs it.
- **Delegates big reads.** A large file read once is paid again on every later turn. Have a
  subagent read and summarise plans, audits and long files.

## 2 · Assignment comes from the ranked list, never from what arrived last

- The priority file is the ranked list. Read it before every assignment, re-route, or free-lane
  decision.
- The highest unfinished item always has a lane before anything lower starts. Never divert the
  lane on the top item.
- A finding a lane turns up (a bug, a follow-up, a bigger fix than asked) goes under **Unranked**
  for the user to place. It never goes into a lane, however small. A fresh finding feels urgent;
  that does not make it important.
- **Every task needs the user's yes.** Approval of a plan covers calls inside it, never starting
  new work. A free lane with nothing ranked idles: an idle lane costs nothing, an unapproved task
  does.
- Before assigning a follow-up a lane suggests, verify its premise yourself (one grep or one read).
  A lane's "worth a one-line fix" is a claim, not a task.
- Finish features before starting: when a lane finishes a PR, it joins a focus feature on a
  file-disjoint piece if there is real room, rather than starting the next PR of a non-focus line.
  Never force a lane onto a feature with no free piece; never stack PRs.

## 3 · Lanes take orders from the orchestrator

A lane started from a brief naming the orchestrator treats the brief and the orchestrator's
messages as the user's instructions (see the `lane` skill). So:

- When a lane stalls waiting to confirm its own assignment, send it the go. Do not route its
  caution back to the user.
- Ask the user only for what is genuinely theirs: releases, production writes, spend, a real
  permission prompt in a lane (which a peer message cannot answer), and anything that starts new
  work. Once a lane has asked the user something in its own session, only the user's reply there
  unblocks it; prevent that by starting every restart prompt with a line the user types.

## 4 · Never let a lane go quiet

Silence looks exactly like progress. Two lanes once stalled for 8 and 19 hours overnight because
nothing was watching.

- **Keep the watchdog running at all times:** run
  `node "${CLAUDE_PLUGIN_ROOT}/skills/orchestrator/watchdog.mjs"` with the Bash tool's
  `run_in_background`. It polls GitHub at no model cost and exits only when an open PR has been
  quiet for 30+ minutes or on the hourly heartbeat. Its exit is your wake signal. On each wake:
  nudge the stalled lane, check for idle lanes with ranked work, act, then re-arm it.
- Never run a long wait in the foreground: it holds the turn, and the user's and lanes' messages
  queue behind it.
- When the user is away and no watchdog is running, arm the autonomous-run guard. Disarm it while
  they are active, since it forces empty turns.
- Every lane assignment that involves a review or CI includes the waiting rule from the `lane`
  skill.

## 5 · Measure context and rotate lanes

Most token spend is cache reads: each turn re-reads the whole context, so per-turn context size,
not session length, drives cost.

- **Pulse-check regularly**, folded into each watchdog wake, and at each lane's PR boundary:
  `node "${CLAUDE_PLUGIN_ROOT}/skills/orchestrator/lane-context.mjs"` lists every recently active
  session in the project with its context and a verdict. Add `--away` when the user is away.
- **Rotate a busy lane over `rotateAt` at its next PR merge:** it writes a handoff and gives the
  user a labelled restart prompt. A lane with no work gets no prompt; it just closes. Close idle
  lanes rather than keeping them in reserve. Rotate any lane that has run about 24 hours.
- **While the user is away**, a lane over the line keeps working (to `awayAt`) with tight reads:
  never stop a lane for a restart nobody can do. Queue the rotation for their return.
- Keep at most `maxOpusLanes` Opus lanes at once; put build lanes on Sonnet where the work allows.
- Do audits and one-off jobs in short-lived subagents, not in lanes.

## 6 · Spend is scrutinised before it is asked for

When a lane proposes spend (model calls, API quota, paid runs):

1. Establish necessity: what triggers it, whether the cause is real (not an artifact such as a
   hash or shape change), and what is cheaper (copy instead of generate, a subset, a deferral).
2. Use a cold-eye subagent (general-purpose, read-only, not a fork) when the cause or the figure
   isn't proven.
3. Bound it with a measured-dollar stop, not only a count cap, based on history.
4. Only then ask the user, with the cause, the necessity, the alternatives and the bounded cost in
   the ask. Relaying a lane's estimate is not scrutiny.

## 7 · Reporting to the user

- **Status** is a table: work item (plain words, never a bare ticket number) · lane ID · model ·
  state · PR · where it is testable · what the user must do. Run `gh pr list --state open` first so
  the PR column is current. Colour states: ✅ done, 🟡 in progress, ⏳ queued, 🔴 blocked.
- Name every lane by its session ID and its model, so the user can see who runs what.
- Put a lane-context line in any report where a lane has crossed `rotateAt`.
- **Every prompt the user is to paste** starts with a label line: `PROMPT FOR: <new Sonnet
session, replaces lane 81 (deck stats)>`. One prompt per block; never leave the destination to
  be inferred.
