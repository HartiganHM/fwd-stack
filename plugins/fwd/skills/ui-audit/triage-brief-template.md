# ui-audit vision-triage subagent brief

You are triaging a batch of Playwright screenshots + DOM-heuristic JSON from a `ui-audit` sweep of the project's staging environment. Return findings in the exact JSON shape at the bottom of this file.

## What is a "finding"

A `finding` is a **pure UI breakage** that a real user would hit on staging. NOT a UX critique, NOT a design-fidelity gap, NOT a copy edit. Only these five classes:

| Class        | Signal                                                                                                     | Example                                 |
| ------------ | ---------------------------------------------------------------------------------------------------------- | --------------------------------------- |
| `overflow`   | Content pushes past the viewport / container right edge; horizontal scroll appears where none should exist | Data table extends past 320px viewport  |
| `wrap`       | Text wraps mid-word to unreadable chunks (single character per line, broken URLs)                          | A narrow table column at mobile         |
| `overlap`    | Two independent elements sit on top of each other with content obscured                                    | Toast covers a modal action button      |
| `image`      | `<img>` in the DOM failed to load in a real browser                                                        | Broken thumbnail rendering the alt text |
| `tap-target` | Interactive element smaller than 24×24 CSS px (WCAG 2.2 AA 2.5.8; 44×44 is the AAA target)                 | Icon button crushed at mobile           |

**Severity is one of two values:**

- `balk` — the render is broken enough that a real user would abandon the current task
- `degraded` — visible defect but the task still completes

## Hard rules — do NOT violate

1. **Do NOT call `gh`, `gh api`, `gh issue create`, or any GitHub mutation.** Filing is the orchestrator's job. You return JSON, that's it.
2. **Do NOT flag findings outside the five classes above.** No UX judgment. No dark-mode gaps. No copy edits. No pixel-perfect comparisons.
3. **Skip `insufficientData: true` captures.** The sweep tagged them because the render is too thin (usually seeder not run). Do not generate findings for these; skip silently.
4. **One finding per (route × class) at the smallest breaking viewport.** If the same overflow appears at 320px, 390px, AND 1440px, that's ONE finding at 320x568 (the mobile break is the worst case). Do NOT return three findings for the same root cause.
5. **Trust the heuristic JSON.** If `hasHorizontalScroll: false` for a route at a viewport, there is no `overflow` finding for that viewport. If `smallTapTargets` is empty, there is no `tap-target` finding.
6. **When in doubt, don't flag.** False positives waste the user's time in the approval gate. Under-report is preferred over over-report.

## What you receive

- A batch of screenshot paths (`.png`) — absolute paths under `<outDir>/<runId>/`
- A heuristic JSON path alongside each (same basename, `.json` extension). It carries:
  ```json
  {
    "hasHorizontalScroll": true,
    "offscreenElements": [{ "selector": "div#x", "rightEdgePx": 500 }],
    "smallTapTargets": [
      { "selector": "button#tiny", "widthPx": 20, "heightPx": 20 }
    ],
    "brokenImages": [{ "src": "broken.png" }],
    "contentDensity": { "mainChildren": 12 },
    "insufficientData": false
  }
  ```
- Enough context to know the routeId, viewport, and state (encoded in the filename as `<routeId>__<state>__<viewport>.png`).

## What you return

**One JSON object with a `findings` array.** No prose, no markdown around it — the orchestrator parses this directly.

```json
{
  "findings": [
    {
      "routeId": "settings",
      "viewport": "320x568",
      "state": "expand-first-card",
      "severity": "balk",
      "class": "wrap",
      "oneLiner": "Detail column wraps one character per line at mobile widths.",
      "screenshotPath": "<outDir>/<run-id>/settings__expand-first-card__320x568.png"
    }
  ]
}
```

**Field requirements:**

- `routeId`, `viewport`, `state` — exact values from the filename, no reformatting
- `severity` — `"balk"` or `"degraded"`, no other values
- `class` — one of `"overflow" | "wrap" | "overlap" | "image" | "tap-target"`, no other values
- `oneLiner` — ≤120 characters. State what breaks + where. No "consider fixing" language.
- `screenshotPath` — the ABSOLUTE path to the `.png` from the batch

**If you find zero findings**, return `{"findings": []}`. Do NOT invent findings to fill the batch.
