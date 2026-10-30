# fwd-stack

The shared stack for Featherweight projects (Concert Crawl, The 99 and whatever comes next): the
configs every project extends, the CI gate every project calls, and the version baseline every
project is held to.

The design and the reasoning behind it are in the
[audit and design doc](https://claude.ai/artifact/Tah89KVLvYZKj7cATrYzwZ).

## What is here

| Path                            | What it is                                                                                                                  |
| ------------------------------- | --------------------------------------------------------------------------------------------------------------------------- |
| `packages/tsconfig`             | `base`, `strictest`, `nextjs` and `node` TypeScript configs                                                                 |
| `packages/eslint-config`        | `base`, `node` and `next` ESLint flat configs                                                                               |
| `packages/prettier-config`      | The shared Prettier config                                                                                                  |
| `packages/commitlint-config`    | Conventional commits with the shared type list                                                                              |
| `.github/workflows/node-ci.yml` | Reusable CI gate: install, then typecheck, lint, test and build                                                             |
| `baseline.json`                 | The majors every project is held to (Node, pnpm, Next, React, Zod, Vitest, Sentry, Drizzle …), plus a Node security minimum |
| `plugins/fwd`                   | Claude Code plugin: the shared agent skills and their guard hooks                                                           |
| `tests/`                        | Proves each config loads and enforces what it claims                                                                        |

Planned, in order: the `stack` generator with opt-in capabilities, `stack doctor` (drift against
`baseline.json`), and a cross-project cost check.

## Using it in a project

The packages are not on npm yet. Until they are, install them from this repo by path:

```sh
pnpm add -D "@fwd-stack/eslint-config@github:HartiganHM/fwd-stack#path:/packages/eslint-config"
```

TypeScript:

```json
{ "extends": "@fwd-stack/tsconfig/nextjs" }
```

ESLint (a project's own rules go after the shared ones):

```js
import next from '@fwd-stack/eslint-config/next';

export default [...next, { rules: {/* project guards */} }];
```

Prettier, in `package.json`: `"prettier": "@fwd-stack/prettier-config"`.

CI, in the project's `.github/workflows/ci.yml`:

```yaml
jobs:
  gate:
    uses: HartiganHM/fwd-stack/.github/workflows/node-ci.yml@main
    with:
      scripts: typecheck lint test build
```

## The Claude Code plugin

This repo is also a Claude Code plugin marketplace. The `fwd` plugin carries the skills and hooks
every project's agents share, so each repo runs the same review gate instead of its own copy.

```sh
/plugin install fwd --marketplace HartiganHM/fwd-stack
```

That one-step form needs Claude Code 2.1.275 or later. On an earlier version, add the
marketplace first:

```sh
/plugin marketplace add HartiganHM/fwd-stack
/plugin install fwd@fwd-stack
```

| Skill                | What it does                                                                                                   |
| -------------------- | -------------------------------------------------------------------------------------------------------------- |
| `pr-review`          | The Copilot review cycle and merge bar: the skill, its gate (`pr-gate.mjs`), watcher and hook                  |
| `feature-acceptance` | Proves a UI feature landed on every route and viewport it claimed                                              |
| `design-review`      | Compares an implementation against its design handoff, property by property                                    |
| `design-status`      | A fixed-shape readout of the design pipeline's state                                                           |
| `css-layout-triage`  | Measurement-first triage for layout bugs that resist fixing                                                    |
| `complete-and-ship`  | Finishes a plan's remaining tasks unattended, then opens and reviews the PR                                    |
| `epic-run`           | Runs a multi-PR feature epic end to end with per-PR and whole-vertical gates                                   |
| `feature-run-report` | The fixed-shape report at the end of an unattended run                                                         |
| `progress-chart`     | Status as a chart: one bar per named feature line from merged PRs, detail per group on request                 |
| `usage-report`       | Splits the weekly Claude allowance by project, model and session, from local transcripts                       |
| `copy-review`        | Writing and reviewing customer-facing copy against the project's voice and locked vocabulary                   |
| `infra-setup`        | Hosting, database and monitoring defaults for a new or audited app, with running cost                          |
| `backlog-audit`      | Audits, triages and prioritises the GitHub Issues backlog, and governs intake                                  |
| `ui-audit`           | Runs the project's UI sweep, triages captures for layout breakage, files on approval                           |
| `prose-pass`         | Rewrites long-form in-app prose in the project's voice, with a fact check (own apps only)                      |
| `run-project`        | The standard operating model: one orchestrator, a capped set of lanes for PR work, subagents for bounded reads |
| `orchestrator`       | Coordinates lane sessions: assigns work, watches stalls and context, rotates lanes, reports status             |
| `lane`               | Works under an orchestrator: stays inside its brief, waits so the wait notifies, writes its handoff            |

Each skill first reads `.claude/fwd/<skill>.md` in the project, if present: the project's own
tools and rules for that skill, which win where they conflict. Settings the skills read (for
example `uiSweep`, `ownApp`) live in `.claude/fwd.json`.

State the skills keep, such as the pre-open pass ledger, lives in the plugin's data folder
(`~/.claude/plugins/data/fwd-fwd-stack/`), never in this repo.

### Setting up a machine

`machine/switch.sh` installs the plugin and makes the machine consistent. It works on a fresh
machine, on one that ran these skills from `~/.claude/skills`, and on one already switched (it
updates the plugin). Backups are kept in `~/.claude/backups/fwd-switchover-<time>/`:

```sh
machine/switch.sh --dry-run   # print every step, change nothing
machine/switch.sh             # back up, install, verify; rolls back on any failed check
machine/rollback.sh [backup]  # undo the last run, or the run whose backup folder you name
```

It does five things:

1. Installs `fwd@fwd-stack`.
2. Retires user-scope copies of the plugin's skills and hooks.
3. Carries the pre-open ledger into the data folder.
4. Links `~/.claude/fwd` to the plugin, so commands and docs outside a hook have a stable path,
   such as `node ~/.claude/fwd/skills/pr-review/pr-gate.mjs <pr>` or
   `node ~/.claude/fwd/hooks/autonomous-guard.mjs arm …`.
5. Points `~/.claude/CLAUDE.md` at that path.

`machine/verify.sh` checks that the guards answer as they should: the Neon guard, the merge
gate and the autonomous-run guard. Run the switch when no session is mid-review or mid-merge,
then restart sessions so they load the plugin's hooks.

**Shipping a plugin change to a machine.** Claude Code fetches a new copy only when
`plugins/fwd/.claude-plugin/plugin.json`'s `version` changes, so a merged change to the plugin
does nothing on a machine until that number is raised. Raise it in the change itself, or in a
follow-up PR, then run `machine/switch.sh` again: it updates the plugin, re-points
`~/.claude/fwd` at the new copy and verifies.

## Working on the kit

```sh
pnpm install
pnpm format:check && pnpm typecheck && pnpm lint
```

That is the whole local gate before a push. Tests run in CI only (the `pr-review` skill, §5).

Raising a version: change `baseline.json` first, then each project. A config change that would
fail an existing project lands with that project's fix PR linked in the description.
