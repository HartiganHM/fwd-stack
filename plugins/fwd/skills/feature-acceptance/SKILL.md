---
name: feature-acceptance
description: Use when a UI feature is finished — before calling any PR done and again before closing out a multi-PR feature line. Defines the acceptance artifacts (route×viewport contact sheet, cross-route sameness checks, the route inventory) that prove a feature actually landed on every surface it claimed. Complements pr-review, which governs the review loop; this governs whether the work is right.
---

# feature-acceptance

**First, read the project's own rules.** If `.claude/fwd/feature-acceptance.md` exists in the project, read
it before anything else: it names the project's own tools and conventions for this skill, and
its rules add to these and win where they conflict.

`pr-review` governs the review loop — whether the code was read. This governs
whether the feature is **there**. They are different questions and they fail
independently.

## Why this exists

One feature line, illustratively: five PRs, dozens of review rounds, dozens of
findings, more than a day of PR lifetime. Then the user opened the app and found three gaps in a few minutes:

- two of the three routes the feature claimed didn't show the new control;
- a fourth route was right on desktop and wrong on the phone;
- the phone treatment didn't reuse the component another route already had.

None of the review findings was any of these, and that is structural rather than bad
luck. **A code review reads a diff. None of these three gaps exists in a diff:**

| Gap                              | Why a diff can't show it                                    |
| -------------------------------- | ----------------------------------------------------------- |
| A route didn't get the component | An absence. The diff shows what was added, not what wasn't. |
| Mobile differs from desktop      | Both halves are individually plausible.                     |
| "Same as route X"                | Sameness lives _between_ files, in different PRs.           |

Worse, each of the five PRs passed its own gate. Every gap was at a seam between
them. **A per-PR gate cannot accept a feature.**

And beware the check that passes for the wrong reason: on that feature, the two
"missing" routes did mount a component, which itself wrapped the shared
primitive. Every structural check of the form _does this route use the chassis_
returned yes, the PR description was literally true, and the routes still didn't
look alike. A per-route reimplementation wearing the shared component's name
defeats every check except looking.

## The four artifacts

A UI feature is not done until these exist. They are cheap — the whole set is
minutes — and they are the only things that catch the class of failure above.

### 1 · The route inventory

The **plan** carries a table of every route × viewport the feature touches,
written before implementation starts. Not "mounts the chassis" — a row per
surface:

| Route       | 390px | 1300px | Shares with |
| ----------- | ----- | ------ | ----------- |
| `/projects` | ☐     | ☐      | — (origin)  |
| `/teams`    | ☐     | ☐      | `/projects` |
| `/search`   | ☐     | ☐      | `/projects` |
| `/archive`  | ☐     | ☐      | `/projects` |

(Use the project's own phone and desktop widths as the column headers.)

Close-out ticks each cell against the **running app**, not against a diff. A row
that was never loaded is not done, however green its PR was.

The inventory is also the input to artifacts 2 and 3 — write it once, and the
checks read it.

### 2 · The contact sheet

One script — **not one per feature** — that loads every route in the inventory at
both viewports and lays the shots out as a single image. No assertions about the
pixels. No baselines. Nothing to approve or maintain. It gets attached to the PR
and to the close-out.

This is the artifact that catches "that route doesn't have it" and "the phone is
wrong" in one glance, because that is exactly how a human catches them.

**It must be a separate script from the feature's own probe.** A probe is written
by the same agent that wrote the code, so it asserts what that agent believed —
on the motivating feature, one PR's probe absorbed several rounds of review
findings and still measured the wrong route. A contact sheet has no beliefs; it just shows the page.

> **The project's contact sheet** is named in `.claude/fwd/feature-acceptance.md`: typically a
> Playwright script driven by a per-feature route inventory, where a row's steps reach a surface
> several clicks deep. Adding a feature means adding an inventory, never another script.

### 3 · Cross-route sameness, checked two ways

Whenever a brief says one surface matches another, "looks the same" is not the
requirement — **a shared component is**, or they drift again next round.

- **Import equality.** Does the route import and _use_ the same component the
  origin route does? Static, seconds to run, and the only check that catches a
  per-route copy wearing the shared name.
- **Marker presence.** Every route in the inventory renders the shared
  component's marker at both widths. Absence fails.

Both are deterministic and neither has a baseline to maintain.

**Point the check at a leaf, not at a composed primitive.** A component that
takes its controls as props is _meant_ to be assembled by a route-level wrapper;
requiring every route to import it directly reports correct composition as
failure. On the motivating feature that produced false reports on several routes. Ask
what a route renders as-is, and check that.

> **The project's sameness check** is named in `.claude/fwd/feature-acceptance.md`: typically a
> script reading a `shares` block on the same inventory. Absent that block it does nothing, which
> is the right state while the shared component is still being identified.

### 4 · The close-out walk

Run **once, at the end of the feature line, against the brief** — not per PR.
Per-PR it reads a slice and confirms the slice; that is how five green PRs
produced three gaps. Load every row of the inventory in a real browser, compare
against the brief, and record what you saw.

This is when the `design-review` skill runs against the whole brief.

## Do not add pixel-diff visual regression

It is the obvious-looking answer and it is wrong for this class of bug.

- **A pixel diff fires on change, not on absence.** A route that was supposed to
  change and didn't produces an empty diff — indistinguishable from passing. The
  most common gap is exactly the one it cannot see.
- **It cannot express "should match route X."** That is a comparison between two
  routes, not between a route and its own past.
- **Baselines are flaky in any app with themes, art-driven backgrounds or live
  data**, and approving them costs more than reading them.

A contact sheet plus the two structural checks covers what matters, with nothing
to maintain.

## Sequencing

- **Before implementation:** the inventory goes in the plan.
- **Per PR:** the contact sheet for the routes that PR touches, in the PR body.
  Marker presence and import equality pass.
- **At feature close:** full inventory walked, full contact sheet, `design-review`
  against the brief, and every row ticked.
- **Not done** until the last of those is true, whatever the PRs' review state.

## Budget

This is not extra work laid on top of the review loop — it is where the review
loop's savings go. Under `pr-review`'s round limits, a feature line like the one
above needs a fraction of the rounds it took, and the hours returned are far more
than the artifacts cost. One of those hours spent on the artifacts above would
have caught all three gaps before the user did.

## Red flags

| Thought                                 | Reality                                                       |
| --------------------------------------- | ------------------------------------------------------------- |
| "The PR says all three routes mount it" | A description is not a route. Load them.                      |
| "The probe passes"                      | The probe asserts what its author believed. Look at the page. |
| "Each PR passed review"                 | Every gap in the motivating case was at a seam between PRs.   |
| "It uses the shared component"          | Wrapped or reimplemented? Check the import.                   |
| "Desktop looks right"                   | Both viewports, every route, or the row isn't ticked.         |
| "I'll walk it after the last PR merges" | That walk is part of the feature. Unwalked is unfinished.     |
| "We should add screenshot baselines"    | They fire on change, not absence. See above.                  |
