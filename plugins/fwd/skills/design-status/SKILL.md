---
name: design-status
description: Use when the user asks about the design pipeline state ("how are the four lists?", "what's ready for eng?", "design status", "/design-status", or similar). Reads docs/superpowers/design-pipeline-status.md and emits a fixed-shape summary of the four actionable pipeline states (🟢 Ready, 🟡 Yellow, 📐 Brief locked, 🕰️ Backlog) plus a bottleneck read. Read-only — never modifies the tracker.
---

# design-status

**First, read the project's own rules.** If `.claude/fwd/design-status.md` exists in the project, read
it before anything else: it names the project's own tools and conventions for this skill, and
its rules add to these and win where they conflict.

## Overview

Deterministic pipeline-state readout for the current repo's design track (any repo with a `docs/superpowers/design-pipeline-status.md` tracker). Locks the output shape so "how are the four lists?" gets the same answer format every time — solves the "which four?" ambiguity by pinning down 🟢 / 🟡 / 📐 / 🕰️ as the actionable forward-moving states.

**Announce at start:** "Using design-status to pull the four lists."

**Read-only.** Never modify the tracker in this skill — tracker updates happen in the PR that changes the underlying state, never in a readout.

---

## When to invoke

Trigger on any of these:

- User asks about the design pipeline state ("how are the four lists?", "how's design looking?", "what's ready for eng?", "design status")
- User types `/design-status`
- Session start in a design-track context, as a pickup routine

## When NOT to invoke

- User is asking about a specific single ticket (just answer directly)
- User is asking about implementation progress on already-shipped work (that's the project's progress log, if it keeps one — named in `.claude/fwd/design-status.md` — not this)
- User is inside an active design brainstorm or audit (skill would interrupt flow)

---

## Steps

1. **Read the tracker** — `docs/superpowers/design-pipeline-status.md` from the CWD. If the file doesn't exist, say so and stop.

2. **Parse the four actionable states** — walk the file section by section:
   - 🟢 Ready for implementation
   - 🟡 Awaiting Design addendum
   - 📐 Brief locked, awaiting Design handoff
   - 🕰️ Backlog

