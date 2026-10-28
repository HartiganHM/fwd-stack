---
name: css-layout-triage
description: Use when a CSS layout bug resists fixing — horizontal scrollbar that won't go away, an element bleeding past the viewport, overflow-hidden/clip that "isn't working", a container that won't constrain its children, or any layout fix where the first attempt didn't work. Replaces guess-and-check with DOM measurement.
---

# css-layout-triage

**First, read the project's own rules.** If `.claude/fwd/css-layout-triage.md` exists in the project, read
it before anything else: it names the project's own tools and conventions for this skill, and
its rules add to these and win where they conflict.

## Overview

Layout bugs invite guessing. The symptom (a horizontal scrollbar) is far from the cause (some descendant, possibly several levels away, is wider than its container or has escaped it entirely). Guessing costs a round-trip per attempt and, in a Tailwind codebase, the offending property is usually inside a utility class nobody read.

This skill replaces guessing with measurement. **Measure first, then fix once.**

**Announce at start:** "I'm using the css-layout-triage skill to find the actual overflow source."

---

## The Hard Gate

**After ONE failed fix attempt, stop proposing CSS changes and instrument the DOM.**

This is the whole point of the skill. The failure mode it exists to prevent is: propose `overflow-hidden` on the wrapper → doesn't work → propose `max-w-full` on the child → doesn't work → propose `overflow-x: clip` on a different ancestor → doesn't work → three rounds burned, and the actual cause was a `position: absolute` from a `.sr-only` utility.

If you catch yourself thinking "let me try one more container fix," that's the signal. Instrument instead.

---

## Why Container Fixes Fail: Two Independent Overflow Chains

This is the key mental model. There are **two** ways content can be wider than the viewport, and they respond to completely different fixes.

**1. Flow overflow.** A normally-positioned element is wider than its parent. This is contained by an ancestor's `overflow-x: hidden` or `clip`. Container fixes work here.

**2. Positioned-element overflow.** An element with `position: absolute` (or `fixed`) resolves its geometry against its **containing block** — the nearest ancestor with `position` other than `static`. If no such ancestor exists, the containing block is the **initial containing block** (effectively `<html>`). Such an element measures against `html.scrollWidth` and **bypasses every `overflow` rule on the ancestors in between**, because those ancestors are not its containing block.

No amount of `overflow-hidden` on an intermediate `<div>` will clip an absolutely-positioned descendant that isn't inside it in the positioning sense. The fix is almost always adding `position: relative` to the right ancestor, not adding another overflow property.

**The Tailwind trap:** utilities apply `position: absolute` without saying so in a name you'd recognize. `.sr-only` is the classic — it's `position: absolute` plus clipping, and it's usually invisible so it never occurs to anyone. Others to watch: `.absolute`, `.fixed`, `.inset-0`, and any component library primitive (Radix portals, tooltips, popovers).

---

## Procedure

### Step 1 — Reproduce and confirm the symptom is real

Get the page open at the breaking viewport. Confirm there is actually overflow rather than, say, a scrollbar-gutter or `100vw` rounding artifact.

### Step 2 — Measure the scrollWidth chain

Run in the browser console (or via Playwright `page.evaluate`):

```js
[document.documentElement, document.body].forEach((el) =>
  console.log(el.tagName, 'scrollW', el.scrollWidth, 'clientW', el.clientWidth),
);
```

**Read the result:**

- `html.scrollWidth > body.scrollWidth` → the overflowing element is almost certainly **positioned** and escaping to the initial containing block. Go to Step 3b.
- `body.scrollWidth > body.clientWidth` (and html matches body) → ordinary **flow** overflow. Go to Step 3a.

This single comparison is what tells you which of the two chains you're in, and it's the step that gets skipped.

### Step 3a — Flow overflow: find the widest offender

```js
const vw = document.documentElement.clientWidth;
[...document.querySelectorAll('*')]
  .filter((el) => el.getBoundingClientRect().right > vw + 1)
  .slice(0, 20)
  .forEach((el) =>
    console.log(
      Math.round(el.getBoundingClientRect().right),
      el.tagName,
      el.className,
    ),
  );
```

Walk up from the offender to find the ancestor that _should_ have constrained it. Common causes: a fixed `width`/`min-width`, a grid/flex child that won't shrink (needs `min-width: 0`), a `<pre>`/`<table>`/long unbroken string, or a negative margin.

### Step 3b — Positioned overflow: filter by `position`

```js
const vw = document.documentElement.clientWidth;
[...document.querySelectorAll('*')]
  .filter((el) => el.getBoundingClientRect().right > vw + 1)
  .map((el) => ({ el, pos: getComputedStyle(el).position }))
  .filter(({ pos }) => pos === 'absolute' || pos === 'fixed')
  .forEach(({ el, pos }) =>
    console.log(
      pos,
      Math.round(el.getBoundingClientRect().right),
      el.tagName,
      el.className,
    ),
  );
```

For each hit, walk up the ancestor chain and find where its containing block actually resolves:

```js
function containingBlock(el) {
  let node = el.parentElement;
  while (node) {
    const cs = getComputedStyle(node);
    if (
      cs.position !== 'static' ||
      cs.transform !== 'none' ||
      cs.filter !== 'none' ||
      cs.contain?.includes('layout')
    )
      return node;
    node = node.parentElement;
  }
  return document.documentElement; // escaped to the ICB — this is the bug
}
```

If it returns `<html>`, that's your answer. **The fix is `position: relative` on the wrapper that should have owned it**, not another `overflow` property.

### Step 4 — Fix once, then re-measure

Apply the single fix the measurement points to. Re-run Step 2 to confirm `html.scrollWidth === body.scrollWidth === clientWidth`. Don't stack speculative fixes "just in case" — remove anything you added that the measurement didn't justify.

---

## Tailwind-Specific Notes

- Grep the class list from the console output against the codebase. If the offending class is a Tailwind utility, `getComputedStyle` is the source of truth — the class name will not tell you it applies `position: absolute`.
- `overflow-x: clip` is usually preferable to `overflow-x: hidden` on page chrome: `hidden` makes the element a scroll container, which silently breaks `position: sticky` in descendants. `clip` does not.
- Applying overflow containment to `<body>` or a top-level wrapper is a blunt instrument that hides the symptom repo-wide and makes the next instance harder to find. Prefer the narrowest ancestor the measurement identifies.

---

## When You Still Can't Find It

If two full measurement passes don't localize the cause, stop and pair with the user rather than continuing to iterate. Bring: the scrollWidth chain numbers, the filtered element list with computed `position` values, and what you've already ruled out. That's a five-minute conversation with data versus an hour of round-trips without it.

---

## Reference Incident

A listing page had a horizontal overflow that would not go away. Three container fixes were proposed and all three failed, because the overflow came from a `.sr-only` element — `position: absolute` with no positioned ancestor, so its containing block was `<html>` and every intermediate `overflow-x: clip` was irrelevant. The eventual fix was adding `relative` to the page-chrome wrapper. Step 2's `html.scrollWidth > body.scrollWidth` check would have pointed at the positioned chain on the first pass.
