---
name: progress-chart
description: Use whenever the user asks for status, the queue, progress, or "how is everything coming" / "how's it going" / "where are we" on a project's work. Shows the progress chart first and alone (one 20-cell bar per named feature line, counted from merged PRs), then a per-group detail table only when the user asks about that group. Also governs how feature lines are added, ordered and counted.
---

# progress-chart

**First, read the project's own rules.** If `.claude/fwd/progress-chart.md` exists in the project,
read it before anything else: it names the project's own tools and conventions for this skill
(such as where its board or priorities file lives), and its rules add to these and win where they
conflict.

Status is a progress chart: the graphic first, then the user asks about specific groups.

## 1 · When

Whenever the user asks for status, the queue, or how things are coming. The chart **always comes
first, alone**. A group's detail table appears only when the user asks about that group. End with
the single open decision (§6).

## 2 · Feature lines

- **Lines are the user's named feature lines only.** Add one only when the user names it or asks
  to promote a group. Everything else is **One-offs**, which get no bar; list them under the chart
  in a line or two if they matter now.
- **Order:** active priority lines first, then queued, then paused.
- **A step** is a PR or a user or external action, sized so each one is a visible unit. When a line
  counts something else, name the unit ("items", "switches retired").
- **Keep a stable step list per line** in the project's board or priorities file, so M does not
  drift. When a step is split or added, say so in one line under the chart: "grew to 11: the
  importer is two PRs".
- **Count from the system of record**, not lane claims: `gh pr list --state merged` and
  `gh pr list --state open` for PR steps, the user's own word for theirs.

## 3 · The chart

A fenced code block, one line per feature line:

```
<LINE NAME, caps, padded to 22> <20-cell bar>  <N of M steps done> [(qualifier)]
```

Right-align N so the counts line up. Glyphs: `█` done, `▒` in flight, `░` not started.
Qualifiers, in parentheses: `(paused)`, `(waits for X)`, `(your call)`.

```
CHECKOUT V2            █████████▒▒░░░░░░░░░   5 of 11 steps done
NOTIFICATIONS          ███████████▒▒▒▒░░░░░   8 of 15 steps done
REFERRAL TRIAL         ████░░░░░░░░░░░░░░░░   2 of 11 steps done (waits for Notifications)
PUBLIC LAUNCH          █████░░░░░░░░░░░░░░░   3 of 11 items done
FLAG RETIREMENTS       ██████▒░░░░░░░░░░░░░  11 of 35 switches retired (paused)
```

## 4 · Bar math

Scale each segment (done, in flight, not started) to `round(count * 20 / M)`. Each is off by at
most half a cell, so the sum can land on 19 or 21: fix it by moving the one segment the rounding
pushed furthest the wrong way, and on a tie move not started first, so a tie never overstates
progress. The bar is always exactly 20 cells.

Worked example, 2 done, 2 in flight, 2 not started (M = 6): each exact share is 6.67, which rounds
to 7 + 7 + 7 = 21. All three rounded up by the same 0.33, so the tie takes the cell from not
started: 7 / 7 / 6, `███████▒▒▒▒▒▒▒░░░░░░`.

Don't count cells by hand. `bar.mjs` beside this file prints the exact bar:

```sh
node "${CLAUDE_PLUGIN_ROOT}/skills/progress-chart/bar.mjs" <done> <inFlight> <total>
```

## 5 · A group's detail, on request

Only when the user asks about a group. Columns `Step | State | PR`:

| Step                 | State                      | PR   |
| -------------------- | -------------------------- | ---- |
| Design handoff       | ✅                         | #101 |
| Order history API    | 🟡 in review (lane b)      | #108 |
| Saved cards screen   | ⏳ after Order history API | —    |
| Turn on for everyone | 🔴 your call               | —    |
| Approve the copy     | ⏳ (you)                   | —    |

- States: ✅ done; 🟡 in flight, with the lane or substate; ⏳ queued, with its dependency; 🔴 blocked
  or needs the user's call.
- Steps are in plain product words, never bare ticket numbers. Put "(you)" on the user's steps.

## 6 · End with one decision

Close with the single open decision that blocks the most, as a direct question. One per turn.