3. **Fetch phase/priority labels** for every numbered ticket across all four lists. The label scheme (which labels carry phase and priority, and their prefixes) is named in `.claude/fwd/design-status.md`. **If the project defines no such scheme, skip this step and render the Phase · Priority column as `—`.** Otherwise use one API call per ticket:

   ```
   gh issue view <N> --json labels --jq '.labels[].name'
   ```

   (`gh issue view` resolves the repo from the CWD's git remote — never hardcode a repo.)
   Extract the phase and priority labels per the project's scheme. Do these fetches in parallel where possible.

   **Fallback for pre-existing handoffs** (rows in the tracker where the `# / vertical` column is a handoff path without a numbered ticket — e.g. a `<feature>_cards` handoff folder): the tracker's own row may not carry a `#N` reference, but the source ticket usually exists in GitHub. Look it up:

   ```
   gh api -X GET search/issues -f q='repo:OWNER/REPO is:issue is:open <search-terms> in:title,body' -f per_page=5 --jq '.items[] | {number, title, labels: [.labels[].name]}'
   ```

   Replace `OWNER/REPO` with the repo from the git remote. Search terms: derive from the handoff folder name (e.g. `account_settings` → `account settings`, or search on distinctive words from Design's README title). Match the returned issues by title similarity. Prefer the oldest open issue whose title reads like the source problem (not a downstream PR/tracker/plan). Use that ticket's labels for the Phase · Priority column. If no clear match after one search pass, render `—`.

   **Related tickets:** if the row's "Blockers" or "Adjacency" text mentions related tickets by name (e.g., "the settings redesign"), quickly search for them too and surface them inline in the Blockers column as `also related to **#<N>**`. This catches downstream scope inheritance that the tracker might not spell out.

4. **Check the transient states** — 🎨 In flight, 🚦 Paused. Include only if non-empty.

   **Every design ticket must land in one of the four lists or one of these two transient states.** (A "design ticket" is one carrying the project's design label, named in `.claude/fwd/design-status.md`; if the project has no design label, the design tickets are just the ones the tracker lists, and the "absent from the tracker" check below is skipped.) If you find a ticket that fits none — a tracker section not in the legend, an open design-labelled issue absent from the tracker entirely, or two sections whose definitions collide so the ticket could sit in either — **flag it as unplaced and stop trying to place it.** Do not stretch the nearest section to fit, do not invent a category, and do not quietly widen "Also worth flagging" to absorb the overflow. Render:

   ```
   ### ⚠️ Unplaced — flag

   | Ticket | Where it is now | Why it doesn't fit a list |
   |---|---|---|
   | **#N** <title> | <tracker section, or "not in tracker"> | <the specific mismatch> |
   ```

   Improvising placement hides exactly the problem this readout exists to surface. A tracker that runs two lists with identical legend definitions is the classic case: a readout that quietly demotes the overflow into a footnote papers over the collision instead of naming it.

5. **Compose the output** using the fixed shape below. Don't paraphrase headings, don't reorder sections, don't add extra sections.

6. **End with a Bottleneck read** — one paragraph naming where the pipeline is stuck (Design capacity, owner input, eng-planning capacity, or "all flowing"). Base this on which lists are heavy vs light.

---

## Output shape (fixed)

```
## 📊 The four lists — as of <today's date>

### 🟢 Ready for implementation (Green — eng picks up)

**<N> items.**

| # / vertical | Phase · Priority | Handoff | Why it's ready |
|---|---|---|---|
| **<ID>** <title> | <Phase · Priority> | `<handoff path>` | <one-line why: verdict PR, round count, key locked decision> |
| ... |

### 🟡 Awaiting Design addendum (Yellow — one light pass to flip Green)

**<N> items.**

| # / handoff | Phase · Priority | Blockers |
|---|---|---|
| `<handoff path>` (PR #<N>) | <Phase · Priority> | <blocker summary> |
| ... |

### 📐 Brief locked, awaiting Design handoff production

**<N> items.**

| # / vertical | Phase · Priority | Brief PR | Path to eng handoff |
|---|---|---|---|
| **<ID>** <title> | <Phase · Priority> | PR #<N> | <compressed one-line path to eng handoff — what Design still owes> |
| ... |

### 🕰️ Backlog (design cycle not started) — ranked by urgency

**<N> items.**

| Rank | # / vertical | Phase · Priority | Adjacency / notes |
|---|---|---|---|
| 1 | **<ID>** <title> | <Phase · Priority> | <adjacency one-liner> |
| 2 | **<ID>** <title> | <Phase · Priority> | <adjacency one-liner> |
| ... |
```

**Phase · Priority column format:** render as `<Phase> · <Priority>` with capitalized values pulled from the labels — e.g. `Alpha · Normal`, `Launch · Blocker`. If either is missing, render `—` for that half. If both are missing (no ticket, or the project has no label scheme), render the whole cell as `—`.

### Empty-state rule

**All four sections render a table, always** — including when empty. When a section has no items, render the table headers row, then place `_Currently empty._` as an italic paragraph directly under the headers. Don't omit the table scaffold; don't put "Currently empty" as a table row.

Example of empty section:

```
### 📐 Brief locked, awaiting Design handoff production

**0 items.**

| # / vertical | Phase · Priority | Brief PR | Path to eng handoff |
|---|---|---|---|

_Currently empty._
```

### Optional trailing section (only if any transient state is non-empty)

```
### Also worth flagging

- 🎨 **In flight:** <N items — one-line each>
- 🚦 **Paused:** <N items — one-line each>
```

This section is for 🎨 and 🚦 only. It is **not** an overflow bin — anything that doesn't fit a list goes in the ⚠️ Unplaced table from step 4, where it reads as a problem rather than a footnote.

### Required closing paragraph

```
---

**Bottleneck read:** <one paragraph naming the current constraint. Examples:
"Eng-planning is the bottleneck — 4 Greens sit ready and the largest alone will fill a week or two."
"Design capacity is the bottleneck — 3 Yellows waiting on addenda and the Backlog is growing."
"All flowing — Green batch is small, no Yellow, Backlog is being worked.">
```

---

## Density rules

- **Per-item detail:** one row per ticket. Notes should be one sentence, not a paragraph. If the underlying tracker row is long, compress it — the tracker itself is authoritative for full detail.
- **Never cap any list. Print every row, in every section.** A row cap on any list, 🟢 Greens included, silently drops real work from the readout and leaves the user to spot the gap themselves.
- **Never cap the Backlog. Print every row.** 🕰️ Backlog is the entire design queue, so truncating it hides real work. If the list ever gets long enough to want trimming, that is a signal to say so out loud, not to trim.
- **Empty state:** render the table headers, then `_Currently empty._` as an italic paragraph beneath — always show the table scaffold so the reader can see what data would go there when populated.
- **Consistency:** all four sections are tables (not bulleted lists, not numbered lists). List 4 (Backlog) uses a table with a `Rank` column so the ordering is explicit.

## Formatting rules

- Use the exact section headers shown (emoji + phrase) — don't paraphrase
- No `You're absolutely right!` or thanks-language anywhere
- Use `**bold**` for issue IDs and item titles inside tables
- Wrap file paths in backticks
- Wrap PR references as `PR #NNN` (no link markdown — the emitted text is for terminal display)

## What NOT to include

- Recently shipped log (that's a different question — the user can ask "what shipped this week?")
- Immediate TODOs section (implied by state — don't duplicate)
- Personal opinions on individual items (just report the state; opinions belong outside the skill)
- Links to GitHub PRs (the terminal renders them fine as `PR #NNN` and the user knows how to look it up)

## Error handling

- **Tracker file missing:** "Can't find `docs/superpowers/design-pipeline-status.md` from the current working directory. Are we in the root of a repo that runs the design pipeline?" — stop.
- **Section missing from tracker:** report what's present, note the missing section as "(section missing from tracker — flag)".
- **Ambiguous parsing:** if a section is hard to parse (e.g., mid-refactor), quote the raw section instead of guessing.
