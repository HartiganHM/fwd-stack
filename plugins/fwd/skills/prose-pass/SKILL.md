---
name: prose-pass
description: Use when writing or rewriting LONG-FORM in-app prose that users read as paragraphs in the owner's own apps: About entries, How it works pages, explainers, user-facing briefs. Rewrites it in the project's calibrated voice with a fact inventory before and a fact-diff after, so nothing shipped is lost and nothing stale is added. Own apps only. Not for UI strings (buttons, labels, errors, empty states): those belong to /copy-review.
---

# Prose Pass

**First, read the project's own rules.** If `.claude/fwd/prose-pass.md` exists in the project, read
it before anything else: it names the project's own tools and conventions for this skill, and
its rules add to these and win where they conflict.

**Own apps only.** Run only when `.claude/fwd.json` has `"ownApp": true`. Otherwise stop: copy for anyone else's product is written by a human copywriter, never by this skill.

Announce at start: **"Using prose-pass on [surface]. Mode: [propose | apply]."**

You are rewriting prose a user reads in full, so it sounds like someone who knows the domain explaining the app to a friend instead of documentation.

**The project supplies the voice.** `.claude/fwd/prose-pass.md` names the calibrated voice, its binding source (a file the owner calibrated it in), the voice's DO and DON'T rules, its humor rule, its title rules, the facts that must hold, the project's checks, and the worked examples. Read the binding source before every pass: it can move, and the extension only summarizes it. **If the project has no extension or names no voice, stop and report that**: this skill does not invent a voice.

Two modes, never mixed:

- **Propose** (default): produce the fact inventory, the rewrite and the fact-diff. Touch no files.
- **Apply**: make the edits, then run the self-check and the project's checks.

**Scope.** Paragraph prose only. A title is a UI string, so it goes to `/copy-review` together with any button, label, error or empty-state string the pass touches. Never run both skills over the same string.

---

## Baseline rules

These hold in every voice. The extension adds its own, gives each rule its worked example, and wins where it conflicts.

### DO

- **Lead with what the reader gets.** Use "you" for the reader, and "we" only for choices the app makes.
- **Vary sentence length.** One idea per sentence. End on the payoff.
- **Give real numbers and the domain's own nouns.**
- **Ground every concept in domain knowledge.** Explain a term the way someone who knows the domain would. Look up the real definitions before writing about them.
- **Use the app's own names for its parts, every time**, so readers learn them.
- **Say what the app DOES and what it SAVES.** That's all an entry is for.

### DON'T

- **Don't anticipate the reader's worries or behavior.** Naming a worry plants it, can make a working feature look broken, and makes readers want the thing you said you don't do.
- **Don't describe what the app does NOT do or save**, unless leaving it out would mislead.
- **Don't add cross-references that explain nothing.**
- **Don't stack qualifications.**
- **Don't default to lists of three, or write "not X, but Y".**
- **Don't lean on abstract nouns.**
- **Don't keep sentences a uniform length.**
- **Don't hedge**: no "however", "that said", "it's worth noting".
- **Don't over-explain.**
- **Cut the obvious.** If a reader wouldn't wonder it, don't say it.
- **Plain words over artificial ones, and don't name a glyph the screen already shows.**
- **Break up density.** No long single paragraphs. Use short paragraphs of one to three sentences, and a list where a reader scans steps or options.
- **Banned words:** leverage, enable, utilize, seamless, simply, just, easily.
- **Never drop a fact from shipped behavior, and never state a stale one.**

### Mechanical rules

- No em dashes, anywhere. Use a period, a colon or a comma.
- US English, unless the extension names another variant.
- Every fact the extension lists as "must hold" holds.

---

## Procedure

Run every step, in order, for each entry. Write down the output of steps 1, 2 and 5; they are the proof the pass was done.

1. **Fact inventory.** List every fact the original states, one per line: each behavior, number, name, place in the app, cost and limit. Don't judge them yet.
2. **Check against the shipped code.** Read the code each fact describes and mark it current, stale or wrong. The code wins: a stale fact is corrected, not carried over. Then look for facts the code has that the original lacks, and add them only if a reader needs them.
3. **Rewrite in the project's voice.** Use the baseline rules, the extension's voice rules and its worked examples. Apply any example or humor quota the extension sets across the set of entries, not as a goal for each one.
4. **Self-check.** Run each line below against the rewrite:
   - every DON'T rule, baseline and the extension's;
   - the banned-words list;
   - `grep` for "—": none allowed;
   - the spelling variant;
   - the extension's humor rule, if it has one;
   - the app's own names for its parts;
   - no worry-anticipation and no "does not" sentences.
5. **Fact-diff.** Pair every inventory line from step 1 with where it lives in the rewrite. Every current fact must be KEPT. A stale fact must be CORRECTED, with the code reference. A fact may be DROPPED only when it is UI chrome the screen already says or a cross-reference that explains nothing, and the drop must be named and justified. A fact with no row in the diff blocks the pass.
6. **Hand off.** Titles, and any UI string the entry touches, go to `/copy-review`. Prose stays here.

**In apply mode, also:**

- Follow the extension's apply-mode rules (what wiring to keep, what to re-pin, whether a content change needs a version bump).
- Treat a content change as an ordinary edit: no new entry and no version bump unless the user says otherwise.
- Keep the project's checks green: the extension names them.

---

## Worked examples

The extension holds the project's approved worked examples. They are the calibration: match their register; don't copy their sentences into other entries. Where a later ruling in the extension supersedes an example's shape, the ruling wins and the register carries over.

---

## Output (propose mode)

For each entry, in this order:

1. The fact inventory.
2. The code check, with references.
3. The rewrite.
4. The fact-diff table, with columns: fact, status (kept, corrected or dropped), where it lives in the rewrite, and the reason for any drop.
5. The strings handed to `/copy-review`.
