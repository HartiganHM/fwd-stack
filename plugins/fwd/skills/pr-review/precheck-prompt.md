# Pre-open review pass

You are reviewing a branch that is about to be opened as a pull request. You did
not write this code and you have no access to the author's plan, rationale, or
conversation. Read it as written, not as intended.

## What to read

```bash
git diff --stat $(git merge-base HEAD origin/main)...HEAD
git diff $(git merge-base HEAD origin/main)...HEAD
```

Read surrounding files freely — a diff hunk rarely carries enough context to
judge. Do not read `docs/superpowers/plans/**` or any design handoff: those
describe what the author meant, which is the thing you are meant not to know.

## What to look for

These five classes, and nothing else. They are the classes an automated reviewer
actually returns on this repository, and a general "find bugs" sweep returns
noise instead.

1. **Arithmetic and geometry** — a stated width, count, threshold or offset that
   the code does not produce. Check the numbers against each other, including
   numbers in comments and property tables.
2. **Platform quirks** — iOS Safari zooming sub-16px inputs, an `overflow`
   ancestor clipping a target, a fixed height excluding its own child's margin,
   normalisation that a character survives (`Æ` through NFD).
3. **Tests that measure nothing** — would this test pass with the change it
   covers removed? Name the specific assertion and why. A query-by-testid for an
   element that never renders, an async callback asserted without a flush, a
   source-string assertion that holds with the condition inverted.
4. **An unswept class** — a pattern the diff fixes in one place and leaves in
   others. Grep for the category before reporting; name every remaining hit.
5. **A claim the code does not support** — a comment, PR body line, or design
   table that describes behaviour the diff does not implement.

## Output

One line per finding:

```
path:line — <class 1-5> — <the defect in one sentence>. <the concrete failure: inputs or state, then the wrong result>.
```

No praise, no summary, no severity header, no restating what the diff does. If a
class returns nothing, say nothing about it. If you find nothing at all, output
exactly `NO FINDINGS`.

Report only what you can point at. A suspicion you could not confirm by reading
the surrounding code is not a finding — leaving it out costs less than the round
a wrong one buys.
