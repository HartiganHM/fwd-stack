# ui-audit run <runId>

**Sweep completed:** <ISO timestamp>
**Base URL:** <the sweep's base URL, as the extension names it, or default staging>
**Captures:** <captures count from SweepResult>
**Sweep errors:** <errors.length from SweepResult>
**Findings after triage + dedupe:** <N>

---

## Summary

| #   | Route       | Class | Severity | Viewport(s)      | One-liner                                              |
| --- | ----------- | ----- | -------- | ---------------- | ------------------------------------------------------ |
| 1   | settings    | wrap  | balk     | 320x568, 390x844 | Detail column wraps one char per line at mobile widths |
| 2   | item-detail | image | degraded | 320x568          | Header hero image failed to load                       |
| ... | ...         | ...   | ...      | ...              | ...                                                    |

---

## Findings (detail)

### 1. settings::wrap::balk

**Route:** `settings` at `320x568` (also seen at `390x844`)
**State:** `expand-first-card`
**Class:** `wrap` — **Severity:** `balk`

Detail column wraps one character per line at mobile widths.

**Screenshot:** `<outDir>/<runId>/settings__expand-first-card__320x568.png`

**Heuristic snapshot excerpt:**

```json
{
  "hasHorizontalScroll": false,
  "offscreenElements": [],
  "contentDensity": { "mainChildren": 9 }
}
```

---

### 2. item-detail::image::degraded

_...same shape per finding._

---

## Integrity notes

Preflight results that limit what this run covers. Always present; write "None" if every check passed.

- <e.g. "Staging data check: not configured in the extension; population unverified">
- <e.g. "Fixture users are placeholders; skipped auth-required routes: route-a, route-b">

_(When triage returns no findings there is no report file: these notes go in the chat message instead.)_

---

## Sweep integrity (audit-tool issues — not filed to GitHub)

| kind | routeId         | message                                                 |
| ---- | --------------- | ------------------------------------------------------- |
| auth | (none)          | <auth setup error, e.g. admin test credentials not set> |
| load | route-that-404s | net::ERR_NAME_NOT_RESOLVED                              |

_(Section omitted if `SweepResult.errors` is empty.)_

---

## Skipped captures (insufficientData)

| routeId | viewport | state   | mainChildren |
| ------- | -------- | ------- | ------------ |
| account | 320x568  | default | 2            |

_(These captures had `<main>` with < 5 direct children — the render is too thin for meaningful triage. Usually means the seeder hasn't been run. Excluded from findings by design.)_

_(Section omitted if all captures had sufficient data.)_

---

## Cross-run dedupe

Findings dropped because an open `ui-audit` issue already exists:

- `admin-list::overflow::balk` — matches existing issue #N
- ...

_(Section omitted if no dedupes.)_

---

## Awaiting approval

**All N findings above are unfiled.** Reply with:

- "File all" — open a GH issue per finding
- "File #1, #3" — subset
- "Skip #2, file the rest" — negative subset
- "Skip this run — I'll fix these directly" — no filing, report kept

_Approval gate belongs to `ui-audit` SKILL.md § Approval gate. Nothing to `gh` before the user replies._
