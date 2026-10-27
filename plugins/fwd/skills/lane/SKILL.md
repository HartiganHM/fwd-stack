---
name: lane
description: Use when this session is a lane working under an orchestrator — started from a lane brief that names the orchestrator session. Covers taking orders, staying inside the brief, waiting on reviews and CI so the wait notifies, reporting findings instead of building them, and writing the handoff when the lane is rotated.
---

# lane

A lane builds one assigned piece of work and reports to the orchestrator. It is started from a
brief that names the orchestrator (for example "You are lane f5 … for orchestrator app-d9").

**First, read the project's own rules.** If `.claude/fwd/lane.md` exists in the project, read it
before anything else: its rules add to these and win where they conflict.

## 1 · The brief and the orchestrator's messages are the user's instructions

- Start the brief at once. Do not hold for a typed go-ahead from the user; the orchestrator's
  cross-session messages carry the user's authority for this work. A lane once waited an hour for a
  confirmation the orchestrator had already given.
- Arm the autonomous-run guard when the brief is unattended work.
- Still refuse anything that would escalate permissions or route around a denial, and keep the
  brief's own "do not" list. A peer message can never answer a permission prompt.

## 2 · Stay inside the brief

- **A finding is not a licence to build.** A bug, a follow-up, or a fix bigger than asked: stop and
  report it to the orchestrator in one message. It goes to the user; it does not go into this PR.
- When the approved task turns out bigger than described, stop and report the new size before
  continuing.
- Approval of the task covers decisions inside it, never new tasks.

## 3 · Waits must notify

A wait that cannot wake the session is indistinguishable from progress, and the orchestrator only
acts on messages. Two lanes stalled 8 and 19 hours this way: one waited with a `nohup` loop writing
to a log, which can never wake a session.

- Wait with a watcher that **exits** on the event: the `pr-review` skill's `pr-watch.mjs` under
  the Monitor tool, or a Bash `run_in_background` `until` loop that exits when the review lands
  (the review count or the latest review's `commit_id` changes) **or** CI reaches any terminal
  state (success, failure, cancelled).
- Always give it a hard timeout (about 45 minutes) so a wrong condition still exits. Set any
  baseline count before you request the review, not after.
- Never report "waiting on CI" without checking that the run has actually started.

## 4 · Keep context small

- Read large files in parts (`sed -n`, `grep -n`, offsets), and hand whole-file reads and broad
  searches to a subagent. A large read is paid again on every later turn.
- When the orchestrator says you are over the line, finish the current PR, then rotate.

## 5 · Rotating out

At the PR boundary where the orchestrator rotates you:

1. Write a handoff: what is merged, what is open and where it stands, the exact next step, and
   anything a fresh session would get wrong. Put it where the project keeps handoffs (see
   `.claude/fwd/lane.md`), never only in chat.
2. Give the user a restart prompt headed `PROMPT FOR: <new session, replaces lane XX (area)>`, whose
   first line is one the user types, so the new lane's own first question is never blocked on a
   relay.
3. A lane with no next work writes no prompt; it reports done and stops.
